// Safety/OHS (xprojman-48 as ruled §7.1 + agreed §8, migration v048).
//   1. Permissions: matrix v16; safety.report raises (tradie, Builder); safety.manage changes.
//   2. Raise offline: server stamps raised_by/raised_at; list shape (raised_by {id,name},
//      counts, no incident details); the Builder gets the list but not the detail (F7).
//   3. incident_details: create-only over sync, never pulled, CREATE_ONLY on update; detail
//      shows it to manage + the reporter; REST correction is audited.
//   4. Notifiable: create-only flag on sync; the event becomes append-only (SAFETY_FROZEN);
//      REST PATCH still works (audited); notified_at + regulator_reference.
//   5. Actions: add (event → in_progress), close stamps; event close blocked while any
//      action is open (SAFETY_OPEN_ACTIONS, details.action_ids) on REST and sync.
//   6. Summary trend, inductions register (valid/expiring/expired), induction_ok derived at
//      check-in, SWMS sign-on via signoffs + the register kind filter on /documents.
//
// Run: EMAIL_ENABLED=false DB_NAME=c1projman2_e2e DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 node tests/safety.test.js
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
async function upload(tok, fields) {
  const fd = new FormData();
  fd.append('client_ref', crypto.randomUUID());
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), crypto.randomBytes(64)]);
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'swms.pdf');
  const res = await fetch(`${BASE}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}
const uuid = () => crypto.randomUUID();
const isoDay = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

(async () => {
  console.log(`Safety test → ${BASE}\n`);
  const s = Date.now();

  const pmEmail = `pm${s}@x.com`;
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Safety ${s}` },
    user: { full_name: 'Pat PM', email: pmEmail, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;
  const pmWeb = (await call('POST', '/auth/login', { email: pmEmail, password: 'hunter2hunter2' })).json.data.accessToken;

  const proj = await call('POST', '/projects', { code: `SF-${s}`, name: 'Lot 21 dwelling' }, pm);
  const projId = proj.json.data.id;

  const tradie = await pairAs(pm, pmUser, 'tradie', `tra-${s}`);
  const sup = await pairAs(pm, pmUser, 'siteSupervisor', `sup-${s}`);

  // A Builder engaged on the project (member) — F7 list only.
  await call('POST', '/organisation/users', {
    email: `bob${s}@x.com`, full_name: 'Bob Builder', role: 'builder', password: 'hunter2hunter2',
  }, pm);
  const builder = (await call('POST', '/auth/login', { email: `bob${s}@x.com`, password: 'hunter2hunter2' })).json.data.accessToken;
  const intro = await call('POST', '/introductions/code', {}, builder);
  const builderUser = (await call('POST', '/introductions/scan', { code: intro.json.data.code }, pm)).json.data.contact.user_id;
  const award = await call('POST', `/projects/${projId}/job-awards`,
    { to_user_id: builderUser, role_offered: 'builder', builder_engagement_type: 'independent_fixed' }, pm);
  await call('POST', `/projects/${projId}/job-awards/${award.json.data.id}/respond`, { accept: true }, builder);

  // ── 1. Permissions ──
  const perms = await call('GET', '/auth/permissions', undefined, tradie);
  ok('matrix v16; tradie holds safety.report but not safety.manage',
    perms.json.data?.matrixVersion === 16 && perms.json.data.permissions.includes('safety.report')
      && !perms.json.data.permissions.includes('safety.manage'), JSON.stringify(perms.json.data?.matrixVersion));

  // ── 2. Raise ──
  const hazardId = uuid();
  const raise = await push(tradie, 'safety_events', 'create', {
    id: hazardId, project_id: projId, kind: 'hazard', description: 'Open trench, no barrier', location: 'Front boundary',
    severity: 'medium', raised_by: 'forged-user',
  });
  ok('a tradie raises a hazard offline', raise.status === 200 && raise.json.applied === true, JSON.stringify(raise.json));

  const badKind = await push(tradie, 'safety_events', 'create', { id: uuid(), project_id: projId, kind: 'rumour', description: 'x' });
  ok('an unknown kind is refused', badKind.status === 400, JSON.stringify(badKind.json));

  const tradieEdit = await push(tradie, 'safety_events', 'update', { id: hazardId, severity: 'high' });
  ok('after raising, a tradie cannot change the event (safety.manage)', tradieEdit.status === 403, JSON.stringify(tradieEdit.json));

  const list = await call('GET', `/projects/${projId}/safety-events`, undefined, pmWeb);
  const row = (list.json.data?.safety_events || []).find((e) => e.id === hazardId);
  ok('list row: raised_by is {id,name} (server-stamped, not forged), counts present, no incident details',
    row && row.raised_by?.id === pmUser && row.raised_by?.name === 'Pat PM' && !!row.raised_at
      && row.open_action_count === 0 && !('incident_details' in row), JSON.stringify(row));

  const bList = await call('GET', `/projects/${projId}/safety-events`, undefined, builder);
  const bDetail = await call('GET', `/safety-events/${hazardId}`, undefined, builder);
  ok('F7: the Builder gets the read-only list but not the detail',
    bList.status === 200 && bList.json.data.safety_events.length >= 1 && bDetail.status === 403,
    JSON.stringify([bList.status, bDetail.status]));

  // ── 3. incident_details ──
  const incId = uuid();
  await push(tradie, 'safety_events', 'create', {
    id: incId, project_id: projId, kind: 'incident', description: 'Cut hand on sheet metal', severity: 'medium',
  });
  const detId = uuid();
  const det = await push(tradie, 'incident_details', 'create', {
    id: detId, event_id: incId, injured_name: 'J. Nguyen', injury_type: 'Laceration', body_part: 'Hand', treatment: 'first_aid',
  });
  ok('incident details push (create)', det.status === 200 && det.json.applied === true, JSON.stringify(det.json));
  const detUpd = await push(tradie, 'incident_details', 'update', { id: detId, body_part: 'Wrist' });
  ok('incident details are create-only over sync (CREATE_ONLY)',
    detUpd.status === 409 && detUpd.json.code === 'CREATE_ONLY', JSON.stringify(detUpd.json));
  const pulled = await call('GET', '/sync/pull?since=0', undefined, sup);
  ok('incident details are never pulled',
    !(pulled.json.changes || []).some((c) => c.table_name === 'incident_details')
      && (pulled.json.changes || []).some((c) => c.table_name === 'safety_events'), `n=${(pulled.json.changes || []).length}`);
  const supDetail = await call('GET', `/safety-events/${incId}`, undefined, pmWeb);
  ok('detail shows incident details to safety.manage', supDetail.json.data?.safety_event?.incident_details?.injured_name === 'J. Nguyen',
    JSON.stringify(supDetail.json).slice(0, 300));
  const fix = await call('PATCH', `/safety-events/${incId}/incident-details`, { body_part: 'Wrist' }, pmWeb);
  ok('REST correction of incident details works (audited)', fix.status === 200 && fix.json.data?.body_part === 'Wrist',
    JSON.stringify(fix.json));

  // ── 4. Notifiable ──
  const notId = uuid();
  const notif = await push(tradie, 'safety_events', 'create', {
    id: notId, project_id: projId, kind: 'incident', description: 'Fall from scaffold', severity: 'high', is_notifiable: 1,
  });
  ok('a notifiable incident is recorded', notif.status === 200, JSON.stringify(notif.json));
  const frozen = await push(sup, 'safety_events', 'update', { id: notId, severity: 'medium' });
  ok('a notifiable event is append-only on sync (SAFETY_FROZEN), even for safety.manage',
    frozen.status === 409 && frozen.json.code === 'SAFETY_FROZEN', JSON.stringify(frozen.json));
  const restFix = await call('PATCH', `/safety-events/${notId}`, { location: 'Scaffold bay 3' }, pmWeb);
  ok('REST correction of a notifiable event still works', restFix.status === 200 && restFix.json.data.location === 'Scaffold bay 3',
    JSON.stringify(restFix.json));
  const reg1 = await call('PATCH', `/safety-events/${notId}/notifiable`,
    { notified_at: '2026-09-30 10:15:00', regulator_reference: 'WS-12345' }, pmWeb);
  ok('notified_at + regulator_reference recorded', reg1.json.data?.safety_event?.regulator_reference === 'WS-12345'
    && reg1.json.data?.safety_event?.notified_at === '2026-09-30 10:15:00', JSON.stringify(reg1.json).slice(0, 300));
  const regZ = await call('PATCH', `/safety-events/${notId}/notifiable`, { notified_at: '2026-10-14T01:00:00.000Z' }, pmWeb);
  ok('notified_at ISO Z is stored as Perth wall-clock', regZ.json.data?.safety_event?.notified_at === '2026-10-14 09:00:00',
    JSON.stringify(regZ.json).slice(0, 300));
  const regOff = await call('PATCH', `/safety-events/${notId}/notifiable`, { notified_at: '2026-10-14T12:00:00+10:00' }, pmWeb);
  ok('notified_at with an offset is stored as Perth wall-clock', regOff.json.data?.safety_event?.notified_at === '2026-10-14 10:00:00',
    JSON.stringify(regOff.json).slice(0, 300));
  const regBad = await call('PATCH', `/safety-events/${notId}/notifiable`, { notified_at: 'yesterday-ish' }, pmWeb);
  ok('an unparseable notified_at is a 400', regBad.status === 400, JSON.stringify(regBad.json));
  const flagEdit = await push(sup, 'safety_events', 'update', { id: hazardId, is_notifiable: 1 });
  const hz = (await call('GET', `/safety-events/${hazardId}`, undefined, pmWeb)).json.data.safety_event;
  ok('is_notifiable is create-only on sync (an update push does not set it)',
    flagEdit.status === 200 && hz.is_notifiable === 0, JSON.stringify([flagEdit.json, hz.is_notifiable]));
  const confirm = await call('PATCH', `/safety-events/${hazardId}/notifiable`, { is_notifiable: false }, pmWeb);
  ok('REST confirm/clear stamps notifiable_confirmed_by', confirm.json.data?.safety_event?.notifiable_confirmed_by?.id === pmUser,
    JSON.stringify(confirm.json).slice(0, 200));

  // ── 5. Actions + close ──
  const act = await call('POST', `/safety-events/${hazardId}/actions`,
    { action: 'Install barrier mesh', assigned_to_name: 'Crew lead', due_date: isoDay(-1) }, pmWeb);
  ok('an action is added (201)', act.status === 201 && act.json.data.status === 'open', JSON.stringify(act.json));
  const afterAct = (await call('GET', `/safety-events/${hazardId}`, undefined, pmWeb)).json.data.safety_event;
  ok('adding an action moves the event to in_progress', afterAct.status === 'in_progress' && afterAct.actions.length === 1,
    JSON.stringify(afterAct.status));
  const listCounts = (await call('GET', `/projects/${projId}/safety-events?kind=hazard`, undefined, pmWeb)).json.data.safety_events
    .find((e) => e.id === hazardId);
  ok('list shows open + overdue action counts', listCounts.open_action_count === 1 && listCounts.overdue_action_count === 1,
    JSON.stringify(listCounts));
  const earlyClose = await call('POST', `/safety-events/${hazardId}/close`, { close_note: 'done' }, pmWeb);
  ok('REST close with an open action → SAFETY_OPEN_ACTIONS (details.action_ids)',
    earlyClose.status === 409 && earlyClose.json.code === 'SAFETY_OPEN_ACTIONS'
      && earlyClose.json.details.action_ids[0] === act.json.data.id, JSON.stringify(earlyClose.json));
  const syncClose = await push(sup, 'safety_events', 'update', { id: hazardId, status: 'closed' });
  ok('sync close hits the same rule', syncClose.status === 409 && syncClose.json.code === 'SAFETY_OPEN_ACTIONS',
    JSON.stringify(syncClose.json));
  const closeAct = await call('PATCH', `/safety-actions/${act.json.data.id}`, { status: 'closed' }, pmWeb);
  ok('closing the action stamps closed_by {id,name}', closeAct.json.data?.closed_by?.id === pmUser && !!closeAct.json.data.closed_at,
    JSON.stringify(closeAct.json));
  const close = await call('POST', `/safety-events/${hazardId}/close`, { close_note: 'Barrier installed' }, pmWeb);
  const closed = (await call('GET', `/safety-events/${hazardId}`, undefined, pmWeb)).json.data.safety_event;
  ok('the event closes and stamps closed_by/closed_at', close.status === 200 && closed.status === 'closed'
    && closed.closed_by?.id === pmUser && closed.close_note === 'Barrier installed', JSON.stringify(closed).slice(0, 300));

  // ── 6. Summary, inductions, attendance, SWMS ──
  const sum = await call('GET', `/safety/summary?project_id=${projId}`, undefined, pmWeb);
  ok('summary trend shape', sum.status === 200 && sum.json.data.totals.by_kind.incident === 2
    && sum.json.data.notifiable_count === 1 && sum.json.data.series.length >= 1, JSON.stringify(sum.json).slice(0, 300));
  const tradieSum = await call('GET', '/safety/summary', undefined, tradie);
  ok('summary is safety.manage only', tradieSum.status === 403, JSON.stringify(tradieSum.json));

  const ind1 = await push(sup, 'site_inductions', 'create',
    { id: uuid(), project_id: projId, user_id: pmUser, inducted_at: '2026-09-01 08:00:00', expires_at: isoDay(120) });
  await push(sup, 'site_inductions', 'create',
    { id: uuid(), project_id: projId, name: 'Visitor Val', inducted_at: '2026-06-01 08:00:00', expires_at: isoDay(5) });
  await push(sup, 'site_inductions', 'create',
    { id: uuid(), project_id: projId, name: 'Old Olly', inducted_at: '2026-01-01 08:00:00', expires_at: isoDay(-3) });
  const tradieInd = await push(tradie, 'site_inductions', 'create',
    { id: uuid(), project_id: projId, name: 'x', inducted_at: '2026-09-01 08:00:00' });
  ok('a Site Supervisor inducts; a tradie cannot', ind1.status === 200 && tradieInd.status === 403,
    JSON.stringify([ind1.json, tradieInd.json]));
  const regAll = await call('GET', `/projects/${projId}/site-inductions`, undefined, pmWeb);
  const st = Object.fromEntries((regAll.json.data?.site_inductions || []).map((i) => [i.name, i.status]));
  ok('inductions register computes valid / expiring / expired',
    st['Pat PM'] === 'valid' && st['Visitor Val'] === 'expiring' && st['Old Olly'] === 'expired', JSON.stringify(st));

  const attOk = uuid(); const attNo = uuid();
  await push(sup, 'site_attendance', 'create', { id: attOk, project_id: projId, person_id: pmUser, person_name: 'Pat PM',
    check_in_at: '2026-09-30 07:00:00', method: 'supervisor', induction_ok: 0 });
  await push(sup, 'site_attendance', 'create', { id: attNo, project_id: projId, person_name: 'Old Olly',
    check_in_at: '2026-09-30 07:05:00', method: 'supervisor', induction_ok: 1 });
  const attPull = (await call('GET', '/sync/pull?since=0', undefined, pm)).json.changes || [];
  const aOk = attPull.find((c) => c.table_name === 'site_attendance' && c.server_id === attOk)?.data;
  const aNo = attPull.find((c) => c.table_name === 'site_attendance' && c.server_id === attNo)?.data;
  ok('induction_ok is server-derived at check-in (device value ignored; expired = 0), sign-in not blocked',
    aOk?.induction_ok === 1 && aNo?.induction_ok === 0, JSON.stringify([aOk?.induction_ok, aNo?.induction_ok]));

  const swms = await upload(pmWeb, { entity_type: 'project', entity_id: projId, project_id: projId, kind: 'swms' });
  const sds = await upload(pmWeb, { entity_type: 'project', entity_id: projId, project_id: projId, kind: 'sds' });
  ok('SWMS + SDS upload as register documents', swms.status === 201 && sds.status === 201, JSON.stringify([swms.json, sds.json]));
  const regDocs = await call('GET', `/documents?project_id=${projId}&kind=swms,sds`, undefined, pmWeb);
  const onlySwms = await call('GET', `/documents?project_id=${projId}&kind=swms`, undefined, pmWeb);
  ok('kind filter on /documents (comma list)', (regDocs.json.data?.documents || []).length === 2
    && (onlySwms.json.data?.documents || []).length === 1, JSON.stringify(regDocs.json).slice(0, 200));

  const swmsSign = await push(tradie, 'signoffs', 'create', {
    id: uuid(), subject_type: 'swms', subject_id: swms.json.data.document_id, project_id: projId,
    user_id: pmUser, signed_at: '2026-09-30 07:10:00',
  });
  const badSwms = await push(tradie, 'signoffs', 'create', {
    id: uuid(), subject_type: 'swms', subject_id: sds.json.data.document_id, project_id: projId,
    name: 'x', signed_at: '2026-09-30 07:10:00',
  });
  ok('a worker signs on to the SWMS; a non-SWMS subject is refused', swmsSign.status === 200 && badSwms.status === 422,
    JSON.stringify([swmsSign.json, badSwms.json]));
  const signs = await call('GET',
    `/projects/${projId}/signoffs?subject_type=swms&subject_id=${swms.json.data.document_id}`, undefined, pmWeb);
  ok('SWMS sign-on status read', (signs.json.data?.signoffs || []).length === 1 && signs.json.data.signoffs[0].name === 'Pat PM',
    JSON.stringify(signs.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
