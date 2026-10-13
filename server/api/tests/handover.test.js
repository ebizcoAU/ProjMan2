// Handover pack + client final sign-off, S18.13/S18.14 (xprojman-51, migration v050).
//
//   1. Stage 18 seeding: S18.14 is a blocking, server-satisfied requirement; S18.12 no longer
//      blocks (xprojman-43 §14 O1).
//   2. The pack: handover-kind documents only, a server-computed canonical hash, pulled by the App.
//   3. Sync (assisted_device): permission, OC gate, signature-first, create-only, idempotent
//      retry, SIGNOFF_FROZEN, the DB freeze trigger, the requirement auto-satisfied.
//   4. A pack change re-opens the requirement; a stale sign-off is stored uncounted + PACK_CHANGED.
//   5. REST (Portal): paper_upload by short hash, client_self refused (no role holds it yet),
//      decline needs reasons, the list with is_current + documents.
//
// Run: EMAIL_ENABLED=false DB_NAME=c1projman2_e2e DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &
//      DB_NAME=c1projman2_e2e BASE=http://localhost:4199 node tests/handover.test.js
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
const push = (tok, operation, data) =>
  call('POST', '/sync/push', { table_name: 'client_signoffs', operation, data: { updated_at: Date.now(), ...data } }, tok);
