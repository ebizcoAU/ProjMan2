-- ProjMan2 — migration v003: construction core (development.md §5.2)
--
--   customers        the builder's clients
--   projects         one job for one customer
--   project_stages   the ordered programme, instantiated from a template
--   tasks            arbitrary nesting under a stage (tasks.parent_id)
--
-- PROPOSED to the app team via projman-01 (§2.2 rows added as a Server-dev
-- proposal) — built ahead of schema v1 sign-off on the owner's instruction so the
-- app port has something to test against. Column-level changes are cheap until the
-- app mirrors them; flag disagreements in projman-01, not in code.
--
-- Every synced table carries the five sync columns (projman-01 §2.4):
-- org_id, device_id, is_deleted, updated_at (BIGINT unix-ms, client clock),
-- server_updated_at (DATETIME(3), server clock — the pull cursor).

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- customers — who the builder builds for. Desk-configured (web system of record).
-- development.md §5.2 lists `contact`; expanded to contact_name/phone/email because
-- "ring the customer" is a field-app action and one free-text blob can't drive it.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `customers` (
  `id`           CHAR(36)     NOT NULL,
  `org_id`       CHAR(36)     NOT NULL,
  `name`         VARCHAR(255) NOT NULL,
  `abn`          VARCHAR(11)  NULL COMMENT 'Optional — commercial customers only',
  `contact_name` VARCHAR(255) NULL,
  `phone`        VARCHAR(30)  NULL,
  `email`        VARCHAR(255) NULL,
  `address`      VARCHAR(255) NULL,
  `notes`        TEXT         NULL,
  `device_id`    VARCHAR(100) NULL,
  `is_deleted`   TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_customers_org`    (`org_id`),
  KEY `idx_customers_cursor` (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_customers_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- projects — one job. Created/budgeted at a desk (web system of record); the field
-- app reads it. contract_value is FINANCIAL — redacted from pulls to non-financial
-- roles (a supervisor's tablet must not carry what the job is worth).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `projects` (
  `id`             CHAR(36)     NOT NULL,
  `org_id`         CHAR(36)     NOT NULL,
  `customer_id`    CHAR(36)     NULL,
  `code`           VARCHAR(30)  NOT NULL COMMENT 'Builder-facing short code, e.g. P-001',
  `name`           VARCHAR(255) NOT NULL,
  `site_address`   VARCHAR(255) NULL,
  `lot_plan`       VARCHAR(100) NULL COMMENT 'Lot/plan identifier (WA: lot on survey-strata etc.)',
  `contract_value` DECIMAL(14,2) NULL COMMENT 'FINANCIAL — redacted on pull for non-financial roles',
  `contract_type`  ENUM('fixed_price','cost_plus') NULL,
  `start_date`     DATE         NULL,
  `due_date`       DATE         NULL,
  `status`         ENUM('draft','active','on_hold','completed','archived') NOT NULL DEFAULT 'draft',
  `template_id`    CHAR(36)     NULL COMMENT 'stage_templates.id — table lands with §5.3',
  `pm_user_id`     CHAR(36)     NULL COMMENT 'users.id of the assigned project manager',
  `device_id`      VARCHAR(100) NULL,
  `is_deleted`     TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_projects_org_code` (`org_id`, `code`),
  KEY `idx_projects_customer` (`customer_id`),
  KEY `idx_projects_cursor`   (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_projects_org`      FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_projects_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_projects_pm`       FOREIGN KEY (`pm_user_id`)  REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- project_stages — the ordered stage list per project, from a template.
-- Structure (seq/code/name/budget) is drawn at the office; PROGRESS (status,
-- actual dates) is marked on site — so the app owns the sync surface but its
-- writable columns are the progress fields only (split-by-field, projman-01 §4).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `project_stages` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `project_id`    CHAR(36)     NOT NULL,
  `seq`           INT          NOT NULL DEFAULT 0,
  `stage_code`    VARCHAR(30)  NULL COMMENT 'From the template, e.g. SLAB, LOCKUP',
  `name`          VARCHAR(255) NOT NULL,
  `status`        ENUM('pending','in_progress','complete','skipped') NOT NULL DEFAULT 'pending',
  `is_validated`  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Inspection/certificate gate passed — set by compliance flow, not a bare device write',
  `start_date`    DATE         NULL,
  `end_date`      DATE         NULL,
  `budget_amount` DECIMAL(14,2) NULL COMMENT 'FINANCIAL — redacted on pull for non-financial roles',
  `device_id`     VARCHAR(100) NULL,
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_stages_project` (`project_id`, `seq`),
  KEY `idx_stages_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_stages_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_stages_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- tasks — arbitrary nesting under a stage (parent_id), assignment, completion.
-- The field app is the system of record: a PM plans and reworks the programme
-- from the app. Budget columns are web-written and financially redacted.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `tasks` (
  `id`             CHAR(36)     NOT NULL,
  `org_id`         CHAR(36)     NOT NULL,
  `project_id`     CHAR(36)     NOT NULL,
  `stage_id`       CHAR(36)     NULL,
  `parent_id`      CHAR(36)     NULL,
  `name`           VARCHAR(255) NOT NULL,
  `budget_hours`   DECIMAL(8,2)  NULL COMMENT 'FINANCIAL — redacted on pull for non-financial roles',
  `budget_amount`  DECIMAL(14,2) NULL COMMENT 'FINANCIAL — redacted on pull for non-financial roles',
  `completion`     TINYINT      NOT NULL DEFAULT 0 COMMENT '0–100 percent',
  `start_date`     DATE         NULL,
  `end_date`       DATE         NULL,
  `assigned_to`    CHAR(36)     NULL COMMENT 'users.id',
  `predecessor_id` CHAR(36)     NULL COMMENT 'tasks.id this one waits on',
  `device_id`      VARCHAR(100) NULL,
  `is_deleted`     TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tasks_project` (`project_id`),
  KEY `idx_tasks_stage`   (`stage_id`),
  KEY `idx_tasks_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_tasks_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_tasks_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_tasks_stage`   FOREIGN KEY (`stage_id`)   REFERENCES `project_stages` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
