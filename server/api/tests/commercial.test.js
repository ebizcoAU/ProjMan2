// Commercial P7a acceptance — Cost Plan (estimate lines) + Progress Claims
// (xprojman-10 §4, servdesignspec §7.2 / §10.6).
//
// Proves:
//   1. Estimate lines: money.write to create; a non-money role is refused; the line
//      rolls up into project_stages.estimated_amount; money.read gates the read.
//   2. Cost-plan lock freezes further edits (COST_PLAN_LOCKED), unlock re-opens.
//   3. Progress claims: Builder submits (claims.submit); PM approves (claims.approve);
//      the §10.6 freeze blocks a claim against an unvalidated hold-point stage
//      (CLAIM_BLOCKED); separation of duties (PM can't submit, Builder can't approve);
//      approve rolls up claimed_amount; pay records a payment and is idempotent.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/commercial.test.js
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
  console.log(`Commercial P7a test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Commercial ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `C-${s}`, name: 'Lot 5 dwelling' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const bySeq = (n) => detail.json.data.stages.find((st) => st.seq === n);
  const stage1 = bySeq(1).id, stage11 = bySeq(11).id;

  const forepersonTok = await pairAs(pm, pmUser, 'foreperson', `fore-${s}`); // no money.write, no claims
  const builderTok = await pairAs(pm, pmUser, 'builder', `bld-${s}`);        // claims.submit

  // ── 1. Estimate lines ──
  const badLine = await call('POST', `/projects/${projId}/estimate-lines`,
    { stage_id: stage1, description: 'Slab concrete', quantity: 10, unit: 'm3', rate: 250 }, forepersonTok);
  ok('a non-money role CANNOT add an estimate line (money.write)',
    badLine.status === 403, JSON.stringify(badLine.json));

  const line = await call('POST', `/projects/${projId}/estimate-lines`,
    { stage_id: stage1, description: 'Slab concrete', quantity: 10, unit: 'm3', rate: 250 }, pm);
  ok('PM adds an estimate line (money.write), amount = qty*rate',
    line.status === 201 && Number(line.json.data.amount) === 2500, JSON.stringify(line.json));

  await call('POST', `/projects/${projId}/estimate-lines`,
    { stage_id: stage1, description: 'Pump hire', quantity: 1, unit: 'day', rate: 800 }, pm);

  const afterEst = await call('GET', `/projects/${projId}`, undefined, pm);
  const est1 = Number(afterEst.json.data.stages.find((x) => x.seq === 1).estimated_amount);
  ok('estimate lines roll up into stage.estimated_amount (2500+800=3300)', est1 === 3300, `estimated_amount=${est1}`);

  const planRead = await call('GET', `/projects/${projId}/cost-plan`, undefined, pm);
  ok('cost-plan read returns lines + total', planRead.status === 200 && Number(planRead.json.data.total) === 3300,
    JSON.stringify(planRead.json));
  const planReadNoMoney = await call('GET', `/projects/${projId}/cost-plan`, undefined, forepersonTok);
  ok('a non-money role CANNOT read the cost plan (money.read)', planReadNoMoney.status === 403,
    JSON.stringify(planReadNoMoney.json));

  // ── 2. Lock / unlock ──
  await call('POST', `/projects/${projId}/cost-plan/lock`, { locked: true }, pm);
  const lockedAdd = await call('POST', `/projects/${projId}/estimate-lines`,
    { stage_id: stage1, description: 'Extra', rate: 100 }, pm);
  ok('a locked cost plan refuses new lines (COST_PLAN_LOCKED)',
    lockedAdd.status === 409 && lockedAdd.json.code === 'COST_PLAN_LOCKED', JSON.stringify(lockedAdd.json));
  await call('POST', `/projects/${projId}/cost-plan/lock`, { locked: false }, pm);
  const unlockedAdd = await call('POST', `/projects/${projId}/estimate-lines`,
    { stage_id: stage1, description: 'Extra', rate: 100 }, pm);
  ok('unlock re-opens editing', unlockedAdd.status === 201, JSON.stringify(unlockedAdd.json));

  // ── 3. Progress claims ──
  const pmSubmit = await call('POST', `/projects/${projId}/progress-claims`, { stage_id: stage1, amount: 1000 }, pm);
  ok('PM CANNOT submit a claim (no claims.submit)', pmSubmit.status === 403, JSON.stringify(pmSubmit.json));

  const blocked = await call('POST', `/projects/${projId}/progress-claims`, { stage_id: stage11, amount: 5000 }, builderTok);
  ok('claim against an unvalidated hold-point stage is frozen (CLAIM_BLOCKED)',
    blocked.status === 409 && blocked.json.code === 'CLAIM_BLOCKED', JSON.stringify(blocked.json));

  const submit = await call('POST', `/projects/${projId}/progress-claims`, { stage_id: stage1, amount: 1500, note: 'Slab done' }, builderTok);
  ok('Builder submits a claim on a non-frozen stage (claims.submit)',
    submit.status === 201 && submit.json.data.status === 'submitted', JSON.stringify(submit.json));
  const claimId = submit.json.data.id;

  const builderApprove = await call('POST', `/projects/${projId}/progress-claims/${claimId}/approve`, {}, builderTok);
  ok('Builder CANNOT approve (no claims.approve)', builderApprove.status === 403, JSON.stringify(builderApprove.json));

  const approve = await call('POST', `/projects/${projId}/progress-claims/${claimId}/approve`, { accept: true }, pm);
  ok('PM approves the claim (claims.approve)', approve.status === 200 && approve.json.data.status === 'approved',
    JSON.stringify(approve.json));

  const afterClaim = await call('GET', `/projects/${projId}`, undefined, pm);
  const claimed1 = Number(afterClaim.json.data.stages.find((x) => x.seq === 1).claimed_amount);
  ok('approved claim rolls up into stage.claimed_amount (1500)', claimed1 === 1500, `claimed_amount=${claimed1}`);

  const pay1 = await call('POST', `/projects/${projId}/progress-claims/${claimId}/pay`, { reference: 'EFT-1' }, pm);
  ok('PM pays the approved claim → payment recorded', pay1.status === 201 && !!pay1.json.data.payment_id,
    JSON.stringify(pay1.json));
  const pay2 = await call('POST', `/projects/${projId}/progress-claims/${claimId}/pay`, {}, pm);
  ok('paying twice is refused (ALREADY_PAID)', pay2.status === 409 && pay2.json.code === 'ALREADY_PAID',
    JSON.stringify(pay2.json));

  const pmList = await call('GET', `/projects/${projId}/progress-claims`, undefined, pm);
  ok('PM (money.read) sees all claims', pmList.status === 200 && (pmList.json.data.claims || []).length >= 1,
    JSON.stringify(pmList.json));
  const builderList = await call('GET', `/projects/${projId}/progress-claims`, undefined, builderTok);
  ok('Builder sees own claims', builderList.status === 200 && (builderList.json.data.claims || []).every((c) => String(c.submitted_by) === String(pmUser)),
    JSON.stringify(builderList.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
