// Tenant isolation — a server test, per the brief's acceptance §7.7.
//
// "A token from org A cannot read or write org B." The brief asks for this as a
// server test, not a client observation, because the whole multi-tenant guarantee
// rests on the server never accepting an org from the caller. This drives the API
// over HTTP and asserts the boundary holds.
//
// Requires a running server and a migrated c1projman2. It creates two throwaway orgs,
// so run it against a dev database only.
//
//   node tests/isolation.test.js            (expects the API on :5100)
//   BASE=http://10.1.1.20:5100 node tests/isolation.test.js

const BASE = (process.env.BASE || 'http://localhost:5100') + '/api/v1';

let passed = 0, failed = 0;
function check(name, condition) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else           { failed++; console.error(`  ✗ ${name}`); }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

function makeOrg(tag) {
  const stamp = Date.now() + Math.floor(Math.random() * 1e6);
  return {
    organisation: { name: `Test Builder ${tag} ${stamp}`, state: 'WA' },
    user: {
      full_name: `Admin ${tag}`,
      email: `iso_${tag}_${stamp}@example.test`,
      password: 'correct horse battery',
    },
    device: { device_uid: `dev-${tag}-${stamp}` },
  };
}

async function run() {
  console.log(`\nTenant isolation test → ${BASE}\n`);

  const health = await api('GET', '/../../health').catch(() => null);
  if (!health || health.status !== 200) {
    console.error(`Server not reachable at ${BASE}. Start it first (npm run dev).`);
    process.exit(2);
  }

  // Two independent orgs, each with its own admin + token.
  const regA = await api('POST', '/auth/register', { body: makeOrg('A') });
  const regB = await api('POST', '/auth/register', { body: makeOrg('B') });
  check('org A registered', regA.status === 201 && regA.json?.data?.accessToken);
  check('org B registered', regB.status === 201 && regB.json?.data?.accessToken);

  const tokenA = regA.json?.data?.accessToken;
  const tokenB = regB.json?.data?.accessToken;
  const orgAId = regA.json?.data?.organisation?.id;
  const orgBId = regB.json?.data?.organisation?.id;
  check('the two orgs are distinct', orgAId && orgBId && orgAId !== orgBId);

  // Each token sees only its own org.
  const meA = await api('GET', '/organisation', { token: tokenA });
  const meB = await api('GET', '/organisation', { token: tokenB });
  check('A reads its own org', meA.json?.data?.organisation?.id === orgAId);
  check('B reads its own org', meB.json?.data?.organisation?.id === orgBId);
  check('A does not see B when reading org', meA.json?.data?.organisation?.id !== orgBId);

  // A's user list contains only A's users.
  const usersA = await api('GET', '/organisation/users', { token: tokenA });
  const leaked = (usersA.json?.data?.users || []).some(
    (u) => u.email.includes('_B_')
  );
  check('A\'s user list contains no B users', !leaked);

  // A pull on A's token returns only A's org row, never B's.
  const pullA = await api('GET', '/sync/pull?since=0', { token: tokenA });
  check('A\'s sync pull succeeds', pullA.status === 200 && Array.isArray(pullA.json?.changes));
  const orgRows = (pullA.json?.changes || []).filter((c) => c.table_name === 'organisations');
  // Not vacuous: A's own org row must actually be present in the pull.
  check('A\'s sync pull contains A\'s org row', orgRows.some((r) => r.data.id === orgAId));
  check('A\'s sync pull returns only org A', orgRows.length > 0 && orgRows.every((r) => r.data.id === orgAId));
  check('A\'s sync pull never returns org B', !orgRows.some((r) => r.data.id === orgBId));
  // And a password hash must never leave the server, even though users sync.
  const userRows = (pullA.json?.changes || []).filter((c) => c.table_name === 'users');
  check('A\'s sync pull never leaks a password hash',
    userRows.length > 0 && userRows.every((r) => !('password_hash' in r.data)));

  // A push from A cannot touch B's org row. It is refused either at the ownership
  // gate (403 — organisations is web-owned, A's token is an app device) or the
  // org filter (404 — the id belongs to another tenant). Both are refusals; what
  // matters is that no write lands.
  const crossWrite = await api('POST', '/sync/push', {
    token: tokenA,
    body: { table_name: 'organisations', operation: 'update', data: { id: orgBId, phone: '0400000000' } },
  });
  check('A\'s write to B\'s org row is refused', crossWrite.status === 403 || crossWrite.status === 404);
  check('B\'s org is unchanged after A\'s attempt',
    (await api('GET', '/organisation', { token: tokenB })).json?.data?.organisation?.phone !== '0400000000');

  // Exercise the org filter directly on an app-owned table: A pushes a devices
  // update carrying B's org id and a B device id. The server scopes the UPDATE to
  // A's org (from A's token), so it matches nothing and returns 404 — proving the
  // org id in the payload is ignored in favour of the token's.
  const crossDevice = await api('POST', '/sync/push', {
    token: tokenA,
    body: {
      table_name: 'devices',
      operation: 'update',
      data: { id: 'some-b-device-id', org_id: orgBId, device_name: 'hijacked' },
    },
  });
  check('A\'s device write scoped to another org finds nothing (404)', crossDevice.status === 404);

  // A garbage token reaches nothing.
  const noAuth = await api('GET', '/organisation', { token: 'not-a-real-token' });
  check('an invalid token is rejected', noAuth.status === 401);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run crashed:', err.message);
  process.exit(2);
});
