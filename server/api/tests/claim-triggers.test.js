// Milestone auto-draft triggers (xprojman-43 R5, §5). No migration.
//
//   1. Deposit: award accepted alone doesn't draft (S9.9 not met); locking the cost plan does, as the
//      system (created_by NULL); re-locking doesn't duplicate.
//   2. Base: an inspector validating Stage 12 drafts the Base claim at the schedule's %.
//   3. Catch-up + 0%: validating Stage 13 with Frame at 0% drafts no Frame claim, but drafts
//      Lock-up whose gate (Stage 14 complete) was already met.
//   4. Completion: Stage 18 validated + the S18.14 sign-off satisfied → Completion draft.
//   5. No contract value: the event still succeeds, nothing is drafted.
//
// Run: DB_NAME=c1projman2_e2e DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &
//      DB_NAME=c1projman2_e2e BASE=http://localhost:4199 node tests/claim-triggers.test.js
const pool = require('../src/db/pool');
const ClientClaimService = require('../src/services/ClientClaimService');
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
const claimsOf = async (projectId) => {
  const [rows] = await pool.query(
    `SELECT milestone, status, created_by, amount_ex_gst FROM client_claims
      WHERE project_id = ? AND live_milestone IS NOT NULL ORDER BY created_at`, [projectId]);
  return rows;
};
const sched = (o) => Object.entries(o).map(([milestone, percentage]) => ({ milestone, percentage }));

