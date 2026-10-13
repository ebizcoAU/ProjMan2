// safety.js — the Safety/OHS client the screens use (xprojman-48, v048).
//
// SAFETY_MOCK = false since 2026-10-14: v048 is live on the lab (c1projman2 migrated, routes
// answer). The mock below is kept for offline design review: set it back to true to use it. It is an in-memory
// store with the SAME response shapes as the contract (Server's §8 response), so
// going live is flipping this flag and checking field names against the real
// responses. Mutations work in the mock (add/close actions, close an event,
// notifiable flag) so the Respond/Close flow can be reviewed before the API exists.
// Nothing in the mock is persisted; a page reload resets it.
import { safetyApiReal } from './api';

export const SAFETY_MOCK = false;

export const REGISTER_KINDS = ['swms', 'sds', 'emergency_plan', 'safety_policy', 'whs_management_plan'];
export const REGISTER_KIND_LABEL = {
  swms: 'SWMS', sds: 'Safety data sheet', emergency_plan: 'Emergency plan',
  safety_policy: 'Safety policy', whs_management_plan: 'WHS management plan',
};
export const KIND_LABEL = { hazard: 'Hazard', near_miss: 'Near miss', incident: 'Incident' };

// ── mock ─────────────────────────────────────────────────────────────────────
const ok = (data) => Promise.resolve({ data: { success: true, data } });
const fail = (status, code, message, details) => {
  const err = new Error(message);
  err.code = code;
  err.response = { status, data: { success: false, code, message, details } };
  return Promise.reject(err);
};
const iso = (daysAgo, h = 9) => {
  const d = new Date(Date.now() - daysAgo * 86400000);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};
const day = (daysFromNow) => iso(-daysFromNow).slice(0, 10);

const stores = {}; // projectId → { events, actions, inductions, docs, signoffs }
let seq = 0;
const nid = (p) => `${p}-mock-${++seq}`;

