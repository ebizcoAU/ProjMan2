# ProjMan2 — Development Framework

**Status:** 🟡 CONCEPT — framework, navigation and database defined; no code yet
**Date:** 2026-07-22
**Owner:** eBizco Australia (Vince Phan)
**Language:** English only. No Vietnamese strings anywhere in this project.

---

## 0. What ProjMan2 is

A **project management platform for building and construction**, delivered as:

- a **web console** (React + Next.js) for the office — programme, costs, customers,
  staff, claims, reports;
- a **field app** (Flutter, ported from MAOI) for the site — attendance, site diary,
  safety, inspections, photos, all offline-first;
- a **server** (Nexus) providing registration, recovery, authentication, device
  identity and sync.

It is **multi-tenant**: each subscribing builder is an organisation, creates its own
projects, and holds its own customers. Nothing crosses the tenant boundary.

### The purpose, stated plainly

Project management here means **on schedule, on budget, delivered** — and the work
that actually achieves that is *coordination*: between subcontractors, against
quotes and estimates, tracking invoices and payments, and knowing where the
materials are. So the system's job is that **everything is in its place, ready the
moment it is needed**:

| Question the user asks | What must be in place |
|---|---|
| Are we on schedule? | programme, stages, hold points, dependencies |
| Are we on budget? | estimate → quote → contract → committed → actual → claimed |
| Who is doing what, when? | subcontractor engagements, assignments, attendance |
| What did we quote, and what did it cost? | estimating library, quotes, variations |
| Have we paid them? | supplier invoices, payment runs, retentions, wages |
| What material, where, at what price? | material catalogue, supplier price lists, deliveries |

**Accounting is not an adjunct — it is half the product.** Spending, payments to
subcontractors and to own staff, the ledger, and Australian tax all sit in the core,
ported from MAOI (§5.9). A build tool that cannot tell the builder what the job has
cost is not a build tool.

### Where it comes from

| Source | What we take |
|---|---|
| `~/Documents/Dev/ProjMan` (legacy) | The domain model — the WBS spine `project → module → phase → task` with budget/actual/completion, the `groupx` tenant idea, timesheets, todo, issues, documents. Mining-engineering-design framing is **dropped**; the cost-control skeleton is kept. |
| `ftpos` MAOI variant | ~70% of the platform: authentication, registration, recovery, device pairing and roles, sync, offline-first image queue, purchasing/expenses, accounting, fixed assets and depreciation, staff roster and attendance. |
| `ftposDecisions/ProjMan.md` | The 18-stage construction and procurement lifecycle (WA planning → DA → slab → cross-border manufacture → craning → trade tie-in). Carried as an **optional project template**, see §5.3. |

### What ProjMan2 is *not*

No selling, no POS, no menus, no dishes or recipes, no rooms or bookings, no
Vietnamese tax. MAOI's **buy side** is kept; its **sell side** is dropped entirely.

---

## 1. Repository layout

```
~/Documents/Dev/Projman2/
├── app/          Flutter field app — ported from MAOI, English only
├── server/       Nexus-side work (built by NexusPM, mirrored here for reference)
├── web/          Next.js management console            [P8, not yet started]
├── docs/         This framework + decisions
└── README.md
```

Decisions follow the ftpos convention: numbered records in `docs/decisions/`,
`PM2-NN-title.md`. Anything requiring Nexus server work is written as a
decision record and handed to NexusPM — never edited directly.

---

## 2. Thinking as the user

The framework below is derived from what these two people actually do in a day,
not from what the old schema happened to contain.

### The Builder / Project Developer

Wins land or a contract → sets a budget and a cost plan → engages subcontractors
on purchase orders → watches committed vs actual vs claimed → issues progress
claims to the customer and approves subbie invoices → collects the compliance
certificates that let the job be handed over. Their questions are **"what has
this job cost me, what have I committed, and what can I claim this month?"**

### The Project Manager / Site Supervisor

Their day, in order:

1. **Who is on site?** Sign tradies in; a headcount that is also the safety record.
2. **Toolbox talk**, inductions for anyone new on site.
3. **What is programmed for today**, and does anything hit a **hold point** that
   needs an inspector or engineer before work continues?
4. **Deliveries** — dockets against orders.
5. **Walk the site** — hazards, incidents, defects, photos.
6. **Close the day with a site diary entry** — weather, headcount, work done,
   delays and their cause.

That last one matters more than it looks: the site diary is the legal record
behind every delay and extension-of-time claim. **It is the app's most important
single feature**, and it must work with no signal and gloves on.

**Design consequence:** the field app is *capture-first*. Everything it does is
fast entry with photos, queued locally, synced when there's signal. Analysis,
Gantt editing and financial work belong on the web console, not the phone.

---

## 3. Roles

**Role model v2 — LOCKED 2026-07-22.** Two decisions taken: **(1) Keep + Add** —
`project_developer` stays a builder-side role (it is *not* reassigned to the
client); `construction_manager` is **added** as a new role. **(2) Scoped v1** —
the target model is 12 roles; the rows flagged ✅ ship in v1, the rest arrive
post-v1 as their modules come online (gated server-side by `ROLE_NOT_ASSIGNABLE`).

