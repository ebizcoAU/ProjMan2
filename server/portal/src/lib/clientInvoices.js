// clientInvoices.js — the Client Billing client the screens use (xprojman-43, approved
// 2026-09-30 per xprojman-roles §8 #5).
//
// CLIENT_INVOICES_MOCK = true until Server builds x43 Steps 1–2 (+ 3 for the schedule).
// x43 §6 names the Portal pages but not the REST shapes, so the routes in
// clientInvoicesApiReal (lib/api.js) and the response shapes below are Portal's proposal (x43 §11).
// Going live is flipping this flag and checking field names against the real responses.
// Dates follow the API's wall-clock form ('YYYY-MM-DD HH:MM:SS', mysql2 dateStrings).
// Nothing in the mock is persisted; a page reload resets it.
import { clientInvoicesApiReal } from './api';

export const CLIENT_INVOICES_MOCK = true;

export const MILESTONES = ['deposit', 'base', 'frame', 'lock_up', 'fixing', 'completion'];
export const MILESTONE_LABEL = {
  deposit: 'Deposit', base: 'Base', frame: 'Frame', lock_up: 'Lock-up', fixing: 'Fixing', completion: 'Completion',
};
// The stage that fires each milestone's draft (x43 §5, v3.4 codes per roles §8 #19).
export const MILESTONE_TRIGGER = {
  deposit: 'Job Award accepted (S9.7)', base: 'S12 complete, slab validated', frame: 'S13 complete, frame approved',
  lock_up: 'S14 complete, building secured', fixing: 'S16 complete', completion: 'S18.3 OC issued + S18.14 client sign-off',
};

// ── mock ─────────────────────────────────────────────────────────────────────
const ok = (data) => Promise.resolve({ data: { success: true, data } });
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
// x43 §2.1 deposit caps. Mock-only: the real cap check is Server's, on issue, and uses
// projects.site_state (falling back to organisations.state, §8 #5).
function depositCap(state, contract) {
  switch (state) {
    case 'VIC': return contract >= 20000 ? 5 : 10;
    case 'NSW': return contract > 20000 ? 10 : null;
    case 'WA':  return contract >= 7500 && contract <= 500000 ? 6.5 : null;
    case 'SA':  return contract >= 20000 ? 5 : null;
    case 'QLD': return contract <= 20000 ? 10 : null;
    default:    return null;
  }
}

const projects = {}; // projectId → { id, code, name, contract_value, site_state }
const schedules = {}; // projectId → { milestone: pct }
const invoices = []; // all mock invoices
let seq = 0;
let invNo = 41;
const nid = (p) => `${p}-mock-${++seq}`;

function makeInvoice(p, milestone, status, issuedDaysAgo) {
  const pct = (schedules[p.id] || DEFAULT_SCHEDULE)[milestone];
  const exGst = round2((p.contract_value * pct) / 100);
  const gst = round2(exGst * 0.1);
  const issued = issuedDaysAgo == null ? null : daysAgo(issuedDaysAgo);
  const inv = {
    id: nid('inv'), project_id: p.id, project_code: p.code, project_name: p.name, milestone,
    invoice_number: status === 'draft' ? null : `INV-2026-${String(++invNo).padStart(4, '0')}`,
    status, amount_ex_gst: exGst, gst_amount: gst, amount_inc_gst: round2(exGst + gst), percentage_of_contract: pct,
    issued_at: issued, due_at: issued ? addDays(issued, 14) : null,
    paid_at: null, payment_reference: null, recorded_by: null, void_reason: null,
    has_pdf: status !== 'draft', journal_entry_id: status === 'draft' ? null : nid('je'),
    supersedes_id: null, created_at: issued || daysAgo(1),
    created_by: { id: 'sys', name: 'System (milestone trigger)' },
  };
  if (status === 'paid') {
    Object.assign(inv, { paid_at: addDays(issued, 9), payment_reference: 'EFT 88213',
      recorded_by: { id: 'u-office', name: 'Office admin' } });
  }
  invoices.push(inv);
  return inv;
}

