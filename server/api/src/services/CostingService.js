// CostingService — Cost Plan costing engine, Phase 1 (xprojman-39 §1/§2,
// APPROVED FOR BUILD 2026-09-06). Two org-level master lists (rate card, cost
// centres) + the labour-cost rollup that reads them alongside `tasks`.
//
// NO cached cost figure anywhere — same anti-drift stance as FinanceService/
// fin_accounts (migration_v031's own header, reinforced again this session by
// the P&L GST work): `labourRollup` computes estimated/actual cost LIVE from
// `budget_hours`/`actual_hours` x the CURRENT rate card, every read. A stored
// per-task cost column would go stale the instant an org edits a rate — there
// is no write event on `tasks` to hang a recompute off, unlike estimate_lines'
// `amount` (a value fixed at entry time, genuinely different from a rate that
// changes out from under every task at once).

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const { PO_COMMITTED, INV_ACTUAL } = require('./ProcurementService');

const SKILL_LEVELS = ['expert', 'professional', 'std', 'free'];
const canRead  = (role) => access.hasPermission(role, 'money.read');
const canWrite = (role) => access.hasPermission(role, 'money.write');
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// ── §1 Rate card ───────────────────────────────────────────────────────────
async function listRateCard({ orgId, actor }) {
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read', 403);
  const [rows] = await pool.query(
    'SELECT skill_level, hourly_rate, updated_at FROM org_rate_cards WHERE org_id = ?',
    [orgId]
  );
  const bySkill = new Map(rows.map((r) => [r.skill_level, r]));
  const rates = SKILL_LEVELS.map((level) => ({
    skill_level: level,
    hourly_rate: bySkill.has(level) ? Number(bySkill.get(level).hourly_rate) : null,
  }));
  return { rates, configured: rates.every((r) => r.hourly_rate !== null) };
}

/** PUT-style upsert, one skill tier at a time (Settings saves a row on edit). */
async function setRate({ orgId, actor, skillLevel, hourlyRate }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  if (!SKILL_LEVELS.includes(skillLevel)) {
    throw new ServiceError('VALIDATION_ERROR', `skill_level must be one of ${SKILL_LEVELS.join(', ')}`, 422);
  }
  if (!(Number(hourlyRate) >= 0)) {
    throw new ServiceError('VALIDATION_ERROR', 'hourly_rate must be >= 0', 422);
  }
  await pool.query(
    `INSERT INTO org_rate_cards (id, org_id, skill_level, hourly_rate)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE hourly_rate = VALUES(hourly_rate)`,
    [uuidv4(), orgId, skillLevel, hourlyRate]
  );
  return { skill_level: skillLevel, hourly_rate: Number(hourlyRate) };
}

// ── §2 Cost centres — fixed, admin-managed list (confirmed xprojman-39 §6
// response: same shape as `suppliers`, not project-level free text) ─────────
async function listCostCentres({ orgId }) {
  const [rows] = await pool.query(
    'SELECT id, code, name, linked_account_id FROM cost_centres WHERE org_id = ? AND is_deleted = 0 ORDER BY code',
    [orgId]
  );
  return { cost_centres: rows };
}

async function createCostCentre({ orgId, actor, code, name }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  if (!code || !String(code).trim()) throw new ServiceError('VALIDATION_ERROR', 'code is required', 400);
  if (!name || !String(name).trim()) throw new ServiceError('VALIDATION_ERROR', 'name is required', 400);
  const [[dup]] = await pool.query(
    'SELECT id FROM cost_centres WHERE org_id = ? AND code = ? AND is_deleted = 0 LIMIT 1',
    [orgId, code.trim()]
  );
  if (dup) throw new ServiceError('DUPLICATE_CODE', 'A cost centre with this code already exists', 409);
  const id = uuidv4();
  await pool.query(
    'INSERT INTO cost_centres (id, org_id, code, name) VALUES (?, ?, ?, ?)',
    [id, orgId, code.trim(), name.trim()]
  );
  return { id, code: code.trim(), name: name.trim() };
}

