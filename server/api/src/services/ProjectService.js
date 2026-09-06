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
  // Site geofence (§11.5) — web-set config the server derives attendance geo_verified
  // from. Not financial, not redacted; the app reads it to render "📍 Site".
  'geofence_lat', 'geofence_lng', 'geofence_radius_m',
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

// `engagementMode`/`isTheBuilder` implement §7.2.1's query-time resolution: a PM
// with `money.read` still doesn't see the engaged Builder's own cost-plan breakdown
// under `independent_fixed` — only the head-contract total (`projects.contract_value`,
// untouched — a separate column, redacted only by the plain `money.read` gate above).
// `independent_cost_plus`/`employee`/no-Builder-yet fall through unchanged (the
// existing `money.read` gate is the whole story, exactly like before this migration).
function redactStage(row, role, engagementMode, isTheBuilder) {
  if (!seesMoney(role)) {
    const {
      budget_amount, estimated_amount, committed_amount, actual_amount, claimed_amount, ...rest
    } = row;
    return rest;
  }
  if (engagementMode === 'independent_fixed' && !isTheBuilder) {
    const { estimated_amount, committed_amount, actual_amount, claimed_amount, ...rest } = row;
    return rest;
  }
  return row;
}

function redactTask(row, role) {
  if (seesMoney(role)) return row;
  // xprojman-39 §2: skill_level/cost_centre_id drive live labour-cost — same
  // money.read gate as budget_hours/budget_amount, same reasoning.
  const { budget_hours, budget_amount, skill_level, cost_centre_id, ...rest } = row;
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
  // xprojman-37/38: `t.seq` (own column since v038, backfilled from the template
  // for every pre-existing seeded task) is now the source of the Sx.y ordinal for
  // EVERY task — seeded or hand-added (xprojman-38 §3's new create endpoint) —
  // not just template-linked ones, so `code` is computed here from the task's own
  // seq + its stage's seq rather than a stage_task_templates lookup. A task with
  // no stage, or a pre-v038 hand-added task with no captured seq, comes back with
  // `code` NULL — "not captured", same posture as description/is_outsourced, not
  // an error. `stt` stays joined only for `actor_role` (informational template
  // metadata still worth exposing; `code`/`seq` no longer come from it).
  const [tasks] = await pool.query(
    `SELECT t.*, u.full_name AS assigned_to_name, stt.actor_role AS template_actor_role,
            CASE WHEN t.seq IS NOT NULL AND ps.seq IS NOT NULL
                 THEN CONCAT('S', ps.seq, '.', t.seq) END AS code
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN stage_task_templates stt ON stt.id = t.template_item_id
       LEFT JOIN project_stages ps ON ps.id = t.stage_id
      WHERE t.project_id = ? AND t.org_id = ? AND t.is_deleted = 0
      ORDER BY t.start_date IS NULL, t.start_date, t.created_at`,
    [id, orgId]
  );

  // §7.2.1 query-time resolution — lazy require, same cycle-break as
  // assertProgrammeWriteScope (JobAwardService requires this module back).
  const JobAwardService = require('./JobAwardService');
  const engagement = await JobAwardService.acceptedBuilderEngagement({ orgId, projectId: id });
  const isTheBuilder = !!engagement && String(engagement.to_user_id) === String(userId);

  return {
    project: redactProject(project, role),
    stages: stages.map((s) => redactStage(s, role, engagement?.builder_engagement_type, isTheBuilder)),
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

  // S1.3 (18-Stage spec v3.4) — PM declares building type/unit count AT CREATION,
  // written immediately rather than only from Stage 9 on. A standalone house is not
  // a special case: `modular_units` always has at least one row (devroadmap.md §2 —
  // "one model, one rule set"). `unit_count` is not a `projects` column — it only
  // ever materialises as these rows.
  const unitCount = Math.max(1, Number(data.unit_count) || 1);
  for (let n = 1; n <= unitCount; n++) {
    await pool.query(
      `INSERT INTO modular_units (id, org_id, project_id, unit_number) VALUES (?, ?, ?, ?)`,
      [uuidv4(), orgId, id, n]
    );
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

// Corrective migration Step A (servdesignspec §7.2): `programme.write` is a flat
// permission grant (route middleware), but WHICH stages it reaches is now scoped per
// row. PM holds Stages 1–8 always, and 9–18 too UNTIL a Builder is actually
// job-awarded and accepted — nobody real starts a project with an instant Builder,
// so this stays backward-compatible for every project before Stage 9 (and every
// existing test). Once a Builder accepts, PM's write on 9–18 stops and only that
// Builder (their own accepted engagement) holds it there. Lazy `require` (not a
// top-level import) — JobAwardService requires ProjectService back for
// `assertProjectReachable`, so this breaks the cycle.
async function assertProgrammeWriteScope({ orgId, projectId, actor, seq }) {
  if (seq === undefined || seq === null) return; // no stage-number context — nothing to scope
  const JobAwardService = require('./JobAwardService');
  const engagement = await JobAwardService.acceptedBuilderEngagement({ orgId, projectId });

  if (Number(seq) <= 8) {
    if (actor.role === 'projectManager') return;
    throw new ServiceError('FORBIDDEN', 'Only the Project Manager holds programme.write on Stages 1–8', 403);
  }
  // Stage 9+
  if (!engagement) {
    if (actor.role === 'projectManager') return; // no Builder yet — PM still runs it
    throw new ServiceError('FORBIDDEN', 'No Builder is engaged on this project yet', 403);
  }
  if (actor.role === 'builder' && String(engagement.to_user_id) === String(actor.userId)) return;
  throw new ServiceError('FORBIDDEN',
    'Stages 9–18 are the engaged Builder\'s own schedule — PM is read-only here once a Builder is engaged', 403);
}

async function createStage({ orgId, projectId, data, auth }) {
  await assertProjectReachable(orgId, projectId, auth);
  await assertProgrammeWriteScope({ orgId, projectId, actor: auth, seq: data.seq });

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

  const [[existing]] = await pool.query(
    'SELECT seq FROM project_stages WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [stageId, projectId, orgId]
  );
  if (!existing) throw new ServiceError('NOT_FOUND', 'Stage not found', 404);
  await assertProgrammeWriteScope({ orgId, projectId, actor: auth, seq: existing.seq });

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

/**
 * GET /projects/dashboard-summary — the Portal console landing figures.
 *
 * WHY THIS EXISTS AS ONE ENDPOINT. The directive it replaces called for the Portal to assemble a
 * dashboard from the existing per-project reads. That is an N+1: list the projects, then fan out
 * per project for defects, diary and hold points. Here it is a FIXED number of aggregate queries
 * regardless of how many jobs the org has, each carrying the same `projectScope` narrowing the rest
 * of the system uses — so an assigned-scope role's dashboard counts only their own jobs, and a
 * portfolio role's counts the org.
 *
 * MONEY IS GATED, NOT ASSUMED. The original spec put a budget summary in front of "any tenant
 * user", which breaches §7.2.1: `money.read` is held by projectManager/developer (and conferred on
 * an org owner), NOT by siteSupervisor/foreperson/tradie/inspector/client. So `money` is `null` for
 * anyone without it rather than zeroed — null says "not yours to see", zero would be a lie.
 * Only `projects.contract_value` (the head-contract total) is summed: §7.2.1's engagement-mode
 * redaction protects the Builder's own cost breakdown, which lives on the stage columns and is
 * deliberately not touched here.
 *
 * "Overdue" is DERIVED from `due_date`, not read from `status` — there is no 'overdue' status in
 * the enum, and inventing one in the UI would have been wrong.
 */
async function dashboardSummary({ orgId, role, userId, isOrgOwner }) {
  const principal = { role, isOrgOwner };
  const seesMoney = access.grants(principal, 'money.read');

  // One scope fragment, reused across every aggregate. `p`/`d`/etc. aliases differ per query, so
  // build it per alias rather than string-patching one.
  const scopeFor = (alias, col = 'project_id') =>
    projectScope({ role, userId }, { projectColumn: col, alias });

  const ps = scopeFor('p', 'id');
  const [[projects]] = await pool.query(
    `SELECT
       COUNT(*)                                                            AS total,
       SUM(p.status = 'draft')                                             AS draft,
       SUM(p.status = 'active')                                            AS active,
       SUM(p.status = 'on_hold')                                           AS on_hold,
       SUM(p.status = 'completed')                                         AS completed,
       SUM(p.status = 'inactive')                                          AS inactive,
       SUM(p.status = 'cancelled')                                         AS cancelled,
       SUM(p.due_date IS NOT NULL AND p.due_date < CURDATE()
           AND p.status NOT IN ('completed','inactive','cancelled'))       AS overdue
     FROM projects p
     WHERE p.org_id = ? AND p.is_deleted = 0${ps.sql}`,
    [orgId, ...ps.params]
  );

  const ds = scopeFor('d');
  const [[defects]] = await pool.query(
    `SELECT
       SUM(d.status = 'open')                                              AS open,
       SUM(d.status = 'in_progress')                                       AS in_progress,
       SUM(d.status <> 'closed' AND d.severity = 'high')                   AS high_severity,
       SUM(d.status <> 'closed' AND d.due_date IS NOT NULL
           AND d.due_date < CURDATE())                                     AS overdue
     FROM defects d
     WHERE d.org_id = ? AND d.is_deleted = 0${ds.sql}`,
    [orgId, ...ds.params]
  );

  // The real hold-point signal, not the coarse stage-status proxy the directive suggested:
  // `blocks_progress = 1 AND status = 'open'` is precisely "this job cannot advance".
  const hs = scopeFor('h');
  const [[holdPoints]] = await pool.query(
    `SELECT COUNT(*) AS open_blocking
       FROM hold_point_requirements h
      WHERE h.org_id = ? AND h.status = 'open' AND h.blocks_progress = 1${hs.sql}`,
    [orgId, ...hs.params]
  );

  const ss = scopeFor('s');
  const [[stages]] = await pool.query(
    `SELECT SUM(s.status = 'blocked') AS blocked, SUM(s.status = 'in_progress') AS in_progress
       FROM project_stages s
      WHERE s.org_id = ? AND s.is_deleted = 0${ss.sql}`,
    [orgId, ...ss.params]
  );

  // Self-scoped by definition — an invitation is addressed to one person, and this is the same
  // identity-level inbox GET /job-awards/pending serves (it is NOT membership-gated, which is the
  // whole point: an invitee is not yet a member).
  const [[awards]] = await pool.query(
    `SELECT COUNT(*) AS pending
       FROM job_awards
      WHERE org_id = ? AND to_user_id = ? AND status = 'sent'`,
    [orgId, userId]
  );

  let money = null;
  if (seesMoney) {
    const ms = scopeFor('p', 'id');
    const [[m]] = await pool.query(
      `SELECT COALESCE(SUM(p.contract_value), 0) AS contract_value_total
         FROM projects p
        WHERE p.org_id = ? AND p.is_deleted = 0
          AND p.status NOT IN ('inactive','cancelled')${ms.sql}`,
      [orgId, ...ms.params]
    );
    money = { contract_value_total: Number(m.contract_value_total) };
  }

  const n = (v) => Number(v || 0);
  return {
    projects: {
      total: n(projects.total),
      by_status: {
        draft: n(projects.draft), active: n(projects.active), on_hold: n(projects.on_hold),
        completed: n(projects.completed), inactive: n(projects.inactive), cancelled: n(projects.cancelled),
      },
      overdue: n(projects.overdue),
    },
    defects: {
      open: n(defects.open), in_progress: n(defects.in_progress),
      high_severity: n(defects.high_severity), overdue: n(defects.overdue),
    },
    hold_points: { open_blocking: n(holdPoints.open_blocking) },
    stages: { blocked: n(stages.blocked), in_progress: n(stages.in_progress) },
    job_awards: { pending_for_me: n(awards.pending) },
    // null (not 0) when the caller lacks money.read — see the §7.2.1 note above.
    money,
  };
}

module.exports = {
  listProjects, getProject, createProject, updateProject,
  createStage, updateStage, assertProjectReachable, assertProgrammeWriteScope, dashboardSummary,
};
