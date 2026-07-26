-- ProjMan2 — migration v011: admin-team sub-roles on the System Admin surface
-- (dashboardspecification.md §2/§3 addendum). The dashboard stays SINGLE-TIER in the
-- sense that matters (platform vs tenant — a `projectManager` still has zero reach
-- here, allowlist-only): this migration adds differentiated roles WITHIN that one
-- platform tier, not a second tenant tier. Three admin-team roles, requested
-- directly by the owner:
--   admin    — full access to every /admin/* route
--   account  — money: billing/subscriptions/payments/plan changes, plus user
--              account actions (enable/disable/force-logout)
--   staff    — user account actions (enable/disable/force-logout) plus the login
--              transaction log (trace login sessions); no money, no billing
--
-- `admin_role` defaults to 'staff' — the least-privileged tier — so any row created
-- before this migration (there were none in this dev DB) or by a future bare INSERT
-- doesn't silently inherit full access.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

ALTER TABLE `platform_admins`
  ADD COLUMN `admin_role` ENUM('admin','account','staff') NOT NULL DEFAULT 'staff'
    COMMENT 'Sub-role within the platform-admin tier (dashboardspec §2/§3 addendum)'
    AFTER `user_id`;

-- Any admin granted before this migration (out-of-band CLI only, none exist yet in
-- dev) becomes full 'admin' rather than being silently downgraded to 'staff'.
UPDATE `platform_admins` SET `admin_role` = 'admin' WHERE `admin_role` = 'staff';
