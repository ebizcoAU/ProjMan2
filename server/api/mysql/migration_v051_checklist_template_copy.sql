-- ProjMan2 — migration v051: the three system checklist templates get Product's approved wording.
--
-- v047 seeded them with placeholder text (xprojman-46 §5). Product (projman2-d4) supplied the copy on
-- 2026-09-30 at the Owner's request; the App mock has carried it since commit 7fe2c69. Data only.
--
-- Safe for checklists already in use: checklist_instance_items carry their own copy of each label, so
-- changing a template never rewrites a started or completed checklist. Item ids stay fixed; v047's
-- items are updated in place by seq, the extra items get new fixed ids, so a re-run is a no-op.
-- server_updated_at moves on every touched row, so devices pull the new wording on their next sync.

UPDATE `checklist_templates` SET `name` = 'Toolbox talk', `description` = 'Pre-start crew briefing. Record what was covered; every attendee signs on.' WHERE `id` = 'c0000000-0000-4000-8000-000000000001';
UPDATE `checklist_templates` SET `name` = 'Plant pre-start', `description` = 'Operator''s daily check before first use. Any Fail: tag the plant out and tell your supervisor.' WHERE `id` = 'c0000000-0000-4000-8000-000000000002';
UPDATE `checklist_templates` SET `name` = 'Internal QA: pre-pour slab', `description` = 'Builder''s own check before the engineer or certifier inspection. It doesn''t replace that inspection.' WHERE `id` = 'c0000000-0000-4000-8000-000000000003';

INSERT INTO `checklist_template_items` (`id`, `org_id`, `template_id`, `seq`, `label`, `is_required`, `photo_required`) VALUES
  ('c1000000-0000-4000-8000-000000000001', NULL, 'c0000000-0000-4000-8000-000000000001', 1, 'Today''s tasks, work areas and sequence explained', 1, 0),
  ('c1000000-0000-4000-8000-000000000002', NULL, 'c0000000-0000-4000-8000-000000000001', 2, 'Site hazards for today reviewed, including new or changed hazards', 1, 0),
  ('c1000000-0000-4000-8000-000000000003', NULL, 'c0000000-0000-4000-8000-000000000001', 3, 'SWMS for today''s high-risk work reviewed with the workers doing it', 1, 0),
  ('c1000000-0000-4000-8000-000000000009', NULL, 'c0000000-0000-4000-8000-000000000001', 4, 'PPE for today''s tasks confirmed and available', 1, 0),
  ('c1000000-0000-4000-8000-000000000010', NULL, 'c0000000-0000-4000-8000-000000000001', 5, 'Exclusion zones, plant movements and overhead/underground services discussed', 1, 0),
  ('c1000000-0000-4000-8000-000000000011', NULL, 'c0000000-0000-4000-8000-000000000001', 6, 'Weather and heat/cold conditions considered', 1, 0),
  ('c1000000-0000-4000-8000-000000000012', NULL, 'c0000000-0000-4000-8000-000000000001', 7, 'Emergency assembly point, first aider and first-aid kit location confirmed', 1, 0),
  ('c1000000-0000-4000-8000-000000000013', NULL, 'c0000000-0000-4000-8000-000000000001', 8, 'Incidents, near misses or hazards since the last talk discussed', 1, 0),
  ('c1000000-0000-4000-8000-000000000014', NULL, 'c0000000-0000-4000-8000-000000000001', 9, 'Crew questions and concerns recorded (use the note)', 0, 0)
ON DUPLICATE KEY UPDATE `template_id` = VALUES(`template_id`), `seq` = VALUES(`seq`), `label` = VALUES(`label`),
  `is_required` = VALUES(`is_required`), `photo_required` = VALUES(`photo_required`), `is_deleted` = 0;

