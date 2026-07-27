-- ProjMan — migration v014: Step A2 (second half) of the corrective migration
-- (DIRECTIVE 1, servdesignspecification.md §7.2.1). `subcontractor_engagements` is
-- new, minimal infrastructure — P7 Commercial (contracts/POs/variations) was never
-- built, so there is no existing table to add a consent flag to. This is deliberately
-- the smallest shape that can hold the consent chain, not a P7 preview: enough to
-- name who the subcontractor is and gate their line-level attribution, nothing about
-- scope of works, rates, or POs.
--
-- Query-time engagement_mode money resolution itself (§7.2.1's `money.read`/
-- `money.write` behaviour) is a CODE change (ProjectService.getProject +
-- SyncService.pullDeltas), not schema — `job_awards.builder_engagement_type`
-- (migration_v013) is what it reads from.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- subcontractor_engagements — a trade business engaged under a Builder. Consent
-- defaults FALSE: a subcontractor who never signed the upward-disclosure clause
-- stays unattributed in PM's view, full stop, regardless of engagement_mode
-- (servdesignspec §7.2.1's enforcement rule).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `subcontractor_engagements` (
  `id`                                CHAR(36)     NOT NULL,
  `org_id`                            CHAR(36)     NOT NULL,
  `project_id`                        CHAR(36)     NOT NULL,
  `job_award_id`                      CHAR(36)     NULL COMMENT 'FK job_awards — the Builder engagement this subcontractor sits under',
  `subcontractor_user_id`             CHAR(36)     NULL COMMENT 'users.id when the subcontractor is a paired/self-registered person',
  `subcontractor_name`                VARCHAR(160) NULL COMMENT 'Free text when not yet a platform user',
  `trade`                             VARCHAR(60)  NULL,
  `subcontractor_pass_through_consent` TINYINT(1)  NOT NULL DEFAULT 0,
  `consent_recorded_at`               DATETIME     NULL,
  `consent_document_id`               CHAR(36)     NULL COMMENT 'The actual signed clause/document — not a bare checkbox with no evidence behind it',
  `created_at`                        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_subeng_project`   (`project_id`),
  KEY `idx_subeng_job_award` (`job_award_id`),
  CONSTRAINT `fk_subeng_org`       FOREIGN KEY (`org_id`)       REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_subeng_project`   FOREIGN KEY (`project_id`)   REFERENCES `projects` (`id`),
  CONSTRAINT `fk_subeng_award`     FOREIGN KEY (`job_award_id`) REFERENCES `job_awards` (`id`),
  CONSTRAINT `fk_subeng_user`      FOREIGN KEY (`subcontractor_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
