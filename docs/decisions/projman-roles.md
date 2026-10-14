> ⚠️ **ROSTER SUPERSEDED 2026-09-30:** read `docs/decisions/xprojman-roles.md` first at every session start. The protocols here (§4–§8) still apply.

projman-roles.md — Team Roles & Memory Management
Status: 🟢 ACTIVE · Issued By: PM / System Architect
Issue Date: 2026-08-21 15:30 AEST
Last Updated: 2026-08-21
Location: docs/projman-roles.md
Purpose: Single source of truth for team roles, memory IDs, directory ownership, and communication protocols.

0. Purpose of This Document
This document defines who owns what in the ProjMan2 project, how each team should identify themselves, and how teams coordinate.

All agents must read this document at the start of every session.

1. Team Roles & Memory IDs
Each agent maintains a memory ID for session context. State this at the beginning of every session:

text
"I am [Role], memory ID [ID]."
Team	Role	Memory ID	Primary Directory	Primary Spec
Server Agent	Backend + Platform Ops	projman2-server-agent	server/api/, server/dashboard/	serverdesignspecification.md
App Agent	Flutter Mobile Client	projman2-app-agent	app/	appdesignspecification.md
Portal Agent	Tenant Web Console	projman2-portal-agent	server/portal/	portaldesignspecification.md
VeriTrade Agent	Public B2B Product	projman2-veritrade-agent	server/veritrade/	veritradedesignspecification.md
2. Directory Ownership
text
Projman2/
├── app/                    → App Agent (Flutter mobile client)
│   └── lib/                → all Flutter code
│
├── docs/
│   ├── decisions/          → xprojman-NN.md task contracts (ALL teams)
│   ├── appdesignspecification.md
│   ├── portaldesignspecification.md
│   ├── veritradedesignspecification.md
│   ├── serverdesignspecification.md
│   ├── devroadmap.md
│   ├── projman-roles.md    ← THIS FILE
│   └── MEMORY.md           → project-wide memory (ALL teams)
│
├── server/
│   ├── api/                → Server Agent (Node/Express REST API)
│   ├── dashboard/          → Server Agent (Platform Ops - Next.js)
│   ├── portal/             → Portal Agent (Tenant Console - Next.js)
│   ├── veritrade/          → VeriTrade Agent (Public B2B - Next.js)
│   └── MEMORY.md           → shared server memory (ALL server agents)
│
├── group-NN.md             → project-wide directives (ALL teams)
└── README.md
3. Shared Memory Files
File	Purpose	Maintained By
server/MEMORY.md	Server-side context, status, conventions, traps	Server Agent (primary), ALL server agents
docs/MEMORY.md	Project-wide framework, locked decisions, open questions	PM / System Architect
docs/projman-roles.md	This document — team roles & memory IDs	PM / System Architect
group-NN.md	Project-wide directives & status updates	PM / System Architect
4. Document Types & Their Purpose
Document Type	File Pattern	Purpose	Audience	When to Use
Task Contract	xprojman-NN.md	Technical handoff between teams — defines API contracts, data shapes, and implementation details for a specific, bounded task.	Specific team members (Server ↔ App, Server ↔ Portal, etc.)	When building a feature that spans multiple teams; when one team needs to give another a concrete spec to build against
Group Directive	group-NN.md	Project-wide coordination — sets deadlines, tracks status, communicates priorities, and ensures alignment across all teams.	ALL teams	Weekly status sync; issuing new priorities; reporting completion; alerting on blockers
Memory File	MEMORY.md	Persistent project context for session resumption.	ALL teams	At the start of every session; when updating project status
5. Two-Part Workflow
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
Document Type	Create When...
xprojman-NN.md	You need to specify an API contract, request a new endpoint, document a design decision affecting one other team, or track completion of a specific task
group-NN.md	You need to issue new directives to multiple teams, report project-wide status, escalate blockers, or realign priorities
MEMORY.md	You need to record persistent context that a fresh session should load immediately
6. Communication Protocol
Between Agents — Using xprojman-NN.md
Use task contracts for technical handoffs between any two teams:

text
Step 1: Agent A → Creates xprojman-NN.md with a proposal/request
Step 2: Agent B → Confirms or corrects the proposal/request
Step 3: Agent A → Builds against confirmed contract
Step 4: Agent B → Builds their side
Step 5: Agent A → Updates xprojman-NN.md with completion status
Project-Wide — Using group-NN.md
Use group directives for:

Issuing new priorities

Reporting project-wide status

Escalating blockers

Realigning deadlines

Onboarding new team members

Session Startup
Every agent must read these files at session start:

docs/projman-roles.md — this file (roles, memory IDs, protocols)

server/MEMORY.md — server-side context (Server, Portal, VeriTrade agents)

docs/MEMORY.md — project-wide context (ALL agents)

group-NN.md — latest project directives (ALL agents, latest number)

7. Team Coordination Matrix
Workstream	Owner	Depends On	Provides To
Server API	Server Agent	—	Portal, App, VeriTrade, Dashboard
Server Dashboard	Server Agent	Server API	Platform Ops
Server Portal	Portal Agent	Server API, Server P10	App (via xprojman contracts)
Server VeriTrade	VeriTrade Agent	Server API, PM2-02	App (login screen)
App (Flutter)	App Agent	Server API	VeriTrade (login), Portal (data)
8. Status Report Template
All team leads must report weekly using this template. Reports are due by 17:00 AEST every Friday in group-NN.md.

text
### Status Report — [Team Name] — [YYYY-MM-DD] — [HH:MM AEST]

**Memory ID:** [your-memory-id]
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
9. Current Team Status (2026-08-21)
Team	Memory ID	Status	Blocked On
Server Agent	projman2-server-agent	🟢 Active	—
App Agent	projman2-app-agent	🟢 Active	Server P10 (2026-08-28)
Portal Agent	projman2-portal-agent	🟡 Onboarding	Server P10 (2026-08-28)
VeriTrade Agent	projman2-veritrade-agent	🟡 Onboarding	PM2-02 (Q4 2026)
10. Critical Dates (2026)
Item	Date	Time (AEST)
Commit & Push Deadline	2026-08-21	17:00
Portal/VeriTrade Onboarding Complete	2026-08-23	17:00
App Offline Queue Deadline	2026-08-23	17:00
Server P10 Deadline	2026-08-28	17:00
Status Reports Due (group-02.md)	2026-08-27	17:00
Portal Builder Console Deadline	2026-09-04	17:00
PM2-02 Build Start	Q4 2026	TBD
Issued by: PM / System Architect
Distribution: Server Agent · App Agent · Portal Agent · VeriTrade Agent
Issue Date: 2026-08-21 15:30 AEST

Questions / concerns? Reply to this thread.

© eBizco Australia Pty Ltd — projman-roles.md, 2026-08-21