| # | Role | `role` enum | v1 | Surface | Scope |
|---|---|---|---|---|---|
| 1 | **Org Admin** | `org_admin` | ✅ | Web | Tenant owner. Billing, users, org settings, device admin. |
| 2 | **Project Developer** | `project_developer` | ✅ | Web | Builder-side principal. Creates projects and customers, sets budgets, approves variations and claims. Financial visibility across the portfolio. |
| 3 | **Project Manager** | `project_manager` | ✅ | Web + App | Runs assigned projects: programme, staff, attendance, safety, inspections, reports. Sees project costs, not portfolio finance. |
| 4 | **Site Supervisor** | `supervisor` | ✅ | App + Web | Site subset of PM: attendance, diary, hazards, defects, photos. No financials. |
| 5 | **Foreperson / Leading Hand** | `foreperson` | ✅ | App | Crew-level subset of Supervisor: crew attendance, task progress, hazards, photos. No diary sign-off, no financials. |
| 6 | **Tradie** (individual) | `tradie` | ✅ | App | Self check-in/out, own assigned tasks, upload own certificates and dockets. Sees nothing else. |
| 7 | **Inspector / Certifier** | `inspector` | ✅ | App + Web | First-class but **temporary + project-scoped**; Quality tab only (appspec Decision 3). Engagement per projman-02 (external C1 or in-house paired device C2). |
| 8 | **Client** | `customer` | ✅ | Portal | Read-only progress view of *their own* project; approve/decline variations, view claims. Portal only — never a sync writer. |
| 9 | **Construction Manager** | `construction_manager` | ⚠️ post-v1 | Web | Cross-project delivery oversight: programme and resources across the portfolio. Not org admin, not portfolio finance approval. |
| 10 | **Estimator / QS** | `estimator` | ⚠️ post-v1 | Web | Cost library, estimates, tenders, quotes. No site operations. |
| 11 | **Subcontractor** (business) | `subcontractor` | ⚠️ post-v1 | App + Web | Engaged business entity with own crew: own POs, claims and dockets, engagement-scoped (projman-02). Distinct from the individual Tradie. |
| 12 | **Labourer / Apprentice** | `labourer` | ⚠️ post-v1 | App | Attendance, assigned tasks, inductions only. Apprentice variant accrues CPC evidence (§12). |

**Enum note.** v001 shipped `org_admin | project_developer | project_manager |
supervisor | tradie | customer`. Role model v2 **adds** `inspector` + `foreperson`
(v1) and `construction_manager` + `estimator` + `subcontractor` + `labourer`
(post-v1, refused at assignment until enabled). Additive only — no existing value
is renamed or reassigned, so no data migration. The enum change is a projman-01
contract amendment owned by NexusPM (see projman-01 §9).

**Device roles.** Reuse MAOI's secondary-device pairing model (ftpos XF-06/07/41):
a device is paired to the org and **bound to a role**, so a shared site tablet
*is* the supervisor device without a shared password. Role lives on the
`devices` row, not on a login the crew passes around.

**App UI shortlist — LOCKED 2026-07-22.** The 12-role model is a **server**
concern (enforcement, permissions, future-proofing). The **pairing screen shows
exactly 5 roles** — the ones that answer "what am I doing on this site?":

| Pairing screen label | `role` enum | Who uses this |
|---|---|---|
| Site Manager | `supervisor` | Runs the site daily |
| Foreman | `foreperson` | Leads a crew |
| Tradie | `tradie` | Does the work |
| Inspector | `inspector` | Checks quality/compliance |
| Project Manager | `project_manager` | Office + site oversight |

Never shown on the pairing screen: `org_admin`, `project_developer`,
`construction_manager`, `estimator`, `subcontractor` (web console — a subbie
principal manages the business on web; their crew pairs as **Tradie**),
`labourer` (pairs as **Tradie** — one label covers both on site), `customer`
(portal only, never a device role).

**Enforcement.** The permission matrix is **server-enforced** (see §13.2); the
app's `RoleVisibility` provider only thins CONTENT cosmetically (appspec
Decision 2) and is never a security boundary.

---

## 4. Navigation — field app

MAOI's shell is kept: five bottom tabs over an `IndexedStack`, sub-pages cycled by
**tapping the header title**, back returns to the tab's default page. Deliberately
fewer options than MAOI — this app is used one-handed on a site.

```
ProjMan2 app
├── 0 · Projects   → list → detail          ·title· Projects / Programme / Costs
├── 1 · Site       → today's site view      ·title· Today / Site Diary / Attendance
├── 2 · Safety     → toolbox, hazards       ·title· Safety / Incidents / Inductions
├── 3 · Quality    → inspections            ·title· Inspections / Defects / Certificates
└── 4 · Profile    → identity + org         ·title· Profile / Device & Sync
```

- **Projects** — assigned jobs; detail shows stages, tasks, % complete; Costs is
  read-only on mobile.
- **Site** — the daily driver. Today = attendance + what's programmed + deliveries.
  Site Diary is the end-of-day entry (weather auto-filled, headcount from
  attendance, notes, photos).
- **Safety** — toolbox talks, inductions, hazard and incident capture. Incident
  entry must be reachable in two taps from anywhere.
- **Quality** — inspection checklists and hold points, defect list with photos,
  certificate upload.
- **Profile** — who this device is, what role it holds, sync state.

The web console carries everything heavier: Gantt, cost plan, estimating, purchase
orders, progress claims, the ledger, BAS and TPAR, customer and staff admin,
reporting.

**Where accounting lives.** The full ledger and tax surfaces are web-primary — they
are desk work. What the *field* app must do is **capture**: photograph a supplier
invoice or delivery docket on site, code it to a project and stage, and queue it.
MAOI already does exactly this for expenses with its offline image queue, so the
capture half ports nearly unchanged. Costs are visible on mobile, read-only, at
stage level: estimated / committed / actual / claimed.

---

## 5. Database

SQLite on the device, MySQL on Nexus, same table and column names, synced by
MAOI's dirty-tracking pattern (`is_dirty` / `sync_status` → queue → push/pull).
The single-writer-per-entity ownership contract (ftpos XF-27) applies unchanged.

### 5.1 Carried over from MAOI

Reused close to as-is — this is the 70%:

| Table | Adaptation |
|---|---|
| `businesses` | → the tenant/org (builder company). ABN instead of MST. |
| `people` | customers, subcontractors, suppliers, staff — by `type`. |
| `device_registry`, `pairing_tokens`, `auth_session`, `handoff_state` | none — identity and device roles port directly |
| `sync_queue`, `sync_log`, `sync_metadata`, `sync_conflicts`, `data_sync` | none |
| `settings`, `setting_cache`, `licenses`, `security_log`, `error_log` | none |
| `business_expenses`, `purchase_items` | → supplier invoices and cost lines |
| `fixed_assets`, `depreciation_schedule` | → plant and equipment; completed projects capitalise here |
| `staff_roster`, `attendance_records` | → site attendance (add project + geo + trade) |
| `payroll`, `payroll_items`, `salary_records` | → own-staff wages; AU rules (PAYG, super) in P7 |
| `item_master` | → **material catalogue** — the same table doing the same job for a different catalogue |
| `inventory_stocks`, `stock_ledger` | → **materials on site**: what was delivered, what is left, what was wasted |
| MAOI ledger + accounting | → the ledger core, see §5.9 |

