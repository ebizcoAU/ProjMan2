// SiteOpsService — the rules for the site-ops module (servdesignspec §11).
//
// Like StageProgressionService (§10), this holds every rule that the generic sync
// writer can't, and it is called FROM SyncService.pushRecord so the rules hold on the
// one write path the site actually uses — offline-first /sync/push. Two entry points:
//
//   guardPush(...)  — BEFORE the write: permission + the append-only diary invariant.
//                     Pure checks; throws a ServiceError or returns.
//   afterPush(...)  — AFTER the write: stamp the server-controlled columns the tablet
//                     may not set — diary provenance (author/finalised/is_current),
//                     the delivery receiver, and the geofence verdict.
//
// The split exists because these tables mix app-written body columns (which the sync
// writer applies) with server-owned provenance (which only a trusted server path may
// set — the legal record must name who the server authenticated, not who the client
// claims). Project-membership scope is NOT re-implemented here: SyncService's generic
// projectColumn block already refuses a non-member's push (§9.4).

const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const AttestationService = require('./AttestationService');

// The three tables this service governs. A push for anything else is a no-op here.
const SITE_OPS_TABLES = new Set(['site_diary', 'site_attendance', 'deliveries']);

const isSiteOps = (wireName) => SITE_OPS_TABLES.has(wireName);

/** Load a site-ops row in the caller's org, or null (non-disclosure — 404 upstream). */
async function loadRow(table, id, orgId) {
  const [[row]] = await pool.query(
    `SELECT * FROM \`${table}\` WHERE id = ? AND org_id = ? LIMIT 1`,
    [id, orgId]
  );
  return row || null;
}

/**
 * BEFORE the write. Throws unless this push is allowed.
 *
 * @param {object} p
 * @param {string} p.wireName   site_diary | site_attendance | deliveries
 * @param {string} p.operation  create | update | delete
 * @param {string} p.id         the row id being written
 * @param {object} p.safe       the sanitised, app-writable columns about to be written
 * @param {object} p.actor      { orgId, userId, role }
 */
async function guardPush({ wireName, operation, id, safe, actor }) {
  if (!isSiteOps(wireName)) return;
  const has = (perm) => access.hasPermission(actor.role, perm);

  if (wireName === 'site_diary') {
    // The append-only invariant (§11.4). A finalised entry is immutable — corrections
    // arrive as a NEW row (create, version+1, supersedes_id), never as an edit.
    if (operation === 'update' || operation === 'delete') {
      const existing = await loadRow('site_diary', id, actor.orgId);
      if (!existing) throw new ServiceError('NOT_FOUND', 'Diary entry not found', 404);
      if (existing.status === 'final') {
        throw new ServiceError('DIARY_FINAL',
          'This diary entry is finalised and cannot be edited or deleted — supersede it with a new version', 409);
      }
    }
    // Finalising (status → final) is the sign-off authority; plain draft edits need
    // only diary.write. A create that lands already-final also needs sign-off.
    const finalising = safe.status === 'final';
    if (operation === 'delete') {
      if (!has('diary.write')) throw new ServiceError('FORBIDDEN', 'Requires permission: diary.write', 403);
    } else if (finalising) {
      if (!has('diary.signoff')) throw new ServiceError('FORBIDDEN', 'Requires permission: diary.signoff', 403);
    } else if (!has('diary.write')) {
      throw new ServiceError('FORBIDDEN', 'Requires permission: diary.write', 403);
    }
    return;
  }

  if (wireName === 'site_attendance') {
    // Either muster the crew (write.site → any person) or check yourself in
    // (write.own → the row's person must be you). A tradie holds only .own.
    if (has('attendance.write.site')) return;
    if (!has('attendance.write.own')) {
      throw new ServiceError('FORBIDDEN', 'Requires permission: attendance.write.site or attendance.write.own', 403);
    }
    // .own only: resolve the person — from the payload, or the existing row on an edit.
    let personId = safe.person_id;
    if (personId === undefined && operation !== 'create') {
      const existing = await loadRow('site_attendance', id, actor.orgId);
      if (!existing) throw new ServiceError('NOT_FOUND', 'Attendance record not found', 404);
      personId = existing.person_id;
    }
    if (String(personId || '') !== String(actor.userId)) {
      throw new ServiceError('FORBIDDEN', 'You may only record your own attendance', 403);
    }
    return;
  }

  if (wireName === 'deliveries') {
    if (!has('deliveries.write')) {
      throw new ServiceError('FORBIDDEN', 'Requires permission: deliveries.write', 403);
    }
  }
}

