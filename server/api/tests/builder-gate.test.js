// Builder gate (xprojman-45 §1 Option B, migration v046). S9.10 is ACTIVATION, not
// seeding: all 18 stages still exist from creation, but a stage with seq >= 10 cannot
// START or COMPLETE until the project has an accepted builder Job Award — on the REST
// /advance path AND the /sync/push path. Accepting stamps projects.programme_activated_at
// (first accept wins). Rows already under way before the rule are not re-gated.
//
// Run: DB_NAME=c1projman2_e2e DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/builder-gate.test.js
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
const push = (tok, table, operation, data) =>
  call('POST', '/sync/push', { table_name: table, operation, data: { updated_at: Date.now(), ...data } }, tok);
const advance = (tok, projId, stageId, to) =>
  call('POST', `/projects/${projId}/stages/${stageId}/advance`, { to_status: to }, tok);

(async () => {
  console.log(`Builder gate test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `BuilderGate ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;

  await call('POST', '/organisation/users', {
    email: `bob${s}@x.com`, full_name: 'Bob Builder', role: 'builder', password: 'hunter2hunter2',
  }, pm);
  const builderTok = (await call('POST', '/auth/login', { email: `bob${s}@x.com`, password: 'hunter2hunter2' })).json.data.accessToken;
  const introB = await call('POST', '/introductions/code', {}, builderTok);
  const builderUser = (await call('POST', '/introductions/scan', { code: introB.json.data.code }, pm)).json.data.contact.user_id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);

  async function newProject(code) {
    const proj = await call('POST', '/projects', { code, name: `Gate ${code}` }, pm);
    const id = proj.json.data.id;
    await call('POST', `/projects/${id}/programme`, { template_id: wa18.id }, pm);
    const detail = await call('GET', `/projects/${id}`, undefined, pm);
    const stages = detail.json.data.stages;
    return { id, bySeq: (n) => stages.find((st) => st.seq === n).id, project: detail.json.data.project };
  }

  // ── A project with no Builder: walk Stages 1–9 (none of them is gated) ──
  const p = await newProject(`BG-${s}`);
  ok('programme_activated_at is null before any builder award', 'programme_activated_at' in p.project && p.project.programme_activated_at === null,
    JSON.stringify(p.project.programme_activated_at));
  let walked = true;
  for (let n = 1; n <= 9; n++) {
    await advance(pm, p.id, p.bySeq(n), 'in_progress');
    const c = await advance(pm, p.id, p.bySeq(n), 'complete');
    if (c.status !== 200) { walked = false; ok(`walk stage ${n}`, false, JSON.stringify(c.json)); break; }
  }
  ok('Stages 1–9 progress with no Builder attached', walked);

  // ── The gate, REST path ──
  const s10 = p.bySeq(10);
  const rest = await advance(pm, p.id, s10, 'in_progress');
  ok('REST: Stage 10 cannot start without an accepted builder award (BUILDER_NOT_ATTACHED)',
    rest.status === 409 && rest.json.code === 'BUILDER_NOT_ATTACHED', JSON.stringify(rest.json));

  // ── The gate, sync path (same rule; a device can't route around it) ──
  const syncStart = await push(pm, 'project_stages', 'update', { id: s10, status: 'in_progress' });
  ok('SYNC: pushing Stage 10 in_progress is refused (BUILDER_NOT_ATTACHED)',
    syncStart.status === 409 && syncStart.json.code === 'BUILDER_NOT_ATTACHED', JSON.stringify(syncStart.json));
  const syncJump = await push(pm, 'project_stages', 'update', { id: p.bySeq(14), status: 'complete' });
  ok('SYNC: jumping a Stage ≥10 straight to complete is refused too',
    syncJump.status === 409 && syncJump.json.code === 'BUILDER_NOT_ATTACHED', JSON.stringify(syncJump.json));

  // Skipping is not "starting work" — the gate doesn't apply.
  const skip = await advance(pm, p.id, p.bySeq(17), 'skipped');
  ok('skipping a Stage ≥10 is not gated', skip.status === 200, JSON.stringify(skip.json));

  // ── A DECLINED builder award doesn't open the gate ──
  const a1 = await call('POST', `/projects/${p.id}/job-awards`,
    { to_user_id: builderUser, role_offered: 'builder', builder_engagement_type: 'independent_fixed' }, pm);
  await call('POST', `/projects/${p.id}/job-awards/${a1.json.data.id}/respond`, { accept: false }, builderTok);
  const afterDecline = await advance(pm, p.id, s10, 'in_progress');
  ok('a declined builder award leaves the gate closed',
    afterDecline.status === 409 && afterDecline.json.code === 'BUILDER_NOT_ATTACHED', JSON.stringify(afterDecline.json));
  const stillNull = (await call('GET', `/projects/${p.id}`, undefined, pm)).json.data.project.programme_activated_at;
  ok('a declined award does not stamp programme_activated_at', stillNull == null, JSON.stringify(stillNull));

  // ── Accepting opens it and stamps activation ──
  const a2 = await call('POST', `/projects/${p.id}/job-awards`,
    { to_user_id: builderUser, role_offered: 'builder', builder_engagement_type: 'independent_fixed' }, pm);
  const acc = await call('POST', `/projects/${p.id}/job-awards/${a2.json.data.id}/respond`, { accept: true }, builderTok);
  ok('Builder accepts the Job Award', acc.status === 200 && acc.json.data.status === 'accepted', JSON.stringify(acc.json));
  const activated = (await call('GET', `/projects/${p.id}`, undefined, pm)).json.data.project.programme_activated_at;
  ok('accepting stamps programme_activated_at', !!activated, JSON.stringify(activated));

  const open = await advance(pm, p.id, s10, 'in_progress');
  ok('REST: Stage 10 starts once a Builder has accepted', open.status === 200, JSON.stringify(open.json));
  const syncOpen = await push(pm, 'project_stages', 'update', { id: p.bySeq(14), status: 'in_progress' });
  ok('SYNC: the gate opens on the sync path too (other gates permitting)',
    syncOpen.json.code !== 'BUILDER_NOT_ATTACHED', JSON.stringify(syncOpen.json));

  // ── Grandfathering: a row already under way before v046 isn't re-gated ──
  // Simulated in-process, since the API can no longer produce this state.
  if (process.env.DB_NAME) {
    const pool = require('../src/db/pool');
    const legacy = await newProject(`BG-L-${s}`);
    const s15 = legacy.bySeq(15);
    await pool.query(`UPDATE project_stages SET status = 'in_progress' WHERE id = ?`, [s15]);
    const finish = await advance(pm, legacy.id, s15, 'complete');
    ok('an already in_progress Stage ≥10 (pre-v046 data) can still complete without a Builder',
      finish.json.code !== 'BUILDER_NOT_ATTACHED', JSON.stringify(finish.json));
    await pool.end();
  } else {
    console.log('  – grandfathering check skipped (set DB_NAME to run it in-process)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
