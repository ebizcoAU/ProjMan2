// Domain acceptance — the migration_v003 surface (customers/projects/stages/tasks).
//
// Proves the four registry rules for the construction core:
//   1. REST CRUD is org-scoped (org B gets 404s, never data).
//   2. The app cannot push a web-owned table (NOT_OWNER), and CAN push exactly the
//      progress fields on the app-owned ones (stage status, task create).
//   3. Financial redaction: a supervisor session pulls projects/stages/tasks with
//      contract_value / budget_* absent; a financial role keeps them.
//   4. A web-surface login is never the single-writer.
//
// Run: PORT=4199 node src/index.js &   then   BASE=http://localhost:4199 node tests/domain.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}

(async () => {
  console.log(`Domain smoke test → ${BASE}\n`);
  const stamp = Date.now();

  // ── Register a builder org (org_admin, financial role, app device) ──
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Smoke Builders ${stamp}` },
    user: { full_name: 'Sam Smoke', email: `smoke${stamp}@example.com`, password: 'hunter2hunter2' },
    device: { device_uid: `smoke-admin-${stamp}`, platform: 'android', device_name: 'Admin phone' },
  });
  ok('org registered', reg.status === 201, JSON.stringify(reg.json));
  const admin = reg.json.data.accessToken;

  // A SEPARATE site-supervisor user — the tablet is bound to them, not to the PM who
  // creates the project. The creator is auto-enrolled (§10.3), so binding to a distinct
  // user is what makes the "no membership → sees nothing" path testable.
  const supUser = await call('POST', '/organisation/users', {
    email: `sally${stamp}@example.com`, full_name: 'Sally Super',
    role: 'siteSupervisor', password: 'hunter2hunter2',
  }, admin);
  ok('second user (siteSupervisor) created', supUser.status === 201, JSON.stringify(supUser.json));
  const supUserId = supUser.json.data?.user?.id;

  // ── Customer CRUD ──
  const cust = await call('POST', '/customers', {
    name: 'Jones Family', contact_name: 'Terry Jones', phone: '0400 111 222',
  }, admin);
  ok('customer created', cust.status === 201, JSON.stringify(cust.json));
  const custId = cust.json.data?.id;

  const custList = await call('GET', '/customers', undefined, admin);
  ok('customer listed', custList.json.data?.customers?.some(c => c.id === custId));

  // ── Project CRUD ──
  const proj = await call('POST', '/projects', {
    code: 'P-001', name: 'Lot 42 — new dwelling', customer_id: custId,
    contract_value: 485000, contract_type: 'fixed_price', status: 'active',
    site_address: '42 Example Way, Baldivis WA',
  }, admin);
  ok('project created', proj.status === 201, JSON.stringify(proj.json));
  const projId = proj.json.data?.id;

  const dup = await call('POST', '/projects', { code: 'P-001', name: 'dup' }, admin);
  ok('duplicate code refused 409', dup.status === 409 && dup.json.code === 'DUPLICATE_CODE');

  // ── Stage via console ──
  const stage = await call('POST', `/projects/${projId}/stages`, {
    name: 'Slab down', seq: 1, stage_code: 'SLAB', budget_amount: 60000,
  }, admin);
  ok('stage created', stage.status === 201, JSON.stringify(stage.json));
  const stageId = stage.json.data?.id;

  const detail = await call('GET', `/projects/${projId}`, undefined, admin);
  ok('detail has stage + contract_value (financial role)',
    detail.json.data?.stages?.length === 1 &&
    detail.json.data?.project?.contract_value != null);

  // ── Pair a supervisor device (pairing flow) ──
  const init = await call('POST', '/pairing/initiate', {
    role: 'siteSupervisor', label: 'Site tablet', assign_user_id: supUserId,
  }, admin);
  ok('pairing initiated', init.status === 200 || init.status === 201, JSON.stringify(init.json));
  const requestId = init.json.data?.request_id;
  const nonce = init.json.data?.qr_payload?.nonce;

  const supUid = `smoke-tablet-${stamp}`;
  const reqRes = await call('POST', '/pairing/request', {
    request_id: requestId, nonce,
    device_uid: supUid, device_name: 'Site tablet', platform: 'android',
  });
  ok('pairing requested', reqRes.json.success === true, JSON.stringify(reqRes.json));

  const confirm = await call('POST', '/pairing/confirm', {
    request_id: requestId, role: 'siteSupervisor',
  }, admin);
  ok('pairing confirmed as supervisor', confirm.status === 200, JSON.stringify(confirm.json));

  const statusRes = await call('GET', `/pairing/status/${requestId}?device_uid=${supUid}`, undefined);
  const supToken = statusRes.json.data?.accessToken;
  ok('supervisor session issued with device role', !!supToken && statusRes.json.data?.role === 'siteSupervisor',
    JSON.stringify(statusRes.json));

  // ── Resource scope (§9.4): an assigned-scope supervisor with NO membership sees
  //    nothing — strict scope, approved 2026-07-22. ──
  const preGrant = await call('GET', '/sync/pull?since=0', undefined, supToken);
  const preProj = (preGrant.json.changes || []).filter(c => c.table_name === 'projects');
  ok('supervisor with no membership pulls NO projects', preProj.length === 0,
    `saw ${preProj.length}`);
  const preRest = await call('GET', `/projects/${projId}`, undefined, supToken);
  ok('supervisor with no membership gets 404 on the project', preRest.status === 404);

  // ── Grant membership (web console Team tab; §9.9.2). This flags the supervisor's
  //    session for a full re-pull. ──
  const grant = await call('POST', `/projects/${projId}/members`,
    { user_id: supUserId }, admin);
  ok('membership granted', grant.status === 201 || grant.status === 200, JSON.stringify(grant.json));

  // ── After grant: the next pull is forced full (requiresFullSync) and now scoped IN. ──
  const supPull = await call('GET', '/sync/pull?since=999999999999', undefined, supToken);
  ok('membership change forces full re-pull (requiresFullSync)',
    supPull.json.requiresFullSync === true, JSON.stringify({ rfs: supPull.json.requiresFullSync }));
  const projRows = (supPull.json.changes || []).filter(c => c.table_name === 'projects');
  const stageRows = (supPull.json.changes || []).filter(c => c.table_name === 'project_stages');
  ok('supervisor now pulls the member project', projRows.length >= 1);
  ok('supervisor pull REDACTS contract_value',
    projRows.every(c => !('contract_value' in c.data)));
  ok('supervisor pull REDACTS stage budget_amount',
    stageRows.every(c => !('budget_amount' in c.data)));

  const adminPull = await call('GET', '/sync/pull?since=0', undefined, admin);
  const adminProj = (adminPull.json.changes || []).filter(c => c.table_name === 'projects');
  ok('admin pull KEEPS contract_value',
    adminProj.length >= 1 && adminProj.every(c => 'contract_value' in c.data));

  // ── App push: supervisor marks the stage in progress (unprotected status) ──
  const push = await call('POST', '/sync/push', {
    table_name: 'project_stages', operation: 'update',
    data: { id: stageId, status: 'in_progress', updated_at: Date.now() },
  }, supToken);
  ok('supervisor pushes stage status', push.status === 200 && push.json.applied === true,
    JSON.stringify(push.json));

  const after = await call('GET', `/projects/${projId}`, undefined, admin);
  ok('stage status now in_progress', after.json.data?.stages?.[0]?.status === 'in_progress');

  // ── App push refused for web-owned projects table ──
  const badPush = await call('POST', '/sync/push', {
    table_name: 'projects', operation: 'update',
    data: { id: projId, name: 'hacked' },
  }, supToken);
  ok('device push to web-owned projects refused (NOT_OWNER)',
    badPush.status === 403 && badPush.json.code === 'NOT_OWNER', JSON.stringify(badPush.json));

  // ── App push of a task (app-owned create) ──
  const taskId = crypto.randomUUID();
  const taskPush = await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'create',
    data: { id: taskId, project_id: projId, stage_id: stageId, name: 'Pour slab',
            completion: 0, updated_at: Date.now() },
  }, supToken);
  ok('supervisor creates task via push', taskPush.status === 200 && taskPush.json.applied === true,
    JSON.stringify(taskPush.json));

  // ── Cross-org isolation for the new tables ──
  const reg2 = await call('POST', '/auth/register', {
    organisation: { name: `Rival Builders ${stamp}` },
    user: { full_name: 'Rita Rival', email: `rival${stamp}@example.com`, password: 'hunter2hunter2' },
    device: { device_uid: `rival-${stamp}`, platform: 'android' },
  });
  const rival = reg2.json.data.accessToken;
  const stolen = await call('GET', `/projects/${projId}`, undefined, rival);
  ok('org B cannot read org A project (404)', stolen.status === 404);
  const stolenPatch = await call('PATCH', `/projects/${projId}`, { name: 'stolen' }, rival);
  ok('org B cannot write org A project (404)', stolenPatch.status === 404);
  const rivalPull = await call('GET', '/sync/pull?since=0', undefined, rival);
  ok('org B pull contains no org A domain rows',
    !(rivalPull.json.changes || []).some(c => ['projects', 'customers', 'project_stages', 'tasks'].includes(c.table_name)));

  // ── Web login is never authoritative ──
  const webLogin = await call('POST', '/auth/login', {
    email: `smoke${stamp}@example.com`, password: 'hunter2hunter2',
    device: { device_uid: `web-${stamp}`, platform: 'web', device_name: 'Office console' },
  });
  ok('web console login succeeds', webLogin.status === 200, JSON.stringify(webLogin.json));
  ok('web session is NOT authoritative', webLogin.json.data?.authoritative === false,
    `authoritative=${webLogin.json.data?.authoritative}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
