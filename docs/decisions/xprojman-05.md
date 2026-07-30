# xprojman-05 — Identity ≠ role: one person, one app, roles granted per project

> ⛔ **WITHDRAWN 2026-07-30 — superseded by `xprojman-08.md`.** The owner
> reversed the core premise: a person holds **one fixed role**, NOT multiple
> per-project roles. The multi-role/active-role-chooser/per-project-grant model
> below is **not** being built. Kept for history and the reasoning trail that led
> to the correction. Read **`xprojman-08.md`** for the model of record.
> ⚠️ NOTE: the Server Agent's `xprojman-07.md` is a spec to *build* this
> withdrawn multi-role model — it is **also superseded by `xprojman-08.md`** and
> should not be built.

**Status:** ⛔ WITHDRAWN (was: 🟠 PROPOSED) — superseded by `xprojman-08.md`
**Author:** App dev (Flutter) · **For:** Owner · Server Agent
**Date:** 2026-07-29 (withdrawn 2026-07-30)
**Supersedes the implicit model in:** every current "role" assumption in the app
(`users.role` single column, device-bound role at pairing) — the *old* two-step
"Register → Assign" model the v3.4 spec already replaced.
**Related:** `xprojman-02.md` §A2/§A3 (this is the fix for those two gaps) ·
`serverdesignspecification.md` §7 · `devroadmap.md` §3 · the 18-Stage spec §1.1

---

## 1. The decision, stated plainly

**One human = one identity = one app install. The identity carries NO fixed
construction role. Roles are per-project grants. The person operates as exactly
ONE active role per session; to act in a different role they log out and log
back in, choosing that role.**

Worked example — the same real person:
- Foreperson on the Smith townhouses,
- Tradie (electrician) on the Nguyen extension,
- Site Supervisor on the Lee duplex.

That is **one** login, **one** Verified Work History, **three** role-grants. When
they open the app they are operating as one of the three (say, Foreperson); the
UI thins to that role (appspec §4). To work the Nguyen job as a Tradie, they log
out and log back in as Tradie. Same identity, different active role.

## 2. Why the current app is wrong for this

| Where | Today (old model) | Should be |
|---|---|---|
| `users.role` | one fixed column, set at register (owner→`projectManager`) or copied at pairing | not the authority — role is a per-project grant |
| Device pairing (`pair_device_screen.dart`) | you pick **one** role, it binds to the device | pair the **person**; role is chosen at login, not at pairing |
| Profile (`profile_tab.dart`) | single role badge | identity first; active role shown as the current session's context, with a "switch role" (= log out / log in) affordance |
| `GET /auth/permissions` | resolves the user's one role | resolves the **active** role of the session |
| Login | email+password → home, role implied | if the identity holds >1 grant, present a **role chooser** (which role to log in as); 1 grant → auto-select |

This is exactly the A2 (two-step vs three-step identity) and A3 (single fixed
role) gap logged in `xprojman-02.md`.

## 3. How it reconciles with "roles are per-project"

Login/switch selects the **active role** first; the session then shows the
**projects where the person holds that role**. So "log in as Foreperson" ⇒ you
see the jobs you're Foreperson on, with Foreperson capabilities — not every job
at once with capabilities shifting per project mid-session. Active role is the
primary session filter; project selection lives underneath it. This keeps the
per-session UI unambiguously one role (which the whole capture-first, gloves-on
design depends on) while the identity underneath spans many.

## 4. What changes, by layer

### App (this team)
- **Login:** after auth, fetch the identity's role-grants; if >1, show a role
  chooser; persist the chosen **active role** on the session.
- **Profile:** lead with identity (name, Verified Work History); demote the role
  badge to "acting as: <role> — switch" where switch = sign out then sign in.
- **Role reads:** everywhere the app reads `user.role` (profile label, pairing,
  any gating) → read the **active-session role** instead.
