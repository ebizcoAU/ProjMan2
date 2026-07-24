-- ProjMan2 — migration v008: site operations (servdesignspecification §11, APPROVED
-- 2026-07-24). The field app's daily driver — and the first module that is
-- app-authored AND app-owned: the site CREATES this data (attendance taps, a delivery
-- docket at the gate, the end-of-day diary), the server receives it through the scoped
-- sync path and enforces the one rule the site cannot self-police — the diary is a
-- legal record, so it is append-only and its edits are versioned (§11.4).
--
-- Owner locked §11.10: (1) new-row-per-version diary with supersedes_id/is_current;
-- (2) geo_verified SERVER-derived from a web-set project geofence; (3) free-text people
-- (no persons table yet — person_id → users when paired, else name/type); (4)
-- diary.signoff distinct from diary.write; (5) deliveries stop at the evidence record
-- (supplier/PO nullable until P7).
--
-- Every synced table carries the five sync columns (projman-01 §2.4): org_id,
-- device_id, is_deleted, updated_at (BIGINT unix-ms, client clock), server_updated_at
-- (DATETIME(3), server clock — the pull cursor).

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- site_diary — the legal record. One logical entry per (project, day); a finalised
-- entry is immutable and can only be SUPERSEDED by a new version (SiteOpsService
-- enforces DIARY_FINAL + the supersede chain). headcount is advisory (the app fills it
-- from attendance); weather is app-cached and never blocks (appspec Decision 4).
-- Server-controlled columns (author_id, finalised_at/by, is_current) are in the sync
-- PROTECTED_COLUMNS set — a tablet writes the body, the server owns the provenance.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `site_diary` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `project_id`    CHAR(36)     NOT NULL,
  `entry_date`    DATE         NOT NULL,
  `version`       INT          NOT NULL DEFAULT 1,
  `supersedes_id` CHAR(36)     NULL COMMENT 'The prior version this row replaces (§11.4)',
  `is_current`    TINYINT(1)   NOT NULL DEFAULT 1 COMMENT 'Server-maintained: latest version of the (project,date)',
  `status`        ENUM('draft','final') NOT NULL DEFAULT 'draft',
  `weather`       VARCHAR(40)  NULL,
  `temp_c`        DECIMAL(4,1) NULL,
  `headcount`     INT          NULL COMMENT 'Advisory — app derives from attendance',
  `work_done`     TEXT         NULL,
  `delays`        TEXT         NULL,
  `delay_cause`   VARCHAR(120) NULL,
  `notes`         TEXT         NULL,
  `photo_ids`     JSON         NULL COMMENT 'Image-queue ids; the image rows land with the documents module',
  `author_id`     CHAR(36)     NULL COMMENT 'Server-stamped from the session (first author)',
  `finalised_at`  DATETIME     NULL COMMENT 'Server-set when status → final',
  `finalised_by`  CHAR(36)     NULL COMMENT 'Server-set from the signing-off session',
  `device_id`     VARCHAR(100) NULL,
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_diary_version` (`org_id`, `project_id`, `entry_date`, `version`),
  KEY `idx_diary_project` (`project_id`, `entry_date`),
  KEY `idx_diary_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_diary_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_diary_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_diary_author`  FOREIGN KEY (`author_id`)  REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- site_attendance — one-tap check-in/out with a geofence stamp (§11.5). person_id →
-- users.id when the person is paired staff; otherwise NULL with free-text
-- person_name + person_type (a subbie chippie with no account still musters).
-- geo_verified is SERVER-derived (haversine vs the project geofence), never trusted
-- from the client — it is in PROTECTED_COLUMNS. Capture must never block (the app
-- stamps coordinates when it has them and omits them when it doesn't).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `site_attendance` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `project_id`    CHAR(36)     NOT NULL,
  `person_id`     CHAR(36)     NULL COMMENT 'users.id when paired staff; NULL for subbie/visitor',
  `person_name`   VARCHAR(120) NULL,
  `person_type`   ENUM('staff','subcontractor','visitor') NOT NULL DEFAULT 'staff',
  `trade`         VARCHAR(60)  NULL,
  `check_in_at`   DATETIME     NULL,
  `check_out_at`  DATETIME     NULL,
  `check_in_lat`  DECIMAL(9,6) NULL,
  `check_in_lng`  DECIMAL(9,6) NULL,
  `method`        ENUM('self','supervisor','qr') NOT NULL DEFAULT 'self',
  `geo_verified`  TINYINT(1)   NULL COMMENT 'Server-derived; NULL = unknown (no geofence/coords), not fail',
  `induction_ok`  TINYINT(1)   NULL,
  `device_id`     VARCHAR(100) NULL,
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_att_project` (`project_id`),
  KEY `idx_att_person`  (`person_id`),
  KEY `idx_att_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_att_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_att_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_att_person`  FOREIGN KEY (`person_id`)  REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- deliveries — the delivery-proof evidence record: photograph a docket at the gate,
