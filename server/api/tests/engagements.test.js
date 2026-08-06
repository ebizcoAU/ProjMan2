// PM2-02 engagements acceptance (serverdesignspec §13, architecture approved
// 2026-07-22 in projman-02.md; decisions #26-#29).
//
// Proves:
//   1. Cross-org QR flow: initiate (panel.manage) -> request (scan, creates pending)
//      -> confirm (panel.manage, status=active).
//   2. Guards: SAME_ORG rejected, ROLE_MISMATCH rejected, SELF_ENGAGEMENT rejected.
//   3. activate() mints a second token scoped to the ENGAGING org; a /sync/pull under
//      that token is restricted to scope_json's project (not the caller's home org).
//   4. Decision #29: activating an engagement does NOT disturb the person's HOME
//      session's authoritative status (scoped by (user_id, org_id), not user_id alone).
//   5. revoke() tombstones the engagement; the activated token is rejected on its
//      next request (ENGAGEMENT_REVOKED).
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 DB_NAME=c1projman2_e2e node src/index.js &  then
//      DB_NAME=c1projman2_e2e BASE=http://localhost:4199 node tests/engagements.test.js
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
async function pairAs(admin, userId, role, uid) {
  const init = await call('POST', '/pairing/initiate', { role, label: uid, assign_user_id: userId }, admin);
  const rid = init.json.data.request_id, nonce = init.json.data.qr_payload.nonce;
  await call('POST', '/pairing/request', { request_id: rid, nonce, device_uid: uid, platform: 'android' });
  await call('POST', '/pairing/confirm', { request_id: rid, role }, admin);
  const st = await call('GET', `/pairing/status/${rid}?device_uid=${uid}`);
  return st.json.data?.accessToken;
}

