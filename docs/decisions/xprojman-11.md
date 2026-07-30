# xprojman-11 — App → Server ask: a "my pending Job Awards" discovery endpoint

**Status:** 🟠 App request — needs Server Agent to confirm/correct the shape, then build
**Author:** App dev (Flutter) · **For:** Server Agent · Owner
**Date:** 2026-07-30
**Context:** app-side S9.7 accept/decline (appdesignspecification.md §4.2) is now built
against the real `.../respond` endpoint — but blocked on one missing endpoint below.
**Related:** `xprojman-09` §5 (Job Award shipped server-side) · `xprojman-04` (the same
app-proposes / server-confirms pattern that worked for Introduction).
**Numbering note:** the Server Agent took `xprojman-10` for the P7 Commercial spec
concurrently; this is the next free number, unrelated to P7.

---

## 1. The gap

The invited person cannot **discover** an award addressed to them. The only list is
`GET /projects/:id/job-awards`, which calls `ProjectService.assertProjectReachable` — and
the invitee is **not a `project_members` row until they accept** (membership is written
inside `respond`, `JobAwardService.js:109`). So:

- A Builder opens the app → has no reachable way to see "PM invited you onto Smith
  townhouses as Builder."
- `respond` itself works for them (it does **not** gate on membership — good), but they'd
  have to already know `project_id` + `jaId`, which they have no way to obtain.

Chicken/egg: you can't see the invitation until you're a member, and you're not a member
until you accept the invitation you can't see.

## 2. What the app already built (against real endpoints)

- **Accept/decline:** `POST /projects/:id/job-awards/:jaId/respond {accept}` — the real,
  confirmed endpoint. Working, no change needed from you.
- **Inbox UI:** `Profile → Job invitations` (`job_invitations_screen.dart`) lists pending
  awards and taps accept/decline. It reads empty today because the list endpoint below
  doesn't exist yet — same posture Introduction's UI had before `xprojman-04` confirmed it.

## 3. The endpoint requested — proposed shape (please confirm or correct)

```
GET /job-awards/pending      (Bearer; identity-level, NOT project-scoped, NOT membership-gated)
→ 200 { success: true, data: { pending: [
    { id, project_id, project_name,
      from_user_id, from_name,          // the inviting PM, for "X invited you"
      role_offered,                      // builder | tradie | foreperson | subcontractor
      builder_engagement_type,           // only when role_offered='builder'
      sent_at }
  ] } }
```

Selection: `to_user_id = <caller> AND status = 'sent'`, across every project in the caller's
org. The app's reader is tolerant (missing `project_name`/`from_name` degrade to
"A project" / "A manager"), so partial fields won't break it — but both names materially
improve the UI.

**The one field name most likely to differ from my guess** is `from_name` (the inviting
PM's display name) — please confirm what you'd call it, as with Introduction's `code` in
`xprojman-04`.

## 4. Notes / boundaries

- **Placement:** identity-level inbox (like `GET /introductions`), not under `/projects/:id`
  — that's the whole point; the invitee can't reach the project yet.
- **Scope:** still org-bounded (same-tenant v1). Cross-company invitations = PM2-02, not this.
- **No schema change** — a read over existing `job_awards` + a `users`/`projects` join.
- Single-role model (`xprojman-08`) is unaffected: an award grants project *membership* +
  the engagement record; it does **not** mint a second role on the person.

## 5. Ask

Confirm (or correct) the §3 shape and add `GET /job-awards/pending`. On confirmation the
app's Job-invitations inbox lights up with no client rework beyond any field-name fix you
flag. Everything else in the S9.7 flow is already built and green on `flutter analyze`.

© eBizco Australia Pty Ltd
