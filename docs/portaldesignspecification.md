# ProjMan2 — Portal (Web Console) Design Specification (for review)

**Status:** 🟠 DRAFT for review — partially built (auth + Devices + Projects + Programme
tab already live). Approve or redline, then I build the rest to it.
**Date:** 2026-07-23
**Author:** Server dev (NexusPM)
**Reviewer:** owner (eBizco)
**Companion docs:** `servdesignspecification.md` (server + §9 access + §10 stage engine) ·
`dashboarddesignspecification.md` (the *platform/ops* admin surface — distinct from
this) · `appdesignspecification.md` (field app) · `projman-04.md` (server progress).

> This spec defines the **office-facing web console** — the surface used by Project
> Managers, Inspectors, and Clients from a desk. It is the same Next.js app already
> scaffolded at **`server/dashboard`** (login, Devices, Projects, the Programme tab are
> built); this document is the plan for growing it into the full console + client
> portal + public entry, **not a new application**.

---

## 1. One app, four route groups (don't build a third web app)

There are, across all the specs, **four web surfaces**. They are **one Next.js app**
(`server/dashboard`) with gated route groups, not separate deployments — sharing the
ported portal UI kit, the API client, and the JWT session:

| Route group | Surface | Users | Auth | Spec |
|---|---|---|---|---|
| `(console)/*` | **PM Console** (this doc) | projectManager, inspector, siteSupervisor | JWT, no device_id | here |
| `/client/*` | **Client Portal** (this doc) | client | JWT, `portal` scope | here §9 |
| `/` `/login` `/signup` | **Public entry** (this doc) | visitors | none | here §10 |
| `/admin/*` | **Admin & monitoring** | tenant-admin, platform-admin | admin mount | `dashboarddesignspecification.md` |

Keeping them one app avoids three parallel auth integrations and three copies of the
component kit. Each group is gated at the layout by permission/scope (§3).

**Already built** (per `projman-04`): the `(console)` shell (collapsible sidebar with
the 60+/low-vision accessible font tiers, topbar), `/login`, the **Devices** page, the
**Projects** list+create, and the **Programme tab** (`/projects/[id]` — 18-stage view,
advance, inspector-validate, cost roll-up). This spec formalises the remaining modules
around that spine.

---

## 2. Purpose & audience

| | |
|---|---|
| **Purpose** | The desk-side complement to the capture-first field app: plan (Gantt, cost), administer (users, devices, org), review (quality, safety), transact (commercial, finance), report — and give the client a read-only window. |
| **Audience** | **projectManager** (full), **inspector** (quality), **siteSupervisor** (read-only review), **client** (own project, read-only + approvals). |
| **Not** | The field app's capture surface (that's on-device, offline-first), and not the platform ops dashboard (`/admin/*`, separate spec). |

---

## 3. Roles & permissions (portal-specific) — mapped to the locked 6-role model

**Reconciliation first.** The brief's role list (Org Admin, PM, Estimator, Site
Supervisor, Inspector, Client, Subcontractor) predates the locked 6-role model
(`18StageProjectMangementMatrix.md`). The mapping:

| Brief's portal role | Our model | Notes |
|---|---|---|
| Org Admin | **`projectManager`** (holds `org.manage`) | there is no separate `org_admin` role — folded into projectManager |
| Project Manager | **`projectManager`** | the portfolio top-actor |
| Estimator | **folded into `projectManager`** (locked) OR a new role | ⚠ **re-opens a locked decision** — see Open Decision #1 |
| Site Supervisor | **`siteSupervisor`** | web = read-only review (their writes happen on the app) |
| Inspector | **`inspector`** | quality only |
| Client | **`client`** | client portal only (`portal` scope) |
| Subcontractor | post-v1 (`projman-02` engagement) | not in v1 |

**Access is by permission, not role name** (§9 of the server spec), so the console gates
each module on the capability the user holds. This is what lets "Estimator" be either a
projectManager view or a future role without rewiring the console:

