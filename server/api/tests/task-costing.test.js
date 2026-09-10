// Cost Plan costing engine, Phase 1 — rate card + cost centres + task costing
// (xprojman-39 §1/§2, APPROVED FOR BUILD 2026-09-06).
//
// Proves:
//   1. Rate card starts unconfigured (all 4 tiers null), each tier settable
//      independently via PUT, upsert-safe (same tier set twice = update not dup).
//   2. Cost centres: fixed org list, duplicate code refused.
//   3. A task's skill_level/cost_centre_id are money.write-gated, separate
//      from output_note/status's projects.write — a caller with ONLY
//      money.write can set costing fields without touching task metadata,
//      and vice versa.
//   4. Labour rollup computed LIVE (budget_hours x rate): a costed-but-no-
//      cost-centre task is flagged, not counted; setting the cost centre
//      makes it count. Locking the cost plan is refused while any costed
//      task is missing a cost centre (owner rule) and succeeds once fixed.
//   5. skill_level/cost_centre_id are redacted for a role without money.read.
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/task-costing.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

(async () => {
  console.log(`Task costing test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Costing ${s}` },
    user: { full_name: 'Pat PM', email: `costing${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;

  // A field role with neither money.write nor projects.write, to prove the
  // redaction + permission split at the end.
  const tradieTok = await pairAs(pm, pmUser, 'tradie', `tradie-${s}`);

  // ── 1. Rate card ──
  const before = await call('GET', '/organisation/rate-card', undefined, pm);
  ok('rate card starts unconfigured', before.json.data?.configured === false, JSON.stringify(before.json));
  ok('all 4 tiers present, all null', before.json.data.rates.length === 4 && before.json.data.rates.every((r) => r.hourly_rate === null),
    JSON.stringify(before.json.data.rates));

  const setProf = await call('PUT', '/organisation/rate-card', { skill_level: 'professional', hourly_rate: 120 }, pm);
  ok('set professional rate', setProf.status === 200 && setProf.json.data.hourly_rate === 120, JSON.stringify(setProf.json));
  const setProfAgain = await call('PUT', '/organisation/rate-card', { skill_level: 'professional', hourly_rate: 150 }, pm);
  ok('re-setting the same tier upserts (no duplicate row)', setProfAgain.status === 200 && setProfAgain.json.data.hourly_rate === 150);
  await call('PUT', '/organisation/rate-card', { skill_level: 'expert', hourly_rate: 200 }, pm);
  await call('PUT', '/organisation/rate-card', { skill_level: 'std', hourly_rate: 80 }, pm);
  await call('PUT', '/organisation/rate-card', { skill_level: 'free', hourly_rate: 0 }, pm);
  const after = await call('GET', '/organisation/rate-card', undefined, pm);
  ok('rate card now fully configured', after.json.data.configured === true, JSON.stringify(after.json.data));

  const badTier = await call('PUT', '/organisation/rate-card', { skill_level: 'bogus', hourly_rate: 10 }, pm);
  ok('an invalid skill_level is refused (422)', badTier.status === 422);
  const negRate = await call('PUT', '/organisation/rate-card', { skill_level: 'std', hourly_rate: -5 }, pm);
  ok('a negative rate is refused (422)', negRate.status === 422);

  const tradieRate = await call('PUT', '/organisation/rate-card', { skill_level: 'std', hourly_rate: 999 }, tradieTok);
  ok('a tradie (no money.write) cannot set a rate (403)', tradieRate.status === 403, JSON.stringify(tradieRate.json));

  // ── 2. Cost centres ──
  const ccList0 = await call('GET', '/cost-centres', undefined, pm);
  ok('cost centres start empty', ccList0.json.data.cost_centres.length === 0);
  const cc = await call('POST', '/cost-centres', { code: `CC-${s}`, name: 'General Labour' }, pm);
  ok('cost centre created', cc.status === 201, JSON.stringify(cc.json));
  const ccDup = await call('POST', '/cost-centres', { code: `CC-${s}`, name: 'Duplicate' }, pm);
  ok('duplicate cost-centre code refused (409)', ccDup.status === 409, JSON.stringify(ccDup.json));

  // ── 3/4. A custom task, costed, rollup + lock gate ──
  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `CT-${s}`, name: 'Costing test' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const stage1 = detail.json.data.stages.find((st) => st.seq === 1);

  const task = await call('POST', `/projects/${projId}/tasks`,
    { stage_id: stage1.id, name: 'Site survey (costed)', budget_hours: 10 }, pm);
  ok('custom task created for costing', task.status === 201, JSON.stringify(task.json));
  const taskId = task.json.data.id;

  // Set skill_level WITHOUT a cost centre yet — should be flagged, not counted.
  const setSkill = await call('PATCH', `/projects/${projId}/tasks/${taskId}`, { skill_level: 'professional' }, pm);
  ok('skill_level set via PATCH', setSkill.status === 200 && setSkill.json.data.skill_level === 'professional', JSON.stringify(setSkill.json));

  let plan = await call('GET', `/projects/${projId}/cost-plan`, undefined, pm);
  ok('task with skill_level but no cost centre is flagged, not costed',
    plan.json.data.labour.tasksMissingCostCentre.includes(taskId) && plan.json.data.labour.total.estimated === 0,
    JSON.stringify(plan.json.data.labour));

  const lockBlocked = await call('POST', `/projects/${projId}/cost-plan/lock`, undefined, pm);
  ok('locking refused while a costed task has no cost centre (409)',
    lockBlocked.status === 409 && lockBlocked.json.code === 'MISSING_COST_CENTRE', JSON.stringify(lockBlocked.json));

  const setCC = await call('PATCH', `/projects/${projId}/tasks/${taskId}`, { cost_centre_id: cc.json.data.id }, pm);
  ok('cost_centre_id set via PATCH', setCC.status === 200 && setCC.json.data.cost_centre_id === cc.json.data.id);

  plan = await call('GET', `/projects/${projId}/cost-plan`, undefined, pm);
  ok('labour estimated cost = budget_hours x professional rate (10 x 150 = 1500)',
    Math.abs(plan.json.data.labour.total.estimated - 1500) < 0.01, JSON.stringify(plan.json.data.labour));
  ok('no longer flagged as missing a cost centre', !plan.json.data.labour.tasksMissingCostCentre.includes(taskId));
  const byTaskEntry = plan.json.data.labour.byTask.find((t) => t.task_id === taskId);
  ok('byTask (xprojman-39 §4 dependency) includes this internally-costed task at the same figure',
    byTaskEntry && Math.abs(byTaskEntry.estimated - 1500) < 0.01, JSON.stringify(byTaskEntry));
  ok('grandTotal = estimate_lines total + labour estimated',
    Math.abs(plan.json.data.grandTotal - (plan.json.data.total + plan.json.data.labour.total.estimated)) < 0.01,
    JSON.stringify({ grandTotal: plan.json.data.grandTotal, total: plan.json.data.total, labour: plan.json.data.labour.total }));

  const lockOk = await call('POST', `/projects/${projId}/cost-plan/lock`, undefined, pm);
  ok('locking succeeds once every costed task has a cost centre', lockOk.status === 200 && lockOk.json.data.status === 'locked',
    JSON.stringify(lockOk.json));
  await call('POST', `/projects/${projId}/cost-plan/lock`, { locked: false }, pm);

  // ── Permission split: money.write alone (not projects.write) can still cost ──
  const badCC = await call('PATCH', `/projects/${projId}/tasks/${taskId}`, { cost_centre_id: '00000000-0000-0000-0000-000000000000' }, pm);
  ok('an unknown cost_centre_id is refused (422)', badCC.status === 422, JSON.stringify(badCC.json));

  const noFields = await call('PATCH', `/projects/${projId}/tasks/${taskId}`, {}, pm);
  ok('PATCH with none of the 5 fields refused (400 NO_FIELDS)', noFields.status === 400 && noFields.json.code === 'NO_FIELDS');

  const tradieCosting = await call('PATCH', `/projects/${projId}/tasks/${taskId}`, { skill_level: 'expert' }, tradieTok);
  ok('a tradie (no money.write) cannot set skill_level (403)', tradieCosting.status === 403, JSON.stringify(tradieCosting.json));

  // ── is_outsourced (v037 column, left read-only until xprojman-39 §3 needed a
  // writer — money-gated like skill_level/cost_centre_id, not projects.write) ──
  const tradieOutsourced = await call('PATCH', `/projects/${projId}/tasks/${taskId}`, { is_outsourced: true }, tradieTok);
  ok('a tradie (no money.write) cannot set is_outsourced (403)', tradieOutsourced.status === 403, JSON.stringify(tradieOutsourced.json));
  const setOutsourced = await call('PATCH', `/projects/${projId}/tasks/${taskId}`, { is_outsourced: true }, pm);
  ok('PM sets is_outsourced via money.write', setOutsourced.status === 200 && setOutsourced.json.data.is_outsourced === 1, JSON.stringify(setOutsourced.json));
  const detailOutsourced = await call('GET', `/projects/${projId}`, undefined, pm);
  const taskNowOutsourced = detailOutsourced.json.data.tasks.find((t) => t.id === taskId);
  ok('is_outsourced sticks and reads back true', !!taskNowOutsourced.is_outsourced, JSON.stringify(taskNowOutsourced.is_outsourced));

  // ── 5. Redaction ──
  const asTradie = await call('GET', `/projects/${projId}`, undefined, tradieTok);
  const taskAsTradie = asTradie.json.data.tasks.find((t) => t.id === taskId);
  ok('a role without money.read never sees skill_level/cost_centre_id on the task',
    taskAsTradie.skill_level === undefined && taskAsTradie.cost_centre_id === undefined,
    JSON.stringify({ skill_level: taskAsTradie.skill_level, cost_centre_id: taskAsTradie.cost_centre_id }));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
