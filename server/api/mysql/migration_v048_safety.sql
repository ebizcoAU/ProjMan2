-- ProjMan2 — migration v048: Safety/OHS (xprojman-48, as ruled in §7.1 and agreed in §8).
--
--   safety_events      hazards, near misses, incidents — reported on site (App, offline),
--                      responded to / closed from App or Portal. Site hazards only: the
--                      Stage 2 S2.4 environmental overlay is a DIFFERENT, future table
--                      (site_constraints, F1).
--   incident_details   1:1, the sensitive part (health information, Privacy Act). Synced
--                      CREATE-ONLY and never pulled (F2); read via REST by safety.manage or
--                      the original reporter; corrected via REST with an audited diff.
--   safety_actions     corrective actions (F4). An event can't close while one is open.
--   site_inductions    project-scoped site inductions with expiry (F5). The White Card is a
--                      personal credential, not this. site_attendance.induction_ok becomes
--                      server-derived from these rows at check-in (warn + alert, never block).
--   signoffs           widened (F6) for site_induction + swms sign-on.
--
-- Rulings (§7.1): no safety.manage for Builder (F7); notifiable incidents are RECORDED and
-- EMAILED to the PM + Site Supervisor, never lodged with a regulator, and a notifiable event
-- is append-only on sync (F3); all incidents retained 5 years — rows are soft-deleted only,
-- and a notifiable one refuses deletion on every path.
--
-- Evidence (photos, the "after" photo, signatures) is a `documents` row keyed by
-- entity_type/entity_id, never a column here.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

CREATE TABLE IF NOT EXISTS `safety_events` (
  `id`                      CHAR(36)     NOT NULL,
  `org_id`                  CHAR(36)     NOT NULL,
  `project_id`              CHAR(36)     NOT NULL,
  `stage_id`                CHAR(36)     NULL,
  `unit_id`                 CHAR(36)     NULL,
  `kind`                    ENUM('hazard','near_miss','incident') NOT NULL,
  `description`             TEXT         NOT NULL,
  `location`                VARCHAR(160) NULL,
  `severity`                ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  `status`                  ENUM('open','in_progress','closed') NOT NULL DEFAULT 'open',
  `occurred_at`             DATETIME     NULL,
  `lat`                     DECIMAL(9,6) NULL,
  `lng`                     DECIMAL(9,6) NULL,
  `is_notifiable`           TINYINT(1)   NOT NULL DEFAULT 0,
  `notifiable_confirmed_by` CHAR(36)     NULL COMMENT 'safety.manage confirm/clear, REST only',
  `notified_at`             DATETIME     NULL COMMENT 'Filled in by a human after they call the regulator',
  `regulator_reference`     VARCHAR(60)  NULL,
  `raised_by`               CHAR(36)     NULL COMMENT 'Server-stamped',
  `raised_at`               DATETIME     NULL COMMENT 'Server-stamped',
  `closed_by`               CHAR(36)     NULL COMMENT 'Server-stamped',
  `closed_at`               DATETIME     NULL COMMENT 'Server-stamped',
  `close_note`              TEXT         NULL,
  `device_id`               VARCHAR(100) NULL,
  `is_deleted`              TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              BIGINT       NULL,
  `server_updated_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_se_project` (`project_id`, `created_at`),
  KEY `idx_se_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_se_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_se_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_se_stage`   FOREIGN KEY (`stage_id`)   REFERENCES `project_stages` (`id`),
  CONSTRAINT `fk_se_unit`    FOREIGN KEY (`unit_id`)    REFERENCES `modular_units` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `incident_details` (
  `id`               CHAR(36)     NOT NULL,
  `org_id`           CHAR(36)     NOT NULL,
  `event_id`         CHAR(36)     NOT NULL,
  `injured_user_id`  CHAR(36)     NULL,
  `injured_name`     VARCHAR(160) NULL,
  `injury_type`      VARCHAR(80)  NULL,
  `body_part`        VARCHAR(80)  NULL,
  `treatment`        ENUM('none','first_aid','medical','hospital','fatality') NULL,
  `lost_time`        TINYINT(1)   NULL,
  `witness_names`    TEXT         NULL,
  `device_id`        VARCHAR(100) NULL,
  `is_deleted`       TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_id_event` (`event_id`),
  CONSTRAINT `fk_id_org`   FOREIGN KEY (`org_id`)   REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_id_event` FOREIGN KEY (`event_id`) REFERENCES `safety_events` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `safety_actions` (
  `id`               CHAR(36)     NOT NULL,
  `org_id`           CHAR(36)     NOT NULL,
  `event_id`         CHAR(36)     NOT NULL,
  `action`           TEXT         NOT NULL,
  `assigned_to`      CHAR(36)     NULL,
  `assigned_to_name` VARCHAR(120) NULL,
  `due_date`         DATE         NULL,
  `status`           ENUM('open','closed') NOT NULL DEFAULT 'open',
  `closed_by`        CHAR(36)     NULL COMMENT 'Server-stamped',
  `closed_at`        DATETIME     NULL COMMENT 'Server-stamped',
  `device_id`        VARCHAR(100) NULL,
  `is_deleted`       TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_sa_event`  (`event_id`),
  KEY `idx_sa_cursor` (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_sa_org`   FOREIGN KEY (`org_id`)   REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_sa_event` FOREIGN KEY (`event_id`) REFERENCES `safety_events` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `site_inductions` (
  `id`                    CHAR(36)     NOT NULL,
  `org_id`                CHAR(36)     NOT NULL,
  `project_id`            CHAR(36)     NOT NULL,
  `user_id`               CHAR(36)     NULL COMMENT 'The inductee, when a user',
  `name`                  VARCHAR(160) NULL COMMENT 'The inductee, when not (visitors)',
  `inducted_by`           CHAR(36)     NULL COMMENT 'Server-stamped',
  `inducted_at`           DATETIME     NOT NULL,
  `expires_at`            DATE         NULL,
  `checklist_instance_id` CHAR(36)     NULL COMMENT 'When the induction content ran as a checklist',
  `device_id`             VARCHAR(100) NULL,
  `is_deleted`            TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            BIGINT       NULL,
  `server_updated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_si_project` (`project_id`, `user_id`),
  KEY `idx_si_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_si_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_si_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `chk_si_person` CHECK (`user_id` IS NOT NULL OR `name` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- F6: one sign-off table for checklists, site inductions and SWMS sign-on.
ALTER TABLE `signoffs`
  MODIFY `subject_type` ENUM('checklist_instance','site_induction','swms') NOT NULL;

-- ── Permissions (F7 ruling: Builder reports + reads the list, never manages) ──
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('tradie',         'safety.report'),
  ('foreperson',     'safety.report'),
  ('siteSupervisor', 'safety.report'),
  ('projectManager', 'safety.report'),
  ('inspector',      'safety.report'),
  ('builder',        'safety.report'),
  ('siteSupervisor', 'safety.manage'),
  ('projectManager', 'safety.manage')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

UPDATE `access_meta` SET `v` = '16' WHERE `k` = 'matrix_version';
