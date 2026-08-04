# xprojman-14 — Server → App: Fork A Self-Registration CONFIRMED + BUILT

**Status:** 🟢 BUILT + VERIFIED — owner picked Fork A; register shape confirmed, org-admin decoupling built.
**Author:** Server Agent · **For:** App dev (Flutter) · Owner
**Date:** 2026-07-30
**Answers:** `xprojman-13` §5 (the three register-shape questions) + §7 ask.
**Owner decision:** **Fork A** (role-at-registration for the business-owning case; crew stays via pairing).
**Pattern:** same app-proposes / server-confirms handshake as `xprojman-04` / `xprojman-12`.

---

## 1. Verdict — Fork A is live on the server

`POST /auth/register` now takes an optional **`user.role`**, validated against a
self-registrable allow-list. A Builder can self-register and **found their own org**,
becoming its administrator — without the `builder` role carrying tenant-owner authority
anywhere else. The other two Fork A questions had clean answers; question #3 (org-admin)
needed the model change I flagged, and it's built. **Migration v018**, no `matrix_version`
bump (no `role_permissions` row changed — see §3).

## 2. Your three §5 questions — answered

**Q1 — a `role` field on `/auth/register`, or a separate `/auth/self-register`?**
→ **A `role` field on the existing `/auth/register`.** It already does the right thing —
org + first user in one transaction — and a Builder founding their own building business is
that same flow with a different role value. A second endpoint would duplicate the
org-creation transaction for no gain. **Confirmed shape:**

```
POST /api/v1/auth/register
{
  organisation: { name, abn?, state?, … },      // unchanged
  user: { full_name, email, password, mobile?,
          role? },                               // NEW — optional
  device: { device_uid, platform }              // unchanged
}
```
- **`user.role`** — placed inside the existing `user` object (not top-level), matching the
  rest of the register body. **Omitting it stays `projectManager`** — your current app
  register flow and the Portal PM flow are unchanged, zero break.
- On success the response `data.user` now carries **`isOrgOwner: true`** (see §4).

**Q2 — the allow-list + error code.**
→ Allow-list = **`{ projectManager, builder, developer }`** (the org-founding / business-owning
roles). A disallowed role returns **`422 ROLE_NOT_SELF_REGISTRABLE`** (`field: "user.role"`).
- **v1 app surfaces only `builder`.** `projectManager` and `developer` (Property Developer)
  are in the allow-list for the Portal self-register flow — the server won't block them, but
  that's a Portal/server track, not your app v1.
- Crew (`siteSupervisor` / `foreperson` / `tradie` / `inspector`) and `client` are **not**
  self-registrable → they arrive by device pairing into an existing org, as today.
  Independent org-less crew identity remains **PM2-02**.

**Q3 — is the registrant still org-admin of their own new org when role is `builder`?**
→ **Yes — via a new `is_org_owner` flag, decoupled from the fixed role.** This is the model
change I flagged in xprojman-13. It could not be done by granting the `builder` role
`org.manage`: a builder later engaged into another PM's org (or paired in as crew) would then
wield tenant-owner authority in an org they don't own — breaking the appointer≠appointed line
(`xprojman-08`). So org-ownership is now **org-scoped metadata on the founder**, not a
property of the everywhere-identical role.

## 3. How the decoupling works (so you can reason about the app)

- New column **`users.is_org_owner`** (migration v018), set `1` for every registrant (they
  found their org). It **confers exactly three "tenant-owner" capabilities** —
  `org.manage`, `users.manage`, `devices.manage` — regardless of the fixed role, and confers
  **nothing else**. A Builder-founder is still a Builder (they do NOT gain `claims.approve` /
  `progress.write` / `money.write`); they just also administer their own org.
- It is **purely additive**: the `projectManager` role keeps its matrix grants untouched, so
  existing PMs are byte-for-byte unaffected — which is why there's **no matrix_version bump**
  (still v6). Backfill set the flag on all existing projectManagers (behaviour-preserving).
- Enforcement centralises in `lib/access.grants({ role, isOrgOwner }, perm)`, used by
  `requirePermission`; `GET /auth/permissions` now returns the **effective** set (role caps +
  owner caps) and a new **`isOrgOwner`** boolean, so your UI enables exactly what the server
  allows.

## 4. What the app can rely on

- Send `user.role: 'builder'` on register → 201, `data.user.role === 'builder'`,
  `data.user.isOrgOwner === true`, and a Builder session that can run its own org
  (create/pair users, manage devices, org settings).
- `GET /auth/permissions` → `{ role, isOrgOwner, permissions: [...effective], … }`. Gate the
  "manage my team / org" UI on `isOrgOwner` (or the presence of `users.manage`), not on role.
- Default (no role) still yields a projectManager — no migration needed on the existing screen
  before you add the role step.

## 5. Verified

10 new checks in `tests/access.test.js` (§7): Builder self-registers as `builder` + is
`is_org_owner`; holds the three owner caps via the flag; keeps builder caps; does **not** gain
PM construction caps; actually administers their org (creates a user); a **non-founder**
builder created inside the org gets **no** owner caps and is refused org admin (the leak the
decoupling prevents); a `tradie` self-register is `ROLE_NOT_SELF_REGISTRABLE`.
Also hardened the two "last admin" guards (`organisation.js`) to count founders, so the sole
admin of a Builder-founded org can't be deactivated/demoted into an unadministered org.
Full suite green: **isolation 16 · domain 29 · access 29 · stages 17 · admin 18 · siteops 28 ·
quality 19 · compliance 18 · directive1 36 · commercial 17 = 227 tests, 0 failures**
(throwaway :4199; owner's :4100 untouched).

## 6. Boundaries

- **Same-tenant v1.** One org per user, so `is_org_owner` (a single boolean) is unambiguous.
  Cross-org portable identity = **PM2-02**; when it lands, ownership becomes per-membership.
- **Single-role model (`xprojman-08`) intact** — one fixed role; org-ownership is orthogonal
  metadata, not a second role.
- A Builder-founder does **not** get `projects.write` (creating projects stays a PM function).
  If a builder-run business ever needs to create its own projects, that's a matrix decision
  (add `projects.write` to the builder role) — out of scope here, flag it if the app needs it.
- Not committed yet — staged for the owner's word (server-dev files by explicit path). Files:
  `mysql/migration_v018_self_registration.sql`, `src/routes/auth.js`, `src/lib/access.js`,
  `src/middleware/auth.js`, `src/routes/organisation.js`, `src/routes/pairing.js`,
  `src/routes/oauth.js`, `tests/access.test.js`.

© eBizco Australia Pty Ltd
