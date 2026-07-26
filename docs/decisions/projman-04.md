# ProjMan-04 — Server Build Status (server dev → app team)

**Status:** 🟢 LIVE tracker · **Author:** server dev (NexusPM) · **For:** the app team
**Updated:** 2026-07-25
**Companions:** `projman-01.md` (the frozen wire contract — still the source of truth
for endpoint shapes) · `servdesignspecification.md` §9 (the access-control design) ·
`18StageProjectMangementMatrix.md` (the workflow of record).

> **Why this file exists.** So the app team can see, in one place, what the server
> has built + verified, what changed on the wire, and what is waiting on you — without
> reading the code or the commit log. `projman-01` stays the **contract**; this is the
> **progress board**. When something here is confirmed by both sides, it graduates
> into `projman-01`. Server-dev authored; tell me if a shape here doesn't suit the
> client and I'll adjust before it hardens.

---

## 1. Snapshot — what is live and verified (dev DB `c1projman2`)

| Area | State | Proof |
|---|---|---|
| **Phase-1 identity** (register/login/refresh/logout, recovery + device-loss, pairing-with-role, devices, sync, org, audit) | ✅ built + verified | `tests/isolation.test.js` 16/16 · `tests/acceptance.js` walk-through green |
| **AU sign-in** (OAuth token-exchange ×3, `/auth/onboarding`, +61 SMS verify) | ✅ built | migration_v002 · dev-bypass path |
| **Construction core** (customers, projects, project_stages, tasks) | ✅ built + verified | migration_v003 · `tests/domain.test.js` 28/28 |
| **Access control** (permissions + resource scope + roles-as-data) | ✅ built + verified | migration_v004/v005 · `tests/access.test.js` 19/19 |
| **18-stage engine** (templates, progression gates, hold-point interlocks, cost cols) | ✅ built + verified | migration_v006 · `tests/stages.test.js` 15/15 |
| **System Admin dashboard** (platform: accounts, login log, billing/fees; **3 admin-team sub-roles** admin/account/staff; own login `/admin/login`, own sidebar, zero overlap with the Portal) | ✅ built + verified | migration_v007+v011 · `tests/admin.test.js` 18/18 |
| **Site ops (P5)** (site_diary append-only+versioned, geofenced attendance, deliveries) | ✅ built + verified | migration_v008 · `tests/siteops.test.js` 28/28 |
| **Quality (P6a)** (inspections/inspection_items/defects/certificates; hold-point inspection pass drives the existing §10.5 validate gate) | ✅ built + verified | migration_v009 · `tests/quality.test.js` 19/19 |
| **Compliance (P6b)** (NCC register + structural-inspection completion gates, wired into the existing stage engine) | ✅ built + verified | migration_v010 · `tests/compliance.test.js` 18/18 |
| **Office portal** (Next.js; login + Devices + Projects + Programme + **Cost Plan** + **Quality** + **Admin**: Users/Settings/Audit) | ✅ builds clean, endpoints verified | `server/dashboard` |
| Public portal (client role) | ⏳ P10 — role seeded, surface not built | — |

**All suites pass together:** isolation 16 · domain 29 · access 19 · stages 15 ·
admin 18 · siteops 28 · quality 19 · **compliance 18** — from a fresh instance
(`DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js`). (The `acceptance.js` transcript
is stale against the current recovery-token + pairing-role-in-confirm contracts —
unrelated to any domain module; refresh it when the identity flow next moves.)

---

## 2. The role model — 6 roles (course-corrected 2026-07-23)

Earlier drafts followed development.md §3's 12-role model. The **18-Stage Matrix** is
the authority, and its Role Actor Pairing Registry is **6 roles, camelCase**. Owner
confirmed 2026-07-23: the matrix wins, the 12-role overlay is retired, identifiers are
camelCase, `projectManager` is the portfolio top-actor that **creates projects**.

| `role` (wire value) | Label (UI) | Scope | Surfaces | Pairable? | Staff-assignable? |
|---|---|---|---|---|---|
| `projectManager` | Project Manager | portfolio (all projects) | Portal + App | ✅ | ✅ |
| `siteSupervisor` | Site Manager | assigned (member projects) | Portal + App | ✅ | ✅ |
| `foreperson` | Foreman | assigned | App | ✅ | ✅ |
| `tradie` | Tradie | self (own tasks) | App | ✅ | ✅ |
| `inspector` | Inspector | assigned | Portal + App | ✅ | ✅ |
| `client` | Client | portal (own project, read) | Public Portal | ❌ | ❌ (P10 invite flow) |

