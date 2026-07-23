-- ProjMan2 — migration v007: System Admin dashboard + SaaS billing
-- (dashboarddesignspecification.md §10, APPROVED 2026-07-23).
--
-- The dashboard is a SINGLE-TIER platform surface (System Admin = eBizco), account &
-- billing layer ONLY — it never touches projects or user content. This migration adds:
--   platform_admins   the System-Admin allowlist (NOT a tenant role)
--   audit_log.user_agent   device/OS per auth event (was only in sessions, success-only)
--   subscriptions     SaaS: eBizco → tenant orgs (plan + status + period)
--   payments          per-invoice payment records
--
-- No construction/content tables are touched. `organisations` (plan, trial_ends_at)
-- stays the baseline; subscriptions/payments are the billing overlay the System Admin
-- maintains (manual reconciliation in v1; a gateway wires in later).

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- platform_admins — the System-Admin allowlist. Membership is the ONLY way to reach
-- /admin/*. Provisioned out-of-band (scripts/grant-platform-admin.js) — never via
-- tenant sign-up or user-management, never device-pairable. NOT a role in `roles`.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `platform_admins` (
  `id`         CHAR(36)     NOT NULL,
  `user_id`    CHAR(36)     NOT NULL COMMENT 'The user account granted platform-admin',
  `granted_by` CHAR(36)     NULL COMMENT 'The platform admin who granted it (NULL for the seed)',
  `note`       VARCHAR(255) NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_platform_admin_user` (`user_id`),
  CONSTRAINT `fk_platform_admin_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- audit_log: capture the user agent per event (the login log wants device/OS on
-- every row, including failures — sessions only had it for successful logins).
-- ============================================================================
ALTER TABLE `audit_log` ADD COLUMN `user_agent` VARCHAR(255) NULL AFTER `ip`;

-- ============================================================================
-- subscriptions — one billing arrangement per org (SaaS: eBizco charges the builder).
-- organisations.plan/trial_ends_at remain the baseline; this row is present once the
-- System Admin records real billing. The billing views fall back to organisations for
-- orgs without a subscription row, so trials show without a migration backfill.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id`           CHAR(36)     NOT NULL,
  `org_id`       CHAR(36)     NOT NULL,
  `plan`         ENUM('trial','starter','builder','enterprise') NOT NULL DEFAULT 'trial',
  `status`       ENUM('trial','active','past_due','cancelled') NOT NULL DEFAULT 'trial',
  `period_start` DATE         NULL,
  `period_end`   DATE         NULL,
  `amount`       DECIMAL(10,2) NULL COMMENT 'Recurring amount per period',
  `currency`     CHAR(3)      NOT NULL DEFAULT 'AUD',
  `note`         VARCHAR(255) NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subscription_org` (`org_id`),
  CONSTRAINT `fk_subscription_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- payments — per-invoice payment records (manual reconciliation in v1).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `payments` (
  `id`              CHAR(36)     NOT NULL,
  `org_id`          CHAR(36)     NOT NULL,
  `subscription_id` CHAR(36)     NULL,
  `amount`          DECIMAL(10,2) NOT NULL,
  `currency`        CHAR(3)      NOT NULL DEFAULT 'AUD',
  `status`          ENUM('paid','overdue','failed','refunded') NOT NULL DEFAULT 'paid',
  `method`          VARCHAR(40)  NULL COMMENT 'e.g. bank_transfer, card, manual',
  `period`          VARCHAR(20)  NULL COMMENT 'e.g. 2026-07 — the billing period this covers',
  `paid_at`         DATETIME     NULL,
  `note`            VARCHAR(255) NULL,
  `recorded_by`     CHAR(36)     NULL COMMENT 'platform admin who recorded it',
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payments_org`    (`org_id`),
  KEY `idx_payments_status` (`status`),
  CONSTRAINT `fk_payments_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