// Links (or unlinks) a cost centre to a chart-of-accounts leaf (xprojman-42
// §4 point 2, migration v042's cost_centres.linked_account_id). Stays
// money.write, same tier as createCostCentre — this tags an existing
// money.write-gated row, it isn't a structural chart-of-accounts edit
// (OrgFinanceService's finance.manage is for those), so it doesn't need the
// narrower permission.
async function setLinkedAccount({ orgId, actor, costCentreId, accountId }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  const [[cc]] = await pool.query(
    'SELECT id FROM cost_centres WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [costCentreId, orgId]
  );
  if (!cc) throw new ServiceError('NOT_FOUND', 'Cost centre not found', 404);

  if (accountId) {
    const [[acc]] = await pool.query(
      'SELECT id, acc_type FROM org_accounts WHERE id = ? AND org_id = ? LIMIT 1',
      [accountId, orgId]
    );
    if (!acc) throw new ServiceError('VALIDATION_ERROR', 'account_id not found in your organisation', 422);
    if (acc.acc_type !== 'expense') throw new ServiceError('VALIDATION_ERROR', 'account_id must be an expense account', 422);
  }
  await pool.query(
    'UPDATE cost_centres SET linked_account_id = ? WHERE id = ? AND org_id = ?',
    [accountId || null, costCentreId, orgId]
  );
  return { id: costCentreId, linked_account_id: accountId || null };
}

// ── Task costing fields (skill_level/cost_centre_id) — money.write, same
// tier as everything else in this file. Lives alongside TaskProgressService.
// updateOfficeFields (output_note/status, projects.write) rather than folded
// into it — different permission, different owner (this file), same task row.
//
// `isOutsourced` added here (xprojman-39 §3 prerequisite, migration v043's
// task_quotes needs is_outsourced=1 to be actually reachable) — v037 added
// the column itself but left it READ-ONLY on purpose pending a real need
// (xprojman-37 §3: "if this needs to become editable later, small follow-up
// not a redesign"); that need is now real, and it's money-gated same as
// skill_level/cost_centre_id per that same v037 decision, not projects.write.
async function setTaskCosting({ orgId, projectId, taskId, actor, skillLevel, costCentreId, isOutsourced }) {
  if (skillLevel === undefined && costCentreId === undefined && isOutsourced === undefined) {
    throw new ServiceError('NO_FIELDS', 'Nothing to update', 400);
  }
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.write', 403);
  if (skillLevel !== undefined && skillLevel !== null && !SKILL_LEVELS.includes(skillLevel)) {
    throw new ServiceError('VALIDATION_ERROR', `skill_level must be one of ${SKILL_LEVELS.join(', ')}`, 422);
  }
  const [[task]] = await pool.query(
    'SELECT id FROM tasks WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [taskId, projectId, orgId]
  );
  if (!task) throw new ServiceError('NOT_FOUND', 'Task not found', 404);

  if (costCentreId) {
    const [[cc]] = await pool.query(
      'SELECT id FROM cost_centres WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
      [costCentreId, orgId]
    );
    if (!cc) throw new ServiceError('VALIDATION_ERROR', 'cost_centre_id not found in your organisation', 422);
  }

  const fields = {};
  if (skillLevel !== undefined) fields.skill_level = skillLevel;
  if (costCentreId !== undefined) fields.cost_centre_id = costCentreId;
  if (isOutsourced !== undefined) fields.is_outsourced = isOutsourced ? 1 : 0;
  const columns = Object.keys(fields);
  await pool.query(
    `UPDATE tasks SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')}, server_updated_at = NOW(3)
      WHERE id = ? AND org_id = ?`,
    [...Object.values(fields), taskId, orgId]
  );
  return { id: taskId, ...fields };
}

