# ProjMan2 — App Design Specification (Field App)

**Status:** 🟢 APPROVED v1.0 — six review decisions locked 2026-07-22 (REVIEW-01,
conditional approval resolved). Build to this guideline.
**Date:** 2026-07-22
**Owner:** eBizco Australia (Vince Phan)
**Scope:** the **Flutter field app** only. The web console and public portal have
their own design surfaces. Wire contract = `docs/decisions/projman-01.md`; product
framework = `development.md`.
**Purpose:** a *guideline* — enough functional and visual direction to build the
app consistently, not an exhaustive redline. Items gated on the cross-tenant
architecture decision carry **⟨projman-02⟩** — approved in intent, built after that
record lands.

---

## 1. Who uses it, and where

A professional tool for the **building & construction** trade, used **outdoors, one-
handed, in gloves, in sunlight, often with no signal**. Not a consumer app.

**Role model v2 (LOCKED 2026-07-22, development.md §3):** the server enforces a
**12-role** model; the app surfaces a **5-role shortlist** — the pairing screen
offers exactly **Site Manager · Foreman · Tradie · Inspector · Project Manager**
and nothing else. Labourers pair as Tradie; a subcontractor principal manages
their business on web while their crew pairs as Tradie; admin/finance/estimating
roles and the Client never pair a device.

| Field role (pairing label → enum) | On the app for | Not on the app for |
|---|---|---|
| **Project Manager** (`project_manager`) | programme for today, attendance, safety, quality, diary; glance at costs | editing Gantt, cost plans, payroll (web) |
| **Site Manager** (`supervisor`) | the daily driver — sign the crew in, diary, hazards, defects, photos | anything financial |
| **Foreman** (`foreperson`) | crew-level capture — crew attendance, task progress, hazards, photos | diary sign-off, anything financial |
| **Tradie** (`tradie`) | *their* assigned tasks, self check-in, raise a hazard, upload own certs/dockets, mark progress | other trades, costs, the wider programme |
| **Inspector** (`inspector`) | run an inspection checklist, pass/fail, hold points — **Quality tab only** | site diary, attendance, safety, financials |
| Org Admin · Project Developer · Construction Manager · Estimator · Subcontractor (principal) · Client | *(web/portal-primary; never pair a device)* | |

**Inspector is a first-class role (LOCKED)** but a *temporary, project-scoped*
engagement: paired as "Inspector — [Project]", Quality-only, expiring on stage
completion or date. **How** an inspector is engaged — intra-org paired device vs
external cross-org party — is decided in **⟨projman-02⟩**; a real building
certifier inspects for many builders, which is the cross-tenant case.

**Design consequence (locked):** the app is **capture-first** — fast entry, photos,
queued offline, synced when there's signal. Analysis and money are web work.

---

## 2. Design principles

1. **Capture in under 10 seconds.** Sign someone in, log a hazard, add a diary
   photo — fast. Incident entry is **two taps from anywhere**.
2. **Works with no signal.** Every capture writes locally and queues; the UI never
   blocks on the network. Sync state always visible, never in the way.
3. **Readable on a bright site, usable in gloves.** ≥48 dp targets, high contrast,
   few options per screen, big primary buttons.
4. **Role-aware, not role-cluttered.** Same shell for everyone; a tradie's surfaces
   are thinner. Never show a control a role can't use.
5. **Every capture is evidence.** Entries are attributable (who, device, when,
   where) — the foundation of the site diary's legal weight and Verified Work
   History (§8).
6. **Professional, calm, trustworthy.** Sturdy, plain, confident. Not playful.

---

## 3. Design language — theme LOCKED (Decision 1)

**Hybrid theme, confirmed:** **dark** for identity (auth, profile); **high-contrast
light** for **all operational tabs — Projects, Site, Safety, Quality.** Projects is
light with the operational set (it's read outdoors too, and it sits next to Site —
a dark↔light flip between adjacent tabs would jar). Identity screens keep the
premium dark; the moment you're working a job, you're in daylight-readable light.

