-- ProjMan2 — migration v054: Security of Payment templates, RCTI agreements and retention
-- (xprojman-43 R3: §13.3, §13.3a, §13.1 retention; rulings §14 O2 and O5).
--
-- Everything legal here is DATA and UNVERIFIED until the solicitor review (§14 O2, devroadmap §13
-- L10/L23): a row with verified_at NULL is shown with a warning and never enforced.
--
--   projects.client_is_owner_occupier  default 1. The SOP Acts exclude owner-occupier contracts,
--                                      so a client claim may carry an SOP template only when 0.
--   sop_templates                      per state: the fields an SOP claim must carry + the statement
--                                      rendered onto it. Seeded NSW, QLD, ACT (unverified).
--   sop_periods                        per state: payment-schedule and payment due periods.
--                                      Seeded NSW, QLD, ACT (unverified): dates are computed and
--                                      shown with SOP_PERIOD_UNVERIFIED, nothing is enforced.
--   progress_claims / client_claims    opt-in SOP fields (sop_state NULL = not an SOP claim), the
--                                      respondent's payment schedule, contract_id + retention_withheld.
--   rcti_agreements                    the written RCTI agreement per counterparty: a supplier
--                                      (supplier_invoices) or a claimant user (progress_claims).
--   rcti_issued                        on supplier_invoices and progress_claims; set only while a
--                                      current agreement exists (RCTI_NO_AGREEMENT).
--   retention_releases                 retention paid back in parts against a contract
--                                      (typically 50% at practical completion, the rest at DLP end).

ALTER TABLE `projects`
  ADD COLUMN `client_is_owner_occupier` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT 'x43 13.3: 1 = the client lives in it (SOP excluded); 0 = developer/investor client' AFTER `site_state`;

