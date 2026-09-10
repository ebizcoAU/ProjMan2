-- ProjMan — migration v043: External cost — task quotes (xprojman-39 §3,
-- confirmed §6 response). Both open questions there answered and re-
-- confirmed in that same response, not re-litigated here:
--
--   §3.1 quote approval — a NEW `quotes.approve` permission, projectManager
--   only (mirrors `claims.approve` exactly, including NOT enforcing
--   four-eyes — this app doesn't enforce that separation anywhere else for
--   a structurally similar approval).
--
--   §3.2 separate `task_quotes` table, NOT an extension of purchase_orders
--   — `committed_amount`-style rollups elsewhere already read
--   `purchase_orders.status IN ('issued','received')` as real committed
--   spend; folding a `pending` quote state into that same table/status
--   enum would be a live footgun for the next copy-pasted WHERE clause.
--
-- No `owner_party` column here (unlike purchase_orders) — TaskQuoteService.
-- approve() raises the PO through the EXISTING ProcurementService.
-- createPurchaseOrder, which derives owner_party from the approving actor's
-- own role the same way it always has; duplicating that column here would
-- be a second place for the same fact to drift from the PO it produces.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

CREATE TABLE IF NOT EXISTS `task_quotes` (
  `id`                 CHAR(36)      NOT NULL,
  `org_id`             CHAR(36)      NOT NULL,
  `project_id`         CHAR(36)      NOT NULL,
  `task_id`            CHAR(36)      NOT NULL,
  `supplier_name`      VARCHAR(200)  NOT NULL,
  `amount`             DECIMAL(14,2) NOT NULL,
  `valid_until`        DATE          NULL,
  `document_id`        CHAR(36)      NULL COMMENT 'soft ref, documents table, entity_type=task_quote — the attached quote PDF/photo',
  `status`             ENUM('pending','approved','declined') NOT NULL DEFAULT 'pending',
  `purchase_order_id`  CHAR(36)      NULL COMMENT 'set on approval — the PO raised FROM this quote (existing procurement flow, xprojman-39 §3 phase 4)',
  `approved_by`        CHAR(36)      NULL COMMENT 'Server-stamped — set on approve OR decline (the resolving actor), same as progress_claims.approved_by',
  `approved_at`        DATETIME      NULL,
  `raised_by_user_id`  CHAR(36)      NOT NULL,
  `is_deleted`         TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tq_task`    (`task_id`),
  KEY `idx_tq_project` (`project_id`, `status`),
  CONSTRAINT `fk_tq_org`        FOREIGN KEY (`org_id`)     REFERENCES `organisations` (`id`),
  CONSTRAINT `fk_tq_project`    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_tq_task`       FOREIGN KEY (`task_id`)    REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_tq_po`         FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `fk_tq_raised_by`  FOREIGN KEY (`raised_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_tq_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `role_permissions` (`role`, `permission`) VALUES
  ('projectManager', 'quotes.approve')
ON DUPLICATE KEY UPDATE `permission` = VALUES(`permission`);

UPDATE `access_meta` SET `v` = '14' WHERE `k` = 'matrix_version';
