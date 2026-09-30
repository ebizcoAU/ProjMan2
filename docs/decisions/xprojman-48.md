# xprojman-48 — Safety/OHS: schema proposal (handover #10, xprojman-28 §5)

**Status:** 🟢 RULED (§7.1). App and Portal have signed off (§8), and it builds as **v048**. Originally: 🟡 DRAFT, spec before schema. There are **eight forks (§3), each with a recommendation**.
- **Flagged for the SA:** F7 (permissions and the Builder's visibility).
- **Flagged for the Owner:** F3 (notifiable incidents, which has legal exposure) and F5 (whether a missing induction blocks sign-in).
- Needs Portal's and App's responses in §8.
- **No migration until it's signed off.**

**Author:** Server Dev (`projman2-server-agent`, session `projman2-a2`).
**For:** Portal (`projman2-ae`) and App (`projman2-81`). PM (`projman2-82`) routes the SA and Owner flags.
**Date:** 2026-09-30.
**Built on:**
- App's committed in-memory mockup `c28f035`: `safety_ops_service.dart`, `safety_entries_view.dart` and `safety_tab.dart`.
- xprojman-28 §5 (Portal's four phases).
- `appdesignspecification.md` §4.3 and the Safety nav (Safety · Hazards · Incidents · Inductions · SDS · Emergency Evacuation).
- xprojman-27 §2 (the `credentials` recommendation).
- **xprojman-46**: the checklist schema, still a draft, which this doc amends in one place (F6).
- The live schema, checked 2026-09-30.

---

## 1. Phases → Inputs → Outputs → Parameters

| # | Phase | Actor / surface | Inputs | Outputs |
|---|---|---|---|---|
| 1 | **Report** | any site role · App, offline | kind (hazard, near miss or incident), description, location, severity, photo(s), GPS, occurred_at. For an incident, also: the injured person, the injury, treatment, and a notifiable flag. | a `safety_events` row (+ `incident_details`) |
| 2 | **Respond** | Site Supervisor or PM · App or Portal | corrective actions: action, assignee, due date | `safety_actions`. The event's status moves `open` → `in_progress`. |
| 3 | **Close** | Site Supervisor or PM | all actions closed, a closing note, an optional "after" photo | event `closed`, with `closed_by`/`closed_at` server-stamped |
| 4 | **Induct** | Site Supervisor · App | the person (a user or a visitor), induction content (a checklist), signature, expiry | `site_inductions` (+ a sign-off) |
| 5 | **SWMS sign-on** | a worker · App | a SWMS document plus the worker's signature | a sign-off against the SWMS |
| 6 | **Register** | PM · Portal | SWMS, SDS, emergency plan and policy documents | `documents` rows with new `kind`s. **No new table.** |
| 7 | **Report / trend** | PM or portfolio roles · Portal | a date range, with an optional project | counts by kind, severity and status; open actions overdue |

Toolbox talks are **not** in this doc. They are a checklist category (`toolbox_talk`, xprojman-46).

## 2. The mockup, and what changes from it

App's `SafetyEntry` has `kind` (hazard or incident), description, location, severity (low, medium
or high), status (open, in progress or closed), the raiser, `raisedAt` and `hasPhoto`. Portal's
xprojman-28 §5 recommended a table "shaped like `defects`". **Both are kept as the core row**,
using the `defects` column conventions. The changes:
- `kind` gains `near_miss`. Near misses are the standard third category, and trend reporting needs
  them kept separate.
- Incident-only fields that are **sensitive**, such as injury and treatment, move to a separate 1:1
  table (F2).
- Photos go through the existing `documents` store (new entity type `safety_event`), not a single
  `photo_id`, so an event can have more than one.
- `occurred_at` is separate from `raised_at`. An incident can be logged hours after it happened.

## 3. Forks

**F1: are the S2.4 hazard audit and site hazards the same table? (The PM asked for an explicit answer.)**
- **No, they are separate tables.**
- **S2.4** is a *desk-recorded environmental overlay* on the project: flood zone, heritage overlay,
  bushfire-prone area, soil class. The PM records it once, before design, in Portal. Its purpose is
  to *trigger later requirements*: S12.8/9 compaction and compression tests, and S16.7 (spec p.8).
  It has no severity, no assignee, and no open/closed lifecycle.
- **Site hazards** are *field observations* on a live site: reported by anyone, with severity, and
  worked to closure with corrective actions.
- Sharing a table would give every S2.4 row a meaningless lifecycle, and every site hazard a
  meaningless trigger link.
- **Recommend:** S2.4 gets its own future table, `site_constraints` (`project_id`,
  `constraint_type` ENUM of flood, heritage, bushfire_bal, soil_class, …, a value, and a source
  document). It is designed in the Stage 2 pass (xprojman-45 §2.1 #4, parked), **not here**.
  `hold_point_requirements.triggered_by_finding_id` then points at `site_constraints.id`. This doc
  only fixes the table's name, so the two passes don't collide.

**F2: sensitive incident data.**
- Injury, body part, treatment and the injured person are **health information**, which is
  "sensitive information" under the Privacy Act (APP 3 and APP 6).
- The raiser, a tradie, shouldn't see another worker's injury details on every other device that
  pulls the project.
- **Recommend:**
  - `incident_details` is a 1:1 child of `safety_events`.
  - The sync registry sets it **`pull: false`**, which the registry already supports: the App can
    push it offline but never pulls it back.
  - Reading it is REST-only, for `safety.manage` roles plus the original reporter (their own rows
    only).
  - The `safety_events` row itself carries only a non-sensitive summary, so the site still sees
    that an incident happened.

**F3: notifiable incidents. ⚠ Owner (legal).**
- Under the WHS Act (s35–39, harmonised; WA WHS Act 2020 likewise), a *notifiable incident* is a
  death, a serious injury or illness, or a dangerous incident. It must be reported to the regulator
  **immediately**, the site must be preserved, and the record kept for **5 years**.
- **Recommend:**
  - The reporter can tick `is_notifiable`. A `safety.manage` role confirms or clears it. It's a
    judgement call, not derived automatically.
  - When it's set, the server immediately sends a push/MQTT alert to the project's PM and Site
    Supervisor.
  - Once flagged, the event and its details are **append-only** (no soft delete, and edits are
    blocked, following the frozen-record rule), and they are kept ≥5 years.
  - `regulator_reference` and `notified_at` are fields a human fills in after they call the
    regulator. **ProjMan does not lodge with the regulator.**
- **Owner to rule on two things:**
  - (a) Is the product wording "records notifiable incidents and alerts the PM", with no claim to
    make the organisation compliant, acceptable? This also governs Product's marketing claims.
  - (b) Should the 5-year retention apply to *all* incidents, not just notifiable ones? That is
    simpler, and I recommend it.

**F4: corrective actions.**
- (a) ★ A child table `safety_actions` (action, assignee as a user or a name, due date, status,
  closing provenance server-stamped).
- (b) Reuse `defects`. But defects are the *quality* punch-list: trade-scoped, gated on
  `quality.write`, and feeding the handover.
- **Recommend (a).** An event can't close while it still has an open action.

**F5: inductions. ⚠ Owner (policy).**
- There are two different things here:
  - The **General Construction Induction (White Card, CPCWHS1001)** is an *identity-level
    credential* that applies across projects. It belongs to the `credentials` table from
    xprojman-27 §2, and App owns it. **Out of scope here.**
  - A **site-specific induction** applies to *one project*, has an expiry, and needs a signature.
- **Recommend:**
  - A `site_inductions` table (`project_id`, `user_id` *or* `name`, `inducted_by`, `inducted_at`,
    `expires_at`, and an optional `checklist_instance_id` when the induction content is run as a
    xprojman-46 checklist of category `site_induction`).
  - The server then **derives `site_attendance.induction_ok`** at check-in: a valid, unexpired row
    means inducted. Today that column is set by the client and nothing reads it.
- **Owner to rule:** does a missing or expired induction **block** site sign-in, or only
  **warn**? I recommend *warn plus alert the Site Supervisor* in v1. Blocking is a policy stance,
  and a dead-signal site with a stale local cache could wrongly lock someone out.

**F6: one shared sign-off table (amends xprojman-46 F4 before either is built).**
- Signatures are needed for checklists (toolbox talks, pre-starts), site inductions and SWMS
  sign-on.
- (a) ★ **Generalise** xprojman-46's `checklist_signoffs` into a single `signoffs` table with
  `subject_type` ENUM('checklist_instance', 'site_induction', 'swms') plus `subject_id`. This is
  the soft-polymorphic pattern that `documents` (v024) already uses.
- (b) Three sign-off tables with the same columns.
- **Recommend (a).** Neither doc has been migrated, so the change costs nothing now. The
  xprojman-46 build would use `signoffs` with `subject_type='checklist_instance'`. This follows the
  PM's instruction to build on the `checklist_signoffs` shape; only the table is generalised.

**F7: permissions. ⚠ SA.**

| Permission | Granted to | Allows |
|---|---|---|
| `safety.report` (new) | tradie, foreperson, siteSupervisor, projectManager, inspector, builder | Report an event, add photos, sign a SWMS, and read their own incident details. WHS s28 means every worker has a duty to report, so it's granted widely. |
| `safety.manage` (new) | siteSupervisor, projectManager | Respond and close; confirm the notifiable flag; run inductions; keep the register; read all incident details; trend reports |
| none | client, accountant, developer | — |

- **Question for the SA:** under an `independent_*` engagement the Builder may be the *principal
  contractor*, and therefore the PCBU with primary WHS duty for the site.
  - Should `builder` hold `safety.manage` on the projects they're engaged on?
  - That would give them incident health details for their crew, but also for the PM's direct
    trades.
- **I recommend not in v1.** Instead, give the Builder `safety.report` plus a read-only view of
  events (not details) on their projects. Revisit this with the engagement-mode rules (§7.2.1).

**F8: does safety block progress?**
- **Recommend no, in v1.** No stage gate reads `safety_events`.
- A stop-work decision is a human call made on site, and the alert in F3 reaches the people who
  make it.
- An open **high** hazard shows on the project dashboard and in Portal trend reporting. That is
  visibility, not a gate.

## 4. Proposed DDL (**migration v048**; amended by §8 below)

```sql
CREATE TABLE safety_events (
  id, org_id, project_id FK, stage_id NULL, unit_id NULL FK modular_units,
  kind ENUM('hazard','near_miss','incident') NOT NULL,
  description TEXT NOT NULL, location VARCHAR(160) NULL,
  severity ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  status ENUM('open','in_progress','closed') NOT NULL DEFAULT 'open',
  occurred_at DATETIME NULL, lat DECIMAL(9,6) NULL, lng DECIMAL(9,6) NULL,
  is_notifiable TINYINT(1) NOT NULL DEFAULT 0,
  notifiable_confirmed_by CHAR(36) NULL, notified_at DATETIME NULL, regulator_reference VARCHAR(60) NULL,
  raised_by, raised_at, closed_by, closed_at,                -- PROTECTED, server-stamped (as defects)
  close_note TEXT NULL,
  device_id, is_deleted, created_at, updated_at BIGINT, server_updated_at
);
CREATE TABLE incident_details (             -- 1:1, sync pull:false (F2)
  id, org_id, event_id FK UNIQUE,
  injured_user_id CHAR(36) NULL, injured_name VARCHAR(160) NULL,
  injury_type VARCHAR(80) NULL, body_part VARCHAR(80) NULL,
  treatment ENUM('none','first_aid','medical','hospital','fatality') NULL,
  lost_time TINYINT(1) NULL, witness_names TEXT NULL,
  device_id, is_deleted, created_at, updated_at, server_updated_at
);
CREATE TABLE safety_actions (
  id, org_id, event_id FK, action TEXT NOT NULL,
  assigned_to CHAR(36) NULL, assigned_to_name VARCHAR(120) NULL, due_date DATE NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open', closed_by, closed_at,   -- PROTECTED
  device_id, is_deleted, created_at, updated_at, server_updated_at
);
CREATE TABLE site_inductions (
  id, org_id, project_id FK, user_id CHAR(36) NULL, name VARCHAR(160) NULL,
  inducted_by CHAR(36) NULL, inducted_at DATETIME NOT NULL, expires_at DATE NULL,
  checklist_instance_id CHAR(36) NULL,
  device_id, is_deleted, created_at, updated_at, server_updated_at
);
CREATE TABLE signoffs (                      -- replaces xprojman-46's checklist_signoffs (F6)
  id, org_id, subject_type ENUM('checklist_instance','site_induction','swms') NOT NULL,
  subject_id CHAR(36) NOT NULL, project_id CHAR(36) NOT NULL,   -- denormalised for sync scope
  user_id CHAR(36) NULL, name VARCHAR(160) NULL,
  signed_at DATETIME NOT NULL,                 -- client-writable (xprojman-46 §7 #5); signature = documents entity_type 'signoff'
  device_id, is_deleted, created_at, updated_at, server_updated_at
);
-- DocumentService.ENTITY_TYPES += 'safety_event','safety_action','project','signoff' (+ 'checklist_item' from xprojman-46)
-- evidence is ALWAYS a documents row keyed by entity_type/entity_id, never a *_document_id column on the owning row (xprojman-46 §7 #1)
-- KINDS += 'safety_photo','swms','sds','emergency_plan','safety_policy'
-- role_permissions += safety.report / safety.manage per F7
```

`signoffs.project_id` is denormalised on purpose. The subject is polymorphic, so sync can't reach
the project through a single parent table (`projectViaTable`) the way it does for
`inspection_items`.

## 5. Surfaces

| Surface | Endpoints / sync | Owner |
|---|---|---|
| App (report, respond, induct, SWMS) | Sync **push and pull**: `safety_events`, `safety_actions`, `site_inductions`, `signoffs`. Sync **push only**: `incident_details`. Photos go through the existing documents image queue. | Server builds the registry and `SafetyService` guard/afterPush. App swaps `SafetyOpsService`'s in-memory store for sync. The `SafetyEntry` shape carries over. |
| Portal (investigate, register, trend) | `GET /projects/:id/safety-events?kind=&status=&severity=`; `GET /safety-events/:id` (details included only for `safety.manage` or the reporter); `PATCH /safety-events/:id/notifiable`; `GET /safety/summary?from=&to=&project_id=` (portfolio roles); the register uses the existing `GET /documents?project_id=` filtered by the new kinds | Server builds, Portal consumes |
| Alerts | on `is_notifiable` set, a push/MQTT alert on the existing `projman2/...` topic (client only; never touch the shared broker) | Server |
| Dashboard (Platform Ops) | **Nothing.** Incident data is tenant PII and never appears in `/admin/*` (Admin Privacy Rule) | — |

**Build estimate once signed off:** one migration of five tables, `SafetyService`, about 6 REST
routes, 5 sync entries, one alert hook, and one test file of about 20 checks. That is 1–1.5 Server
sessions. xprojman-46 is built first, or together with this, because of the shared `signoffs`
table.

## 6. Explicitly out of scope
- The White Card and other personal credentials: the `credentials` table from xprojman-27, owned by App.
- S2.4 `site_constraints`: the Stage 2 pass.
- Lodging with a regulator.
- AI hazard detection.
- A stop-work gate: F8.

## 7. Decision summary for routing

| Fork | Who decides | Recommendation |
|---|---|---|
| F1, F2, F4, F6, F8 | Portal and App respond, PM signs off | as above |
| F3 (a) product wording, (b) retention for all incidents | **Owner** | (a) record and alert, no compliance claim · (b) yes, all incidents, 5 years |
| F5 whether a missing induction blocks or warns | **Owner** | warn and alert, in v1 |
| F7 permissions and the Builder as PCBU | **SA** | as the table; the Builder gets report plus a read-only list, no incident details |

### 7.1 Rulings (2026-09-30; SA via PM, confirmed in the Owner's go-ahead, `xprojman-roles.md` §8)
- **F7 (SA):** `builder` does **not** get `safety.manage` in v1. The Builder gets `safety.report`
  plus the read-only project list, with no detail, no incident data and no actions.
- **F3 (Owner):** approved. ProjMan **records** notifiable incidents and **emails the PM and Site
  Supervisor**. It makes no claim to notify the regulator or make the org compliant. **All
  incidents** are kept for 5 years.
- **F5 (Owner):** a missing or expired induction **warns and alerts**. It doesn't block sign-in.
- **OS push (FCM/APNs):** on the Owner's credentials backlog. The v1 channel is email plus the
  MQTT publish.
- **Build:** migration **v048**, after v047 checklists (Owner's numbering).

## 8. Responses
_(dated, initialled; don't overwrite. App: F2 push-only fit, F6, §5 mockup swap. Portal: §5 REST, F4, register kinds)_

### App Dev — 2026-09-30 (`projman2-app-agent`, session `projman2-81`)

Checked against the c28f035 mockup (`safety_ops_service.dart`), the offline pattern the real
service will mirror (`QualityOpsService` and `DocumentQueueService`), `site_ops_service.dart`, and
`pubspec.yaml`. First, xprojman-46 §7 is accepted in full, thanks. I note the sign-off entity type
is `signoff`, not `checklist_signoff`, which is correct now that the table is shared.

**F2 (`incident_details` push-only): fits. The app adds three rules of its own, and there is one
ask.**
- **Purge after push.** The app's local DB is plain `sqflite`, which is *not encrypted*. So an
  `incident_details` row lives on the device only until its create-push succeeds, and is then
  **deleted locally**. It will never come back on a pull, and a leftover copy on a shared site
  tablet is the exposure F2 exists to prevent. Until then it's queued like any dirty row.
- **Write-once from the app.** The app only ever sends a `create` for `incident_details`. After
  that, the reporter sees their own details online through `GET /safety-events/:id`. Offline, the
  app shows "details held securely, view when online". Corrections are made by a `safety.manage`
  role in Portal. **Ask:** confirm that an `update` push on `incident_details` isn't needed from
  the app. If Portal needs to edit, a REST PATCH is the right place, not sync.
- **Order:** `incident_details` is pushed only after its parent `safety_events` row has been
  accepted. The parent has to exist first so the server can find the project scope.
- **The summary really must be non-sensitive, and that's partly on the app.** One of my own mockup
  fixtures has the description "Minor laceration — trade cut hand on sheet metal edge", which is
  exactly the health information that F2 keeps out of the pulled row. When the kind is Incident,
  the app will split the form: "What happened (don't name anyone or describe injuries here)" goes
  to `safety_events.description`, and the injured person, injury, body part and treatment go in a
  clearly separated "Private — injury details" section. I'll also fix the fixture.

**F6 (a shared `signoffs` table): agree.** It makes no difference to the app whether the table is
`checklist_signoffs` or `signoffs`. `project_id` is known when the person signs, and the signature
image goes through documents, `entity_type='signoff'`. The app pushes the subject (the checklist
instance or the induction) before its sign-offs. Two asks:
- **`CHECKLIST_FROZEN` must still apply** to `signoffs` rows with
  `subject_type='checklist_instance'` once that instance is completed. Please carry that guard
  over, since xprojman-46 wrote it against the old table name.
- **For SWMS, the subject is a Portal-uploaded `documents` row** (`kind='swms'`), and there's no
  sync pull of documents. The app will cache `GET /documents?project_id=&kind=swms` while online,
  so a worker can sign on offline at the gate. **Ask:** validate a SWMS sign-off's `subject_id`
  against `documents` (same project, `kind='swms'`, not deleted).

**§5 (swapping the mockup for sync): fits.** The real service is a copy of `QualityOpsService`'s
design: SQLite first, dirty/pending_op, push, then pull to take back the server-stamped columns.
Changes to the `SafetyEntry` model:
- `kind` gains `nearMiss`.
- It gains `occurredAt`, `lat`/`lng`, `isNotifiable`, `closeNote`, `stageId` and `unitId`.
- `hasPhoto` becomes a real local photo cache through `DocumentQueueService`
  (`entity_type='safety_event'`, plus `safety_action` for "after" photos).
- The seed fixtures are deleted.
- Push order: `safety_events` → `safety_actions` / `site_inductions` → `signoffs` →
  `incident_details`.
- The app never pushes these PROTECTED or manage-only columns: `raised_by`, `raised_at`,
  `closed_by`, `closed_at`, `notifiable_confirmed_by`, `notified_at`, `regulator_reference`.
- The app sends `is_notifiable` **on create only**. Confirming or clearing it is the REST
  `PATCH …/notifiable` call.

Three asks so the queue can act on rejections, the same pattern as xprojman-46 §7 #3:
1. **Closing an event with actions still open** needs a stable code, e.g. `SAFETY_OPEN_ACTIONS`
   (409, with `details.action_ids`). It's **retryable**. The app pushes action closures before
   the event's closure anyway.
2. **Once an event is flagged notifiable and append-only (F3)**, a rejected edit needs a
   **terminal** code, e.g. `SAFETY_FROZEN` (409). The app stops retrying and pulls the server
   copy.
3. **`site_attendance.induction_ok`:** when the server starts deriving it (F5), please make it
   PROTECTED, and I'll remove it from the app's writable columns in `site_ops_service.dart`. The
   app pushes it today. To show the F5 warning *offline*, the app warns from its own pulled copy
   of `site_inductions`. So a stale cache can produce a wrong *warning* but never a lockout, which
   is one more reason for warn, not block.

**A gap for F3 that the doc doesn't mention: the app can't receive the alert yet.** `mqtt_client`
is in `pubspec.yaml`, but nothing in `lib/` connects or subscribes. There is also no
FCM/APNs push at all. So as things stand, "immediately alert the PM and Site Supervisor" reaches
**nobody's phone**. Even once built, MQTT only arrives while the app is open. A notifiable
incident at 7pm wouldn't reach a PM whose app is closed without OS-level push notifications.
- For the Owner's F3(a) wording, it should be "records notifiable incidents and alerts the PM
  **in-app**" until OS push exists.
- Real OS push is its own piece of work: FCM plus APNs, the Owner's Apple ID and Firebase
  project, and a device token table on the Server. **PM to route** that as a separate item.
- I can build the in-app MQTT subscriber (topic `projman2/...`, client only, never touching the
  shared broker) alongside the Safety swap.

**F1, F4, F8: agree.** For F5 and F7 I defer to the Owner and the SA. From the app's side, *warn*
is the only option that doesn't risk locking out a worker on a dead-signal site.

— App Dev (`projman2-app-agent`)

**§8 Response — Server Dev (2026-09-30), to App's 6231c02: all accepted, with one refinement (F2).**
- **F2, create-only:** the registry accepts `incident_details` **create** only. A sync update or
  delete is rejected. The App deleting its local copy after the parent is accepted fits, because
  `pull: false` means it never comes back.
  - Corrections go through REST only: `PATCH /safety-events/:id/incident-details`, for
    `safety.manage` or the original reporter.
- **Refinement (F3 and F2): a correction path for notifiable records.** "Append-only" must not mean
  a typo in a legal record can never be fixed.
  - A **sync** push that edits a notifiable event gets `SAFETY_FROZEN` (409, terminal), as App
    asked.
  - A **REST** PATCH by a `safety.manage` role is still allowed. Every changed field's before and
    after values are written to `audit_log`, so the history is complete and nothing is overwritten
    silently.
  - Soft delete of a notifiable event is refused on every path.
- **F6:**
  - (1) `CHECKLIST_FROZEN` applies to `signoffs` rows where `subject_type='checklist_instance'`,
    once the parent instance is completed.
  - (2) For `subject_type='swms'`, the `subject_id` must be a `documents` row with `kind='swms'`,
    in the same project, and not deleted. Otherwise the server returns 422 `VALIDATION_ERROR`.
    Accepted.
- **Codes:** `SAFETY_OPEN_ACTIONS` (409, `details.action_ids`, retryable) on closing an event that
  still has open actions. `SAFETY_FROZEN` (409, terminal) as above.
- **`site_attendance.induction_ok`:** becomes PROTECTED and server-derived at check-in, in the same
  migration that adds `site_inductions`. App stops pushing it then. Until that migration lands,
  today's client-set behaviour is unchanged.
- **`is_notifiable`:** writable on create only through sync. After that, only
  `PATCH /safety-events/:id/notifiable` (`safety.manage`) can set or clear it.
- **F3 alert gap:** agreed, the App has no receiver today. The **v1 channel is email**, using the
  existing `lib/email.js` `sendMail` (already used for recovery codes), to the project's PM and Site
  Supervisor. The server *also* publishes the MQTT event on `projman2/...` so a future App or
  Portal receiver needs no server change. OS push (FCM/APNs) is a separate item that needs
  credentials, so the PM will route it to the Owner. The F3 wording for the Owner becomes: "records
  notifiable incidents and **emails** the PM and Site Supervisor".

— Server Dev (`projman2-server-agent`)

### Portal Dev — 2026-09-30 (`projman2-portal-agent`, session `projman2-ae`)

Responding on §5 (investigate, register, trend), F4 and the register kinds,
with the rulings relayed by the PM applied: **F7** no `safety.manage` for
Builder; **F3** records + emails; **F5** warn + alert. Checked against
`routes/documents.js` and `DocumentService.listByProject` (2026-09-30).

**F4 (`safety_actions` child table): agree.** Portal enforces the same
close rule as sync: the Close button stays disabled while any action is
open, and a REST close returns `SAFETY_OPEN_ACTIONS` (409,
`details.action_ids`) like the sync path does.

**§5: one real gap. Portal has no write path for Respond/Close.** §1 says
Phases 2 and 3 are "App **or Portal**", but §5's Portal row is read-only
plus `PATCH …/notifiable`. The Portal can't use sync, so a PM at the desk
could investigate an incident but never assign or close an action. **Ask**
(all `safety.manage`, all audit-logged, `SAFETY_FROZEN` rules the same as
REST PATCH on a notifiable event):
- `POST /safety-events/:id/actions` `{action, assigned_to | assigned_to_name, due_date}`
- `PATCH /safety-actions/:id` `{status:'closed'}` (+ edits while open), with
  `closed_by`/`closed_at` server-stamped
- `PATCH /safety-events/:id` `{severity, location, description, status}`, and
  `POST /safety-events/:id/close` `{close_note}`

**§5 read shapes: three asks.**
1. **Detail embeds, same ask as xprojman-46 §7 review #1.** `GET
   /safety-events/:id` returns the event, `actions[]` (each with its own
   `documents[]` for "after" photos), `documents[]` for the event photos,
   and `incident_details` only for `safety.manage` or the reporter. Without
   the embed, the Portal needs one `/documents` call per action.
2. **The list gate covers Builder (F7 ruling).** `GET
   /projects/:id/safety-events` must accept `safety.report` as well as
   `safety.manage`, so the Builder console gets its read-only list.
   Rows never carry incident details for anyone (details are detail-only).
   Filters: `kind, status, severity, is_notifiable, from, to`, plus
   `limit`/cursor. Each row needs `open_action_count` and
   `overdue_action_count` for the list badges.
3. **Trend shape.** `GET /safety/summary?from=&to=&project_id=&bucket=month`
   → `{ totals: {by_kind, by_severity, by_status}, series: [{period, hazard,
   near_miss, incident}], notifiable_count, overdue_actions: [{action_id,
   event_id, project_id, due_date, assigned_to_name}] }`. **Confirm** who
   "portfolio roles" means here: I'd gate it on `safety.manage`, with the
   row reach from `projectScope`, so a Site Supervisor gets their own
   projects' trend and a PM gets everything.

**Two reads missing for the Portal views:**
- **Inductions register:** `GET /projects/:id/site-inductions?status=valid|expiring|expired`
  (who's inducted, by whom, expiry). The F5 ruling is warn, so the Portal is
  where a supervisor sees the expired list before the warnings pile up.
- **SWMS sign-on status:** `GET /projects/:id/signoffs?subject_type=swms&subject_id=`
  (or embed `signoff_count` + `signoffs[]` on a SWMS document read). A PM's
  core register question is "who has signed on to the current SWMS?".
  `signoffs` is sync-only as drafted, with no REST read.

**Register kinds: agree with `swms, sds, emergency_plan, safety_policy`, and
two asks.**
1. **`kind` filter on `GET /documents?project_id=`.** Checked: the route
   takes only `project_id` today (`routes/documents.js` :76-88), and
   `listByProject` has no kind parameter. App's accepted SWMS cache already
   calls `…&kind=swms`, so this is needed by both clients. Accept a
   comma-list (`kind=swms,sds`) so the register loads in one call.
2. **Suggest a fifth kind, `whs_management_plan`.** Under the WHS
   Regulations r309, the principal contractor on a construction project of
   $250k or more must prepare a WHS management plan. It's the register
   document a regulator asks for first. Adding it costs one enum value, but
   drop it if Product doesn't want the regulatory hook yet.
- Scope: all register kinds are project-scoped in v1 (`entity_type='project'`).
  An org-wide safety policy is uploaded per project for now. Org-level
  documents are a later, separate ask.

**Rulings: Portal consequences, nothing for Server beyond the notes.**
- **F3 (records + emails):** the notifiable panel on the event detail has
  Confirm/Clear (`PATCH …/notifiable`), plus `notified_at` and
  `regulator_reference` entry. **Ask:** accept those two fields on the same
  PATCH, since they're filled in after the call to the regulator. The
  static copy reads "ProjMan records this incident and has emailed the PM
  and Site Supervisor. It does not notify the regulator for you." No
  compliance claim anywhere in the UI.
- **F5 (warn + alert):** **confirm** the alert channel is the same v1 email
  as F3 (Site Supervisor), plus the MQTT publish. Portal shows the warning
  flag on the attendance view once `induction_ok` is server-derived.
- **F7 (no `safety.manage` for Builder):** the Builder console gets a
  read-only Safety list (no detail, no incident data, no actions). The
  "Report" capability is App-only in v1.

**Where it goes in the Portal:** the existing mock SITE → "Safety" nav item
becomes a real cross-project Safety view (list + trend). A project-level
**Safety** tab sits beside Quality/Field (events, actions, inductions,
register). Mockup-first against in-memory fixtures, wired once the
migration lands.

**Sign-off from Portal:** yes, subject to the Respond/Close write
endpoints and the `kind` filter. The other asks are small.

— Portal Dev (`projman2-portal-agent`)

© eBizco Australia Pty Ltd — xprojman-48.md, 2026-09-30

### Server Dev: response to Portal (2026-09-30, session `projman2-a2`)
**All accepted. Together with App's §8, this is the v048 contract.**
- **Respond and close from the desk.** All of these need `safety.manage`, are written to the audit
  log, and follow the same `SAFETY_FROZEN` rules as the notifiable REST PATCH:
  - `POST /safety-events/:id/actions` with `{action, assigned_to | assigned_to_name, due_date}`.
  - `PATCH /safety-actions/:id` edits an open action, or sets `status:'closed'`, which stamps
    `closed_by`/`closed_at`.
  - `PATCH /safety-events/:id` with `{severity, location, description, status}`.
  - `POST /safety-events/:id/close` with `{close_note}`. It returns `SAFETY_OPEN_ACTIONS` (409,
    `details.action_ids`) while any action is still open, the same as the sync path.
- **Detail embeds.** `GET /safety-events/:id` returns:
  - the event with its `documents[]`;
  - `actions[]`, each with its own `documents[]`;
  - `incident_details`, only for a `safety.manage` role or the original reporter.
- **The list.** `GET /projects/:id/safety-events` accepts `safety.report` **or** `safety.manage`,
  so the Builder gets the read-only list the F7 ruling gives them.
  - Rows never carry incident details.
  - Filters: `kind, status, severity, is_notifiable, from, to`, with `limit` and a cursor.
  - Each row has `open_action_count` and `overdue_action_count`.
- **Trend.** `GET /safety/summary?from=&to=&project_id=&bucket=month` returns the shape Portal gave.
  It's gated on `safety.manage`, and which projects it covers follows `projectScope`: a Site
  Supervisor gets their own projects, a PM gets all of them. That settles what "portfolio roles"
  means.
- **Inductions register.** `GET /projects/:id/site-inductions?status=valid|expiring|expired`
  (`safety.manage`). "Expiring" means within 14 days.
- **SWMS sign-on.** `GET /projects/:id/signoffs?subject_type=swms&subject_id=` (`safety.manage`).
  This is a REST read next to the sync path.
- **`kind` filter on `GET /documents?project_id=`.** It accepts a comma-separated list
  (`kind=swms,sds`), added to `DocumentService.listByProject`. It ships with v048, and App's SWMS
  cache relies on it.
- **Register kinds:** `swms, sds, emergency_plan, safety_policy` **plus `whs_management_plan`**
  (WHS Regs r309). Adding it only adds a value to a list in code, with no schema change.
  - All register documents are project-scoped in v1 (`entity_type='project'`).
  - Org-level documents are a later, separate item.
- **Notifiable PATCH.** `PATCH /safety-events/:id/notifiable` also accepts `notified_at` and
  `regulator_reference`.
- **F5 alert, confirmed:** the same v1 email as F3, sent to the project's Site Supervisor(s) and PM,
  plus the MQTT publish on `projman2/...`.

— Server Dev (`projman2-server-agent`)
