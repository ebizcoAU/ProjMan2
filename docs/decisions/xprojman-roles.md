# xprojman-roles — Team Roles, Work Scope, Domains & Reporting Lines

**Status:** 🟢 ACTIVE — roster of record (supersedes the roster in `projman-roles.md`; that file's
protocols §4–§8 still apply unless changed here).
**Author:** Project Manager (PM, session `projman2-82`, memory ID `projman2-pm`).
**Issued under:** System Architect + SA Assistant direction.
**Date:** 2026-09-30.
> ### ⚠️ STANDING INSTRUCTION (System Architect, 2026-09-30)
> **Every agent, at the start of EVERY new chat session, reads this file first**, before any other work.
> Then read the latest `group-NN.md` and your own memory file.
> Then send the PM your new session name (§5 step 2), because session names change on restart.
> Save a pointer to this rule in your own memory so it survives resets.

**Sources this is built from:** `docs/researchPaper/ProjMan_18Stage_Specification_v3.4.pdf` (Core Logic
Driver), `docs/researchPaper/18Stage_Tasks.md`, `docs/devroadmap.md`, `docs/processmap.md`,
`docs/CostCentre.md` (proposed), `product/docs/productwebsite.md`, `xprojman-01…44`, `pm-01`,
`group-01/02`.

---

## 0. Chain of command

```
                     Owner — eBizco Australia (Vince Phan)
                     final say: scope, policy, legal, spend, commits-to-main, credentials
                                        │
                  System Architect (SA) + SA Assistant
                  direct & monitor the team; architecture/model rulings
                                        │
                           Project Manager (PM)  ← you report here
                  roster, sequencing, status roll-up, cross-team unblocking,
                  escalation to SA/Owner, group-NN directives
                                        │
     ┌──────────────┬──────────────┬────┴─────────┬────────────────┬──────────────────┐
  Server Dev      App Dev       Portal Dev     VeriTrade Dev    Product Manager
  (api+dashboard) (Flutter)     (tenant web)   (public B2B)     (marketing site)
```

- **Every team member reports to the PM.** The PM consolidates and reports up to SA / SA Assistant.
- **Do not go straight to the Owner** for a decision. Raise it with the PM, who routes it to SA or the
  Owner (see §4). Exception: the Owner or SA contacts you directly — answer, then tell the PM.
- **Peer-to-peer is encouraged** for technical contracts (xprojman-NN). You don't need the PM in the loop to
  agree an endpoint shape, but copy the PM on the status line when it changes.

---

## 1. Team roster

| Role | Memory ID | Session name¹ | Owns (directory) | Dev port / Prod domain | Spec of record |
|---|---|---|---|---|---|
| **Project Manager** | `projman2-pm` | `projman2-a1` (2026-10-14; was `projman2-82`) | `docs/decisions/xprojman-roles.md`, `group-NN.md`, status roll-ups | — | this file |
| **Server Dev** (backend + Platform Ops dashboard) | `projman2-server-agent` | `projman2-d3` ✅ (2026-10-14; was `projman2-a2`) | `server/api/`, `server/dashboard/`, `server/skills/`, `server/shared/`, migrations | API 5100 · Dashboard 5101 · Skills 5104 (reserved) · prod: placeholders `api.` / `dashboard.projman2.ebizco.com.au` | `serverdesignspecification.md`, `dashboarddesignspecification.md` |
| **App Dev** (Flutter field app) | `projman2-app-agent` | `projman2-ef` ✅ (2026-10-14; was `projman2-81`) | `app/` | device builds; dev API 10.1.1.42:5100 (Makefile auto-detects the LAN IP) · MQTT `mqtt.ebizco.com.au` (client only, never touch the shared broker) | `appdesignspecification.md` (LOCKED v2) |
| **Portal Dev** (tenant web console) | `projman2-portal-agent` | `projman2-55` ✅ (2026-10-14; was `projman2-ae`) | `server/portal/` | 5102 · prod placeholder `portal.projman2.ebizco.com.au` | `portaldesignspecification.md` |
| **VeriTrade Dev** (public B2B verified-trade product) | `projman2-veritrade-agent` | _no session 2026-10-14_ (was `product-5a`; the name is misleading: the session opened in `product/`, but VeriTrade works only in `server/veritrade/`) | `server/veritrade/` | 5103 · prod placeholder `veritrade.ebizco.com.au` | `veritradedesignspecification.md` |
| **Product Manager** (public marketing site) | `projman2-product-agent` | `projman2-60` ✅ (2026-10-14; was `projman2-d4`) | `product/` | dev 5105 · prod 6032 behind **projman.ebizco.com.au** (LIVE, the only real prod domain) | `product/docs/productwebsite.md` |
| **System Architect** + **SA Assistant** | — | **not a session**: SA = the Owner (Vince, human); SA Assistant = an external AI the Owner uses outside this machine | direction; no code directory | — | 18-Stage Spec v3.4 |

