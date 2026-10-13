// ClientClaimService — client progress claims at the 6 billing milestones (xprojman-43 R2;
// §3/§5/§12 as re-scoped by §13 and ruled in §14). User-facing name: "Progress claim".
//
// ProjMan RECORDS the claim and exports it (R4); it posts no ledger and issues no tax invoice.
//   * schedule   client_payment_schedules (or the x43 §2.2 default) must total 100%.
//   * caps       deposit_caps rows: a verified row over the cap blocks (DEPOSIT_CAP_EXCEEDED);
//                an unverified state or no row only warns (DEPOSIT_CAP_UNVERIFIED).
//   * lifecycle  draft → issued (number assigned) → paid (full payment, recorded by the office),
//                or void (reason; a replacement draft supersedes it). Drafts are re-priced from
//                the schedule; issued/paid milestones lock their percentage (SCHEDULE_LOCKED).
//   * money      amounts follow the codebase rule (§11.4 #12): ex GST, with GST additive,
//                10% only when the org is gst_registered. contract_value is ex GST.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const { toWallClock, nowWallClock } = require('../lib/datetime');
const ProjectService = require('./ProjectService');
const { projectScope } = require('../lib/scope');

const MILESTONES = ['deposit', 'base', 'frame', 'lock_up', 'fixing', 'completion'];
const DEFAULT_SCHEDULE = { deposit: 5, base: 10, frame: 15, lock_up: 35, fixing: 20, completion: 15 };
const PAYMENT_TERMS_DAYS = 14;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const person = (id, name) => (id ? { id, name: name || null } : null);

// ── Project + caps ──────────────────────────────────────────────────────────────

/** actor null = the system (an R5 milestone trigger): no reach check. */
async function loadProject(orgId, projectId, actor) {
  if (actor) await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  const [[p]] = await pool.query(
    `SELECT p.id, p.code, p.name, p.contract_value, COALESCE(p.site_state, o.state) AS site_state,
            o.name AS org_name, o.abn AS org_abn, o.gst_registered
       FROM projects p JOIN organisations o ON o.id = p.org_id
      WHERE p.id = ? AND p.org_id = ? AND p.is_deleted = 0 LIMIT 1`, [projectId, orgId]);
  if (!p) throw new ServiceError('NOT_FOUND', 'Project not found', 404);
  return { ...p, contract_value: p.contract_value == null ? null : Number(p.contract_value), gst_registered: !!p.gst_registered };
}

const gstFor = (exGst, gstRegistered) => (gstRegistered ? round2(exGst * 0.1) : 0);

async function depositCap(project) {
  if (!project.site_state || !(project.contract_value > 0)) return null;
  const priceInc = round2(project.contract_value + gstFor(project.contract_value, project.gst_registered));
  const [[row]] = await pool.query(
    `SELECT * FROM deposit_caps
      WHERE jurisdiction = ? AND min_price <= ? AND (max_price IS NULL OR max_price >= ?)
      ORDER BY verified_at IS NULL, min_price DESC LIMIT 1`,
    [project.site_state, priceInc, priceInc]);
  if (!row) return null;
  const pct = row.pct == null ? null : Number(row.pct);
  const fromPct = pct == null ? null : round2((priceInc * pct) / 100);
  const abs = row.abs_cap_amount == null ? null : Number(row.abs_cap_amount);
  const amount = fromPct == null ? abs : (abs == null ? fromPct : Math.min(fromPct, abs));
  return { pct, amount_inc_gst: amount, rule: row.rule, source: row.source, verified: !!row.verified_at };
}

/** Throws a verified breach; returns the warnings list otherwise. */
async function checkDeposit(project, depositIncGst) {
  const cap = await depositCap(project);
  const over = !!cap && cap.amount_inc_gst != null && depositIncGst > cap.amount_inc_gst + 0.005;
  if (cap?.verified) {
    if (over) {
      throw new ServiceError('DEPOSIT_CAP_EXCEEDED', `The deposit is over the statutory cap: ${cap.rule}`, 409,
        { cap_pct: cap.pct, cap_amount_inc_gst: cap.amount_inc_gst, rule: cap.rule });
    }
    return [];
  }
  return [{
    code: 'DEPOSIT_CAP_UNVERIFIED',
    message: cap
      ? `The ${project.site_state} deposit cap (${cap.rule}) isn't verified yet, so it wasn't enforced${over ? '. This deposit is over it' : ''}.`
      : `No verified deposit cap is on file for ${project.site_state || 'this site'}, so none was enforced.`,
  }];
}

// ── Schedule ────────────────────────────────────────────────────────────────────

