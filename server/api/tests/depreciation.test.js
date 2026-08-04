// P8a Fixed assets & depreciation acceptance (serverdesignspec §11.2, migration v022).
//
// Proves:
//   1. Asset entry: money.write to declare (a non-money role refused); always lands 'draft'.
//   2. S18.11 prepareDraft: writes the per-FY schedule; prime_cost and diminishing_value both
//      computed; an under-declared asset is SKIPPED, not fatal; re-preparing is idempotent.
//   3. THE GATE (the point of the slice): S18.12 approve is `tax.approve` — the accountant
//      approves, and a PM (who holds money.write but NOT tax.approve) is refused. Reusing the
//      EXISTING v012 permission, no matrix bump.
//   4. Approving stamps approved_by/approved_at and flips draft → approved; double-approve 409s;
//      an asset with no prepared schedule cannot be approved (422).
//   5. List: money.read OR tax.approve; a role with neither is refused; approved assets carry
//      their schedule lines.
//   6. computeSchedule unit maths (no DB): straight line, pro-rata first year, DV never negative.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/depreciation.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const pool = require('../src/db/pool');
const Dep = require('../src/services/DepreciationService');

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

(async () => {
  console.log(`P8a Fixed assets & depreciation test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Depreciation ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `FA-${s}`, name: 'Lot 9 dwelling' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);

  // A foreperson holds neither money.write nor money.read nor tax.approve.
  const foreTok = await pairAs(pm, pmUser, 'foreperson', `fore-${s}`);

  // The accountant is `portal` surface and NOT device-pairable (v012: device_pairable=0), so it
  // is a real user + password login, not a paired device — and `assigned` scope, so they must be
  // a project_members row on the job they review (the v012 compromise).
  const acctEmail = `acct${s}@x.com`;
  const mk = await call('POST', '/organisation/users',
    { email: acctEmail, full_name: 'Ada Accountant', role: 'accountant', password: 'ledger-lines-9' }, pm);
  ok('org_admin can create an `accountant` user (assignable, portal surface)',
    mk.status === 201 || mk.status === 200, JSON.stringify(mk.json));
  const acctUser = mk.json.data?.id || mk.json.data?.user?.id;

  const acctLogin = await call('POST', '/auth/login',
    { email: acctEmail, password: 'ledger-lines-9', device: { device_uid: `acct-${s}`, platform: 'web' } });
  const acct = acctLogin.json.data?.accessToken;
  ok('accountant logs in and holds role `accountant`',
    !!acct && acctLogin.json.data?.user?.role === 'accountant', JSON.stringify(acctLogin.json?.data?.user));

  await call('POST', `/projects/${projId}/members`, { user_id: acctUser }, pm);

  // ── 1. Asset entry (money.write) ──
  const badCreate = await call('POST', `/projects/${projId}/fixed-assets`,
    { description: 'Scaffold tower', acquisition_cost: 12000 }, foreTok);
  ok('a non-money role CANNOT declare a fixed asset (money.write)', badCreate.status === 403, JSON.stringify(badCreate.json));

  const a1 = await call('POST', `/projects/${projId}/fixed-assets`, {
    description: 'Scaffold tower', category: 'plant', acquisition_cost: 12000,
    acquired_at: '2025-07-01', method: 'prime_cost', effective_life_years: 4,
  }, pm);
  ok('PM declares a prime_cost asset — lands `draft`',
    a1.status === 201 && a1.json.data.status === 'draft', JSON.stringify(a1.json));
  const asset1 = a1.json.data.id;

  const a2 = await call('POST', `/projects/${projId}/fixed-assets`, {
    description: 'Site ute', category: 'motor vehicle', acquisition_cost: 40000,
    acquired_at: '2025-10-01', method: 'diminishing_value', effective_life_years: 8,
  }, pm);
  ok('PM declares a diminishing_value asset', a2.status === 201, JSON.stringify(a2.json));
  const asset2 = a2.json.data.id;

  // Under-declared on purpose: no acquired_at, no effective life.
  const a3 = await call('POST', `/projects/${projId}/fixed-assets`,
    { description: 'Unspecified tooling', acquisition_cost: 3000 }, pm);
  ok('an asset may be declared before its ATO inputs are known', a3.status === 201, JSON.stringify(a3.json));
  const asset3 = a3.json.data.id;

  // ── 2. S18.11 prepareDraft ──
  const badPrep = await call('POST', `/projects/${projId}/fixed-assets/prepare-draft`, {}, foreTok);
  ok('a non-money role CANNOT run the S18.11 preparation (money.write)', badPrep.status === 403, JSON.stringify(badPrep.json));

  const prep = await call('POST', `/projects/${projId}/fixed-assets/prepare-draft`, {}, pm);
  ok('S18.11 prepareDraft prepares the two complete assets',
    prep.status === 200 && prep.json.data.prepared_count === 2, JSON.stringify(prep.json));
  ok('the under-declared asset is SKIPPED, not fatal',
    prep.json.data.skipped?.length === 1 && prep.json.data.skipped[0].id === asset3,
    JSON.stringify(prep.json.data.skipped));

  const [l1] = await pool.query(
    'SELECT fy, opening_value, depreciation, closing_value FROM depreciation_schedule WHERE fixed_asset_id = ? ORDER BY fy',
    [asset1]);
  ok('prime_cost 12000 over 4y acquired 1 Jul = 4 FY lines of 3000',
    l1.length === 4 && Number(l1[0].depreciation) === 3000 && Number(l1[3].closing_value) === 0,
    JSON.stringify(l1));
  ok('the first schedule FY is labelled 2025-26',
    l1[0]?.fy === '2025-26', JSON.stringify(l1[0]));

  const [l2] = await pool.query(
    'SELECT fy, depreciation, closing_value FROM depreciation_schedule WHERE fixed_asset_id = ? ORDER BY fy',
    [asset2]);
  ok('diminishing_value schedule is written and never depreciates below zero',
    l2.length > 1 && l2.every((l) => Number(l.closing_value) >= 0), JSON.stringify(l2.slice(0, 3)));
  ok('DV first year is pro-rata (acquired 1 Oct → 273/365 of a full year, < the 10000 full rate)',
    Number(l2[0].depreciation) > 0 && Number(l2[0].depreciation) < 10000, JSON.stringify(l2[0]));

  // Idempotence — preparing twice must not duplicate or drift.
  await call('POST', `/projects/${projId}/fixed-assets/prepare-draft`, {}, pm);
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM depreciation_schedule WHERE fixed_asset_id = ?', [asset1]);
  ok('re-preparing is idempotent (still 4 lines, no duplicates)', n === 4, `got ${n}`);

  // ── 3 + 4. THE GATE: S18.12 tax.approve ──
  const pmApprove = await call('POST', `/projects/${projId}/fixed-assets/${asset1}/approve`, {}, pm);
  ok('THE GATE: a PM CANNOT approve (holds money.write but NOT tax.approve)',
    pmApprove.status === 403 && /tax\.approve/.test(pmApprove.json.message || ''), JSON.stringify(pmApprove.json));

  const foreApprove = await call('POST', `/projects/${projId}/fixed-assets/${asset1}/approve`, {}, foreTok);
  ok('a foreperson CANNOT approve either', foreApprove.status === 403, JSON.stringify(foreApprove.json));

  const acctApprove = await call('POST', `/projects/${projId}/fixed-assets/${asset1}/approve`, {}, acct);
  ok('S18.12: the accountant CAN approve (tax.approve, v012 reused — no matrix bump)',
    acctApprove.status === 200 && acctApprove.json.data.status === 'approved', JSON.stringify(acctApprove.json));

  const [[stamped]] = await pool.query(
    'SELECT status, approved_by, approved_at FROM fixed_assets WHERE id = ?', [asset1]);
  ok('approval stamps status/approved_by/approved_at',
    stamped.status === 'approved' && stamped.approved_by === acctUser && !!stamped.approved_at,
    JSON.stringify(stamped));

  const again = await call('POST', `/projects/${projId}/fixed-assets/${asset1}/approve`, {}, acct);
  ok('double-approve is refused (409)', again.status === 409, JSON.stringify(again.json));

  const noSchedule = await call('POST', `/projects/${projId}/fixed-assets/${asset3}/approve`, {}, acct);
  ok('an asset with no prepared schedule cannot be approved (422)',
    noSchedule.status === 422, JSON.stringify(noSchedule.json));

  // An approved asset is not silently rewritten by a later preparation run.
  const prep3 = await call('POST', `/projects/${projId}/fixed-assets/prepare-draft`, {}, pm);
  ok('a later prepare run skips the APPROVED asset (the S18.12 stamp stays meaningful)',
    prep3.json.data.prepared.every((p) => p.id !== asset1), JSON.stringify(prep3.json.data.prepared));

  // ── 5. List ──
  const badList = await call('GET', `/projects/${projId}/fixed-assets`, undefined, foreTok);
  ok('a role with neither money.read nor tax.approve CANNOT list assets',
    badList.status === 403, JSON.stringify(badList.json));

  const list = await call('GET', `/projects/${projId}/fixed-assets`, undefined, pm);
  const listed = list.json.data?.fixed_assets || [];
  const row1 = listed.find((a) => a.id === asset1);
  ok('money.read lists the register with schedule lines attached',
    list.status === 200 && listed.length === 3 && row1?.depreciation_schedule?.length === 4,
    JSON.stringify(listed.map((a) => [a.description, a.depreciation_schedule?.length])));

  const acctList = await call('GET', `/projects/${projId}/fixed-assets`, undefined, acct);
  ok('the accountant can SEE what they must approve (tax.approve reads the register)',
    acctList.status === 200 && (acctList.json.data?.fixed_assets || []).length === 3,
    JSON.stringify(acctList.json).slice(0, 200));

  const approvedOnly = await call('GET', `/projects/${projId}/fixed-assets?status=approved`, undefined, pm);
  ok('?status=approved filters the register',
    (approvedOnly.json.data?.fixed_assets || []).length === 1, JSON.stringify(approvedOnly.json.data));

  // ── 6. computeSchedule unit maths (no DB) ──
  const straight = Dep.computeSchedule({
    acquisitionCost: 10000, acquiredAt: '2025-07-01', method: 'prime_cost', effectiveLifeYears: 5 });
  ok('unit: prime_cost 10000/5y from 1 Jul = 5 lines of 2000, closing 0',
    straight.length === 5 && straight[0].depreciation === 2000 && straight[4].closing_value === 0,
    JSON.stringify(straight));

  const prorata = Dep.computeSchedule({
    acquisitionCost: 10000, acquiredAt: '2026-01-01', method: 'prime_cost', effectiveLifeYears: 5 });
  ok('unit: a 1 Jan acquisition is pro-rated in its first FY (< a full 2000) and runs a 6th FY',
    prorata[0].depreciation < 2000 && prorata.length === 6, JSON.stringify(prorata.slice(0, 2)));

  const dv = Dep.computeSchedule({
    acquisitionCost: 10000, acquiredAt: '2025-07-01', method: 'diminishing_value', effectiveLifeYears: 5 });
  ok('unit: diminishing_value first year = 10000 × (200%/5) = 4000',
    dv[0].depreciation === 4000, JSON.stringify(dv[0]));
  ok('unit: DV closing values never go negative and decline monotonically',
    dv.every((l) => l.closing_value >= 0) && dv.every((l, i) => i === 0 || l.closing_value <= dv[i - 1].closing_value),
    JSON.stringify(dv.map((l) => l.closing_value)));

  ok('unit: DV terminates at effective life (+1 pro-rata FY), writing off the remainder',
    dv.length === 6 && dv[dv.length - 1].closing_value === 0, JSON.stringify(dv.map((l) => l.depreciation)));
  ok('unit: Σ depreciation === acquisition_cost for BOTH methods (nothing stranded)',
    Math.abs(dv.reduce((t, l) => t + l.depreciation, 0) - 10000) < 0.01 &&
    Math.abs(straight.reduce((t, l) => t + l.depreciation, 0) - 10000) < 0.01,
    `dv=${dv.reduce((t, l) => t + l.depreciation, 0)} pc=${straight.reduce((t, l) => t + l.depreciation, 0)}`);

  ok('unit: an asset with no effective life yields no schedule',
    Dep.computeSchedule({ acquisitionCost: 5000, acquiredAt: '2025-07-01', method: 'prime_cost' }).length === 0);
  ok('unit: FY labelling straddles 30 June correctly',
    Dep.fyLabel(new Date('2025-06-30')) === '2024-25' && Dep.fyLabel(new Date('2025-07-01')) === '2025-26');

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
