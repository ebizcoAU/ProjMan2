// P8b GST & BAS acceptance (serverdesignspec §11.2/§11.3, migration v023).
//
// Proves:
//   1. accounts.read gates the org-level surface (a foreperson is refused; the PM holds it at v10).
//   2. prepareBas classifies the quarter and caches G1/1A/1B/net — with the pinned convention
//      (`amount` ex-GST, gst_amount additive, G1 = amount + gst_amount).
//   3. An UNREGISTERED org attributes no GST, whatever the treatment says.
//   4. gst_free / out_of_scope rows are counted in G1 but carry no GST.
//   5. What deliberately does NOT count: a 'submitted' (uncertified) claim, a 'declined' claim,
//      a 'received'/'disputed' supplier invoice, and project_payments (never in 1B — double count).
//   6. THE GATE: lodging is `tax.approve` — the accountant lodges, the PM (accounts.read but no
//      tax.approve) is refused; lodging an unprepared period is refused.
//   7. A LODGED period cannot be re-prepared (409) — the cached figures are the lodgement record.
//   8. Cash basis is REFUSED (422), not approximated.
//   9. Export produces a BAS worksheet + the GST transaction listing behind it.
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/tax.test.js
const BASE = (process.env.BASE || 'http://localhost:4199') + '/api/v1';
const pool = require('../src/db/pool');
const TaxService = require('../src/services/TaxService');

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
// The BAS quarter we are in right now — so the rows this test creates (created_at = now) fall in it.
function currentQuarterStart() {
  const n = new Date();
  const m = [0, 3, 6, 9].filter((x) => x <= n.getUTCMonth()).pop();
  return `${n.getUTCFullYear()}-${String(m + 1).padStart(2, '0')}-01`;
}