¹ The session name each agent is reachable at for `SendMessage` (see §5). Filled in from roll-call replies.
Roll-call 2026-09-30: all five leads replied. Roll-call 2026-10-14 (PM `projman2-a1`): the Owner assigned the roles directly. VeriTrade has no session. **The SA is the Owner**, so SA rulings reach agents through the Owner's own messages or through the PM. No agent should look for an SA session in `ListAgents`.
**Session names don't tell you the role.** Always check this table before you message anyone.

Shared by everyone: `docs/decisions/` (anyone can write a contract), `docs/*designspecification.md` (the
owning team edits, others append dated responses), `docs/researchPaper/` (read-only reference).

**Domain roadmap:** `projman.com.au` is being bought and will replace `projman.ebizco.com.au`, with
`admin.` / `portal.` / `veritrade.` subdomains planned. Until the Owner confirms, every prod URL except
the product site is a **placeholder**. Don't hard-code it.

---

## 2. Work scope per team (mapped to the 18-Stage spec)

The spec tags each sub-step as App, Portal or Both (p.4 §1.2). The split below turns that into team
ownership. `devroadmap.md` §6 is the baseline: **App = Stages 1, 6, 7 capture + 10–18. Portal = 2–5, 8–9 + PM/Builder
desk work.** Every cross-cutting rule lives in the Server.

### 2.1 Server Dev — `server/api`, `server/dashboard`
- **Owns:** the domain model and every rule that must hold whatever the surface:
  - Identity, sync, roles/RBAC (one person = one fixed role, xprojman-08).
  - The 18-stage engine, hold points (statutory vs internal QA, conditional by jurisdiction or hazard), event chaining.
  - Frozen/hashed records and `supersedes_id`.
  - Commercial visibility walls (§1.9), Job Award / Introduction rule, Cost Plan lock, S9.10 seeding.
  - Billing milestones (Stages 9/12/13/14/16/18), per-tenant Finance, the AU tax module.
  - Attestation emission (S18.16) and the VeriTrade backend, OAuth/SMS, MQTT client.
- **Dashboard** is eBizco **Platform Ops only**: cross-tenant/admin. It must never expose tenant user PII to
  non-admin platform roles.