**Palettes**

| | Dark (auth/profile) | Light (operational) |
|---|---|---|
| Background | `#0A0F18` / surface `#141B29` | `#F8FAFC` / surface `#FFFFFF` |
| Text | `#FFFFFF` / muted 60% | `#1E293B` / muted `#64748B` |
| Accent | `#0066FF` | `#0066FF` |

**Status = colour + icon + label** (never colour alone — accessibility, gloves, sun):

| Meaning | Colour |
|---|---|
| Success / passed / synced | `#34D399` |
| Warning / pending / due / hold point | `#F59E0B` |
| Danger / notifiable / overdue / failed | `#EF4444` |

- Light theme is genuinely **high-contrast** (text on background ≥ 7:1) for sunlight.
- One clean sans; numbers legible at a glance. Type scale 28/20/16/14/13.
- Material outline icons, consistent weight. Photos first-class — thumbnails
  everywhere capture happens, tap to enlarge. Corner radius 12; touch target ≥48 dp.

---

## 4. Navigation — role-adaptive shell (Decision 2 LOCKED)

Five bottom tabs over an `IndexedStack`; **tap the header title to cycle** a tab's
sub-pages; back returns to the tab's default (MAOI pattern).

```
0 Projects  → Projects · Programme · Costs(read-only)
1 Site      → Today · Site Diary · Attendance          ← the daily driver
2 Safety    → Safety · Incidents · Inductions
3 Quality   → Inspections · Defects · Certificates
4 Profile   → Profile · Device & Sync
```

**All roles keep all five tabs; the role thins the *content*, not the tab bar.** A
tradie still has Safety (raise a hazard — safety is everyone's) and Quality (their
defects + upload certs), just without the management views.

Content visibility per field role (role model v2, development.md §3 — the five
pairing-shortlist roles):

| Tab | Project Manager | Site Manager | Foreman | Tradie | Inspector |
|---|---|---|---|---|---|
| Projects | full incl. Costs (read-only) | programme + tasks, **no Costs** | crew tasks | their tasks only | — (hidden content) |
| Site | full | full — diary sign-off | crew attendance · task progress · diary contribute (**no sign-off**) | self check-in only | — |
| Safety | full | full | raise hazards · crew inductions | raise hazard · my inductions | — |
| Quality | full | full | raise defects + photos | my defects · upload certs | **full (only tab)** |
| Profile | full | full | full | full | full |

- **`RoleVisibility` is UI-only.** A provider maps the **effective role** (device
  role wins over user role — projman-01 §1.7) to visible tabs/sub-pages/actions.
  **It is cosmetic — the server enforces isolation.** Client-side hiding is never a
  security boundary: the authorization layer is the 9 server enforcement points of
  development.md §13.2 (role RBAC per the §3 matrix, evaluated on the sync-push
  path and every web/portal write).
- Post-v1 app roles slot into this matrix without new columns: **Labourer pairs as
  Tradie**; a **Subcontractor** crew appears as Tradie under an engagement scope
  (projman-02).
- **Header sync chip** (§6) and a **disabled mic** (§7) are always present.

---

## 5. Screens + brief functional

Functional guideline per surface: purpose · key inputs · offline behaviour ·
evidence produced. Mockups are indicative, not pixel redlines.

### 5.1 Identity (built, P2)
Welcome → OAuth-first (Google/Microsoft/Facebook) or email → Login / Register
(2-step: account → AU onboarding) → Recovery. Onboarding (state, business type,
GST, ABN-optional) after a first sign-in. *Next: wire OAuth to the server dev-bypass
+ the onboarding screen; map `business_type` to the server's snake_case enum.*

