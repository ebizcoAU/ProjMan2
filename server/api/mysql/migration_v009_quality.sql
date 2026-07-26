-- ProjMan2 — migration v009: quality (servdesignspecification §12, APPROVED
-- 2026-07-24). P6a — the detail behind a gate that already has teeth: the 18-stage
-- engine (§10) already refuses a hold-point stage's completion until an independent
-- inspector validates it. This migration adds the record that justifies that flip
-- (an inspection with a checklist) plus the two records a build's quality trail
-- needs alongside it (defects, certificates). It does NOT touch StageProgressionService
-- or its gate — InspectionService calls the existing validate() (§12.2).
--
-- Owner locked §12.12: (1) P6a now, NCC/structural ComplianceService (P6b) follows;
-- (2) open defects do NOT block stage completion in v1 (hold points only gate);
-- (3) a certificate at its hold point is advisory in v1 (the inspection pass is the
-- gate); (4) quality.write NOT granted to foreperson in v1; (5) quality.signoff stays
-- reserved (quality.validate already is the hold-point sign-off).
--
-- Every synced table carries the five sync columns (projman-01 §2.4): org_id,
-- device_id, is_deleted, updated_at (BIGINT unix-ms, client clock), server_updated_at
-- (DATETIME(3), server clock — the pull cursor). Same loose-coupling as P5 (§11.2):
-- document_id/photo_id are nullable ids the app queues through the offline image
-- queue; no suppliers/persons FK targets yet, so `trade` is free-text and
-- `assigned_to` -> users.id only when the assignee is staff.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- inspections — an inspector's checklist run against a stage. Completing a
-- HOLD-POINT inspection with an overall pass drives the stage's is_validated (the
-- §10.5 gate) via InspectionService.complete — the inspection id is the validate()
-- `reference`, provenance-linking the flip to the checklist that justified it.
-- Non-hold-point inspections are QA records that inform without gating (§12.1).
-- `inspector_id`/`completed_at` are server-stamped (PROTECTED) on the gated complete
-- path — never a bare device write.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `inspections` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `project_id`    CHAR(36)     NOT NULL,
  `stage_id`      CHAR(36)     NULL COMMENT 'The gated stage, when this inspection is against one',
  `type`          VARCHAR(60)  NOT NULL COMMENT 'e.g. slab, frame, waterproofing, QA',
  `is_hold_point` TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Mirrors the stage — a hold-point inspection drives validation',
  `scheduled_at`  DATETIME     NULL,
  `inspector_id`  CHAR(36)     NULL COMMENT 'Server-stamped on complete — who ran it',
  `result`        ENUM('pending','pass','fail') NOT NULL DEFAULT 'pending',
  `completed_at`  DATETIME     NULL COMMENT 'Server-set on complete',
  `reference`     VARCHAR(100) NULL COMMENT 'Cert/form ref, e.g. BA2-0031',
  `document_id`   CHAR(36)     NULL COMMENT 'Signed report — image/document queue id',
  `notes`         TEXT         NULL,
  `device_id`     VARCHAR(100) NULL,
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_insp_project` (`project_id`),
  KEY `idx_insp_stage`   (`stage_id`),
  KEY `idx_insp_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_insp_org`       FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_insp_project`   FOREIGN KEY (`project_id`)  REFERENCES `projects` (`id`),
  CONSTRAINT `fk_insp_stage`     FOREIGN KEY (`stage_id`)    REFERENCES `project_stages` (`id`),
  CONSTRAINT `fk_insp_inspector` FOREIGN KEY (`inspector_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- inspection_items — the pass/fail checklist lines the inspector ticks off offline,
-- via /sync/push. Child-scoped: it carries no project_id of its own — its project is
-- resolved from its parent `inspections` row (§12.9), the same parent-derivation
-- Nexus's cook_session_lines uses.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `inspection_items` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `inspection_id` CHAR(36)     NOT NULL,
  `seq`           INT          NOT NULL DEFAULT 0,
  `description`   VARCHAR(255) NOT NULL,
  `result`        ENUM('pending','pass','fail','na') NOT NULL DEFAULT 'pending',
  `note`          VARCHAR(255) NULL,
  `photo_id`      CHAR(36)     NULL,
  `device_id`     VARCHAR(100) NULL,
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_items_inspection` (`inspection_id`),
  KEY `idx_items_cursor`     (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_item_org`         FOREIGN KEY (`org_id`)        REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_item_inspection`  FOREIGN KEY (`inspection_id`) REFERENCES `inspections` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- defects — the punch-list. Raised and closed through /sync/push (app-owned,
-- offline-first). `raised_by`/`closed_at`/`closed_by` are server-stamped (PROTECTED).
-- Open defects do NOT block stage completion in v1 (§12.5, owner decision #2) — only
-- hold points gate; this is tracked to closure separately.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `defects` (
  `id`               CHAR(36)     NOT NULL,
  `org_id`           CHAR(36)     NOT NULL,
  `project_id`       CHAR(36)     NOT NULL,
  `stage_id`         CHAR(36)     NULL,
  `raised_by`        CHAR(36)     NULL COMMENT 'Server-stamped from the session',
  `raised_at`        DATETIME     NULL,
  `location`         VARCHAR(160) NULL,
  `trade`            VARCHAR(60)  NULL,
  `description`      TEXT         NULL,
  `assigned_to`      CHAR(36)     NULL COMMENT 'users.id when the assignee is staff',
  `assigned_to_name` VARCHAR(120) NULL COMMENT 'Free text when not a staff user',
  `due_date`         DATE         NULL,
  `severity`         ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  `status`           ENUM('open','in_progress','closed') NOT NULL DEFAULT 'open',
  `closed_at`        DATETIME     NULL COMMENT 'Server-set when status -> closed',
  `closed_by`        CHAR(36)     NULL COMMENT 'Server-stamped from the closing session',
  `photo_id`         CHAR(36)     NULL,
  `photo_after_id`   CHAR(36)     NULL,
  `device_id`        VARCHAR(100) NULL,
  `is_deleted`       TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_defect_project` (`project_id`),
  KEY `idx_defect_status`  (`project_id`, `status`),
  KEY `idx_defect_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_defect_org`         FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_defect_project`     FOREIGN KEY (`project_id`)  REFERENCES `projects` (`id`),
  CONSTRAINT `fk_defect_stage`       FOREIGN KEY (`stage_id`)    REFERENCES `project_stages` (`id`),
  CONSTRAINT `fk_defect_raised_by`   FOREIGN KEY (`raised_by`)   REFERENCES `users` (`id`),
  CONSTRAINT `fk_defect_assigned_to` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_defect_closed_by`   FOREIGN KEY (`closed_by`)   REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- certificates — the statutory documents (BA2/BA3/OC, termite, waterproofing…) with
-- expiry tracking. Created app- or web-side (§12.6) — office upload OR an on-site
-- inspector attach. `expires_at` drives a portal "lapsing in 30 days" read; presence
-- at a hold point is advisory in v1, not a gate (owner decision #3). No money columns
-- -> no financialColumns.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `certificates` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `project_id`    CHAR(36)     NOT NULL,
  `stage_id`      CHAR(36)     NULL,
  `type`          VARCHAR(60)  NOT NULL COMMENT 'BA2, BA3, OC, termite, waterproofing, …',
  `reference`     VARCHAR(100) NULL,
  `issued_by`     VARCHAR(160) NULL COMMENT 'The surveyor/authority — free text, not a tenant user',
  `issued_at`     DATE         NULL,
  `expires_at`    DATE         NULL,
  `document_id`   CHAR(36)     NULL,
  `notes`         TEXT         NULL,
  `device_id`     VARCHAR(100) NULL,
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cert_project` (`project_id`),
  KEY `idx_cert_expiry`  (`org_id`, `expires_at`),
  KEY `idx_cert_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_cert_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_cert_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_cert_stage`   FOREIGN KEY (`stage_id`)   REFERENCES `project_stages` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Access matrix — activate quality.write (§9.3 reserved, §12.7). quality.validate
-- already exists (v006, §10.5) and stays inspector-only — projectManager
-- deliberately holds quality.write (schedule inspections, record certs, manage the
-- punch-list) but NOT quality.validate, preserving the independent-inspector
-- separation of duties. foreperson/tradie get neither in v1 (owner decision #4).
-- ============================================================================
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('projectManager','quality.write'),
  ('siteSupervisor','quality.write'),
  ('inspector','quality.write')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

-- Matrix changed → bump the version so the app cache-busts GET /auth/permissions.
UPDATE `access_meta` SET `v` = '4' WHERE `k` = 'matrix_version';
