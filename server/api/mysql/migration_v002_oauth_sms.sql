-- ProjMan2 — migration v002: OAuth sign-in, SMS mobile verification, AU onboarding
--
-- Australian market: no national-ID scan (that was MAOI's CCCD). Identity here is
-- email + password, three OAuth providers (Google / Microsoft / Facebook), and an
-- SMS-verified +61 mobile. Post-auth we collect the AU business shape (ABN, state,
-- business type, GST status).
--
-- Design notes:
--   • A user may hold SEVERAL sign-in methods for one account — password + Google +
--     Microsoft — all keyed on the same email. Provider links live in their own
--     table (`auth_identities`), one row per (provider, provider_sub), so linking a
--     new provider is an insert, not a schema change.
--   • `password_hash` becomes NULLABLE: an OAuth-only account has no password.
--   • Every user still belongs to exactly ONE org (the Phase-1 invariant is kept).
--     An OAuth first-sign-in creates the org immediately, like /auth/register, but
--     leaves `onboarding_complete = 0` so the app shows the AU onboarding screen.

SET NAMES utf8mb4;

-- ── users: password optional, onboarding + mobile-verified state ──────────────
ALTER TABLE `users`
  MODIFY COLUMN `password_hash` VARCHAR(255) NULL
    COMMENT 'bcrypt cost 12 — NULL for an OAuth-only account';

ALTER TABLE `users`
  ADD COLUMN `onboarding_complete` TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '0 until the AU onboarding step is done. Existing + email/password users = 1; OAuth first sign-in = 0.'
    AFTER `status`,
  ADD COLUMN `mobile_verified` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Set by /auth/sms/verify against a +61 mobile'
    AFTER `mobile`;

-- ── organisations: the AU business shape collected at onboarding ──────────────
-- (name, abn, state, postcode already exist from v001.)
ALTER TABLE `organisations`
  ADD COLUMN `business_type` ENUM('sole_trader','partnership','company','trust') NULL
    COMMENT 'AU legal structure — drives tax treatment later'
    AFTER `abn_checked_at`,
  ADD COLUMN `gst_registered` TINYINT(1) NULL
    COMMENT 'NULL = not yet stated. Registered builders charge + claim GST.'
    AFTER `business_type`;

-- ── auth_identities: one row per linked OAuth account ─────────────────────────
-- The identity key across providers is the user's email; this table records which
-- external accounts resolve to which local user.
CREATE TABLE IF NOT EXISTS `auth_identities` (
  `id`            CHAR(36)     NOT NULL,
  `user_id`       CHAR(36)     NOT NULL,
  `provider`      ENUM('google','microsoft','facebook') NOT NULL,
  `provider_sub`  VARCHAR(255) NOT NULL COMMENT 'The provider''s stable subject id (Google sub, MS oid, FB id)',
  `email`         VARCHAR(255) NULL     COMMENT 'Email as the provider reported it at link time',
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login_at` DATETIME     NULL,
  PRIMARY KEY (`id`),
  -- One external account links to exactly one local user.
  UNIQUE KEY `uq_identity_provider_sub` (`provider`, `provider_sub`),
  KEY `idx_identity_user` (`user_id`),
  CONSTRAINT `fk_identity_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sms_verifications: prove ownership of a +61 mobile ────────────────────────
-- Same shape as recovery_tokens: hashed code, per-code attempt ceiling, short TTL.
CREATE TABLE IF NOT EXISTS `sms_verifications` (
  `id`          CHAR(36)     NOT NULL,
  `user_id`     CHAR(36)     NULL COMMENT 'The user proving the number (NULL only for pre-account flows)',
  `mobile`      VARCHAR(20)  NOT NULL COMMENT 'Normalised E.164, e.g. +614XXXXXXXX',
  `code_hash`   VARCHAR(255) NOT NULL,
  `purpose`     ENUM('verify_mobile') NOT NULL DEFAULT 'verify_mobile',
  `attempts`    INT          NOT NULL DEFAULT 0,
  `expires_at`  DATETIME     NOT NULL,
  `verified_at` DATETIME     NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sms_user` (`user_id`),
  KEY `idx_sms_mobile` (`mobile`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
