-- ProjMan — migration v038: tasks.status (N/A + cancelled, xprojman-38 §1) and
-- tasks.seq (own ordinal, xprojman-38 §2), owner directive 2026-09-05.
--
-- `status` is nullable, not NOT NULL DEFAULT 'not_started' — every existing task
-- predates this column, and the one-time backfill below is a deliberate, visible
-- decision (completion=0->not_started, 0<completion<100->in_progress,
-- completion=100->complete), not silently baked into the column default. Going
-- forward `status` is authoritative: TaskProgressService.guardPush derives it from
-- every completion-changing push so the two columns never drift, and the office
-- PATCH path can additionally set 'cancelled'/'n_a' (never device-writable).
--
-- `seq` lets EVERY task — template-seeded or hand-added (xprojman-38 §3, no create
-- endpoint existed before this) — carry its own Sx.y ordinal directly, without a
-- join to stage_task_templates (whose seq only ever existed for seeded tasks).
-- Backfilled from the template for existing seeded tasks; left NULL for existing
-- hand-added tasks (there's no ordering data to derive it from honestly — same
-- "NULL over a fabricated guess" posture as description/is_outsourced, v037). Every
-- task created after this migration (seeded at instantiation, or via the new
-- POST /projects/:id/tasks) gets a real seq going forward.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

ALTER TABLE `tasks`
  ADD COLUMN `status` ENUM('not_started','in_progress','complete','cancelled','n_a')
    NULL AFTER `completion`,
  ADD COLUMN `seq` INT NULL AFTER `template_item_id`;

-- One-time backfill, not an ongoing derivation — confirmed rule, xprojman-38 §1.
UPDATE `tasks`
   SET `status` = CASE
                    WHEN `completion` >= 100 THEN 'complete'
                    WHEN `completion` > 0    THEN 'in_progress'
                    ELSE 'not_started'
                  END
 WHERE `status` IS NULL;

-- Backfill seq for existing template-seeded tasks from their template row.
-- Hand-added existing tasks (template_item_id IS NULL) are left seq=NULL —
-- there's no template to derive an ordinal from and no ordering was ever
-- captured for them.
UPDATE `tasks` t
  JOIN `stage_task_templates` stt ON stt.id = t.template_item_id
   SET t.`seq` = stt.`seq`
 WHERE t.`seq` IS NULL;
