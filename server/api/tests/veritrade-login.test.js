// VeriTrade App-mediated login acceptance (veritradedesignspecification.md §4,
// migration v029). Proves the browser<->phone handshake end to end, since there is
// no real browser/phone pair in an automated test — the App's own HTTP calls are
// simulated directly, same posture as EngagementService/IntroductionService's QR
// tests (a scan is just an authenticated POST with the right code).
//
// Proves:
//   1. initiate() is public and returns a session_id + code.
//   2. context() requires auth + the right code; wrong code / wrong session refused.
//   3. approve() mints a normal, non-authoritative web session (same as Portal).
//   4. status() hands over the token pair exactly once (consume-once).
//   5. deny() resolves the session without ever minting a token.
//   6. Acting twice on an already-resolved session is refused (ALREADY_RESOLVED).
//
// Run: DISABLE_RATE_LIMIT=true DB_NAME=c1projman2_e2e PORT=4199 node src/index.js &
//      BASE=http://localhost:4199 DB_NAME=c1projman2_e2e node tests/veritrade-login.test.js
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

(async () => {
  console.log(`VeriTrade login test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `VT-Login ${s}` },
    user: { full_name: 'Casey Carpenter', email: `vtlogin${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `vtlogin-app-${s}`, platform: 'android' },
  });
  const appToken = reg.json.data.accessToken; // simulates the person's ALREADY-logged-in App session

  // ── 1. initiate ──
  const init1 = await call('POST', '/veritrade/login/initiate');
  ok('initiate is public and returns a session_id + code (201)',
    init1.status === 201 && !!init1.json.data.session_id && !!init1.json.data.code, JSON.stringify(init1.json));
  const { session_id: sid, code } = init1.json.data;

  // ── 2. context — auth + code required ──
  const ctxNoAuth = await call('GET', `/veritrade/login/${sid}/context?code=${encodeURIComponent(code)}`);
  ok('context requires App auth (401)', ctxNoAuth.status === 401, JSON.stringify(ctxNoAuth.json));

  const ctxWrongCode = await call('GET', `/veritrade/login/${sid}/context?code=not-a-real-code`, undefined, appToken);
  ok('context refuses a wrong code (INVALID_CODE)',
    ctxWrongCode.status === 400 && ctxWrongCode.json.code === 'INVALID_CODE', JSON.stringify(ctxWrongCode.json));

  const init2 = await call('POST', '/veritrade/login/initiate');
  const crossSession = await call('GET', `/veritrade/login/${sid}/context?code=${encodeURIComponent(init2.json.data.code)}`, undefined, appToken);
  ok('a code minted for a DIFFERENT session is refused on this one',
    crossSession.status === 400 && crossSession.json.code === 'INVALID_CODE', JSON.stringify(crossSession.json));

  const ctx = await call('GET', `/veritrade/login/${sid}/context?code=${encodeURIComponent(code)}`, undefined, appToken);
  ok('context succeeds with the right code + auth, shows device/IP/timestamp',
    ctx.status === 200 && ctx.json.data.status === 'pending' && 'requested_ip' in ctx.json.data && 'requested_at' in ctx.json.data,
    JSON.stringify(ctx.json));

  // ── 3/4. approve + status hands over tokens once ──
  const approve = await call('POST', `/veritrade/login/${sid}/approve`, { code }, appToken);
  ok('approve mints a session (200)', approve.status === 200 && approve.json.data.status === 'approved', JSON.stringify(approve.json));

  const poll1 = await call('GET', `/veritrade/login/${sid}/status?code=${encodeURIComponent(code)}`);
  ok('first poll after approval returns the token pair',
    poll1.status === 200 && poll1.json.data.status === 'approved' && !!poll1.json.data.access_token && !!poll1.json.data.refresh_token,
    JSON.stringify(poll1.json));

  const poll2 = await call('GET', `/veritrade/login/${sid}/status?code=${encodeURIComponent(code)}`);
  ok('second poll does NOT re-hand the token pair (consume-once)',
    poll2.status === 200 && poll2.json.data.status === 'approved' && poll2.json.data.redeemed === true && !poll2.json.data.access_token,
    JSON.stringify(poll2.json));

  // The minted token behaves like a normal ProjMan session (works against /auth/me).
  const me = await call('GET', '/auth/me', undefined, poll1.json.data.access_token);
  ok('the minted token is a real, working ProjMan session',
    me.status === 200 && String(me.json.data.user.id) === String(reg.json.data.user.id), JSON.stringify(me.json));

  const reApprove = await call('POST', `/veritrade/login/${sid}/approve`, { code }, appToken);
  ok('approving an already-resolved session is refused (ALREADY_RESOLVED)',
    reApprove.status === 409 && reApprove.json.code === 'ALREADY_RESOLVED', JSON.stringify(reApprove.json));

  // ── 5. deny ──
  const init3 = await call('POST', '/veritrade/login/initiate');
  const { session_id: sid2, code: code2 } = init3.json.data;
  const deny = await call('POST', `/veritrade/login/${sid2}/deny`, { code: code2 }, appToken);
  ok('deny resolves the session (200)', deny.status === 200 && deny.json.data.status === 'denied', JSON.stringify(deny.json));
  const pollDenied = await call('GET', `/veritrade/login/${sid2}/status?code=${encodeURIComponent(code2)}`);
  ok('a denied session polls as denied, no token ever offered',
    pollDenied.status === 200 && pollDenied.json.data.status === 'denied' && !pollDenied.json.data.access_token,
    JSON.stringify(pollDenied.json));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