CREATE TABLE IF NOT EXISTS `sop_templates` (
  `state`            VARCHAR(3)    NOT NULL,
  `act_name`         VARCHAR(160)  NOT NULL,
  `required_fields`  JSON          NOT NULL COMMENT 'claim fields that must be present: work_description, amount, reference_date, supporting_statement',
  `statement_text`   TEXT          NOT NULL COMMENT 'rendered onto the claim; placeholders {amount} {reference_date}',
  `source`           VARCHAR(255)  NOT NULL,
  `verified_at`      DATETIME      NULL COMMENT 'NULL = not legally reviewed: warn only',
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sop_periods` (
  `state`          VARCHAR(3)    NOT NULL,
  `schedule_days`  SMALLINT      NOT NULL COMMENT 'claim served → payment schedule due',
  `payment_days`   SMALLINT      NOT NULL COMMENT 'claim served → payment due (absent an earlier contract date)',
  `business_days`  TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '1 = skip Sat/Sun (public holidays are NOT skipped yet)',
  `source`         VARCHAR(255)  NOT NULL,
  `verified_at`    DATETIME      NULL COMMENT 'NULL = not legally reviewed: SOP_PERIOD_UNVERIFIED',
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`state`),
  CONSTRAINT `fk_sopp_template` FOREIGN KEY (`state`) REFERENCES `sop_templates` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `sop_templates` (`state`, `act_name`, `required_fields`, `statement_text`, `source`) VALUES
  ('NSW', 'Building and Construction Industry Security of Payment Act 1999 (NSW)',
   JSON_ARRAY('work_description', 'amount', 'reference_date', 'supporting_statement'),
   'This is a payment claim made under the Building and Construction Industry Security of Payment Act 1999 (NSW).',
   's13(2) claim content; s13(7) head contractor supporting statement. Law-firm commentary via xprojman-55 §4.1 — NOT legally reviewed'),
  ('QLD', 'Building Industry Fairness (Security of Payment) Act 2017 (Qld)',
   JSON_ARRAY('work_description', 'amount', 'reference_date'),
   'The claimant requests payment of the claimed amount of {amount}.',
   's68(1): identify the work, state the amount, request payment (MWB Everton Park v Devcon [2024] QCA 94). Via xprojman-55 §4.1 — NOT legally reviewed'),
  ('ACT', 'Building and Construction Industry (Security of Payment) Act 2009 (ACT)',
   JSON_ARRAY('work_description', 'amount', 'reference_date'),
   'This is a payment claim made under the Building and Construction Industry (Security of Payment) Act 2009 (ACT).',
   's15 claim content. Via xprojman-55 §4.1 — NOT legally reviewed');

INSERT IGNORE INTO `sop_periods` (`state`, `schedule_days`, `payment_days`, `business_days`, `source`) VALUES
  ('NSW', 10, 15, 1, 's14(4) schedule 10 business days; s11(1)(a) head contractor → principal 15 business days — NOT legally reviewed'),
  ('QLD', 15, 10, 1, 's76 schedule 15 business days; s73(2) payment 10 business days where the contract is silent — NOT legally reviewed'),
  ('ACT', 10, 10, 1, 's16 schedule 10 business days; s17 payment 10 business days — NOT legally reviewed');

-- ── RCTI agreements ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `rcti_agreements` (
  `id`             CHAR(36)      NOT NULL,
  `org_id`         CHAR(36)      NOT NULL COMMENT 'the RECIPIENT, which issues the RCTIs',
  `supplier_id`    CHAR(36)      NULL COMMENT 'counterparty for supplier_invoices',
  `party_user_id`  CHAR(36)      NULL COMMENT 'counterparty for progress_claims (the claimant)',
  `agreed_at`      DATE          NOT NULL,
  `ends_at`        DATE          NULL COMMENT 'NULL = open-ended',
  `document_id`    CHAR(36)      NULL COMMENT 'the signed written agreement',
  `note`           VARCHAR(300)  NULL,
  `revoked_at`     DATETIME      NULL,
  `revoked_by`     CHAR(36)      NULL,
  `created_by`     CHAR(36)      NULL,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rcti_supplier` (`org_id`, `supplier_id`),
  KEY `idx_rcti_party` (`org_id`, `party_user_id`),
  CONSTRAINT `fk_rcti_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_rcti_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`),
  CONSTRAINT `fk_rcti_party` FOREIGN KEY (`party_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_rcti_document` FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`),
  CONSTRAINT `chk_rcti_one_party` CHECK ((`supplier_id` IS NULL) <> (`party_user_id` IS NULL)),
  CONSTRAINT `chk_rcti_dates` CHECK (`ends_at` IS NULL OR `ends_at` >= `agreed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `supplier_invoices`
  ADD COLUMN `rcti_issued` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'x43 13.3a: this org issues the tax invoice' AFTER `gst_amount`,
  ADD COLUMN `rcti_agreement_id` CHAR(36) NULL AFTER `rcti_issued`,
  ADD CONSTRAINT `fk_si_rcti` FOREIGN KEY (`rcti_agreement_id`) REFERENCES `rcti_agreements` (`id`);

-- ── Claim columns: SOP + RCTI + retention ───────────────────────────────────────

ALTER TABLE `progress_claims`
  ADD COLUMN `work_description` VARCHAR(1000) NULL COMMENT 'SOP: the work the claim relates to' AFTER `note`,
  ADD COLUMN `sop_state` VARCHAR(3) NULL COMMENT 'NULL = not an SOP claim' AFTER `work_description`,
  ADD COLUMN `reference_date` DATE NULL AFTER `sop_state`,
  ADD COLUMN `supporting_statement_document_id` CHAR(36) NULL COMMENT 'NSW s13(7)' AFTER `reference_date`,
  ADD COLUMN `sop_statement` TEXT NULL COMMENT 'rendered from sop_templates at submit' AFTER `supporting_statement_document_id`,
  ADD COLUMN `schedule_due_at` DATETIME NULL AFTER `sop_statement`,
  ADD COLUMN `payment_due_at` DATETIME NULL AFTER `schedule_due_at`,
  ADD COLUMN `scheduled_amount` DECIMAL(14,2) NULL COMMENT 'the respondent''s payment schedule' AFTER `payment_due_at`,
  ADD COLUMN `schedule_reason` VARCHAR(500) NULL AFTER `scheduled_amount`,
  ADD COLUMN `scheduled_at` DATETIME NULL AFTER `schedule_reason`,
  ADD COLUMN `scheduled_by` CHAR(36) NULL AFTER `scheduled_at`,
  ADD COLUMN `rcti_issued` TINYINT(1) NOT NULL DEFAULT 0 AFTER `scheduled_by`,
  ADD COLUMN `rcti_agreement_id` CHAR(36) NULL AFTER `rcti_issued`,
  ADD COLUMN `contract_id` CHAR(36) NULL COMMENT 'retention source' AFTER `rcti_agreement_id`,
  ADD COLUMN `retention_withheld` DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'ex GST, held back from the payment' AFTER `contract_id`,
  ADD CONSTRAINT `fk_pcl_sop_state` FOREIGN KEY (`sop_state`) REFERENCES `sop_templates` (`state`),
  ADD CONSTRAINT `fk_pcl_supporting_doc` FOREIGN KEY (`supporting_statement_document_id`) REFERENCES `documents` (`id`),
  ADD CONSTRAINT `fk_pcl_rcti` FOREIGN KEY (`rcti_agreement_id`) REFERENCES `rcti_agreements` (`id`),
  ADD CONSTRAINT `fk_pcl_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`),
  ADD CONSTRAINT `chk_pcl_retention` CHECK (`retention_withheld` >= 0 AND `retention_withheld` <= `amount`);

