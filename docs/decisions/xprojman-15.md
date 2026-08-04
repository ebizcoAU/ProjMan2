# xprojman-15 — Server report to PM: the multi-role misstep on the server, corrected to ONE role

**Status:** 🟢 REPORT / status to PM — server-side only; no decision needed, model of record settled.
**Author:** Server Agent · **For:** PM / Manager · Owner
**Date:** 2026-07-30
**Subject:** On the server we briefly specced a multi-role identity model, caught the flaw,
and corrected to **one identity = one fixed role**. This reports the *server* side: what I
specced, what I did NOT build, the one safeguard I shipped, and how the correction has held
through every server build since. (The app-side account is the App dev's to give.)

---

## 1. The server misstep

For a short window on **2026-07-30** I specced a **hybrid multi-role** model on the server
(`xprojman-06`, then `xprojman-07`): a portfolio role on `users.role`, **field roles as
per-project grants**, an **active-role chooser at login**, plus `sessions.active_role`,
`POST /auth/active-role`, `GET /auth/grants` — all planned as **migration v017**. In the
server thread the owner briefly said *"yes on #3,"* which `xprojman-07` recorded as a nod to
build.

**Why it was wrong:** per-project roles let **one identity be both PM and Builder**, which
lets a person **Job-Award themselves** — collapsing the invariant the site-execution engine
rests on: **appointer ≠ appointed** (18-Stage §1.1, the basis of tick-then-verify).

## 2. What it cost on the server: **nothing in built code**

The multi-role scope was **spec-only — not one line was written.** No `project_members.role`,
no `sessions.active_role`, no `/auth/active-role`, no `/auth/grants`, no role-chooser, no
migration v017. So there was **nothing to unwind** — no rollback, no data migration. `users.role`
as the single authority was the status quo throughout; correcting course meant *keeping* it,
not rebuilding. `xprojman-06/07` are annotated **SUPERSEDED** as the honest paper trail.

## 3. The correction + the one thing I shipped

Model of record (owner-confirmed, acknowledged by me in `xprojman-09`): **one identity = one
fixed role** (`users.role`, global) — one role, many projects; `project_members` / accepted
Job Awards control *which projects* a person reaches, never *what role* they hold.

The **only** net-new server change out of the episode was a **safeguard reinforcing** it: an
explicit `from_user_id !== to_user_id` **`SELF_AWARD` (400)** guard on Job Award creation
(`JobAwardService.create`) — appointer ≠ appointed, now enforced in code, with a test.

## 4. How the correction has HELD in server work since

Two server builds followed the reversal; both upheld single-role rather than drifting back:

- **Job Award pending inbox** (`xprojman-11/12`) — accepting an award grants a person
  **project membership + an engagement record**; it **never mints a second role**. PM and
  Builder stay two identities.

- **Fork A Self-Registration** (`xprojman-13/14`, migration v018) — where single-role was
  genuinely tested on the server, and held. A Builder can self-register and found their own
  org. The tempting wrong answer to *"how does a builder-founder then administer their org?"*
  was *"give them a PM role too"* — a relapse into multi-role. I did **not** do that. Org
  administration was **decoupled from the role**: a new `users.is_org_owner` flag confers
  exactly the three tenant-owner capabilities (org / users / devices manage) on the founder,
  **regardless of their one fixed role**, and confers nothing else. A Builder-founder stays a
  Builder — runs their own business without becoming a PM, and the `builder` role never
  carries owner authority into orgs they're merely engaged into. Org-ownership is orthogonal
  metadata, not a second role. Additive — no `matrix_version` bump (still v6).

## 5. Server net state

- **Single-role is the server model of record**; multi-role scope struck from every plan;
  nothing was ever built on it.
- `users.role` = single authority; `project_members` stays reachability-only (no role column).
- **227 tests green** across 10 suites (includes the `SELF_AWARD` guard and the Fork A /
  org-admin-decoupling checks). Owner's `:4100` never touched during verification.
- Two server items (`xprojman-12` inbox, `xprojman-14` Fork A) are built + verified and
  **staged, uncommitted**, awaiting the owner's commit word.
- Next server build unchanged: **P7b Procurement**.

## 6. What I need from the PM

**Nothing to decide** — awareness only. Flag it if you'd like `xprojman-06/07` physically
archived rather than annotated SUPERSEDED; otherwise they remain as the record of the detour.

© eBizco Australia Pty Ltd
