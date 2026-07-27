-- ProjMan — migration v015: Step D of the corrective migration (DIRECTIVE 1,
-- servdesignspecification.md §7.6). Deactivation, not erasure.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

ALTER TABLE `users`
  ADD COLUMN `deactivated_at` DATETIME NULL COMMENT 'Set by DELETE /organisation/users/:id — never a hard delete for anyone with relied-upon project evidence' AFTER `disabled_reason`;
