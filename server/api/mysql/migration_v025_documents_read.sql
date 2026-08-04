-- ProjMan — migration v025: `documents.read` — Builder document visibility on engaged projects.
--
-- Closes open decision #19 (raised from the v024 build, xprojman-23 §3a). Owner ruling 2026-08-03:
-- a Builder should see the documents on projects they are ENGAGED on, not only their own uploads.
--
-- WHY A NEW PERMISSION RATHER THAN GRANTING `builder` → `projects.read`:
-- `projects.read` is the gate on the whole project-detail surface — GET /projects, /projects/:id
-- (+stages+tasks), /inspections, /defects, /certificates, /members. Granting it to reach DOCUMENTS
-- would hand the Builder that entire surface as a side effect: far more than the ruling asked for,
-- and a change to §7.2.1-adjacent visibility that nobody reviewed. `documents.read` grants exactly
-- the capability named and nothing else.
--
-- WHY NO SCOPING WORK IS NEEDED HERE:
-- `builder.scope_class = 'assigned'` (v012), and accepting a job award writes the `project_members`
-- row (JobAwardService.respond → MembershipService.addMember). So "engaged project" IS
-- "project_members row", which is precisely what `lib/scope.js projectScope()` already narrows to.
-- The permission is the only missing piece; the reach rule was already correct.
--
-- Granted to `builder` ONLY. Every other role that reads documents already holds `projects.read`
-- (projectManager, siteSupervisor, foreperson, tradie, inspector, client), and the documents gate
-- accepts either — so re-granting them would be matrix noise. `accountant`/`developer` are
-- deliberately NOT included: neither has a document-capture surface, and desk roles reaching site
-- photographs is a separate question nobody has asked.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('builder', 'documents.read')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

-- Matrix changed → bump so clients cache-bust GET /auth/permissions. v11 → v12.
UPDATE `access_meta` SET `v` = '12' WHERE `k` = 'matrix_version';
