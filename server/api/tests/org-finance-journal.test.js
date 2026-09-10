// Per-tenant journal + auto-posting (xprojman-42 §3, migration v044, AUTO
// posting confirmed).
//
// Proves:
//   1. Paying a progress claim auto-posts debit Subcontractor Labour (5020) /
//      credit Cash & Bank (1000) — real cash out.
//   2. A supplier invoice created already-matched (via po_id) auto-posts
//      against the task's cost-centre-linked account, not the fallback.
//   3. A supplier invoice with no task/cost-centre link falls back to
//      Materials Cost (5100) when it reaches 'approved' via setInvoiceStatus.
//   4. Idempotency: re-setting the SAME status does not double-post.
//   5. A purchase_order status change alone (issued/received) posts NOTHING —
//      only the invoice reaching matched/approved is a real cost event.
//   6. GET /finance/reports/pnl reflects both expense postings; /balance-sheet
//      shows Accounts Payable grown and Cash & Bank reduced; /reports/expenses
//      lists both transactions; /reports/sales is empty (no revenue path yet).
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/org-finance-journal.test.js
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findLeaf(nodes, name) {
  for (const n of nodes) {
    if (n.name === name) return n;
    const found = findLeaf(n.children, name);
    if (found) return found;
  }
  return null;
}

