-- ProjMan — migration v042: per-tenant chart of accounts (xprojman-42 §2,
-- confirmed §6/§8 response, APPROVED — Server's own review confirmed this
-- can start independently of §3's journal/posting-trigger decision, per the
-- doc's own §4 build order point 1/2).
--
-- `org_accounts` is a NEW, org-scoped parallel to `fin_accounts`
-- (migration_v031, eBizco's own single-company books, Dashboard /admin/*
-- only) — NOT an extension of it. migration_v031's own header already rules
-- out adding org_id to fin_accounts (every tenant would see every other
-- tenant's ledger); this is the real parallel build §0.1 called for. The
-- ENGINEERING PATTERN (parent/child tree, no cached balance columns, P&L/
-- Balance Sheet computed live from a journal) carries over unchanged —
-- see OrgFinanceService.js, modelled directly on FinanceService.buildAccountTree.
--
-- §3 (org_journal + the four report screens) is NOT in this migration —
-- explicitly out of scope per the doc's own build order; nothing here
-- depends on the automatic-vs-manual posting decision being finalized.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- org_accounts — per-org chart of accounts, parent/child tree. Same shape as
-- fin_accounts minus the missing org_id, per the doc's own §2 SQL. No cached
-- balance/debit/credit columns, same anti-drift stance as fin_accounts —
-- §3's future org_journal is the one source of truth once it exists.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `org_accounts` (
  `id`         CHAR(36)     NOT NULL,
  `org_id`     CHAR(36)     NOT NULL,
  `parent_id`  CHAR(36)     NULL,
  `code`       VARCHAR(20)  NOT NULL,
  `name`       VARCHAR(120) NOT NULL,
  `acc_type`   ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  `seq`        INT          NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_acct_org_code` (`org_id`, `code`),
  KEY `idx_org_accounts_parent` (`parent_id`),
  KEY `idx_org_accounts_type`   (`org_id`, `acc_type`, `is_active`),
  CONSTRAINT `fk_acct_org`    FOREIGN KEY (`org_id`)    REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_acct_parent` FOREIGN KEY (`parent_id`) REFERENCES `org_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- cost_centres.linked_account_id (xprojman-42 §4 point 2, "the actual answer
-- to should cost centres link to an account: yes"). Nullable — an existing
-- cost centre (xprojman-39 §2) is not retroactively broken by this column
-- existing; linking is optional, set through the existing money.write-gated
-- CostingService path, not a new permission (not a structural chart-of-
-- accounts edit, just tagging an existing row — see OrgFinanceService.js
-- header for the finance.manage vs money.write boundary).
-- ============================================================================
ALTER TABLE `cost_centres`
  ADD COLUMN `linked_account_id` CHAR(36) NULL AFTER `name`,
  ADD CONSTRAINT `fk_cc_account` FOREIGN KEY (`linked_account_id`) REFERENCES `org_accounts` (`id`);

-- ============================================================================
-- finance.manage — NEW permission (confirmed §6 response), narrower than
-- money.write, gates STRUCTURAL org_accounts edits only (create/rename/
-- deactivate/re-parent). Reading accounts/reports stays money.read,
-- unchanged. Granted to `projectManager` only — currently the only role
-- holding `money.write` (roles/role_permissions as of this migration,
-- verified by query, not assumed) — same portfolio-principal blast-radius
-- reasoning as `tax.approve` being narrower than `money.write` for
-- `accountant`.
-- ============================================================================
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('projectManager', 'finance.manage')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

UPDATE `access_meta` SET `v` = '13' WHERE `k` = 'matrix_version';
