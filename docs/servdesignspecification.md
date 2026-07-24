# ProjMan2 — Server & Web Design Specification (for review)

**Status:** 🟠 DRAFT for review — not yet built beyond Phase 1 identity
**Date:** 2026-07-22
**Author:** Server dev (NexusPM)
**Reviewer:** owner (eBizco)
**Companion docs:** `docs/development.md` (domain framework of record) ·
`docs/decisions/projman-01.md` (the live app↔server contract, Phase 1)

> This is a **guideline for review before building**, per the "specify, then build"
> rule. It sets the server architecture, a brief functional map of what each part
> does, and — the question you asked — **exactly what can be ported from Nexus's
> `portal`/`dashboard` and what must be dropped**. Nothing here is built yet except
> Phase 1 identity (already delivered). Approve or redline, then I build to it.

---

## 1. Scope

What this spec covers:
- The **server** (`server/api`) beyond Phase-1 identity: the service layer, and how
  the domain modules (P3–P9) attach to it.
- The **two web surfaces** the server feeds — the **office dashboard** and the
  **public portal** — and what of Nexus's Next.js `dashboard` we reuse to build them.

What it does **not** cover (owned elsewhere):
- The Flutter field app UI (app team) · the domain data model in detail
  (`development.md` §5) · the Phase-1 wire contract (`projman-01.md`).

---

## 2. System context — one server, three surfaces

Per the architecture you shared, one Express service serves three clients, all behind
the same JWT + `org_id` isolation:

```
   ┌── App (Flutter) ──────────┐   ┌── Dashboard (Next.js) ───┐   ┌── Public portal (Next.js) ─┐
   │ site + office, on-device  │   │ office console            │   │ customer read-only view    │
   │ capture-first, offline    │   │ org_admin / developer / PM│   │ their project only         │
   │ session WITH device_id    │   │ session, no device_id     │   │ session, `customer` role   │
   └─────────────┬─────────────┘   └────────────┬─────────────┘   └─────────────┬──────────────┘
                 │                                │                               │
                 └────────────────────────────────┴───────────────────────────────┘
                                             │  HTTPS /api/v1
                                 ┌───────────▼────────────┐
                                 │  ProjMan2 API (server) │  MySQL c1projman2 (AU region)
                                 └────────────────────────┘
```

Surface rules (already in `projman-01.md` §1.9): the server derives the surface from
the token (device present → **app**; else **web**), enforces `org_id` on every query,
and refuses writes from the `customer` role. The **public portal is read-only** — it
never becomes a sync writer, so it needs no new ownership rule.

---

## 3. Server architecture (layered)