async function scheduleMap(orgId, projectId) {
  const [rows] = await pool.query(
    'SELECT milestone, percentage FROM client_payment_schedules WHERE org_id = ? AND project_id = ?', [orgId, projectId]);
  if (!rows.length) return { ...DEFAULT_SCHEDULE, _default: true };
  const m = {};
  for (const r of rows) m[r.milestone] = Number(r.percentage);
  for (const k of MILESTONES) if (m[k] == null) m[k] = 0;
  return m;
}

async function liveClaims(orgId, projectId) {
  const [rows] = await pool.query(
    `SELECT * FROM client_claims WHERE org_id = ? AND project_id = ? AND live_milestone IS NOT NULL`, [orgId, projectId]);
  return new Map(rows.map((r) => [r.milestone, r]));
}

/** Readiness gates per milestone (§13.4), computed from the stage engine and existing records. */
async function gatesFor(orgId, projectId) {
  const [stages] = await pool.query(
    'SELECT seq, status, is_validated, validated_at FROM project_stages WHERE org_id = ? AND project_id = ? AND is_deleted = 0',
    [orgId, projectId]);
  const st = new Map(stages.map((s) => [Number(s.seq), s]));
  const validated = (seq) => ({ met: !!st.get(seq)?.is_validated, met_at: st.get(seq)?.validated_at || null });
  const complete = (seq) => ({ met: st.get(seq)?.status === 'complete', met_at: null });
  const [[award]] = await pool.query(
    `SELECT responded_at FROM job_awards WHERE org_id = ? AND project_id = ? AND status = 'accepted'
      ORDER BY responded_at DESC LIMIT 1`, [orgId, projectId]);
  const [[plan]] = await pool.query(
    `SELECT locked_at FROM cost_plans WHERE org_id = ? AND project_id = ? AND status = 'locked'
      ORDER BY locked_at DESC LIMIT 1`, [orgId, projectId]);
  const [[signoff]] = await pool.query(
    `SELECT status, satisfied_at FROM hold_point_requirements
      WHERE org_id = ? AND project_id = ? AND auto_source = 'client_signoff' LIMIT 1`, [orgId, projectId]);
  const g = (code, label, r) => ({ code, label, met: !!r.met, met_at: r.met ? (r.met_at || null) : null });
  return {
    deposit: [g('S9.7', 'Job Award accepted', { met: !!award, met_at: award?.responded_at }),
              g('S9.9', 'Cost Plan locked', { met: !!plan, met_at: plan?.locked_at })],
    base: [g('S12.10', 'Slab hold points cleared (Stage 12 validated)', validated(12))],
    frame: [g('S13.11', 'Frame validated (Stage 13)', validated(13))],
    lock_up: [g('S14.7', 'Secured from weather (Stage 14 complete)', complete(14))],
    fixing: [g('S16.10', 'Final trade sign-off (Stage 16 complete)', complete(16))],
    completion: [g('S18.3', 'Occupation certificate (Stage 18 validated)', validated(18)),
                 g('S18.14', 'Client final sign-off', { met: signoff?.status === 'satisfied', met_at: signoff?.satisfied_at })],
  };
}

/** GET /projects/:id/payment-schedule */
async function getSchedule({ orgId, projectId, actor }) {
  const project = await loadProject(orgId, projectId, actor);
  const sched = await scheduleMap(orgId, projectId);
  const live = await liveClaims(orgId, projectId);
  const gates = await gatesFor(orgId, projectId);
  return {
    schedule: MILESTONES.map((m) => {
      const claim = live.get(m);
      return {
        milestone: m, percentage: sched[m],
        invoiced: !!claim && ['issued', 'paid'].includes(claim.status), // the lock flag (§12 #4)
        invoice_status: claim ? claim.status : null,
        gates: gates[m], ready: gates[m].every((x) => x.met),
      };
    }),
    is_default: !!sched._default,
    contract_value: project.contract_value, site_state: project.site_state,
    deposit_cap: await depositCap(project),
  };
}

