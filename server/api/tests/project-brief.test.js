// Project Brief PDF snapshots (xprojman-41 §3, confirmed §8/§9, 2026-09-07).
//
// Proves:
//   1. POST /:id/brief-snapshots (the "Formalize Brief" action) generates a
//      real PDF (starts with the %PDF magic bytes, not a stub), stored and
//      listed, downloadable as application/pdf.
//   2. Permission split: projects.write to generate, a role without it
//      refused; projects.read to list/view.
//   3. The variation-approval auto-trigger (ContractService.respondVariation)
//      generates a NEW snapshot with variation_id set — called directly at
//      the SERVICE level with a `client`-role actor, same precedent
//      variations.test.js already established (no live client session is
//      reachable in v1, confirmed via that file's own "DORMANT GATE" test) —
//      and specifically proves the client actor does NOT need projects.write
//      for this to work (the whole point of the unchecked-internal-path
//      design, not just an implementation detail).
//   4. Declining a variation generates NOTHING.
//   5. Cross-org isolation on the download endpoint.
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/project-brief.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const ContractService = require('../src/services/ContractService');
const access = require('../src/lib/access');
const pool = require('../src/db/pool');

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
async function callRaw(method, path, token) {
  const res = await fetch(BASE + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const buffer = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buffer, contentType: res.headers.get('content-type') };
}
async function pairAs(admin, userId, role, uid) {
  const init = await call('POST', '/pairing/initiate', { role, label: uid, assign_user_id: userId }, admin);
  const rid = init.json.data.request_id, nonce = init.json.data.qr_payload.nonce;
  await call('POST', '/pairing/request', { request_id: rid, nonce, device_uid: uid, platform: 'android' });
  await call('POST', '/pairing/confirm', { request_id: rid, role }, admin);
  const st = await call('GET', `/pairing/status/${rid}?device_uid=${uid}`);
  return st.json.data?.accessToken;
}

(async () => {
  console.log(`Project Brief snapshot test → ${BASE}\n`);
  // ContractService.respondVariation is called DIRECTLY below (service-level,
  // not via HTTP), so this process needs its own access-matrix load — the
  // running server on BASE already did this at its own boot, but this test
  // process never went through index.js's startup path.
  await access.loadMatrix();
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Brief Co ${s}` },
    user: { full_name: 'Pat PM', email: `brief${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;
  const orgId = reg.json.data.organisation.id;

  const tradieTok = await pairAs(pm, pmUser, 'tradie', `tradie-${s}`); // no projects.write

  const regB = await call('POST', '/auth/register', {
    organisation: { name: `Brief Co B ${s}` },
    user: { full_name: 'Other PM', email: `briefb${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pmb-${s}`, platform: 'android' },
  });
  const pmB = regB.json.data.accessToken;

  const proj = await call('POST', '/projects',
    { code: `PB-${s}`, name: 'Brief test dwelling', description: 'Test brief', site_address: '1 Test St, Perth WA' }, pm);
  const projId = proj.json.data.id;

  // ── 1/2. Generate the intake snapshot ──
  const noPerm = await call('POST', `/projects/${projId}/brief-snapshots`, undefined, tradieTok);
  ok('a role without projects.write cannot formalize a brief (403)', noPerm.status === 403, JSON.stringify(noPerm.json));

  const gen = await call('POST', `/projects/${projId}/brief-snapshots`, undefined, pm);
  ok('Formalize Brief generates a snapshot (201)', gen.status === 201, JSON.stringify(gen.json));
  ok('intake snapshot has no variation_id', gen.json.data.variation_id === null, JSON.stringify(gen.json.data));
  const snapshotId = gen.json.data.id;

  const list = await call('GET', `/projects/${projId}/brief-snapshots`, undefined, pm);
  ok('snapshot appears in the list', list.json.data.snapshots.some((sn) => sn.id === snapshotId), JSON.stringify(list.json));

  const dl = await callRaw('GET', `/projects/${projId}/brief-snapshots/${snapshotId}`, pm);
  ok('download returns application/pdf', dl.status === 200 && dl.contentType === 'application/pdf', dl.contentType);
  ok('the bytes are a real PDF (starts with %PDF magic bytes, not a stub)',
    dl.buffer.slice(0, 4).toString() === '%PDF', dl.buffer.slice(0, 20).toString());
  ok('a non-trivial PDF (more than just a header)', dl.buffer.length > 500, dl.buffer.length);

  const noReadPerm = await call('GET', `/projects/${projId}/brief-snapshots`, undefined, undefined);
  ok('no auth refused (401)', noReadPerm.status === 401);

  // ── 3/4. Variation-approval auto-trigger, at the service level (no live
  // client session is reachable in v1 — same precedent variations.test.js
  // itself establishes with its own DORMANT GATE test) ──
  const contract = await call('POST', `/projects/${projId}/contracts`,
    { party_type: 'client', title: 'Head contract', contract_value: 200000 }, pm);
  const variation = await call('POST', `/projects/${projId}/variations`,
    { contract_id: contract.json.data.id, description: 'Extra retaining wall', amount: 5000 }, pm);
  const variationId = variation.json.data.id;

  const beforeCount = (await call('GET', `/projects/${projId}/brief-snapshots`, undefined, pm)).json.data.snapshots.length;

  // A real `client` actor — holds variations.approve but NOT projects.write
  // (migration_v005: client's only permission is projects.read). Calling the
  // SERVICE directly (not via HTTP) because there is no way to mint a live
  // client session in v1 — the exact same reason variations.test.js simulates
  // approval via a direct DB UPDATE instead of a real request.
  const clientActor = { role: 'client', userId: pmUser, orgId };
  const declined = await ContractService.respondVariation({
    orgId, projectId: projId, variationId, actor: clientActor, accept: false,
  });
  ok('declining a variation does not error', declined.status === 'declined');

  // Raise a second variation to approve (the first is now resolved/declined).
  const variation2 = await call('POST', `/projects/${projId}/variations`,
    { contract_id: contract.json.data.id, description: 'Upgraded tapware', amount: 1200 }, pm);
  const approved = await ContractService.respondVariation({
    orgId, projectId: projId, variationId: variation2.json.data.id, actor: clientActor, accept: true,
  });
  ok('approving a variation succeeds even though the client actor has no projects.write',
    approved.status === 'approved');

  // The snapshot generation is fire-and-forget (non-fatal by design) off respondVariation.
  await new Promise((r) => setTimeout(r, 300));

  const afterDecline = await call('GET', `/projects/${projId}/brief-snapshots`, undefined, pm);
  const afterCount = afterDecline.json.data.snapshots.length;
  ok('exactly one new snapshot after one decline + one approval (decline generated nothing)',
    afterCount === beforeCount + 1, `before=${beforeCount} after=${afterCount}`);

  const variationSnapshot = afterDecline.json.data.snapshots.find((sn) => sn.variation_id === variation2.json.data.id);
  ok('the new snapshot is tagged with the approved variation_id', !!variationSnapshot, JSON.stringify(afterDecline.json.data.snapshots));

  // ── 5. Cross-org isolation ──
  const crossOrg = await callRaw('GET', `/projects/${projId}/brief-snapshots/${snapshotId}`, pmB);
  ok('a different org cannot download this project\'s brief (404)', crossOrg.status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
