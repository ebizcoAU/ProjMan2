// Subcontractor engagement writer (xprojman-44 Module C). `subcontractor_engagements`
// (migration_v014) existed since the corrective migration but had no writer anywhere —
// this proves the new one: role_offered='subcontractor' Job Award acceptance creates
// the row, the Builder's own line-level list is scoped to his own awards, and consent
// recording is Builder-only, evidence-backed, and non-overwritable.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/subcontractor-engagement.test.js
const crypto = require('crypto');
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
async function postDoc(fields, bytes, token) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  fd.append('file', new Blob([bytes], { type: 'application/pdf' }), 'consent.pdf');
  const res = await fetch(`${BASE}/documents`, {
    method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: fd,
  });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), crypto.randomBytes(64)]);

(async () => {
  console.log(`Subcontractor engagement test → ${BASE}\n`);
  const s = Date.now();

  // ── Setup: PM org, a Builder, a project with a programme, PM→Builder award accepted ──
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `SubEng ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;

  const bReg = await call('POST', '/organisation/users', {
    email: `bob${s}@x.com`, full_name: 'Bob Builder', role: 'builder', password: 'hunter2hunter2',
  }, pm);
  const builderTok = (await call('POST', '/auth/login', { email: `bob${s}@x.com`, password: 'hunter2hunter2' })).json.data.accessToken;

  // A second Builder, to prove list-scoping never leaks across Builders.
  const b2Reg = await call('POST', '/organisation/users', {
    email: `bea${s}@x.com`, full_name: 'Bea Builder', role: 'builder', password: 'hunter2hunter2',
  }, pm);
  const builder2Tok = (await call('POST', '/auth/login', { email: `bea${s}@x.com`, password: 'hunter2hunter2' })).json.data.accessToken;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `SE-${s}`, name: 'Lot 9 dwelling' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);

  const introB = await call('POST', '/introductions/code', {}, builderTok);
  const pmScanB = await call('POST', '/introductions/scan', { code: introB.json.data.code }, pm);
  const builderUser = pmScanB.json.data.contact.user_id;

  const bAward = await call('POST', `/projects/${projId}/job-awards`,
    { to_user_id: builderUser, role_offered: 'builder', builder_engagement_type: 'independent_fixed' }, pm);
  await call('POST', `/projects/${projId}/job-awards/${bAward.json.data.id}/respond`, { accept: true }, builderTok);

  // ── A trade-role subcontractor, introduced to the Builder ──
  const tReg = await call('POST', '/organisation/users', {
    email: `tim${s}@x.com`, full_name: 'Tim Tradie', role: 'tradie', password: 'hunter2hunter2',
  }, pm);
  const tradieTok = (await call('POST', '/auth/login', { email: `tim${s}@x.com`, password: 'hunter2hunter2' })).json.data.accessToken;
  const introT = await call('POST', '/introductions/code', {}, tradieTok);
  const builderScanT = await call('POST', '/introductions/scan', { code: introT.json.data.code }, builderTok);
  const tradieUser = builderScanT.json.data.contact.user_id;

  // ── Module B/C: trade_offered mandatory for a subcontractor award ──
  const noTrade = await call('POST', `/projects/${projId}/job-awards`,
    { to_user_id: tradieUser, role_offered: 'subcontractor' }, builderTok);
  ok('subcontractor Job Award without trade_offered refused (VALIDATION_ERROR)',
    noTrade.status === 400 && noTrade.json.code === 'VALIDATION_ERROR', JSON.stringify(noTrade.json));

  const subAward = await call('POST', `/projects/${projId}/job-awards`,
    { to_user_id: tradieUser, role_offered: 'subcontractor', trade_offered: 'Electrical' }, builderTok);
  ok('Builder sends a subcontractor Job Award with a trade (201, status:sent)',
    subAward.status === 201 && subAward.json.data.status === 'sent', JSON.stringify(subAward.json));
  const saId = subAward.json.data.id;

  // ── Before acceptance: no engagement row exists yet, list is empty ──
  const preAccept = await call('GET', `/projects/${projId}/subcontractor-engagements`, undefined, builderTok);
  ok('no subcontractor_engagements row exists before acceptance',
    preAccept.status === 200 && (preAccept.json.data.subcontractor_engagements || []).length === 0,
    JSON.stringify(preAccept.json));

  const acceptSub = await call('POST', `/projects/${projId}/job-awards/${saId}/respond`, { accept: true }, tradieTok);
  ok('the tradie accepts the subcontractor award (200, status:accepted)',
    acceptSub.status === 200 && acceptSub.json.data.status === 'accepted', JSON.stringify(acceptSub.json));

  // ── Module C step 2: acceptance creates the subcontractor_engagements row ──
  const list1 = await call('GET', `/projects/${projId}/subcontractor-engagements`, undefined, builderTok);
  const rows1 = list1.json.data?.subcontractor_engagements || [];
  ok('accepting creates exactly one subcontractor_engagements row, trade carried through, consent unset',
    rows1.length === 1 && rows1[0].trade === 'Electrical'
      && String(rows1[0].subcontractor_user_id) === String(tradieUser)
      && Number(rows1[0].subcontractor_pass_through_consent) === 0
      && !rows1[0].consent_document_id, JSON.stringify(rows1));
  const engId = rows1[0].id;

  // ── Scoping: the PM (a project member, but never the from_user_id of a subcontractor
  // award — Module B fixes PM's role_offered to 'builder' only) sees none of this; this
  // is the aggregate PM view's job (ProcurementService.subcontractorRegister), not this one. ──
  const list2 = await call('GET', `/projects/${projId}/subcontractor-engagements`, undefined, pm);
  ok('the PM\'s own line-level list is empty (scoped to job_awards.from_user_id = caller, not project membership)',
    list2.status === 200 && (list2.json.data.subcontractor_engagements || []).length === 0, JSON.stringify(list2.json));

  // ── Consent recording: Builder-only, evidence-backed ──
  const wrongActor = await call('POST', `/projects/${projId}/subcontractor-engagements/${engId}/consent`,
    { document_id: crypto.randomUUID() }, builder2Tok);
  ok('a different Builder cannot record consent on someone else\'s engagement (FORBIDDEN)',
    wrongActor.status === 403 && wrongActor.json.code === 'FORBIDDEN', JSON.stringify(wrongActor.json));

  const fakeDoc = await call('POST', `/projects/${projId}/subcontractor-engagements/${engId}/consent`,
    { document_id: crypto.randomUUID() }, builderTok);
  ok('consent refused when document_id does not reference an uploaded subcontractor_engagement document (VALIDATION_ERROR)',
    fakeDoc.status === 400 && fakeDoc.json.code === 'VALIDATION_ERROR', JSON.stringify(fakeDoc.json));

  const upload = await postDoc(
    { client_ref: crypto.randomUUID(), entity_type: 'subcontractor_engagement', entity_id: engId, project_id: projId },
    PDF, builderTok
  );
  ok('the consent document uploads through the generic Documents pipeline',
    upload.status === 201, JSON.stringify(upload.json));
  const docId = upload.json.data.document_id;

  const consent1 = await call('POST', `/projects/${projId}/subcontractor-engagements/${engId}/consent`,
    { document_id: docId }, builderTok);
  ok('the engaging Builder records consent against the real uploaded document (200)',
    consent1.status === 200 && consent1.json.data.consent_document_id === docId, JSON.stringify(consent1.json));

  const list3 = await call('GET', `/projects/${projId}/subcontractor-engagements`, undefined, builderTok);
  const row3 = (list3.json.data.subcontractor_engagements || [])[0];
  ok('recording consent persists the document + timestamp AND sets the pass-through flag the PM register reads',
    row3.consent_document_id === docId && !!row3.consent_recorded_at
      && Number(row3.subcontractor_pass_through_consent) === 1, JSON.stringify(row3));

  const consent2 = await call('POST', `/projects/${projId}/subcontractor-engagements/${engId}/consent`,
    { document_id: docId }, builderTok);
  ok('a second consent recording is refused, not overwritten (ALREADY_RECORDED)',
    consent2.status === 409 && consent2.json.code === 'ALREADY_RECORDED', JSON.stringify(consent2.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
