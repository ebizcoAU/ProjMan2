// clientClaims.js — client progress claims at the 6 billing milestones + the payment
// schedule (xprojman-43 §11/§12, re-scoped by §13 and renamed from "invoices" by O3, §14).
// ProjMan records the claim; the builder's accounting system issues the tax invoice from
// the export (lib/accountingExport.js).
//
// CLIENT_CLAIMS_MOCK was true until Server built x43 R2 (v053, live 2026-10-14); the mock stays for offline review. The routes in clientClaimsApiReal
// (lib/api.js) and the response shapes below follow §12 as renamed by §13.2.
// Going live is flipping this flag and checking field names against the real responses.
// Dates follow the API's wall-clock form ('YYYY-MM-DD HH:MM:SS', mysql2 dateStrings).
// Nothing in the mock is persisted; a page reload resets it.
import { clientClaimsApiReal } from './api';

export const CLIENT_CLAIMS_MOCK = false; // live since x43 R2 (v053, 2026-10-14)

export const MILESTONES = ['deposit', 'base', 'frame', 'lock_up', 'fixing', 'completion'];
export const MILESTONE_LABEL = {
  deposit: 'Deposit', base: 'Base', frame: 'Frame', lock_up: 'Lock-up', fixing: 'Fixing', completion: 'Completion',
};
// Readiness gates per milestone (x43 §13.4): the statutory/stage events that must be met
// before the claim is ready. S18.14 stays unmet until xprojman-51 (client sign-off) is built.
const GATES = {
  deposit: [['S9.7', 'Job Award accepted'], ['S9.9', 'Cost Plan locked']],
  base: [['S12.10', 'Slab hold points cleared']],
  frame: [['S13.11', 'Frame validated (engineer, surveyor, certificate)']],
  lock_up: [['S14.7', 'Secured from weather (Site Supervisor)']],
  fixing: [['S16.10', 'Final trade sign-off']],
  completion: [['S18.3', 'Occupation certificate issued'], ['S18.14', 'Client final sign-off']],
};
// The stage that fires each milestone's draft (x43 §5, v3.4 codes per roles §8 #19).
export const MILESTONE_TRIGGER = {
  deposit: 'Job Award accepted (S9.7)', base: 'S12 complete, slab validated', frame: 'S13 complete, frame approved',
  lock_up: 'S14 complete, building secured', fixing: 'S16 complete', completion: 'S18.3 OC issued + S18.14 client sign-off',
};

// ── mock ─────────────────────────────────────────────────────────────────────
const ok = (data, warnings) => Promise.resolve({ data: { success: true, data, ...(warnings?.length ? { warnings } : {}) } });
const fail = (status, code, message, details) => {
  const err = new Error(message);
  err.code = code;
  err.response = { status, data: { success: false, code, message, details } };
  return Promise.reject(err);
};
const pad = (n) => String(n).padStart(2, '0');
const wall = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;
const daysAgo = (n) => wall(new Date(Date.now() - n * 86400000));
const addDays = (w, n) => wall(new Date(new Date(w.replace(' ', 'T')).getTime() + n * 86400000));
const now = () => wall(new Date());
const round2 = (v) => Math.round(v * 100) / 100;

