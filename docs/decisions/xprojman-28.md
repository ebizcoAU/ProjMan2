# xprojman-28 — Portal build specification: Scheduling, Documents, Checklists, Defects, Safety/OHS

**Status:** 🟡 DRAFT — spec-before-code, per owner correction 2026-09-03 ("the design
specification will outlay each phase... do not blindly code and have no plan" /
"the whole team goes with the server progress"). Each module below is checked
against what Server has **actually built** (routes + schema, not the design
docs' own claims), not assumed. Open for all-team contribution, same
convention as `xprojman-27.md` — dated, initialled note in §6, don't silently
overwrite.
**Author:** Portal Agent (`projman2-portal-agent`) · **For:** All Teams ·
Owner sign-off requested before further Portal code lands against modules 2-5.
**Date:** 2026-09-03
**Related:** `docs/decisions/xprojman-27.md` (the module list this build
order is drawn from), `docs/decisions/schema-relationship-map.md` (source for
every table/route claim below), `docs/portaldesignspecification.md` §3.4/§10.

---

## 0. Reading this doc

Per module: **Phases** (the workflow, in order) → **Inputs** (what data, from
where, whose write) → **Outputs** (what the screen produces/changes) →
**Parameters** (permission gate, scope, validation, edge cases) →
**Server dependency** (what already exists vs. what's missing — the thing
this doc exists to surface before code gets written against a gap).

---

## 1. Scheduling — Programme/Line-of-Balance editing

**Status: built** (this session, `server/portal/src/app/builder/programme/`)
— documented here retroactively for review, per the correction above. Nav
entry (`BUILDER_NAV` in `PortalNav.js`) still marked `mock: true` pending
sign-off; not yet linked live.

**Phases:**
1. *Discover* — Builder opens `/builder/programme`, sees a picker of their own
   engaged jobs.
2. *Author* — opens one job, adds/edits his own Stages 9–18 (name, milestone,
   start/end date).
3. *Track* — advances a stage's status along `not_started → in_progress →
   complete`.
4. *Visualise* — a Gantt bar renders every dated own-stage proportionally
   against the min/max span.

**Inputs:**
- `project_stages` rows via `GET /projects/:id` (same payload the PM
  console's read-only Programme tab already renders).
- User-entered: `name`, `milestone`, `start_date`, `end_date` (create via
  `POST /projects/:id/stages`, edit via `PATCH /projects/:id/stages/:stageId`).
- `projects.unit_count` (S1.3) — read only, to raise the multi-unit caveat.

**Outputs:**
- New/updated `project_stages` rows, `seq >= 9` only.
- `stage.create`/`stage.update` audit log entries (server-side, automatic).
- No financial columns (`budget_amount`/`estimated_amount`/`committed_amount`/
  `actual_amount`/`claimed_amount`) are ever sent — Cost Plan is a separate
  wall (§1.4 of the portal spec); this screen only ever touches schedule
  fields.

**Parameters:**
- Permission: `programme.write`.
- Scope: `assertProgrammeWriteScope` (`ProjectService.js:259`) — Stages 1–8
  reject any non-PM write regardless of what this UI sends; Stages 9–18
  accept a write only from the Builder holding the **accepted** engagement on
  *this* project. The UI never offers an edit control for Stages 1–8 (renders
  them read-only) so there's no dangling control guaranteed a 403.
- Multi-unit Line-of-Balance (`unit_count > 1`): **not built.** No
  `modular_units`/per-unit stage table exists (`schema-relationship-map.md`,
  2026-09-03) — there's no per-unit dimension to render swim-lanes against.
  The page renders a caveat banner instead of a stub swim-lane view when
  `unit_count > 1`.

**Server dependency — one bug surfaced, not fixed by Portal:**
`routes/projects.js`'s `POST /projects/:id/stages` validator still checks
`status` against `['pending','in_progress','complete','skipped']` —
pre-migration-`v006` values. The actual enum since `v006` is `not_started`/
`in_progress`/`blocked`/`complete`/`skipped`. This UI never sends `status` on
create (relies on the column default), so it isn't blocked by this, but any
future caller that does send `status: 'not_started'` on create would get a
stale 422. Flagging for Server to fix in `routes/projects.js`, not touching
another team's file myself.

---

## 2. Documents repository UI

**Status: NOT built. Blocked on a server gap, not a Portal build task yet.**

**Phases (as designed):**
1. *Browse* — list documents for a project, filterable by kind/entity.
2. *Upload* — office-side upload (a PM attaching a surveyor's cert, etc.).
3. *View/download* — stream a document's bytes.
4. *(future)* Organise by stage/unit — deferred, no `modular_units` to key on
   (same gap as module 1).

**Inputs (what exists today):** `documents` table — `entity_type`/`entity_id`
soft-polymorphic ref, `kind`, `project_id` (nullable), `uploaded_by`,
`sha256`/`size_bytes`/`mime_type` (server-derived).

**The gap:** `GET /documents` (`routes/documents.js:69`, `DocumentService.
listByEntity`) **requires both `entity_type` and `entity_id`** — it lists
documents for one specific inspection/defect/certificate/site-diary/delivery
row, not "every document on project X." `ENTITY_TYPES` is a closed list of
five values (`inspection_item`, `defect`, `certificate`, `site_diary`,
`delivery`) — there's no `project` entity type and no project-wide list
endpoint. A "browse this project's documents" screen cannot be built against
this API today without either:
- (a) Server adding a project-scoped list (e.g. `GET /projects/:id/documents`
  or an `entity_type`-optional mode on the existing endpoint), or
- (b) Portal fan-out across all five entity types per project (N+1, and still
  misses org-level/unattached uploads where `entity_type IS NULL`).

Recommend (a). **Not building past this point until Server confirms the
endpoint shape** — this is exactly the kind of gap the owner asked this doc
to surface before code, not after.

**Outputs (once unblocked):** a document list/grid, an upload form
(multipart, `client_ref` for idempotency), inline preview/download.

**Parameters:** `projects.read` to list, `documents.write` (or
`quality.write`, per the existing `DELETE` gate) to upload/delete. Scope:
whatever the new endpoint's `projectScope` narrowing resolves to — same
pattern as every other project-scoped read.

---

## 3. Checklist template builder

**Status: NOT built. Blocked on new schema — Server input needed before
either team estimates this.**

**Phases (as designed):**
1. *Author* — PM/org-admin creates a reusable checklist template (e.g. site
   induction, plant pre-start, toolbox talk) — a name + an ordered list of
   items.
2. *Publish* — template becomes available to attach to a project/stage/role.
3. *Execute* (App) — the assigned role ticks items against a live checklist
   instance.
4. *Review* (Portal) — history of completed checklists per project.

**The gap:** `hold_point_requirements` (`migration_v016`) is the only
checklist-shaped table in the schema, and it's narrowly hold-point-specific
(`stage_id` NOT NULL, `required_role`, `jurisdiction`, `blocks_progress`) —
not a generic template. `xprojman-27` module #2 already flagged this: "No
generic checklist-template table." Building this needs new schema:

- `checklist_templates` (`id`, `org_id`, `name`, `category`, `created_by`) —
  proposed, not agreed.
- `checklist_template_items` (`id`, `template_id`, `seq`, `label`,
  `required`) — mirrors the `stage_templates`/`stage_template_items` parent/
  child shape already proven in the schema.
- `checklist_instances` (`id`, `org_id`, `project_id`, `template_id`,
  `completed_by`, `completed_at`) + `checklist_instance_items` (per-item
  tick, mirrors `inspection_items`' relationship to `inspections`).

**Not proposing this as final** — flagging the shape for Server to confirm
or correct (same courtesy as `xprojman-27` §4's `credentials` discussion),
since this is squarely a schema decision, not a Portal-only one.

**Parameters (anticipated):** author = `programme.write` or a new
`checklists.manage`; execute = whatever role the template targets (App-side,
out of Portal's scope); Portal's own surface is author + review only.

---

## 4. Defects — Portal management/close-out view

**Status: NOT built. One missing endpoint, otherwise ready.**

**Phases:**
1. *List* — punch-list for a project, filterable by status
   (open/in_progress/closed).
2. *Triage* — PM assigns/reassigns, sets due date.
3. *Close* — mark closed once resolved (photo-after already captured
   App-side via `photo_after_id`).
4. *Escalate* — link into Disputes oversight (module 13 of the portal
   catalogue) when a defect is contested — out of scope for this pass,
   flagged for the pairing noted in `portaldesignspecification.md` §10 step 5.

**Inputs:** `defects` table (`migration_v009`) — already fully built and
populated App-side (`raised_by`, `location`, `trade`, `description`,
`assigned_to`/`assigned_to_name`, `due_date`, `severity`, `status`,
`closed_by`/`closed_at` server-stamped, `photo_id`/`photo_after_id`).
`GET /projects/:id/defects?status=` (`routes/projects.js:503`) already
exists and is what the App's own quality tab presumably reads from.

**The gap:** no write endpoint. `routes/projects.js` has no
`PATCH /projects/:id/defects/:defectId` — a Portal close-out/reassign action
has nothing to call. This is a **small, well-scoped ask**: one new route,
gated on an existing permission (`quality.write` is already used for the
document delete gate; reasonable default here too, PM confirms).

**Outputs (once the endpoint exists):** `status`/`assigned_to`/`due_date`
updates on an existing row; `closed_by`/`closed_at` stay server-stamped, same
pattern as every other server-stamped column in this schema — never a bare
client write.

**Parameters:** `projects.read` to list (already gates the GET); the new
PATCH needs its own permission decision — smallest surface: reuse
`quality.write`, scoped `assigned` like every other project-scoped write.

**This is the cheapest of the four not-yet-built modules** — one endpoint,
no new schema, no new permission if `quality.write` is reused. Recommend
this goes to Server first among modules 2–5.

---

## 5. Safety/OHS management dashboard

**Status: NOT built. Blocked on schema that doesn't exist anywhere yet —
largest gap of the five.**

**Phases (as designed):**
1. *Capture* (App) — hazard/incident logged on-site.
2. *Investigate* (Portal) — PM/safety officer records findings, corrective
   action, sign-off.
3. *Register* (Portal) — running policy/procedure document register.
4. *Report* (Portal) — WHS dashboard/trend view across projects.

**The gap:** confirmed twice now — `xprojman-27` §0's original correction and
`schema-relationship-map.md` Appendix A both found **no `hazards` or
`incidents` table anywhere in the schema**, only prose mentions in seed data
and service comments. Phase 1 (the App-side capture this whole module reads
from) doesn't exist. Building a Portal dashboard before that capture surface
exists would mean building a screen with nothing to show.

**Recommend:** this module doesn't start until Server (and App, for the
capture side) scope the underlying schema — likely `hazards`/`incidents`
tables shaped like `defects` (raised_by/location/severity/status, photo via
the existing `documents` polymorphic ref) plus an `investigations` or
`corrective_actions` child table for phase 2. Not proposing exact columns
here — this needs a three-team pass (Server schema, App capture UI, Portal
dashboard), not a Portal-only spec.

**Parameters:** unresolved — depends on the schema decision above.

---

## Net read for sequencing

| Module | Blocked on | Recommended order |
|---|---|---|
| 1 Scheduling | Nothing — built | Ship (flip `mock:false` in nav on sign-off) |
| 4 Defects | One new endpoint (`PATCH .../defects/:id`) | Next — cheapest, Server-only, no schema |
| 2 Documents | A project-scoped list endpoint | After Defects — Server decides (a) new route vs (b) fan-out |
| 3 Checklists | New schema (3-4 tables), Server input needed | After Documents — needs a schema proposal pass first |
| 5 Safety/OHS | New schema AND App capture surface, 3-team scoping | Last — biggest gap, not a Portal-only decision |

---

## 6. Team contributions

*(Dated, initialled entry per contribution — don't silently overwrite, add
below.)*

- 2026-09-03, Portal Agent: initial draft, all 5 modules, per owner
  correction to write phases/inputs/outputs/parameters before coding.
- 2026-09-03, App Agent (`projman2-app-agent`): confirming module 5's Phase 1
  gap from the App side, since this doc's Safety/OHS section is asking for it.
  `app/lib/screens/tabs/safety_tab.dart` is still `_stub_tab.dart`-backed —
  "Built at P6" note, zero implementation, three unbuilt sub-pages (Safety/
  Incidents/Inductions). So it's not just the schema that's missing (as
  `schema-relationship-map.md` Appendix A found) — there's no App capture UI
  to wire a schema into yet either, on either side of the gap. Agree with the
  "last, three-team scoping pass" ordering. When that pass happens, App's
  §4.0-style Input/Output table (`appdesignspecification.md` §9, added this
  session per the same owner directive) is the format I'd extend for whatever
  hazard/incident capture ends up in Stage 2/10 — happy to co-author the
  schema proposal alongside Server rather than have App design it solo, same
  pattern as the `credentials` discussion in `xprojman-27` §4.
