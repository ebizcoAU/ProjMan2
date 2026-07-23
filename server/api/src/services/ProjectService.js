// ProjectService — the projects/stages business logic (migration_v003).
//
// The web console is the system of record for project structure (creation, budget,
// programme shape); the field app pushes progress through sync. Console writes land
// here, and every write stamps `updated_at` (ms) + `server_updated_at` so devices
// pull the change on their next cycle — a console edit IS a sync event.
//
// Financial redaction is applied at this layer too: the same role that cannot pull
// contract_value must not read it through the REST surface either.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const { projectScope } = require('../lib/scope');
const MembershipService = require('./MembershipService');

const PROJECT_FIELDS = [
  'customer_id', 'code', 'name', 'site_address', 'lot_plan', 'contract_value',
  'contract_type', 'start_date', 'due_date', 'status', 'template_id', 'pm_user_id',
];
// Structure fields only. `status` is deliberately NOT here — it moves solely through
// StageProgressionService (the gated /advance endpoint or a gated sync push), never a
// bare PATCH, so a hold point can't be sidestepped. Same for is_validated (§10.4).
const STAGE_FIELDS = [
  'seq', 'stage_code', 'name', 'milestone', 'start_date', 'end_date',
  'budget_amount', 'estimated_amount', 'committed_amount', 'actual_amount', 'claimed_amount',
];

const seesMoney = (role) => access.hasPermission(role, 'money.read');

function redactProject(row, role) {
  if (seesMoney(role)) return row;
  const { contract_value, ...rest } = row;
  return rest;
}

function redactStage(row, role) {
  if (seesMoney(role)) return row;
  const {
    budget_amount, estimated_amount, committed_amount, actual_amount, claimed_amount, ...rest
  } = row;
  return rest;
}

function redactTask(row, role) {
  if (seesMoney(role)) return row;
  const { budget_hours, budget_amount, ...rest } = row;
  return rest;
}

