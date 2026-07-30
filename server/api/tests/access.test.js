// Access-control acceptance — the 6-role model (18-Stage Matrix) + v004/v005 layer.
//
// Proves:
//   1. GET /auth/permissions serves the matrix (version, role, scopeClass, perms,
//      pairableRoles, assignableRoles).
//   2. The registry is data: projectManager (portfolio) holds projects.write; a
//      siteSupervisor does not.
//   3. Per-operation ownership (projman-01 §4): the field app may CREATE a project
//      offline (projectManager), but a role lacking projects.write cannot; UPDATE
//      from the app stays refused.
//   4. Pairing rank ceiling: projectManager pairs an inspector; a siteSupervisor
//      cannot; `client` is never pairable.
//
// Run: PORT=4199 node src/index.js &   then   BASE=http://localhost:4199 node tests/access.test.js
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

async function pairAs(admin, adminUserId, role, uid, stamp) {
  const init = await call('POST', '/pairing/initiate', { role, label: uid, assign_user_id: adminUserId }, admin);
  if (init.status >= 400) return { init };
  const rid = init.json.data.request_id, nonce = init.json.data.qr_payload.nonce;
  await call('POST', '/pairing/request', { request_id: rid, nonce, device_uid: uid, platform: 'android' });
  await call('POST', '/pairing/confirm', { request_id: rid, role }, admin);
  const st = await call('GET', `/pairing/status/${rid}?device_uid=${uid}`);
  return { init, token: st.json.data?.accessToken, role: st.json.data?.role };
}

