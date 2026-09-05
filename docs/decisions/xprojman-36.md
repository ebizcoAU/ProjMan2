xprojman-36 — Portal forced re-login every ~15min: the refresh token was never used
Status: 🟢 BUILT — Server → Portal, informational (code already lives in server/portal/)
Issued By: Server Agent (`projman2-server-agent`)
Date: 2026-09-05
Location: docs/decisions/xprojman-36.md

## 0. Trigger

Owner report: "portal auto exit to the login page every 15min, forcing
re-login so often." Diagnosed and fixed same session — documenting here
per the owner's explicit ask ("raise xp-xx docs so portal team aware"),
since the fix landed in `server/portal/src/lib/api.js` (Portal Agent's own
directory), not `server/api/`.

## 1. Root cause

Every login already returns TWO tokens (`POST /auth/login`/`register`/etc.):
- `accessToken` — a JWT, short-lived on purpose (`JWT_EXPIRES_IN`, `.env`).
- `refreshToken` — an opaque session id, valid 30 days
  (`JWT_REFRESH_EXPIRES_IN`), meant to silently mint a new `accessToken` via
  `POST /auth/refresh` once the old one expires.

Portal's `setSession()` (`src/lib/api.js`) already stores both
(`pm2Token`/`pm2Refresh` in localStorage) — but the core `request()` fetch
wrapper never called `/auth/refresh` at all. On ANY 401 (which is exactly
what happens the instant `accessToken` expires), it went straight to
`clearSession()` + `window.location.replace('/login')`. The 30-day refresh
token was sitting in localStorage completely unused every single time.

**Not a server bug** — `POST /auth/refresh` (`routes/auth.js`) has worked
correctly this whole time; nothing there changed. This is purely a missing
client-side behaviour.

Separately, during this diagnosis `JWT_EXPIRES_IN` was bumped `15m → 45m`
directly in `.env`/`config.js`'s default (uncommitted, done outside this
fix). That only makes the gap less frequent, not fixed — Portal still never
refreshes, so any session longer than 45 minutes hits the same wall. Worth
knowing this is a stopgap, not the fix, if anyone finds `.env` at 45m later
and wonders why.

## 2. What was built

`server/portal/src/lib/api.js` — `request()` now, on a 401:
1. Skips this whole path for the `/auth/refresh` call itself, and for a
   request that's already been retried once (no infinite loop).
2. Calls `POST /auth/refresh` with the stored `refreshToken` (single-flight
   — concurrent 401s across in-flight requests share one refresh call, not
   one each).
3. On success: stores the new `accessToken`, retries the ORIGINAL request
   once with it, and the caller never sees the 401 at all.
4. On failure (refresh token itself missing/expired/revoked): falls through
   to the existing `clearSession()` + redirect-to-`/login` behaviour,
   unchanged — this path still works exactly as before for a genuinely dead
   session.

No new endpoints, no schema, no contract change — `POST /auth/refresh`'s
request/response shape was already exactly what was needed
(`{refreshToken} → {accessToken, role}`), just never called from here.

`next build` clean. Live browser verification was attempted (register a
throwaway user against a disposable e2e-DB API instance, log into Portal,
corrupt the stored access token to force a 401, confirm the app silently
recovers instead of bouncing to `/login`, then confirm the fallback path
still redirects when the refresh token itself is also invalidated) but
could not complete — the Chrome browser extension wasn't connected in this
environment. The fix is a straightforward, hand-traced control-flow change
against an unmodified, already-covered server endpoint; flagging the gap
rather than claiming a browser-verified pass.

## 3. For the Portal team

- Nothing else needs to change on your side — this is entirely inside
  `api.js`'s existing `request()`/`setSession()`/`clearSession()` contract,
  every other file that imports from `lib/api.js` is unaffected.
- If you (or anyone) revisit `server/dashboard/src/lib/api.js` or
  `server/veritrade/src/lib/api.js` — same exact gap exists there (checked
  this session): both store a `refreshToken` and never use it either. Not
  fixed here (out of scope of what was reported), just flagged so it isn't
  rediscovered cold.
- If a real end-to-end browser pass is wanted before fully trusting this
  in production, that's the one thing this session couldn't close out.

— Server Agent (`projman2-server-agent`)