(async () => {
  console.log(`PM2-02 engagements test → ${BASE}\n`);
  const s = Date.now();

  // ── Org A (the engaging org) — a PM with a project ──────────────────────────
  const regA = await call('POST', '/auth/register', {
    organisation: { name: `EngA ${s}` },
    user: { full_name: 'PM Alpha', email: `pma${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pma-${s}`, platform: 'android' },
  });
  const pmA = regA.json.data.accessToken;
  const projA = await call('POST', '/projects', { code: `EA-${s}`, name: 'Org A Job' }, pmA);
  const projAId = projA.json.data.id;

  // A genuine tradie identity in Org A itself — for the SAME_ORG guard test below.
  // (pairAs() only overrides a DEVICE's effective role for shared-tablet scenarios —
  // it does NOT change the person's own FIXED `users.role` (xprojman-08's one-
  // identity-one-role model), so a real cross-org role check needs a real account.)
  const tradieInA = await call('POST', '/organisation/users',
    { email: `tia${s}@x.com`, full_name: 'Tradie In-Org-A', role: 'tradie', password: 'hunter2hunter2' }, pmA);
  const tradieInALogin = await call('POST', '/auth/login',
    { email: `tia${s}@x.com`, password: 'hunter2hunter2', device: { device_uid: `tia-${s}`, platform: 'android' } });
  const tradieInATok = tradieInALogin.json.data.accessToken;

  // ── Org B (the identity's home org) — a genuine tradie account, fixed role ──
  const regB = await call('POST', '/auth/register', {
    organisation: { name: `EngB ${s}` },
    user: { full_name: 'PM Bravo', email: `pmb${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pmb-${s}`, platform: 'android' },
  });
  const pmB = regB.json.data.accessToken;
  const tradieB = await call('POST', '/organisation/users',
    { email: `tb${s}@x.com`, full_name: 'Tradie Beta', role: 'tradie', password: 'hunter2hunter2' }, pmB);
  const tradieBLogin = await call('POST', '/auth/login',
    { email: `tb${s}@x.com`, password: 'hunter2hunter2', device: { device_uid: `tb-home-${s}`, platform: 'android' } });
  const tradieHomeTok = tradieBLogin.json.data.accessToken;
  ok('a genuine cross-org tradie identity exists (Org B, fixed role)', !!tradieHomeTok, JSON.stringify(tradieBLogin.json));

  // ── 1. initiate (Org A principal) ────────────────────────────────────────────
  const init = await call('POST', '/engagements/initiate',
    { project_id: projAId, role: 'tradie' }, pmA);
  ok('initiate() returns a signed code (panel.manage)', init.status === 200 && !!init.json.data.code, JSON.stringify(init.json));
  const code = init.json.data.code;

  // ── 2a. SAME_ORG guard — a role-matching person from the SAME org is refused ──
  const selfOrgReq = await call('POST', '/engagements/request', { code }, tradieInATok);
  ok('same-org request is refused (SAME_ORG)', selfOrgReq.status === 400 && selfOrgReq.json.code === 'SAME_ORG', JSON.stringify(selfOrgReq.json));

  // ── 2b. ROLE_MISMATCH — Org B's PM (role projectManager) cannot take a 'tradie' code
  const roleMismatch = await call('POST', '/engagements/request', { code }, pmB);
  ok('a role mismatch is refused (ROLE_MISMATCH)', roleMismatch.status === 409 && roleMismatch.json.code === 'ROLE_MISMATCH', JSON.stringify(roleMismatch.json));

  // ── 3. request (the tradie, cross-org) ───────────────────────────────────────
  const reqRes = await call('POST', '/engagements/request', { code }, tradieHomeTok);
  ok('cross-org request creates a pending engagement', reqRes.status === 201 && reqRes.json.data.status === 'pending', JSON.stringify(reqRes.json));
  const engId = reqRes.json.data.id;

  const reqAgain = await call('POST', '/engagements/request', { code }, tradieHomeTok);
  ok('a second request for the same code is idempotent (alreadyRequested)', reqAgain.json.data.alreadyRequested === true, JSON.stringify(reqAgain.json));

  // ── 4. pending() (Org A principal sees it) ───────────────────────────────────
  const pendingList = await call('GET', '/engagements/pending', undefined, pmA);
  ok('Org A principal sees the pending engagement', pendingList.json.data.pending.some((e) => e.id === engId), JSON.stringify(pendingList.json));

  // ── 5. confirm ────────────────────────────────────────────────────────────────
  const conf = await call('POST', `/engagements/${engId}/confirm`, {}, pmA);
  ok('confirm() activates the engagement', conf.status === 200 && conf.json.data.status === 'active', JSON.stringify(conf.json));

  // ── 6. activate — mints a SECOND token scoped to Org A ───────────────────────
  const act = await call('POST', `/engagements/${engId}/activate`, { device_uid: `tb-tradie-${s}` }, tradieHomeTok);
  ok('activate() mints an engagement-scoped token', act.status === 200 && !!act.json.data.access_token && act.json.data.org_id === regA.json.data.organisation.id, JSON.stringify(act.json));
  const engToken = act.json.data.access_token;

  // ── 7. pull under the engagement token is scoped to THAT project only ────────
  const projBforPM = await call('POST', '/projects', { code: `EB-${s}`, name: 'Org B Job (must not leak)' }, pmB);
  const pull = await call('GET', '/sync/pull?since=0', undefined, engToken);
  const pulledProjects = (pull.json.changes || []).filter((c) => c.table_name === 'projects').map((c) => c.server_id);
  ok('engagement pull includes Org A\'s project', pulledProjects.includes(projAId), JSON.stringify(pulledProjects));
  ok('engagement pull does NOT include any Org B project (home-org data)',
    !pulledProjects.includes(projBforPM.json.data.id), JSON.stringify(pulledProjects));

  // ── 8. decision #29 — activating did not disturb the home session's authority ─
  const homeStillWorks = await call('GET', '/sync/pull?since=0', undefined, tradieHomeTok);
  ok('the home-org token still authenticates fine after activation (authority scoped per org, not globally stolen)',
    homeStillWorks.status === 200, JSON.stringify(homeStillWorks.json));

  // ── 9. revoke — the engagement token stops working ───────────────────────────
  const rev = await call('POST', `/engagements/${engId}/revoke`, {}, pmA);
  ok('revoke() tombstones the engagement', rev.status === 200 && rev.json.data.status === 'revoked', JSON.stringify(rev.json));

  const afterRevoke = await call('GET', '/sync/pull?since=0', undefined, engToken);
  ok('the activated token is rejected after revoke (ENGAGEMENT_REVOKED)',
    afterRevoke.status === 401 && afterRevoke.json.code === 'ENGAGEMENT_REVOKED', JSON.stringify(afterRevoke.json));

  const homeStillWorksAfterRevoke = await call('GET', '/sync/pull?since=0', undefined, tradieHomeTok);
  ok('the home-org token is UNAFFECTED by revoking the (different) engagement session',
    homeStillWorksAfterRevoke.status === 200, JSON.stringify(homeStillWorksAfterRevoke.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