async function upload(tok, fields) {
  const fd = new FormData();
  fd.append('client_ref', crypto.randomUUID());
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), crypto.randomBytes(64)]);
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'doc.pdf');
  const res = await fetch(`${BASE}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}
const uuid = () => crypto.randomUUID();
const reqRow = async (projId) => (await pool.query(
  `SELECT * FROM hold_point_requirements WHERE project_id = ? AND auto_source = 'client_signoff' LIMIT 1`, [projId]))[0][0];

(async () => {
  console.log(`Handover / S18.14 test → ${BASE}\n`);
  const s = Date.now();
  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Handover ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id;
  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const projId = (await call('POST', '/projects', { code: `HO-${s}`, name: 'Lot 7 dwelling' }, pm)).json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  const inspector = await pairAs(pm, pmUser, 'inspector', `insp-${s}`);

  // ── 1. Stage 18 seeding ──
  const [s18reqs] = await pool.query(
    `SELECT h.label, h.blocks_progress, h.auto_source FROM hold_point_requirements h
       JOIN project_stages ps ON ps.id = h.stage_id WHERE ps.project_id = ? AND ps.seq = 18`, [projId]);
  const r1412 = s18reqs.find((r) => r.label.includes('S18.12'));
  const r1414 = s18reqs.find((r) => r.auto_source === 'client_signoff');
  ok('S18.14 is seeded as a BLOCKING, server-satisfied Stage 18 requirement', r1414?.blocks_progress === 1, JSON.stringify(s18reqs));
  ok('S18.12 no longer blocks (x43 §14 O1)', r1412?.blocks_progress === 0, JSON.stringify(r1412));

  // ── 2. The pack ──
  const empty = await call('GET', `/projects/${projId}/handover-pack`, undefined, pm);
  ok('an empty pack has no hash', empty.status === 200 && empty.json.data.pack_hash === null && empty.json.data.document_count === 0,
    JSON.stringify(empty.json));
  const noProj = await upload(pm, { kind: 'occupation_certificate' });
  ok('a handover-only kind needs a project_id (400)', noProj.status === 400, JSON.stringify(noProj.json));
  const oc = await upload(pm, { kind: 'occupation_certificate', project_id: projId });
  await upload(pm, { kind: 'general', project_id: projId }); // not a handover kind: never in the pack
  const pack1 = await call('GET', `/projects/${projId}/handover-pack`, undefined, pm);
  const expectHash = crypto.createHash('sha256')
    .update(`${oc.json.data.document_id}:${oc.json.data.sha256}`).digest('hex');
  ok('the pack holds only handover-kind documents', pack1.json.data.document_count === 1, JSON.stringify(pack1.json.data));
  ok('pack_hash = SHA-256 of the canonical "id:sha256" manifest', pack1.json.data.pack_hash === expectHash);
  ok('…with an 8-hex short hash', pack1.json.data.short === expectHash.slice(0, 8));
  const pull = await call('GET', '/sync/pull?since=0', undefined, pm);
  const packPulled = (pull.json.changes || []).find((c) => c.table_name === 'handover_packs' && c.server_id === projId);
  ok('the handover_packs row is pulled (offline at the house)', !!packPulled, JSON.stringify((pull.json.changes || []).map((c) => c.table_name)));
  const packPush = await call('POST', '/sync/push',
    { table_name: 'handover_packs', operation: 'create', data: { id: uuid(), project_id: projId, updated_at: Date.now() } }, pm);
  ok('handover_packs is server-owned: a device push is refused', packPush.status >= 400, JSON.stringify(packPush.json));

  // ── 3. Sync (assisted_device) ──
  const sig = await upload(pm, { entity_type: 'client_signoff', entity_id: uuid(), project_id: projId });
  ok('a client_signoff signature uploads (default kind signature)', sig.status === 201 && sig.json.data.kind === 'signature',
    JSON.stringify(sig.json));
  const base = {
    project_id: projId, pack_hash: pack1.json.data.pack_hash, decision: 'accepted',
    signer_name: 'Casey Client', signed_at: '2026-10-14T02:00:00.000Z', signature_document_id: sig.json.data.document_id,
  };
  const early = await push(pm, 'create', { id: uuid(), ...base });
  ok('before S18.3 is validated: OC_NOT_VALIDATED (409)', early.status === 409 && early.json.code === 'OC_NOT_VALIDATED',
    JSON.stringify(early.json));
  await pool.query('UPDATE project_stages SET is_validated = 1 WHERE project_id = ? AND seq = 18', [projId]);

  const insp = await push(inspector, 'create', { id: uuid(), ...base });
  ok('an inspector cannot take a client sign-off (no handover.witness)', insp.status === 403, JSON.stringify(insp.json));
  const noSig = await push(pm, 'create', { id: uuid(), ...base, signature_document_id: uuid() });
  ok('the signature must be uploaded first: SIGNATURE_MISSING', noSig.status === 409 && noSig.json.code === 'SIGNATURE_MISSING',
    JSON.stringify(noSig.json));
  const declNoReason = await push(pm, 'create', { id: uuid(), ...base, decision: 'declined' });
  ok('a decline needs reasons (400)', declNoReason.status === 400, JSON.stringify(declNoReason.json));

  const so1 = uuid();
  const accepted = await push(pm, 'create', { id: so1, ...base, witnessed_by: uuid(), counted: 1 });
  ok('an assisted sign-off on the current pack is accepted', accepted.status === 200, JSON.stringify(accepted.json));
  const [[row1]] = await pool.query('SELECT * FROM client_signoffs WHERE id = ?', [so1]);
  ok('the server stamps witnessed_by (the pusher, not the client\'s value), method and frozen_at',
    row1.witnessed_by === pmUser && row1.method === 'assisted_device' && !!row1.frozen_at, JSON.stringify(row1));
  ok('counted = 1 and signed_at normalised to Perth wall-clock',
    row1.counted === 1 && String(row1.signed_at) === '2026-10-14 10:00:00', `${row1.counted} ${row1.signed_at}`);
  ok('the S18.14 requirement is now satisfied by the server', (await reqRow(projId))?.status === 'satisfied');

  const retry = await push(pm, 'create', { id: so1, ...base });
  ok('a retried create of the same sign-off is acknowledged (idempotent)', retry.status === 200, JSON.stringify(retry.json));
  const upd = await push(pm, 'update', { id: so1, signer_name: 'Someone Else' });
  ok('any update push is SIGNOFF_FROZEN (409)', upd.status === 409 && upd.json.code === 'SIGNOFF_FROZEN', JSON.stringify(upd.json));
  let dbBlocked = false;
  try { await pool.query("UPDATE client_signoffs SET signer_name = 'tamper' WHERE id = ?", [so1]); } catch { dbBlocked = true; }
  ok('the database itself refuses an UPDATE (freeze trigger)', dbBlocked);
  let dbDelBlocked = false;
  try { await pool.query('DELETE FROM client_signoffs WHERE id = ?', [so1]); } catch { dbDelBlocked = true; }
  ok('…and a DELETE', dbDelBlocked);

  const stage18 = (await pool.query('SELECT id FROM project_stages WHERE project_id = ? AND seq = 18', [projId]))[0][0];
  const manual = await call('POST', `/projects/${projId}/stages/${stage18.id}/hold-points/${(await reqRow(projId)).id}/satisfy`, {}, pm);
  ok('S18.14 cannot be satisfied by hand', manual.status === 409, JSON.stringify(manual.json));

  // ── 4. The pack changes ──
  await upload(pm, { kind: 'warranty', project_id: projId });
  ok('a new handover document re-opens the S18.14 requirement', (await reqRow(projId))?.status === 'open');
  const so2 = uuid();
  const stale = await push(pm, 'create', { id: so2, ...base });
  ok('a sign-off on the old pack: PACK_CHANGED (409) with the current hash',
    stale.status === 409 && stale.json.code === 'PACK_CHANGED' && /^[0-9a-f]{64}$/.test(stale.json.details?.current_pack_hash || ''),
    JSON.stringify(stale.json));
  const [[row2]] = await pool.query('SELECT counted FROM client_signoffs WHERE id = ?', [so2]);
  ok('…the stale row is still stored, uncounted (evidence)', row2?.counted === 0, JSON.stringify(row2));
  ok('…and the requirement stays open', (await reqRow(projId))?.status === 'open');

  // ── 5. REST (Portal) ──
  const pack2 = (await call('GET', `/projects/${projId}/handover-pack`, undefined, pm)).json.data;
  const scan = await upload(pm, { entity_type: 'client_signoff', entity_id: uuid(), project_id: projId });
  const paperBody = { method: 'paper_upload', decision: 'accepted', signer_name: 'Casey Client',
    signed_at: '2026-10-14 11:30', signature_document_id: scan.json.data.document_id };
  const wrongShort = await call('POST', `/projects/${projId}/client-signoffs`, { ...paperBody, pack_hash_short: '00000000' }, pm);
  ok('paper upload with a stale printed short hash: PACK_CHANGED', wrongShort.status === 409 && wrongShort.json.code === 'PACK_CHANGED',
    JSON.stringify(wrongShort.json));
  const noScan = await call('POST', `/projects/${projId}/client-signoffs`,
    { ...paperBody, signature_document_id: undefined, pack_hash_short: pack2.short }, pm);
  ok('paper upload needs the scan (400)', noScan.status === 400, JSON.stringify(noScan.json));
  const paper = await call('POST', `/projects/${projId}/client-signoffs`, { ...paperBody, pack_hash_short: pack2.short }, pm);
  ok('paper upload with the right short hash is accepted (201)', paper.status === 201 && paper.json.data.client_signoff?.method === 'paper_upload',
    JSON.stringify(paper.json));
  ok('…stored with the FULL pack hash and the PM as witness',
    paper.json.data.client_signoff?.pack_hash === pack2.pack_hash && paper.json.data.client_signoff?.witnessed_by?.id === pmUser);
  ok('…and the requirement is satisfied again', (await reqRow(projId))?.status === 'satisfied');
  const self = await call('POST', `/projects/${projId}/client-signoffs`, { ...paperBody, method: 'client_self', pack_hash: pack2.pack_hash }, pm);
  ok('client_self needs handover.signoff, which no role holds yet (403)', self.status === 403, JSON.stringify(self.json));

  const list = await call('GET', `/projects/${projId}/client-signoffs`, undefined, pm);
  const rows = list.json.data?.client_signoffs || [];
  ok('the list returns every sign-off, newest first', list.status === 200 && rows.length === 3 && rows[0].method === 'paper_upload',
    JSON.stringify(rows.map((r) => r.method)));
  ok('only the newest counted row on the current pack is is_current',
    rows[0].is_current === true && rows.filter((r) => r.is_current).length === 1, JSON.stringify(rows.map((r) => r.is_current)));
  ok('the signature / scan document is embedded', rows[0].documents?.[0]?.id === scan.json.data.document_id);
  const pull2 = await call('GET', '/sync/pull?since=0', undefined, pm);
  ok('client_signoffs are pulled (history offline)', (pull2.json.changes || []).some((c) => c.table_name === 'client_signoffs'));

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
