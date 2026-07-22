ProjMan2 — Product Specification for AI Development Team
Version: 1.0
Date: 2026-07-22
Purpose: Conversion of MAOI/Nexus server to ProjMan2 ecosystem
Audience: AI development team (Flutter, Node.js, Next.js, Python)
Format: Abstract instructions — implementation details left to your expertise

1. Executive Summary
ProjMan2 is a construction project management platform for the Australian market. It is a port of MAOI (hospitality POS) to construction, retaining the proven architecture while adapting the domain model.

The Core Difference: MAOI was for restaurants (orders, tables, dishes). ProjMan2 is for construction (projects, stages, tasks, site diary, safety, quality, costing, accounting).

Four Products, One System:

Product	Technology	Users	Purpose
Field App	Flutter	Tradies, supervisors, safety officers	On-site capture, offline-first
Web Console	Next.js	PMs, developers, admins	Analysis, planning, admin
Public Portal	Next.js	Clients, investors	Read-only progress viewing
Server (Nexus)	Node.js	All	Auth, sync, API, orchestration
Key Differentiators:

IVR Voice Commands — "Hey ProjMan, log site diary" (ported from MAOI)

Verified Work History — Every interaction becomes evidence; solves trust problem

Australian Accounting — GST, BAS, TPAR, PAYG, superannuation built-in

Offline-First — Works without signal; syncs when connected

2. What to Port from MAOI
2.1 Keep These MAOI Components
Component	Why Keep
Offline-first sync engine	Dirty-tracking (is_dirty/sync_status) — proven reliable
SQLite on device, MySQL on server	Same schema; clean sync
IVR AI system	Voice commands — the killer feature; keep wake word, STT, intent engine
Device pairing + QR codes	Secure role assignment without passwords
Image queue	Offline photo capture; sync when connected
Role-based device binding	Device has a role, not just a user
Ledger/accounting core	Chart of accounts, journals, payments (adapt to AU tax)
Multi-tenant architecture	org_id everywhere; tenant isolation
2.2 Drop These MAOI Components
Component	Why Drop
Sales/POS	No selling; construction only
Dishes/menus/recipes	No hospitality domain
Tables/rooms/bookings	No hospitality domain
Vietnamese tax (VAT, CCCD, eInvoice)	Replace with Australian tax
Vietnamese language strings	English only
CCCD ID scanning	Not applicable; Australians don't have CCCD
2.3 Replace These MAOI Components
MAOI Domain	ProjMan2 Domain
Dishes	Materials/Items
Tables	Projects
Orders	Site Diary Entries
Rooms/Bookings	Stages/Tasks
Dish Ingredients	Bill of Materials
Staff	Users (with roles)
Sales Reports	Project Reports
VN Tax (VAT)	AU Tax (GST, BAS, TPAR)
3. Core Architecture Decisions (Non-Negotiable)
3.1 Sync Architecture
Rule: Same tables, same columns on SQLite and MySQL. Dirty-tracking sync.

The Sync Contract:

is_dirty = 1 → record needs pushing

sync_status = 'pending' | 'synced' | 'error'

device_id = writer's device UID (echo elimination)

updated_at = client clock (display/ordering)

server_updated_at = server clock (pull cursor)

Ownership Rule (Single Writer):

Each table has one owner (APP or WEB)

APP writes: attendance, site diary, photos, hazards

WEB writes: projects, stages, tasks, costing, payroll

Server writes: auth, device roles, sync metadata

Pull Cursor:

GET /sync/pull?since=<unix_ms> returns changes since that time

Cursor is server's server_updated_at (epoch ms)

Exclude rows with caller's device_id (don't get own echo)

Return rows in server_updated_at order (parents before children)

3.2 Authentication Strategy
Primary OAuth Providers (Exactly Three):

Google — Universal; everyone has it

Microsoft — Corporate builders use Office 365

Facebook — Tradies and subcontractors use it personally

No Other OAuth Providers: Drop GitHub, Apple, TikTok, X, LinkedIn.

Fallback Authentication:

Email + password registration

SMS verification for Australian mobile numbers (+61)

Password recovery via email (and SMS later)

Session Management:

Access token: JWT, 15m TTL

Refresh token: Opaque UUID in sessions table, 30d TTL

Revoke session → kill refresh token

3.3 Database Schema Principles
Every Synced Table Must Have:

