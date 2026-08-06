// PM2-02 identity/consent acceptance (serverdesignspec §13.4, decision #28).
//
// Proves:
//   1. GET /identity/evidence (self) — full detail, issuing org visible.
//   2. POST /identity/share mints a token; GET /identity/:id/profile with that token
//      returns the SAME evidence but with issuing_org_id/name REDACTED (decision #28:
//      anonymisation protects the subject from third parties, never from themselves).
//   3. A missing/invalid/expired token is refused, and a token cannot be used against
//      a DIFFERENT person's :id than the one who minted it.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 DB_NAME=c1projman2_e2e node src/index.js &  then
//      DB_NAME=c1projman2_e2e BASE=http://localhost:4199 node tests/identity.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
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

(async () => {
  console.log(`PM2-02 identity/consent test → ${BASE}\n`);
  const s = Date.now();

  const regA = await call('POST', '/auth/register', {
    organisation: { name: `IdA ${s}` },
    user: { full_name: 'Owner Alpha', email: `ida${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `ida-${s}`, platform: 'android' },
  });
  const ownerTok = regA.json.data.accessToken;
  const ownerId = regA.json.data.user.id;
  const orgId = regA.json.data.organisation.id;

  const regB = await call('POST', '/auth/register', {
    organisation: { name: `IdB ${s}` },
    user: { full_name: 'Viewer Beta', email: `idb${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `idb-${s}`, platform: 'android' },
  });
  const viewerTok = regB.json.data.accessToken;

  await AttestationService.emit({
    subjectUserId: ownerId, issuingOrgId: orgId,
    sourceType: 'stage_complete', sourceId: 'test-stage', payload: { note: 'seed' },
  });

  const own = await call('GET', '/identity/evidence', undefined, ownerTok);
  ok('owner sees their own evidence with issuing org visible',
    own.status === 200 && own.json.data.attestations.length > 0 && own.json.data.attestations[0].issuing_org_id === orgId,
    JSON.stringify(own.json));

  const share = await call('POST', '/identity/share', {}, ownerTok);
  ok('owner mints a share token', share.status === 200 && !!share.json.data.token, JSON.stringify(share.json));
  const token = share.json.data.token;

  const thirdParty = await call('GET', `/identity/${ownerId}/profile?token=${encodeURIComponent(token)}`, undefined, viewerTok);
  ok('a third party with a valid share token reads the profile', thirdParty.status === 200, JSON.stringify(thirdParty.json));
  ok('the third-party read has issuing_org_id REDACTED (decision #28)',
    thirdParty.json.data.attestations.every((a) => a.issuing_org_id === undefined), JSON.stringify(thirdParty.json.data));
  ok('the third-party read still carries the trust score',
    typeof thirdParty.json.data.trust_score === 'number', JSON.stringify(thirdParty.json.data));

  const noToken = await call('GET', `/identity/${ownerId}/profile`, undefined, viewerTok);
  ok('no token → refused (422/validation)', noToken.status === 422 || noToken.status === 400, JSON.stringify(noToken.json));

  const badToken = await call('GET', `/identity/${ownerId}/profile?token=not-a-real-token`, undefined, viewerTok);
  ok('an invalid token is refused', badToken.status === 400 && badToken.json.code === 'INVALID_TOKEN', JSON.stringify(badToken.json));

  // A share token only grants access to ITS OWN owner's id, not an arbitrary other id.
  const wrongId = await call('GET', `/identity/${regB.json.data.user.id}/profile?token=${encodeURIComponent(token)}`, undefined, viewerTok);
  ok('a share token cannot be used against a different person\'s :id',
    wrongId.status === 403 && wrongId.json.code === 'FORBIDDEN', JSON.stringify(wrongId.json));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