| Module | Gate (permission) | projectManager | inspector | siteSupervisor | client |
|---|---|:-:|:-:|:-:|:-:|
| Dashboard (portfolio) | `projects.read` | ✅ | ✅ (assigned) | ✅ (assigned) | — |
| Projects / Programme | `projects.read` / `programme.write` | ✅ | R | R | — |
| Gantt (edit) | `programme.write` | ✅ | — | — | — |
| Cost Plan | `money.read` / `money.write` | ✅ | — | — | — |
| Estimating | `money.write` | ✅ | — | — | — |
| Quality | `quality.validate` / `projects.read` | R | ✅ | R | — |
| Safety | `progress.write` / `projects.read` | ✅ | R | R | — |
| Admin (users/devices/org) | `users.manage` / `devices.manage` / `org.manage` | ✅ | — | — | — |
| Client Portal | `portal` scope | — | — | — | ✅ |

`siteSupervisor` on the web is **read-only review** — a deliberate design point: their
authoritative writes (attendance, diary, hazards) happen on the app where they are on
site; the console lets them review, not double-enter.

---

## 4. Navigation structure

The `(console)` sidebar (already scaffolded, with the "soon" placeholders) formalises to:

```
Dashboard                     portfolio KPIs
PROJECTS
  Projects                    list + create + detail
  Programme (per project)     18-stage tracker  ✅ built
  Gantt (per project)         interactive schedule
  Cost Plan (per project)     estimated/committed/actual/claimed + variance
SITE
  Site Diary                  review (app-owned)
  Attendance                  review (app-owned)
  Safety                      hazards / incidents / inductions / toolbox
  Quality                     inspections / defects / certificates
COMMERCIAL
  Estimating                  cost library, estimates, BOQ
  Procurement                 POs, supplier invoices, materials
  Progress Claims             claims against completed stages
  Variations                  raise → client approval
FINANCE
  Accounting                  COA, journals, payments, bank rec
  Tax                         BAS / TPAR / PAYG / super
REPORTING                     standard + custom, export
ORGANISATION
  Users                       ✅ endpoints live (/organisation/users)
  Devices                     ✅ built
  Settings                    org profile, ABN, GST
  Audit                       ✅ endpoint live (/organisation/audit)
```

Items render only when the user holds the module's permission (§3); a role sees a
focused console, not greyed-out clutter.

---

## 5. Feature list per module — with build-readiness

The console can only be as real as the server data behind it. This column is the honest
state so the portal doesn't get built ahead of its API:

| Module | Key features | Server data | Buildable |
|---|---|---|---|
| **Dashboard** | portfolio cards (active projects, stages due, claims, safety), trend charts | projects/stages (built) | ✅ now (basic); richer with P5–P7 |
| **Projects** | list, create, edit, detail | `/projects*` (built) | ✅ built |
| **Programme** | 18-stage tracker, advance, validate, cost roll-up | `/programme`,`/advance`,`/validate` (built) | ✅ built |
| **Gantt** | drag tasks/dates, dependencies, critical path | stages + tasks (built); needs date/dep endpoints | 🟡 needs a little server + a Gantt lib |
| **Cost Plan** | per-stage est/committed/actual/claimed, variance | stage cost columns (built, money-redacted) | ✅ now (read); edit via stage PATCH |
| **Estimating** | cost library, estimates, BOQ, quote compare | `cost_library`, `estimates` — **not built (P7)** | 🟢 waits on P7 |
| **Procurement** | POs, supplier invoices, materials | `purchase_orders`, `item_master` — **P7** | 🟢 waits on P7 |
| **Workforce** | roster, attendance, payroll summary | `staff_roster`, `attendance` — **P5/P8** | 🟢 waits |
| **Quality** | inspection log, defects, certificates | `/validate` (built); full `inspections` **P6** | 🟡 gate built, module P6 |
| **Safety** | hazards, incidents, inductions, toolbox | **P6** | 🟢 waits on P6 |
| **Documents** | repository, versions, expiry | `documents` — **not built** | 🟢 waits |
| **Finance** | COA, journals, payments, bank rec | accounting — **P8** | 🟢 waits on P8 |
| **Tax** | BAS, TPAR, PAYG, super | tax — **P9** | 🟢 waits on P9 |
| **Reporting** | standard + custom, PDF/Excel/CSV | all domain | 🟢 after its data exists |
| **Admin** | users, devices, org settings, audit | `/organisation*`, `/devices*` (built) | ✅ now |

So **v1-buildable now**: Dashboard, Projects, Programme, Cost Plan, Admin. Everything
else follows its server P-module — the portal build order (§12) tracks the server one.

---

## 6. Key user flows

