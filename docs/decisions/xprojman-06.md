# xprojman-06 — Server Agent response to xprojman-05 (identity ≠ role): AGREED, with one correction

**Status:** 🟢 Server Agent sign-off — needs OWNER approval on §7 before build
**Author:** Server Agent · **For:** App dev (Flutter) · Owner
**Date:** 2026-07-30
**Responds to:** `xprojman-05.md` (App team) · **Related:** `xprojman-01` (assessment),
DIRECTIVE 1 (v012–v016, committed `10295e2`), `serverdesignspecification.md` §7,
18-Stage spec §1.1

---

## 1. Verdict

**Agreed — this is the right model and it aligns with what DIRECTIVE 1 already built,
it doesn't fight it.** `job_awards.role_offered` is *already* a per-project role grant, so
"roles are per-project grants" is a direction the server is half-way into, not a reversal.
The App team hasn't designed something wrong; they've reached the half of the
identity migration that isn't done yet.

**One correction** (§3) changes one Open Decision answer. **Two things** (§4 schema, §6
pairing) are real work on top of DIRECTIVE 1. Nothing here is blocked by DIRECTIVE 1 —
it extends it.

## 2. The mechanic — how a person becomes a "Foreperson", today vs. proposed

This is the heart of it, so it's worth stating exactly.

**Today (old model).** A person's role is a *global attribute*:
- `users.role` is set once — at registration (`org_admin`→`projectManager`) or at user
  creation by an admin — OR a **device** is paired *with* a role and the session inherits
  the device's role.
- `project_members` controls **which projects you can reach** (`assigned` scope), but it
  carries **no role** — it's reachability only.
- Net: you are "a Foreperson" everywhere, or nowhere. The same person can't be a
  Foreperson on one job and a Tradie on another. There is no place to even store that.

