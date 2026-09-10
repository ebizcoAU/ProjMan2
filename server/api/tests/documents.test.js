// Documents/Upload module acceptance (contract: xprojman-21, migration v024).
//
// This is the module the app team's offline image queue (xprojman-22) is held on, so the tests
// track the contract clause by clause:
//   1. POST /documents stores bytes + metadata; server DERIVES sha256/size/mime (P3), and its
//      derivation beats anything the client sends.
//   2. IDEMPOTENCY — the headline for an offline queue: re-POSTing the same `client_ref` returns
//      the SAME document_id, does not duplicate, and does not re-store bytes.
//   3. The link is document → owner via (entity_type, entity_id = the owning row's OWN app-minted
//      UUID) — so a document uploads fine for an owning row that has NOT synced yet (P1).
//   4. N documents per entity, no server-side cap, on every kind (P2).
//   5. GET /documents/:id streams the exact bytes back (sha256 round-trips).
//   6. Read gate: projects.read OR you uploaded it — the Builder (who holds NO projects.read) can
//      read back their own delivery docket, but not another user's document.
//   7. DELETE is quality.write | documents.write; a tradie is refused; soft delete hides it.
//   8. Cross-org isolation.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/documents.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const crypto = require('crypto');
const pool = require('../src/db/pool');
const DocumentService = require('../src/services/DocumentService');

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
/** multipart POST /documents — fetch sets the boundary, so Content-Type must NOT be set here. */
async function postDoc(fields, { bytes, filename, type }, token) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  if (bytes) fd.append('file', new Blob([bytes], { type: type || 'application/octet-stream' }), filename || 'f.bin');
  const res = await fetch(`${BASE}/documents`, {
    method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: fd,
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
const uuid = () => crypto.randomUUID();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Real magic numbers, so the server's sniffing is exercised rather than the filename.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(64)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), crypto.randomBytes(64)]);

(async () => {
  console.log(`Documents/Upload module test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Docs ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `DOC-${s}`, name: 'Lot 12 dwelling' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);

  const foreTok = await pairAs(pm, pmUser, 'foreperson', `fore-${s}`);
  const tradieTok = await pairAs(pm, pmUser, 'tradie', `trad-${s}`);

  // The Builder must be a DISTINCT USER, not just a differently-roled device on the PM's identity:
  // `pairAs` assigns the device to the same user_id, which would make every "is this your own
  // upload?" check trivially true and hide the very gate this test is here to prove.
  const bEmail = `bldr${s}@x.com`;
  await call('POST', '/organisation/users',
    { email: bEmail, full_name: 'Bob Builder', role: 'builder', password: 'framing-crew-77' }, pm);
  const bLogin = await call('POST', '/auth/login',
    { email: bEmail, password: 'framing-crew-77', device: { device_uid: `bldr-${s}`, platform: 'android' } });
  const builderTok = bLogin.json.data?.accessToken;
  const builderUser = bLogin.json.data?.user?.id;
  ok('a distinct `builder` user exists and holds role builder',
    !!builderTok && bLogin.json.data?.user?.role === 'builder', JSON.stringify(bLogin.json?.data?.user));

  // ── 1 + 3. Upload against an owning row that DOES NOT EXIST yet (the whole point of P1) ──
  const itemId = uuid();            // an app-minted inspection_item id, not yet synced
  const ref1 = uuid();
  const up1 = await postDoc({
    client_ref: ref1, entity_type: 'inspection_item', entity_id: itemId, project_id: projId,
  }, { bytes: PNG, filename: 'crack.png', type: 'image/png' }, pm);

  ok('POST /documents stores a photo for an owning row that has NOT synced yet (P1)',
    up1.status === 201 && !!up1.json.data?.document_id, JSON.stringify(up1.json));
  const doc1 = up1.json.data.document_id;
  ok('server DERIVES sha256 from the bytes (P3)', up1.json.data.sha256 === sha(PNG), up1.json.data.sha256);
  ok('server DERIVES size_bytes', up1.json.data.size_bytes === PNG.length, String(up1.json.data.size_bytes));
  ok('server SNIFFS mime from the magic number', up1.json.data.mime_type === 'image/png', up1.json.data.mime_type);
  ok('kind defaults from entity_type (inspection_item → inspection_photo)',
    up1.json.data.kind === 'inspection_photo', up1.json.data.kind);
  ok('document_id is server-minted and is NOT the client_ref',
    doc1 !== ref1 && /^[0-9a-f-]{36}$/.test(doc1), doc1);

  // ── 2. IDEMPOTENCY — the offline-queue guarantee ──
  const retry = await postDoc({
    client_ref: ref1, entity_type: 'inspection_item', entity_id: itemId, project_id: projId,
  }, { bytes: PNG, filename: 'crack.png', type: 'image/png' }, pm);
  ok('IDEMPOTENT: re-POSTing the same client_ref returns the SAME document_id',
    retry.status === 200 && retry.json.data.document_id === doc1, JSON.stringify(retry.json));
  ok('…and is reported as a duplicate, not a new resource', retry.json.data.duplicate === true);
  const [[{ n: rowCount }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM documents WHERE client_ref = ?', [ref1]);
  ok('…and no second row was written', rowCount === 1, `rows=${rowCount}`);

  // The client's advisory values must lose to the server's own derivation (P3).
  const ref2 = uuid();
  const lying = await postDoc({
    client_ref: ref2, entity_type: 'inspection_item', entity_id: itemId, project_id: projId,
    sha256: 'deadbeef', size_bytes: '999999', mime_type: 'application/x-pretend',
  }, { bytes: JPEG, filename: 'shot.jpg', type: 'image/jpeg' }, pm);
  ok('client-sent sha256/size/mime are ADVISORY — the server derivation wins (P3)',
    lying.json.data.sha256 === sha(JPEG) && lying.json.data.size_bytes === JPEG.length &&
    lying.json.data.mime_type === 'image/jpeg', JSON.stringify(lying.json.data));

  // ── 4. N per entity, no cap ──
  const list1 = await call('GET', `/documents?entity_type=inspection_item&entity_id=${itemId}`, undefined, pm);
  ok('GET /documents?entity_type=&entity_id= lists N documents per entity — no server cap (P2)',
    list1.status === 200 && list1.json.data.documents.length === 2, JSON.stringify(list1.json.data?.documents?.length));
  ok('the list is newest-first and carries the metadata the app caches',
    list1.json.data.documents[0].sha256 === sha(JPEG) && !!list1.json.data.documents[0].kind,
    JSON.stringify(list1.json.data.documents[0]));

  // ── 5. Stream the bytes back ──
  const streamed = await fetch(`${BASE}/documents/${doc1}`, { headers: { Authorization: `Bearer ${pm}` } });
  const got = Buffer.from(await streamed.arrayBuffer());
  ok('GET /documents/:id streams the EXACT bytes back (sha256 round-trips)',
    streamed.status === 200 && sha(got) === sha(PNG), `${streamed.status} len=${got.length}`);
  ok('…with the derived content-type', streamed.headers.get('content-type') === 'image/png');

  // ── 6. Read gate: projects.read OR own ──
  const builderRef = uuid(), deliveryId = uuid();
  const bUp = await postDoc({
    client_ref: builderRef, entity_type: 'delivery', entity_id: deliveryId, project_id: projId,
  }, { bytes: PDF, filename: 'docket.pdf', type: 'application/pdf' }, builderTok);
  ok('a BUILDER can upload a delivery docket (POST is authenticated, no projects.read needed)',
    bUp.status === 201, JSON.stringify(bUp.json));

  const bList = await call('GET', `/documents?entity_type=delivery&entity_id=${deliveryId}`, undefined, builderTok);
  ok('THE GATE FIX: the Builder — who holds NO projects.read — can read back their OWN docket',
    bList.status === 200 && bList.json.data.documents.length === 1, JSON.stringify(bList.json));

  // Decision #19 has TWO halves, and this pair is what proves "engaged projects ONLY". The Builder
  // is not yet a member of this project, so `documents.read` alone must not reveal anything —
  // the projectScope narrowing is doing the work.
  const bOther = await call('GET', `/documents?entity_type=inspection_item&entity_id=${itemId}`, undefined, builderTok);
  ok('a Builder NOT engaged on the project sees none of its documents (scope, not permission)',
    bOther.status === 200 && bOther.json.data.documents.length === 0, JSON.stringify(bOther.json.data));

  const bStream = await fetch(`${BASE}/documents/${doc1}`, { headers: { Authorization: `Bearer ${builderTok}` } });
  ok('…and cannot stream a document from a job they are not on', bStream.status === 404 || bStream.status === 403,
    String(bStream.status));

  // ── Decision #19: ENGAGE the Builder (a job-award acceptance writes exactly this row) ──
  const addM = await call('POST', `/projects/${projId}/members`, { user_id: builderUser }, pm);
  ok('the Builder is engaged onto the project (project_members row — what accepting a job award writes)',
    addM.status === 201 || addM.status === 200, JSON.stringify(addM.json));

  const bEngaged = await call('GET', `/documents?entity_type=inspection_item&entity_id=${itemId}`, undefined, builderTok);
  ok('DECISION #19: an ENGAGED Builder now sees documents uploaded by OTHERS on that job (documents.read, v025)',
    bEngaged.status === 200 && bEngaged.json.data.documents.length === 2, JSON.stringify(bEngaged.json.data));

  const bEngagedStream = await fetch(`${BASE}/documents/${doc1}`, { headers: { Authorization: `Bearer ${builderTok}` } });
  ok('…and can stream them', bEngagedStream.status === 200, String(bEngagedStream.status));

  const fList = await call('GET', `/documents?entity_type=inspection_item&entity_id=${itemId}`, undefined, foreTok);
  ok('a foreperson (projects.read) sees the entity\'s documents',
    fList.json.data.documents.length === 2, JSON.stringify(fList.json.data?.documents?.length));

  // ── 7. DELETE gate ──
  const tDel = await call('DELETE', `/documents/${doc1}`, undefined, tradieTok);
  ok('a tradie CANNOT delete (holds neither quality.write nor documents.write)',
    tDel.status === 403, JSON.stringify(tDel.json));

  const fDel = await call('DELETE', `/documents/${doc1}`, undefined, foreTok);
  ok('a foreperson CAN delete (documents.write, new in v024)',
    fDel.status === 200 && fDel.json.data.status === 'deleted', JSON.stringify(fDel.json));

  const list2 = await call('GET', `/documents?entity_type=inspection_item&entity_id=${itemId}`, undefined, pm);
  ok('a soft-deleted document drops out of the list', list2.json.data.documents.length === 1);
  const [[delRow]] = await pool.query('SELECT is_deleted, storage_key FROM documents WHERE id = ?', [doc1]);
  ok('soft delete flags the row but KEEPS it (evidentiary record)', delRow.is_deleted === 1);
  ok('…and deliberately leaves the bytes in storage (reversible)',
    require('../src/lib/storage').exists(delRow.storage_key));

  const pmDel = await call('DELETE', `/documents/${doc1}`, undefined, pm);
  ok('deleting an already-deleted document is idempotent', pmDel.json.data.status === 'already_deleted');

  // ── 8. Validation + cross-org ──
  const noRef = await postDoc({ entity_type: 'defect', entity_id: uuid() },
    { bytes: PNG, filename: 'x.png' }, pm);
  ok('client_ref is required', noRef.status === 400, JSON.stringify(noRef.json));
  const badType = await postDoc({ client_ref: uuid(), entity_type: 'not_a_thing', entity_id: uuid() },
    { bytes: PNG, filename: 'x.png' }, pm);
  ok('an unknown entity_type is refused', badType.status === 400, JSON.stringify(badType.json));
  const noFile = await postDoc({ client_ref: uuid(), entity_type: 'defect', entity_id: uuid() }, {}, pm);
  ok('a file is required', noFile.status === 400, JSON.stringify(noFile.json));

  // ── 'task' entity_type (v030, xprojman-29) — task drawings/reports reuse this exact
  // mechanism, no new store. Same soft-ref-before-sync behaviour as inspection_item above.
  const taskDocId = uuid();
  const taskDocRef = uuid();
  const taskDoc = await postDoc({
    client_ref: taskDocRef, entity_type: 'task', entity_id: taskDocId, project_id: projId,
  }, { bytes: PNG, filename: 'drawing.png', type: 'image/png' }, pm);
  ok('POST /documents accepts entity_type=task', taskDoc.status === 201, JSON.stringify(taskDoc.json));
  ok('kind defaults from entity_type (task → task_document)',
    taskDoc.json.data.kind === 'task_document', taskDoc.json.data.kind);
  const taskDocList = await call('GET', `/documents?entity_type=task&entity_id=${taskDocId}`, undefined, pm);
  ok('GET /documents?entity_type=task lists it back',
    (taskDocList.json.data.documents || []).some((d) => d.document_id === taskDoc.json.data.document_id));

  // ── GET /documents?project_id= — the repository view (unblocks Portal's Documents
  // repository UI): every entity_type on this project in one call, not one at a time ──
  const repo = await call('GET', `/documents?project_id=${projId}`, undefined, pm);
  ok('repository view 200s', repo.status === 200, JSON.stringify(repo.json));
  const repoIds = (repo.json.data.documents || []).map((d) => d.document_id);
  ok('repository view spans multiple entity_types (inspection_item photo + task drawing both present)',
    repoIds.includes(lying.json.data.document_id) && repoIds.includes(taskDoc.json.data.document_id), JSON.stringify(repoIds));
  ok('the soft-deleted doc1 (deleted in §7 above) is excluded, same as any other list', !repoIds.includes(doc1));

  const repoBuilder = await call('GET', `/documents?project_id=${projId}`, undefined, builderTok);
  ok('an engaged builder sees the repository view too (documents.read covers project-wide, not just their own uploads)',
    repoBuilder.status === 200 && (repoBuilder.json.data.documents || []).length > 0, JSON.stringify(repoBuilder.json));

  const noProjectId = await call('GET', '/documents', undefined, pm);
  ok('neither project_id nor entity_type/entity_id given falls through to the original 400', noProjectId.status === 400, JSON.stringify(noProjectId.json));

  const unknownProject = await call('GET', '/documents?project_id=00000000-0000-4000-8000-000000000000', undefined, pm);
  ok('an unknown project_id 404s (non-disclosure, same convention as every /projects/:id/X sub-resource)',
    unknownProject.status === 404, JSON.stringify(unknownProject.json));

  const reg2 = await call('POST', '/auth/register', {
    organisation: { name: `Other ${s}` },
    user: { full_name: 'Other PM', email: `other${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `oth-${s}`, platform: 'android' },
  });
  const other = reg2.json.data.accessToken;
  const xStream = await fetch(`${BASE}/documents/${lying.json.data.document_id}`,
    { headers: { Authorization: `Bearer ${other}` } });
  ok('CROSS-ORG: another org cannot stream this org\'s document (404, not 403)',
    xStream.status === 404, String(xStream.status));
  const xList = await call('GET', `/documents?entity_type=inspection_item&entity_id=${itemId}`, undefined, other);
  ok('CROSS-ORG: another org sees none of this entity\'s documents',
    (xList.json.data?.documents || []).length === 0, JSON.stringify(xList.json.data));
  const xRepo = await call('GET', `/documents?project_id=${projId}`, undefined, other);
  ok('CROSS-ORG: another org gets 404 on this project\'s repository view, not an empty list',
    xRepo.status === 404, JSON.stringify(xRepo.json));

  // ── Unit: mime sniffing ──
  ok('unit: sniffs PNG/JPEG/PDF from magic numbers, ignoring a wrong filename',
    DocumentService.sniffMime(PNG, 'wrong.txt') === 'image/png' &&
    DocumentService.sniffMime(JPEG, 'wrong.txt') === 'image/jpeg' &&
    DocumentService.sniffMime(PDF, 'wrong.txt') === 'application/pdf');
  ok('unit: falls back to the extension, then to octet-stream',
    DocumentService.sniffMime(Buffer.from('plain'), 'notes.csv') === 'text/csv' &&
    DocumentService.sniffMime(Buffer.from('plain'), 'mystery.zzz') === 'application/octet-stream');

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
