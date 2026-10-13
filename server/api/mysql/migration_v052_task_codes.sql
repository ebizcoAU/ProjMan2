-- ProjMan2 — migration v052: stored task codes + the task library re-keyed to the v3.4 PDF
-- (xprojman-56, signed off by App and Portal 2026-10-14; mapping = 18Stage_Tasks.md "Code
-- alignment to Spec v3.4", b43db9d, with xprojman-56 §3.6's S9.10 resolution).
--
--   tasks.code               the task's code, STORED and server-owned (was computed from seq, which
--                            can't express v3.4: letter suffixes, renumbering, system steps).
--   tasks.auto_event /       non-NULL = a SYS+ step the SERVER ticks when the event fires; a manual
--   stage_task_templates.    tick is refused (SYSTEM_STEP).
--     auto_event
--
-- Order matters (MySQL DDL isn't transactional; every step below is written to be re-runnable):
--   1. columns  2. live tasks keep their OLD code + lose the code prefix from `name`
--   3. re-key the library (old codes parked as 'o…' first, so renames can swap without colliding)
--   4. NEW and SYS+ rows  5. drop lib S10.7 (Q4)  6. live tasks follow their library row
--   7. hand-added tasks  8. open stages get the new rows  9. SYS+ rows whose event already happened

SET @tpl = '00000000-0000-4000-8000-00000000wa18';

-- 1 ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE `tasks`
  ADD COLUMN `code` VARCHAR(10) NULL COMMENT 'server-owned; v3.4 numbering (xprojman-56)' AFTER `seq`,
  ADD COLUMN `auto_event` VARCHAR(30) NULL COMMENT 'SYS+ step ticked by the server on this event' AFTER `code`;
ALTER TABLE `stage_task_templates`
  ADD COLUMN `auto_event` VARCHAR(30) NULL COMMENT 'SYS+ step: the event that ticks it' AFTER `is_hold_point`;

-- 2 ─────────────────────────────────────────────────────────────────────────────
UPDATE `tasks` t JOIN `stage_task_templates` s ON s.id = t.template_item_id
   SET t.code = s.code
 WHERE t.code IS NULL;
-- "S9.8 Lock Cost Plan…" → "Lock Cost Plan…": clients render code + name from now on.
UPDATE `tasks`
   SET `name` = TRIM(SUBSTRING(`name`, CHAR_LENGTH(`code`) + 2))
 WHERE `code` IS NOT NULL AND `name` LIKE CONCAT(`code`, ' %');

-- 3 ─────────────────────────────────────────────────────────────────────────────
-- Park every row of a changing stage: seq out of the way of the unique key, code marked 'o…'.
UPDATE `stage_task_templates`
   SET `seq` = `seq` + 100, `code` = CONCAT('o', `code`)
 WHERE `template_id` = @tpl AND `stage_seq` IN (1, 2, 3, 4, 5, 6, 7, 9, 10, 18) AND `code` NOT LIKE 'o%';

-- (stage_seq, seq, new code [, actor/name]) ← old code. Rows not listed in a changing stage are
-- untouched except for S10.7 (dropped in step 5).
UPDATE `stage_task_templates` SET `seq` = 1,  `code` = 'S1.1'   WHERE `template_id` = @tpl AND `code` = 'oS1.1';
UPDATE `stage_task_templates` SET `seq` = 2,  `code` = 'S1.1a'  WHERE `template_id` = @tpl AND `code` = 'oS1.7';
UPDATE `stage_task_templates` SET `seq` = 3,  `code` = 'S1.2'   WHERE `template_id` = @tpl AND `code` = 'oS1.4';
UPDATE `stage_task_templates` SET `seq` = 4,  `code` = 'S1.2a'  WHERE `template_id` = @tpl AND `code` = 'oS1.6';
UPDATE `stage_task_templates` SET `seq` = 6,  `code` = 'S1.4'   WHERE `template_id` = @tpl AND `code` = 'oS1.2';
UPDATE `stage_task_templates` SET `seq` = 7,  `code` = 'S1.6'   WHERE `template_id` = @tpl AND `code` = 'oS1.3';

UPDATE `stage_task_templates` SET `seq` = 1,  `code` = 'S2.1'   WHERE `template_id` = @tpl AND `code` = 'oS2.1';
UPDATE `stage_task_templates` SET `seq` = 2,  `code` = 'S2.1a'  WHERE `template_id` = @tpl AND `code` = 'oS2.2';
UPDATE `stage_task_templates` SET `seq` = 3,  `code` = 'S2.1b'  WHERE `template_id` = @tpl AND `code` = 'oS2.3';
UPDATE `stage_task_templates` SET `seq` = 4,  `code` = 'S2.2'   WHERE `template_id` = @tpl AND `code` = 'oS2.4';
UPDATE `stage_task_templates` SET `stage_seq` = 2, `seq` = 5, `code` = 'S2.3' WHERE `template_id` = @tpl AND `code` = 'oS1.5';
UPDATE `stage_task_templates` SET `seq` = 6,  `code` = 'S2.4a'  WHERE `template_id` = @tpl AND `code` = 'oS2.5';
UPDATE `stage_task_templates` SET `seq` = 7,  `code` = 'S2.4b'  WHERE `template_id` = @tpl AND `code` = 'oS2.6';
UPDATE `stage_task_templates` SET `seq` = 8,  `code` = 'S2.4c'  WHERE `template_id` = @tpl AND `code` = 'oS2.7';
UPDATE `stage_task_templates` SET `seq` = 9,  `code` = 'S2.6'   WHERE `template_id` = @tpl AND `code` = 'oS2.8';

UPDATE `stage_task_templates` SET `seq` = 1,  `code` = 'S3.1'   WHERE `template_id` = @tpl AND `code` = 'oS3.1';
UPDATE `stage_task_templates` SET `seq` = 2,  `code` = 'S3.2'   WHERE `template_id` = @tpl AND `code` = 'oS3.2';
UPDATE `stage_task_templates` SET `seq` = 3,  `code` = 'S3.5a'  WHERE `template_id` = @tpl AND `code` = 'oS3.3';
UPDATE `stage_task_templates` SET `seq` = 4,  `code` = 'S3.7'   WHERE `template_id` = @tpl AND `code` = 'oS3.4';
UPDATE `stage_task_templates` SET `seq` = 5,  `code` = 'S3.10'  WHERE `template_id` = @tpl AND `code` = 'oS3.5';

UPDATE `stage_task_templates` SET `seq` = 1,  `code` = 'S4.1'   WHERE `template_id` = @tpl AND `code` = 'oS4.1';
UPDATE `stage_task_templates` SET `seq` = 2,  `code` = 'S4.3'   WHERE `template_id` = @tpl AND `code` = 'oS4.2';
UPDATE `stage_task_templates` SET `seq` = 3,  `code` = 'S4.4'   WHERE `template_id` = @tpl AND `code` = 'oS4.3';
UPDATE `stage_task_templates` SET `seq` = 4,  `code` = 'S4.5'   WHERE `template_id` = @tpl AND `code` = 'oS4.4';

UPDATE `stage_task_templates` SET `seq` = 1,  `code` = 'S5.3'   WHERE `template_id` = @tpl AND `code` = 'oS5.1';
UPDATE `stage_task_templates` SET `seq` = 2,  `code` = 'S5.3a'  WHERE `template_id` = @tpl AND `code` = 'oS5.3';
UPDATE `stage_task_templates` SET `stage_seq` = 6, `seq` = 1, `code` = 'S6.1', `actor_role` = 'Client',
       `name` = 'Client selects a budget tier' WHERE `template_id` = @tpl AND `code` = 'oS5.2';

UPDATE `stage_task_templates` SET `seq` = 2,  `code` = 'S6.2'   WHERE `template_id` = @tpl AND `code` = 'oS6.1';
UPDATE `stage_task_templates` SET `seq` = 3,  `code` = 'S6.3'   WHERE `template_id` = @tpl AND `code` = 'oS6.2';
UPDATE `stage_task_templates` SET `seq` = 4,  `code` = 'S6.3a'  WHERE `template_id` = @tpl AND `code` = 'oS6.6';
UPDATE `stage_task_templates` SET `seq` = 5,  `code` = 'S6.4'   WHERE `template_id` = @tpl AND `code` = 'oS6.3';
UPDATE `stage_task_templates` SET `seq` = 6,  `code` = 'S6.5'   WHERE `template_id` = @tpl AND `code` = 'oS6.4';
UPDATE `stage_task_templates` SET `seq` = 7,  `code` = 'S6.7'   WHERE `template_id` = @tpl AND `code` = 'oS6.5';

UPDATE `stage_task_templates` SET `seq` = 1,  `code` = 'S7.1'   WHERE `template_id` = @tpl AND `code` = 'oS7.1';
UPDATE `stage_task_templates` SET `seq` = 2,  `code` = 'S7.3'   WHERE `template_id` = @tpl AND `code` = 'oS7.2';
UPDATE `stage_task_templates` SET `seq` = 3,  `code` = 'S7.3a'  WHERE `template_id` = @tpl AND `code` = 'oS7.5';
UPDATE `stage_task_templates` SET `seq` = 4,  `code` = 'S7.5'   WHERE `template_id` = @tpl AND `code` = 'oS7.3';
UPDATE `stage_task_templates` SET `seq` = 5,  `code` = 'S7.6'   WHERE `template_id` = @tpl AND `code` = 'oS7.4';

UPDATE `stage_task_templates` SET `seq` = 1,  `code` = 'S9.1'   WHERE `template_id` = @tpl AND `code` = 'oS9.1';
UPDATE `stage_task_templates` SET `seq` = 2,  `code` = 'S9.3'   WHERE `template_id` = @tpl AND `code` = 'oS9.2';
UPDATE `stage_task_templates` SET `seq` = 3,  `code` = 'S9.4'   WHERE `template_id` = @tpl AND `code` = 'oS9.3';
UPDATE `stage_task_templates` SET `seq` = 4,  `code` = 'S9.5'   WHERE `template_id` = @tpl AND `code` = 'oS9.4';
UPDATE `stage_task_templates` SET `seq` = 5,  `code` = 'S9.6'   WHERE `template_id` = @tpl AND `code` = 'oS9.5';
UPDATE `stage_task_templates` SET `seq` = 6,  `code` = 'S9.6a'  WHERE `template_id` = @tpl AND `code` = 'oS9.7';
UPDATE `stage_task_templates` SET `seq` = 7,  `code` = 'S9.7'   WHERE `template_id` = @tpl AND `code` = 'oS9.6';
UPDATE `stage_task_templates` SET `seq` = 9,  `code` = 'S9.9'   WHERE `template_id` = @tpl AND `code` = 'oS9.8';
UPDATE `stage_task_templates` SET `seq` = 11, `code` = 'S9.10a' WHERE `template_id` = @tpl AND `code` = 'oS9.10';
UPDATE `stage_task_templates` SET `seq` = 12, `code` = 'S9.10b' WHERE `template_id` = @tpl AND `code` = 'oS9.9';

UPDATE `stage_task_templates` SET `seq` = 1,  `code` = 'S10.1a' WHERE `template_id` = @tpl AND `code` = 'oS10.1';
UPDATE `stage_task_templates` SET `seq` = 2,  `code` = 'S10.2'  WHERE `template_id` = @tpl AND `code` = 'oS10.2';
UPDATE `stage_task_templates` SET `seq` = 3,  `code` = 'S10.3'  WHERE `template_id` = @tpl AND `code` = 'oS10.3';
UPDATE `stage_task_templates` SET `seq` = 4,  `code` = 'S10.4'  WHERE `template_id` = @tpl AND `code` = 'oS10.4';
UPDATE `stage_task_templates` SET `seq` = 5,  `code` = 'S10.5'  WHERE `template_id` = @tpl AND `code` = 'oS10.6';
UPDATE `stage_task_templates` SET `seq` = 6,  `code` = 'S10.6'  WHERE `template_id` = @tpl AND `code` = 'oS10.5';

UPDATE `stage_task_templates` SET `seq` = 1,  `code` = 'S18.1'  WHERE `template_id` = @tpl AND `code` = 'oS18.1';
UPDATE `stage_task_templates` SET `seq` = 2,  `code` = 'S18.2'  WHERE `template_id` = @tpl AND `code` = 'oS18.2';
UPDATE `stage_task_templates` SET `seq` = 3,  `code` = 'S18.3'  WHERE `template_id` = @tpl AND `code` = 'oS18.3';
UPDATE `stage_task_templates` SET `seq` = 4,  `code` = 'S18.6'  WHERE `template_id` = @tpl AND `code` = 'oS18.4';
UPDATE `stage_task_templates` SET `seq` = 5,  `code` = 'S18.7'  WHERE `template_id` = @tpl AND `code` = 'oS18.5';
UPDATE `stage_task_templates` SET `seq` = 6,  `code` = 'S18.8'  WHERE `template_id` = @tpl AND `code` = 'oS18.6';
UPDATE `stage_task_templates` SET `seq` = 7,  `code` = 'S18.9'  WHERE `template_id` = @tpl AND `code` = 'oS18.7';
UPDATE `stage_task_templates` SET `seq` = 9,  `code` = 'S18.11' WHERE `template_id` = @tpl AND `code` = 'oS18.8';
UPDATE `stage_task_templates` SET `seq` = 10, `code` = 'S18.12' WHERE `template_id` = @tpl AND `code` = 'oS18.9';
UPDATE `stage_task_templates` SET `seq` = 11, `code` = 'S18.13' WHERE `template_id` = @tpl AND `code` = 'oS18.10';
UPDATE `stage_task_templates` SET `seq` = 12, `code` = 'S18.14', `auto_event` = 'client_signoff'
 WHERE `template_id` = @tpl AND `code` = 'oS18.11';
UPDATE `stage_task_templates` SET `seq` = 13, `code` = 'S18.15', `auto_event` = 'project_completed'
 WHERE `template_id` = @tpl AND `code` = 'oS18.12';

-- 4 ─────────────────────────────────────────────────────────────────────────────
INSERT INTO `stage_task_templates`
  (`id`, `template_id`, `stage_seq`, `seq`, `code`, `name`, `actor_role`, `is_hold_point`, `auto_event`) VALUES
  ('c5600000-0000-4000-8000-000000000001', @tpl, 1,  5,  'S1.3',   'Declare building type and unit count', 'PM', 0, NULL),
  ('c5600000-0000-4000-8000-000000000002', @tpl, 1,  8,  'S1.7',   'Confirm or override the OCR extract', 'PM', 0, NULL),
  ('c5600000-0000-4000-8000-000000000003', @tpl, 6,  8,  'S6.8',   'Client views the 3D preview (optional)', 'Client', 0, NULL),
  ('c5600000-0000-4000-8000-000000000004', @tpl, 9,  8,  'S9.8',   'Technical documents handed to the crew (offline cache)', 'System', 0, 'job_award_accepted'),
  ('c5600000-0000-4000-8000-000000000005', @tpl, 9,  10, 'S9.10',  'Stages 10–18 activated for the Builder', 'System', 0, 'programme_activated'),
  ('c5600000-0000-4000-8000-000000000006', @tpl, 11, 12, 'S11.12', 'Concrete pour (after the S11.9–S11.11 certificates)', 'Foreperson', 0, NULL),
  ('c5600000-0000-4000-8000-000000000007', @tpl, 12, 10, 'S12.10', 'BASE milestone: Stage 12 validated', 'System', 0, 'stage_validated'),
  ('c5600000-0000-4000-8000-000000000008', @tpl, 13, 11, 'S13.11', 'FRAME milestone: Stage 13 validated', 'System', 0, 'stage_validated'),
  ('c5600000-0000-4000-8000-000000000009', @tpl, 18, 8,  'S18.10', 'Cross-check: Stages 12 and 15 validated', 'System', 0, 'cross_check'),
  ('c5600000-0000-4000-8000-000000000010', @tpl, 18, 14, 'S18.16', 'Work recorded on every participant''s Verified Work History', 'System', 0, 'attestations_emitted')
ON DUPLICATE KEY UPDATE `id` = `id`;

-- 5 ─── Q4: lib S10.7 "Site Supervisor confirms setout" is the S10.5 hold point's own verify.
UPDATE `tasks` t JOIN `stage_task_templates` s ON s.id = t.template_item_id
   SET t.code = 'S10.7x', t.template_item_id = NULL
 WHERE s.template_id = @tpl AND s.code = 'oS10.7';
DELETE FROM `stage_task_templates` WHERE `template_id` = @tpl AND `code` = 'oS10.7';

-- 6 ─── live tasks follow their library row: code, SYS+ flag, order; a row that moved stage
-- (S1.5 → S2.3, S5.2 → S6.1) moves its task to the matching stage of the same project.
UPDATE `tasks` t JOIN `stage_task_templates` s ON s.id = t.template_item_id
   SET t.code = s.code, t.auto_event = s.auto_event, t.seq = s.seq
 WHERE s.template_id = @tpl;
UPDATE `tasks` t
  JOIN `stage_task_templates` s ON s.id = t.template_item_id
  JOIN `project_stages` cur ON cur.id = t.stage_id
  JOIN `project_stages` tgt ON tgt.project_id = t.project_id AND tgt.seq = s.stage_seq AND tgt.is_deleted = 0
   SET t.stage_id = tgt.id
 WHERE s.template_id = @tpl AND cur.seq <> s.stage_seq;

-- 7 ─── hand-added tasks keep S{stage}.{seq} unless the library reserves it in that stage (their
-- seq is unique within the stage, so they can't collide with each other). The rest stay NULL and
-- the server mints them on first read.
UPDATE `tasks` t JOIN `project_stages` ps ON ps.id = t.stage_id
   SET t.code = CONCAT('S', ps.seq, '.', t.seq)
 WHERE t.code IS NULL AND t.template_item_id IS NULL AND t.seq IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM `stage_task_templates` s
                    WHERE s.stage_seq = ps.seq AND s.code = CONCAT('S', ps.seq, '.', t.seq));

-- 8 ─── open stages of library-seeded projects get the NEW and SYS+ rows.
INSERT INTO `tasks` (`id`, `org_id`, `project_id`, `stage_id`, `name`, `template_item_id`, `seq`, `code`,
                     `auto_event`, `status`, `updated_at`, `server_updated_at`)
SELECT UUID(), ps.org_id, ps.project_id, ps.id, s.name, s.id, s.seq, s.code, s.auto_event, 'not_started',
       UNIX_TIMESTAMP() * 1000, NOW(3)
  FROM `stage_task_templates` s
  JOIN `project_stages` ps ON ps.seq = s.stage_seq AND ps.is_deleted = 0 AND ps.status <> 'complete'
 WHERE s.template_id = @tpl AND s.id LIKE 'c5600000-0000-4000-8000-%'
   AND EXISTS (SELECT 1 FROM `tasks` lt JOIN `stage_task_templates` ls ON ls.id = lt.template_item_id
                WHERE lt.project_id = ps.project_id AND ls.template_id = @tpl)
   AND NOT EXISTS (SELECT 1 FROM `tasks` e WHERE e.project_id = ps.project_id AND e.template_item_id = s.id);

-- 9 ─── SYS+ rows whose event has already happened are complete now.
UPDATE `tasks` t JOIN `projects` p ON p.id = t.project_id
   SET t.status = 'complete', t.completion = 100
 WHERE t.auto_event IN ('job_award_accepted', 'programme_activated') AND p.programme_activated_at IS NOT NULL;
UPDATE `tasks` t JOIN `project_stages` ps ON ps.id = t.stage_id
   SET t.status = 'complete', t.completion = 100
 WHERE t.auto_event = 'stage_validated' AND ps.is_validated = 1;
UPDATE `tasks` t
   SET t.status = 'complete', t.completion = 100
 WHERE t.auto_event = 'cross_check'
   AND EXISTS (SELECT 1 FROM `project_stages` a WHERE a.project_id = t.project_id AND a.seq = 12 AND a.is_validated = 1)
   AND EXISTS (SELECT 1 FROM `project_stages` b WHERE b.project_id = t.project_id AND b.seq = 15 AND b.is_validated = 1);
UPDATE `tasks` t
   SET t.status = 'complete', t.completion = 100
 WHERE t.auto_event = 'client_signoff'
   AND EXISTS (SELECT 1 FROM `hold_point_requirements` h WHERE h.project_id = t.project_id
                  AND h.auto_source = 'client_signoff' AND h.status = 'satisfied');