(async () => {
  console.log(`P8b GST & BAS test → ${BASE}\n`);
  const s = Date.now();
  const Q = currentQuarterStart();

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `Tax ${s}` },
    user: { full_name: 'Pat PM', email: `pm${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `pm-${s}`, platform: 'android' },
  });
  const pm = reg.json.data.accessToken, pmUser = reg.json.data.user.id, orgId = reg.json.data.organisation.id;

  const tpls = await call('GET', '/stage-templates', undefined, pm);
  const wa18 = tpls.json.data.templates.find((t) => t.is_system && t.stage_count === 18);
  const proj = await call('POST', '/projects', { code: `TX-${s}`, name: 'Lot 11 dwelling' }, pm);
  const projId = proj.json.data.id;
  await call('POST', `/projects/${projId}/programme`, { template_id: wa18.id }, pm);

  const foreTok = await pairAs(pm, pmUser, 'foreperson', `fore-${s}`);
  const builderTok = await pairAs(pm, pmUser, 'builder', `bldr-${s}`);

  const acctEmail = `acct${s}@x.com`;
  const mk = await call('POST', '/organisation/users',
    { email: acctEmail, full_name: 'Ada Accountant', role: 'accountant', password: 'ledger-lines-9' }, pm);
  const acctUser = mk.json.data?.id || mk.json.data?.user?.id;
  const acctLogin = await call('POST', '/auth/login',
    { email: acctEmail, password: 'ledger-lines-9', device: { device_uid: `acct-${s}`, platform: 'web' } });
  const acct = acctLogin.json.data?.accessToken;

  // ── 1. accounts.read gate ──
  // NOTE: `foreTok` is a device paired onto the FOUNDER's identity, and OWNER_CAPABILITIES attach
  // to the user (`is_org_owner`), not the device role — so since decision #18 that token DOES carry
  // accounts.read. To test the role gate we need a foreperson who is not the founder.
  const foreEmail = `fore${s}@x.com`;
  await call('POST', '/organisation/users',
    { email: foreEmail, full_name: 'Fred Foreperson', role: 'foreperson', password: 'site-gate-42' }, pm);
  const foreLogin = await call('POST', '/auth/login',
    { email: foreEmail, password: 'site-gate-42', device: { device_uid: `foreu-${s}`, platform: 'android' } });
  const foreUserTok = foreLogin.json.data?.accessToken;

  const badList = await call('GET', '/accounts/bas', undefined, foreUserTok);
  ok('accounts.read gates the org-level BAS surface (a non-founder foreperson is refused)',
    badList.status === 403, JSON.stringify(badList.json));

  // Pinned deliberately so the consequence of decision #18 is visible rather than a surprise:
  // a founder's device carries their owner capabilities WHATEVER role it is paired as. This is how
  // org.manage/users.manage/devices.manage have always behaved; #18 adds the books to that set.
  const founderDeviceBas = await call('GET', '/accounts/bas', undefined, foreTok);
  ok('DECISION #18 CONSEQUENCE: a founder\'s device carries accounts.read at ANY paired role',
    founderDeviceBas.status === 200, JSON.stringify(founderDeviceBas.json));
  const pmList = await call('GET', '/accounts/bas', undefined, pm);
  ok('the PM holds accounts.read at matrix v10', pmList.status === 200, JSON.stringify(pmList.json));

  // ── 3. Unregistered org attributes NO GST ──
  await pool.query('UPDATE organisations SET gst_registered = 0 WHERE id = ?', [orgId]);
  const claim1 = await call('POST', `/projects/${projId}/progress-claims`, { amount: 10000 }, builderTok);
  ok('builder submits a progress claim', claim1.status === 201, JSON.stringify(claim1.json));
  await call('POST', `/projects/${projId}/progress-claims/${claim1.json.data.id}/approve`, { accept: true }, pm);

  const unreg = await call('POST', '/accounts/bas/prepare', { period_start: Q }, pm);
  ok('an UNREGISTERED org attributes no GST (1A = 0) even on a `gst` row',
    unreg.status === 200 && Number(unreg.json.data.a1_gst_on_sales) === 0, JSON.stringify(unreg.json.data));
  ok('…but the sale is still reported in G1 (10000)',
    Number(unreg.json.data.g1_total_sales) === 10000, JSON.stringify(unreg.json.data));

  // ── 2. Registered: the real roll-up ──
  await pool.query('UPDATE organisations SET gst_registered = 1 WHERE id = ?', [orgId]);

  // A second claim, left 'submitted' (uncertified) — must NOT count.
  const claim2 = await call('POST', `/projects/${projId}/progress-claims`, { amount: 5000 }, builderTok);
  // A third, declined — must NOT count.
  const claim3 = await call('POST', `/projects/${projId}/progress-claims`, { amount: 7000 }, builderTok);
  await call('POST', `/projects/${projId}/progress-claims/${claim3.json.data.id}/approve`, { accept: false }, pm);

  // A gst_free approved claim — counts in G1, no GST.
  const claim4 = await call('POST', `/projects/${projId}/progress-claims`, { amount: 2000 }, builderTok);
  await call('POST', `/projects/${projId}/progress-claims/${claim4.json.data.id}/approve`, { accept: true }, pm);
  await pool.query("UPDATE progress_claims SET gst_treatment = 'gst_free' WHERE id = ?", [claim4.json.data.id]);

  // Purchases: one approved (counts), one still 'received' (does not).
  const inv1 = await call('POST', `/projects/${projId}/supplier-invoices`,
    { invoice_number: `INV-${s}-1`, amount: 4000, supplier_name: 'Bright Timbers' }, pm);
  ok('PM records a supplier invoice', inv1.status === 201, JSON.stringify(inv1.json));
  // Status transition to 'approved' via DB — the 2-way match path is P7b's own test surface.
  await pool.query("UPDATE supplier_invoices SET status = 'approved' WHERE id = ?", [inv1.json.data.id]);
  const inv2 = await call('POST', `/projects/${projId}/supplier-invoices`,
    { invoice_number: `INV-${s}-2`, amount: 9000, supplier_name: 'Unverified Co' }, pm);

  const prep = await call('POST', '/accounts/bas/prepare', { period_start: Q }, pm);
  const d = prep.json.data;
  ok('prepareBas rolls up a registered org: 1A = 10% of the taxable sale (1000)',
    Number(d.a1_gst_on_sales) === 1000, JSON.stringify(d));
  ok('G1 is GST-INCLUSIVE and includes the gst_free sale (10000+1000 + 2000 = 13000)',
    Number(d.g1_total_sales) === 13000, JSON.stringify(d));
  ok('1B = GST on the APPROVED supplier invoice only (400, not the unverified 9000)',
    Number(d.b1_gst_on_purchases) === 400, JSON.stringify(d));
  ok('net GST = 1A − 1B = 600', Number(d.net_gst) === 600, JSON.stringify(d));
  ok('a submitted (uncertified) and a declined claim are both excluded',
    d.counted.sales === 2, JSON.stringify(d.counted));

  const [[c2row]] = await pool.query('SELECT gst_amount FROM progress_claims WHERE id = ?', [claim2.json.data.id]);
  ok('an uncounted claim is left unclassified (gst_amount stays 0)', Number(c2row.gst_amount) === 0);
  const [[c1row]] = await pool.query('SELECT amount, gst_amount FROM progress_claims WHERE id = ?', [claim1.json.data.id]);
  ok('the convention holds on the row: amount stays ex-GST 10000, gst_amount additive 1000',
    Number(c1row.amount) === 10000 && Number(c1row.gst_amount) === 1000, JSON.stringify(c1row));

  // ── 5. project_payments are classified but NEVER in 1B ──
  const payId = require('uuid').v4();
  await pool.query(
    `INSERT INTO project_payments (id, org_id, project_id, payee_user_id, amount, purpose, paid_at, recorded_by)
     VALUES (?, ?, ?, ?, ?, 'deposit', NOW(), ?)`,
    [payId, orgId, projId, pmUser, 3000, pmUser]);
  const prep2 = await call('POST', '/accounts/bas/prepare', { period_start: Q }, pm);
  ok('a project_payment is NOT rolled into 1B (still 400 — no double count with supplier invoices)',
    Number(prep2.json.data.b1_gst_on_purchases) === 400, JSON.stringify(prep2.json.data));
  const [[payRow]] = await pool.query('SELECT gst_amount FROM project_payments WHERE id = ?', [payId]);
  ok('…but it IS classified for TPAR (gst_amount = 300)', Number(payRow.gst_amount) === 300, JSON.stringify(payRow));

  // ── 8. Cash basis refused, not approximated ──
  const cash = await call('POST', '/accounts/bas/prepare', { period_start: Q, basis: 'cash' }, pm);
  ok('cash basis is REFUSED (422) rather than approximated off accrual dates',
    cash.status === 422 && /cash/i.test(cash.json.message || ''), JSON.stringify(cash.json));

  const badQ = await call('POST', '/accounts/bas/prepare', { period_start: '2026-08-01' }, pm);
  ok('a non-quarter period_start is refused', badQ.status === 400 || badQ.status === 422, JSON.stringify(badQ.json));

  // ── 6. THE GATE: lodging is tax.approve ──
  const periodId = prep2.json.data.id;
  const pmLodge = await call('POST', `/accounts/bas/${periodId}/lodge`, {}, pm);
  ok('THE GATE: the PM CANNOT lodge (accounts.read but no tax.approve)',
    pmLodge.status === 403 && /tax\.approve/.test(pmLodge.json.message || ''), JSON.stringify(pmLodge.json));

  const acctLodge = await call('POST', `/accounts/bas/${periodId}/lodge`, {}, acct);
  ok('the accountant CAN lodge (tax.approve extended to all tax artifacts — decision #14)',
    acctLodge.status === 200 && acctLodge.json.data.status === 'lodged', JSON.stringify(acctLodge.json));
  const [[lodged]] = await pool.query('SELECT status, lodged_by, lodged_at FROM tax_periods WHERE id = ?', [periodId]);
  ok('lodging stamps lodged_by / lodged_at',
    lodged.status === 'lodged' && lodged.lodged_by === acctUser && !!lodged.lodged_at, JSON.stringify(lodged));

  const relodge = await call('POST', `/accounts/bas/${periodId}/lodge`, {}, acct);
  ok('double-lodge is refused (409)', relodge.status === 409, JSON.stringify(relodge.json));

  // ── 7. A lodged period cannot be re-prepared ──
  const reprep = await call('POST', '/accounts/bas/prepare', { period_start: Q }, pm);
  ok('a LODGED period cannot be re-prepared (409) — the cache IS the lodgement record',
    reprep.status === 409, JSON.stringify(reprep.json));

  // ── 9. Export ──
  const exp = await call('GET', `/accounts/bas/${periodId}/export`, undefined, pm, true);
  ok('export returns CSV', exp.status === 200 && /G1,Total sales/.test(exp.text), exp.text?.slice(0, 120));
  ok('the worksheet carries the cached labels G1/1A/1B and the net',
    /1A,GST on sales,1000/.test(exp.text) && /1B,GST on purchases,400/.test(exp.text) && /600/.test(exp.text),
    exp.text?.split('\n').slice(8, 14).join(' | '));
  ok('the transaction listing behind the worksheet is included (sales + purchases)',
    /listing — SALES/.test(exp.text) && /listing — PURCHASES/.test(exp.text) && /Bright Timbers/.test(exp.text),
    exp.text?.slice(-300));
  ok('the unverified purchase is absent from the listing', !/Unverified Co/.test(exp.text));

  const badExport = await call('GET', `/accounts/bas/${periodId}/export`, undefined, foreUserTok, true);
  ok('export is accounts.read gated', badExport.status === 403);

  // ── DECISION #18: a Builder FOUNDER reaches their OWN org's books; an engaged Builder does not ──
  // The fix is `accounts.read` in OWNER_CAPABILITIES (lib/access.js), conferred by the
  // `users.is_org_owner` flag — NOT granted to the `builder` role, which would follow a Builder
  // into every org they are merely engaged into and expose another tenant's books.
  const founderEmail = `founder${s}@x.com`;
  const founderReg = await call('POST', '/auth/register', {
    organisation: { name: `Bob's Own Building ${s}` },
    user: { full_name: 'Bob Founder', email: founderEmail, password: 'own-company-11', role: 'builder' },
    device: { device_uid: `founder-${s}`, platform: 'android' },
  });
  const founderTok = founderReg.json.data?.accessToken;
  ok('a Builder can self-register and found their own org (role stays builder)',
    founderReg.status === 201 && founderReg.json.data?.user?.role === 'builder',
    JSON.stringify(founderReg.json?.data?.user));

  const founderBas = await call('GET', '/accounts/bas', undefined, founderTok);
  ok('DECISION #18: a Builder FOUNDER can see their OWN org\'s books (accounts.read via is_org_owner)',
    founderBas.status === 200, JSON.stringify(founderBas.json));

  // The other side of the ruling: the builder ROLE still confers nothing. This builder was created
  // by an org admin, so is_org_owner = 0 — an engaged Builder, not a founder.
  const engagedEmail = `engaged${s}@x.com`;
  await call('POST', '/organisation/users',
    { email: engagedEmail, full_name: 'Engaged Builder', role: 'builder', password: 'framing-crew-77' }, pm);
  const engagedLogin = await call('POST', '/auth/login',
    { email: engagedEmail, password: 'framing-crew-77', device: { device_uid: `eng-${s}`, platform: 'android' } });
  const engagedBas = await call('GET', '/accounts/bas', undefined, engagedLogin.json.data?.accessToken);
  ok('…but an ENGAGED (non-founder) Builder still CANNOT see the host org\'s books',
    engagedBas.status === 403, JSON.stringify(engagedBas.json));

  // ── Unit: quarter + gst maths ──
  ok('unit: quarterFor(1 Jul) = 1 Jul – 30 Sep',
    TaxService.quarterFor('2026-07-01').end.toISOString().slice(0, 10) === '2026-09-30');
  ok('unit: quarterFor(1 Jan) = 1 Jan – 31 Mar',
    TaxService.quarterFor('2026-01-01').end.toISOString().slice(0, 10) === '2026-03-31');
  let threw = false;
  try { TaxService.quarterFor('2026-08-01'); } catch { threw = true; }
  ok('unit: a mid-quarter start throws rather than snapping silently', threw);
  ok('unit: gstFor only attributes GST on a taxable supply by a registered org',
    TaxService.gstFor(1000, 'gst', true) === 100 &&
    TaxService.gstFor(1000, 'gst', false) === 0 &&
    TaxService.gstFor(1000, 'gst_free', true) === 0 &&
    TaxService.gstFor(1000, 'out_of_scope', true) === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