// x43 §2.2 canonical AIA schedule — the seed for a project with no schedule yet.
const DEFAULT_SCHEDULE = { deposit: 5, base: 10, frame: 15, lock_up: 35, fixing: 20, completion: 15 };
// x43 §2.1 deposit caps, shaped per Server's §11 review + the PM ruling: Server holds them
// in a data table, and only VIC and WA are verified. The rest are unverified until the
// Owner's legal check. Shape { pct|null, amount_inc_gst|null, rule, source, verified } or null
// (no row). Only a VERIFIED cap blocks (DEPOSIT_CAP_EXCEEDED); unverified or missing just
// adds a DEPOSIT_CAP_UNVERIFIED warning to the envelope. Mock-only, display-only.
function depositCap(state, contractExGst) {
  const price = contractExGst * 1.1; // the caps are on the contract price the client pays
  const cap = (pct, amount, rule, source, verified) => ({
    pct, amount_inc_gst: amount ?? (pct == null ? null : round2((price * pct) / 100)), rule, source, verified });
  switch (state) {
    case 'VIC': return cap(price >= 20000 ? 5 : 10, null, `VIC: ${price >= 20000 ? '5% (contract ≥ $20k)' : '10% (contract < $20k)'}`, 'Domestic Building Contracts Act 1995', true);
    case 'WA':  return price >= 7500 && price <= 500000 ? cap(6.5, null, 'WA: 6.5% ($7.5k–$500k)', 'Home Building Contracts Act 1991', true) : null;
    case 'NSW': return price > 20000 ? cap(10, null, 'NSW: 10% (contract > $20k)', 'Home Building Act 1989', false) : null;
    case 'SA':  return price >= 12000 ? cap(null, 1000, 'SA: $1,000 flat (contract ≥ $12k)', 'SA domestic building law', false) : null;
    case 'QLD': return price <= 20000 ? cap(10, null, 'QLD: 10% (contract ≤ $20k)', 'QBCC', false) : null;
    default:    return null;
  }
}
// Applies the cap to a deposit (inc GST). Returns { error } for a verified breach, else { warnings }.
function checkDeposit(p, depositIncGst) {
  const c = depositCap(p.site_state, p.contract_value);
  if (c?.verified) {
    return c.amount_inc_gst != null && depositIncGst > c.amount_inc_gst + 0.005 ? { error: capError(c) } : { warnings: [] };
  }
  const over = c?.amount_inc_gst != null && depositIncGst > c.amount_inc_gst + 0.005;
  return { warnings: [{ code: 'DEPOSIT_CAP_UNVERIFIED', message: c
    ? `The ${p.site_state} deposit cap (${c.rule}) isn't verified yet, so it wasn't enforced${over ? '. This deposit is over it' : ''}.`
    : `No deposit cap is on file for ${p.site_state || 'this site'}, so none was enforced.` }] };
}
const capError = (cap) => fail(409, 'DEPOSIT_CAP_EXCEEDED', `The deposit is over the cap: ${cap.rule}`,
  { cap_pct: cap.pct, cap_amount_inc_gst: cap.amount_inc_gst, rule: cap.rule });
const GST_REGISTERED = true; // organisations.gst_registered — the mock org is registered
const gstOn = (exGst) => (GST_REGISTERED ? round2(exGst * 0.1) : 0);

const projects = {}; // projectId → { id, code, name, contract_value, site_state }
const schedules = {}; // projectId → { milestone: pct }
const invoices = []; // all mock invoices
let seq = 0;
let invNo = 41;
const nid = (p) => `${p}-mock-${++seq}`;

function makeInvoice(p, milestone, status, issuedDaysAgo) {
  const pct = (schedules[p.id] || DEFAULT_SCHEDULE)[milestone];
  const exGst = round2((p.contract_value * pct) / 100);
  const gst = gstOn(exGst);
  const issued = issuedDaysAgo == null ? null : daysAgo(issuedDaysAgo);
  const inv = {
    id: nid('inv'), project_id: p.id, project_code: p.code, project_name: p.name, milestone,
    claim_number: status === 'draft' ? null : `INV-2026-${String(++invNo).padStart(4, '0')}`,
    status, amount_ex_gst: exGst, gst_amount: gst, amount_inc_gst: round2(exGst + gst), percentage_of_contract: pct,
    issued_at: issued, due_at: issued ? addDays(issued, 14) : null,
    paid_at: null, payment_reference: null, payment_recorded_by: null, void_reason: null, voided_at: null, voided_by: null,
    has_pdf: status !== 'draft', journal_entry_id: status === 'draft' ? null : nid('je'),
    supersedes_id: null, created_at: issued || daysAgo(1),
    created_by: { id: 'sys', name: 'System (milestone trigger)' },
  };
  if (status === 'paid') {
    Object.assign(inv, { paid_at: addDays(issued, 9), payment_reference: 'EFT 88213',
      payment_recorded_by: { id: 'u-office', name: 'Office admin' } });
  }
  invoices.push(inv);
  return inv;
}

// Called by the pages with the real project list, so the mock bills real projects.
export function seedMockProjects(list) {
  if (!CLIENT_CLAIMS_MOCK) return;
  (list || []).forEach((src, i) => {
    if (projects[src.id]) return;
    const p = { id: src.id, code: src.code || `P-${i + 1}`, name: src.name || 'Project',
      contract_value: Number(src.contract_value) > 0 ? Number(src.contract_value) : 640000 + i * 85000,
      site_state: src.site_state || 'VIC' };
    projects[p.id] = p;
    schedules[p.id] = { ...DEFAULT_SCHEDULE };
    // Vary the sample by position: paid, overdue, current and a draft awaiting issue.
    const shape = [
      [['deposit', 'paid', 120], ['base', 'paid', 75], ['frame', 'issued', 30], ['lock_up', 'draft', null]],
      [['deposit', 'paid', 40], ['base', 'issued', 6]],
      [['deposit', 'draft', null]],
    ][i % 3];
    shape.forEach(([m, st, d]) => makeInvoice(p, m, st, d));
  });
}

