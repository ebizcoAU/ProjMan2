-- ProjMan — migration v017: P7a Commercial (Cost Plan + Progress Claims).
-- Per xprojman-10 §4 (owner-approved scope + phasing) and serverdesignspecification.md
-- §7.2 / §10.6. This is the FIRST P7 phase — the document layer that feeds the money
-- columns the stage engine already carries (`project_stages.estimated_amount` /
-- `claimed_amount`); those columns stay the single read model (xprojman-10 §5), P7 owns
-- them as derived roll-ups.
--
-- REST-mediated workflow, NOT sync-registry tables (same reasoning as job_awards, v013):
-- estimate edits and the submit→approve→paid claim workflow are transitions, not
-- free-form offline field edits, so they do not ride /sync/push.
--
-- Note: an earlier, CANCELLED plan used v017 for the (never-built) active-role identity
-- work (xprojman-07, superseded by xprojman-08/09). That migration was never written;
-- v017 is free and is P7a's.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- cost_plans — a thin per-project header so the estimate can be "locked" as the
-- baseline. One row per project (created lazily on first estimate line). Locking
-- freezes the estimate; further edits are refused by EstimateService until unlocked.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `cost_plans` (
  `id`         CHAR(36)     NOT NULL,
  `org_id`     CHAR(36)     NOT NULL,
  `project_id` CHAR(36)     NOT NULL,
  `status`     ENUM('draft','locked') NOT NULL DEFAULT 'draft',
  `locked_at`  DATETIME     NULL,
  `locked_by`  CHAR(36)     NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_costplan_project` (`project_id`),
  KEY `idx_costplan_org` (`org_id`),
  CONSTRAINT `fk_costplan_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_costplan_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- estimate_lines — the cost-plan breakdown. Stage-tagged lines roll up into
-- `project_stages.estimated_amount` (EstimateService recomputes on every write).
-- `amount` is stored (= quantity × rate, computed server-side) so the roll-up is a
-- plain SUM. Money-gated like every FINANCIAL surface (money.read/write).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `estimate_lines` (
  `id`           CHAR(36)     NOT NULL,
  `org_id`       CHAR(36)     NOT NULL,
  `project_id`   CHAR(36)     NOT NULL,
  `cost_plan_id` CHAR(36)     NOT NULL,
  `stage_id`     CHAR(36)     NULL COMMENT 'NULL = project-level line (does not roll to a stage)',
  `description`  VARCHAR(300) NOT NULL,
  `category`     VARCHAR(60)  NULL,
  `quantity`     DECIMAL(12,3) NOT NULL DEFAULT 1,
  `unit`         VARCHAR(20)  NULL,
  `rate`         DECIMAL(14,2) NOT NULL DEFAULT 0,
  `amount`       DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'server-computed quantity*rate',
  `created_by`   CHAR(36)     NULL,
  `is_deleted`   TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_estline_project` (`project_id`),
  KEY `idx_estline_stage`   (`stage_id`),
  CONSTRAINT `fk_estline_org`      FOREIGN KEY (`org_id`)       REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_estline_project`  FOREIGN KEY (`project_id`)   REFERENCES `projects` (`id`),
  CONSTRAINT `fk_estline_costplan` FOREIGN KEY (`cost_plan_id`) REFERENCES `cost_plans` (`id`),
  CONSTRAINT `fk_estline_stage`    FOREIGN KEY (`stage_id`)     REFERENCES `project_stages` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- progress_claims — the Builder→PM billing workflow (§7.2 claims.submit/approve).
-- submit calls stageHooks.assertClaimAllowed (§10.6 freeze: refused if the stage or a
-- prior hold point is an unvalidated hold point). approve→paid records a
-- project_payments row (purpose='progress_claim', TPAR-reportable). Approved+paid
-- claims roll up into `project_stages.claimed_amount`.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `progress_claims` (
  `id`           CHAR(36)     NOT NULL,
  `org_id`       CHAR(36)     NOT NULL,
  `project_id`   CHAR(36)     NOT NULL,
  `stage_id`     CHAR(36)     NULL,
  `claim_number` INT          NOT NULL DEFAULT 1 COMMENT 'sequential per project',
  `amount`       DECIMAL(14,2) NOT NULL,
  `status`       ENUM('submitted','approved','declined','paid') NOT NULL DEFAULT 'submitted',
  `note`         VARCHAR(300) NULL,
  `submitted_by` CHAR(36)     NULL,
  `submitted_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `approved_by`  CHAR(36)     NULL,
  `approved_at`  DATETIME     NULL,
  `payment_id`   CHAR(36)     NULL COMMENT 'FK project_payments — set when paid',
  `is_deleted`   TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_claim_project` (`project_id`, `status`),
  KEY `idx_claim_stage`   (`stage_id`),
  CONSTRAINT `fk_claim_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_claim_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_claim_stage`   FOREIGN KEY (`stage_id`)   REFERENCES `project_stages` (`id`),
  CONSTRAINT `fk_claim_payment` FOREIGN KEY (`payment_id`) REFERENCES `project_payments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Permissions (§7.2). Estimating/cost-plan writes are gated by the EXISTING
-- money.write (no new permission — spec §7.2 names money.* + claims.*/variations.*,
-- not a separate estimates.write). Only the two claim permissions are new.
-- ============================================================================
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('builder',        'claims.submit'),   -- Builder submits a progress claim
  ('projectManager', 'claims.approve')   -- PM approves it → payable
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

UPDATE `access_meta` SET `v` = '6' WHERE `k` = 'matrix_version';
