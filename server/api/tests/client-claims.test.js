// Client progress claims (xprojman-43 R2, migration v053).
//
//   1. Schedule: the x43 §2.2 default, SCHEDULE_NOT_100, a verified deposit cap blocks (VIC).
//   2. Claims: raise a draft, CLAIM_EXISTS, edit a draft (GST recomputed), issue (number + due date),
//      CLAIM_FROZEN, SCHEDULE_LOCKED + re-pricing drafts, payment (CLAIM_NOT_ISSUED, Perth paid_at),
//      void (reason, CLAIM_PAID, replacement draft with supersedes_id).
//   3. An unverified state warns but doesn't block (DEPOSIT_CAP_UNVERIFIED).
//   4. The list: totals, overdue derived, status filter; money.read gate; CONTRACT_VALUE_MISSING.
//
// Run: DB_NAME=c1projman2_e2e DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &
//      DB_NAME=c1projman2_e2e BASE=http://localhost:4199 node tests/client-claims.test.js
const pool = require('../src/db/pool');
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}
async function pairAs(admin, userId, role, uid) {
  const init = await call('POST', '/pairing/initiate', { role, label: uid, assign_user_id: userId }, admin);
  const rid = init.json.data.request_id, nonce = init.json.data.qr_payload.nonce;
  await call('POST', '/pairing/request', { request_id: rid, nonce, device_uid: uid, platform: 'android' });
  await call('POST', '/pairing/confirm', { request_id: rid, role }, admin);
  const st = await call('GET', `/pairing/status/${rid}?device_uid=${uid}`);
  return st.json.data?.accessToken;
}
const sched = (o) => Object.entries(o).map(([milestone, percentage]) => ({ milestone, percentage }));

