-- ProjMan — migration v027: PM2-02 build (serverdesignspec §13, decisions #26-#28,
-- architecture approved 2026-07-22 in projman-02.md — this is code, not a new decision).
--
-- Three tables:
--   engagements   — the cross-org bridge. Grants an EXISTING home-org `users.id` a
--                   scoped slice of a DIFFERENT org's project, without ever creating a
--                   second `users` row for that person (users.email is globally unique,
--                   users.org_id is NOT NULL — §13.0 of the server spec explains why a
--                   parallel person-entity table is not needed: the identity anchor IS
--                   the existing users.id).
--   identities    — NOT a person record. A thin 1:1 evidence-aggregate companion to a
--                   home-org users.id (trust-score cache only).
--   attestations  — the evidence store. Queryable by the OWNING identity from any
--                   context; by the issuing org only for what that org itself issued.
--                   Deliberately NOT org_id-scoped as its primary key — subject_user_id
--                   is.
--
-- Also additive: two columns on `organisations` for the Ed25519 attestation-signing
-- keypair (projman-02 §10.1) — the migration this record promised got dropped when the
-- projman-03 slot was reused for CPC50220, so nowhere on `organisations` currently holds
-- an issuer key. Server-generated at org creation, private half envelope-encrypted at
-- rest (per-org data key wrapped by a KMS master key in the AU deploy); public half
-- freely distributable for signature verification. Generation/wrapping is application
-- code (AttestationService / org-creation flow), not this migration's concern.
--
-- NO MATRIX BUMP: no new permission is introduced. `panel.manage` (existing, v012) gates
-- engagement initiate/confirm/revoke; `/identity/*` is self-scoped by construction, the
-- same shape `self` scope class already covers. The `engagement` scope_class VALUE has
-- existed in `scopeClassFor`'s doc comment since §7.1 was written but was never wired to
-- an actual resolver — that resolver is application code (SyncService.pullDeltas), not a
-- matrix/schema change.
--
-- source_type is VARCHAR(40), not an ENUM: the build directive listing five hook sources
-- ("task_complete, inspection, diary_entry, stage_complete, invoice_matched — plus future
-- types") is only honest as free text. An ENUM would need its own migration for every
-- future emitter, defeating the stated extensibility.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ── organisations: the attestation-signing keypair (projman-02 §10.1) ────────────────
ALTER TABLE `organisations`
  ADD COLUMN `attestation_key_public` TEXT NULL
    COMMENT 'Ed25519 public key, base64 — freely distributable, verifies this org''s attestation signatures'
    AFTER `status`,
  ADD COLUMN `attestation_key_encrypted` TEXT NULL
    COMMENT 'Ed25519 private key, envelope-encrypted at rest (per-org data key wrapped by KMS master key) — never leaves the server decrypted'
    AFTER `attestation_key_public`,
  ADD COLUMN `attestation_key_created_at` DATETIME NULL
    AFTER `attestation_key_encrypted`;

-- ============================================================================
-- engagements — cross-org bridge (Decision A1+B2, projman-02 §4/§5). Lives in the
-- ENGAGING org (`org_id`), points at a home-org person by `identity_user_id`. No FK to
-- a project_members row — this table IS the alternative to needing one, because the
-- global-unique-email constraint on `users` means a second org can never hold its own
-- `users` row for the same person (§13.0).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `engagements` (
  `id`                CHAR(36)     NOT NULL,
  `org_id`            CHAR(36)     NOT NULL COMMENT 'the ENGAGING org, not the identity''s home org',
  `project_id`        CHAR(36)     NOT NULL,
  `identity_user_id`  CHAR(36)     NOT NULL COMMENT 'users.id — the person''s home-org row, wherever it lives',
  `role`              ENUM('builder','tradie','foreperson','subcontractor','inspector') NOT NULL,
  `scope_json`        JSON         NOT NULL COMMENT 'the resolved pull slice: {project_id, stage_range?}',
  `status`            ENUM('pending','active','revoked') NOT NULL DEFAULT 'pending',
  `initiated_by`      CHAR(36)     NOT NULL COMMENT 'users.id — the engaging org''s principal',
  `granted_at`        DATETIME     NULL,
  `revoked_at`        DATETIME     NULL,
  `is_deleted`        TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `server_updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_engagement_org_project_identity` (`org_id`, `project_id`, `identity_user_id`),
  KEY `idx_engagement_identity` (`identity_user_id`, `status`),
  KEY `idx_engagement_org_status` (`org_id`, `status`),
  CONSTRAINT `fk_engagement_org`      FOREIGN KEY (`org_id`)           REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_engagement_project`  FOREIGN KEY (`project_id`)       REFERENCES `projects` (`id`),
  CONSTRAINT `fk_engagement_identity` FOREIGN KEY (`identity_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_engagement_initiator` FOREIGN KEY (`initiated_by`)    REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- identities — NOT a person record (§13.0). A thin evidence-aggregate companion,
-- 1:1 with a home-org users.id. Exists so trust-score caching has a row to hang off
-- without bloating `users` with cross-cutting columns.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `identities` (
  `user_id`                  CHAR(36)      NOT NULL COMMENT 'PK — FK users.id, home org',
  `trust_score_cache`        DECIMAL(5,2)  NULL,
  `trust_score_computed_at`  DATETIME      NULL COMMENT '24h cache, event-invalidated on new attestation (projman-02 §10.3)',
  `created_at`               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_identities_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- attestations — the evidence store. Primary access key is `subject_user_id`, NOT
-- `org_id` — the whole point is that a person's evidence outlives, and spans, any one
-- tenant relationship. `issuing_org_id` is kept for the org-side "what did I issue"
-- query and for anonymisation at read time (decision #28: redacted for third-party
-- reads, e.g. VeriTrade; always visible to the subject themselves).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `attestations` (
  `id`                     CHAR(36)     NOT NULL,
  `subject_user_id`        CHAR(36)     NOT NULL COMMENT 'users.id — whose evidence this is (the owner)',
  `issuing_org_id`         CHAR(36)     NOT NULL COMMENT 'organisations.id — anonymised in third-party reads (#28)',
  `engagement_id`          CHAR(36)     NULL COMMENT 'FK engagements.id when emitted under a cross-org grant; NULL when emitted in the person''s home org',
  `source_type`            VARCHAR(40)  NOT NULL COMMENT 'e.g. task_complete, inspection, diary_entry, stage_complete, invoice_matched — free text, not an enum (extensible)',
  `source_id`              CHAR(36)     NULL COMMENT 'soft ref to the row that triggered emission — no FK, polymorphic across many tables',
  `payload_json`           JSON         NOT NULL COMMENT 'frozen evidence content — same evidentiary discipline as job_awards.document_hash',
  `signature`              VARCHAR(255) NOT NULL COMMENT 'Ed25519 signature, base64 — signed by the ISSUING org''s key at emission',
  `signature_valid`        TINYINT(1)   NULL COMMENT 'cached verify result (projman-02 §10.2); re-verified on issuer-key rotation',
  `signature_verified_at`  DATETIME     NULL,
  `created_at`             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_attest_subject` (`subject_user_id`, `created_at`),
  KEY `idx_attest_issuing_org` (`issuing_org_id`),
  KEY `idx_attest_engagement` (`engagement_id`),
  CONSTRAINT `fk_attest_subject`     FOREIGN KEY (`subject_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_attest_issuing_org` FOREIGN KEY (`issuing_org_id`)  REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_attest_engagement`  FOREIGN KEY (`engagement_id`)   REFERENCES `engagements` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No role_permissions insert and no matrix bump: see the header note above.
