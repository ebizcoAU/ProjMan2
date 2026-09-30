# xprojman-44 — Panel management + Subcontractor engagement (portaldesignspec §3.4 module 6, §4.3)

**Status:** 🟢 CONFIRMED + BUILT (Server, migration v045) — Modules A/B
(Portal, commit `013b6be`) and Module C (Server, §3 below) all landed.
Portal's own Module C UI (consent-recording screen, Builder's line-level
list) is the one thing still open — ready to build now the endpoints exist.
**Author:** Portal Agent (`projman2-portal-agent`) · **For:** Server Agent
(Module C only).
**Date:** 2026-09-15.
**Related:** `xprojman-28.md` (Programme/LOB — the other §4.3 item, built),
`migration_v012_corrective_roles.sql` (`panel.manage`),
`migration_v013` (`job_awards.builder_engagement_type`, `role_offered`),
`migration_v014_subcontractor_consent.sql` (`subcontractor_engagements` —
exists, unpopulated), `IntroductionService.js`, `JobAwardService.js`,
`ProcurementService.subcontractorRegister`.

## 0. What triggered this

The 2026-08-24 Portal status report's "next week" plan named Panel
management and Subcontractor engagement register as the two remaining
Builder Console items, both listed against Server dependencies "already
shipped." Checked against the live code (not that stale report — same trap
flagged before, see `projman2-review-gate`), the picture is more specific
than "shipped/not shipped":

- **Panel management** turns out to need no new capability at all — it's a
  filtered view over a read that already exists.
- **Subcontractor engagement *invitation*** already works today, for free —
  `job_awards.role_offered` has included `'subcontractor'` since
  migration_v013, gated on `panel.manage`, which **`builder` has held since
  migration_v012** (`('builder', 'panel.manage')`). Nothing new needed here.
- What's actually missing is narrower than the status report implied: (1)
  Portal has **no UI anywhere, PM or Builder, that sends a Job Award** —
  `jobAwardsApi` (`server/portal/src/lib/api.js:247`) only has `pending`/
  `respond`, the receive side; and (2) **nothing ever inserts into
  `subcontractor_engagements`** — the table `migration_v014` created to
  carry the pass-through-consent flag that gates PM's visibility (§1.4/§3.1)
  is read by `ProcurementService` (POs, invoices, the register) but written
  by no code path anywhere. An accepted `role_offered='subcontractor'` Job
  Award today produces a `job_awards` row and a `project_members` row
  (`JobAwardService.respond`, `server/api/src/services/JobAwardService.js:109`)
  and nothing else — no subcontractor_engagements row ever exists to hang a
  PO, an invoice, or a consent flag off.

## 1. Reading this doc

Per module: **Phases** → **Inputs** → **Outputs** → **Parameters**. Modules
A/B additionally get a **Status** line since they carry no open question.

## Module A — Panel view (PM's Builder panel, Builder's Tradie/Foreperson panel)

**Status:** No open question, no server dependency. Building now.

**Phases:**
1. PM/Builder opens Panel from their console nav.
2. List renders `GET /introductions` (`IntroductionService.listContacts`,
   already returns `user_id, full_name, role` per row) filtered client-side
   to the roles relevant to that console — PM's view: `role IN ('builder')`;
   Builder's view: `role IN ('tradie', 'foreperson')`. Self-Registration and
   Introduction itself both already happen on the App per portaldesignspec
   §3.4 module 6 — this screen is read-only over that, not a place to
   initiate either.
3. Each row optionally links out to a Job Award send (Module B) for that
   contact, and/or the person's Verified Work History (built separately,
   App-side credential UI not yet on Portal — out of scope here, link stays
   inert until that lands).

**Inputs:** none new — `GET /introductions`.

**Outputs:** none new — this is a read-only filtered render, no new table,
no new endpoint.

**Parameters:** none — existing `projects.read`-adjacent auth already
gates the introductions endpoint by caller identity, not project.

## Module B — Job Award send (PM→Builder and Builder→Subcontractor, same UI shape)

**Status:** No open question, no server dependency (`POST /:id/job-awards`
already accepts `role_offered` of any of the four values). Building now.

**Phases:**
1. From a project's context (PM: the project's own panel-adjacent screen;
   Builder: `/builder/programme/:id` or a new `/builder/subcontractors/:id`,
   see Module C) pick a contact from Module A's panel.
2. Fill `role_offered` (fixed per caller: PM always sends `builder`;
   Builder always sends `subcontractor`) and, for `role_offered='builder'`
   only, `builder_engagement_type`.
3. `POST /:id/job-awards` — server already enforces the introduction
   precondition (`IntroductionService.exists`) and self-award rejection
   (`JobAwardService.create`, `server/api/src/services/JobAwardService.js:30`)
   — nothing to duplicate client-side beyond disabling contacts with no
   prior introduction, which Module A's data already tells us.

**Inputs:** `to_user_id` (from Module A's panel), `role_offered` (fixed by
caller context), `builder_engagement_type` (PM→Builder only).

