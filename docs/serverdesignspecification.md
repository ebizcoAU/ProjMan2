# ProjMan — Server Design Specification

**Status:** Specification of record — §5 onward describes already-built modules;
§1–4 and §7–8 are the corrected architecture layer, ship as a migration on top
of what exists, not a rewrite of it
**Date:** 27 July 2026
**Owner:** eBizco Australia (Vince Phan) / NexusPM (server)
**Source of truth:** *ProjMan — The 18-Stage Construction Lifecycle, Fully
Decomposed*, v3.4 — cited as "the 18-Stage spec."
**Companion docs:** `devroadmap.md` (roles, phases, the `PM2-02` prerequisite) ·
`appdesignspecification.md` · `portaldesignspecification.md` ·
`veritradedesignspecification.md` · `dashboarddesignspecification.md`
**Naming note:** earlier server material referred to cross-cutting decisions as
`projman-01`/`projman-02`/`projman-03`. This document renames them to the
project's own `PM2-NN` convention for consistency — `projman-02` (cross-org
engagement/evidence scope) is now **`PM2-02`**, referenced throughout
`devroadmap.md` and `veritradedesignspecification.md` as the identity-scoped
evidence domain decision. Same decision, same content, one naming convention.

---

## 1. Scope

What this spec covers: the server (`server/api`) and how the domain modules
attach to it, plus the two web/app surfaces it feeds. What it does not cover
(owned elsewhere): the Flutter field app UI (`appdesignspecification.md`), the
Portal UI (`portaldesignspecification.md`), VeriTrade's own frontend
(`veritradedesignspecification.md`), the platform-ops Dashboard
(`dashboarddesignspecification.md`).

---

## 2. System context — two tenant surfaces, plus two products this server does not itself render

**This corrects the single biggest architectural error carried through this
project's earlier drafts:** those modelled **three tenant client surfaces** —
App, Dashboard (the office console), and a "Public portal" (the client's
read-only view) — drawn as three peer boxes. The third was never architecturally
separate: its session was always `customer`-scoped on the exact same JWT/`org_id`
model as everything else. There are **two** tenant-facing surfaces.

```
        ┌── App (Flutter) ──────────┐        ┌── Portal (Next.js) ───────────────┐
        │ site + office, on-device  │        │ ALL desk roles — PM, Builder,     │
        │ capture-first, offline    │        │ Property Developer, Site          │
        │ session WITH device_id    │        │ Supervisor (review), Inspector    │
        │                           │        │ (review), Client (own project)    │
        └─────────────┬─────────────┘        └─────────────┬──────────────────────┘
                      │                                     │
                      └─────────────────┬───────────────────┘
                                         │  HTTPS /api/v1
                             ┌───────────▼────────────┐
                             │  ProjMan API (server) │  MySQL c1projman2 (AU region)
                             └───────────┬────────────┘
                                         │  read-only evidence export, once PM2-02 lands
                             ┌───────────▼────────────┐
                             │   VeriTrade (separate)  │  own frontend, own domain
                             └─────────────────────────┘
```

Two other surfaces exist in the ecosystem and are **not** tenant surfaces of
this server in the same sense:

- **Dashboard** — a genuinely separate application, platform-ops only,
  `platform_admin` scope, never resolves an `org_id` a tenant recognises as
  theirs. See `dashboarddesignspecification.md`.
- **VeriTrade** — a genuinely separate product. It does not share this
  server's session model at all; it authenticates through the App (§7.4) and
  reads from a person-owned evidence export this server produces once `PM2-02`
  is resolved (§7.3), never from live tenant tables directly.

**Surface rules:** the server derives the surface from the token (device
present → app; else portal), enforces `org_id` on every query, and refuses
writes from the `client` role. **Portal's Client-scoped session is read-only
and it never becomes a sync writer** — it needs no new ownership rule beyond
the one every non-app session already has.

---

## 3. Server architecture (layered)

Four layers:

```
Gateway/middleware  — auth, org_id resolution, rate limiting, request logging
Service layer       — AuthService, SyncService, ProjectService, ProgrammeService,
                       CostPlanService, ComplianceService, EvidenceService (new, §7)
Domain modules      — P4–P9 (projects, site ops, safety/quality, commercial,
                       accounting, tax) — see §8
Data layer          — MySQL c1projman2, migration-versioned, sync-registry-driven
```

The gateway, middleware, and data layers exist today. The service layer is
extracted from current routes with no behaviour change — structure only.

---

## 4. Functional guideline — server modules by phase

See `devroadmap.md` §11 for the authoritative phase table (P1–P12 plus the
independent Dashboard track). This spec's remaining sections map onto that
table as follows: §6 → P10, §7 → P10/P12, §8 → P4–P9 (already built, patches
noted inline).

---

## 5. What we port from Nexus `dashboard` / `portal`

*(Historical porting reference — kept for the dev team migrating the legacy
Nexus codebase; not itself a design decision.)*

| Nexus asset | ProjMan target | Verdict |
|---|---|---|
| Server (`nexus/api`) core: auth, sync, device pairing | Server identity/sync layer | ✅ **PORT** — proven |
| Web UI kit (`_components` + `lib`) | Portal's component kit | ✅ **PORT** — proven, accessible |
| Ledger/accounting pages | Accounting module | ⚠️ **ADAPT** — VN tax → AU GST/BAS/TPAR |
| Payroll/tax pages | AU payroll (PAYG/super) | ⚠️ **ADAPT** |
| Login (CCCD+PIN+QR) | Portal login | ❌ **REWRITE** — different auth model entirely; reuse only layout |
| `nexus/dashboard/src/app/admin/*` | — | ❌ **DROP** — that's FTPOS's own platform ops, not ProjMan's |
| `sentinel/*` (inspection/scan) | Quality inspections | ⏸ **EVALUATE** before reuse |