Matching your diagram, four layers. The gateway + middleware + data layers exist today
(Phase 1); the **service layer** is the new structure this spec introduces so P3–P9
domain work has one home instead of growing fat route handlers (the mistake that made
Nexus's `sync.js` 3,281 lines).

| Layer | Today (Phase 1) | This spec adds |
|---|---|---|
| **Gateway** (`routes/`) | auth, oauth, recovery, pairing, devices, sync, organisation | thin domain routers: projects, site, safety, quality, commercial, accounting |
| **Middleware** | `authenticate`, `requireRole`, rate-limit, audit | `requireFinancial` widened; a `loadProject` scope guard for project-bound routes |
| **Service** (`services/`) | *(logic currently sits in routes + `lib/`)* | `AuthService`, `SyncService`, `ProjectService`, `FinanceService`, `ComplianceService` — the business rules, callable by any route |
| **Data** (`db/`, `sync/registry.js`) | pool, migration runner, sync registry | one registry entry + migration per domain table; **no new push/pull handler** |

**Why a service layer.** The compliance rules that must be **server-enforced, never
client-only** — an open hold point blocks its stage (`development.md` §5.6), the
invoice gate (§5.8), and the CPC50220 additions (NCC register + structural hold points
blocking completion) — belong in `ComplianceService`, called from both the sync push
path and the dashboard write path, so the rule holds no matter which surface writes.
Routes stay thin; the rule lives once.

**Guideline: adding a domain module (the repeatable shape).**
1. Migration `vNNN_<module>.sql` — tables carry the five sync columns (`org_id`,
   `device_id`, `is_deleted`, `updated_at`, `server_updated_at`).
2. One entry per table in `sync/registry.js` (`table, columns, owner, pull, scope`).
3. A `services/<Module>Service.js` for rules that aren't plain CRUD.
4. A thin `routes/<module>.js` for dashboard/portal reads the app doesn't sync.
5. A row per table in `projman-01.md` §2.2 + the ownership matrix §4, **before** the
   app builds against it.

---

## 4. Functional guideline (brief) — server modules by phase

Each line: what the module owns, its non-obvious server rule, and its P-plan slot.
Detail lives in `development.md` §5; this is the server's view of it.

| Module | Owns (server) | Server-enforced rule | Phase |
|---|---|---|---|
| **Identity** ✅ | orgs, users, devices, sessions, auth_identities, sms | `org_id` isolation; single-writer handoff; role on device binding | P2 (done) |
| **Projects** | customers, projects, stages, tasks, stage templates | stage order from template; task nesting via `parent_id` | P4 |
| **Site ops** | site_diary, attendance, deliveries | diary is the legal record — append-only, edits versioned | P5 |
| **Safety** | toolbox, inductions, hazards, incidents, + **Environmental** (CPC gap) | `incidents.notifiable` flagged at entry; EMP checklists | P6 |
| **Quality** | inspections, defects, certificates, + **NCC compliance register** & **structural** (CPC gaps) | **open hold point / unmet NCC / structural check BLOCKS stage completion** | P6 |
| **Commercial** | estimates, quotes (in/out), POs, supplier invoices, variations, progress claims, + **Consultant register** (CPC gap) | **invoice gate**: invoice against an unvalidated stage → payment frozen | P7 |
| **Accounting** | chart of accounts, journals, payments, bank rec, fixed assets | double-entry integrity; TPAR flag (sub vs supplier) at record time | P8 |
| **AU tax** | GST/BAS, **TPAR**, PAYG withholding, super, DV depreciation | prepare-and-record only; never lodges to ATO | P9 |

CPC50220 gaps (NCC register, environmental, site services, service coordination,
consultant management, plan viewer, structural) fold into the modules above per the
memory note; the compliance-blocking ones are `ComplianceService` rules.

---

## 5. What we port from Nexus `dashboard` / `portal`  ← your question

Two source trees, assessed concretely from the code:

### 5.1 Server (`~/Documents/Dev/nexus/api`)
Already done for identity (see `projman-01.md`). For P3–P9 the **patterns** port — the
sync registry, the `org_id`-scoped query shape, the migration runner — not the VN/POS
route bodies. Verdict: **pattern-port, not copy-port.**

### 5.2 Web UI kit (`nexus/dashboard/src/app/portal/_components` + `lib`)
This is the high-value reuse — domain-agnostic and proven.

| Nexus asset | Verdict | Notes |
|---|---|---|
| `_components/PortalTable`, `PortalKpi`, `PortalCard`, `PortalFilter`, `PortalPagination`, `PortalEmpty`, `PortalError` | ✅ **PORT** | Generic UI kit. Lift near-verbatim; swap CSS vars for the ProjMan2 palette. |
| `_components/usePortalData`, `PeriodContext` | ✅ **PORT** | Generic fetch hook + period selector. Only VN error strings to translate. |
| `_components/PortalNav` (695 ln) | ⚠️ **ADAPT** | Keep the shell — collapsible sidebar, responsive font tiers, **accessibility font-floors for 60+/low-vision** (excellent fit for older builders on site). Re-label nav items; drop the Observe/Audit switcher unless we want it. |
| `lib/api.js`, `lib/portalApi.js` | ⚠️ **ADAPT** | Fetch wrapper w/ token + axios-shape response + session-expiry redirect — port the transport; change BASE to ProjMan2, token keys, `/api/v1`. |
| `lib/MqttContext.js`, `useMqtt.js` | ❌ **DROP** | ProjMan2 has no broker — polling (as in Phase 1). |
| Next.js shell (`next.config`, `tailwind.config`, app-router layout) | ✅ **PORT** | Same stack (Next 14 + Tailwind + recharts). Reuse the scaffolding. |

### 5.3 Web pages (`nexus/dashboard/src/app/portal/*`)
Structure reusable, content VN/POS-specific — **adapt, don't copy**.

| Nexus portal page | Maps to ProjMan2 | Verdict |
|---|---|---|
| `thiet-bi` (devices + sync) | Dashboard → Devices | ✅ **PORT** — closest 1:1; wires straight to my `/devices` + `/sync/status` |
| `danh-ba` (contacts: customer/supplier) | Customers / subcontractors / suppliers | ⚠️ **ADAPT** — same "people by type" CRUD, re-labelled |
| `ke-toan` (ledger, expenses, bank, GL, export) | Accounting | ⚠️ **ADAPT** — page structure ports; VN tax → AU GST/BAS/TPAR |
| `tai-chinh` (payroll, tax) | AU payroll (PAYG/super) | ⚠️ **ADAPT** |
| `cai-dat` (settings) | Org settings | ⚠️ **ADAPT** — drop Xero unless wanted |
| `dashboard` (KPIs, reports) | Project dashboard | ⚠️ **ADAPT** — re-point KPIs to project/cost data |
| `hang-hoa` (goods/menu/cook-history) | Materials catalogue (partial) | ⚠️ **PARTIAL** — `item_master`→materials keeps; menu/cook/POS drops |
| `login` (CCCD+PIN+QR) | Dashboard login (email/OAuth) | ❌ **REWRITE** — different auth; reuse only layout/styling |
| `nexus/dashboard/src/app/admin/*` (FTPOS internal ops) | — | ❌ **DROP** — that's FTPOS platform ops, not a ProjMan2 tenant surface |
| `sentinel/*` (inspection/scan) | Quality inspections | ⏸ **EVALUATE** — `development.md` §8 already flags this; assess before reuse |

### 5.4 Public portal (the customer view)
Nexus has **no** direct equivalent — its `portal` is an operator console, not a
client-facing read-only view. So the public portal is **new UI on ported infra**: the
same `_components` kit + API client, a stripped read-only layout, feeding on
customer-scoped read endpoints (progress %, photo gallery, document download,
variation approve/decline). Server side it is a handful of read endpoints + one write
(variation decision) gated to the `customer` role. Build target: **P10**, plan in P8.

---

## 6. Data residency & compliance (AU)

- **Residency:** deploy MySQL `c1projman2` + this service to **AWS Sydney
  `ap-southeast-2`** (or Azure Australia East). Code is region-agnostic; **all PII at
  rest stays in `c1projman2`**. Only outbound calls: OAuth token verification
  (Google/MS/FB) and ABR ABN lookup (AU gov) — neither stores PII externally. A
  `/health` region tag gets added once the target is set, so the residency claim is
  auditable.
- **Privacy Act:** PII columns are known and enumerable (users, auth_identities,
  organisations); `audit_log` records access to identity ops from day one. Retention +
  deletion policy is a P-plan item, not code today — flagged so it's designed in, not
  retrofitted.

---

## 7. Proposed build order (server + web)

| Step | Deliverable | Depends on |
|---|---|---|
| **A** | Confirm §8 answers (OAuth shape, SMS scope) from `projman-01.md` | you |
| **B** | Scaffold the ProjMan2 dashboard: port `_components` + API client + Next shell; wire **Devices** page to `/devices` (proves the port end to end) | A |
| **C** | Extract the **service layer** (`AuthService`, `SyncService`) from current routes — no behaviour change, just structure | — |
| **D** | P4 **Projects** module: migration + registry + `ProjectService` + dashboard CRUD | schema v1 sign-off |
| **E** | P5–P9 modules in `development.md` order, each following the §3 shape | D |
| **F** | Public portal (P10) on the ported infra | D–E domain reads |

Steps B and C are safe to start now (no domain-schema dependency); D waits on your
schema v1 sign-off.

---

## 8. Open decisions for your review

1. **Service-layer refactor now or later?** I recommend **now** (step C) while the
   codebase is small — extracting it after P7 is far more disruptive.
2. **Dashboard = port Nexus `portal` styling, or fresh design?** I recommend porting
   the `_components` kit (proven, accessible) with a ProjMan2 palette — fastest path to
   a working console. A fresh visual design is a bigger spend; your call.
3. **Public portal in P10, or pulled earlier?** Clients asking "can I see progress?"
   is a sales surface; earlier has product value but competes with domain build.
4. **Xero / accounting integration** — Nexus has a Xero stub (`cai-dat/xero`). In or
   out for ProjMan2? Affects the accounting module's export design (P8).
5. **Internal ProjMan2 admin console?** Nexus's `admin/` (platform ops: subscribers,
   billing) has no ProjMan2 equivalent yet. Needed for a real SaaS (onboarding,
   billing, support) — plan it, or defer?

---

**Review ask:** approve §3 (architecture) + §5 (porting plan) + §7 (build order), and
answer §8. Then I start with steps B/C, which unblock the dashboard without waiting on
the domain schema.

---

## 9. Access control — permissions, scope, and roles-as-data  ✅ BUILT

