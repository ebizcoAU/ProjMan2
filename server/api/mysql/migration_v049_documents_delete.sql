-- ProjMan2 — migration v049: `documents.delete`, a dedicated permission for document deletion.
--
-- Until now DocumentService.softDelete accepted `quality.write` OR `documents.write`, so the
-- Inspector (who holds quality.write to create/complete inspections, fill items and raise
-- defects) could also delete project documents. That was never intended (server spec §15.4;
-- re-baseline 2026-10-14). The lab check found no inspector had ever used it.
--
-- The fix keeps everyone's real job intact: the Inspector keeps quality.write +
-- quality.validate (inspections still work) and can still upload. Deletion moves to
-- `documents.delete`, granted to exactly the roles that could delete before, minus the
-- Inspector: projectManager + siteSupervisor (were via quality.write), builder + foreperson
-- (were via documents.write).

INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('projectManager', 'documents.delete'),
  ('siteSupervisor', 'documents.delete'),
  ('builder',        'documents.delete'),
  ('foreperson',     'documents.delete');

UPDATE `access_meta` SET `v` = '17' WHERE `k` = 'matrix_version';