**Dropped:** `sales`, `sale_items`, `dish_ingredients`, `cook_sessions`,
`cook_session_lines`, `table_layouts`, `table_orders`, `quick_receipts`,
`web_menu_settings`, `rooms`, `room_types`, `bookings`, `booking_charges`,
`einvoice_*`, `cccd_transaction_log`, `kit_items`.

**Replaced, not dropped:** `tax_declarations` and `debts` are VN-shaped —
the concepts survive as AU equivalents in §5.9.

> Correction against an earlier draft of this document: `item_master`,
> `inventory_stocks` and `stock_ledger` were initially listed as dropped. They
> are not — a builder catalogues materials and tracks what is on site for exactly
> the reasons a kitchen catalogues ingredients and tracks stock. The MAOI
> inventory work (ftpos XF-24/XF-28) is reused, not rebuilt.

> `inspection_sessions` / `inspection_qr_codes` exist in MAOI for a different
> purpose — evaluate before reuse rather than assuming they fit (§8).

### 5.2 New — construction core

```
customers            org_id, name, abn, contact, address, notes
projects             org_id, customer_id, code, name, site_address, lot_plan,
                     contract_value, contract_type, start_date, due_date,
                     status, template_id, pm_user_id
project_stages       project_id, seq, stage_code, name, status,
                     is_validated, start_date, end_date, budget_amount
tasks                project_id, stage_id, parent_id, name, budget_hours,
                     budget_amount, completion, start_date, end_date,
                     assigned_to, predecessor_id
```

`project_stages` replaces the legacy `module → phase` pair. Legacy nesting was
four fixed design phases per module; construction wants **one ordered stage list
per project**, instantiated from a template, with arbitrary task nesting under it
(`tasks.parent_id`). Simpler, and it maps to how a programme is actually drawn.

### 5.3 Stage templates

```
stage_templates      org_id, name, industry, is_system
stage_template_items seq, stage_code, name, default_duration_days,
                     requires_inspection, requires_certificate
```

The **18-stage matrix from `ProjMan.md` ships as a system template**
(`WA_RESIDENTIAL_18`), not as hardcoded schema. That keeps its WA-specific and
import-specific stages (Fremantle breakbulk, TT milestones, craning) available
without forcing them on a builder doing a simple renovation. Builders clone and
edit templates.

### 5.4 Site operations

```
site_diary           project_id, entry_date, weather, temp_c, headcount,
                     work_done, delays, delay_cause, notes, author_id
site_attendance      project_id, person_id, trade, check_in_at, check_out_at,
                     check_in_geo, method (self|supervisor|qr), induction_ok
deliveries           project_id, supplier_id, po_id, received_at, docket_no, notes
```

### 5.5 Safety (OHS/WHS)

```
swms                 project_id, trade, title, document_id, valid_from, valid_to
toolbox_talks        project_id, held_at, topic, presenter_id, notes
toolbox_attendees    toolbox_id, person_id, signed_at
inductions           project_id, person_id, inducted_at, expires_at, document_id
hazards              project_id, raised_by, raised_at, description, severity,
                     control_measure, status, closed_at
incidents            project_id, occurred_at, type (injury|near_miss|damage|env),
                     description, persons_involved, notifiable, reported_at,
                     investigation, status
```

`incidents.notifiable` flags the WorkSafe-reportable cases — the app should say
so at entry time, not leave it to be discovered later.

### 5.6 Quality and compliance

```
inspections          project_id, stage_id, type, scheduled_at, inspector,
                     is_hold_point, result, completed_at, document_id
inspection_items     inspection_id, seq, description, result, note, photo_id
defects              project_id, raised_at, location, description, trade,
                     assigned_to, due_date, status, closed_at, photo_id
certificates         project_id, type, reference, issued_by, issued_at,
                     document_id
```

`inspections.is_hold_point` is the one with teeth: an open hold point should
**block** the stage from being marked complete.

### 5.7 Estimating, quoting and materials

The front half of the money chain — what a job *should* cost, before it does.

```
cost_library         org_id, code, name, unit, category, rate,
                     labour_rate, material_rate, updated_at
                     -- the builder's own rates; the basis of every estimate

estimates            org_id, customer_id, project_id?, number, name, status,
                     margin_pct, overhead_pct, total_cost, total_price, valid_until
estimate_lines       estimate_id, seq, stage_code, cost_library_id, description,
                     qty, unit, rate, cost, markup_pct, price, trade

quotes               estimate_id, customer_id, number, issued_at, expires_at,
                     status (draft|sent|accepted|declined), accepted_at,
                     document_id
                     -- an accepted quote is what creates the project + its budget

subcontractor_quotes project_id, stage_id, supplier_id, trade, scope,
                     amount, received_at, status, document_id
                     -- quotes coming IN, compared side by side before award
```

Materials (on `item_master` + `inventory_stocks` + `stock_ledger` from MAOI):

```
supplier_prices      item_id, supplier_id, price, unit, valid_from, valid_to
                     -- same material, several suppliers, current price each
```

The estimate is the spine of the budget: accepted quote → project → stage budgets →
POs committed against them → invoices actual against those. A builder should be able
to open any stage and see **estimated / committed / actual / claimed** side by side.
That single row is the product.

### 5.8 Commercial

