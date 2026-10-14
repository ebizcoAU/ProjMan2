// Accounting export (xprojman-43 R4, migration v055).
//
//   1. Settings: defaults + formats, PUT validation (directions/keys), money.write gate; cost-centre code.
//   2. Preview: the four kinds, account codes (cost centre → org default → unmapped), gst_code per
//      direction, rcti/sop/retention columns, accounts.read gate (accountant yes, tradie no),
//      bad kind/format, Xero has no POs (EXPORT_KIND_UNSUPPORTED), nothing marked.
//   3. CSV: header, formula-safe cells, marks rows + records the run (sha256 matches),
//      only_new skips them next time, only_new=0 repeats with EXPORT_INCLUDES_EXPORTED.
//   4. Sales void after export → one credit row; Xero preset (unverified warning, DD/MM/YYYY,
//      tracking only when the category is set). History lists the runs.
//
// Run: DB_NAME=c1projman2_e2e DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &
//      DB_NAME=c1projman2_e2e BASE=http://localhost:4199 node tests/accounting-export.test.js
const crypto = require('crypto');
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
async function csv(path, token) {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, text: await res.text(), headers: res.headers };
}
async function pairAs(admin, userId, role, uid) {
  const init = await call('POST', '/pairing/initiate', { role, label: uid, assign_user_id: userId }, admin);
  const rid = init.json.data.request_id, nonce = init.json.data.qr_payload.nonce;
  await call('POST', '/pairing/request', { request_id: rid, nonce, device_uid: uid, platform: 'android' });
  await call('POST', '/pairing/confirm', { request_id: rid, role }, admin);
  const st = await call('GET', `/pairing/status/${rid}?device_uid=${uid}`);
  return st.json.data?.accessToken;
}
const codes = (r) => (r.json.warnings || []).map((w) => w.code);
// Splits our fully-quoted CSV.
const parse = (text) => text.trim().split('\r\n').map((l) => l.slice(1, -1).split('","').map((c) => c.replace(/""/g, '"')));

