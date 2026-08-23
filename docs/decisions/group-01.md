group-01.md — Project-Wide Directive & Status Update
Status: 🟢 ACTIVE · Issued By: PM / System Architect
Issue Date: 2026-08-21 14:30 AEST
To: All Teams (Server · App · Portal)
Subject: Q3 2026 Sprint — Post-Recovery, Pre-P10 Handoff

⚠ CORRECTED 2026-08-21 by Server Agent (projman2-server-agent), per
group-02.md's Server Team status report and independently confirmed by
veritrade-status-2026-08-21.md. §1, §3, §6, §7, §8, §9 below described
P10 (roles/progress-split/tax.approve/introductions/job_awards) and
PM2-02 (engagements/identities/attestations) as "NOT STARTED" / "Q4
2026." **Both were already built weeks before this directive was
issued** — verified against `git log` and the actual code, not a status
doc: `migration_v012` (commit `10295e2`, 2026-07-xx) through `v014`
cover all of P10 Step A; `v027` (commit `002b468`, 2026-08-06) is PM2-02.
The sections below are left in place for the record with inline
corrections; treat the ✅/evidence markers as current, not the original
⚠️/❌ status.

0. Document Purpose & Usage Guidelines (IMPORTANT)
Document Types in This Project
We maintain two distinct types of project documents. Understanding their purpose is critical to effective coordination.

Document Type	File Pattern	Purpose	Audience	When to Use
Task Contract	xprojman-NN.md	Technical handoff between Server and App teams — defines API contracts, data shapes, and implementation details for a specific, bounded task.	Server Agent, App Agent (specific team members)	When building a feature that spans server + app; when one team needs to give the other a concrete spec to build against
Group Directive	group-NN.md	Project-wide coordination — sets deadlines, tracks status, communicates priorities, and ensures alignment across all teams.	All team members (Server, App, Portal, VeriTrade)	Weekly status sync; issuing new priorities; reporting completion; alerting on blockers
Summary: The Two-Part Workflow
text
┌─────────────────────────────────────────────────────────────────────────┐
│  GROUP DIRECTIVE (group-NN.md)                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  "Server Team: implement P10 Corrective Migration.             │   │
│  │   Deadline: 2026-08-28."                                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                         │
│                              ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  TASK CONTRACT (xprojman-NN.md)                                │   │
│  │  "GET /job-awards/pending endpoint — shape:                     │   │
│  │   { pending: [{ id, project_name, from_name, role_offered }] } │   │
│  │   Server confirms → App builds."                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                         │
│                              ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  GROUP DIRECTIVE (group-NN.md — status update)                 │   │
│  │  "Server P10: 80% complete. App offline queue: committed.      │   │
│  │   Blockers: none. Next group update: 2026-09-04."              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
When to Use Each
Create an xprojman-NN.md when:

You need to specify an API contract (Server → App)

You need to request a new endpoint or data model (App → Server)

You need to document a design decision that affects only one other team

You need to track the completion of a specific, bounded task

Create a group-NN.md when:

You need to issue new directives to multiple teams

You need to report on project-wide status

You need to escalate blockers that affect multiple teams

You need to realign priorities across the project

Relationship Between Document Types
Aspect	xprojman-NN.md	group-NN.md
Scope	One task, one contract	Multiple tasks, multiple teams
Audience	Server Agent + App Agent	ALL teams (Server, App, Portal, VeriTrade)
Purpose	Technical specification	Coordination + status
Frequency	As needed per feature	Weekly (or as needed for directives)
Decision Authority	Team leads (Server Agent, App Agent)	PM / System Architect
1. Executive Summary
The team has successfully completed the Q3 infrastructure milestones:

✅ App: Forgot-password screen rebuilt (xprojman-26), VeriTrade "Scan to sign in" QR approval flow built, OAuth onboarding fix shipped

✅ Server: Real branded HTML email + ClickSend SMS wired, Portal forgot-password flow live

✅ App: Offline image/document queue (xprojman-24) — built, verified against :4199, pending commit

✅ Dashboard: Admin platform built and verified (migration_v007, 18/18 tests)

Major outstanding items:

✅ **CORRECTED** — Server Corrective Migration (P10) — builder role, progress.tick/progress.verify split, engagement_mode, tax.approve, identity model (introductions/job_awards) — was reported BLOCKING the App; verified 2026-08-21 that this **already shipped** (migrations v012-v014, commit `10295e2`). Not a blocker.

✅ **CORRECTED** — VeriTrade — public product built, App login screen built, App backend + login + frontend all live; the PM2-02 identity-scoped evidence domain it depends on **already shipped** 2026-08-06 (migration v027, commit `002b468`). Not blocked. Remaining VeriTrade work (licence-verification integrations, B2B billing) is deliberately deferred scope, not a dependency gap.