### 5.2 Projects tab — the stage backbone
Purpose: the jobs this person is on; project detail = the **18-stage lifecycle
tracker** (`docs/18StageProjectMangementMatrix.md`, `WA_RESIDENTIAL_18`). Sub-pages:
Projects (list) · Programme (the 18 stages + hold points) · Costs (**read-only**:
estimated/committed/actual/claimed per stage).

**Stage tracker states** (Programme sub-page, one row per stage):

| State | Display |
|---|---|
| active | ✅ "Framing — in progress" |
| blocked (hold point) | 🔒 "Framing — awaiting inspection" |
| complete | ✅ "Framing — passed" |
| incomplete (validation tag) | ⚠️ "Framing — missing final check" |

**Stage advancement — Decision b LOCKED (2026-07-23):** the PM manually taps
**"Complete & Next Stage"**; the server validates required data/docs; if missing, the
stage is tagged **INCOMPLETE** (⚠️ red tag, visible on the list) and advance is
blocked **unless the PM overrides with a reason** — the tag persists as a record. The
system guides; the PM decides.

**Create Project — the app's front door (Stage 1, PM only).** A pushed screen, light
operational theme, **capture-first** mobile order (fields stack to one column in
portrait; tablet/landscape may use two):

1. **Documents** — 📷 Take Photo / 📁 Upload land title, survey, contour. Stored on
   the **device filesystem + a metadata row** (MAOI image-queue pattern — **no blobs
   in SQLite**), queued for sync. OCR runs server/Python-side.
2. **Site & land vectors** — address, suburb, postcode, state, title Volume/Folio,
   area (m²). **OCR auto-fills these; the PM can always override.**
3. **Customer profile** — search existing or **+ New Customer**; auto-linked.
4. Bottom action bar: **Save Draft** (local-only) · **Submit** (create + queue).

**OCR never blocks — Decision a LOCKED (2026-07-23):** OCR success → auto-populate,
PM can override; OCR failed/offline → PM types manually, OCR re-runs later; OCR
pending → field shows "Processing…" with manual entry still available. **OCR never
overwrites a manual entry** unless the PM confirms. A "⚠️ OCR pending" line is a
*tag*, not a gate — **Submit stays enabled**. The PM is never blocked by signal or AI.

⚠ **Ownership dependency (projman-01 §10):** an app-originated project/customer create
needs the ownership change (create = APP **or** WEB; update/delete WEB-only).
**Save Draft (local-only) is buildable now; the Submit/sync path waits on that
delivery.**

Inputs: mark task progress, tick done. Offline: reads cache, edits queue. Evidence:
task completion, on-time signal. **⟨projman-02⟩** "Join Project" via QR lives here
for cross-org parties.