// ── Labour-cost rollup — read live, never stored (see file header) ─────────
// An internal task with no skill_level was never asked to be costed (not an
// error, not "missing"). A task WITH a skill_level but no cost_centre_id IS
// flagged (`missingCostCentre`) — owner rule (§0.1): internal cost requires
// a cost centre; enforced at cost-plan LOCK time (setLock below), not here —
// read paths should never 403/refuse, only report.
//
// Outsourced tasks (xprojman-39 §3, built) now DO contribute: estimated =
// SUM of committed purchase_orders against the task (an approved quote
// raises one of these, xprojman-39 §3 phase 4), actual = SUM of matched/
// approved supplier_invoices — same PO_COMMITTED/INV_ACTUAL statuses
// ProcurementService's own stage-level committed_amount/actual_amount
// rollups already use, just aggregated per-task instead of per-stage.
//
// `byTask` (xprojman-39 §4's own server dependency — the Scheduler's dual
// completion/spend bar needs a per-task figure, not just the stage rollup
// this function returned before) covers EVERY task with a non-zero figure
// either way, internal or outsourced — a task nobody has costed at all is
// simply absent from it, same "not an error" posture as skill_level being null.
async function labourRollup({ orgId, projectId }) {
  const [rateRows] = await pool.query(
    'SELECT skill_level, hourly_rate FROM org_rate_cards WHERE org_id = ?', [orgId]
  );
  const rateMap = new Map(rateRows.map((r) => [r.skill_level, Number(r.hourly_rate)]));
  const [tasks] = await pool.query(
    `SELECT id, stage_id, skill_level, cost_centre_id, is_outsourced, budget_hours, actual_hours
       FROM tasks WHERE project_id = ? AND org_id = ? AND is_deleted = 0`,
    [projectId, orgId]
  );
  const [poRows] = await pool.query(
    `SELECT task_id, SUM(amount) AS total FROM purchase_orders
      WHERE project_id = ? AND org_id = ? AND is_deleted = 0 AND task_id IS NOT NULL
        AND status IN (?) GROUP BY task_id`,
    [projectId, orgId, PO_COMMITTED]
  );
  const [invRows] = await pool.query(
    `SELECT task_id, SUM(amount) AS total FROM supplier_invoices
      WHERE project_id = ? AND org_id = ? AND is_deleted = 0 AND task_id IS NOT NULL
        AND status IN (?) GROUP BY task_id`,
    [projectId, orgId, INV_ACTUAL]
  );
  const committedByTask = new Map(poRows.map((r) => [r.task_id, Number(r.total)]));
  const actualByTask = new Map(invRows.map((r) => [r.task_id, Number(r.total)]));

  const byStage = new Map();
  const byTask = [];
  let totalEstimated = 0, totalActual = 0;
  const missingCostCentre = [];
  for (const t of tasks) {
    let estimated, actual;
    if (t.is_outsourced) {
      estimated = committedByTask.get(t.id) || 0;
      actual = actualByTask.get(t.id) || 0;
      if (estimated === 0 && actual === 0) continue; // no quote/PO/invoice against this task yet
    } else {
      if (!t.skill_level) continue;
      if (!t.cost_centre_id) { missingCostCentre.push(t.id); continue; }
      const rate = rateMap.get(t.skill_level);
      if (rate === undefined) continue; // rate card not (yet) configured for this tier
      estimated = Number(t.budget_hours || 0) * rate;
      actual = Number(t.actual_hours || 0) * rate;
    }
    totalEstimated += estimated;
    totalActual += actual;
    byTask.push({ task_id: t.id, estimated: round2(estimated), actual: round2(actual) });
    const stageKey = t.stage_id || 'unassigned';
    const cur = byStage.get(stageKey) || { stage_id: t.stage_id, estimated: 0, actual: 0 };
    cur.estimated += estimated;
    cur.actual += actual;
    byStage.set(stageKey, cur);
  }
  return {
    byStage: [...byStage.values()].map((s) => ({ ...s, estimated: round2(s.estimated), actual: round2(s.actual) })),
    byTask,
    total: { estimated: round2(totalEstimated), actual: round2(totalActual) },
    tasksMissingCostCentre: missingCostCentre,
  };
}

module.exports = {
  SKILL_LEVELS, listRateCard, setRate, listCostCentres, createCostCentre,
  setLinkedAccount, setTaskCosting, labourRollup,
};
