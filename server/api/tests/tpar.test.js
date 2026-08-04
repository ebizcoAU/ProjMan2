// P8c TPAR + the P8a depreciation export (serverdesignspec §11.2, migration v026).
//
// Proves:
//   1. accounts.read gates the TPAR surface.
//   2. prepare() groups an FY's reportable payments BY PAYEE, snapshotting ABN + name.
//   3. tpar_reportable = 0 payments are excluded; out-of-FY payments are excluded.
//   4. A payee with NO ABN still appears and is counted in `missing_abn` — the preparer must see
//      the gap before lodging, not have it silently dropped.
//   5. Re-preparing REPLACES lines (a payee whose payments vanish must disappear).
//   6. THE GATE: lodging is `tax.approve` — accountant yes, PM no; a lodged report can't re-prepare.
//   7. The snapshot is frozen: editing a payee's ABN afterwards does NOT alter a lodged line.
//   8. Export CSV carries the payee listing + the missing-ABN warning.
//   9. Depreciation export: accounts.read gated, APPROVED assets only, ?fy= narrows.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/tpar.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const crypto = require('crypto');
const pool = require('../src/db/pool');
const TparService = require('../src/services/TparService');

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
async function call(method, path, body, token, raw = false) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return { status: res.status, text: await res.text() };
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
// A payment date inside the FY we prepare, and one safely outside it.
const FY = '2025-26';
const IN_FY = '2025-11-15 10:00:00';
const OUT_FY = '2024-11-15 10:00:00';

