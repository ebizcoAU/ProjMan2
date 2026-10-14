ProjMan-05 — Project Status & Integration Summary
Status: 🟢 LIVE tracker · Author: Project Manager (PM) · For: App Team · Server Team · Owner
Updated: 2026-07-24
Companions: projman-04.md (server dev → app team) · servdesignspecification.md (server & web design) · dashboarddesignspecification.md (admin/ops dashboard) · portaldesignspecification.md (web console)

1. Executive Summary
The project has reached a significant milestone with the successful integration of three concurrent workstreams:

Workstream	Status	Completion
P5 — Site Operations (diary, attendance, deliveries)	✅ BUILT + VERIFIED	tests/siteops.test.js 28/28
P6a — Quality Module (inspections, defects, certificates)	✅ BUILT + VERIFIED	tests/quality.test.js 19/19
Sync Integration (app ↔ server contract)	✅ VERIFIED	No conflicts, end-to-end passing
Staging Deployment	✅ DEPLOYED	Both agents merged and deployed
Backlog BL-001 (person_id auto-populate)	📋 LOGGED	Not yet assigned to sprint
All 7 test suites pass: isolation 16 · domain 29 · access 19 · stages 15 · admin 18 · siteops 28 · quality 19.

2. Server Build Status (From projman-04.md §1)
Area	Status	Tests
Phase-1 identity (auth, recovery, pairing)	✅	16/16
AU sign-in (OAuth + SMS)	✅	—
Construction core (customers, projects, stages, tasks)	✅	29/29
Access control (permissions + RBAC + scope)	✅	19/19
18-stage engine (templates, progression, hold-point interlocks)	✅	15/15
System Admin dashboard	✅	18/18
Site ops (P5) — diary, attendance, deliveries	✅	28/28
Quality (P6a) — inspections, defects, certificates	✅	19/19
Office portal (Next.js; login + Devices + Projects + Programme + Cost Plan + Admin)	✅	Builds clean
3. Architecture Summary
3.1 One Server, Three Surfaces
text
┌── App (Flutter) ──────────┐   ┌── Dashboard (Next.js) ───┐   ┌── Public portal (Next.js) ─┐
│ site + office, on-device  │   │ office console            │   │ customer read-only view    │
│ capture-first, offline    │   │ org_admin / PM            │   │ their project only         │
│ session WITH device_id    │   │ session, no device_id     │   │ session, `customer` role   │
└─────────────┬─────────────┘   └────────────┬─────────────┘   └─────────────┬──────────────┘
              │                               │                               │
              └───────────────────────────────┴───────────────────────────────┘
                                            │  HTTPS /api/v1
                              ┌─────────────▼──────────────┐
                              │  ProjMan2 API (server)     │  MySQL c1projman2
                              │  Express + service layer   │
                              └────────────────────────────┘
3.2 Role Model (6 Roles, CamelCase)
Role	Scope	Description
projectManager	portfolio	Creates projects, full access
siteSupervisor	assigned	Site manager, read/write on assigned projects
foreperson	assigned	Foreman, diary contribute, attendance muster
tradie	self	Own tasks, own attendance
inspector	assigned	Quality validation only
client	portal	Read-only own project (P10)
Key enforcement: Permissions are tied to roles via the matrix (matrixVersion: 4). PM cannot self-validate a hold-point inspection — quality.validate is inspector-only.

4. Latest API Endpoints (Ready for App)
All endpoints under /api/v1, Bearer auth:

4.1 Site Operations (P5)
Endpoint	Method	Description
GET /projects/:id/diary	GET	Diary entries (current + version history)
GET /projects/:id/attendance	GET	Muster / day roster
GET /projects/:id/deliveries	GET	Delivery log
All writes ride /sync/push (offline-first, app-owned).

4.2 Quality Module (P6a)
Endpoint	Method	Description	Permission
POST /projects/:id/inspections	POST	Create inspection	quality.write
GET /projects/:id/inspections	GET	List (+items)	projects.read
POST /projects/:id/inspections/:iid/complete	POST	Commit verdict; hold-point pass → validate	quality.write + quality.validate (hold-point)
GET /projects/:id/defects	GET	Punch-list	projects.read
GET /projects/:id/certificates	GET	Certificate register	projects.read
Key constraint: inspection_items has no project_id column — it resolves scope through its parent inspections row. Push/pull work identically to other sync tables.

