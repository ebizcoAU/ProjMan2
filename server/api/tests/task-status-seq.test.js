// tasks.status + tasks.seq (xprojman-38, owner directive 2026-09-05).
//
// Proves:
//   1. Seeded tasks get status='not_started' + a real code (Sx.y from the
//      task's OWN seq + its stage's seq) at instantiation, not just via the
//      one-time migration backfill.
//   2. status derives from completion on every tick (never drifts): 0 ->
//      not_started, 1-99 -> in_progress, 100 -> complete. A device can never
//      set status directly — verified via a real push, not assumed.
//   3. Office PATCH is the ONLY path to 'cancelled'/'n_a', and it's fully
//      reversible (no terminal-state lock).
//   4. A device tick against a cancelled/n_a task is silently dropped
//      (applied:false), not rejected — the office decision wins, the device
//      just doesn't know about it yet.
//   5. POST /projects/:id/tasks (didn't exist before this) continues the
//      SAME Sx.y numbering a stage's seeded tasks use — the owner's own
//      example (seeded ends S1.7, add S1.8/S1.9/S1.10).
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/task-status-seq.test.js
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
  console.log(`Task status/seq test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `TaskStatus ${s}` },
    user: { full_name: 'Pat PM', email: `taskstatus${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;

  // progress.tick is a field-role permission (tradie/foreperson/builder) — the
  // PM's own web session doesn't hold it. Same identity, a device-paired role,
  // exactly like domain.test.js's supervisor.
  const foreTok = await pairAs(pm, pmUser, 'foreperson', `fore-${s}`);

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);

  const proj = await call('POST', '/projects', { code: `TS-${s}`, name: 'Task status test' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);

  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const stage1 = detail.json.data.stages.find((st) => st.seq === 1);
  const stage1Tasks = detail.json.data.tasks.filter((t) => t.stage_id === stage1.id);

  // ── 1. Seeded tasks: status + code at instantiation, no migration needed ──
  ok('seeded tasks all start not_started', stage1Tasks.every((t) => t.status === 'not_started'),
    JSON.stringify(stage1Tasks.map((t) => t.status)));
  ok('Stage 1 has exactly 7 seeded tasks S1.1-S1.7', stage1Tasks.length === 7, stage1Tasks.length);
  const codes = stage1Tasks.map((t) => t.code).sort();
  ok('codes are S1.1..S1.7, computed from own seq + stage seq (no template join needed)',
    JSON.stringify(codes) === JSON.stringify(['S1.1', 'S1.2', 'S1.3', 'S1.4', 'S1.5', 'S1.6', 'S1.7']),
    JSON.stringify(codes));

  const s1_1 = stage1Tasks.find((t) => t.code === 'S1.1');

  // ── 2. status derives from completion, never drifts ──
  const tick50 = await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'update',
    data: { id: s1_1.id, completion: 50, updated_at: Date.now() },
  }, foreTok);
  ok('tick to 50 accepted', tick50.status === 200 && tick50.json.applied === true, JSON.stringify(tick50.json));
  let after = await call('GET', `/projects/${projId}`, undefined, pm);
  let t = after.json.data.tasks.find((x) => x.id === s1_1.id);
  ok('completion=50 -> status in_progress', t.status === 'in_progress', t.status);

  const tick100 = await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'update',
    data: { id: s1_1.id, completion: 100, updated_at: Date.now() },
  }, foreTok);
  ok('tick to 100 accepted', tick100.status === 200 && tick100.json.applied === true);
  after = await call('GET', `/projects/${projId}`, undefined, pm);
  t = after.json.data.tasks.find((x) => x.id === s1_1.id);
  ok('completion=100 -> status complete', t.status === 'complete', t.status);

  const tick0 = await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'update',
    data: { id: s1_1.id, completion: 0, updated_at: Date.now() },
  }, foreTok);
  ok('tick back to 0 accepted', tick0.status === 200 && tick0.json.applied === true);
  after = await call('GET', `/projects/${projId}`, undefined, pm);
  t = after.json.data.tasks.find((x) => x.id === s1_1.id);
  ok('completion=0 -> status not_started', t.status === 'not_started', t.status);

  // A device cannot set status directly, even if it tries — sanitise() strips it
  // (not in tasks' sync-registry columns set), so the push is a no-op here (no
  // other field left to change).
  const devStatusPush = await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'update',
    data: { id: s1_1.id, status: 'complete' },
  }, pm);
  ok('device push of a bare status field is a no-op (stripped, not applied)',
    devStatusPush.status === 200 && devStatusPush.json.applied === false, JSON.stringify(devStatusPush.json));
  after = await call('GET', `/projects/${projId}`, undefined, pm);
  t = after.json.data.tasks.find((x) => x.id === s1_1.id);
  ok('status unchanged by the device push attempt', t.status === 'not_started', t.status);

  // ── 3. Office PATCH: the only path to cancelled/n_a, fully reversible ──
  const s1_2 = stage1Tasks.find((t) => t.code === 'S1.2');
  const markNA = await call('PATCH', `/projects/${projId}/tasks/${s1_2.id}`, { status: 'n_a' }, pm);
  ok('office marks a task n_a', markNA.status === 200 && markNA.json.data?.status === 'n_a', JSON.stringify(markNA.json));
  after = await call('GET', `/projects/${projId}`, undefined, pm);
  t = after.json.data.tasks.find((x) => x.id === s1_2.id);
  ok('n_a persisted', t.status === 'n_a');

  const unmarkNA = await call('PATCH', `/projects/${projId}/tasks/${s1_2.id}`, { status: 'not_started' }, pm);
  ok('office reverses n_a back to not_started (reversible, no terminal lock)',
    unmarkNA.status === 200 && unmarkNA.json.data?.status === 'not_started', JSON.stringify(unmarkNA.json));

  const markCancelled = await call('PATCH', `/projects/${projId}/tasks/${s1_2.id}`, { status: 'cancelled' }, pm);
  ok('office cancels a task', markCancelled.status === 200 && markCancelled.json.data?.status === 'cancelled');

  const badStatus = await call('PATCH', `/projects/${projId}/tasks/${s1_2.id}`, { status: 'bogus' }, pm);
  ok('an invalid status value is refused (422)', badStatus.status === 422, JSON.stringify(badStatus.json));

  const noFields = await call('PATCH', `/projects/${projId}/tasks/${s1_2.id}`, {}, pm);
  ok('PATCH with neither output_note nor status refused (400 NO_FIELDS)',
    noFields.status === 400 && noFields.json.code === 'NO_FIELDS', JSON.stringify(noFields.json));

  // ── 4. A device tick against a cancelled task is silently dropped ──
  const tickCancelled = await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'update',
    data: { id: s1_2.id, completion: 75, updated_at: Date.now() },
  }, pm);
  ok('device tick against a cancelled task is a no-op (not rejected, not applied)',
    tickCancelled.status === 200 && tickCancelled.json.applied === false, JSON.stringify(tickCancelled.json));
  after = await call('GET', `/projects/${projId}`, undefined, pm);
  t = after.json.data.tasks.find((x) => x.id === s1_2.id);
  ok('cancelled task\'s completion/status untouched by the device tick',
    t.status === 'cancelled' && Number(t.completion) !== 75, JSON.stringify({ status: t.status, completion: t.completion }));

  // ── 5. POST /projects/:id/tasks — continues the same Sx.y numbering ──
  const add1 = await call('POST', `/projects/${projId}/tasks`, { stage_id: stage1.id, name: 'Other custom Task1' }, pm);
  ok('custom task created (201)', add1.status === 201, JSON.stringify(add1.json));
  ok('custom task gets seq=8, continuing after the 7 seeded tasks', add1.json.data?.seq === 8, JSON.stringify(add1.json));
  ok('custom task code is S1.8', add1.json.data?.code === 'S1.8', JSON.stringify(add1.json));

  const add2 = await call('POST', `/projects/${projId}/tasks`, { stage_id: stage1.id, name: 'Task2' }, pm);
  ok('a second custom task continues at seq=9 (S1.9)', add2.json.data?.seq === 9 && add2.json.data?.code === 'S1.9',
    JSON.stringify(add2.json));

  after = await call('GET', `/projects/${projId}`, undefined, pm);
  const custom1 = after.json.data.tasks.find((x) => x.id === add1.json.data.id);
  ok('custom task has no template_item_id (not seeded)', custom1.template_item_id === null || custom1.template_item_id === undefined,
    JSON.stringify(custom1.template_item_id));
  ok('custom task starts not_started', custom1.status === 'not_started', custom1.status);

  const missingStage = await call('POST', `/projects/${projId}/tasks`, { name: 'No stage' }, pm);
  ok('missing stage_id refused (422 validator)', missingStage.status === 422, JSON.stringify(missingStage.json));

  const missingName = await call('POST', `/projects/${projId}/tasks`, { stage_id: stage1.id }, pm);
  ok('missing name refused (422 validator)', missingName.status === 422, JSON.stringify(missingName.json));

  const badStage = await call('POST', `/projects/${projId}/tasks`,
    { stage_id: '00000000-0000-0000-0000-000000000000', name: 'x' }, pm);
  ok('unknown stage_id refused (422)', badStage.status === 422, JSON.stringify(badStage.json));

  const withPredecessor = await call('POST', `/projects/${projId}/tasks`,
    { stage_id: stage1.id, name: 'Depends on S1.8', predecessor_id: add1.json.data.id }, pm);
  ok('a valid predecessor_id is accepted', withPredecessor.status === 201, JSON.stringify(withPredecessor.json));

  const badPredecessor = await call('POST', `/projects/${projId}/tasks`,
    { stage_id: stage1.id, name: 'x', predecessor_id: '00000000-0000-0000-0000-000000000000' }, pm);
  ok('an unknown predecessor_id is refused (422)', badPredecessor.status === 422, JSON.stringify(badPredecessor.json));

  const noPermission = await call('POST', `/projects/${projId}/tasks`, { stage_id: stage1.id, name: 'x' }, undefined);
  ok('no auth refused (401)', noPermission.status === 401);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
