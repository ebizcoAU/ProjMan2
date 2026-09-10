// OrgFinanceService — per-tenant chart of accounts (xprojman-42 §2, migration
// v042). A parallel, org-scoped build alongside FinanceService/fin_accounts
// (eBizco's OWN books, Dashboard /admin/* only, deliberately no org_id per
// migration_v031's own header) — the ENGINEERING PATTERN (parent/child tree,
// no cached balance columns, live-computed rollups) is copied from there;
// the tables are not (xprojman-42 §0.1, confirmed §6).
//
// §3 (org_journal, migration v044) — AUTO posting, confirmed. postEntry is
// the generic, best-effort two-sided writer every auto-posting call site
// uses (ClaimService.pay, ProcurementService's supplier-invoice matched/
// approved transition — see those files for the "why these two, not PO
// issue" reasoning); profitAndLoss/balanceSheet mirror FinanceService's own
// live-computed, no-cached-balance report shape, org-scoped. Revenue
// posting has no write path yet (see migration_v044's header) — the P&L
// will show real expenses against zero revenue until that gap is closed.
//
// PERMISSION BOUNDARY (confirmed §6 response): `finance.manage` gates only
// STRUCTURAL org_accounts edits (create/rename/deactivate/re-parent) — a
// bigger blast radius than day-to-day money work, same reasoning `tax.
// approve` is narrower than `money.write`. Reading stays `money.read`.
// `cost_centres.linked_account_id` (set in CostingService, not here) is
// NOT a structural chart-of-accounts edit — it's tagging an existing
// money.write-gated row, so it keeps that gate rather than gaining a new one.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');

const canRead    = (role) => access.hasPermission(role, 'money.read');
const canManage  = (role) => access.hasPermission(role, 'finance.manage');

// Standard AU small-business chart of accounts, construction-tenant flavoured
// (confirmed §6: a new org with zero accounts can't produce a P&L/Balance
// Sheet at all — seed a real starting tree, editable after). Same multi-root-
// per-type shape as fin_accounts (v031) — there is no single umbrella
// "Expenses" node, `acc_type` roots sit side by side. Overhead buckets
// (Corporate/Admin, Sales & BD, Engineering Operations — confirmed §8 point
// 1) are deliberately childless top-level expense roots: an overhead cost is
// a plain expense-account entry that never carries a project tag, nothing
// else distinguishes them structurally.
//
// `code` is a string key used only within this seed list to wire parent_id
// before ids exist — it becomes org_accounts.code (unique per org), not a
// display artifact.
const TEMPLATE = [
  { code: '1000', name: 'Cash & Bank',                accType: 'asset' },
  { code: '1100', name: 'Accounts Receivable',        accType: 'asset' },
  { code: '1200', name: 'Retention Receivable',       accType: 'asset' },

  { code: '2000', name: 'Accounts Payable',           accType: 'liability' },
  { code: '2100', name: 'GST Payable',                accType: 'liability' },
  { code: '2200', name: 'PAYG Withholding Payable',   accType: 'liability' },
  { code: '2300', name: 'Retention Payable',          accType: 'liability' },

  { code: '3000', name: "Owner's Equity",             accType: 'equity' },
  { code: '3100', name: 'Retained Earnings',          accType: 'equity' },

  { code: '4000', name: 'Contract Revenue',           accType: 'revenue' },
  { code: '4010', name: 'Variation Income',           accType: 'revenue', parent: '4000' },
  { code: '4100', name: 'Other Income',                accType: 'revenue' },

  { code: '5000', name: 'Labour Cost',                accType: 'expense' },
  { code: '5010', name: 'Staff Wages',                accType: 'expense', parent: '5000' },
  { code: '5020', name: 'Subcontractor Labour',       accType: 'expense', parent: '5000' },
  { code: '5030', name: 'Superannuation',             accType: 'expense', parent: '5000' },
  { code: '5040', name: 'Payroll Tax',                accType: 'expense', parent: '5000' },

  { code: '5100', name: 'Materials Cost',             accType: 'expense' },
  { code: '5110', name: 'Materials & Supplies',       accType: 'expense', parent: '5100' },
  { code: '5120', name: 'Plant & Equipment Hire',     accType: 'expense', parent: '5100' },

  { code: '5200', name: 'Site Cost',                  accType: 'expense' },
  { code: '5210', name: 'Site Establishment',         accType: 'expense', parent: '5200' },
  { code: '5220', name: 'Insurance',                  accType: 'expense', parent: '5200' },
  { code: '5230', name: 'Permits & Fees',             accType: 'expense', parent: '5200' },

  { code: '5300', name: 'Administrative Cost',        accType: 'expense' },
  { code: '5310', name: 'Office Expenses',            accType: 'expense', parent: '5300' },
  { code: '5320', name: 'Professional Fees',          accType: 'expense', parent: '5300' },
  { code: '5330', name: 'Bank Fees',                  accType: 'expense', parent: '5300' },
  { code: '5340', name: 'Software & Subscriptions',   accType: 'expense', parent: '5300' },

  // Overhead buckets (§8 point 1) — top-level, childless, expense.
  { code: '6000', name: 'Corporate/Admin',            accType: 'expense' },
  { code: '6100', name: 'Sales & BD',                 accType: 'expense' },
  { code: '6200', name: 'Engineering Operations',     accType: 'expense' },
];

