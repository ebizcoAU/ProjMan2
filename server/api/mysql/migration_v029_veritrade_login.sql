-- ProjMan — migration v029: VeriTrade App-mediated login sessions
-- (veritradedesignspecification.md §4 — "no VeriTrade password, for anyone").
--
-- The QR-handshake primitive used elsewhere (Introduction, Engagement) is a
-- stateless signed JWT because nothing needs to be polled — the scanning device
-- acts immediately. A browser login is different: the browser has to POLL for the
-- outcome of an action that happens on a SEPARATE device (the phone) at an
-- unpredictable later moment, so there has to be a server-side row to poll against.
-- The signed JWT ("code") still exists here too (`veritrade_login_sessions.id` alone
-- is not accepted as proof of anything — every state-changing call verifies the
-- signed code), it's just accompanied by a row instead of being the whole mechanism.
--
-- Tokens are stored on the row only long enough for the browser's next poll to
-- collect them once (`redeemed_at` set immediately after), not held indefinitely —
-- the same reasoning /identity/share's grant token uses for not persisting a table
-- of open grants, applied to a case that DOES need a table.
--
-- NO MATRIX BUMP: initiate/poll are public by construction (nothing to authenticate
-- yet); approve/deny run under plain `authenticate` (the App user's own session) —
-- no new permission, same posture as the rest of VeriTrade v1.

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

CREATE TABLE IF NOT EXISTS `veritrade_login_sessions` (
  `id`                    CHAR(36)     NOT NULL,
  `status`                ENUM('pending','approved','denied','expired') NOT NULL DEFAULT 'pending',
  `requested_ip`          VARCHAR(64)  NULL,
  `requested_user_agent`  VARCHAR(255) NULL,
  `approved_user_id`      CHAR(36)     NULL COMMENT 'users.id — who approved from the App',
  `access_token`          TEXT         NULL COMMENT 'set on approve, cleared by the browser''s first successful poll',
  `refresh_token`         VARCHAR(64)  NULL,
  `resolved_at`           DATETIME     NULL COMMENT 'when approve/deny happened',
  `redeemed_at`           DATETIME     NULL COMMENT 'when the browser collected the tokens (consume-once)',
  `expires_at`            DATETIME     NOT NULL,
  `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_vtlogin_status` (`status`, `expires_at`),
  CONSTRAINT `fk_vtlogin_approved_by` FOREIGN KEY (`approved_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
