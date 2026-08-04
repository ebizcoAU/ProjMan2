-- ProjMan — migration v022: P8a Fixed assets & depreciation (serverdesignspec §11.2,
-- owner-authorised 2026-08-01; decisions #6/#12–#16 ruled in §11.4).
--
-- The first slice of P8 Accounting/Tax. It is the natural first slice because its permission
-- gate ALREADY exists: `tax.approve` (v012) and the `S18.12` blocks_progress hold point (v016)
-- were built by the corrective migration and have had no module to point at until now.
--
--   S18.11 = system prepares the depreciation DRAFT   → fixed_assets(status='draft') + schedule
--   S18.12 = the accountant's `tax.approve` write      → fixed_assets(status='approved') + stamp
--
-- No external transmission happens at draft; only an approved asset is eligible for the
-- depreciation export / accountant hand-off (export-first, decision #6 = (B)+(b1)). REST-mediated
-- workflow tables (like P7a/P7b/P7c), NOT sync-registry — these are office/desk artifacts, not
-- device-synced. NO matrix bump: `tax.approve` is reused verbatim (§11.3).

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- fixed_assets — one row per depreciable asset. `project_id` is set when the asset arises
-- from a job's Stage 18 close-out (S18.11); NULL for a plain org-level asset. `method` +
-- `effective_life_years` are the ATO depreciation inputs. `source_supplier_invoice_id` is a
-- SOFT provenance link back to the P7b supplier invoice the asset was bought on (no hard FK —
-- optional, informational, mirrors the soft supplier/po refs in v019). `status` is the
-- S18.11→S18.12 gate: a draft is system-prepared and never transmitted; approval is the
-- `tax.approve` write and stamps who/when.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `fixed_assets` (
  `id`                        CHAR(36)      NOT NULL,
  `org_id`                    CHAR(36)      NOT NULL,
  `project_id`                CHAR(36)      NULL COMMENT 'set when the asset arises from a job (S18.11); NULL = org-level asset',
  `description`               VARCHAR(200)  NOT NULL,
  `category`                  VARCHAR(60)   NULL COMMENT 'ATO asset class (plant/equipment/…)',
  `acquisition_cost`          DECIMAL(12,2) NOT NULL DEFAULT 0,
  `acquired_at`               DATE          NULL,
  `method`                    ENUM('prime_cost','diminishing_value') NOT NULL DEFAULT 'prime_cost',
  `effective_life_years`      DECIMAL(5,2)  NULL COMMENT 'ATO effective life; drives the schedule',
  `source_supplier_invoice_id` CHAR(36)     NULL COMMENT 'SOFT ref to supplier_invoices.id (provenance; no hard FK)',
  `status`                    ENUM('draft','approved') NOT NULL DEFAULT 'draft' COMMENT 'S18.11 writes draft; S18.12 tax.approve → approved',
  `approved_by`               CHAR(36)      NULL COMMENT 'users.id of the tax.approve holder (accountant)',
  `approved_at`               DATETIME      NULL,
  `created_by`                CHAR(36)      NULL,
  `is_deleted`                TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fa_org_status`   (`org_id`, `status`),
  KEY `idx_fa_project`      (`project_id`),
  KEY `idx_fa_src_invoice`  (`source_supplier_invoice_id`),
  CONSTRAINT `fk_fa_org`      FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_fa_project`  FOREIGN KEY (`project_id`)  REFERENCES `projects` (`id`),
  CONSTRAINT `fk_fa_approver` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- depreciation_schedule — the system-prepared per-financial-year lines that ARE the content
-- of the S18.11 draft. One row per (asset, FY). Regeneration is an upsert on the unique
-- (fixed_asset_id, fy) key, so re-preparing a draft replaces its lines cleanly rather than
-- duplicating them. `fy` is the AU financial year label, e.g. '2025-26' (1 Jul–30 Jun).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `depreciation_schedule` (
  `id`             CHAR(36)      NOT NULL,
  `org_id`         CHAR(36)      NOT NULL,
  `fixed_asset_id` CHAR(36)      NOT NULL,
  `fy`             CHAR(7)       NOT NULL COMMENT 'AU financial year, e.g. 2025-26',
  `opening_value`  DECIMAL(12,2) NOT NULL DEFAULT 0,
  `depreciation`   DECIMAL(12,2) NOT NULL DEFAULT 0,
  `closing_value`  DECIMAL(12,2) NOT NULL DEFAULT 0,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dep_asset_fy` (`fixed_asset_id`, `fy`),
  KEY `idx_dep_org` (`org_id`),
  CONSTRAINT `fk_dep_org`   FOREIGN KEY (`org_id`)         REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_dep_asset` FOREIGN KEY (`fixed_asset_id`) REFERENCES `fixed_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No role_permissions insert and NO matrix bump: the S18.12 approval reuses the existing
-- `tax.approve` (accountant, v012). matrix_version stays 9.
