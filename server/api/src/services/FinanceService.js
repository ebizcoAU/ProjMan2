// FinanceService — eBizco's OWN books, as the SaaS operator (migration v031).
//
// NOT tenant accounting — every tenant org already has its own (P7/P8: cost_plans,
// purchase_orders, supplier_invoices, tax_periods, tpar_reports, fixed_assets, all
// org_id-scoped, owned by the tenant Portal). This is the other book: eBizco paying
// its own staff, its own office expenses, and its own subscription revenue from
// tenants. Single company, no org_id anywhere in this file.
//
// ONE LEDGER: fin_expenses and fin_payroll both auto-post to fin_journal here;
// BillingService.recordPayment (subscription revenue) posts to it too. P&L and
// Balance Sheet are always computed LIVE from fin_journal — fin_accounts carries no
// cached balance/debits/credits, on purpose (see migration_v031's header note; same
// anti-drift reasoning already applied to xprojman-29's tasks.actual_amount).

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');

// Well-known seed account ids (migration_v031) — used by the auto-posting helpers
// below so a caller never has to know or guess which account "Wages Expense" is.
const ACCOUNTS = {
  CASH: '00000000-0000-4f00-9000-000000000001',
  TAX_PAYABLE: '00000000-0000-4f00-9000-000000000002',
  RETAINED_EARNINGS: '00000000-0000-4f00-9000-000000000003',
  SUBSCRIPTION_REVENUE: '00000000-0000-4f00-9000-000000000004',
  WAGES_EXPENSE: '00000000-0000-4f00-9000-000000000005',
};

// ── Chart of accounts ─────────────────────────────────────────────────────────
async function listAccounts() {
  const [rows] = await pool.query(
    `SELECT id, parent_id, seq, acc_type, name, is_active
       FROM fin_accounts WHERE is_active = 1
      ORDER BY acc_type, COALESCE(parent_id, id), seq`
  );
  return { accounts: rows };
}

// ── Expenses (office/operating costs) ─────────────────────────────────────────
async function listExpenses({ page = 1, limit = 25 }) {
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM fin_expenses WHERE is_deleted = 0');
  const [rows] = await pool.query(
    `SELECT e.id, e.description, e.amount, e.tax, e.status, e.incurred_at, e.paid_at,
            a.name AS account_name, u.full_name AS created_by_name
       FROM fin_expenses e
       JOIN fin_accounts a ON a.id = e.account_id
       LEFT JOIN users u ON u.id = e.created_by
      WHERE e.is_deleted = 0
      ORDER BY e.incurred_at DESC, e.created_at DESC
      LIMIT ? OFFSET ?`,
    [Number(limit), (Number(page) - 1) * Number(limit)]
  );
  return { expenses: rows, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) || 1 } };
}

