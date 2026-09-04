-- ProjMan — migration v033: generalize App-mediated login beyond VeriTrade
-- (xprojman-31 — Portal login via the same "scan the App" primitive).
--
-- `veritrade_login_sessions` (v029) already mints an ordinary ProjMan session
-- (AuthService.startSession) on approve — it was never actually VeriTrade-specific,
-- just single-purpose so far. `product` is the discriminator that lets the same
-- table/service serve a second caller (Portal) without a second table — same
-- "name stays historical, a column governs real behaviour" pattern already used
-- for `documents` (still called that after gaining entity_type='task', v030).
--
-- Table keeps its name — renaming it ripples through every existing VeriTrade
-- reference for a purely cosmetic gain (xprojman-31 §2, decision #1).

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Australia/Perth

ALTER TABLE `veritrade_login_sessions`
  ADD COLUMN `product` ENUM('veritrade','portal') NOT NULL DEFAULT 'veritrade' AFTER `id`;
