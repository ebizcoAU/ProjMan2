-- ProjMan — migration v021: P7c Variations & Contracts (xprojman-10 §4c, owner-approved).
-- Both open decisions locked (Manager 2026-07-31):
--   Retention  → model `retention_pct` on the contract now; the per-claim withholding +
--                release-at-practical-completion flow is deferred ("release flow later").
--   Variations → build server-side NOW, but `variations.approve` is DORMANT until the Client
--                portal (P10): it's held only by the `client` role, and no client can reach
--                the tenant portal yet — same posture as the VeriTrade endpoints. Buildable
--                and testable up to the approval boundary; not exercisable end-to-end until P10.
--
-- REST-mediated workflow tables (like P7a/P7b), not sync-registry.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- contracts — the head contract (PM↔Client or PM↔Builder) and subcontracts
-- (Builder↔trade sub) / supply contracts. `party_type='subcontractor'` covers the Builder
-- as the largest-scope subcontracted entity (portaldesignspec §1.1). `retention_pct` is the
-- retention model's anchor; the withholding/release flow that consumes it is deferred.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `contracts` (
  `id`             CHAR(36)      NOT NULL,
  `org_id`         CHAR(36)      NOT NULL,
  `project_id`     CHAR(36)      NOT NULL,
  `party_type`     ENUM('client','subcontractor','supplier') NOT NULL,
  `party_user_id`  CHAR(36)      NULL COMMENT 'the counterparty user (Builder/sub) when in-org',
  `party_name`     VARCHAR(200)  NULL COMMENT 'free-text / external party fallback',
  `title`          VARCHAR(200)  NULL,
  `contract_value` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `retention_pct`  DECIMAL(5,2)  NOT NULL DEFAULT 0 COMMENT 'e.g. 5.00 = 5%; withholding/release deferred',
  `status`         ENUM('draft','active','completed','terminated') NOT NULL DEFAULT 'draft',
  `created_by`     CHAR(36)      NULL,
  `is_deleted`     TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contract_project` (`project_id`, `party_type`),
  CONSTRAINT `fk_contract_org`     FOREIGN KEY (`org_id`)        REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_contract_project` FOREIGN KEY (`project_id`)    REFERENCES `projects` (`id`),
  CONSTRAINT `fk_contract_party`   FOREIGN KEY (`party_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- variations — the PM-raised change, Client-approved (variations.approve DORMANT until P10).
-- `amount` is a signed adjustment to the contract value (+ add, − omit). An approved variation
-- adjusts the contract's EFFECTIVE value (contract_value + Σ approved variations), computed at
-- read time — it does NOT write the project_stages cost columns (those stay P7a/P7b's).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `variations` (
  `id`               CHAR(36)      NOT NULL,
  `org_id`           CHAR(36)      NOT NULL,
  `project_id`       CHAR(36)      NOT NULL,
  `contract_id`      CHAR(36)      NULL COMMENT 'the contract this varies',
  `variation_number` INT           NOT NULL DEFAULT 1 COMMENT 'sequential per project',
  `description`      VARCHAR(500)  NOT NULL,
  `amount`          DECIMAL(14,2)  NOT NULL DEFAULT 0 COMMENT 'signed adjustment to contract value',
  `status`           ENUM('draft','submitted','approved','declined') NOT NULL DEFAULT 'submitted',
  `raised_by`        CHAR(36)      NULL,
  `approved_by`      CHAR(36)      NULL,
  `approved_at`      DATETIME      NULL,
  `is_deleted`       TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_variation_project` (`project_id`, `status`),
  KEY `idx_variation_contract` (`contract_id`),
  CONSTRAINT `fk_variation_org`      FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_variation_project`  FOREIGN KEY (`project_id`)  REFERENCES `projects` (`id`),
  CONSTRAINT `fk_variation_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Permissions (§7.2). variations.raise = PM; variations.approve = client (DORMANT — the
-- client role has no tenant-portal session path until P10, so nobody can exercise approve
-- yet; the gate is real and in place for when P10 lands). Contract writes reuse the existing
-- money.write (a commercial document, same as estimates). matrix_version 8 → 9.
-- ============================================================================
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('projectManager', 'variations.raise'),
  ('client',         'variations.approve')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

UPDATE `access_meta` SET `v` = '9' WHERE `k` = 'matrix_version';
