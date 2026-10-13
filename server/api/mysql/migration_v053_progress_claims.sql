-- ProjMan2 — migration v053: client progress claims at the 6 billing milestones (xprojman-43 R2,
-- as re-scoped in §13 and ruled in §14). v052 is reserved for xprojman-56 (task codes), which is
-- still in review; the two are independent, and migrate.js applies whichever is pending.
--
-- ProjMan records the construction money facts and EXPORTS them (§13.4, R4). It keeps no ledger
-- and issues no tax invoice of its own; the builder's accounting system does that from the export.
-- "Progress claim" is the user-facing name (§14 O3).
--
--   projects.site_state         the site's jurisdiction (deposit caps follow the SITE, not the
--                               builder's registered office). Backfilled from organisations.state.
--   deposit_caps                statutory deposit caps as DATA (PM ruling): only rows with
--                               verified_at set are enforced (DEPOSIT_CAP_EXCEEDED); anything else
--                               warns (DEPOSIT_CAP_UNVERIFIED). Seeded: VIC and WA only.
--   client_payment_schedules    the project's milestone percentages (must total 100).
--   client_claims               one live claim per milestone per project: draft → issued → paid,
--                               or void (which drafts a replacement via supersedes_id).

ALTER TABLE `projects`
  ADD COLUMN `site_state` ENUM('WA','SA','NT','QLD','NSW','VIC','TAS','ACT') NULL
    COMMENT 'jurisdiction of the SITE; defaults from organisations.state at creation' AFTER `lot_plan`;

UPDATE `projects` p JOIN `organisations` o ON o.id = p.org_id
   SET p.site_state = o.state
 WHERE p.site_state IS NULL AND o.state IS NOT NULL;

CREATE TABLE IF NOT EXISTS `deposit_caps` (
  `id`              CHAR(36)      NOT NULL,
  `jurisdiction`    ENUM('WA','SA','NT','QLD','NSW','VIC','TAS','ACT') NOT NULL,
  `min_price`       DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'contract price INCLUDING GST, inclusive',
  `max_price`       DECIMAL(14,2) NULL COMMENT 'inclusive; NULL = no upper bound',
  `pct`             DECIMAL(5,2)  NULL COMMENT 'cap as % of the contract price (inc GST)',
  `abs_cap_amount`  DECIMAL(14,2) NULL COMMENT 'flat cap (inc GST), e.g. a $ amount',
  `rule`            VARCHAR(160)  NOT NULL COMMENT 'short human text shown to the PM',
  `source`          VARCHAR(160)  NOT NULL,
  `verified_at`     DATETIME      NULL COMMENT 'NULL = unverified: warn, never block',
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dc_jurisdiction` (`jurisdiction`, `min_price`),
  CONSTRAINT `chk_dc_cap` CHECK (`pct` IS NOT NULL OR `abs_cap_amount` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The PM's verified reading (2026-10-14). Every other state stays absent → warning only, until
-- the Owner's legal review adds verified rows.
INSERT INTO `deposit_caps` (`id`, `jurisdiction`, `min_price`, `max_price`, `pct`, `abs_cap_amount`, `rule`, `source`, `verified_at`) VALUES
  ('dc000000-0000-4000-8000-000000000001', 'VIC', 0,        19999.99, 10.00, NULL, 'VIC: 10% (contract under $20,000)',       'Domestic Building Contracts Act 1995 (Vic)', NOW()),
  ('dc000000-0000-4000-8000-000000000002', 'VIC', 20000,    NULL,      5.00, NULL, 'VIC: 5% (contract $20,000 or more)',      'Domestic Building Contracts Act 1995 (Vic)', NOW()),
  ('dc000000-0000-4000-8000-000000000003', 'WA',  7500,     500000,    6.50, NULL, 'WA: 6.5% (contract $7,500 to $500,000)',  'Home Building Contracts Act 1991 (WA)',      NOW())
ON DUPLICATE KEY UPDATE `id` = `id`;

CREATE TABLE IF NOT EXISTS `client_payment_schedules` (
  `id`          CHAR(36)     NOT NULL,
  `org_id`      CHAR(36)     NOT NULL,
  `project_id`  CHAR(36)     NOT NULL,
  `milestone`   ENUM('deposit','base','frame','lock_up','fixing','completion') NOT NULL,
  `percentage`  DECIMAL(5,2) NOT NULL,
  `updated_by`  CHAR(36)     NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cps_project_milestone` (`project_id`, `milestone`),
  CONSTRAINT `fk_cps_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_cps_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_claims` (
  `id`                     CHAR(36)      NOT NULL,
  `org_id`                 CHAR(36)      NOT NULL,
  `project_id`             CHAR(36)      NOT NULL,
  `milestone`              ENUM('deposit','base','frame','lock_up','fixing','completion') NOT NULL,
  `status`                 ENUM('draft','issued','paid','void') NOT NULL DEFAULT 'draft',
  `claim_number`           VARCHAR(40)   NULL COMMENT 'assigned at ISSUE (PC-YYYY-NNNN per org); NULL on drafts',
  `claim_year`             SMALLINT      NULL,
  `claim_seq`              INT           NULL,
  `amount_ex_gst`          DECIMAL(14,2) NOT NULL,
  `gst_amount`             DECIMAL(14,2) NOT NULL DEFAULT 0,
  `amount_inc_gst`         DECIMAL(14,2) NOT NULL,
  `percentage_of_contract` DECIMAL(5,2)  NULL COMMENT 'frozen at issue',
  `variation_note`         VARCHAR(500)  NULL,
  `issued_at`              DATETIME      NULL,
  `issued_by`              CHAR(36)      NULL,
  `due_at`                 DATETIME      NULL COMMENT 'issued_at + 14 days (residential default)',
  `paid_at`                DATETIME      NULL,
  `payment_reference`      VARCHAR(100)  NULL,
  `payment_recorded_by`    CHAR(36)      NULL COMMENT 'the PM/office user who recorded the payment',
  `paid_by_user_id`        CHAR(36)      NULL COMMENT 'reserved: the client, once client logins exist (x50)',
  `void_reason`            VARCHAR(500)  NULL,
  `voided_at`              DATETIME      NULL,
  `voided_by`              CHAR(36)      NULL,
  `supersedes_id`          CHAR(36)      NULL COMMENT 'the voided claim this draft replaces',
  `exported_at`            DATETIME      NULL COMMENT 'R4 accounting export',
  `exported_by`            CHAR(36)      NULL,
  `export_id`              CHAR(36)      NULL,
  `is_deleted`             TINYINT(1)    NOT NULL DEFAULT 0,
  `created_by`             CHAR(36)      NULL COMMENT 'NULL = drafted by the system (milestone trigger)',
  `created_at`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             BIGINT        NULL,
  `server_updated_at`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- One LIVE claim per milestone: a void (or deleted) claim drops out, so its replacement fits.
  `live_milestone`         VARCHAR(20)   GENERATED ALWAYS AS
                             (IF(`status` <> 'void' AND `is_deleted` = 0, `milestone`, NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_clc_live_milestone` (`project_id`, `live_milestone`),
  UNIQUE KEY `uq_clc_org_number`     (`org_id`, `claim_number`),
  KEY `idx_clc_org_status` (`org_id`, `status`),
  KEY `idx_clc_cursor`     (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_clc_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_clc_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
