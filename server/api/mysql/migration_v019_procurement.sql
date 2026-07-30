-- ProjMan — migration v019: P7b Procurement (committed → actual).
-- Per xprojman-10 §4 (P7b) AS CORRECTED by xprojman-16 (owner-approved 2026-07-30).
--
-- ⚠ CORRECTION to the directive: xprojman-10 §2 claimed procurement money reads could
-- just "reuse redactStage — no new redaction engine." That is WRONG for procurement.
-- serverdesignspecification.md §7.2.1 states the independent_fixed redaction "extends to
-- the supplier/subcontractor register in full" — i.e. a PO / supplier-invoice ROW is the
-- Builder's private cost breakdown and must be invisible to the PM under a fixed-price
-- engagement, not merely have columns blanked. redactStage only blanks 5 aggregate columns
-- on the stage row; it cannot hide document rows. So P7b needs (a) an OWNER dimension on
-- every PO/invoice and (b) genuinely new row-level visibility (PurchaseOrderService
-- .procurementVisibility). This migration adds the owner columns; the filter lives in code.
--
-- Roll-up ownership (xprojman-16 §4): committed_amount / actual_amount on a stage aggregate
-- ALL of that stage's POs / invoices (the true total). DOCUMENT-level visibility is the
-- owner×mode filter; STAGE-column visibility stays the existing §7.2.1 redactStage (in
-- independent_fixed the PM has no claim on cost roll-ups — they pay the fixed head price;
-- they still see their OWN po rows and can total those). No per-owner stage columns.
--
-- TPAR (xprojman-16 §5): a supplier invoice is paid to a MATERIALS/goods supplier, which is
-- generally NOT TPAR-reportable (TPAR covers contractor services). project_payments.payee_
-- user_id is also NOT NULL (a supplier is not a user). So supplier_invoices do NOT write a
-- project_payments row — the invoice row itself is the actual-cost record. Contractor
-- payments (progress claims, S9.9 deposits) stay the only project_payments writers.
--
-- REST-mediated, NOT sync-registry tables (same reasoning as job_awards v013 / P7a v017):
-- the raise→receive PO and received→matched→approved invoice flows are workflow transitions.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- suppliers — org-level vendor master (materials + services suppliers, and the
-- subcontractor's trading entity). Org-shared, NOT engagement-redacted: a vendor NAME is
-- not sensitive; what §7.2.1 protects is WHICH supplier the Builder used for WHAT amount on
-- this job — that lives on the PO/invoice rows below, which ARE redacted. Turns the
-- free-text deliveries.supplier_name into an optional real reference (soft — see below).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `suppliers` (
  `id`         CHAR(36)     NOT NULL,
  `org_id`     CHAR(36)     NOT NULL,
  `name`       VARCHAR(200) NOT NULL,
  `abn`        VARCHAR(20)  NULL,
  `contact`    VARCHAR(200) NULL,
  `email`      VARCHAR(255) NULL,
  `phone`      VARCHAR(40)  NULL,
  `is_deleted` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_by` CHAR(36)     NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_supplier_org` (`org_id`, `is_deleted`),
  CONSTRAINT `fk_supplier_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- purchase_orders — a commitment to a supplier (→ project_stages.committed_amount).
-- `owner_party` + `raised_by_user_id` are the visibility keys (see the header): a
-- builder-owned PO is hidden from the PM under independent_fixed. `amount` is stored
-- (server-set) so the roll-up is a plain SUM. committed = status IN ('issued','received').
-- `subcontractor_engagement_id` (nullable) links a PO to a subcontractor engagement so the
-- §7.2.1 pass-through-consent gate can redact the counterparty on cost-plus reads.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `purchase_orders` (
  `id`             CHAR(36)      NOT NULL,
  `org_id`         CHAR(36)      NOT NULL,
  `project_id`     CHAR(36)      NOT NULL,
  `stage_id`       CHAR(36)      NULL COMMENT 'NULL = project-level PO (no stage roll-up)',
  `supplier_id`    CHAR(36)      NULL COMMENT 'soft ref to suppliers.id; may be NULL with free-text supplier_name',
  `supplier_name`  VARCHAR(200)  NULL COMMENT 'denormalised/free-text fallback when supplier_id is NULL',
  `po_number`      INT           NOT NULL DEFAULT 1 COMMENT 'sequential per project',
  `description`    VARCHAR(300)  NULL,
  `amount`         DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'committed total (server-set)',
  `status`         ENUM('draft','issued','received','cancelled') NOT NULL DEFAULT 'draft',
  `owner_party`    ENUM('pm','builder') NOT NULL COMMENT 'whose ledger — derived from raiser at create; the §7.2.1 visibility key',
  `raised_by_user_id` CHAR(36)   NOT NULL,
  `subcontractor_engagement_id` CHAR(36) NULL COMMENT 'if this PO is to a subcontractor — gates line attribution via pass-through consent',
  `is_deleted`     TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_po_project` (`project_id`, `status`),
  KEY `idx_po_stage`   (`stage_id`),
  KEY `idx_po_owner`   (`project_id`, `owner_party`),
  CONSTRAINT `fk_po_org`      FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_po_project`  FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_po_stage`    FOREIGN KEY (`stage_id`)   REFERENCES `project_stages` (`id`),
  CONSTRAINT `fk_po_raiser`   FOREIGN KEY (`raised_by_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- supplier_invoices — the actual cost incurred (→ project_stages.actual_amount).
-- 2-way match to a PO (po_id) v1; 3-way (+delivery) deferred (xprojman-10 §7 #3). Same
-- owner_party/raised_by visibility keys as POs. actual = status IN ('matched','approved').
-- Does NOT write project_payments (see header — supplier payments aren't TPAR contractor
-- payments and payee_user_id can't hold a supplier). Roll-up uses the invoice's own
-- stage_id (defaulted from the matched PO's stage at create when a PO is given).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `supplier_invoices` (
  `id`             CHAR(36)      NOT NULL,
  `org_id`         CHAR(36)      NOT NULL,
  `project_id`     CHAR(36)      NOT NULL,
  `stage_id`       CHAR(36)      NULL,
  `po_id`          CHAR(36)      NULL COMMENT '2-way match target; NULL = direct invoice (no PO)',
  `supplier_id`    CHAR(36)      NULL,
  `supplier_name`  VARCHAR(200)  NULL,
  `invoice_number` VARCHAR(60)   NOT NULL,
  `amount`         DECIMAL(14,2) NOT NULL DEFAULT 0,
  `status`         ENUM('received','matched','approved','disputed') NOT NULL DEFAULT 'received',
  `owner_party`    ENUM('pm','builder') NOT NULL,
  `raised_by_user_id` CHAR(36)   NOT NULL,
  `subcontractor_engagement_id` CHAR(36) NULL,
  `is_deleted`     TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inv_project` (`project_id`, `status`),
  KEY `idx_inv_stage`   (`stage_id`),
  KEY `idx_inv_po`      (`po_id`),
  CONSTRAINT `fk_inv_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_inv_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_inv_stage`   FOREIGN KEY (`stage_id`)   REFERENCES `project_stages` (`id`),
  CONSTRAINT `fk_inv_po`      FOREIGN KEY (`po_id`)      REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `fk_inv_raiser`  FOREIGN KEY (`raised_by_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- deliveries.supplier_id / po_id already exist (v008, nullable). They stay SOFT references
-- (no hard FK) so legacy free-text delivery rows remain valid — the service validates
-- supplier_id / po_id are in-org when supplied. Nothing to alter here; documented for the
-- reader that P7b is what gives those columns real targets.

-- ============================================================================
-- Permission (§7.2 / xprojman-10 §2). po.write is new — not previously in the matrix.
-- Held by projectManager (their own procurement) and builder (own-scope procurement,
-- enforced in code). matrix_version 6 → 7.
-- ============================================================================
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('projectManager', 'po.write'),
  ('builder',        'po.write')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

UPDATE `access_meta` SET `v` = '7' WHERE `k` = 'matrix_version';
