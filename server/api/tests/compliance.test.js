// Compliance acceptance — NCC + structural completion gates (P6b, servdesignspec
// §12.10, projman-03 R2/R3).
//
// Proves:
//   1. A stage with nothing raised against it completes cleanly (vacuous compliance —
//      the gate only bites once something is actually open/unmet).
//   2. quality.write gates ncc_register writes (tradie refused).
//   3. R3 qualification-scope CHECK: residential (1/10) takes no building_type;
//      commercial (2..9) needs one of B/C; an unknown class is rejected.
//   4. An OPEN ncc_register item blocks its stage's completion (NCC_OPEN); closing
//      it (server-stamps closed_at/closed_by) unblocks it.
//   5. A structural inspection left pending OR failed blocks its stage (
//      STRUCTURAL_INCOMPLETE); passing it unblocks completion.
//   6. REST/sync parity: both gates are ALSO enforced when a device pushes
//      `project_stages` status='complete' via /sync/push directly — same codes,
//      because both paths share StageProgressionService.checkTransition.
//   7. Project-scoped push/pull for ncc_register (member sees it; a different org
//      never does).
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/compliance.test.js
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
const push = (tok, table, operation, data) =>
  call('POST', '/sync/push', { table_name: table, operation, data: { updated_at: Date.now(), ...data } }, tok);
async function pull(tok, table) {
  const r = await call('GET', '/sync/pull?since=0', undefined, tok);
  return (r.json.changes || []).filter((c) => c.table_name === table);
}