(async () => {
  console.log(`Org finance journal test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Journal ${s}` },
    user: { full_name: 'Pat PM', email: `journal${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;
  const builderTok = await pairAs(pm, pmUser, 'builder', `bld-${s}`);

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `JR-${s}`, name: 'Journal test' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const stage1 = detail.json.data.stages.find((st) => st.seq === 1);

  // Baseline P&L (a plain GET seeds the org's chart of accounts).
  const before = await call('GET', '/finance/reports/pnl', undefined, pm);
  const siteBefore = findLeaf(before.json.data.tree, 'Site Cost')?.total || 0;
  const materialsBefore = findLeaf(before.json.data.tree, 'Materials Cost')?.total || 0;
  const subLabourBefore = findLeaf(before.json.data.tree, 'Subcontractor Labour')?.total || 0;

  // ── 1. Progress claim payment → debit Subcontractor Labour / credit Cash & Bank ──
  const submit = await call('POST', `/projects/${projId}/progress-claims`, { stage_id: stage1.id, amount: 1200 }, builderTok);
  const claimId = submit.json.data.id;
  await call('POST', `/projects/${projId}/progress-claims/${claimId}/approve`, { accept: true }, pm);
  const pay = await call('POST', `/projects/${projId}/progress-claims/${claimId}/pay`, {}, pm);
  ok('claim paid', pay.status === 201, JSON.stringify(pay.json));
  await sleep(300); // fire-and-forget posting

  const afterClaim = await call('GET', '/finance/reports/pnl', undefined, pm);
  const subLabourAfter = findLeaf(afterClaim.json.data.tree, 'Subcontractor Labour')?.total || 0;
  ok('Subcontractor Labour grew by the claim amount', Math.abs((subLabourAfter - subLabourBefore) - 1200) < 0.01, `before=${subLabourBefore} after=${subLabourAfter}`);

  const bsAfterClaim = await call('GET', '/finance/reports/balance-sheet', undefined, pm);
  const cashAfterClaim = findLeaf(bsAfterClaim.json.data.tree, 'Cash & Bank')?.total || 0;
  ok('Cash & Bank reduced by the same amount (real cash out)', Math.abs(cashAfterClaim - -1200) < 0.01, `cash=${cashAfterClaim}`);

  // ── 2. Supplier invoice via po_id (matched at creation) → cost-centre-linked account ──
  const cc = await call('POST', '/cost-centres', { code: `SITE-${s}`, name: 'Site costs' }, pm);
  const accs = await call('GET', '/finance/accounts', undefined, pm);
  function flatten(nodes, out = []) { for (const n of nodes) { out.push(n); flatten(n.children, out); } return out; }
  const siteAccount = flatten(accs.json.data.accounts).find((a) => a.name === 'Site Cost');
  await call('PATCH', `/cost-centres/${cc.json.data.id}/account`, { account_id: siteAccount.id }, pm);

  const task = await call('POST', `/projects/${projId}/tasks`, { stage_id: stage1.id, name: 'Site fencing' }, pm);
  const taskId = task.json.data.id;
  await call('PATCH', `/projects/${projId}/tasks/${taskId}`, { cost_centre_id: cc.json.data.id, is_outsourced: true }, pm);

  const po = await call('POST', `/projects/${projId}/purchase-orders`, { task_id: taskId, supplier_name: 'Acme Fencing', amount: 3000 }, pm);
  ok('PO raised', po.status === 201, JSON.stringify(po.json));
  const invMatched = await call('POST', `/projects/${projId}/supplier-invoices`, { po_id: po.json.data.id, invoice_number: `INV-${s}-A`, amount: 3000 }, pm);
  ok('supplier invoice created already-matched via po_id', invMatched.status === 201 && invMatched.json.data.status === 'matched', JSON.stringify(invMatched.json));
  await sleep(300);

  const afterInv1 = await call('GET', '/finance/reports/pnl', undefined, pm);
  const siteAfter1 = findLeaf(afterInv1.json.data.tree, 'Site Cost')?.total || 0;
  ok('Site Cost (cost-centre-linked account) grew by the matched invoice amount', Math.abs((siteAfter1 - siteBefore) - 3000) < 0.01, `before=${siteBefore} after=${siteAfter1}`);

  // ── 3. Supplier invoice with no task/cost-centre link → fallback Materials Cost ──
  const invPlain = await call('POST', `/projects/${projId}/supplier-invoices`, { invoice_number: `INV-${s}-B`, amount: 750 }, pm);
  ok('plain invoice created received (no po_id)', invPlain.status === 201 && invPlain.json.data.status === 'received', JSON.stringify(invPlain.json));
  const approvePlain = await call('POST', `/projects/${projId}/supplier-invoices/${invPlain.json.data.id}/status`, { status: 'approved' }, pm);
  ok('invoice transitioned to approved via setInvoiceStatus', approvePlain.status === 200, JSON.stringify(approvePlain.json));
  await sleep(300);

  const afterInv2 = await call('GET', '/finance/reports/pnl', undefined, pm);
  const materialsAfter = findLeaf(afterInv2.json.data.tree, 'Materials Cost')?.total || 0;
  ok('Materials Cost (fallback account, no cost-centre link) grew by the approved invoice amount',
    Math.abs((materialsAfter - materialsBefore) - 750) < 0.01, `before=${materialsBefore} after=${materialsAfter}`);

  // ── 4. Idempotency: re-approving does NOT double-post ──
  const reApprove = await call('POST', `/projects/${projId}/supplier-invoices/${invPlain.json.data.id}/status`, { status: 'approved' }, pm);
  ok('re-setting the same status succeeds (not an error)', reApprove.status === 200);
  await sleep(300);
  const afterReapprove = await call('GET', '/finance/reports/pnl', undefined, pm);
  const materialsAfterReapprove = findLeaf(afterReapprove.json.data.tree, 'Materials Cost')?.total || 0;
  ok('Materials Cost did NOT grow again — postEntry is idempotent on (org_id, ref_type, ref_id)',
    Math.abs(materialsAfterReapprove - materialsAfter) < 0.01, `after=${materialsAfter} afterReapprove=${materialsAfterReapprove}`);

  // ── 5. A PO status change alone posts nothing ──
  const task2 = await call('POST', `/projects/${projId}/tasks`, { stage_id: stage1.id, name: 'Formwork' }, pm);
  const po2 = await call('POST', `/projects/${projId}/purchase-orders`, { task_id: task2.json.data.id, supplier_name: 'BuildCo', amount: 2000 }, pm);
  await call('POST', `/projects/${projId}/purchase-orders/${po2.json.data.id}/status`, { status: 'received' }, pm);
  await sleep(300);
  const afterPoReceived = await call('GET', '/finance/reports/pnl', undefined, pm);
  const materialsAfterPo = findLeaf(afterPoReceived.json.data.tree, 'Materials Cost')?.total || 0;
  ok('a PO status change (issued -> received) posts NOTHING to the journal — only the invoice does',
    Math.abs(materialsAfterPo - materialsAfterReapprove) < 0.01, `${materialsAfterPo} vs ${materialsAfterReapprove}`);

  // ── 6. Reports round-out ──
  const bsFinal = await call('GET', '/finance/reports/balance-sheet', undefined, pm);
  ok('balance sheet balances (assets = liabilities + equity)', bsFinal.json.data.balanced === true, JSON.stringify(bsFinal.json.data.totals));
  const apFinal = findLeaf(bsFinal.json.data.tree, 'Accounts Payable')?.total || 0;
  ok('Accounts Payable grew by both posted invoices (3000 + 750)', apFinal >= 3750 - 0.01, `ap=${apFinal}`);

  const expensesReport = await call('GET', '/finance/reports/expenses', undefined, pm);
  ok('expenses report lists both invoice postings', expensesReport.json.data.entries.filter((e) => e.ref_type === 'supplier_invoice').length >= 2, JSON.stringify(expensesReport.json.data.entries.length));

  const salesReport = await call('GET', '/finance/reports/sales', undefined, pm);
  ok('sales report is empty — no revenue write path exists yet, an honest gap not a bug', salesReport.status === 200 && salesReport.json.data.entries.length === 0, JSON.stringify(salesReport.json.data));

  const tradieTok = await pairAs(pm, pmUser, 'tradie', `tr-${s}`);
  const tradiePnl = await call('GET', '/finance/reports/pnl', undefined, tradieTok);
  ok('a tradie (no money.read) cannot read the P&L (403)', tradiePnl.status === 403, JSON.stringify(tradiePnl.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
