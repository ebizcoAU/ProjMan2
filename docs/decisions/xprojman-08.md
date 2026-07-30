# xprojman-08 — Identity carries ONE fixed role (model of record; reverses the multi-role direction)

**Status:** 🟢 Owner-confirmed 2026-07-30 — **overrides `xprojman-05/06/07`'s multi-role direction**. Server Agent must acknowledge + HALT the v017 build.
**Author:** App dev (Flutter) · **For:** Owner · Server Agent
**Date:** 2026-07-30
**Supersedes / reverses:**
- `xprojman-05.md` (App — WITHDRAWN): multi-role per-project grants.
- `xprojman-06.md` (Server — agreed to 05 with a hybrid correction).
- `xprojman-07.md` (Server — a spec to **build** the hybrid multi-role model,
  migration v017; it claims an owner nod dated 2026-07-30 — **that nod is
  overtaken by this record**, see §0).
**Related:** 18-Stage spec §1.1 (appointment chain) · `serverdesignspecification.md` §7

---

## 0. ⚠️ Why this record exists — a concurrent-agent conflict to resolve

Two owner positions landed on the **same day (2026-07-30)** from parallel threads:
- To the **Server Agent** — recorded in `xprojman-07` as a nod to build the
  **hybrid multi-role** model (portfolio role on `users.role`; field roles as
  per-project grants; active-role chooser at login).
- To the **App dev** (this thread) — an explicit **retraction**: *"a user / phone /
  app should stick to ONE role only… he can't be a Project Manager and Builder at
  the same time… there's no way he assigns a job to himself as a Builder."*

These conflict. **The owner has confirmed (this session) that the single-role
model below is the intended one.** Therefore the multi-role direction of 05/06/07
is cancelled, and **the Server Agent must not build migration v017.** If the owner
intends the opposite, this record is where they say so — but as of sign-off,
single-role stands.

## 1. The decision

**One human = one identity = one app install = ONE fixed role** (`users.role`,
global). Not a per-project grant; does not change per session; no active-role
chooser.

- **One role, many projects.** A Builder works for many PMs; a Tradie works many
  jobs. The role stays constant; `project_members` / accepted Job Awards control
  *which projects* the person reaches, never *what role* they hold.
- **A person may NOT hold two roles.** The forbidden case is **PM + Builder in one
  identity** — a PM who is also a Builder could Job-Award themselves, collapsing the
  appointment-chain independence the whole tick-then-verify model rests on
  (18-Stage spec §1.1: appointer and appointed must be different parties).
- **"Builder" is always a separate person the PM engages — never the PM
  themselves** (owner, 2026-07-30). A solo owner-builder = the **PM who engages a
  Builder**, not one identity wearing both hats (consistent with spec §1.1's
  same-tenant-v1, "founder is Builder's boss").

## 2. This CONFIRMS the current schema — it is not new build

- `users.role` = single `VARCHAR(40)` (migration_v004): one role per identity.
- `project_members` = **no role column**: reachability only.

So "one role only" is the status quo. This record says **keep it; do not add
multi-role.**

## 3. The only net-new work (defense-in-depth)

- **Add an explicit `from_user_id !== to_user_id` guard** to Job Award creation
  (`JobAwardService`). Today a self-award is only *indirectly* blocked (award needs
  a prior introduction; self-introduction is rejected). Make it an explicit rule.
- **Invariant:** appointer ≠ appointed on any project. Near-automatic under
  single-role; stated so no future change silently reintroduces the self-deal.

## 4. What is CANCELLED (from 05/06/07)

- ❌ `project_members.role` column (per-project field grant) — `xprojman-07` §1.
- ❌ `sessions.active_role`, the login role-chooser, `POST /auth/active-role`,
  `GET /auth/grants` — `xprojman-07` §1–§3.
- ❌ Job-Award-accept stamping a per-project role — `xprojman-07` §4.
- ❌ Migration **v017** as specced — do not build.
- ❌ The pairing device→person rework (was Phase 2) — device→role binding stays.
- ❌ App-side role-chooser + identity-first Profile scaffolding — the single role
  badge is correct.

## 5. Boundaries (unchanged)

- **Client (`customer`)** — portal-only, never the App, one role.
- **Platform administrator** — separate `platform_admins` tier; not a tenant
  construction role; should not have App access (owner, this session).

## 6. Still gated on PM2-02

"A Builder for many PMs" works **within one company today** (`project_members`
across that org's projects). Across **different companies** = portable cross-tenant
identity = `PM2-02`, still unresolved. Single-role neither unlocks nor blocks it.

## 7. Consequences

- **App:** no change — current single-role handling is correct. The A2/A3 items in
  `xprojman-02` are re-classified: the app's role handling was right; only the
  three-step Self-Registration → Introduction → Job Award *flow* remains
  outstanding, not a role-model change.
- **Server:** HALT v017; drop the `xprojman-06`/`07` per-project-role scope; add
  only the §3 self-award guard; keep `users.role` as the single authority.

## 8. Sign-off

Owner: confirmed the single-role model 2026-07-30 (this session). **Server Agent:
acknowledge the halt of v017 and the cancellation of the multi-role scope; confirm
the §3 guard as the only net-new work.** If any owner approval of the hybrid
post-dates this record, the owner must say so here explicitly — otherwise
single-role is the model of record.

© eBizco Australia Pty Ltd
