-- ProjMan — migration v032: a REAL multi-level chart of accounts for eBizco's own
-- Finance books, replacing v031's flat 10-row stub.
--
-- Modelled directly on ../ihms's own `account` table and P&L report (account.js
-- `/getAcc/:fromdt/:todt/:gst`) — same shape: 5 root accounts (parent_id NULL) —
-- Revenue/Expenses feed the P&L, Assets/Liabilities/Equity feed the Balance Sheet —
-- each with category-level children (L2) and leaf accounts (L3) underneath. Ordered
-- with `seq` per ihms's own `seqID`. Report period itself is the implicit L0 (not a
-- row here — the report's own root node, added at render time).
--
-- NOT copied verbatim: ihms caches `balance`/`debits`/`credits` on the account row,
-- updated by a recursive bottom-up walk (`prepareAccount`'s fn/fn2/fn3 chain) after
-- every report request. That's the exact drift-prone pattern already rejected once
-- this session (xprojman-29's `tasks.actual_amount`) — this schema still carries NO
-- cached balance columns; FinanceService computes every rollup live from
-- `fin_journal` at report-generation time instead.
--
-- Four well-known leaf ids are PRESERVED from v031 (same UUID, new position in the
-- tree) because FinanceService.js's `ACCOUNTS` constant hardcodes them:
--   ...0001 Cash & Bank            (was a flat root, now Assets > Current Assets > Cash & Bank)
--   ...0002 Tax Payable            (was a flat root, now Liabilities > Current Liabilities > Tax Payable)
--   ...0004 Subscription Revenue   (was a flat root, now Revenue > Subscription Revenue, still L2)
--   ...0005 Wages Expense          (was a flat root, now Expenses > Employee Costs > Wages Expense)
-- Everything else from v031's flat seed is retired (deleted below, along with this
-- session's own smoke-test transactions — no real user has used Finance yet, so
-- there is nothing of value to preserve).

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ── Clear this session's own smoke-test data ──────────────────────────────────
-- fin_accounts self-references via parent_id, so a plain DELETE fails mid-batch
-- (MySQL has no guaranteed row-deletion order matching the parent/child
-- dependency within one statement) — toggle FK checks off for this cleanup only,
-- same as any other "wipe and reseed" block.
DELETE FROM `fin_journal`;
DELETE FROM `fin_payroll_items`;
DELETE FROM `fin_payroll`;
DELETE FROM `fin_expenses`;
DELETE FROM `fin_staff`;
SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM `fin_accounts`;
SET FOREIGN_KEY_CHECKS = 1;

-- ── L1 — the five roots. Revenue/Expenses feed the P&L; Assets/Liabilities/Equity
-- feed the Balance Sheet (FinanceService routes on `acc_type`, no separate
-- PLEnabled flag needed — ihms needed one because a handful of expense-typed rows
-- were deliberately excluded from its P&L; nothing here needs that exception yet).
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000030', NULL, 1, 'revenue',   'Revenue'),
  ('00000000-0000-4f00-9000-000000000031', NULL, 2, 'expense',   'Expenses'),
  ('00000000-0000-4f00-9000-000000000032', NULL, 3, 'asset',     'Assets'),
  ('00000000-0000-4f00-9000-000000000033', NULL, 4, 'liability', 'Liabilities'),
  ('00000000-0000-4f00-9000-000000000034', NULL, 5, 'equity',    'Equity');

-- ── L2 under Revenue ──────────────────────────────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000004', '00000000-0000-4f00-9000-000000000030', 1, 'revenue', 'Subscription Revenue'),
  ('00000000-0000-4f00-9000-000000000035', '00000000-0000-4f00-9000-000000000030', 2, 'revenue', 'Other Revenue');

-- ── L3 under Other Revenue ────────────────────────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000036', '00000000-0000-4f00-9000-000000000035', 1, 'revenue', 'Interest Income');

-- ── L2 under Expenses ─────────────────────────────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000037', '00000000-0000-4f00-9000-000000000031', 1, 'expense', 'Employee Costs'),
  ('00000000-0000-4f00-9000-000000000038', '00000000-0000-4f00-9000-000000000031', 2, 'expense', 'Office Expenses'),
  ('00000000-0000-4f00-9000-000000000039', '00000000-0000-4f00-9000-000000000031', 3, 'expense', 'Professional Fees');

-- ── L3 under Employee Costs ───────────────────────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000005', '00000000-0000-4f00-9000-000000000037', 1, 'expense', 'Wages Expense'),
  ('00000000-0000-4f00-9000-00000000003a', '00000000-0000-4f00-9000-000000000037', 2, 'expense', 'Superannuation');

-- ── L3 under Office Expenses ──────────────────────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-00000000003b', '00000000-0000-4f00-9000-000000000038', 1, 'expense', 'Software & Subscriptions'),
  ('00000000-0000-4f00-9000-00000000003c', '00000000-0000-4f00-9000-000000000038', 2, 'expense', 'Rent'),
  ('00000000-0000-4f00-9000-00000000003d', '00000000-0000-4f00-9000-000000000038', 3, 'expense', 'Utilities'),
  ('00000000-0000-4f00-9000-00000000003e', '00000000-0000-4f00-9000-000000000038', 4, 'expense', 'Other Operating Costs');

-- ── L3 under Professional Fees ────────────────────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-00000000003f', '00000000-0000-4f00-9000-000000000039', 1, 'expense', 'Accounting & Legal');

-- ── L2 under Assets ───────────────────────────────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000040', '00000000-0000-4f00-9000-000000000032', 1, 'asset', 'Current Assets'),
  ('00000000-0000-4f00-9000-000000000041', '00000000-0000-4f00-9000-000000000032', 2, 'asset', 'Fixed Assets');

-- ── L3 under Current Assets / Fixed Assets ────────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000001', '00000000-0000-4f00-9000-000000000040', 1, 'asset', 'Cash & Bank'),
  ('00000000-0000-4f00-9000-000000000042', '00000000-0000-4f00-9000-000000000041', 1, 'asset', 'Office Equipment');

-- ── L2 under Liabilities ──────────────────────────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000043', '00000000-0000-4f00-9000-000000000033', 1, 'liability', 'Current Liabilities');

-- ── L3 under Current Liabilities ──────────────────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000002', '00000000-0000-4f00-9000-000000000043', 1, 'liability', 'Tax Payable'),
  ('00000000-0000-4f00-9000-000000000044', '00000000-0000-4f00-9000-000000000043', 2, 'liability', 'GST Payable');

-- ── L2 under Equity ───────────────────────────────────────────────────────────
-- Retained Earnings is never posted to directly (FinanceService.balanceSheet
-- computes it live as accumulated net profit, same as ihms treats it implicitly) —
-- kept as a real row purely so the tree has somewhere to display that figure.
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000003', '00000000-0000-4f00-9000-000000000034', 1, 'equity', 'Retained Earnings'),
  ('00000000-0000-4f00-9000-000000000045', '00000000-0000-4f00-9000-000000000034', 2, 'equity', "Owner's Capital");