**The customer/Client view has no direct Nexus equivalent** — Nexus's `portal`
was an operator console, not a client-facing read-only view. It is **new UI on
ported infra**: the same component kit + API client, a stripped read-only
layout inside the *same* Portal application (not a separate one), feeding on
customer-scoped read endpoints. Server side: a handful of read endpoints + one
write (variation decision), gated to the `client` role.

---

## 6. Data residency & compliance (AU)

- **Residency:** MySQL `c1projman2` + this service deploy to AWS Sydney
  `ap-southeast-2` (or Azure Australia East). All PII at rest stays in
  `c1projman2`. Only outbound calls: OAuth token verification
  (Google/Microsoft/Facebook), ABR ABN lookup, and — once built — the
  state-by-state licence-verification calls VeriTrade needs
  (`veritradedesignspecification.md` §6); none stores PII externally.
- **Privacy Act:** PII columns are known and enumerable; `audit_log` records
  access to identity ops from day one. Retention + deletion policy must
  implement **deactivation, not erasure** (§7.5) as a first-class distinction,
  not a later retrofit.

---

## 7. The corrected identity & role layer

### 7.1 Roles-as-data (unchanged design, corrected content)

```
role (a row, not an enum)
  ├── scope_class          WHICH rows this role reaches   (resource dimension)
  └── permission set       WHAT it may do to them          (capability dimension)

enforcement = requirePermission(<capability>) + scopeFilter(<scope_class>)
```

A **permission** is a dotted capability string. Routes and services check
permissions, never role names. A **scope class** says which slice of the org's
rows the role reaches: `portfolio` (org-wide) · `assigned` (member projects
only) · `self` (own rows) · `engagement` (`PM2-02` slice) · `portal` (own
project, read-only). A **role** is a row in a `roles` reference table binding a
label to a scope class + permission set. Adding a role, or changing what a
Foreperson may do, is a data change. Zero route edits.

### 7.2 The corrective migration — adding `builder`, fixing `programme.write`

The permission matrix as previously built had **no `builder` role** and gave
`project_manager` unconditional `programme.write`. Both are defects against
`portaldesignspecification.md` §1.1/§1.3. This ships as a migration on the
existing roles-as-data table, additive, no big-bang rewrite:

| Permission | Meaning |
|---|---|
| `org.manage` | org profile, plan, settings |
| `users.manage` | create users, change roles/status |
| `devices.manage` | revoke, re-role, pairing initiate/confirm |
| `customers.read` / `customers.write` | customer list / CRUD |
| `projects.read` / `projects.write` | project list+detail / create+edit+status |
| `programme.write` | stage/task **structure** — **now scoped per row**: PM holds it Stages 1–8 only; Builder holds it for his own engagement's Stage 10–18 schedule; **neither holds it into the other's rows** |
| `progress.tick` | *(renamed from a bare `progress.write`)* the device-writable status field — Tradie/Foreperson's pen |
| `progress.verify` | the protected `verified_by`/`verified_at` field, settable only by the role one level up (Site Supervisor over Foreperson/Tradie) — **this split did not exist in the prior matrix and is the server-side form of tick-then-verify (§1.3 of the 18-Stage spec)** |
| `money.read` / `money.write` | see/set `contract_value`, `budget_*`, `cost_plan_*` — **scope and depth now set by the engagement's `builder_engagement_type` (§7.2.1), not a flat rule.** In `independent_fixed`: Builder's `money.write` is his own private ledger; PM holds `money.read` on the head-contract figure only, never the breakdown. In `independent_cost_plus`: PM's `money.read` extends into Builder's actual-cost and commission lines. In `employee`: there is no separate ledger — `money.read`/`money.write` on that project resolve to the one shared company Cost Plan for whoever the org's normal permissions grant it to |
| `claims.submit` / `claims.approve` | Builder submits, PM approves |
| `variations.raise` / `variations.approve` | PM raises, Client approves/declines |
| `panel.manage` | Introduction/Job-Award initiation for one's own panel (PM's Builders, Builder's crew) |
| `quality.validate` | Inspector's protected `is_validated` write; Site Supervisor's verification write |
| `disputes.read` / `disputes.review` | PM reads escalations; Site Supervisor is first-line reviewer |
| `development.read` | Property Developer's portfolio view |
| `tax.approve` *(new, v3.4)* | The single protected write at `S18.12` — approves the system-prepared fixed-asset/depreciation draft (`S18.11`) before ATO lodgement fires. Held by the new `accountant` role (§7.2's matrix) |

**Corrected matrix — roles × permissions:**

| Role | Scope | org.manage | users.manage | projects r/w | programme.write | progress.tick/verify | money r/w | claims submit/approve | panel.manage | development.read | tax.approve |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `org_admin` | portfolio | ✅ | ✅ | ✅/✅ | ✅ | — / — | ✅/✅ | —/— | — | ✅ | — |
| `developer` | portfolio | — | — | —/— | — | — / — | ✅ (read) | —/— | — | ✅ | — |
| `projectManager` | assigned | — | ✅ | ✅/✅ | **Stages 1–8 only** | — / — | ✅/**—** (Stage 9 on) | —/approve | ✅ | ✅\* | — |
| **`builder`** *(new)* | assigned (own engagement) | — | — | ✅/— (own) | ✅ (own, Stage 9 on) | — / — | ✅/✅ (own) | submit/— | ✅ (own crew) | — | — |
| `siteSupervisor` | assigned | — | — | ✅/— | — | —/**✅** | — | —/— | — | — | — |
| `foreperson` | assigned (own crew) | — | — | ✅/— (own) | — | **✅**/— (crew) | — | —/— | — | — | — |
| `tradie` | self | — | — | ✅/— (own) | — | **✅**/— (own tasks) | — | —/— | — | — | — |
| `inspector` | assigned/engagement | — | — | ✅/— | — | —/**✅** *(narrowly, hold-point rows only)* | — | —/— | — | — | — |
| `client` | portal | — | — | ✅ (read)/— | — | — / — | — | view only | — | — | — |
| **`accountant`** *(new, v3.4)* | engagement (`S18.12` row only) | — | — | — | — | — / — | — | — | — | — | **✅** *(narrowly, one row per project)* |

\* `org.manage`/`development.read` on `projectManager` reflects the founder's
own same-tenant v1 where PM and Property Developer may be the same person; a
genuine arms-length Property Developer holds `development.read` without
`org.manage`.

### 7.2.1 `builder_engagement_type` — visibility scales with risk, at the schema level

New in this pass, per `portaldesignspecification.md` §1.4. The principle:
whoever bears cost-overrun risk earns cost-structure privacy; whoever is
protected from that risk owes transparency in exchange. This is not a policy
statement alone — it has to be a real column, checked by the same
`scopeFilter`/`requirePermission` mechanics as everything else in §7.1, or it's
just documentation.

```sql
-- Lives on the Builder's engagement record (job_awards, once accepted, or a
-- dedicated builder_engagements row keyed to it — implementation detail,
-- not a design decision).

builder_engagement_type      ENUM('employee','independent_fixed','independent_cost_plus')
                     NOT NULL, set at Job Award (S9.6), not changeable
                     without its own explicit, audited event (Open
                     Decision #9, §10) — a silent mode flip would move
                     the disclosure boundary without anyone confirming it.

-- Resolves what money.read/money.write actually return, at query time:
--   independent_fixed      -> Builder's cost_plan_lines redacted except
--                              the head-contract total; margin/rate
--                              columns never selected for PM's session
--   independent_cost_plus  -> full disclosure of cost AND commission —
--                              this is what makes cost-plus an honest
--                              pricing model rather than fixed-price in
--                              disguise. Extends to job costing and the
--                              supplier/subcontractor register in full,
--                              not just the head-contract figure — but
--                              see the pass-through consent gate below
--                              for what "in full" means at the specific
--                              subcontractor-line level
--   employee               -> no separate cost_plan owner check at all;
--                              falls through to the org's normal
--                              money.read/money.write grant
```

**The subcontractor pass-through consent chain** — a new requirement,
not previously modelled anywhere in this project:

```sql
subcontractor_engagements   ... existing columns ...,
                             subcontractor_pass_through_consent BOOLEAN NOT NULL
                             DEFAULT FALSE,
                             consent_recorded_at, consent_document_id
                             -- FK to the actual signed clause/document,
                             -- not just a checkbox with no evidence
                             -- behind it — this is exactly the same
                             -- evidentiary discipline as every other
                             -- frozen record in this system (§1.4 of
                             -- the 18-Stage spec), applied to a consent
                             -- rather than a completion.
```

**Enforcement:** even when `builder_engagement_type` is `independent_cost_plus` or
`employee`, a query resolving PM's `money.read` down to a *specific*
subcontractor's line item must additionally check
`subcontractor_engagements.subcontractor_pass_through_consent = TRUE` for that
particular subcontractor row. The aggregate claim amount PM needs to verify a
progress claim is not gated the same way — Builder still has to be able to
bill for real cost — but the line-level attribution (which sub, what rate) is.
Defaults to `FALSE`: a subcontractor who never signed the clause stays
unattributed in PM's view, full stop, regardless of engagement mode.

### 7.3 Self-Registration → Introduction → Job Award — data model

Replaces every earlier "Register/Assign" or "Principal generates QR for
Builder Appointment" design. Three distinct event types, one shared table
family:

```sql
-- Self-Registration: no counterpart row needed beyond the person's own
-- identity/profile record (users, licences, verified_work_history) — this
-- is just normal account creation, on the App or the Portal-equivalent for
-- desk roles.

introductions        id, party_a_id, party_b_id, introduced_at,
                     initiated_by (app_qr_scan | veritrade_engage),
                     device_signature   -- the QR/signed-reference primitive.
                                        -- Resolved (v3.4): relies on each
                                        -- party's own ordinary session/login
                                        -- already established at Self-
                                        -- Registration — NOT a separate out-
                                        -- of-band PIN table. Lower friction;
                                        -- revisit only if proximity fraud at
                                        -- this step becomes an observed
                                        -- problem, not a theoretical one.

job_awards           id, org_id, project_id, from_user_id, to_user_id,
                     role_offered (builder | tradie | foreperson | subcontractor),
                     status (sent | accepted | declined),
                     sent_at, responded_at, response_channel (app | portal),
                     document_hash,   -- frozen/hashed per §1.4 of the 18-Stage
                                      -- spec — applies to the INVITATION
                                      -- (S9.6), not the acceptance tap
                     builder_engagement_type  -- for role_offered='builder' only; see
                                      -- §7.2.1 for the full enum and what it
                                      -- resolves at query time. Set once, at
                                      -- the same moment as the invitation
                                      -- (S9.6) — Builder accepts the mode
                                      -- along with the engagement, not as a
                                      -- separate later negotiation.
                     deposit_payment_id  -- nullable FK into the billing/
                                         -- payments table (S9.9's Deposit
                                         -- milestone). Resolved (v3.4):
                                         -- acceptance itself (S9.7) is a
                                         -- lightweight in-app tap, not a
                                         -- signature ceremony — Builder's
                                         -- identity is already government-
                                         -- backed at Self-Registration. What
                                         -- actually makes acceptance binding
                                         -- is THIS row: a TPAR-reportable
                                         -- deposit payment against Builder's
                                         -- own ABN, not the tap alone.
```

**Legal confirmation still needed, not a design choice:** whether an in-app
tap plus a deposit transaction satisfies what some states' home building
contract legislation requires for a validly executed contract, or whether a
compliant document + proper e-signing flow is still required alongside it —
confirm with a solicitor before `job_awards.status='accepted'` is treated as
contractually binding in production (§10).

**Constraint enforced server-side, not just by UI convention:** a `job_awards`
row can only be created if an `introductions` row already exists between the
same two parties — **PM cannot Job-Award a cold stranger.** This is the
server-side teeth behind the 18-Stage spec's "PM sources from his own contact
book — never a cold stranger" rule.

### 7.4 VeriTrade login — endpoint shape

VeriTrade holds no password credentials for anyone (§4 of
`veritradedesignspecification.md`). This server is the identity provider for
both products:

```
POST   /veritrade/login/initiate   → { session_qr, expires_at }
GET    /veritrade/login/status/:id → pending | approved | denied
POST   /app/veritrade-login/scan   → returns request context to the app
                                      (device/browser, rough location, time)
POST   /app/veritrade-login/respond → { approve: true|false }, signed by the
                                      paired device's key — same signature
                                      primitive as §7.3's Introduction
```

On approval, the server issues a VeriTrade web session tied to the person's own
`user_id` — never a new, separate account record.

### 7.5 `PM2-02` — the identity-scoped evidence domain

**The single most important open design decision downstream of the data core**,
and the hard blocker on VeriTrade (`veritradedesignspecification.md` §2). A
Tradie's evidence must span many Builders' tenants and be portable, owned by
the individual — in direct tension with `org_id` isolation.

**Proposed reconciliation:** project data stays locked inside each Builder's
org; each qualifying interaction (a validated inspection, a signed diary entry,
a completed stage, a matched invoice) emits a **signed attestation** into a
person-owned, identity-scoped evidence store outside any one tenant — a third
isolation domain alongside `org_id` and `self`. The counterpart org is
anonymised in any score or summary that leaves the person's own record.

**Two questions to answer before this is built, not during:**

1. Is a person a full account that **owns** a cross-org evidence record, or is
   a profile assembled only at read time? *(Recommend: owned record — the only
   answer consistent with "immutable, tamper-proof.")*
2. Does a multi-Builder Tradie hold **one session with many project-grants**,
   or **many sessions switched between**?

This becomes `PM2-02` as a decision record before any of §7.4 or VeriTrade's
backend (`veritradedesignspecification.md` §11) is built.

### 7.6 Deactivation, not erasure — the server-side rule

`DELETE /users/:id` must never be a hard delete for any user with
relied-upon project evidence attached (a verified tick, a signed diary entry,
a hold-point sign-off). The endpoint instead:

- sets `deactivated_at`, stops all future sync/capture for that identity,
- immediately pulls the person's record off VeriTrade (`is_published = false`,
  regardless of who requested the deactivation),
- purges only rows flagged `discretionary` (profile photo, bio text, contact
  details),
- retains every relied-upon evidence row, unattached to an active, growing
  profile, under the same retention policy as everything else.

---

## 8. Domain modules already built — carried forward, patches noted

The following are implemented and stable; this spec does not reproduce their
full schema in-line (column-by-column DDL lives in the migration files
themselves, not duplicated here). Each row below is the patch this correction
requires, not a rewrite:

| Module | Status | Patch required by this correction |
|---|---|---|
| 18-stage template & progression engine | ✅ Built | Stage 9's actor line updates to Job Award terminology (§7.3); no schema change — `contracts.party_type='subcontractor'` already covers Builder. **New (v3.4):** `S1.3` — PM declares building type/unit count **at project creation**, writing `modular_units` immediately rather than only from Stage 9 on; this single value conditionally selects the Portal's Programme renderer (standard Gantt for one unit, Line-of-Balance flow view for more than one) — the LOB rendering component still needs to be built, but the trigger for when it's needed is now exact. Stage 1's sub-step codes shift down one (old `S1.3`–`S1.7` → new `S1.4`–`S1.8`) |
| Site operations (diary, attendance, deliveries) | ✅ Built | Diary sign-off authority is Site Supervisor's alone (append-only rule already correct); no schema change. **New (v3.4):** `S10.5` (survey set-out) is now a hard `is_hold_point` blocking Stage 11 — was recorded evidence only |
| Quality (inspections, defects, certificates) | ✅ Built | Inspector's write permission narrows to `quality.validate` on `is_validated` rows only, per §7.2's matrix — verify no broader `quality.write` grant survived from the pre-correction matrix. **New (v3.4), three schema-relevant changes:** (1) `S11.9` splits into three named `hold_point_requirements` rows — electrician's rough-in certificate, plumber's rough-in certificate, PC overall verification (pour renumbers to `S11.12`); (2) `S12.8`/`S12.9` (core compression / compaction tests) auto-flag as required when Stage 2's `S2.4` hazard-audit finding already recorded the triggering soil/hazard condition, falling back to manual Inspector judgement only where `S2.4` captured nothing relevant — needs a `triggered_by_finding_id` link back to the `S2.4` record; (3) `hold_point_requirements` gains a **`jurisdiction` column** — first needed for `S16.7`, the mains energisation certificate, a genuine new statutory hold point required nationwide but named differently per state (COES VIC/WA, CCEW NSW, Certificate of Testing & Compliance QLD, CoC NT/SA, CES ACT/TAS); a reference table mapping state → certificate name/requirement is new infrastructure, not just a column. `S17.2` (driveway/crossover) uses the same `jurisdiction` field but stays a PM-checked manual flag, not a statutory hold point — council-level variation is too fine-grained for a national reference table |
| Commercial (estimating, POs, variations, claims) | ✅ Built (P7 target) | **Superseded by the engagement-mode framework (§7.2.1):** Builder's `money.write` visibility to PM is no longer a flat exclusion — it depends on `builder_engagement_type`, plus the subcontractor `subcontractor_pass_through_consent` gate on line-level attribution |
| Accounting & AU tax | ✅ Built (P8–P9 target) | **New (v3.4):** `S18.11`/`S18.12` split — the fixed-asset/depreciation step now writes a **draft only** (`S18.11`, no external transmission), gated behind a new protected `tax.approve` write (`S18.12`, held by the new `accountant` role, §7.2) before ATO lodgement fires. Downstream Stage 18 sub-steps renumber: old `S18.12`→`S18.13` (handover email), old `S18.13`→`S18.14` (client sign-off — **also fixes a stale citation**: `portaldesignspecification.md` previously cited the old `S18.13` for this), old `S18.14`→`S18.15` (status=completed), old `S18.15`→`S18.16` (VeriTrade attestation hand-off) |
| CPC50220 alignment (`cpc_units`, `cpc_feature_map`, `cpc_evidence`) | Reference/tagging buildable now; evidence-generation gated on `PM2-02` | Unchanged design, dependency restated in `devroadmap.md` §8 |

---

## 9. Proposed build order

| Step | Deliverable | Depends on |
|---|---|---|
| A | Corrective migration: add `builder` role, split `progress.tick`/`progress.verify`, scope `programme.write`/`money.write`, add `accountant` role + `tax.approve` per §7.2 | none — do this first |
| A2 | `builder_engagement_type` column + query-time money resolution + `subcontractor_engagements.subcontractor_pass_through_consent` (§7.2.1) | A |
| B | Self-Registration/Introduction/Job Award data model + endpoints (§7.3), incl. `builder_engagement_type` set at `S9.6` | A2 |
| C | Portal: collapse the "Dashboard + Public Portal" pages into one Portal app with role-scoped route groups | A |
| D | Deactivation endpoint correction (§7.6) | A |
| D2 | Stage-level patches (§8): `S1.3` unit-count declaration, `S10.5` hold point, `S11.9` split, `S12.8`/`S12.9` hybrid auto-flag, `S16.7`/`S17.2` `jurisdiction` field + state-certificate reference table, `S18.11`/`S18.12` split | A |
| E | `PM2-02` decision record — resolve before F | B, C |
| F | VeriTrade login endpoints (§7.4) + evidence export | E |
| G | VeriTrade's own backend (search, licence-verification integration) | F |

Steps A–D2 are safe to start immediately — no dependency on `PM2-02`. E is a
design decision, not code, and should be scheduled as such rather than
discovered mid-build.

---

## 10. Open decisions for review

| # | Decision | Status |
|---|---|---|
| 1 | `PM2-02` — owned record vs. read-time assembly; one session vs. many | **Blocking VeriTrade** |
| 2 | ~~Introduction PIN/QR mechanic~~ | **Resolved:** ordinary login, not a separate PIN — see §7.3 |
| 3 | ~~Job Award's exact signature mechanic~~ | **Resolved:** lightweight tap + `S9.9` deposit pairing (§7.3). **New, genuinely open:** does this satisfy contract-execution law state by state — solicitor confirmation needed, not a server-design call |
| 4 | Whether `quality.validate`'s narrow `is_validated`-only scope is fully enforced in the existing built Quality module, or whether a broader grant survived from the pre-correction matrix | **Audit before shipping step A** |
| 5 | State-by-state licence-verification integration order | Owned by VeriTrade spec, server-side implementation TBD |
| 6 | Xero/accounting integration — in or out for v1 | Carried forward, unresolved |
| 7 | Whether the new `accountant` role (§7.2) ever needs a dedicated paired login, or stays external/no-login (PM uploads their `S18.12` sign-off) indefinitely | Founder call, gated on volume — same pattern as the Structural Engineer/Surveyor today |
| 8 | State → energisation-certificate reference table (`S16.7`) — build/maintain in-house vs. source from an existing compliance data provider | Not decided; needed before `S16.7` can go live in any state |
| 9 | **New:** can `builder_engagement_type` (§7.2.1) ever change mid-project, and if so, via what audited event? | Not designed — a silent change would move the disclosure boundary without confirmation, so this needs its own explicit flow, not a plain `UPDATE` |
| 10 | **New:** subcontractor `subcontractor_pass_through_consent` — one-time blanket clause vs. per-project re-confirmation | Leaning blanket-at-engagement, not finally decided |
| 11 | **New:** in `employee` mode, is Builder's `money.write` on the shared Cost Plan automatic, or does it still need an explicit grant from PM/Property Developer? | Not designed — §7.2.1 removes the *wall*, it doesn't by itself grant the *write* |

---

## 11. P8 — Accounting & AU Tax module (design draft, specify-then-build)

Expands the one-line §8 row ("Accounting & AU tax — P8–P9 target") into a buildable
design. **Decisions #6/#12–#16 ruled by owner 2026-08-01 (§11.4); P8a authorised and in
build (migration v022). P8b/P8c specified, not yet authorised.** The `accountant` role +
`tax.approve` permission (v012)
and the `S18.12` `blocks_progress` accountant gate (v016) already exist; P8 fills in the
module those stubs point at. Everything else in the accounting/tax domain is greenfield.

### 11.0 The one gating decision — Xero in or out (Open Decision #6)

This decides P8's whole shape, so it leads. Two architectures:

- **(A) Native ledger.** ProjMan2 becomes the accounting system of record: double-entry
  general ledger, chart of accounts, native GST/BAS computation, TPAR, depreciation, and
  later PAYG/super. Largest build; a **standing liability** to track ATO format/rate
  changes and effectively certify a tax engine.
- **(B) Facts-here, ledger-there (RECOMMENDED for v1).** ProjMan2 stays the *operational
  and commercial* system of record and owns the **source-of-truth tax facts** —
  GST-classified amounts, TPAR-reportable contractor payment lines, the `S18.11`
  fixed-asset/depreciation draft — while the **general ledger lives in the accountant's
  existing package** (Xero/MYOB — every AU building SME already runs one). This matches
  the market, keeps ProjMan2 out of the tax-engine-certification business, and gives the
  external `accountant` (Open Decision #7) something to consume without ProjMan2 growing a
  GL it doesn't need.

Within (B), two delivery increments:

- **(b1) Export-first (RECOMMENDED to build first).** Every artifact — TPAR file, BAS
  worksheet, GST transaction listing, depreciation schedule — is a **pure function of data
  ProjMan2 already holds**. No OAuth, no rate limits, no external dependency; the
  accountant downloads and lodges. Fully decoupled, shippable now.
- **(b2) Xero/MYOB API sync (later increment, P8.x / P9).** Push the same facts over the
  Xero API and pull reconciliation back. Same source facts as (b1), so **(b1)'s tables are
  the substrate (b2) syncs from — no rework**, exactly the two-phase shape used for
  documents (REST now / presigned later) and online orders.

**DECIDED (owner, 2026-08-01):** **(B) + (b1)** for P8 v1 — native source-of-truth tax
facts + export; the live Xero/MYOB API sync (b2) is deferred behind a later go on Open
Decision #6. The tables below are identical under (b1) or (b2), so this ruling unblocks all
of P8a–P8c; only the sync adapter waits. P8a is now authorised to build (§11.3 migration v022).

### 11.1 Scope of P8 v1 (under the recommendation)

| Phase | Deliverable | Uses / builds on |
|---|---|---|
| **P8a** | **Fixed assets & depreciation** — the `S18.11` system-prepared draft → `S18.12` `tax.approve` gate. Smallest, self-contained, and its permission gate already exists. | existing `tax.approve` (v012), `S18.12` hold point (v016) |
| **P8b** | **GST & BAS** — GST classification on the commercial money rows + `tax_periods` (quarterly BAS) + BAS roll-up + export. | `organisations.gst_registered`/`abn`, `progress_claims`, `supplier_invoices`, `estimate_lines` |
| **P8c** | **TPAR** — annual contractor-payments report assembled from the existing payment spine + export file. | `project_payments` (`tpar_reportable`, `payee_user_id` → payee org `abn`) |

**Out of P8 v1 (explicitly):** native double-entry GL / chart of accounts (obviated by (B));
live Xero/MYOB API sync (b2, gated on #6); **PAYG/super payroll** — a large distinct domain,
proposed for **P9**, not folded in here (flag below).

### 11.2 Data model (greenfield tables — REST-mediated, not sync-registry)

These are office/desk artifacts computed server-side, not device-synced — like the P7
commercial tables, they ride REST endpoints, not the `SyncService` pull. All are
`org_id`-scoped; period/report tables are org-level (not project-scoped).

**P8a — fixed assets & depreciation**
```sql
fixed_assets(
  id, org_id, project_id?,               -- project_id set when the asset arises from a job (S18.11)
  description, category,                  -- ATO asset class (plant/equipment/…)
  acquisition_cost DECIMAL(12,2), acquired_at DATE,
  method ENUM('prime_cost','diminishing_value') NOT NULL,
  effective_life_years DECIMAL(5,2),
  source_supplier_invoice_id?,           -- soft link to P7b where the asset was purchased
  status ENUM('draft','approved') NOT NULL DEFAULT 'draft',  -- S18.11 writes draft; S18.12 approves
  approved_by?, approved_at?,            -- stamped by the tax.approve write
  is_deleted, created_at )
depreciation_schedule(                    -- system-prepared lines, the "draft" content of S18.11
  id, org_id, fixed_asset_id,
  fy CHAR(7),                             -- e.g. '2025-26'
  opening_value DECIMAL(12,2), depreciation DECIMAL(12,2), closing_value DECIMAL(12,2),
  created_at )
```
`S18.11` = `DepreciationService.prepareDraft(projectId)` writes `fixed_assets(status='draft')`
+ its `depreciation_schedule` lines, **no external transmission**. `S18.12` = the
`tax.approve` write (`accountant`) flips `status='approved'` + stamps approver; only an
approved asset is eligible for the depreciation export / hand-off. This is the one place the
already-stubbed gate has a concrete home, so P8a is the natural first slice.

**Asset-entry path — RULED (decision #17, 2026-08-02, at build time).** How does a row get into
`fixed_assets`? Two candidates: **(A)** an explicit create endpoint (a human declares the asset)
or **(B)** derived automatically from capital `supplier_invoices` at prepare time. **BUILT: (A).**
(B) is not buildable on v022 as applied, for two reasons that are not a matter of effort:
`supplier_invoices` (v019) carries **no capital/expense flag**, so a derive pass has nothing to
distinguish a depreciable plant purchase from a consumable — adding that column is a schema
change, i.e. P8b territory; and the depreciation inputs proper (`method`, `effective_life_years`,
ATO `category`) are **accountant judgements that exist nowhere on an invoice**, so even a perfect
capital flag could not populate them. (B) is preserved as a later *additive* path rather than
designed out: `source_supplier_invoice_id` is a soft provenance ref, so a future "derive
candidates from capital invoices" pass can pre-fill draft assets pointing at their source
invoice, and the schedule/approve/export chain downstream works unchanged.

**Endpoints as built (P8a):**

| Method | Path | Gate |
|---|---|---|
| `GET` | `/projects/:id/fixed-assets` (`?status=`) | `money.read` **OR** `tax.approve` |
| `POST` | `/projects/:id/fixed-assets` | `money.write` |
| `POST` | `/projects/:id/fixed-assets/prepare-draft` | `money.write` (S18.11) |
| `POST` | `/projects/:id/fixed-assets/:assetId/approve` | `tax.approve` (S18.12) |

The read gate is `money.read` **OR** `tax.approve` deliberately: the `accountant` holds *only*
`tax.approve` (v012), so a bare `money.read` gate would leave them unable to SEE the asset they
are required to approve. It matches the shape of the neighbouring reads rather than inventing one
(`/:id/progress-claims` = money.read OR claims.submit; `/:id/subcontractor-register` = money.read
OR po.write). The proper long-term home is the org-level `accounts.read` landing in P8b
(decision #13); this is the P8a-shaped stand-in until then.

Depreciation maths as built: `prime_cost` = straight line (`cost ÷ effective_life`);
`diminishing_value` = ATO post-2006 rate (`200% ÷ effective_life`) on the written-down value. The
acquisition FY is **pro-rated by days held**, which is why a schedule normally runs one FY past the
nominal life. DV asymptotes, so the final FY **writes off the remainder** — making
`Σ depreciation === acquisition_cost` for both methods, with nothing stranded. Re-preparing is
idempotent (lines are replaced per asset), and **an already-approved asset is never re-prepared**,
so the S18.12 stamp cannot be silently invalidated.

**P8b — GST & BAS**
```sql
-- GST classification, added to each amount-bearing commercial row (progress_claims,
-- supplier_invoices, estimate_lines, project_payments). Additive columns, existing `amount`
-- semantics UNCHANGED (see the ex/inc decision in §11.4):
  gst_treatment ENUM('gst','gst_free','input_taxed','out_of_scope') NOT NULL DEFAULT 'gst',
  gst_amount    DECIMAL(14,2) NOT NULL DEFAULT 0        -- 10% where treatment='gst' & org gst_registered
                                                        -- (12,2 on project_payments — see note)
tax_periods(                              -- one per org per BAS quarter (AU FY = 1 Jul–30 Jun)
  id, org_id, period_start DATE, period_end DATE,
  basis ENUM('accrual','cash') NOT NULL DEFAULT 'accrual',
  g1_total_sales DECIMAL(14,2), a1_gst_on_sales DECIMAL(14,2),
  b1_gst_on_purchases DECIMAL(14,2), net_gst DECIMAL(14,2),   -- computed roll-up, cached at prepare
  status ENUM('open','prepared','lodged') NOT NULL DEFAULT 'open',
  prepared_by?, prepared_at?, lodged_at?,
  UNIQUE (org_id, period_start) )
```
**BUILT as migration v023 (2026-08-02) — schema only; `TaxService` is NOT yet written.** Three
corrections to the sketch above, all forced by the code as it actually stands:

1. **`gst_amount` precision is per-table, not a flat `12,2`.** `estimate_lines`,
   `progress_claims` and `supplier_invoices` carry `amount DECIMAL(14,2)` (v017/v019), so their
   `gst_amount` is `14,2`; `project_payments.amount` is `DECIMAL(12,2)` (v013), so its is `12,2`.
   A GST column narrower than the base amount it derives from is an overflow waiting to happen.
2. **The ex/inc convention is now pinned.** Decision #12 said `amount` is not re-interpreted and
   `gst_amount` is additive — which fixes the meaning as `amount` = **GST-exclusive base**,
   `gst_amount` = the GST on top, and the **GST-inclusive gross (BAS G1) = `amount + gst_amount`**.
   Existing P7 rows land `gst_amount = 0`, i.e. "not yet classified" rather than a false claim of
   GST-free; `TaxService` classifies them at prepare time.
3. **`tax_periods` gains `lodged_by`** (and `is_deleted`), for symmetry with the P8a approval
   stamp — "who lodged this" is the same evidentiary question as "who approved this".

The G1/1A/1B/net figures are a **cached roll-up written at prepare time, not a live view**: a
lodged BAS must keep reporting what was lodged even as later rows are edited. That is the whole
reason the summary is stored rather than computed on read.

`TaxService.prepareBas(orgId, period)` classifies every in-period money row by
`gst_treatment`, rolls up G1/1A/1B/net, caches the summary on `tax_periods`, sets
`status='prepared'`; the `tax.approve`-holder locks it to `lodged`. Export = a BAS worksheet
+ a GST transaction listing (CSV) the accountant lodges.

**P8c — TPAR**
```sql
tpar_reports(                             -- one per org per financial year
  id, org_id, fy CHAR(7),
  status ENUM('open','prepared','lodged') NOT NULL DEFAULT 'open',
  prepared_by?, prepared_at?, lodged_at?,
  UNIQUE (org_id, fy) )
tpar_lines(                               -- assembled from project_payments, snapshot at prepare
  id, org_id, tpar_report_id,
  payee_user_id, payee_abn VARCHAR(11), payee_name,   -- ABN resolved from the payee's org profile
  gross_paid DECIMAL(14,2), gst_paid DECIMAL(14,2),
  source_payment_ids JSON )                            -- provenance back to project_payments
```
`TparService.prepare(orgId, fy)` selects `project_payments WHERE tpar_reportable=1` in the FY,
groups by `payee_user_id`, resolves each payee's ABN from their org profile, snapshots
`tpar_lines`; export = the ATO TPAR file (or CSV for the accountant). No new payment capture —
the spine (`project_payments`, v013) already carries everything TPAR needs.

### 11.3 Access & matrix plan

- **`accountant` + `tax.approve`** — already built (v012). P8a's `S18.12` approve write reuses
  `tax.approve` verbatim; **no matrix change for P8a**.
- **New `accounts.read`** — org-scoped view/export of BAS/TPAR/depreciation artifacts (these
  are org-level financial aggregates, not project-level, so `money.read`'s project scoping is
  the wrong shape). **BUILT in v023; matrix is now v10.**
  **⚠ SPEC CORRECTION — there is no `org_admin` role.** This section previously said "grant to
  `org_admin` + `accountant`", naming a role that does not exist. The nine roles are
  `projectManager`/`siteSupervisor`/`foreperson`/`tradie`/`inspector`/`client`/`builder`/
  `developer`/`accountant`; tenant-**owner** authority is the `users.is_org_owner` flag
  conferring `OWNER_CAPABILITIES` (`org.manage`/`users.manage`/`devices.manage`), decoupled
  from the fixed role by v018/xprojman-08. The grant therefore landed on **`projectManager`**
  (the tenant-owner role in practice, and already the `money.read` holder) **+ `accountant` +
  `developer`**.
- **`tax.approve` semantics** — proposed to cover *approving any tax artifact for lodgement*
  (depreciation approve **and** BAS lock **and** TPAR lock), i.e. the accountant is the single
  tax gatekeeper — rather than minting `tax.lodge`. Decision in §11.4.

**Migration numbering** (next free = **v022**):

| Migration | Contents | Matrix |
|---|---|---|
| **v022** | P8a: `fixed_assets` + `depreciation_schedule`; `S18.11` draft / `S18.12` approve wiring | none (uses `tax.approve`) |
| **v023** | P8b: GST columns on commercial rows + `tax_periods` + `accounts.read` — **BUILT + applied to c1projman2_e2e 2026-08-02** (schema only; `TaxService`/BAS roll-up not yet coded) | **v9 → v10 (done)** |
| **v024** | Documents/Upload module (`documents`) + `documents.write` — xprojman-21/23 | **v10 → v11** |
| **v025** | `documents.read` (builder) — decision #19, Builder document visibility on engaged jobs | **v11 → v12** |
| **v026** | P8c: `tpar_reports` + `tpar_lines` + TPAR assembly/export — **BUILT 2026-08-04** | none (reuses `accounts.read` + `tax.approve`) |

Services (REST, mirroring the P7 commercial pattern): `DepreciationService`, `TaxService`
(GST/BAS), `TparService`. Routes under `/projects/:id/*` (fixed assets) and org-level
`/accounts/{bas,tpar,depreciation}`. Engagement-mode redaction (§7.2.1) applies unchanged to
any project-level cost figures these surface.

### 11.4 Decisions (RULED by owner 2026-08-01)

| # | Decision | Ruling |
|---|---|---|
| 6 | **Xero/MYOB — in or out for v1** (carried from §10). | **RULED: (B)+(b1)** — native source facts + export now; live API sync deferred behind a later go. Unblocks P8a–c; only the sync adapter waits. |
| 12 | **GST ex/inc convention** on the existing `amount` columns (`progress_claims`, `supplier_invoices`, `estimate_lines`, `project_payments`). | **RULED:** existing `amount` meaning **untouched**; add **additive** `gst_amount` (10% where `gst_treatment='gst'` and org `gst_registered=1`). No P7 row is re-interpreted. |
| 13 | **`accounts.read` new permission vs. reuse `money.read`.** | **RULED: new `accounts.read`** — BAS/TPAR are org-level aggregates, not the project-scoped cost figures `money.read` governs. Granted `org_admin` + `accountant`; `developer` read included. Added in P8b (matrix v9→v10). |
| 14 | **`tax.approve` extended vs. new `tax.lodge`.** | **RULED: extend `tax.approve`** to all tax-artifact lockings (depreciation approve + BAS lock + TPAR lock) — the accountant is the single tax gatekeeper; no new verb. |
| 15 | **BAS basis** — cash vs. accrual (AU SMEs may elect). | **RULED: default `accrual`**, with a `basis` column per `tax_periods` row so an org can elect cash later without a schema change. |
| 16 | **PAYG/super payroll** — P8 or P9? | **RULED: P9**, separate — payroll is a distinct domain; P8 stays entity/project tax. Not in P8 scope. |
| 18 | **⚠ OPEN — can a Builder-founder see their own org's accounts?** `accounts.read` went to `projectManager`/`accountant`/`developer` (v023). A **self-registered Builder who founded their own org** holds the `builder` role, so they cannot see their own BAS/TPAR. Granting `builder` the permission is the WRONG fix — it would leak `accounts.read` into every org they are merely *engaged* into, exactly the xprojman-08 trap `OWNER_CAPABILITIES` exists to prevent. The right fix is adding `accounts.read` to `OWNER_CAPABILITIES` in `lib/access.js` (owner-flag conferred, org-scoped by definition) — a **code** change, deliberately not smuggled into a migration. **Awaiting owner ruling before P8b's service layer.** |
| 17 | **Asset-entry path** — explicit create endpoint vs. derive from capital `supplier_invoices`. | **RULED: (A) explicit create endpoint** (built 2026-08-02). (B) is not buildable on v022 — no capital flag on `supplier_invoices`, and `method`/`effective_life_years`/`category` are accountant judgements absent from any invoice. Kept as a later additive path via the soft `source_supplier_invoice_id`. Full reasoning in §11.2. |
| 7 | Accountant login (carried from §10). | **RULED: no accountant login** — export-first; PM/org_admin downloads and hands off, or the accountant uses the existing narrow `assigned`-scope login. No change. |

---

© eBizco Australia Pty Ltd — prepared against the 18-Stage Construction Lifecycle
Specification v3.4, 26 July 2026.