text
id               TEXT (uuid v4) — app generates, server accepts
org_id           TEXT — tenant isolation (filter on every query)
device_id        TEXT — writer's device UID
is_deleted       INTEGER 0/1 — soft delete tombstone
updated_at       INTEGER unix ms — client clock
server_updated_at DATETIME(3) — server clock (pull cursor)
Server-Only Tables (Never Sync to Device):

sessions — refresh tokens

pairing_tokens — QR code data

recovery_tokens — password reset codes

audit_log — all identity actions

sync_history — sync metadata

3.4 Australian-Specific Requirements
Accounting Core (Ported from MAOI, Adapted for AU):

Chart of Accounts (AU standard)

Journal entries with debit/credit

Payment runs (subcontractors, staff, ATO)

Bank reconciliation

Fixed assets + diminishing-value depreciation

Tax Requirements (Mandatory):

GST — 10%; reported quarterly on BAS

BAS — Business Activity Statement (G1, G11, 1A, 1B, W1, W2)

TPAR — Taxable Payments Annual Report (mandatory for construction)

PAYG Withholding — on staff wages

Superannuation — 11.5% (2026 rate) on ordinary earnings

ABN Validation — modulus-89 checksum; ABR API lookup

Data Residency:

All data must stay in Australia (AWS Sydney ap-southeast-2 or Azure Australia East)

Privacy policy: Australian Privacy Act compliant