// Called by the pages with the real project list, so the mock bills real projects.
export function seedMockProjects(list) {
  if (!CLIENT_INVOICES_MOCK) return;
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
      client_invoices: rows,
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
    if (!inv) return fail(404, 'NOT_FOUND', 'Invoice not found');
    const p = projects[inv.project_id];
    return ok({ client_invoice: { ...withAging(inv), contract_value: p.contract_value, site_state: p.site_state,
      supplier: { name: 'Your organisation', abn: '12 345 678 901' } } });
  },
  patch: (iid, body) => {
    const inv = findInv(iid);
    if (!inv) return fail(404, 'NOT_FOUND', 'Invoice not found');
    if (inv.status !== 'draft') return fail(409, 'INVOICE_FROZEN', 'Only a draft invoice can be edited');
    const exGst = round2(Number(body.amount_ex_gst));
    if (!(exGst > 0)) return fail(400, 'VALIDATION_ERROR', 'amount_ex_gst must be greater than 0');
    const gst = round2(exGst * 0.1);
    Object.assign(inv, { amount_ex_gst: exGst, gst_amount: gst, amount_inc_gst: round2(exGst + gst),
      variation_note: body.variation_note || null });
    return ok(inv);
  },
  issue: (iid) => {
    const inv = findInv(iid);
    if (!inv) return fail(404, 'NOT_FOUND', 'Invoice not found');
    if (inv.status !== 'draft') return fail(409, 'INVOICE_FROZEN', 'Invoice already issued');
    const p = projects[inv.project_id];
    const total = Object.values(schedules[p.id]).reduce((s, v) => s + Number(v), 0);
    if (Math.abs(total - 100) > 0.001) {
      return fail(409, 'SCHEDULE_NOT_100', `The project's payment schedule sums to ${total}%, not 100%`);
    }
    const cap = depositCap(p.site_state, p.contract_value);
    if (inv.milestone === 'deposit' && cap != null && inv.amount_ex_gst > (p.contract_value * cap) / 100 + 0.005) {
      return fail(409, 'DEPOSIT_CAP_EXCEEDED',
        `A ${p.site_state} deposit can't exceed ${cap}% of the contract price`, { cap_pct: cap, site_state: p.site_state });
    }
    const issued = now();
    Object.assign(inv, { status: 'issued', invoice_number: `INV-2026-${String(++invNo).padStart(4, '0')}`,
      issued_at: issued, due_at: addDays(issued, 14), has_pdf: true, journal_entry_id: nid('je'),
      percentage_of_contract: round2((inv.amount_ex_gst / p.contract_value) * 100) });
    return ok(withAging(inv));
  },
  recordPayment: (iid, body) => {
    const inv = findInv(iid);
    if (!inv) return fail(404, 'NOT_FOUND', 'Invoice not found');
    if (inv.status !== 'issued') return fail(409, 'INVOICE_NOT_ISSUED', 'Only an issued invoice can be marked paid');
    Object.assign(inv, { status: 'paid', paid_at: body.paid_at || now(), payment_reference: body.payment_reference || null,
      recorded_by: { id: 'me', name: 'You' } });
    return ok(withAging(inv));
  },
  void: (iid, reason) => {
    const inv = findInv(iid);
    if (!inv) return fail(404, 'NOT_FOUND', 'Invoice not found');
    if (inv.status === 'paid') return fail(409, 'INVOICE_PAID', 'A paid invoice can’t be voided');
    if (!reason) return fail(400, 'VALIDATION_ERROR', 'A reason is required');
    Object.assign(inv, { status: 'void', void_reason: reason });
    return ok(withAging(inv));
  },
  schedule: (pid) => {
    const p = projects[pid];
    if (!p) return fail(404, 'NOT_FOUND', 'Project not found');
    const s = schedules[pid];
    const invoiced = new Set(invoices.filter((i) => i.project_id === pid && !i.is_deleted && i.status !== 'void').map((i) => i.milestone));
    return ok({
      schedule: MILESTONES.map((m) => ({ milestone: m, percentage: s[m], invoiced: invoiced.has(m) })),
      contract_value: p.contract_value, site_state: p.site_state, deposit_cap_pct: depositCap(p.site_state, p.contract_value),
    });
  },
  saveSchedule: (pid, rows) => {
    const p = projects[pid];
    if (!p) return fail(404, 'NOT_FOUND', 'Project not found');
    const total = rows.reduce((s, r) => s + Number(r.percentage || 0), 0);
    if (Math.abs(total - 100) > 0.001) return fail(400, 'SCHEDULE_NOT_100', `The schedule must sum to 100% (it sums to ${round2(total)}%)`);
    const cap = depositCap(p.site_state, p.contract_value);
    const dep = Number(rows.find((r) => r.milestone === 'deposit')?.percentage || 0);
    if (cap != null && dep > cap) {
      return fail(409, 'DEPOSIT_CAP_EXCEEDED', `A ${p.site_state} deposit can't exceed ${cap}% of the contract price`, { cap_pct: cap });
    }
    rows.forEach((r) => { schedules[pid][r.milestone] = Number(r.percentage); });
    return mock.schedule(pid);
  },
};

export const clientInvoicesApi = CLIENT_INVOICES_MOCK ? mock : clientInvoicesApiReal;
