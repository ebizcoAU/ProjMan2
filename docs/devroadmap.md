# ProjMan — Development Roadmap

**Status:** Domain framework of record. PM alignment pass 2026-10-14 (see §11.1 phase status, §12 ledger additions, §13 legal register, §14 blockers, §15 ecosystem).
**Date:** 27 July 2026 · revised 14 October 2026 (PM, `projman2-pm`)
**Owner:** eBizco Australia (Vince Phan)
**Language:** English only. No Vietnamese strings anywhere in this project.
**Replaces:** `development.md` and `development2.md` — both retired. This is the single
authoritative framework document; do not re-derive the domain model from either.
**Companion docs:** `appdesignspecification.md` · `portaldesignspecification.md` ·
`veritradedesignspecification.md` · `serverdesignspecification.md` ·
`dashboarddesignspecification.md`
**Source of truth for the domain itself:** *ProjMan — The 18-Stage Construction
Lifecycle, Fully Decomposed*, v3.4, 26 July 2026 ("the 18-Stage spec"). This document
does not restate that spec — it explains how the four products and the server are
built around it.

---

## 0. What ProjMan is

> ### ★ SCOPE RULING (Owner, 2026-10-14)
> **ProjMan is project management.** Accounting and invoicing (tax invoices, GST/BAS, ledger,
> payroll, depreciation) go through the business's accounting system: **QuickBooks, Xero, MYOB,
> or eBizco's MAVEN**. ProjMan does not reinvent them. **Staff rostering and job attendance for pay** are
> MAVEN + AURA's job. The **server dashboard's Finance module is eBizco platform finance only**, never
> tenant/user finance. ProjMan keeps: stages, programme, cost *plan* (budget vs progress), milestone
> readiness and statutory gates, site/safety/quality records, and **hand-off data** (export, then API) to the
> accounting system. Affected: P8 (accounting) → integration; xprojman-42 org_journal and
> xprojman-43 client invoicing → **ON HOLD for re-scope** (§12 #29).

A project management platform for building and construction, delivered as **four
products and one server**:

| Product | Tech | Users | Purpose |
|---|---|---|---|
| **App** | Flutter | Builder, Site Supervisor, Foreperson, Tradie, Inspector; PM (recall-only) | On-site capture, offline-first; also the universal identity root — see §7 |
| **Portal** | Next.js | Property Developer, Project Manager, Builder, Site Supervisor (review), Inspector (review), Client | Desk-analytical: programme, cost plan, tender, compliance, client relationship — **one application, role-scoped, not several** |
| **Dashboard** | Next.js, separate app | eBizco's own platform-ops team only | Cross-tenant monitoring: login/auth telemetry, billing, device health. Never tenant-facing. See `dashboarddesignspecification.md`. |
| **VeriTrade** | Separate product/brand | The public — B2B trade-vetting network | A standalone, public-facing professional network, fed by evidence ProjMan already captures, authenticated through the App. See `veritradedesignspecification.md`. |
| **Server** | Node.js (`server/api`) | All of the above | Registration, auth, device identity, sync, domain services. **Corrected 2026-10-14:** an in-repo lane owned by Server Dev (`xprojman-roles.md` §1). It is not Nexus and not handed to NexusPM. Nexus is a separate eBizco project (AURA/MAVEN, §15). |
| **Product site** | Next.js (`product/`) | The public | Marketing site, LIVE at projman.ebizco.com.au. Copy must not claim unbuilt features (xprojman-53, §13 L8). |

**This corrects a naming collision that ran through the earlier drafts of this
framework and of the server spec:** those documents modelled **three tenant client
surfaces** — "App," "Dashboard" (the office console), and a "Public Portal" (the
client's read-only view) — with Public Portal drawn as a third, separately-built
product. It never was one: its own session was always `customer`-scoped on the same
JWT/`org_id` model as everything else. There are **two** tenant-facing surfaces —
**App** and **Portal** — and Client is one more role-scoped view inside Portal, exactly
as `portaldesignspecification.md` §4.8 specs it. "Dashboard" is reserved exclusively
for eBizco's own internal ops tool (never a tenant sees it); the office console some
earlier material called "Dashboard" is **Portal**. VeriTrade is a genuinely separate,
fourth product — not a tenant surface at all, and not built on this pass's port plan.

It is **multi-tenant**: each subscribing builder is an organisation, creates its own
projects, and holds its own customers. Nothing crosses the tenant boundary — except,
by design and under its own architecture, the identity-scoped evidence a person takes
with them to VeriTrade (§7).

### The purpose, stated plainly

Project management here means **on schedule, on budget, delivered** — and the work
that achieves that is *coordination*: between subcontractors, against quotes and
estimates, tracking invoices and payments, knowing where the materials are.

| Question the user asks | What must be in place |
|---|---|
| Are we on schedule? | programme, stages, hold points, dependencies |
| Are we on budget? | estimate → quote → contract → committed → actual → claimed |
| Who is doing what, when? | subcontractor engagements, assignments, attendance |
| What did we quote, and what did it cost? | estimating library, quotes, variations |
| Have we paid them? | supplier invoices, payment runs, retentions, wages |
| What material, where, at what price? | material catalogue, supplier price lists, deliveries |

**Accounting is not an adjunct — it is half the product.** Spending, payments to
subcontractors and to own staff, the ledger, and Australian tax all sit in the core.

### Where it comes from

| Source | What we take |
|---|---|
| `~/Documents/Dev/ProjMan` (legacy) | The domain model — WBS spine, cost-control skeleton. Mining-engineering framing dropped. |
| `ftpos` MAOI variant | The proven ~70% of the platform: authentication, registration, recovery, device pairing, sync, offline-first image queue, accounting, fixed assets and depreciation, staff roster and attendance. |
| **The 18-Stage spec, v3.4** | The authoritative construction and procurement lifecycle. This — not any earlier reconstruction — is the Core Logic Driver. Do not re-derive it; read that file. |

### What ProjMan is *not*

No selling, no POS, no menus, no rooms or bookings, no Vietnamese tax. MAOI's **buy
side** is kept; its **sell side** is dropped entirely.

---

## 1. Repository layout

```
~/Documents/Dev/Projman2/
├── app/          Flutter field app
├── server/
│   ├── api/        Node API :5100 (Server Dev) + migrations
│   ├── dashboard/  Next.js platform-ops :5101 (Server Dev), eBizco internal only
│   ├── portal/     Next.js desk console :5102 (Portal Dev)
│   ├── veritrade/  Next.js public B2B :5103 (VeriTrade Dev)
│   ├── shared/     constants.js, the single source of ports/URLs
│   └── lab.sh      lab start/stop (run by the PM)
├── product/      Next.js marketing site (Product Manager), LIVE
├── docs/         This framework + design specs + decisions
└── README.md
```

Decisions follow the numbered-record convention `docs/decisions/xprojman-NN.md` (corrected
2026-10-14; the `PM2-NN` naming is retired). Cross-lane work is agreed in an xprojman-NN contract
between the lanes. Lanes and reporting lines: `docs/decisions/xprojman-roles.md`.

---

## 2. Thinking as the user

### The Property Developer / Project Manager

Wins land or a contract → sets a budget and cost plan → engages a Builder by Job
Award → watches committed vs actual vs claimed against **the Builder's own** figures
(read-only, §6 of `serverdesignspecification.md`) → issues progress-claim
approvals → collects the compliance certificates that let the job be handed over.
Their question is **"is this project on schedule and on budget, and what can I
approve this month?"** — not "let me edit the Builder's programme," which is a wall,
not a permission nuance.

### The Builder

Appointed at Stage 9, in one of three **engagement modes** — `independent_fixed`,
`independent_cost_plus`, or `employee` — set at the same moment as the Job Award
and load-bearing for everything downstream about what PM can see. The
underlying rule, stated once: **visibility scales with risk.** Whoever bears
the risk of a cost overrun earns the right to keep their cost structure
private; whoever is protected from that risk owes transparency in exchange.

- **`independent_fixed`** (the original design, still the default mental
  model): Builder runs his own Cost Plan, his own Programme/Line-of-Balance
  schedule, his own subcontractor engagements, appoints his own Foreperson and
  Tradies — a genuinely separate business inside the same tenant. His
  question is **"what has this job cost me, what have I committed, and what
  can I claim this month?"** — his margins and his authored schedule are both
  protected from PM, the schedule unconditionally, the margins because he
  bears the price risk. PM still sees the head-contract figure and the
  subcontractor engagement register regardless — not a concession, a standing
  requirement to support step-in rights if Builder becomes insolvent.
- **`independent_cost_plus`:** still a separate business, but PM/Client now
  bears the cost risk — so Builder's actual costs and commission are fully
  disclosed to PM, extending to job costing and the supplier/subcontractor
  register in full, not just the head-contract figure. Hiding them here would
  be the fixed-price privacy wall without the fixed-price risk that justifies
  it.
- **`employee`:** not a separate business at all. There is one Cost Plan, not
  two — the schedule-authorship wall still holds (someone still has to
  operationally run the site), but the cost-privacy wall doesn't apply,
  because there's no second business's ledger to protect.

Full detail, including the schema (`builder_engagement_type`, and the
subcontractor pass-through consent flag this creates) lives in
`portaldesignspecification.md` §1.4 and `serverdesignspecification.md` §7.2.1
— worth reading in full before touching any Commercial-module code, since an
earlier pass of this framework stated the margin-privacy rule as an
unconditional absolute, which was itself a defect against the actual
principle.

### The Site Supervisor

Their day, in order — confirmed detail, not inference:

1. **Who is on site?** Crew sign-in, a headcount that is also the safety record.
2. **Toolbox talk**, inductions for anyone new on site.
3. **What is programmed for today**, and does anything hit a **hold point** that
   needs an inspector or engineer before work continues?
4. **Deliveries** — dockets against orders.
5. **Walk the site** — hazards, incidents, defects, photos.
6. **Close the day with a site diary entry** — weather, headcount, work done,
   delays and their cause. **Site Supervisor signs it off; Foreperson may
   contribute, never sign off** — Site Supervisor is PM's own independent
   appointee, not Builder's employee, and the diary is PM's independent record of
   the day, not the Builder's.

The site diary is the legal record behind every delay and extension-of-time claim
— **the app's most important single feature**, and it must work with no signal and
gloves on.

**Design consequence:** the field app is *capture-first*. Everything it does is
fast entry with photos, queued locally, synced when there's signal. Analysis,
Gantt editing and financial work belong on the Portal, never the phone.

---

## 3. Role model — the corrected set

The nine roles the 18-Stage spec, App Design and Portal Design all key off. **This
supersedes every earlier role table in this project's history** — the previous
"role model v2, LOCKED" table had no `builder` role at all and folded his functions
into `supervisor`, which conflated a paid contractor with the party independently
checking that contractor's work.

| # | Role | `role` enum | v1 | Surface | Scope |
|---|---|---|---|---|---|
| 1 | **Property Developer** | `developer` | ✅ | Portal | Portfolio-level commercial principal. `development.read`, funding/pipeline view. Same-tenant as PM in v1. |
| 2 | **Project Manager** | `projectManager` | ✅ | Portal (full) + App (recall-only) | Stages 1–9 near-sole actor; Stage 10 on, **read-only** on everything Builder authors. |
| 3 | **Builder** | `builder` | ✅ | App + Portal (own engagement) | Job-Awarded at Stage 9; runs his own Programme, Cost Plan, subcontractor register; appoints his own crew. **First-class role — the single biggest correction in this framework.** |
| 4 | **Site Supervisor** | `siteSupervisor` | ✅ | App (primary) + Portal (review) | PM's own independent on-site appointee — explicitly *not* a subset of Builder's role. Verifies Foreperson's/Tradie's ticks. |
| 5 | **Foreperson** | `foreperson` | ✅ | App | Builder's crew lead. Verifies Tradie ticks; verified by Site Supervisor. No diary sign-off, no financials. |
| 6 | **Tradie** | `tradie` | ✅ | App | Self check-in, own tasks, own certs. Own portable Digital ID, independent of any one Builder. |
| 7 | **Inspector** | `inspector` | ✅ | App (Quality only) + Portal (history) | External, engaged at **six** defined checkpoints (Stage 8, 12, 13, 15, **16**, 18 — Stage 16 added in v3.4, the mains energisation certificate). Write access is exclusively the protected `is_validated` flag. |
| 8 | **Client** | `client` | ✅ | Portal only — **never App** ⚠️ **Superseded:** the Owner reversed this on 2026-09-07 (xprojman-41 §0.1), so Client becomes App-pairable. App built ClientHomeScreen (`4ee4d49`, xprojman-50). | Two tiers: `development` (whole-project principal) and `unit` (individual buyer). Sees what they're buying and owe, never upstream commercial detail. |
| 9 | **Accountant / BAS Agent** *(new, v3.4)* | `accountant` | ✅ | Portal, one gate only | The mandatory `S18.12` approval before the fixed-asset/depreciation draft (`S18.11`) becomes an ATO lodgement. Likely external/no-login (PM uploads their sign-off), same pattern as the Structural Engineer, unless volume justifies a dedicated paired login. |
| 10 | Construction Manager | `construction_manager` | ⚠️ post-v1 | Portal | Cross-project delivery oversight across the portfolio. Not org admin, not portfolio finance approval. |
| 11 | Estimator / QS | `estimator` | ⚠️ post-v1 | Portal | Cost library, estimates, tenders, quotes. No site operations. |
| 12 | Subcontractor (business) | `subcontractor` | ⚠️ post-v1 | App + Portal | A trade **business entity** engaged under Builder — distinct from an individual Tradie and from Builder himself; own crew, own POs, engagement-scoped. Waits on the cross-tenant identity-scoped evidence domain (§7.3). |
| 13 | Labourer / Apprentice | `labourer` | ⚠️ post-v1 | App | Attendance, assigned tasks, inductions only. Apprentice variant accrues CPC evidence (§9). |

**On the corrected identity model (App Design §3, Portal Design §1):** every
relationship in this system — PM↔Builder, Builder↔Tradie/Foreperson — runs through
three distinct events, not two: **Self-Registration** (independent, any role, own
pace) → **Introduction** (a QR business-card swap, any time, no job implied,
**resolved to rely on each party's own ordinary login, not a separate PIN**) →
**Job Award** (the later, formal, project-specific invitation, sourced only from an
existing contact book, **resolved as a lightweight in-app tap paired with the
deposit transaction as what actually makes it binding**). This replaces every
earlier "Register/Assign" reference in this project's history.

---

## 4. Navigation — field app

See `appdesignspecification.md` §4 for the authoritative navigation spec. Five
bottom tabs, unchanged in shape from the original MAOI port: Projects · Site ·
Safety · Quality · Profile. Sub-pages absorb every role-specific correction; the
tab bar itself never changes per role.

---

## 5. Database

The schema itself is owned by `serverdesignspecification.md`. In outline, the
domains it must express:

| Domain | Core tables |
|---|---|
| Identity | `organisations`, `users`, `devices`, `roles` (data, not enum), `sessions`, `pairing_events` (Self-Registration / Introduction / Job Award — §7 of the server spec) |
| Projects & stages | `projects`, `modular_units`, `project_stages`, `tasks` (`parent_id` nesting), `stage_templates` |
| Site operations | `site_diary`, `attendance`, `deliveries` |
| Safety & Quality | `hazards`, `incidents`, `inspections`, `hold_point_requirements`, `certificates`, `defects` |
| Commercial | `contracts`, `cost_plans`, `estimate_lines`, `purchase_orders`, `variations`, `progress_claims`, `material_selections` |
| Accounting & AU tax | chart of accounts, journals, payment runs, `fixed_assets`, GST/BAS/TPAR tables — **no payroll/PAYG/super tables: out of scope, see §11** |
| Verified Work History | evidence tiers, trust/credibility record, `cpc_evidence` (§9) — **the shared engine VeriTrade is the public face of** |
| Compliance | `ncc_register`, `compliance_register`, `risk_register`, `consultant_reports`, `drawings`/`drawing_markups` |

---

## 6. The 18-stage lifecycle

**The project lifecycle is the 18-Stage spec, v3.4 — not a reconstruction, not an
earlier matrix.** Every project instantiates the `WA_RESIDENTIAL_18` template;
optional modules layer on per project (cross-border/precast, milestone payment
terms, BIM, sustainability/BASIX).

- **App's slice:** Stage 1 (PM creates project + land-doc camera capture), Stage 6
  (material selection), Stage 7 (DA review + digital signature) are capture/review;
  Stages 10–18 are app-primary site execution.
- **Portal's slice:** everything else — Stages 2–5, 8–9 (including the Job Award
  invitation, sent from PM's own contact book), all AI-confirm-gated generation,
  council routing, Cost Plan, Programme.
- **Stage advancement is manual and tagged:** PM taps "Complete & Next Stage"; the
  server validates required data/docs; missing items tag the stage **INCOMPLETE**
  and block advance unless PM overrides with a recorded reason. The system guides;
  the PM decides.
- **`S1.3` — the single value that selects the Programme renderer.** At project
  creation, before anything else is built, PM declares building type/unit count
  (single dwelling, or multi-unit development and how many). This one value
  conditionally selects which Gantt renders later: standard bar-chart for one
  unit, Line-of-Balance flow view for more than one. This isn't a
  roadmap-priority engineering call between which project type to build for
  first — the Portal renders whichever the value on file actually needs. The
  LOB component itself still needs building; what's resolved is exactly *when*
  it's needed, the first time any project is created with more than one unit.
- **New in v3.4, worth flagging here as they ripple across the whole lifecycle:**
  `S10.5` (survey set-out) is now a hard hold point; `S16.7` introduces a
  genuine new statutory hold point (the mains energisation certificate,
  jurisdiction-dependent); `S18.11` splits into a draft-prepare step and a new
  `S18.12` approval gate held by the new Accountant/BAS Agent role (§3). Full
  detail in `serverdesignspecification.md` §8.

---

## 7. Verified Work History → VeriTrade

This is the differentiator, and the reason this framework exists in its current
form. **Every project interaction ProjMan already captures becomes evidence, and
a person's evidence follows them — not any one Builder, not any one tenant.**

### 7.1 What accrues, and from what

| Tier | Source |
|---|---|
| Primary (system-generated) | site diary entries, attendance, inspection pass/fail, on-time/on-budget completion, safety incidents |
| **Financial/contractual** *(the category that makes VeriTrade different from a review site)* | purchase orders, matched supplier invoices, payment records tied to a specific job |
| Secondary (multi-party) | client satisfaction at handover, peer review, dispute record (resolved, append-only per the Ethical Safeguards) |
| Tertiary (external) | state licence database cross-check, RTO trade certificates, insurance certificates, ABN verification |

### 7.2 Internal engine vs. public product

**Verified Work History is ProjMan's internal engine. VeriTrade is a genuinely
separate, standalone public product that VeriTrade is fed by it — not a page inside
ProjMan.** See `veritradedesignspecification.md` for the full spec. In outline:

- VeriTrade is **B2B**, not consumer — commercial builders, tier-1 contractors,
  and specialised trade businesses vetting talent. It is explicitly not a
  hipages-style homeowner review site.
- **Every VeriTrade login goes through the ProjMan App** — there is no separate
  password for an individual. This makes the App the identity root for both
  products, and is why Self-Registration (§3) has to be solid before VeriTrade can
  exist at all.
- Public, indexable **teaser profiles** (name, licence-verified badge, trade,
  headline verified-project count); full project-by-project evidence gated behind
  a paid B2B login.

### 7.3 The hard prerequisite: identity-scoped evidence, across tenants

Verified Work History sits in direct tension with the platform's hardest rule:
**tenant isolation** — nothing crosses the `org_id` boundary, proven by the
identity layer's isolation tests. Yet a Tradie's evidence must span many Builders'
tenants and be portable, owned by the individual — a cross-tenant flow the
isolation model otherwise forbids.

**The reconciliation:** project data stays locked inside each Builder's org; each
qualifying interaction emits a **signed attestation** into a **person-owned,
identity-scoped evidence store** living outside any one tenant. This is a **third
isolation domain** (identity-scoped, not org-scoped), which the current
single-`org_id` session model cannot yet express.

This becomes decision record **`PM2-02` — the identity-scoped evidence domain** and
must be resolved before any VeriTrade work begins, not discovered mid-build. Two
questions gate it:

1. Is a person a full account that **owns** a cross-org evidence record, or is a
   profile assembled only at read time?
2. Does a multi-Builder Tradie hold **one session with many project-grants**, or
   **many sessions switched between**?

**Recommendation:** resolve toward the "owned record" answer — it's the only one
consistent with VeriTrade's "immutable, tamper-proof" positioning; an
assembled-at-read-time profile can't make that claim honestly.

---

## 8. CPC50220 Diploma alignment — the professional framework

Kept from the earlier framework — still a real, valuable differentiator, now
explicitly tied to VeriTrade as well as to internal compliance:

- The seven capability gaps (NCC compliance, environmental, site establishment,
  service coordination, consultant management, plan viewer, structural compliance)
  map to CPC50220 unit codes via `cpc_units` / `cpc_feature_map`.
- `cpc_evidence` is emitted whenever a person performs qualifying work — the same
  primitive as §7.1's evidence tiers, projected onto a formal qualification. A
  trainee's Verified Work History **doubles as a self-filling RTO logbook.**
- **This inherits §7.3's unresolved isolation question directly** — a trainee's
  competency evidence must be person-scoped and portable across Builders, which is
  exactly what `PM2-02` has to solve. The evidence-*generation* half is gated
  behind that decision; the *reference and tagging* half (`cpc_units`,
  `cpc_feature_map`) has no such dependency and can land earlier.
- Three audiences, one dataset: the Builder gets compliance and hold-point
  enforcement, the trainee gets a self-filling competency portfolio, the RTO gets
  verifiable, timestamped, geo-located evidence of real workplace practice.

---

## 9. Ethical safeguards

Full detail lives in `appdesignspecification.md` §2.7–2.12 (this is where the
evidence architecture actually lives). Not a closing disclaimer — four safeguards
treated as necessary before any of this ships:

1. **Escalation & dispute** — a Tradie contests a verification to Site Supervisor
   first, never Builder.
2. **Portability & visibility** — private-by-default, portable always; publishing
   to VeriTrade is an explicit, revocable opt-in, never automatic.
3. **Invoice-gate footprint minimisation** — payment-linked capture stays
   task-specific, never grows into continuous tracking; short retention for
   granular capture, long retention only for validated milestones.
4. **Deactivation, not erasure** — an account can stop growing and come off any
   public listing immediately; already-relied-upon project evidence is retained
   under policy, not deleted.

A fifth, related point (v3.4, raised in external review): **a geofenced
timestamp alone is gameable** — one worker carrying a colleague's phone can
fake presence. No new mechanism is needed to close this; it needs to be
*relied upon deliberately*: tick-then-verify already requires an independent
Foreperson or Site Supervisor to separately confirm the physical work was
actually done, so faking proximity still has to fool a human looking at the
result, not just a phone's location. This has to be stated explicitly in the
build (`appdesignspecification.md` §2.5) — it's easy to design a UI that
treats a geofence match as sufficient by itself, quietly removing the real
safeguard.

Two named-not-yet-resolved asymmetries carried forward: the commercial-visibility
walls currently protect Builder's/PM's margins more than they protect the Client;
and the AI confirm-gate pattern is only as good as the confirming human's retained
expertise.

---

## 10. Australian compliance

- **Data residency:** all data — identity, PII, uploaded photos, the evidence
  store — stays on Australian infrastructure (AWS Sydney `ap-southeast-2` or Azure
  Australia East).
- **Privacy Act:** a person **owns** their Verified Work History; previous
  clients' details are anonymised in any reputation surfacing.
- **ABN validation:** modulus-89 checksum always; ABR API lookup when configured.
- **Tax:** GST/BAS, **TPAR** (mandatory for building & construction), diminishing-value
  depreciation. **PAYG withholding / superannuation payroll is CANCELLED — out of scope
  for ProjMan (2026-08-05, `serverdesignspecification.md` §12).**
- **Licence verification (new, for VeriTrade):** integration with state licensing
  boards is jurisdiction-specific and needs per-state confirmation before
  VeriTrade's "government licence verification" claim is made live — see
  `veritradedesignspecification.md` §6.

---

## 11. Build phases

| Phase | Content | Depends on |
|---|---|---|
| P1 | Skeleton port (MAOI → ProjMan), English-only, AU locale | — |
| P2 | Identity: register/login/recover/device pairing/OAuth | — |
| P3 | Sync v1: orgs, users, devices end-to-end | P2 |
| P4 | Projects: customers, projects, stages, tasks, `WA_RESIDENTIAL_18` template, incl. `S1.3`'s building-type/unit-count declaration at creation (§6) | P3 |
| P5 | Site ops: site diary, attendance, deliveries | P4 |
| P6 | Safety + Quality: hazards, incidents, inspections, hold points, defects, certificates | P5 |
| P7 | Commercial: estimating, POs, supplier invoices, variations, progress claims | P6 |
| ~~P8~~ | ~~Accounting: ledger, AU adaptation — GST/BAS, TPAR, fixed assets/depreciation~~ → **integration with Xero/MYOB/QuickBooks/MAVEN** (Owner scope ruling 2026-10-14) | P7 |
| ~~P9~~ | ~~AU payroll: PAYG, superannuation~~ — **CANCELLED 2026-08-05, out of scope for ProjMan** (`serverdesignspecification.md` §12) | — |
| **P10** | **Role/permission corrective migration** — add `builder`, correct `programme.write` scoping, three-step identity model, tick/verify split | P4–P8 must be stable first |
| **P11** | **Portal** — the single, role-scoped web console (absorbs what was previously split as "web console" + "public portal") | P10 |
| **P12** | **VeriTrade** — public teaser profiles, App-mediated login, B2B search/vetting | `PM2-02` resolved; P10–P11 stable |
| — | **Dashboard** (platform-ops) | independent track, gated only on identity + billing data existing — see `dashboarddesignspecification.md` |

### 11.1 Phase status (PM, 2026-10-14, verified against git)

| Phase | Status |
|---|---|
| P1–P4 | ✅ Built |
| P5 Site ops | ✅ Built (diary, attendance, deliveries) |
| P6 Safety + Quality | Quality ✅ (checklists v047, defects). Safety: v048 is built on branch `server/v048-safety`, **not landed**. Portal Safety screens run on mock data. |
| P7 Commercial | Partial. Builder gate v046 ✅. Client billing xprojman-43 APPROVED, not built (Steps 1–2 queued). Portal Client Invoices UI uses mock data. |
| P8 Accounting | Partial: org_journal (xprojman-42). GST/BAS export not built. |
| P10 Role corrective | ✅ (role model v2, xprojman-08) |
| P11 Portal | In progress: Documents, Defects, Gantt, Checklists, LOB built |
| P12 VeriTrade | Specced. Licence checks (x49 NSW, x52 QLD) wait on API.NSW credentials. **Lane paused, no session.** |
| Dashboard | Built (v007 + Finance module). Gaps: health panel, auto-refresh, reset/disable actions, audit-log prune. Spec refresh owed by Server. |

**Template:** `WA_RESIDENTIAL_18` is still the only seeded template. xprojman-43 adds `projects.site_state`, so state-specific rules (deposit caps, certificates) key off the project's state, not the template.

P1–P2 are pure porting. P5–P7 is new construction domain work. P8 is porting
again — MAOI's accounting with AU rules substituted. Payroll (PAYG/superannuation) is
explicitly out of scope for ProjMan — not a phase, not deferred.

---

## 12. Open decisions ledger

Consolidated from every design doc in this set, so nothing is silently assumed:

| # | Decision | Owner doc | Status |
|---|---|---|---|
| 1 | ~~`PM2-02` — identity-scoped evidence domain (owned record vs. read-time assembly; one session vs. many)~~ | this doc §7.3 | **RESOLVED 2026-07-22** (`decisions/projman-02.md`: A1 owned record + A1+B2 session synthesis, signed off owner+NexusPM). Mis-carried as open here since this doc was written; corrected 2026-08-05/06. **What blocks VeriTrade now is the build** (`engagements`/`identities`/`attestations` schema+endpoints, `serverdesignspecification.md` §13) — no decision-record work remains |
| 2 | Property Developer — permission + dashboard, not a new login-holder | Portal Design | Recommended, not yet signed off |
| 3 | PM's read-only wall over Builder's **schedule** — no exception path, ever. **Cost Plan visibility is no longer part of this item — it's mode-conditional, see #17** | Portal Design / Server Design | Specced, needs sign-off |
| 4 | ~~Line-of-Balance visualisation~~ | Portal Design | **Resolved:** `S1.3`'s declared unit count conditionally selects the renderer (§6). The LOB component still needs building — that part isn't a decision, it's a task |
| 5 | ~~Introduction PIN/QR mechanic~~ | App Design | **Resolved:** ordinary account login, not a separate PIN |
| 6 | ~~Job Award's exact signature mechanic~~ | App Design | **Resolved:** lightweight in-app tap, paired with the deposit transaction as the actual binding anchor |
| 7 | Single Builder per project assumed throughout | Portal Design | Carried forward, kept as the deliberate v1 default |
| 8 | Dispute-resolution SLA (auto-escalate to PM after how long?) | App/Portal Design | Open |
| 9 | Deactivation-vs-erasure — AU privacy law compatibility | App Design | Legal confirmation needed |
| 10 | VeriTrade B2B account model for organisations without individual Verified Work History profiles | VeriTrade Design | Resolved this pass — every login is App-mediated, no exception; see VeriTrade Design §4 |
| 11 | State-by-state licence-verification integration | VeriTrade Design | Legal/technical confirmation needed per state |
| 12 | Client-side protection asymmetry (commercial walls favour Builder/PM) | this doc §9 | Flagged, not designed |
| 13 | AI confirm-gate long-term erosion risk | this doc §9 | Flagged — consider periodic sampling audit |
| 14 | ⚠️ **Same question as xprojman-51 F1** (client sign-off on the PM's tablet). Both go to the solicitor (§13 L2). Does `job_awards.status='accepted'` (the `S9.7` tap + `S9.9` deposit pair) satisfy state home building contract execution legislation? | Server Design §7.3 | **Legal confirmation needed before this ships — not a design choice** |
| 15 | **New:** Accountant/BAS Agent (`S18.12`) — external/no-login indefinitely, or a dedicated paired login once volume justifies it? | Portal Design / Server Design | Founder call, gated on volume |
| 16 | **New:** `S16.7` state → energisation-certificate reference table (COES/CCEW/CoT&C/CoC/CES) — build/maintain in-house vs. source externally | Server Design §10 | Not decided; blocks `S16.7` going live in any state. Tracked as xprojman-45 §2.1 #2 |
| 17 | **New:** `builder_engagement_type` — can it change mid-project, and via what audited event? | Portal Design §9 / Server Design §10 | Not designed — a silent change would move the disclosure boundary unconfirmed |
| 18 | **New:** subcontractor pass-through consent — blanket clause at engagement vs. per-project re-confirmation | Portal Design §9 / Server Design §10 | Leaning blanket, not finally decided |
| 19 | **New:** in `employee` mode, is Builder's write access to the shared Cost Plan automatic, or a separate grant? | Portal Design §9 / Server Design §10 | Not designed — removing the wall doesn't by itself grant the write |
| 20 | Client in the App | xprojman-41 §0.1 | ✅ **RULED by the Owner on 2026-09-07:** Client is App-pairable. This doc's role #8 is corrected. The 18-Stage v3.4 §1.1 should be annotated to match (SA). |
| 21 | **New:** deposit caps per state (xprojman-43 §2.1): only VIC and WA are verified. Unverified states warn, verified states block (409). | xprojman-43 §12 | Statute verification by the solicitor (§13 L1) |
| 22 | **New:** Builder gate on Stage ≥10 starts | xprojman-45 | ✅ RULED B (SA, 2026-09-30); built v046 |
| 23 | **New:** licence-check display: badge only, "as at {date}"; never store DOB or address | xprojman-49/52 | 49 RULED. 52 F2 waits on the Owner |
| 24 | **New:** public site copy audit, 13 of 21 modules unbuilt | xprojman-53 | **Owner sign-off, live legal exposure** (§13 L8) |
| 25 | **New:** OS push (FCM/APNs) | xprojman-54 | Credentials (§14) |
| 26 | **New:** S8.8 hold point? (PM recommends no) | xprojman-roles §6 #19 | Owner |
| 27 | Identity root: ProjMan App vs Nexus AURA | §15, xprojman-55 | ✅ **RULED by the Owner on 2026-10-14:** separate systems, API exchange; link, never merge. |
| 28 | **New:** under-18 users (school-based apprentices) | §13 L5 | Block under-18 sign-up until a consent design exists. Owner. |
| 29 | **New:** re-scope xprojman-43 to "Payment milestones & claims": ProjMan computes milestone readiness, statutory gates (deposit cap, S18.3/S18.14 completion) and claim data, then hands off to Xero/MYOB/QuickBooks/MAVEN (CSV export in v1, API later). Keep, hide or retire what's already built (x42 org_journal, Portal Finance/Client Invoices mock). | §0 scope ruling | **Owner to confirm the re-scope.** x43 build is ON HOLD. |
| 29a | ✅ **RULED 2026-10-14 (xprojman-43 §14):** S18.12 is non-blocking (**annotates v3.4 S18.11/S18.12**); "Progress claim" naming; Xero → MYOB → QuickBooks; retention model; hidden tables retired after v1 launch. | xprojman-43 §14 | Ruled |
| 31 | **New:** Inspector scope. Roles #7 says write access is "exclusively `is_validated`", but the build gives the Inspector quality.write (create/complete inspections, raise defects, PATCH defects). Should the Inspector be unable to CLOSE defects (separation of duties)? | this doc §roles / server §15.4 | Owner. PM recommends: the Inspector may raise defects and record inspections, but **not close** defects (the builder fixes, the site supervisor/PM closes). |
| 30 | **New:** attendance boundary. Site sign-on (who is on site, for WHS/induction/evidence) stays in ProjMan. Time-for-pay attendance and rosters go to MAVEN+AURA. Sub-question from App: "actual hours logged" on a task (App spec §4.5, not built). PM recommends keeping it as task effort for job costing against the estimate, labelled "effort hours", **never used as a timesheet or for pay**. | §0 scope ruling | Owner to confirm |

---

## 13. Legal & compliance register (PM, 2026-10-14). Draft list for the Owner's solicitor (handover #13)

This replaces the "legal list" the PM owed under xprojman-roles §8 #13. Severity is the PM's assessment. **None of this is legal advice; each item needs the solicitor's confirmation.**

| # | Where | Issue | Law / regulator | Sev | Mitigation now |
|---|---|---|---|---|---|
| L1 | xprojman-43 §2.1 | Deposit caps unverified: the QLD ≥$20k rule is missing, NSW threshold wording is doubtful, SA needs checking, TAS/ACT/NT are absent | QBCC Act Sch 1B; Home Building Act 1989 (NSW); DBCA 1995 (VIC); HBCA 1991 (WA); BWC Act 1995 (SA) | High | Data table that blocks only on verified rows; others warn (agreed with Server 2026-10-14) |
| L2 | §12 #6/#14; xprojman-51 F1 | Job Award tap + deposit as contract execution; client sign-off on the PM's tablet. Home-building contracts need writing, signatures and a copy to the owner | Electronic Transactions Acts; state home-building Acts | High | Generate a signed PDF contract record and email the owner a copy. Don't ship #14 until the solicitor confirms. App's S18.14 mockup (2a42a07) offers 3 methods with none preselected and shows the pack contents + hash before signing. **The client statement is App's DRAFT** ("I confirm I have been given the handover documents listed above (pack reference …), and I accept the completed work." / the decline variant), and needs the solicitor's text. |
| L3 | App evidence capture (recordings, geofenced photos) | Audio/video of people on site | Surveillance/listening devices Acts (vary by state); Workplace Surveillance Act 2005 (NSW) | High | Photos of work, not people. Notice + consent before any audio/video. Workplace-surveillance notice for crews. |
| L4 | §12 #9; evidence retention | Indefinite retention; "deactivate, not erase" | Privacy Act APP 11.2/12/13; NDB scheme | Med-High | Retention/destruction schedule per record type: as-built indefinite, ATO 5 yrs, WHS ≥5 yrs, defects period by state (Portal §9 #22). Collection notices and access/destruction process (Portal §9 #20). NDB response plan. |
| L5 | Apprentices (15–16) | Minors on the platform | Privacy Act; Children's Online Privacy Code (in development) | High (once TAFE distribution starts) | Block under-18 sign-up (§12 #28) |
| L6 | VeriTrade profiles | Work/payment history feeding public profiles; dispute records | APP 6 secondary use; defamation | Med | Explicit opt-in. Never show counterparty financials. Dispute records stay private. |
| L7 | xprojman-49/52 | Use of licence-register data; badge wording | API.NSW / QBCC terms of use; ACL s18 | Med | Badge only, "as at {date}"; no DOB or address stored |
| L8 | product/ live site (xprojman-53) | Claims of unbuilt modules, "NCC compliance", SLA, testimonials | ACL s18/s29 (ACCC) | **High, live now** | Owner sign-off on xprojman-53, then a hot-fix. P0: the contact emails bounce. |
| L9 | Lab API | Real email/SMS sent from dev | Spam Act 2003 (transactional exemption still needs sender identification) | Low | Existing test accounts only; add a dev SMS/email sandbox |
| L10 | xprojman-43 claims | Payment claims, schedules, response timeframes. **SOP Acts exclude owner-occupier/resident-owner contracts**, so they apply to sub → builder and builder → developer, not builder → homeowner (Nexus Finance via xprojman-55 §4.1). | SOP Acts: NSW s13, QLD BIF s68 (*MWB v Devcon* [2024] QCA 94), ACT s15 | Med | Optional per-state SOP claim template with the statutory wording; record claim, schedule and due dates |
| L23 | xprojman-55 F1/F4 | Builder issuing RCTIs to subcontractors | ATO RCTI determination (written agreement required) | Med | "RCTI issued" variant only with a recorded written RCTI agreement per subcontractor |
| L24 | App inductions + SWMS sign-on (v048) | Signed acknowledgement statement on the phone ("I have read and understood this SWMS…", App's plain-English draft); visitor names captured | WHS Regs (SWMS must be reviewed and complied with; consultation); Electronic Transactions Act; APP 5 for visitors | Med | Owner/solicitor to approve the statement text; collection notice for visitors |
| L11 | xprojman-43 | Retention money; project/retention trust accounts | QLD BIF Act Ch 2 (trust accounts) | Med | Scope x43 v1 to **residential**; retention handling goes to the solicitor |
| L12 | xprojman-43 | Tax-invoice content | GST Act s29-70; ABN requirements | Med | "Tax invoice" wording, ABN, GST only if registered (Server §12). Voiding an issued invoice must produce an **adjustment note** (Portal §9 #17). |
| L13 | Dashboard Finance/payroll; CostCentre labour allocation | Payroll implications | STP Phase 2, SG, Fair Work | Med | Payroll stays out of ProjMan (P9 cancelled). Dashboard payroll is eBizco-internal only. Tradie payroll → MAVEN (§15). |
| L14 | Builder `employee` vs `independent_*` mode | Worker classification | Fair Work Act s357 (sham contracting) | Low-Med | Neutral copy; the app never classifies a worker |
| L15 | xprojman-48 Safety | Incident/induction record retention; notifiable incidents | WHS Act/Regs (records ≥5 yrs; notify the regulator) | Med | Retention class on Safety records; in-app "notify the regulator" reminder |
| L16 | Hosting | AU data-residency claim vs the actual host (auzora01) | APP 8 (cross-border disclosure) | Med | Owner to confirm where auzora01 is hosted |
| L17 | App onboarding | **No privacy policy link, terms acceptance or collection notice at register/onboarding** (App §11 L4) | Privacy Act APP 1/5 | **High before any real user** | Add policy + terms + collection notice to register/OAuth onboarding. Product drafts the text; the solicitor reviews. |
| L18 | App evidence photos | Gallery upload allowed and no capture-time hash, against v3.4 §1.4 "never a gallery upload" | Evidence Acts (weight of evidence) | Med | Camera-only for evidence, with a hash at capture (App amendment A1) |
| L19 | Dashboard platform payroll (eBizco-internal) | Each salary run pays the whole ANNUAL salary. PAYG/super hand-typed (≈0), no liabilities posted, no STP; P&L "PAYG withheld"/"BAS payable" are unreliable (server §15.6 R11) | Tax Admin Act (PAYG), SG Act, STP Phase 2, Fair Work | **High if used for real pay** | **Freeze real pay runs.** Owner: fix properly or use external payroll |
| L20 | Platform security (dashboard + roles) | `inspector` could DELETE documents (DocumentService.canCurate piggybacked on quality.write; never used, checked 2026-10-14). Fix v049: new `documents.delete` permission, which the Inspector doesn't get. Staff can bulk-export the login log (emails/IPs); CSV formula injection; spoofable X-Forwarded-For in the audit log; hardcoded seed password; wrong org_id on admin audit rows | Privacy Act APP 11 (security of personal info); NDB | High | Server: revoke in the migration after v048, then the dashboard fixes (in lane) |
| L21 | Defects / Stage 9 | No defects-liability/warranty period fields; no Home Warranty Insurance (HBCF/DBI) gate before work starts | State home-building Acts (statutory warranties; HWI before deposit/commencement) | Med-High | Add DLP/warranty fields to defects; HWI certificate as an S9 hold point. Solicitor confirms per state. |
| L22 | Evidence integrity | Frozen/hashed evidence is app-level only (no DB triggers); `job_awards.document_hash` hashes metadata, not the document | Evidence weight | Med | DB-level immutability and a content hash (Server) |

## 14. Blockers (PM, 2026-10-14)

| Blocker | Who | Holds up |
|---|---|---|
| Typed approval in Server's session to land v048 | Owner | v048 migration, TZ fix, x43 build, x51 reply → App S18.14 |
| Lab test accounts (PM/office portal login; field account → vphan 12 Pro Max by recovery) | Owner | Checklist E2E, Client Invoices check |
| Push 60+ commits, deploy product/, merge to `main` (slipped from 2026-10-09) | Owner | Live copy fix, `main` |
| xprojman-53 sign-off + P0 contact address | Owner → Product | §13 L8 |
| Credentials, in order: SMTP, API.NSW, Maps, Google origins, pm2, Apple/Firebase | Owner | Email, NSW licences, push |
| Rulings: x50 F6/F11, x52 F2, S8.8, §12 #20, #27, #28 | Owner | Pairing, QLD badge, client-in-App |
| Solicitor review of §13 | Owner | L1–L5, L10–L11 |
| Decisions: document object storage; "record only" vs lodging with the regulator/ATO/STP; AI/OCR provider | Owner | S3/S5 AI stages, Safety notifications |
| VeriTrade lane paused (follow-up on VIC/WA letters due 2026-10-21) | Owner | P12 |

## 15. Ecosystem: AURA and MAVEN (Nexus project), Owner 2026-10-14

The Owner encourages tradies, builders and developers to also use **AURA** (personal app) and **MAVEN** (business app), both built by the separate eBizco **Nexus** project.

Facts from the Nexus PM (`nexus-86`, 2026-10-14):
- MAVEN is a voice-first POS. Its deepest template is food & drink; the 'services' type covers hotel/lodging only, with **no tradie flow yet**.
- AURA is personal: sealed chat/calls, contacts, AI chat. AU chat/calls are off in v1.
- AU trial: Canberra, Nov 2026. Any tradie flow comes after the trial.
- No shared auth, broker or gateway. Integration would be API-to-API with per-user consent, **link, never merge** identities.

**✅ RULED by the Owner on 2026-10-14: "separate, with an API exchange". See xprojman-55.** MAVEN/AURA have built-in AI IVR and target small-business POS (F&B, Retail, Services/tradies, Transport, Manufacturing), with their own portal. Positioning:
- **ProjMan** = the construction project: 18 stages, crew, site, quality, safety, client milestone billing (x43).
- **MAVEN** = the tradie's own small business: quotes, call-outs, invoicing their customers and the builder, GST/BAS, payments. Payroll lives here, never in ProjMan.
- **AURA** = the person. Candidate home for the portable credential wallet and the CPC logbook (§9). This needs an Owner ruling on the identity root (§12 #27).
- Candidate handoffs, all needing consent and an xprojman contract:
  - a ProjMan job award → a MAVEN job;
  - a MAVEN invoice to the builder → a ProjMan supplier bill;
  - the ProjMan Verified Work History badge → the MAVEN profile.
- **No integration work** in any lane until the Owner rules.

**Nexus PM's preliminary answer on accounting (2026-10-14):** recommends option (a): ProjMan exports claims, bills and contractor payments to the builder's own Xero/MYOB/QuickBooks (CSV, then their APIs). Don't build our own ledger, and don't use MAVEN as a builder's books.
- MAVEN's books are POS/venue-first, with no progress claims, SOP, retention trusts or multi-party GST.
- Taking on tax lodgement would put compliance on eBizco.
- MAVEN may later serve SMALL tradies (quote → job → invoice, post-Nov 2026) with a Xero/MYOB export, and a ProjMan badge link first.
- Final facts (Q1–Q5) are still to come.

PM proposal (2026-10-14), pending the Owner: ProjMan builds the construction-specific money records (payment claims with SOP and deposit-cap checks, variations, retention, bills against the cost plan, GST amounts). It does not build the general ledger, BAS/STP lodging, payroll or depreciation. Hand-off: CSV in v1, a unified accounting API (Codat/Apideck/Merge) in v2, MAVEN later.

---

© eBizco Australia Pty Ltd
