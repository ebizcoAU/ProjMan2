-- ProjMan2 — migration v010: P6b compliance gates (servdesignspecification §12.10,
-- projman-03 R1-R3). Adds the NCC + structural completion gates on top of the
-- existing stage-progression engine (§10.4) — this migration does NOT touch
-- project_stages or the hold-point interlock; ComplianceService is called from
-- StageProgressionService.checkTransition alongside it, so REST /advance and the
-- sync-push path share the SAME gate (no separate sync wiring needed for this).
--
-- Source of record for the unit list: docs/decisions/projman-03.md (frozen
-- CPC50220_R4 transcription — 24 core + 13 elective units). Do not edit codes/titles
-- from memory; re-transcribe from the official PDF on any new release.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- cpc_units — R1: system reference, NOT tenant-scoped (no org_id) and NOT synced to
-- devices (same treatment as a shared lookup table — excluded from sync/registry.js's
-- pull loop). Every org sees the same frozen CPC50220 unit list.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `cpc_units` (
  `code`         VARCHAR(20)  NOT NULL COMMENT 'e.g. CPCCBC4001',
  `release`      VARCHAR(20)  NOT NULL COMMENT 'e.g. CPC50220_R4',
  `title`        VARCHAR(255) NOT NULL,
  `type`         ENUM('core','elective') NOT NULL,
  `prereq_codes` VARCHAR(100) NULL COMMENT 'Comma-separated cpc_units.code list',
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `cpc_units` (`code`, `release`, `title`, `type`, `prereq_codes`) VALUES
  -- Core (24)
  ('BSBOPS504',  'CPC50220_R4', 'Manage business risk', 'core', NULL),
  ('BSBWHS513',  'CPC50220_R4', 'Lead WHS risk management', 'core', NULL),
  ('CPCCBC4001', 'CPC50220_R4', 'Apply building codes and standards to the construction process for Class 1 and 10 buildings', 'core', NULL),
  ('CPCCBC4003', 'CPC50220_R4', 'Select, prepare and administer a construction contract', 'core', NULL),
  ('CPCCBC4004', 'CPC50220_R4', 'Identify and produce estimated costs for building and construction projects', 'core', NULL),
  ('CPCCBC4005', 'CPC50220_R4', 'Produce labour and material schedules for ordering', 'core', NULL),
  ('CPCCBC4008', 'CPC50220_R4', 'Supervise site communication and administration processes for building and construction projects', 'core', NULL),
  ('CPCCBC4009', 'CPC50220_R4', 'Apply legal requirements to building and construction projects', 'core', NULL),
  ('CPCCBC4010', 'CPC50220_R4', 'Apply structural principles to residential and commercial constructions', 'core', 'CPCCBC4053,CPCCBC4001'),
  ('CPCCBC4012', 'CPC50220_R4', 'Read and interpret plans and specifications', 'core', NULL),
  ('CPCCBC4013', 'CPC50220_R4', 'Prepare and evaluate tender documentation', 'core', NULL),
  ('CPCCBC4014', 'CPC50220_R4', 'Prepare simple building sketches and drawings', 'core', NULL),
  ('CPCCBC4018', 'CPC50220_R4', 'Apply site surveys and set-out procedures to building and construction projects', 'core', NULL),
  ('CPCCBC4053', 'CPC50220_R4', 'Apply building codes and standards to the construction process for Class 2 to 9, Type C buildings', 'core', NULL),
  ('CPCCBC5001', 'CPC50220_R4', 'Apply building codes and standards to the construction process for Type B construction', 'core', NULL),
  ('CPCCBC5002', 'CPC50220_R4', 'Monitor costing systems on complex building and construction projects', 'core', NULL),
  ('CPCCBC5003', 'CPC50220_R4', 'Supervise the planning of onsite building and construction work', 'core', NULL),
  ('CPCCBC5005', 'CPC50220_R4', 'Select and manage building and construction contractors', 'core', NULL),
  ('CPCCBC5007', 'CPC50220_R4', 'Administer the legal obligations of a building and construction contractor', 'core', NULL),
  ('CPCCBC5010', 'CPC50220_R4', 'Manage construction work', 'core', NULL),
  ('CPCCBC5011', 'CPC50220_R4', 'Manage environmental management practices and processes in building and construction', 'core', NULL),
  ('CPCCBC5013', 'CPC50220_R4', 'Manage professional technical and legal reports on building and construction projects', 'core', NULL),
  ('CPCCBC5018', 'CPC50220_R4', 'Apply structural principles to the construction of buildings up to 3 storeys', 'core', 'CPCCBC5001,CPCCBC4053'),
  ('CPCCBC5019', 'CPC50220_R4', 'Manage building and construction business finances', 'core', NULL),
  -- Elective (13 — a builder picks 3; the reference table seeds the whole pool)
  ('BSBPMG532',  'CPC50220_R4', 'Manage project quality', 'elective', NULL),
  ('BSBPMG538',  'CPC50220_R4', 'Manage project stakeholder engagement', 'elective', NULL),
  ('CPCCBC4052', 'CPC50220_R4', 'Lead and manage teams in the building and construction industry', 'elective', NULL),
  ('CPCCBC5004', 'CPC50220_R4', 'Supervise and apply quality standards to the selection of building and construction materials', 'elective', NULL),
  ('CPCCBC5006', 'CPC50220_R4', 'Apply site surveys and set-out procedures to building projects up to three storeys', 'elective', NULL),
  ('CPCCBC5009', 'CPC50220_R4', 'Identify services layout and connection methods for Type C and B construction', 'elective', NULL),
  ('CPCCBC5012', 'CPC50220_R4', 'Manage the application and monitoring of energy conservation and management practices and processes', 'elective', NULL),
  ('CPCCBC6001', 'CPC50220_R4', 'Apply building codes and standards to the construction process for large building projects', 'elective', NULL),
  ('CPCCDE5001', 'CPC50220_R4', 'Conduct air monitoring and clearance inspections for asbestos removal work', 'elective', NULL),
  ('CPCSUS5001', 'CPC50220_R4', 'Develop workplace policies and procedures for sustainability', 'elective', NULL),
  ('CPCSUS5002', 'CPC50220_R4', 'Develop action plans to retrofit existing buildings for energy efficiency', 'elective', NULL),
  ('CPCSUS5003', 'CPC50220_R4', 'Manage energy efficient building methods and strategies', 'elective', NULL),
  ('CPPDSM5022', 'CPC50220_R4', 'Develop and implement asset management plans', 'elective', NULL)
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

-- ============================================================================
-- cpc_feature_map — R1: unit -> feature/module tag, reference/non-tenant. Seeded
-- here only for the units this migration's gates actually enforce (R2); the
-- remaining development.md §12 gap-feature mappings land incrementally as those
-- modules are built, additive to this table.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `cpc_feature_map` (
  `unit_code` VARCHAR(20) NOT NULL,
  `feature`   VARCHAR(60) NOT NULL,
  PRIMARY KEY (`unit_code`, `feature`),
  CONSTRAINT `fk_feature_unit` FOREIGN KEY (`unit_code`) REFERENCES `cpc_units` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `cpc_feature_map` (`unit_code`, `feature`) VALUES
  ('CPCCBC4001', 'ncc'), ('CPCCBC4053', 'ncc'), ('CPCCBC5001', 'ncc'),
  ('CPCCBC6001', 'ncc'), ('CPCCBC5003', 'ncc'),
  ('CPCCBC4010', 'structural'), ('CPCCBC5018', 'structural')
ON DUPLICATE KEY UPDATE `feature` = VALUES(`feature`);

-- ============================================================================
-- ncc_register — R2/R3: an open item against a stage BLOCKS that stage's completion
-- (ComplianceService.checkNccCompliance, wired into StageProgressionService.
-- checkTransition — §10.4/§12.10). Tenant-scoped, project-scoped like the other
-- quality tables (§12.7); written through /sync/push, owner app, gated by the same
-- `quality.write` permission (QualityOpsService governs it, same pattern as defects).
-- `raised_by`/`raised_at`/`closed_at`/`closed_by` are server-stamped (PROTECTED).
--
-- R3 scope CHECK: residential (ncc_class 1 or 10, max 3 storeys per projman-03) takes
-- no building_type; commercial (ncc_class 2..9) must carry building_type B or C. This
-- mirrors the qualification's own scope limits so a client cannot record an
-- out-of-scope class.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `ncc_register` (
  `id`            CHAR(36)     NOT NULL,
  `org_id`        CHAR(36)     NOT NULL,
  `project_id`    CHAR(36)     NOT NULL,
  `stage_id`      CHAR(36)     NOT NULL COMMENT 'The stage this NCC item gates',
  `ncc_class`     VARCHAR(10)  NOT NULL COMMENT '1,10 residential; 2..9 commercial',
  `building_type` ENUM('B','C') NULL COMMENT 'Required when ncc_class is commercial (2..9)',
  `cpc_unit`      VARCHAR(20)  NULL COMMENT 'FK cpc_units.code — which unit this register item maps to',
  `reference`     VARCHAR(100) NULL,
  `notes`         TEXT         NULL,
  `status`        ENUM('open','closed') NOT NULL DEFAULT 'open',
  `raised_by`     CHAR(36)     NULL COMMENT 'Server-stamped from the session',
  `raised_at`     DATETIME     NULL,
  `closed_at`     DATETIME     NULL COMMENT 'Server-set when status -> closed',
  `closed_by`     CHAR(36)     NULL COMMENT 'Server-stamped from the closing session',
  `device_id`     VARCHAR(100) NULL,
  `is_deleted`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    BIGINT       NULL,
  `server_updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ncc_project` (`project_id`),
  KEY `idx_ncc_stage`   (`stage_id`, `status`),
  KEY `idx_ncc_cursor`  (`org_id`, `server_updated_at`),
  CONSTRAINT `fk_ncc_org`      FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_ncc_project`  FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_ncc_stage`    FOREIGN KEY (`stage_id`)   REFERENCES `project_stages` (`id`),
  CONSTRAINT `fk_ncc_cpc_unit` FOREIGN KEY (`cpc_unit`)   REFERENCES `cpc_units` (`code`),
  CONSTRAINT `chk_ncc_scope` CHECK (
    (`ncc_class` IN ('1','10') AND `building_type` IS NULL) OR
    (`ncc_class` IN ('2','3','4','5','6','7','8','9') AND `building_type` IN ('B','C'))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
