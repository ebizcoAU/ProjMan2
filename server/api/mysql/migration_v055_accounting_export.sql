-- ProjMan2 — migration v055: the accounting export (xprojman-43 R4, §13.4; package order §14 O4).
--
-- ProjMan keeps the construction money records and EXPORTS them to the builder's accounting
-- package (Xero first, then MYOB, then QuickBooks). It posts no ledger of its own.
--
--   cost_centres.export_account_code   the builder's OWN account code for this cost centre (from
--                                      their package); feeds account_code on bills/POs/payments.
--   accounting_export_settings         per org: default sales/bills account codes, the per-direction
--                                      gst_code_map { sales: {...}, bills: {...} }, and the Xero
--                                      tracking category name (blank = no tracking columns filled).
--   accounting_exports                 one row per export run (the audit trail + checksum).
--   exported_at / exported_by / export_id
--                                      the double-post guard on every exportable source row.
--                                      client_claims has them since v053; void_exported_at records
--                                      the credit-note row for a voided, already-exported claim.

ALTER TABLE `cost_centres`
  ADD COLUMN `export_account_code` VARCHAR(20) NULL COMMENT 'x43 13.4: the account code in the builder''s package' AFTER `linked_account_id`;

CREATE TABLE IF NOT EXISTS `accounting_export_settings` (
  `org_id`                  CHAR(36)     NOT NULL,
  `sales_account_code`      VARCHAR(20)  NULL,
  `bills_account_code`      VARCHAR(20)  NULL,
  `gst_code_map`            JSON         NULL COMMENT '{ sales: { gst, gst_free, input_taxed, out_of_scope }, bills: { same keys } }',
  `xero_tracking_category`  VARCHAR(60)  NULL COMMENT 'must already exist in Xero; NULL = tracking columns left blank',
  `updated_by`              CHAR(36)     NULL,
  `updated_at`              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`org_id`),
  CONSTRAINT `fk_aes_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounting_exports` (
  `id`          CHAR(36)     NOT NULL,
  `org_id`      CHAR(36)     NOT NULL,
  `kind`        ENUM('sales','bills','purchase_orders','contractor_payments') NOT NULL,
  `format`      VARCHAR(20)  NOT NULL,
  `filters`     JSON         NULL,
  `row_count`   INT          NOT NULL DEFAULT 0,
  `sha256`      CHAR(64)     NOT NULL,
  `includes_exported` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = a full re-export (only_new=0) that repeated rows',
  `created_by`  CHAR(36)     NULL,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_aex_org` (`org_id`, `created_at`),
  CONSTRAINT `fk_aex_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `client_claims`
  ADD COLUMN `void_exported_at` DATETIME NULL COMMENT 'the credit-note row for this void was exported' AFTER `export_id`;

ALTER TABLE `progress_claims`
  ADD COLUMN `exported_at` DATETIME NULL COMMENT 'R4 accounting export (bills)',
  ADD COLUMN `exported_by` CHAR(36) NULL,
  ADD COLUMN `export_id` CHAR(36) NULL;

ALTER TABLE `supplier_invoices`
  ADD COLUMN `exported_at` DATETIME NULL COMMENT 'R4 accounting export (bills)',
  ADD COLUMN `exported_by` CHAR(36) NULL,
  ADD COLUMN `export_id` CHAR(36) NULL;

ALTER TABLE `purchase_orders`
  ADD COLUMN `exported_at` DATETIME NULL COMMENT 'R4 accounting export (purchase_orders)',
  ADD COLUMN `exported_by` CHAR(36) NULL,
  ADD COLUMN `export_id` CHAR(36) NULL;

ALTER TABLE `project_payments`
  ADD COLUMN `exported_at` DATETIME NULL COMMENT 'R4 accounting export (contractor_payments)',
  ADD COLUMN `exported_by` CHAR(36) NULL,
  ADD COLUMN `export_id` CHAR(36) NULL;