4.3 Admin (Platform Ops) — Separate /admin/* Mount
Endpoint	Method	Description
GET /admin/stats	GET	Summary counts + trends
GET /admin/users	GET	User-account list (filters: role, status, org)
POST /admin/users/:id/suspend	POST	Account suspension
POST /admin/users/:id/reactivate	POST	Account reactivation
POST /admin/users/:id/force-logout	POST	Terminate all sessions
GET /admin/devices	GET	Device list (filters: status, role, org)
GET /admin/logs/login	GET	Login transaction log (filters: from, to, email, org, outcome, method)
GET /admin/logs/login/export	GET	CSV export of login log
GET /admin/orgs	GET	Org directory
GET /admin/billing/subscriptions	GET	Subscription list (status, plan)
GET /admin/billing/revenue	GET	MRR + revenue chart + overdue list
POST /admin/billing/payments	POST	Record a payment
PATCH /admin/orgs/:id/plan	PATCH	Change plan / extend trial
GET /admin/system/health	GET	API + sync health
⚠️ Boundary enforced: No /admin/* endpoint returns project or user content — account layer only. Access = platform_admins allowlist.

5. Portal (Web Console) Status
One Next.js app (server/dashboard) with four route groups:

Route Group	Surface	Status
(console)/*	PM Console	✅ Built: login, Devices, Projects, Programme tab, Cost Plan, Admin
/client/*	Client Portal	⏳ Pending — spec exists, waits on portal scope surface (P10)
/ /login /signup	Public entry	✅ Built: login + signup; marketing landing deferred to v2
/admin/*	Admin & monitoring	✅ Built: System Admin dashboard
5.1 Immediate Buildable Portal Modules (Today)
Module	Status	Server Dependency
Cost Plan	✅ Ready	Stage cost columns (built)
Admin (users, devices, org settings, audit)	✅ Ready	/organisation/*, /devices/* (built)
Dashboard (portfolio KPIs)	✅ Basic	Projects/stages (built); richer with P5–P7
Quality review (inspections, defects, certificates)	🟡 Requires P6a	✅ Built — now buildable
Gantt	🟡 Small server work	Task dep/date endpoints needed
Estimating	🟢 Waits P7	Not built
Procurement	🟢 Waits P7	Not built
Safety	🟢 Waits P6b	Not built
Client Portal	🟢 Waits P10	portal scope surface
6. Sync Contract — What Changed (App Must Handle)
6.1 Quality Tables Added to Sync Registry
Table	Owner	Pull	Project Scope	Notes
inspections	app	✅	project_id	Owner app
inspection_items	app	✅	parent-derived	No project_id column — scopes through inspections
defects	app	✅	project_id	Server-stamped raised_by, closed_at, closed_by
certificates	app + web	✅	project_id	Array-valued owner (['app','web'])
App Action Required:

Your sync client must now handle certificates in the payload — they are app-owned but web-owned as well.

inspection_items is a child table — your push/pull logic should work as for any other project-scoped table; the server resolves parent scope.

6.2 Protected Columns (App Cannot Write)
Table	Protected Columns
inspections	inspector_id, completed_at (only via complete REST)
defects	raised_by, raised_at, closed_at, closed_by
certificates	None — app writes all fields
site_diary	is_current, author_id, finalised_at, finalised_by
site_attendance	geo_verified (server-derived from geofence)
deliveries	received_by (server-stamped)
App Action Required:

Your app must not attempt to write protected columns. They will be silently dropped or rejected.

geo_verified is server-derived, not client-asserted. Send check_in_lat/lng; the server computes geo_verified against the project geofence.

6.3 Permission Matrix (v4) — Role Table
Permission	projectManager	siteSupervisor	foreperson	tradie	inspector	client
org.manage	✅					
users.manage	✅					
devices.manage	✅	✅				
customers.read/write	✅/✅					
projects.read	✅	✅	✅	✅	✅	✅
projects.write	✅					
programme.write	✅					
progress.write	✅	✅	✅	✅ (own)		
money.read/write	✅/✅					
quality.validate					✅	
diary.write / diary.signoff	✅/✅	✅/✅	✅/—			
attendance.write.site / .own	✅/✅	✅/✅	✅/✅	—/✅		
deliveries.write	✅	✅	✅			
quality.write	✅	✅			✅	
App Action Required:

Your UI should gate actions based on permissions, not roles. Fetch GET /auth/permissions and render accordingly.

quality.validate is inspector-only — a PM cannot self-validate a hold-point inspection.

7. Gap Analysis — What's Missing
#	Item	Owner	Priority	Status
1	BL-001 — Auto-populate person_id in attendance	App Agent	P3	📋 Logged, not assigned
2	P6b — NCC/structural ComplianceService	Server Agent	P2	⏳ Spec exists, not built
3	Portal Quality tab (review UI)	Server Agent	P2	⏳ Waits on P6a (now built)
4	Portal Gantt (interactive schedule)	Server Agent	P3	⏳ Needs small server work
5	Client Portal (/client/*)	Server Agent	P4	⏳ Waits P10 (portal scope surface)
6	P7 Commercial (estimates, POs, claims)	Server Agent	P3	⏳ Not built
7	P8 Accounting	Server Agent	P4	⏳ Not built
8	P9 AU Tax	Server Agent	P4	⏳ Not built
8. Unified Build Order (Remaining)
Phase	Module	Server	Portal	App
Immediate	P6b — ComplianceService (NCC/structural)	🔴 Build	—	—
Immediate	Portal Quality tab	—	🔴 Build	—
P2	P7 Commercial (estimating, procurement, claims)	🔴	🟡	🟡
P3	Portal Gantt	🟡	🔴	—
P3	BL-001 (person_id auto-populate)	—	—	🔴
P4	P8 Accounting	🔴	🟡	—
P4	P9 AU Tax	🔴	🟡	—
P5	P10 Client Portal	🔴	🔴	—
v2	Marketing landing	—	🔴	—
9. Key Decisions Made (Locked)
Decision	Outcome	Reference
Role model	6 roles, camelCase	18StageProjectMangementMatrix.md
estimator	Folded into projectManager — no new role	portaldesignspecification.md §11
P6a now, P6b follows	Split Quality module; P6a built	servdesignspecification.md §12.12
quality.validate	Inspector-only — PM cannot self-validate	servdesignspecification.md §10.5
Diary append-only	New-row-per-version, supersedes_id + is_current	servdesignspecification.md §11.4
geo_verified server-derived	Anti-fraud, not client-asserted	servdesignspecification.md §11.5
Admin dashboard	platform_admins allowlist, not a tenant role	dashboarddesignspecification.md §2
Billing in v1	Real module (subscriptions/payments), manual reconciliation	dashboarddesignspecification.md §5.4
10. Action Items
10.1 App Team
#	Action	Priority	Status
1	Handle certificates owner ['app','web'] in sync client	High	⏳ Pending
2	Fetch GET /auth/permissions and gate UI by permissions, not roles	High	⏳ Pending
3	Do not write protected columns (geo_verified, is_current, etc.)	High	⏳ Pending
4	Implement BL-001 (person_id auto-populate)	Medium	📋 Logged
5	Handle inspection_items parent-scoped push/pull (server resolves scope)	Low	⏳ Pending
10.2 Server Team
#	Action	Priority	Status
1	Build P6b — NCC/structural ComplianceService	High	⏳ Spec exists
2	Build Portal Quality tab (inspections, defects, certificates review)	High	⏳ Ready (P6a built)
3	Build Portal Gantt (interactive schedule)	Medium	⏳ Needs spec
4	Build P7 Commercial (estimates, POs, claims)	Medium	⏳ Not started
5	Build P8 Accounting	Low	⏳ Not started
6	Build P10 Client Portal	Low	⏳ Spec exists
10.3 Project Manager
#	Action	Priority	Status
1	Schedule sprint for BL-001	High	📋 To schedule
2	Greenlight P6b build	High	⏳ Awaiting owner
3	Review portal Gantt spec	Medium	⏳ Awaiting owner
11. Risk Register
Risk	Impact	Mitigation	Status
App sync client doesn't handle certificates array owner	Sync failures	App team updates sync client	⏳ Pending
App gates UI by role instead of permission	Wrong UI visibility	App team fetches /auth/permissions	⏳ Pending
Protected columns written by app	Data corruption / rejections	App team removes from payload	⏳ Pending
P6b (NCC/structural) not built	Stage completion gate incomplete	Server team builds	⏳ Pending
Portal quality tab not built	Office cannot review inspections	Server team builds	⏳ Pending
12. Environment
Environment	URL / Address	Status
Staging API	http://<staging-host>:4199/api/v1	✅ Deployed
Staging Dashboard	http://<staging-host>:3300	✅ Deployed
Development DB	c1projman2 (local)	✅ Running
Staging DB	c1projman2_staging	✅ Migrated (v009)
13. Next Steps
App Team: Address high-priority sync client items (certificates owner, protected columns, permission-based UI).

Server Team: Build P6b (NCC/structural ComplianceService) and Portal Quality tab.

Project Manager: Schedule BL-001 sprint, greenlight P6b.

14. Conformance Checklist (Post-Integration)
☑ All 7 test suites pass (isolation, domain, access, stages, admin, siteops, quality)
☑ Sync review complete — no conflicts
☑ App and server branches merged to main
☑ Deployed to staging
☑ End-to-end verification passed (app ↔ server sync)
☑ Quality module (P6a) built and verified
☑ Site ops (P5) built and verified
□ BL-001 implemented (pending)
□ P6b built (pending)
□ Portal Quality tab built (pending)
15. Sign-off
Role	Status	Date
Project Manager	✅ Proceed	2026-07-24
App Team	⏳ Reviewing	—
Server Team	✅ Proceed	2026-07-24
Owner	⏳ Pending	—
