-- ProjMan — migration v013: Step B of the corrective migration (DIRECTIVE 1,
-- servdesignspecification.md §7.3). Self-Registration → Introduction → Job Award —
-- replaces the MAOI-style single-step "PM issues a pairing QR" model with the
-- three-event chain the 18-Stage spec v3.4 requires. `pairing_tokens`/`devices`
-- (device pairing) are UNCHANGED — this is additive, a separate identity layer for
-- PERSON-to-person relationships (who may be Job-Awarded), not a replacement of
-- device pairing (which stays how a paired device gets a role).
--
-- Both tables are REST-mediated, not sync-registry tables: they're workflow state
-- (introduce once; sent -> accepted/declined once) rather than free-form field
-- editing, same reasoning P6a's `InspectionService.complete` used to stay REST
-- instead of forcing a workflow transition through /sync/push.
--
-- `project_payments` is new, minimal infrastructure — P7/P8 (Commercial/Accounting)
-- were never built, so there is no existing payments table scoped to a tenant's own
-- projects (`payments` in migration_v007 is eBizco's OWN SaaS subscription billing —
-- a different ledger entirely, wrong FK target for a construction deposit). This is
-- deliberately the smallest table that can anchor S9.9's deposit and carry what TPAR
-- needs (payee ABN via the Builder's org profile, amount, date) — not a P7/P8 preview.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- introductions — the QR business-card swap. No job implied; happens any time, years
-- before a project may exist. `device_signature` is the QR/signed-reference
-- primitive (v3.4 §1.1: resolved to rely on each party's own ordinary session/login
-- already established at Self-Registration, not a separate out-of-band PIN).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `introductions` (
  `id`               CHAR(36)     NOT NULL,
  `org_id`           CHAR(36)     NOT NULL,
  `party_a_id`       CHAR(36)     NOT NULL COMMENT 'users.id — who initiated the scan',
  `party_b_id`       CHAR(36)     NOT NULL COMMENT 'users.id — the other party',
  `introduced_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `initiated_by`     ENUM('app_qr_scan','veritrade_engage') NOT NULL DEFAULT 'app_qr_scan',
  `device_signature` VARCHAR(255) NULL COMMENT 'signed reference from the scanning device',
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_intro_org`     (`org_id`),
  KEY `idx_intro_party_a` (`party_a_id`),
  KEY `idx_intro_party_b` (`party_b_id`),
  CONSTRAINT `fk_intro_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_intro_party_a` FOREIGN KEY (`party_a_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_intro_party_b` FOREIGN KEY (`party_b_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- project_payments — the minimal, TPAR-relevant payment record. `tpar_reportable`
-- defaults TRUE since building & construction TPAR is mandatory (devroadmap.md §10);
-- a future P8/P9 pass may fold this into a real ledger, but the deposit anchor needs
-- somewhere real to point at today, not a placeholder boolean on job_awards itself.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `project_payments` (
  `id`              CHAR(36)     NOT NULL,
  `org_id`          CHAR(36)     NOT NULL,
  `project_id`      CHAR(36)     NOT NULL,
  `payee_user_id`   CHAR(36)     NOT NULL COMMENT 'users.id — who is being paid (the Builder at S9.9)',
  `amount`          DECIMAL(12,2) NOT NULL,
  `currency`        CHAR(3)      NOT NULL DEFAULT 'AUD',
  `purpose`         VARCHAR(60)  NOT NULL DEFAULT 'deposit' COMMENT 'deposit | progress_claim | other',
  `reference`       VARCHAR(100) NULL,
  `paid_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `tpar_reportable` TINYINT(1)   NOT NULL DEFAULT 1,
  `recorded_by`     CHAR(36)     NULL COMMENT 'users.id — server-stamped from the session',
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pay_project` (`project_id`),
  CONSTRAINT `fk_pay_org`     FOREIGN KEY (`org_id`)        REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_pay_project` FOREIGN KEY (`project_id`)    REFERENCES `projects` (`id`),
  CONSTRAINT `fk_pay_payee`  FOREIGN KEY (`payee_user_id`)  REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- job_awards — the formal, later, project-specific invitation. Server-side
-- constraint (enforced in JobAwardService, not just a UI convention): a row here may
-- only be created if an `introductions` row already exists between `from_user_id`
-- and `to_user_id` — PM cannot Job-Award a cold stranger.
--
-- `builder_engagement_type` is set at the same moment as the invitation (S9.6) and,
-- per Open Decision #17 (devroadmap.md §12), not changeable without its own audited
-- event — enforced in JobAwardService (no plain UPDATE path), not by a DB trigger,
-- matching this codebase's existing convention for "corrections create a new version,
-- never an edit" style rules (site_diary, certificates).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `job_awards` (
  `id`                       CHAR(36)     NOT NULL,
  `org_id`                   CHAR(36)     NOT NULL,
  `project_id`               CHAR(36)     NOT NULL,
  `from_user_id`             CHAR(36)     NOT NULL COMMENT 'users.id — the PM issuing it',
  `to_user_id`               CHAR(36)     NOT NULL COMMENT 'users.id — the invited Builder/Tradie/Foreperson/Subcontractor',
  `role_offered`             ENUM('builder','tradie','foreperson','subcontractor') NOT NULL,
  `status`                   ENUM('sent','accepted','declined') NOT NULL DEFAULT 'sent',
  `sent_at`                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `responded_at`             DATETIME     NULL,
  `response_channel`         ENUM('app','portal') NULL,
  `document_hash`            VARCHAR(128) NULL COMMENT 'frozen/hashed invitation, per §1.4 of the 18-Stage spec',
  `builder_engagement_type`  ENUM('employee','independent_fixed','independent_cost_plus') NULL
                             COMMENT 'role_offered=builder only; set at S9.6, immutable once set except via an audited event',
  `deposit_payment_id`       CHAR(36)     NULL COMMENT 'FK project_payments — S9.9, what actually makes acceptance binding',
  `created_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_award_project` (`project_id`),
  KEY `idx_award_to_user` (`to_user_id`, `status`),
  CONSTRAINT `fk_award_org`      FOREIGN KEY (`org_id`)         REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_award_project`  FOREIGN KEY (`project_id`)     REFERENCES `projects` (`id`),
  CONSTRAINT `fk_award_from`     FOREIGN KEY (`from_user_id`)   REFERENCES `users` (`id`),
  CONSTRAINT `fk_award_to`       FOREIGN KEY (`to_user_id`)     REFERENCES `users` (`id`),
  CONSTRAINT `fk_award_deposit`  FOREIGN KEY (`deposit_payment_id`) REFERENCES `project_payments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