INSERT INTO `checklist_template_items` (`id`, `org_id`, `template_id`, `seq`, `label`, `is_required`, `photo_required`) VALUES
  ('c1000000-0000-4000-8000-000000000004', NULL, 'c0000000-0000-4000-8000-000000000002', 1, 'Operator holds the required licence/ticket and is competent on this machine', 1, 0),
  ('c1000000-0000-4000-8000-000000000005', NULL, 'c0000000-0000-4000-8000-000000000002', 2, 'Operator''s manual and plant risk assessment available', 1, 0),
  ('c1000000-0000-4000-8000-000000000006', NULL, 'c0000000-0000-4000-8000-000000000002', 3, 'Walk-around done: no leaks, damage, loose or missing parts', 1, 1),
  ('c1000000-0000-4000-8000-000000000015', NULL, 'c0000000-0000-4000-8000-000000000002', 4, 'Engine oil, hydraulic oil, coolant and fuel at correct levels', 1, 0),
  ('c1000000-0000-4000-8000-000000000016', NULL, 'c0000000-0000-4000-8000-000000000002', 5, 'Tyres/tracks, rims and undercarriage in good condition', 1, 1),
  ('c1000000-0000-4000-8000-000000000017', NULL, 'c0000000-0000-4000-8000-000000000002', 6, 'Brakes, steering and all controls operate correctly', 1, 0),
  ('c1000000-0000-4000-8000-000000000018', NULL, 'c0000000-0000-4000-8000-000000000002', 7, 'Lights, beacon, horn and reversing alarm working', 1, 0),
  ('c1000000-0000-4000-8000-000000000019', NULL, 'c0000000-0000-4000-8000-000000000002', 8, 'Seatbelt, ROPS/FOPS and guards intact', 1, 0),
  ('c1000000-0000-4000-8000-000000000020', NULL, 'c0000000-0000-4000-8000-000000000002', 9, 'Attachment and quick hitch secure, safety pin fitted (N/A if none)', 1, 0),
  ('c1000000-0000-4000-8000-000000000021', NULL, 'c0000000-0000-4000-8000-000000000002', 10, 'Fire extinguisher present, charged and in date', 1, 0),
  ('c1000000-0000-4000-8000-000000000022', NULL, 'c0000000-0000-4000-8000-000000000002', 11, 'Hour meter reading recorded (use the note)', 0, 0)
ON DUPLICATE KEY UPDATE `template_id` = VALUES(`template_id`), `seq` = VALUES(`seq`), `label` = VALUES(`label`),
  `is_required` = VALUES(`is_required`), `photo_required` = VALUES(`photo_required`), `is_deleted` = 0;

INSERT INTO `checklist_template_items` (`id`, `org_id`, `template_id`, `seq`, `label`, `is_required`, `photo_required`) VALUES
  ('c1000000-0000-4000-8000-000000000007', NULL, 'c0000000-0000-4000-8000-000000000003', 1, 'Set-out and levels checked against the drawings', 1, 0),
  ('c1000000-0000-4000-8000-000000000008', NULL, 'c0000000-0000-4000-8000-000000000003', 2, 'Formwork and edge forms braced, true and to dimension', 1, 0),
  ('c1000000-0000-4000-8000-000000000023', NULL, 'c0000000-0000-4000-8000-000000000003', 3, 'Reo size, spacing and laps as per structural drawings', 1, 1),
  ('c1000000-0000-4000-8000-000000000024', NULL, 'c0000000-0000-4000-8000-000000000003', 4, 'Bar chairs and cover as specified', 1, 1),
  ('c1000000-0000-4000-8000-000000000025', NULL, 'c0000000-0000-4000-8000-000000000003', 5, 'Starter bars, cogs and ties secured', 1, 0),
  ('c1000000-0000-4000-8000-000000000026', NULL, 'c0000000-0000-4000-8000-000000000003', 6, 'Penetrations, set-downs, conduits and sleeves in place and fixed', 1, 1),
  ('c1000000-0000-4000-8000-000000000027', NULL, 'c0000000-0000-4000-8000-000000000003', 7, 'Vapour barrier lapped, taped and undamaged', 1, 0),
  ('c1000000-0000-4000-8000-000000000028', NULL, 'c0000000-0000-4000-8000-000000000003', 8, 'Termite management system installed as specified (N/A if not required)', 1, 0),
  ('c1000000-0000-4000-8000-000000000029', NULL, 'c0000000-0000-4000-8000-000000000003', 9, 'Excavation clean, no water or loose material', 1, 0),
  ('c1000000-0000-4000-8000-000000000030', NULL, 'c0000000-0000-4000-8000-000000000003', 10, 'Concrete order confirmed: grade, slump, volume, pump booked', 0, 0)
ON DUPLICATE KEY UPDATE `template_id` = VALUES(`template_id`), `seq` = VALUES(`seq`), `label` = VALUES(`label`),
  `is_required` = VALUES(`is_required`), `photo_required` = VALUES(`photo_required`), `is_deleted` = 0;