(async () => {
  console.log(`Compliance test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Compliance ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `C-${s}`, name: 'Lot 3 dwelling' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);

  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const stages = detail.json.data.stages;
  const bySeq = (n) => stages.find((st) => st.seq === n);
  // Stages 1–9 have no gate_prev (per the stage-engine suite) — each independently
  // startable, so a fresh stage per test avoids cross-test interference.
  const s2 = bySeq(2).id, s3 = bySeq(3).id, s4 = bySeq(4).id, s5 = bySeq(5).id, s6 = bySeq(6).id;

  const supTok = await pairAs(pm, pmUser, 'siteSupervisor', `sup-${s}`);
  const inspTok = await pairAs(pm, pmUser, 'inspector', `insp-${s}`);
  const tradieTok = await pairAs(pm, pmUser, 'tradie', `tra-${s}`);

  // ── 1. Vacuous compliance: nothing raised -> completes cleanly ──
  await call('POST', `/projects/${projId}/stages/${s2}/advance`, { to_status: 'in_progress' }, pm);
  const cleanComplete = await call('POST', `/projects/${projId}/stages/${s2}/advance`, { to_status: 'complete' }, pm);
  ok('a stage with no NCC/structural items raised completes cleanly',
    cleanComplete.status === 200, JSON.stringify(cleanComplete.json));

  // ── 2. quality.write gates ncc_register ──
  await call('POST', `/projects/${projId}/stages/${s3}/advance`, { to_status: 'in_progress' }, pm);
  const tradieNcc = await push(tradieTok, 'ncc_register', 'create',
    { id: `ncc-${s}-0`, project_id: projId, stage_id: s3, ncc_class: '10' });
  ok('tradie CANNOT raise an ncc_register item (no quality.write)',
    tradieNcc.status === 403 && tradieNcc.json.code === 'FORBIDDEN', JSON.stringify(tradieNcc.json));

  // ── 3. R3 qualification-scope CHECK ──
  const badResidential = await push(supTok, 'ncc_register', 'create',
    { id: `ncc-${s}-bad1`, project_id: projId, stage_id: s3, ncc_class: '10', building_type: 'B' });
  ok('residential ncc_class (10) WITH a building_type is rejected',
    badResidential.status === 422 && badResidential.json.code === 'VALIDATION_ERROR', JSON.stringify(badResidential.json));

  const badCommercial = await push(supTok, 'ncc_register', 'create',
    { id: `ncc-${s}-bad2`, project_id: projId, stage_id: s3, ncc_class: '5' });
  ok('commercial ncc_class (5) WITHOUT a building_type is rejected',
    badCommercial.status === 422 && badCommercial.json.code === 'VALIDATION_ERROR', JSON.stringify(badCommercial.json));

  const badClass = await push(supTok, 'ncc_register', 'create',
    { id: `ncc-${s}-bad3`, project_id: projId, stage_id: s3, ncc_class: '99' });
  ok('an unknown ncc_class is rejected', badClass.status === 422 && badClass.json.code === 'VALIDATION_ERROR',
    JSON.stringify(badClass.json));

  const goodCommercial = await push(supTok, 'ncc_register', 'create',
    { id: `ncc-${s}-good`, project_id: projId, stage_id: bySeq(9).id, ncc_class: '5', building_type: 'C' });
  ok('commercial ncc_class (5) WITH building_type C is accepted', goodCommercial.status === 200 && goodCommercial.json.applied,
    JSON.stringify(goodCommercial.json));

  // ── 4. Open NCC item blocks stage completion; closing it unblocks ──
  const nccId = `ncc-${s}-1`;
  const nccCreate = await push(supTok, 'ncc_register', 'create',
    { id: nccId, project_id: projId, stage_id: s3, ncc_class: '10', reference: 'NCC-CL1-01' });
  ok('siteSupervisor raises a residential NCC register item', nccCreate.status === 200 && nccCreate.json.applied,
    JSON.stringify(nccCreate.json));

  const blockedComplete = await call('POST', `/projects/${projId}/stages/${s3}/advance`, { to_status: 'complete' }, pm);
  ok('stage CANNOT complete with an open NCC item (NCC_OPEN)',
    blockedComplete.status === 409 && blockedComplete.json.code === 'NCC_OPEN', JSON.stringify(blockedComplete.json));

  await push(supTok, 'ncc_register', 'update', { id: nccId, status: 'closed' });
  const nccPull = await pull(pm, 'ncc_register');
  const closedRow = nccPull.find((c) => c.data.id === nccId);
  ok('closing the NCC item server-stamps closed_at/closed_by',
    closedRow && closedRow.data.closed_at && closedRow.data.closed_by, JSON.stringify(closedRow?.data));
  ok('raised_by/raised_at were server-stamped on create, not device-set',
    closedRow && closedRow.data.raised_by && closedRow.data.raised_at, JSON.stringify(closedRow?.data));

  const unblockedComplete = await call('POST', `/projects/${projId}/stages/${s3}/advance`, { to_status: 'complete' }, pm);
  ok('stage completes once its NCC item is closed', unblockedComplete.status === 200, JSON.stringify(unblockedComplete.json));

  // ── 5. Structural: pending/failed inspection blocks; a pass unblocks ──
  await call('POST', `/projects/${projId}/stages/${s4}/advance`, { to_status: 'in_progress' }, pm);
  const structInsp = await call('POST', `/projects/${projId}/inspections`, { type: 'structural', stage_id: s4 }, pm);
  const pendingBlock = await call('POST', `/projects/${projId}/stages/${s4}/advance`, { to_status: 'complete' }, pm);
  ok('a PENDING structural inspection blocks stage completion (STRUCTURAL_INCOMPLETE)',
    pendingBlock.status === 409 && pendingBlock.json.code === 'STRUCTURAL_INCOMPLETE', JSON.stringify(pendingBlock.json));

  await call('POST', `/projects/${projId}/inspections/${structInsp.json.data.id}/complete`, { result: 'fail' }, inspTok);
  const failBlock = await call('POST', `/projects/${projId}/stages/${s4}/advance`, { to_status: 'complete' }, pm);
  ok('a FAILED structural inspection still blocks stage completion',
    failBlock.status === 409 && failBlock.json.code === 'STRUCTURAL_INCOMPLETE', JSON.stringify(failBlock.json));

  // A fresh structural inspection on the same stage, passed, clears the gate.
  const structInsp2 = await call('POST', `/projects/${projId}/inspections`, { type: 'structural', stage_id: s4 }, pm);
  await call('POST', `/projects/${projId}/inspections/${structInsp2.json.data.id}/complete`, { result: 'pass' }, inspTok);
  const passUnblocked = await call('POST', `/projects/${projId}/stages/${s4}/advance`, { to_status: 'complete' }, pm);
  ok('stage completes once a structural inspection has passed', passUnblocked.status === 200, JSON.stringify(passUnblocked.json));

  // ── 6. REST/sync parity — the SAME gates fire on a sync-push status change ──
  await call('POST', `/projects/${projId}/stages/${s5}/advance`, { to_status: 'in_progress' }, pm);
  await push(supTok, 'ncc_register', 'create',
    { id: `ncc-${s}-2`, project_id: projId, stage_id: s5, ncc_class: '1' });
  const syncNccBlock = await push(supTok, 'project_stages', 'update', { id: s5, status: 'complete' });
  ok('sync-push completion hits the SAME NCC_OPEN gate as REST /advance',
    syncNccBlock.status === 409 && syncNccBlock.json.code === 'NCC_OPEN', JSON.stringify(syncNccBlock.json));

  await call('POST', `/projects/${projId}/stages/${s6}/advance`, { to_status: 'in_progress' }, pm);
  await call('POST', `/projects/${projId}/inspections`, { type: 'structural', stage_id: s6 }, pm);
  const syncStructBlock = await push(supTok, 'project_stages', 'update', { id: s6, status: 'complete' });
  ok('sync-push completion hits the SAME STRUCTURAL_INCOMPLETE gate as REST /advance',
    syncStructBlock.status === 409 && syncStructBlock.json.code === 'STRUCTURAL_INCOMPLETE', JSON.stringify(syncStructBlock.json));

  // ── 7. Project-scoped pull + org isolation for ncc_register ──
  // Pull from a DIFFERENT device than the one that pushed it (inspTok, not supTok) —
  // the pushing device's own writes are echo-skipped on its own pull, by design.
  const memberPull = await pull(inspTok, 'ncc_register');
  ok('a member (inspector) pull INCLUDES this project\'s ncc_register rows (pushed by a different device)',
    memberPull.some((c) => c.data.id === nccId), JSON.stringify(memberPull.map((c) => c.data.id)));

  const regB = await call('POST', '/auth/register', {
    organisation: { name: `Compliance B ${s}` },
    user: { full_name: 'Other PM', email: `pmb${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pmb-${s}`, platform: 'android' },
  });
  const pullB = await pull(regB.json.data.accessToken, 'ncc_register');
  ok('a different ORG never receives this project\'s ncc_register rows',
    !pullB.some((c) => c.data.id === nccId), JSON.stringify(pullB.map((c) => c.data.id)));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
