// Site-ops acceptance — diary · attendance · deliveries (servdesignspec §11).
//
// Proves:
//   1. Diary lifecycle: draft is mutable; finalise stamps provenance; a FINAL entry is
//      immutable (DIARY_FINAL on edit AND delete); a correction is a NEW version that
//      retires the prior (is_current flips) — §11.4.
//   2. Sign-off authority: foreperson may write a draft (diary.write) but NOT finalise
//      (diary.signoff) — §11.6.
//   3. Geofence: server-derived geo_verified — pass (inside), fail (outside), degrade
//      (no coords → NULL, never blocks) — §11.5.
//   4. Attendance self-vs-site: a tradie (attendance.write.own) may record only its own
//      check-in; a siteSupervisor (write.site) may muster anyone — §11.6.
//   5. Deliveries: received_by is server-stamped; write needs deliveries.write.
//   6. Project-scoped pull/push: a member reaches only its project's rows; a non-member
//      push is refused (NOT_MEMBER) until enrolled — §11.6 / §9.4.
//   7. No financial redaction interferes (site-ops carries no money columns).
//
// Writes ride /sync/push (offline-first). Verification pulls come from a SEPARATE
// device (the echo-skip means a device never re-pulls its own writes).
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/siteops.test.js
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
const rowById = (rows, id) => rows.find((c) => c.server_id === id || c.data?.id === id);

