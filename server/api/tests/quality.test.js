// Quality acceptance — inspections · defects · certificates (servdesignspec §12).
//
// Proves:
//   1. Hold-point inspection PASS drives the stage's is_validated (the EXISTING §10.5
//      gate) and unblocks its completion — the inspection id becomes the reference.
//   2. Hold-point inspection FAIL records the result; the stage stays unvalidated and
//      blocked.
//   3. Separation of duties: projectManager holds quality.write (can create/complete)
//      but NOT quality.validate — completing a hold-point inspection with a pass
//      still requires it, so the PM cannot self-validate through this path either.
//   4. A non-hold-point (QA) inspection records pass/fail WITHOUT touching any stage.
//   5. Defects: raised/closed through /sync/push; quality.write gates the push;
//      raised_by/raised_at/closed_at/closed_by are server-stamped, never device-set.
//   6. Certificates: both app and web surfaces may push (§12.7); expiry read surfaces
//      a `lapsing_soon` flag.
//   7. inspection_items is child-scoped (no project_id of its own) — a member's pull
//      includes them (parent-derivation, §12.9); a non-member org cannot reach them.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/quality.test.js
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
  console.log(`Quality test → ${BASE}\n`);
  const s = Date.now();

  // ── Setup: org, PM, a programme, members ──
  const pmEmail = `pm${s}@x.com`;
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Quality ${s}` },
    user: { full_name: 'Pat PM', email: pmEmail, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;
  // A genuine WEB session (no device object at all -> no device_id JWT claim -> the
  // sync surface resolves to 'web', not 'app') for the certificates dual-owner check.
  const pmWeb = (await call('POST', '/auth/login', { email: pmEmail, password: 'hunter2hunter2' })).json.data.accessToken;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `Q-${s}`, name: 'Lot 9 dwelling' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);

  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const stages = detail.json.data.stages;
  const bySeq = (n) => stages.find((st) => st.seq === n);

  // Paired early — Stage 10's S10.5 hold-point requirement (DIRECTIVE 1 Step D2)
  // needs a Site Supervisor to satisfy it before Stage 10 can complete.
  const supTokEarly = await pairAs(pm, pmUser, 'siteSupervisor', `sup-early-${s}`);

  // Walk 1–10 to complete so stage 11 (hold point) may start.
  for (let n = 1; n <= 10; n++) {
    const id = bySeq(n).id;
    await call('POST', `/projects/${projId}/stages/${id}/advance`, { to_status: 'in_progress' }, pm);
    if (n === 10) {
      const hp = await call('GET', `/projects/${projId}/stages/${id}/hold-points`, undefined, pm);
      const setout = hp.json.data.requirements.find((r) => r.blocks_progress === 1);
      await call('POST', `/projects/${projId}/stages/${id}/hold-points/${setout.id}/satisfy`, {}, supTokEarly);
    }
    await call('POST', `/projects/${projId}/stages/${id}/advance`, { to_status: 'complete' }, pm);
  }
  const s11 = bySeq(11).id, s12 = bySeq(12).id;
  await call('POST', `/projects/${projId}/stages/${s11}/advance`, { to_status: 'in_progress' }, pm);

  const inspTok = await pairAs(pm, pmUser, 'inspector', `insp-${s}`);
  const supTok = await pairAs(pm, pmUser, 'siteSupervisor', `sup-${s}`);
  const tradieTok = await pairAs(pm, pmUser, 'tradie', `tra-${s}`);

  // ── 1+3. Hold-point inspection: create (PM, quality.write), PM cannot complete-pass ──
  const insp11 = await call('POST', `/projects/${projId}/inspections`,
    { type: 'slab', stage_id: s11 }, pm);
  ok('inspection created, is_hold_point mirrors the stage', insp11.status === 201 && insp11.json.data.is_hold_point === true,
    JSON.stringify(insp11.json));
  const insp11Id = insp11.json.data.id;

  const pmComplete = await call('POST', `/projects/${projId}/inspections/${insp11Id}/complete`,
    { result: 'pass' }, pm);
  ok('projectManager CANNOT complete-pass a hold-point inspection (needs quality.validate)',
    pmComplete.status === 403 && pmComplete.json.code === 'FORBIDDEN', JSON.stringify(pmComplete.json));

  const inspComplete = await call('POST', `/projects/${projId}/inspections/${insp11Id}/complete`,
    { result: 'pass', reference: 'BA2-001' }, inspTok);
  ok('inspector completes a hold-point PASS -> drives is_validated',
    inspComplete.status === 200 && inspComplete.json.data.validation?.is_validated === true,
    JSON.stringify(inspComplete.json));

  const s11complete = await call('POST', `/projects/${projId}/stages/${s11}/advance`, { to_status: 'complete' }, pm);
  ok('stage 11 completes once its inspection passed', s11complete.status === 200, JSON.stringify(s11complete.json));

  // ── 2. Hold-point inspection FAIL leaves the stage blocked ──
  await call('POST', `/projects/${projId}/stages/${s12}/advance`, { to_status: 'in_progress' }, pm);
  const insp12 = await call('POST', `/projects/${projId}/inspections`, { type: 'frame', stage_id: s12 }, pm);
  const failComplete = await call('POST', `/projects/${projId}/inspections/${insp12.json.data.id}/complete`,
    { result: 'fail' }, inspTok);
  ok('inspector records a FAIL without needing quality.validate',
    failComplete.status === 200 && failComplete.json.data.validation === null, JSON.stringify(failComplete.json));
  const s12blocked = await call('POST', `/projects/${projId}/stages/${s12}/advance`, { to_status: 'complete' }, pm);
  ok('stage 12 still blocked after a failed hold-point inspection (STAGE_NOT_VALIDATED)',
    s12blocked.status === 409 && s12blocked.json.code === 'STAGE_NOT_VALIDATED', JSON.stringify(s12blocked.json));

  // A subsequent PASS on a NEW inspection against the same stage still validates it.
  const insp12b = await call('POST', `/projects/${projId}/inspections`, { type: 'frame', stage_id: s12 }, pm);
  const pass12b = await call('POST', `/projects/${projId}/inspections/${insp12b.json.data.id}/complete`,
    { result: 'pass' }, inspTok);
  ok('re-inspection PASS validates the stage', pass12b.json.data.validation?.is_validated === true, JSON.stringify(pass12b.json));

  // ── 4. QA (non-hold-point) inspection records without gating ──
  const qa = await call('POST', `/projects/${projId}/inspections`, { type: 'QA' }, pm);
  ok('QA inspection created with no stage, is_hold_point=false', qa.json.data.is_hold_point === false);
  const qaComplete = await call('POST', `/projects/${projId}/inspections/${qa.json.data.id}/complete`,
    { result: 'pass' }, pm); // PM's own quality.write is enough — no validate needed
  ok('PM completes a QA (non-hold-point) inspection directly (no validate call)',
    qaComplete.status === 200 && qaComplete.json.data.validation === null, JSON.stringify(qaComplete.json));

  // ── 5. Defects: sync-push gated by quality.write, provenance server-stamped ──
  const tradieDefect = await push(tradieTok, 'defects', 'create',
    { id: `def-${s}-1`, project_id: projId, location: 'Kitchen', description: 'Chipped tile' });
  ok('tradie CANNOT raise a defect (no quality.write)',
    tradieDefect.status === 403 && tradieDefect.json.code === 'FORBIDDEN', JSON.stringify(tradieDefect.json));

  const defId = `def-${s}-2`;
  const supDefect = await push(supTok, 'defects', 'create',
    { id: defId, project_id: projId, location: 'Bathroom', description: 'Loose tap', severity: 'low' });
  ok('siteSupervisor raises a defect (quality.write)', supDefect.status === 200 && supDefect.json.applied,
    JSON.stringify(supDefect.json));

  const defectsList1 = await call('GET', `/projects/${projId}/defects`, undefined, pm);
  const raised = defectsList1.json.data.defects.find((d) => d.id === defId);
  ok('defect raised_by is server-stamped to the pushing user, not device-set',
    raised && raised.raised_by && raised.raised_at, JSON.stringify(raised));

  await push(supTok, 'defects', 'update', { id: defId, status: 'closed' });
  const defectsList2 = await call('GET', `/projects/${projId}/defects?status=closed`, undefined, pm);
  const closed = defectsList2.json.data.defects.find((d) => d.id === defId);
  ok('defect closed_at/closed_by are server-stamped on closing status push',
    closed && closed.closed_at && closed.closed_by, JSON.stringify(closed));

  // ── 5b. PATCH /projects/:id/defects/:defectId — the Portal's own writer,
  // a second door onto the same row as §5's sync push ──
  const patchDefId = `def-${s}-3`;
  await push(supTok, 'defects', 'create',
    { id: patchDefId, project_id: projId, location: 'Laundry', description: 'Leaking pipe', severity: 'medium' });

  const tradiePatch = await call('PATCH', `/projects/${projId}/defects/${patchDefId}`, { status: 'in_progress' }, tradieTok);
  ok('tradie cannot PATCH a defect (no quality.write, 403)', tradiePatch.status === 403, JSON.stringify(tradiePatch.json));

  const emptyPatch = await call('PATCH', `/projects/${projId}/defects/${patchDefId}`, {}, pm);
  ok('an empty PATCH body is refused (400 NO_FIELDS)', emptyPatch.status === 400, JSON.stringify(emptyPatch.json));

  const badSeverity = await call('PATCH', `/projects/${projId}/defects/${patchDefId}`, { severity: 'extreme' }, pm);
  ok('an invalid severity is refused (422, express-validator gate)', badSeverity.status === 422);

  const inProgress = await call('PATCH', `/projects/${projId}/defects/${patchDefId}`, { status: 'in_progress', assigned_to_name: 'Bob the plumber' }, pm);
  ok('PM PATCHes status + assigned_to_name via Portal', inProgress.status === 200 && inProgress.json.data.status === 'in_progress', JSON.stringify(inProgress.json));

  const patchClosed = await call('PATCH', `/projects/${projId}/defects/${patchDefId}`, { status: 'closed' }, supTok);
  ok('siteSupervisor closes the defect via PATCH', patchClosed.status === 200, JSON.stringify(patchClosed.json));
  const afterClose = await call('GET', `/projects/${projId}/defects?status=closed`, undefined, pm);
  const closedViaPatch = afterClose.json.data.defects.find((d) => d.id === patchDefId);
  ok('closing via PATCH stamps closed_at/closed_by too — same QualityOpsService.afterPush stamp as the sync path',
    closedViaPatch && closedViaPatch.closed_at && closedViaPatch.closed_by, JSON.stringify(closedViaPatch));

  const unknownDefect = await call('PATCH', `/projects/${projId}/defects/00000000-0000-4000-8000-000000000000`, { status: 'open' }, pm);
  ok('PATCHing an unknown defect id is refused (404)', unknownDefect.status === 404, JSON.stringify(unknownDefect.json));

  // ── 6. Certificates: both app (inspector) and web (PM) surfaces may push ──
  const certApp = await push(inspTok, 'certificates', 'create', {
    id: `cert-${s}-app`, project_id: projId, type: 'BA2', reference: 'BA2-001',
    issued_at: '2026-07-01',
  });
  ok('inspector (app surface) may push a certificate', certApp.status === 200 && certApp.json.applied,
    JSON.stringify(certApp.json));

  const lapsing = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const certWeb = await push(pmWeb, 'certificates', 'create', {
    id: `cert-${s}-web`, project_id: projId, type: 'termite', reference: 'TC-77',
    issued_at: '2026-01-01', expires_at: lapsing,
  });
  ok('PM (web surface) may also push a certificate', certWeb.status === 200 && certWeb.json.applied,
    JSON.stringify(certWeb.json));

  const certs = await call('GET', `/projects/${projId}/certificates`, undefined, pm);
  const lapsingCert = certs.json.data.certificates.find((c) => c.id === `cert-${s}-web`);
  ok('certificate expiry read flags a cert lapsing within 30 days',
    !!(lapsingCert && Number(lapsingCert.lapsing_soon) === 1), JSON.stringify(lapsingCert));

  // ── 7. inspection_items — child-scoped via its parent inspection's project ──
  const itemId = `item-${s}`;
  const itemPush = await push(inspTok, 'inspection_items', 'create',
    { id: itemId, inspection_id: insp11Id, seq: 1, description: 'Reo spacing correct', result: 'pass' });
  ok('inspector pushes an inspection_item (project resolved via parent inspection)',
    itemPush.status === 200 && itemPush.json.applied, JSON.stringify(itemPush.json));

  const supItems = await pull(supTok, 'inspection_items');
  ok('a member (siteSupervisor) pull INCLUDES the item via parent-project derivation',
    supItems.some((c) => c.data.id === itemId), JSON.stringify(supItems.map((c) => c.data.id)));

  // A device in a DIFFERENT org must never reach it (org isolation on the parent join).
  const regB = await call('POST', '/auth/register', {
    organisation: { name: `Quality B ${s}` },
    user: { full_name: 'Other PM', email: `pmb${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pmb-${s}`, platform: 'android' },
  });
  const pmB = regB.json.data.accessToken;
  const itemsB = await pull(pmB, 'inspection_items');
  ok('a different ORG never receives this item (org isolation on the parent join)',
    !itemsB.some((c) => c.data.id === itemId), JSON.stringify(itemsB.map((c) => c.data.id)));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
