# ProjMan2 — Backlog

Tracked in-repo (no Jira/Linear/GitHub-issues integration wired up yet). One
section per ticket, newest first.

---

## BL-001 — Auto-populate `person_id` for attendance check-in

| Field | Value |
|---|---|
| Priority | P3 (Medium) |
| Assignee | App Team Lead |
| Sprint | Next sprint |
| Status | Open |
| Filed | 2026-07-24 |

**Description**

Attendance check-in does not currently capture `person_id` for the logged-in
user — "Add person" (`site_attendance_view.dart`) only ever creates a free-text
`person_name`/`person_type` row, never linking it to the authenticated
account. This causes `attendance.write.own` pushes to fail server-side for
`tradie`-role devices (that role holds only `.own`, not `.site` — see
`SiteOpsService.guardPush` in `server/api/src/services/SiteOpsService.js`,
which requires `person_id === actor.userId` on that path).

**Acceptance criteria**

1. Opening "Add person" for a self check-in pre-fills the logged-in user's
   name and sets `person_id` automatically.
2. If the user edits the name, `person_id` is re-evaluated — cleared if it no
   longer matches the logged-in account (free-text) or set again if it does.
3. Server-side validation continues to enforce `attendance.write.own` —
   reject any push where `person_id != logged_in_user_id` for a `.own`-only
   role. (Already enforced server-side today; this ticket is client-side only
   — call out here so a client fix isn't assumed to relax that check.)

**Notes**

Raised while wiring P5 site-ops persistence client-side (servdesignspec
§11) — flagged as a known gap rather than fixed inline, since it changes the
"Add person" UX (self vs. muster-someone-else) and wasn't part of that task's
scope.