// Records the expense AND posts the two-sided journal entry in one transaction —
// an fin_expenses row with no matching journal postings would make the ledger lie.
async function createExpense({ accountId, description, amount, tax = 0, incurredAt, createdBy }) {
  if (!description || !String(description).trim()) throw new ServiceError('VALIDATION_ERROR', 'description is required', 400);
  if (!(Number(amount) > 0)) throw new ServiceError('VALIDATION_ERROR', 'amount must be a positive number', 422);
  const [[acc]] = await pool.query('SELECT id, acc_type FROM fin_accounts WHERE id = ? AND is_active = 1 LIMIT 1', [accountId]);
  if (!acc) throw new ServiceError('VALIDATION_ERROR', 'account_id not found', 422);
  if (acc.acc_type !== 'expense') throw new ServiceError('VALIDATION_ERROR', 'account_id must be an expense account', 422);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = uuidv4();
    const date = incurredAt || new Date().toISOString().slice(0, 10);
    const total = Number(amount) + Number(tax);
    await conn.query(
      `INSERT INTO fin_expenses (id, account_id, description, amount, tax, status, incurred_at, created_by)
       VALUES (?, ?, ?, ?, ?, 'recorded', ?, ?)`,
      [id, accountId, description.trim(), amount, tax, date, createdBy || null]
    );
    // Debit the expense category, credit Cash & Bank — the expense costs money out.
    await conn.query(
      `INSERT INTO fin_journal (id, account_id, debit, credit, ref_type, ref_id, memo, entry_date) VALUES
       (?, ?, ?, 0, 'expense', ?, ?, ?)`,
      [uuidv4(), accountId, total, id, description.trim(), date]
    );
    await conn.query(
      `INSERT INTO fin_journal (id, account_id, debit, credit, ref_type, ref_id, memo, entry_date) VALUES
       (?, ?, 0, ?, 'expense', ?, ?, ?)`,
      [uuidv4(), ACCOUNTS.CASH, total, id, description.trim(), date]
    );
    await conn.commit();
    return { id, status: 'recorded' };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── Staff roster ───────────────────────────────────────────────────────────────
async function listStaff({ status } = {}) {
  const where = status ? 'WHERE status = ?' : '';
  const [rows] = await pool.query(
    `SELECT id, full_name, role_title, pay_type, rate, status FROM fin_staff ${where} ORDER BY full_name`,
    status ? [status] : []
  );
  return { staff: rows };
}

async function createStaff({ fullName, roleTitle, payType = 'hourly', rate = 0, userId }) {
  if (!fullName || !String(fullName).trim()) throw new ServiceError('VALIDATION_ERROR', 'full_name is required', 400);
  const id = uuidv4();
  await pool.query(
    `INSERT INTO fin_staff (id, user_id, full_name, role_title, pay_type, rate) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId || null, fullName.trim(), roleTitle || null, payType, rate]
  );
  return { id };
}

// ── Payroll ────────────────────────────────────────────────────────────────────
async function listPayroll({ page = 1, limit = 25 }) {
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM fin_payroll');
  const [rows] = await pool.query(
    `SELECT p.id, p.period_start, p.period_end, p.gross_amount, p.tax, p.super_amount,
            p.total_paid, p.status, p.paid_at, s.full_name AS staff_name
       FROM fin_payroll p JOIN fin_staff s ON s.id = p.staff_id
      ORDER BY p.period_start DESC
      LIMIT ? OFFSET ?`,
    [Number(limit), (Number(page) - 1) * Number(limit)]
  );
  return { payroll: rows, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) || 1 } };
}

// Creates a draft pay run from a set of {workDate, hours, rateFactor} shift entries —
// gross pay computed from the staff member's own hourly rate (or a flat salary
// amount when pay_type='salary', items optional in that case). Not yet posted to the
// journal — that happens on markPayrollPaid, mirroring fin_expenses' "record now, the
// ledger entry is the thing that makes it real money out" posture from c1ihms's own
// draft-then-post pattern.
async function createPayrollRun({ staffId, periodStart, periodEnd, items = [], allowance = 0, tax = 0, superAmount = 0, createdBy }) {
  const [[staff]] = await pool.query('SELECT id, pay_type, rate FROM fin_staff WHERE id = ? AND status = "active" LIMIT 1', [staffId]);
  if (!staff) throw new ServiceError('VALIDATION_ERROR', 'staff_id not found or inactive', 422);
  if (!periodStart || !periodEnd) throw new ServiceError('VALIDATION_ERROR', 'period_start and period_end are required', 400);

  let gross;
  if (staff.pay_type === 'salary') {
    gross = Number(staff.rate);
  } else {
    gross = items.reduce((sum, i) => sum + Number(i.hours || 0) * Number(i.rateFactor || 1) * Number(staff.rate), 0);
  }
  const totalPaid = gross + Number(allowance) - Number(tax);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = uuidv4();
    await conn.query(
      `INSERT INTO fin_payroll (id, staff_id, period_start, period_end, gross_amount, tax, super_amount, total_paid, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [id, staffId, periodStart, periodEnd, gross, tax, superAmount, totalPaid, createdBy || null]
    );
    for (const item of items) {
      await conn.query(
        `INSERT INTO fin_payroll_items (id, payroll_id, work_date, hours, rate_factor) VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), id, item.workDate, item.hours, item.rateFactor || 1]
      );
    }
    await conn.commit();
    return { id, grossAmount: gross, totalPaid, status: 'draft' };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function markPayrollPaid({ payrollId }) {
  const [[run]] = await pool.query('SELECT id, total_paid, status FROM fin_payroll WHERE id = ? LIMIT 1', [payrollId]);
  if (!run) throw new ServiceError('NOT_FOUND', 'Payroll run not found', 404);
  if (run.status === 'paid') throw new ServiceError('VALIDATION_ERROR', 'Already paid', 409);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const paidAt = new Date().toISOString().slice(0, 10);
    await conn.query(`UPDATE fin_payroll SET status = 'paid', paid_at = ? WHERE id = ?`, [paidAt, payrollId]);
    await conn.query(
      `INSERT INTO fin_journal (id, account_id, debit, credit, ref_type, ref_id, memo, entry_date) VALUES
       (?, ?, ?, 0, 'payroll', ?, 'Payroll run', ?)`,
      [uuidv4(), ACCOUNTS.WAGES_EXPENSE, run.total_paid, payrollId, paidAt]
    );
    await conn.query(
      `INSERT INTO fin_journal (id, account_id, debit, credit, ref_type, ref_id, memo, entry_date) VALUES
       (?, ?, 0, ?, 'payroll', ?, 'Payroll run', ?)`,
      [uuidv4(), ACCOUNTS.CASH, run.total_paid, payrollId, paidAt]
    );
    await conn.commit();
    return { id: payrollId, status: 'paid', paidAt };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── Subscription revenue posting (called from BillingService.recordPayment) ────
// Kept here, not in BillingService, so every fin_journal-writing rule lives in one
// file — BillingService just calls this after it inserts its own `payments` row.
async function postSubscriptionRevenue({ paymentId, amount, paidAt }) {
  if (!(Number(amount) > 0)) return; // an 'overdue'/'failed' record has nothing to post yet
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const date = (paidAt ? new Date(paidAt) : new Date()).toISOString().slice(0, 10);
    await conn.query(
      `INSERT INTO fin_journal (id, account_id, debit, credit, ref_type, ref_id, memo, entry_date) VALUES
       (?, ?, ?, 0, 'subscription_payment', ?, 'Subscription payment received', ?)`,
      [uuidv4(), ACCOUNTS.CASH, amount, paymentId, date]
    );
    await conn.query(
      `INSERT INTO fin_journal (id, account_id, debit, credit, ref_type, ref_id, memo, entry_date) VALUES
       (?, ?, 0, ?, 'subscription_payment', ?, 'Subscription payment received', ?)`,
      [uuidv4(), ACCOUNTS.SUBSCRIPTION_REVENUE, amount, paymentId, date]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── Reports — a real multi-level tree, modelled on ../ihms's own P&L report
// (account.js `/getAcc/:fromdt/:todt/:gst`) ────────────────────────────────────
//
// ihms's tree: a disabled "period" root, whose children are the top-level accounts
// (Revenue/Expenses), each of which fans out through category (L2) and leaf (L3)
// accounts, with a rolled-up subtotal shown at every level and a final Net Profit
// summary row. Same shape here, computed differently: ihms caches `balance` on
// each `account` row via a recursive bottom-up UPDATE after every request; this
// walks `fin_accounts`' `parent_id` tree and sums `fin_journal` LIVE at read time
// instead — no cached figure to go stale or drift from the journal that is
// actually the source of truth (same reasoning as `documents.supersedes_id`
// already applied elsewhere, and the `tasks.actual_amount` refinement earlier
// this session: don't cache what you can just compute).
//
// One sign convention for both reports, uniform per account type rather than
// special-cased per account: an account's "natural balance" is which side of the
// ledger it normally grows on — debit for asset/expense, credit for liability/
// equity/revenue. `balance = (debit - credit) * sign`, sign = -1 for the
// credit-natural types, so every reported figure is a plain positive number
// meaning "this much", not a raw accounting debit/credit that only makes sense in
// context.
const BALANCE_SIGN = { asset: 1, expense: 1, liability: -1, equity: -1, revenue: -1 };

// Loads every active account, sums fin_journal per account over `journalWhere`
// (the caller decides period-delta vs. cumulative-to-date), links parent→children,
// and rolls up each node's `total` = its own balance + every descendant's. Returns
// the top-level (parent_id IS NULL) roots, `accType`-filtered to `rootTypes`.
async function buildAccountTree({ rootTypes, journalWhereSql, journalParams }) {
  const [accountRows] = await pool.query(
    `SELECT id, parent_id, seq, acc_type, name FROM fin_accounts WHERE is_active = 1 ORDER BY seq`
  );
  const [journalRows] = await pool.query(
    `SELECT account_id, SUM(debit) AS debit, SUM(credit) AS credit
       FROM fin_journal WHERE ${journalWhereSql} GROUP BY account_id`,
    journalParams
  );
  const journalByAccount = new Map(journalRows.map((r) => [r.account_id, { debit: Number(r.debit), credit: Number(r.credit) }]));

  const byId = new Map(accountRows.map((a) => [a.id, {
    id: a.id, name: a.name, accType: a.acc_type, seq: a.seq, parentId: a.parent_id,
    children: [],
    ownBalance: ((journalByAccount.get(a.id)?.debit || 0) - (journalByAccount.get(a.id)?.credit || 0)) * BALANCE_SIGN[a.acc_type],
    total: 0,
  }]));
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
  }
  function rollUp(node) {
    node.children.sort((a, b) => a.seq - b.seq);
    node.total = node.ownBalance + node.children.reduce((sum, c) => sum + rollUp(c), 0);
    return node.total;
  }
  const roots = [...byId.values()]
    .filter((n) => !n.parentId && rootTypes.includes(n.accType))
    .sort((a, b) => a.seq - b.seq);
  roots.forEach(rollUp);
  return roots;
}

// Profit & Loss, one period, tree-formatted: Revenue and Expenses roots, each
// walked down through category → leaf, a rolled-up total at every level, plus a
// Net Profit summary. `from`/`to` bound the PERIOD (a delta, not cumulative) —
// defaults to the current calendar month if neither is given.
async function profitAndLoss({ from, to }) {
  const today = new Date();
  const defaultFrom = from || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo = to || today.toISOString().slice(0, 10);

  const tree = await buildAccountTree({
    rootTypes: ['revenue', 'expense'],
    journalWhereSql: 'entry_date >= ? AND entry_date <= ?',
    journalParams: [defaultFrom, defaultTo],
  });
  const revenueRoot = tree.find((n) => n.accType === 'revenue');
  const expenseRoot = tree.find((n) => n.accType === 'expense');
  const netProfit = (revenueRoot?.total || 0) - (expenseRoot?.total || 0);
  return { from: defaultFrom, to: defaultTo, tree, netProfit };
}

// Balance Sheet: account balances AS OF a date — cumulative from the start of the
// ledger through `asOf`, not a period delta (a balance sheet is a snapshot, a P&L
// is a period). Retained Earnings isn't posted to directly (see fin_accounts'
// v032 comment) — it's injected as that leaf's `ownBalance`/`total`, computed as
// all-time net profit up to `asOf`, same plug-figure role it plays in ihms.
async function balanceSheet({ asOf }) {
  const date = asOf || new Date().toISOString().slice(0, 10);
  const tree = await buildAccountTree({
    rootTypes: ['asset', 'liability', 'equity'],
    journalWhereSql: 'entry_date <= ?',
    journalParams: [date],
  });

  const [[pl]] = await pool.query(
    `SELECT SUM(CASE WHEN a.acc_type = 'revenue' THEN j.credit - j.debit
                      WHEN a.acc_type = 'expense' THEN -(j.debit - j.credit) ELSE 0 END) AS net
       FROM fin_journal j JOIN fin_accounts a ON a.id = j.account_id
      WHERE j.entry_date <= ? AND a.acc_type IN ('revenue','expense')`,
    [date]
  );
  const retainedEarnings = Number(pl.net) || 0;
  const equityRoot = tree.find((n) => n.accType === 'equity');
  const retainedNode = equityRoot?.children.find((c) => c.id === ACCOUNTS.RETAINED_EARNINGS);
  if (retainedNode) {
    retainedNode.ownBalance = retainedEarnings;
    retainedNode.total = retainedEarnings;
    equityRoot.total += retainedEarnings;
  }

  const assetTotal = tree.find((n) => n.accType === 'asset')?.total || 0;
  const liabilityTotal = tree.find((n) => n.accType === 'liability')?.total || 0;
  const equityTotal = equityRoot?.total || 0;
  return {
    asOf: date, tree,
    totals: { asset: assetTotal, liability: liabilityTotal, equity: equityTotal },
    retainedEarnings,
    balanced: Math.abs(assetTotal - (liabilityTotal + equityTotal)) < 0.01,
  };
}

module.exports = {
  ACCOUNTS,
  listAccounts, listExpenses, createExpense,
  listStaff, createStaff, listPayroll, createPayrollRun, markPayrollPaid,
  postSubscriptionRevenue, profitAndLoss, balanceSheet,
};
