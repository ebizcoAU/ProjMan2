# xprojman-25 — Server → App: VeriTrade "Scan to sign in" contract (App-side screen needed)

**Status:** 🟡 Server backend BUILT and live on `:4100`/`c1projman2` (migrations v028/v029). App-side screen NOT built — zero references to VeriTrade anywhere in `app/lib/` as of this writing. This doc is the contract the App needs to implement it against.
**Author:** Server Agent · **For:** App dev (Flutter) · Owner
**Date:** 2026-08-07
**Related:** `docs/veritradedesignspecification.md` §4 (the product requirement) · `appdesignspecification.md` §8 (session-QR-approval, the same primitive Introduction/Engagement already use) · the VeriTrade frontend now live at `server/veritrade` (port 4330).

---

## Why this doc exists

The Manager's directive to build the VeriTrade frontend assumed the login backend
already existed. It didn't — flagged and built first (migration v029,
`veritrade_login_sessions`). The frontend at `server/veritrade/login` is fully wired
to it and working end to end (verified via a dev-only bypass panel that stands in
for the App). What's still missing is the **App's own screen** — without it, a real
person has nothing to scan with. This is that contract.

## What VeriTrade needs from the App

Spec §4: "There is no VeriTrade password, for anyone." A B2B user (or the tradie
themself, checking their own profile) opens VeriTrade in a browser, which shows a
QR code. The App needs one screen — **Profile → "Scan to sign in"** — that:

1. Opens the device camera / QR scanner.
2. Decodes the scanned payload. **Current placeholder shape** (server doesn't
   validate this URL format — it's just what the browser encodes into the QR; the
   App can request a different shape if a real deep-link scheme fits better):
   ```
   projman://veritrade-login?session_id=<uuid>&code=<jwt>
   ```
   `code` is a short-lived (5 min) signed JWT — treat it as an opaque string, same
   as an Introduction/Engagement QR code already scanned elsewhere in the App.
3. Calls **`GET /veritrade/login/:session_id/context?code=<code>`** (authenticated —
   the person's own existing App session) to fetch what to show for review:
   ```json
   { "status": "pending", "requested_ip": "...", "requested_user_agent": "...",
     "requested_at": "...", "expires_at": "..." }
   ```
   Render this as "Someone is trying to sign in to VeriTrade from [browser/device],
   requested at [time]." A 400 `INVALID_CODE` means the QR was stale/malformed —
   show "This code is no longer valid." A 409 `ALREADY_RESOLVED` means someone
   already approved/denied it (e.g. a double-scan) — show that outcome, not an error.
4. On **Approve** tap: **`POST /veritrade/login/:session_id/approve`** with body
   `{ "code": "<code>" }`, same auth. This mints a normal ProjMan session (non-
   authoritative, same as Portal) for the browser to pick up on its next poll — no
   response payload the App needs to act on beyond a 200.
5. On **Deny** tap: **`POST /veritrade/login/:session_id/deny`**, same body/auth.

That's the whole contract — 2 GET/POST calls plus a QR scan, the same shape as the
Introduction QR swap already built into the App. No new auth model, no new token
type on the App's side; it's using the App's own existing session to authorize an
action, exactly like everything else that already requires being logged in.

## What's already live for you to test against

`:4100`/`c1projman2` has migrations v028/v029 applied — `POST
/veritrade/login/initiate` (what the browser calls to mint the QR), `GET .../context`,
`POST .../approve`, `POST .../deny`, and `GET .../status` (the browser's poll) are
all real and working. The VeriTrade frontend (`server/veritrade`, port 4330) has a
dev-only stand-in panel (`NEXT_PUBLIC_VERITRADE_DEV_LOGIN=true`, never set in prod)
that plays the App's part over plain HTTP so the loop is testable without this
screen existing — useful as a live reference for exact request/response shapes
while building the real one.

## Not blocking anything else

VeriTrade's public teaser, search, and gated full profile (once already logged in
some other way, e.g. dev-bypass) all work today without this screen. This is
specifically the thing standing between a real person and a real VeriTrade login —
worth prioritising, but nothing else on the VeriTrade frontend build is waiting on it.
