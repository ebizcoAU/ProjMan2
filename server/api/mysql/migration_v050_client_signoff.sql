-- ProjMan2 — migration v050: client final sign-off (S18.14) + the Stage 18 requirement swap.
-- xprojman-51 (Server response §6, 2026-10-14) and xprojman-43 §14 O1.
--
--   handover_packs     one row per project: the server-computed handover pack (every non-deleted
--                      document with a handover kind), its canonical manifest and pack_hash.
--                      Server-owned, pull-only — the App needs it offline at the house.
--   client_signoffs    the client's frozen accept/decline of a specific pack_hash. Create-only on
--                      sync (assisted_device) and REST (paper_upload / client_self). FROZEN AT THE
--                      DATABASE: triggers refuse every UPDATE and DELETE — the first DB-enforced
--                      freeze in the schema (v3.4 §1.4; server spec §15.6 R13).
--   hold_point_requirements.auto_source
--                      'client_signoff' marks the S18.14 row the server satisfies itself; the
--                      manual satisfy endpoint refuses it.
--
-- Stage 18 swap (x43 §14 O1): S18.12 (accountant depreciation approval) stops blocking, and
-- S18.14 (client sign-off) becomes the blocking requirement. Requirements are seeded when a
-- programme is created, so open projects are backfilled here; completed Stage 18s are untouched.

CREATE TABLE IF NOT EXISTS `handover_packs` (
  `id`                CHAR(36)     NOT NULL COMMENT '= project_id (one pack per project)',
  `org_id`            CHAR(36)     NOT NULL,
  `project_id`        CHAR(36)     NOT NULL,
  `pack_hash`         CHAR(64)     NULL COMMENT 'SHA-256 hex of the canonical manifest; NULL when the pack is empty',
  `manifest`          JSON         NOT NULL COMMENT '[{document_id, kind, file_name, sha256}] sorted by document_id',
  `document_count`    INT          NOT NULL DEFAULT 0,
  `computed_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `device_id`         VARCHAR(100) NULL,
  `is_deleted`        TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        BIGINT       NULL,
  `server_updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hp_project` (`project_id`),
  KEY `idx_hp_cursor` (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_hp_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_hp_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_signoffs` (
  `id`                    CHAR(36)     NOT NULL,
  `org_id`                CHAR(36)     NOT NULL,
  `project_id`            CHAR(36)     NOT NULL,
  `step_code`             VARCHAR(10)  NOT NULL DEFAULT 'S18.14' COMMENT 'S18.14 now; S7.3 (DA sign-off) later',
  `method`                ENUM('assisted_device','paper_upload','client_self') NOT NULL,
  `pack_hash`             CHAR(64)     NOT NULL,
  `manifest`              JSON         NULL COMMENT 'the manifest the signer saw',
  `decision`              ENUM('accepted','declined') NOT NULL,
  `decline_reasons`       TEXT         NULL,
  `signer_user_id`        CHAR(36)     NULL COMMENT 'client_self only',
  `signer_name`           VARCHAR(120) NOT NULL,
  `witnessed_by`          CHAR(36)     NULL COMMENT 'server-stamped: the pushing/uploading PM; NULL only for client_self',
  `signature_document_id` CHAR(36)     NULL COMMENT 'signature image (assisted) or scan (paper)',
  `signed_at`             DATETIME     NOT NULL COMMENT 'client-writable, Perth wall-clock',
  `counted`               TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'server-set: pack_hash matched the current pack on arrival',
  `frozen_at`             DATETIME     NOT NULL COMMENT 'server-stamped on insert',
  `supersedes_id`         CHAR(36)     NULL,
  `device_id`             VARCHAR(100) NULL,
  `is_deleted`            TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'never set: the row is frozen',
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            BIGINT       NULL,
  `server_updated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cs_project` (`project_id`, `step_code`, `frozen_at`),
  KEY `idx_cs_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_cs_org`      FOREIGN KEY (`org_id`)       REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_cs_project`  FOREIGN KEY (`project_id`)   REFERENCES `projects` (`id`),
  CONSTRAINT `fk_cs_witness`  FOREIGN KEY (`witnessed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_cs_signer`   FOREIGN KEY (`signer_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `chk_cs_reasons` CHECK (`decision` = 'accepted' OR `decline_reasons` IS NOT NULL),
  CONSTRAINT `chk_cs_witness` CHECK (`method` = 'client_self' OR `witnessed_by` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No update path, ever (S7.3 discipline, which S18.14 copies). Enforced here, not just in code.
CREATE TRIGGER `trg_client_signoffs_no_update` BEFORE UPDATE ON `client_signoffs`
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'client_signoffs rows are frozen (S18.14)';
CREATE TRIGGER `trg_client_signoffs_no_delete` BEFORE DELETE ON `client_signoffs`
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'client_signoffs rows are frozen (S18.14)';

ALTER TABLE `hold_point_requirements`
  ADD COLUMN `auto_source` VARCHAR(30) NULL
    COMMENT 'set when the SERVER satisfies the row (client_signoff); manual satisfy refuses it'
    AFTER `blocks_progress`;

-- x43 §14 O1: S18.12 no longer blocks Stage 18 (asset register exported to the accountant).
UPDATE `hold_point_requirements`
   SET `blocks_progress` = 0
 WHERE `label` = 'Fixed-asset/depreciation draft approval (S18.12)';

-- S18.14 on every open Stage 18 (seq 18, not complete) that doesn't already have it.
INSERT INTO `hold_point_requirements`
  (`id`, `org_id`, `project_id`, `stage_id`, `label`, `required_role`, `inspection_type`,
   `jurisdiction`, `blocks_progress`, `auto_source`)
SELECT UUID(), ps.org_id, ps.project_id, ps.id, 'Client final sign-off (S18.14)', 'projectManager',
       'internal_qa', NULL, 1, 'client_signoff'
  FROM `project_stages` ps
 WHERE ps.seq = 18 AND ps.status <> 'complete' AND ps.is_deleted = 0
   AND NOT EXISTS (SELECT 1 FROM `hold_point_requirements` h
                    WHERE h.stage_id = ps.id AND h.auto_source = 'client_signoff');

-- Take an assisted or paper sign-off: the PM only, until the Owner rules on siteSupervisor.
-- `handover.signoff` (the client's own self-sign) is checked in code but granted to no role until
-- xprojman-50 pairing ships.
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('projectManager', 'handover.witness');

UPDATE `access_meta` SET `v` = '18' WHERE `k` = 'matrix_version';
