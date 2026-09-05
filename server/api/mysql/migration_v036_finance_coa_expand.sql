-- ProjMan — migration v036: Chart of Accounts expansion (owner directive, 2026-09-05)
-- for the P&L dashboard rework. Three L2 category renames + a full set of L3 leaf
-- accounts under each, matching the owner's own naming exactly. Renames update
-- IN PLACE (same id) — FinanceService.ACCOUNTS hardcodes 4 ids from v031/v032 and
-- none of those are touched here beyond a display-name tidy (WAGES_EXPENSE keeps
-- its name; the other 3 renames are cosmetic only, no code references these ids by
-- name).

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ── L2 renames (same ids, new names) ──────────────────────────────────────────
UPDATE `fin_accounts` SET `name` = 'Labour Cost'         WHERE `id` = '00000000-0000-4f00-9000-000000000037'; -- was 'Employee Costs'
UPDATE `fin_accounts` SET `name` = 'Operating Cost'      WHERE `id` = '00000000-0000-4f00-9000-000000000038'; -- was 'Office Expenses'
UPDATE `fin_accounts` SET `name` = 'Administrative Cost' WHERE `id` = '00000000-0000-4f00-9000-000000000039'; -- was 'Professional Fees'

-- ── Existing L3 leaves, renamed to match the owner's exact wording ────────────
UPDATE `fin_accounts` SET `name` = 'Consultant Fee (Legal)' WHERE `id` = '00000000-0000-4f00-9000-00000000003f'; -- was 'Accounting & Legal'
UPDATE `fin_accounts` SET `name` = 'Software & Subscription' WHERE `id` = '00000000-0000-4f00-9000-00000000003b'; -- was 'Software & Subscriptions'

-- ── New L3 leaves under Labour Cost (...037) ──────────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000050', '00000000-0000-4f00-9000-000000000037', 3, 'expense', 'Staff Benefit'),
  ('00000000-0000-4f00-9000-000000000051', '00000000-0000-4f00-9000-000000000037', 4, 'expense', 'Staff Travel'),
  ('00000000-0000-4f00-9000-000000000052', '00000000-0000-4f00-9000-000000000037', 5, 'expense', 'Union Fee'),
  ('00000000-0000-4f00-9000-000000000053', '00000000-0000-4f00-9000-000000000037', 6, 'expense', 'Payroll Tax');

-- ── New L3 leaves under Administrative Cost (...039) ──────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000054', '00000000-0000-4f00-9000-000000000039', 2, 'expense', 'Subscription Cost'),
  ('00000000-0000-4f00-9000-000000000055', '00000000-0000-4f00-9000-000000000039', 3, 'expense', 'Council Rate'),
  ('00000000-0000-4f00-9000-000000000056', '00000000-0000-4f00-9000-000000000039', 4, 'expense', 'Land Tax'),
  ('00000000-0000-4f00-9000-000000000057', '00000000-0000-4f00-9000-000000000039', 5, 'expense', 'Management Fee'),
  ('00000000-0000-4f00-9000-000000000058', '00000000-0000-4f00-9000-000000000039', 6, 'expense', 'Bank Fee'),
  ('00000000-0000-4f00-9000-000000000059', '00000000-0000-4f00-9000-000000000039', 7, 'expense', 'Bad Debt');

-- ── New L3 leaves under Operating Cost (...038) ───────────────────────────────
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-00000000005a', '00000000-0000-4f00-9000-000000000038', 5, 'expense', 'Inventory'),
  ('00000000-0000-4f00-9000-00000000005b', '00000000-0000-4f00-9000-000000000038', 6, 'expense', 'Insurance'),
  ('00000000-0000-4f00-9000-00000000005c', '00000000-0000-4f00-9000-000000000038', 7, 'expense', 'Equipment'),
  ('00000000-0000-4f00-9000-00000000005d', '00000000-0000-4f00-9000-000000000038', 8, 'expense', 'Lease'),
  ('00000000-0000-4f00-9000-00000000005e', '00000000-0000-4f00-9000-000000000038', 9, 'expense', 'Advertising'),
  ('00000000-0000-4f00-9000-00000000005f', '00000000-0000-4f00-9000-000000000038', 10, 'expense', 'Maintenance'),
  ('00000000-0000-4f00-9000-000000000060', '00000000-0000-4f00-9000-000000000038', 11, 'expense', 'Postage & Shipping'),
  ('00000000-0000-4f00-9000-000000000061', '00000000-0000-4f00-9000-000000000038', 12, 'expense', 'Vehicles');