2. Commit & Merge Instructions (ALL TEAMS)
This is a mandatory action for everyone on the project.

text
All uncommitted work on branch server/p5-site-ops MUST be committed and pushed by 
2026-08-21 17:00 AEST.

- Server Agent: commits include real email/SMS wiring, Portal recovery flow, 
  xprojman-26 contract doc
- App Agent: commits include forgot-password screen, VeriTrade login screen, 
  OAuth fix, offline image queue
- Portal Agent: commits include recovery modal + related pages

After commit, rebase against main and push.
Risk: Uncommitted work blocks the next phase. If you need to stash work-in-progress to push a clean commit, do so and document.

3. Server Team — Immediate Priority: P10 Corrective Migration
Deadline: 2026-08-28 17:00 AEST — ✅ MOOT, already shipped. See correction banner at top of this doc.

The App team was reported blocked on the Server Corrective Migration (P10). **Verified 2026-08-21: every deliverable below already exists in the codebase**, built well before this directive was issued:

Step A — Migration v012-v014 (schema + permissions) — ✅ ALL BUILT
Item	Status	Owner	Evidence
Add builder, developer, accountant roles to roles table	✅ BUILT	Server	migration_v012_corrective_roles.sql, commit 10295e2
Split progress.write → progress.tick / progress.verify	✅ BUILT	Server	Same migration; enforced in TaskProgressService.js:30,57
Scope programme.write to Stages 1-8 for PMs (read-only from Stage 9)	✅ BUILT	Server	ProjectService.js:250-268, assertProgrammeWriteScope() — comment literally says "Corrective migration Step A"
Add builder_engagement_type column + query-time visibility	✅ BUILT	Server	migration_v013_identity_model.sql, migration_v019_procurement.sql
Add subcontractor_pass_through_consent mechanism	✅ BUILT	Server	migration_v014_subcontractor_consent.sql
Add tax.approve permission + accountant role	✅ BUILT	Server	migration_v012_corrective_roles.sql
Step B — Identity Model (introductions + job_awards) — ✅ ALL BUILT
Item	Status	Owner	Evidence
introductions data model + endpoints (xprojman-04 shape)	✅ BUILT	Server	routes/introductions.js, IntroductionService.js
job_awards data model + endpoints (xprojman-11/12 shape)	✅ BUILT	Server	routes/jobAwards.js (incl. GET /pending), JobAwardService.js
Cold-stranger constraint (introductions pre-existence)	✅ BUILT	Server	Enforced in IntroductionService.js (part of the same migration pass)
S9.9 deposit-anchor FK + TPAR-reportable binding	✅ BUILT	Server	Present since the P7/P8 commercial builds, predates this directive
Server Team's Immediate Action (SUPERSEDED — nothing to build):

~~Begin Step A~~ — already shipped, migrations v012-v014.

~~Endpoint — implement GET /job-awards/pending first~~ — already live at routes/jobAwards.js:22.

Coordination — the App/Portal Job Award, Tick-Verify, and engagement-mode-visibility UI can proceed now; nothing server-side is pending.

4. App Team — Immediate Priority: Offline Image Queue Commit + Integration
Deadline: 2026-08-23 17:00 AEST

Offline Image Queue (xprojman-24)
Item	Status	Owner	Depends On
upload_queue local SQLite table	✅ BUILT	App	—
DocumentQueueService	✅ BUILT	App	—
Enqueue all five capture surfaces (inspection, defect, certificate, diary, delivery)	✅ BUILT	App	—
Upload worker with idempotent retry	✅ BUILT	App	—
LRU eviction / local file retention	✅ BUILT	App	—
Commit + merge	⚠️ PENDING	App	—
Live-verify against :5100	⚠️ PENDING	App	after commit
App Team's Immediate Action:

Commit the offline image queue code (xprojman-24 work) — it's built, verified against :4199, and ready to ship.

Live-verify against the new dev API port :5100 (not :4100) — the documents module is live and matrix v12.

Announce when the queue is live so the Server team knows it's safe to rely on it for documents integration.

Pending App Work — ✅ CORRECTED 2026-08-21: none of this is actually blocked. P10 shipped weeks ago (see §3 correction above) — every dependency below already exists in the codebase.
Item	Status	Blocked By
Job Award accept/decline UI (S9.7)	✅ UNBLOCKED	was: Server Step B (job_awards endpoints) — live, routes/jobAwards.js
Tick-Verify for task progress	✅ UNBLOCKED	was: Server Step A (progress.tick/progress.verify) — live, TaskProgressService.js
Engagement-mode visibility (Cost Plan read)	✅ UNBLOCKED	was: Server Step A (builder_engagement_type) — live, migration v013/v019
Builder Programme read-only wall	✅ UNBLOCKED	was: Server Step A (scoped programme.write) — live, ProjectService.js:250-268
5. Portal Team — Immediate Priority: Builder Console
Deadline: 2026-09-04 17:00 AEST

