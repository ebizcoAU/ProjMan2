-- ProjMan2 — migration v045: subcontractor_engagements writer (xprojman-44 Module C).
-- `subcontractor_engagements` (migration_v014) has existed since the corrective
-- migration but had no writer anywhere — an accepted role_offered='subcontractor'
-- Job Award produced a `job_awards` row + `project_members` row and nothing else,
-- so no row ever existed to hang a PO, invoice, or consent flag off.
--
-- The only schema change needed: `job_awards.trade_offered`, carrying the trade
-- the Builder names at send time through to acceptance, where JobAwardService.respond
-- copies it into the new subcontractor_engagements row (mirrors how
-- `builder_engagement_type` already rides the award row for the builder case).
-- Nullable — only meaningful for role_offered='subcontractor', required by the
-- service layer at send time for that case, same enforcement shape as
-- builder_engagement_type's own requiredness.
--
-- No role_permissions change (reuses panel.manage, already held by builder/
-- projectManager) — matrix_version untouched.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

ALTER TABLE `job_awards`
  ADD COLUMN `trade_offered` VARCHAR(60) NULL
    COMMENT 'Free text, required at send time when role_offered=subcontractor; copied into subcontractor_engagements.trade on accept'
    AFTER `builder_engagement_type`;
