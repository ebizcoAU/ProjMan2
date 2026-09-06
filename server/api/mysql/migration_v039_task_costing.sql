-- ProjMan — migration v039: Cost Plan costing engine, Phase 1 — §1 (Skill-rate
-- card) + §2 (task costing, cost centres) of xprojman-39, APPROVED FOR BUILD
-- 2026-09-06. §3 (quotes) and §4 (Job Scheduler) are NOT in this migration —
-- phased per the doc's own §5 build order.
--
-- No cached cost columns anywhere here — same anti-drift stance as
-- FinanceService/fin_accounts (migration_v031's own header): a rate card edit
-- must retroactively change every task's live cost, which a stored
-- estimated_cost/actual_cost column could never do without a bulk rewrite on
-- every rate change. CostingService computes labour cost LIVE at read time
-- from budget_hours/actual_hours x org_rate_cards.hourly_rate — nothing here
-- stores a cost figure, only the inputs (skill tier, cost centre).

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

-- ============================================================================
-- org_rate_cards — 4 fixed rows per org (Expert/Professional/Std/Free), never
-- a free-form list (owner decision, xprojman-39 §0.1). ex-GST hourly rate,
-- same convention as every other money field in this schema.
-- ============================================================================
CREATE TABLE IF NOT EXISTS `org_rate_cards` (
  `id`           CHAR(36)      NOT NULL,
  `org_id`       CHAR(36)      NOT NULL,
  `skill_level`  ENUM('expert','professional','std','free') NOT NULL,
  `hourly_rate`  DECIMAL(10,2) NOT NULL,
  `updated_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rate_org_skill` (`org_id`, `skill_level`),
  CONSTRAINT `fk_rate_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- cost_centres — a fixed, admin-managed org-wide list (confirmed xprojman-39
-- §6 response: same shape as `suppliers`, not project-level free text). A
-- REAL cost-centre entity, distinct from what migration_v030 called "task-
-- level cost centre" (that one only added a `task_id` FK to POs/invoices, no
-- actual Cost Centre master list — flagged in xprojman-37 §3, this is not a
-- duplicate of it).
-- ============================================================================
CREATE TABLE IF NOT EXISTS `cost_centres` (
  `id`          CHAR(36)     NOT NULL,
  `org_id`      CHAR(36)     NOT NULL,
  `code`        VARCHAR(20)  NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `is_deleted`  TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cc_org_code` (`org_id`, `code`),
  CONSTRAINT `fk_cc_org` FOREIGN KEY (`org_id`) REFERENCES `organisations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- tasks.skill_level / tasks.cost_centre_id — both nullable, "unknown"/"not yet
-- costed" is a real state, same posture as is_outsourced (xprojman-37). Never
-- device-writable (not in the sync-registry columns set for tasks) — set only
-- via the office PATCH, money.write-gated (CostingService), same "server sets
-- it, device can't" posture as status.
-- ============================================================================
ALTER TABLE `tasks`
  ADD COLUMN `skill_level`    ENUM('expert','professional','std','free') NULL AFTER `is_outsourced`,
  ADD COLUMN `cost_centre_id` CHAR(36) NULL AFTER `skill_level`,
  ADD CONSTRAINT `fk_tasks_cost_centre` FOREIGN KEY (`cost_centre_id`) REFERENCES `cost_centres` (`id`);
