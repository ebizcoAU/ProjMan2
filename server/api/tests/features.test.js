// Accounting feature flags (xprojman-43 §13.5, R1).
//
// The suite's main server runs with every flag ON (the code default), so the existing
// org-finance-journal / tax / tpar / depreciation tests keep proving the features themselves.
// This test starts its OWN server with every flag OFF and proves:
//   1. GET /organisation reports the flags, so Portal can hide its nav.
//   2. /finance/*, /accounts/bas*, TPAR lodge, the depreciation export and the fixed-asset
//      routes answer 404 FEATURE_DISABLED (after authentication: no token is still a 401).
//   3. The TPAR register stays reachable (only "lodge" is hidden).
//   4. The ledger hook OrgFinanceService.postEntry writes nothing.
//
// Run: DB_NAME=c1projman2_e2e node tests/features.test.js   (it spawns its own API on :4198)
process.env.FEATURE_TENANT_LEDGER = 'false';
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const PORT = 4198;
const BASE = `http://localhost:${PORT}/api/v1`;
const FLAGS_OFF = { FEATURE_TENANT_LEDGER: 'false', FEATURE_BAS: 'false', FEATURE_TPAR_LODGE: 'false', FEATURE_DEPRECIATION: 'false' };

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
async function call(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json; try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, json };
}
const disabled = (r) => r.status === 404 && r.json.code === 'FEATURE_DISABLED';

(async () => {
  console.log(`Feature flags test → own API on :${PORT}, all accounting flags OFF\n`);
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...FLAGS_OFF, PORT: String(PORT), DISABLE_RATE_LIMIT: 'true',
           EMAIL_ENABLED: 'false', SMS_ENABLED: 'false', MQTT_ENABLED: 'false' },
    stdio: 'ignore',
  });
  const stop = () => { try { child.kill(); } catch { /* already gone */ } };
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      try { up = (await fetch(`http://localhost:${PORT}/internal/health`)).ok; } catch { /* starting */ }
      if (!up) await new Promise((r) => setTimeout(r, 250));
    }
    ok('the flags-off API starts', up);

    const s = Date.now();
    const reg = await call('POST', '/auth/register', {
      organisation: { name: `Flags ${s}` },
      user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
      device: { device_uid: `pm-${s}`, platform: 'web' },
    });
    const pm = reg.json.data.accessToken;
    const projId = (await call('POST', '/projects', { code: `FL-${s}`, name: 'Flags job' }, pm)).json.data.id;

    // 1. Portal reads the flags
    const org = await call('GET', '/organisation', undefined, pm);
    const f = org.json.data?.features || {};
    ok('GET /organisation reports every accounting flag off',
      f.tenantLedger === false && f.bas === false && f.tparLodge === false && f.depreciation === false, JSON.stringify(f));

    // 2. Hidden routes
    ok('no token on a hidden route is still 401 (auth runs first)', (await call('GET', '/finance/accounts')).status === 401);
    ok('/finance/accounts → FEATURE_DISABLED', disabled(await call('GET', '/finance/accounts', undefined, pm)));
    ok('/finance/reports/pnl → FEATURE_DISABLED', disabled(await call('GET', '/finance/reports/pnl', undefined, pm)));
    ok('/accounts/bas → FEATURE_DISABLED', disabled(await call('GET', '/accounts/bas', undefined, pm)));
    ok('POST /accounts/bas/prepare → FEATURE_DISABLED', disabled(await call('POST', '/accounts/bas/prepare', {}, pm)));
    ok('POST /accounts/tpar/:id/lodge → FEATURE_DISABLED', disabled(await call('POST', `/accounts/tpar/${crypto.randomUUID()}/lodge`, {}, pm)));
    ok('/accounts/depreciation/export → FEATURE_DISABLED', disabled(await call('GET', '/accounts/depreciation/export', undefined, pm)));
    ok('/projects/:id/fixed-assets → FEATURE_DISABLED', disabled(await call('GET', `/projects/${projId}/fixed-assets`, undefined, pm)));

    // 3. Still on
    const tpar = await call('GET', '/accounts/tpar', undefined, pm);
    ok('the TPAR register stays reachable (only lodge is hidden)', tpar.status === 200, JSON.stringify(tpar.json).slice(0, 200));
    const proj = await call('GET', `/projects/${projId}`, undefined, pm);
    ok('ordinary project routes are untouched', proj.status === 200);

    // 4. The ledger hook, in this process (FEATURE_TENANT_LEDGER=false was set before config loaded)
    const OrgFinanceService = require('../src/services/OrgFinanceService');
    const pool = require('../src/db/pool');
    const ref = crypto.randomUUID();
    await OrgFinanceService.postEntry({
      orgId: reg.json.data.user.orgId || reg.json.data.organisation?.id, projectId: projId,
      debitAccountId: crypto.randomUUID(), creditAccountId: crypto.randomUUID(), amount: 100,
      refType: 'flag_test', refId: ref, memo: 'should not post', entryDate: '2026-10-14',
    });
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM org_journal WHERE ref_id = ?', [ref]);
    ok('with the tenant ledger off, postEntry writes nothing', Number(n) === 0, `rows=${n}`);
    await pool.end();
  } catch (e) {
    console.error(e); failed++;
  } finally {
    stop();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
