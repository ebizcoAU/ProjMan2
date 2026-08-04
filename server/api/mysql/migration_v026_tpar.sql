-- ProjMan — migration v026: P8c TPAR (serverdesignspec §11.2, decisions #6/#14).
--
-- The Taxable Payments Annual Report — the ATO return a building & construction business lodges
-- each financial year listing what it paid contractors. It is the LAST P8 slice because it needs
-- no new capture at all: the payment spine (`project_payments`, v013) already carries
-- `tpar_reportable` and `payee_user_id`, and v023 added `gst_amount` to it. This migration only
-- adds the report/snapshot tables.
--
-- NO MATRIX BUMP: reads are `accounts.read` (v023) and the lodgement lock is `tax.approve` (v012,
-- extended to every tax artifact by decision #14). Matrix stays v12.
--
-- WHY A SNAPSHOT RATHER THAN A VIEW: same reasoning as `tax_periods`. A lodged TPAR must keep
-- reporting the figures that were actually lodged, and payee ABNs/names drift as organisations
-- edit their profiles. `tpar_lines` freezes what was reported, with `source_payment_ids` carrying
-- provenance back to the rows it came from.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- tpar_reports — one per org per financial year.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `tpar_reports` (
  `id`            CHAR(36)      NOT NULL,
  `org_id`        CHAR(36)      NOT NULL,
  `fy`            CHAR(7)       NOT NULL COMMENT 'AU financial year, e.g. 2025-26 (1 Jul – 30 Jun)',
  `total_gross`   DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'cached roll-up, written at prepare',
  `total_gst`     DECIMAL(14,2) NOT NULL DEFAULT 0,
  `payee_count`   INT           NOT NULL DEFAULT 0,
  `status`        ENUM('open','prepared','lodged') NOT NULL DEFAULT 'open',
  `prepared_by`   CHAR(36)      NULL,
  `prepared_at`   DATETIME      NULL,
  `lodged_by`     CHAR(36)      NULL COMMENT 'users.id of the tax.approve holder who locked it',
  `lodged_at`     DATETIME      NULL,
  `is_deleted`    TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tpar_org_fy` (`org_id`, `fy`),
  KEY `idx_tpar_org_status` (`org_id`, `status`),
  CONSTRAINT `fk_tpar_org`      FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_tpar_preparer` FOREIGN KEY (`prepared_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_tpar_lodger`   FOREIGN KEY (`lodged_by`)   REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- tpar_lines — one per payee per report, snapshotted at prepare.
--
-- `payee_abn`/`payee_name` are COPIES, not joins: the ATO return records who was paid as at
-- lodgement, and a later profile edit must not retroactively rewrite a lodged report.
-- `source_payment_ids` is the audit trail back to `project_payments`.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `tpar_lines` (
  `id`                CHAR(36)      NOT NULL,
  `org_id`            CHAR(36)      NOT NULL,
  `tpar_report_id`    CHAR(36)      NOT NULL,
  `payee_user_id`     CHAR(36)      NULL,
  `payee_abn`         VARCHAR(11)   NULL COMMENT 'SNAPSHOT of the payee org ABN at prepare time',
  `payee_name`        VARCHAR(200)  NULL COMMENT 'SNAPSHOT of the payee name at prepare time',
  `gross_paid`        DECIMAL(14,2) NOT NULL DEFAULT 0,
  `gst_paid`          DECIMAL(14,2) NOT NULL DEFAULT 0,
  `payment_count`     INT           NOT NULL DEFAULT 0,
  `source_payment_ids` JSON         NULL COMMENT 'provenance back to project_payments.id',
  `created_at`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tparline_report_payee` (`tpar_report_id`, `payee_user_id`),
  KEY `idx_tparline_org` (`org_id`),
  CONSTRAINT `fk_tparline_org`    FOREIGN KEY (`org_id`)         REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_tparline_report` FOREIGN KEY (`tpar_report_id`) REFERENCES `tpar_reports` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tparline_payee`  FOREIGN KEY (`payee_user_id`)  REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No role_permissions insert and NO matrix bump: reads use `accounts.read` (v023), the lodgement
-- lock uses `tax.approve` (v012, decision #14). matrix_version stays 12.