#### 5.2.1 Stage 2 — Environment, Utility & Hazard Audit (PM)
A **risk audit** screen (the matrix's Stage 2), pushed from the stage tracker.
Purpose: the PM captures four spatial boundaries; the server **Python NLP** evaluates
them against WA planning law / NCC and emails the client a risk summary. On the app
this is **capture**; the analysis + email are server/Python. Feeds `compliance_register`
+ `risk_register`.

**The risk profile is the spine** — each of the four sections carries a risk chip
(🟢 clear / 🟠 caution / 🔴 critical — **colour + icon + label**), rolled up in a header
overview. Portrait single-column, collapsible sections:

1. **Utilities** — DBYD ref + lodged date (PM lodges Dial-Before-You-Dig externally;
   app captures the ref and **attaches the response doc** — it can't fetch it), sewer
   depth (m), overhead power clearance (m), notes.
2. **Zoning** — council R-code (dropdown), planned density, density-check result,
   zoning certificate attach.
3. **Legal** — easements / covenants / design guidelines (yes/no + describe); **reuses
   the Stage-1 title** (`↗ view`) rather than re-uploading.
4. **Environment** — flood zone, heritage, **bushfire BAL rating** (LOW/12.5/19/29/40/FZ),
   hazard-map attach.

**Compliance Assessment (AI) card** at the bottom: offline → **⏳ Pending**; the PM can
**Complete Stage 2 anyway** (client email sends on sync). **Risk flags follow the same
manual + AI rule as OCR (Decision a):** the PM may set a section's chip manually; the
NLP eval **suggests/fills** flags when it runs and **never overwrites** a manual flag
without confirm. AI never blocks.

Documents: filesystem + metadata row, **no SQLite blobs** (MAOI image-queue). Advance
via **Complete & Next Stage** (Decision b — validates, tags INCOMPLETE on gaps, PM may
override with a reason). ⚠ Another **PM-creates-from-app offline** case — rides the
same **projman-01 §10** ownership change as Stage 1. AU value sets (R-codes, BAL) are
structured fields.

#### 5.2.2 Stage 3 — Concept Design Generation (PM)
A deliberately **thin app surface** — the matrix's Stage 3 is a **one-click AI
trigger + results viewer**; all generation (geometric block model, footprint,
open-space, elevation, floor areas, setback rationale, the 3 client PDFs) is
**server/Python**. Heavy concept review stays on the Portal.

- **Inputs-ready checklist** reads Stage 1 boundaries + Stage 2 zoning/area; if a
  prerequisite is missing the **Generate** button is disabled with a tag pointing back.
- **Generate Concept Design** (one-click) fires the Python job. This is the **honest
  offline exception** — generation is server-only. Offline → the trigger **queues**,
  RESULT shows ⏳ Pending, and the PM may still Complete & Next with a `concept pending`
  tag (decision-a spirit: never trap the PM); results arrive on sync.
- **Results = Plan Viewer** (development.md §12): block diagram + 3 PDFs (Footprint /
  Elevation / Area Summary) open in the PDF viewer and are **cached after first
  download** for offline viewing. **Regenerate** keeps prior versions (evidence trail).
- **Client email** is auto-composed + sent **server/Python-side**; the app shows the
  sent receipt, never composes it.

**No new capture tables** — Stage 3 *consumes* Stage 1/2 data and *produces*
server-side artefacts (`concept_designs` + documents, WEB/Python-owned). Because
nothing is app-authored, **Stage 3 does NOT need the projman-01 §10 ownership change.**

#### 5.2.3 Stage 4 — Town Planner / Council Screening (PM) · client sign-off pattern
Thin app surface: **capture client acceptance → pick the route → trigger**; server
packages the Stage-3 assets and emails the appointed Town Planner **or** the local
council. This stage settles the **client sign-off pattern reused at Stages 7, 8, 18.**

**Client sign-off — LOCKED (2026-07-23):** the client is **Portal-only**, so
acceptance is captured **two ways, both supported**:
- **Portal approval (primary)** — the client taps Approve on the Public Portal
  (WEB/portal-authored).
- **In-person capture (fallback)** — the **PM captures the client's acceptance on the
  PM's device as a digital signature** (common in AU residential; app-authored, works
  offline/queues). **The digital-signature-capture component is born here** and reused
  at every later sign-off (7/8/18).

Both write a `client_approvals` row (portal-era table pulled forward). The in-person
path is **app-authored → rides projman-01 §10**; the portal path is WEB-authored.
Acceptance is **evidence** (feeds Verified Work History / client-satisfaction).

**Route:** PM picks Town Planner or Council (disabled until accepted); **Send package**
is server-side + **needs signal** (offline → queues, `not sent` tag). Advance per
Decision (b), override-with-reason.

#### 5.2.4 Stage 5 — Budget-Based Style Generation (PM) · the await-external gate
Thin surface: **gate → trigger → comparison viewer → selection**. Server/Python
generates the three cost-calibrated options and costs them; the app displays and
tracks selection.

**Envelope-confirmed gate — LOCKED (2026-07-23):** Stage 5 is 🔒 blocked until the
council/planner **envelope confirmation** is recorded — the template's first real
"await-external" hold. **The PM records it** (date + confirmation doc), or a
portal/server event records the council response; that unlocks the generate trigger.
The confirmation is **app-authored → rides projman-01 §10**.

- **Generate Style Options** — one-click AI trigger (server-only; offline → queues).
- **3-option comparison** — Budget / Deluxe / Premium cards (cost figure + spec),
  each opens in the Plan Viewer, cached for offline view. Server-owned (`style_options`).
- **Client tier selection — same sign-off pattern as Stage 4 (LOCKED):**
  portal-primary (client picks a tier) + **in-person fallback** (PM records the chosen
  tier, app-authored → §10). Selection kicks off Stage 6.
- Advance per Decision (b), gated on "options generated + sent".

### 5.3 Site tab — the daily driver
**Site Diary** — the most important screen; single-purpose, linear:
```
 Site Diary — Ocean Views
 Wed 22 Jul 2026   ☀ 24°C(cached)   16 workers
 Work done today:      [ Framing complete, level 2        ] [+ line]
 Delays / disruptions: [ None                             ]
 Photos (3)  [+ Photo]   [ ▢▢▢ ]
 [ DRAFT ]   [ SAVE ]   [ 🎤 voice (P5) ]
```
- Auto: date, headcount (from attendance), **weather cached** — offline shows the
  last known reading or lets the supervisor set it manually; **never blocks on a
  weather fetch**. The **voice button is disabled until P5** (§7).
- Linear order matches how a supervisor thinks: done → delays → proof. Draft/final.

**Attendance** — one-tap check-in/out; muster list:
```
 Attendance — Ocean Views     on site: 16 (2 min ago)
 ✅ Dave Smith   Electrician  08:15 present
 ⚪ Mary Chen    Supervisor   not checked in
 ❌ Tom Anderson Labourer     absent
 [+ Add Person]  [Scan QR]  [All Out]
```
- Trade + type (staff/subbie/visitor). **"All Out"** = end-of-day bulk sign-out
  **and evacuation muster**. QR self-check-in optional.
- **Geofence, not just geo-stamp (Decision 4):** the check-in location is compared
  to the project site (anti-fraud; feeds trust-score integrity). Permission denied
  → **degrade gracefully, never block check-in**. Show "📍 Site" when verified.

**Deliveries** — photograph a docket against a PO; queue. Evidence: delivery proof.

### 5.4 Safety tab
```
 Safety — Ocean Views
 [ ⚠ REPORT HAZARD ]   [ 🔥 INCIDENT (notifiable) ]   ← red, prominent
 Active hazards: 2   Today's toolbox 08:30 Scaffolding   Inductions due: 3
```
**Incident** — type (injury/near-miss/damage/env) · description · photos ·
**notifiable toggle** (prompts at entry, WorkSafe) → notifies PM + safety officer.
An **Emergency** action dials 000 / site contact **with a confirm step** (no
misdials). All capture queues offline; a notifiable incident is flagged locally
immediately. Evidence: safety record (trust score, §8).

### 5.5 Quality tab
Inspections (checklist per stage; pass/fail + photo per item; **hold point blocks
stage completion**), Defects (location, description, trade, photo, assign, due),
Certificates (upload + expiry). Evidence: inspection pass rate, defect closure.
This is the **Inspector's only surface**.

### 5.6 Profile tab
Identity, org, **role on this device**, Device & Sync (queue depth, last sync,
pairing/role, sign out). **QR (Decision 6 LOCKED, split by mechanism):**
- **"Pair Device"** here → intra-org device pairing (projman-01 §1.3, **buildable
  now**).
- **"Join Project"** on a project → cross-org, project-scoped engagement
  (**⟨projman-02⟩** — built after that decision).

---

## 6. Cross-cutting patterns

**Sync chip** (header, colour + icon + count):

| State | Colour | Label |
|---|---|---|
| Synced | green | ✓ Synced |
| Syncing | amber | ⟳ Syncing (3) |
| Offline | grey | 📡 Offline (12 pending) |
| Error | red | ⚠ Sync error (tap) |

- **Photo queue:** MAOI's offline image queue — shoot/pick → thumbnail (small amber
  dot until uploaded) → background upload. Shared by diary, hazard, incident,
  defect, delivery, certificate.