- **`PermissionsService`:** unchanged in shape — it already gates on server-
  declared permissions — but the server must key them to the active role, and the
  active role must be selectable (below).
- **Pairing:** drop the role picker; a paired device belongs to the **person**,
  who then logs in as whichever role. (Server-gated — pairing semantics live on
  the server.)

### Server (Server Agent — all of this is gated, none built per `xprojman-01`)
- **Session/token carries an `active_role`**, chosen at login from the person's
  grants — not the single `users.role`.
- **Login response returns the list of role-grants** the person holds, so the app
  can render the chooser.
- **Role-grants source = `project_members.role` / `job_awards.role_offered`** (per
  project), not `users.role`.
- **`GET /auth/permissions`** resolves against the session's `active_role`.
- **Pairing** binds device→user; role selected at login, not at pairing.

### Schema (Server Agent)
- Role-grants authoritative in `project_members` (role per project) and/or
  `job_awards`. `users.role` → deprecated as the authority (keep only as an
  optional default/primary, or drop — Open Decision 3).
- Session record gains `active_role` (and, implicitly, the project set that role
  scopes to).

## 5. Boundaries — who this does NOT apply to

- **Client (`customer`)** — portal-only, never the App, one role by nature. Not a
  per-project construction grant.
- **Platform administrator** — eBizco ops staff, the separate `platform_admins`
  tier; not a tenant construction role at all, and (per the owner, this session)
  should not have App access. Out of scope here.

The one-identity-many-roles model is about the **field/construction roles**
(Builder, Site Supervisor, Foreperson, Tradie, Inspector), nothing else.

## 6. Interaction with PM2-02 (be honest about the endgame)

True identity-first registration — a Tradie self-registers as a **person with no
company of their own**, then gets attached to builders purely through Job Awards —
is the portable-identity / third-isolation-domain model that is **blocked on
`PM2-02`** (`serverdesignspecification.md` §7.5). Until that lands, the interim
same-tenant v1 keeps the person inside a founder's org.

So split this decision in two:
- **Now (same-tenant v1):** role becomes a per-project grant and the active-role-
  at-login mechanic — buildable against the existing single-org model once the
  Server Agent does the Step A/B role rework. **This record's core.**
- **Later (PM2-02):** person-with-no-org, evidence portable across tenants. Not
  this record; flagged so we don't accidentally design it away.

## 7. Open decisions (need answers before build)

| # | Question | Leaning |
|---|---|---|
| 1 | Active-role switch = full log out / log in (owner's stated mechanic) vs. a lighter in-session "switch role" | **Full logout/login for v1** (owner stated it; matches MAOI precedent). In-session switch = possible later nicety, not v1 |
| 2 | Does "log in as role X" show *all* projects where you hold X? (§3's reconciliation) | Yes — active role is the primary filter, projects scoped under it |
| 3 | Does `users.role` survive as a convenience "default/primary role", or is it fully removed? | Keep as optional default for migration ease; grants are the authority |
| 4 | Pairing binds device→person (role at login) — confirm this replaces device→role, incl. the shared-site-tablet case | Device→person; a shared tablet is just a device many people can log into |
| 5 | Does a person need ≥1 grant to log in at all, or can they log in "role-less" (identity only, e.g. just to manage their profile / Verified Work History)? | Allow role-less login (identity/profile view); role required only for project work |

## 8. Sequencing / readiness

- **App can start now, safely:** the role-chooser-at-login UI and identity-first
  Profile can be scaffolded against a stubbed "grants" list, so the moment the
  server returns real grants + accepts an `active_role`, it lights up. Same
  posture as the Introduction flow before its endpoint existed.
- **App cannot finish** until the server carries `active_role` in the session and
  sources roles from grants — Server Step A/B, not yet built.
- **Recommend:** owner signs off §1 + Open Decisions; Server Agent folds the
  `active_role`-in-session + grants-in-login-response into the Step A/B role
  migration; app builds the chooser/Profile against it.

© eBizco Australia Pty Ltd