> **⚠️ Superseded in one respect — 2026-07-23.** The mechanism below (permissions as
> the enforcement unit · `project_members` resource scope · roles-as-data · financial
> redaction · `GET /auth/permissions`) is **built and verified**. But the **role LIST
> and matrix in §9.3/§9.5 below describe the retired 12-role model.** The authoritative
> role model is now the **6-role** set from `18StageProjectMangementMatrix.md`
> (`projectManager`/`siteSupervisor`/`foreperson`/`tradie`/`inspector`/`client`,
> camelCase, projectManager = portfolio). The **live matrix is `projman-04.md` §3**;
> read that, not the tables here. This section is kept for the mechanism design; its
> role tables are historical. Delivered as migration_v004 (mechanism) + migration_v005
> (6-role correction).

**Status: ✅ BUILT — approved 2026-07-22, corrected to 6 roles 2026-07-23.**
This section is the design behind `development.md` §13.2 enforcement point #2
("Role RBAC"). It replaced the Phase-1 mechanism (`requireRole` lists +
`FINANCIAL_ROLES`), now deleted.

### 9.1 The flaw being fixed

Three defects, all currently live:

1. **Role is the enforcement unit.** Every guarded route hard-codes a role list
   (`requireRole('org_admin','project_developer')`). At 6 roles this was tolerable;
   at 12 (§3) every new role or capability change means auditing every guard in the
   codebase — including the two new v003 route files, which added more lists the day
   the flaw was flagged. This is how permission drift and privilege escalation are
   born.
2. **No resource-level scoping.** The §3 matrix promises "PM runs *assigned*
   projects", "Tradie sees *own* tasks only", "Inspector is *project-scoped*" — but
   the only scoping primitive on the wire is `org_id`. Today any supervisor pulls
   and reads **every project in the org**. Role answers *what kinds of things you
   can do*; nothing answers *on which things*.
3. **Roles are baked into MySQL ENUMs** in three tables, plus `lib/roles.js`, plus
   validator lists, plus the app's pairing screen. The app already ships
   `inspector`, which the v001 enum 422s — the flaw demonstrating itself.

### 9.2 Design overview — three primitives

```
role (a row, not an enum)
  ├── scope_class          WHICH rows this role reaches   (resource dimension)
  └── permission set       WHAT it may do to them         (capability dimension)

enforcement = requirePermission(<capability>) + scopeFilter(<scope_class>)
```

- A **permission** is a dotted capability string (`projects.write`, `money.read`).
  Routes and services check permissions, never role names.
- A **scope class** says which slice of the org's rows the role reaches:
  `portfolio` (org-wide) · `assigned` (member projects only, via
  `project_members`) · `self` (own rows) · `engagement` (projman-02 slice) ·
  `portal` (own project, read-only).
- A **role** is a row in a `roles` reference table binding a label to a scope
  class + a permission set + assignability/pairability flags. Adding role #13 —
  or changing what a foreperson may do — is a data change. **Zero route edits.**

The app's `RoleVisibility` stays cosmetic (appspec Decision 2); it now mirrors the
server matrix by **fetching it** (`GET /auth/permissions`, §9.7) instead of
hard-coding a copy that drifts.

### 9.3 Permission catalogue — v1

Dotted `<domain>.<verb>[.<modifier>]`. v1 ships the rows needed by the surfaces
that exist (identity, devices, sync, construction core, dashboard); P5–P9 names
are **reserved now** so modules land as matrix rows, not new mechanisms.

| Permission | Meaning (v1 surface it guards) |
|---|---|
| `org.manage` | org profile, plan, settings (`PATCH /organisation`) |
| `users.manage` | create users, change roles/status |
| `devices.manage` | revoke, re-role, pairing initiate/confirm |
| `customers.read` / `customers.write` | customer list / CRUD |
| `projects.read` / `projects.write` | project list+detail / create+edit+status |
| `programme.write` | stage/task **structure**: seq, codes, names, templates |
| `progress.write` | stage status + actual dates, task completion — the site's pen |
| `money.read` | see `contract_value`, `budget_*` (replaces `FINANCIAL_ROLES`); drives sync + REST redaction |
| `money.write` | set budgets, contract values |
| *(reserved)* `diary.write`, `attendance.write.own`, `attendance.write.site`, `safety.write`, `quality.write`, `quality.signoff`, `claims.approve`, `variations.approve`, `engagement.manage`, `portal.view` | P5–P10 modules; named here so their guards are matrix rows on arrival |

### 9.4 Scope classes and their resolution