(async () => {
  console.log(`Accounting export test → ${BASE}\n`);
  const s = Date.now();
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Export ${s}` },
    user: { full_name: 'Pat PM', email: `xpm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `xpm-${s}`, platform: 'web' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id;
  const [[me]] = await pool.query('SELECT org_id FROM users WHERE id = ?', [pmUser]);
  const orgId = me.org_id;
  await pool.query("UPDATE organisations SET state = 'WA', gst_registered = 1 WHERE id = ?", [orgId]);
  const builder = await pairAs(pm, pmUser, 'builder', `xb-${s}`);
  // A separate, non-owner user: every paired token above is the org owner, and owners hold accounts.read.
  await call('POST', '/organisation/users',
    { email: `xtr${s}@x.com`, full_name: 'Tess Tradie', role: 'tradie', password: 'hammer-time-9' }, pm);
  const tradie = (await call('POST', '/auth/login',
    { email: `xtr${s}@x.com`, password: 'hammer-time-9', device: { device_uid: `xt-${s}`, platform: 'web' } })).json.data?.accessToken;
  // The accountant is a web role (not device-pairable): created as an org user, then logged in.
  await call('POST', '/organisation/users',
    { email: `xacct${s}@x.com`, full_name: 'Ada Accountant', role: 'accountant', password: 'ledger-lines-9' }, pm);
  const accountant = (await call('POST', '/auth/login',
    { email: `xacct${s}@x.com`, password: 'ledger-lines-9', device: { device_uid: `xa-${s}`, platform: 'web' } })).json.data?.accessToken;

  const cust = (await call('POST', '/customers', { name: '=Smith Family', abn: '51824753556', email: 'smith@example.com' }, pm)).json.data;
  const projId = (await call('POST', '/projects', { code: `EX-${s}`, name: 'Lot 9 dwelling', contract_value: 400000, customer_id: cust.id }, pm)).json.data.id;
  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  const [[task]] = await pool.query('SELECT id, stage_id FROM tasks WHERE project_id = ? LIMIT 1', [projId]);

  // Money records: one of each kind.
  const dep = (await call('POST', `/projects/${projId}/client-claims`, { milestone: 'deposit' }, pm)).json.data.client_claim;
  await call('POST', `/client-claims/${dep.id}/issue`, undefined, pm);
  const pc = (await call('POST', `/projects/${projId}/progress-claims`, { amount: 10000, work_description: 'Slab' }, builder)).json.data;
  await call('POST', `/projects/${projId}/progress-claims/${pc.id}/approve`, { accept: true }, pm);
  await call('POST', `/rcti-agreements`, { party_user_id: pmUser, agreed_at: '2026-10-01' }, pm);
  await call('POST', `/projects/${projId}/progress-claims/${pc.id}/rcti`, { issued: true }, pm);
  await call('POST', `/projects/${projId}/progress-claims/${pc.id}/pay`, { reference: 'EFT-9' }, pm);
  const sup = (await call('POST', '/suppliers', { name: `Bricks ${s}`, abn: '33102417032' }, pm)).json.data;
  const cc = (await call('POST', '/cost-centres', { code: `BR${String(s).slice(-6)}`, name: 'Brickwork' }, pm)).json.data;
  await pool.query('UPDATE tasks SET cost_centre_id = ? WHERE id = ?', [cc.id, task.id]);
  const inv = (await call('POST', `/projects/${projId}/supplier-invoices`,
    { supplier_id: sup.id, invoice_number: `B-${s}`, amount: 2000, task_id: task.id, stage_id: task.stage_id }, pm)).json.data;
  await call('POST', `/projects/${projId}/supplier-invoices/${inv.id}/status`, { status: 'approved' }, pm);
  const inv2 = (await call('POST', `/projects/${projId}/supplier-invoices`, { supplier_id: sup.id, invoice_number: `B2-${s}`, amount: 500 }, pm)).json.data;
  await call('POST', `/projects/${projId}/supplier-invoices/${inv2.id}/status`, { status: 'approved' }, pm);
  const po = (await call('POST', `/projects/${projId}/purchase-orders`, { supplier_id: sup.id, amount: 3000, description: 'Bricks' }, pm)).json.data;
  ok('(setup) the money records exist', !!dep.id && !!pc.id && !!inv.id && !!po.id, JSON.stringify({ dep: !!dep.id, pc: !!pc.id, inv: !!inv.id, po: !!po.id }));

  // ── 1. Settings ──
  const g0 = await call('GET', '/accounting-export/settings', undefined, accountant);
  ok('the accountant reads the settings: empty codes, generic + xero formats, cost centres listed',
    g0.status === 200 && g0.json.data.settings.sales_account_code === null
      && g0.json.data.formats.find((f) => f.id === 'xero')?.verified === false
      && g0.json.data.cost_centres.some((c) => c.id === cc.id), JSON.stringify(g0.json).slice(0, 300));
  const badDir = await call('PUT', '/accounting-export/settings', { gst_code_map: { purchases: { gst: 'X' } } }, pm);
  const badKey = await call('PUT', '/accounting-export/settings', { gst_code_map: { sales: { vat: 'X' } } }, pm);
  ok('gst_code_map only takes sales/bills and the four treatments (400s)', badDir.status === 400 && badKey.status === 400);
  const accPut = await call('PUT', '/accounting-export/settings', { sales_account_code: '200' }, accountant);
  ok('the accountant (no money.write) cannot change the settings (403)', accPut.status === 403);
  const put = await call('PUT', '/accounting-export/settings',
    { sales_account_code: '200', gst_code_map: { bills: { gst: 'GST on Expenses' } } }, pm);
  ok('the PM saves the sales default + a bills GST code', put.status === 200 && put.json.data.settings.sales_account_code === '200'
    && put.json.data.settings.gst_code_map.bills.gst === 'GST on Expenses', JSON.stringify(put.json).slice(0, 300));
  const ccSet = await call('PATCH', `/cost-centres/${cc.id}`, { export_account_code: '310' }, pm);
  const ccTradie = await call('PATCH', `/cost-centres/${cc.id}`, { export_account_code: '999' }, tradie);
  ok('PATCH /cost-centres/:id sets the export code (money.write; a tradie is refused)',
    ccSet.status === 200 && ccSet.json.data.export_account_code === '310' && ccTradie.status === 403, JSON.stringify([ccSet.json, ccTradie.json]));

  // ── 2. Preview ──
  const tPrev = await call('GET', '/accounting-export/preview?kind=sales', undefined, tradie);
  ok('a tradie cannot preview (accounts.read)', tPrev.status === 403);
  const badKind = await call('GET', '/accounting-export/preview?kind=payroll', undefined, pm);
  const xPo = await call('GET', '/accounting-export/preview?kind=purchase_orders&format=xero', undefined, pm);
  ok('an unknown kind is a 400; Xero POs are EXPORT_KIND_UNSUPPORTED',
    badKind.status === 400 && xPo.status === 400 && xPo.json.code === 'EXPORT_KIND_UNSUPPORTED', JSON.stringify(xPo.json));
  const ps = await call('GET', `/accounting-export/preview?kind=sales&project_id=${projId}`, undefined, accountant);
  const sRow = ps.json.data?.rows?.[0] || {};
  ok('sales: the issued deposit claim, contact = the customer + ABN, account 200, gst code "gst" (generic default)',
    ps.status === 200 && ps.json.data.row_count === 1 && sRow.reference.startsWith('PC-') && sRow.contact_name === '=Smith Family'
      && sRow.contact_abn === '51824753556' && sRow.account_code === '200' && sRow.gst_code === 'gst'
      && sRow.amount_inc_gst === 22000, JSON.stringify(ps.json).slice(0, 500));
  const pb = await call('GET', `/accounting-export/preview?kind=bills&project_id=${projId}`, undefined, pm);
  const rows = pb.json.data?.rows || [];
  const bClaim = rows.find((r) => r.source_type === 'progress_claim');
  const bInv = rows.find((r) => r.source_id === inv.id);
  const bInv2 = rows.find((r) => r.source_id === inv2.id);
  ok('bills: the approved claim (RCTI flagged) and both approved invoices', pb.status === 200 && rows.length === 3 && bClaim?.rcti === true,
    JSON.stringify(pb.json).slice(0, 500));
  ok('bills use the bills GST map ("GST on Expenses")', bInv?.gst_code === 'GST on Expenses');
  ok('account codes: cost centre code (310), else unmapped (no bills default yet) + EXPORT_UNMAPPED_ACCOUNTS',
    bInv?.account_code === '310' && bInv2?.account_code === null && bClaim?.account_code === null
      && codes(pb).includes('EXPORT_UNMAPPED_ACCOUNTS'), JSON.stringify([bInv, bInv2, pb.json.warnings]));
  const ppo = await call('GET', `/accounting-export/preview?kind=purchase_orders&project_id=${projId}`, undefined, pm);
  ok('purchase_orders: the issued PO, reference CODE-PO1', ppo.json.data?.rows?.length === 1 && ppo.json.data.rows[0].reference === `EX-${s}-PO1`,
    JSON.stringify(ppo.json).slice(0, 300));
  const pcp = await call('GET', `/accounting-export/preview?kind=contractor_payments&project_id=${projId}`, undefined, pm);
  ok('contractor_payments: the claim payment (TPAR-reportable)', pcp.json.data?.rows?.length === 1 && pcp.json.data.rows[0].amount_ex_gst === 10000,
    JSON.stringify(pcp.json).slice(0, 300));
  const [[unmarked]] = await pool.query('SELECT exported_at FROM client_claims WHERE id = ?', [dep.id]);
  ok('a preview marks nothing', unmarked.exported_at === null);

  // ── 3. CSV + the guard ──
  await call('PUT', '/accounting-export/settings', { bills_account_code: '300' }, pm);
  const c1 = await csv(`/accounting-export?kind=sales&project_id=${projId}`, accountant);
  const lines = parse(c1.text);
  ok('the CSV: generic header + 1 row, X-Export headers set',
    c1.status === 200 && lines[0][0] === 'kind' && lines.length === 2 && c1.headers.get('x-export-rows') === '1' && !!c1.headers.get('x-export-id'),
    c1.text.slice(0, 300));
  ok('a text cell starting with "=" is defused with an apostrophe', lines[1][6] === "'=Smith Family", lines[1][6]);
  const exportId = c1.headers.get('x-export-id');
  const [[run]] = await pool.query('SELECT * FROM accounting_exports WHERE id = ?', [exportId]);
  const [[marked]] = await pool.query('SELECT exported_at, exported_by, export_id FROM client_claims WHERE id = ?', [dep.id]);
  ok('the run is recorded (kind, row_count, sha256 of the file) and the claim is marked',
    run?.kind === 'sales' && run.row_count === 1 && run.sha256 === crypto.createHash('sha256').update(c1.text).digest('hex')
      && !!marked.exported_at && marked.export_id === exportId, JSON.stringify([run, marked]));
  const again = await call('GET', `/accounting-export/preview?kind=sales&project_id=${projId}`, undefined, pm);
  ok('only_new (default): the exported claim is skipped next time',
    again.json.data.row_count === 0 && again.json.data.skipped_already_exported === 1, JSON.stringify(again.json.data));
  const full = await call('GET', `/accounting-export/preview?kind=sales&project_id=${projId}&only_new=0`, undefined, pm);
  ok('only_new=0 repeats it and warns EXPORT_INCLUDES_EXPORTED',
    full.json.data.row_count === 1 && !!full.json.data.rows[0].exported_at && codes(full).includes('EXPORT_INCLUDES_EXPORTED'), JSON.stringify(full.json));
  const bCsv = await csv(`/accounting-export?kind=bills&project_id=${projId}`, pm);
  const bl = parse(bCsv.text);
  const claimLine = bl.find((l) => l[2] === pc.id);
  ok('bills CSV: the claim row carries rcti=1 and the bills default account (300)', claimLine?.[16] === '1' && claimLine?.[13] === '300', JSON.stringify(claimLine));
  const [[pcRow]] = await pool.query('SELECT exported_at FROM progress_claims WHERE id = ?', [pc.id]);
  const [[invRow]] = await pool.query('SELECT exported_at FROM supplier_invoices WHERE id = ?', [inv.id]);
  ok('…and marks the progress claim and the invoices', !!pcRow.exported_at && !!invRow.exported_at);
  const empty = await csv(`/accounting-export?kind=bills&project_id=${projId}`, pm);
  ok('a second bills export has only the header and records no run', parse(empty.text).length === 1 && empty.headers.get('x-export-id') === '');

  // ── 4. Void → credit row; Xero ──
  await call('POST', `/client-claims/${dep.id}/void`, { reason: 'Wrong amount' }, pm);
  const cr = await call('GET', `/accounting-export/preview?kind=sales&project_id=${projId}`, undefined, pm);
  const crRow = cr.json.data?.rows?.[0] || {};
  ok('voiding an exported claim yields one credit row (-CR, negative amounts)',
    cr.json.data.row_count === 1 && crRow.is_credit === true && crRow.reference.endsWith('-CR') && crRow.amount_inc_gst === -22000,
    JSON.stringify(cr.json).slice(0, 400));
  const xs = await csv(`/accounting-export?kind=sales&format=xero&project_id=${projId}`, pm);
  const xl = parse(xs.text);
  ok('Xero sales CSV: Xero header, unverified warning header, DD/MM/YYYY date, negative unit amount, GST on Income',
    xl[0][0] === '*ContactName' && (xs.headers.get('x-export-warnings') || '').includes('EXPORT_FORMAT_UNVERIFIED')
      && /^\d{2}\/\d{2}\/\d{4}$/.test(xl[1][12]) && xl[1][18] === '-20000' && xl[1][21] === 'GST on Income' && xl[1][23] === '',
    JSON.stringify(xl));
  const [[voidRow]] = await pool.query('SELECT void_exported_at FROM client_claims WHERE id = ?', [dep.id]);
  ok('…and the credit is marked (void_exported_at), so it goes out once', !!voidRow.void_exported_at);
  await call('PUT', '/accounting-export/settings', { xero_tracking_category: 'Project' }, pm);
  const base = (await call('POST', `/projects/${projId}/client-claims`, { milestone: 'base' }, pm)).json.data.client_claim;
  await call('POST', `/client-claims/${base.id}/issue`, undefined, pm);
  const xs2 = parse((await csv(`/accounting-export?kind=sales&format=xero&project_id=${projId}`, pm)).text);
  const baseLine = xs2.find((l) => l[11] === `EX-${s}`);
  ok('with a tracking category set, Xero rows carry TrackingName1/Option1 (category / project code)',
    baseLine?.[23] === 'Project' && baseLine?.[24] === `EX-${s}`, JSON.stringify(xs2));
  const hist = await call('GET', '/accounting-export/history', undefined, accountant);
  ok('history lists this org\'s runs, newest first', hist.status === 200 && hist.json.data.exports.length === 4
    && hist.json.data.exports[0].format === 'xero', JSON.stringify(hist.json).slice(0, 300));
  const pcList = await call('GET', `/projects/${projId}/progress-claims`, undefined, pm);
  ok('exported_at shows in the normal claim list', !!pcList.json.data.claims.find((c) => c.id === pc.id)?.exported_at);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async (err) => { console.error(err); try { await pool.end(); } catch {} process.exit(1); });
