// Stored task codes + the v3.4 re-key (xprojman-56, migration v052).
//
//   1. The library: billing milestones and hold points sit at their v3.4 codes; lib S10.7 is gone;
//      S9.10 is the SYS+ step and the Builder's confirm is S9.10b.
//   2. A new programme: stored codes, names without a code prefix, SYS+ rows flagged.
//   3. Minting: hand-added and App-created tasks never take a reserved or letter code.
//   4. SYS+: a manual tick (sync or REST) is SYSTEM_STEP; validating Stage 12 ticks S12.10 (Base).
//
// Run: DB_NAME=c1projman2_e2e DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &
//      DB_NAME=c1projman2_e2e BASE=http://localhost:4199 node tests/task-codes.test.js
const crypto = require('crypto');
const pool = require('../src/db/pool');
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
const WA18 = '00000000-0000-4000-8000-00000000wa18';

(async () => {
  console.log(`Task codes / v3.4 re-key test → ${BASE}\n`);

  // ── 1. The library ──
  const [lib] = await pool.query('SELECT stage_seq, code, name, is_hold_point, auto_event FROM stage_task_templates WHERE template_id = ?', [WA18]);
  const by = new Map(lib.map((r) => [r.code, r]));
  ok('Deposit is S9.9 (Lock Cost Plan)', /cost plan/i.test(by.get('S9.9')?.name || ''), JSON.stringify(by.get('S9.9')));
  ok('Base S12.10 and Frame S13.11 are SYS+ (stage_validated)',
    by.get('S12.10')?.auto_event === 'stage_validated' && by.get('S13.11')?.auto_event === 'stage_validated');
  ok('Lock-up S14.7 and Fixing S16.10 are unchanged', by.has('S14.7') && by.has('S16.10'));
  ok('Completion S18.15 is SYS+ (project_completed); S18.14 follows the client sign-off',
    by.get('S18.15')?.auto_event === 'project_completed' && by.get('S18.14')?.auto_event === 'client_signoff');
  ok('the set-out hold point is S10.5 and fencing is S10.6 (the swap)',
    by.get('S10.5')?.is_hold_point === 1 && /fencing/i.test(by.get('S10.6')?.name || '') && by.get('S10.6')?.is_hold_point === 0);
  ok('lib S10.7 is gone (Q4), and no old code is left parked',
    !by.has('S10.7') && !lib.some((r) => r.code.startsWith('o')), JSON.stringify(lib.filter((r) => r.code.startsWith('o'))));
  ok('S9.10 is the SYS+ activation step; the Builder\'s confirm is S9.10b',
    by.get('S9.10')?.auto_event === 'programme_activated' && /job breakdown/i.test(by.get('S9.10b')?.name || ''));
  ok('easements moved to Stage 2 (S2.3); the budget tier to Stage 6 (S6.1, Client)',
    by.get('S2.3')?.stage_seq === 2 && by.get('S6.1')?.stage_seq === 6 && by.has('S2.4a') && by.has('S2.4c'));

  // ── 2. A new programme ──
  const s = Date.now();
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Codes ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id;
  const projId = (await call('POST', '/projects', { code: `TC-${s}`, name: 'Codes job' }, pm)).json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: WA18 }, pm);
  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const tasks = detail.json.data?.tasks || [];
  const t = (code) => tasks.find((x) => x.code === code);
  ok('every seeded task has a stored code', tasks.length > 100 && tasks.every((x) => !!x.code), `n=${tasks.length}`);
  ok('names no longer carry the code ("Finalise and lock…", not "S9.9 Finalise…")',
    !!t('S9.9') && !/^S\d/.test(t('S9.9').name), JSON.stringify(t('S9.9')));
  ok('SYS+ tasks carry auto_event on the read', t('S12.10')?.auto_event === 'stage_validated' && t('S1.1')?.auto_event === null);

  // ── 3. Minting ──
  const stages = detail.json.data.stages;
  const st = (seq) => stages.find((x) => Number(x.seq) === seq);
  const add12 = await call('POST', `/projects/${projId}/tasks`, { stage_id: st(12).id, name: 'Extra slab task' }, pm);
  ok('a hand-added Stage 12 task is S12.11, never the reserved S12.10',
    add12.json.data?.code === 'S12.11', JSON.stringify(add12.json));
  const add3 = await call('POST', `/projects/${projId}/tasks`, { stage_id: st(3).id, name: 'Extra concept task' }, pm);
  ok('Stage 3 mints above the highest library number (S3.11)', add3.json.data?.code === 'S3.11', JSON.stringify(add3.json));
  const appTaskId = crypto.randomUUID();
  await call('POST', '/sync/push', { table_name: 'tasks', operation: 'create',
    data: { id: appTaskId, project_id: projId, stage_id: st(12).id, name: 'From the App', completion: 0, updated_at: Date.now() } }, pm);
  const [[appTask]] = await pool.query('SELECT code FROM tasks WHERE id = ?', [appTaskId]);
  ok('an App-created task gets a server-minted code on push (S12.12)', appTask?.code === 'S12.12', JSON.stringify(appTask));
  const spoof = crypto.randomUUID();
  await call('POST', '/sync/push', { table_name: 'tasks', operation: 'create',
    data: { id: spoof, project_id: projId, stage_id: st(12).id, name: 'Spoof', code: 'S12.10', auto_event: 'x', completion: 0, updated_at: Date.now() } }, pm);
  const [[sp]] = await pool.query('SELECT code, auto_event FROM tasks WHERE id = ?', [spoof]);
  ok('a device can\'t set code or auto_event (server-owned)', sp?.code === 'S12.13' && sp.auto_event === null, JSON.stringify(sp));

  // ── 4. SYS+ ──
  const base = t('S12.10');
  const tick = await call('POST', '/sync/push', { table_name: 'tasks', operation: 'update',
    data: { id: base.id, completion: 100, updated_at: Date.now() } }, pm);
  ok('a manual tick on a SYS+ step over sync is SYSTEM_STEP (409)', tick.status === 409 && tick.json.code === 'SYSTEM_STEP', JSON.stringify(tick.json));
  const patch = await call('PATCH', `/projects/${projId}/tasks/${base.id}`, { status: 'n_a' }, pm);
  ok('…and over REST', patch.status === 409 && patch.json.code === 'SYSTEM_STEP', JSON.stringify(patch.json));
  const insp = await pairAs(pm, pmUser, 'inspector', `insp-${s}`);
  const v = await call('POST', `/projects/${projId}/stages/${st(12).id}/validate`, { result: 'pass', reference: 'BA2-1' }, insp);
  const [[baseAfter]] = await pool.query('SELECT status, completion FROM tasks WHERE id = ?', [base.id]);
  ok('validating Stage 12 ticks S12.10 (Base) on the server',
    v.status === 200 && baseAfter.status === 'complete' && Number(baseAfter.completion) === 100, JSON.stringify([v.json, baseAfter]));
  const [[frame]] = await pool.query("SELECT status FROM tasks WHERE project_id = ? AND code = 'S13.11'", [projId]);
  ok('…and leaves S13.11 (Frame) alone', frame.status === 'not_started');

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
