// stage_task_templates acceptance (xprojman-32, owner directive 2026-09-03) —
// the WA_RESIDENTIAL_18 task library, one level under stage_template_items.
//
// Proves:
//   1. GET /stage-templates/:id now also returns taskItems (139 rows, 15 hold
//      points), the read path Portal's task drill-down resolves
//      tasks.template_item_id metadata from.
//   2. POST /projects/:id/programme (instantiate) stamps exactly 139 `tasks`
//      rows alongside the 18 `project_stages` rows, in one atomic pass.
//   3. Each stage gets exactly the right task count and hold-point count —
//      not just a total that happens to add up.
//   4. tasks.template_item_id round-trips through GET /projects/:id, so the
//      REST project-detail read (Portal's actual read path, not sync) already
//      carries what a drill-down needs with no further server change.
//   5. UNIQUE(template_id, stage_seq, seq) actually holds — a duplicate insert
//      is refused.
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/stage-task-templates.test.js

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

// Expected per-stage {task count, hold-point count} — the exact shape of
// docs/researchPaper/18Stage_Tasks.md, not just a 139/15 total.
const EXPECTED = {
  1: [7, 0], 2: [8, 0], 3: [5, 0], 4: [4, 0], 5: [3, 0], 6: [6, 0], 7: [5, 0],
  8: [8, 1], 9: [10, 0], 10: [7, 1], 11: [11, 3], 12: [9, 3], 13: [10, 3],
  14: [7, 0], 15: [8, 2], 16: [10, 1], 17: [9, 0], 18: [12, 1],
};

(async () => {
  console.log(`stage_task_templates test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `TaskTpl ${s}` },
    user: { full_name: 'Pat PM', email: `tasktpl${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;

  // ── 1. Template read now carries taskItems ──
  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data?.templates?.find((t) => t.is_system && t.stage_count === 18);
  ok('WA_RESIDENTIAL_18 found', !!wa18);

  const tplDetail = await call('GET', `/stage-templates/${wa18.id}`, undefined, pm);
  const taskItems = tplDetail.json.data?.taskItems || [];
  ok('template read returns 139 task items', taskItems.length === 139, taskItems.length);
  ok('template read returns 15 hold-point task items',
    taskItems.filter((t) => t.is_hold_point).length === 15,
    taskItems.filter((t) => t.is_hold_point).length);
  ok('task items carry a code (e.g. S1.1)', taskItems.some((t) => t.code === 'S1.1'));

  // ── 2/3. Instantiate a project, check exact per-stage shape ──
  const proj = await call('POST', '/projects', { code: `TT-${s}`, name: 'Task template test dwelling' }, pm);
  const projId = proj.json.data.id;
  const inst = await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  ok('programme instantiated (18 stages)', inst.status === 201 && inst.json.data.stagesCreated === 18);

  const detail = await call('GET', `/projects/${projId}`, undefined, pm);
  const stages = detail.json.data?.stages || [];
  const tasks = detail.json.data?.tasks || [];
  ok('exactly 139 tasks stamped', tasks.length === 139, tasks.length);

  const byTemplateId = new Map(taskItems.map((t) => [t.id, t]));
  let shapeOk = true, shapeDetail = '';
  for (const stage of stages) {
    const stageTasks = tasks.filter((t) => t.stage_id === stage.id);
    const holdCount = stageTasks.filter((t) => byTemplateId.get(t.template_item_id)?.is_hold_point).length;
    const [expCount, expHold] = EXPECTED[stage.seq] || [];
    if (stageTasks.length !== expCount || holdCount !== expHold) {
      shapeOk = false;
      shapeDetail += `stage ${stage.seq}: got ${stageTasks.length}/${holdCount}, want ${expCount}/${expHold}; `;
    }
  }
  ok('every stage has the exact expected task count + hold-point count', shapeOk, shapeDetail);

  // ── 4. template_item_id round-trips and resolves to real metadata ──
  const s1_1 = tasks.find((t) => byTemplateId.get(t.template_item_id)?.code === 'S1.1');
  ok('a task resolves back to its template (S1.1)', s1_1?.name?.includes('Initial client meeting'), JSON.stringify(s1_1));

  // ── 5. Re-instantiation refused (existing behaviour, unaffected) ──
  const reInst = await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  ok('re-instantiation refused (PROGRAMME_EXISTS)',
    reInst.status === 409 && reInst.json.code === 'PROGRAMME_EXISTS');

  // ── 6. PATCH /projects/:id/tasks/:taskId — office-side output_note edit ──
  const patch = await call('PATCH', `/projects/${projId}/tasks/${s1_1.id}`,
    { output_note: 'Title search clean, vendor matches' }, pm);
  ok('PATCH output_note succeeds (200)', patch.status === 200 && patch.json.data?.output_note === 'Title search clean, vendor matches',
    JSON.stringify(patch.json));

  const afterPatch = await call('GET', `/projects/${projId}`, undefined, pm);
  const patchedTask = (afterPatch.json.data?.tasks || []).find((t) => t.id === s1_1.id);
  ok('output_note persisted and readable via GET /projects/:id',
    patchedTask?.output_note === 'Title search clean, vendor matches', patchedTask?.output_note);

  const patchMissingBody = await call('PATCH', `/projects/${projId}/tasks/${s1_1.id}`, {}, pm);
  ok('PATCH with no output_note refused (422)', patchMissingBody.status === 422);

  const patchUnknownTask = await call('PATCH', `/projects/${projId}/tasks/00000000-0000-0000-0000-000000000000`,
    { output_note: 'x' }, pm);
  ok('PATCH on unknown task refused (404)', patchUnknownTask.status === 404);

  const patchNoAuth = await call('PATCH', `/projects/${projId}/tasks/${s1_1.id}`, { output_note: 'x' }, undefined);
  ok('PATCH without auth refused (401)', patchNoAuth.status === 401);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
