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
  const cls = scopeClassFor(auth.role);
  if (cls === 'portfolio') return { sql: '', params: [] };

  // engagement + portal are not resolvable in v1 (projman-02 / P10). Fail closed:
  // reach nothing rather than fall through to org-wide.
  if (cls === 'engagement' || cls === 'portal') {
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
