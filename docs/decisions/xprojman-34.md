# xprojman-34 — Portal → Server: authenticated API responses are browser-cacheable, serving stale bodies via 304

**Status:** 🟢 FIXED + VERIFIED, 2026-09-04. Went with the global option (§3):
`app.disable('etag')` + a blanket `Cache-Control: no-store` middleware, mounted
first, before `helmet`/`cors`/body-parsing/any router. Checked before applying
it app-wide: nothing in this API currently sets its own `Cache-Control`
anywhere, including VeriTrade's public teaser/search routes — their
"cacheable, indexable" is a design note in a comment, not an implemented
header — so there was nothing to preserve by scoping this more narrowly.
Verified: repeated identical `GET /organisation` now returns `200` + no
`ETag` + `Cache-Control: no-store` every time (was `304` after the first
request); full regression pass unaffected (125 tests across
stages/veritrade-login/isolation/domain/stage-task-templates/access, all
green). Applied to `server/api/src/index.js`; owner is running the API
locally to confirm against the real browser session that surfaced this.
**Author:** Portal Agent (`projman2-portal-agent`) · **For:** Server Agent
(`projman2-server-agent`) · Owner
**Date:** 2026-09-04
**Related:** the Project List page (`server/portal/src/app/(console)/projects/
page.js`) — where this was first noticed as "the project list is empty even
though the database has real rows for this account."

---

## 1. What's actually happening — confirmed, not guessed

The owner's browser was showing an empty Project List for an account that
genuinely has 3 real projects in the database. Verified step by step before
writing this up:

1. **The data is real.** Queried `c1projman2` directly — `arthurphan.au@gmail.com`
   (org `27a041db-...`, `projectManager`, `is_org_owner=1`) has 3 non-deleted
   projects.
2. **The backend is correct.** Minted a valid JWT for this exact user/org
   server-side and curled `GET /projects` and `GET /organisation` directly —
   both returned the full, correct data on the first request.
3. **The owner's own server log, read directly, shows the actual cause:**
   ```
   GET /api/v1/organisation 304 17.763 ms - -
   GET /api/v1/projects?limit=100 304 29.361 ms - -
   GET /api/v1/organisation 304 6.181 ms - -
   GET /api/v1/projects/de08b676-... 304 15.205 ms - -
   ```
   **Every single request from the real browser session returns 304 Not
   Modified.** A 304 response has no body — the browser is expected to reuse
   whatever it cached from an earlier response to that same URL. That earlier
   cached body is stale (from before these projects existed, or from a
   different point in the session), so the Portal's `fetch()` calls are
   silently getting old/empty data back instead of the real, current rows my
   direct test just proved the server has.

## 2. Root cause — Express's default conditional-GET, with no opt-out

Checked `server/api/src/index.js` directly: there is no `app.disable('etag')`
and no `Cache-Control` header set anywhere on the API's responses.
Express enables **weak ETag generation by default** on every `res.json()`
call, and its built-in `fresh`/conditional-GET handling auto-returns 304 the
moment an incoming request's `If-None-Match` matches the ETag Express computes
from the response body. Since:

- the ETag is computed **from body content only** — it has no idea the
  request carries a different bearer token, a different user, or that the
  underlying data has since changed via a `POST`/`PATCH` the browser doesn't
  know invalidates its cache entry, and
- there is no `Vary: Authorization` and no `Cache-Control: no-store` telling
  the browser these responses are per-user and must not be reused this way,

the browser's ordinary HTTP cache does exactly what HTTP caching is designed
to do — revalidate a GET against a matching URL and, on 304, replay its own
previously-cached body. For a private, authenticated, frequently-mutated API
like this one, that's the wrong behaviour: every list/detail endpoint a
tenant user reads can silently go stale the moment the browser decides to
revalidate instead of re-fetching.

This is **not** a Portal bug, not a "wrong endpoint" (verified — every path
Portal calls is correct and matches its route definition), and not a data
bug (the rows are real and correctly scoped). It's a missing cache-control
policy on the API layer, and it very likely affects every authenticated
GET in the app, not just the two Portal happened to notice it on.

## 3. Proposed fix (Server's call, not Portal's to make)

Smallest fix: disable Express's automatic ETag on the API app, and/or send
`Cache-Control: no-store` on every authenticated response —

```js
app.disable('etag'); // no conditional-GET / 304 for this API — every response is live
```

or, more targeted (keeps ETag for genuinely public/cacheable routes like
VeriTrade's teaser profiles, if that caching is ever wanted there):

```js
app.use('/api/v1', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
```
mounted before the tenant-facing routers (`projects`, `organisation`,
`documents`, etc.), leaving VeriTrade's public routes unaffected if they're
mounted separately or excluded.

Not proposing which of the two Server prefers — flagging the bug and a
credible fix shape, per this repo's own review-gate convention, not
committing a change to a file outside Portal's own lane.

## 4. What this unblocks

Every Portal screen that reads live, frequently-changing tenant data (Project
List, Task drill-down, Field, Cost Plan, dashboards) is exposed to this same
stale-304 risk, not just the one screen that surfaced it. Worth Server
treating this as an app-wide fix rather than a one-route patch.

---

## 5. Team contributions

*(Dated, initialled entry per contribution, same convention as `xprojman-27`–`33`.)*

- 2026-09-04, Portal Agent: initial report, root-caused via direct server log
  read + a manually-minted-token API test proving the backend itself is
  correct. No code changed in `server/api` — Server's lane.

---

© eBizco Australia Pty Ltd
