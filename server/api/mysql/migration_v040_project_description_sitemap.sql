-- ProjMan — migration v040: projects.description (xprojman-40 §1, Portal Agent
-- request, 2026-09-07). A genuinely new field, not a restored one — confirmed
-- via full history check (no prior migration, no `project_briefs` ever landed,
-- see the doc's own §0 trigger). Nullable — every existing project predates
-- this, same "unset is a real, different state" posture as `tasks.description`/
-- `is_outsourced` (xprojman-37). No redaction needed (not financial, same as
-- `name`/`site_address`).
--
-- §2 (server-mediated Google Static Map) needs no schema — it's a live proxy
-- over the existing `projects.site_address`, cached to disk via the existing
-- storage driver. See SiteMapService.js.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

ALTER TABLE `projects`
  ADD COLUMN `description` TEXT NULL AFTER `name`;
