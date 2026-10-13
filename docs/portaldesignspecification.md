# ProjMan — Portal Functional Specification

**Status:** Functional specification of record
**Date:** 27 July 2026 · **Updated:** 14 October 2026 (Portal Agent): §3.5 is now the
build status of record, §6.1 is aligned to v3.4's billing-milestone task codes and the
Client Billing contract (xprojman-43), and §9 gains the legal-risk and blocking items
(rows 16–27). Where an older passage in this doc says "built", "queued" or "blocked",
§3.5 wins.
**Owner:** eBizco Australia (Vince Phan)
**Source of truth:** *ProjMan — The 18-Stage Construction Lifecycle, Fully
Decomposed*, v3.4 — cited as "the 18-Stage spec"; section numbers refer to its
Part 1, stage codes (`S1.1` etc.) to its Part 2, safeguards to its Part 4.
**Companion docs:** `appdesignspecification.md` (App — the field companion) ·
`devroadmap.md` (roles, build phases, VeriTrade relationship) ·
`veritradedesignspecification.md` · `serverdesignspecification.md` ·
`dashboarddesignspecification.md` (a genuinely separate, platform-ops-only tool —
never confuse the two; see §0) · `docs/decisions/xprojman-27.md` (the full
Portal-vs-App split across 20 modules named by the owner 2026-09-01, several
not yet in this catalogue — see §3.4's build-status note) ·
`docs/decisions/schema-relationship-map.md` (verified table-by-table build
status against the live schema, not this doc's own claims — cited wherever
this spec's "already built" language has since been corrected) ·
`docs/decisions/xprojman-29.md` (task-level cost-centre request to Server —
invoice/HR-hours attribution, feeds §3.4 modules 18/19 below) ·
`docs/mocked/portal/` (static HTML mockups, reviewed before any of §3.4
modules 16-19 get wired to live data — see the "mocked before wired"
convention noted per-module below)

---

## 0. What Portal is, and what it is not

**Portal is one application.** It is the desk-analytical companion to the App,
and it serves every desk-based role — Property Developer, Project Manager,
Builder, Site Supervisor (review), Inspector (review), and Client — through
permission-based scoping inside a single codebase. It is **not** three separate
products, and the Client's view inside it is **not** a "public portal": it is an
authenticated, single-project-scoped view for one named client, on the same
session model as everyone else.

Two other things sometimes get confused with Portal and are deliberately not this
document's subject:

- **Dashboard** is a completely separate application — eBizco's own internal
  platform-operations tool (login telemetry, billing, device health across every
  tenant). No tenant, and no tenant role, ever sees it. See
  `dashboarddesignspecification.md`.
- **VeriTrade** is a completely separate, public-facing product — a B2B
  professional network fed by evidence this Portal and the App produce, but built,
  hosted, and branded independently. See `veritradedesignspecification.md`.

---

## 1. Role model

| Role (slug) | What they are | Tenant model | App? | Portal? |
|---|---|---|---|---|
| **Property Developer** (`developer`) | The commissioning/funding principal | Same org as PM in v1 | No | Yes — narrow, portfolio-level |
| **Project Manager** (`projectManager`) | Portfolio actor, Stages 1–9 near-sole actor, **read-only oversight** from Stage 10 | Own org | Yes — recall/notes only | Yes — full |
| **Builder** (`builder`) | Engaged via Job Award at Stage 9; runs Stages 10–18 execution; appoints his own crew | **Same-tenant v1** | Yes — Introduction/Job-Award/oversight/capture | Yes — full, scoped to his own engagement |
| **Site Supervisor** (`siteSupervisor`) | PM's **own** independent on-site rep — explicitly *not* a subset of Builder's role | Same org as PM | Yes — primary, capture-first, daily driver | Yes — read-only review |
| **Foreperson** (`foreperson`) | Builder's crew lead | Same tenant as Builder | Yes — primary | Minimal — self-service only |
| **Tradie** (`tradie`) | Builder's crew / self-employed trade | `self` scope; identity individually owned | Yes — primary | Minimal — self-service only |
| **Inspector** (`inspector`) | External certifier, engaged at 6 defined checkpoints only | External org (cross-org deferred) | Yes — Quality-only | Yes — reports/history |
| **Client** (`client`) | One authenticated project-scoped role, inside Portal — never a separate product | External, never same tenant | **No — never** | Yes — own project only |
| **Accountant / BAS Agent** (`accountant`) | New in v3.4: the mandatory `S18.12` approval gate before fixed-asset/ATO lodgement fires | External, no-login by default (mirrors Structural Engineer) | No — unless volume ever justifies a paired login | Yes — narrow, the approval gate only |

### 1.1 Builder — a first-class role

`contracts.party_type='subcontractor'` already covers Builder as the
largest-scope subcontracted entity. He has his own scope class (`assigned`,
resolved against *his own engagement*, not PM's project list) and his own
permission set (§5).

### 1.2 Property Developer

| Situation | How it's modelled | New role needed? |
|---|---|---|
| An **external** principal commissions the whole development (arms-length) | `client` role, `client_tier = development` (vs `unit` for an individual buyer at Stage 6) — portal-only, same commercial-visibility walls as any Client | No — a Client variant |
| The founder's **own** company self-funds a spec-built development | A `funding_source` attribute per project/unit (`external_client` \| `developer_capital` \| `construction_finance`) + a narrow **Development/Portfolio Dashboard** gated on `development.read` | No — a permission + a dashboard, not a login-holder |

**Recommendation:** ship both — see Open Decisions (§9).

### 1.3 PM's read-only wall over Builder's authored schedule

> From the moment Builder is engaged (Stage 9) onward, PM's access to Builder's
> job breakdown and Programme/Line-of-Balance schedule is **read-only, without
> exception.** PM reads Builder's authored plan and progress; he never has a
> parallel write or override path into it — not a redaction of a shared
> record, a genuinely separate table Builder alone authors.

This holds **regardless of engagement mode** (§1.4) — it protects who is
operationally running the job day to day, which is a different question from
who bears commercial risk. It must not carry any override path, under any
permission grant, any role, or any emergency-access design. If PM genuinely
needs to force a schedule change (e.g. a dispute or a Builder default), that is
a **Variation or a contract action against Builder** (§4.3, §7), never a direct
edit into Builder's Gantt.

**Cost Plan visibility is a separate wall, and it is not unconditional — see
§1.4.** The Builder's *margins* being unconditionally private was true only
for one of three engagement shapes; stating it as an absolute rule (as an
earlier pass of this document did) was a real defect, corrected here.

### 1.4 Builder engagement modes — visibility scales with risk

**The underlying principle, stated once so three rules read as one:**
whoever bears the risk of a cost overrun earns the right to keep their cost
structure private. Whoever is protected from that risk — because the other
party absorbs it — owes transparency in exchange. This isn't an arbitrary
design choice; it's the same logic that makes open-book accounting standard on
cost-plus and government contracts generally, and it's the exact reasoning
already applied to material-selection pricing (§6.3 of the 18-Stage spec):
cost-plus only means something if the cost is real and disclosed, with an
agreed, visible margin. This section applies that same sentence to the whole
Builder relationship, not just one selection line.

Every Builder engagement carries a `builder_engagement_type`, set at Job Award
and visible to PM:

| Mode | What it is | Who bears cost-overrun risk | Cost Plan visibility to PM |
|---|---|---|---|
| **`independent_fixed`** | Builder is a separate business, paid a fixed/lump-sum head-contract figure | **Builder** — he eats a blowout, keeps the upside if he runs efficient | Head-contract figure, plus **the subcontractor engagement register (who/committed/owed) — not a concession, a standing requirement regardless of pricing model, to support step-in rights if Builder becomes insolvent.** Margins and rates stay private — the wall as originally specced. |
| **`independent_cost_plus`** | Builder is still a separate business, paid actual cost + an agreed, disclosed commission | **PM/Client** — they absorb actual cost | **Full disclosure of cost and commission — this is what makes cost-plus an honest pricing model rather than a fixed price wearing a disguise.** Hiding it would let Builder extract margin with no accountability, the same conflict-of-interest shape flagged for undisclosed referral commissions. **Extends to job costing and the supplier/subcontractor register in full, not just the head-contract figure** — subject to the pass-through consent gate below for what "in full" means at a specific subcontractor's line. |
| **`employee`** | Builder is not a separate business at all — an employee of PM's/Property Developer's own company | **The company** — there is no second party's margin to protect | **Full visibility, and it isn't a concession.** There is only **one** Cost Plan, not a private one nested under a head-contract line — an employee Builder has spending authority within it, not a separate ledger. Full visibility here is simply what "not a separate entity" already means. |

**A real data-modelling consequence, not just a visibility one:** in the two
`independent_*` modes, Builder runs his **own, separately-nested Cost Plan**
underneath PM's (PM's Cost Plan shows Builder's head-contract figure as one
line — §3.1). In `employee` mode, **there is no second Cost Plan to nest** —
it's the company's single Cost Plan throughout, and the read-only-wall
language in §1.3/§3.1 simply doesn't apply, because there's no independent
entity's ledger left to wall off.

**This does not contradict the existing rule that an employee Builder lacks
portfolio-wide financial visibility (§3 role model, `devroadmap.md`).**
Direction matters: that rule is about Builder looking **outward/upward** —
into the company's *other* projects and finances, which he still shouldn't
see regardless of engagement mode. This section is about the company looking
**inward**, at the one project it's running through its own employee, which
it obviously can. Different direction, same architecture — stated here
explicitly so the two rules are never read as fighting each other.

**New requirement this creates — the subcontractor consent chain:**
`independent_cost_plus` and `employee` mode expose Builder's (or, once
subcontractors are engaged, a subcontractor's) cost detail up the chain to PM.
A subcontractor agreed to disclose his pricing **to Builder** — he didn't
necessarily agree to **PM**, a party he has no direct contract with, seeing
it too. Builder's own subcontractor engagement agreements need their own
**subcontractor pass-through consent clause**, mirroring whatever Builder agreed to with PM, or
the transparency designed here quietly becomes a privacy problem for a third
party who was never in that conversation. Modelled server-side as a consent
flag per subcontractor engagement (`serverdesignspecification.md` §7.2.1) —
without it, that specific subcontractor's line-item detail stays redacted
from PM's view even in a fully transparent engagement mode, regardless of what
the aggregate claim shows.

**Independent of the client-facing wall — stated explicitly so it's never
assumed otherwise:** whichever `builder_engagement_type` PM chooses with Builder is
**completely independent** of whatever `pricing_model` (fixed | cost_plus) the
Client sees on their material selections (§6.3 of the 18-Stage spec). PM could
run `independent_cost_plus` with Builder while still quoting the Client a
fixed price on the house. The client-facing wall doesn't move just because the
PM–Builder wall did — these are two separate settings on two separate
relationships, never coupled.

---

## 2. Portal architecture — route groups per role

| Route group | Who | Scope |
|---|---|---|
| `(console)/*` | Project Manager | `assigned` |
| `(builder)/*` | Builder | `assigned` (own engagement) |
| `(review)/*` | Site Supervisor, Inspector | `assigned` / `engagement` |
| `(profile)/*` | Foreperson, Tradie | `self` |
| `/client/*` | Client | `portal` (own project, `client_tier` aware) |
| `/developer/*` | Property Developer / `development.read` holder | `portfolio` (development) |
| `/` `/login` `/signup` | visitors | none |

Each group gates at the layout on **permission**, not role name.

---

## 3. Cross-cutting Portal capability areas

### 3.1 Commercial, job costing, tracking, paying, monitoring — PM & Builder

**Every row below is conditional on `builder_engagement_type` (§1.4) — this table was
previously written as one unconditional rule, which was a defect.**

| View | PM sees — `independent_fixed` | PM sees — `independent_cost_plus` | PM sees — `employee` | Client sees |
|---|---|---|---|---|
| Head-contract figure (PM↔Builder) | ✅ | ✅ | n/a — one company Cost Plan | ❌ |
| Builder's subcontractor engagement register | ✅ *(step-in-rights basis)* | ✅ *(step-in-rights basis)* | ✅ — it's the company's own engagement | ❌ |
| Builder's own margins/rates | **❌ — never, not even by permission grant** | ✅ — full disclosure, cost + agreed commission | n/a — no separate margin exists | ❌ |
| Subcontractor-level cost detail | not applicable (Builder's private ledger) | gated on that **subcontractor's own pass-through consent** (§1.4) — not automatic just because Builder's mode is transparent | gated on the same consent flag — the company can see its own contracts, but a sub's specific rate still needs their consent to surface at PM's granularity | ❌ |
| Cost Plan (estimated/committed/actual/claimed) | ✅ **read of Builder's figures** — no edit path | ✅ **read of Builder's figures**, including actual-cost lines | ✅ **read/write** — it's the one shared company Cost Plan, not a read of someone else's | coarse status only |
| Billing milestones | ✅ full | ✅ full | ✅ full | ✅ — coarse, client-facing event only |
| Progress claims (Builder → PM) | ✅ approve/decline | ✅ approve/decline | n/a — internal cost movements, not a claim between two parties | not visible |

**Progress claims vs billing milestones are two different tables/workflows**,
not one PATCH endpoint: progress claims are the internal Builder→PM commercial
mechanism (`independent_*` modes only); the six billing milestones (§6.1) are
the client-facing event that happens to be triggered by the same underlying
stage validation, and exist regardless of engagement mode.

### 3.2 Job breakdown, schedule, monitoring — Builder authors, PM reads only

- **Job breakdown (`S9.10`):** Builder sets task-level scope (`project` |
  `unit`) once assigned; system proposes defaults, **Builder** confirms/
  overrides — this is Builder overriding the system's suggestion, not PM
  overriding Builder.
- **Gantt / Line-of-Balance:** Builder's authored schedule. **PM's Portal view
  of it is a read, full stop** — see §1.3. Open question whether the existing
  Gantt library needs a genuine Line-of-Balance chart type for multi-unit work,
  or a filtered/grouped Gantt suffices (§9).
- **Job Monitoring Loop:** "Portal for planning, System for comparison, App for
  notification." The comparison is a System job, surfaced as a dashboard both
  Builder and PM watch — **only Builder edits the plan it's measured against.**
- **Notification routing respects the commercial-visibility walls:** a
  cost-overspend flag never reaches the client; a milestone-reached flag does,
  without cost detail.

### 3.3 Documents, inspection logs & reports — Builder, Site Supervisor, Inspector

Document repository grouped by stage/unit, inspection log viewer tagged
`statutory`/`internal_qa`, standard + custom reporting.

### 3.4 Full module catalogue

| # | Module | Purpose | Primary role(s) |
|---|---|---|---|
| 1 | Commercial / job costing (§3.1) | Cost Plan, progress claims, billing milestones | PM, Builder |
| 2 | Job breakdown / schedule / monitoring (§3.2) | Builder's authored programme, PM's read | Builder (write), PM (read) |
| 3 | Documents / inspection logs / reports (§3.3) | Central evidence repository | Builder, Site Supervisor, Inspector |
| 4 | Compliance & Hold-Point Command Center | `hold_point_requirements` is a checklist, not a boolean; a cross-project queue tagged statutory vs internal QA and by required inspector type. Two additions: a `jurisdiction` field (Stage 16's mains energisation certificate — COES/CCEW/CoT&C/CoC/CES — and Stage 2's BAL/flood report use the same conditional-requirement pattern); and Stage 10's survey set-out (`S10.5`) is now a hard hold point, not recorded evidence only | PM |
| 5 | Verified Work History / Credibility Center | Reviewing a role's record before a Job Award — the Portal-side view of what the App builds | Builder, PM |
| 6 | Panel & Roster management | PM's Builder panel, Builder's Tradie/Foreperson panel. **Self-Registration** happens independently on each individual's own account. **Introduction** happens on the App, any time. **Portal is where Job Award is initiated** — PM selects a winning Builder at `S9.5` and sends the formal invitation (`S9.6`); the accept/decline (`S9.7`) may land back here or on the App | PM, Builder |
| 7 | Variations & Progress Claims workspace | Two distinct workflows, both audited via the frozen/hashed pattern | PM, Builder, Client |
| 8 | Handover & As-Built Vault | A query, not an authoring task, over evidence since Stage 10; long/indefinite retention class for validated milestones, distinct from the shorter retention appropriate to granular day-to-day capture | PM |
| 9 | Consultant & Rate-Card management | DA-phase costs absorbed under a pre-negotiated rate card, tracked internally to measure cost-to-win | PM |
| 10 | Legal/Compliance register | Five items flagged "confirm against current legislation" — a maintained register, not hard-coded copy | PM |
| 11 | Client Communications Center | Every client-facing send, correlated to the frozen/hashed pattern, as one timeline | PM |
| 12 | Accountant / BAS-Agent seat | **Resolved as a new role.** `S18.11` now only prepares the fixed asset entry/depreciation schedule as a draft, no external transmission; `S18.12` is a new protected **approval gate** — an Accountant/BAS Agent reviews and approves before ATO lodgement fires. Likely an external, no-login party (PM uploads their sign-off), same pattern as the Structural Engineer/Surveyor, unless volume ever justifies a dedicated paired login | Accountant/BAS Agent (new), PM (uploads on their behalf if no-login) |
| 13 | Disputes oversight | PM's read-only visibility into escalated verification disputes and their resolution — Site Supervisor is the first-line adjudicator, Builder is never the final word | PM (read), Site Supervisor (act) |
| 14 | Deactivation (not deletion) in Organisation → Users | "Delete account" must mean deactivation for anyone with relied-upon project evidence — built into the language and the action, not just the backend | PM / Org Admin |
| 15 | VeriTrade opt-in visibility (read-only flag) | Whether a given person's profile is also opted-in to VeriTrade is their own toggle; Portal shows it read-only, never editable by PM/Builder on someone else's behalf | PM, Builder (read) |
| 16 | Checklist template builder | Author/configure reusable checklist templates (inductions, plant pre-starts, toolbox talks) — a generalisation *beyond* module 4's hold-point-gating checklists, which stay narrowly `hold_point_requirements`-backed. App executes against whatever's published | PM (author), on-site roles (execute, App) |
| 17 | Safety/OHS management dashboard | Policy register, incident investigation, WHS trend reporting — the Portal-side oversight view of daily hazard/incident capture. **No backing schema exists yet for hazard/incident capture itself** (`schema-relationship-map.md` §0, 2026-09-03: no `hazards`/`incidents` table anywhere in the schema, only prose mentions) — Portal build here needs to coordinate schema with Server, not assume the App-side capture surface already exists. *(Superseded: the schema is v048, xprojman-48; status in §3.5.)* | PM |
| 18 | Project List — alert-level triage | The office's actual landing screen (organisation → its projects, not a single project). Per project: stage progress (%), budget-used (%), and a composite **Alert level** — see formula below. **Mocked, not wired** — `docs/mocked/portal/project_list.html`, reviewed 2026-09-03 | PM, Property Developer |
| 19 | Task-level stage breakdown | Click a stage on the Project Overview roadmap → its tasks: description, drawings/reports, start/end date, invoice (if outsourced), HR hours used, assigned-to, output. **Blocked on task-granular cost data** — see `xprojman-29.md`; invoice/HR-hours fields render a "pending XP-29" placeholder until that lands, everything else (description, dates, assignee) is already real schema (`tasks` table) | PM, Builder |

**Alert-level formula (module 18), proposed 2026-09-03 — not finally decided:**
composite of (a) Budget% running ahead of Schedule% (the classic overrun
signal — e.g. 91% of budget spent at 72% of stages complete), (b) project
`status = 'on_hold'` while spend continues, and (c) — not yet in the mockup,
flagged here for the next pass — overdue defects and a stage stalled behind
an unmet hold point (`hold_point_requirements.status = 'open'` blocking
`blocks_progress`). (a)/(b) are mocked; (c) needs its own threshold pass
before it's added to the visual.

**Build status:** see §3.5. The 2026-09-03 snapshot that used to sit here is superseded.
See `xprojman-27.md` for the full 20-module Portal-vs-App split. It overlaps this catalogue
in places and goes beyond it in others: Insurances, Tickets, Actions, Locations, SDS,
Drawings, RFI, Submittals, Permits, Emergency evacuation and the NCC AI assistant aren't in
this table yet. `schema-relationship-map.md` records what is actually built against the
live schema.

### 3.5 Build status of record — 14 October 2026

Checked against `server/portal/src/app/` and git on `server/p5-site-ops`, not against
earlier status notes. Legend:
- **Live** — built and verified against real `:5100` data.
- **Built** — code is committed and compiles; not yet exercised against real data. (The
  lab API was down from 2026-09-30 to 2026-10-14, and test logins are still pending from
  the Owner.)
- **Mock** — screens are committed and run on an in-memory mock with the contract's
  response shapes. Going live means flipping one flag.
- **Specced** — a contract exists, but no Portal code yet.
- **Not started** — neither.

| # | Module | Status | What exists (route · commit · contract) | Waiting on |
|---|---|---|---|---|
| 1a | Cost Plan + Forecast at completion | Live | `/projects/[id]/cost-plan`; forecast = budget-weighted % complete (xprojman-42 §9) | — |
| 1b | Progress Claims (Builder → PM) | Built | `/projects/[id]/claims`: submit / approve / decline / pay, CLAIM_BLOCKED freeze | Live test |
| 1c | Finance: chart of accounts, P&L, Balance Sheet, Expenses, Sales | Live | `/finance/*`, `7ecacc4` (xprojman-42 §2/§3) | — |
| 1d | **Progress claims to the client** (6 milestones; "Client Invoices" until O3, x43 §14) + **Accounting export** + export codes | Mock | `/finance/progress-claims`, `/finance/progress-claims/[id]`, project **Payment schedule** tab (milestones, readiness gates, claims), `/finance/export` (CSV, Xero first), Finance → Settings "Accounting export codes". `CLIENT_CLAIMS_MOCK` / `ACCOUNTING_EXPORT_MOCK`. Contract: x43 §12–§14; see §6.1. Ledger screens (CoA, P&L, BS, Expenses, Sales) sit behind `NEXT_PUBLIC_ACCOUNTING_SCREENS`, paired with Server's `FEATURE_TENANT_LEDGER` | Server's x43 R1–R5 (after v048, inspector, dashboard security) |
| 2a | Builder Programme (stages, authoring) | Built | `/builder/programme`, `/builder/programme/[id]` (`a2287db`) | Live test |
| 2b | Gantt / Job Scheduler (read-only) | Built | `/projects/[id]/schedule` (`b6d7846`, xprojman-39 §4 v1) | Live test. Drag-write: not started |
| 2c | Line-of-Balance renderer (unit count > 1) | Not started | §9 #3 | — |
| 3a | Documents repository | Live | `/projects/[id]/documents` (`9180249`, xprojman-28 §2) | — |
| 3b | Defects management (edit, close-out) | Built | Quality tab, `PATCH /projects/:id/defects/:defectId` (`ea221de`) | Live test |
| 4 | Hold points | Built (per project) | Field tab: per-stage checklist, satisfy a requirement, verify a ticked task | Cross-project command-centre queue: not started. `jurisdiction` / `projects.site_state`: Server (xprojman-45 §2.1) |
| 5 | Verified Work History / Credibility Center | Not started | Server side exists (PM2-02, v027) | Portal design pass |
| 6 | Panel & Roster + Job Award send | Built | `/panel`, `/builder/panel`, shared `PanelView` (`013b6be`); `trade_offered` (`babc051`) | Live test (xprojman-44 send + consent) |
| 6b | Subcontractor engagements + pass-through consent record | Built | `/builder/subcontractors` (`babc051`, xprojman-44 Module C, v045) | Live test |
| 6c | Job Award inbox (Builder) | Built | `/builder/job-awards`, legacy `/job-awards` | Live test |
| 7 | Variations | Not started | — | Design pass (§9 #13 affects it) |
| 8 | Handover & As-Built Vault | Specced | xprojman-51 (S18.14 client sign-off, Handover card) | Schema (Server) and Owner F1 |
| 9 | Consultant & Rate-Card | Not started | (Cost Rates / Cost Centres in `/finance/settings` are task cost types, not this) | — |
| 10 | Legal/Compliance register | Not started | — | §9 rows 16–27 are its first content |
| 11 | Client Communications Center | Not started | The Project Brief PDF snapshot history (formalise / re-issue) is built on the project edit page | Customer pairing (xprojman-50) |
| 12 | Accountant / BAS-Agent seat | Not started | — | §9 #12 |
| 13 | Disputes oversight | Not started | — | — |
| 14 | Deactivate, not delete (Organisation → Users) | Not started | `/organisation/users` lists users; there's no deactivate action yet | — |
| 15 | VeriTrade opt-in flag (read-only) | Not started | — | — |
| 16 | Checklist template builder + project checklist review | Built | `/organisation/checklists`, Quality tab review (`7521d5a`, xprojman-46, v047). Field names checked against `ChecklistService` 2026-10-14 | End-to-end test with App (iPhone XS): blocked on test logins |
| 17 | Safety/OHS (events, investigate/respond/close, notifiable, inductions, SWMS register, trend) | Built (on live v048) | `/projects/[id]/safety`, `/safety`, `/builder/safety` (`aaff592`, xprojman-48). Field names checked against v048 `SafetyService` 2026-10-14; date round-trip fixed | `SAFETY_MOCK` flipped off 2026-10-14 (routes confirmed on the lab). Live test waits on test logins |
| 18 | Project List (alert-level triage) | Built, real data | `/projects` (`008315e`); status enum, cancel / delete-draft | Alert-formula part (c) (§3.4) |
| 19 | Task detail (stage → task) | Built | `/projects/[id]/tasks/[taskId]`: output / notes, attachments with PDF / image markup, PO raising, cost centre (money.write) | Live test |
| — | Project create wizard / edit / Brief PDF | Built, real data | `/projects/new`, `/projects/[id]/edit` | — |
| — | QR sign-in with the App | Live | `AppLoginModal` (xprojman-31) | — |

**Cross-cutting, 14 October 2026:**
- The API returns DATETIMEs as `'YYYY-MM-DD HH:MM:SS'` wall-clock strings (mysql2
  `dateStrings`), not ISO. Safety and Progress claims normalise to `'T'` before parsing
  (Safari rejects the space form). About 18 older pages still call `new Date(v)`
  directly; Safari is on the live-test list.
- Until Server's TZ fix lands with v048, the lab API runs in UTC, so expiry times are
  8 hours lenient. That isn't a Portal defect.

---

## 4. Per-role Portal specification

### 4.1 Property Developer

Portfolio-level pipeline/funding view, `development.read`, read-only in v1. See
§1.2 for the modelling decision.

### 4.2 Project Manager

- Stages 1–8 sole-actor work: project/customer creation, Stage 2 audit review,
  Stage 3/5 AI-output confirm-gates, Stage 4 routing decision, Stage 6 architect
  coordination + client tier/material review, Stage 7 DA release check, Stage 8
  CC/Home Warranty tracking.
- Stage 9: BOQ, tender issue/comparison (`S9.1`–`S9.5`), then **sends the Job
  Award invitation (`S9.6`) from his own contact book** — Builder must already
  have completed Self-Registration + Introduction with PM before this step is
  available; this is not the first time PM and Builder have interacted, only the
  first time it's project-specific. **The Job Award also fixes the engagement's
  `builder_engagement_type` (§1.4)** — `independent_fixed`, `independent_cost_plus`, or
  `employee` — which determines everything downstream about Cost Plan
  visibility; this isn't a later configuration step, it's decided here.
- Ongoing oversight from Stage 10 on: Cost Plan **(visibility set by
  `builder_engagement_type` — §1.4 and §3.1; never an edit path into an independent
  Builder's own ledger, full read/write on a shared `employee`-mode Cost
  Plan)**, **Programme/Line-of-Balance — read-only, no override, full stop,
  regardless of mode (§1.3)**, Quality/Safety review, Compliance & Hold-Point
  Command Center, Client Communications Center, Variations (raise), Progress
  Claims (approve/decline, `independent_*` modes), Disputes oversight (read).
- Admin: users (incl. deactivation, not deletion), devices, org settings, audit.

**Permission set:** `org.manage`\*, `users.manage`, `devices.manage`,
`customers.read/write`, `projects.read/write`, `progress.write` *(Stages 1–8
only)*, `money.read` *(scope and depth set by `builder_engagement_type` — §1.4; never
a `money.write` into an independent Builder's own cost structure; full
read/write on an `employee`-mode Cost Plan since it's the company's own)*,
`claims.approve`, `variations.raise`, `documents.read/write`, `disputes.read`.
**PM's programme permission from Stage 9 onward is `programme.read` only,
unconditionally** — any Stage 1–8 internal task adjustment is covered by
`projects.write`, not a separate schedule-write grant. **Scope:** `assigned`.
(\* `org.manage` is what carries `development.read` by default in v1.)

### 4.3 Builder — Portal console

- **Job Award response** — Introduction with PM may have happened long before;
  the Portal shows the formal invitation (`S9.6`) landing here (or its App
  equivalent) for Builder to review and accept/decline (`S9.7`).
- **Subcontractor engagement** — his own tender/engagement of trade subs; PM
  sees the *register* (who/committed/owed) via step-in-rights visibility
  regardless of mode, never a specific subcontractor's negotiated rate unless
  that subcontractor's own engagement carries the subcontractor pass-through consent
  flag (§1.4) — Builder's own margins, in `independent_fixed` mode, are never
  visible to PM under any circumstance.
- **Job breakdown authoring (`S9.10`)** — confirms/overrides task-level scope
  (`project` | `unit`) once assigned.
- **Programme / Line-of-Balance editing** — Builder's **own, sole-authored**
  table. PM's Gantt view is a read of this; there is no second, PM-writable
  copy.
- **Progress claims** — submits against the head contract for PM approval.
- **Panel management (his own)** — Introduction/Job-Award initiation for his
  own crew, mirroring PM's panel of Builders one tier down.
- **Documents** — uploads/reviews everything his crew produces.
- **Verified Work History** — reviews his crew's record before a Job Award; his
  own record is visible to PM at tender time.

**Permission set:** `projects.read` (own engagement only), `programme.write`
(**own project's task-level schedule only, unconditionally — §1.3**),
`progress.write`, `money.read/write` scoped to his own cost structure in
`independent_*` modes (**in `employee` mode this is simply the company's own
Cost Plan permission, not a walled-off scope — §1.4**), `claims.submit`
(`independent_*` modes only), `panel.manage` (own crew), `documents.read/
write`. **Explicitly absent:** any permission reaching outside this one
engagement. **Scope class:** `assigned`, resolved against
Builder's own engagement record.

### 4.4 Site Supervisor

Read-only review on the web; authoritative writes happen on the App, where he
runs the daily operational cycle: crew sign-in and attendance, toolbox talks,
checking the programme against hold points before work proceeds, receiving
deliveries, walking the site, closing the day with a site diary entry — and
verifying Foreperson's/Tradie's ticks, giving PM an independent check on
Builder's crew that never routes through Builder.

| Sees (read) | Writes |
|---|---|
| Programme, diary, attendance (review, not author) | — (authoritative writes are App-side) |
| Quality — inspection log, defects, Disputes queue (first-line reviewer, App-side action; Portal shows history) | — |
| Compliance & Hold-Point Command Center, filtered to his assigned project(s) | — |
| His own Verified Work History (inspection-thoroughness metric) | — |

**Permission:** `projects.read`, `quality.validate` (read side). **No cost
visibility, at all.** **Scope:** `assigned`. Org attachment: **PM's org**,
reporting to PM — not Builder's, even though he reviews Builder's crew daily.

### 4.5 Inspector

External, engaged at six defined checkpoints only: NCC compliance (Stage 8),
slab (Stage 12), frame — structural engineer and building surveyor separately
(Stage 13), rough-in (Stage 15), the mains energisation certificate (Stage 16
— jurisdiction-dependent, alongside a licensed Electrician), final compliance
and Occupation Certificate (Stage 18). No day-to-day site management, no
schedule visibility, no financials — his write access is exclusively the
protected `is_validated` flag at the hold point he's attending.

| Sees | Writes |
|---|---|
| His own inspection history/report archive across every project he's engaged on | Report upload (heavier documents than the App's checklist suits) |
| The specific hold-point requirements assigned to him, `required_inspector_type` shown | **`is_validated` — nothing else** |
| His own Verified Work History | — |

**Permission:** `projects.read` (assigned/engagement scope, six checkpoints
only), `documents.write` (own certification uploads), `quality.validate`
(write, narrowly — `is_validated` only). **Scope:** `assigned` now;
`engagement` once cross-org lands.

### 4.6 Foreperson

Minimal — self-service, not a console:

| Sees | Writes |
|---|---|
| Own profile, licences/certs, Verified Work History | Certificate upload (fallback) |
| Read-only view of current crew assignment and tasks | — |

**Permission:** `projects.read` (own assignment only), `documents.write` (own
certs). **Scope:** `self`.

### 4.7 Tradie

Same shape as Foreperson, one tier down — this is the Tradie's own portable
professional record, owned by the individual regardless of which Builder
Job-Awards him next.

**Permission:** `projects.read` (own tasks only), `documents.write` (own
credentials). **Scope:** `self`. One identity, two surfaces (Portal/App), never
two records.

### 4.8 Client

| Feature | Server/data need |
|---|---|
| Project progress (% complete, stage timeline), photo gallery | stage status only, **no costs** |
| Budget summary — deliberately coarse | internal est/committed/actual stay redacted |
| Variations — **Approve/Decline** | scoped mutation |
| Progress claims — view status only (billing-milestone events, not the internal Builder→PM claim) | read |
| Documents — handover pack, certificates, plans | download |
| `client_tier` — `development` vs `unit` | attribute on the client↔project link |

**Permission:** `portal` scope only. **Never** paired to the App. Note: Client
currently holds the thinnest protective architecture of any party in this
system — flagged, not resolved here (§9).

---

## 5. Permission × scope matrix

| Role | Scope | org.manage | users.manage | projects r/w | programme.write | progress.write | money r/w | builder.engage | claims submit/approve | panel.manage | development.read | documents r/w | disputes.read/review |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Property Developer | portfolio (dev) | — | — | — | — | — | — | — | — | — | ✅ | — | — |
| Project Manager | assigned | ✅\* | ✅ | ✅/✅ | **read-only from Stage 9** | ✅ (Stages 1–8 only) | ✅/✅\*\* | ✅ | approve | — | ✅\* | ✅/✅ | read |
| Builder | assigned (own) | — | — | ✅/— (own) | ✅ (own, post-Stage-9) | ✅ | ✅/✅ (own)\*\*\*\* | — | submit | ✅ (own crew) | — | ✅/✅ | — |
| Site Supervisor | assigned | — | — | ✅/— | — | review only | — | — | — | — | — | ✅/— | —/review (first-line) |
| Foreperson | self | — | — | ✅/— (own) | — | ✅ (crew, ticks) | — | — | — | — | — | —/✅ (own) | — |
| Tradie | self | — | — | ✅/— (own) | — | ✅ (own tasks, ticks) | — | — | — | — | — | —/✅ (own) | can raise (App) |
| Inspector | assigned/engagement | — | — | ✅/— | — | `is_validated` only | — | — | — | — | — | ✅/✅ (own certs) | — |
| Client | portal | — | — | ✅ (own, read) | — | — | — | — | view only | — | — | ✅ (own, read) | — |
| Accountant/BAS Agent | engagement (`S18.12` only) | — | — | — | — | — | — | — | — | — | — | `tax.approve` only\*\*\* | — |

\* `org.manage` is v1's default carrier of `development.read`. \*\* PM's
`money` visibility on Builder's scope is **set by `builder_engagement_type`, §1.4** —
never a write into an `independent_*` Builder's own cost structure; full
read/write on an `employee`-mode Cost Plan, since it's the company's own, not
Builder's private ledger. \*\*\*\* Builder's own `money.write` is likewise
mode-dependent: a genuinely private, separately-nested ledger in
`independent_*` modes, or simply his access into the company's single shared
Cost Plan in `employee` mode (§1.4) — not two different permissions, one
permission whose *meaning* changes with the engagement's commercial shape.
\*\*\* a narrow, new permission gating exactly one write — the `S18.12`
approval before ATO lodgement fires — see `serverdesignspecification.md` §7.2.

---

## 6. Cross-cutting architecture

### 6.1 Billing milestones (frozen/hashed) → Client Billing

Task codes per the 18-Stage spec v3.4, §1.10 and Part 2:

| Milestone | Fires at (v3.4) | Who / where |
|---|---|---|
| Deposit | `S9.9` Cost Plan locked, once the construction contract is signed (Job Award `S9.7` accepted) | PM, Portal |
| Base | `S12.10` stage advances only once every hold point has cleared | System |
| Frame | `S13.11` stage validated (engineer + surveyor + frame certificate) | System |
| Lock-up | `S14.7` Site Supervisor confirms the building is secured from weather | Site Supervisor, App; Portal reflects |
| Fixing | `S16.10` final trade sign-off per room | Foreperson → Site Supervisor, App |
| Completion | `S18.15` `project.status = 'completed'`, gated on `S18.3` (OC) and `S18.14` (client final digital sign-off, frozen/hashed, xprojman-51) | System, after the Client's Portal sign-off |

Only these six carry a client-facing billing event. Between them, the Client sees a
coarse status view, never cost or schedule internals (§1.9 of the 18-Stage spec).
`18Stage_Tasks.md` still uses older codes (S9.8 / S13.10 / S18.12; roles §8 #19).
Triggers must use the v3.4 codes above.

**Progress claims to the client (xprojman-43; re-scoped by §13, ruled by §14 on
2026-10-14).** ProjMan is project management: it **records** one `client_claims` row per
milestone and **exports** it. The builder's accounting system (Xero first, then MYOB, then
QuickBooks) issues the tax invoice and keeps the books. ProjMan posts no ledger and issues
no tax invoice of its own. Portal screens are built mockup-first (§3.5 1d). Contract:
x43 §11 (Portal proposal) + §12 (Server's corrections) + §13 (re-scope, export) + §14
(rulings):
- **Lifecycle.** The milestone fires → the server creates a **draft** → the PM reviews
  and may adjust the amount with a variation note → the PM **issues** it. The claim
  number is assigned at issue, so drafts don't consume numbers.
- **On issue:** due date = issue + 14 days, and the claim becomes exportable as a `sales`
  row. Revenue posting to `org_journal` (old §4) is superseded and sits behind
  `FEATURE_TENANT_LEDGER`.
- **Payment** is recorded by PM/office with a date and bank reference
  (`payment_recorded_by`). It's full payment only in v1; there's no gateway, and the
  payment itself is reconciled in the accounting system.
- **Void** (draft or issued) keeps the row. The server opens a replacement draft with
  `supersedes_id`. An issued void exports as a credit row, so the accounting system
  raises the adjustment note. A paid claim can't be voided.
- **GST** is 10% only if the org is GST-registered. Otherwise the claim carries no GST.
- **Payment schedule.** Per project, six percentages summing to 100%, seeded with the
  jurisdiction default and confirmed by the PM at Job Award. An issued or paid milestone
  is locked at the % it was billed at (`SCHEDULE_LOCKED`). Open drafts re-price when the
  schedule changes.
- **Deposit cap: warn or block.** The caps are a server-side data table keyed by
  `projects.site_state` (falling back to `organisations.state`). Each cap has a % and/or
  a dollar amount, a rule, a source and a `verified` flag.
  - **Verified** caps (VIC, WA only, as of 2026-10-14) **block**: `DEPOSIT_CAP_EXCEEDED`
    on issue and on schedule save.
  - **Unverified** caps (NSW, QLD, SA) and states with no row (TAS, ACT, NT) **don't
    block**. The call succeeds with a `DEPOSIT_CAP_UNVERIFIED` warning, shown as an amber
    banner, until the Owner's legal check (§9 #16).
- **Retention** (O5): withheld per claim and released in parts (typically 50% at
  Practical Completion, the balance after the defects-liability period). Server §13.1 R3.
- **Accounting export** (§13.4): `sales` / `bills` / `purchase_orders` /
  `contractor_payments`. Account code = the cost centre's `export_account_code`, else the
  org default; tax codes come from `gst_code_map.{sales|bills}`. Rows already exported are
  skipped unless re-included (`EXPORT_INCLUDES_EXPORTED`).
- **Not in v1:** a payment gateway, interest on late payment, and partial payments. The
  client-side claim view waits on customer pairing
  (xprojman-50).

### 6.2 Self-Registration → Introduction → Job Award — Portal touchpoints

Self-Registration and Introduction happen independently, on each individual's
own App or Portal account, out of this module's control. **The Portal is
specifically where Job Award is initiated** — PM selects a winning Builder at
`S9.5` and sends the formal invitation (`S9.6`) from his contact book of
already-Introduced parties; the accept/decline (`S9.7`) may land back here or on
the App.

### 6.3 Hold points as a checklist, not a boolean

Every hold-point-bearing stage (**10**, 8, 11, 12, 13, **16**, 18) renders
`hold_point_requirements` as a list, each item showing its
`required_inspector_type` and its `inspection_type` (`statutory`, which blocks
progress, vs `internal_qa`, which is recorded but doesn't — Stages 14 and 17
are internal QA only). The Portal's Programme view shows partial hold-point
completion (e.g. Stage 12's three named documents) rather than a single
pass/fail flag.

**Two stages moved into the hold-point column in v3.4, corrected here:**
Stage 10's survey set-out (`S10.5`) is now a hard `is_hold_point` blocking
Stage 11 — the cost asymmetry settled it (cheap to verify now, potentially
project-ending to discover wrong at Stage 12's slab pour). And Stage 16 is no
longer internal-QA-only: `S16.7`, the mains energisation certificate, is a
genuine statutory hold point, required nationwide but named differently per
state (COES/CCEW/Certificate of Testing & Compliance/CoC/CES). This is the
first hold point to need a **`jurisdiction` field** on
`hold_point_requirements`, so the correct certificate name and requirement
injects automatically from the project's state — the same conditional-
requirement pattern already used for Stage 2's BAL/flood report and Stage 12's
compression/compaction tests (which auto-flag from Stage 2's hazard-audit
finding, falling back to manual Inspector judgement only where Stage 2 didn't
capture a relevant finding). Stage 17's driveway/crossover permit uses the
same field but is caveated as council-level, not state-level — kept as a
PM-checked manual flag rather than a fully system-verified national table.

### 6.4 Handover pack (Stage 18)

The end-of-project handover pack is a **query**, not an authoring task, over
every `inspection`, `certificate`, `delivery` and `material_selection` row tied
to the project/unit's stage-and-task tree since Stage 10. Scoped per
`modular_unit`. Needs its own long, probably indefinite, retention class,
distinct from routine log-pruning (structural defect liability periods run
years in Australia — confirm the exact figure per state/defect category before
finalising retention rules).

### 6.5 Multi-unit / Line-of-Balance model

`modular_units (project_id, unit_number)` sits between Project and Stage.
Stages 1–9 are project-level, run once. Stages 10+ default to unit-scope, but
scope lives on the individual task, not the stage. A standalone house is
`modular_units` with exactly one row — never a special-cased fork.

---

## 7. The commercial visibility wall — two rules, not one, checked everywhere

> Client sees what they are buying and what they owe — never who is paying
> whom upstream. The PM↔Builder↔Subcontractor relationship stays invisible to
> the client at every tier.

This one is genuinely unconditional, regardless of `builder_engagement_type` — the
Client-facing wall never moves, and never moves *because* the PM–Builder wall
did (§1.4's independence note).

**The PM–Builder wall is different, and it is conditional (§1.4), not
absolute:**

- **Schedule/job-breakdown authorship (§1.3)** stays a hard, unconditional
  read-only wall in every engagement mode — it protects who operationally runs
  the job, a different question from who bears commercial risk.
- **Cost/margin visibility scales with risk (§1.4)** — private in
  `independent_fixed`, fully disclosed in `independent_cost_plus`, structurally
  absent as a separate concept in `employee` mode. Treating this as a single
  unconditional "Builder's margins are never exposed" rule — as an earlier
  pass of this document did — was itself a defect against the actual
  principle, not a safe simplification of it.

If a future module or a permission-grant convenience would let a Client see a
subcontractor rate, or let a PM edit Builder's Gantt in *any* mode, or let a
PM see `independent_fixed` margins, or let a PM see a *specific*
subcontractor's cost line without that subcontractor's own pass-through
consent — each of those is a defect against this section, not a feature
request.

---

## 8. Ethical safeguards & governance — Portal implementation

Full detail lives in `appdesignspecification.md` §2.7–2.12. Portal's share:

- **Escalation & dispute:** PM gets **read** visibility into disputes and their
  resolutions (§3.4 item 13) — Site Supervisor is the first-line adjudicator on
  the App, Builder is never the final word.
- **Portability vs. VeriTrade:** the Portal's Trust Directory (§3.4 item 5) is
  the **internal** view only — it is never VeriTrade itself. Whether a profile
  is opted-in to VeriTrade is the individual's own toggle, visible here as a
  read-only flag, never editable by PM/Builder on someone else's behalf.
- **Invoice-gate footprint minimisation:** the Handover & As-Built Vault (§3.4
  item 8) separates the long/indefinite retention class for validated
  milestones from the shorter retention for granular day-to-day capture.
- **Deactivation, not erasure:** Organisation → Users (§3.4 item 14) implements
  deactivate, never a hard delete, for anyone with relied-upon project evidence.
- **Named, not yet resolved:** the commercial-visibility walls currently
  protect Builder's/PM's margins more than the Client's; the AI confirm-gate
  pattern is only as good as the confirming human's retained expertise.

---

## 9. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Property Developer — role or dashboard? | Ship as `client_tier` + `development.read`, no new login-holder in v1 |
| 2 | PM's read-only wall over Builder's **schedule** — confirm no exception path, ever | No override, no emergency-access carve-out, in any `builder_engagement_type` — force a Variation/contract action instead. **Cost Plan visibility is no longer part of this decision — it's mode-conditional, §1.4, not absolute** |
| 3 | ~~Line-of-Balance visualisation~~ | **Resolved:** not a roadmap-priority call. `S1.3` has the PM declare unit count at project creation, and that value conditionally selects the renderer — one unit renders the standard bar-chart Gantt, more than one renders a Line-of-Balance flow view. The LOB component itself still needs building; what's resolved is *when* it's needed, not whether it exists yet |
| 4 | ~~Accountant/BAS-Agent seat~~ | **Resolved:** a genuinely new role, confirmed. `S18.11` prepares a draft only; `S18.12` is the mandatory approval gate. Likely external/no-login (PM uploads their sign-off) unless volume justifies a dedicated paired login — that specific call is still open |
| 5 | Progress Claims vs Billing Milestones — confirmed as two separate workflows? | Yes |
| 6 | Inspector's Portal scope — `assigned` (in-house) buildable now; `engagement` (external certifier) waits on cross-org | Ship in-house path now |
| 7 | ~~Introduction PIN/QR mechanic~~ | **Resolved:** ordinary account login, not a separate PIN — see `appdesignspecification.md` §9 |
| 8 | Dispute-resolution SLA — how long can a dispute sit unresolved before PM is auto-notified? | Not designed here |
| 9 | Deactivation-vs-erasure legal review — AU privacy law compatibility | Legal-confirmation item |
| 10 | Client-protection asymmetry | Flagged, not designed |
| 11 | **New:** Job Award's `S9.7` tap — does it satisfy state home building contract execution law? | Legal-confirmation item, not a design choice — see `appdesignspecification.md` §2.3/§9 |
| 12 | **New:** whether the Accountant/BAS-Agent role ever needs a dedicated paired login (vs. external/no-login) | Founder call, gated on volume |
| 13 | **New:** `builder_engagement_type` UI — where and how PM sets `independent_fixed` \| `independent_cost_plus` \| `employee` at Job Award, and whether it can ever change mid-project | Not designed here — a mode change mid-project has real implications for what was previously private suddenly needing disclosure, or vice versa; needs its own pass |
| 14 | **New:** the subcontractor pass-through consent mechanism (§1.4) — a one-time blanket clause in the subcontractor's engagement agreement, or per-project/per-line consent | Leaning toward a blanket clause at engagement time, re-confirmed per project — not finally decided |
| 15 | **New:** in `employee` mode, does Builder get *write* access to the company Cost Plan by default, or does that still need a separate permission grant from PM/Property Developer? | §1.4 establishes there's no separate ledger to wall off; it does not by itself establish Builder's write authority over the shared one — a genuinely separate question, not designed here |
| 16 | ⚖ **Legal:** deposit caps for NSW, QLD, SA, TAS, ACT and NT | Owner's legal check. Until then only VIC/WA block; the rest warn (§6.1). Note that x43 §2.1's own table is partial (e.g. QLD over $20k, SA's $1,000 vs 5%) |
| 17 | ⚖ **Legal:** a client invoice must meet ATO tax-invoice requirements (supplier ABN, issue date, description, GST shown separately, total; "Tax invoice" wording for GST-registered suppliers) | Server's PDF (x43 Step 7) is checked against the ATO list before the first real issue. A void must be an adjustment note, not a delete |
| 18 | ⚖ **Legal:** final-payment gating (VIC DBCA s.42: OC issued and free of defects) | The Completion invoice can't be drafted before `S18.3` + `S18.14`. `S18.14`'s capture design is xprojman-51 (Owner F1 open) |
| 19 | ⚖ **Legal:** is `S9.7`'s tap a valid contract execution under each state's home building law? | Unchanged from §9 #11, and now also a billing dependency: the Deposit invoice relies on it |
| 20 | ⚖ **Legal:** Privacy Act / APPs for client and worker personal data (customer records, injured-person details in incident reports, inductions, signatures) | Collection notices, access requests and a retention/destruction schedule need legal input. Incident details are already restricted to safety.manage + the reporter (v048). The Dashboard PII wall still applies |
| 21 | ⚖ **Legal:** customer App pairing consent (xprojman-50) | Consent wording and what the client can see need sign-off (x50 F6/F11 with the SA). Minors via TAFE/school remain a separate, undesigned privacy item (18-Stage spec Part 3 #4) |
| 22 | ⚖ **Legal:** records retention: as-built/handover (indefinite), safety (5 years in v1, SA F3), tax records (ATO 5 years), and structural-defect periods by state | No retention/destruction schedule exists yet; the 18-Stage spec flags the defect-period figures as "confirm with a solicitor" |
| 23 | ⚖ **Legal:** notifiable incidents | v1 records them and emails the PM + Site Supervisor only. The copy must never claim to lodge with the regulator or make the org compliant (SA F3). The Portal Safety screens follow this |
| 24 | ⚖ **Legal:** audio/video capture of people, and cost-plus / referral disclosure | Open per the 18-Stage spec's legal list. Not touched by Portal yet |
| 25 | ⛔ **Blocking:** test logins for the lab | Blocks every live test in §3.5 (Built → Live), the checklists E2E with App, and the Safari date check. Owner to supply |
| 26 | ~~⛔ Blocking: v048 migrated on the lab~~ | ✅ Done 2026-10-14: v048 is live on c1projman2 and `SAFETY_MOCK` is off |
| 27 | ⛔ **Blocking:** x43 R1–R5 (flags, `client_claims` + `projects.site_state`, SOP/RCTI, export, triggers) | Blocks progress claims, the export and the ledger flag going live. Server's queue: v048 → inspector → dashboard security → x43 R1–R5 |

---

## 10. Build order

| Step | Deliverable | Why here |
|---|---|---|
| 1 | Role/permission matrix — add `builder` role, `client_tier`, corrected `programme.write` scoping | Nothing else buildable until this lands |
| 2 | PM console — no write/override path into Builder-scoped data | Cheap, subtractive, closes the biggest defect first |
| 3 | Builder console — Job Award response, Cost Plan, Panel, Job Breakdown | Unblocks every Stage 10–18 actor reference |
| 4 | Compliance & Hold-Point Command Center | Needed the moment multi-unit/Line-of-Balance scheduling is real |
| 5 | Verified Work History / Credibility Center + Disputes oversight (read) | Cross-cuts every role; pair these together |
| 6 | Variations & Progress Claims workspace | Depends on Builder console existing |
| 7 | Client portal `client_tier` addition | Small, additive |
| 8 | Organisation → Users: Deactivate, not Delete | Build before the evidence architecture is relied upon at scale |
| 9 | Development/Portfolio Dashboard | Lowest urgency |
| 10 | Handover & As-Built Vault, Legal/Compliance register, Accountant/BAS-Agent seat | Stage-18-adjacent |

**Status:** §3.5 (14 October 2026) is the build status of record. It supersedes the
2026-09-03 note that used to sit here.

---

© eBizco Australia Pty Ltd — prepared against the 18-Stage Construction Lifecycle
Specification v3.4, 26 July 2026.