- **Status:** P1–P8, P10, PM2-02 and the VeriTrade backend are built, migrations through **v045** (xprojman-44 C).
- **In flight / next:**
  - xprojman-43 Steps 1–2 (client billing, revenue posting), waiting for Owner sign-off.
  - **Handover items:**
    - #7: the S9.10 vs `instantiateProgramme` mismatch.
    - #8: stage-patch status for S10.5 / S11.9 / S12.8-9 / the jurisdiction field.
  - **Lead the schema proposal passes:**
    - The checklist-template schema (xprojman-28 §3). ✅ ✅ **BUILT v047** `d219e7e` (791/791 green, applied to c1projman2). App and Portal are now wiring to it. Proposed in **xprojman-46** (`bbc1b39`). Six forks. ✅ **F3 approved** (SA, 2026-09-30). App responded (`dc8590a`): it agrees with F1/F2/F4/F6. F5 has a blocker: the draft checks `photo_id` on the item row, but photos attach via `documents.entity_id` (xprojman-21), so Server must fix that before the build. Waiting on Portal's response.
    - The Safety/OHS schema (#10), with Portal and App. Proposed in **xprojman-48**; App responded (`6231c02`), Server replied (`29e6efc`). **Rulings, SA 2026-09-30 (relayed by PM):**
      - **F7:** Builder does NOT get `safety.manage` in v1.
      - **F3:** approved. v1 records notifiable incidents and *emails* the PM and Site Supervisor; no claim to lodge with the regulator or to make the org compliant; 5-year retention. Product copy follows the same wording.
      - **F5:** warn plus alert; no hard block on sign-in.

      Still waiting on Portal's response.
- **Done, verified 2026-09-30:**
  - xprojman-30 is committed (`bea4878`, `abe8598`).
  - The defects PATCH and project-scoped docs list are built (`dbaa649`).
  - The stage status enum is fixed (`10bb83e`, not pushed yet).
  - `trade_offered` is added to `/job-awards/pending` (`ce5a016`, not pushed yet). App is built for it (`5634003`).

### 2.2 App Dev — `app/`
- **Owns:** the field surface. Capture-first and offline:
  - Stage 1 capture (title photo, site access).
  - Builder's Job Award accept tap (S9.7) and offline document cache (S9.8).
  - **Stages 10–18 site work:** Tradie tick → Foreperson verify, Site Supervisor oversight, Inspector hold
    points, geofenced append-only evidence, dockets, site diary, safety, defects.
  - S18 Inspector BA3/OC, and the PM walkthrough.
  - Self-registration, QR Introduction, QR sign-in for VeriTrade/Portal, customer app access (xprojman-41).
- **Status:** core app, offline queue, QR sign-in and recovery are done.
- **Last commit:** `c28f035` (2026-09-09): QR sign-in for Portal (xprojman-31), Safety/OHS mockup.
- **Safety tab:** a committed in-memory mockup, deliberately left unwired until a hazards/incidents schema exists.
  That schema needs a Server + Portal + App pass.
- **Next candidates:**
  - Job Award card should show `trade_offered`. Needs a one-line Server add to `/job-awards/pending`; App is logging it in 44.
  - Customer access (41 §1): signed off, no app code yet.
  - S18.14 client final sign-off (v3.4 numbering; 43 §5 and §10 used the old S18.11). Planned in **xprojman-51** (`46aa2a8`). F1, assisted signing on the PM's tablet at handover, is for the **Owner and the solicitor**.
  - Role design (33): waiting on the Owner.
  - Task list / tick screen (29): not verified.
- **Device builds:** the dev rig works. Only App Store / TestFlight distribution needs the Owner's Apple ID.

### 2.3 Portal Dev — `server/portal/`
- **Owns:** the desk surface for PM, Builder, Client (narrow writes) and Accountant:
  - Stages 2–5 confirm-gates, conditions register, response clocks.
  - Stage 6 selections and the Client's first write; Stage 7 release/sign-off.
  - Stages 8–9: certifier, CC checklist, BOQ/tender compare/Job Award, Cost Plan, engagement type,
    subcontractor register/panel.
  - Programme and Gantt/Line-of-Balance, monitoring and variance, Finance.
  - S18.12 accountant gate, client sign-off/handover.
  - Project Definition desk work (processmap A–B).
- **Status:** Builder Console, Programme, Panel/Job Award, Finance/Forecast are built.
- **Also built:** QR login panel (31, `008315e`) and the Finance module (42, `7ecacc4`).
- **Last commit:** `013b6be`.
- **Next, in order** (PM-confirmed 2026-09-30):
  1. Draft the customer pairing contract (41 §1). It's a doc and it unblocks Server and App.
  2. Add `trade_offered` to the subcontractor send form (44).
  3. Builder's subcontractor-engagements list and detail (44).
  4. Consent recording: Documents upload, then POST consent (44).
  5. Defects edit UI. Server's PATCH has been live since `dbaa649`.
  - ✅ Done 2026-09-30: 44 Module C UI `babc051`, Defects edit UI `ea221de`, checklists authoring and review `7521d5a`, Gantt v1 read-only `b6d7846` (parked, not yet checked visually). **Waiting on a real-data test** once the dev API is up: the 44 send and consent flow, defect editing, checklist authoring → App run → Portal review, and Gantt.
  - Now: Safety screens (48) mockup-first, then wired to v048.
  6. **Gantt Scheduler (39 §4). NOT built.** The PM Scheduler tab doesn't exist yet; only the per-stage bars on the Builder Programme page do (`a2287db`). Server's part is done. Read-only first.
  7. Client Invoices UI (after 43).
- **Open drafts waiting on the Owner:** 27, 28, 33, 43.

### 2.4 VeriTrade Dev — `server/veritrade/`
- **Owns:** the public B2B verified-trade product (opt-in, B2B-gated, never a consumer directory; spec §4.2):
  - Teaser and gated profiles, search, App-mediated login, Engage → Introduction.
  - Consuming the S18.16 attestations as Verified Work History.
- **Status:** v1 is built, with the refresh-token fix.
- **Last commits:** `43aba83` and `766a399`. Nothing is uncommitted.
- **The attestation feed is already built** on PM2-02 (v027). VeriTrade needs nothing new from Server for it.
- **Next:** licence verification and B2B billing, parked since 2026-08-06. They need an **Owner scope ruling**, not only a date:
  - **Licence verification:** which state goes first (WA/NSW/VIC/QLD).
  - **B2B billing:** the pricing and tier model.
- ✅ **xprojman-47** (`608ac75`). Recommends **A3** (automate NSW, then QLD; WA manual track with a "staff-checked" badge) and **B2** (search seats bundled in Pro/Enterprise plus a standalone seat plan; publishing is free). ✅ **RULED A3 + B2** (SA, 2026-09-30). Still open for the Owner: seat N, per-user vs per-org, prices, the WA badge, who sends the regulator requests. Licences are stored as `credentials` rows (47 C.2.3).

### 2.5 Product Manager — `product/`
- **Owns:** the public marketing site. Pages: Home, Features, Solutions-by-role, How It Works, VeriTrade,
  Pricing, About, Resources, Contact/Demo, Blog. Also the lead capture to sales@ebizco.com.au, and SEO.
- **Also owns** product messaging that stays true to the spec:
  - VeriTrade is B2B-gated.
  - Honest wording about the evidence needed for payment (p.33).
  - The TAFE/school distribution angle (p.6).
- **Status:** LIVE at projman.ebizco.com.au (PM2 `projman-product`, fork mode).
- **Open:** SMTP credentials, pm2 startup-on-boot, merge to `main`, the domain move to `projman.com.au`.
- **Must not claim features** that aren't built. Check with the PM before publishing capability claims.

### 2.6 Cross-cutting proposals and who leads them
| Item | Lead | Contributors | Status |
|---|---|---|---|
| `processmap.md` (Project Definition A→H) | Portal | Server (schema), App (Stage 1 capture) | Unresolved: redraw, or narrow to the new A–B only |
| `CostCentre.md` (proposed) | Server | Portal | Reconciled in xprojman-42 §7–8: no schema change; overhead as `org_accounts`; Opportunity codes → a separate spec; %-time deferred |
| `18Stage_Tasks.md` task library | Portal | Server (v034 seed) | Built as WA_RESIDENTIAL_18; its codes ≠ the PDF's codes. Keep the mapping explicit |
| `devroadmap.md` §12 open decisions (#2, #3, #8, #9, #11–#19) | PM (tracking) | SA / Owner (ruling) | Open. #14 (is the in-app tap a valid contract) needs a solicitor |

---

## 3. Who to talk to

| You need… | Talk to |
|---|---|
| An endpoint, schema, migration, RBAC permission, sync rule | **Server Dev** (write an xprojman-NN contract) |
| Anything a field user does on a phone, offline capture, QR flows | **App Dev** |
| Desk screens for PM/Builder/Client/Accountant, Gantt/LOB, Finance UI | **Portal Dev** |
| Public profiles, attestation display, B2B search/engage | **VeriTrade Dev** |
| Marketing copy, pricing page, public claims, SEO, lead form | **Product Manager** |
| Priority conflict, sequencing, blocked for more than 1 day, a status doc that disagrees with git | **PM** |
| Architecture or domain-model ruling, a change to a LOCKED spec, a reversal of a model of record | **PM → SA / SA Assistant** |
| Scope, legal, money, credentials/keys (Maps API, Google Console, Apple ID, SMTP), merge to `main`, prod deploy | **PM → Owner** (via SA) |

---

## 4. Decision rights

| Decision | Who decides | How it's recorded |
|---|---|---|
| Technical contract between two teams | The two team leads | xprojman-NN, with "§N Response — Agent (date)" |
| Priority, sequencing, deadlines, who picks up an orphan item | PM | group-NN |
| Architecture, data model, anything contradicting the 18-Stage spec or a LOCKED spec | SA (SA Assistant prepares) | xprojman-NN, "SA ruling" section |
| Scope, policy, legal, pricing, spend, credentials, prod domains, merge to `main` | Owner | Owner sign-off line in the doc |

Standing rules, which carry over and are not new:
- **Spec before code.** Draft the contract, show the forks with a recommendation, then wait for sign-off.
  Exception: a contract that is complete and has no open decision can be built directly.
- **Verify against git.** Treat any status claim, including one in this file, as a hypothesis until
  `git log` confirms it.
- **Shared working tree.** Run `git status` before committing. Stage only your own paths; never `git add -A`.
- **Never kill or restart the shared MQTT broker** (1883/9001). It carries real hardware.
- **Mockup before wiring** for new UI.

---

## 5. Communication protocol

1. **Session start:** state "I am [Role], memory ID [ID]", then read this file, the latest `group-NN.md` and your memory.
2. **Register your session.** Send the PM your session name (what `ListAgents` shows, e.g. `projman2-a2`). The
   PM records it in §1. Re-send it after every restart, because session names change.
3. **Messaging:** use `SendMessage` to the session name for pings, questions and hand-offs. Anything that is a
   **decision or a contract goes in a doc**. Messages are for pointers, not for the record.
4. **Status report** (template in `projman-roles.md` §8): send a short version to the PM on request, and a full
   one weekly, due Friday 17:00 AEST. The PM compiles them into `group-NN.md`.
5. **Blockers:** tell the PM the same day, naming what you need, from whom, and by when.
6. **New xprojman numbers:** `ls docs/decisions/` immediately before creating, create with noclobber (`set -o noclobber`, or check that the file doesn't exist), and commit the new file straight away. On 2026-09-30 App overwrote Product's brand-new xprojman-53; it was restored from git.

---

### 5.1 Lab servers and session lifecycle (Owner ruling 2026-10-14)

The **PM runs the lab** with `server/lab.sh`. The lab is api :5100, dashboard :5101, portal :5102 and veritrade :5103, on this Mac at 10.1.1.42.
- The shared MQTT broker (1883/9001) and MySQL (3306) are only checked, never started or stopped.
- Server Dev keeps code, migrations and schema. Leads ask the PM for any start, stop or restart and never kill lab ports themselves.
- **Start:** the PM runs a roll-call (§5 step 2), runs `lab.sh start`, and pings each lead that the lab is up, along with its queue.
- **Shutdown** (laptop restart, a break, or the Owner says "close down"): the PM tells every lead to stop at a clean point, commit its own lane (no pushes) and save its memory. Once all have acked, the PM runs `lab.sh stop` and reports to the Owner.
- ⚠ The lab API sends **real** email and SMS. Use existing test accounts only.
- **Test devices are shared with other projects.** ProjMan2 app deploys go ONLY to the vphan iPhone 12 Pro Max and Vince's iPad (Owner, 2026-10-14).

## 6. PM open items (first pass, 2026-09-30)

1. Roll-call: collect session names and a current status from all five leads and SA/SA Assistant.
2. Branch hygiene: all lanes commit to `server/p5-site-ops`, nothing has been committed since 2026-09-16, and there is a large
   uncommitted `docs/` change set (deleted `development*.md`, new `devroadmap`, `processmap`, `CostCentre`
   …). The owner of that change set and its commit plan are still to be established.
3. Owner sign-off queue: xprojman-27, 28, 33. **43 is APPROVED** (§8 #5). New: 50 F6/F11 (SA) and 51 F1 (Owner).
4. **Owner credentials queue:**
   - `GOOGLE_MAPS_API_KEY` (40)
   - Google Console origins (31)
   - Apple ID for App Store/TestFlight (App)
   - SMTP creds (Product). Since the 2026-09-16 go-live, leads are only logged, not emailed.
   - pm2 startup-on-boot on auzora01, which needs the Owner's terminal.
   - B2 pricing: Owner sign-off, seat N, per-user vs per-org seats (xprojman-47).
   - **OS push** (FCM + APNs): the Owner's Apple ID, a Firebase project, and a Server device-token table. Added to the backlog 2026-09-30. Email covers v1 alerts until then.
   - **API.NSW account registration** (xprojman-49 G1). This gates the NSW licence-check build.
   - **Microsoft and Facebook OAuth app registrations**, if customers are to use them (xprojman-50 F2). Only Google is live in the App.
   - **OS push (xprojman-54 §6):** confirm Apple Developer team QWRPRU9SE5 is a paid membership, upload the APNs .p8 key to Firebase `projman-f4bca`, enable Push on the App ID, issue a Firebase service-account key for the server only, and confirm the prod MQTT credentials and ACLs.
   - **A real support contact** (email or phone) for the xprojman-50 `ACCOUNT_EXISTS` "contact support" message. Owner or Product.
   - xprojman-49 **F3** (show disciplinary history? VeriTrade recommends badge only in v1) and **F4** (never store date of birth or address).
   - xprojman-49 **F2**, identity strength: App found a name-edit bypass, now guarded in `87a351b` (a mismatch can only be cleared by staff; a match within 30 days of a name change goes to staff). Residual risk: signing up under another person's name from day one. **PM recommends accepting it for v1.**
5. Stale docs to retire or refresh: `README.md` (says "no code yet"), `MEMORY.md` (root, 2026-07-22),
   `projman-roles.md` roster (§1 and §9 replaced by this file).
6. xprojman-28 Server endpoints: the defects PATCH and the project-scoped documents list are both built (`dbaa649`). The checklist-template schema and the Safety/OHS schema are still not built; **Server will lead both proposal passes.**
9. **Unpushed commits:** Server `10bb83e`, `ce5a016`, `196ff43` and `bbc1b39`, App `5634003` and `dc8590a`, VeriTrade `608ac75`.
11. ✅ **Resolved**: Server resumed on the Owner's go-ahead. Config committed (`a35e75c`), JWT kept at 15m, and the routed-around commits were confirmed accurate (`6eb1b04`). Previously: **Server session is PAUSED by its own permission check.** Two actions were refused: the `JobAwardService.respond` edit (xprojman-45 B) and committing the ruling lines in xprojman-45/46. Server has escalated to the Owner. Uncommitted and untested: the gate code in `StageProgressionService.js` and `migration_v046_programme_activation.sql`. **No other agent does this work for Server.** It resumes only on the Owner's decision. **Owner to review:** two commits carry Server-paused content that other lanes committed for it. `c390c0d` (VeriTrade) holds Server's xprojman-49 review in §7.1. `15f965c` (App) holds Server's N/A photo answer and the SA F3 ruling section in xprojman-46. Both lanes have been told to stop. Revert or keep is the Owner's call.
13. **Portal session is PAUSED by its own safeguards.** It won't take peer-directed work without its user's go-ahead. The pairing contract (41 §1), the 46 §7 reply, the 48 §8 reply and the task-code map (#9) all wait on the **Owner approving them in the Portal session**. Portal's research for the pairing contract, recorded for whoever drafts it:
   - The client scope fails closed.
   - The client role is not assignable or pairable.
   - `users.email` is globally unique and each user belongs to one org, so a customer who already has an account in another org can't be paired.
   - There is no SMS login.
   - A first OAuth sign-in creates a PM in a new org.
   - `customers` has no `user_id` column.
14. **Migration number collision.** Server's paused draft `migration_v046_programme_activation.sql` (45 B), xprojman-46's DDL (checklists) and Portal's pairing work all assume **v046**. Server assigns the numbers when it resumes; nobody else claims one.
15. ✅ **Fixed** in `d71b702` (MySQL session and process TZ pinned to +08:00; system settings untouched). **Environment: timezone drift.** This host is now on AEST, while the API assumes Perth (+08:00), so pairing codes expire as soon as they are issued. About 15 test files fail, and dev-API device pairing is probably broken too. Server is fixing it inside the API (pin the process TZ or compare in UTC), not by changing the system TZ.
16. **Public claims ahead of the build.** The live site claims "Safety & OHS … incident reporting, hazard register" and "National Construction Code compliance". Product is drafting a line-by-line copy audit for Owner sign-off.
17. 🔴 **P0: the public contact emails bounce.** `product/lib/data.ts:11-12` uses `hello@` and `support@projman.com.au`. projman.com.au has **no NS, MX or A records** (PM checked with dig on 2026-09-30), and these addresses appear on /contact, the demo mailto and the legal pages, including security reports. `ebizco.com.au` has an A record but no MX, so the Owner must test-send before relying on `sales@ebizco.com.au`. **The Owner names a working address; Product hot-fixes it.**
18. **xprojman-53 (Product) is the site copy audit** awaiting the Owner's line-by-line sign-off. 13 of 21 advertised modules are not built. "NCC compliance" appears site-wide. Evidence claims are overstated. There are commercial claims with no backing (prorated billing, SLA, a trust strip, testimonials). Forks F1/F2/F3.
19. **Handover #9 done** (`b43db9d`). The billing-milestone codes don't match v3.4: Deposit S9.8→S9.9, Base S12.10 missing, Frame S13.10→S13.11, Completion S18.12→S18.15. **This affects the xprojman-43 triggers.** Q1 (S8.8 as a hold point?) goes to the SA; Q2/Q4/Q5 to Server.
12. **Push and deploy is an Owner action.** 18 local commits are not on origin, and auzora01 pulls from origin. Product's live-copy fix (`cb7c0ea`) is committed but not live until the Owner pushes and runs the deploy.
10. **Live public-claim conflict:** `product/lib/data.ts:462` sells "VeriTrade publishing" as a paid Pro feature, but the spec says the supply side is free. ✅ SA approved the minimal fix now (delete :462, trim :457); Product is deploying.
7. **Unowned uncommitted change set.** It is dated 2026-09-03 and neither Portal nor VeriTrade claims it. Files:
   - `server/{portal,veritrade}/next.config.js` (API_URL taken from shared constants) and both `.env.production.example`
   - `server/api/.env.*.example`
   - `server/api/src/config.js`: JWT default 15m → 45m
   - `.gitignore`

   The `projects.js` enum part was committed by Server in `10bb83e`. Server claims the `server/api` config/.env parts and will confirm with the Owner. The Portal/VeriTrade `next.config.js`, the `.env.production.example` files and `.gitignore` are still unowned; they look like the Owner's shared-constants change.
8. Merge `server/p5-site-ops` → `main` is an Owner call, and it is required before `product/` can live on `main`.

## 7. Handover backlog from the retired PM (received 2026-09-30, checked against git the same day)

| # | Item | Owner | Pri | Verified state 2026-09-30 |
|---|---|---|---|---|
| 1 | Portal batch commit + push | Portal + Server | P0 | ✅ **CLOSED.** Local = `origin/server/p5-site-ops` (0 ahead / 0 behind); tip `53a097f`. |
| 2 | App commit (xprojman-41 §11) | App | P0 | ✅ **CLOSED.** §11 is committed; `app/` is clean (App roll-call). |
| 3 | Product commit (Next.js 16) | Product | P0 | ✅ **CLOSED.** `f8b8bbe`; `product/` is clean. |
| 4 | xprojman-43 Client Billing review + build | Server + Portal (+ App S18.14) | P1 | ✅ **APPROVED** (§8 #5). Server builds Steps 1–2 after the gate. S18.14 sign-off plan is in xprojman-51. |
| 5 | Customer pairing contract (xprojman-41 §1; the handover calls it "43 v1") | Portal (author) → Server/App | P1 | 🔴 Not written. §0.1 is signed off; there is no app code. **Portal to draft.** |
| 6 | Documents UI / Defects management / Gantt Scheduler | Portal | P1 | Documents UI ✅ `9180249`; LOB programme ✅ `a2287db`; Defects edit UI ⏳ queued (the Server PATCH is live, `dbaa649`); Gantt (39 §4) ❌ not built, queued (Portal #6). |
| 7 | S9.10 seeding vs `instantiateProgramme` mismatch | Server | **P1** | ✅ **BUILT** `37982e5` (v046; 763/763 checks green). Written up in **xprojman-45 §1** (`196ff43`). ✅ **RULED B** (SA, 2026-09-30): keep stamping all 18 stages, and gate the start of Stage ≥10 on an accepted Builder Job Award, on both the REST and sync paths. Server is building it. |
| 8 | Stage patch build status: S10.5 / S11.9 / S12.8-9 / jurisdiction field | Server | P2 | ✅ Audited in **xprojman-45 §2**. S1.3, S17.2 and S18.11/12 are built. S10.5, S11.9, S12.8/9 and S16.7 are partly built. Five follow-ups (§2.1): (1) `projects.site_state`, which is also open in xprojman-43; (2) the state-to-certificate table; (3) task-library code re-map, which merges with #9 (Portal lead, Server re-seed); (4) the S2.4 hazard-audit module; (5) optionally making S11.9 blocking. |
| 9 | ✅ `b43db9d`: `18Stage_Tasks.md` S1.1 refers to the retracted `project_briefs`, plus the library/PDF code re-map (xprojman-45 §2.1 #3) | Portal lead, Server re-seed | P2 | Open. The code mismatch affects S10.5 and S18.11–16. The xprojman-43 S18.14 sign-off work must not rely on the library codes. |
| 10 | Safety/OHS (hazards/incidents) schema | Server lead + Portal + App | P2 | Unscoped. App mockup is ready; needs a contract. |
| 11 | Consolidate the legal-confirmation list (in-app tap = contract, cost-plus disclosure, recording consent, defect liability, devroadmap §12 #14) | PM + Owner | P2 | PM to draft one list for Owner/solicitor. |
| 12 | `JWT_EXPIRES_IN` 15m → 45m (uncommitted in `server/api/src/config.js`) | Owner | P3 | Owner ruling: commit or revert. |
| 13 | Port-hardcoding memory fix propagation | All agents | P3 | Relates to the uncommitted shared-constants set in §6 #7. Each agent should check that its memory uses `server/shared/constants.js` ports (5100–5105). |

## 8. SA rulings on the PM's recommendations (2026-09-30)

| # | Ruling |
|---|---|
| 1 | ✅ Done. The Owner told the Server and Portal sessions to accept PM-routed work under this doc. |
| 2 | Keep `c390c0d` and `15f965c`. Server reviews them and confirms or corrects in its own docs. No lane commits for another lane again. |
| 3 | The Owner pushes `server/p5-site-ops` to origin, then deploys `product/` on auzora01. |
| 4 | Server commits the shared-constants config set (Portal/VeriTrade `next.config.js`, `.env.production.example`, `.gitignore`, api `.env` examples). `JWT_EXPIRES_IN` is **reverted to 15m**. |
| 5 | xprojman-43 is **approved**, with `projects.site_state` (falling back to `organisations.state`). This also fixes xprojman-45 §2 S16.7/S17.2. |
| 6 | B2 seats are a **per-org pool, 3 included in Professional**, with Enterprise negotiated. Public copy: "includes 3 VeriTrade search seats". No prices yet. |
| 6a | ✅ xprojman-47 leftovers, **ruled by the Owner directly** (`9e343ee`): (i) the WA staff-checked badge is approved, with the WA manual track built only after NSW and QLD are live; (ii) the VIC (BPC) and WA (Building and Energy) data-request letters were **SENT by the Owner on 2026-09-30**; VeriTrade tracks the replies. 47 is fully RULED. |
| 7 | xprojman-49 rulings: **G1**, the Owner registers the API.NSW account. **F2**, accept the name match plus the `87a351b` guards for v1, recording the residual risk. **F3**, badge only. **F4**, never store date of birth or address. |
| 8 | Customer pairing v1 covers customers with **no existing account only**. An existing account in another org gets "contact support". Multi-org membership is out of scope. |
| 9 | Migration numbers (Server assigns them): **v046** Builder gate (45 B), **v047** checklists (46), **v048** Safety (48), then `site_state`/billing (43), pairing (41 §1) and licences (49) in build order. |
| 10 | App deploys the Checklists mockup to the iPad for an Owner walkthrough. |
| 11 | Credential order: SMTP, API.NSW, Google Maps key, Google Console origins, pm2 startup, then Apple ID/Firebase (with the Safety build). |
| 12 | Merge to `main` after the push and after the Builder gate lands. Target end of next week (≈2026-10-09). |
| 13 | PM drafts the consolidated legal list for the Owner's solicitor this week. It now includes xprojman-51 F1 (assisted client signing on the PM's tablet), which is the same question as devroadmap #14. |

© eBizco Australia Pty Ltd — xprojman-roles.md, 2026-09-30

