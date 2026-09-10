-- ProjMan — migration v044: per-tenant journal + auto-posting (xprojman-42
-- §3, AUTO posting confirmed — owner clarified 2026-09-11, per Server's own
-- §6 recommendation: a manually-posted ledger has a forgettable step, the
-- exact parallel-truth/drift risk this codebase has already ruled against
-- repeatedly — cached cost figures, fin_accounts' own no-cached-balance
-- design, etc).
--
-- `org_journal` is the org-scoped mirror of `fin_journal` (migration v031) —
-- same anti-drift shape, no cached balance anywhere, P&L/Balance Sheet
-- always computed LIVE by summing this table. `project_id` is NULLABLE
-- (confirmed §8 point 1 — an overhead posting carries no project tag) even
-- though nothing in THIS migration posts an overhead entry yet (no org-level
-- "record an overhead expense" endpoint exists — that's its own future ask,
-- not invented here).
--
-- Auto-posting is wired into the two write paths where the account mapping
-- is genuinely unambiguous — see OrgFinanceService.postEntry's callers
-- (ClaimService.pay, ProcurementService's supplier-invoice matched/approved
-- transition). Deliberately NOT posted on a purchase_orders status change:
-- a PO is a commitment/encumbrance (already tracked in committed_amount),
-- not yet a real expense in either cash or accrual terms — the SUPPLIER
-- INVOICE reaching matched/approved is the actual cost event, matching this
-- app's own existing committed-vs-actual distinction. This is a considered
-- refinement of the doc's literal "purchase_orders/supplier_invoices status
-- changes, at minimum" wording, not a partial implementation of it.
--
-- Revenue posting is OUT OF SCOPE this pass — there is no unambiguous
-- client-billing/revenue write path in this schema yet (progress_claims is
-- Builder-bills-PM, a COST from the paying org's side; no PM-bills-client
-- flow exists). The P&L will correctly show real expenses against zero
-- revenue until that gap is closed — an honest absence, not a bug, same
-- posture as GOOGLE_MAPS_API_KEY being "not configured" (xprojman-40).

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

CREATE TABLE IF NOT EXISTS `org_journal` (
  `id`          CHAR(36)      NOT NULL,
  `org_id`      CHAR(36)      NOT NULL,
  `account_id`  CHAR(36)      NOT NULL,
  `project_id`  CHAR(36)      NULL COMMENT 'NULL = overhead/unattached posting (xprojman-42 §8 point 1)',
  `debit`       DECIMAL(14,2) NOT NULL DEFAULT 0,
  `credit`      DECIMAL(14,2) NOT NULL DEFAULT 0,
  `ref_type`    VARCHAR(40)   NOT NULL COMMENT 'progress_claim|supplier_invoice|... — free text, extensible, same reasoning as fin_journal.ref_type',
  `ref_id`      CHAR(36)      NULL,
  `memo`        VARCHAR(255)  NULL,
  `entry_date`  DATE          NOT NULL,
  `created_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_oj_account_date` (`org_id`, `account_id`, `entry_date`),
  KEY `idx_oj_ref`          (`org_id`, `ref_type`, `ref_id`),
  KEY `idx_oj_project`      (`project_id`),
  CONSTRAINT `fk_oj_org`     FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_oj_account` FOREIGN KEY (`account_id`) REFERENCES `org_accounts` (`id`),
  CONSTRAINT `fk_oj_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
