-- ProjMan2 — migration v047: generic checklists (xprojman-46, as amended by its §7).
--
-- Author (Portal) → publish → execute offline (App) → complete (server freezes) → review.
-- The generic layer only: statutory hold points stay on hold_point_requirements +
-- inspections (xprojman-46 §1 boundary), and a generic checklist never gates a stage.
--
--   checklist_templates / _items   org templates + system templates (org_id NULL, read-only)
--   checklist_instances / _items   an executed checklist; items are a SNAPSHOT of the
--                                  template at start (F2), so template edits never rewrite
--                                  a completed record
--   signoffs                       one shared sign-off table (xprojman-48 F6). v047 needs
--                                  only subject_type 'checklist_instance'; v048 widens the
--                                  ENUM for site inductions + SWMS
--
-- Evidence (item photos, signatures) is NEVER a column on these rows: it is a `documents`
-- row keyed entity_type='checklist_item' / 'signoff' + entity_id (xprojman-46 §7 #1).
--
-- Every table carries device_id/updated_at/server_updated_at/is_deleted because every one
-- of them is in the sync delta pull (the pull's echo filter reads device_id).
--
-- Permissions (SA ruling on F3): checklists.manage → projectManager, siteSupervisor;
-- checklists.execute → projectManager, siteSupervisor, foreperson, tradie, inspector.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

CREATE TABLE IF NOT EXISTS `checklist_templates` (
  `id`           CHAR(36)     NOT NULL,
  `org_id`       CHAR(36)     NULL COMMENT 'NULL = system template (read-only; customise by copy_from)',
  `name`         VARCHAR(160) NOT NULL,
  `category`     ENUM('internal_qa','toolbox_talk','plant_prestart','other') NOT NULL,
  `target_role`  VARCHAR(40)  NULL COMMENT 'NULL = any role holding checklists.execute',
  `description`  TEXT         NULL,
  `is_published` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_by`   CHAR(36)     NULL,
  `device_id`    VARCHAR(100) NULL,
  `is_deleted`   TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ckt_org`    (`org_id`),
  KEY `idx_ckt_cursor` (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_ckt_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `checklist_template_items` (
  `id`             CHAR(36)     NOT NULL,
  `org_id`         CHAR(36)     NULL COMMENT 'Mirrors the parent template (NULL for system) — lets the pull filter directly',
  `template_id`    CHAR(36)     NOT NULL,
  `seq`            INT          NOT NULL,
  `label`          VARCHAR(255) NOT NULL,
  `is_required`    TINYINT(1)   NOT NULL DEFAULT 1,
  `photo_required` TINYINT(1)   NOT NULL DEFAULT 0,
  `device_id`      VARCHAR(100) NULL,
  `is_deleted`     TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ckti_template` (`template_id`),
  KEY `idx_ckti_cursor`   (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_ckti_template` FOREIGN KEY (`template_id`) REFERENCES `checklist_templates` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `checklist_instances` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `project_id`    CHAR(36)     NOT NULL,
  `template_id`   CHAR(36)     NOT NULL,
  `stage_id`      CHAR(36)     NULL,
  `unit_id`       CHAR(36)     NULL COMMENT 'modular_units — spec §1.5 two-tier, optional',
  `template_name` VARCHAR(160) NOT NULL COMMENT 'Snapshot (F2) — server copies it from the template on create',
  `category`      ENUM('internal_qa','toolbox_talk','plant_prestart','other') NOT NULL COMMENT 'Snapshot (F2)',
  `status`        ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  `result`        ENUM('pending','pass','fail') NOT NULL DEFAULT 'pending' COMMENT 'Server-derived at completion (F5)',
  `started_by`    CHAR(36)     NULL COMMENT 'Server-stamped on create',
  `completed_by`  CHAR(36)     NULL COMMENT 'Server-stamped on completion',
  `completed_at`  DATETIME     NULL COMMENT 'Server-stamped on completion',
  `lat`           DECIMAL(9,6) NULL,
  `lng`           DECIMAL(9,6) NULL,
  `notes`         TEXT         NULL,
  `supersedes_id` CHAR(36)     NULL COMMENT 'A correction is a new instance pointing at the one it replaces',
  `device_id`     VARCHAR(100) NULL,
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cki_project`    (`project_id`),
  KEY `idx_cki_supersedes` (`supersedes_id`),
  KEY `idx_cki_cursor`     (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_cki_org`      FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_cki_project`  FOREIGN KEY (`project_id`)  REFERENCES `projects` (`id`),
  CONSTRAINT `fk_cki_template` FOREIGN KEY (`template_id`) REFERENCES `checklist_templates` (`id`),
  CONSTRAINT `fk_cki_stage`    FOREIGN KEY (`stage_id`)    REFERENCES `project_stages` (`id`),
  CONSTRAINT `fk_cki_unit`     FOREIGN KEY (`unit_id`)     REFERENCES `modular_units` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `checklist_instance_items` (
  `id`             CHAR(36)     NOT NULL,
  `org_id`         CHAR(36)     NOT NULL,
  `instance_id`    CHAR(36)     NOT NULL,
  `seq`            INT          NOT NULL DEFAULT 0,
  `label`          VARCHAR(255) NOT NULL,
  `is_required`    TINYINT(1)   NOT NULL DEFAULT 1,
  `photo_required` TINYINT(1)   NOT NULL DEFAULT 0,
  `result`         ENUM('pending','pass','fail','na') NOT NULL DEFAULT 'pending',
  `note`           VARCHAR(255) NULL,
  `device_id`      VARCHAR(100) NULL,
  `is_deleted`     TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ckii_instance` (`instance_id`),
  KEY `idx_ckii_cursor`   (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_ckii_org`      FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_ckii_instance` FOREIGN KEY (`instance_id`) REFERENCES `checklist_instances` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `signoffs` (
  `id`           CHAR(36)     NOT NULL,
  `org_id`       CHAR(36)     NOT NULL,
  `subject_type` ENUM('checklist_instance') NOT NULL COMMENT 'v048 adds site_induction, swms',
  `subject_id`   CHAR(36)     NOT NULL,
  `project_id`   CHAR(36)     NOT NULL COMMENT 'Denormalised: the subject is polymorphic, so sync scope cannot join through one parent',
  `user_id`      CHAR(36)     NULL COMMENT 'The signer, when they are a user',
  `name`         VARCHAR(160) NULL COMMENT 'The signer, when they are not (visitors, non-users)',
  `signed_at`    DATETIME     NOT NULL COMMENT 'Client-writable — when it was signed on the device',
  `device_id`    VARCHAR(100) NULL,
  `is_deleted`   TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_so_subject` (`subject_type`, `subject_id`),
  KEY `idx_so_project` (`project_id`),
  KEY `idx_so_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_so_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_so_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `chk_so_signer` CHECK (`user_id` IS NOT NULL OR `name` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Permissions (SA ruling, xprojman-46 F3) ────────────────────────────────
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('projectManager', 'checklists.manage'),
  ('siteSupervisor', 'checklists.manage'),
  ('projectManager', 'checklists.execute'),
  ('siteSupervisor', 'checklists.execute'),
  ('foreperson',     'checklists.execute'),
  ('tradie',         'checklists.execute'),
  ('inspector',      'checklists.execute')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

UPDATE `access_meta` SET `v` = '15' WHERE `k` = 'matrix_version';

-- ── Three system templates (org_id NULL), published. Placeholder wording until PM or
--    Product supplies the real text (xprojman-46 §5). Fixed ids so re-runs are no-ops.
INSERT INTO `checklist_templates` (`id`, `org_id`, `name`, `category`, `description`, `is_published`) VALUES
  ('c0000000-0000-4000-8000-000000000001', NULL, 'Toolbox talk (generic)',    'toolbox_talk',   'Placeholder system template — duplicate to customise.', 1),
  ('c0000000-0000-4000-8000-000000000002', NULL, 'Plant pre-start (generic)', 'plant_prestart', 'Placeholder system template — duplicate to customise.', 1),
  ('c0000000-0000-4000-8000-000000000003', NULL, 'Internal QA (generic)',     'internal_qa',    'Placeholder system template — duplicate to customise.', 1)
ON DUPLICATE KEY UPDATE `id` = `id`;

INSERT INTO `checklist_template_items` (`id`, `org_id`, `template_id`, `seq`, `label`, `is_required`, `photo_required`) VALUES
  ('c1000000-0000-4000-8000-000000000001', NULL, 'c0000000-0000-4000-8000-000000000001', 1, 'Topic covered with the crew',            1, 0),
  ('c1000000-0000-4000-8000-000000000002', NULL, 'c0000000-0000-4000-8000-000000000001', 2, 'Site hazards for today discussed',       1, 0),
  ('c1000000-0000-4000-8000-000000000003', NULL, 'c0000000-0000-4000-8000-000000000001', 3, 'Questions and concerns recorded',        0, 0),
  ('c1000000-0000-4000-8000-000000000004', NULL, 'c0000000-0000-4000-8000-000000000002', 1, 'Visual inspection — no damage or leaks', 1, 1),
  ('c1000000-0000-4000-8000-000000000005', NULL, 'c0000000-0000-4000-8000-000000000002', 2, 'Fluid levels checked',                   1, 0),
  ('c1000000-0000-4000-8000-000000000006', NULL, 'c0000000-0000-4000-8000-000000000002', 3, 'Safety devices and alarms working',      1, 0),
  ('c1000000-0000-4000-8000-000000000007', NULL, 'c0000000-0000-4000-8000-000000000003', 1, 'Work matches the drawings',              1, 1),
  ('c1000000-0000-4000-8000-000000000008', NULL, 'c0000000-0000-4000-8000-000000000003', 2, 'Work area left clean and safe',          1, 0)
ON DUPLICATE KEY UPDATE `id` = `id`;
