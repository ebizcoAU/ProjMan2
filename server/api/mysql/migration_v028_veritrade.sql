-- ProjMan — migration v028: VeriTrade V1 backend (veritradedesignspecification.md,
-- scope locked with the owner 2026-08-06: V1 core loop only — publish opt-in, public
-- teaser, gated full profile, search, Engage->Introduction. Licence-verification
-- integrations (§6) and B2B subscription billing (§9) are OUT of this pass, per the
-- owner's own "core loop only" choice — not silently dropped, deliberately deferred.
--
-- NO MATRIX BUMP: VeriTrade gates on plain authentication (any logged-in App identity
-- may act as a demand-side searcher in V1 — subscription entitlement is deferred, so
-- there is no new permission to check). Matrix stays v12.
--
-- All new columns live on `identities` (PM2-02, v027) — the thin evidence-aggregate
-- companion row this table already exists to hold. VeriTrade adds NO new tables:
--   - the Engage rate-limit (decision #4: basic per-searcher daily cap) is answered by
--     counting existing `introductions` rows with initiated_by='veritrade_engage'
--     (that enum value has existed since v013, reserved for exactly this)
--   - "verified projects" / "years active" are computed at read time from the existing
--     `attestations` table, not cached columns — no new aggregate to keep in sync.

ALTER TABLE `identities`
  ADD COLUMN `veritrade_published`      TINYINT(1)  NOT NULL DEFAULT 0
    COMMENT 'opt-in, revocable, immediate (spec §8) — off by default',
  ADD COLUMN `veritrade_published_at`   DATETIME    NULL,
  ADD COLUMN `trade_classification`     VARCHAR(80) NULL COMMENT 'self-declared, e.g. Electrician, Carpenter',
  ADD COLUMN `service_region`           VARCHAR(80) NULL COMMENT 'self-declared, e.g. Perth Metro / South West WA',
  ADD COLUMN `licence_number`           VARCHAR(60) NULL,
  ADD COLUMN `licence_state`            VARCHAR(10) NULL COMMENT 'WA/NSW/VIC/QLD/... — free text, no state has a live integration yet',
  ADD COLUMN `licence_status`           ENUM('unverified','verified','not_available') NOT NULL DEFAULT 'unverified'
    COMMENT 'never set to verified by this build — spec §6: must say "not yet available" rather than a false negative or an unearned badge; a future per-state integration is what may set it',
  ADD COLUMN `licence_verified_at`      DATETIME    NULL,
  ADD COLUMN `veritrade_disclose_financials` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'spec §5.2: the invoice/PO trail on a project entry is shown only where the worker has separately opted to disclose it — narrower than the general publish flag';
