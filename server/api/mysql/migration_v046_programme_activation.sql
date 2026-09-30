-- ProjMan2 — migration v046: programme activation stamp (xprojman-45 §1, Option B,
-- SA ruling 2026-09-30).
--
-- The 18-Stage spec's S9.10 says Stages 10–18 are seeded "now that a Builder is
-- attached". The build stamps all 18 stages at project creation, because Stages 8–9
-- (BOQ, tender compare, S9.9 Cost Plan lock) price against the Stage 10–18 task
-- rows. Option B keeps that, and turns S9.10 into ACTIVATION instead of seeding:
--   * StageProgressionService refuses to START (or complete) any stage with
--     seq >= 10 until the project has an accepted role_offered='builder' Job Award
--     (BUILDER_NOT_ATTACHED, 409), on both the REST /advance and /sync/push paths.
--   * JobAwardService.respond stamps `projects.programme_activated_at` on the first
--     accepted builder award: the moment "the Gantt actually comes alive".
--
-- The gate reads job_awards (the source of truth), not this column. The column is
-- the activation record the Portal/App display. It is not in the sync registry's
-- writable columns, so no device can set it.
--
-- Backfill: projects that already have an accepted builder award get the award's
-- responded_at, so the stamp is consistent with the gate from day one.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

ALTER TABLE `projects`
  ADD COLUMN `programme_activated_at` DATETIME NULL
    COMMENT 'S9.10 activation — set on the first accepted builder Job Award (xprojman-45 Option B)';

UPDATE `projects` p
  JOIN (SELECT project_id, MIN(responded_at) AS first_accept
          FROM job_awards
         WHERE role_offered = 'builder' AND status = 'accepted'
         GROUP BY project_id) a ON a.project_id = p.id
   SET p.programme_activated_at = a.first_accept
 WHERE p.programme_activated_at IS NULL;