// Seeds the standard template the first time an org touches Finance —
// "org creation or first Finance visit" (doc §2 phase 1); lazy-on-first-read
// was the simpler of the two to implement correctly (one code path, not one
// per org-creation entry point — self-registration, admin-created org,
// OAuth signup all funnel through here instead of each needing its own
// seeding hook) and self-heals every pre-existing org with zero backfill
// migration. Idempotent: a second call against an already-seeded org is a
// no-op (checked by row count, not a flag column — an org that later
// deletes every account back to zero re-seeding is an edge case nobody
// asked for and INSERT...UNIQUE(org_id,code) would just 409 harmlessly
// anyway if it somehow ran twice concurrently).
async function ensureSeeded(orgId) {
  const [[{ count }]] = await pool.query(
    'SELECT COUNT(*) AS count FROM org_accounts WHERE org_id = ?', [orgId]
  );
  if (count > 0) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const idByCode = new Map();
    let seq = 0;
    for (const acct of TEMPLATE) {
      const id = uuidv4();
      idByCode.set(acct.code, id);
      const parentId = acct.parent ? idByCode.get(acct.parent) : null;
      await conn.query(
        `INSERT INTO org_accounts (id, org_id, parent_id, code, name, acc_type, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, orgId, parentId, acct.code, acct.name, acct.accType, seq++]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    // A concurrent request already seeded this org between the count check and
    // here (uq_acct_org_code collision) — not a real failure, the tree exists.
    if (err.code === 'ER_DUP_ENTRY') return;
    throw err;
  } finally {
    conn.release();
  }
}

/** Plain parent/child tree, every active+inactive account (Settings needs to
 * show and re-activate a deactivated one) — no journal, no balances (§3). */
async function listAccounts({ orgId, actor }) {
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read', 403);
  await ensureSeeded(orgId);
  const [rows] = await pool.query(
    `SELECT id, parent_id, code, name, acc_type, seq, is_active
       FROM org_accounts WHERE org_id = ? ORDER BY acc_type, seq`,
    [orgId]
  );
  const byId = new Map(rows.map((r) => [r.id, {
    id: r.id, code: r.code, name: r.name, accType: r.acc_type,
    seq: r.seq, isActive: !!r.is_active, parentId: r.parent_id, children: [],
  }]));
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
  }
  for (const node of byId.values()) node.children.sort((a, b) => a.seq - b.seq);
  const roots = [...byId.values()].filter((n) => !n.parentId).sort((a, b) => a.seq - b.seq);
  return { accounts: roots };
}

async function assertAccount(orgId, accountId) {
  const [[acc]] = await pool.query(
    'SELECT id, parent_id, acc_type FROM org_accounts WHERE id = ? AND org_id = ? LIMIT 1',
    [accountId, orgId]
  );
  if (!acc) throw new ServiceError('NOT_FOUND', 'Account not found', 404);
  return acc;
}

async function createAccount({ orgId, actor, parentId, code, name, accType }) {
  if (!canManage(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: finance.manage', 403);
  if (!code || !String(code).trim()) throw new ServiceError('VALIDATION_ERROR', 'code is required', 400);
  if (!name || !String(name).trim()) throw new ServiceError('VALIDATION_ERROR', 'name is required', 400);

  let resolvedType = accType;
  if (parentId) {
    const parent = await assertAccount(orgId, parentId);
    // A child's acc_type follows its parent — same convention the seed template
    // uses throughout (e.g. Staff Wages sits under Labour Cost, both 'expense').
    // Letting a caller mismatch these would make buildAccountTree-style rollups
    // (§3, once it exists) mix debit-natural and credit-natural balances under
    // one root, which is meaningless.
    if (accType && accType !== parent.acc_type) {
      throw new ServiceError('VALIDATION_ERROR', 'acc_type must match the parent account', 422);
    }
    resolvedType = parent.acc_type;
  }
  if (!resolvedType) throw new ServiceError('VALIDATION_ERROR', 'acc_type is required for a root account', 400);
  if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(resolvedType)) {
    throw new ServiceError('VALIDATION_ERROR', 'acc_type must be one of asset, liability, equity, revenue, expense', 422);
  }

  const [[dup]] = await pool.query(
    'SELECT id FROM org_accounts WHERE org_id = ? AND code = ? LIMIT 1', [orgId, code.trim()]
  );
  if (dup) throw new ServiceError('DUPLICATE_CODE', 'An account with this code already exists', 409);

  const [[{ maxSeq }]] = await pool.query(
    'SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM org_accounts WHERE org_id = ?', [orgId]
  );
  const id = uuidv4();
  await pool.query(
    `INSERT INTO org_accounts (id, org_id, parent_id, code, name, acc_type, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, parentId || null, code.trim(), name.trim(), resolvedType, maxSeq + 1]
  );
  return { id, code: code.trim(), name: name.trim(), accType: resolvedType, parentId: parentId || null };
}

/** Rename / activate-deactivate / re-parent — one PATCH, all finance.manage. */
async function updateAccount({ orgId, actor, accountId, name, isActive, parentId }) {
  if (name === undefined && isActive === undefined && parentId === undefined) {
    throw new ServiceError('NO_FIELDS', 'Nothing to update', 400);
  }
  if (!canManage(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: finance.manage', 403);
  const acc = await assertAccount(orgId, accountId);

  const fields = {};
  if (name !== undefined) {
    if (!String(name).trim()) throw new ServiceError('VALIDATION_ERROR', 'name cannot be empty', 422);
    fields.name = name.trim();
  }
  if (isActive !== undefined) fields.is_active = isActive ? 1 : 0;
  if (parentId !== undefined) {
    if (parentId === accountId) throw new ServiceError('VALIDATION_ERROR', 'An account cannot be its own parent', 422);
    if (parentId) {
      const parent = await assertAccount(orgId, parentId);
      if (parent.acc_type !== acc.acc_type) {
        throw new ServiceError('VALIDATION_ERROR', 're-parenting cannot change acc_type — move to a same-type parent', 422);
      }
      // Reject re-parenting under one of this account's own descendants — a
      // cycle would make the tree walk (listAccounts, and §3's future rollup)
      // infinite-loop. Only relevant when accountId has children; walk down
      // from it and check parentId never appears.
      const [descendants] = await pool.query(
        `SELECT id, parent_id FROM org_accounts WHERE org_id = ?`, [orgId]
      );
      const childrenOf = new Map();
      for (const d of descendants) {
        if (!childrenOf.has(d.parent_id)) childrenOf.set(d.parent_id, []);
        childrenOf.get(d.parent_id).push(d.id);
      }
      const stack = [...(childrenOf.get(accountId) || [])];
      while (stack.length) {
        const cur = stack.pop();
        if (cur === parentId) throw new ServiceError('VALIDATION_ERROR', 'Cannot re-parent an account under its own descendant', 422);
        stack.push(...(childrenOf.get(cur) || []));
      }
    }
    fields.parent_id = parentId || null;
  }

  const columns = Object.keys(fields);
  await pool.query(
    `UPDATE org_accounts SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ? AND org_id = ?`,
    [...Object.values(fields), accountId, orgId]
  );
  return { id: accountId, ...fields };
}

// ── §3: the journal + reports (migration v044) ──────────────────────────────

/** A seeded template account by its stable CODE (e.g. '1000' Cash & Bank) — the
 * handle every auto-posting caller uses for a well-known account, since ids are
 * minted fresh per org. Runs ensureSeeded first so a never-visited-Finance org
 * still resolves on its very first journal-worthy write. */
async function accountByCode({ orgId, code }) {
  await ensureSeeded(orgId);
  const [[row]] = await pool.query('SELECT id FROM org_accounts WHERE org_id = ? AND code = ? LIMIT 1', [orgId, code]);
  return row?.id || null;
}

/**
 * Resolves the expense account a cost should post against. Primary source:
 * the task's own cost_centre_id → linked_account_id (§2/§4 point 2 —
 * exactly what that link was built FOR). Falls back to the seeded template's
 * "Materials Cost" root (code 5100, always exists once ensureSeeded has run)
 * when the task has no cost centre, or no cost centre is linked yet — most
 * supplier invoices in this app ARE materials/subcontractor costs, and a
 * best-guess bucket beats silently dropping the posting.
 */
async function resolveExpenseAccount({ orgId, taskId }) {
  await ensureSeeded(orgId);
  if (taskId) {
    const [[row]] = await pool.query(
      `SELECT cc.linked_account_id AS id FROM tasks t
         JOIN cost_centres cc ON cc.id = t.cost_centre_id
        WHERE t.id = ? AND t.org_id = ? AND cc.linked_account_id IS NOT NULL LIMIT 1`,
      [taskId, orgId]
    );
    if (row?.id) return row.id;
  }
  return accountByCode({ orgId, code: '5100' });
}

/**
 * The generic, best-effort two-sided writer. Every caller invokes this
 * fire-and-forget (`.catch(...)`, not awaited into the request path) — same
 * posture as AttestationService.emit elsewhere in this codebase: a posting
 * failure must never block the write that actually happened.
 *
 * Silently no-ops (does not throw) when either account can't be resolved or
 * amount isn't positive — an unresolvable mapping is a data-completeness gap
 * to surface on the report, not a reason to fail a procurement write days
 * after the fact. Idempotent on (org_id, ref_type, ref_id): a second call
 * for the same ref (e.g. an invoice re-entering 'approved' from 'matched')
 * is a no-op, not a duplicate posting.
 */
async function postEntry({ orgId, projectId, debitAccountId, creditAccountId, amount, refType, refId, memo, entryDate }) {
  if (!debitAccountId || !creditAccountId || !(Number(amount) > 0)) return;
  const [[dup]] = await pool.query(
    'SELECT id FROM org_journal WHERE org_id = ? AND ref_type = ? AND ref_id = ? LIMIT 1',
    [orgId, refType, refId]
  );
  if (dup) return;

  const date = entryDate || new Date().toISOString().slice(0, 10);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO org_journal (id, org_id, account_id, project_id, debit, credit, ref_type, ref_id, memo, entry_date)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [uuidv4(), orgId, debitAccountId, projectId || null, amount, refType, refId || null, memo || null, date]
    );
    await conn.query(
      `INSERT INTO org_journal (id, org_id, account_id, project_id, debit, credit, ref_type, ref_id, memo, entry_date)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [uuidv4(), orgId, creditAccountId, projectId || null, amount, refType, refId || null, memo || null, date]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Same BALANCE_SIGN/tree-rollup shape as FinanceService.buildAccountTree —
// the pattern this whole module was told to copy (§0.1), org-scoped instead
// of global, and reading org_accounts/org_journal instead of the fin_*
// tables. No GST toggle — org_journal carries no parallel gross/net figure
// the way fin_expenses.tax does; that's a real gap for a future pass, not
// silently faked here.
const BALANCE_SIGN = { asset: 1, expense: 1, liability: -1, equity: -1, revenue: -1 };

async function buildOrgAccountTree({ orgId, rootTypes, journalWhereSql, journalParams }) {
  const [accountRows] = await pool.query(
    `SELECT id, parent_id, seq, acc_type, name FROM org_accounts WHERE org_id = ? AND is_active = 1 ORDER BY seq`,
    [orgId]
  );
  const [journalRows] = await pool.query(
    `SELECT account_id, SUM(debit) AS debit, SUM(credit) AS credit
       FROM org_journal WHERE org_id = ? AND ${journalWhereSql} GROUP BY account_id`,
    [orgId, ...journalParams]
  );
  const journalByAccount = new Map(journalRows.map((r) => [r.account_id, { debit: Number(r.debit), credit: Number(r.credit) }]));

  const byId = new Map(accountRows.map((a) => {
    const ownBalance = ((journalByAccount.get(a.id)?.debit || 0) - (journalByAccount.get(a.id)?.credit || 0)) * BALANCE_SIGN[a.acc_type];
    return [a.id, { id: a.id, name: a.name, accType: a.acc_type, seq: a.seq, parentId: a.parent_id, children: [], ownBalance, total: 0 }];
  }));
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
  }
  function rollUp(node) {
    node.children.sort((a, b) => a.seq - b.seq);
    node.total = node.ownBalance + node.children.reduce((sum, c) => sum + rollUp(c), 0);
    return node.total;
  }
  const roots = [...byId.values()].filter((n) => !n.parentId && rootTypes.includes(n.accType)).sort((a, b) => a.seq - b.seq);
  roots.forEach(rollUp);
  return roots;
}

/** GET /finance/reports/pnl?from=&to= — one period, Revenue/Expense roots + Net Profit. */
async function profitAndLoss({ orgId, actor, from, to }) {
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read', 403);
  await ensureSeeded(orgId);
  const today = new Date();
  const defaultFrom = from || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo = to || today.toISOString().slice(0, 10);
  const tree = await buildOrgAccountTree({
    orgId, rootTypes: ['revenue', 'expense'],
    journalWhereSql: 'entry_date >= ? AND entry_date <= ?', journalParams: [defaultFrom, defaultTo],
  });
  const revenueRoot = tree.find((n) => n.accType === 'revenue');
  const expenseRoot = tree.find((n) => n.accType === 'expense');
  const netProfit = (revenueRoot?.total || 0) - (expenseRoot?.total || 0);
  return { from: defaultFrom, to: defaultTo, tree, netProfit };
}

/** GET /finance/reports/balance-sheet?as_of= — cumulative snapshot, Retained Earnings plugged. */
async function balanceSheet({ orgId, actor, asOf }) {
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read', 403);
  await ensureSeeded(orgId);
  const date = asOf || new Date().toISOString().slice(0, 10);
  const tree = await buildOrgAccountTree({
    orgId, rootTypes: ['asset', 'liability', 'equity'],
    journalWhereSql: 'entry_date <= ?', journalParams: [date],
  });

  const [[pl]] = await pool.query(
    `SELECT SUM(CASE WHEN a.acc_type = 'revenue' THEN j.credit - j.debit
                      WHEN a.acc_type = 'expense' THEN -(j.debit - j.credit) ELSE 0 END) AS net
       FROM org_journal j JOIN org_accounts a ON a.id = j.account_id
      WHERE j.org_id = ? AND j.entry_date <= ? AND a.acc_type IN ('revenue','expense')`,
    [orgId, date]
  );
  const retainedEarnings = Number(pl.net) || 0;
  // '3100' Retained Earnings is a TOP-LEVEL root in the seeded template (a sibling
  // of Owner's Equity 3000, not nested under it — the template's own multi-root-
  // per-type shape, same as fin_accounts' Cash & Bank/Wages Expense sitting side
  // by side). Find it directly among the tree's roots, not inside some other
  // equity root's children — org_accounts ids are minted fresh per org, so the
  // seeded CODE is the only stable handle here (unlike FinanceService.ACCOUNTS'
  // fixed well-known ids).
  const [[retainedAcct]] = await pool.query(
    'SELECT id FROM org_accounts WHERE org_id = ? AND code = ? LIMIT 1', [orgId, '3100']
  );
  const retainedLeaf = retainedAcct && tree.find((n) => n.id === retainedAcct.id);
  if (retainedLeaf) {
    retainedLeaf.ownBalance = retainedEarnings;
    retainedLeaf.total = retainedEarnings;
  }

  const assetTotal = tree.find((n) => n.accType === 'asset')?.total || 0;
  const liabilityTotal = tree.find((n) => n.accType === 'liability')?.total || 0;
  // Sum EVERY equity root, not just one — the template seeds two (Owner's
  // Equity, Retained Earnings) side by side, same multi-root shape as above.
  const equityTotal = tree.filter((n) => n.accType === 'equity').reduce((sum, n) => sum + n.total, 0);
  return {
    asOf: date, tree, totals: { asset: assetTotal, liability: liabilityTotal, equity: equityTotal },
    retainedEarnings, balanced: Math.abs(assetTotal - (liabilityTotal + equityTotal)) < 0.01,
  };
}

/**
 * GET /finance/reports/expenses|sales — the doc's own framing: "arguably
 * just two different account-type filters over the same journal, not
 * separate data models." A flat, leaf-level (no children) listing of every
 * posting in the period for one acc_type, newest first — not a tree, since
 * a transaction list is what "Expenses"/"Sales" mean as nav items, not a
 * rolled-up summary (that's what P&L already is).
 */
async function listEntries({ orgId, actor, accType, from, to }) {
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read', 403);
  await ensureSeeded(orgId);
  const today = new Date();
  const defaultFrom = from || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo = to || today.toISOString().slice(0, 10);
  const [rows] = await pool.query(
    `SELECT j.id, j.entry_date, j.debit, j.credit, j.ref_type, j.ref_id, j.memo,
            a.id AS account_id, a.name AS account_name, p.name AS project_name
       FROM org_journal j
       JOIN org_accounts a ON a.id = j.account_id
       LEFT JOIN projects p ON p.id = j.project_id
      WHERE j.org_id = ? AND a.acc_type = ? AND j.entry_date >= ? AND j.entry_date <= ?
        AND ${accType === 'revenue' ? 'j.credit > 0' : 'j.debit > 0'}
      ORDER BY j.entry_date DESC, j.created_at DESC`,
    [orgId, accType, defaultFrom, defaultTo]
  );
  return {
    from: defaultFrom, to: defaultTo,
    entries: rows.map((r) => ({ ...r, amount: accType === 'revenue' ? Number(r.credit) : Number(r.debit) })),
  };
}

module.exports = {
  ensureSeeded, listAccounts, createAccount, updateAccount,
  accountByCode, resolveExpenseAccount, postEntry, profitAndLoss, balanceSheet, listEntries,
};
