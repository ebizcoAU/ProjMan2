// System Admin dashboard acceptance (dashboarddesignspecification.md).
//
// Proves:
//   1. Allowlist gate: a normal projectManager gets 403 on every /admin/* route; a
//      platform-admin gets through.
//   2. Cross-tenant reach: the dashboard sees users/orgs across ALL orgs (the first
//      legitimate cross-tenant read) — but only the account layer.
//   3. THE BOUNDARY: no /admin/* response contains project/construction content.
//   4. Account actions (suspend/force-logout) work and are account-layer only.
//   5. Billing: subscriptions view (org fallback), record payment, change plan, revenue.
//   6. Login transaction log returns auth events with method/outcome.
//
// Setup uses the DB pool directly to add the platform_admins row (out-of-band, as in
// production). Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &  then
//   BASE=http://localhost:4199 node tests/admin.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const pool = require('../src/db/pool');
const { v4: uuidv4 } = require('uuid');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + ' ' + e)); };
async function call(m, p, b, t) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
  let j; try { j = await r.json(); } catch { j = {}; }
  return { status: r.status, j };
}

(async () => {
  console.log(`Admin dashboard test → ${BASE}\n`);
  const s = Date.now();

  // Two separate orgs (to prove cross-tenant reach + isolation-doesn't-apply-here).
  const regA = await call('POST', '/auth/register', {
    organisation: { name: `AdminOrgA ${s}` },
    user: { full_name: 'Alice Admin', email: `a${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `a-${s}`, platform: 'web' },
  });
  const regB = await call('POST', '/auth/register', {
    organisation: { name: `AdminOrgB ${s}` },
    user: { full_name: 'Bob Builder', email: `b${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `b-${s}`, platform: 'web' },
  });
  const pmA = regA.j.data.accessToken;
  const userA = regA.j.data.user.id;
  const orgB = regB.j.data.organisation?.id || regB.j.data.user.orgId;

  // A creates a project (content that must NEVER appear on /admin/*).
  await call('POST', '/projects', { code: `SECRET-${s}`, name: 'Confidential Build' }, pmA);

  // ── 1. Allowlist gate — projectManager is NOT a platform admin ──
  const denied = await call('GET', '/admin/stats', undefined, pmA);
  ok('projectManager denied /admin/stats (403 FORBIDDEN)', denied.status === 403 && denied.j.code === 'FORBIDDEN', JSON.stringify(denied.j));
  ok('projectManager denied /admin/billing/subscriptions', (await call('GET', '/admin/billing/subscriptions', undefined, pmA)).status === 403);
  ok('no token → 401 on /admin', (await call('GET', '/admin/stats')).status === 401);

  // Grant platform-admin to Alice, out-of-band (as the CLI does). This test exercises
  // the full surface (billing/devices/orgs/logs), so she needs the 'admin' sub-role
  // (migration_v011) — the column defaults to the least-privileged 'staff' otherwise.
  await pool.query('INSERT INTO platform_admins (id, user_id, admin_role, note) VALUES (?, ?, ?, ?)', [uuidv4(), userA, 'admin', 'test']);

  // ── 2. Cross-tenant reach ──
  const stats = await call('GET', '/admin/stats', undefined, pmA);
  ok('platform admin reaches /admin/stats', stats.status === 200, JSON.stringify(stats.j));
  ok('stats sees >= 2 orgs (cross-tenant)', stats.j.data.organisations.total >= 2);
  ok('stats has users.byRole breakdown', Array.isArray(stats.j.data.users.byRole));

  const users = await call('GET', '/admin/users', undefined, pmA);
  const sawBothOrgs = new Set(users.j.data.users.map(u => u.org_name)).size >= 2;
  ok('user list spans multiple orgs (cross-tenant)', sawBothOrgs, `orgs=${new Set(users.j.data.users.map(u=>u.org_name)).size}`);

  // ── 3. THE BOUNDARY — no project/content anywhere in /admin/* ──
  const blob = JSON.stringify([stats.j, users.j,
    (await call('GET', '/admin/devices', undefined, pmA)).j,
    (await call('GET', '/admin/orgs', undefined, pmA)).j,
    (await call('GET', '/admin/logs/login', undefined, pmA)).j,
    (await call('GET', '/admin/billing/subscriptions', undefined, pmA)).j,
  ]);
  ok('NO admin endpoint leaks the secret project code', !blob.includes(`SECRET-${s}`), 'project content leaked!');
  ok('NO admin endpoint mentions project content keys',
    !/"(stage_code|contract_value|estimated_amount|site_address|programme)"/.test(blob), 'construction field leaked!');

  // ── 4. Account actions ──
  const bUser = regB.j.data.user.id;
  const susp = await call('POST', `/admin/users/${bUser}/suspend`, {}, pmA);
  ok('suspend an account', susp.status === 200 && susp.j.data.action === 'suspend');
  const fl = await call('POST', `/admin/users/${bUser}/force-logout`, {}, pmA);
  ok('force-logout an account', fl.status === 200);
  // Bob's token should now be dead — rejected as suspended (403) or force-logout (401);
  // either way it no longer works.
  ok("suspended+logged-out user's token is rejected",
    (await call('GET', '/auth/me', undefined, regB.j.data.accessToken)).status >= 401);
  await call('POST', `/admin/users/${bUser}/reactivate`, {}, pmA);

  // ── 5. Billing ──
  const subs = await call('GET', '/admin/billing/subscriptions', undefined, pmA);
  ok('subscriptions list falls back to org trial baseline', subs.j.data.subscriptions.length >= 2 &&
    subs.j.data.subscriptions.every(x => x.status), JSON.stringify(subs.j.data.subscriptions[0]));
  const payA = await call('POST', '/admin/billing/payments', { org_id: orgB, amount: 149, method: 'bank_transfer', period: '2026-07' }, pmA);
  ok('record a payment', payA.status === 201, JSON.stringify(payA.j));
  const plan = await call('PATCH', `/admin/orgs/${orgB}/plan`, { plan: 'builder', status: 'active', amount: 149 }, pmA);
  ok('change a plan', plan.status === 200);
  const rev = await call('GET', '/admin/billing/revenue', undefined, pmA);
  ok('revenue reflects the payment + MRR', rev.j.data.revenue.total >= 149 && rev.j.data.mrr >= 149, JSON.stringify(rev.j.data));

  // ── 6. Login log ──
  const log = await call('GET', '/admin/logs/login?outcome=success', undefined, pmA);
  ok('login log returns auth events with method+outcome',
    log.j.data.entries.length > 0 && log.j.data.entries.every(e => e.method && e.outcome === 'success'),
    JSON.stringify(log.j.data.entries[0]));
  const csv = await fetch(BASE + '/admin/logs/login/export', { headers: { Authorization: `Bearer ${pmA}` } });
  ok('login log CSV export', csv.headers.get('content-type')?.includes('csv') && (await csv.text()).startsWith('at,action'));

  await pool.query('DELETE FROM platform_admins WHERE user_id = ?', [userA]);
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
