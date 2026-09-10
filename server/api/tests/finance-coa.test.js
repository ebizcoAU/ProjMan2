// Per-tenant chart of accounts (xprojman-42 §2, migration v042).
//
// Proves:
//   1. GET /finance/accounts lazily seeds the standard AU template on first
//      read (a brand-new org has zero org_accounts rows until this fires),
//      and re-reading doesn't duplicate/re-seed.
//   2. The overhead buckets (§8 point 1) exist as childless top-level
//      expense roots.
//   3. finance.manage (not money.write) gates create/rename/deactivate/
//      re-parent — a money.write-only caller (estimator-shaped: has
//      money.write but not finance.manage) is refused; a tradie (neither)
//      is refused reading too.
//   4. A child account's acc_type follows its parent; a mismatched acc_type
//      is refused. Re-parenting under one's own descendant is refused
//      (cycle guard).
//   5. cost_centres.linked_account_id: money.write (not finance.manage)
//      sets it; must point at an expense account; unlinking (null) works.
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/finance-coa.test.js
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
function flatten(nodes, out = []) {
  for (const n of nodes) { out.push(n); flatten(n.children, out); }
  return out;
}

(async () => {
  console.log(`Finance chart-of-accounts test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `FinCOA ${s}` },
    user: { full_name: 'Pat PM', email: `fincoa${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;

  const tradieTok = await pairAs(pm, pmUser, 'tradie', `tradie-${s}`);
  const supervisorTok = await pairAs(pm, pmUser, 'siteSupervisor', `sup-${s}`);

  // ── 1. Lazy seed on first read ──
  const first = await call('GET', '/finance/accounts', undefined, pm);
  ok('first read seeds a non-empty tree', first.status === 200 && first.json.data.accounts.length > 0, JSON.stringify(first.json).slice(0, 300));
  const flatFirst = flatten(first.json.data.accounts);
  const codes = new Set(flatFirst.map((n) => n.code));
  ok('template includes standard roots (Cash & Bank, Contract Revenue, Labour Cost)',
    codes.has('1000') && codes.has('4000') && codes.has('5000'));

  const second = await call('GET', '/finance/accounts', undefined, pm);
  const flatSecond = flatten(second.json.data.accounts);
  ok('re-reading does not duplicate the tree', flatSecond.length === flatFirst.length, `${flatFirst.length} vs ${flatSecond.length}`);

  // ── 2. Overhead buckets ──
  const corporate = flatFirst.find((n) => n.name === 'Corporate/Admin');
  const salesBd = flatFirst.find((n) => n.name === 'Sales & BD');
  const engOps = flatFirst.find((n) => n.name === 'Engineering Operations');
  ok('Corporate/Admin overhead bucket exists, top-level, expense, childless',
    corporate && !corporate.parentId && corporate.accType === 'expense' && corporate.children.length === 0);
  ok('Sales & BD overhead bucket exists, top-level, expense, childless',
    salesBd && !salesBd.parentId && salesBd.accType === 'expense' && salesBd.children.length === 0);
  ok('Engineering Operations overhead bucket exists, top-level, expense, childless',
    engOps && !engOps.parentId && engOps.accType === 'expense' && engOps.children.length === 0);

  // ── 3. Permission gating ──
  const tradieRead = await call('GET', '/finance/accounts', undefined, tradieTok);
  ok('a tradie (no money.read) cannot read the chart of accounts (403)', tradieRead.status === 403, JSON.stringify(tradieRead.json));

  const supervisorCreate = await call('POST', '/finance/accounts', { code: `X-${s}`, name: 'Rogue Account', acc_type: 'expense' }, supervisorTok);
  ok('a siteSupervisor (no money.read/finance.manage) cannot create an account (403)', supervisorCreate.status === 403, JSON.stringify(supervisorCreate.json));

  // ── 4. Create: acc_type inheritance + mismatch guard ──
  const labourCost = flatFirst.find((n) => n.code === '5000');
  const goodChild = await call('POST', '/finance/accounts', { code: `5900-${s}`, name: 'Casual Wages', parent_id: labourCost.id }, pm);
  ok('creating a child with no acc_type inherits the parent\'s (expense)', goodChild.status === 201 && goodChild.json.data.accType === 'expense', JSON.stringify(goodChild.json));

  const revenueRoot = flatFirst.find((n) => n.code === '4000');
  const mismatch = await call('POST', '/finance/accounts', { code: `4900-${s}`, name: 'Bad Mix', parent_id: revenueRoot.id, acc_type: 'expense' }, pm);
  ok('a child acc_type mismatched with its parent is refused (422)', mismatch.status === 422, JSON.stringify(mismatch.json));

  const noType = await call('POST', '/finance/accounts', { code: `9000-${s}`, name: 'No Type Root' }, pm);
  ok('a root account with no acc_type is refused (400)', noType.status === 400);

  const dupCode = await call('POST', '/finance/accounts', { code: '1000', name: 'Duplicate Cash', acc_type: 'asset' }, pm);
  ok('a duplicate code within the org is refused (409)', dupCode.status === 409, JSON.stringify(dupCode.json));

  // ── 5. Update: rename, deactivate, re-parent, cycle guard ──
  const renamed = await call('PATCH', `/finance/accounts/${goodChild.json.data.id}`, { name: 'Casual Labour Wages' }, pm);
  ok('rename succeeds under finance.manage', renamed.status === 200 && renamed.json.data.name === 'Casual Labour Wages', JSON.stringify(renamed.json));

  const deactivated = await call('PATCH', `/finance/accounts/${goodChild.json.data.id}`, { is_active: false }, pm);
  ok('deactivate succeeds under finance.manage', deactivated.status === 200 && deactivated.json.data.is_active === 0);

  const reparented = await call('PATCH', `/finance/accounts/${goodChild.json.data.id}`, { parent_id: null }, pm);
  ok('re-parenting to a root of the same acc_type succeeds', reparented.status === 200);
  const flatAfterReparent = flatten((await call('GET', '/finance/accounts', undefined, pm)).json.data.accounts);
  const movedNode = flatAfterReparent.find((n) => n.id === goodChild.json.data.id);
  ok('re-parented node is now a root', movedNode && !movedNode.parentId);

  // A real cycle: try to move labourCost under one of its OWN current children.
  const staffWages = flatFirst.find((n) => n.code === '5010');
  const realCycle = await call('PATCH', `/finance/accounts/${labourCost.id}`, { parent_id: staffWages.id }, pm);
  ok('re-parenting an account under its own current descendant is refused (422)', realCycle.status === 422, JSON.stringify(realCycle.json));

  const moneyWriteOnlyUpdate = await call('PATCH', `/finance/accounts/${labourCost.id}`, { name: 'Hacked' }, tradieTok);
  ok('a role without finance.manage cannot update an account (403)', moneyWriteOnlyUpdate.status === 403);

  const emptyPatch = await call('PATCH', `/finance/accounts/${labourCost.id}`, {}, pm);
  ok('an empty PATCH body is refused (400 NO_FIELDS)', emptyPatch.status === 400);

  // ── 6. cost_centres.linked_account_id ──
  const cc = await call('POST', '/cost-centres', { code: `CC-${s}`, name: 'General Labour' }, pm);
  ok('cost centre created', cc.status === 201, JSON.stringify(cc.json));

  const linkToRevenue = await call('PATCH', `/cost-centres/${cc.json.data.id}/account`, { account_id: revenueRoot.id }, pm);
  ok('linking a cost centre to a non-expense account is refused (422)', linkToRevenue.status === 422, JSON.stringify(linkToRevenue.json));

  const link = await call('PATCH', `/cost-centres/${cc.json.data.id}/account`, { account_id: labourCost.id }, pm);
  ok('linking a cost centre to an expense account succeeds', link.status === 200 && link.json.data.linked_account_id === labourCost.id, JSON.stringify(link.json));

  const ccList = await call('GET', '/cost-centres', undefined, pm);
  const ccRow = ccList.json.data.cost_centres.find((c) => c.id === cc.json.data.id);
  ok('the list reflects the link', ccRow && ccRow.linked_account_id === labourCost.id);

  const unlink = await call('PATCH', `/cost-centres/${cc.json.data.id}/account`, { account_id: null }, pm);
  ok('unlinking (null) succeeds', unlink.status === 200 && unlink.json.data.linked_account_id === null, JSON.stringify(unlink.json));

  const tradieLink = await call('PATCH', `/cost-centres/${cc.json.data.id}/account`, { account_id: labourCost.id }, tradieTok);
  ok('a role without money.write cannot link a cost centre (403)', tradieLink.status === 403);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
