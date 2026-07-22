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

| Field role | On the app for | Not on the app for |
|---|---|---|
| **Project Manager** | programme for today, attendance, safety, quality, diary; glance at costs | editing Gantt, cost plans, payroll (web) |
| **Supervisor / Foreman** | the daily driver — sign the crew in, diary, hazards, defects, photos | anything financial |
| **Tradie / Subcontractor** | *their* assigned tasks, self check-in, raise a hazard, upload own certs/dockets, mark progress | other trades, costs, the wider programme |
| **Inspector** | run an inspection checklist, pass/fail, hold points — **Quality tab only** | site diary, attendance, safety, financials |
| Org Admin · Project Developer · Customer | *(web-primary; minimal or no app surface)* | |

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

| Tab | PM / Supervisor | Tradie | Inspector |
|---|---|---|---|
| Projects | full | their tasks only | — (hidden content) |
| Site | full | self check-in only | — |
| Safety | full | raise hazard · my inductions | — |
| Quality | full | my defects · upload certs | **full (only tab)** |
| Profile | full | full | full |

- **`RoleVisibility` is UI-only.** A provider maps the **effective role** (device
  role wins over user role — projman-01 §1.7) to visible tabs/sub-pages/actions.
  **It is cosmetic — the server enforces isolation.** Client-side hiding is never a
  security boundary.
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

### 5.2 Projects tab
Purpose: the jobs this person is on; drill to stages/tasks + % complete. Sub-pages:
Projects (list) · Programme (stages, hold points) · Costs (**read-only**:
estimated/committed/actual/claimed per stage). Inputs: mark task progress, tick
done. Offline: reads cache, edits queue. Evidence: task completion, on-time signal.
**⟨projman-02⟩** "Join Project" via QR lives here for cross-org parties.

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
