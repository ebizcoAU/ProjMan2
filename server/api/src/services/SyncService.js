// SyncService — the push/pull/status business logic, lifted out of routes/sync.js.
//
// The route is now transport only: validate, read the token, call a method, map the
// result. Every rule that keeps sync honest lives here, callable from anywhere:
//
//   1. Cursor is server epoch-ms, bounded both ends (timezone-independent).
//   2. A device never receives its own echo.
//   3. Single writer per entity (ftpos XF-27) — a push from the wrong surface is
//      refused, not merged.
//
// And ProjMan2's own guarantee: every query filters on `orgId`, which the caller
// passes from the verified token — never from a request body.

const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const { TABLES, sanitise, maskSensitive } = require('../sync/registry');
const access = require('../lib/access');
const { projectScope, isProjectMember } = require('../lib/scope');
const MembershipService = require('./MembershipService');
const StageProgressionService = require('./StageProgressionService');

const SYNC_DEBUG = process.env.SYNC_DEBUG === 'true';

/** snake_case → camelCase, for reading a project id the app may send either way. */
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** Append a sync-cycle row. Never allowed to fail the operation that caused it. */
async function logSync(actor, syncType, tableName, count, status = 'success', error = null) {
  try {
    await pool.query(
      `INSERT INTO sync_history
         (org_id, user_id, device_id, sync_type, table_name, records_synced, status,
          error_message, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      [actor.orgId, actor.userId, actor.deviceUid, syncType, tableName, count, status, error]
    );
  } catch (err) {
    console.warn('[SYNC] history write failed (non-fatal):', err.message);
  }
}

/**
 * Apply one create/update/delete from a device.
 * @returns {Promise<{serverId:string, applied:boolean}>}
 * @throws  {ServiceError} NOT_OWNER | NO_ID | CREATE_NOT_ALLOWED | NOT_FOUND | PUSH_FAILED
 */
async function pushRecord({ orgId, userId, deviceUid, role, surface, wireName, operation, data, localId }) {
  const entry = TABLES[wireName];
  if (!entry) throw new ServiceError('VALIDATION_ERROR', 'Unsupported table_name', 400);

  // Ownership contract: the registry names one system of record per table; a push from
  // any other surface is refused. Merging is how two surfaces silently overwrite each
  // other's fields.
  //
  // Exception — per-operation ownership (projman-01 §4, 2026-07-23): a table may set
  // `appCreate` to let the field app CREATE (never update/delete) even though the web
  // owns it. A create is a new row with a client UUID — no single-writer conflict —
  // so offline on-site creation (Stage 1) is safe while edits stay WEB-only.
  const isAppCreate = operation === 'create' && entry.appCreate && surface === 'app';
  if (entry.owner !== surface && !isAppCreate) {
    throw new ServiceError(
      'NOT_OWNER',
      `${wireName} is owned by the ${entry.owner}; the ${surface} may ${entry.appCreate ? 'create but not update/delete it' : 'read it but not write it'}.`,
      403
    );
  }
  // App-create is still permission-gated: only a role entitled to write the table
  // (projectManager for projects/customers) may create it — a tradie's tablet cannot.
  if (isAppCreate && entry.createPermission && !access.hasPermission(role, entry.createPermission)) {
    throw new ServiceError(
      'FORBIDDEN',
      `Creating ${wireName} requires the ${entry.createPermission} permission`,
      403
    );
  }

  // The row id may arrive inside data or alongside it — accept both.
  const incoming = { ...data };
  if (!incoming.id && localId) incoming.id = String(localId);
  if (!incoming.id) throw new ServiceError('NO_ID', 'A record id is required', 400);

  // Resource scoping (§9.4): a project-scoped table pushed by an assigned/self role
  // must land inside a project the pusher is a member of. Portfolio roles skip this.
  // Checked BEFORE the write so a non-member can neither create nor mutate rows on
  // another crew's job — org isolation was never enough for this.
  if (entry.projectColumn && role && access.scopeClassFor(role) !== 'portfolio') {
    let projectId = entry.projectColumn === 'id'
      ? incoming.id
      : incoming[entry.projectColumn] ?? incoming[toCamel(entry.projectColumn)];
    // An update/delete need only carry the row id — resolve the project from the
    // existing row rather than forcing the app to resend project_id on every edit.
    if (!projectId && operation !== 'create' && entry.projectColumn !== 'id') {
      const [[row]] = await pool.query(
        `SELECT \`${entry.projectColumn}\` AS pid FROM \`${entry.table}\`
          WHERE id = ? AND \`${entry.orgColumn || 'org_id'}\` = ? LIMIT 1`,
        [incoming.id, orgId]
      );
      projectId = row?.pid;
    }
    if (!projectId) {
      throw new ServiceError('VALIDATION_ERROR', `${wireName} push needs a project id`, 400);
    }
    const member = await isProjectMember(pool, { orgId, userId, projectId: String(projectId) });
    if (!member) {
      throw new ServiceError('NOT_MEMBER', 'You are not a member of that project', 403);
    }
  }

  const safe = sanitise(incoming, entry);
  // The handler stamps updated_at itself (push receive time) — carrying the client's
  // copy through `safe` as well made the INSERT name the column twice (ER 1110),
  // which surfaced on the first create-push against the v003 tables.
  delete safe.updated_at;
  const nowMs = Date.now();
  const orgColumn = entry.orgColumn || 'org_id';
  const actor = { orgId, userId, deviceUid };

  try {
    if (operation === 'create') {
      // `organisations` is created at registration, never via sync — the tenant cannot
      // invent itself, and its scope column is `id`, not `org_id`.
      if (orgColumn !== 'org_id') {
        throw new ServiceError('CREATE_NOT_ALLOWED', `${wireName} cannot be created through sync`, 403);
      }
      const columns = Object.keys(safe);
      const values = Object.values(safe);
      await pool.query(
        `INSERT INTO \`${entry.table}\`
           (id, org_id${columns.length ? ', ' + columns.map((c) => `\`${c}\``).join(', ') : ''},
            device_id, updated_at, server_updated_at)
         VALUES (?, ?${columns.length ? ', ' + columns.map(() => '?').join(', ') : ''}, ?, ?, NOW(3))
         ON DUPLICATE KEY UPDATE
           ${columns.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).concat([
             'device_id = VALUES(device_id)',
             'updated_at = VALUES(updated_at)',
             'server_updated_at = NOW(3)',
           ]).join(', ')}`,
        [incoming.id, orgId, ...values, deviceUid, nowMs]
      );

      // Auto-enrol the creator of an app-authored project (projman-01 §10.3): the PM
      // who pushed the Stage-1 create must be able to pull it back. Only for the
      // project row itself (projectColumn 'id'); stages/tasks inherit their project's
      // membership. No resync flag — the authoring device already holds the row.
      if (entry.appCreate && entry.projectColumn === 'id') {
        await MembershipService.enrolCreator({ orgId, projectId: incoming.id, userId });
      }
    } else if (operation === 'update') {
      const columns = Object.keys(safe);
      if (columns.length === 0) {
        // Nothing this device may change. Acknowledge so the row leaves the queue
        // rather than retrying forever. (No sync_history row — matches prior behaviour.)
        return { serverId: incoming.id, applied: false };
      }

      // Stage progression gate (§10.4): a device advancing project_stages.status runs
      // the SAME StageProgressionService.checkTransition the REST /advance runs — a
      // hold point can't be skipped by pushing instead of calling. Only when status
      // is actually changing; a pure date/other-field push is untouched.
      if (wireName === 'project_stages' && 'status' in safe) {
        const [[current]] = await pool.query(
          'SELECT * FROM project_stages WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
          [incoming.id, orgId]
        );
        if (!current) throw new ServiceError('NOT_FOUND', 'Record not found', 404);
        await StageProgressionService.checkTransition({
          actor: { orgId, userId, role }, stage: current, toStatus: safe.status,
        });
      }

      const [result] = await pool.query(
        `UPDATE \`${entry.table}\`
            SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')},
                device_id = ?, updated_at = ?, server_updated_at = NOW(3)
          WHERE id = ? AND \`${orgColumn}\` = ?`,
        [...Object.values(safe), deviceUid, nowMs, incoming.id, orgId]
      );
      // Zero rows = the id does not exist IN THIS ORG. 404 either way, on purpose:
      // telling the caller apart would confirm another builder owns that id.
      if (result.affectedRows === 0) throw new ServiceError('NOT_FOUND', 'Record not found', 404);
    } else if (operation === 'delete') {
      // Soft delete only. The tombstone tells other devices to remove their copy; a
      // hard delete would leave the row alive on every device offline at the time.
      const [result] = await pool.query(
        `UPDATE \`${entry.table}\`
            SET is_deleted = 1, device_id = ?, updated_at = ?, server_updated_at = NOW(3)
          WHERE id = ? AND \`${orgColumn}\` = ?`,
        [deviceUid, nowMs, incoming.id, orgId]
      );
      if (result.affectedRows === 0) throw new ServiceError('NOT_FOUND', 'Record not found', 404);
    }

    await logSync(actor, 'push', wireName, 1);
    if (SYNC_DEBUG) {
      console.log(`[SYNC/PUSH] ${wireName}.${operation} id=${incoming.id} org=${orgId} data=`, maskSensitive(safe));
    }
    return { serverId: incoming.id, applied: true };
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    console.error(`[SYNC/PUSH] ${wireName}.${operation} failed:`, err.message);
    await logSync(actor, 'push', wireName, 0, 'failed', err.message);
    throw new ServiceError('PUSH_FAILED', 'Push failed', 500);
  }
}