ALTER TABLE `client_claims`
  ADD COLUMN `work_description` VARCHAR(1000) NULL AFTER `variation_note`,
  ADD COLUMN `sop_state` VARCHAR(3) NULL COMMENT 'only when projects.client_is_owner_occupier = 0' AFTER `work_description`,
  ADD COLUMN `reference_date` DATE NULL AFTER `sop_state`,
  ADD COLUMN `supporting_statement_document_id` CHAR(36) NULL AFTER `reference_date`,
  ADD COLUMN `sop_statement` TEXT NULL AFTER `supporting_statement_document_id`,
  ADD COLUMN `schedule_due_at` DATETIME NULL AFTER `sop_statement`,
  ADD COLUMN `payment_due_at` DATETIME NULL AFTER `schedule_due_at`,
  ADD COLUMN `contract_id` CHAR(36) NULL AFTER `payment_due_at`,
  ADD COLUMN `retention_withheld` DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'ex GST' AFTER `contract_id`,
  ADD CONSTRAINT `fk_clc_sop_state` FOREIGN KEY (`sop_state`) REFERENCES `sop_templates` (`state`),
  ADD CONSTRAINT `fk_clc_supporting_doc` FOREIGN KEY (`supporting_statement_document_id`) REFERENCES `documents` (`id`),
  ADD CONSTRAINT `fk_clc_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`),
  ADD CONSTRAINT `chk_clc_retention` CHECK (`retention_withheld` >= 0 AND `retention_withheld` <= `amount_ex_gst`);

-- ── Retention releases ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `retention_releases` (
  `id`           CHAR(36)      NOT NULL,
  `org_id`       CHAR(36)      NOT NULL,
  `project_id`   CHAR(36)      NOT NULL,
  `contract_id`  CHAR(36)      NOT NULL,
  `amount`       DECIMAL(14,2) NOT NULL COMMENT 'ex GST',
  `reason`       ENUM('practical_completion','dlp_end','other') NOT NULL,
  `released_at`  DATE          NOT NULL,
  `note`         VARCHAR(300)  NULL,
  `payment_id`   CHAR(36)      NULL COMMENT 'project_payments row when the payee is a claimant user (TPAR)',
  `created_by`   CHAR(36)      NULL,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rr_contract` (`contract_id`),
  CONSTRAINT `fk_rr_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_rr_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_rr_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`),
  CONSTRAINT `chk_rr_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
