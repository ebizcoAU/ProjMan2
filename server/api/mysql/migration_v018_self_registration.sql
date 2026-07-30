-- ProjMan — migration v018: Self-Registration Step 1 (xprojman-13 Fork A / xprojman-14).
-- Owner picked Fork A: a field/business role may self-register and FOUND its own org,
-- instead of every self-registrant being forced to role `projectManager`. v1 app case is
-- Builder (the Job-Award counterpart a PM needs someone to award TO); PM/Property Developer
-- self-register on the Portal. Crew (siteSupervisor/foreperson/tradie/inspector) still
-- arrive via device pairing — independent, org-less crew identity stays PM2-02.
--
-- The one model change this needs: DECOUPLE org-adminship from the fixed identity role.
-- Today the tenant-owner capabilities (org.manage / users.manage / devices.manage) are
-- held ONLY by the `projectManager` ROLE (matrix v6). If we instead granted them to the
-- `builder` role, EVERY builder — including a builder ENGAGED into another PM's org via a
-- Job Award, or paired in as crew — would wield tenant-owner authority in an org they do
-- not own. That breaks the appointer≠appointed line (xprojman-08). So org-ownership must be
-- ORG-SCOPED metadata on the founder, not a property of the everywhere-identical role.
--
-- `is_org_owner` is that flag. It is ADDITIVE and OR'd into enforcement (see lib/access.js
-- `grants`): it CONFERS the three owner caps on the founder regardless of role, and it
-- REMOVES nothing. The `projectManager` role KEEPS its matrix grants untouched, so existing
-- PMs are unaffected — this is why there is no matrix_version bump (no role_permissions row
-- changed). One org per user in v1, so a single boolean on `users` is unambiguous ("owner of
-- the one org I belong to"); when PM2-02 opens cross-org identity this becomes per-membership.

ALTER TABLE `users`
  ADD COLUMN `is_org_owner` TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'Founder/owner of their own org. Confers org.manage/users.manage/devices.manage independent of the fixed identity role (xprojman-14). Org-scoped in v1 = the single org the user belongs to.'
  AFTER `role`;

-- Backfill preserves today's behaviour exactly. Today org-adminship == role
-- `projectManager` (the only role holding org.manage). Seed the founder flag on every
-- existing projectManager so the SEMANTIC ("founders are owners") is true from day one and
-- the flag is future-proof if org.manage is ever pulled off the PM role. Because the PM role
-- also still carries org.manage in the matrix, this changes nothing observable — a PM added
-- to an org by another PM already held org.manage via the role and keeps it either way.
UPDATE `users` SET `is_org_owner` = 1 WHERE `role` = 'projectManager';
