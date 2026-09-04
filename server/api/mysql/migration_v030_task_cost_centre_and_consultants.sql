-- ProjMan — migration v030: two small, unrelated, additive asks bundled together (both
-- signed off 2026-09-03, neither touches the other's tables):
--
--   (A) Task-level cost centre (xprojman-29, Portal → Server request, full team sign-off):
--       `tasks.actual_hours`/`output_note`, `purchase_orders.task_id`,
--       `supplier_invoices.task_id`. Deliberately NOT adding `tasks.actual_amount` — outsourced
--       task cost is a live query over `supplier_invoices` filtered by the new `task_id`
--       (SUM(amount) WHERE task_id=X AND status IN ('matched','approved')), not a duplicated,
--       driftable column. `documents.entity_type` gets `'task'` added in code
--       (DocumentService.js's ENTITY_TYPES), not here — it was never a DB enum.
--
--   (B) Stage 3 (Concept Design Generation) supporting schema (serverdesignspecification.md
--       §14.2, from the v3.4 spec's S3.10/S3.11 revision loop + consultant references across
--       S6/S8/S13/S18): `documents.supersedes_id` (soft ref, no FK — same undeclared-FK pattern
--       already used by `site_diary.supersedes_id`, since both are self-referencing correction
--       chains, not parent/child rows) and a new `consultants` table for the external,
--       no-login professionals (draftsman, architect, structural engineer, building surveyor,
--       principal certifier, accountant/BAS agent) the spec references repeatedly but which had
--       no table anywhere.
--
-- NO MATRIX BUMP: no new permission introduced. `actual_hours`/`output_note` ride the existing
-- `tasks` sync-registry entry (owner: app); `task_id` on PO/invoice is written through the
-- existing `po.write`-gated create endpoints; `consultants` reads/writes are PM-only for now
-- (same actor as everything else through Stage 8, per the spec's own S6 note) — no dedicated
-- route built in this migration, schema only, per §14.2's "flagging existence and shape only."

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ── (A) Task-level cost centre ──────────────────────────────────────────────────────────────

ALTER TABLE `tasks`
  ADD COLUMN `actual_hours` DECIMAL(8,2) NULL
    COMMENT 'FINANCIAL-adjacent, same redaction posture as budget_hours — on-site ground truth, App-writable (xprojman-29)'
    AFTER `budget_amount`,
  ADD COLUMN `output_note` TEXT NULL
    COMMENT 'What the task actually produced, in the assignee''s own words (xprojman-29 §3)'
    AFTER `predecessor_id`;

ALTER TABLE `purchase_orders`
  ADD COLUMN `task_id` CHAR(36) NULL
    COMMENT 'nullable — a PO can still be stage-level-only, same as before this column existed'
    AFTER `stage_id`,
  ADD CONSTRAINT `fk_po_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`);

ALTER TABLE `supplier_invoices`
  ADD COLUMN `task_id` CHAR(36) NULL
    AFTER `stage_id`,
  ADD CONSTRAINT `fk_inv_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`);

-- ── (B) Stage 3 supporting schema ───────────────────────────────────────────────────────────

ALTER TABLE `documents`
  ADD COLUMN `supersedes_id` CHAR(36) NULL
    COMMENT 'the prior version this row replaces (Stage 3 S3.11 revision loop) — soft ref, no FK by design, same as site_diary.supersedes_id: a correction chain, not a parent/child relationship'
    AFTER `kind`;

-- consultants — external, no-login professionals whose certification/deliverable the PM uploads
-- on receipt (S6.2/S6.4 draftsman/architect, S8.2/S8.3 Principal Certifier + Structural Engineer,
-- S13.8/S13.9 Engineer vs. Surveyor — two different disciplines, neither substitutes for the
-- other, S18.12 Accountant/BAS Agent). `discipline` is free text, not an ENUM, same
-- extensibility reasoning as `attestations.source_type` (v027) — a new professional type should
-- never need its own migration.
CREATE TABLE IF NOT EXISTS `consultants` (
  `id`              CHAR(36)     NOT NULL,
  `org_id`          CHAR(36)     NOT NULL,
  `discipline`      VARCHAR(40)  NOT NULL COMMENT 'draftsman|architect|structural_engineer|building_surveyor|principal_certifier|accountant_bas_agent|... — free text, extensible',
  `name`            VARCHAR(200) NOT NULL,
  `contact`         VARCHAR(200) NULL,
  `licence_number`  VARCHAR(60)  NULL,
  `is_deleted`      TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_consultants_org_discipline` (`org_id`, `discipline`, `is_deleted`),
  CONSTRAINT `fk_consultants_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
