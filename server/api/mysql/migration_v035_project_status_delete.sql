-- ProjMan — migration v035: project status enum (inactive replaces archived, adds
-- cancelled) + the schema-side support for DELETE /projects/:id (xprojman-35, Portal
-- Agent request, 2026-09-04).
--
-- Schema change only. Cancel needs NOTHING beyond the enum — it is the existing
-- `PATCH /projects/:id { status: 'cancelled' }`, matching xprojman-35 §1. Delete
-- needs no new columns at all: every table it touches already carries `is_deleted`
-- (the synced ones) or nothing extra (the REST-only ones) — see ProjectDeletionService.js
-- for the cascade itself, and xprojman-35.md §5 for why it is a two-tier cascade
-- (soft-delete/tombstone the sync-registered tables, hard-delete everything else),
-- not the single hard-delete pass Portal's draft proposed.
--
-- `archived` had ZERO live usages anywhere in the codebase at the time of writing
-- (routes/projects.js's 3 validators + ProjectService.dashboardSummary's aggregation
-- were the only references, both updated in this same commit) — renaming its slot to
-- `inactive` is not a data migration, just a label change for a value nothing had
-- ever written.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

ALTER TABLE `projects`
  MODIFY COLUMN `status` ENUM('draft','active','on_hold','completed','inactive','cancelled')
    NOT NULL DEFAULT 'draft';