**Proposed (grant model).** Role moves off the identity and onto the *person↔project
relationship*:
- **Field roles** (siteSupervisor, foreperson, tradie, inspector, builder) become a
  **grant per project**, held in `project_members.role` (a new column) — written either
  when a PM adds someone to a project's team with a role, or when a **Job Award is
  accepted** (`job_awards.role_offered` → the member row's role; DIRECTIVE 1 already
  auto-enrols on accept, it just doesn't stamp the role yet — a small extension).
- **Identity** stays single: one login, one Verified Work History.
- At login the person sees every grant they hold — "Foreperson on Smith, Tradie on
  Nguyen, Site Supervisor on Lee" — picks **one active role**, and the session shows the
  projects where they hold *that* role, with *that* role's capabilities.

So the concrete change is: **`project_members` gains a `role` column, and that grant —
not `users.role` — is the authority for field roles.**

## 3. The one correction — portfolio roles do NOT become per-project grants

`xprojman-05` §4 says "deprecate `users.role` as the authority." **Taken literally that
breaks portfolio roles.** A **projectManager** (and **developer**) has
`scope_class = portfolio` — org-level authority over *all* projects, which is **not** a
per-project grant and has no `project_members` row to live in. The worked example
(Foreperson/Tradie/Site Supervisor) is *entirely field roles* (`assigned`/`self` scope) —
those fit grants perfectly; portfolio roles do not.

**Correct model = hybrid:**
| Role class | Authority source | Example |
|---|---|---|
| **Org / portfolio** (projectManager, developer, org admin) | `users.role` (org-level identity) — **kept** | The founder/PM sees all org projects |
| **Field** (siteSupervisor, foreperson, tradie, inspector, builder) | per-project grant (`project_members.role` / `job_awards.role_offered`) | The tradesperson's three jobs |

The **login chooser lists both** — the person's org-level role AND their per-project field
grants — and `active_role` may be either. Consequence for **Open Decision 3**: `users.role`
is **kept as the org-level grant**, not merely an optional default. It cannot be dropped.

## 4. Server work, scoped

1. **Schema** — `project_members.role` (the field grant; `NULL` = plain member/legacy);
   `sessions.active_role` (for audit/introspection — the *token* claim is what enforcement
   reads).
2. **Login** — return the person's distinct grants (org role + per-project field roles);
   accept a chosen `active_role`; **validate it is one they actually hold**; mint the token
   with `role = active_role`.
3. **`GET /auth/permissions`** — resolve `active_role`. Near-free: enforcement already
   reads the token's `role` claim, so once the token carries the active role, permissions,
   scope-class, and all of DIRECTIVE 1 (tick/verify, `programme.write` stage-scoping) work
   unchanged.
4. **Job Award accept** — stamp `project_members.role = role_offered` on auto-enrol (small
   extension to `JobAwardService.respond` + `MembershipService.addMember`).
5. **Pairing** — the heavy one, §6.

## 5. What already aligns (so we don't over-scope)

- **Enforcement is untouched.** `requirePermission` / `scopeFilter` / `access.js` key off a
  single `actor.role` = the JWT `role` claim. Make that claim the `active_role` and the
  entire authorization layer just works. This is why the change is *shallower* than it
  looks.
- **`job_awards` is already a grant.** DIRECTIVE 1's cold-stranger→award→accept chain is
  exactly how a field person acquires a project role in the new model.
- **Scope-class already drives visibility.** `portfolio` sees all org projects, `assigned`
  sees only member projects — so "log in as Foreperson ⇒ see your Foreperson jobs" is the
  existing `assigned`-scope behaviour, filtered by the active role. No new filter engine.

## 6. The real cost: pairing

Today pairing **binds a role to the device**, and that is load-bearing: the `pair_rank`
ceiling (who may pair whom), the device-role JWT claim, and most server test suites
(`pairAs(role)`) all depend on it. The proposal's "pair the person, choose role at login"
removes that binding. That is a genuine rework touching **proven** code — it is the bulk of
the effort and the highest-risk piece, not a small edit. Recommend it be its own tracked
sub-task with its own test pass, sequenced after the schema/login/permissions changes
(which are additive and low-risk) land and prove out.

## 7. Answers to xprojman-05 §7 open decisions (Server Agent view)

| # | Question | Server Agent answer |
|---|---|---|
| 1 | Switch = full logout/login vs in-session switch | **Full logout/login for v1.** Server mints a fresh token per active role — simplest, safest, no mid-session claim mutation. In-session switch = later nicety. |
| 2 | "Log in as X" shows all projects where you hold X | **Yes.** Active role is the primary filter; that's just existing `assigned`-scope behaviour keyed to the active role. |
| 3 | Does `users.role` survive? | **Kept — as the ORG-LEVEL grant** (not "optional default"). Required for portfolio roles (§3). Field roles come from grants. |
| 4 | Pairing binds device→person | **Agreed**, but flagged as the highest-effort/highest-risk change (§6) — ripples into `pair_rank` + tests. |
| 5 | Role-less login allowed | **Yes** — identity/profile view with no active role. (A portfolio-role holder always has ≥1 org role; "role-less" mainly = a field person with zero current grants.) |

## 8. Sequencing & readiness

- **This is a new server phase, NOT a retrofit** into the already-committed/pushed
  DIRECTIVE 1 (deployed to `c1projman2_staging` on the current model). It gets its own
  migration (v017+) and its own spec section.
- **Buildable now as same-tenant v1** — the person stays inside a founder's org. The full
  portable-identity / cross-tenant Verified Work History (a Tradie who is a person with **no
  org of their own**) is the `PM2-02` third-isolation-domain model and stays **blocked**;
  agreed with xprojman-05 §6's honest split.
- **App can scaffold now, safely:** build the role-chooser-at-login + identity-first Profile
  against a **stubbed grants list**; it lights up the moment the server returns real grants
  and accepts an `active_role` — same posture Introductions had before its endpoint existed.
- **App cannot finish** until the server carries `active_role` + sources field roles from
  grants.

## 9. What I need from the Owner before I write code

Per "Specify, then build":
1. **Sign off §1 + §3** (the hybrid correction — portfolio roles stay on `users.role`).
2. **Confirm the §7 answers** (especially Decision 3, which I've changed from the App
   team's leaning).
3. On approval I fold `active_role`-in-session + grants-in-login + the `project_members.role`
   grant + the pairing rework into a **Step-A/B-v2 migration**, spec'd first, then built and
   test-covered like every prior phase.

**Net:** the App team is unblocked to scaffold immediately; the server change is well-bounded
(shallow on enforcement, real on pairing); one correction keeps portfolio roles intact.
Awaiting owner sign-off on §7 to start.

© eBizco Australia Pty Ltd