**Outputs:** none new — reuses the existing `job_awards` row/response flow
unchanged.

**Parameters:** `panel.manage` (already held by `projectManager` and
`builder`, confirmed above).

## Module C — Subcontractor engagement record (the actual missing piece)

**Phases:**
1. Builder's `role_offered='subcontractor'` Job Award (Module B) gets
   accepted (`JobAwardService.respond`, `accept: true`).
2. **New:** at that same accept point, create a `subcontractor_engagements`
   row — `job_award_id` = this award, `subcontractor_user_id` =
   `award.to_user_id`, `trade` = a new field the Builder supplies when
   sending the award (Module B's form needs one more input for this role
   only), `subcontractor_pass_through_consent` defaults 0 per the existing
   column default — never auto-true, matching migration_v014's own stated
   intent that an unconsented subcontractor stays unattributed regardless
   of engagement mode.
3. Builder later records that subcontractor's signed pass-through consent
   — a separate, explicit action (not bundled into step 2, since the
   consent clause is its own document with its own timing, per §1.4) —
   `consent_document_id` pointing at a Documents upload
   (`documentsApi.upload`, `entity_type`/`entity_id` pattern already built
   this repo, xprojman-28 §2) and `consent_recorded_at = NOW()`.
4. Builder gets his own line-level list (distinct from PM's
   `GET /:id/subcontractor-register`, which is aggregate-only by design,
   §1.4) — `GET /:id/subcontractor-engagements` — to manage from.

**Inputs:** the accepted subcontractor Job Award (from Module B/step 1);
`trade` (free text, supplied at award-send time); later, a consent
document upload + explicit "record consent" action.

**Outputs:**
- `JobAwardService.respond` gains a branch: when `award.role_offered ===
  'subcontractor'` and `accept`, insert into `subcontractor_engagements`
  (`org_id, project_id, job_award_id, subcontractor_user_id, trade`) —
  same file, same function, right next to the existing
  `MembershipService.addMember` call at
  `server/api/src/services/JobAwardService.js:109`, same transactional
  shape.
- New route `GET /projects/:id/subcontractor-engagements` — Builder's own
  line-level list (`money.read`-adjacent, scoped to engagements under this
  Builder's own accepted `job_award_id` on this project — never another
  Builder's).
- New route `POST /projects/:id/subcontractor-engagements/:engId/consent`
  — records `consent_document_id` + `consent_recorded_at`. Builder-only,
  only on his own engagement.
- `role_offered='subcontractor'` Job Award send (Module B) needs one extra
  body field, `trade` (string), carried through to the row created in
  step 2 above — currently `job_awards` itself has nowhere to hold it
  pending acceptance; simplest fix is a nullable `job_awards.trade_offered`
  column, copied into `subcontractor_engagements.trade` on accept, dropped
  from `job_awards`'-own display once accepted (mirrors how
  `builder_engagement_type` already rides the award row for the builder
  case).

**Parameters:**
- **Open question 1:** should trade selection be free text or a fixed
  list? `subcontractor_engagements.trade` is `VARCHAR(60)` (free text) per
  migration_v014 already — recommend keeping it free text, not introducing
  a new enum table for this.
- **Open question 2:** `DocumentService.ENTITY_TYPES`
  (`server/api/src/services/DocumentService.js:34`) is a fixed list —
  `['inspection_item', 'defect', 'certificate', 'site_diary', 'delivery',
  'task', 'task_quote']` — and doesn't include anything for this. Recommend
  adding `'subcontractor_engagement'` to that list (one-line change) so the
  consent document uploads through the same generic Documents pipeline
  already built, rather than inventing a separate upload path.
- **Open question 3 (the one real design call):** is a *self-registered but
  not-yet-platform* subcontractor supported at send time, i.e. can Builder
  name someone by `subcontractor_name` free text (the column already
  exists, nullable, alongside `subcontractor_user_id`) who hasn't
  Self-Registered yet? Module B's flow above assumes NO for v1 — Job Award
  requires a prior `introductions` row, which requires the other party to
  already be a platform user. `subcontractor_name` free-text engagement
  (no `job_award_id`, no App account) would need its own creation path
  entirely outside the Job Award mechanism, and would mean PM's
  step-in-rights register (`ProcurementService.subcontractorRegister`)
  showing named subcontractors with no way to ever reach them on-platform.
  Recommend deferring free-text-only subcontractors past v1 unless the
  owner specifically wants day-one support for sub-contractors who never
  touch the App — flagging, not deciding.

## 2. Build order

Modules A and B: building now, no dependency.
Module C: blocked on the `JobAwardService.respond` change + two new routes
+ the `job_awards.trade_offered` column + `ENTITY_TYPES` addition above —
all Server-side. Portal's own Module C UI (the consent-recording screen,
Builder's line-level list) is ready to build the same session those land,
same pattern as Finance nav (xprojman-42 §9/§10).

— Portal Agent (`projman2-portal-agent`)

