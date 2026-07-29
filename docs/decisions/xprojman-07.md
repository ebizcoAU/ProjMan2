# xprojman-07 — Phase 1 spec: active-role identity (hybrid grants) — SPEC FOR NOD

> ⛔ **SUPERSEDED / CANCELLED 2026-07-30 by `xprojman-08` (single-role, owner-confirmed)
> and `xprojman-09` (Server ACK).** Migration v017 and every endpoint below are cancelled
> and were never built. Retained for history only — do not build from this doc.

**Status:** 🟠 SPEC — owner nod to build (model already approved: hybrid, `users.role`
kept for portfolio roles — owner 2026-07-30). Build = migration v017 + code, on nod.
**Author:** Server Agent · **For:** Owner · App dev (Flutter)
**Date:** 2026-07-30
**Implements:** `xprojman-05` (App) as corrected by `xprojman-06` (Server) §3.
**Scope:** Phase 1 only — additive, backward-compatible. **Pairing rework = Phase 2**
(xprojman-06 §6), NOT here.

---

## 0. Principle (settled)
One human = one identity = one login = one Verified Work History. **Org/portfolio roles**
(projectManager, developer, org admin) stay on `users.role`. **Field roles**
(siteSupervisor, foreperson, tradie, inspector, builder) are **per-project grants**. A
session operates as exactly one **active role**, chosen from the person's grants.

## 1. Schema (migration v017)
```sql
-- Field-role grant, per project. NULL = plain member / legacy row (unchanged behaviour).
ALTER TABLE project_members
  ADD COLUMN role VARCHAR(40) NULL COMMENT 'per-project field-role grant; NULL=legacy member';
-- Which role a session is acting as (audit/introspection; the TOKEN claim is authoritative
-- for enforcement).
ALTER TABLE sessions
  ADD COLUMN active_role VARCHAR(40) NULL;
```
`UNIQUE(project_id,user_id)` stays — one role per person per project. `users.role`
unchanged (kept as the org-level grant).

## 2. Grants — how they're computed for a person
The union of:
- **Org grant:** `users.role` **iff** it is a portfolio/org role (projectManager,
  developer, org admin). Scope = `portfolio`.
- **Field grants:** the DISTINCT `project_members.role` (non-NULL) across their
  memberships. Scope = `assigned`/`self` (from the `roles` table). Each carries the
  `project_ids` where it's held.

`job_awards.role_offered` is NOT a separate source — accepting an award **writes**
`project_members.role` (§4), so grants read from one place.

Grant shape (login response + a new `GET /auth/grants`):
```json
{ "role": "foreperson", "scope_class": "assigned",
  "project_ids": ["...","..."], "source": "grant" }   // org grant: source:"org", no project_ids
```

## 3. Login + active-role selection (the app contract)
**`POST /auth/login { email, password, active_role? }`**
- Authenticates as today, then computes grants.
- `active_role` supplied → validate it ∈ grants → mint token with `role = active_role`.
- omitted &  exactly 1 grant → auto-select it.
- omitted & >1 grant → mint a **role-less** token (identity/profile scope only, Decision 5)
  and return `requiresRoleSelection: true`.
- omitted & 0 grants → role-less token (profile only).

Response adds: `grants: [...]`, `activeRole: <role|null>`, `requiresRoleSelection: bool`.

**`POST /auth/active-role { active_role }`** (authenticated) — validate ∈ grants, **re-mint**
the session token with `role = active_role`; update `sessions.active_role`. This is the
"pick from the chooser" step (no re-password). Role **switch** in v1 UX = logout→login
(Decision 1); the app drives that, the endpoint is the same selection mechanism.

## 4. Job Award accept → stamp the grant
`JobAwardService.respond(accept)` already auto-enrols the invitee. Extend it +
`MembershipService.addMember` to set `project_members.role = job_awards.role_offered` on
the created/existing member row. (Small, closes the loop: an accepted award IS the grant.)

## 5. Permissions & enforcement
- **`GET /auth/permissions`** resolves the session's **active role** (the token `role`
  claim). Near-zero change — `requirePermission`/`scopeFilter`/`access.js` already read
  `actor.role`.
- **Role-less session:** `role = null` ⇒ empty permission set; only identity/profile
  endpoints reachable (`/auth/me`, `/auth/grants`, profile read, `/introductions`). Every
  project/domain route stays gated and returns 403/empty. Must be verified by test, not
  assumed.

## 6. Backward compatibility (why Phase 1 is safe)
- A **paired device session keeps its device role** and behaves as a single-grant active
  role — pairing is untouched in Phase 1. Existing devices/tests keep working.
- A `project_members` row with `role = NULL` behaves exactly as today (member, reachability
  only). No backfill required; grants simply start empty for field roles until rows carry a
  role (or an award is accepted).
- DIRECTIVE 1 (tick/verify, programme.write scoping, cold-stranger awards) is unaffected —
  all key off the token role, which now = active role.

## 7. Out of scope (explicit)
- **Pairing device→person** — Phase 2 (own migration + test pass; touches `pair_rank` +
  every `pairAs` suite).
- **Portable cross-tenant identity / person-with-no-org** — PM2-02, still blocked.
- In-session (no-relogin) role switch — later nicety.

## 8. Test plan (build gate)
New `identity.test.js`: grants union (org + field); login auto-select (1 grant) vs
`requiresRoleSelection` (>1); `active-role` selection validates membership of grants and
re-scopes visibility; role-less login reaches profile only, 403s on project routes;
job-award accept stamps `project_members.role`; a legacy `role=NULL` member is unchanged;
a paired device session still works (backward-compat). Plus full 9-suite regression green.

## 9. App team — what you can code against now
Build the **role chooser** off `login.grants` + `requiresRoleSelection`, then
`POST /auth/active-role` on pick; identity-first Profile off `GET /auth/grants`. Contract
above is stable; it lights up when v017 + the login changes land. Same posture as
Introductions before its endpoint existed.

## 10. Ask
**Owner: nod §1–§5** and I build v017 + code + `identity.test.js`, verify the full suite,
then hand the app team the live endpoints. No code until the nod.

© eBizco Australia Pty Ltd
