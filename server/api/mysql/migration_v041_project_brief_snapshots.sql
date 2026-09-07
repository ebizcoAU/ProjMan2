-- ProjMan — migration v041: project_brief_snapshots (xprojman-41 §3, confirmed
-- §8/§9, 2026-09-07). Append-only history of dated Project Brief PDFs — the
-- initial intake snapshot (variation_id NULL) plus one new snapshot per
-- approved variation (variation_id set), per the owner's own framing: a
-- correction/variation gets a fresh dated point-in-time confirmation between
-- both parties, not a silently-drifting live document.
--
-- Not named `document_signatures` (Portal's original §3 proposal) — v1 is a
-- timestamped, both-parties-viewable record with a plain ack flag, not a
-- cryptographic/legally-binding signature (§8's confirmed v1 descope) — the
-- name should say what it actually is. `acknowledged_by`/`acknowledged_at`
-- sit on the row itself (nullable) rather than a separate table: one snapshot
-- has at most one ack, a join table would be a 1:1 relationship pretending to
-- be 1:many.
--
-- acknowledged_by has no FK to `users` — the customer identity that will
-- someday ack a snapshot doesn't exist until xprojman-41 §1 (customer App
-- pairing) ships; a soft ref now avoids a migration reshuffle later, same
-- posture as `documents.entity_id`/`site_diary.supersedes_id` elsewhere in
-- this schema.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

CREATE TABLE IF NOT EXISTS `project_brief_snapshots` (
  `id`              CHAR(36)     NOT NULL,
  `org_id`          CHAR(36)     NOT NULL,
  `project_id`      CHAR(36)     NOT NULL,
  `variation_id`    CHAR(36)     NULL COMMENT 'FK variations.id — NULL for the initial/intake snapshot',
  `storage_key`     VARCHAR(255) NOT NULL COMMENT 'the PDF bytes, via lib/storage.js (same driver documents already uses)',
  `generated_by`    CHAR(36)     NOT NULL COMMENT 'users.id — the PM who formalized/re-issued',
  `generated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `acknowledged_by` CHAR(36)     NULL COMMENT 'soft ref — the customer identity, once xprojman-41 §1 exists',
  `acknowledged_at` DATETIME     NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pbs_project` (`project_id`, `generated_at`),
  KEY `idx_pbs_variation` (`variation_id`),
  CONSTRAINT `fk_pbs_org`       FOREIGN KEY (`org_id`)       REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_pbs_project`   FOREIGN KEY (`project_id`)   REFERENCES `projects` (`id`),
  CONSTRAINT `fk_pbs_variation` FOREIGN KEY (`variation_id`) REFERENCES `variations` (`id`),
  CONSTRAINT `fk_pbs_generator` FOREIGN KEY (`generated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
