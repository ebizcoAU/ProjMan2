// Task quotes — external cost for outsourced tasks (xprojman-39 §3, migration v043).
//
// Proves:
//   1. A quote can only be raised against an outsourced task (is_outsourced=1).
//   2. po.write raises a quote; a role without it (tradie) is refused.
//   3. quotes.approve (projectManager only, NOT plain po.write) approves/declines.
//   4. Approving raises a REAL purchase_orders row (existing procurement flow),
//      links it back onto the quote, and that PO counts toward the stage's
//      committed_amount — a quote itself never feeds the rollup directly.
//   5. Declining does NOT raise a PO.
//   6. A quote already resolved (approved/declined) cannot be resolved again (409).
//   7. Cross-org / unknown ids 404, not a leak.
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/task-quotes.test.js
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
  console.log(`Task quotes test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Quotes ${s}` },
    user: { full_name: 'Pat PM', email: `quotes${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;
  const tradieTok = await pairAs(pm, pmUser, 'tradie', `tradie-${s}`);
  const builderTok = await pairAs(pm, pmUser, 'builder', `builder-${s}`);

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `TQ-${s}`, name: 'Quotes test' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const stage1 = detail.json.data.stages.find((st) => st.seq === 1);

  const task = await call('POST', `/projects/${projId}/tasks`, { stage_id: stage1.id, name: 'Fence installation' }, pm);
  const taskId = task.json.data.id;

  // ── 1. is_outsourced precondition ──
  const notOutsourced = await call('POST', `/projects/${projId}/task-quotes`,
    { task_id: taskId, supplier_name: 'Acme Fencing', amount: 5000 }, pm);
  ok('cannot raise a quote against a non-outsourced task (422)', notOutsourced.status === 422, JSON.stringify(notOutsourced.json));

  const setOutsourced = await call('PATCH', `/projects/${projId}/tasks/${taskId}`, { is_outsourced: true }, pm);
  ok('task marked outsourced', setOutsourced.status === 200 && setOutsourced.json.data.is_outsourced === 1);

  // ── 2. Raise: po.write ──
  const tradieRaise = await call('POST', `/projects/${projId}/task-quotes`,
    { task_id: taskId, supplier_name: 'Acme Fencing', amount: 5000 }, tradieTok);
  ok('a tradie (no po.write) cannot raise a quote (403)', tradieRaise.status === 403, JSON.stringify(tradieRaise.json));

  const noAmount = await call('POST', `/projects/${projId}/task-quotes`, { task_id: taskId, supplier_name: 'Acme' }, pm);
  ok('a quote with no amount is refused (400/422)', [400, 422].includes(noAmount.status), JSON.stringify(noAmount.json));

  const quote = await call('POST', `/projects/${projId}/task-quotes`,
    { task_id: taskId, supplier_name: 'Acme Fencing', amount: 5000 }, pm);
  ok('quote raised', quote.status === 201 && quote.json.data.status === 'pending', JSON.stringify(quote.json));
  const quoteId = quote.json.data.id;

  const list1 = await call('GET', `/projects/${projId}/task-quotes`, undefined, pm);
  ok('quote appears in the project list', list1.json.data.task_quotes.some((q) => q.id === quoteId));

  // ── 3. Approve: quotes.approve (projectManager only, not plain po.write) ──
  const builderApprove = await call('POST', `/projects/${projId}/task-quotes/${quoteId}/approve`, { accept: true }, builderTok);
  ok('a builder (po.write, but NOT quotes.approve) cannot approve a quote (403)', builderApprove.status === 403, JSON.stringify(builderApprove.json));

  // ── 4. Approve raises a real PO, links it back, counts toward committed_amount ──
  const beforePlan = await call('GET', `/projects/${projId}`, undefined, pm);
  const committedBefore = beforePlan.json.data.stages.find((st) => st.id === stage1.id)?.committed_amount || 0;

  const approve = await call('POST', `/projects/${projId}/task-quotes/${quoteId}/approve`, { accept: true }, pm);
  ok('PM approves the quote', approve.status === 200 && approve.json.data.status === 'approved' && !!approve.json.data.purchase_order_id, JSON.stringify(approve.json));

  const poList = await call('GET', `/projects/${projId}/purchase-orders`, undefined, pm);
  const raisedPo = poList.json.data.purchase_orders.find((p) => p.id === approve.json.data.purchase_order_id);
  ok('a real purchase_orders row was raised, status issued, referencing the task', raisedPo && raisedPo.status === 'issued' && raisedPo.task_id === taskId, JSON.stringify(raisedPo));
  ok('the raised PO carries the quote\'s own amount and supplier', Number(raisedPo.amount) === 5000 && raisedPo.supplier_name === 'Acme Fencing');

  const afterPlan = await call('GET', `/projects/${projId}`, undefined, pm);
  const committedAfter = afterPlan.json.data.stages.find((st) => st.id === stage1.id)?.committed_amount || 0;
  ok('the stage\'s committed_amount grew by the quote\'s amount (via the PO, not the quote directly)',
    Math.abs(Number(committedAfter) - Number(committedBefore) - 5000) < 0.01, `before=${committedBefore} after=${committedAfter}`);

  const quoteAfter = await call('GET', `/projects/${projId}/task-quotes`, undefined, pm);
  const resolvedQuote = quoteAfter.json.data.task_quotes.find((q) => q.id === quoteId);
  ok('the quote row itself is now approved with the PO id linked back', resolvedQuote.status === 'approved' && resolvedQuote.purchase_order_id === raisedPo.id);

  // ── 6. Already resolved ──
  const reApprove = await call('POST', `/projects/${projId}/task-quotes/${quoteId}/approve`, { accept: true }, pm);
  ok('approving an already-approved quote is refused (409)', reApprove.status === 409, JSON.stringify(reApprove.json));

  // ── 5. Decline: no PO raised ──
  const task2 = await call('POST', `/projects/${projId}/tasks`, { stage_id: stage1.id, name: 'Concrete pour' }, pm);
  await call('PATCH', `/projects/${projId}/tasks/${task2.json.data.id}`, { is_outsourced: true }, pm);
  const quote2 = await call('POST', `/projects/${projId}/task-quotes`,
    { task_id: task2.json.data.id, supplier_name: 'BuildCo', amount: 8000 }, pm);
  const decline = await call('POST', `/projects/${projId}/task-quotes/${quote2.json.data.id}/approve`, { accept: false }, pm);
  ok('PM declines a quote', decline.status === 200 && decline.json.data.status === 'declined', JSON.stringify(decline.json));
  const poListAfterDecline = await call('GET', `/projects/${projId}/purchase-orders`, undefined, pm);
  ok('declining raises NO purchase order', poListAfterDecline.json.data.purchase_orders.length === 1);

  // ── 7. Cross-org / unknown ──
  const unknownQuote = await call('POST', `/projects/${projId}/task-quotes/00000000-0000-4000-8000-000000000000/approve`, { accept: true }, pm);
  ok('approving an unknown quote id is refused (404)', unknownQuote.status === 404);

  const reg2 = await call('POST', '/auth/register', {
    organisation: { name: `OtherQuotes ${s}` },
    user: { full_name: 'Other PM', email: `otherquotes${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `oth-${s}`, platform: 'android' },
  });
  const other = reg2.json.data.accessToken;
  const xList = await call('GET', `/projects/${projId}/task-quotes`, undefined, other);
  ok('CROSS-ORG: another org cannot list this project\'s quotes (404)', xList.status === 404, JSON.stringify(xList.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
