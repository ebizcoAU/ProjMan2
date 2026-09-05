-- ProjMan — migration v037: two nullable Task-popup fields (xprojman-37, Portal
-- Agent request, 2026-09-05). Duration needs nothing new — `budget_hours`
-- (migration_v003) already is "estimate hours". The Sx.x code/seq the popup also
-- wants is a JOIN against the existing `stage_task_templates` (v034), not a new
-- column — see ProjectService.js's `getProject` query.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

ALTER TABLE `tasks`
  ADD COLUMN `description`   TEXT       NULL AFTER `name`,
  ADD COLUMN `is_outsourced` TINYINT(1) NULL AFTER `budget_amount`;
-- Both NULL, not DEFAULT 0/'' — every task created before this migration has no
-- recorded value for either, and for `is_outsourced` specifically "unknown" is a
-- real, different state from "internal" (a false default would silently claim
-- knowledge no one entered). The popup already renders a distinct "not captured
-- yet" state for NULL, separate from the true/false cases.