/** PUT /projects/:id/payment-schedule { schedule: [{ milestone, percentage }] } (all six). */
async function saveSchedule({ orgId, projectId, actor, schedule }) {
  const project = await loadProject(orgId, projectId, actor);
  const rows = Array.isArray(schedule) ? schedule : [];
  const next = {};
  for (const r of rows) {
    if (!MILESTONES.includes(r?.milestone)) throw new ServiceError('VALIDATION_ERROR', `Unknown milestone ${r?.milestone}`, 400);
    const pct = Number(r.percentage);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new ServiceError('VALIDATION_ERROR', 'percentage must be 0–100', 400);
    next[r.milestone] = round2(pct);
  }
  if (MILESTONES.some((m) => next[m] == null)) {
    throw new ServiceError('VALIDATION_ERROR', 'The schedule must list all six milestones', 400);
  }
  const total = round2(MILESTONES.reduce((s, m) => s + next[m], 0));
  if (Math.abs(total - 100) > 0.001) {
    throw new ServiceError('SCHEDULE_NOT_100', `The schedule totals ${total}%, not 100%`, 400, { total });
  }
  const current = await scheduleMap(orgId, projectId);
  const live = await liveClaims(orgId, projectId);
  const locked = MILESTONES.filter((m) => {
    const c = live.get(m);
    return c && ['issued', 'paid'].includes(c.status) && Math.abs(next[m] - current[m]) > 0.001;
  });
  if (locked.length) {
    throw new ServiceError('SCHEDULE_LOCKED', 'An issued or paid milestone keeps the percentage it was billed at', 409,
      { milestones: locked });
  }
  let warnings = [];
  if (project.contract_value > 0) {
    const depEx = round2((project.contract_value * next.deposit) / 100);
    warnings = await checkDeposit(project, round2(depEx + gstFor(depEx, project.gst_registered)));
  }
  for (const m of MILESTONES) {
    await pool.query(
      `INSERT INTO client_payment_schedules (id, org_id, project_id, milestone, percentage, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE percentage = VALUES(percentage), updated_by = VALUES(updated_by)`,
      [uuidv4(), orgId, projectId, m, next[m], actor.userId]);
  }
  // Drafts follow the schedule; a locked milestone was refused above.
  for (const [m, c] of live) {
    if (c.status === 'draft' && project.contract_value > 0) {
      const ex = round2((project.contract_value * next[m]) / 100);
      await pool.query(
        `UPDATE client_claims SET amount_ex_gst = ?, gst_amount = ?, amount_inc_gst = ?, updated_at = ? WHERE id = ?`,
        [ex, gstFor(ex, project.gst_registered), round2(ex + gstFor(ex, project.gst_registered)), Date.now(), c.id]);
    }
  }
  return { data: await getSchedule({ orgId, projectId, actor }), warnings };
}

// ── Claims ──────────────────────────────────────────────────────────────────────

const CLAIM_SELECT = `
  SELECT c.*, p.code AS project_code, p.name AS project_name,
         cb.full_name AS created_by_name, rb.full_name AS payment_recorded_by_name,
         vb.full_name AS voided_by_name, ib.full_name AS issued_by_name,
         (c.status = 'issued' AND c.due_at IS NOT NULL AND c.due_at < NOW()) AS is_overdue,
         GREATEST(0, DATEDIFF(NOW(), c.due_at)) AS overdue_days
    FROM client_claims c
    JOIN projects p ON p.id = c.project_id
    LEFT JOIN users cb ON cb.id = c.created_by
    LEFT JOIN users rb ON rb.id = c.payment_recorded_by
    LEFT JOIN users vb ON vb.id = c.voided_by
    LEFT JOIN users ib ON ib.id = c.issued_by`;

function shape(r) {
  return {
    id: r.id, project_id: r.project_id, project_code: r.project_code, project_name: r.project_name,
    milestone: r.milestone, status: r.status, claim_number: r.claim_number,
    amount_ex_gst: Number(r.amount_ex_gst), gst_amount: Number(r.gst_amount), amount_inc_gst: Number(r.amount_inc_gst),
    percentage_of_contract: r.percentage_of_contract == null ? null : Number(r.percentage_of_contract),
    variation_note: r.variation_note, issued_at: r.issued_at, due_at: r.due_at,
    days_overdue: r.is_overdue ? Number(r.overdue_days) : 0,
    paid_at: r.paid_at, payment_reference: r.payment_reference,
    payment_recorded_by: person(r.payment_recorded_by, r.payment_recorded_by_name),
    void_reason: r.void_reason, voided_at: r.voided_at, voided_by: person(r.voided_by, r.voided_by_name),
    supersedes_id: r.supersedes_id, has_pdf: false, exported_at: r.exported_at,
    created_by: r.created_by ? person(r.created_by, r.created_by_name) : { id: null, name: 'System (milestone trigger)' },
    created_at: r.created_at,
  };
}