(async () => {
  console.log(`Client progress claims test → ${BASE}\n`);
  const s = Date.now();
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Claims ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'web' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id;
  const [[me]] = await pool.query('SELECT org_id FROM users WHERE id = ?', [pmUser]);
  await pool.query("UPDATE organisations SET state = 'VIC', gst_registered = 1 WHERE id = ?", [me.org_id]);
  const tradie = await pairAs(pm, pmUser, 'tradie', `tra-${s}`);

  const projId = (await call('POST', '/projects', { code: `CC-${s}`, name: 'Lot 3 dwelling', contract_value: 500000 }, pm)).json.data.id;
  const [[prow]] = await pool.query('SELECT site_state FROM projects WHERE id = ?', [projId]);
  ok('a new project\'s site_state defaults to the org\'s state', prow.site_state === 'VIC', JSON.stringify(prow));

  // ── 1. Schedule ──
  const g0 = await call('GET', `/projects/${projId}/payment-schedule`, undefined, pm);
  const d = g0.json.data;
  ok('the default schedule (x43 §2.2) totals 100% and is flagged default',
    g0.status === 200 && d.is_default === true && d.schedule.reduce((a, r) => a + r.percentage, 0) === 100, JSON.stringify(d).slice(0, 300));
  ok('VIC deposit cap: 5%, verified, on the GST-inclusive price ($550,000 → $27,500)',
    d.deposit_cap?.pct === 5 && d.deposit_cap.verified === true && d.deposit_cap.amount_inc_gst === 27500, JSON.stringify(d.deposit_cap));
  ok('each schedule row carries readiness gates', d.schedule.every((r) => Array.isArray(r.gates) && r.gates.length >= 1 && r.ready === false));
  const not100 = await call('PUT', `/projects/${projId}/payment-schedule`,
    { schedule: sched({ deposit: 5, base: 10, frame: 15, lock_up: 35, fixing: 20, completion: 10 }) }, pm);
  ok('a schedule that doesn\'t total 100% is refused (SCHEDULE_NOT_100)', not100.status === 400 && not100.json.code === 'SCHEDULE_NOT_100', JSON.stringify(not100.json));
  const overCap = await call('PUT', `/projects/${projId}/payment-schedule`,
    { schedule: sched({ deposit: 6, base: 9, frame: 15, lock_up: 35, fixing: 20, completion: 15 }) }, pm);
  ok('a 6% deposit in VIC breaks the verified 5% cap (DEPOSIT_CAP_EXCEEDED)',
    overCap.status === 409 && overCap.json.code === 'DEPOSIT_CAP_EXCEEDED' && overCap.json.details?.cap_pct === 5, JSON.stringify(overCap.json));

  // ── 2. Claims ──
  const noMoney = await call('GET', '/client-claims', undefined, tradie);
  ok('a role without money.read cannot list claims (403)', noMoney.status === 403);
  const dep = await call('POST', `/projects/${projId}/client-claims`, { milestone: 'deposit' }, pm);
  const depC = dep.json.data?.client_claim;
  ok('the PM raises a deposit draft: 5% ex GST + 10% GST, no number yet',
    dep.status === 201 && depC.status === 'draft' && depC.amount_ex_gst === 25000 && depC.gst_amount === 2500
      && depC.amount_inc_gst === 27500 && depC.claim_number === null, JSON.stringify(dep.json));
  const dup = await call('POST', `/projects/${projId}/client-claims`, { milestone: 'deposit' }, pm);
  ok('one live claim per milestone (CLAIM_EXISTS)', dup.status === 409 && dup.json.code === 'CLAIM_EXISTS', JSON.stringify(dup.json));
  const ed = await call('PATCH', `/client-claims/${depC.id}`, { amount_ex_gst: 24000, variation_note: 'Agreed reduction' }, pm);
  ok('a draft can be edited; GST is recomputed',
    ed.status === 200 && ed.json.data.client_claim.gst_amount === 2400 && ed.json.data.client_claim.variation_note === 'Agreed reduction',
    JSON.stringify(ed.json).slice(0, 300));
  const iss = await call('POST', `/client-claims/${depC.id}/issue`, undefined, pm);
  const issC = iss.json.data?.client_claim;
  const year = new Date().getFullYear();
  ok('issuing assigns PC-YYYY-0001 and a due date 14 days on, with no cap warning (within the verified cap)',
    iss.status === 200 && issC.status === 'issued' && issC.claim_number === `PC-${year}-0001` && !!issC.due_at && !iss.json.warnings,
    JSON.stringify(iss.json).slice(0, 400));
  ok('…and the supplier block shows the org and its GST registration', issC?.supplier?.gst_registered === true);
  const frozen = await call('PATCH', `/client-claims/${depC.id}`, { amount_ex_gst: 1 }, pm);
  ok('an issued claim can\'t be edited (CLAIM_FROZEN)', frozen.status === 409 && frozen.json.code === 'CLAIM_FROZEN');

  const base = (await call('POST', `/projects/${projId}/client-claims`, { milestone: 'base' }, pm)).json.data.client_claim;
  const lockedPut = await call('PUT', `/projects/${projId}/payment-schedule`,
    { schedule: sched({ deposit: 4, base: 11, frame: 15, lock_up: 35, fixing: 20, completion: 15 }) }, pm);
  ok('changing an issued milestone\'s % is refused (SCHEDULE_LOCKED)',
    lockedPut.status === 409 && lockedPut.json.code === 'SCHEDULE_LOCKED' && lockedPut.json.details?.milestones?.includes('deposit'),
    JSON.stringify(lockedPut.json));
  const okPut = await call('PUT', `/projects/${projId}/payment-schedule`,
    { schedule: sched({ deposit: 5, base: 12, frame: 13, lock_up: 35, fixing: 20, completion: 15 }) }, pm);
  const baseAfter = (await call('GET', `/client-claims/${base.id}`, undefined, pm)).json.data.client_claim;
  ok('a schedule change on unissued milestones saves, and the base draft is re-priced (12%)',
    okPut.status === 200 && baseAfter.amount_ex_gst === 60000, JSON.stringify([okPut.json.code, baseAfter.amount_ex_gst]));

  const payDraft = await call('POST', `/client-claims/${base.id}/payment`, { paid_at: '2026-10-14T01:00:00Z' }, pm);
  ok('a draft can\'t be paid (CLAIM_NOT_ISSUED)', payDraft.status === 409 && payDraft.json.code === 'CLAIM_NOT_ISSUED');
  const paid = await call('POST', `/client-claims/${depC.id}/payment`, { paid_at: '2026-10-14T01:00:00Z', payment_reference: 'EFT 1234' }, pm);
  const paidC = paid.json.data?.client_claim;
  ok('recording a full payment: paid, Perth wall-clock, recorded by the PM',
    paid.status === 200 && paidC.status === 'paid' && String(paidC.paid_at) === '2026-10-14 09:00:00' && paidC.payment_recorded_by?.id === pmUser,
    JSON.stringify(paid.json).slice(0, 300));
  const voidPaid = await call('POST', `/client-claims/${depC.id}/void`, { reason: 'x' }, pm);
  ok('a paid claim can\'t be voided (CLAIM_PAID)', voidPaid.status === 409 && voidPaid.json.code === 'CLAIM_PAID');

  const baseIss = await call('POST', `/client-claims/${base.id}/issue`, undefined, pm);
  ok('the next issue is PC-YYYY-0002', baseIss.json.data?.client_claim?.claim_number === `PC-${year}-0002`, JSON.stringify(baseIss.json).slice(0, 200));
  const noReason = await call('POST', `/client-claims/${base.id}/void`, {}, pm);
  ok('a void needs a reason (400)', noReason.status === 400);
  const vd = await call('POST', `/client-claims/${base.id}/void`, { reason: 'Wrong client entity' }, pm);
  ok('voiding an issued claim drafts a replacement that supersedes it',
    vd.status === 200 && vd.json.data.client_claim.status === 'void' && vd.json.data.replacement?.status === 'draft'
      && vd.json.data.replacement.supersedes_id === base.id, JSON.stringify(vd.json).slice(0, 400));

  // ── 3. Unverified state ──
  const nswId = (await call('POST', '/projects', { code: `CCN-${s}`, name: 'NSW job', contract_value: 400000, site_state: 'NSW' }, pm)).json.data.id;
  const nswDep = (await call('POST', `/projects/${nswId}/client-claims`, { milestone: 'deposit' }, pm)).json.data.client_claim;
  const nswIss = await call('POST', `/client-claims/${nswDep.id}/issue`, undefined, pm);
  ok('an unverified state is never blocked, only warned (DEPOSIT_CAP_UNVERIFIED)',
    nswIss.status === 200 && nswIss.json.warnings?.[0]?.code === 'DEPOSIT_CAP_UNVERIFIED', JSON.stringify(nswIss.json).slice(0, 300));
  const noCv = (await call('POST', '/projects', { code: `CCX-${s}`, name: 'No price' }, pm)).json.data.id;
  const missing = await call('POST', `/projects/${noCv}/client-claims`, { milestone: 'deposit' }, pm);
  ok('no contract value → CONTRACT_VALUE_MISSING', missing.status === 409 && missing.json.code === 'CONTRACT_VALUE_MISSING');

  // ── 4. List ──
  await pool.query("UPDATE client_claims SET due_at = DATE_SUB(NOW(), INTERVAL 3 DAY) WHERE id = ?", [nswDep.id]);
  const all = await call('GET', '/client-claims', undefined, pm);
  const t = all.json.data?.totals;
  ok('totals: one draft (the replacement), $26,400 paid (the edited deposit), and the overdue NSW deposit',
    t?.draft_count === 1 && t.paid_inc_gst === 26400 && t.overdue_inc_gst > 0 && t.outstanding_inc_gst === t.overdue_inc_gst,
    JSON.stringify(t));
  const overdue = await call('GET', '/client-claims?status=overdue', undefined, pm);
  ok('status=overdue is derived (issued and past due), with days_overdue',
    overdue.json.data.client_claims.length === 1 && overdue.json.data.client_claims[0].days_overdue >= 3, JSON.stringify(overdue.json.data.client_claims.map((c) => c.days_overdue)));
  const byProj = await call('GET', `/client-claims?project_id=${projId}&status=void`, undefined, pm);
  ok('filters by project and status', byProj.json.data.client_claims.length === 1 && byProj.json.data.client_claims[0].id === base.id);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
