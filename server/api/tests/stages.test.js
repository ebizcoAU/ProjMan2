// Stage engine acceptance — the 18-stage template & progression engine (servdesignspec §10).
//
// Proves:
//   1. Template library: WA_RESIDENTIAL_18 is served with 18 items + hold points.
//   2. Instantiation: /programme stamps the 18 stages onto a project.
//   3. Progression gates (REST /advance): sequential gate + hold-point gate.
//   4. Inspector-only validation: projectManager cannot self-validate; inspector can;
//      after validation the hold-point stage may complete.
//   5. Sync-path parity: the SAME gate refuses a hold-point completion pushed via sync.
//   6. is_validated is not a device-writable column.
//   7. Financial redaction of the stage cost columns for a non-money role.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/stages.test.js
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
  console.log(`Stage engine test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Stage ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;

  // ── 1. Template library ──
  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data?.templates?.find(t => t.is_system && t.stage_count === 18);
  ok('WA_RESIDENTIAL_18 listed with 18 stages', !!wa18, JSON.stringify(tpls.json.data?.templates));
  const tplDetail = await call('GET', `/stage-templates/${wa18.id}`, undefined, pm);
  const holdPoints = (tplDetail.json.data?.items || []).filter(i => i.is_hold_point).map(i => i.seq);
  ok('template hold points are 11,12,13,15,18',
    JSON.stringify(holdPoints) === JSON.stringify([11, 12, 13, 15, 18]), JSON.stringify(holdPoints));

  // ── 2. Instantiate onto a project ──
  const proj = await call('POST', '/projects', { code: `WA-${s}`, name: 'Lot 7 dwelling' }, pm);
  const projId = proj.json.data.id;
  const inst = await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  ok('programme instantiated (18 stages)', inst.status === 201 && inst.json.data.stagesCreated === 18,
    JSON.stringify(inst.json));

  const reInst = await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  ok('re-instantiation refused (PROGRAMME_EXISTS)',
    reInst.status === 409 && reInst.json.code === 'PROGRAMME_EXISTS');

  // Grab the stage list.
  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const stages = detail.json.data.stages;
  const bySeq = (n) => stages.find(st => st.seq === n);
  ok('project detail returns 18 stages with parts', stages.length === 18 && bySeq(1).part === 'A');

  // ── 3. Progression gates ──
  // Stage 11 (hold point, gate_prev). Its predecessor (10) is not complete → cannot start.
  const s11 = bySeq(11).id;
  const startEarly = await call('POST', `/projects/${projId}/stages/${s11}/advance`, { to_status: 'in_progress' }, pm);
  ok('stage 11 cannot start before stage 10 complete (STAGE_GATE_PREV)',
    startEarly.status === 409 && startEarly.json.code === 'STAGE_GATE_PREV', JSON.stringify(startEarly.json));

  // Walk stages 1–10 to complete so 11 may start. (1–9 no gate; 10 gate_prev on 9.)
  for (let n = 1; n <= 10; n++) {
    const id = bySeq(n).id;
    await call('POST', `/projects/${projId}/stages/${id}/advance`, { to_status: 'in_progress' }, pm);
    const c = await call('POST', `/projects/${projId}/stages/${id}/advance`, { to_status: 'complete' }, pm);
    if (c.status !== 200) { ok(`walk stage ${n} to complete`, false, JSON.stringify(c.json)); break; }
  }
  const start11 = await call('POST', `/projects/${projId}/stages/${s11}/advance`, { to_status: 'in_progress' }, pm);
  ok('stage 11 starts once stage 10 is complete', start11.status === 200, JSON.stringify(start11.json));

  // Stage 11 is a hold point → cannot complete until validated.
  const complete11 = await call('POST', `/projects/${projId}/stages/${s11}/advance`, { to_status: 'complete' }, pm);
  ok('stage 11 cannot complete unvalidated (STAGE_NOT_VALIDATED)',
    complete11.status === 409 && complete11.json.code === 'STAGE_NOT_VALIDATED', JSON.stringify(complete11.json));

  // ── 4. Inspector-only validation ──
  const pmValidate = await call('POST', `/projects/${projId}/stages/${s11}/validate`, { result: 'pass' }, pm);
  ok('projectManager CANNOT validate (no quality.validate)',
    pmValidate.status === 403 && pmValidate.json.code === 'FORBIDDEN', JSON.stringify(pmValidate.json));

  // Pair an inspector (bound to the PM user so it's a member-less assigned scope — give
  // it membership so it can reach the project).
  const inspTok = await pairAs(pm, pmUser, 'inspector', `insp-${s}`);
  await call('POST', `/projects/${projId}/members`, { user_id: pmUser }, pm); // pmUser already member (creator); harmless
  const inspValidate = await call('POST', `/projects/${projId}/stages/${s11}/validate`,
    { result: 'pass', reference: 'BA2-001' }, inspTok);
  ok('inspector validates the hold point', inspValidate.status === 200 && inspValidate.json.data.is_validated === true,
    JSON.stringify(inspValidate.json));

  const complete11b = await call('POST', `/projects/${projId}/stages/${s11}/advance`, { to_status: 'complete' }, pm);
  ok('stage 11 completes after validation', complete11b.status === 200, JSON.stringify(complete11b.json));

  // ── 5. Sync-path parity ──
  // Start stage 12 (gate_prev on 11, now complete+validated → allowed), then try to
  // COMPLETE it via a sync push while it is an unvalidated hold point → same refusal.
  const s12 = bySeq(12).id;
  await call('POST', `/projects/${projId}/stages/${s12}/advance`, { to_status: 'in_progress' }, pm);
  // Give the PM's own app device a session (register created one). Use a paired
  // siteSupervisor device that is a member, to push as the field app.
  const supTok = await pairAs(pm, pmUser, 'siteSupervisor', `sup-${s}`);
  const syncComplete = await call('POST', '/sync/push', {
    table_name: 'project_stages', operation: 'update',
    data: { id: s12, status: 'complete', updated_at: Date.now() },
  }, supTok);
  ok('sync push of a hold-point completion hits the SAME gate (STAGE_NOT_VALIDATED)',
    syncComplete.status === 409 && syncComplete.json.code === 'STAGE_NOT_VALIDATED', JSON.stringify(syncComplete.json));

  // A non-status field change on the same stage still syncs (gate only fires on status).
  const syncProgress = await call('POST', '/sync/push', {
    table_name: 'project_stages', operation: 'update',
    data: { id: s12, status: 'in_progress', start_date: '2026-07-23', updated_at: Date.now() },
  }, supTok);
  ok('sync push of an allowed transition applies', syncProgress.status === 200 && syncProgress.json.applied,
    JSON.stringify(syncProgress.json));

  // ── 6. is_validated is not device-writable ──
  const forgeValidate = await call('POST', '/sync/push', {
    table_name: 'project_stages', operation: 'update',
    data: { id: s12, is_validated: 1, updated_at: Date.now() },
  }, supTok);
  // Server drops is_validated (protected); nothing to change → applied:false, still not validated.
  const s12detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const s12row = s12detail.json.data.stages.find(st => st.id === s12);
  ok('device cannot flip is_validated via sync', !s12row.is_validated, `is_validated=${s12row.is_validated}`);

  // ── 7. Financial redaction of stage cost columns ──
  // Set a cost on stage 12 via web, then pull as the siteSupervisor (no money.read).
  await call('PATCH', `/projects/${projId}/stages/${s12}`, { estimated_amount: 90000 }, pm);
  const supPull = await call('GET', '/sync/pull?since=0', undefined, supTok);
  const supStages = (supPull.json.changes || []).filter(c => c.table_name === 'project_stages');
  ok('siteSupervisor pull REDACTS stage cost columns',
    supStages.length > 0 && supStages.every(c =>
      !('estimated_amount' in c.data) && !('budget_amount' in c.data) &&
      !('committed_amount' in c.data) && !('actual_amount' in c.data) && !('claimed_amount' in c.data)),
    `stages=${supStages.length}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