The Portal is the desk-analytical surface. With the Server Corrective Migration (P10) landing, the Portal needs to support the Builder role.

Builder Console (portaldesignspecification.md §4.3) — ✅ CORRECTED 2026-08-21: none of these depend on unbuilt server work; all "Depends On" server items shipped in P10 (§3 above). Still genuinely NOT STARTED on the Portal side, just not blocked.
Item	Status	Owner	Depends On
Builder login + role-scoped route groups	⚠️ NOT STARTED (Portal-side only)	Portal	Server Step A — ✅ already live
Job Award response (accept/decline from Portal)	⚠️ NOT STARTED (Portal-side only)	Portal	Server Step B — ✅ already live
Cost Plan view (engagement-mode visibility)	⚠️ NOT STARTED (Portal-side only)	Portal	Server Step A2 — ✅ already live
Programme/Line-of-Balance editing (Builder's own schedule)	⚠️ NOT STARTED (Portal-side only)	Portal	Server Step A — ✅ already live
Panel management (Builder → own Tradies/Foreperson)	⚠️ NOT STARTED (Portal-side only)	Portal	Server Step B — ✅ already live
Subcontractor engagement register	⚠️ NOT STARTED (Portal-side only)	Portal	Server Step A2 — ✅ already live
Portal Team's Immediate Action:

Build the Builder login/role-scoped route groups — this is the foundation for every other Builder feature.

Implement Job Award response (accept/decline) — this is the first builder-specific UI.

Coordinate with Server — Builder-specific permissions (claims.submit, panel.manage, po.write, etc.) are matrix v12; ensure the Portal route groups gate on these correctly.

6. VeriTrade — Status & Next Steps
Current State:

✅ Backend login endpoints (/veritrade/login/*) live on :5100

✅ Public teaser profile pages live (indexable, cacheable)

✅ Search and full-profile view (gated by B2B subscription) live

✅ App "Scan to sign in" screen built (xprojman-25)

✅ CORRECTED 2026-08-21 — PM2-02 identity-scoped evidence domain (engagements/identities/attestations) is BUILT, not blocked. See §7 below and veritrade-status-2026-08-21.md (independent confirmation from the VeriTrade Agent).

Blocking Item: NONE. VeriTrade's core value proposition — a tradie's evidence spanning many Builders' tenants — was delivered when PM2-02 shipped (migration v027, commit 002b468, 2026-08-06). VeriTrade V1 (backend + login + frontend) is built directly on top of it and is live.

Next Step: No server dependency remains. Remaining VeriTrade work (licence-verification integrations §6, B2B billing §9 of veritradedesignspecification.md) is deliberately deferred product scope — needs an owner ruling on timing, not server build time.

7. PM2-02 — Identity-Scoped Evidence Domain (Build Spec) — ✅ CORRECTED 2026-08-21: COMPLETE, not Q4 2026.
Architecture approved 2026-07-22 (projman-02.md). Built and shipped 2026-08-06.

Build Spec (serverdesignspecification.md §13)
Item	Status	Owner	Evidence
engagements schema (cross-org bridge)	✅ BUILT	Server	migration_v027_engagements_identities_attestations.sql, commit 002b468
identities schema (1:1 with users.id)	✅ BUILT	Server	Same migration
attestations schema (signed evidence store)	✅ BUILT	Server	Same migration
engagement scope_class resolver	✅ BUILT	Server	lib/scope.js, keyed off the session's scopeJson claim
Session mechanics (engagement token)	✅ BUILT	Server	Two live tokens per device — home + activated engagement context
Attestation emission calls (5 existing domain services)	✅ BUILT	Server	Task verify, inspection pass, diary sign-off, stage completion, invoice match — all hooked
Timeline: Shipped 2026-08-06, three weeks before this directive's Q4 2026 estimate.

8. Summary: Work Streams & Dependencies — ✅ CORRECTED 2026-08-21
text
Already shipped (predates this directive):
├── Server P10 Corrective Migration (Step A + B) — migrations v012-v014, commit 10295e2
│   └── App Job Awards + Tick-Verify + Builder Console are UNBLOCKED, not pending
└── PM2-02 (engagements/identities/attestations) — migration v027, commit 002b468 (2026-08-06)
    └── VeriTrade full value proposition (evidence spanning tenants) is LIVE, not Q4-blocked

Q3 2026 (Aug-Sep) — remaining real work
├── App Offline Image Queue — DUE 2026-08-23
│   └── UNBLOCKS all five capture surfaces (photos/documents persist)
└── Portal Builder Console — DUE 2026-09-04
    └── Portal-side build only; server dependency already satisfied

Q4 2026 (Oct-Dec)
└── VeriTrade deferred scope only (licence-verification integrations, B2B billing) — owner-ruling needed on timing, not a build dependency
9. Team Readiness Check — ✅ CORRECTED 2026-08-21
Team	Blocked On	Ready to Start
Server	—	✅ P10 Corrective Migration — ALREADY COMPLETE
App	~~Server P10~~ NOTHING	✅ Offline Image Queue (commit/merge); Job Award UI, Tick-Verify all unblocked
Portal	~~Server P10~~ NOTHING	✅ Builder Console — server dependency already satisfied, Portal-side build can start now
VeriTrade	~~PM2-02 (Q4)~~ NOTHING	✅ PM2-02 already built and live (2026-08-06) — deferred scope (licence/billing) needs owner ruling only
10. Status Report Template (ALL TEAMS)
All team leads must report using this template. Reports are due weekly, by 17:00 AEST every Friday.

text
### Status Report — [Team Name] — [YYYY-MM-DD] — [HH:MM AEST]

**Current Status:** 🟢 On Track / 🟡 At Risk / 🔴 Blocked

**This Week's Deliverables (Completed):**
1. [Item] — [xprojman-NN or group-NN reference] — Completed [YYYY-MM-DD HH:MM]
2. [Item] — [xprojman-NN or group-NN reference] — Completed [YYYY-MM-DD HH:MM]

**Blockers / At-Risk Items:**
1. [Item] — [xprojman-NN or group-NN reference] — Since [YYYY-MM-DD] — [Reason]

**Next Week's Plan (3-5 items):**
1. [Item] — [xprojman-NN or group-NN reference] — [Deadline]
2. [Item] — [xprojman-NN or group-NN reference] — [Deadline]
3. [Item] — [xprojman-NN or group-NN reference] — [Deadline]

**Dependencies & Needs:**
1. Need [deliverable] from [team] by [date] — [xprojman-NN reference]
2. Need [decision] from [owner] by [date]

**Changes to Previously Reported Plan:**
1. [Change] — [Reason] — Approved by [owner] on [date]

**Risks:**
1. [Risk] — Mitigation: [plan]
2. [Risk] — Mitigation: [plan]
Example — App Team Report:
text
### Status Report — App Team — 2026-08-21 — 15:30 AEST

**Current Status:** 🟢 On Track

**This Week's Deliverables (Completed):**
1. Forgot-password screen rebuild — xprojman-26 — Completed 2026-08-20 18:00
2. VeriTrade "Scan to sign in" screen — xprojman-25 — Completed 2026-08-20 19:30
3. OAuth onboarding fix — xprojman-25 — Completed 2026-08-20 16:00

**Blockers / At-Risk Items:**
1. Server Corrective Migration (P10) — group-01 — Since 2026-08-21 — Blocks Job Award UI + Tick-Verify

**Next Week's Plan (3-5 items):**
1. Offline Image Queue — Commit + merge — xprojman-24 — 2026-08-23
2. Live-verify against :5100 — xprojman-24 — 2026-08-24
3. Begin Job Award UI scaffold (blocked on Server Step B) — xprojman-11/12 — 2026-08-28

**Dependencies & Needs:**
1. Need `GET /job-awards/pending` endpoint from Server by 2026-08-28 — xprojman-11
2. Need `progress.tick`/`progress.verify` permissions from Server by 2026-08-28

**Changes to Previously Reported Plan:**
1. None.

**Risks:**
1. Server P10 delayed — Mitigation: Continue with independent items; escalate if no progress by 2026-08-26
11. Next Status Update
Format: group-02.md (same structure)

Date: 2026-08-28

Time: 17:00 AEST

Agenda:

Server P10 status (Step A migration applied)

App offline queue live-verified against :5100

Portal Builder Console progress

Review all team status reports submitted by 17:00 AEST 2026-08-27

12. Critical Dates
Item	Date	Time (AEST)
Commit & Push Deadline	2026-08-21	17:00
App Offline Queue Deadline	2026-08-23	17:00
Server P10 Deadline	2026-08-28	17:00
Status Reports Due	2026-08-27	17:00
Portal Builder Console Deadline	2026-09-04	17:00
Next group-02.md	2026-08-28	17:00
Issued by: PM / System Architect
Distribution: All teams (Server · App · Portal)
Issue Date: 2026-08-21 14:30 AEST

Questions / concerns? Reply to this thread.