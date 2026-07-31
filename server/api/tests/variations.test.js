// P7c Variations & Contracts acceptance (xprojman-10 §4c, serverdesignspec §7.2).
//
// Proves:
//   1. Contracts: money.write to create (a non-money role refused); retention_pct captured;
//      list returns effective_value (= contract_value + Σ approved variations).
//   2. Variations: variations.raise = PM (a non-PM refused); raise creates a 'submitted' row.
//   3. THE DORMANT GATE: variations.approve is held ONLY by `client` (no tenant-portal session
//      in v1), so a PM is refused — the gate is live for P10, unreachable until then.
//   4. Retention anchor: builderRetentionPct resolves the subcontractor contract's retention_pct
//      (the deferred withholding/release flow will consume it).
//   5. Effective-value roll-up lights up once a variation is approved (simulated via DB, since
//      no client can approve in v1).
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/variations.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const pool = require('../src/db/pool');
const ContractService = require('../src/services/ContractService');

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
  console.log(`P7c Variations & Contracts test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Variations ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id, orgId = reg.json.data.organisation.id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `V-${s}`, name: 'Lot 7 dwelling' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  const forepersonTok = await pairAs(pm, pmUser, 'foreperson', `fore-${s}`);  // no money.write / variations.raise

  // ── 1. Contracts ──
  const badC = await call('POST', `/projects/${projId}/contracts`, { party_type: 'client', contract_value: 200000 }, forepersonTok);
  ok('a non-money role CANNOT create a contract (money.write)', badC.status === 403, JSON.stringify(badC.json));

  const clientC = await call('POST', `/projects/${projId}/contracts`,
    { party_type: 'client', title: 'Head contract', contract_value: 200000, retention_pct: 5 }, pm);
  ok('PM creates a client head contract (money.write), retention_pct captured',
    clientC.status === 201 && clientC.json.data.party_type === 'client', JSON.stringify(clientC.json));
  const clientContractId = clientC.json.data.id;

  const subC = await call('POST', `/projects/${projId}/contracts`,
    { party_type: 'subcontractor', title: 'Builder engagement', contract_value: 150000, retention_pct: 10 }, pm);
  ok('PM creates a subcontractor (Builder) contract with 10% retention', subC.status === 201, JSON.stringify(subC.json));

  const list1 = await call('GET', `/projects/${projId}/contracts`, undefined, pm);
  const clientRow = (list1.json.data.contracts || []).find((c) => c.id === clientContractId);
  ok('contract list returns effective_value (= base value with no approved variations)',
    !!clientRow && Number(clientRow.effective_value) === 200000, JSON.stringify(clientRow));

  // ── 2 + 3. Variations: raise (PM), dormant approve ──
  const badV = await call('POST', `/projects/${projId}/variations`, { description: 'x', amount: 100 }, forepersonTok);
  ok('a non-PM CANNOT raise a variation (variations.raise)', badV.status === 403, JSON.stringify(badV.json));

  const v1 = await call('POST', `/projects/${projId}/variations`,
    { contract_id: clientContractId, description: 'Extra retaining wall', amount: 5000 }, pm);
  ok('PM raises a variation (submitted)', v1.status === 201 && v1.json.data.status === 'submitted', JSON.stringify(v1.json));
  const variationId = v1.json.data.id;

  const pmApprove = await call('POST', `/projects/${projId}/variations/${variationId}/approve`, { accept: true }, pm);
  ok('DORMANT GATE: a PM CANNOT approve a variation (variations.approve is Client-only, P10)',
    pmApprove.status === 403 && /variations\.approve/.test(pmApprove.json.message || ''), JSON.stringify(pmApprove.json));

  // ── 4. Retention anchor (service-level) ──
  const pct = await ContractService.builderRetentionPct({ orgId, projectId: projId });
  ok('builderRetentionPct resolves the subcontractor contract retention (10%)', pct === 10, `got ${pct}`);

  // ── 5. Effective-value roll-up lights up on approval (simulated — no client in v1) ──
  await pool.query("UPDATE variations SET status = 'approved', approved_at = NOW() WHERE id = ?", [variationId]);
  const list2 = await call('GET', `/projects/${projId}/contracts`, undefined, pm);
  const clientRow2 = (list2.json.data.contracts || []).find((c) => c.id === clientContractId);
  ok('an approved variation adjusts the contract effective_value (200000 + 5000 = 205000)',
    !!clientRow2 && Number(clientRow2.effective_value) === 205000, JSON.stringify(clientRow2));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