(async () => {
  console.log(`Milestone triggers test → ${BASE}\n`);
  const s = Date.now();
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Triggers ${s}` },
    user: { full_name: 'Pat PM', email: `trg${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `trg-${s}`, platform: 'web' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id;
  const [[me]] = await pool.query('SELECT org_id FROM users WHERE id = ?', [pmUser]);
  const orgId = me.org_id;
  await pool.query("UPDATE organisations SET state = 'WA', gst_registered = 1 WHERE id = ?", [orgId]);
  const insp = await pairAs(pm, pmUser, 'inspector', `trgi-${s}`);

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const projId = (await call('POST', '/projects', { code: `TR-${s}`, name: 'Lot 2 dwelling', contract_value: 500000 }, pm)).json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  const stages = (await call('GET', `/projects/${projId}`, undefined, pm)).json.data.stages;
  const st = (n) => stages.find((x) => x.seq === n);
  ok('(setup) a new project with a programme has no claims', (await claimsOf(projId)).length === 0);

  // ── 1. Deposit ──
  await call('POST', '/organisation/users',
    { email: `trgb${s}@x.com`, full_name: 'Bo Builder', role: 'builder', password: 'hunter2hunter2' }, pm);
  const bTok = (await call('POST', '/auth/login', { email: `trgb${s}@x.com`, password: 'hunter2hunter2' })).json.data.accessToken;
  const intro = await call('POST', '/introductions/code', {}, bTok);
  const bUser = (await call('POST', '/introductions/scan', { code: intro.json.data.code }, pm)).json.data.contact.user_id;
  const award = await call('POST', `/projects/${projId}/job-awards`,
    { to_user_id: bUser, role_offered: 'builder', builder_engagement_type: 'independent_fixed' }, pm);
  const acc = await call('POST', `/projects/${projId}/job-awards/${award.json.data.id}/respond`, { accept: true }, bTok);
  ok('the award is accepted, but with the cost plan unlocked (S9.9) no Deposit claim is drafted',
    acc.status === 200 && (await claimsOf(projId)).length === 0, JSON.stringify(acc.json).slice(0, 200));
  const lock = await call('POST', `/projects/${projId}/cost-plan/lock`, { locked: true }, pm);
  let cl = await claimsOf(projId);
  ok('locking the cost plan completes the gate: a Deposit draft by the system (created_by NULL), 5% = 25,000',
    lock.status === 200 && cl.length === 1 && cl[0].milestone === 'deposit' && cl[0].status === 'draft'
      && cl[0].created_by === null && Number(cl[0].amount_ex_gst) === 25000, JSON.stringify([lock.json, cl]));
  await call('POST', `/projects/${projId}/cost-plan/lock`, { locked: false }, pm);
  await call('POST', `/projects/${projId}/cost-plan/lock`, { locked: true }, pm);
  ok('re-locking doesn\'t draft a second Deposit claim', (await claimsOf(projId)).length === 1);
  const list = await call('GET', `/client-claims?project_id=${projId}`, undefined, pm);
  ok('the list shows it as drafted by "System (milestone trigger)"',
    list.json.data?.client_claims?.[0]?.created_by?.name === 'System (milestone trigger)', JSON.stringify(list.json).slice(0, 300));

  // ── 2. Base ──
  const v12 = await call('POST', `/projects/${projId}/stages/${st(12).id}/validate`, { result: 'pass', reference: 'BA-1' }, insp);
  cl = await claimsOf(projId);
  const base = cl.find((c) => c.milestone === 'base');
  ok('validating Stage 12 drafts the Base claim (10% = 50,000)',
    v12.status === 200 && base?.status === 'draft' && Number(base.amount_ex_gst) === 50000, JSON.stringify([v12.json, cl]));

  // ── 3. Catch-up + a 0% milestone ──
  const put = await call('PUT', `/projects/${projId}/payment-schedule`,
    { schedule: sched({ deposit: 5, base: 10, frame: 0, lock_up: 50, fixing: 20, completion: 15 }) }, pm);
  await pool.query("UPDATE project_stages SET status = 'complete' WHERE id = ?", [st(14).id]);
  const v13 = await call('POST', `/projects/${projId}/stages/${st(13).id}/validate`, { result: 'pass', reference: 'FR-1' }, insp);
  cl = await claimsOf(projId);
  ok('Frame at 0%: validating Stage 13 drafts no Frame claim',
    put.status === 200 && v13.status === 200 && !cl.some((c) => c.milestone === 'frame'), JSON.stringify([put.json.code, v13.json, cl]));
  ok('…but the same event catches up Lock-up, whose gate (Stage 14 complete) was already met (50% = 250,000)',
    Number(cl.find((c) => c.milestone === 'lock_up')?.amount_ex_gst) === 250000, JSON.stringify(cl));

  // ── 4. Completion ──
  const [[req]] = await pool.query(
    "SELECT id FROM hold_point_requirements WHERE project_id = ? AND auto_source = 'client_signoff' LIMIT 1", [projId]);
  ok('(setup) the project has its S18.14 sign-off requirement', !!req);
  await pool.query("UPDATE hold_point_requirements SET status = 'satisfied', satisfied_at = NOW() WHERE id = ?", [req.id]);
  const v18 = await call('POST', `/projects/${projId}/stages/${st(18).id}/validate`, { result: 'pass', reference: 'OC-1' }, insp);
  if (v18.status === 409 && v18.json.code === 'NOT_HOLD_POINT') {
    // Stage 18 isn't a hold point on this template: mark it validated and run the trigger directly.
    await pool.query('UPDATE project_stages SET is_validated = 1, validated_at = NOW() WHERE id = ?', [st(18).id]);
    await ClientClaimService.draftReadyClaims(orgId, projId);
  }
  cl = await claimsOf(projId);
  ok('OC (Stage 18 validated) + client sign-off → a Completion draft (15% = 75,000)',
    Number(cl.find((c) => c.milestone === 'completion')?.amount_ex_gst) === 75000, JSON.stringify([v18.json, cl]));
  ok('Fixing (Stage 16 not complete) is still not drafted', !cl.some((c) => c.milestone === 'fixing'));
  const again = await ClientClaimService.draftReadyClaims(orgId, projId);
  ok('running the trigger again drafts nothing (idempotent)', again.length === 0 && (await claimsOf(projId)).length === cl.length);

  // ── 5. No contract value ──
  const p2 = (await call('POST', '/projects', { code: `TR2-${s}`, name: 'No price yet' }, pm)).json.data.id;
  await call('POST', `/projects/${p2}/programme`, { template_id: wa18.id }, pm);
  const s2 = (await call('GET', `/projects/${p2}`, undefined, pm)).json.data.stages.find((x) => x.seq === 12);
  const v2 = await call('POST', `/projects/${p2}/stages/${s2.id}/validate`, { result: 'pass' }, insp);
  ok('with no contract value the validation still succeeds and nothing is drafted',
    v2.status === 200 && (await claimsOf(p2)).length === 0, JSON.stringify(v2.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async (err) => { console.error(err); try { await pool.end(); } catch {} process.exit(1); });