function storeFor(pid) {
  if (stores[pid]) return stores[pid];
  const e1 = nid('ev'), e2 = nid('ev'), e3 = nid('ev'), e4 = nid('ev');
  const swms1 = nid('doc'), swms2 = nid('doc');
  stores[pid] = {
    events: [
      { id: e1, project_id: pid, kind: 'incident', description: 'Worker struck by falling offcut from first-floor frame.', location: 'Lot 12, east elevation',
        severity: 'high', status: 'in_progress', occurred_at: iso(3, 14), raised_at: iso(3, 15), raised_by: { id: 'u1', name: 'Sam Tran' },
        is_notifiable: 1, notifiable_confirmed_by: null, notified_at: null, regulator_reference: null, closed_by: null, closed_at: null, close_note: null,
        documents: [{ id: nid('doc'), kind: 'safety_photo', file_name: 'offcut.jpg', created_at: iso(3, 15) }],
        incident_details: { injured_name: 'J. Nguyen', injury_type: 'Laceration', body_part: 'Forearm', treatment: 'medical', lost_time: 1, witness_names: 'Sam Tran, Alex Reid' } },
      { id: e2, project_id: pid, kind: 'hazard', description: 'Open trench beside the driveway, no barrier.', location: 'Front boundary',
        severity: 'medium', status: 'open', occurred_at: iso(1, 8), raised_at: iso(1, 8), raised_by: { id: 'u2', name: 'Alex Reid' },
        is_notifiable: 0, notifiable_confirmed_by: null, notified_at: null, regulator_reference: null, closed_by: null, closed_at: null, close_note: null,
        documents: [], incident_details: null },
      { id: e3, project_id: pid, kind: 'near_miss', description: 'Pallet of bricks slipped off forklift tines during unload.', location: 'Laydown area',
        severity: 'medium', status: 'closed', occurred_at: iso(12, 10), raised_at: iso(12, 11), raised_by: { id: 'u3', name: 'Priya Shah' },
        is_notifiable: 0, notifiable_confirmed_by: null, notified_at: null, regulator_reference: null,
        closed_by: { id: 'u9', name: 'Site Supervisor' }, closed_at: iso(10, 16), close_note: 'Unloading now done on level ground only, spotter required.',
        documents: [], incident_details: null },
      { id: e4, project_id: pid, kind: 'hazard', description: 'Extension lead run through standing water.', location: 'Garage slab',
        severity: 'low', status: 'closed', occurred_at: iso(40, 9), raised_at: iso(40, 9), raised_by: { id: 'u2', name: 'Alex Reid' },
        is_notifiable: 0, notifiable_confirmed_by: null, notified_at: null, regulator_reference: null,
        closed_by: { id: 'u9', name: 'Site Supervisor' }, closed_at: iso(39, 12), close_note: 'Lead re-routed overhead.',
        documents: [], incident_details: null },
    ],
    actions: [
      { id: nid('act'), event_id: e1, action: 'Install catch screens on first-floor east edge', assigned_to: null, assigned_to_name: 'Framing crew lead',
        due_date: day(-1), status: 'open', closed_by: null, closed_at: null, documents: [] },
      { id: nid('act'), event_id: e1, action: 'Toolbox talk on working below frames', assigned_to: null, assigned_to_name: 'Site Supervisor',
        due_date: day(2), status: 'closed', closed_by: { id: 'u9', name: 'Site Supervisor' }, closed_at: iso(1, 7), documents: [] },
      { id: nid('act'), event_id: e3, action: 'Brief forklift operators on level-ground rule', assigned_to: null, assigned_to_name: 'Priya Shah',
        due_date: day(-11), status: 'closed', closed_by: { id: 'u9', name: 'Site Supervisor' }, closed_at: iso(10, 15), documents: [] },
    ],
    inductions: [
      { id: nid('ind'), user_id: 'u1', name: 'Sam Tran', inducted_by_name: 'Site Supervisor', inducted_at: iso(60), expires_at: day(120) },
      { id: nid('ind'), user_id: 'u2', name: 'Alex Reid', inducted_by_name: 'Site Supervisor', inducted_at: iso(170), expires_at: day(9) },
      { id: nid('ind'), user_id: null, name: 'Visitor: plumbing inspector', inducted_by_name: 'Site Supervisor', inducted_at: iso(200), expires_at: day(-5) },
    ],
    docs: [
      { document_id: swms1, kind: 'swms', original_filename: 'SWMS – Working at heights.pdf', created_at: iso(30) },
      { document_id: swms2, kind: 'swms', original_filename: 'SWMS – Excavation.pdf', created_at: iso(25) },
      { document_id: nid('doc'), kind: 'sds', original_filename: 'SDS – Concrete additive.pdf', created_at: iso(20) },
      { document_id: nid('doc'), kind: 'emergency_plan', original_filename: 'Emergency & evacuation plan.pdf', created_at: iso(45) },
    ],
    signoffs: {
      [swms1]: [
        { id: nid('so'), user_id: 'u1', name: 'Sam Tran', signed_at: iso(29, 7) },
        { id: nid('so'), user_id: 'u2', name: 'Alex Reid', signed_at: iso(29, 7) },
      ],
      [swms2]: [{ id: nid('so'), user_id: 'u2', name: 'Alex Reid', signed_at: iso(24, 7) }],
    },
  };
  return stores[pid];
}
const findEvent = (eid) => {
  for (const s of Object.values(stores)) {
    const e = s.events.find((x) => x.id === eid);
    if (e) return { s, e };
  }
  return {};
};
const today = () => new Date().toISOString().slice(0, 10);
const withCounts = (s, e) => {
  const acts = s.actions.filter((a) => a.event_id === e.id && a.status === 'open');
  const { incident_details: _hidden, documents: _docs, ...row } = e; // rows never carry incident details
  return { ...row, open_action_count: acts.length, overdue_action_count: acts.filter((a) => a.due_date && a.due_date < today()).length };
};
const inductionStatus = (i) => {
  if (!i.expires_at) return 'valid';
  if (i.expires_at < today()) return 'expired';
  return i.expires_at <= day(14) ? 'expiring' : 'valid';
};

