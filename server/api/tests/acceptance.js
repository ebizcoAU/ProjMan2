// Acceptance walk-through — the brief's §5 list, run end to end against a live server.
//
// Not a pass/fail test (that is isolation.test.js); this is the "short curl transcript
// per endpoint" the brief asked for, as a script, so the client can be built against
// something concrete. It prints what each step returned.
//
//   node tests/acceptance.js            (expects the API on :4100, email disabled)
//
// It reads recovery codes out of the server log, so point LOG at wherever the server
// is writing (default /tmp/pm2api.log).

const fs = require('fs');
const BASE = (process.env.BASE || 'http://localhost:4100') + '/api/v1';
const LOG  = process.env.LOG || '/tmp/pm2api.log';
const stamp = Date.now();

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const line = (label, value) => console.log(`  ${label.padEnd(42)} ${value}`);

// A valid ABN passes the modulus-89 checksum, and it is unique per org — so a
// repeatable walk-through needs a fresh valid one each run. Search upward from a
// timestamp-seeded base until the checksum passes.
function freshValidAbn() {
  const W = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  // Search a wide window: the checksum passes ~1 in 89, so 100 tries would come up
  // empty about a third of the time.
  let base = 10000000000 + (stamp % 89000000000);
  for (let n = base; n < base + 1000; n++) {
    const d = String(n).padStart(11, '0').split('').map(Number);
    d[0] -= 1;
    if (d.reduce((a, x, i) => a + x * W[i], 0) % 89 === 0) return String(n).padStart(11, '0');
  }
  return null;
}

async function run() {
  console.log(`\nProjMan2 acceptance walk-through → ${BASE}\n`);
  const email = `dana+${stamp}@kestrel.test`;

  // 1 — register a builder org, receive a working session
  console.log('§5.1  Register a new builder org');
  const reg = await api('POST', '/auth/register', {
    body: {
      organisation: { name: `Kestrel Constructions ${stamp}`, abn: freshValidAbn(), state: 'WA', suburb: 'Fremantle', postcode: '6160' },
      user: { full_name: 'Dana Reyes', email, password: 'scaffold-tower-42' },
      device: { device_uid: 'office-imac-1', device_name: 'Office iMac', platform: 'web' },
    },
  });
  line('status', reg.status);
  line('abn validated to', reg.json?.data?.organisation?.abnValidated);
  line('first user role', reg.json?.data?.user?.role);
  let token = reg.json?.data?.accessToken;
  const refreshToken = reg.json?.data?.refreshToken;

  // 2 — log in and refresh
  console.log('\n§5.2  Log in and refresh');
  const login = await api('POST', '/auth/login', {
    body: { email, password: 'scaffold-tower-42', device: { device_uid: 'office-imac-1' } },
  });
  line('login authoritative', login.json?.data?.authoritative);
  const refreshed = await api('POST', '/auth/refresh', { body: { refreshToken } });
  line('refresh returned new access token', !!refreshed.json?.data?.accessToken);

  // 3 — reset a forgotten password end to end
  console.log('\n§5.3  Reset a forgotten password');
  await api('POST', '/auth/recovery/request', { body: { email } });
  const codes = [...fs.readFileSync(LOG, 'utf8').matchAll(/reset code is: (\d{6})/g)];
  const code = codes.length ? codes[codes.length - 1][1] : null;
  line('code delivered (from server log)', code);
  const verify = await api('POST', '/auth/recovery/verify', { body: { email, code } });
  const recoveryToken = verify.json?.data?.recoveryToken;
  const reset = await api('POST', '/auth/recovery/reset', { body: { recoveryToken, newPassword: 'brand-new-pw-7' } });
  line('reset', reset.json?.message);
  const relogin = await api('POST', '/auth/login', {
    body: { email, password: 'brand-new-pw-7', device: { device_uid: 'office-imac-1' } },
  });
  line('login with new password', relogin.status === 200);
  token = relogin.json?.data?.accessToken;

  // 4 — pair a second device as supervisor, see the role in its session
  console.log('\n§5.4  Pair a site tablet, confirm as supervisor');
  const init = await api('POST', '/pairing/initiate', {
    token, body: { role: 'siteSupervisor', label: 'Site tablet — Lot 42' },
  });
  const requestId = init.json?.data?.request_id;
  const nonce = init.json?.data?.qr_payload?.nonce;
  await api('POST', '/pairing/request', {
    body: { request_id: requestId, nonce, device: { device_uid: 'site-tablet-1', device_name: 'Toughpad', platform: 'android' } },
  });
  const pending = await api('GET', '/pairing/pending', { token });
  line('primary sees pending requests', pending.json?.data?.pending?.length);
  const confirm = await api('POST', '/pairing/confirm', { token, body: { request_id: requestId } });
  line('confirmed device role', confirm.json?.data?.device?.role);
  const status = await api('GET', `/pairing/status/${requestId}?device_uid=site-tablet-1`);
  line('tablet status → role', `${status.json?.data?.role} (requiresLogin=${status.json?.data?.requiresLogin})`);

  // 5 — revoke that device, watch its next call fail
  console.log('\n§5.5  Revoke the site tablet');
  const devices = await api('GET', '/devices', { token });
  const tablet = devices.json?.data?.devices?.find((d) => d.uid === 'site-tablet-1');
  line('devices listed', devices.json?.data?.devices?.map((d) => `${d.uid}:${d.role}`).join(', '));
  const revoke = await api('POST', `/devices/${tablet.id}/revoke`, { token });
  line('revoke result', revoke.json?.data?.status);

  // 6 — push and pull, see the cursor advance
  console.log('\n§5.6  Sync push/pull and cursor advance');
  const pull1 = await api('GET', '/sync/pull?since=0', { token });
  line('initial pull changes', pull1.json?.changes?.length);
  const cursor1 = pull1.json?.last_sync_at;
  await api('PATCH', '/organisation', { token, body: { phone: '08 9000 0000' } });
  await new Promise((r) => setTimeout(r, 50));
  const pull2 = await api('GET', `/sync/pull?since=${cursor1}`, { token });
  line('changes after org edit', pull2.json?.changes?.length);
  line('cursor advanced', pull2.json?.last_sync_at > cursor1);

  // 7 — the audit trail the brief wanted from day one
  console.log('\n§4    Audit log (evidentiary from day one)');
  const audit = await api('GET', '/organisation/audit', { token });
  line('audit entries recorded', audit.json?.data?.entries?.length);
  line('actions', [...new Set((audit.json?.data?.entries || []).map((e) => e.action))].join(', '));

  console.log('\nWalk-through complete.\n');
}

run().catch((err) => { console.error('Walk-through failed:', err); process.exit(1); });
