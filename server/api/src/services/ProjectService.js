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
const { FINANCIAL_ROLES } = require('../lib/roles');

const PROJECT_FIELDS = [
  'customer_id', 'code', 'name', 'site_address', 'lot_plan', 'contract_value',
  'contract_type', 'start_date', 'due_date', 'status', 'template_id', 'pm_user_id',
];
const STAGE_FIELDS = [
  'seq', 'stage_code', 'name', 'status', 'start_date', 'end_date', 'budget_amount',
];

const seesMoney = (role) => FINANCIAL_ROLES.has(role);

function redactProject(row, role) {
  if (seesMoney(role)) return row;
  const { contract_value, ...rest } = row;
  return rest;
}

function redactStage(row, role) {
  if (seesMoney(role)) return row;
  const { budget_amount, ...rest } = row;
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

// ── Projects ─────────────────────────────────────────────────────────────────

async function listProjects({ orgId, role, status, page = 1, limit = 20 }) {
  const params = [orgId];
  let where = 'p.org_id = ? AND p.is_deleted = 0';
  if (status) { where += ' AND p.status = ?'; params.push(status); }

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

async function getProject({ orgId, role, id }) {
  const [[project]] = await pool.query(
    `SELECT p.*, c.name AS customer_name, pm.full_name AS pm_name
       FROM projects p
       LEFT JOIN customers c ON c.id = p.customer_id
       LEFT JOIN users pm    ON pm.id = p.pm_user_id
      WHERE p.id = ? AND p.org_id = ? AND p.is_deleted = 0 LIMIT 1`,
    [id, orgId]
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

async function createProject({ orgId, data }) {
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
  return { id };
}

async function updateProject({ orgId, id, data }) {
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
  return { id };
}

// ── Stages ───────────────────────────────────────────────────────────────────

async function createStage({ orgId, projectId, data }) {
  await assertInOrg('projects', projectId, orgId, 'Project');

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

async function updateStage({ orgId, projectId, stageId, data }) {
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