⚠️ **Wire values are these exact camelCase strings.** The pairing screen shows the 5
pairable roles as **labels** but must send the **`role` value**. Don't send display
forms like `Site Manager`. Fetch the list from `GET /auth/permissions` →
`pairableRoles` rather than hard-coding it (this is how `inspector` shipped ahead of
the server before — now it can't).

**Doc inconsistency flagged:** Stage 9 names an `estimator`, absent from the 6-role
registry. Treated as a `projectManager` sub-function (registry is authority). Say the
word if you want `estimator` as a 7th role.

---

## 3. Permission matrix (what each role may do) — `matrixVersion: 4`

Enforcement is by **permission**, not role name (adding/altering a role is a data
change, no endpoint edits). ✅ = granted.

| Permission | projectManager | siteSupervisor | foreperson | tradie | inspector | client |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `org.manage` | ✅ | | | | | |
| `users.manage` | ✅ | | | | | |
| `devices.manage` (pairing) | ✅ | ✅ | | | | |
| `customers.read/write` | ✅/✅ | | | | | |
| `projects.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `projects.write` (create/edit) | ✅ | | | | | |
| `programme.write` (stage/task structure) | ✅ | | | | | |
| `progress.write` (stage status, task %) | ✅ | ✅ | ✅ | ✅ (own) | | |
| `money.read/write` | ✅/✅ | | | | | |
| `quality.validate` (is_validated) | | | | | ✅ | |
| `diary.write` / `diary.signoff` | ✅/✅ | ✅/✅ | ✅/— | | | |
| `attendance.write.site` / `.own` | ✅/✅ | ✅/✅ | ✅/✅ | —/✅ | | |
| `deliveries.write` | ✅ | ✅ | ✅ | | | |
| `quality.write` (P6: inspections/items/defects/certificates) | ✅ | ✅ | | | ✅ | |

**Money is redacted on the wire** for any session lacking `money.read`:
`projects.contract_value`, `project_stages.budget_amount`, `tasks.budget_*` are
stripped from `/sync/pull` **and** REST reads for siteSupervisor/foreperson/tradie/
inspector. A supervisor's tablet never carries what the job is worth.

**Pairing authority** is a rank ceiling, not a permission subset: projectManager (100)
may pair anyone; siteSupervisor (40) may pair only foreperson/tradie; nobody pairs an
inspector but a projectManager. `client` is never a device role.

---

## 4. Endpoints you can build against now

New since projman-01 §1 (all `/api/v1`, Bearer unless noted):

```
GET   /auth/permissions        → { matrixVersion, role, scopeClass, permissions[],
                                    pairableRoles[{role,label}], assignableRoles[] }

GET   /projects?status=&page=&limit=     list (scoped + money-redacted per role)
POST  /projects                          create            (projects.write)
GET   /projects/:id                      detail + stages + tasks (scoped)
PATCH /projects/:id                      update            (projects.write)
POST  /projects/:id/stages               add stage         (programme.write)
PATCH /projects/:id/stages/:stageId      edit stage        (programme.write)

GET    /projects/:id/members             the project team
POST   /projects/:id/members {user_id}   add member        (users.manage)
DELETE /projects/:id/members/:userId     remove member     (users.manage)

GET   /customers                         list
POST  /customers                         create            (customers.write)
PATCH /customers/:id                     update            (customers.write)

GET   /stage-templates                   system + org templates (the programme library)
GET   /stage-templates/:id               template + its 18 items
POST  /projects/:id/programme {template_id}   instantiate stages (programme.write)
POST  /projects/:id/stages/:sid/advance  {to_status,milestone?}  gated status change (progress.write)
POST  /projects/:id/stages/:sid/validate {result,reference?}     hold-point pass/fail (quality.validate → inspector)

POST  /projects/:id/inspections                 {type,stage_id?,is_hold_point?,scheduled_at?,notes?}  create (quality.write)
GET   /projects/:id/inspections                 list (+items)                       (projects.read, scoped)
POST  /projects/:id/inspections/:iid/complete   {result,reference?,document_id?}    commit verdict — a hold-point PASS
                                                 drives is_validated via the SAME §10.5 gate (quality.write; hold-point
                                                 pass also needs quality.validate — PM cannot self-validate here either)
GET   /projects/:id/defects?status=             punch-list                          (projects.read, scoped)
GET   /projects/:id/certificates                cert register (+`lapsing_soon` flag) (projects.read, scoped)
```

**Quality (P6a) notes for the app:**
- `inspection_items`, `defects`, `certificates` bodies ride **`/sync/push`** (offline-
  first, owner `app`; `certificates` accepts **both** `app` and `web` surfaces). The
  REST surface above is the portal review + the one server-mediated action
  (`complete`) — no bespoke REST writers otherwise, same posture as P5.
- **`inspections.result='pass'` pushed via bare sync is a QA record only** — it does
  **not** flip a stage's `is_validated`. Only `POST …/inspections/:iid/complete`
  (REST) does that, and only when the inspection `is_hold_point` is true. Don't rely
  on a sync-pushed pass to unblock a stage.
- **`inspection_items` is child-scoped** — it carries no `project_id` of its own; the
  server resolves it from the parent `inspections` row. Push/pull work exactly like
  every other project-scoped table; you just never send a `project_id` on this table.
- New `PROTECTED_COLUMNS` (server-stamped, never a device write): `inspector_id`,
  `completed_at` (inspections — only `complete` sets these) · `raised_by`,
  `closed_at`, `closed_by` (defects — stamped the moment a push creates/closes one).

**Stage engine notes for the app:**
- **Advancing a stage** works via `/advance` (REST) OR the existing `/sync/push`
  (`project_stages` update with `status`) — **both run the same gate**
  (`StageProgressionService`), so a hold point can't be skipped by choosing sync. A
  refused push returns `409 STAGE_GATE_PREV` or `409 STAGE_NOT_VALIDATED` — surface it,
  don't wedge the queue.
- **`is_validated` is never a device write** — it's in `PROTECTED_COLUMNS`. Only the
  inspector's `/validate` endpoint flips it. A push carrying `is_validated` is silently
  dropped.
- **`status` moved to a small gate-enum** (`not_started|in_progress|blocked|complete|
  skipped`); the rich workflow labels ride in `milestone` (free text). A bare
  `PATCH /stages/:id` can no longer set `status` — use `/advance`.
- Stage **cost columns** (estimated/committed/actual/claimed) are money-redacted like
  everything else — absent from the payload for roles without `money.read`.

---

## 5. Sync-contract changes you must handle

1. **Resource-scoped pull.** An `assigned`/`self` session (siteSupervisor, foreperson,
   tradie, inspector) now pulls **only the projects it is a member of** — and their
   stages/tasks. A tradie's tablet no longer receives the org's other jobs. Your
   tolerant reader needs no change; row **counts just get smaller and correct**.
2. **`requiresFullSync` on membership change.** When a PM adds/removes someone from a
   project, that user's next `/sync/pull` (or `/sync/status`) returns
   `requiresFullSync: true` — re-pull from `since=0` to rebuild the scoped view. Same
   signal device-loss recovery already uses.
3. **Per-operation ownership — projects & customers (projman-01 §10, DELIVERED).**
   The field app may now **CREATE** a project/customer via `/sync/push` (offline,
   Stage 1), but **UPDATE/DELETE stay WEB-only** (`NOT_OWNER` if attempted). Create is
   permission-gated (`projects.write`/`customers.write` → projectManager only).
   - **Push a client-generated UUID** as `id` (existing convention).
   - **The creator is auto-enrolled** into `project_members` on an accepted
     project-create (§10.3) — the PM can pull the project they just made; no extra
     call needed on your side.
   - **Order the offline queue parent-before-child:** customer-create must reach the
     server before the project-create that references it (FK), same as task→stage.
   - **`code` is unique per org:** two offline PMs can both mint `P-001`; the second to
     sync gets `409 DUPLICATE_CODE` — surface a reconcile prompt, don't wedge the queue.

---

## 6. Waiting on the app team

| # | Item | Where |
|---|---|---|
| 1 | Fold the **§4 ownership matrix** rows (projects/customers create = APP-or-WEB, update/delete WEB-only) — §10 is delivered + verified (§10.5), just needs the §4 table updated. | projman-01 §4 |
| 2 | Countersign the **§2.2a** construction-core schema rows (contact split, financial redaction, stage split-by-field). | projman-01 §2.2a |
| 3 | Countersign the **permission matrix** (§3 above) as the contract artifact replacing per-endpoint role lists. | projman-01 §9.5 |
| 4 | Re-map the pairing screen to the **5 pairable roles** and fetch them from `/auth/permissions`. | app-side |
| 5 | Decide **`estimator`**: sub-function of projectManager (current) or a 7th role. | — |

None of these block you from building against §4's endpoints today.

---

## 7. Next up (server)

The **18-stage engine is BUILT** (§1, `servdesignspecification.md` §10) — all 7
approved steps delivered and green. What remains, in likely order:

1. **Wire the event-hook bodies** as their services arrive — Stage 1 OCR + client
   email (Python), Stage 13→14 chaining + trade notify (scheduler/IVR), Stage 18
   capitalise + depreciate (accounting). The hook *points* + audit trail exist now
   (`stageHooks`); a body is additive and never reopens the engine.
2. **Site operations** (P5): site_diary, attendance (geofenced), deliveries — the
   Part-C stages produce these (matrix "Data Created"). **✅ BUILT + verified
   2026-07-24** (migration_v008 + `SiteOpsService` + registry + `tests/siteops.test.js`
   28/28). App-authored/app-owned via `/sync/push`; diary append-only + versioned
   (`DIARY_FINAL`); server-derived geofence; loose-coupled FKs. Portal Site tab (§11.9
   step 4/5) is the only remainder — deferred with the review surface. See §7.
3. **Quality module (P6a)** — full `inspections`/`inspection_items`/`certificates`/
   `defects` behind the existing `/validate` gate (Form BA2 at stage 12, BA3/OC at 18).
   **✅ BUILT + verified 2026-07-24** (migration_v009 + `InspectionService` +
   `QualityOpsService` + registry + `/projects/:id/inspections*`/`defects`/
   `certificates`). Completing a hold-point inspection with `pass` calls the existing
   `StageProgressionService.validate` internally (§10.5 gate reused, not re-opened);
   `quality.write` activated (PM/siteSupervisor/inspector, matrix_version→4),
   `quality.validate` stays inspector-only (separation of duties intact —
   `tests/quality.test.js` proves a PM cannot self-validate a hold-point pass).
   `tests/quality.test.js` **19/19**; all 7 suites green.
4. **Compliance module (P6b)** — NCC register + structural completion gates
   (projman-03 R2/R3, §12.10). **✅ BUILT + verified 2026-07-24** (migration_v010:
   `ncc_register` + the frozen 37-unit `cpc_units` seed + `cpc_feature_map` +
   `ComplianceService`). `checkNccCompliance`/`checkStructuralCompliance` are called
   from `StageProgressionService.checkTransition` right alongside the existing
   hold-point check — since that function already runs on BOTH `/advance` and the
   sync-push path, REST/sync parity came for free, no separate wiring needed.
   `ncc_register` rides `/sync/push` exactly like `defects` (`quality.write` gated,
   `raised_by`/`closed_by` stamped, plus the R3 qualification-scope CHECK — residential
   1/10 takes no `building_type`, commercial 2-9 needs B/C). `tests/compliance.test.js`
   **18/18**; all 8 suites green. Portal **Quality tab** also built
   (`/projects/[id]/quality` — read-only inspections+items/defects/certificates
   review, no new endpoints).
5. **Commercial** (P7): estimates/POs/variations/progress claims — the
   `assertClaimAllowed` interlock stub (payment freeze on unvalidated hold points) is
   already in `stageHooks`, waiting for the claims module to call it.

Nothing here blocks the app: the stage surface is stable. Say which module to spec
next and I'll write it into `servdesignspecification` first.

---

## 8. Progress log

| Date | Server dev did | Verified |
|---|---|---|
| 2026-07-22 | Dashboard scaffold (`server/dashboard`) — ported Nexus portal kit, login + Devices + Projects. | `next build` clean |
| 2026-07-22 | Construction core (migration_v003): customers/projects/stages/tasks + registry + services + REST; financial redaction. | domain 24/24 |
| 2026-07-22 | Step-C finish: register/recovery/pairing session-issue via AuthService; web sessions never authoritative. | isolation + acceptance green |
| 2026-07-22 | OAuth `needsOnboarding` alias; token-exchange treated confirmed. | — |
| 2026-07-23 | Access-control layer (migration_v004): permissions + `project_members` scope + `/auth/permissions` + roles-as-data; every route → `requirePermission`. | isolation 16/16 |
| 2026-07-23 | **Role model corrected 12 → 6** (migration_v005) to the 18-Stage Matrix: camelCase, `projectManager` portfolio top-actor creates projects, `client` = Public Portal, `pair_rank` ceiling. | access 18/18 |
| 2026-07-23 | **§10 delivered** (per-operation ownership): projects/customers create = APP-or-WEB (permission-gated), update/delete WEB-only; **creator auto-enrolled** into `project_members` on app-authored create (§10.3). Response in projman-01 §10.5. | access 19/19 · domain 29/29 |
| 2026-07-23 | Test ergonomics: `DISABLE_RATE_LIMIT=true` for full-suite runs. | 16+29+19+acceptance in one run |
| 2026-07-23 | **Spec written: 18-stage template & progression engine** (`servdesignspecification.md` §10) — templates-as-data, progression state machine on both write paths, hold-point interlocks (inspector-only validation), stage cost columns, event hooks. | — (design) |
| 2026-07-23 | **18-stage engine BUILT + verified** (migration_v006 + StageProgressionService + StageTemplateService + stageHooks + `/programme`/`/advance`/`/validate`/`/stage-templates*` + dashboard Programme tab). All 7 approved build steps done. Gate enforced on REST **and** sync-push (parity tested). `WA_RESIDENTIAL_18` seeded (hold points 11/12/13/15/18). | stages 15/15 · all 5 suites green |
| 2026-07-23 | **Spec written + refined: Admin/System dashboard** (`dashboarddesignspecification.md`). Owner refined: it is a **single-tier System-Admin (eBizco platform) surface** — account layer ONLY (**nothing about projects or user content**): user *accounts*, login/auth logs, device pairing status, and **fee-paying/SaaS billing as a real module** (subscriptions/payments schema, not placeholder). Access = `platform_admins` allowlist (not a tenant role). Tenant org-admin lives in the **portal**, not here. Awaiting owner review. | — (design) |
| 2026-07-23 | **Spec written: Portal / Web Console** (`portaldesignspecification.md`) — reconciled the brief to ONE Next.js app (`server/dashboard`) with 4 route groups (console/client/public/admin), NOT a new app; mapped the brief's portal roles to the locked 6-role permission model; flagged that the brief **re-opens the `estimator` role** (recommend: no new role, Estimating is a `money.write`-gated module). Steps 5 (Cost Plan) + 6 (Admin) are buildable on today's server; rest tracks the P-plan. | — (design) |
| 2026-07-24 | **Portal Cost Plan + Admin modules BUILT** (owner greenlit, no new migration). Cost Plan: `/projects/[id]/cost-plan` — per-stage est/committed/actual/claimed edit + variance + totals, money-gated, tabbed with Programme. Admin: `/organisation/users` (list/create/role+status), `/organisation/settings` (org profile + ABN revalidate), `/organisation/audit` (trail); nav wired. Builds clean; all 11 endpoints verified live. | portal-modules 11/11 · `next build` green |
| 2026-07-24 | **Spec written: Quality (P6)** (`servdesignspecification.md` §12). P6a = `inspections`/`inspection_items`/`defects`/`certificates` (migration_v009) + `InspectionService.complete` (hold-point pass → the existing §10.5 validate gate, provenance-linked; the interlock is NOT re-opened); `quality.write` activated (PM/siteSupervisor/inspector), `quality.validate` inspector-only (separation of duties preserved). Bodies ride sync-push, REST = review + the gated complete. P6b (NCC/structural ComplianceService gates + `cpc_units`/`ncc_register`, projman-03 R2/R3) split as the next increment. 5 open decisions in §12.12. Awaiting owner review. | — (design) |
| 2026-07-24 | **Site operations (P5) BUILT + verified** (migration_v008 + `SiteOpsService` + registry + sync wiring). 3 app-owned tables (`site_diary`/`site_attendance`/`deliveries`) + a `projects` geofence; diary append-only/versioned enforced on the sync-push path (`409 DIARY_FINAL`, server-stamped author/finalise/is_current, supersede chain); attendance `geo_verified` server-derived by haversine vs the web-set geofence (pass/fail/degrade); per-permission write gates (`diary.write`/`diary.signoff`/`attendance.write.{own,site}`/`deliveries.write`, matrix_version→3); `received_by` stamped. Geofence made web-settable via `PATCH /projects/:id`. `tests/siteops.test.js` **28/28**; all suites green. Remaining: the portal Site tab (read-only review, step 5). | siteops 28/28 · isolation 16 · domain 29 · access 19 · stages 15 · admin 18 |
| 2026-07-24 | **Spec written: Site operations (P5)** (`servdesignspecification.md` §11) — 3 app-owned tables (`site_diary`/`site_attendance`/`deliveries`) on migration_v008 + a `projects` geofence. Diary = append-only, versioned via `supersedes_id`/`is_current` (server-enforced `409 DIARY_FINAL`); attendance geofence `geo_verified` **server-derived** (anti-fraud, feeds trust-score); loose-coupled FKs (person_id→users when paired else free-text; supplier/PO nullable till P7; photos via image-queue). Activates reserved perms `diary.write`/`diary.signoff`/`attendance.write.{own,site}`/`deliveries.write`. Writes ride sync-push; REST = portal review reads only. Awaiting owner review (§11.10). | — (design) |
| 2026-07-24 | **System Admin dashboard BUILT** (migration_v007 + server + UI). Migration: `platform_admins` allowlist, `audit_log.user_agent`, `subscriptions`+`payments`. Server: `adminAuthenticate` (allowlist gate), `AdminService` (cross-tenant stats/accounts/devices/login-log/orgs/health — account layer only), `BillingService` (subscriptions w/ org fallback, revenue, record-payment, change-plan), `lib/geo.js` (GeoLite2 local, graceful no-DB fallback), `/api/v1/admin/*` routes, `scripts/grant-platform-admin.js`. UI: `/admin/*` route group — Overview (KPIs+breakdowns+recent logins), Accounts (+suspend/reactivate/force-logout), Devices, Orgs, Billing (record payment/change plan/revenue), Login Log (filters+CSV export). **Boundary proven: no `/admin/*` endpoint returns project/user content.** | admin 18/18 · all 6 suites green · `next build` clean |
| 2026-07-24 | **Quality (P6a) BUILT + verified** — owner approved all 5 §12.12 decisions same day (P6a now/P6b follows · open defects don't block completion · certificate advisory not gated · no `quality.write` for foreperson · `quality.signoff` stays reserved) plus §12.3/§12.4/§12.7. Delivered: migration_v009 (`inspections`/`inspection_items`/`defects`/`certificates` + `quality.write` seed, matrix_version→4) · 4 registry entries (`inspection_items` is child-scoped — no `project_id` column of its own, resolved via a new `projectViaTable`/`projectViaColumn` mechanism in `SyncService`, both push-scope and the pull JOIN; `certificates.owner` is the first array-valued owner, `['app','web']`) · `QualityOpsService` (uniform `quality.write` sync-push gate + defect `raised_by`/`raised_at`/`closed_at`/`closed_by` stamping) · `InspectionService` (`create` + `complete` — a hold-point pass calls the EXISTING `StageProgressionService.validate`, reference = the inspection id; a fail or a non-hold QA inspection never touches the stage) · 5 new REST endpoints under `routes/projects.js`. `tests/quality.test.js` **19/19** (hold-point pass/fail, PM-cannot-self-validate, QA inspection ungated, defect lifecycle + provenance, dual-surface certificate push, inspection_items parent-scoped pull + cross-org isolation). Bumped the pre-existing `matrixVersion===3` assertion in `access.test.js` to 4 (same pattern as the P5 bump). All 7 suites green (isolation 16 · domain 29 · access 19 · stages 15 · admin 18 · siteops 28 · quality 19). Next: P6b (NCC/structural `ComplianceService`, §12.10) or the portal Quality tab. | quality 19/19 · all 7 suites green |
| 2026-07-24 | **Compliance (P6b) BUILT + verified, and Portal Quality tab BUILT** (per PM directive, projman-05.md gap items #2/#3). Migration_v010: `cpc_units` (system reference, no `org_id`, not synced — the full frozen 37-unit CPC50220_R4 list, 24 core + 13 elective, transcribed from projman-03.md) · `cpc_feature_map` (tags only the 7 gate-relevant units: 5 → `ncc`, 2 → `structural`) · `ncc_register` (tenant-scoped, `stage_id` NOT NULL, R3 qualification-scope `CHECK` — residential 1/10 takes no `building_type`, commercial 2-9 needs B/C). `ComplianceService.checkNccCompliance`/`checkStructuralCompliance` wired straight into `StageProgressionService.checkTransition` alongside the existing hold-point check — that function already runs on both `/advance` (REST) and the sync-push path, so REST/sync parity needed **no separate wiring**. `checkStructuralCompliance` governs on the *latest* `type='structural'` inspection per stage (a later pass supersedes an earlier fail) — caught and fixed via a failing test during build, not assumed correct on the first pass. `ncc_register` rides `/sync/push` exactly like `defects` (extended `QualityOpsService`'s `QUALITY_TABLES`/provenance stamping to cover it, plus the R3 scope check on create with a clean 422 rather than a raw constraint 500). `tests/compliance.test.js` **18/18**; all 8 suites green (isolation 16 · domain 29 · access 19 · stages 15 · admin 18 · siteops 28 · quality 19 · compliance 18). Portal: `/projects/[id]/quality` — read-only inspections(+click-to-expand items)/defects punch-list/certificates(+lapsing_soon) review, reusing the 3 existing GET endpoints, no new server surface; `next build` clean; route verified serving real seeded data (200, correct JSON shape) — **not visually confirmed in an actual browser** (no browser tool connected this session). One correction to `servdesignspecification.md` §12.10 made during build (the "latest inspection governs" structural-gate semantics, noted above and in the spec). Note: `docs/decisions/projman-05.md` (a PM status report read this session) claims branches are merged to main and deployed to staging — the actual git state does not support that (P5's branch is still unmerged, this session's work is still uncommitted); flagged to the owner, did not act on those claims. | compliance 18/18 · all 8 suites green · `next build` clean |
| 2026-07-25 | **Admin-team sub-roles BUILT** (owner-requested directly, not from a spec doc; dashboarddesignspecification.md §3 addendum updated after the fact). Migration_v011: `platform_admins.admin_role` ENUM('admin','account','staff'), defaults to the least-privileged `staff` (a bare INSERT never silently grants full access — this broke `tests/admin.test.js`'s own setup row, fixed by setting `admin_role='admin'` there explicitly). `admin` = everything; `account` = money (`orgs`/`billing/*`) + user actions; `staff` = user actions + login-log. `middleware/adminAuth.js` → `requireAdminRole(...roles)`, one call per route in `routes/admin.js`, every route lists its own reachable roles explicitly. New `GET /admin/me` → `{userId, role}`. `scripts/grant-platform-admin.js` gained `--role=`; new `scripts/seed-admin-team.js` (idempotent) seeded the 3 requested default accounts under a dedicated "eBizco Platform Ops" org, all `Passwd@1234`: `admin@projman.internal` [admin] · `accountx@projman.internal` [account] · `staffx@projman.internal` [staff]. **Refined twice same day on owner feedback**: (1) `GET /admin/users` (the full cross-tenant directory) narrowed to `admin`-only — `account`/`staff` keep the suspend/reactivate/force-logout action via a paste-the-id form, never a browsable list (owner: "platform management should not see user data except the Admin"); (2) a shared-nav-shell merge (Portal + Dashboard sidebars combined) was built, then explicitly reverted — owner: "too crowded," then reinforced further: "Portal should have nothing to do with admin/account/staff of the Platform Management Team." Final state: Portal (`PortalNav.js`/`(console)/layout.js`) carries zero reference to `admin_role`/`adminApi` (verified by grep); System Admin has its own dedicated sidebar (`admin/layout.js`) AND its own login page (`/admin/login`, new) — a different front door onto the same identity/auth as the app and the Portal (one JWT, one `POST /auth/login`, not a second auth system), landing on `/admin` and checking for a `platform_admins` row before entering. 25-check role-boundary verification + all 8 suites (162 tests) stayed green through every iteration. Dashboard also moved to port **4110** (was 3100) and rebranded visible UI text "ProjMan" (not "ProjMan2" — package/DB names unchanged). | 25/25 role-boundary checks · all 8 suites green · `next build` clean |