const today = () => now().slice(0, 10);
// Milestones whose % is frozen: an issued or paid claim was billed at it.
const lockedMilestones = (pid) => new Set(invoices
  .filter((i) => i.project_id === pid && !i.is_deleted && (i.status === 'issued' || i.status === 'paid')).map((i) => i.milestone));
const withAging = (inv) => {
  const overdueDays = inv.status === 'issued' && inv.due_at && inv.due_at.slice(0, 10) < today()
    ? Math.floor((Date.now() - new Date(inv.due_at.replace(' ', 'T')).getTime()) / 86400000) : 0;
  return { ...inv, days_overdue: overdueDays };
};
const findInv = (iid) => invoices.find((x) => x.id === iid);

const mock = {
  list: (p = {}) => {
    let rows = invoices.filter((i) => !i.is_deleted);
    if (p.project_id) rows = rows.filter((i) => i.project_id === p.project_id);
    if (p.status === 'overdue') rows = rows.filter((i) => withAging(i).days_overdue > 0);
    else if (p.status) rows = rows.filter((i) => i.status === p.status);
    rows = rows.map(withAging).sort((a, b) =>
      a.project_code.localeCompare(b.project_code) || MILESTONES.indexOf(a.milestone) - MILESTONES.indexOf(b.milestone));
    const live = invoices.filter((i) => !i.is_deleted && (!p.project_id || i.project_id === p.project_id)).map(withAging);
    const sum = (arr) => round2(arr.reduce((s, i) => s + i.amount_inc_gst, 0));
    return ok({
      client_claims: rows,
      totals: {
        draft_count: live.filter((i) => i.status === 'draft').length,
        outstanding_inc_gst: sum(live.filter((i) => i.status === 'issued')),
        overdue_inc_gst: sum(live.filter((i) => i.days_overdue > 0)),
        paid_inc_gst: sum(live.filter((i) => i.status === 'paid')),
      },
    });
  },
  detail: (iid) => {
    const inv = findInv(iid);
    if (!inv) return fail(404, 'NOT_FOUND', 'Claim not found');
    const p = projects[inv.project_id];
    return ok({ client_claim: { ...withAging(inv), contract_value: p.contract_value, site_state: p.site_state,
      supplier: { name: 'Your organisation', abn: '12 345 678 901', gst_registered: GST_REGISTERED } } });
  },
  create: (pid, milestone) => {
    const p = projects[pid];
    if (!p) return fail(404, 'NOT_FOUND', 'Project not found');
    if (invoices.some((i) => i.project_id === pid && i.milestone === milestone && i.status !== 'void')) {
      return fail(409, 'CLAIM_EXISTS', 'That milestone already has a live claim');
    }
    return ok({ client_claim: withAging(makeInvoice(p, milestone, 'draft', null)) });
  },
  patch: (iid, body) => {
    const inv = findInv(iid);
    if (!inv) return fail(404, 'NOT_FOUND', 'Claim not found');
    if (inv.status !== 'draft') return fail(409, 'CLAIM_FROZEN', 'Only a draft claim can be edited');
    const exGst = round2(Number(body.amount_ex_gst));
    if (!(exGst > 0)) return fail(400, 'VALIDATION_ERROR', 'amount_ex_gst must be greater than 0');
    const gst = gstOn(exGst);
    Object.assign(inv, { amount_ex_gst: exGst, gst_amount: gst, amount_inc_gst: round2(exGst + gst),
      variation_note: body.variation_note || null });
    return ok(inv);
  },
  issue: (iid) => {
    const inv = findInv(iid);
    if (!inv) return fail(404, 'NOT_FOUND', 'Claim not found');
    if (inv.status !== 'draft') return fail(409, 'CLAIM_FROZEN', 'Claim already issued');
    const p = projects[inv.project_id];
    const total = Object.values(schedules[p.id]).reduce((s, v) => s + Number(v), 0);
    if (Math.abs(total - 100) > 0.001) {
      return fail(409, 'SCHEDULE_NOT_100', `The project's payment schedule sums to ${total}%, not 100%`);
    }
    const dep = inv.milestone === 'deposit' ? checkDeposit(p, inv.amount_inc_gst) : { warnings: [] };
    if (dep.error) return dep.error;
    const issued = now();
    Object.assign(inv, { status: 'issued', claim_number: `INV-2026-${String(++invNo).padStart(4, '0')}`,
      issued_at: issued, due_at: addDays(issued, 14), has_pdf: true, journal_entry_id: nid('je'),
      percentage_of_contract: round2((inv.amount_ex_gst / p.contract_value) * 100) });
    return ok(withAging(inv), dep.warnings);
  },
  recordPayment: (iid, body) => {
    const inv = findInv(iid);
    if (!inv) return fail(404, 'NOT_FOUND', 'Claim not found');
    if (inv.status !== 'issued') return fail(409, 'CLAIM_NOT_ISSUED', 'Only an issued claim can be marked paid');
    Object.assign(inv, { status: 'paid', paid_at: body.paid_at || now(), payment_reference: body.payment_reference || null,
      payment_recorded_by: { id: 'me', name: 'You' } });
    return ok(withAging(inv));
  },
  // Voiding keeps the row (status 'void') and the server opens a fresh draft for the same
  // milestone, supersedes_id → the voided one. An issued void also posts a reversing
  // journal entry (an adjustment note); a draft void posts nothing.
  void: (iid, reason) => {
    const inv = findInv(iid);
    if (!inv) return fail(404, 'NOT_FOUND', 'Claim not found');
    if (inv.status === 'paid') return fail(409, 'CLAIM_PAID', 'A paid claim can’t be voided');
    if (inv.status === 'void') return fail(409, 'CLAIM_FROZEN', 'Claim already voided');
    if (!reason) return fail(400, 'VALIDATION_ERROR', 'A reason is required');
    Object.assign(inv, { status: 'void', void_reason: reason, voided_at: now(), voided_by: { id: 'me', name: 'You' } });
    const replacement = makeInvoice(projects[inv.project_id], inv.milestone, 'draft', null);
    replacement.supersedes_id = inv.id;
    return ok({ client_claim: withAging(inv), replacement: withAging(replacement) });
  },
  schedule: (pid) => {
    const p = projects[pid];
    if (!p) return fail(404, 'NOT_FOUND', 'Project not found');
    const s = schedules[pid];
    const invoiced = lockedMilestones(pid);
    return ok({
      // invoiced = the lock flag (issued or paid); invoice_status = the live invoice, voids excluded.
      schedule: MILESTONES.map((m) => {
        const live = invoices.find((i) => i.project_id === pid && i.milestone === m && !i.is_deleted && i.status !== 'void');
        // Mock: a milestone with a claim has had its gates met (that's what drafted it).
        const gates = GATES[m].map(([code, label]) => ({ code, label,
          met: !!live && code !== 'S18.14', met_at: live && code !== 'S18.14' ? live.created_at : null }));
        return { milestone: m, percentage: s[m], invoiced: invoiced.has(m), invoice_status: live?.status || null,
          gates, ready: gates.every((g) => g.met) };
      }),
      contract_value: p.contract_value, site_state: p.site_state, deposit_cap: depositCap(p.site_state, p.contract_value),
    });
  },
  saveSchedule: (pid, rows) => {
    const p = projects[pid];
    if (!p) return fail(404, 'NOT_FOUND', 'Project not found');
    const total = rows.reduce((s, r) => s + Number(r.percentage || 0), 0);
    if (Math.abs(total - 100) > 0.001) return fail(400, 'SCHEDULE_NOT_100', `The schedule must sum to 100% (it sums to ${round2(total)}%)`);
    const locked = lockedMilestones(pid);
    const changedLocked = rows.filter((r) => locked.has(r.milestone) && Number(r.percentage) !== Number(schedules[pid][r.milestone]))
      .map((r) => r.milestone);
    if (changedLocked.length) {
      return fail(409, 'SCHEDULE_LOCKED', 'An issued or paid milestone keeps the percentage it was billed at', { milestones: changedLocked });
    }
    const depPct = Number(rows.find((r) => r.milestone === 'deposit')?.percentage || 0);
    const dep = checkDeposit(p, (p.contract_value * 1.1 * depPct) / 100);
    if (dep.error) return dep.error;
    rows.forEach((r) => { schedules[pid][r.milestone] = Number(r.percentage); });
    // Open drafts are re-priced from the new percentages.
    invoices.filter((i) => i.project_id === pid && i.status === 'draft').forEach((i) => {
      const exGst = round2((p.contract_value * schedules[pid][i.milestone]) / 100);
      const gst = gstOn(exGst);
      Object.assign(i, { amount_ex_gst: exGst, gst_amount: gst, amount_inc_gst: round2(exGst + gst), percentage_of_contract: schedules[pid][i.milestone] });
    });
    return mock.schedule(pid).then((res) => ok(res.data.data, dep.warnings));
  },
};

// Read access for the accounting-export mock (lib/accountingExport.js), so its `sales` rows
// are the same claims the Client Invoices screens show. Mock-only.
export const mockStore = { projects, invoices };

export const clientClaimsApi = CLIENT_CLAIMS_MOCK ? mock : clientClaimsApiReal;