const mock = {
  events: (pid, p = {}) => {
    const s = storeFor(pid);
    let rows = s.events;
    for (const k of ['kind', 'status', 'severity']) if (p[k]) rows = rows.filter((e) => e[k] === p[k]);
    if (p.is_notifiable !== undefined && p.is_notifiable !== '') rows = rows.filter((e) => String(e.is_notifiable) === String(p.is_notifiable));
    rows = [...rows].sort((a, b) => b.raised_at.localeCompare(a.raised_at));
    return ok({ safety_events: rows.map((e) => withCounts(s, e)), next_cursor: null });
  },
  event: (eid) => {
    const { s, e } = findEvent(eid);
    if (!e) return fail(404, 'NOT_FOUND', 'Safety event not found');
    return ok({ safety_event: { ...e, actions: s.actions.filter((a) => a.event_id === eid) } });
  },
  patchEvent: (eid, body) => {
    const { e } = findEvent(eid);
    if (!e) return fail(404, 'NOT_FOUND', 'Safety event not found');
    // A notifiable event stays editable over REST by safety.manage (audit-logged,
    // Server's §8 refinement); only sync edits are SAFETY_FROZEN.
    Object.assign(e, body);
    return ok({ id: eid, ...body });
  },
  closeEvent: (eid, closeNote) => {
    const { s, e } = findEvent(eid);
    if (!e) return fail(404, 'NOT_FOUND', 'Safety event not found');
    const open = s.actions.filter((a) => a.event_id === eid && a.status === 'open');
    if (open.length) return fail(409, 'SAFETY_OPEN_ACTIONS', `${open.length} action(s) still open`, { action_ids: open.map((a) => a.id) });
    Object.assign(e, { status: 'closed', close_note: closeNote || null, closed_at: new Date().toISOString(), closed_by: { id: 'me', name: 'You' } });
    return ok({ id: eid, status: 'closed' });
  },
  setNotifiable: (eid, body) => {
    const { e } = findEvent(eid);
    if (!e) return fail(404, 'NOT_FOUND', 'Safety event not found');
    Object.assign(e, body);
    if (body.is_notifiable !== undefined) e.notifiable_confirmed_by = body.is_notifiable ? { id: 'me', name: 'You' } : null;
    return ok({ id: eid, ...body });
  },
  addAction: (eid, body) => {
    const { s, e } = findEvent(eid);
    if (!e) return fail(404, 'NOT_FOUND', 'Safety event not found');
    const a = { id: nid('act'), event_id: eid, status: 'open', closed_by: null, closed_at: null, documents: [], assigned_to: null, ...body };
    s.actions.push(a);
    if (e.status === 'open') e.status = 'in_progress';
    return ok(a);
  },
  patchAction: (aid, body) => {
    for (const s of Object.values(stores)) {
      const a = s.actions.find((x) => x.id === aid);
      if (!a) continue;
      Object.assign(a, body);
      if (body.status === 'closed') Object.assign(a, { closed_at: new Date().toISOString(), closed_by: { id: 'me', name: 'You' } });
      return ok(a);
    }
    return fail(404, 'NOT_FOUND', 'Action not found');
  },
  summary: (p = {}) => {
    // The mock only knows projects it has seen; with none yet, show one sample set.
    const pids = p.project_id ? [p.project_id] : (Object.keys(stores).length ? Object.keys(stores) : ['sample']);
    const evs = pids.flatMap((pid) => storeFor(pid).events.map((e) => ({ ...e, _s: storeFor(pid) })));
    const count = (key, vals) => Object.fromEntries(vals.map((v) => [v, evs.filter((e) => e[key] === v).length]));
    const months = {};
    for (const e of evs) {
      const period = e.occurred_at.slice(0, 7);
      months[period] ||= { period, hazard: 0, near_miss: 0, incident: 0 };
      months[period][e.kind] += 1;
    }
    const overdue = pids.flatMap((pid) => storeFor(pid).actions
      .filter((a) => a.status === 'open' && a.due_date && a.due_date < today())
      .map((a) => ({ action_id: a.id, event_id: a.event_id, project_id: pid, due_date: a.due_date, assigned_to_name: a.assigned_to_name, action: a.action })));
    return ok({
      totals: {
        by_kind: count('kind', ['hazard', 'near_miss', 'incident']),
        by_severity: count('severity', ['low', 'medium', 'high']),
        by_status: count('status', ['open', 'in_progress', 'closed']),
      },
      series: Object.values(months).sort((a, b) => a.period.localeCompare(b.period)),
      notifiable_count: evs.filter((e) => e.is_notifiable).length,
      overdue_actions: overdue,
    });
  },
  inductions: (pid, status) => {
    const rows = storeFor(pid).inductions.map((i) => ({ ...i, status: inductionStatus(i) }));
    return ok({ site_inductions: status ? rows.filter((i) => i.status === status) : rows });
  },
  swmsSignoffs: (pid, docId) => ok({ signoffs: storeFor(pid).signoffs[docId] || [] }),
  registerDocs: (pid, kinds) => ok({ documents: storeFor(pid).docs.filter((d) => kinds.includes(d.kind)) }),
};

export const safetyApi = SAFETY_MOCK ? mock : safetyApiReal;