/**
 * Return all changes for this org since the cursor.
 * @returns {Promise<{last_sync_at:number, changes:Array}>}
 */
async function pullDeltas({ orgId, userId, deviceUid, jti, sinceMs, role }) {
  const actor = { orgId, userId, deviceUid };
  // Financial redaction: money columns never reach a session without `money.read`.
  // This is NOT a per-table pull allowlist (that decision stays locked) — the payload
  // is still the whole row; only registry-declared financial columns are withheld.
  const seesMoney = access.hasPermission(role, 'money.read');
  try {
    // Membership change → full re-pull (§9.4). Rows older than the device's cursor
    // never re-pull on their own, so a just-granted project would stay invisible.
    // When a grant/revoke set needs_full_resync, we ignore the client cursor for THIS
    // pull (since=0) and clear the flag, so the device rebuilds its scoped view once.
    let forcedFullSync = false;
    if (jti) {
      const [[s]] = await pool.query(
        'SELECT needs_full_resync FROM sessions WHERE refresh_token = ? LIMIT 1', [jti]
      );
      if (s?.needs_full_resync) {
        forcedFullSync = true;
        sinceMs = 0;
        await pool.query(
          'UPDATE sessions SET needs_full_resync = 0 WHERE refresh_token = ?', [jti]
        ).catch(() => {});
      }
    }

    // Cursor: an epoch-ms value the DB computes BEFORE the row queries. Comparing
    // UNIX_TIMESTAMP epochs is timezone-independent — it does not matter what the
    // server's session tz is, only that reads + cursor share it (they do, one pool).
    const [[{ cursor_ms }]] = await pool.query(
      'SELECT ROUND(UNIX_TIMESTAMP(NOW(3)) * 1000) AS cursor_ms'
    );
    const cursorMs = Number(cursor_ms);
    const changes = [];

    for (const [wireName, entry] of Object.entries(TABLES)) {
      if (!entry.pull) continue;

      const orgColumn = entry.orgColumn || 'org_id';
      const params = [orgId, sinceMs, cursorMs];
      let scopeSql = '';
      if (entry.scope === 'self') {
        scopeSql = ' AND user_id = ?';
        params.push(userId);
      }
      // Resource scoping (§9.4): a project-scoped table returns only the member
      // projects' rows to an assigned/self role. A portfolio role gets '' (org-wide).
      // The scope source table (project_members) has no projectColumn on purpose —
      // a device must receive its own membership rows to know what it may reach.
      if (entry.projectColumn) {
        const { sql, params: sp } = projectScope(
          { role, userId },
          { projectColumn: entry.projectColumn, selfColumn: entry.selfColumn }
        );
        scopeSql += sql;
        params.push(...sp);
      }
      // Echo skip. NULL-safe `<=>` so a web-written row (device_id NULL) still reaches
      // every device.
      const echoSql = deviceUid ? ' AND NOT (device_id <=> ?)' : '';
      if (deviceUid) params.push(deviceUid);

      const [rows] = await pool.query(
        `SELECT *, ROUND(UNIX_TIMESTAMP(server_updated_at) * 1000) AS _su_ms
           FROM \`${entry.table}\`
          WHERE \`${orgColumn}\` = ?
            AND ROUND(UNIX_TIMESTAMP(server_updated_at) * 1000) >  ?
            AND ROUND(UNIX_TIMESTAMP(server_updated_at) * 1000) <= ?
            ${scopeSql}${echoSql}`,
        params
      );

      for (const row of rows) {
        // Strip: password_hash (secret), _su_ms (internal), server_updated_at (a
        // DATETIME string the client neither needs nor can store in its ms column).
        const { password_hash, _su_ms, server_updated_at, ...rowData } = row;
        if (!seesMoney && entry.financialColumns) {
          for (const col of entry.financialColumns) delete rowData[col];
        }
        changes.push({
          table_name: wireName,
          operation: row.is_deleted ? 'delete' : 'create',
          server_id: row[entry.idColumn],
          local_id: row[entry.idColumn],
          data: rowData,
          updated_at: Number(row.updated_at) || Number(_su_ms),
        });
      }
    }

    // Oldest first so a client applying in order never sees a child before its parent.
    changes.sort((a, b) => a.updated_at - b.updated_at);

    await logSync(actor, 'pull', null, changes.length);
    if (jti) {
      await pool.query('UPDATE sessions SET last_sync_at = NOW() WHERE refresh_token = ?', [jti]).catch(() => {});
    }
    // requiresFullSync signals the app that this pull was a scope rebuild (from
    // since=0) — the same field device-loss recovery uses, so the client already
    // knows to treat the response as authoritative for the scoped tables.
    return { last_sync_at: cursorMs, changes, requiresFullSync: forcedFullSync };
  } catch (err) {
    console.error('[SYNC/PULL] Error:', err.message);
    await logSync(actor, 'pull', null, 0, 'failed', err.message);
    throw new ServiceError('PULL_FAILED', 'Pull failed', 500);
  }
}

/** Sync health for a device/session. */
async function status({ orgId, deviceUid, jti }) {
  const [[session]] = jti
    ? await pool.query(
        `SELECT is_authoritative, last_sync_at, last_pending_count
           FROM sessions WHERE refresh_token = ? LIMIT 1`,
        [jti]
      )
    : [[null]];

  const [[last]] = await pool.query(
    `SELECT sync_type, records_synced, status, started_at
       FROM sync_history
      WHERE org_id = ? AND (? IS NULL OR device_id = ?)
      ORDER BY started_at DESC LIMIT 1`,
    [orgId, deviceUid, deviceUid]
  );

  return {
    authoritative: !!session?.is_authoritative,
    lastSyncAt: session?.last_sync_at || null,
    pendingOnDevice: session?.last_pending_count ?? 0,
    lastCycle: last || null,
    tables: Object.entries(TABLES).map(([name, e]) => ({ name, owner: e.owner, pull: e.pull })),
    serverTime: Date.now(),
  };
}

module.exports = { pushRecord, pullDeltas, status };
