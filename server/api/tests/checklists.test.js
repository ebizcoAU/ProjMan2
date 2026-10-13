// Checklists (xprojman-46 as amended by §7, migration v047).
//   1. Permissions (F3): matrix v15; execute roles push, a Builder can't; manage authors.
//   2. Templates (Portal): system ones visible + read-only (SYSTEM_TEMPLATE_READONLY),
//      copy_from, items validation (details.index), INVALID_TARGET_ROLE, publish/unpublish,
//      PATCH while published replaces the item set.
//   3. Sync pull: system + org templates reach the device, with is_published.
//   4. Execute offline (App): create → server snapshot (template_name/category) +
//      started_by; target_role enforced; create-as-completed refused.
//   5. Completion (F5): CHECKLIST_INCOMPLETE (retryable, details.item_ids) for a pending
//      required item and for a pass/fail photo_required item without a documents photo;
//      N/A exempt; success stamps completed_by/at + result (fail if any item failed).
//   6. Frozen: instance/item/sign-off pushes after completion → CHECKLIST_FROZEN.
//   7. Review (Portal): list (filters, fail_count, superseded_by_id, cursor) + detail with
//      evidence embedded.
//
// Run: DB_NAME=c1projman2_e2e DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/checklists.test.js
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
async function uploadPhoto(tok, projectId, entityType, entityId) {
  const fd = new FormData();
  fd.append('client_ref', crypto.randomUUID());
  fd.append('entity_type', entityType);
  fd.append('entity_id', entityId);
  fd.append('project_id', projectId);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
  fd.append('file', new Blob([png], { type: 'image/png' }), 'photo.png');
  const res = await fetch(`${BASE}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}
const uuid = () => crypto.randomUUID();

(async () => {
  console.log(`Checklists test → ${BASE}\n`);
  const s = Date.now();

  const pmEmail = `pm${s}@x.com`;
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Checklists ${s}` },
    user: { full_name: 'Pat PM', email: pmEmail, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;
  const pmWeb = (await call('POST', '/auth/login', { email: pmEmail, password: 'hunter2hunter2' })).json.data.accessToken;

  const proj = await call('POST', '/projects', { code: `CK-${s}`, name: 'Lot 4 dwelling' }, pm);
  const projId = proj.json.data.id;

  const tradie = await pairAs(pm, pmUser, 'tradie', `tra-${s}`);
  const fore = await pairAs(pm, pmUser, 'foreperson', `fore-${s}`);
  await call('POST', '/organisation/users', {
    email: `bob${s}@x.com`, full_name: 'Bob Builder', role: 'builder', password: 'hunter2hunter2',
  }, pm);
  const builder = (await call('POST', '/auth/login', { email: `bob${s}@x.com`, password: 'hunter2hunter2' })).json.data.accessToken;

  // ── 1. Permissions ──
  const perms = await call('GET', '/auth/permissions', undefined, tradie);
  ok('matrix v15+ and tradie holds checklists.execute',
    perms.json.data?.matrixVersion >= 15 && (perms.json.data?.permissions || []).includes('checklists.execute'),
    JSON.stringify(perms.json.data?.matrixVersion));

  // ── 2. Templates ──
  const list0 = await call('GET', '/checklist-templates', undefined, pmWeb);
  const systemTpls = (list0.json.data?.templates || []).filter((t) => t.is_system === 1);
  ok('three published system templates are listed, items inline',
    systemTpls.length === 3 && systemTpls.every((t) => t.is_published === 1 && t.items.length > 0),
    JSON.stringify(list0.json).slice(0, 300));
  const sysToolbox = systemTpls.find((t) => t.category === 'toolbox_talk');
  // v051: the system templates carry Product's approved wording (not v047's placeholders).
  ok('v051: system toolbox talk has Product\'s wording (9 items, no placeholder text)',
    sysToolbox?.name === 'Toolbox talk' && (sysToolbox.items || []).length === 9
      && !/placeholder/i.test(sysToolbox.description || ''), JSON.stringify(sysToolbox).slice(0, 300));

  const sysPatch = await call('PATCH', `/checklist-templates/${sysToolbox.id}`, { name: 'Mine now' }, pmWeb);
  ok('a system template is read-only (SYSTEM_TEMPLATE_READONLY)',
    sysPatch.status === 403 && sysPatch.json.code === 'SYSTEM_TEMPLATE_READONLY', JSON.stringify(sysPatch.json));

  const copy = await call('POST', '/checklist-templates', { copy_from: sysToolbox.id, name: 'Our toolbox talk' }, pmWeb);
  ok('copy_from makes a draft org copy with the items',
    copy.status === 201 && copy.json.data.template.is_system === 0 && copy.json.data.template.is_published === 0
      && copy.json.data.template.items.length === sysToolbox.items.length, JSON.stringify(copy.json).slice(0, 300));

  const badItems = await call('POST', '/checklist-templates',
    { name: 'Bad', category: 'internal_qa', items: [{ label: 'ok' }, { label: '  ' }] }, pmWeb);
  ok('a blank item label is refused with details.index',
    badItems.status === 400 && badItems.json.details?.index === 1, JSON.stringify(badItems.json));

  const badRole = await call('POST', '/checklist-templates',
    { name: 'Bad role', category: 'internal_qa', target_role: 'accountant', items: [{ label: 'x' }] }, pmWeb);
  ok('a target_role without checklists.execute is refused (INVALID_TARGET_ROLE)',
    badRole.status === 400 && badRole.json.code === 'INVALID_TARGET_ROLE', JSON.stringify(badRole.json));

  const tradieAuthor = await call('POST', '/checklist-templates',
    { name: 'T', category: 'other', items: [{ label: 'x' }] }, tradie);
  ok('a tradie cannot author templates (checklists.manage)', tradieAuthor.status === 403, JSON.stringify(tradieAuthor.json));

  const qa = await call('POST', '/checklist-templates', {
    name: 'Pre-pour QA', category: 'internal_qa',
    items: [
      { label: 'Reo chairs in place', photo_required: true },
      { label: 'Formwork braced' },
      { label: 'Optional note', is_required: false, photo_required: true },
    ],
  }, pmWeb);
  const qaId = qa.json.data.template.id;
  const pub = await call('POST', `/checklist-templates/${qaId}/publish`, {}, pmWeb);
  ok('publish sets is_published', pub.json.data?.template?.is_published === 1, JSON.stringify(pub.json));

  const prestart = await call('POST', '/checklist-templates', {
    name: 'Excavator pre-start', category: 'plant_prestart', target_role: 'tradie', items: [{ label: 'Tracks OK' }],
  }, pmWeb);
  const prestartId = prestart.json.data.template.id;
  await call('POST', `/checklist-templates/${prestartId}/publish`, {}, pmWeb);

  // PATCH while published replaces the set.
  const repl = await call('PATCH', `/checklist-templates/${prestartId}`,
    { items: [{ label: 'Tracks OK' }, { label: 'Horn works' }] }, pmWeb);
  ok('PATCH on a published template replaces its item set',
    repl.status === 200 && repl.json.data.template.items.length === 2 && repl.json.data.template.is_published === 1,
    JSON.stringify(repl.json).slice(0, 300));

  // ── 3. Sync pull ──
  const pull = await call('GET', '/sync/pull?since=0', undefined, tradie);
  const pulledTpls = (pull.json.changes || []).filter((c) => c.table_name === 'checklist_templates');
  ok('the device pulls system + org templates',
    pulledTpls.some((c) => c.data.org_id === null) && pulledTpls.some((c) => c.server_id === qaId),
    `n=${pulledTpls.length}`);
  const pulledItems = (pull.json.changes || []).filter((c) => c.table_name === 'checklist_template_items'
    && c.data.template_id === prestartId);
  ok('the replaced item set arrives as deletes + inserts',
    pulledItems.filter((c) => c.operation === 'delete').length === 1
      && pulledItems.filter((c) => c.operation === 'create').length === 2, JSON.stringify(pulledItems.map((c) => c.operation)));

  // ── 4. Execute ──
  const builderPush = await push(builder, 'checklist_instances', 'create',
    { id: uuid(), project_id: projId, template_id: qaId });
  ok('a Builder cannot run a checklist', builderPush.status === 403, JSON.stringify(builderPush.json));

  const foreOnPrestart = await push(fore, 'checklist_instances', 'create',
    { id: uuid(), project_id: projId, template_id: prestartId });
  ok('target_role is enforced (a foreperson on a tradie pre-start → FORBIDDEN)',
    foreOnPrestart.status === 403, JSON.stringify(foreOnPrestart.json));

  const asCompleted = await push(tradie, 'checklist_instances', 'create',
    { id: uuid(), project_id: projId, template_id: qaId, status: 'completed' });
  ok('creating a checklist already completed is refused', asCompleted.status === 400, JSON.stringify(asCompleted.json));

  const instId = uuid();
  const create = await push(tradie, 'checklist_instances', 'create',
    { id: instId, project_id: projId, template_id: qaId, template_name: 'forged', lat: -31.95, lng: 115.86 });
  ok('the tradie starts the checklist offline (applied)', create.status === 200 && create.json.applied === true,
    JSON.stringify(create.json));

  const tplItems = qa.json.data.template.items;
  const itemIds = tplItems.map(() => uuid());
  for (let i = 0; i < tplItems.length; i++) {
    await push(tradie, 'checklist_instance_items', 'create', {
      id: itemIds[i], instance_id: instId, seq: tplItems[i].seq, label: tplItems[i].label,
      is_required: tplItems[i].is_required, photo_required: tplItems[i].photo_required, result: 'pending',
    });
  }

  // ── 5. Completion ──
  const early = await push(tradie, 'checklist_instances', 'update', { id: instId, status: 'completed' });
  ok('completing with required items pending → CHECKLIST_INCOMPLETE (retryable, item ids)',
    early.status === 409 && early.json.code === 'CHECKLIST_INCOMPLETE'
      && early.json.details.unanswered.includes(itemIds[0]) && early.json.details.unanswered.includes(itemIds[1])
      && !early.json.details.item_ids.includes(itemIds[2]),
    JSON.stringify(early.json));

  await push(tradie, 'checklist_instance_items', 'update', { id: itemIds[0], result: 'pass' });
  await push(tradie, 'checklist_instance_items', 'update', { id: itemIds[1], result: 'fail', note: 'Brace missing' });
  await push(tradie, 'checklist_instance_items', 'update', { id: itemIds[2], result: 'na' });
  const noPhoto = await push(tradie, 'checklist_instances', 'update', { id: instId, status: 'completed' });
  ok('a pass item with photo_required but no documents photo blocks completion; the N/A one does not',
    noPhoto.status === 409 && JSON.stringify(noPhoto.json.details?.missing_photo) === JSON.stringify([itemIds[0]]),
    JSON.stringify(noPhoto.json));

  const photo = await uploadPhoto(tradie, projId, 'checklist_item', itemIds[0]);
  ok('the item photo uploads through Documents (entity_type checklist_item)', photo.status === 201, JSON.stringify(photo.json));

  const sign = await push(tradie, 'signoffs', 'create', {
    id: uuid(), subject_type: 'checklist_instance', subject_id: instId, project_id: projId,
    name: 'Visitor Val', signed_at: '2026-09-30 10:00:00',
  });
  ok('a non-user attendee signs off (name, client signed_at)', sign.status === 200 && sign.json.applied === true,
    JSON.stringify(sign.json));

  const done = await push(tradie, 'checklist_instances', 'update', { id: instId, status: 'completed' });
  ok('completion succeeds once evidence is in', done.status === 200 && done.json.applied === true, JSON.stringify(done.json));

  const detail = await call('GET', `/checklists/${instId}`, undefined, pmWeb);
  const ck = detail.json.data?.checklist;
  ok('server stamped completed_by/at, derived result=fail, kept the template snapshot (not the forged name)',
    ck && ck.status === 'completed' && ck.result === 'fail' && ck.completed_by === pmUser && !!ck.completed_at
      && ck.started_by === pmUser && ck.template_name === 'Pre-pour QA' && ck.category === 'internal_qa',
    JSON.stringify(ck).slice(0, 400));
  ok('detail embeds item evidence and sign-offs',
    ck?.items?.find((i) => i.id === itemIds[0])?.documents?.length === 1 && ck?.signoffs?.[0]?.name === 'Visitor Val',
    JSON.stringify(ck?.items).slice(0, 300));

  // ── 6. Frozen ──
  const f1 = await push(tradie, 'checklist_instances', 'update', { id: instId, notes: 'late edit' });
  const f2 = await push(tradie, 'checklist_instance_items', 'update', { id: itemIds[1], result: 'pass' });
  const f3 = await push(tradie, 'signoffs', 'create', {
    id: uuid(), subject_type: 'checklist_instance', subject_id: instId, project_id: projId,
    name: 'Late Larry', signed_at: '2026-09-30 11:00:00',
  });
  ok('instance, item and sign-off pushes after completion are all CHECKLIST_FROZEN',
    [f1, f2, f3].every((r) => r.status === 409 && r.json.code === 'CHECKLIST_FROZEN'),
    JSON.stringify([f1.json.code, f2.json.code, f3.json.code]));

  // A correction supersedes it.
  const corrId = uuid();
  await push(tradie, 'checklist_instances', 'create',
    { id: corrId, project_id: projId, template_id: qaId, supersedes_id: instId });

  // Unpublished templates still accept new instance pushes (§7 #4).
  await call('POST', `/checklist-templates/${qaId}/unpublish`, {}, pmWeb);
  const afterUnpub = await push(tradie, 'checklist_instances', 'create',
    { id: uuid(), project_id: projId, template_id: qaId });
  ok('an unpublished template still accepts an instance push', afterUnpub.status === 200, JSON.stringify(afterUnpub.json));

  // ── 7. Review ──
  const list = await call('GET', `/projects/${projId}/checklists?limit=2`, undefined, pmWeb);
  const rows = list.json.data?.checklists || [];
  ok('review list pages (limit 2 + next_cursor)', rows.length === 2 && !!list.json.data.next_cursor, JSON.stringify(list.json).slice(0, 300));
  const page2 = await call('GET', `/projects/${projId}/checklists?limit=2&cursor=${encodeURIComponent(list.json.data.next_cursor)}`, undefined, pmWeb);
  const all = [...rows, ...(page2.json.data?.checklists || [])];
  const original = all.find((r) => r.id === instId);
  ok('the original row shows fail_count and superseded_by_id',
    original && original.fail_count === 1 && original.superseded_by_id === corrId, JSON.stringify(original));
  const completedOnly = await call('GET', `/projects/${projId}/checklists?status=completed`, undefined, pmWeb);
  ok('status filter works', (completedOnly.json.data?.checklists || []).every((r) => r.status === 'completed')
    && completedOnly.json.data.checklists.length === 1, JSON.stringify(completedOnly.json).slice(0, 200));
  const tradieReview = await call('GET', `/projects/${projId}/checklists`, undefined, tradie);
  ok('review is checklists.manage only (tradie 403)', tradieReview.status === 403, JSON.stringify(tradieReview.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
