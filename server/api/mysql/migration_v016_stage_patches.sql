-- ProjMan — migration v016: Step D2 of the corrective migration (DIRECTIVE 1,
-- servdesignspecification.md §8, 18-Stage spec v3.4). Schema only — no seed data
-- here. `hold_point_requirements` rows are per-PROJECT (not per-template), so they
-- are seeded in JS at instantiation time (`StageTemplateService.instantiate`,
-- `HoldPointService.seedForStage`), exactly the same reasoning `project_stages`
-- itself is copied from `stage_template_items` in JS rather than in a migration.
--
-- Scope decision (documented here, restated in HoldPointService's header): this
-- does NOT rebuild the full S10.1…S18.16 sub-step numbering the 18-Stage spec
-- decomposes to (xprojman-01.md flagged that as the one item needing a design call
-- before migrating, given its blast radius against P6a/P6b). What IS built: the
-- concrete, named patches DIRECTIVE 1 lists — S10.5, S11.9 (informational split,
-- not a new blocking gate — see below), S12.8/S12.9 (informational, no hazard-audit
-- source table exists yet to auto-trigger from), S16.7/S17.2 (jurisdiction), S18.11/
-- S18.12 (the accountant gate) — as a checklist attached to the EXISTING whole-stage
-- `project_stages` rows, additive to the proven `is_hold_point`/`is_validated` gate,
-- never replacing it. Stages 11/12/13/15/18's EXISTING hold-point behaviour (P6a/P6b,
-- tests/quality.test.js + tests/compliance.test.js) is untouched — new requirement
-- rows on those stages are seeded `blocks_progress=0` (informational) specifically
-- to avoid silently making an already-tested gate stricter. Stage 10's hold point and
-- Stage 18's new accountant gate ARE `blocks_progress=1` — genuinely new blocking
-- conditions, on stages/scenarios no existing test currently exercises.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- modular_units — S1.3's building-type/unit-count declaration, written at project
-- creation (ProjectService.createProject). Stages 1–9 are always project-level
-- regardless of unit count; a standalone house is simply `modular_units` with
-- exactly one row (devroadmap.md §2: "not a special case... one model, one rule
-- set"). The Line-of-Balance renderer itself is Portal's job, not this migration's.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `modular_units` (
  `id`          CHAR(36)  NOT NULL,
  `org_id`      CHAR(36)  NOT NULL,
  `project_id`  CHAR(36)  NOT NULL,
  `unit_number` INT       NOT NULL,
  `created_at`  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit_project_number` (`project_id`, `unit_number`),
  CONSTRAINT `fk_unit_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_unit_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- hold_point_requirements — a checklist per stage, not a single flag (18-Stage spec
-- §1.5). `required_role` names WHO satisfies a row (not always "Inspector" — S10.5's
-- verifier is Site Supervisor) — `HoldPointService.satisfy` checks the matching
-- permission per row (inspector -> quality.validate, siteSupervisor ->
-- progress.verify, accountant -> tax.approve, pm -> programme.write). `jurisdiction`
-- first lands here for S16.7 (energisation certificate, named differently per
-- state) and S17.2 (driveway/crossover, PM-checked, non-blocking).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `hold_point_requirements` (
  `id`                      CHAR(36)     NOT NULL,
  `org_id`                  CHAR(36)     NOT NULL,
  `project_id`              CHAR(36)     NOT NULL,
  `stage_id`                CHAR(36)     NOT NULL COMMENT 'FK project_stages — the instance, not the template',
  `label`                   VARCHAR(160) NOT NULL,
  `required_role`           VARCHAR(40)  NOT NULL COMMENT 'inspector | siteSupervisor | accountant | projectManager',
  `inspection_type`         ENUM('statutory','internal_qa') NOT NULL DEFAULT 'statutory',
  `jurisdiction`            VARCHAR(10)  NULL COMMENT 'AU state/territory this requirement is specific to, where relevant (S16.7/S17.2)',
  `blocks_progress`         TINYINT(1)   NOT NULL DEFAULT 1,
  `status`                  ENUM('open','satisfied') NOT NULL DEFAULT 'open',
  `satisfied_by`            CHAR(36)     NULL COMMENT 'users.id — server-stamped only',
  `satisfied_at`            DATETIME     NULL,
  `triggered_by_finding_id` CHAR(36)     NULL COMMENT 'S12.8/9 — links back to a Stage 2 hazard-audit finding, when that module exists',
  `created_at`              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_hpr_stage`   (`stage_id`, `status`),
  KEY `idx_hpr_project` (`project_id`),
  CONSTRAINT `fk_hpr_org`     FOREIGN KEY (`org_id`)      REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_hpr_project` FOREIGN KEY (`project_id`)  REFERENCES `projects` (`id`),
  CONSTRAINT `fk_hpr_stage`   FOREIGN KEY (`stage_id`)    REFERENCES `project_stages` (`id`),
  CONSTRAINT `fk_hpr_satisfied_by` FOREIGN KEY (`satisfied_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