| Scope class | Reaches | Resolution |
|---|---|---|
| `portfolio` | every row in the org | filter by `org_id` only (today's behaviour) |
| `assigned` | member projects only | `org_id` **AND** `project_id IN (SELECT project_id FROM project_members WHERE user_id = actor)` |
| `self` | assigned scope ∩ own rows | assigned filter **AND** row-level `user_id`/`assigned_to = actor` on self tables (tasks, attendance) |
| `engagement` | the granted slice of ONE project | projman-02; refused until that record is BUILT |
| `portal` | own project, read-only | customer linkage; lands at P10 |

Applied at **three** places, or it is theatre:
1. **REST reads/writes** — a `scopeFilter(auth)` helper in the service layer
   returns the SQL fragment + params; every domain service query composes it.
2. **Sync pull** — registry entries gain `projectColumn` (`'project_id'`, or
   `'id'` on `projects` itself). Assigned/self-scope sessions pull only member
   projects' rows. A tradie's tablet no longer even *receives* the org's other
   jobs.
3. **Sync push** — `pushRecord` refuses a row whose `project_id` is outside the
   pusher's membership (assigned/self scopes). NOT_MEMBER, 403.

**Membership change vs the cursor (the trap):** rows older than a device's cursor
never re-pull, so granting membership would leave the device blind to the
project's history. Fix: membership grant/revoke sets `needs_full_resync = 1` on
the affected user's live sessions; the next `/sync/pull` or `/sync/status`
response carries `requiresFullSync: true` (same signal device-loss recovery
already uses) and the app re-pulls from `since=0`. Cheap, uses an existing client
behaviour, no server-side row touching.

### 9.5 The matrix — roles × permissions (the contract artifact)

Scope class + v1 permission set per §3 role. ✅ = has permission. This table is
the thing the app team signs off; it becomes seed data, and its version is served
with it.

| Role | Scope | org. manage | users. manage | devices. manage | customers r / w | projects r / w | programme. write | progress. write | money r / w |
|---|---|---|---|---|---|---|---|---|---|
| `org_admin` | portfolio | ✅ | ✅ | ✅ | ✅ / ✅ | ✅ / ✅ | ✅ | ✅ | ✅ / ✅ |
| `project_developer` | portfolio | — | — | ✅ | ✅ / ✅ | ✅ / ✅ | ✅ | ✅ | ✅ / ✅ |
| `project_manager` | assigned | — | — | ✅ | ✅ / — | ✅ / — | ✅ | ✅ | ✅ / — |
| `supervisor` | assigned | — | — | — | ✅ / — | ✅ / — | — | ✅ | — / — |
| `foreperson` | assigned | — | — | — | — / — | ✅ / — | — | ✅ | — / — |
| `tradie` | self | — | — | — | — / — | ✅ / — | — | ✅ *(own tasks)* | — / — |
| `inspector` | assigned | — | — | — | — / — | ✅ / — | — | — *(quality.* at P6)* | — / — |
| `customer` | portal | — | — | — | — | ✅ *(portal read)* | — | — | — / — |
| `construction_manager` ⚠post-v1 | portfolio | — | — | — | ✅ / — | ✅ / ✅ | ✅ | ✅ | — / — |
| `estimator` ⚠post-v1 | portfolio | — | — | — | ✅ / ✅ | ✅ / — | — | — | ✅ / ✅ |
| `subcontractor` ⚠post-v1 | engagement | — | — | — | — | ✅ *(slice)* | — | ✅ *(slice)* | — |
| `labourer` ⚠post-v1 | self | — | — | — | — | ✅ / — | — | ✅ *(own)* | — |

Notes: PM's `money.read`-not-`money.write` and project-scoped money is exactly §3
("sees project costs, not portfolio finance") — scope class does the portfolio
cut, the permission does the read/write cut. Reserved P5–P9 permissions get their
matrix column when their module lands, as a projman-01 amendment each time.

### 9.6 Schema — migration v004

```sql
roles             role VARCHAR(40) PK, label, scope_class ENUM('portfolio','assigned',
                  'self','engagement','portal'), surface ENUM('web','app','both','portal'),
                  is_assignable TINYINT, device_pairable TINYINT, sort INT,
                  is_system TINYINT DEFAULT 1
role_permissions  role FK→roles, permission VARCHAR(64), PK(role, permission)
project_members   id CHAR(36), org_id, project_id FK, user_id FK, added_by,
                  + the five sync columns  (owner: WEB, pull: yes — devices use it
                  for "who's on this job"; server uses it for scope)
users.role / devices.role / pairing_tokens.role
                  ENUM → VARCHAR(40) (+ FK to roles where cheap)  — roles become data
```

Seeded: the 12 §3 roles (8 with `is_assignable=1` in v1; the 5-role shortlist with
`device_pairable=1`; `customer` `is_assignable=1` but `device_pairable=0` —
**refused at `/pairing/initiate` and `/devices/:id/role` by data, not by code**).
Backfill: `project_members` rows created from existing `projects.pm_user_id`;
ProjectService keeps auto-membershipping the PM on create/reassign. Org-custom
roles are **out of v1** (`is_system=1` everywhere) but the shape supports them
later without migration.

### 9.7 Enforcement mechanics

- **`requirePermission(perm)` middleware** replaces `requireRole` route-by-route.
  Resolver: role → permission set from an in-process cache of `role_permissions`
  (load at boot; the table is seed data, so restart = reload; a `matrix_version`
  row lets the app cache-bust).
- **JWT unchanged** (§1.7 — `role` is a string claim, resolved to permissions
  server-side per request). No stale-token problem when the matrix changes; no
  wire change for the app.
- **`GET /auth/permissions`** (authenticated): `{ matrixVersion, role, scopeClass,
  permissions: [...], pairableRoles: [{role,label}...], assignableRoles: [...] }`.
  The app's `RoleVisibility` and the pairing screen render from this — the 5-role
  shortlist becomes server data, and the pairing screen stops hard-coding roles
  (which is how `inspector` slipped out ahead of the enum).
- **Financial redaction** keys off `money.read` (not `FINANCIAL_ROLES`), same
  strip points as today: sync pull + REST reads.
- **§13.2 gates 4–7** (hold points, claim gates, NCC, structural) attach later as
  the same shape — service-layer checks that compose with `scopeFilter` — via
  ComplianceService (projman-03 R2). This layer is deliberately their foundation.

### 9.8 What changes for existing code (migration path, no big-bang)

| Today | Becomes | Risk |
|---|---|---|
| `requireRole(...)` in 7 route files | `requirePermission(...)`; `requireRole` kept one release as sugar, then deleted | mechanical, per-route |
| `FINANCIAL_ROLES` in roles.js + SyncService + ProjectService | `money.read` matrix rows | one seed row per role |
| org-wide pull for everyone | scoped pull for assigned/self roles | **behaviour change the app must expect** — fewer rows + `requiresFullSync` on membership change (projman-01 §9.5 tells the app team) |
| v001 ENUMs | VARCHAR + `roles` table | additive migration; existing values unchanged, tokens stay valid |
| app pairing screen hard-codes 5 labels | renders `pairableRoles` from `/auth/permissions` | app change, theirs to schedule |

Isolation/acceptance/domain suites all re-run; `tests/domain.test.js` grows:
PM-assigned-scope sees only member projects · tradie pull excludes non-member
rows · push to non-member project refused (NOT_MEMBER) · `inspector` pairs ·
`customer` pairing refused · redaction driven by matrix.

### 9.9 Open decisions for the owner

1. **Strict assigned scope from day one?** My recommendation: **yes** — an
   assigned-scope user with no memberships sees no projects (correct, and the
   backfill + PM auto-membership means nobody real starts empty). Alternative: a
   transition flag that falls back to org-wide until the console ships membership
   management UI.
2. **Membership management surface, v1:** web console only (Users page + a
   project's team tab), per lifecycle step 7 being a Web action. PM-on-app
   membership editing can come with P5. Recommend: **web-only v1**.
3. **Inspector before projman-02:** in-house inspectors (C2, paired device) work
   now via `assigned` scope + `project_members`; external inspectors (C1) wait for
   engagements. Recommend: **ship C2 path now**.
4. **`GET /auth/permissions` in Phase-1 surface or with v004?** Recommend: with
   v004 — it is meaningless before the matrix exists.

**Review ask (§9):** approve 9.3 (catalogue), 9.5 (matrix — the app team must
countersign this table in projman-01), 9.6 (schema), and answer 9.9. Then the
build order is: migration v004 + seed → resolver + `requirePermission` →
`scopeFilter` in services + sync → `/auth/permissions` → route migration → tests.

---

## 10. The 18-stage template & progression engine  ✅ BUILT

**Status: ✅ BUILT + verified 2026-07-23 — approved same day, all §10.10 recommendations
locked (estimator = projectManager sub-function · status+milestone split · web-first
instantiation · inspector-only validation · cost columns now). Delivered as
migration_v006 + `StageProgressionService` + `StageTemplateService` + `stageHooks` +
the `/programme` `/advance` `/validate` `/stage-templates*` endpoints + the dashboard
Programme tab. `tests/stages.test.js` 15/15 (incl. sync-path parity + inspector-only
validation).** This is the server realization of
`18StageProjectMangementMatrix.md` (the workflow of record) and development.md §5.3
(stage templates) + §5.6 (quality) + §5.10 (cost model). It sits on the construction
core already built (migration_v003: `projects`/`project_stages`/`tasks`) and the
access layer (§9): every rule here is a service-layer guard invoked from **both** the
REST surface and the sync-push path, exactly like scope and redaction.

### 10.1 What it delivers

1. **Templates as data** — the 18-stage WA residential lifecycle ships as a *system*
   `stage_template` (`WA_RESIDENTIAL_18`), cloneable per org, not hardcoded schema.
2. **Programme instantiation** — a project's `project_stages` are stamped from a
   template (development.md §5.3; matrix Stage 9 "project_stages from
   WA_RESIDENTIAL_18").
3. **A progression state machine** — a stage advances only when its gate passes; the
   gate is enforced on every write path so the interlocks can't be bypassed by the
   sync client.
4. **Hold-point interlocks** — the CRITICAL HOLD POINTS table (matrix): a stage
   blocks the next until an **independent inspector** validates it.
5. **Stage cost tracking** — estimated / committed / actual / claimed per stage
   (matrix "each stage gets its … columns"; §5.10), money-redacted per §9.
6. **Event hooks** — the "algorithmic event-chaining" (Stage 13 → schedule Stage 14;
   Stage 18 → capitalise + depreciate) declared as hook points; their bodies (Python
   OCR/email, accounting) attach as those modules land.

### 10.2 Two layers — definition vs instance

```
stage_templates ─┐ (the LIBRARY: WA_RESIDENTIAL_18 + org clones)
                 │  one row per template
stage_template_items ─ 18 rows: seq, code, name, part, actor_role, hold-point, gate
                 │
   instantiate   ▼  (POST /projects/:id/programme — copies items → stages)
project_stages ─── the INSTANCE: one project's live programme (already exists, v003)
                    + progression status, is_validated, cost columns
```

The template is the reusable definition; `project_stages` is the running instance a
site actually advances. Editing a template never touches a project already
instantiated (matrix "builders clone and edit templates").

### 10.3 Schema — migration v006

**Extend `stage_template_items`** (development.md §5.3 columns + the matrix's actor &
gate):
```
stage_template_items  (existing: seq, stage_code, name, default_duration_days,
                       requires_inspection, requires_certificate)
  + part            ENUM('A','B','C','D','E')   the matrix's five lifecycle parts
  + actor_role      VARCHAR(40)  primary owner from the registry (projectManager,
                                 siteSupervisor, …) — informational; enforcement is
                                 by permission, not this label
  + is_hold_point   TINYINT      completion needs an inspector validation
  + gate_prev       TINYINT      cannot start until the previous stage is complete
                                 (+validated if that one is a hold point)
  + milestone_vocab JSON NULL    optional stage-specific status labels the app shows
                                 (e.g. WAITING_FOR_CUSTOMER_FEEDBACK, DA_PENDING_…)
```

**Extend `project_stages`** (on top of v003's id/org_id/project_id/seq/stage_code/
name/status/is_validated/start_date/end_date/budget_amount):
```
  + part            ENUM('A'..'E')
  + actor_role      VARCHAR(40)
  + template_item_id CHAR(36)     provenance: which template row this came from
  + is_hold_point   TINYINT
  + gate_prev       TINYINT
  + milestone       VARCHAR(64)   the current stage-specific label (display/workflow)
  + validated_by    CHAR(36)      users.id of the inspector who validated (server-set)
  + validated_at    DATETIME
  + estimated_amount DECIMAL(14,2) 𝗙   (budget_amount backfills into this)
  + committed_amount DECIMAL(14,2) 𝗙   POs raised against the stage
  + actual_amount    DECIMAL(14,2) 𝗙   costs booked
  + claimed_amount   DECIMAL(14,2) 𝗙   progress-claimed to the client
```
𝗙 = money-redacted on pull + REST for roles without `money.read` (§9). `budget_amount`
is kept and backfilled into `estimated_amount`; new code reads the four-column model.

**`status`** stays the generic gate enum — extend it from v003's
`pending|in_progress|complete|skipped` to `not_started|in_progress|blocked|complete|
skipped`. The rich, stage-specific states from the matrix
(`WAITING_FOR_CUSTOMER_FEEDBACK`, `DA_APPROVED`, …) live in `milestone` (free-text,
template-vocab-driven) so the engine gates on a small, closed enum while the app
still shows the exact workflow state.

**Seed** `WA_RESIDENTIAL_18` as one `is_system` template + 18 `stage_template_items`
transcribed from the matrix's SUMMARY table (parts A–E, primary owners, and the five
hold points at stages 11/12/13/15/18).

### 10.4 The progression engine (`StageProgressionService`)

One service, the projman-03 R2 "ComplianceService pattern", holding every rule that
gates a stage. Invoked from the REST advance endpoint **and** from `SyncService`
when a device pushes a `project_stages.status` change — so the interlock is identical
on both paths and a client cannot skip it.

`checkTransition({ orgId, actor, stage, toStatus })` throws a `ServiceError` unless:

1. **Permission + scope.** The actor holds `progress.write` and is a member of the
   stage's project (§9.4). Portfolio roles pass scope automatically.
2. **Sequential gate.** `toStatus='in_progress'` is refused while a `gate_prev` stage's
   predecessor is not `complete` (and `is_validated` if that predecessor is a hold
   point). → `STAGE_GATE_PREV`.
3. **Hold-point gate.** `toStatus='complete'` on an `is_hold_point` stage is refused
   until `is_validated = 1`. → `STAGE_NOT_VALIDATED`. This is the matrix's
   "milestone cannot advance until the independent Inspector uploads …".
4. **Validation is not a device write.** `is_validated`, `validated_by`, `validated_at`
   stay in the sync `PROTECTED_COLUMNS` — a tablet can move `status`, never flip its
   own hold point. Validation happens only via 10.5.

On an accepted transition the service records the change, stamps
`server_updated_at` (so it syncs), writes an `audit_log` row, and fires any
registered **event hooks** for that stage (10.6).

### 10.5 Validation — the inspector's gate

```
POST /projects/:id/stages/:stageId/validate   (quality.validate → inspector)
     { result: 'pass'|'fail', reference?, note?, document_id? }
```
- Guarded by `requirePermission('quality.validate')` + project scope. Only the
  `inspector` role holds it; `projectManager` deliberately does **not** — the matrix's
  "independent Inspector" is a separation of duties, and the engine enforces it.
- `pass` sets `is_validated=1`, `validated_by`, `validated_at`, and (when the
  inspections module lands, §5.6) links an `inspections`/`certificates` row
  (Form BA2 at stage 12, Form BA3/OC at stage 18). For v1 the gate + provenance land;
  the full inspection checklist is a later module behind the same endpoint.
- `fail` records the result and leaves the hold point closed, blocking completion.

### 10.6 Event hooks (declared now, bodies deferred)

The matrix's automation is real but depends on services not yet built (Python
OCR/email, accounting). Model each as a **named hook** the progression service fires
on a validated transition, with a no-op default:

| Trigger | Hook | Body lands with |
|---|---|---|
| Stage 1 create (already live) | `onProjectCreated` → OCR land docs, client receipt email | Python service |
| Stage 13 validated | `onStageValidated('frame')` → schedule Stage 14, notify trades | scheduler + IVR/notify |
| Stage 18 OC validated | `onProjectCompleted` → capitalise costs, depreciation, ATO | accounting module |
| any claim/invoice | `assertClaimAllowed(stage)` → block if a gating stage unvalidated | accounting module |

v1 ships the hook points + the audit trail; wiring a body is additive and never
reopens the engine. The **payment-freeze interlock** (matrix Stage 18: invoice blocked
if Stage 12/15 not validated) is `assertClaimAllowed`, specified here, enforced when
the claims module exists.

### 10.7 Ownership & sync mapping

| Data | App | Web | Server | Notes |
|---|:-:|:-:|:-:|---|
| `stage_templates` / `_items` | R | **W** | R | System templates seeded server-side; org clones via web. Pull-only to the app so it can render the programme. |
| `project_stages` structure (seq, name, cost, part, gate) | R | **W** | R | Office draws the programme (matrix Stage 9, Dashboard). |
| `project_stages.status` / dates | **W** | R | R | The site advances stages (progress.write) — through the engine's gates. |
| `project_stages.is_validated`+ | R | R | **W** | Inspector validation only (10.5); in `PROTECTED_COLUMNS`. |
| cost columns | R | **W** | R | 𝗙 money-redacted on pull. |

New registry entries: `stage_templates`, `stage_template_items` (owner web, pull true,
no app-writable columns). `project_stages` already exists; add the new server/web
columns to its protected set and the cost columns to `financialColumns`.

### 10.8 Endpoints

```
GET   /stage-templates                     list system + org templates
GET   /stage-templates/:id                 template + its items
POST  /stage-templates                     clone/create an org template   (programme.write)

POST  /projects/:id/programme              instantiate stages from a template
      { template_id }                                                     (programme.write)
PATCH /projects/:id/stages/:stageId        structure edit (programme.write) OR
                                           progress edit (progress.write) — service splits
POST  /projects/:id/stages/:stageId/advance
      { to_status, milestone? }            run the progression gates      (progress.write)
POST  /projects/:id/stages/:stageId/validate
      { result, reference?, note? }        inspector hold-point gate      (quality.validate)
```
The field app can also advance a stage through the existing `/sync/push`
(`project_stages` update) — the same `StageProgressionService.checkTransition` guards
it, so REST and sync behave identically.

### 10.9 Build order

| Step | Deliverable | Depends on |
|---|---|---|
| 1 | migration_v006: extend the two tables, add cost columns, seed `WA_RESIDENTIAL_18` | — |
| 2 | `StageProgressionService` (checkTransition + advance) + wire into SyncService push and a REST `/advance` | 1 |
| 3 | `/projects/:id/programme` instantiation + `/stage-templates*` | 1 |
| 4 | validation endpoint + `is_validated` gate + audit | 2 |
| 5 | event-hook registry (no-op bodies) + `assertClaimAllowed` stub | 2 |
| 6 | dashboard: a project's Programme tab (stage list, status, validate, cost roll-up) | 2–4 |
| 7 | `tests/stages.test.js`: gate refusals, inspector-only validation, redaction, sync-path parity | 2–4 |

Steps 1–4 are the spine; 5–6 are additive.

### 10.10 Open decisions for the owner

1. **`estimator` (Stage 9).** Named in the matrix but absent from the 6-role
   registry. Recommend: **projectManager sub-function in v1** (Stage 9 tender/BOQ is a
   projectManager Dashboard action); revisit if you want tendering delegated. Confirm.
2. **Status vs milestone split.** I recommend the small gate-enum + free-text
   `milestone` (10.3) so the engine stays simple while the app shows the matrix's exact
   states. Alternative: one big status enum with all ~25 states — simpler wire, but the
   gate logic then hard-codes the vocabulary. Your call.
3. **Programme instantiation surface.** Matrix Stage 9 is a Dashboard action, so I'd
   make `/programme` **web-first** in v1 (the PM instantiates from the office). The
   app renders the resulting stages. Confirm, or do you want offline instantiation too?
4. **Inspector independence.** I've kept `quality.validate` off `projectManager`
   (separation of duties per the matrix). Confirm the PM should not be able to
   self-validate a hold point.
5. **Cost columns now or with accounting?** The four columns + roll-up are cheap to
   add now (they're just money-redacted fields); the *claim/invoice interlock* waits
   for the accounting module. Recommend: **add the columns now**, wire the interlock
   later. Confirm.

**Review ask (§10):** approve 10.3 (schema), 10.4 (the gate rules), 10.7 (ownership),
and answer 10.10. Then I build steps 1–4 and bring `tests/stages.test.js` green before
touching the dashboard.

---

## 11. Site operations (P5) — diary · attendance · deliveries  ✅ BUILT

**Status: ✅ BUILT + verified 2026-07-24 — approved same day (all §11.10 recommendations
locked). Delivered as migration_v008 + `SiteOpsService` (guardPush/afterPush wired into
SyncService on both write intents) + the three registry entries + the `projects`
geofence (web-settable via `PATCH /projects/:id`). `tests/siteops.test.js` 28/28; all
suites green. Remaining: the portal Site tab (read-only review, step 5) — deferred with
the review surface. The spec below is the as-built contract.**

**Original status (for history): ⏳ SPEC — written 2026-07-24, awaiting owner approval before any v008 code.**
This is the field app's **daily driver** (appspec §5.3, development.md §5.4, P5.10). It
is the first domain module that is **app-authored and app-owned**: unlike the programme
(office draws it) or money (web writes it), the site *creates* this data — attendance
taps, a delivery docket photographed at the gate, the end-of-day diary. The server's job
is to receive it through the existing scoped/redacted sync path, and to enforce the one
rule the site can't self-police: **the diary is a legal record, so it is append-only and
its edits are versioned** (development.md §5.4, appspec Decision 4 lineage). It sits on
the construction core (v003 `projects`) and the access layer (§9): every write is a
`requirePermission` + `scopeFilter` guard on **both** REST and sync-push.

### 11.1 What it delivers

1. **Site diary** — one immutable legal entry per project per day; drafts are freely
   editable, a **finalised** entry can only be *superseded by a new version* (the audit
   chain is the point). Headcount derives from attendance; weather is app-cached and
   never blocks (appspec §5.3).
2. **Attendance** — one-tap check-in/out with a **geofence stamp** (anti-fraud, feeds the
   future trust-score, projman-02 §60). Covers staff (paired → `users.id`),
   subcontractors and visitors; capture is either self (a tradie) or site (a supervisor
   mustering the crew). "All Out" = bulk end-of-day sign-out + evacuation muster.
3. **Deliveries** — photograph a docket against the project (and, when P7 lands, a PO);
   the delivery *proof* record. v1 is the evidence row; supplier/PO linkage is nullable
   until the commercial module exists.

### 11.2 Where the FKs point today (the constraint that shapes v1)

`development.md` §5.4 writes `attendance.person_id`, `deliveries.supplier_id/po_id` as if
those tables exist. **They don't yet** — there is no `persons`, `suppliers`,
`purchase_orders` or `documents` table (checked: only v001–v007). So v1 is deliberately
**loose-coupled**:

- **People:** `person_id CHAR(36) NULL` → `users.id` **when the person is paired staff**;
  otherwise NULL with a free-text `person_name` + `person_type` (`staff|subcontractor|
  visitor`). A subbie chippie with no account still musters. When an HR/`persons` table
  arrives it backfills; no rework of the wire.
- **Suppliers/POs:** `supplier_id` / `po_id` **nullable**, plus free-text
  `supplier_name` / `po_reference`. P7 wires the FKs; v1 captures the docket regardless.
- **Photos:** attach through the ported **offline-first image queue** (development.md
  §5.1, MAOI lineage) as a `documents` module lands. v1 stores a `photo_ids JSON NULL`
  column so the app can queue image ids now; the actual image rows are that module's job.
  No blocking dependency.

This keeps P5 shippable now and additive later — the same move that let the stage engine
declare hooks before their bodies existed.

### 11.3 Schema — migration v008

All three tables carry the five sync columns (`org_id`, `device_id`, `is_deleted`,
`updated_at`, `server_updated_at`) + `id CHAR(36)` client-UUID PK + `created_at`.

```
site_diary        project_id CHAR(36) NOT NULL         (FK projects.id)
                  entry_date  DATE    NOT NULL
                  version     INT     NOT NULL DEFAULT 1
                  supersedes_id CHAR(36) NULL           prior version this replaces
                  is_current  TINYINT NOT NULL DEFAULT 1 server-maintained (see 11.4)
                  status      ENUM('draft','final') NOT NULL DEFAULT 'draft'
                  weather     VARCHAR(40)   temp_c DECIMAL(4,1)
                  headcount   INT NULL       (app fills from attendance; advisory)
                  work_done   TEXT   delays TEXT   delay_cause VARCHAR(120)
                  notes       TEXT
                  photo_ids   JSON NULL
                  author_id   CHAR(36) NULL  (server-stamped from the session, see 11.4)
                  finalised_at DATETIME NULL   finalised_by CHAR(36) NULL  (server-set)
     UNIQUE (org_id, project_id, entry_date, version)

site_attendance   project_id  CHAR(36) NOT NULL
                  person_id   CHAR(36) NULL          (users.id when paired staff)
                  person_name VARCHAR(120) NULL      person_type ENUM('staff','subcontractor','visitor')
                  trade       VARCHAR(60)
                  check_in_at DATETIME NULL   check_out_at DATETIME NULL
                  check_in_lat DECIMAL(9,6) NULL   check_in_lng DECIMAL(9,6) NULL
                  method      ENUM('self','supervisor','qr') NOT NULL DEFAULT 'self'
                  geo_verified TINYINT NULL          server-derived (11.5); NULL = unknown
                  induction_ok TINYINT NULL

deliveries        project_id  CHAR(36) NOT NULL
                  supplier_id CHAR(36) NULL   supplier_name VARCHAR(160) NULL
                  po_id       CHAR(36) NULL   po_reference  VARCHAR(60)  NULL
                  received_at DATETIME NOT NULL
                  docket_no   VARCHAR(60)   photo_ids JSON NULL   notes TEXT
                  received_by CHAR(36) NULL  (server-stamped)
```

**Add a geofence to `projects`** (needed so the server can *derive* `geo_verified`
rather than trust the client's own verdict):
```
projects  + geofence_lat    DECIMAL(9,6) NULL
          + geofence_lng    DECIMAL(9,6) NULL
          + geofence_radius_m INT NULL DEFAULT 200
```
Web-set (office knows the site coordinates). Absent → `geo_verified` stays NULL (graceful
degrade — appspec Decision 4: "never block check-in"). None of these are money columns,
so **no `financialColumns` on any P5 table** — a delivery has no value in v1.

### 11.4 The append-only diary rule (the one server-enforced invariant)

The diary's legal weight comes from immutability (development.md §5.4 "diary is the legal
record — append-only, edits versioned"). Enforced in `SiteOpsService`, on **both** the
REST edit and the sync-push update path (parity, like the stage gates):

- **A `draft` row is freely mutable** — the supervisor is still writing today's entry.
- **Finalising** (`status: draft→final`) stamps `finalised_at` + `finalised_by` (server,
  from the session) and freezes the row.
- **Editing a `final` row is refused** on the wire → `409 DIARY_FINAL`. To correct a
  finalised day the app **creates a new row**: same `(project_id, entry_date)`, `version =
  prior + 1`, `supersedes_id = prior.id`. The service, in one transaction, inserts the new
  version and flips the prior row's `is_current = 0`. The superseded row is **never
  deleted** — the chain of what was recorded, and when, survives. `is_current` +
  `is_deleted` are in `PROTECTED_COLUMNS` for this table (server maintains them).
- `author_id` / `finalised_by` are **server-stamped from the session**, never trusted
  from the body — the legal record must name who the server authenticated, not who the
  client claims. (Same principle as `validated_by` in §10.5.)

Reads (app pull, portal review) default to `is_current = 1`; the version history is
available through a REST read for the portal's audit view.

### 11.5 Attendance & the geofence

- **Capture is app-side and must never block** (appspec Decision 4). The app stamps
  `check_in_lat/lng` when permission is granted and omits them when it isn't — the server
  accepts both.
- **`geo_verified` is server-derived, not client-asserted.** At ingest, if the project
  has a geofence and the row has coordinates, `SiteOpsService` computes the haversine
  distance to `(geofence_lat, geofence_lng)` and sets `geo_verified = distance ≤
  geofence_radius_m`. No geofence set, or no coordinates → `geo_verified = NULL`
  (unknown, not "fail"). This is the anti-fraud signal that feeds the trust-score when
  projman-02 is built; keeping the *verdict* server-side means a tampered client can't
  self-certify a fraudulent check-in. `check_in_lat/lng` stay app-writable; `geo_verified`
  is in `PROTECTED_COLUMNS`.
- **Self vs site capture** is the permission split (11.6): a tradie writes only their own
  check-in (`method='self'`, `person_id = self`); a supervisor/foreperson musters the crew
  (`method='supervisor'`, any `person_id` on a member project). "All Out" is a bulk
  check-out the app composes as N attendance updates — no special server verb.

### 11.6 Ownership, scope & redaction

All three tables: **owner `app`**, **pull true**, **project-scoped**
(`projectColumn: 'project_id'`), **no financial columns**.

| Permission (activates a §9.3 reserved name) | Grants | Roles |
|---|---|---|
| `diary.write` | create/edit a **draft** diary line | projectManager, siteSupervisor, foreperson |
| `diary.signoff` | finalise the legal entry (draft→final) | projectManager, siteSupervisor |
| `attendance.write.site` | muster the crew (any person on a member project) | projectManager, siteSupervisor, foreperson |
| `attendance.write.own` | own check-in/out only (`self` scope ∩ `person_id=self`) | tradie |
| `deliveries.write` | record a delivery on a member project | projectManager, siteSupervisor, foreperson |

`foreperson` gets `diary.write` (contribute) but **not** `diary.signoff` — matches
appspec §120/development.md §128 ("diary contribute, no sign-off"). Scope: `assigned` for
supervisor/foreperson/inspector-none-here; `self` for the tradie's own attendance
(`selfColumn: 'person_id'`); `portfolio` PM reaches all. `inspector` and `client` get no
P5 write. **Read** of P5 data follows the same project scope on pull — a tradie's tablet
receives only its member projects' diary/attendance/deliveries, and (self scope) only its
own attendance rows.

### 11.7 Endpoints

The site writes P5 almost entirely through **`/sync/push`** (offline-first — a delivery is
logged at the gate with no signal). REST exists for the **portal review surface** and for
the two server-mediated actions:

```
GET   /projects/:id/diary            list current entries (portal review; ?date= , ?all_versions=)
GET   /projects/:id/diary/:entryId   an entry + its version chain (audit view)
GET   /projects/:id/attendance       muster / day roster (?date=)  — headcount source
GET   /projects/:id/deliveries       delivery log (?from=&to=)
```
Writes ride sync-push; a finalise or a versioned correction pushed as a
`site_diary` update runs the same `SiteOpsService` guard that a REST edit would. No
bespoke REST write verbs in v1 (keeps the offline path canonical) — add them only if the
portal needs to author, which appspec says it does not ("review, app-owned").

### 11.8 Sync registry entries (v008)

Three additions to `sync/registry.js`, no new mechanism — the pattern the file was built
for (its own header names `site_diary` and `attendance` as the worked example):

```js
site_diary:      { owner:'app', pull:true, scope:'org', orgColumn:'org_id',
                   projectColumn:'project_id',
                   columns: entry_date, status, weather, temp_c, headcount, work_done,
                            delays, delay_cause, notes, photo_ids, version, supersedes_id,
                            is_deleted, updated_at
                   /* is_current, author_id, finalised_at/by, org_id → PROTECTED */ }
site_attendance: { owner:'app', pull:true, scope:'org', orgColumn:'org_id',
                   projectColumn:'project_id', selfColumn:'person_id',
                   columns: person_id, person_name, person_type, trade, check_in_at,
                            check_out_at, check_in_lat, check_in_lng, method,
                            induction_ok, is_deleted, updated_at
                   /* geo_verified → PROTECTED (server-derived) */ }
deliveries:      { owner:'app', pull:true, scope:'org', orgColumn:'org_id',
                   projectColumn:'project_id',
                   columns: supplier_id, supplier_name, po_id, po_reference, received_at,
                            docket_no, photo_ids, notes, is_deleted, updated_at }
```

Add to `PROTECTED_COLUMNS` (table-agnostic, so they're safe everywhere): `is_current`,
`author_id`, `finalised_at`, `finalised_by`, `geo_verified`, `received_by`. `status` is
already protected globally; `site_diary` needs it in its `unprotect` set (like
`project_stages`) so the app can push `draft`/`final` — the finalise/immutability logic
then lives in `SiteOpsService`, not in the column filter.

### 11.9 Build order

| Step | Deliverable | Depends on |
|---|---|---|
| 1 | migration_v008: 3 tables + `projects` geofence columns | — |
| 2 | registry entries + `PROTECTED_COLUMNS` additions + permission seed rows (`diary.write`, `diary.signoff`, `attendance.write.{own,site}`, `deliveries.write`) into the matrix | 1 |
| 3 | `SiteOpsService`: diary append-only/versioning rule + geofence derivation, wired into **sync-push** and REST | 1–2 |
| 4 | portal review reads (`/diary`, `/attendance`, `/deliveries`) + a Site tab on the project page (read-only muster, diary chain, delivery log) | 3 |
| 5 | `tests/siteops.test.js`: diary finalise→immutable→versioned, geofence pass/fail/degrade, self-vs-site attendance scope, project-scoped pull, redaction-N/A sanity | 3 |

Steps 1–3 are the spine; 4–5 additive. No dependency on the image/documents module or on
P7 — those wire in additively (11.2).

### 11.10 Open decisions for the owner

1. **Diary versioning shape.** I recommend **new-row-per-version** with `supersedes_id` +
   `is_current` (11.4) — the superseded text is preserved verbatim, which is what makes it
   a legal record. Alternative: a side `site_diary_revisions` audit table with the live
   row mutated in place. I prefer the former (one table, the chain is the data). Confirm.
2. **`geo_verified` server-derived vs app-asserted.** I recommend **server-derived** from
   a web-set project geofence (11.5) so a tampered client can't self-certify. Cost: the
   office must set site coordinates (else `geo_verified` is NULL/unknown, which degrades
   gracefully). Confirm, or accept a client-asserted flag for v1?
3. **People with no account.** v1 uses `person_id` (paired staff) OR free-text
   `person_name`+`person_type` (subbie/visitor) — no `persons` table yet. Confirm that's
   enough for P5, or do you want a lightweight `site_personnel` roster now?
4. **`diary.signoff` as a distinct permission.** Splitting contribute (`diary.write`,
   incl. foreperson) from finalise (`diary.signoff`, supervisor+) matches the app spec.
   Confirm — or collapse to one `diary.write` and let the app hide sign-off?
5. **Deliveries without commercial.** v1 delivery is an evidence record (docket photo +
   free-text supplier/PO), no value, no stock movement. The stock-on-site view
   (development.md §231 "materials on site") and PO linkage wait for P7. Confirm P5 stops
   at the evidence record.

**Review ask (§11):** approve 11.3 (schema + the `projects` geofence add), 11.4 (the
append-only diary invariant), 11.6 (ownership/permissions/scope), and answer 11.10. Then
I build steps 1–3 and bring `tests/siteops.test.js` green before the portal Site tab.
