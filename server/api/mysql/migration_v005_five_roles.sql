-- ProjMan2 — migration v005: the 6-role model (18StageProjectManagementMatrix.md)
--
-- Course correction. v004 seeded development.md §3's 12-role model. The authoritative
-- workflow document is the 18-Stage Matrix, whose Role Actor Pairing Registry is
-- SIX roles, camelCase, with projectManager as the top actor that CREATES projects
-- (Stage 1). Owner decisions 2026-07-23: the matrix wins; retire the 12-role overlay;
-- identifiers are camelCase; projectManager is portfolio scope; the registry is SIX
-- (the client — Public Portal — was the sixth I first missed).
--
--   projectManager  portfolio  Portal+App  creates projects, variations, money, AI, pairing
--   siteSupervisor  assigned   App         runs the site; pairs foreperson/tradie
--   foreperson      assigned   App         leads crews, WBS
--   tradie          self       App         own tasks, schematics
--   inspector       assigned   Portal+App  validates stages (is_validated interlocks)
--   client          portal     Portal      reviews progress, approves variations, signs off
--
-- The client is Public-Portal only: not device-pairable, and not staff-assignable in
-- v1 (the portal + its invite flow is P10). It is seeded so tokens/validation know it,
-- but scope_class 'portal' fails closed until the portal surface exists.
--
-- Flagged doc inconsistency: Stage 9 names "projectManager & estimator", but estimator
-- is NOT in the registry. Treated as a projectManager sub-function here (the registry
-- is the authority); raised with the owner rather than silently seeding a 7th role.
--
-- No production data — this is a dev/test DB — so existing role VALUES are remapped
-- in place (the columns are VARCHAR since v004, no ENUM to alter).

SET NAMES utf8mb4;
SET time_zone = '+08:00';

-- ── Remap existing role values old → new (camelCase) ──────────────────────────
-- projectManager absorbs the old office/portfolio roles; the site roles map across;
-- the post-v1 four collapse to their nearest field equivalent.
UPDATE `users` SET `role` = CASE `role`
  WHEN 'org_admin'            THEN 'projectManager'
  WHEN 'project_developer'    THEN 'projectManager'
  WHEN 'project_manager'      THEN 'projectManager'
  WHEN 'construction_manager' THEN 'projectManager'
  WHEN 'estimator'            THEN 'projectManager'
  WHEN 'supervisor'           THEN 'siteSupervisor'
  WHEN 'foreperson'           THEN 'foreperson'
  WHEN 'inspector'            THEN 'inspector'
  WHEN 'tradie'               THEN 'tradie'
  WHEN 'labourer'             THEN 'tradie'
  WHEN 'subcontractor'        THEN 'tradie'
  WHEN 'customer'             THEN 'client'
  ELSE `role` END;

UPDATE `devices` SET `role` = CASE `role`
  WHEN 'org_admin'            THEN 'projectManager'
  WHEN 'project_developer'    THEN 'projectManager'
  WHEN 'project_manager'      THEN 'projectManager'
  WHEN 'construction_manager' THEN 'projectManager'
  WHEN 'estimator'            THEN 'projectManager'
  WHEN 'supervisor'           THEN 'siteSupervisor'
  WHEN 'foreperson'           THEN 'foreperson'
  WHEN 'inspector'            THEN 'inspector'
  WHEN 'tradie'               THEN 'tradie'
  WHEN 'labourer'             THEN 'tradie'
  WHEN 'subcontractor'        THEN 'tradie'
  WHEN 'customer'             THEN 'client'
  ELSE `role` END;

UPDATE `pairing_tokens` SET `role` = CASE `role`
  WHEN 'supervisor'    THEN 'siteSupervisor'
  WHEN 'project_manager' THEN 'projectManager'
  WHEN 'org_admin'     THEN 'projectManager'
  WHEN 'customer'      THEN 'client'
  WHEN 'labourer'      THEN 'tradie'
  WHEN 'subcontractor' THEN 'tradie'
  ELSE `role` END;

-- New sensible defaults (columns default to a site role, not the top actor).
ALTER TABLE `users`   MODIFY `role` VARCHAR(40) NOT NULL DEFAULT 'siteSupervisor';
ALTER TABLE `devices` MODIFY `role` VARCHAR(40) NOT NULL DEFAULT 'siteSupervisor';

-- ── Reseed the roles table: drop the 12, install the 5 ────────────────────────
-- pair_rank is the pairing-authority ceiling (who may hand out which device role) —
-- distinct from permissions on purpose: an inspector holds an authority the PM lacks
-- (independent validation), yet the PM must still be able to bring one onto a job, so
-- "who can pair whom" is a rank ladder, not a permission subset.
ALTER TABLE `roles` ADD COLUMN `pair_rank` INT NOT NULL DEFAULT 0;

DELETE FROM `role_permissions`;
DELETE FROM `roles`;

INSERT INTO `roles`
  (`role`, `label`, `scope_class`, `surface`, `is_assignable`, `device_pairable`, `pair_rank`, `sort`) VALUES
  ('projectManager', 'Project Manager', 'portfolio', 'both',   1, 1, 100, 1),
  ('siteSupervisor', 'Site Manager',    'assigned',  'both',   1, 1,  40, 2),
  ('foreperson',     'Foreman',         'assigned',  'app',    1, 1,  30, 3),
  ('tradie',         'Tradie',          'self',      'app',    1, 1,  20, 4),
  ('inspector',      'Inspector',       'assigned',  'both',   1, 1,  50, 5),
  -- Public Portal only: not pairable, not staff-assignable in v1 (portal = P10).
  ('client',         'Client',          'portal',    'portal', 0, 0,   0, 6);

INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  -- projectManager — the top actor: creates projects, runs money, admins the tenant
  ('projectManager','org.manage'), ('projectManager','users.manage'),
  ('projectManager','devices.manage'),
  ('projectManager','customers.read'), ('projectManager','customers.write'),
  ('projectManager','projects.read'), ('projectManager','projects.write'),
  ('projectManager','programme.write'), ('projectManager','progress.write'),
  ('projectManager','money.read'), ('projectManager','money.write'),
  -- siteSupervisor — runs the site; may pair crew devices on site
  ('siteSupervisor','devices.manage'),
  ('siteSupervisor','projects.read'), ('siteSupervisor','progress.write'),
  -- foreperson — leads a crew
  ('foreperson','projects.read'), ('foreperson','progress.write'),
  -- tradie — own tasks only (self scope narrows progress.write to assigned_to)
  ('tradie','projects.read'), ('tradie','progress.write'),
  -- inspector — independent validation authority (the is_validated interlocks)
  ('inspector','projects.read'), ('inspector','quality.validate'),
  -- client — Public Portal read of own project. approve-variations / milestone-signoff
  -- write perms arrive with the portal surface (P10); portal scope fails closed now.
  ('client','projects.read');

UPDATE `access_meta` SET `v` = '2' WHERE `k` = 'matrix_version';

-- project_members backfill already ran in v004 from projects.pm_user_id; the remapped
-- projectManager users keep their memberships. Nothing to re-backfill.
