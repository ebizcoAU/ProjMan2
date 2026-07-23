// MembershipService — who is on which project (migration_v004, §9.4/§9.6).
//
// project_members is the resource-scoping source: an `assigned`/`self` role reaches
// exactly its member projects. Granting or revoking membership therefore changes what
// a user's DEVICES may pull — and rows older than a device's cursor never re-pull on
// their own. So every grant/revoke flags the affected user's live sessions with
// `needs_full_resync`, and the next pull rebuilds that device's scoped view from
// since=0 (SyncService reads and clears the flag). This is the one moment scope and
// the sync cursor interact, and getting it wrong means a device blind to a project it
// was just added to — so it lives here, once.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');

/** Flag every live session of a user so its next pull is a full scope rebuild. */
async function flagResync(userId) {
  await pool.query(
    `UPDATE sessions SET needs_full_resync = 1
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()`,
    [userId]
  );
}

/**
 * Insert a membership row idempotently (revives a soft-deleted one). Returns
 * {id, added}. Does NOT flag resync — callers that grant access to someone who
 * lacked it (addMember) do; callers where the user already has the project locally
 * (the creator self-enrolling, enrolCreator) do not.
 */
async function _upsert({ orgId, projectId, userId, addedBy }) {
  const [[existing]] = await pool.query(
    'SELECT id, is_deleted FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1',
    [projectId, userId]
  );
  if (existing && !existing.is_deleted) return { id: existing.id, added: false };
  if (existing) {
    await pool.query(
      `UPDATE project_members SET is_deleted = 0, added_by = ?, updated_at = ?,
              server_updated_at = NOW(3) WHERE id = ?`,
      [addedBy || null, Date.now(), existing.id]
    );
    return { id: existing.id, added: true };
  }
  const id = uuidv4();
  await pool.query(
    `INSERT INTO project_members (id, org_id, project_id, user_id, added_by,
                                  updated_at, server_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
    [id, orgId, projectId, userId, addedBy || null, Date.now()]
  );
  return { id, added: true };
}

/**
 * Auto-enrol the CREATOR of a project as a member (projman-01 §10.3). Used by both
 * the REST create and the app-authored create-push: an assigned-scope creator must be
 * able to pull the project they just made. No resync flag — the creator already holds
 * the row locally (app) or is portfolio (web); nothing to re-fetch.
 */
async function enrolCreator({ orgId, projectId, userId, addedBy }) {
  if (!userId) return { added: false };
  return _upsert({ orgId, projectId, userId, addedBy: addedBy || userId });
}

/** List a project's members. */
async function listMembers({ orgId, projectId }) {
  const [rows] = await pool.query(
    `SELECT m.id, m.user_id, u.full_name, u.email, u.role, m.added_by, m.created_at
       FROM project_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? AND m.project_id = ? AND m.is_deleted = 0
      ORDER BY u.full_name`,
    [orgId, projectId]
  );
  return { members: rows };
}

/**
 * Add a user to a project. Idempotent (revives a soft-deleted row). Both the project
 * and the user must be in the caller's org — a cross-org member would be a scope hole.
 */
async function addMember({ orgId, projectId, userId, addedBy }) {
  const [[project]] = await pool.query(
    'SELECT id FROM projects WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [projectId, orgId]
  );
  if (!project) throw new ServiceError('NOT_FOUND', 'Project not found', 404);
  const [[user]] = await pool.query(
    'SELECT id FROM users WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [userId, orgId]
  );
  if (!user) throw new ServiceError('VALIDATION_ERROR', 'User not found in your organisation', 422);

  const result = await _upsert({ orgId, projectId, userId, addedBy });
  // Only flag a re-pull when this actually granted access — an already-member is a
  // no-op and must not churn the user's devices into a full resync.
  if (result.added) await flagResync(userId);
  return result;
}

/** Remove a user from a project (soft delete + tombstone so devices drop it). */
async function removeMember({ orgId, projectId, userId }) {
  const [result] = await pool.query(
    `UPDATE project_members SET is_deleted = 1, updated_at = ?, server_updated_at = NOW(3)
      WHERE org_id = ? AND project_id = ? AND user_id = ? AND is_deleted = 0`,
    [Date.now(), orgId, projectId, userId]
  );
  if (result.affectedRows === 0) throw new ServiceError('NOT_FOUND', 'Membership not found', 404);
  await flagResync(userId);
  return { removed: true };
}

module.exports = { listMembers, addMember, removeMember, enrolCreator, flagResync };
