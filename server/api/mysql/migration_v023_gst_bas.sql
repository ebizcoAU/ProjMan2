-- ProjMan — migration v023: P8b GST & BAS (serverdesignspec §11.2, decisions #12/#13/#15).
--
-- The second P8 slice. Three parts, all additive:
--   1. GST classification on every amount-bearing commercial row (P7a/P7b/v013 spine).
--   2. `tax_periods` — one row per org per BAS quarter, carrying the cached G1/1A/1B/net roll-up.
--   3. The new `accounts.read` permission → matrix v9 → v10.
--
-- DECISION #12 (ruled 2026-08-01): the existing `amount` columns are **NOT re-interpreted**.
-- Nothing that P7 already wrote changes meaning. `gst_amount` is ADDITIVE, which fixes the
-- convention as: `amount` = the GST-EXCLUSIVE base, `gst_amount` = the GST sitting on top, and
-- the GST-inclusive gross (what BAS G1 wants) = `amount + gst_amount`. Existing rows get
-- gst_amount = 0, i.e. they read as "no GST computed yet" rather than silently claiming to be
-- GST-free — TaxService classifies them at prepare time.
--
-- DECISION #15: BAS basis defaults to `accrual`, with a per-period `basis` column so an org can
-- elect cash later without a schema change.
--
-- REST-mediated (not sync-registry), like the rest of P8: office/desk artifacts.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- 1. GST classification on the commercial money rows.
--
-- `gst_treatment` defaults to 'gst' (the ordinary case for a construction supply); the
-- classifier only ATTRIBUTES GST where the org is actually gst_registered
-- (organisations.gst_registered, v002) — an unregistered sole trader charges none.
--
-- NOTE ON PRECISION: §11.2 sketched DECIMAL(12,2). The actual `amount` columns on
-- estimate_lines / progress_claims / supplier_invoices are DECIMAL(14,2) (v017, v019), so
-- gst_amount MATCHES ITS OWN TABLE rather than the spec's literal 12,2 — a narrower GST column
-- than its base amount would be an overflow waiting to happen. project_payments.amount is
-- DECIMAL(12,2) (v013), so its gst_amount is 12,2. Spec §11.2 corrected to match.
-- ============================================================================
ALTER TABLE `progress_claims`
  ADD COLUMN `gst_treatment` ENUM('gst','gst_free','input_taxed','out_of_scope')
    NOT NULL DEFAULT 'gst' AFTER `amount`,
  ADD COLUMN `gst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
    COMMENT 'ADDITIVE — GST on top of `amount`; gross = amount + gst_amount' AFTER `gst_treatment`;

ALTER TABLE `supplier_invoices`
  ADD COLUMN `gst_treatment` ENUM('gst','gst_free','input_taxed','out_of_scope')
    NOT NULL DEFAULT 'gst' AFTER `amount`,
  ADD COLUMN `gst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
    COMMENT 'ADDITIVE — GST on top of `amount`; gross = amount + gst_amount' AFTER `gst_treatment`;

ALTER TABLE `estimate_lines`
  ADD COLUMN `gst_treatment` ENUM('gst','gst_free','input_taxed','out_of_scope')
    NOT NULL DEFAULT 'gst' AFTER `amount`,
  ADD COLUMN `gst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0
    COMMENT 'ADDITIVE — GST on top of `amount`; gross = amount + gst_amount' AFTER `gst_treatment`;

ALTER TABLE `project_payments`
  ADD COLUMN `gst_treatment` ENUM('gst','gst_free','input_taxed','out_of_scope')
    NOT NULL DEFAULT 'gst' AFTER `amount`,
  ADD COLUMN `gst_amount` DECIMAL(12,2) NOT NULL DEFAULT 0
    COMMENT 'ADDITIVE — GST on top of `amount`; gross = amount + gst_amount' AFTER `gst_treatment`;

-- ============================================================================
-- 2. tax_periods — one row per org per BAS quarter (AU FY = 1 Jul–30 Jun).
--
-- The G1/1A/1B/net figures are a CACHED roll-up written at prepare time, not a live view: a
-- lodged BAS must keep reporting what was actually lodged even as later rows are edited. That
-- is the whole reason the summary is stored rather than computed on read.
--
-- `status` open → prepared → lodged. The lock to `lodged` is the `tax.approve` write
-- (decision #14: the accountant is the single tax gatekeeper for every tax artifact — no
-- separate `tax.lodge` verb), stamped by lodged_by/lodged_at exactly like fixed_assets.
-- (`lodged_by` is an addition to the §11.2 sketch, for symmetry with the P8a approval stamp —
-- "who lodged this" is the same evidentiary question as "who approved this".)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `tax_periods` (
  `id`                  CHAR(36)      NOT NULL,
  `org_id`              CHAR(36)      NOT NULL,
  `period_start`        DATE          NOT NULL COMMENT 'BAS quarter start (1 Jul / 1 Oct / 1 Jan / 1 Apr)',
  `period_end`          DATE          NOT NULL,
  `basis`               ENUM('accrual','cash') NOT NULL DEFAULT 'accrual'
                          COMMENT 'decision #15 — accrual default, per-period so cash can be elected later',
  `g1_total_sales`      DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'G1 — GST-inclusive total sales',
  `a1_gst_on_sales`     DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '1A — GST collected',
  `b1_gst_on_purchases` DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '1B — GST credits claimable',
  `net_gst`             DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT '1A − 1B (positive = payable)',
  `status`              ENUM('open','prepared','lodged') NOT NULL DEFAULT 'open',
  `prepared_by`         CHAR(36)      NULL,
  `prepared_at`         DATETIME      NULL,
  `lodged_by`           CHAR(36)      NULL COMMENT 'users.id of the tax.approve holder who locked it',
  `lodged_at`           DATETIME      NULL,
  `is_deleted`          TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_taxperiod_org_start` (`org_id`, `period_start`),
  KEY `idx_taxperiod_org_status` (`org_id`, `status`),
  CONSTRAINT `fk_taxperiod_org`      FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_taxperiod_preparer` FOREIGN KEY (`prepared_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_taxperiod_lodger`   FOREIGN KEY (`lodged_by`)   REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. accounts.read (decision #13) — the org-level view/export of BAS/TPAR/depreciation
-- artifacts. Deliberately NOT money.read: these are whole-of-entity aggregates, and money.read
-- is project-scoped (§9.4 resource scope) — the wrong shape for a BAS.
--
-- ⚠ SPEC CORRECTION: §11.3 said "grant to org_admin + accountant". **There is no `org_admin`
-- role** in this system — the 9 roles are projectManager/siteSupervisor/foreperson/tradie/
-- inspector/client/builder/developer/accountant, and tenant-OWNER authority is the
-- `users.is_org_owner` flag conferring OWNER_CAPABILITIES (org.manage/users.manage/
-- devices.manage), decoupled from the fixed role by v018/xprojman-08. So the grant lands on
-- **projectManager** (the tenant-owner role in practice, and already the money.read holder),
-- plus accountant and developer per the decision.
--
-- ⚠ OPEN — raised to owner as decision #18, NOT decided here: a self-registered BUILDER founder
-- owns their org but holds the `builder` role, which does NOT get accounts.read below — so they
-- could not see their own org's BAS. The fix is NOT granting `builder` the permission (that
-- would leak accounts.read into every org they are merely ENGAGED into — precisely the
-- xprojman-08 trap OWNER_CAPABILITIES exists to prevent); it is adding `accounts.read` to
-- OWNER_CAPABILITIES in lib/access.js, a code change with its own blast radius. Left for the
-- owner's ruling rather than smuggled into a migration.
-- ============================================================================
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('projectManager', 'accounts.read'),
  ('accountant',     'accounts.read'),
  ('developer',      'accounts.read')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

-- Matrix changed (a new permission with real enforcement points in P8b) → bump so clients
-- cache-bust GET /auth/permissions. v9 → v10.
UPDATE `access_meta` SET `v` = '10' WHERE `k` = 'matrix_version';
