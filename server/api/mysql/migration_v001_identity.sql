-- ProjMan2 — migration v001: identity, devices, pairing, sessions, sync, audit
-- Database: c1projman2 (new — the legacy c1projman is not migrated)
-- Region:   Australia/WA. AUD, Australia/Perth, ABN.
--
-- Ported from the Nexus identity surface (users / user_devices / user_sessions /
-- device_registry / pairing_tokens / pairing_requests / sync_history) with three
-- structural changes:
--
--   1. `businesses` + `business_sites` collapse into `organisations` — the builder
--      company. One tenant, one org. Every domain table carries `org_id` and the
--      server filters on the token's org on both push and pull.
--   2. CCCD + 6-digit PIN identity is replaced by email + password. ProjMan2 is
--      Australian; there is no national ID scan.
--   3. Role lives on the DEVICE binding as well as the user, so a shared site
--      tablet holds a role without a shared password (MAOI's contract, kept).
--
-- Every table that syncs carries: org_id, device_id, is_deleted, updated_at (BIGINT
-- Unix ms, client clock) and server_updated_at (DATETIME(3), server clock). The pull
-- cursor reads server_updated_at ONLY — client clocks are not trusted for ordering.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- organisations — the subscribing builder. The tenant boundary.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `organisations` (
  `id`             CHAR(36)     NOT NULL,
  `name`           VARCHAR(255) NOT NULL,
  `abn`            VARCHAR(11)  NULL COMMENT '11 digits, no spaces',
  -- 'no' = failed/absent, 'checksum' = passed modulus-89, 'abr' = confirmed against
  -- the ABR. TPAR and withholding decisions later depend on knowing which.
  `abn_validated`  ENUM('no','checksum','abr') NOT NULL DEFAULT 'no',
  `abn_checked_at` DATETIME     NULL,
  `address`        VARCHAR(255) NULL,
  `suburb`         VARCHAR(100) NULL,
  `state`          ENUM('WA','SA','NT','QLD','NSW','VIC','TAS','ACT') NULL,
  `postcode`       VARCHAR(4)   NULL,
  `phone`          VARCHAR(30)  NULL,
  `email`          VARCHAR(255) NULL,
  `timezone`       VARCHAR(64)  NOT NULL DEFAULT 'Australia/Perth',
  `currency`       CHAR(3)      NOT NULL DEFAULT 'AUD',
  `plan`           ENUM('trial','starter','builder','enterprise') NOT NULL DEFAULT 'trial',
  `status`         ENUM('active','suspended','disabled') NOT NULL DEFAULT 'active',
  `trial_ends_at`  DATETIME     NULL,
  `device_id`      VARCHAR(100) NULL COMMENT 'Device that last wrote this row — pull echo-skip',
  `is_deleted`     TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     BIGINT       NULL COMMENT 'Unix ms, client clock — display only',
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_org_abn` (`abn`),
  KEY `idx_org_cursor` (`server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- users — a person with a login, inside exactly one organisation.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `users` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `email`         VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL COMMENT 'bcrypt cost 12',
  `full_name`     VARCHAR(255) NOT NULL,
  `mobile`        VARCHAR(30)  NULL,
  `role`          ENUM('org_admin','project_developer','project_manager',
                       'supervisor','tradie','customer') NOT NULL DEFAULT 'supervisor',
  `status`        ENUM('active','suspended','disabled') NOT NULL DEFAULT 'active',
  `disabled_reason`   TEXT     NULL,
  `suspended_until`   DATETIME NULL,
  -- Bumped on password reset. Any access token minted before the bump is refused,
  -- so a reset kills every live session without a table scan.
  `security_version`  INT      NOT NULL DEFAULT 1,
  `force_logout_flag` TINYINT(1) NOT NULL DEFAULT 0,
  `last_login_at` DATETIME     NULL,
  `device_id`     VARCHAR(100) NULL,
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- Email is globally unique, not per-org: it is the login identifier, and a person
  -- typing an address must resolve to exactly one account without picking a tenant.
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_org`    (`org_id`),
  KEY `idx_users_cursor` (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_users_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- devices — a paired handset or site tablet. Role lives HERE, not only on the user.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `devices` (
  `id`          CHAR(36)     NOT NULL,
  `org_id`      CHAR(36)     NOT NULL,
  `user_id`     CHAR(36)     NULL COMMENT 'NULL for a shared site tablet with no personal owner',
  `device_uid`  VARCHAR(100) NOT NULL COMMENT 'Stable per-install id from the app',
  `device_name` VARCHAR(255) NULL,
  `platform`    VARCHAR(50)  NULL COMMENT 'ios | android | web',
  `model`       VARCHAR(100) NULL,
  `os_version`  VARCHAR(50)  NULL,
  `app_version` VARCHAR(50)  NULL,
  `role`        ENUM('org_admin','project_developer','project_manager',
                     'supervisor','tradie','customer') NOT NULL DEFAULT 'supervisor',
  `is_primary`  TINYINT(1)   NOT NULL DEFAULT 0,
  `status`      ENUM('active','revoked','suspended') NOT NULL DEFAULT 'active',
  `paired_at`   DATETIME     NULL,
  `paired_by`   CHAR(36)     NULL COMMENT 'user_id that confirmed the pairing',
  `last_seen_at`DATETIME     NULL,
  `last_seen_ip`VARCHAR(45)  NULL,
  `revoked_at`  DATETIME     NULL,
  `device_id`   VARCHAR(100) NULL,
  `is_deleted`  TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- One row per physical device per org. A device_uid may legitimately appear under
  -- two orgs (a contractor's phone), so the org is part of the key.
  UNIQUE KEY `uq_devices_org_uid` (`org_id`, `device_uid`),
  KEY `idx_devices_user`   (`user_id`),
  KEY `idx_devices_cursor` (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_devices_org`  FOREIGN KEY (`org_id`)  REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_devices_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- sessions — one row per issued token pair.
--
-- is_authoritative carries MAOI's single-writer-per-entity contract (XF-27) into
-- ProjMan2: exactly one session per (user, org) holds the right to push offline
-- work. A site tablet is far likelier to be lost or destroyed than an office
-- machine, so the device-loss handoff is ported with it.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `sessions` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `user_id`       CHAR(36)     NOT NULL,
  `device_id`     VARCHAR(100) NOT NULL DEFAULT 'unknown' COMMENT 'device_uid, not devices.id',
  `access_token`  TEXT         NOT NULL,
  `refresh_token` CHAR(36)     NOT NULL COMMENT 'Opaque UUID, also embedded as the access token jti',
  `ip_address`    VARCHAR(45)  NULL,
  `user_agent`    TEXT         NULL,
  `issued_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`    DATETIME     NOT NULL,
  `revoked_at`    DATETIME     NULL,
  `is_authoritative` TINYINT(1) NOT NULL DEFAULT 0,
  `authority_since`  DATETIME  NULL,
  `last_sync_at`     DATETIME  NULL,
  `last_pending_count` INT     NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sessions_refresh` (`refresh_token`),
  KEY `idx_sessions_user`   (`user_id`, `revoked_at`),
  KEY `idx_sessions_device` (`user_id`, `device_id`),
  CONSTRAINT `fk_sessions_org`  FOREIGN KEY (`org_id`)  REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- pairing_tokens — QR pairing, primary device → new device, with a role.
--
-- `nonce_hash` is SHA-256 of the raw nonce. The raw value exists only in the QR
-- code and in the claiming request; it is never at rest.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `pairing_tokens` (
  `id`           CHAR(36)     NOT NULL,
  `org_id`       CHAR(36)     NOT NULL,
  `initiated_by` CHAR(36)     NOT NULL COMMENT 'users.id of the person holding the primary device',
  `nonce_hash`   CHAR(64)     NOT NULL COMMENT 'SHA-256 hex of the raw nonce — raw is never stored',
  `role`         ENUM('org_admin','project_developer','project_manager',
                      'supervisor','tradie','customer') NOT NULL,
  `label`        VARCHAR(255) NULL COMMENT 'e.g. "Site tablet — Lot 42"',
  `assign_user_id` CHAR(36)   NULL COMMENT 'Optional: bind the device to a specific user',
  `status`       ENUM('pending','requested','confirmed','rejected','expired') NOT NULL DEFAULT 'pending',
  `device_uid`   VARCHAR(100) NULL COMMENT 'Set when the new device submits the scanned payload',
  `device_name`  VARCHAR(255) NULL,
  `platform`     VARCHAR(50)  NULL,
  `model`        VARCHAR(100) NULL,
  `claimed_device_id` CHAR(36) NULL COMMENT 'devices.id created on confirm',
  `expires_at`   DATETIME     NOT NULL,
  `confirmed_at` DATETIME     NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pairing_nonce` (`nonce_hash`),
  KEY `idx_pairing_org_status` (`org_id`, `status`),
  KEY `idx_pairing_expires`    (`expires_at`),
  CONSTRAINT `fk_pairing_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- recovery_tokens — password reset and device-loss recovery.
-- The code is hashed. `attempts` gives per-code lockout independent of the IP limiter.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `recovery_tokens` (
  `id`         CHAR(36)     NOT NULL,
  `user_id`    CHAR(36)     NOT NULL,
  `code_hash`  VARCHAR(255) NOT NULL,
  `purpose`    ENUM('password_reset','device_loss') NOT NULL DEFAULT 'password_reset',
  `attempts`   INT          NOT NULL DEFAULT 0,
  `expires_at` DATETIME     NOT NULL,
  `used_at`    DATETIME     NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_recovery_user` (`user_id`, `purpose`, `used_at`),
  CONSTRAINT `fk_recovery_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- audit_log — from day one, per the brief.
--
-- Construction disputes are evidentiary. "Who marked that stage complete, from
-- which device" is a question asked in anger months later, and it cannot be
-- reconstructed after the fact.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id`        BIGINT       NOT NULL AUTO_INCREMENT,
  `org_id`    CHAR(36)     NULL COMMENT 'NULL only for pre-registration events',
  `user_id`   CHAR(36)     NULL,
  `device_id` VARCHAR(100) NULL,
  `action`    VARCHAR(64)  NOT NULL COMMENT 'e.g. auth.login, pairing.confirm, device.revoke',
  `entity`    VARCHAR(64)  NULL,
  `entity_id` VARCHAR(100) NULL,
  `detail`    JSON         NULL,
  `ip`        VARCHAR(45)  NULL,
  `created_at`DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_audit_org_time` (`org_id`, `created_at`),
  KEY `idx_audit_entity`   (`entity`, `entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- sync_history — one row per push/pull cycle. Feeds GET /sync/status.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `sync_history` (
  `id`             BIGINT      NOT NULL AUTO_INCREMENT,
  `org_id`         CHAR(36)    NOT NULL,
  `user_id`        CHAR(36)    NOT NULL,
  `device_id`      VARCHAR(100) NULL,
  `sync_type`      ENUM('push','pull','full') NOT NULL,
  `table_name`     VARCHAR(64) NULL,
  `records_synced` INT         NOT NULL DEFAULT 0,
  `status`         ENUM('success','partial','failed') NOT NULL DEFAULT 'success',
  `error_message`  TEXT        NULL,
  `started_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at`   DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sync_org_device` (`org_id`, `device_id`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