4. The Field App (Flutter) — High-Level Instructions
4.1 Navigation
Five bottom tabs (ported from MAOI's shell):

Projects — List of assigned projects; drill to detail

Site — Today's view: attendance, programme, quick actions

Safety — Hazards, incidents, inductions, toolbox talks

Quality — Inspections, defects, certificates

Profile — Device identity, org info, sync status

Navigation Rule: Sub-pages cycled by tapping header title; back returns to tab default (MAOI pattern).

4.2 Key Screens and Their Purpose
Site Diary (Most Important Feature):

Daily legal record; must work offline

Auto-populate: date, weather (via API), headcount (from attendance)

Voice dictation: "Hey ProjMan, log site diary..."

Fields: Work done, delays, cause, notes

Photo attachment (queued offline)

Save as draft or final

Attendance:

Check-in/out (one tap per person)

Role selection: trade, subcontractor, visitor

QR code scanning for self-check-in

Offline: works without signal; queues records

Safety (Hazard/Incident Reporting):

Must be reachable in 2 taps from anywhere

Voice: "Hey ProjMan, report hazard..."

Notifiable flag for WorkSafe-reportable incidents

Photo evidence (queued offline)

Immediate notification to PM and safety officer

Quality (Inspections/Defects):

Checklist-based inspections (custom templates)

Hold points: blocks stage completion

Defect logging with photo evidence

Certificate upload and expiry tracking

4.3 What to Exclude from the App
Feature	Why Not in App
Gantt editing	Too complex; belongs on web console
Cost plan editing	Financial decisions need big screen
Estimating	Heavy data entry; belongs on web
Bulk operations	Batch work belongs on web
TPAR/BAS	Desk work; belongs on web
User/role management	Admin function; belongs on web
Read-Only Exceptions: Costs and schedule are viewable on app (glanceable), not editable.

5. The Web Console (Next.js) — High-Level Instructions
5.1 Navigation Structure
text
Dashboard → Projects → Estimating → Procurement → Workforce → Finance → Tax → Reporting → Admin
5.2 Key Modules
Project Dashboard:

Overview of all projects (portfolio view)

Key metrics: On-time, On-budget, Safety, Quality

Drill-down to individual project detail

Project Detail (Per Project):

Overview: progress, alerts, key metrics

Schedule: Interactive Gantt with drag-to-adjust

Cost Plan: Estimated/Committed/Actual/Claimed per stage

Site Diary: Searchable diary entries

Safety: Hazards, incidents, inductions

Quality: Inspections, defects, certificates

Commercial: POs, invoices, variations, claims

Documents: Central repository

Estimating:

Cost Library: rates library (labour, materials, plant)

Estimates: create, edit, approve

Quotes: incoming (subcontractor quotes) and outgoing (client quotes)

Procurement:

Purchase Orders: create, approve, track

Supplier Invoices: entry, approval, payment

Material Catalogue: item master + supplier prices

Workforce:

Staff Roster: assign to projects

Attendance: view, approve, report

Payroll: process, approve, report

Finance:

Chart of Accounts

Journal Entries

Payment Runs (subbies, staff, ATO)

Bank Reconciliation

Fixed Assets + Depreciation

Tax & Compliance:

GST/BAS: prepare, review

TPAR: prepare, lodge

PAYG Withholding

Superannuation

ABN Validation

Reporting:

Standard reports (Project Status, Cost, Safety, Quality, TPAR, BAS)

Custom report builder

Export: PDF, Excel, CSV

Admin:

Organisation Settings (ABN, GST, business type)

User Management (invite, roles, permissions)

Device Management (pair, revoke, monitor)

Audit Log

6. The Public Portal (Next.js) — High-Level Instructions
6.1 Purpose
Read-only progress view for clients, investors, and financiers.

6.2 Features
Project progress (visual, percentage-based)

Photo gallery (latest photos)

Simplified timeline (no Gantt complexity)

Budget summary (no internal cost detail)

Variation requests (approve/decline only)

Progress claims (view only)

Document download

Contact project team

6.3 What to Exclude
No editing of any kind

No subcontractor names (privacy)

No internal costs (commercial sensitivity)

No full schedule (simplified only)

No safety/quality details (unless approved)

7. The Server (Nexus) — High-Level Instructions
7.1 API Surface (Phase 1 — Identity)
Auth Endpoints:

text
POST   /auth/register      → session
POST   /auth/login         → session
POST   /auth/refresh       → new access token
POST   /auth/logout        → success
GET    /auth/me            → user, org, device
POST   /auth/change-password → new token
Recovery Endpoints:

text
POST   /auth/recovery/request    → masked email
POST   /auth/recovery/verify     → recovery token
POST   /auth/recovery/reset      → success
POST   /auth/recovery/device-loss → session (requiresFullSync)
POST   /auth/recovery/handoff-complete → success
Pairing Endpoints:

text
POST   /pairing/initiate  → QR payload
POST   /pairing/request   → status (unauthenticated)
GET    /pairing/pending   → pending requests
POST   /pairing/confirm   → confirmed
POST   /pairing/reject    → rejected
GET    /pairing/status/:id → confirmed device
Device Endpoints:

text
GET    /devices           → list
GET    /devices/:id       → detail
POST   /devices/:id/revoke → revoked
POST   /devices/:id/role  → role updated
Organisation Endpoints:

text
GET    /organisation      → org detail
PATCH  /organisation      → update org
GET    /organisation/users → user list
POST   /organisation/users → create user
PATCH  /organisation/users/:id → update user
GET    /organisation/audit → audit log
Sync Endpoints:

text
POST   /sync/push         → apply changes
GET    /sync/pull?since=  → changes since cursor
GET    /sync/status       → pending count
7.2 OAuth Endpoints (Phase 2)
text
POST   /auth/oauth/google/start    → redirect/PKCE params
POST   /auth/oauth/google/callback → session
POST   /auth/oauth/microsoft/start → redirect/PKCE params
POST   /auth/oauth/microsoft/callback → session
POST   /auth/oauth/facebook/start  → redirect/PKCE params
POST   /auth/oauth/facebook/callback → session
Requirement: Each provider MUST return the user's email. First-time OAuth sign-in routes to AU onboarding (ABN, business type, GST status).

7.3 IVR Endpoints (Ported from MAOI)
text
POST   /ivr/process        → process voice command
GET    /ivr/commands       → list available commands
POST   /ivr/queue          → queue voice command (offline)
GET    /ivr/queue/status   → pending queue count
Commands (Construction Vocabulary):

"Log site diary [project] [entry]"

"Sign in [name] [trade]"

"Sign out [name]"

"Report hazard [project] [location] [description]"

"Report incident [project] [type] [description]"

"Log defect [project] [location] [description]"

"Log delivery [project] [supplier] [docket]"

"What's scheduled? [project]"

"Weather update [project]"

"Confirm inspection [project] [inspection] [result]"

"Take photo [project] [location]"

"Sync now"

8. Verified Work History — The Differentiator
8.1 The Problem It Solves
Builders and tradies currently self-report their experience. There is no way to verify:

Did they actually do the work?

Was it on time and on budget?

Was quality acceptable?

Were there safety incidents?

ProjMan2 solves this: Every project interaction becomes evidence.

8.2 How It Works
Primary Evidence (System-Generated):

Site diary entries (daily, signed by supervisor)

Attendance records (who worked, when, how long)

Inspection results (pass/fail, defects)

Project completion (on time? on budget?)

Safety incidents (recorded, notifiable)

Secondary Evidence (Multi-Party):

Client satisfaction rating (automated at handover)

Subcontractor feedback (anonymised)

Peer review (from other trades)

Dispute record (mediated? resolved?)

Tertiary Evidence (External Verification):

Builder license (state DB check)

Trade certificates (registered training org)

Insurance certificates

ABN verification

8.3 QR Code Trust Exchange
Principal generates QR code for "Builder Appointment"

Builder scans QR → shares verified profile

Principal reviews → accepts/declines

Once accepted: project data flows, evidence accumulates

Technical Requirements:

QR payload: {v, org, id, nonce, role, expires}

Signed by Principal's device key

Geo-fencing: prevent false attendance claims

Australian data sovereignty

8.4 Trust Score Algorithm
text
TRUST_SCORE = (
    Primary Evidence (60%):
        Project Completion Rate × 0.20
        Inspection Pass Rate × 0.15
        Safety Incident Rate (inverse) × 0.10
        Variation Rate (inverse) × 0.05
        Site Diary Consistency × 0.10
    +
    Secondary Evidence (30%):
        Client Satisfaction × 0.15
        Subcontractor Feedback × 0.10
        Peer Reviews × 0.05
    +
    Tertiary Evidence (10%):
        License Status × 0.05
        Certificate Recency × 0.05
) × Project Complexity Factor
9. IVR System — Port from MAOI
9.1 What to Preserve
MAOI Component	Keep?	Adaptation
Wake word detection	Yes	Change from "Hey MAOI" to "Hey ProjMan"
On-device STT	Yes	For basic commands (offline)
Cloud STT	Yes	For complex dictation (when signal)
Intent recognition	Yes	Adapt hospitality intents → construction intents
Entity extraction	Yes	Adapt dishes/tables → projects/locations/trades
Action execution	Yes	Adapt order management → site diary/attendance/safety
TTS responses	Yes	Construction vocabulary
Offline queue	Yes	Queue commands, sync later
9.2 Command Vocabulary (Adapted)
MAOI Command	ProjMan2 Command
"Take order [dish]"	"Log site diary [entry]"
"Add customer [name]"	"Sign in [name]"
"Close table"	"Sign out [name]"
"Report sales"	"Report hazard"
"Add expense"	"Log delivery"
"Check inventory"	"Check schedule"
"Take payment"	"Confirm inspection"
New Construction Commands:

"Weather update [project]"

"Who's on site [project]"

"What's scheduled [project]"

"Log defect [description]"

"Add photo [project/location]"

"Sync now"

9.3 Technical Requirements
On-device STT: Vosk or similar (offline)

Cloud STT: Google Speech-to-Text (when signal)

Intent engine: Rasa NLU (trained on construction vocabulary)

Entity extraction: Australian names, trade names, site locations

Queue system: Queue offline commands, process in order on sync

Privacy: No voice data stored longer than necessary; Australian data sovereignty

10. Development Phases
Phase	Content	Priority
P1	Skeleton: Port MAOI to ProjMan2, strip F&B/VN	Foundation
P2	Identity: Register, login, recovery, device pairing, OAuth	Must-have
P3	Sync v1: orgs, users, devices sync end-to-end	Must-have
P4	Projects: Customers, projects, stages, tasks, templates	Must-have
P5	Site Ops: Site diary, attendance, deliveries	Must-have
P6	Safety + Quality: Hazards, incidents, inspections, defects	Must-have
P7	Commercial: Estimating, POs, supplier invoices, variations, claims	Must-have
P8	Accounting: Ledger port from MAOI, AU adaptation	Must-have
P9	Tax: GST/BAS, TPAR, PAYG, superannuation	Must-have
P10	Web Console: Next.js admin + reporting	Must-have
11. Non-Negotiable Requirements
11.1 Security
All JWT secrets in environment variables (never in repo)

Password hashing: bcrypt, 12 rounds

Rate limiting: 10 attempts per identifier

Audit log: every identity action logged

Device revocation: kills all sessions on that device

Session revocation: kills refresh token

11.2 Privacy
No user data leaves Australian servers

Privacy policy: Australian Privacy Act compliant

User owns their verified work history

Previous clients' details are anonymised in reputation scores

11.3 Australian Compliance
ABN Validation: Modulus-89 checksum always; ABR API lookup when available

TPAR: Mandatory for building/construction; track payments to subcontractors by ABN

BAS: GST collected/paid, PAYG withheld

Superannuation: 11.5% (2026 rate) on ordinary earnings

Data Residency: AWS Sydney or Azure Australia East

11.4 Language
English only throughout the entire codebase

No Vietnamese strings anywhere

Australian English spelling (organisation, colour, labour)

12. The Data Contract (App ↔ Server)
12.1 Core Tables (Phase 1)
organisations (synced):

text
id, name, abn, abn_validated, address, suburb, state, postcode, phone, email,
business_type, gst_registered, is_deleted, updated_at, server_updated_at
Owner: WEB (created at register; updated via console)
users (synced):

text
id, org_id, email, password_hash, full_name, mobile, role, status,
security_version, last_login_at, is_deleted, updated_at, server_updated_at
Owner: WEB (admin creates users)
⚠️ password_hash NEVER leaves server
devices (synced):

text
id, org_id, user_id, device_uid, device_name, platform, model, os_version,
app_version, role, is_primary, status, paired_at, paired_by, last_seen_at,
revoked_at, is_deleted, updated_at, server_updated_at
Owner: APP (device knows its own name/OS); server owns role/status
12.2 Sync Rules
Push: Device sends dirty rows to server. Server validates owner, applies, sets server_updated_at.

Pull: Device requests changes since cursor. Server returns rows with server_updated_at > since.

Echo Elimination: Device does not receive rows with its own device_id.

Ownership: Server rejects push for tables not owned by APP (403 NOT_OWNER).

Column Safety: Server drops unknown/writable columns silently. Client ignores unknown columns on pull.

12.3 Error Codes (Stable — Branch On These)
NO_TOKEN · TOKEN_EXPIRED · INVALID_TOKEN · SESSION_REVOKED · DEVICE_REVOKED · FORCE_LOGOUT · ORG_INACTIVE · ORG_MISMATCH · DISABLED · SUSPENDED · INVALID_CREDENTIALS · TOO_MANY_LOGIN_ATTEMPTS · DUPLICATE_EMAIL · DUPLICATE_ABN · INVALID_ABN · VALIDATION_ERROR · INVALID_CODE · TOO_MANY_ATTEMPTS · INVALID_RECOVERY_TOKEN · ROLE_NOT_ASSIGNABLE · NOT_OWNER · NOT_FOUND · RATE_LIMITED

13. Success Criteria
13.1 Phase 1 (Identity) ✅
☑ Register organisation + admin user → session issued
☑ Login + refresh → new access token
☑ Password reset → request → verify → reset → login
☑ Pair 2nd device → role in session
☑ Revoke device → next request fails with DEVICE_REVOKED
☑ Push/pull org/users/devices → cursor advances
☑ Isolation: org A cannot read/write org B (16/16 tests)
13.2 Phase 2+ Targets
□ OAuth providers (Google, Microsoft, Facebook) working
□ SMS verification for Australian mobiles (+61)
□ AU onboarding: ABN, business_type, gst_registered
□ Projects → stages → tasks → site diary → attendance → safety → quality
□ Estimating → POs → invoices → variations → claims
□ Accounting ported from MAOI (AU adaptation)
□ GST/BAS, TPAR, PAYG, superannuation
□ Web console: all modules
□ Public portal: client view
□ Verified Work History: QR trust exchange, trust score
□ IVR: voice commands for all site operations
14. Key Constraints
Constraint	Why
Offline-first	Sites have poor/no connectivity
Australian data residency	Privacy Act compliance
Australian tax (GST/BAS/TPAR)	Mandatory for construction
English only	Australian market
No GitHub OAuth	Not relevant for construction users
No TikTok	Wrong demographic; unprofessional
Three OAuth providers only	Google, Microsoft, Facebook
IVR is non-negotiable	The killer feature; hands-free on site
Verified Work History	The differentiator; solves trust problem
15. Summary: What Makes ProjMan2 Different
Feature	MAOI	ProjMan2
Domain	Hospitality	Construction
Primary User	Restaurant staff	Tradies, supervisors, PMs
Key Metric	Sales, tables	On-time, on-budget, safety
Voice Commands	"Take order"	"Log site diary"
Accounting	VN Tax (VAT)	AU Tax (GST, BAS, TPAR)
Identity	CCCD	Google/Microsoft/Facebook OAuth
Differentiator	All-in-one POS	Verified Work History