-- against the project (and, when P7 lands, a PO). v1 is the evidence row only —
-- supplier_id/po_id are nullable with no FK (those tables don't exist until the
-- commercial module); a free-text supplier_name/po_reference captures the docket
-- regardless (§11.2).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `deliveries` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `project_id`    CHAR(36)     NOT NULL,
  `supplier_id`   CHAR(36)     NULL COMMENT 'FK wired at P7 (no suppliers table yet)',
  `supplier_name` VARCHAR(160) NULL,
  `po_id`         CHAR(36)     NULL COMMENT 'FK wired at P7 (no purchase_orders table yet)',
  `po_reference`  VARCHAR(60)  NULL,
  `received_at`   DATETIME     NOT NULL,
  `docket_no`     VARCHAR(60)  NULL,
  `photo_ids`     JSON         NULL,
  `notes`         TEXT         NULL,
  `received_by`   CHAR(36)     NULL COMMENT 'Server-stamped from the session',
  `device_id`     VARCHAR(100) NULL,
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_deliv_project` (`project_id`),
  KEY `idx_deliv_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_deliv_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_deliv_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- projects — add the site geofence (§11.5). Web-set (the office knows the site
-- coordinates); absent → geo_verified stays NULL and check-in degrades gracefully.
-- ============================================================================
ALTER TABLE `projects`
  ADD COLUMN `geofence_lat`      DECIMAL(9,6) NULL AFTER `lot_plan`,
  ADD COLUMN `geofence_lng`      DECIMAL(9,6) NULL AFTER `geofence_lat`,
  ADD COLUMN `geofence_radius_m` INT NULL DEFAULT 200 AFTER `geofence_lng`;

-- ============================================================================
-- Access matrix — activate the §9.3 reserved P5 permissions (§11.6). Enforcement is
-- by permission (SiteOpsService), so this is a data change, no endpoint edits.
--   diary.write             create/edit a DRAFT diary line   PM · siteSupervisor · foreperson
--   diary.signoff           finalise the legal entry          PM · siteSupervisor
--   attendance.write.site   muster the crew (any person)      PM · siteSupervisor · foreperson
--   attendance.write.own    own check-in/out only (self)      tradie
--   deliveries.write        record a delivery                 PM · siteSupervisor · foreperson
-- foreperson gets diary.write (contribute) but NOT diary.signoff (appspec §120).
-- ============================================================================
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('projectManager','diary.write'),   ('projectManager','diary.signoff'),
  ('projectManager','attendance.write.site'), ('projectManager','attendance.write.own'),
  ('projectManager','deliveries.write'),
  ('siteSupervisor','diary.write'),   ('siteSupervisor','diary.signoff'),
  ('siteSupervisor','attendance.write.site'), ('siteSupervisor','attendance.write.own'),
  ('siteSupervisor','deliveries.write'),
  ('foreperson','diary.write'),
  ('foreperson','attendance.write.site'), ('foreperson','attendance.write.own'),
  ('foreperson','deliveries.write'),
  ('tradie','attendance.write.own')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

-- Matrix changed → bump the version so the app cache-busts GET /auth/permissions.
UPDATE `access_meta` SET `v` = '3' WHERE `k` = 'matrix_version';
