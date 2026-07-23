-- ProjMan2 — migration v006: the 18-stage template & progression engine
-- (servdesignspecification §10, APPROVED 2026-07-23). Owner locked §10.10:
-- estimator = projectManager sub-function · status(gate-enum) + milestone(free-text)
-- split · web-first instantiation · inspector-only validation (PM cannot self-validate)
-- · cost columns now.
--
-- Delivers: stage_templates + stage_template_items (the LIBRARY), the WA_RESIDENTIAL_18
-- system template seed, and the extensions to project_stages (the INSTANCE) that the
-- progression engine reasons over — gate metadata, validation provenance, and the
-- four stage cost columns.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- stage_templates — the reusable programme library. A system template (org_id NULL)
-- is the seed; a builder clones it into their org and edits the clone. REST-only
-- (web instantiation, matrix Stage 9 is a Dashboard action) — not synced to devices;
-- the app renders the INSTANCE (project_stages), which does sync.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `stage_templates` (
  `id`          CHAR(36)     NOT NULL,
  `org_id`      CHAR(36)     NULL COMMENT 'NULL = system template (global seed)',
  `name`        VARCHAR(255) NOT NULL,
  `industry`    VARCHAR(100) NULL,
  `description` TEXT         NULL,
  `is_system`   TINYINT(1)   NOT NULL DEFAULT 0,
  `is_deleted`  TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_stpl_org` (`org_id`),
  CONSTRAINT `fk_stpl_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- stage_template_items — the ordered stage definitions within a template
-- (development.md §5.3 + the matrix's actor & gate metadata).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `stage_template_items` (
  `id`          CHAR(36)     NOT NULL,
  `template_id` CHAR(36)     NOT NULL,
  `seq`         INT          NOT NULL DEFAULT 0,
  `stage_code`  VARCHAR(30)  NOT NULL,
  `name`        VARCHAR(255) NOT NULL,
  `part`        ENUM('A','B','C','D','E') NULL COMMENT 'The matrix lifecycle part',
  `actor_role`  VARCHAR(40)  NULL COMMENT 'Primary owner (informational; enforcement is by permission)',
  `default_duration_days` INT NULL,
  `is_hold_point`        TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Completion needs an inspector validation',
  `gate_prev`            TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Cannot start until the previous stage is complete (+validated if a hold point)',
  `requires_inspection`  TINYINT(1) NOT NULL DEFAULT 0,
  `requires_certificate` TINYINT(1) NOT NULL DEFAULT 0,
  `milestone_vocab` JSON NULL COMMENT 'Optional stage-specific status labels the app shows',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stpl_item_seq` (`template_id`, `seq`),
  KEY `idx_stpl_item_tpl` (`template_id`),
  CONSTRAINT `fk_stpl_item_tpl` FOREIGN KEY (`template_id`) REFERENCES `stage_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Extend project_stages (the running instance).
-- ============================================================================
-- Gate enum: v003 shipped pending|in_progress|complete|skipped. The engine reasons
-- over a small closed set — add not_started + blocked, drop the legacy 'pending'.
-- Three steps so existing 'pending' rows (from earlier dev runs) survive the retype:
-- widen to a superset, remap, then narrow to the final enum.
ALTER TABLE `project_stages`
  MODIFY `status` ENUM('not_started','pending','in_progress','blocked','complete','skipped')
                  NOT NULL DEFAULT 'not_started';
UPDATE `project_stages` SET `status` = 'not_started' WHERE `status` = 'pending';
ALTER TABLE `project_stages`
  MODIFY `status` ENUM('not_started','in_progress','blocked','complete','skipped')
                  NOT NULL DEFAULT 'not_started';

ALTER TABLE `project_stages`
  ADD COLUMN `part`             ENUM('A','B','C','D','E') NULL AFTER `name`,
  ADD COLUMN `actor_role`       VARCHAR(40)  NULL AFTER `part`,
  ADD COLUMN `template_item_id` CHAR(36)     NULL COMMENT 'Provenance: the template row this came from' AFTER `actor_role`,
  ADD COLUMN `is_hold_point`    TINYINT(1)   NOT NULL DEFAULT 0 AFTER `is_validated`,
  ADD COLUMN `gate_prev`        TINYINT(1)   NOT NULL DEFAULT 0 AFTER `is_hold_point`,
  ADD COLUMN `milestone`        VARCHAR(64)  NULL COMMENT 'Current stage-specific label (display/workflow)' AFTER `status`,
  ADD COLUMN `validated_by`     CHAR(36)     NULL COMMENT 'users.id of the inspector (server-set only)' AFTER `is_hold_point`,
  ADD COLUMN `validated_at`     DATETIME     NULL AFTER `validated_by`,
  ADD COLUMN `estimated_amount` DECIMAL(14,2) NULL COMMENT 'FINANCIAL — redacted on pull' AFTER `budget_amount`,
  ADD COLUMN `committed_amount` DECIMAL(14,2) NULL COMMENT 'FINANCIAL' AFTER `estimated_amount`,
  ADD COLUMN `actual_amount`    DECIMAL(14,2) NULL COMMENT 'FINANCIAL' AFTER `committed_amount`,
  ADD COLUMN `claimed_amount`   DECIMAL(14,2) NULL COMMENT 'FINANCIAL' AFTER `actual_amount`;

-- budget_amount (v003) maps to the plan figure — backfill into estimated_amount.
UPDATE `project_stages` SET `estimated_amount` = `budget_amount`
 WHERE `estimated_amount` IS NULL AND `budget_amount` IS NOT NULL;

-- ============================================================================
-- Seed: WA_RESIDENTIAL_18 (system template) + its 18 items.
-- Hold points at stages 11/12/13/15/18 (matrix CRITICAL HOLD POINTS); gate_prev on
-- the stages each hold point blocks (12,13,14,16) plus the final handover (18).
-- ============================================================================
SET @tpl = '00000000-0000-4000-8000-00000000wa18';

INSERT INTO `stage_templates` (`id`, `org_id`, `name`, `industry`, `description`, `is_system`)
VALUES (@tpl, NULL, 'WA Residential — 18 Stage', 'residential_construction',
        'Standard WA residential build lifecycle, design through handover (18StageProjectManagementMatrix).', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `stage_template_items`
  (`id`, `template_id`, `seq`, `stage_code`, `name`, `part`, `actor_role`,
   `is_hold_point`, `gate_prev`, `requires_inspection`, `requires_certificate`) VALUES
  (UUID(), @tpl,  1, 'PROJECT_CREATION',      'Project Creation & Land Ingestion', 'A', 'projectManager', 0, 0, 0, 0),
  (UUID(), @tpl,  2, 'UTILITY_HAZARD_AUDIT',  'Utility & Hazard Audit',            'A', 'projectManager', 0, 0, 0, 0),
  (UUID(), @tpl,  3, 'CONCEPT_DESIGN',        'Concept Design Generation',         'A', 'projectManager', 0, 0, 0, 0),
  (UUID(), @tpl,  4, 'TOWN_PLANNER_SCREEN',   'Town Planner Screening',            'A', 'projectManager', 0, 0, 0, 0),
  (UUID(), @tpl,  5, 'BUDGET_STYLE',          'Budget Style Generation',           'A', 'projectManager', 0, 0, 0, 0),
  (UUID(), @tpl,  6, 'ARCH_DRAWINGS',         'Architectural Drawings',            'A', 'projectManager', 0, 0, 0, 0),
  (UUID(), @tpl,  7, 'DA_SUBMISSION',         'DA Submission & Approval',          'A', 'projectManager', 0, 0, 0, 1),
  (UUID(), @tpl,  8, 'DA_APPROVAL_CC',        'DA Approval & Construction Cert',   'B', 'projectManager', 0, 1, 1, 1),
  (UUID(), @tpl,  9, 'CONSTRUCTION_TENDER',   'Construction Tender Preparation',   'B', 'projectManager', 0, 0, 0, 0),
  (UUID(), @tpl, 10, 'SITE_WORKS',            'Site Works & Earthworks',           'C', 'siteSupervisor', 0, 1, 1, 0),
  (UUID(), @tpl, 11, 'FOUNDATION_SERVICES',   'Foundation & Services Rough-in',    'C', 'siteSupervisor', 1, 1, 1, 0),
  (UUID(), @tpl, 12, 'SLAB_POUR',             'Slab Pour & Foundation',            'C', 'siteSupervisor', 1, 1, 1, 1),
  (UUID(), @tpl, 13, 'FRAME_ROOF',            'Frame & Roof Construction',         'C', 'siteSupervisor', 1, 1, 1, 1),
  (UUID(), @tpl, 14, 'LOCK_UP',               'Lock-up & External Works',          'C', 'siteSupervisor', 0, 1, 1, 1),
  (UUID(), @tpl, 15, 'INTERNAL_ROUGH_IN',     'Internal Services Rough-in',        'C', 'foreperson',     1, 1, 1, 1),
  (UUID(), @tpl, 16, 'FIT_OUT',               'Fit-out & Finishes',                'D', 'foreperson',     0, 1, 1, 0),
  (UUID(), @tpl, 17, 'EXTERNAL_LANDSCAPING',  'External Works & Landscaping',      'D', 'siteSupervisor', 0, 0, 1, 0),
  (UUID(), @tpl, 18, 'COMPLIANCE_HANDOVER',   'Compliance & Handover',             'E', 'projectManager', 1, 1, 1, 1);
