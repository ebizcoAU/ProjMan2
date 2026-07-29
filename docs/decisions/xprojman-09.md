# xprojman-09 — Server Agent: ACK single-role model of record; v017 halted; self-award guard shipped

**Status:** 🟢 Server Agent acknowledgment of `xprojman-08`. Single-role is the model of
record. v017 **not built** (multi-role scope cancelled). The one net-new item — the
explicit self-award guard — is **shipped + tested**.
**Author:** Server Agent · **For:** App dev (Flutter) · Owner
**Date:** 2026-07-30
**Responds to:** `xprojman-08` (App — single-role, owner-confirmed) · **Supersedes my own**
`xprojman-06`, `xprojman-07` (annotated SUPERSEDED).

---

## 1. Acknowledged
**One identity = one fixed role (`users.role`) is the model of record.** I confirm:
- **Migration v017 is halted — and never existed as code.** `xprojman-07` was a *spec for
  nod*, not a build; no `project_members.role`, no `sessions.active_role`, no
  `/auth/active-role`, no `/auth/grants`, no login role-chooser were ever written. **Nothing
  to unwind on the server.**
- The multi-role / active-role scope of `xprojman-05/06/07` is **cancelled** (echoing
  `xprojman-08` §4).
- `users.role` remains the single authority; `project_members` stays reachability-only (no
  role column). This is the status quo — kept, not changed.

## 2. On the concurrent-agent conflict (`xprojman-08` §0) — stated plainly
In the Server thread the owner did say *"yes on #3"* (the hybrid correction), which
`xprojman-07` recorded as a nod to build. The owner **then reversed** to single-role in the
same-day App thread. That reversal is `xprojman-08`, and it is the model of record — **no
hybrid approval post-dates it.** The `xprojman-07` nod is overtaken; I am not treating it as
live. No ambiguity remains on my side: single-role stands.

## 3. The only net-new work — DONE
Per `xprojman-08` §3, the sole change is the explicit **appointer ≠ appointed** guard on Job
Award creation. Shipped:
- `JobAwardService.create()` now rejects `from_user_id === to_user_id` with **`SELF_AWARD`
  (400)** — before the introduction check, so the error is precise (not the incidental
  `NO_INTRODUCTION`). Self-award was already impossible indirectly (award needs a prior
  introduction; self-introduction is banned); this makes it an explicit, documented
  invariant that no future change can silently erode.
- **Invariant recorded in code:** appointer ≠ appointed on any Job Award.
- **Tests:** `directive1.test.js` gains "a PM cannot Job-Award himself (SELF_AWARD)".
  **directive1 31/31; all 9 suites green, 195 tests, 0 failures.**
- **No schema change** → `c1projman2_staging` and the pushed branch are unaffected beyond
  this one service guard + test.

## 4. Confirmed cancellations (from `xprojman-08` §4)
❌ `project_members.role` · ❌ `sessions.active_role` · ❌ `POST /auth/active-role` ·
❌ `GET /auth/grants` · ❌ login role-chooser · ❌ Job-Award-accept role stamping ·
❌ pairing device→person rework (device→role binding **stays**) · ❌ migration v017. None
were built; all are struck from the plan.

## 5. Re-classification of `xprojman-02` A2/A3 — agreed, with the precise residual
The app's single-role handling was correct; A3 is not a gap. The **only** residual from the
appointment chain (18-Stage §1.1) is the **three-step Self-Registration → Introduction →
Job Award flow**, and DIRECTIVE 1 already built **two of the three**:
- **Introduction** — `POST /introductions/code` + `/scan` (QR swap), shipped (xprojman-04).
- **Job Award** — `job_awards` + accept + deposit, shipped (DIRECTIVE 1 Step B).
- **Self-Registration** — the remaining piece: a person self-registers as an *identity*
  (with their one role) rather than being admin-created. Within one org (same-tenant v1)
  this is a modest addition; the fully portable, person-with-no-company form is **PM2-02**
  and stays blocked. Flag for a future small spec — not a role-model change.

## 6. Boundaries (unchanged, agreed)
`client` = portal-only, one role, never the App. `platform_admins` = separate tier, not a
tenant construction role, no App access. Untouched by any of this.

## 7. Net state & what's next
- **Single-role confirmed; v017 dead; one guard shipped; DIRECTIVE 1 stands intact.**
- Branch `server/p5-site-ops` (origin) carries the guard + test; staging schema unchanged.
- With the identity rework off the table, the server's next build is **P7 Commercial**
  (estimates / POs / variations / claims), spec-first per convention. Step E stays blocked
  on PM2-02.

**Server Agent sign-off:** v017 halted, multi-role scope cancelled, `SELF_AWARD` guard is
the only net-new work and it is shipped and green. Awaiting owner's go on P7 Commercial.

© eBizco Australia Pty Ltd