(async () => {
  console.log(`Access-control test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Acc ${s}` },
    user: { full_name: 'Ada Admin', email: `acc${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  ok('register → projectManager (the top actor)', reg.json.data.user.role === 'projectManager',
    JSON.stringify(reg.json.data.user));
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;

  // ── 1. /auth/permissions ──
  const perms = await call('GET', '/auth/permissions', undefined, pm);
  const d = perms.json.data;
  // v5 (v012, DIRECTIVE 1): + builder/developer/accountant + progress.tick/verify/
  // tax.approve/development.read/panel.manage. v6 (v017, P7a Commercial): + claims.submit
  // (builder) / claims.approve (projectManager).
  ok('permissions: matrixVersion present', d?.matrixVersion === 6, JSON.stringify(d?.matrixVersion));
  ok('permissions: projectManager scope = portfolio', d?.scopeClass === 'portfolio');
  ok('permissions: projectManager has projects.write', d?.permissions?.includes('projects.write'));
  ok('permissions: pairableRoles are the 6 field roles (+ builder, no client)',
    d?.pairableRoles?.length === 6 && !d.pairableRoles.some(r => r.role === 'client'),
    JSON.stringify(d?.pairableRoles?.map(r => r.role)));
  ok('permissions: client is not assignable',
    !d?.assignableRoles?.some(r => r.role === 'client'),
    JSON.stringify(d?.assignableRoles?.map(r => r.role)));

  // ── 2. Offline app-create of a project by the projectManager (per-op ownership) ──
  const custId = crypto.randomUUID();
  const custCreate = await call('POST', '/sync/push', {
    table_name: 'customers', operation: 'create',
    data: { id: custId, name: 'Offline Client', updated_at: Date.now() },
  }, pm);
  ok('projectManager app-creates a customer offline', custCreate.status === 200 && custCreate.json.applied,
    JSON.stringify(custCreate.json));

  const projId = crypto.randomUUID();
  const projCreate = await call('POST', '/sync/push', {
    table_name: 'projects', operation: 'create',
    data: { id: projId, code: `OFF-${s}`, name: 'Lot 9 offline', customer_id: custId, updated_at: Date.now() },
  }, pm);
  ok('projectManager app-creates a project offline', projCreate.status === 200 && projCreate.json.applied,
    JSON.stringify(projCreate.json));

  const back = await call('GET', `/projects/${projId}`, undefined, pm);
  ok('offline-created project is readable via REST', back.status === 200 && back.json.data.project.code === `OFF-${s}`);

  // ── 3. App UPDATE of a project still refused (single-writer for edits) ──
  const projUpdate = await call('POST', '/sync/push', {
    table_name: 'projects', operation: 'update',
    data: { id: projId, name: 'renamed via app' },
  }, pm);
  ok('app UPDATE of a project refused (NOT_OWNER)',
    projUpdate.status === 403 && projUpdate.json.code === 'NOT_OWNER', JSON.stringify(projUpdate.json));

  // ── 4. A role without projects.write cannot app-create a project ──
  //    Pair a siteSupervisor device (assigned scope, no projects.write) and try.
  const sup = await pairAs(pm, pmUser, 'siteSupervisor', `sup-${s}`, s);
  ok('projectManager pairs a siteSupervisor', !!sup.token && sup.role === 'siteSupervisor',
    JSON.stringify(sup.init.json));

  // §10.3: the creator was auto-enrolled on the app-create, so an ASSIGNED-scope
  // session for that same user (this siteSupervisor device, bound to pmUser) pulls
  // the offline-created project — proving membership was seeded, not just portfolio.
  const supPull = await call('GET', '/sync/pull?since=0', undefined, sup.token);
  const sawOffline = (supPull.json.changes || [])
    .some(c => c.table_name === 'projects' && c.server_id === projId);
  ok('creator auto-enrolled: assigned session pulls the app-created project (§10.3)',
    sawOffline, `changes=${(supPull.json.changes || []).filter(c => c.table_name === 'projects').length}`);
  const supCreate = await call('POST', '/sync/push', {
    table_name: 'projects', operation: 'create',
    data: { id: crypto.randomUUID(), code: `SUP-${s}`, name: 'x', updated_at: Date.now() },
  }, sup.token);
  ok('siteSupervisor app-create of a project FORBIDDEN (no projects.write)',
    supCreate.status === 403 && supCreate.json.code === 'FORBIDDEN', JSON.stringify(supCreate.json));

  // ── 5. Pairing rank ceiling ──
  const insp = await pairAs(pm, pmUser, 'inspector', `insp-${s}`, s);
  ok('projectManager pairs an inspector (rank 100 ≥ 50)', !!insp.token, JSON.stringify(insp.init.json));

  // siteSupervisor holds devices.manage but rank 40 < inspector 50 → refused.
  const supPairsInsp = await call('POST', '/pairing/initiate',
    { role: 'inspector', label: 'x', assign_user_id: pmUser }, sup.token);
  ok('siteSupervisor CANNOT pair an inspector (rank 40 < 50)',
    supPairsInsp.status === 403 && supPairsInsp.json.code === 'ROLE_NOT_ASSIGNABLE',
    JSON.stringify(supPairsInsp.json));

  // client is never a device role.
  const pairClient = await call('POST', '/pairing/initiate',
    { role: 'client', label: 'x', assign_user_id: pmUser }, pm);
  ok('client role is never device-pairable',
    pairClient.status === 403 && pairClient.json.code === 'ROLE_NOT_ASSIGNABLE',
    JSON.stringify(pairClient.json));

  // ── 6. Role gates at user-create ──
  //   'client' exists but is_assignable=0 (portal role, provisioned by the P10 invite
  //   flow, not staff user-create) → ROLE_NOT_ASSIGNABLE.
  const clientUser = await call('POST', '/organisation/users', {
    email: `c${s}@x.com`, full_name: 'C', role: 'client', password: 'hunter2hunter2',
  }, pm);
  ok('client role not staff-assignable at user-create (ROLE_NOT_ASSIGNABLE)',
    clientUser.status === 403 && clientUser.json.code === 'ROLE_NOT_ASSIGNABLE',
    JSON.stringify(clientUser.json));

  //   'estimator' was retired in the 6-role model → unknown role → VALIDATION_ERROR.
  const goneUser = await call('POST', '/organisation/users', {
    email: `e${s}@x.com`, full_name: 'E', role: 'estimator', password: 'hunter2hunter2',
  }, pm);
  ok('retired role (estimator) is unknown at user-create (VALIDATION_ERROR)',
    goneUser.status === 422 && goneUser.json.code === 'VALIDATION_ERROR',
    JSON.stringify(goneUser.json));

  //   A valid assignable role succeeds.
  const goodUser = await call('POST', '/organisation/users', {
    email: `g${s}@x.com`, full_name: 'G', role: 'foreperson', password: 'hunter2hunter2',
  }, pm);
  ok('assignable role (foreperson) accepted at user-create', goodUser.status === 201,
    JSON.stringify(goodUser.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
