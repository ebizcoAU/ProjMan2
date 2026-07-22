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
const { FINANCIAL_ROLES } = require('../lib/roles');

const SYNC_DEBUG = process.env.SYNC_DEBUG === 'true';

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
async function pushRecord({ orgId, userId, deviceUid, surface, wireName, operation, data, localId }) {
  const entry = TABLES[wireName];
  if (!entry) throw new ServiceError('VALIDATION_ERROR', 'Unsupported table_name', 400);

  // Ownership contract: the registry names one system of record per table; a push from
  // any other surface is refused. Merging is how two surfaces silently overwrite each
  // other's fields.
  if (entry.owner !== surface) {
    throw new ServiceError(
      'NOT_OWNER',
      `${wireName} is owned by the ${entry.owner}; the ${surface} reads it but does not write it.`,
      403
    );
  }

  // The row id may arrive inside data or alongside it — accept both.
  const incoming = { ...data };
  if (!incoming.id && localId) incoming.id = String(localId);
  if (!incoming.id) throw new ServiceError('NO_ID', 'A record id is required', 400);

  const safe = sanitise(incoming, entry);
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
    } else if (operation === 'update') {
      const columns = Object.keys(safe);
      if (columns.length === 0) {
        // Nothing this device may change. Acknowledge so the row leaves the queue
        // rather than retrying forever. (No sync_history row — matches prior behaviour.)
        return { serverId: incoming.id, applied: false };
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
  // Financial redaction: money columns never reach a session whose role cannot see
  // money. This is NOT a per-table pull allowlist (that decision stays locked) — the
  // payload is still the whole row; only registry-declared financial columns are
  // withheld, and only from non-financial roles.
  const seesMoney = FINANCIAL_ROLES.has(role);
  try {
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
    return { last_sync_at: cursorMs, changes };
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
