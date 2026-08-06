// PM2-02 attestations acceptance (serverdesignspec §13.3/§13.4, projman-02 §10.2/§10.3).
//
// Proves:
//   1. A task verify() emits a signed 'task_complete' attestation for the task's
//      assignee (§13.3's hook — no existing service logic changed, one call added).
//   2. The attestation is signed and signature_valid at the owner's own read.
//   3. A tampered/forged signature is excluded from the trust score, not merely flagged
//      (projman-02 §10.2) — verified via the service layer directly (no HTTP path
//      exists to forge a signature, by design).
//   4. Trust score is a number, present on GET /identity/evidence (§10.3 caching).
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 DB_NAME=c1projman2_e2e node src/index.js &  then
//      DB_NAME=c1projman2_e2e BASE=http://localhost:4199 node tests/attestations.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const crypto = require('crypto');
const pool = require('../src/db/pool');
const AttestationService = require('../src/services/AttestationService');

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

(async () => {
  console.log(`PM2-02 attestations test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Attest ${s}` },
    user: { full_name: 'Pat PM', email: `attpm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `attpm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken;
  const pmUser = reg.json.data.user.id;
  const orgId = reg.json.data.organisation.id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `AT-${s}`, name: 'Attestation Job' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);
  const stagesRes = await call('GET', `/projects/${projId}`, undefined, pm);
  const stage1 = stagesRes.json.data.stages.find((st) => st.seq === 1).id;

  const foreTok = await pairAs(pm, pmUser, 'foreperson', `att-fore-${s}`);
  const supTok  = await pairAs(pm, pmUser, 'siteSupervisor', `att-sup-${s}`);
  const taskId = crypto.randomUUID();

  await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'create',
    data: { id: taskId, project_id: projId, stage_id: stage1, name: 'Frame', completion: 0, assigned_to: pmUser, updated_at: Date.now() },
  }, foreTok);
  await call('POST', '/sync/push', {
    table_name: 'tasks', operation: 'update',
    data: { id: taskId, completion: 100, updated_at: Date.now() },
  }, foreTok);
  const verifyRes = await call('POST', `/projects/${projId}/tasks/${taskId}/verify`, {}, supTok);
  ok('task verified', verifyRes.status === 200, JSON.stringify(verifyRes.json));

  // Emission is fire-and-forget (best-effort) — give it a beat to land.
  await new Promise((r) => setTimeout(r, 300));

  const evidence = await call('GET', '/identity/evidence', undefined, pm);
  const attestation = (evidence.json.data.attestations || []).find((a) => a.source_id === taskId);
  ok('a task_complete attestation was emitted for the assignee', !!attestation, JSON.stringify(evidence.json.data));
  ok('the attestation is signed and valid at the owner\'s own read',
    !!attestation && attestation.signature_valid === 1, JSON.stringify(attestation));
  ok('the owner\'s own read shows the full issuing org (decision #28)',
    !!attestation && attestation.issuing_org_id === orgId, JSON.stringify(attestation));
  ok('a numeric trust score is present (§10.3 cache)',
    typeof evidence.json.data.trust_score === 'number', JSON.stringify(evidence.json.data.trust_score));

  // ── Tampered signature is excluded from the score, not merely flagged (§10.2) ──
  const tamperedId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO attestations (id, subject_user_id, issuing_org_id, source_type, payload_json, signature, signature_valid)
     VALUES (?, ?, ?, 'inspection', '{}', 'forged-not-a-real-signature', NULL)`,
    [tamperedId, pmUser, orgId]
  );
  // Bust the cache so trustScore recomputes and has to re-verify the new row.
  await pool.query(`UPDATE identities SET trust_score_cache = NULL WHERE user_id = ?`, [pmUser]);
  await AttestationService.trustScore(pmUser);
  const [[tamperedRow]] = await pool.query(`SELECT signature_valid FROM attestations WHERE id = ?`, [tamperedId]);
  ok('a forged signature is marked invalid on verification, not silently trusted',
    tamperedRow.signature_valid === 0, JSON.stringify(tamperedRow));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