- **Attribution:** every record stamps author + device + time (+ geo where it's
  evidence). Invisible in the happy path; the backbone of evidence.
- **Empty states** teach the next action; **errors** map the server's stable codes
  (§1.6) to plain English (done in `nexus_service`).
- **Permissions** (camera, location, notifications) are primed on first relevant
  use, and every capture degrades gracefully if denied.

---

## 7. Voice / IVR (P5+, reserved now — Decision 5 LOCKED)

IVR is non-negotiable (development.md §10) but lands at **P5+**. **Show the mic now,
disabled, with a "Voice commands coming soon" tooltip** — reserves the slot, signals
the vision, prevents later layout churn. The diary/incident **voice buttons are
likewise disabled until P5.** No voice UI is built at P2.

---

## 8. Verified Work History in the app — ⟨projman-02⟩

The differentiator (development.md §10). Likely app surfaces: the **QR trust
exchange** (a Principal's primary device shows an appointment QR; the other party
shares a verified profile; Principal accepts), a light **verified badge** on a
profile, and the fact that **every capture already *is* the evidence.** No
trust-score or tradie cross-org UI is designed or built until **`projman-02`**
resolves the cross-tenant evidence model (development.md §10.2). Placeholder only.

---

## 9. Out of scope for the app (web-only)

