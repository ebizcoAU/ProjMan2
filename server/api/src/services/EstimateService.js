// EstimateService — P7a Cost Plan / estimate lines (xprojman-10 §4, servdesignspec §7.2).
// The estimate is the org/PM's cost plan; writes are gated by the EXISTING `money.write`
// (spec §7.2 names money.*, not a separate estimates.write). Stage-tagged lines roll up
// into `project_stages.estimated_amount` — the stage columns stay the single read model
// (xprojman-10 §5), so the roll-up is recomputed on every write, never hand-edited.
//
// A thin per-project `cost_plans` header carries a draft/locked status; once locked the
// estimate is the frozen baseline and further line edits are refused until unlocked.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const ProjectService = require('./ProjectService');

const canRead  = (role) => access.hasPermission(role, 'money.read');
const canWrite = (role) => access.hasPermission(role, 'money.write');

/** Lazily create (once) and return the project's cost-plan header row. */
async function getOrCreatePlan({ orgId, projectId }) {
  const [[existing]] = await pool.query(
    'SELECT * FROM cost_plans WHERE project_id = ? AND org_id = ? LIMIT 1',
    [projectId, orgId]
  );
  if (existing) return existing;
  const id = uuidv4();
  await pool.query(
    'INSERT INTO cost_plans (id, org_id, project_id) VALUES (?, ?, ?)',
    [id, orgId, projectId]
  );
  const [[row]] = await pool.query('SELECT * FROM cost_plans WHERE id = ?', [id]);
  return row;
}

/** Recompute a stage's estimated_amount from its (non-deleted) estimate lines. */
async function recomputeStageEstimate({ orgId, projectId, stageId }) {
  if (!stageId) return;
  await pool.query(
    `UPDATE project_stages ps
        SET ps.estimated_amount = (
          SELECT COALESCE(SUM(el.amount), 0) FROM estimate_lines el
           WHERE el.stage_id = ps.id AND el.org_id = ps.org_id AND el.is_deleted = 0)
      WHERE ps.id = ? AND ps.project_id = ? AND ps.org_id = ?`,
    [stageId, projectId, orgId]
  );
}

async function assertWritablePlan({ orgId, projectId, actor }) {
  if (!canWrite(actor.role)) {
    throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  }
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  const plan = await getOrCreatePlan({ orgId, projectId });
  if (plan.status === 'locked') {
    throw new ServiceError('COST_PLAN_LOCKED', 'The cost plan is locked; unlock it before editing lines', 409);
  }
  return plan;
}

function computeAmount(quantity, rate) {
  const q = Number(quantity), r = Number(rate);
  return Math.round((q * r) * 100) / 100;
}

/** POST /projects/:id/estimate-lines */
async function createLine({ orgId, projectId, actor, stageId, description, category, quantity, unit, rate }) {
  const plan = await assertWritablePlan({ orgId, projectId, actor });
  if (stageId) await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });

  const id = uuidv4();
  const amount = computeAmount(quantity ?? 1, rate ?? 0);
  await pool.query(
    `INSERT INTO estimate_lines
       (id, org_id, project_id, cost_plan_id, stage_id, description, category, quantity, unit, rate, amount, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, projectId, plan.id, stageId || null, description, category || null,
     quantity ?? 1, unit || null, rate ?? 0, amount, actor.userId]
  );
  await recomputeStageEstimate({ orgId, projectId, stageId });
  return { id, amount };
}

/** PATCH /projects/:id/estimate-lines/:lineId */
async function updateLine({ orgId, projectId, actor, lineId, patch }) {
  await assertWritablePlan({ orgId, projectId, actor });
  const [[line]] = await pool.query(
    'SELECT * FROM estimate_lines WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [lineId, projectId, orgId]
  );
  if (!line) throw new ServiceError('NOT_FOUND', 'Estimate line not found', 404);

  const description = patch.description ?? line.description;
  const category    = patch.category   ?? line.category;
  const quantity    = patch.quantity   ?? line.quantity;
  const unit        = patch.unit        ?? line.unit;
  const rate        = patch.rate        ?? line.rate;
  const amount      = computeAmount(quantity, rate);
  await pool.query(
    `UPDATE estimate_lines SET description = ?, category = ?, quantity = ?, unit = ?, rate = ?, amount = ?
      WHERE id = ? AND org_id = ?`,
    [description, category, quantity, unit, rate, amount, lineId, orgId]
  );
  await recomputeStageEstimate({ orgId, projectId, stageId: line.stage_id });
  return { id: lineId, amount };
}

/** DELETE /projects/:id/estimate-lines/:lineId (soft) */
async function deleteLine({ orgId, projectId, actor, lineId }) {
  await assertWritablePlan({ orgId, projectId, actor });
  const [[line]] = await pool.query(
    'SELECT stage_id FROM estimate_lines WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [lineId, projectId, orgId]
  );
  if (!line) throw new ServiceError('NOT_FOUND', 'Estimate line not found', 404);
  await pool.query('UPDATE estimate_lines SET is_deleted = 1 WHERE id = ? AND org_id = ?', [lineId, orgId]);
  await recomputeStageEstimate({ orgId, projectId, stageId: line.stage_id });
  return { id: lineId, deleted: true };
}

/** GET /projects/:id/cost-plan — plan header + lines. money.read gated. */
async function list({ orgId, projectId, actor }) {
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read', 403);
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  const plan = await getOrCreatePlan({ orgId, projectId });
  const [lines] = await pool.query(
    `SELECT * FROM estimate_lines WHERE project_id = ? AND org_id = ? AND is_deleted = 0
      ORDER BY stage_id IS NULL, stage_id, created_at`,
    [projectId, orgId]
  );
  const total = lines.reduce((s, l) => s + Number(l.amount), 0);
  return { cost_plan: { id: plan.id, status: plan.status, locked_at: plan.locked_at }, lines, total };
}

/** POST /projects/:id/cost-plan/lock  |  /unlock */
async function setLock({ orgId, projectId, actor, locked }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  await getOrCreatePlan({ orgId, projectId });
  await pool.query(
    `UPDATE cost_plans SET status = ?, locked_at = ?, locked_by = ? WHERE project_id = ? AND org_id = ?`,
    [locked ? 'locked' : 'draft', locked ? new Date() : null, locked ? actor.userId : null, projectId, orgId]
  );
  return { project_id: projectId, status: locked ? 'locked' : 'draft' };
}

module.exports = { createLine, updateLine, deleteLine, list, setLock, getOrCreatePlan };
