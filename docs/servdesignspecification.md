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