Gantt editing, cost-plan/estimating entry, POs/invoices/claims entry, payroll,
BAS/TPAR, user & role management, bulk operations, the public portal. The app may
**glance** at costs and schedule (read-only), never edit them.

---

## 10. Decisions — LOCKED (REVIEW-01, 2026-07-22)

| # | Decision | Resolution |
|---|---|---|
| 1 | Theme for daylight | **Hybrid** — dark auth/profile; **light for all operational tabs incl. Projects** (§3) |
| 2 | Tradie shell | **All five tabs; role thins content, not the tab bar**; `RoleVisibility` UI-only (§4) |
| 3 | Inspector role | **First-class**, temporary + project-scoped, Quality-only; engagement mechanism ⟨projman-02⟩ |
| 4 | Geo-stamping | **v1 for attendance + incidents** as a **geofence** (anti-fraud); optional diary; graceful degrade (§5.3) |
| 5 | Mic placeholder | **Shown disabled** with tooltip from day one (§7) |
| 6 | QR placement | **Both** — Profile "Pair Device" (now); Project "Join Project" ⟨projman-02⟩ (§5.6) |

Nuances folded in beyond REVIEW-01: Projects on light (theme adjacency); weather
cached/manual offline; diary/incident voice buttons disabled until P5; geo framed as
geofence; 000 behind a confirm; `RoleVisibility` is cosmetic, server enforces.

---

## 11. Build sequence (corrected)

REVIEW-01 suggested starting at P4, but **P4 has nothing to render against yet** —
we're at P2, and **P3 (domain schema v2 + sync) is the gate for every capture
screen.** Real order:

1. **Finish P2** — wire OAuth→onboarding against the server dev-bypass (server
   delivered §1.8); fix the `business_type` enum mapping.
2. **P3** — domain schema v2 (development.md §5) + sync-apply through the
   tolerant-reader filter (`filterToTableColumns`).
3. **`projman-02`** — drafted next, runs in parallel with P3; decides
   inspector/tradie project access before P4 needs it.
4. **P4 → P5 → P6 UI** to this guideline. **P5 (Site/Diary/Attendance) gets the most
   polish** — the daily driver.
