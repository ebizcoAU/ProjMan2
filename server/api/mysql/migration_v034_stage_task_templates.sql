-- ProjMan — migration v034: stage_task_templates (the WA_RESIDENTIAL_18 task
-- library) — owner-directed, 2026-09-03, correcting an earlier instruction that
-- would have seeded these 139 rows into `stage_template_items` directly.
--
-- `stage_template_items` is STAGE-granularity: exactly 18 rows per template,
-- UNIQUE(template_id, seq) with seq=1-18, and every project's `project_stages`
-- is instantiated 1:1 from it (StageTemplateService.instantiate). Task-level
-- content needs its own template, one level down — same parent/child shape
-- already proven twice in this schema (stage_templates/stage_template_items,
-- and cost_plans/estimate_lines).
--
-- Source content: docs/researchPaper/18Stage_Tasks.md (Portal draft + PM's
-- Reality Check review, merged, 2026-09-03) — 139 tasks, 15 hold points,
-- across the 18 stages. `code`/`name`/`actor_role`/`is_hold_point` below are a
-- direct, script-extracted transcription of that document's table rows, not
-- hand-typed, to avoid a transcription error across 139 rows.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- stage_task_templates — the task library, one level under stage_template_items.
-- `stage_seq` is a soft ref by VALUE to stage_template_items.seq (1-18), not an
-- FK to its id — a template's stages and its tasks are both keyed off the same
-- template_id + the stage's ordinal position, so this survives a template being
-- cloned (org copy) without needing to remap stage ids.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `stage_task_templates` (
  `id`            CHAR(36)     NOT NULL,
  `template_id`   CHAR(36)     NOT NULL COMMENT 'FK stage_templates.id',
  `stage_seq`     INT          NOT NULL COMMENT 'stage_template_items.seq (1-18) this task belongs to',
  `seq`           INT          NOT NULL COMMENT 'task order within the stage',
  `code`          VARCHAR(10)  NOT NULL COMMENT 'reference code, e.g. S1.1 — 18Stage_Tasks.md',
  `name`          VARCHAR(255) NOT NULL,
  `actor_role`    VARCHAR(40)  NULL COMMENT 'typical actor, informational only — same posture as stage_template_items.actor_role',
  `is_hold_point` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stage_task_tpl_seq` (`template_id`, `stage_seq`, `seq`),
  KEY `idx_stage_task_templates_template_stage` (`template_id`, `stage_seq`),
  CONSTRAINT `fk_stage_task_tpl_template` FOREIGN KEY (`template_id`) REFERENCES `stage_templates` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- tasks.template_item_id — soft link back to the template row a seeded task
-- came from, same precedent as project_stages.template_item_id ->
-- stage_template_items.id (migration_v006). Lets the Portal drill-down read
-- is_hold_point/actor_role/code from the template without duplicating those
-- columns onto every instantiated task row. NULL for any task a PM/Builder
-- adds by hand (§ "core + extra, not a locked list" in the source doc).
-- ============================================================================
ALTER TABLE `tasks`
  ADD COLUMN `template_item_id` CHAR(36) NULL AFTER `predecessor_id`,
  ADD CONSTRAINT `fk_tasks_template_item` FOREIGN KEY (`template_item_id`) REFERENCES `stage_task_templates` (`id`);

-- ============================================================================
-- Seed: WA_RESIDENTIAL_18's 139 tasks (fixed template id from migration_v006).
-- ============================================================================
SET @tpl = '00000000-0000-4000-8000-00000000wa18';

INSERT INTO `stage_task_templates`
  (`id`, `template_id`, `stage_seq`, `seq`, `code`, `name`, `actor_role`, `is_hold_point`) VALUES
  (UUID(), @tpl, 1, 1, 'S1.1', 'Initial client meeting / brief capture', 'PM', 0),
  (UUID(), @tpl, 1, 2, 'S1.2', 'Verify land title & ownership', 'PM', 0),
  (UUID(), @tpl, 1, 3, 'S1.3', 'Order/obtain contour & feature survey', 'PM', 0),
  (UUID(), @tpl, 1, 4, 'S1.4', 'Confirm lot/plan number and zoning', 'PM', 0),
  (UUID(), @tpl, 1, 5, 'S1.5', 'Check easements, covenants, restrictive design guidelines', 'PM', 0),
  (UUID(), @tpl, 1, 6, 'S1.6', 'Confirm site access for delivery vehicles/crane', 'PM', 0),
  (UUID(), @tpl, 1, 7, 'S1.7', 'Collect customer emails / meeting summary', 'PM', 0),
  (UUID(), @tpl, 2, 1, 'S2.1', 'Lodge Dial-Before-You-Dig (DBYD) referral', 'PM', 0),
  (UUID(), @tpl, 2, 2, 'S2.2', 'Record sewer/stormwater connection depth and point of connection', 'PM', 0),
  (UUID(), @tpl, 2, 3, 'S2.3', 'Check overhead power clearance', 'PM', 0),
  (UUID(), @tpl, 2, 4, 'S2.4', 'Confirm council zoning code and density/site-coverage allowance', 'PM', 0),
  (UUID(), @tpl, 2, 5, 'S2.5', 'Check bushfire-prone area (BAL) status', 'PM', 0),
  (UUID(), @tpl, 2, 6, 'S2.6', 'Check flood/acid-sulfate-soil overlay', 'PM', 0),
  (UUID(), @tpl, 2, 7, 'S2.7', 'Check heritage overlay / tree-protection order', 'PM', 0),
  (UUID(), @tpl, 2, 8, 'S2.8', 'PM reviews and confirms the compiled hazard audit', 'PM', 0),
  (UUID(), @tpl, 3, 1, 'S3.1', 'Confirm client''s preferred footprint/orientation', 'PM', 0),
  (UUID(), @tpl, 3, 2, 'S3.2', 'Generate/review footprint within setback envelope', 'PM/System', 0),
  (UUID(), @tpl, 3, 3, 'S3.3', 'Review floor area summary against budget', 'PM', 0),
  (UUID(), @tpl, 3, 4, 'S3.4', 'PM confirms concept before client sees it', 'PM', 0),
  (UUID(), @tpl, 3, 5, 'S3.5', 'Log client-requested revisions', 'PM', 0),
  (UUID(), @tpl, 4, 1, 'S4.1', 'Decide screening pathway (Planner vs direct)', 'PM', 0),
  (UUID(), @tpl, 4, 2, 'S4.2', 'Brief the Town Planner (if engaged)', 'PM', 0),
  (UUID(), @tpl, 4, 3, 'S4.3', 'Track council/planner response clock', 'PM', 0),
  (UUID(), @tpl, 4, 4, 'S4.4', 'Record outcome and conditions raised', 'PM', 0),
  (UUID(), @tpl, 5, 1, 'S5.1', 'Review 3 cost-calibrated style options', 'PM', 0),
  (UUID(), @tpl, 5, 2, 'S5.2', 'Present options to client; record their selection', 'PM', 0),
  (UUID(), @tpl, 5, 3, 'S5.3', 'Reconcile selected tier against the indicative budget', 'PM', 0),
  (UUID(), @tpl, 6, 1, 'S6.1', 'Route selected tier''s brief to the draftsman/architect', 'PM', 0),
  (UUID(), @tpl, 6, 2, 'S6.2', 'Client completes material selections', 'Client', 0),
  (UUID(), @tpl, 6, 3, 'S6.3', 'Track draftsman/architect turnaround', 'PM', 0),
  (UUID(), @tpl, 6, 4, 'S6.4', 'Upload finalised structural floor plans + elevations', 'PM', 0),
  (UUID(), @tpl, 6, 5, 'S6.5', 'PM reviews 3D material preview before client sees it', 'PM', 0),
  (UUID(), @tpl, 6, 6, 'S6.6', 'Resolve out-of-variance material selections', 'PM', 0),
  (UUID(), @tpl, 7, 1, 'S7.1', 'Final release check on the DA package', 'PM', 0),
  (UUID(), @tpl, 7, 2, 'S7.2', 'Client reviews and signs off DA package', 'Client', 0),
  (UUID(), @tpl, 7, 3, 'S7.3', 'Lodge DA with council / certifier', 'PM/System', 0),
  (UUID(), @tpl, 7, 4, 'S7.4', 'Track council''s statutory response clock', 'PM', 0),
  (UUID(), @tpl, 7, 5, 'S7.5', 'If declined: redraft via Variation', 'PM', 0),
  (UUID(), @tpl, 8, 1, 'S8.1', 'Record DA approval from council', 'PM', 0),
  (UUID(), @tpl, 8, 2, 'S8.2', 'Engage Principal Certifier', 'PM', 0),
  (UUID(), @tpl, 8, 3, 'S8.3', 'Obtain structural engineer certification', 'Structural Engineer', 0),
  (UUID(), @tpl, 8, 4, 'S8.4', 'Lodge Construction Certificate application', 'PM', 0),
  (UUID(), @tpl, 8, 5, 'S8.5', 'HOLD POINT — NCC compliance', 'Inspector', 1),
  (UUID(), @tpl, 8, 6, 'S8.6', 'Confirm DA conditions addressed', 'PM', 0),
  (UUID(), @tpl, 8, 7, 'S8.7', 'Confirm Home Warranty Insurance', 'PM', 0),
  (UUID(), @tpl, 8, 8, 'S8.8', 'Receive CC — construction can commence', 'System', 0),
  (UUID(), @tpl, 9, 1, 'S9.1', 'Prepare Bill of Quantities from drawings', 'PM/Estimator', 0),
  (UUID(), @tpl, 9, 2, 'S9.2', 'Issue tender to shortlist of Builders', 'PM', 0),
  (UUID(), @tpl, 9, 3, 'S9.3', 'Compare Builder tenders', 'PM', 0),
  (UUID(), @tpl, 9, 4, 'S9.4', 'Select winning Builder', 'PM', 0),
  (UUID(), @tpl, 9, 5, 'S9.5', 'Send formal Job Award invitation', 'PM', 0),
  (UUID(), @tpl, 9, 6, 'S9.6', 'Builder accepts/declines', 'Builder', 0),
  (UUID(), @tpl, 9, 7, 'S9.7', 'Set `builder_engagement_type`', 'PM', 0),
  (UUID(), @tpl, 9, 8, 'S9.8', 'Finalise and lock construction Cost Plan', 'PM', 0),
  (UUID(), @tpl, 9, 9, 'S9.9', 'Builder confirms/overrides job breakdown', 'Builder', 0),
  (UUID(), @tpl, 9, 10, 'S9.10', 'Builder engages own subcontractor panel', 'Builder', 0),
  (UUID(), @tpl, 10, 1, 'S10.1', 'Site induction / toolbox talk', 'Site Supervisor', 0),
  (UUID(), @tpl, 10, 2, 'S10.2', 'Site clearing and demolition', 'Foreperson', 0),
  (UUID(), @tpl, 10, 3, 'S10.3', 'Cut and fill earthworks to design levels', 'Foreperson', 0),
  (UUID(), @tpl, 10, 4, 'S10.4', 'Install temporary site amenities', 'Foreperson', 0),
  (UUID(), @tpl, 10, 5, 'S10.5', 'Install temporary fencing and signage', 'Foreperson', 0),
  (UUID(), @tpl, 10, 6, 'S10.6', 'HOLD POINT — Surveyor sets out building position', 'Surveyor + Foreperson', 1),
  (UUID(), @tpl, 10, 7, 'S10.7', 'Site Supervisor confirms setout', 'Site Supervisor', 0),
  (UUID(), @tpl, 11, 1, 'S11.1', 'Excavate footings and trenches', 'Tradie', 0),
  (UUID(), @tpl, 11, 2, 'S11.2', 'Underground drainage — sewer, stormwater', 'Tradie', 0),
  (UUID(), @tpl, 11, 3, 'S11.3', 'Water supply rough-in', 'Tradie', 0),
  (UUID(), @tpl, 11, 4, 'S11.4', 'Gas line rough-in (if required)', 'Tradie', 0),
  (UUID(), @tpl, 11, 5, 'S11.5', 'Electrical conduit rough-in', 'Tradie', 0),
  (UUID(), @tpl, 11, 6, 'S11.6', 'Reinforcement steel (rebar) placement', 'Tradie', 0),
  (UUID(), @tpl, 11, 7, 'S11.7', 'Formwork for slab', 'Tradie', 0),
  (UUID(), @tpl, 11, 8, 'S11.8', 'Site Supervisor checks service location/depth', 'Site Supervisor', 0),
  (UUID(), @tpl, 11, 9, 'S11.9', 'HOLD POINT — electrician''s rough-in certificate', 'Inspector (Electrical)', 1),
  (UUID(), @tpl, 11, 10, 'S11.10', 'HOLD POINT — plumber''s rough-in certificate', 'Inspector (Plumbing)', 1),
  (UUID(), @tpl, 11, 11, 'S11.11', 'HOLD POINT — Principal Certifier overall verification', 'Inspector', 1),
  (UUID(), @tpl, 12, 1, 'S12.1', 'Pour ground floor slab and footings', 'Foreperson', 0),
  (UUID(), @tpl, 12, 2, 'S12.2', 'Finish concrete to design levels', 'Foreperson', 0),
  (UUID(), @tpl, 12, 3, 'S12.3', 'Install anchor bolts and connection plates', 'Foreperson', 0),
  (UUID(), @tpl, 12, 4, 'S12.4', 'Cure concrete (time-gated)', 'System', 0),
  (UUID(), @tpl, 12, 5, 'S12.5', 'Waterproofing (if required)', 'Foreperson', 0),
  (UUID(), @tpl, 12, 6, 'S12.6', 'Record concrete delivery dockets', 'Site Supervisor', 0),
  (UUID(), @tpl, 12, 7, 'S12.7', 'HOLD POINT — Form BA2 slab inspection', 'Inspector', 1),
  (UUID(), @tpl, 12, 8, 'S12.8', 'HOLD POINT — core compression test (if flagged)', 'Inspector', 1),
  (UUID(), @tpl, 12, 9, 'S12.9', 'HOLD POINT — compaction test log (if flagged)', 'Inspector', 1),
  (UUID(), @tpl, 13, 1, 'S13.1', 'Erect structural frame (timber/steel)', 'Tradie', 0),
  (UUID(), @tpl, 13, 2, 'S13.2', 'Install structural bracing', 'Tradie', 0),
  (UUID(), @tpl, 13, 3, 'S13.3', 'Install roof trusses and sheathing', 'Tradie', 0),
  (UUID(), @tpl, 13, 4, 'S13.4', 'Install roof cladding', 'Tradie', 0),
  (UUID(), @tpl, 13, 5, 'S13.5', 'Install gutters and downpipes', 'Tradie', 0),
  (UUID(), @tpl, 13, 6, 'S13.6', 'Install ceiling insulation', 'Tradie', 0),
  (UUID(), @tpl, 13, 7, 'S13.7', 'Record timber/steel + roof material dockets', 'Site Supervisor', 0),
  (UUID(), @tpl, 13, 8, 'S13.8', 'HOLD POINT — structural engineer inspects frame', 'Inspector (Engineer)', 1),
  (UUID(), @tpl, 13, 9, 'S13.9', 'HOLD POINT — building surveyor inspects frame', 'Inspector (Surveyor)', 1),
  (UUID(), @tpl, 13, 10, 'S13.10', 'HOLD POINT — F5 timber grade certification', 'System', 1),
  (UUID(), @tpl, 14, 1, 'S14.1', 'Install external wall cladding', 'Tradie', 0),
  (UUID(), @tpl, 14, 2, 'S14.2', 'Install windows and glazing', 'Tradie', 0),
  (UUID(), @tpl, 14, 3, 'S14.3', 'Install external doors', 'Tradie', 0),
  (UUID(), @tpl, 14, 4, 'S14.4', 'Install wall insulation', 'Tradie', 0),
  (UUID(), @tpl, 14, 5, 'S14.5', 'Window/cladding QA check (internal)', 'Site Supervisor', 0),
  (UUID(), @tpl, 14, 6, 'S14.6', 'Window energy rating certificate', 'System', 0),
  (UUID(), @tpl, 14, 7, 'S14.7', 'Confirm building secured from weather', 'Site Supervisor', 0),
  (UUID(), @tpl, 15, 1, 'S15.1', 'Electrical rough-in (cabling, switchboard, alarms)', 'Tradie', 0),
  (UUID(), @tpl, 15, 2, 'S15.2', 'Plumbing rough-in (drainage, water supply)', 'Tradie', 0),
  (UUID(), @tpl, 15, 3, 'S15.3', 'HVAC rough-in (ducting, refrigerant)', 'Tradie', 0),
  (UUID(), @tpl, 15, 4, 'S15.4', 'Data/comms cabling (if required)', 'Tradie', 0),
  (UUID(), @tpl, 15, 5, 'S15.5', 'HOLD POINT — electrical inspection', 'Inspector (Electrical)', 1),
  (UUID(), @tpl, 15, 6, 'S15.6', 'HOLD POINT — plumbing inspection', 'Inspector (Plumbing)', 1),
  (UUID(), @tpl, 15, 7, 'S15.7', 'Electrical safety compliance certificate', 'System', 0),
  (UUID(), @tpl, 15, 8, 'S15.8', 'Install plasterboard/wall lining', 'Tradie', 0),
  (UUID(), @tpl, 16, 1, 'S16.1', 'Plastering and setting', 'Tradie', 0),
  (UUID(), @tpl, 16, 2, 'S16.2', 'Painting', 'Tradie', 0),
  (UUID(), @tpl, 16, 3, 'S16.3', 'Cabinetry installation', 'Tradie', 0),
  (UUID(), @tpl, 16, 4, 'S16.4', 'Tiling (per room/wet area)', 'Tradie', 0),
  (UUID(), @tpl, 16, 5, 'S16.5', 'Flooring', 'Tradie', 0),
  (UUID(), @tpl, 16, 6, 'S16.6', 'Fixtures and fittings', 'Tradie', 0),
  (UUID(), @tpl, 16, 7, 'S16.7', 'HOLD POINT — energisation certificate', 'Electrician + Inspector', 1),
  (UUID(), @tpl, 16, 8, 'S16.8', 'Appliance installation', 'Tradie', 0),
  (UUID(), @tpl, 16, 9, 'S16.9', 'Record cabinetry/tiles/fixtures deliveries', 'Foreperson', 0),
  (UUID(), @tpl, 16, 10, 'S16.10', 'Final trade sign-off, per room', 'Foreperson/Site Supervisor', 0),
  (UUID(), @tpl, 17, 1, 'S17.1', 'External cladding final finishes and painting', 'Tradie', 0),
  (UUID(), @tpl, 17, 2, 'S17.2', 'Driveway and paths (council permit may apply)', 'Tradie', 0),
  (UUID(), @tpl, 17, 3, 'S17.3', 'Retaining walls', 'Tradie', 0),
  (UUID(), @tpl, 17, 4, 'S17.4', 'Boundary fencing', 'Tradie', 0),
  (UUID(), @tpl, 17, 5, 'S17.5', 'Hard landscaping', 'Tradie', 0),
  (UUID(), @tpl, 17, 6, 'S17.6', 'Soft landscaping', 'Tradie', 0),
  (UUID(), @tpl, 17, 7, 'S17.7', 'Final clean (builder''s clean)', 'Tradie', 0),
  (UUID(), @tpl, 17, 8, 'S17.8', 'Record fencing/retaining-wall/landscaping deliveries', 'Foreperson', 0),
  (UUID(), @tpl, 17, 9, 'S17.9', 'Site Supervisor final external walk-through', 'Site Supervisor', 0),
  (UUID(), @tpl, 18, 1, 'S18.1', 'Final building inspection', 'Inspector', 0),
  (UUID(), @tpl, 18, 2, 'S18.2', 'Issue Form BA3 (Certificate of Compliance)', 'Inspector', 0),
  (UUID(), @tpl, 18, 3, 'S18.3', 'HOLD POINT — Occupation Certificate', 'Inspector', 1),
  (UUID(), @tpl, 18, 4, 'S18.4', 'Practical Completion walkthrough — generate defect list', 'PM & Client', 0),
  (UUID(), @tpl, 18, 5, 'S18.5', 'Defect rectification (loops until clear)', 'Tradie', 0),
  (UUID(), @tpl, 18, 6, 'S18.6', 'Client handover — keys, manuals, warranties', 'PM', 0),
  (UUID(), @tpl, 18, 7, 'S18.7', 'Client satisfaction survey', 'Client', 0),
  (UUID(), @tpl, 18, 8, 'S18.8', 'Prepare fixed-asset + depreciation draft', 'System', 0),
  (UUID(), @tpl, 18, 9, 'S18.9', 'APPROVAL GATE — Accountant/BAS Agent approves', 'Accountant/BAS Agent', 0),
  (UUID(), @tpl, 18, 10, 'S18.10', 'Auto-email handover pack', 'System', 0),
  (UUID(), @tpl, 18, 11, 'S18.11', 'Client final digital sign-off', 'Client', 0),
  (UUID(), @tpl, 18, 12, 'S18.12', 'Project status set to completed', 'System', 0);