async function loadClaim(orgId, id, actor) {
  const [[r]] = await pool.query(`${CLAIM_SELECT} WHERE c.id = ? AND c.org_id = ? AND c.is_deleted = 0 LIMIT 1`, [id, orgId]);
  if (!r) throw new ServiceError('NOT_FOUND', 'Progress claim not found', 404);
  await ProjectService.assertProjectReachable(orgId, r.project_id, { role: actor.role, userId: actor.userId });
  return r;
}

/**
 * Draft a claim for one milestone from the schedule. Used by POST /projects/:id/client-claims
 * (the PM raising it by hand) and by the R5 milestone triggers (actor = null → system).
 */
async function createDraft({ orgId, projectId, actor, milestone, supersedesId = null }) {
  if (!MILESTONES.includes(milestone)) throw new ServiceError('VALIDATION_ERROR', 'Unknown milestone', 400);
  const project = await loadProject(orgId, projectId, actor);
  if (!(project.contract_value > 0)) {
    throw new ServiceError('CONTRACT_VALUE_MISSING', 'Set the contract value before raising progress claims', 409);
  }
  const sched = await scheduleMap(orgId, projectId);
  const ex = round2((project.contract_value * sched[milestone]) / 100);
  const gst = gstFor(ex, project.gst_registered);
  const id = uuidv4();
  try {
    await pool.query(
      `INSERT INTO client_claims (id, org_id, project_id, milestone, status, amount_ex_gst, gst_amount, amount_inc_gst,
                                  supersedes_id, created_by, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      [id, orgId, projectId, milestone, ex, gst, round2(ex + gst), supersedesId, actor?.userId || null, Date.now()]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new ServiceError('CLAIM_EXISTS', `There is already a live ${milestone} claim on this project`, 409, { milestone });
    }
    throw err;
  }
  return id;
}

/** GET /client-claims?project_id=&status= — rows + totals (totals ignore the status filter). */
async function list({ orgId, actor, projectId, status }) {
  const params = [orgId];
  let where = 'c.org_id = ? AND c.is_deleted = 0';
  if (projectId) {
    await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
    where += ' AND c.project_id = ?'; params.push(projectId);
  }
  // Same project narrowing as every other list: a non-portfolio role sees its own projects only.
  const scope = projectScope({ role: actor.role, userId: actor.userId }, { projectColumn: 'project_id', alias: 'c' });
  const [rows] = await pool.query(`${CLAIM_SELECT} WHERE ${where}${scope.sql} ORDER BY c.created_at DESC`,
    [...params, ...scope.params]);
  const reachable = rows.map(shape);
  const sum = (xs) => round2(xs.reduce((s, x) => s + x.amount_inc_gst, 0));
  const totals = {
    draft_count: reachable.filter((c) => c.status === 'draft').length,
    outstanding_inc_gst: sum(reachable.filter((c) => c.status === 'issued')),
    overdue_inc_gst: sum(reachable.filter((c) => c.days_overdue > 0)),
    paid_inc_gst: sum(reachable.filter((c) => c.status === 'paid')),
  };
  let filtered = reachable;
  if (status === 'overdue') filtered = reachable.filter((c) => c.days_overdue > 0);
  else if (status) filtered = reachable.filter((c) => c.status === status);
  return { client_claims: filtered, totals };
}

/** GET /client-claims/:id */
async function detail({ orgId, actor, id }) {
  const r = await loadClaim(orgId, id, actor);
  const project = await loadProject(orgId, r.project_id, actor);
  return {
    client_claim: {
      ...shape(r), contract_value: project.contract_value, site_state: project.site_state,
      supplier: { name: project.org_name, abn: project.org_abn, gst_registered: project.gst_registered },
    },
  };
}

/** PATCH /client-claims/:id { amount_ex_gst?, variation_note? } — drafts only. */
async function patchDraft({ orgId, actor, id, body }) {
  const r = await loadClaim(orgId, id, actor);
  if (r.status !== 'draft') throw new ServiceError('CLAIM_FROZEN', 'Only a draft claim can be edited', 409);
  const project = await loadProject(orgId, r.project_id, actor);
  let ex = Number(r.amount_ex_gst);
  if (body.amount_ex_gst !== undefined) {
    ex = round2(Number(body.amount_ex_gst));
    if (!Number.isFinite(ex) || ex < 0) throw new ServiceError('VALIDATION_ERROR', 'amount_ex_gst must be 0 or more', 400);
  }
  const gst = gstFor(ex, project.gst_registered);
  await pool.query(
    `UPDATE client_claims SET amount_ex_gst = ?, gst_amount = ?, amount_inc_gst = ?, variation_note = ?, updated_at = ?
      WHERE id = ?`,
    [ex, gst, round2(ex + gst), body.variation_note !== undefined ? (body.variation_note || null) : r.variation_note,
     Date.now(), id]);
  return detail({ orgId, actor, id });
}

/** POST /client-claims/:id/issue — number assigned, due date set, deposit cap applied. */
async function issue({ orgId, actor, id }) {
  const r = await loadClaim(orgId, id, actor);
  if (r.status !== 'draft') throw new ServiceError('CLAIM_FROZEN', 'This claim has already been issued', 409);
  const project = await loadProject(orgId, r.project_id, actor);
  const sched = await scheduleMap(orgId, r.project_id);
  const total = round2(MILESTONES.reduce((s, m) => s + sched[m], 0));
  if (Math.abs(total - 100) > 0.001) {
    throw new ServiceError('SCHEDULE_NOT_100', `The payment schedule totals ${total}%, not 100%`, 409, { total });
  }
  const warnings = r.milestone === 'deposit' ? await checkDeposit(project, Number(r.amount_inc_gst)) : [];
  const issuedAt = nowWallClock();
  const year = Number(issuedAt.slice(0, 4));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[{ last }]] = await conn.query(
      'SELECT COALESCE(MAX(claim_seq), 0) AS last FROM client_claims WHERE org_id = ? AND claim_year = ? FOR UPDATE',
      [orgId, year]);
    const seq = Number(last) + 1;
    const number = `PC-${year}-${String(seq).padStart(4, '0')}`;
    const pct = project.contract_value > 0 ? round2((Number(r.amount_ex_gst) / project.contract_value) * 100) : null;
    await conn.query(
      `UPDATE client_claims SET status = 'issued', claim_number = ?, claim_year = ?, claim_seq = ?,
              issued_at = ?, issued_by = ?, due_at = DATE_ADD(?, INTERVAL ${PAYMENT_TERMS_DAYS} DAY),
              percentage_of_contract = ?, updated_at = ?
        WHERE id = ? AND status = 'draft'`,
      [number, year, seq, issuedAt, actor.userId, issuedAt, pct, Date.now(), id]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return { data: await detail({ orgId, actor, id }), warnings };
}

/** POST /client-claims/:id/payment { paid_at, payment_reference } — full payment only (v1). */
async function recordPayment({ orgId, actor, id, body }) {
  const r = await loadClaim(orgId, id, actor);
  if (r.status === 'paid') throw new ServiceError('CLAIM_PAID', 'This claim is already paid', 409);
  if (r.status !== 'issued') throw new ServiceError('CLAIM_NOT_ISSUED', 'Only an issued claim can be paid', 409);
  const paidAt = body.paid_at ? toWallClock(body.paid_at, 'paid_at') : nowWallClock();
  await pool.query(
    `UPDATE client_claims SET status = 'paid', paid_at = ?, payment_reference = ?, payment_recorded_by = ?, updated_at = ?
      WHERE id = ?`,
    [paidAt, body.payment_reference || null, actor.userId, Date.now(), id]);
  return detail({ orgId, actor, id });
}

/** POST /client-claims/:id/void { reason } — and a replacement draft supersedes it. */
async function voidClaim({ orgId, actor, id, reason }) {
  if (!String(reason || '').trim()) throw new ServiceError('VALIDATION_ERROR', 'A reason is required to void a claim', 400);
  const r = await loadClaim(orgId, id, actor);
  if (r.status === 'paid') throw new ServiceError('CLAIM_PAID', 'A paid claim cannot be voided', 409);
  if (r.status === 'void') throw new ServiceError('CLAIM_FROZEN', 'This claim is already void', 409);
  await pool.query(
    `UPDATE client_claims SET status = 'void', void_reason = ?, voided_at = NOW(), voided_by = ?, updated_at = ? WHERE id = ?`,
    [String(reason).trim(), actor.userId, Date.now(), id]);
  const replacementId = await createDraft({ orgId, projectId: r.project_id, actor, milestone: r.milestone, supersedesId: id });
  const voided = (await detail({ orgId, actor, id })).client_claim;
  const replacement = (await detail({ orgId, actor, id: replacementId })).client_claim;
  return { client_claim: voided, replacement };
}

/** POST /projects/:id/client-claims { milestone } — the PM raises a draft by hand. */
async function raise({ orgId, actor, projectId, milestone }) {
  const id = await createDraft({ orgId, projectId, actor, milestone });
  return detail({ orgId, actor, id });
}

module.exports = {
  MILESTONES, DEFAULT_SCHEDULE, depositCap, getSchedule, saveSchedule, createDraft,
  list, detail, patchDraft, issue, recordPayment, voidClaim, raise,
};
