// Resource scoping — the WHICH-rows dimension of access control (§9.4).
//
// Role answers "what kinds of things can you do" (lib/access permissions). Scope
// answers "on which things". A `portfolio` role reaches every project in the org; an
// `assigned` role reaches only its `project_members` projects; a `self` role is
// additionally narrowed to its own rows on self-owned tables.
//
// This module returns SQL fragments the service layer and SyncService compose onto
// their queries — so scoping is applied at the DB, not filtered in JS after the fact
// (which would pull the rows into memory before dropping them — the exact leak being
// closed). Every fragment is org-scoped first; scope only ever NARROWS from there.

const { scopeClassFor } = require('./access');

// The subquery of project ids an assigned/self actor may reach. Kept as a correlated
// IN (…) rather than a JOIN so it drops into any query that has a project_id column.
const MEMBER_PROJECT_IDS =
  '(SELECT pm.project_id FROM project_members pm WHERE pm.user_id = ? AND pm.is_deleted = 0)';

/**
 * A WHERE fragment restricting `<alias>.<projectColumn>` to what this actor reaches.
 *
 * @param {object} auth        req.auth (needs role, userId)
 * @param {object} [opts]
 * @param {string} [opts.projectColumn='project_id'] the project fk on the table
 * @param {string} [opts.alias]  table alias, e.g. 'p'
 * @param {string} [opts.selfColumn] for `self` scope: the row-owner column
 *                 (e.g. 'assigned_to' on tasks). Omitted → self behaves as assigned.
 * @returns {{sql:string, params:Array}}  sql is '' for portfolio (no narrowing).
 */
function projectScope(auth, { projectColumn = 'project_id', alias = null, selfColumn = null } = {}) {
  // PM2-02 (§13.2/§13.5): an activated engagement SESSION overrides the role's own
  // normal scope resolution entirely, regardless of what scope class the role
  // itself carries. This is deliberately keyed off `auth.scopeJson` (a session-level
  // fact — only ever present on a token minted by EngagementService.activate(),
  // already verified active by the auth middleware before a request reaches here),
  // NOT off `scopeClassFor(auth.role)` — a `tradie`'s own scope class is `self`
  // (project_members-based) whether or not they happen to be engaged right now, and
  // an engaged person holds NO project_members row in the engaging org at all
  // (that's the whole point of the bridge, §13.0), so the role's normal resolution
  // would always find nothing here regardless of which class it names.
  if (auth.scopeJson?.project_id) {
    const col = alias ? `${alias}.\`${projectColumn}\`` : `\`${projectColumn}\``;
    return { sql: ` AND ${col} = ?`, params: [auth.scopeJson.project_id] };
  }

  const cls = scopeClassFor(auth.role);
  if (cls === 'portfolio') return { sql: '', params: [] };

  // `portal` is not resolvable in v1 (P10 territory, unrelated to PM2-02). A role
  // whose OWN scope class is `engagement` but has no active engagement session
  // right now (no role is actually assigned this class today) falls in here too —
  // fail closed for both: reach nothing rather than fall through to org-wide.
  if (cls === 'portal' || cls === 'engagement') {
    return { sql: ' AND 1 = 0', params: [] };
  }

  const col = alias ? `${alias}.\`${projectColumn}\`` : `\`${projectColumn}\``;
  const parts = [`${col} IN ${MEMBER_PROJECT_IDS}`];
  const params = [auth.userId];

  if (cls === 'self' && selfColumn) {
    const sc = alias ? `${alias}.\`${selfColumn}\`` : `\`${selfColumn}\``;
    parts.push(`${sc} = ?`);
    params.push(auth.userId);
  }

  return { sql: ' AND ' + parts.join(' AND '), params };
}

/** True if this actor may reach `projectId` at all (membership check for writes). */
async function isProjectMember(pool, { orgId, userId, projectId }) {
  const [[row]] = await pool.query(
    `SELECT 1 FROM project_members
      WHERE org_id = ? AND user_id = ? AND project_id = ? AND is_deleted = 0 LIMIT 1`,
    [orgId, userId, projectId]
  );
  return !!row;
}

module.exports = { projectScope, isProjectMember, MEMBER_PROJECT_IDS };
