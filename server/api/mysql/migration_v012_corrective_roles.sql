-- ProjMan — migration v012: Step A of the corrective migration (Manager directive
-- "DIRECTIVE 1 — Server Agent", per xprojman-01.md's assessment + servdesignspec §7.2 +
-- devroadmap.md §11). Adds the 3 missing v1 roles (builder/developer/accountant) and
-- the progress.tick/progress.verify split, additive on top of the existing
-- roles-as-data mechanism (migration_v004/v005) — no rewrite, no route edits.
--
-- Scope decision, documented here since it's a judgment call the directive's wording
-- could be read two ways: `progress.tick`/`progress.verify` are wired to **`tasks`**
-- (previously COMPLETELY unguarded — any authenticated device could push any task
-- change, a real pre-existing gap this closes), NOT to `project_stages.status`/
-- `/advance`. The proven stage-advance gate (`progress.write`, 15/15 passing tests)
-- is left untouched — devroadmap.md §6 frames stage advancement itself as PM/Builder's
-- "Complete & Next Stage" action, which the separate `programme.write` stage-range
-- scoping (code change, not this migration) now governs. Tick-then-verify is the
-- site crew's per-task execution discipline (18-Stage spec §1.3): Tradie/Foreperson
-- tick `tasks.completion`, Site Supervisor verifies via the new protected
-- `tasks.verified_by`/`verified_at`.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- New roles. `pair_rank` reasoning: builder=35 sits between foreperson(30) and
-- siteSupervisor(40) — lets Builder pair his own crew (foreperson/tradie, "appoints
-- his own crew" per devroadmap §2) but never a Site Supervisor (PM's independent
-- appointee) or an Inspector (external). developer/accountant are desk-only, never
-- paired to a device (`device_pairable=0`, `pair_rank=0`).
--
-- `accountant.scope_class='assigned'`, NOT the spec's literal "engagement (S18.12 row
-- only)" — `engagement` scope fails closed today (lib/scope.js: PM2-02 not resolved,
-- "reach nothing"), which would make the role unable to do the one thing it exists
-- for. v1 compromise, same shape as how `inspector` already works: an accountant is
-- added as a `project_members` row on the one project they're reviewing (assigned
-- scope), and the ONLY write permission granted is the narrow `tax.approve` — broader
-- *reach* than "one row" until PM2-02 lands, but no broader *write* authority.
-- ============================================================================
INSERT INTO `roles`
  (`role`, `label`, `scope_class`, `surface`, `is_assignable`, `device_pairable`, `pair_rank`, `sort`) VALUES
  ('builder',    'Builder',              'assigned',  'both',   1, 1, 35, 7),
  ('developer',  'Property Developer',   'portfolio', 'portal', 1, 0,  0, 8),
  ('accountant', 'Accountant/BAS Agent', 'assigned',  'portal', 1, 0,  0, 9)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);

ALTER TABLE `users` MODIFY `role` VARCHAR(40) NOT NULL DEFAULT 'projectManager';
ALTER TABLE `devices` MODIFY `role` VARCHAR(40) NULL;

-- ============================================================================
-- New permissions. `panel.manage` gates Step B's Introduction/Job-Award creation
-- (PM's own Builders panel, Builder's own crew panel) — added now so migration_v013
-- has something to check against. `claims.*`/`variations.*`/`disputes.*` are named in
-- servdesignspec §7.2 but belong to P7 Commercial/dispute-handling, neither built —
-- deliberately NOT added here (a permission string with no enforcement point is dead
-- weight); reserved for when those modules land, same pattern as P5/P6's reserved
-- names in the original §9.3 catalogue.
-- ============================================================================
INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  -- progress.tick / progress.verify — the tasks tick-then-verify chain (new gate;
  -- tasks had no permission check at all before this).
  ('tradie',        'progress.tick'),
  ('foreperson',    'progress.tick'),
  ('builder',       'progress.tick'),   -- an owner-operator Builder can tick his own work too
  ('siteSupervisor','progress.verify'),
  -- tax.approve — the one protected S18.12 write, accountant only.
  ('accountant',    'tax.approve'),
  -- development.read — Property Developer's portfolio view; PM keeps it too per the
  -- founder's own same-tenant v1 (servdesignspec §7.2 footnote).
  ('developer',      'development.read'),
  ('projectManager', 'development.read'),
  -- development.read is a read of PROJECT rows (portfolio scope, all projects) — no
  -- separate projects.read grant for developer per the corrected matrix (a portfolio
  -- commercial principal sees the money/portfolio rollup, not day-to-day project
  -- operational detail).
  ('developer',      'money.read'),
  -- panel.manage — Introduction/Job-Award initiation for one's own panel.
  ('projectManager', 'panel.manage'),
  ('builder',        'panel.manage')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

-- Matrix changed → bump the version so clients cache-bust GET /auth/permissions.
UPDATE `access_meta` SET `v` = '5' WHERE `k` = 'matrix_version';

-- ============================================================================
-- tasks — the tick-then-verify target. `verified_by`/`verified_at` are server-owned
-- (PROTECTED_COLUMNS, same principle as `is_validated`) — a device ticks `completion`,
-- only a permission-holding session (Site Supervisor) can set the verify pair, and
-- only through the gated path (TaskProgressService, not a bare sync write).
-- ============================================================================
ALTER TABLE `tasks`
  ADD COLUMN `verified_by` CHAR(36)  NULL COMMENT 'users.id of the Site Supervisor who verified this tick (server-set only)' AFTER `assigned_to`,
  ADD COLUMN `verified_at` DATETIME  NULL AFTER `verified_by`;

ALTER TABLE `tasks`
  ADD CONSTRAINT `fk_tasks_verified_by` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`);

-- Stage 9-18's informational actor label now reads `builder` (Builder is the
-- accountable party for site execution from Stage 9 on, per the corrected model) —
-- purely a display hint (servdesignspec §10.3 note: enforcement is by permission,
-- never this column), no behaviour change.
UPDATE `stage_template_items` SET `actor_role` = 'builder'
 WHERE `template_id` = '00000000-0000-4000-8000-00000000wa18' AND `seq` >= 9;