/** Guard: a referenced row must exist in the SAME org — a cross-org FK is an attack. */
async function assertInOrg(table, id, orgId, label) {
  if (!id) return;
  const [[row]] = await pool.query(
    `SELECT id FROM \`${table}\` WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
    [id, orgId]
  );
  if (!row) throw new ServiceError('VALIDATION_ERROR', `${label} not found in your organisation`, 422);
}

/** Guard: the actor must be able to REACH this project (org + membership for a
 *  non-portfolio role). A PM may edit the programme only on their own jobs. 404, not
 *  403, for a non-member — same non-disclosure rule as getProject. */
async function assertProjectReachable(orgId, projectId, auth) {
  const scope = projectScope(auth, { projectColumn: 'id' });
  const [[row]] = await pool.query(
    `SELECT id FROM projects WHERE id = ? AND org_id = ? AND is_deleted = 0${scope.sql} LIMIT 1`,
    [projectId, orgId, ...scope.params]
  );
  if (!row) throw new ServiceError('NOT_FOUND', 'Project not found', 404);
}

// ── Projects ─────────────────────────────────────────────────────────────────

async function listProjects({ orgId, role, userId, status, page = 1, limit = 20 }) {
  const params = [orgId];
  let where = 'p.org_id = ? AND p.is_deleted = 0';
  if (status) { where += ' AND p.status = ?'; params.push(status); }
  // Resource scope (§9.4): an assigned/self role lists only member projects; a
  // portfolio role lists the whole org. Same fragment the sync pull uses.
  const scope = projectScope({ role, userId }, { projectColumn: 'id', alias: 'p' });
  where += scope.sql;
  params.push(...scope.params);

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM projects p WHERE ${where}`, params
  );
  const [rows] = await pool.query(
    `SELECT p.id, p.customer_id, c.name AS customer_name, p.code, p.name,
            p.site_address, p.lot_plan, p.contract_value, p.contract_type,
            p.start_date, p.due_date, p.status, p.template_id,
            p.pm_user_id, pm.full_name AS pm_name, p.created_at
       FROM projects p
       LEFT JOIN customers c ON c.id = p.customer_id
       LEFT JOIN users pm    ON pm.id = p.pm_user_id
      WHERE ${where}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Number(page) - 1) * Number(limit)]
  );

  return {
    projects: rows.map((r) => redactProject(r, role)),
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) || 1 },
  };
}

async function getProject({ orgId, role, userId, id }) {
  // A non-member assigned/self role gets 404, not 403 — revealing "exists but denied"
  // would leak the org's project list one probe at a time.
  const scope = projectScope({ role, userId }, { projectColumn: 'id', alias: 'p' });
  const [[project]] = await pool.query(
    `SELECT p.*, c.name AS customer_name, pm.full_name AS pm_name
       FROM projects p
       LEFT JOIN customers c ON c.id = p.customer_id
       LEFT JOIN users pm    ON pm.id = p.pm_user_id
      WHERE p.id = ? AND p.org_id = ? AND p.is_deleted = 0${scope.sql} LIMIT 1`,
    [id, orgId, ...scope.params]
  );
  if (!project) throw new ServiceError('NOT_FOUND', 'Project not found', 404);

  const [stages] = await pool.query(
    `SELECT * FROM project_stages
      WHERE project_id = ? AND org_id = ? AND is_deleted = 0 ORDER BY seq, created_at`,
    [id, orgId]
  );
  const [tasks] = await pool.query(
    `SELECT t.*, u.full_name AS assigned_to_name
       FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.project_id = ? AND t.org_id = ? AND t.is_deleted = 0
      ORDER BY t.start_date IS NULL, t.start_date, t.created_at`,
    [id, orgId]
  );

  return {
    project: redactProject(project, role),
    stages: stages.map((s) => redactStage(s, role)),
    tasks: tasks.map((t) => redactTask(t, role)),
  };
}

async function createProject({ orgId, data, addedBy }) {
  await assertInOrg('customers', data.customer_id, orgId, 'Customer');
  if (data.pm_user_id) {
    const [[pm]] = await pool.query(
      'SELECT id FROM users WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
      [data.pm_user_id, orgId]
    );
    if (!pm) throw new ServiceError('VALIDATION_ERROR', 'Project manager not found in your organisation', 422);
  }

  const id = uuidv4();
  const fields = {};
  for (const key of PROJECT_FIELDS) {
    if (data[key] !== undefined) fields[key] = data[key] === '' ? null : data[key];
  }
  const columns = Object.keys(fields);

  try {
    await pool.query(
      `INSERT INTO projects (id, org_id${columns.map((c) => `, \`${c}\``).join('')},
                             updated_at, server_updated_at)
       VALUES (?, ?${columns.map(() => ', ?').join('')}, ?, NOW(3))`,
      [id, orgId, ...Object.values(fields), Date.now()]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new ServiceError('DUPLICATE_CODE', `Project code "${data.code}" is already in use`, 409);
    }
    throw err;
  }

  // Auto-enrol the creator (projman-01 §10.3) — they must be able to pull what they
  // just made. A named PM different from the creator is a deliberate grant (resync).
  if (addedBy) {
    await MembershipService.enrolCreator({ orgId, projectId: id, userId: addedBy });
  }
  if (data.pm_user_id && data.pm_user_id !== addedBy) {
    await MembershipService.addMember({ orgId, projectId: id, userId: data.pm_user_id, addedBy });
  }
  return { id };
}

async function updateProject({ orgId, id, data, addedBy }) {
  await assertInOrg('customers', data.customer_id, orgId, 'Customer');

  const fields = {};
  for (const key of PROJECT_FIELDS) {
    if (data[key] !== undefined) fields[key] = data[key] === '' ? null : data[key];
  }
  const columns = Object.keys(fields);
  if (columns.length === 0) throw new ServiceError('NO_FIELDS', 'Nothing to update', 400);

  const [result] = await pool.query(
    `UPDATE projects
        SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')},
            updated_at = ?, server_updated_at = NOW(3)
      WHERE id = ? AND org_id = ? AND is_deleted = 0`,
    [...Object.values(fields), Date.now(), id, orgId]
  );
  if (result.affectedRows === 0) throw new ServiceError('NOT_FOUND', 'Project not found', 404);

  // Reassigning the PM makes the new PM a member (keeps their assigned scope honest).
  // The old PM's membership is left intact deliberately — someone who ran a job keeps
  // read access to it unless explicitly removed via the Team tab.
  if (data.pm_user_id) {
    await MembershipService.addMember({ orgId, projectId: id, userId: data.pm_user_id, addedBy });
  }
  return { id };
}

// ── Stages ───────────────────────────────────────────────────────────────────

async function createStage({ orgId, projectId, data, auth }) {
  await assertProjectReachable(orgId, projectId, auth);

  const id = uuidv4();
  const fields = { name: data.name };
  for (const key of STAGE_FIELDS) {
    if (data[key] !== undefined) fields[key] = data[key] === '' ? null : data[key];
  }
  const columns = Object.keys(fields);

  await pool.query(
    `INSERT INTO project_stages (id, org_id, project_id${columns.map((c) => `, \`${c}\``).join('')},
                                 updated_at, server_updated_at)
     VALUES (?, ?, ?${columns.map(() => ', ?').join('')}, ?, NOW(3))`,
    [id, orgId, projectId, ...Object.values(fields), Date.now()]
  );
  return { id };
}

async function updateStage({ orgId, projectId, stageId, data, auth }) {
  await assertProjectReachable(orgId, projectId, auth);

  const fields = {};
  for (const key of STAGE_FIELDS) {
    if (data[key] !== undefined) fields[key] = data[key] === '' ? null : data[key];
  }
  const columns = Object.keys(fields);
  if (columns.length === 0) throw new ServiceError('NO_FIELDS', 'Nothing to update', 400);

  const [result] = await pool.query(
    `UPDATE project_stages
        SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')},
            updated_at = ?, server_updated_at = NOW(3)
      WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0`,
    [...Object.values(fields), Date.now(), stageId, projectId, orgId]
  );
  if (result.affectedRows === 0) throw new ServiceError('NOT_FOUND', 'Stage not found', 404);
  return { id: stageId };
}

module.exports = {
  listProjects, getProject, createProject, updateProject,
  createStage, updateStage,
};
