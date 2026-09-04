-- ProjMan — migration v031: eBizco's own Finance books (Dashboard "Finance" section).
--
-- NOT tenant accounting. Every tenant construction org already has its own books
-- (P7/P8: cost_plans, purchase_orders, supplier_invoices, tax_periods, tpar_reports,
-- fixed_assets — all org_id-scoped). This is the OTHER book the owner named
-- explicitly: eBizco's own, as the SaaS operator — paying its own staff, its own
-- office expenses, and its own subscription revenue from tenants. Single company,
-- deliberately NO org_id anywhere in this migration.
--
-- ANTI-DRIFT DESIGN CHOICE, differs from the c1ihms.sql prior-art system this was
-- modelled on: `account` there cached `balance`/`debits`/`credits` directly on the
-- row, updated by application code alongside every journal write. That is exactly
-- the parallel-figure-that-can-drift shape already rejected once this session
-- (xprojman-29's `tasks.actual_amount`) — `fin_accounts` here carries NO cached
-- totals. P&L and Balance Sheet are always computed live from `fin_journal`, which
-- is the one source of truth.
--
-- ONE LEDGER, not two data sources stitched together: `fin_expenses` and
-- `fin_payroll` both auto-post to `fin_journal` on save (application code,
-- FinanceService), and BillingService.recordPayment (existing, v007) is extended to
-- post subscription revenue there too — see the retrofit note in AdminService/
-- BillingService. P&L reads `fin_journal` alone, never a UNION of unrelated tables.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- fin_accounts — chart of accounts, parent/child tree (same shape as c1ihms's
-- `account.parentID`, without the cached balance columns — see note above).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `fin_accounts` (
  `id`         CHAR(36)     NOT NULL,
  `parent_id`  CHAR(36)     NULL,
  `seq`        INT          NOT NULL DEFAULT 0,
  `acc_type`   ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  `name`       VARCHAR(120) NOT NULL,
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fin_accounts_parent` (`parent_id`),
  KEY `idx_fin_accounts_type`   (`acc_type`, `is_active`),
  CONSTRAINT `fk_fin_accounts_parent` FOREIGN KEY (`parent_id`) REFERENCES `fin_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- fin_journal — the ledger. One row per debit/credit posting. `ref_type`/`ref_id`
-- is a soft polymorphic ref (no FK by design — same pattern as documents.entity_id/
-- attestations.source_id), pointing back at the fin_expenses/fin_payroll/payments
-- row that caused the posting.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `fin_journal` (
  `id`          CHAR(36)      NOT NULL,
  `account_id`  CHAR(36)      NOT NULL,
  `debit`       DECIMAL(14,2) NOT NULL DEFAULT 0,
  `credit`      DECIMAL(14,2) NOT NULL DEFAULT 0,
  `ref_type`    VARCHAR(40)   NOT NULL COMMENT 'expense|payroll|subscription_payment|... — free text, extensible, same reasoning as attestations.source_type',
  `ref_id`      CHAR(36)      NULL,
  `memo`        VARCHAR(255)  NULL,
  `entry_date`  DATE          NOT NULL,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fin_journal_account_date` (`account_id`, `entry_date`),
  KEY `idx_fin_journal_ref`          (`ref_type`, `ref_id`),
  KEY `idx_fin_journal_date`         (`entry_date`),
  CONSTRAINT `fk_fin_journal_account` FOREIGN KEY (`account_id`) REFERENCES `fin_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- fin_expenses — eBizco's own office/operating expenses. Auto-posts two
-- fin_journal rows on save (debit the expense account, credit Cash/Bank).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `fin_expenses` (
  `id`           CHAR(36)      NOT NULL,
  `account_id`   CHAR(36)      NOT NULL COMMENT 'FK fin_accounts, acc_type=expense — which category',
  `description`  VARCHAR(255)  NOT NULL,
  `amount`       DECIMAL(14,2) NOT NULL,
  `tax`          DECIMAL(14,2) NOT NULL DEFAULT 0,
  `status`       ENUM('recorded','paid') NOT NULL DEFAULT 'recorded',
  `incurred_at`  DATE          NOT NULL,
  `paid_at`      DATE          NULL,
  `is_deleted`   TINYINT(1)    NOT NULL DEFAULT 0,
  `created_by`   CHAR(36)      NULL,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fin_expenses_account` (`account_id`),
  KEY `idx_fin_expenses_date`    (`incurred_at`),
  CONSTRAINT `fk_fin_expenses_account` FOREIGN KEY (`account_id`) REFERENCES `fin_accounts` (`id`),
  CONSTRAINT `fk_fin_expenses_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- fin_staff — eBizco's own payroll roster. Deliberately decoupled from `users`/
-- `platform_admins` (nullable `user_id` link only) — not every paid staff member
-- holds a platform-admin login (a bookkeeper, a casual, a contractor).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `fin_staff` (
  `id`          CHAR(36)      NOT NULL,
  `user_id`     CHAR(36)      NULL COMMENT 'optional link to a platform_admins-holding users row',
  `full_name`   VARCHAR(120)  NOT NULL,
  `role_title`  VARCHAR(80)   NULL,
  `pay_type`    ENUM('hourly','salary') NOT NULL DEFAULT 'hourly',
  `rate`        DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'per-hour rate OR annual salary, per pay_type',
  `status`      ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_fin_staff_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- fin_payroll — one pay run per staff member per period. Auto-posts to
-- fin_journal on `status='paid'` (debit Wages Expense, credit Cash/Bank).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `fin_payroll` (
  `id`             CHAR(36)      NOT NULL,
  `staff_id`       CHAR(36)      NOT NULL,
  `period_start`   DATE          NOT NULL,
  `period_end`     DATE          NOT NULL,
  `gross_amount`   DECIMAL(14,2) NOT NULL DEFAULT 0,
  `tax`            DECIMAL(14,2) NOT NULL DEFAULT 0,
  `super_amount`   DECIMAL(14,2) NOT NULL DEFAULT 0,
  `total_paid`     DECIMAL(14,2) NOT NULL DEFAULT 0,
  `status`         ENUM('draft','paid') NOT NULL DEFAULT 'draft',
  `paid_at`        DATE          NULL,
  `created_by`     CHAR(36)      NULL,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fin_payroll_staff_period` (`staff_id`, `period_start`, `period_end`),
  CONSTRAINT `fk_fin_payroll_staff`   FOREIGN KEY (`staff_id`)   REFERENCES `fin_staff` (`id`),
  CONSTRAINT `fk_fin_payroll_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- fin_payroll_items — per-shift/day hours feeding a payroll run (mirrors
-- c1ihms's payrollitem, minus its unused factor/paytype granularity for v1).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `fin_payroll_items` (
  `id`           CHAR(36)      NOT NULL,
  `payroll_id`   CHAR(36)      NOT NULL,
  `work_date`    DATE          NOT NULL,
  `hours`        DECIMAL(6,2)  NOT NULL DEFAULT 0,
  `rate_factor`  DECIMAL(4,2)  NOT NULL DEFAULT 1.00 COMMENT 'e.g. 1.5 for overtime',
  PRIMARY KEY (`id`),
  KEY `idx_fin_payroll_items_payroll` (`payroll_id`),
  CONSTRAINT `fk_fin_payroll_items_payroll` FOREIGN KEY (`payroll_id`) REFERENCES `fin_payroll` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Minimal starter chart of accounts — enough for the retrofit (subscription
-- revenue posting) and first expense/payroll entries to have somewhere to land.
-- Not exhaustive; more categories are just another row, added via the UI later.
-- ============================================================================
INSERT INTO `fin_accounts` (`id`, `parent_id`, `seq`, `acc_type`, `name`) VALUES
  ('00000000-0000-4f00-9000-000000000001', NULL, 1, 'asset',     'Cash & Bank'),
  ('00000000-0000-4f00-9000-000000000002', NULL, 2, 'liability', 'Tax Payable'),
  ('00000000-0000-4f00-9000-000000000003', NULL, 3, 'equity',    'Retained Earnings'),
  ('00000000-0000-4f00-9000-000000000004', NULL, 4, 'revenue',   'Subscription Revenue'),
  ('00000000-0000-4f00-9000-000000000005', NULL, 5, 'expense',   'Wages Expense'),
  ('00000000-0000-4f00-9000-000000000006', NULL, 6, 'expense',   'Office Expenses'),
  ('00000000-0000-4f00-9000-000000000007', '00000000-0000-4f00-9000-000000000006', 1, 'expense', 'Software & Subscriptions'),
  ('00000000-0000-4f00-9000-000000000008', '00000000-0000-4f00-9000-000000000006', 2, 'expense', 'Rent'),
  ('00000000-0000-4f00-9000-000000000009', '00000000-0000-4f00-9000-000000000006', 3, 'expense', 'Utilities'),
  ('00000000-0000-4f00-9000-00000000000a', '00000000-0000-4f00-9000-000000000006', 4, 'expense', 'Other Operating Costs')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