(async () => {
  console.log(`Site-ops test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Site ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;         // REST admin (projects, users, pairing)
  const pmUser = reg.json.data.user.id;

  // Devices bound to the PM user (member of everything the PM owns). Writers vs a
  // reader — a device never re-pulls its own writes, so verification needs its own.
  const writer = await pairAs(pm, pmUser, 'projectManager', `w-${s}`);   // all perms
  const reader = await pairAs(pm, pmUser, 'projectManager', `r-${s}`);   // money.read
  const fp     = await pairAs(pm, pmUser, 'foreperson',     `fp-${s}`);  // diary.write, no signoff
  const tradie = await pairAs(pm, pmUser, 'tradie',         `tr-${s}`);  // attendance.write.own only
  const sup    = await pairAs(pm, pmUser, 'siteSupervisor', `sup-${s}`); // attendance.write.site

  // Two projects (PM auto-enrolled as creator). A geofence on A.
  const pa = await call('POST', '/projects', { code: `A-${s}`, name: 'Ocean Views' }, pm);
  const projA = pa.json.data.id;
  const pb = await call('POST', '/projects', { code: `B-${s}`, name: 'Hilltop' }, pm);
  const projB = pb.json.data.id;
  const geo = await call('PATCH', `/projects/${projA}`,
    { geofence_lat: -31.950000, geofence_lng: 115.860000, geofence_radius_m: 200 }, pm);
  ok('geofence set on project A (web-owned)', geo.status === 200, JSON.stringify(geo.json));

  // ── 1. Diary lifecycle + immutability ──────────────────────────────────────
  const d1 = `diary-${s}-1`;
  const c1 = await push(writer, 'site_diary', 'create',
    { id: d1, project_id: projA, entry_date: '2026-07-20', status: 'draft', work_done: 'Framing L2' });
  ok('diary draft create applies', c1.status === 200 && c1.json.applied, JSON.stringify(c1.json));

  let dA = rowById(await pull(reader, 'site_diary'), d1);
  ok('author_id server-stamped to the writing user', dA?.data?.author_id === pmUser, JSON.stringify(dA?.data));
  ok('draft has no finalise stamp + is_current=1',
    dA?.data?.status === 'draft' && !dA?.data?.finalised_at && dA?.data?.is_current === 1);

  const e1 = await push(writer, 'site_diary', 'update', { id: d1, notes: 'crane on site am' });
  ok('draft is mutable', e1.status === 200 && e1.json.applied, JSON.stringify(e1.json));

  const f1 = await push(writer, 'site_diary', 'update', { id: d1, status: 'final' });
  ok('finalise applies (diary.signoff)', f1.status === 200 && f1.json.applied, JSON.stringify(f1.json));
  dA = rowById(await pull(reader, 'site_diary'), d1);
  ok('finalise stamps finalised_at + finalised_by',
    dA?.data?.status === 'final' && !!dA?.data?.finalised_at && dA?.data?.finalised_by === pmUser,
    JSON.stringify(dA?.data));

  const badEdit = await push(writer, 'site_diary', 'update', { id: d1, notes: 'sneaky rewrite' });
  ok('a FINAL entry cannot be edited (DIARY_FINAL)',
    badEdit.status === 409 && badEdit.json.code === 'DIARY_FINAL', JSON.stringify(badEdit.json));
  const badDel = await push(writer, 'site_diary', 'delete', { id: d1 });
  ok('a FINAL entry cannot be deleted (DIARY_FINAL)',
    badDel.status === 409 && badDel.json.code === 'DIARY_FINAL', JSON.stringify(badDel.json));

  // Correction = a NEW version that retires the prior as current.
  const d2 = `diary-${s}-2`;
  const c2 = await push(writer, 'site_diary', 'create',
    { id: d2, project_id: projA, entry_date: '2026-07-20', version: 2, supersedes_id: d1,
      status: 'draft', work_done: 'Framing L2 — corrected headcount' });
  ok('a superseding version can be created', c2.status === 200 && c2.json.applied, JSON.stringify(c2.json));
  const diaryRows = await pull(reader, 'site_diary');
  ok('prior version retired (is_current=0), new version current (is_current=1)',
    rowById(diaryRows, d1)?.data?.is_current === 0 && rowById(diaryRows, d2)?.data?.is_current === 1,
    JSON.stringify(diaryRows.map((r) => ({ id: r.data.id, v: r.data.version, cur: r.data.is_current }))));

  // ── 2. Sign-off authority (foreperson) ─────────────────────────────────────
  const d3 = `diary-${s}-3`;
  const c3 = await push(fp, 'site_diary', 'create',
    { id: d3, project_id: projA, entry_date: '2026-07-22', status: 'draft', work_done: 'brickwork' });
  ok('foreperson may write a draft (diary.write)', c3.status === 200 && c3.json.applied, JSON.stringify(c3.json));
  const fpFinal = await push(fp, 'site_diary', 'update', { id: d3, status: 'final' });
  ok('foreperson CANNOT finalise (no diary.signoff → FORBIDDEN)',
    fpFinal.status === 403 && fpFinal.json.code === 'FORBIDDEN', JSON.stringify(fpFinal.json));

  // ── 3. Geofence (server-derived geo_verified) ──────────────────────────────
  const aIn = `att-${s}-in`;
  await push(sup, 'site_attendance', 'create',
    { id: aIn, project_id: projA, person_name: 'Dave', person_type: 'subcontractor', trade: 'Electrician',
      method: 'supervisor', check_in_at: '2026-07-20 08:15:00', check_in_lat: -31.950000, check_in_lng: 115.860000 });
  const aOut = `att-${s}-out`;
  await push(sup, 'site_attendance', 'create',
    { id: aOut, project_id: projA, person_name: 'Far Frank', person_type: 'visitor',
      method: 'supervisor', check_in_at: '2026-07-20 08:20:00', check_in_lat: -32.500000, check_in_lng: 116.500000 });
  const aNo = `att-${s}-nogeo`;
  await push(sup, 'site_attendance', 'create',
    { id: aNo, project_id: projA, person_name: 'No GPS Nia', person_type: 'staff', method: 'supervisor',
      check_in_at: '2026-07-20 08:25:00' });

  const att = await pull(reader, 'site_attendance');
  ok('check-in inside the geofence → geo_verified = 1', rowById(att, aIn)?.data?.geo_verified === 1,
    JSON.stringify(rowById(att, aIn)?.data));
  ok('check-in outside the geofence → geo_verified = 0', rowById(att, aOut)?.data?.geo_verified === 0,
    JSON.stringify(rowById(att, aOut)?.data));
  ok('check-in with no coords → geo_verified = NULL (degrades, never blocks)',
    rowById(att, aNo) && rowById(att, aNo).data.geo_verified == null, JSON.stringify(rowById(att, aNo)?.data));

  // ── 4. Attendance self-vs-site ─────────────────────────────────────────────
  const selfOk = await push(tradie, 'site_attendance', 'create',
    { id: `att-${s}-self`, project_id: projA, person_id: pmUser, person_type: 'staff',
      method: 'self', check_in_at: '2026-07-20 07:00:00' });
  ok('tradie may record OWN check-in (attendance.write.own)', selfOk.status === 200 && selfOk.json.applied,
    JSON.stringify(selfOk.json));
  const selfBad = await push(tradie, 'site_attendance', 'create',
    { id: `att-${s}-other`, project_id: projA, person_id: `someone-else-${s}`, method: 'self',
      check_in_at: '2026-07-20 07:05:00' });
  ok('tradie CANNOT record someone else (FORBIDDEN)',
    selfBad.status === 403 && selfBad.json.code === 'FORBIDDEN', JSON.stringify(selfBad.json));
  const tradieDiary = await push(tradie, 'site_diary', 'create',
    { id: `diary-${s}-tr`, project_id: projA, entry_date: '2026-07-23', status: 'draft' });
  ok('tradie CANNOT write the diary (no diary.write → FORBIDDEN)',
    tradieDiary.status === 403 && tradieDiary.json.code === 'FORBIDDEN', JSON.stringify(tradieDiary.json));
  const musterOk = await push(sup, 'site_attendance', 'create',
    { id: `att-${s}-crew`, project_id: projA, person_name: 'Crew #4', person_type: 'subcontractor',
      method: 'supervisor', check_in_at: '2026-07-20 06:55:00' });
  ok('siteSupervisor may muster anyone (attendance.write.site)', musterOk.status === 200 && musterOk.json.applied,
    JSON.stringify(musterOk.json));

  // ── 5. Deliveries ──────────────────────────────────────────────────────────
  const dl1 = `deliv-${s}-1`;
  const dlc = await push(writer, 'deliveries', 'create',
    { id: dl1, project_id: projA, received_at: '2026-07-20 10:30:00', supplier_name: 'Boral',
      docket_no: 'DK-4471', notes: '3x concrete' });
  ok('delivery record applies', dlc.status === 200 && dlc.json.applied, JSON.stringify(dlc.json));
  ok('received_by is server-stamped',
    rowById(await pull(reader, 'deliveries'), dl1)?.data?.received_by === pmUser);
  const tradieDeliv = await push(tradie, 'deliveries', 'create',
    { id: `deliv-${s}-x`, project_id: projA, received_at: '2026-07-20 11:00:00' });
  ok('tradie CANNOT record a delivery (no deliveries.write → FORBIDDEN)',
    tradieDeliv.status === 403 && tradieDeliv.json.code === 'FORBIDDEN', JSON.stringify(tradieDeliv.json));

  // ── 6. Project-scoped push + pull ──────────────────────────────────────────
  // A fresh foreperson user, member of NOTHING yet.
  const fu = await call('POST', '/organisation/users',
    { email: `fore${s}@x.com`, full_name: 'Sam Site', role: 'foreperson', password: 'hunter2hunter2' }, pm);
  const foreUser = fu.json.data?.user?.id;
  const foreTok = await pairAs(pm, foreUser, 'foreperson', `fu-${s}`);

  const noMember = await push(foreTok, 'site_diary', 'create',
    { id: `diary-${s}-nm`, project_id: projA, entry_date: '2026-07-24', status: 'draft' });
  ok('a non-member push is refused (NOT_MEMBER)',
    noMember.status === 403 && noMember.json.code === 'NOT_MEMBER', JSON.stringify(noMember.json));

  await call('POST', `/projects/${projA}/members`, { user_id: foreUser }, pm);
  const nowMember = await push(foreTok, 'site_diary', 'create',
    { id: `diary-${s}-m`, project_id: projA, entry_date: '2026-07-24', status: 'draft', work_done: 'after enrol' });
  ok('the same push succeeds once enrolled', nowMember.status === 200 && nowMember.json.applied,
    JSON.stringify(nowMember.json));

  // PM writer seeds a diary on BOTH projects; the projA-only member must see only A.
  const dAonly = `diary-${s}-A`, dBonly = `diary-${s}-B`;
  await push(writer, 'site_diary', 'create',
    { id: dAonly, project_id: projA, entry_date: '2026-07-25', status: 'draft', work_done: 'A work' });
  await push(writer, 'site_diary', 'create',
    { id: dBonly, project_id: projB, entry_date: '2026-07-25', status: 'draft', work_done: 'B work' });
  const foreRows = await pull(foreTok, 'site_diary');
  ok('member pull INCLUDES its project (A) diary', !!rowById(foreRows, dAonly));
  ok('member pull EXCLUDES a non-member project (B) diary', !rowById(foreRows, dBonly),
    JSON.stringify(foreRows.map((r) => r.data.id)));

  // ── 7. Redaction is a no-op for site-ops (no money columns) ────────────────
  ok('non-money role still receives the diary body intact (no over-redaction)',
    rowById(foreRows, dAonly)?.data?.work_done === 'A work', JSON.stringify(rowById(foreRows, dAonly)?.data));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
