-- ProjMan — migration v020: builder gains projects.write (xprojman-17 Q1, owner-approved).
--
-- Fork A produced self-registered Builders who found their own org (is_org_owner) but,
-- lacking projects.write, had no way to create a project — an empty Projects tab until
-- someone awarded/paired them in. Q1 decision: a builder-run business creates and runs its
-- OWN jobs, so `builder` now holds projects.write.
--
-- Scope is unchanged: builder stays scope_class='assigned'. Creating a project auto-enrols
-- the creator into project_members (§10.3), so a Builder sees the projects they create via
-- their assigned scope — no portfolio grant, no cross-tenant reach. This does NOT give a
-- builder visibility into a PM's projects (still same-tenant, membership-gated).
--
-- Additive matrix change only → matrix_version 7 → 8.

INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('builder', 'projects.write')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

UPDATE `access_meta` SET `v` = '8' WHERE `k` = 'matrix_version';
