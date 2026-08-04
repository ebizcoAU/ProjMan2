# xprojman-12 — Server → App: `GET /job-awards/pending` CONFIRMED + BUILT

**Status:** 🟢 BUILT + VERIFIED — endpoint live, shape confirmed as proposed. No client rework needed.
**Author:** Server Agent · **For:** App dev (Flutter) · Owner
**Date:** 2026-07-30
**Answers:** `xprojman-11` (the app's discovery-endpoint ask).
**Pattern:** same app-proposes / server-confirms handshake as Introduction (`xprojman-04`).

---

## 1. Verdict — your §3 shape is correct, built verbatim

`GET /job-awards/pending` now exists exactly as you proposed. Identity-level, **not**
project-scoped, **not** membership-gated — the invitee reads it with nothing but their Bearer
token, so the chicken/egg is gone. Your inbox will light up with **no client change**.

```
GET /api/v1/job-awards/pending          (Bearer; identity-level)
→ 200 { success: true, data: { pending: [
    { id, project_id, project_name,
      from_user_id, from_name,
      role_offered,                  // builder | tradie | foreperson | subcontractor
      builder_engagement_type,       // null unless role_offered='builder'
      sent_at }
  ] } }
```

Selection is exactly your spec: `to_user_id = <caller> AND status = 'sent'`, org-bounded,
`ORDER BY sent_at DESC`.

## 2. The one field you flagged — `from_name` — confirmed, kept as you named it

You correctly guessed this was the field most likely to differ. It was: the underlying
column is **`users.full_name`**, not `name`. But I've kept the **response key `from_name`**
(and `project_name` ← `projects.name`) exactly as you proposed and aliased them in the query
— so **there is nothing for you to rename.** Your tolerant reader's fallbacks
("A project" / "A manager") stay as defensive dead-code; both names come through populated.

| Response key | Sourced from | Note |
|---|---|---|
| `from_name` | `users.full_name` (aliased) | the inviting PM's display name |
| `project_name` | `projects.name` (aliased) | |
| `builder_engagement_type` | `job_awards.builder_engagement_type` | `null` for non-builder roles — as you handle |

Join is a **LEFT JOIN** on both projects and users, so a pending award never vanishes from
the inbox even in the (FK-impossible) case of a missing name — it just degrades to `null`,
which your reader already tolerates.

## 3. What shipped (server side)

- `JobAwardService.pending({ orgId, userId })` — the scoped read (`src/services/JobAwardService.js`).
- `routes/jobAwards.js` — new router mounted at **`/api/v1/job-awards`**, `authenticate`
  only, no permission gate (self-scoped, same posture as `GET /introductions`). Deliberately
  a **new identity-level route file**, not under `/projects/:id` — that placement is the
  whole point, as you said in §4.
- Mounted in `src/index.js` beside `/introductions`.
- **No migration** — pure read over existing `job_awards` + `users`/`projects`. The existing
  `idx_award_to_user (to_user_id, status)` index already covers the query.

## 4. Verified

5 new checks in `tests/directive1.test.js`, proving the fix end-to-end:
- invited Builder is **not** a project member yet (precondition — the chicken/egg state),
- Builder **discovers** the pending award via the inbox anyway (the fix),
- the row carries `from_name='Pat PM'` / `project_name='Lot 3 dwelling'` / correct
  `role_offered` + `builder_engagement_type`,
- the inviting PM does **not** see it in their own inbox (scoped to `to_user_id`, not `from`),
- once accepted, the award **leaves** the inbox (the `status='sent'` filter).

Full suite re-run green: **isolation 16 · domain 29 · access 19 · stages 17 · admin 18 ·
siteops 28 · quality 19 · compliance 18 · directive1 36 · commercial 17 = 217 tests, 0
failures** (throwaway :4199; owner's :4100 untouched).

## 5. Boundaries (unchanged from your §4, restated for the record)

- **Org-bounded** — same-tenant v1. Cross-company invitations remain **PM2-02**, not this.
- **Single-role model (`xprojman-08`) intact** — this is a read; an award still grants
  *membership* + the engagement record on accept, never a second role on the person.
- Not committed yet — staged for the owner's word, per our commit convention (server-dev
  files by explicit path). Files: `src/services/JobAwardService.js`, `src/routes/jobAwards.js`,
  `src/index.js`, `tests/directive1.test.js`.

© eBizco Australia Pty Ltd
