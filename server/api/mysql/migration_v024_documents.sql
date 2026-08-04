-- ProjMan — migration v024: the Documents/Upload module (contract locked in xprojman-21).
--
-- The one polymorphic document store behind all FIVE capture surfaces (inspection photo, defect
-- photo, certificate, site-diary photo, delivery docket) — plus office/web uploads. This is what
-- the app team's offline image queue (xprojman-22) has been held on.
--
-- THE LOAD-BEARING DESIGN (xprojman-21 P1): the link is document → owner, carried at capture.
-- `entity_id` is the OWNING ROW'S OWN APP-MINTED UUID — the same id the app holds locally the
-- moment the photo is taken, whether or not that row has synced yet. Every domain row in ProjMan2
-- is app-PK'd (SyncService.pushRecord takes `incoming.id = localId`), so there is no separate
-- server id to wait for. The document self-describes its owner on upload; the owning row is never
-- patched; either side may sync first. That is what makes the link order-independent.
--
-- `client_ref` is a DIFFERENT id doing a DIFFERENT job: it is the app-minted UPLOAD idempotency
-- key. An offline retry of the same capture returns the same `document_id` instead of a duplicate.
-- Two ids, two jobs — client_ref de-dups the upload, entity_id names what the photo is of.
--
-- `documents` is REST-mediated, NOT a sync-registry table: it carries bytes, which the JSON sync
-- delta cannot. Metadata reaches the app via GET /documents?entity_type=&entity_id=, not the pull.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- documents — one row per stored file.
--
-- `entity_type`/`entity_id` are a SOFT polymorphic ref by design: no FK is possible (the target
-- table varies per row) and, more importantly, a document may legitimately arrive BEFORE its
-- owning row syncs. A hard constraint would reintroduce exactly the ordering dependency
-- xprojman-21 P1 removes. Integrity is enforced at read time by org + project scoping instead.
--
-- sha256/size_bytes/mime_type are SERVER-DERIVED on receipt (P3) — the server is the one
-- authority for them; anything the client sends is advisory and its own derivation wins.
--
-- `storage_key` is the abstraction seam: local disk in dev, object store in prod, and the
-- two-phase shape is preserved so presigned direct-to-blob can be added with no client rewrite.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `documents` (
  `id`                CHAR(36)      NOT NULL COMMENT 'SERVER-minted document_id (xprojman-19 §1)',
  `org_id`            CHAR(36)      NOT NULL,
  `project_id`        CHAR(36)      NULL COMMENT 'NULL = org-level/unattached; drives read scoping when set',
  `client_ref`        CHAR(36)      NOT NULL COMMENT 'APP-minted upload idempotency key — dedup on (org_id, client_ref)',
  `entity_type`       VARCHAR(40)   NULL COMMENT 'inspection_item|defect|certificate|site_diary|delivery (NULL = unattached)',
  `entity_id`         CHAR(36)      NULL COMMENT 'the OWNING ROW''S OWN app-minted UUID — soft ref, no FK by design',
  `kind`              VARCHAR(40)   NOT NULL DEFAULT 'general'
                        COMMENT 'inspection_photo|defect_photo|certificate|site_diary_photo|delivery_docket|general',
  `original_filename` VARCHAR(255)  NULL,
  `mime_type`         VARCHAR(120)  NULL COMMENT 'SERVER-sniffed from the bytes',
  `size_bytes`        BIGINT        NOT NULL DEFAULT 0 COMMENT 'SERVER-derived',
  `sha256`            CHAR(64)      NULL COMMENT 'SERVER-derived integrity hash',
  `storage_key`       VARCHAR(255)  NOT NULL COMMENT 'opaque key into the storage driver (disk/object store)',
  `uploaded_by`       CHAR(36)      NULL,
  `is_deleted`        TINYINT(1)    NOT NULL DEFAULT 0,
  -- MILLISECOND precision, unlike every other table here, and deliberately: the app's offline
  -- queue flushes a whole capture session on reconnect, so N photos for one entity land inside
  -- the SAME SECOND. At DATETIME(0) their "newest first" order is undefined — the gallery would
  -- shuffle between reads. DATETIME(3) makes the contract's ordering actually hold.
  `created_at`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- The idempotency guarantee itself: a retried offline upload collides here and is answered
  -- with the ORIGINAL document_id rather than creating a second row.
  UNIQUE KEY `uq_doc_org_client_ref` (`org_id`, `client_ref`),
  KEY `idx_doc_entity`  (`entity_type`, `entity_id`),
  KEY `idx_doc_project` (`project_id`),
  KEY `idx_doc_org`     (`org_id`, `is_deleted`),
  KEY `idx_doc_sha`     (`sha256`),
  CONSTRAINT `fk_doc_org`      FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_doc_project`  FOREIGN KEY (`project_id`)  REFERENCES `projects` (`id`),
  CONSTRAINT `fk_doc_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- documents.write — curate the document register (delete a wrong upload).
--
-- Named in the build directive as the alternative to `quality.write` on DELETE. It is granted to
-- the capturers who do NOT already hold quality.write but who own a capture surface:
--   • foreperson — site diary photos, delivery dockets
--   • builder    — delivery dockets (and the Builder holds NO quality.write at all)
-- projectManager / siteSupervisor / inspector reach DELETE through their existing `quality.write`,
-- so they are not re-granted here (a redundant row would just be matrix noise).
-- `tradie` is deliberately EXCLUDED: they tick progress, they do not curate the register.
-- ============================================================================
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('foreperson', 'documents.write'),
  ('builder',    'documents.write')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

-- Matrix changed → bump so clients cache-bust GET /auth/permissions. v10 → v11.
UPDATE `access_meta` SET `v` = '11' WHERE `k` = 'matrix_version';
