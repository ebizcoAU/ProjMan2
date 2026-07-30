// Procurement P7b acceptance — purchase orders + supplier invoices
// (xprojman-10 §4 P7b, CORRECTED by xprojman-16; serverdesignspec §7.2 / §7.2.1).
//
// Proves:
//   1. Suppliers master (po.write to add; money.read/po.write to read).
//   2. po.write gates PO/invoice writes; a non-po.write role is refused.
//   3. Roll-ups: an issued PO → project_stages.committed_amount; a matched invoice
//      (2-way match to the PO) → actual_amount. (Verified under a SHARED engagement,
//      where the PM's money.read can see the stage columns.)
//   4. THE CORRECTNESS FIX (§7.2.1): under `independent_fixed`, a Builder-owned PO/invoice
//      row is INVISIBLE to the PM (and vice-versa) — document-level redaction redactStage
//      cannot do; own-scope mutation is enforced.
//   5. `independent_cost_plus` = full disclosure (PM sees the Builder's rows); the
//      subcontractor pass-through-consent gate redacts a counterparty identity (amount kept)
//      until consent is recorded.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/procurement.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const crypto = require('crypto');
const pool = require('../src/db/pool');                       // for the service-level consent check
const ProcurementService = require('../src/services/ProcurementService');

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
  console.log(`Procurement P7b test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Procure ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;
  const orgId = reg.json.data.organisation.id;

  // A real Builder identity (role builder → holds po.write), and a non-money field role.
  await call('POST', '/organisation/users',
    { email: `bob${s}@x.com`, full_name: 'Bob Builder', role: 'builder', password: 'hunter2hunter2' }, pm);
  const builderUser = (await call('POST', '/auth/login', { email: `bob${s}@x.com`, password: 'hunter2hunter2' })).json.data.user.id;
  const builderTok  = (await call('POST', '/auth/login', { email: `bob${s}@x.com`, password: 'hunter2hunter2' })).json.data.accessToken;
  const forepersonTok = await pairAs(pm, pmUser, 'foreperson', `fore-${s}`); // no po.write

  // Introduce PM↔Builder once (cold-stranger constraint for the Job Award).
  const code = await call('POST', '/introductions/code', {}, builderTok);
  await call('POST', '/introductions/scan', { code: code.json.data.code }, pm);

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);

  async function newProject(tag) {
    const proj = await call('POST', '/projects', { code: `${tag}-${s}`, name: `Lot ${tag}` }, pm);
    const projId = proj.json.data.id;
    await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
    const detail = await call('GET', `/projects/${projId}`, undefined, pm);
    const bySeq = (n) => detail.json.data.stages.find((st) => st.seq === n);
    return { projId, bySeq };
  }
  async function awardBuilder(projId, mode) {
    const aw = await call('POST', `/projects/${projId}/job-awards`,
      { to_user_id: builderUser, role_offered: 'builder', builder_engagement_type: mode }, pm);
    await call('POST', `/projects/${projId}/job-awards/${aw.json.data.id}/respond`, { accept: true }, builderTok);
  }

  // ── 1. Suppliers master + po.write gating ──
  const badSup = await call('POST', '/suppliers', { name: 'Rogue' }, forepersonTok);
  ok('a non-po.write role CANNOT add a supplier', badSup.status === 403, JSON.stringify(badSup.json));
  const sup = await call('POST', '/suppliers', { name: 'BuildMart', abn: '51824753556' }, pm);
  ok('PM adds a supplier (po.write)', sup.status === 201 && !!sup.json.data.id, JSON.stringify(sup.json));
  const supplierId = sup.json.data.id;
  const supList = await call('GET', '/suppliers', undefined, pm);
  ok('supplier appears in the org master list', (supList.json.data.suppliers || []).some((x) => x.id === supplierId));

  // ── 2 + 3. Shared engagement (no builder award): roll-ups + 2-way match, PM can read ──
  const A = await newProject('A');
  const s1 = A.bySeq(1).id;
  const badPo = await call('POST', `/projects/${A.projId}/purchase-orders`,
    { stage_id: s1, supplier_id: supplierId, amount: 1000, description: 'Steel' }, forepersonTok);
  ok('a non-po.write role CANNOT raise a PO (po.write)', badPo.status === 403, JSON.stringify(badPo.json));

  const po = await call('POST', `/projects/${A.projId}/purchase-orders`,
    { stage_id: s1, supplier_id: supplierId, amount: 1000, description: 'Steel' }, pm);
  ok('PM raises a PO (issued, owner_party=pm)',
    po.status === 201 && po.json.data.status === 'issued' && po.json.data.owner_party === 'pm', JSON.stringify(po.json));
  const poId = po.json.data.id;

  let detailA = await call('GET', `/projects/${A.projId}`, undefined, pm);
  let committed = Number(detailA.json.data.stages.find((x) => x.seq === 1).committed_amount);
  ok('an issued PO rolls up into stage.committed_amount (=1000)', committed === 1000, `committed=${committed}`);

  const inv = await call('POST', `/projects/${A.projId}/supplier-invoices`,
    { po_id: poId, invoice_number: 'INV-1', amount: 900 }, pm);
  ok('an invoice 2-way-matched to the PO is status=matched', inv.status === 201 && inv.json.data.status === 'matched'
    && inv.json.data.matched === true, JSON.stringify(inv.json));

  detailA = await call('GET', `/projects/${A.projId}`, undefined, pm);
  const actual = Number(detailA.json.data.stages.find((x) => x.seq === 1).actual_amount);
  ok('a matched invoice rolls up into stage.actual_amount (=900)', actual === 900, `actual=${actual}`);

  // No project_payments row was written for the supplier invoice (not a TPAR contractor payment).
  const [[{ n: payCount }]] = await pool.query(
    "SELECT COUNT(*) n FROM project_payments WHERE project_id = ? AND org_id = ?", [A.projId, orgId]);
  ok('a supplier invoice writes NO project_payments row (not a TPAR contractor payment)',
    payCount === 0, `project_payments rows=${payCount}`);

  // ── 4. independent_fixed: the §7.2.1 row-level redaction (the correctness fix) ──
  const B = await newProject('B');
  await awardBuilder(B.projId, 'independent_fixed');
  const b9 = B.bySeq(9).id, b1 = B.bySeq(1).id;

  const builderPo = await call('POST', `/projects/${B.projId}/purchase-orders`,
    { stage_id: b9, supplier_id: supplierId, amount: 2000, description: "Builder's framing" }, builderTok);
  ok('Builder raises a PO (owner_party=builder)',
    builderPo.status === 201 && builderPo.json.data.owner_party === 'builder', JSON.stringify(builderPo.json));
  const builderPoId = builderPo.json.data.id;

  const pmSees = await call('GET', `/projects/${B.projId}/purchase-orders`, undefined, pm);
  ok('independent_fixed: PM CANNOT see the Builder-owned PO (§7.2.1 register redaction)',
    !(pmSees.json.data.purchase_orders || []).some((p) => p.id === builderPoId),
    JSON.stringify((pmSees.json.data.purchase_orders || []).map((p) => p.owner_party)));
  const bSees = await call('GET', `/projects/${B.projId}/purchase-orders`, undefined, builderTok);
  ok('independent_fixed: the Builder DOES see their own PO',
    (bSees.json.data.purchase_orders || []).some((p) => p.id === builderPoId), JSON.stringify(bSees.json));

  const pmPo = await call('POST', `/projects/${B.projId}/purchase-orders`,
    { stage_id: b1, supplier_id: supplierId, amount: 500, description: 'PM supply item' }, pm);
  const pmPoId = pmPo.json.data.id;
  const bSees2 = await call('GET', `/projects/${B.projId}/purchase-orders`, undefined, builderTok);
  ok('independent_fixed: the Builder CANNOT see the PM-owned PO (symmetric)',
    !(bSees2.json.data.purchase_orders || []).some((p) => p.id === pmPoId), JSON.stringify(bSees2.json));
  const pmSees2 = await call('GET', `/projects/${B.projId}/purchase-orders`, undefined, pm);
  ok('independent_fixed: the PM sees their OWN PO (only)',
    (pmSees2.json.data.purchase_orders || []).length === 1 &&
    pmSees2.json.data.purchase_orders[0].id === pmPoId, JSON.stringify(pmSees2.json));

  const crossAct = await call('POST', `/projects/${B.projId}/purchase-orders/${builderPoId}/status`,
    { status: 'received' }, pm);
  ok('own-scope: PM CANNOT change the status of a Builder-owned PO (FORBIDDEN)',
    crossAct.status === 403, JSON.stringify(crossAct.json));

  // ── 5. independent_cost_plus: full disclosure + the consent gate ──
  const C = await newProject('C');
  await awardBuilder(C.projId, 'independent_cost_plus');
  const c9 = C.bySeq(9).id;
  const cPo = await call('POST', `/projects/${C.projId}/purchase-orders`,
    { stage_id: c9, supplier_id: supplierId, amount: 3000 }, builderTok);
  const cPmSees = await call('GET', `/projects/${C.projId}/purchase-orders`, undefined, pm);
  const seenRow = (cPmSees.json.data.purchase_orders || []).find((p) => p.id === cPo.json.data.id);
  ok('cost_plus: PM SEES the Builder-owned PO with its amount (full disclosure)',
    !!seenRow && Number(seenRow.amount) === 3000, JSON.stringify(cPmSees.json));

  // Consent gate at the service layer: a row tied to a non-consented subcontractor hides the
  // counterparty identity for a non-Builder viewer; recording consent reveals it.
  const subId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO subcontractor_engagements (id, org_id, project_id, subcontractor_name, subcontractor_pass_through_consent)
     VALUES (?, ?, ?, 'Acme Rebar', 0)`, [subId, orgId, C.projId]);
  const rowTpl = { owner_party: 'builder', subcontractor_engagement_id: subId,
    supplier_id: supplierId, supplier_name: 'Acme Rebar', amount: 3000 };
  const ctxPM = { mode: 'independent_cost_plus', isTheBuilder: false, viewerParty: 'pm' };

  let vis = await ProcurementService.applyVisibility({ orgId, rows: [{ ...rowTpl }], ctx: ctxPM });
  ok('cost_plus + no consent: counterparty identity redacted, amount kept',
    vis[0].supplier_name === null && vis[0].supplier_id === null && Number(vis[0].amount) === 3000,
    JSON.stringify(vis[0]));

  await pool.query('UPDATE subcontractor_engagements SET subcontractor_pass_through_consent = 1 WHERE id = ?', [subId]);
  vis = await ProcurementService.applyVisibility({ orgId, rows: [{ ...rowTpl }], ctx: ctxPM });
  ok('cost_plus + consent recorded: counterparty identity now visible',
    vis[0].supplier_name === 'Acme Rebar' && !vis[0].counterparty_redacted, JSON.stringify(vis[0]));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