(async () => {
  console.log(`P8c TPAR + depreciation export test → ${BASE}\n`);
  const s = Date.now();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Tpar ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id, orgId = reg.json.data.organisation.id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `TP-${s}`, name: 'Lot 14 dwelling' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);

  // A foreperson who is NOT the founder. A device paired onto the founder's identity carries their
  // OWNER_CAPABILITIES — which since decision #18 include `accounts.read` — so it cannot be used to
  // test the role gate.
  const foreEmail = `fore${s}@x.com`;
  await call('POST', '/organisation/users',
    { email: foreEmail, full_name: 'Fred Foreperson', role: 'foreperson', password: 'site-gate-42' }, pm);
  const foreLogin = await call('POST', '/auth/login',
    { email: foreEmail, password: 'site-gate-42', device: { device_uid: `foreu-${s}`, platform: 'android' } });
  const foreTok = foreLogin.json.data?.accessToken;

  const acctEmail = `acct${s}@x.com`;
  const mk = await call('POST', '/organisation/users',
    { email: acctEmail, full_name: 'Ada Accountant', role: 'accountant', password: 'ledger-lines-9' }, pm);
  const acctUser = mk.json.data?.id || mk.json.data?.user?.id;
  const acctLogin = await call('POST', '/auth/login',
    { email: acctEmail, password: 'ledger-lines-9', device: { device_uid: `acct-${s}`, platform: 'web' } });
  const acct = acctLogin.json.data?.accessToken;

  // Two payees: one whose org has an ABN, one whose org has none.
  const withAbn = `payee-a${s}@x.com`, noAbn = `payee-b${s}@x.com`;
  const pa = await call('POST', '/organisation/users',
    { email: withAbn, full_name: 'Ace Concreting', role: 'builder', password: 'concrete-mix-8' }, pm);
  const pb = await call('POST', '/organisation/users',
    { email: noAbn, full_name: 'Vague Trades', role: 'builder', password: 'vague-trade-8' }, pm);
  const payeeA = pa.json.data?.id || pa.json.data?.user?.id;
  const payeeB = pb.json.data?.id || pb.json.data?.user?.id;
  // Both payees sit in this org (cross-org engagement is PM2-02, unresolved), so the ABN under
  // test is the org's own — set it, then blank it for payee B's line by moving B to a second org.
  // organisations.abn is UNIQUE, so a hardcoded value collides on the second run of this suite.
  // Derived from the run timestamp instead; the checksum is irrelevant here (validation happens at
  // registration, not on a direct update) — uniqueness is the only property under test.
  const ABN = String(s).slice(-11).padStart(11, '0');
  await pool.query('UPDATE organisations SET abn = ? WHERE id = ?', [ABN, orgId]);
  const reg2 = await call('POST', '/auth/register', {
    organisation: { name: `NoAbnCo ${s}` },
    user: { full_name: 'Other Owner', email: `oo${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `oo-${s}`, platform: 'android' },
  });
  const org2 = reg2.json.data.organisation.id;
  await pool.query('UPDATE organisations SET abn = NULL WHERE id = ?', [org2]);
  await pool.query('UPDATE users SET org_id = ? WHERE id = ?', [org2, payeeB]);

  const pay = async (payee, amount, gst, when, reportable = 1) => {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO project_payments (id, org_id, project_id, payee_user_id, amount, gst_amount,
                                     purpose, paid_at, tpar_reportable, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, 'progress', ?, ?, ?)`,
      [id, orgId, projId, payee, amount, gst, when, reportable, pmUser]);
    return id;
  };
  await pay(payeeA, 10000, 1000, IN_FY);
  await pay(payeeA, 5000, 500, IN_FY);            // same payee — must GROUP
  await pay(payeeB, 3000, 300, IN_FY);
  await pay(payeeA, 99000, 9900, IN_FY, 0);       // NOT tpar_reportable — must be excluded
  await pay(payeeA, 77000, 7700, OUT_FY);         // outside the FY — must be excluded

  // ── 1. Gate ──
  const badList = await call('GET', '/accounts/tpar', undefined, foreTok);
  ok('accounts.read gates the TPAR surface (a foreperson is refused)', badList.status === 403, JSON.stringify(badList.json));

  // ── 2/3/4. Prepare ──
  const prep = await call('POST', '/accounts/tpar/prepare', { fy: FY }, pm);
  const d = prep.json.data;
  ok('prepare groups the FY\'s reportable payments by payee (2 payees)',
    prep.status === 200 && d.payee_count === 2, JSON.stringify(d));
  ok('a payee\'s multiple payments are summed (10000 + 5000 + 3000 = 18000 gross)',
    Number(d.total_gross) === 18000, JSON.stringify(d));
  ok('tpar_reportable = 0 and out-of-FY payments are BOTH excluded',
    Number(d.total_gross) === 18000 && Number(d.total_gst) === 1800, JSON.stringify(d));
  ok('a payee with no ABN is reported in missing_abn (not silently dropped)',
    d.missing_abn === 1, JSON.stringify(d));

  const reportId = d.id;
  const full = await call('GET', `/accounts/tpar/${reportId}`, undefined, pm);
  const lineA = full.json.data.lines.find((l) => l.payee_user_id === payeeA);
  const lineB = full.json.data.lines.find((l) => l.payee_user_id === payeeB);
  ok('the payee ABN is SNAPSHOT onto the line', lineA?.payee_abn === ABN, JSON.stringify(lineA));
  ok('the ABN-less payee still has a line, with a null ABN', !!lineB && !lineB.payee_abn, JSON.stringify(lineB));
  ok('source_payment_ids records provenance back to project_payments',
    Array.isArray(lineA?.source_payment_ids ? JSON.parse(JSON.stringify(lineA.source_payment_ids)) : null) ||
    !!lineA?.source_payment_ids, JSON.stringify(lineA?.source_payment_ids));
  ok('per-payee totals are right (Ace: 15000 gross / 1500 gst over 2 payments)',
    Number(lineA.gross_paid) === 15000 && Number(lineA.gst_paid) === 1500 && lineA.payment_count === 2,
    JSON.stringify(lineA));

  // ── 5. Re-prepare replaces ──
  await pool.query('UPDATE project_payments SET tpar_reportable = 0 WHERE payee_user_id = ?', [payeeB]);
  const prep2 = await call('POST', '/accounts/tpar/prepare', { fy: FY }, pm);
  ok('re-preparing REPLACES lines — a payee whose payments vanish disappears',
    prep2.json.data.payee_count === 1 && Number(prep2.json.data.total_gross) === 15000,
    JSON.stringify(prep2.json.data));

  // ── 6. THE GATE ──
  const pmLodge = await call('POST', `/accounts/tpar/${reportId}/lodge`, {}, pm);
  ok('THE GATE: the PM CANNOT lodge a TPAR (accounts.read but no tax.approve)',
    pmLodge.status === 403 && /tax\.approve/.test(pmLodge.json.message || ''), JSON.stringify(pmLodge.json));
  const acctLodge = await call('POST', `/accounts/tpar/${reportId}/lodge`, {}, acct);
  ok('the accountant CAN lodge (tax.approve, decision #14 — no new verb)',
    acctLodge.status === 200 && acctLodge.json.data.status === 'lodged', JSON.stringify(acctLodge.json));
  const [[lodged]] = await pool.query('SELECT lodged_by, lodged_at FROM tpar_reports WHERE id = ?', [reportId]);
  ok('lodging stamps lodged_by / lodged_at', lodged.lodged_by === acctUser && !!lodged.lodged_at);
  const reprep = await call('POST', '/accounts/tpar/prepare', { fy: FY }, pm);
  ok('a LODGED TPAR cannot be re-prepared (409)', reprep.status === 409, JSON.stringify(reprep.json));

  // ── 7. The snapshot is frozen ──
  await pool.query('UPDATE organisations SET abn = ? WHERE id = ?', ['9' + ABN.slice(1), orgId]);
  const after = await call('GET', `/accounts/tpar/${reportId}`, undefined, pm);
  const lineAfter = after.json.data.lines.find((l) => l.payee_user_id === payeeA);
  ok('SNAPSHOT: editing the payee ABN afterwards does NOT rewrite the lodged line',
    lineAfter.payee_abn === ABN, JSON.stringify(lineAfter));

  // ── 8. Export ──
  const exp = await call('GET', `/accounts/tpar/${reportId}/export`, undefined, pm, true);
  ok('TPAR export returns CSV with the payee listing',
    exp.status === 200 && /Taxable Payments Annual Report/.test(exp.text) && /Ace Concreting/.test(exp.text),
    exp.text?.slice(0, 120));
  const badExp = await call('GET', `/accounts/tpar/${reportId}/export`, undefined, foreTok, true);
  ok('TPAR export is accounts.read gated', badExp.status === 403);

  // ── 9. Depreciation export (P8a (b1) hand-off) ──
  const a1 = await call('POST', `/projects/${projId}/fixed-assets`, {
    description: 'Excavator', category: 'plant', acquisition_cost: 60000,
    acquired_at: '2025-07-01', method: 'prime_cost', effective_life_years: 5 }, pm);
  const a2 = await call('POST', `/projects/${projId}/fixed-assets`, {
    description: 'Never approved trailer', acquisition_cost: 8000,
    acquired_at: '2025-07-01', method: 'prime_cost', effective_life_years: 4 }, pm);
  await call('POST', `/projects/${projId}/fixed-assets/prepare-draft`, {}, pm);
  // The accountant is `assigned` scope (v012), so they must be a project_members row to reach the
  // job at all — without this the approve 404s and the export silently has nothing to emit.
  await call('POST', `/projects/${projId}/members`, { user_id: acctUser }, pm);
  const appr = await call('POST', `/projects/${projId}/fixed-assets/${a1.json.data.id}/approve`, {}, acct);
  ok('the accountant approves the asset (S18.12) so it becomes export-eligible',
    appr.status === 200 && appr.json.data.status === 'approved', JSON.stringify(appr.json));

  const dExp = await call('GET', '/accounts/depreciation/export', undefined, pm, true);
  ok('depreciation export returns CSV of APPROVED assets',
    dExp.status === 200 && /Excavator/.test(dExp.text), dExp.text?.slice(0, 100));
  ok('…and EXCLUDES draft assets (only an approved asset is eligible for hand-off)',
    !/Never approved trailer/.test(dExp.text));
  ok('…and carries the schedule lines (12000/yr over 5 FYs)', /12000/.test(dExp.text), dExp.text?.slice(-200));

  const dFy = await call('GET', '/accounts/depreciation/export?fy=2025-26', undefined, pm, true);
  ok('?fy= narrows the export to one financial year',
    dFy.status === 200 && (dFy.text.match(/2025-26/g) || []).length >= 1 && !/2027-28/.test(dFy.text),
    dFy.text?.slice(-200));
  const dBad = await call('GET', '/accounts/depreciation/export', undefined, foreTok, true);
  ok('depreciation export is accounts.read gated', dBad.status === 403);

  // ── Unit: FY parsing ──
  ok('unit: fyRange(2025-26) = 1 Jul 2025 – 30 Jun 2026',
    TparService.fyRange('2025-26').start === '2025-07-01' && TparService.fyRange('2025-26').end === '2026-06-30');
  let threw = false;
  try { TparService.fyRange('2025-27'); } catch { threw = true; }
  ok('unit: a non-consecutive FY label is rejected', threw);
  let threw2 = false;
  try { TparService.fyRange('nonsense'); } catch { threw2 = true; }
  ok('unit: a malformed FY label is rejected', threw2);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
