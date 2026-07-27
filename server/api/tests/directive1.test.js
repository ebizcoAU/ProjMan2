// DIRECTIVE 1 acceptance — the corrective-migration surface (Steps A/A2/B/D/D2,
// servdesignspecification.md §7.2/§7.3, xprojman-01.md). These features did not exist
// in the P5/P6 build; this suite is their first-class coverage.
//
// Proves:
//   B1. Introduction (QR business-card swap): idempotent, self-introduction refused.
//   B2. Job Award cold-stranger constraint — no award without a prior introduction.
//   B3. builder_engagement_type is mandatory when role_offered='builder' (Step A2, set
//       once at S9.6).
//   B4. respond authz — only the invited person may respond; accepting auto-enrols.
//   B5. deposit — binding only on an accepted award; idempotent (no double-charge).
//   A1. tick-then-verify — a completion push needs progress.tick; a create at the
//       default completion:0 is NOT a tick; Site Supervisor verifies (protected
//       verified_by/at); PM cannot verify; verifying an unticked task is refused.
//   A2. verified_by/verified_at are not device-writable via sync.
//   D2. hold-point satisfy authz — a row is satisfied only by the authority it names.
//   D1. deactivation-not-erasure — DELETE deactivates, revokes sessions, is idempotent,
//       and the last admin is protected.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/directive1.test.js
const crypto = require('crypto');
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
  console.log(`DIRECTIVE 1 test → ${BASE}\n`);
  const s = Date.now();

  // ── Setup: PM org, a second real user (the Builder), a project with a programme ──
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Directive1 ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;

  const bReg = await call('POST', '/organisation/users', {
    email: `bob${s}@x.com`, full_name: 'Bob Builder', role: 'builder', password: 'hunter2hunter2',
  }, pm);
  const builderUser = bReg.json.data.user.id;
  const builderTok = (await call('POST', '/auth/login', { email: `bob${s}@x.com`, password: 'hunter2hunter2' })).json.data.accessToken;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `D1-${s}`, name: 'Lot 3 dwelling' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const bySeq = (n) => detail.json.data.stages.find((st) => st.seq === n);

  // ── B2. Cold-stranger constraint: a Job Award before any introduction is refused ──
  const noIntro = await call('POST', `/projects/${projId}/job-awards`,
    { to_user_id: builderUser, role_offered: 'builder', builder_engagement_type: 'independent_fixed' }, pm);
  ok('Job Award to a not-yet-introduced user refused (NO_INTRODUCTION)',
    noIntro.status === 409 && noIntro.json.code === 'NO_INTRODUCTION', JSON.stringify(noIntro.json));

  // ── B1. Introduction via the QR code/scan swap (confirmed contract, xprojman-04 §A) ──
  const badScan = await call('POST', '/introductions/scan', { code: 'not-a-real-code' }, pm);
  ok('a forged/garbage code is refused (INVALID_CODE)',
    badScan.status === 400 && badScan.json.code === 'INVALID_CODE', JSON.stringify(badScan.json));

  // The Builder mints their own QR code; the PM scans it → records the introduction.
  const code = await call('POST', '/introductions/code', {}, builderTok);
  ok('issuer mints a short-lived introduction code', code.status === 200 && !!code.json.data.code,
    JSON.stringify(code.json));

  const selfScan = await call('POST', '/introductions/scan', { code: code.json.data.code }, builderTok);
  ok('cannot scan your own code (self-introduction refused)',
    selfScan.status === 400 || selfScan.status === 422, JSON.stringify(selfScan.json));

  const scan1 = await call('POST', '/introductions/scan', { code: code.json.data.code }, pm);
  ok('scanning the code records the introduction (201, alreadyIntroduced:false, contact returned)',
    scan1.status === 201 && scan1.json.data.alreadyIntroduced === false
      && String(scan1.json.data.contact.user_id) === String(builderUser), JSON.stringify(scan1.json));
  const scan2 = await call('POST', '/introductions/scan', { code: code.json.data.code }, pm);
  ok('re-scanning is idempotent (200, alreadyIntroduced:true)',
    scan2.status === 200 && scan2.json.data.alreadyIntroduced === true, JSON.stringify(scan2.json));

  const contacts = await call('GET', '/introductions', undefined, pm);
  ok('the introduction appears in the PM\'s contact book',
    (contacts.json.data.contacts || []).some((c) => String(c.user_id) === String(builderUser)),
    JSON.stringify(contacts.json));

  // ── B3. builder_engagement_type is mandatory for a builder award ──
  const noEng = await call('POST', `/projects/${projId}/job-awards`,
    { to_user_id: builderUser, role_offered: 'builder' }, pm);
  ok('builder Job Award without engagement type refused (VALIDATION_ERROR)',
    noEng.status === 422 || noEng.status === 400, JSON.stringify(noEng.json));

  // ── B2 (cont). With the introduction present, the award sends ──
  const award = await call('POST', `/projects/${projId}/job-awards`,
    { to_user_id: builderUser, role_offered: 'builder', builder_engagement_type: 'independent_fixed' }, pm);
  ok('Job Award sends once an introduction exists (201, status:sent)',
    award.status === 201 && award.json.data.status === 'sent', JSON.stringify(award.json));
  const jaId = award.json.data.id;

  // ── B4. respond authz — only the invited person; accepting auto-enrols ──
  const pmRespond = await call('POST', `/projects/${projId}/job-awards/${jaId}/respond`, { accept: true }, pm);
  ok('the PM (not the invitee) CANNOT respond to the award (FORBIDDEN)',
    pmRespond.status === 403 && pmRespond.json.code === 'FORBIDDEN', JSON.stringify(pmRespond.json));
  const accept = await call('POST', `/projects/${projId}/job-awards/${jaId}/respond`, { accept: true }, builderTok);
  ok('the invited Builder accepts (200, status:accepted)',
    accept.status === 200 && accept.json.data.status === 'accepted', JSON.stringify(accept.json));
  const members = await call('GET', `/projects/${projId}/members`, undefined, pm);
  ok('accepting auto-enrolled the Builder into project_members',
    (members.json.data.members || []).some((m) => String(m.user_id) === String(builderUser)), JSON.stringify(members.json));
  const reRespond = await call('POST', `/projects/${projId}/job-awards/${jaId}/respond`, { accept: false }, builderTok);
  ok('a second response is refused (ALREADY_RESPONDED)',
    reRespond.status === 409 && reRespond.json.code === 'ALREADY_RESPONDED', JSON.stringify(reRespond.json));

  // ── B5. deposit — binding only on an accepted award, idempotent ──
  const dep1 = await call('POST', `/projects/${projId}/job-awards/${jaId}/deposit`, { amount: 5000, reference: 'DEP-1' }, pm);
  ok('deposit recorded against the accepted award (201)',
    dep1.status === 201 && !!dep1.json.data.deposit_payment_id, JSON.stringify(dep1.json));
  const dep2 = await call('POST', `/projects/${projId}/job-awards/${jaId}/deposit`, { amount: 5000 }, pm);
  ok('a second deposit is refused (ALREADY_RECORDED)',
    dep2.status === 409 && dep2.json.code === 'ALREADY_RECORDED', JSON.stringify(dep2.json));

  // ── A1. tick-then-verify on tasks ──
  const stage1 = bySeq(1).id;
  const foreTok = await pairAs(pm, pmUser, 'foreperson', `fore-${s}`);   // has progress.tick
  const supTok = await pairAs(pm, pmUser, 'siteSupervisor', `sup-${s}`);  // has progress.verify
  const taskId = crypto.randomUUID();

  // A create at the default completion:0 is not a "tick" — a role without progress.tick
  // may still author the task row (closes the old any-device-writes-tasks gap without
  // over-blocking). siteSupervisor has progress.verify but NOT progress.tick.
  const create0 = await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'create',
    data: { id: taskId, project_id: projId, stage_id: stage1, name: 'Set out', completion: 0, updated_at: Date.now() },
  }, supTok);
  ok('a task create at completion:0 is not a tick (applies without progress.tick)',
    create0.status === 200 && create0.json.applied === true, JSON.stringify(create0.json));

  const supTick = await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'update',
    data: { id: taskId, completion: 100, updated_at: Date.now() },
  }, supTok);
  ok('siteSupervisor (no progress.tick) CANNOT tick a task to complete (FORBIDDEN)',
    supTick.status === 403 && supTick.json.code === 'FORBIDDEN', JSON.stringify(supTick.json));

  const foreTick = await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'update',
    data: { id: taskId, completion: 100, updated_at: Date.now() },
  }, foreTok);
  ok('foreperson (progress.tick) ticks the task to 100', foreTick.status === 200 && foreTick.json.applied === true,
    JSON.stringify(foreTick.json));

  const pmVerify = await call('POST', `/projects/${projId}/tasks/${taskId}/verify`, {}, pm);
  ok('projectManager CANNOT verify (no progress.verify)',
    pmVerify.status === 403 && pmVerify.json.code === 'FORBIDDEN', JSON.stringify(pmVerify.json));

  const supVerify = await call('POST', `/projects/${projId}/tasks/${taskId}/verify`, {}, supTok);
  ok('siteSupervisor verifies the ticked task (stamps verified_by)',
    supVerify.status === 200 && String(supVerify.json.data.verified_by) === String(pmUser), JSON.stringify(supVerify.json));

  // Verifying an unticked task is refused.
  const taskId2 = crypto.randomUUID();
  await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'create',
    data: { id: taskId2, project_id: projId, stage_id: stage1, name: 'Trench', completion: 0, updated_at: Date.now() },
  }, foreTok);
  const earlyVerify = await call('POST', `/projects/${projId}/tasks/${taskId2}/verify`, {}, supTok);
  ok('verifying an unticked task is refused (TASK_NOT_TICKED)',
    earlyVerify.status === 409 && earlyVerify.json.code === 'TASK_NOT_TICKED', JSON.stringify(earlyVerify.json));

  // ── A2. verified_by is not device-writable via sync ──
  await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'update',
    data: { id: taskId2, completion: 100, verified_by: builderUser, verified_at: '2020-01-01', updated_at: Date.now() },
  }, foreTok);
  const pull = await call('GET', '/sync/pull?since=0', undefined, pm);
  const t2 = (pull.json.changes || []).map((c) => c.data).find((d) => d && d.id === taskId2);
  ok('device cannot self-stamp verified_by via sync (protected column)',
    !t2 || !t2.verified_by, JSON.stringify(t2 || {}));

  // ── D2. hold-point satisfy authz — only the authority the ROW names ──
  await call('POST', `/projects/${projId}/stages/${stage1}/advance`, { to_status: 'in_progress' }, pm);
  // Stage 10 seeds a siteSupervisor-required survey set-out row (blocks_progress). A
  // foreperson (wrong authority) cannot satisfy it; the siteSupervisor can.
  const s10 = bySeq(10).id;
  const hp = await call('GET', `/projects/${projId}/stages/${s10}/hold-points`, undefined, pm);
  const setout = hp.json.data.requirements.find((r) => r.blocks_progress === 1);
  ok('Stage 10 seeded a blocking hold-point requirement (S10.5)', !!setout, JSON.stringify(hp.json));
  const wrongSat = await call('POST', `/projects/${projId}/stages/${s10}/hold-points/${setout.id}/satisfy`, {}, foreTok);
  ok('a foreperson CANNOT satisfy a siteSupervisor-required hold point (FORBIDDEN)',
    wrongSat.status === 403 && wrongSat.json.code === 'FORBIDDEN', JSON.stringify(wrongSat.json));
  const rightSat = await call('POST', `/projects/${projId}/stages/${s10}/hold-points/${setout.id}/satisfy`, {}, supTok);
  ok('the siteSupervisor satisfies it', rightSat.status === 200, JSON.stringify(rightSat.json));

  // ── D1. deactivation-not-erasure ──
  const del = await call('DELETE', `/organisation/users/${builderUser}`, undefined, pm);
  ok('DELETE deactivates the user (not erased)', del.status === 200 && del.json.data.deactivated === true,
    JSON.stringify(del.json));
  const builderAfter = await call('GET', '/projects', undefined, builderTok);
  ok('the deactivated user\'s session is rejected (401 revoked / 403 DISABLED)',
    builderAfter.status === 401 || (builderAfter.status === 403 && builderAfter.json.code === 'DISABLED'),
    JSON.stringify(builderAfter.json));
  const stillListed = await call('GET', '/organisation/users', undefined, pm);
  ok('the deactivated user is retained in the directory (evidence, not erased)',
    (stillListed.json.data?.users || []).some((u) => String(u.id) === String(builderUser)), '');
  const delAgain = await call('DELETE', `/organisation/users/${builderUser}`, undefined, pm);
  ok('a second deactivation is refused (ALREADY_DEACTIVATED)',
    delAgain.status === 409 && delAgain.json.code === 'ALREADY_DEACTIVATED', JSON.stringify(delAgain.json));
  const selfDelete = await call('DELETE', `/organisation/users/${pmUser}`, undefined, pm);
  ok('the last admin cannot be deactivated', selfDelete.status >= 400, JSON.stringify(selfDelete.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