```
purchase_orders      project_id, supplier_id, stage_id, po_number, description,
                     amount, status, issued_at
supplier_invoices    project_id, supplier_id, po_id, stage_id, invoice_no,
                     amount, gst, invoice_date, status, approved_by
variations           project_id, number, description, amount, status,
                     submitted_at, approved_at
progress_claims      project_id, number, period_from, period_to, claimed_amount,
                     approved_amount, status, submitted_at
retentions           project_id, claim_id, amount, release_due
documents            org_id, project_id, kind, filename, path, uploaded_by,
                     uploaded_at, is_dirty
```

**Invoice gate** (from `ProjMan.md` §4.1): a supplier invoice mapped to a stage
whose prerequisite stages are not `is_validated` is flagged as a compliance risk
and its progress payment frozen. Implemented server-side as a validation rule —
never client-side only.

### 5.9 Accounting and Australian tax

Ported from MAOI's ledger and accounting core — the largest single asset in the
port (MAOI's `ledger_tab.dart` is its biggest file) — with VN law swapped for AU.

```
chart_of_accounts    org_id, code, name, type (asset|liability|equity|
                     income|expense), parent_id, is_system
journal_entries      org_id, entry_date, reference, source (invoice|payment|
                     payroll|depreciation|manual), project_id?, memo, posted_at
journal_lines        entry_id, account_id, debit, credit, project_id?, stage_id?

payments             org_id, party_id, party_type (supplier|staff|ato),
                     project_id?, method, paid_at, amount, reference,
                     status, batch_id
payment_batches      org_id, run_date, total, status
                     -- the fortnightly subbie/wage payment run

bank_accounts        org_id, name, bsb, account_no, current_balance
bank_transactions    account_id, txn_date, amount, description,
                     matched_entry_id     -- reconciliation
```

**Australian tax:**

```
tax_periods          org_id, type (BAS|IAS), period_from, period_to,
                     due_date, status, lodged_at
bas_lines            period_id, label (G1|G11|1A|1B|W1|W2|…), amount
                     -- GST collected/paid, PAYG withheld

tpar_records         org_id, financial_year, supplier_id, abn,
                     gross_paid, gst_paid, status
                     -- Taxable Payments Annual Report

payg_withholding     staff_id, period_id, gross, withheld
superannuation       staff_id, period_id, ordinary_earnings, sg_rate, amount,
                     paid_at, fund
```

Four AU specifics that are **not** optional for this industry:

1. **GST at 10%** on both sides, reported quarterly on the **BAS**. `constants.js`
   in the legacy app already carried `gst: {AU: 0.1}` — the rate was never the hard
   part; the reporting is.
2. **TPAR** — the Taxable Payments Annual Report is **mandatory for the building and
   construction industry**. Every payment to a contractor must be reportable by ABN
   at year end. This is a direct reason the ledger must know that a payment went to
   a *subcontractor*, not merely to a *supplier* — design it in from the start
   rather than reconstructing it in July.
3. **PAYG withholding and superannuation** on own staff wages.
4. **ABN validation** — an unquoted or invalid ABN changes withholding obligations.

`fixed_assets` + `depreciation_schedule` port across for plant and equipment, and
for capitalising a completed project — but on **diminishing-value** ATO rules, not
VN straight-line.

> Everything here is *prepare-and-record*, matching MAOI's prepare-only stance on
> tax. ProjMan2 produces the numbers and the report; it does not lodge to the ATO.

### 5.10 Cost model

Legacy ProjMan was **hours-based** — budget hours vs timesheet, appropriate to a
design consultancy selling labour. Construction is **committed-cost based**:
budget → committed (POs) → actual (invoices) → claimed. Both are carried:
`tasks.budget_hours` for self-performed labour, `budget_amount` and the PO/invoice
chain for subcontracted work. A builder mostly reads the money; a PM reads both.

---

## 6. Authentication and the Nexus split

| Concern | Where |
|---|---|
| Register, login, password/account recovery | Nexus (`server/`) |
| Device registration, pairing, device roles | Nexus + app, ported from MAOI |
| Token issue and refresh | Nexus |
| Tenant/org membership and role assignment | Nexus |
| Domain data (projects, site, safety, quality, costs) | ProjMan2 API on Nexus |
| Offline cache and capture | App SQLite |

MAOI's registration flow scans a **CCCD** (Vietnamese national ID) QR — that must
be **removed**, not translated. AU registration is company (ABN) plus email;
identity documents, if wanted later, are a separate decision.

### 6.1 Sign-in surface — OAuth-first, three providers only

The app is **OAuth-first**: the three provider buttons are prominent, email +
password is the "or" fallback below.

| Provider | In? | Why |
|---|---|---|
| **Google** | ✅ | Universal — every Australian has a Google account |
| **Microsoft** | ✅ | Office 365 builders; Outlook/Hotmail tradies |
| **Facebook** | ✅ | High penetration among tradies and subcontractors |
| GitHub · Apple · X · TikTok · LinkedIn | ❌ | Wrong demographic / needless complexity — the server rejects any other with `UNSUPPORTED_PROVIDER` |

- **Email is the identity key.** A provider account links to an existing user by
  verified email (Google then Microsoft on one address → one account). Every
  provider **must** return a verified email.
- **Fallback:** email + password; **SMS verification of a +61 mobile** at
  onboarding (not a login method); password recovery by email (SMS later).
- **AU onboarding** after a first sign-in with no org: `state`, `business_type`
  (`sole_trader | partnership | company | trust`), `gst_registered`, ABN
  (optional in v1). See the compliance note in §10.
- Wire shapes are the **contract of record** in `docs/decisions/projman-01.md`
  §1.8 (OAuth/SMS/onboarding) — built and verified server-side, with an
  `OAUTH_DEV_BYPASS` so the app can build the full login→onboarding UI before the
  real provider apps exist.

Everything on the Nexus side is specified there and built by NexusPM.

---

## 7. Port plan

Feature by feature, as instructed. Each increment lands compiling and usable.

| # | Increment | Content |
|---|---|---|
| **P1** | Skeleton | Copy MAOI → `app/`. Strip BANOI variant axis, F&B, hotel, POS, VN tax, eInvoice, IVR (see §8), LAN/KDS, doorlock. English-only strings, `build_config` without the variant axis, AUD/`Australia/Perth`. Must build and run. |
| **P2** | Identity | Register / login / recover / device pairing + roles. CCCD removed, ABN+email in. Nexus half by NexusPM. **This is the first working milestone.** |
| **P3** | Data core | Schema v1 (§5) + migration runner + sync wiring + ownership contract. |
| **P4** | Projects | Customers, projects, stages, tasks, stage templates incl. `WA_RESIDENTIAL_18`. |
| **P5** | Site ops | Attendance, site diary, deliveries. The daily driver. |
| **P6** | Safety + Quality | Toolbox, inductions, hazards, incidents; inspections, hold points, defects, certificates. |
| **P7** | Commercial | Material catalogue + supplier prices, cost library, estimates, quotes in and out, POs, supplier invoices, variations, progress claims, invoice gate. |
| **P8** | Accounting | Ledger port from MAOI: chart of accounts, journals, payment runs to subcontractors and staff, reconciliation, `fixed_assets` capitalisation. |
| **P9** | AU tax | GST/BAS, **TPAR**, PAYG withholding, superannuation, diminishing-value depreciation. |
| **P10** | Web console + public portal | Next.js: Gantt, cost plan, estimating, customer and staff admin, reports; and the client-facing **public portal** (§7.1). |

P1–P2 are pure porting. P3–P6 is new construction domain work. P8–P9 is porting
again — MAOI's accounting with AU rules substituted — and is the second-largest
body of work after the skeleton itself.

### 7.1 Public portal (P10)

A separate Next.js surface — the **third client** the server serves (projman-01
§1.9), alongside the app and the office console. Read-only for **clients,
investors and financiers** to watch a job progress. Plan its requirements from P8
so they are clear by P10.

- **Shows:** progress (visual, % based), latest photo gallery, a simplified
  timeline (no Gantt), a budget summary, progress claims (view), documents to
  download, contact the project team.
- **Can do:** approve/decline a variation request — the only write, and it is
  role-gated (`customer`), never a sync writer.
- **Never shows** (commercial-sensitive / privacy): subcontractor names, internal
  costs and rates, the full schedule, safety/quality detail unless explicitly
  approved.

Isolation and the ownership matrix hold identically for the portal; the `customer`
role is refused by every write guard server-side.

---

## 8. Open decisions

Recorded rather than guessed. Each becomes a `PM2-NN` decision record.

1. ~~**Tradie and Customer logins in v1?**~~ **CLOSED 2026-07-22** by role model
   v2 (§3): **Tradie is v1 on the app** (paired device / QR self check-in — no
   open self-service registration until the projman-02 identity domain lands)
   and **Client is v1 on the portal** (read-only, invited). Supervisor-recorded
   attendance remains the fallback where a crew has no paired devices.
2. **Legacy `c1projman` data** — migrate the existing MySQL data, or start clean?
   Assumed **start clean**.
3. ~~**AU tax** — what replaces the VN engine?~~ **CLOSED 2026-07-22:** accounting
   and AU tax are core, not optional. Scoped in §5.9, built in P8–P9. The VN
   *rules* go; the ledger *machinery* ports.
4. **IVR / CGPA voice** — MAOI's largest distinctive asset and a genuinely good fit
   for gloved, noisy site use ("log a hazard", "sign in Dave"). **CLARIFIED
   2026-07-22:** IVR is a **non-negotiable killer feature** (development2 spec
   §9/§11), re-enabled and re-vocabularied for construction at **P5+** ("Hey
   ProjMan", Vosk on-device STT, Rasa NLU). The open question is only *when the
   code lands*: (a) port it **disabled in P1** so it is never lost, or (b) keep it
   out until P5 so it is not carried dead. **Current state:** the P1 seed-spine
   port chose (b) — the `ivr/` tree (~6k LOC) and `flutter_tts`/`speech_to_text`
   were **not** carried; MAOI's `core/ivr/` remains the port source when P5
   arrives. Pending the owner's call on (a) vs (b).
5. **`inspection_sessions` / `inspection_qr_codes`** — MAOI has these for another
   purpose; reuse or replace with §5.6.
6. **Product or internal tool** — selling to WA builders changes billing, onboarding
   and support surface. Affects P8 scope.
7. **Site access control** — the ozkey/BLE doorlock work could secure site sheds and
   gates. Out of scope now; noted as a natural fit.

## 9. Security note

Legacy `ProjMan/src/constants.js` holds live MySQL, MQTT and session secrets in a
repo with a GitHub remote. ProjMan2 uses environment variables for all secrets from
the first commit, and the legacy credentials should be rotated regardless of whether
that repo is public.

---

## 10. Verified Work History — the differentiator

The feature that sets ProjMan2 apart from every other construction platform.
**The problem:** builders and tradies self-report their experience; there is no way
to verify they did the work, on time, on budget, safely. **The solution:** every
project interaction the platform already captures *becomes evidence*, and a
person's evidence follows *them*, not any one builder.

**Evidence tiers**

| Tier | Weight | Source |
|---|---|---|
| **Primary** (system-generated) | 60% | site diary entries, attendance, inspection pass/fail, on-time/on-budget completion, safety incidents |
| **Secondary** (multi-party) | 30% | client satisfaction at handover, anonymised subcontractor feedback, peer review from other trades, dispute outcomes |
| **Tertiary** (external) | 10% | builder licence (state DB), trade certificates (RTO), insurance certificates, ABN verification |

A **trust score** rolls these up (weights above, scaled by project complexity), and
a **verified badge** signals it. The full algorithm lives in the product spec
(development2 §8.4); it is deliberately not frozen here.

### 10.1 The QR trust exchange — one primitive for the whole chain

The "beauty" of the model: a tradie is **independent** and takes instruction from
**many** builders at once. Engagement happens by a **QR trust exchange** — the same
handshake at every tier of the contractual chain (client → builder → subcontractor
→ tradie):

1. The **Principal** (the engaging party's primary device) generates a signed QR
   "appointment" — payload `{v, org, id, nonce, role, expires}`, signed by the
   Principal's device key.
2. The other party scans it and **shares their verified profile** (identity +
   trust score).
3. The Principal **reviews → accepts / declines**.
4. On accept: **project data flows** (scoped to the engagement) and **evidence
   accumulates** on both sides.

This extends — does not replace — MAOI's device pairing (§3). Pairing binds *one
device* to *one org* with a role; the trust exchange grants a *cross-org project
engagement*, and it is bidirectional (a profile is exchanged, not just a role
assigned). Geo-fencing guards against false attendance claims.

### 10.2 Open architectural decision — evidence vs tenant isolation ⚠

Verified Work History sits in **direct tension** with the platform's hardest rule:
**tenant isolation** (§0, §5 — "nothing crosses the tenant boundary", proven by
projman-01's 16/16 isolation tests). Yet a tradie's evidence must **span** many
builders and be **portable and owned by the tradie** — a cross-tenant flow the
isolation model otherwise forbids.

The reconciliation to design (not yet decided): project data stays locked inside
each builder's org, but each interaction **emits a signed attestation** into a
**tradie-owned, identity-scoped evidence store** that lives *outside* any one
builder's tenant; the counterpart builder is anonymised in the score. This is a
**third isolation domain** (identity-scoped, not org-scoped), which the current
single-`org_id` session model cannot yet express.

**This is the single most important design decision downstream of P3**, and it
gates the tradie-sharing and trust-score work. It becomes decision record
**`projman-02`** (App team + NexusPM) before any of it is built. Two questions
must be answered first: *(a)* is a tradie a full account that **owns** a cross-org
evidence record, or is evidence assembled only at read time? and *(b)* does a
multi-builder tradie hold **one session with many project-grants**, or **many
sessions it switches between** (MAOI's profile switcher is a precedent)?

---

## 11. Australian compliance

Making explicit what "AU rules" and "ABN instead of MST" have implied throughout.

- **Data residency.** All data — `c1projman2`, identity, PII, uploaded photos —
  stays on **Australian infrastructure** (AWS Sydney `ap-southeast-2` or Azure
  Australia East). The signup screen promises users "your details stay in
  Australia"; the SMS sender must also be AU-resident (projman-01 §1.8). *Confirm
  the current `c1projman2` host meets this.*
- **Privacy Act.** Stored PII complies with the Australian Privacy Act. A user
  **owns their verified work history** (§10); previous clients' details are
  **anonymised** in any reputation score.
- **ABN validation.** Modulus-89 checksum always; ABR API lookup when a guid is
  configured; the org records which level passed (`no | checksum | abr`) — it
  drives TPAR and withholding (§5.9). ABN is **optional in v1**, required for
  invoicing later.
- **Tax obligations** are core, not optional: GST/BAS, **TPAR** (mandatory for
  building & construction), PAYG withholding, superannuation (a **config rate** —
  12% from 1 July 2025, not a hardcoded constant), diminishing-value depreciation
  (§5.9, built P9).

---

## 12. CPC50220 Diploma alignment — the professional framework

ProjMan2's users hold (or train toward) a **Diploma of Building and Construction**.
Aligning the software to that qualification's competencies is the positioning move:
**the first construction platform that explicitly maps to CPC50220**, making it the
obvious tool for builders, RTOs and trainees. This section maps the qualification to
features, closes the seven gaps, and shows how alignment fuses with the Verified
Work History engine (§10).

### 12.0 The authoritative framework

Source of record: **CPC50220 Diploma of Building and Construction (Building),
Release 4** (training.gov.au, official PDF generated 24 Dec 2024). Packaging rule:

> **27 units = 24 core + 3 elective** (max one elective from any training package).

⚠ Do not take unit codes from web summaries or memory. An automated summary of this
same PDF returned superseded **CPC50210** codes (the `…A` suffix) and the wrong
count. The 24 core codes below are transcribed from the official document; the
frozen list lives at `docs/decisions/projman-03.md` and in the `cpc_units` seed
(§12.4). CPC50210's units are **not** interchangeable with these.

### 12.1 The seven gaps → units → where they land

The seven gaps map to real units and to a home module. Per the integration rule —
compliance folds into **Quality**, environment folds into **Safety**, new concerns
get a new home:

| # | Gap | Units it satisfies | Home module | New tables (§12.3) |
|---|---|---|---|---|
| 1 | **NCC Compliance Register** | CPCCBC4001, 4053, 5001 *(core)* · 6001 *(elec)* | Quality | `ncc_register` |
| 2 | **Environmental Management** | CPCCBC5011 *(core)* · 5012, CPCSUS5001/2/3, CPCCDE5001 *(elec)* | Safety | `environmental_plans`, `waste_tracking` |
| 3 | **Site Services Planning** | CPCCBC4018 *(core)* · 5006 *(elec)* | Site | `site_establishment`, `site_access_log`, `setout_records` |
| 4 | **Service Coordination** | CPCCBC5009 *(elec)* | Quality | `service_registers`, `service_clashes` |
| 5 | **Consultant Management** | CPCCBC5013 *(core)* · BSBPMG538 *(elec)* | Commercial | `consultants`, `consultant_contracts`, `consultant_reports` |
| 6 | **Plan Viewer** | CPCCBC4012, 4014 *(core)* | new (Documents) | `drawings`, `drawing_markups` |
| 7 | **Structural Compliance** | CPCCBC4010, 5018 *(core)* | Quality | reuses inspections/certificates/consultants |

Two honest notes:
- **Gap 4 maps to an elective, not a core unit** — genuinely useful, but a lower
  priority than the six that satisfy core units.
- **Gap 6 (Plan Viewer): PDF view + markup is achievable offline; DWG is not.**
  Plan to **store and version-control DWG**, render **PDF** on device, and treat DWG
  rendering as convert-to-PDF or web-only. Promising offline DWG markup would be a
  promise the field app cannot keep.

### 12.2 Traceability — all 24 core units

Status: ✅ already covered by the framework · 🟢 closed by a §12 gap · 🟡 needs a
small addition noted here.

| Unit | Title (abbrev.) | Feature / module | Status |
|---|---|---|---|
| BSBOPS504 | Manage business risk | `risk_register` (§12.3) | 🟡 |
| BSBWHS513 | Lead WHS risk management | Safety §5.5 | ✅ |
| CPCCBC4001 | Codes — Class 1 & 10 | NCC register (Gap 1) | 🟢 |
| CPCCBC4003 | Select/prepare/administer contract | `contracts` (§12.3) | 🟡 |
| CPCCBC4004 | Estimated costs | Estimating §5.7 | ✅ |
| CPCCBC4005 | Labour & material schedules for ordering | Materials + POs §5.7/5.8 | ✅ |
| CPCCBC4008 | Supervise site comms & admin | Site diary §5.4 + `comms_log` | 🟡 |
| CPCCBC4009 | Apply legal requirements | `compliance_register` (§12.3) | 🟡 |
| CPCCBC4010* | Structural principles — res/comm | Structural (Gap 7) | 🟢 |
| CPCCBC4012 | Read & interpret plans | Plan Viewer (Gap 6) | 🟢 |
| CPCCBC4013 | Prepare & evaluate tender docs | Tenders/quotes §5.7 | ✅ |
| CPCCBC4014 | Prepare building sketches | Plan Viewer markup (Gap 6) | 🟢 |
| CPCCBC4018 | Site surveys & set-out | Site Services (Gap 3) | 🟢 |
| CPCCBC4053 | Codes — Class 2–9 Type C | NCC register (Gap 1) | 🟢 |
| CPCCBC5001 | Codes — Type B | NCC register (Gap 1) | 🟢 |
| CPCCBC5002 | Monitor costing systems | Cost model §5.10 | ✅ |
| CPCCBC5003 | Supervise onsite planning | Programme §5.2 | ✅ |
| CPCCBC5005 | Select & manage contractors | Subcontractors §5.8 + trust exchange §10.1 | ✅ |
| CPCCBC5007 | Administer legal obligations | `contracts` + `compliance_register` | 🟡 |
| CPCCBC5010 | Manage construction work | Core PM (§4, §5.2) | ✅ |
| CPCCBC5011 | Manage environmental practices | Environmental (Gap 2) | 🟢 |
| CPCCBC5013 | Manage technical & legal reports | Consultant Mgmt (Gap 5) | 🟢 |
| CPCCBC5018* | Structural principles — ≤3 storeys | Structural (Gap 7) | 🟢 |
| CPCCBC5019 | Manage business finances | Accounting §5.9 | ✅ |

Result: **10 core units already covered, 11 closed by the gap work, 3 need small
additions** (business risk, contracts, comms log — all in §12.3). No core unit is
left unsupported.

### 12.3 New schema for the gaps

```
-- Gap 1 · NCC compliance (Quality). Extends the hold-point mechanism:
--   an open, required NCC item blocks its stage from completing.
ncc_register        project_id, stage_id, ncc_class, building_type,
                    provision_ref, description, required, status,
                    evidence_document_id, verified_by, verified_at

-- Gap 2 · Environmental (Safety). Env incidents reuse incidents.type='env'.
environmental_plans project_id, title, document_id, valid_from, valid_to
waste_tracking      project_id, waste_type, qty, unit, disposal_method,
                    carrier, docket_no, photo_id, disposed_at

-- Gap 3 · Site services + set-out (Site)
site_establishment  project_id, item, category (water|power|waste|security|
                    access|amenities|fencing), status, provider, connected_at,
                    notes, photo_id
site_access_log     project_id, person_id?, visitor_name, purpose,
                    in_at, out_at, method
setout_records      project_id, stage_id, reference, surveyor, recorded_at,
                    document_id

-- Gap 4 · Service coordination (Quality)
service_registers   project_id, discipline (hydraulic|electrical|mechanical|
                    fire|comms), item, spec_ref, status, inspected_at
service_clashes     project_id, discipline_a, discipline_b, location,
                    description, severity, status, resolved_at

-- Gap 5 · Consultant management (Commercial)
consultants         org_id, name, discipline (architect|engineer|certifier|
                    surveyor|hydraulic|other), abn, contact, rating
consultant_contracts project_id, consultant_id, scope, fee, status,
                    document_id, start_date, end_date
consultant_reports  project_id, consultant_id, type, reference,
                    issued_at, document_id   -- CPCCBC5013

-- Gap 6 · Plan viewer (Documents). PDF render + markup offline; DWG stored/
--   versioned only (see §12.1 note).
drawings            project_id, number, title, discipline, revision,
                    status (current|superseded), file_document_id,
                    issued_at, is_current
drawing_markups     drawing_id, author_id, page, geometry_json, note, created_at

-- Gap 7 · Structural compliance (Quality) — mostly reuse:
--   inspections.type='structural' with is_hold_point=1,
--   certificates.type='structural' (e.g. Form BA3),
--   consultants.discipline='engineer'. One join table:
structural_engagements project_id, consultant_id, scope, status

-- The three 🟡 core-unit additions (§12.2)
risk_register       org_id, project_id?, category, description, likelihood,
                    consequence, rating, control, owner_id, status, review_date
contracts           project_id, party_id, party_type (customer|subcontractor|
                    consultant|supplier), type, value, retention_pct,
                    signed_at, status, document_id
compliance_register project_id, requirement, source (NCC|contract|WHS|env|
                    statutory), obligation, responsible_id, due_date, status,
                    evidence_document_id
```

`ncc_register` and `compliance_register` are the teeth of §5.6's hold-point rule:
a stage with an open *required* compliance item cannot be marked complete, and the
invoice gate (§5.8) already refuses payment against an unvalidated stage.

### 12.4 The payoff — alignment becomes competency evidence

This is where CPC50220 alignment stops being a marketing line and becomes
architecture. Tag each evidence-producing feature with the unit(s) it demonstrates,
and **§10's Verified Work History engine doubles as a diploma evidence portfolio**.
A trainee doing real work on real projects automatically accumulates evidence
mapped to CPC50220 units — an RTO logbook that fills itself.

```
cpc_units           code (PK), title, is_core, release   -- seeded from projman-03
cpc_feature_map     cpc_unit_code, feature_key, evidence_type
                    -- which app feature demonstrates which unit
cpc_evidence        person_id, cpc_unit_code, project_id, source_entity,
                    source_id, captured_at, weight
                    -- emitted when a person performs qualifying work
```

`cpc_evidence` is the same primitive as §10's evidence tiers, projected onto the
qualification. It therefore inherits §10.2's **unresolved isolation question**: a
trainee's competency evidence must be **person-scoped and portable across builders**,
which the single-`org_id` model cannot yet express. So the evidence-generation half
is gated behind decision record **`projman-02`** (identity-scoped evidence domain);
the *reference and tagging* half (`cpc_units`, `cpc_feature_map`) has no such
dependency and can land with P3.

**Three audiences, one dataset:** the builder gets compliance and hold-point
enforcement; the trainee gets a self-filling competency portfolio; the RTO gets
verifiable, timestamped, geo-located evidence of real workplace practice. That
triangle is the differentiator — and none of it requires a feature that a working
builder wasn't already going to use.

### 12.5 Port-plan impact

The gaps extend existing phases rather than adding a new tier — this is the point of
folding compliance into Quality and environment into Safety:

| Phase | Gains |
|---|---|
| P4 Projects | `contracts`, `risk_register`, `compliance_register`; `cpc_units` + `cpc_feature_map` reference/tagging |
| P5 Site | Gap 3 (site establishment, access log, set-out) |
| P6 Safety + Quality | Gap 1 NCC, Gap 2 Environmental, Gap 4 Service Coordination, Gap 7 Structural |
| **P6.5 Documents** *(new)* | Gap 5 Consultant Management, Gap 6 Plan Viewer (PDF render + markup) |
| Post-`projman-02` | `cpc_evidence` generation, fused with §10 Verified Work History |

Every new feature keeps the framework's two rules: **offline-first capture** on the
field app, and **AU compliance** (data residency, TPAR-aware, ABN-validated) in the
ledger.
---

## 13. Data flow — the project lifecycle (role model v2)

### 13.1 The authoritative lifecycle — the 18-stage matrix

**The project lifecycle is `docs/18StageProjectMangementMatrix.md`** — the owner-
authored `WA_RESIDENTIAL_18` standard template and the app's declared **Core Logic
Driver**. It supersedes an earlier 17-step reconstruction that stood here. Do not
re-derive the steps; read that file. How it lands in the app:

- **Template-driven, not hard-coded.** Every project instantiates `WA_RESIDENTIAL_18`;
  four **optional modules** layer on per project (Cross-Border / precast, TT Payment
  Milestones, BIM > $5M, Sustainability / BASIX).
- **App's slice.** Stage **1** (PM creates project + land-doc **camera capture** — the
  app's front door), Stage **6** (material selection), Stage **7** (DA review +
  digital signature) are app capture/review; Stages **10–18** are **app-primary** site
  execution. The rest (2–5, 8–9, and all OCR / NLP / 3D, council routing, TT finance)
  are **Portal + Dashboard + Python** — NexusPM's, not the field app.
- **Stages are the Projects-tab backbone** (appspec §4, §5.2): project detail is the
  18-stage tracker with per-stage gate status — active / blocked-awaiting-inspection /
  complete / incomplete-tag. Site / Safety / Quality tabs are the **capture surfaces**
  that feed the active stage. Safety data is stage-independent (log a hazard anytime);
  Quality inspections unlock blocked stages at their hold points.
- **Stage advancement is manual + tagged (LOCKED decision, 2026-07-23):** the PM taps
  **"Complete & Next Stage"**; the server validates required data/docs; if any are
  missing the stage is tagged **INCOMPLETE** (⚠️ red tag on the Projects tab) and
  advance is blocked **unless the PM overrides with a reason** — the tag persists as a
  record of the gap. The system guides; the PM decides.

Entities the matrix references not yet in §5: **`leads`** (P7), **`client_feedback`**
(P10 portal), stage-template + module-toggle tables (domain contract, NexusPM).
`contracts` already lands at P4 (§12.5).

### 13.2 Server enforcement points (9)

The matrix in §3 is enforced **server-side only** — on both the sync-push path and
dashboard/portal writes (the ComplianceService pattern, projman-03 R2). The app's
`RoleVisibility` is cosmetic. Hold-point rows below map to the matrix's *Critical
Hold Points* table (11→12, 12→13, 13→14, 15→16, 18→handover).

### 13.2 Server enforcement points (9)

The matrix in §3 is enforced **server-side only** — on both the sync-push path and
dashboard/portal writes (the ComplianceService pattern, projman-03 R2). The app's
`RoleVisibility` is cosmetic.

| # | Enforcement | Rule |
|---|---|---|
| 1 | **org_id isolation** | Every query filtered by tenant; nothing crosses the org boundary (projman-01, 16/16). |
| 2 | **Role RBAC** | CRUD per the §3 role matrix, evaluated per surface. |
| 3 | **Engagement scope** | An engaged external party sees only the granted slice of ONE project (projman-02). |
| 4 | **Hold-point block** | An open hold point blocks that stage's completion. |
| 5 | **Invoice / claim gate** | No claim or invoice approval against a stage that fails its gate. |
| 6 | **NCC block** | An open `ncc_register` item blocks stage completion (projman-03 R2). |
| 7 | **Structural gate** | An incomplete structural inspection blocks completion (projman-03 R2). |
| 8 | **TPAR flag** | Payments to construction subcontractors accumulate by ABN for TPAR. |
| 9 | **Geofence** | Attendance and incident capture geo-validated against the site (anti-fraud; feeds trust score; degrades gracefully — never blocks capture, appspec Decision 4). |