| Flow | Steps (portal) |
|---|---|
| **Create Project (Stage 1)** | Projects → New → keyed entry + document drag-drop (OCR preview when the Python hook lands) → save. *Create is APP-or-WEB (projman-01 §10); the console creates online.* |
| **Instantiate Programme (Stage 9)** | Project → Programme → "Instantiate from template" → pick `WA_RESIDENTIAL_18` → 18 stages stamped. ✅ built. |
| **Advance / validate a stage** | Programme → Start/Complete a stage (gated); inspector → Validate a hold point. ✅ built. |
| **Gantt editing** | Gantt → drag a task's bar / set a dependency → PATCH stage/task dates. Gated `programme.write`. |
| **Cost Plan** | Cost Plan → enter est/committed per stage; actual/claimed roll up; variance shown. Money-redacted for non-financial viewers. |
| **Tender prep** | Estimating → BOQ from stages → issue to subs → compare quotes. (P7.) |
| **Progress claim** | Commercial → new claim against completed+validated stages; `assertClaimAllowed` blocks a claim behind an unvalidated hold point (stub built). (P7.) |
| **Variation approval** | PM raises a variation → **client** sees it in the client portal → Approve/Decline (the client's one write). |
| **Reporting** | Reporting → type + date range → export PDF/Excel/CSV. |

---

## 7. Architecture

| Aspect | Decision |
|---|---|
| Framework | **Next.js 14 (App Router)** — the existing `server/dashboard`. |
| Auth | **Same JWT as the field app**, same `/api/v1/auth/*` — a **web session (no device_id)**, so it is never the single-writer (§ AuthService: web sessions never authoritative). *(Answer to Q1: yes, shared auth.)* |
| State | SSR for first paint where useful; client-side data via the ported `usePortalData` hook + the `/api/v1` client. No global store needed at this size. |
| API | The **same `/api/v1` endpoints** as the app — the console is just another client of the tenant surface. No portal-only API except reads the app doesn't sync. |
| Realtime | **Polling** — no MQTT (platform decision). Dashboards/log views auto-refresh. *(Answer to Q2: polling.)* |
| Theming | **Light theme** (office, not sunlight) — the ported accessible kit's light palette is already the default. |
| Layout | Collapsible sidebar + topbar (built), responsive. |
| Resolution | **Desktop primary; responsive to laptop/tablet.** Client portal is **mobile-friendly** (clients check progress on a phone). *(Answer to Q3.)* |
| Offline | **No** — the console assumes connectivity. Offline-first is the app's job (incl. Stage-1 create-offline). *(Answer to Q4.)* |

---

## 8. UI guidelines

- **Reuse the ported portal kit** (`PortalCard`/`PortalKpi`/`PortalTable`/`PortalFilter`/
  `PortalPagination`/`usePortalData`/`PortalNav`) — proven, accessible, already themed.
  **Recommendation: do NOT introduce a second component system (shadcn/ui) in v1** — it
  would fork the design language and duplicate the kit. Tailwind is already present for
  utility styling. (Open Decision #1 tech; a future shadcn migration is possible but is
  a deliberate spend, not a v1 default.)
- **Accessibility is a feature here** — many builders are 60+; the kit's font floors and
  focus rings stay.
- **Charts** follow the `dataviz` design system at build time (one visual system, light
  + dark, accessible) — Recharts (already a Nexus dep) rather than a new chart lib.
- **Responsive:** relative units, the sidebar collapses, tables scroll inside their own
  overflow container.

---

## 9. Client portal (`/client/*`) — the `portal` scope surface

The `client` role + `portal` scope class already exist (seeded, currently **fail-closed**
in `lib/scope.js` until this surface is built). Building the client portal is where
`portal` scope gets resolved.

| Feature | Server need |
|---|---|
| Project progress (% complete, stage timeline) | read of the client's project's stages (status only, **no costs**) |
| Photo gallery | site photos (P5/P6 documents) |
| Budget summary (high-level, **no internal cost detail**) | a deliberately coarse figure — internal est/committed/actual stay redacted |
| Variations — **Approve/Decline** | the client's **one write** — a scoped mutation |
| Progress claims (view status) | read of claims (P7) |
| Documents (handover, certificates, plans) | document download (P6/P10) |
| PM contact | org/user read |

**Two design items to settle before building it (§11 / new decisions):**
1. **Client ↔ project linkage.** How is a `client` login tied to *their* project? Options:
   a client user linked to a `customers` row, and `portal` scope resolves
   `project.customer_id = the client's customer`. Needs a `client_users`/link (a client
   is not staff). I'll spec this when the portal is greenlit.
2. **Variation approval as the sole client write** — a narrow, audited endpoint gated to
   `portal` scope + the client's own project.

Client portal is **P10** in the server plan; it is the reason `portal` scope was built
fail-closed rather than omitted.

---

## 10. Public entry (`/`, `/login`, `/signup`)

| Piece | v1 |
|---|---|
| **Login** | ✅ built (`/login`, email/password; OAuth buttons when provider IDs land). |
| **Sign-up (register org)** | **v1 — needed.** Self-service org registration → `POST /auth/register` (creates the projectManager). A focused signup form, not a marketing site. |
| **Marketing landing** (features, pricing) | **v2 — defer.** *(Answer to Q5: v1 ships a functional login + signup entry; the marketing site is v2.)* |

---

## 11. Answers to your questions + open decisions

**Q1 Same auth as the app?** **Yes** — same JWT, same `/auth/*`, web session without
device_id (never single-writer). **Q2 Realtime?** **Polling**, no WebSockets/MQTT.
**Q3 Resolution?** Desktop primary, responsive to laptop/tablet; client portal
mobile-friendly. **Q4 Offline?** **No** — always-on; offline is the app's role.
**Q5 Public landing v1?** **Login + signup yes; marketing landing v2.**

| # | Open decision | My recommendation |
|---|---|---|
| 1 | Component library | **Keep the ported portal kit + Tailwind** (consistency, accessibility). shadcn/ui = a future migration, not a v1 fork. |
| 2 | Gantt library | A **free, self-containable** option (frappe-gantt MIT, or a custom SVG/`d3`) over paid dhtmlxGantt — cost + CSP. Confirm appetite. |
| 3 | Reporting/charts | **Recharts** (already a dep) for charts + **jsPDF** for PDF; CSV native. Follow `dataviz`. |
| 4 | Client portal app | **Same app, `/client/*` route group** — agreed. |
| 5 | Bulk operations | Project edit, cost-plan update, PO/invoice entry — **later**, after the single-record flows are proven. |
| ⚠ | **`estimator` as a restricted role** (brief §Permission) | **Re-opens a locked decision** (estimator = projectManager sub-function). **Recommend v1: no new role** — the Estimating module is gated by `money.write` and lives in the projectManager's console. If you want a *restricted* estimator (estimating-only, no site/programme), that's a 7th role — cheap to add (roles are data) but it reverses the lock. **Your call.** |

---

## 12. Build order (tracks the server P-plan — portal can't outrun its data)

| Step | Deliverable | Priority | Gated by |
|---|---|---|---|
| 1 | Auth + console shell | 🔴 | ✅ built |
| 2 | Dashboard (portfolio + basic KPIs) | 🔴 | projects/stages (built) |
| 3 | Projects list + detail | 🔴 | ✅ built |
| 4 | Programme tracker | 🔴 | ✅ built |
| 5 | **Cost Plan** (read + per-stage edit + variance) | 🟡 | stage cost cols (built) — **buildable now** |
| 6 | **Admin** (users, devices, org settings, audit) | 🟡 | `/organisation*`,`/devices*` (built) — **buildable now** |
| 7 | Gantt (interactive) | 🟡 | small server (task deps/dates) + Gantt lib |
| 8 | Quality + Safety (review) | 🟡 | server **P6** |
| 9 | Estimating + Procurement | 🟢 | server **P7** |
| 10 | Commercial (claims, variations) | 🟢 | server **P7** |
| 11 | Accounting + Tax | 🟢 | server **P8/P9** |
| 12 | Reporting | 🟢 | its data |
| 13 | **Client Portal** (`/client/*`) | 🟢 | `portal` scope surface (**P10**) |
| 14 | Public marketing landing | 🟢 | v2 |

**Immediately buildable on today's server (no new domain modules): steps 5 (Cost Plan)
and 6 (Admin)** — they sit on surfaces already live. Everything else waits on its server
P-module, so the portal and server advance in lockstep.

---

## 13. Review ask

Approve §1 (one-app/four-route-groups), §3 (the role→permission mapping), §7
(architecture), and answer §11 — **especially the `estimator` question**, since it
decides whether the role model stays at 6. Then, on your word, I build the two
already-unblocked modules (**Cost Plan** and **Admin**) next, and the rest follows the
server P-plan.

---

© eBizco Australia Pty Ltd