/** Great-circle distance in metres between two lat/lng points. */
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * AFTER the write. Stamps the server-controlled columns the tablet may not set.
 * Best-effort per column, but a throw here fails the push (the caller is inside the
 * push try) — these are cheap single-row updates on a row that just succeeded.
 *
 * @param {object} p  { wireName, operation, id, safe, actor }
 */
async function afterPush({ wireName, operation, id, safe, actor }) {
  if (!isSiteOps(wireName) || operation === 'delete') return;
  const orgId = actor.orgId;

  if (wireName === 'site_diary') {
    // Provenance: first author is sticky; the finalise stamp is set the moment the row
    // reads 'final' and isn't yet stamped (covers both create-final and draft→final).
    await pool.query(
      `UPDATE site_diary
          SET author_id = COALESCE(author_id, ?),
              finalised_at = CASE WHEN status = 'final' AND finalised_at IS NULL THEN NOW() ELSE finalised_at END,
              finalised_by = CASE WHEN status = 'final' AND finalised_by IS NULL THEN ?    ELSE finalised_by END
        WHERE id = ? AND org_id = ?`,
      [actor.userId, actor.userId, id, orgId]
    );
    // A superseding create retires its predecessor as the current version (§11.4).
    if (operation === 'create' && safe.supersedes_id) {
      await pool.query(
        `UPDATE site_diary SET is_current = 0, server_updated_at = NOW(3)
          WHERE id = ? AND org_id = ?`,
        [safe.supersedes_id, orgId]
      );
    }
    // PM2-02 evidence emission (§13.3) — the signer's own record (diary sign-off
    // authority is theirs alone, §11.4). guardPush already refuses any further write
    // to a finalised row, so `safe.status === 'final'` here can only be the one
    // moment this row is finalising — no separate "did it just transition" check
    // needed. Best-effort, never fails a push that already committed.
    if (safe.status === 'final') {
      AttestationService.emit({
        subjectUserId: actor.userId, issuingOrgId: orgId,
        sourceType: 'diary_entry', sourceId: id, payload: { table: 'site_diary' },
      }).catch((err) => console.warn('[ATTESTATION] diary_entry emit failed (non-fatal):', err.message));
    }
    return;
  }

  if (wireName === 'site_attendance') {
    // Derive geo_verified only when THIS push carried coordinates — never clobber a
    // prior verdict on a check-out-only edit. NULL when the project has no geofence
    // (graceful degrade — appspec Decision 4: never block, never false-fail).
    if (safe.check_in_lat === undefined || safe.check_in_lng === undefined) return;
    const [[row]] = await pool.query(
      `SELECT a.check_in_lat, a.check_in_lng,
              p.geofence_lat, p.geofence_lng, p.geofence_radius_m
         FROM site_attendance a
         JOIN projects p ON p.id = a.project_id
        WHERE a.id = ? AND a.org_id = ? LIMIT 1`,
      [id, orgId]
    );
    if (!row || row.geofence_lat == null || row.geofence_lng == null
        || row.check_in_lat == null || row.check_in_lng == null) return;
    const dist = haversineMetres(
      Number(row.check_in_lat), Number(row.check_in_lng),
      Number(row.geofence_lat), Number(row.geofence_lng)
    );
    const verified = dist <= (row.geofence_radius_m ?? 200) ? 1 : 0;
    await pool.query(
      `UPDATE site_attendance SET geo_verified = ?, server_updated_at = NOW(3)
        WHERE id = ? AND org_id = ?`,
      [verified, id, orgId]
    );
    return;
  }

  if (wireName === 'deliveries') {
    await pool.query(
      `UPDATE deliveries SET received_by = COALESCE(received_by, ?)
        WHERE id = ? AND org_id = ?`,
      [actor.userId, id, orgId]
    );
  }
}

module.exports = { isSiteOps, guardPush, afterPush, SITE_OPS_TABLES, haversineMetres };