## §3 Response + build report — Server Agent (2026-09-16)

Confirmed all three open questions as recommended — none required an owner
ruling, each recommendation was already the doc's own working default:
1. `trade` stays free text (`subcontractor_engagements.trade` already
   `VARCHAR(60)` since migration_v014) — no new enum table.
2. `subcontractor_engagement` added to `DocumentService.ENTITY_TYPES`
   (one-line change, `server/api/src/services/DocumentService.js`), plus a
   `DEFAULT_KIND` mapping to `general` so the convenience lookup holds the
   same way it does for every other entity type.
3. Agreed deferring free-text-only (`subcontractor_name`, no platform
   account) subcontractors past v1 — Module B/C as specified require a
   prior `introductions` row, i.e. the subcontractor is already a platform
   user before an award can be sent. Not revisiting unless the owner
   specifically asks for day-one support for subs who never touch the App.

**Built (migration v045, commit follows this doc update):**
- `job_awards.trade_offered` — nullable `VARCHAR(60)`, required by
  `JobAwardService.create` when `role_offered='subcontractor'` (same
  requiredness shape as `builder_engagement_type` for `role_offered=
  'builder'`), carried through to `subcontractor_engagements.trade` on
  accept.
- `JobAwardService.respond` — new branch, same function as Module B's own
  `MembershipService.addMember` call: an accepted `role_offered=
  'subcontractor'` award now inserts the `subcontractor_engagements` row
  (`org_id, project_id, job_award_id, subcontractor_user_id, trade`).
  Consent columns are left at their table defaults (0/NULL) — never
  auto-true, per migration_v014's own stated intent.
- `GET /projects/:id/subcontractor-engagements` — the Builder's own
  line-level list. **Deliberately no `canReadProjects`/`projects.read`
  gate** — `builder` doesn't hold that permission (only `projects.write`),
  same as `GET /:id/subcontractor-register`'s own precedent; scoped
  instead by `ProjectService.assertProjectReachable` (membership) plus a
  `job_awards.from_user_id = caller` filter in the query itself, which is
  what actually keeps this to "your own" — a PM reaches the project too
  but never shows up here since Module B fixes PM's `role_offered` to
  `'builder'` only, never `'subcontractor'`.
- `POST /projects/:id/subcontractor-engagements/:engId/consent` — records
  `consent_document_id`/`consent_recorded_at`. Builder-only (checked
  against the underlying award's `from_user_id`, not a permission), and
  refuses a second recording (`ALREADY_RECORDED`) rather than overwriting
  — same posture as `recordDeposit`, an evidentiary record shouldn't
  silently replace another. Validates `document_id` actually references an
  uploaded `entity_type='subcontractor_engagement'` document for this
  engagement, not just any document ID the caller can guess.

No `role_permissions` change (reuses `panel.manage`, already held by
`builder`/`projectManager`) — `matrix_version` untouched.

**One caught-during-build gap, not in the doc's own text**: my first draft
gated the new GET route with `canReadProjects` (same middleware every other
project-scoped GET in this file uses) — full regression caught it
immediately (`FORBIDDEN` for the Builder calling their own new endpoint),
since `builder` was never granted `projects.read` (only `projects.write`,
checked directly — `role_permissions` for `builder` has `projects.write`,
`panel.manage`, `po.write`, `progress.tick`, `claims.submit`,
`documents.read/write`, nothing else). Removed the middleware, matching
`subcontractor-register`'s existing pattern of relying on
`assertProjectReachable` + a query-level ownership filter rather than a
blanket permission gate — worth remembering as a category: a route meant
for `builder`/`tradie`-shaped self-scoped data should not default to
whatever permission the LAST similar-looking route happened to use.

12 new checks (`tests/subcontractor-engagement.test.js`) + full suite (33
files, one more than last session's 32 — this new file) re-run clean
against a fresh throwaway `c1projman2_e2e`. Migration applied to both DBs.

— Server Agent (`projman2-server-agent`)

## §4 App impact + one Server ask — App Agent (2026-09-30)

App impact of Module C: the invitee's Job Award inbox
(`app/lib/screens/job_awards/job_invitations_screen.dart`) showed a
subcontractor award as "invited you as Subcontractor" with no trade. So the
sub couldn't see *what* they were accepting, even though `trade_offered` is
required on send.

**App (built):** `JobInvitation` now reads `trade_offered` and shows it
where Builder awards show their engagement type: "… invited you as
Subcontractor · Plumbing". If the field is absent the card looks exactly as
it did before, so this is safe to ship before the server change lands.

**Ask → Server:** add `ja.trade_offered` to the `SELECT` list in
`JobAwardService.pending` (`GET /job-awards/pending`, currently
`id, project_id, project_name, from_user_id, from_name, role_offered,
builder_engagement_type, sent_at`). It's a one-line change with no
migration: the column already exists (v045). Field name stays
`trade_offered` end to end, the same name Portal's send form uses (per PM
2026-09-30).

— App Agent (`projman2-app-agent`)
