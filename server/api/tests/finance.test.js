// eBizco's own Finance books — chart-of-accounts expansion (migration v036) + the
// P&L GST toggle / GST-PAYG summary (owner directive, 2026-09-05).
//
// Proves:
//   1. The expanded chart of accounts (v036) is live: renamed L2s (Labour Cost,
//      Administrative Cost, Operating Cost) + a sample of the new L3 leaves.
//   2. An expense posts amount+tax; the P&L GST-inclusive view shows amount+tax on
//      that leaf, GST-exclusive shows amount alone — the exact stored `tax`, not a
//      formula guess (fin_expenses.tax is real per-row data).
//   3. Subscription revenue (posted via /admin/billing/payments, same path
//      BillingService really uses) is treated as GST-INCLUSIVE pricing: exclusive
//      view divides by 1.1; the GST summary's "GST must pay" is that revenue's /11
//      GST component.
//   4. "GST from purchase" = SUM(fin_expenses.tax) for the period (input tax
//      credit); "Tax withholding in PAYG" = SUM(fin_payroll.tax) for runs PAID in
//      the period; net GST payable and the combined BAS total are correct.
//   5. Non-admin is refused (existing admin allowlist gate, unaffected).
//
// Run: DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js &   then
//      BASE=http://localhost:4199 node tests/finance.test.js
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`Finance test → ${BASE}\n`);
  const s = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const reg = await call('POST', '/auth/register', {
    organisation: { name: `FinTest ${s}` },
    user: { full_name: 'Alice Admin', email: `fa${s}@x.com`, password: 'hunter2hunter2' },
    device: { device_uid: `fa-${s}`, platform: 'web' },
  });
  const pm = reg.j.data.accessToken;
  const userId = reg.j.data.user.id;
  const orgId = reg.j.data.organisation.id;

  const denied = await call('GET', '/admin/finance/reports/pnl', undefined, pm);
  ok('non-platform-admin refused /admin/finance/reports/pnl (403)', denied.status === 403, JSON.stringify(denied.j));

  await pool.query('INSERT INTO platform_admins (id, user_id, admin_role, note) VALUES (?, ?, ?, ?)', [uuidv4(), userId, 'admin', 'test']);

  // ── 1. Chart of accounts (v036) ──
  const accs = await call('GET', '/admin/finance/accounts', undefined, pm);
  const byName = (n) => accs.j.data.accounts.find((a) => a.name === n);
  ok('L2 renamed: Labour Cost', !!byName('Labour Cost'));
  ok('L2 renamed: Administrative Cost', !!byName('Administrative Cost'));
  ok('L2 renamed: Operating Cost', !!byName('Operating Cost'));
  ok('new L3: Staff Benefit', !!byName('Staff Benefit'));
  ok('new L3: Payroll Tax', !!byName('Payroll Tax'));
  ok('new L3: Bank Fee', !!byName('Bank Fee'));
  ok('new L3: Bad Debt', !!byName('Bad Debt'));
  ok('new L3: Equipment', !!byName('Equipment'));
  ok('new L3: Postage & Shipping', !!byName('Postage & Shipping'));
  ok('renamed L3: Consultant Fee (Legal)', !!byName('Consultant Fee (Legal)'));

  const bankFee = byName('Bank Fee');

  // Finance is a single, un-org-scoped ledger by design (migration_v031 — one
  // company, not multi-tenant) — re-running this file on the SAME calendar day
  // adds to whatever an earlier run already posted for "today". So every figure
  // below is asserted as a DELTA against a baseline taken right here, not against
  // an assumed-pristine zero.
  function findLeaf(tree, name) {
    for (const root of tree) {
      const stack = [root];
      while (stack.length) {
        const n = stack.pop();
        if (n.name === name) return n;
        stack.push(...(n.children || []));
      }
    }
    return null;
  }
  // Baselines taken in BOTH modes — each mode's "after" figure is compared only
  // against its OWN mode's "before" (an inclusive-mode Bank Fee total and an
  // exclusive-mode one differ by however much prior tax was already posted today,
  // so mixing baselines across modes would produce a false failure on a re-run).
  const beforeIncl = (await call('GET', `/admin/finance/reports/pnl?from=${today}&to=${today}&gst_mode=inclusive`, undefined, pm)).j.data;
  const beforeExcl = (await call('GET', `/admin/finance/reports/pnl?from=${today}&to=${today}&gst_mode=exclusive`, undefined, pm)).j.data;
  const beforeInclBankFee = findLeaf(beforeIncl.tree, 'Bank Fee')?.total || 0;
  const beforeExclBankFee = findLeaf(beforeExcl.tree, 'Bank Fee')?.total || 0;
  const beforeInclSubRev = findLeaf(beforeIncl.tree, 'Subscription Revenue')?.total || 0;
  const beforeExclSubRev = findLeaf(beforeExcl.tree, 'Subscription Revenue')?.total || 0;
  const beforeGst = beforeIncl.gst;

  // ── 2. An expense with amount+tax ──
  const EXP_AMOUNT = 200, EXP_TAX = 20;
  const exp = await call('POST', '/admin/finance/expenses',
    { account_id: bankFee.id, description: `Test bank fee ${s}`, amount: EXP_AMOUNT, tax: EXP_TAX, incurred_at: today }, pm);
  ok('expense recorded', exp.status === 201, JSON.stringify(exp.j));

  // ── 3. Subscription revenue via the real BillingService path ──
  const SUB_AMOUNT = 1100; // GST-inclusive: $1000 + $100 GST (11 x $100)
  const pay = await call('POST', '/admin/billing/payments', { org_id: orgId, amount: SUB_AMOUNT, status: 'paid' }, pm);
  ok('subscription payment recorded', pay.status === 201, JSON.stringify(pay.j));
  await sleep(300); // postSubscriptionRevenue is fire-and-forget (non-fatal by design) off this route

  // ── 4. Payroll, to prove PAYG withholding is period-scoped by paid_at ──
  const staff = await call('POST', '/admin/finance/staff', { full_name: `Test Staffer ${s}`, pay_type: 'salary', rate: 1000 }, pm);
  const run = await call('POST', '/admin/finance/payroll',
    { staff_id: staff.j.data.id, period_start: today, period_end: today, tax: 150, super_amount: 95 }, pm);
  ok('payroll run created', run.status === 201, JSON.stringify(run.j));
  const paid = await call('POST', `/admin/finance/payroll/${run.j.data.id}/pay`, undefined, pm);
  ok('payroll run paid', paid.status === 200, JSON.stringify(paid.j));

  // ── The P&L itself, both GST modes, tight-bounded to today. Every figure below
  // is the DELTA against the `before` baseline taken above this test's own postings —
  // see the note there for why (single un-org-scoped ledger, re-runs on the same day).
  const incl = await call('GET', `/admin/finance/reports/pnl?from=${today}&to=${today}&gst_mode=inclusive`, undefined, pm);
  const excl = await call('GET', `/admin/finance/reports/pnl?from=${today}&to=${today}&gst_mode=exclusive`, undefined, pm);
  ok('inclusive P&L 200', incl.status === 200, JSON.stringify(incl.j));
  ok('exclusive P&L 200', excl.status === 200, JSON.stringify(excl.j));

  const inclBankFee = findLeaf(incl.j.data.tree, 'Bank Fee')?.total || 0;
  const exclBankFee = findLeaf(excl.j.data.tree, 'Bank Fee')?.total || 0;
  ok('GST-inclusive Bank Fee leaf grew by amount + tax',
    Math.abs((inclBankFee - beforeInclBankFee) - (EXP_AMOUNT + EXP_TAX)) < 0.01, `now=${inclBankFee} before=${beforeInclBankFee}`);
  ok('GST-exclusive Bank Fee leaf grew by amount only (the real stored net, not a formula)',
    Math.abs((exclBankFee - beforeExclBankFee) - EXP_AMOUNT) < 0.01, `now=${exclBankFee} before=${beforeExclBankFee}`);

  const inclSubRev = findLeaf(incl.j.data.tree, 'Subscription Revenue')?.total || 0;
  const exclSubRev = findLeaf(excl.j.data.tree, 'Subscription Revenue')?.total || 0;
  ok('GST-inclusive Subscription Revenue grew by the full payment',
    Math.abs((inclSubRev - beforeInclSubRev) - SUB_AMOUNT) < 0.01, `now=${inclSubRev} before=${beforeInclSubRev}`);
  ok('GST-exclusive Subscription Revenue grew by payment / 1.1 (the one formula-derived figure, no per-payment GST field exists yet)',
    Math.abs((exclSubRev - beforeExclSubRev) - SUB_AMOUNT / 1.1) < 0.01, `now=${exclSubRev} before=${beforeExclSubRev}`);

  // ── GST/PAYG summary (independent of the display toggle — checked off the
  // inclusive response, but present identically on the exclusive one too) ──
  const gst = incl.j.data.gst;
  const expectedCollectedDelta = SUB_AMOUNT / 11; // AU 10% GST backed out of an inclusive price
  ok('GST must pay grew by subscription revenue / 11',
    Math.abs((gst.collected - beforeGst.collected) - expectedCollectedDelta) < 0.01, JSON.stringify({ gst, beforeGst }));
  ok('GST from purchase grew by the real recorded expense tax',
    Math.abs((gst.paid - beforeGst.paid) - EXP_TAX) < 0.01, JSON.stringify({ gst, beforeGst }));
  ok('net GST payable = collected - paid', Math.abs(gst.netPayable - (gst.collected - gst.paid)) < 0.01, JSON.stringify(gst));
  ok('PAYG withheld grew by the payroll run\'s recorded tax (paid this period)',
    Math.abs((gst.paygWithheld - beforeGst.paygWithheld) - 150) < 0.01, JSON.stringify({ gst, beforeGst }));
  ok('total BAS payable = net GST + PAYG withheld',
    Math.abs(gst.totalBasPayable - (gst.netPayable + gst.paygWithheld)) < 0.01, JSON.stringify(gst));
  ok('GST/PAYG summary present identically on the exclusive-mode response too',
    Math.abs(excl.j.data.gst.collected - gst.collected) < 0.01 && Math.abs(excl.j.data.gst.paid - gst.paid) < 0.01);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
