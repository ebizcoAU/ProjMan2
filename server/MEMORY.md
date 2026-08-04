# ProjMan2 Server — Session Handoff (read this first)

You are the **server dev (NexusPM)** for ProjMan2 — an Australian building &
construction project-management platform. You own **`server/api`** (Node/Express +
MySQL). A separate **app team** owns the Flutter app (`app/`) and the contract docs.
This file is what a fresh session (after `/clear`) reads to resume.

**★ ONE-LINE STATUS (2026-08-05, branch `server/p5-site-ops`):** migrations **v026**, matrix
**v12**, **393 tests green across 16 suites** (throwaway :4199 → `c1projman2_e2e`). Dev DB
`c1projman2` migrated to v026 and **:4100 restarted on matrix v12**. Since the last header:
**P7 Commercial complete (a/b/c)**; **P8 Accounting COMPLETE (a/b/c)** — `DepreciationService`
(fixed assets + S18.11 draft / S18.12 `tax.approve`), `TaxService` (GST/BAS prepare-lodge-export),
`TparService` (TPAR) under org-level `/accounts/{bas,tpar,depreciation}`; **Documents/Upload module
shipped** (`/documents`, xprojman-21/23 — the app built their offline queue on it and confirmed the
contract in xprojman-24); decisions **#17** (asset entry = explicit create), **#18**
(`accounts.read` added to `OWNER_CAPABILITIES` so a Builder-FOUNDER sees their own books),
**#19** (`documents.read` → builder, engaged jobs only). NEW DEP: **multer**. Still open: Xero/MYOB
sync deferred (#6); P9 payroll and the Portal Dashboard both unstarted.

**TWO SEPARATE WEB APPS (split 2026-07-31, owner-directed; previously one mixed `dashboard/`):**
- **`server/portal`** (port **4220**, `projman2-portal`) = the tenant PORTAL — app-users only,
  the app's desktop companion (projects, cost plan, claims, job-award inbox, signup, org admin).
  Each app user sees only their own data (org isolation + role scope). NO admin surface, NO
  `adminApi`. This is where all the P7/console UI work now lives.
- **`server/dashboard`** (port **4110**, `projman2-platform`) = ProjMan PLATFORM MANAGEMENT —
  internal admin/support only (`/admin/*`: accounts, subscriptions, billing, device/login health).
  ZERO app-user content (AdminService boundary-tested). Root → `/admin/login`. **INTERIM — to be
  REPLACED by porting the Nexus dashboard later ("we don't build from scratch").**
- Both are Next.js, both proxy `/api` → the API (:4100); the split is frontend-only, one JWT/auth.
  Both `next build` clean; portal verified listening on 4220. **Split is UNCOMMITTED.**
- FUTURE (not built): Support→Portal access requires the app user's in-app APPROVAL (a consent
  handshake). No support-into-tenant path exists today (by design).
- **PORTAL GOOGLE LOGIN added 2026-07-31** (a Google-app-signup user has no password → couldn't
  reach the Portal). `authApi.oauth(provider,token)` → `POST /auth/oauth/:provider` (server already
  verified Google ID tokens, migration_v002). Login page: real **GIS** button when
  `NEXT_PUBLIC_GOOGLE_CLIENT_ID` set (must be one of server GOOGLE_CLIENT_IDS — 3 already
  configured); **dev fallback** sends `dev:google:<email>:<name>` (OAUTH_DEV_BYPASS on) → server
  matches SAME user by sub/email. Verified: app-Google-signup then Portal-Google-login = same user.
  `next build` clean. Files: `portal/src/lib/api.js`, `portal/src/app/login/page.js`. UNCOMMITTED.
  For prod: set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web) in portal env.

**One-line status (2026-07-31 — `server/p5-site-ops` synced at `22c94b7`+; migrations at **v021**
(dev DB applied; v020=builder+projects.write matrix v8; v021=P7c Variations/Contracts matrix
**v9**); **255 tests green** across 12 suites (access 30, procurement 18, variations 9); staging
`c1projman2_staging` @ v017; **E2E DB `c1projman2_e2e` @ v021** (for app live-E2E, isolated from
:4100). **P7b COMMITTED+PUSHED (dc9a196). P7c + projects.write (v020/v021) + xprojman-18 answers
(Q1-Q4) UNCOMMITTED. Purged E2E test data off :4100 dev DB (93 rows, 3 orgs).** **Portal Cost Plan tab WIRED to P7a+P7b reads
2026-07-31 (dashboard, UNCOMMITTED, `next build` clean): now DERIVED read-only roll-ups
(was wrongly hand-editable — violated xprojman-10 §5) + drill-downs into estimate lines / POs
/ supplier invoices / progress claims; engagement-mode redaction shows through (Builder rows
absent for PM under independent_fixed; [redacted] pill for cost_plus consent). Files:
`dashboard/src/app/(console)/projects/[id]/cost-plan/page.js`, `dashboard/src/lib/api.js`.
COMMITTED 22c94b7 (Cost Plan tab + commercial/jobAwards/register API surface).**
**Portal VISIBILITY modules built 2026-07-31 (Manager directive; `next build` clean, UNCOMMITTED):
(1) Job Award Inbox `/job-awards` (console) — GET /job-awards/pending + Accept/Decline, PortalNav
entry; (2) Self-Registration `/signup` (public, spec §2 route) — founds org w/ role builder|PM,
shows isOrgOwner; login links to it; (3) Progress Claims tab `/projects/[id]/claims` — Builder
submit / PM approve-decline-pay, gated on /auth/permissions. Files: `(console)/job-awards/page.js`,
`signup/page.js`, `(console)/projects/[id]/claims/page.js` (new) + `_ProjectTabs.js`, `login/page.js`,
`components/portal/PortalNav.js` (mod). NOT browser-confirmed (no browser tool).**
**⚠ TWO FLAGS RAISED (need owner): (A) SPEC CONFLICT — portaldesignspec §1.4/§3.1 says under
independent_fixed the PM SHOULD SEE the Builder's subcontractor register (who/committed/owed) for
step-in rights (hiding only margins/rates), but P7b (built to serverdesignspec §7.2.1) HIDES the
Builder's PO/invoice rows entirely from PM. One spec is stale — needs reconcile before trusting the
Cost Plan tab under independent_fixed. (B) xprojman-17 (App, 2026-07-31) 4 asks: Q1 should builder
get projects.write (self-reg builder can't create projects); Q2 self-reg builder (own org) can't be
cross-org introduced/awarded in v1 → Job Award Inbox empty for them (cross-org=PM2-02?); Q3 docs/
upload module shape; Q4 throwaway E2E target + :4100 has E2E-Inbox pollution to purge. Q1/Q2 = owner
calls; Q3/Q4 = mine to answer.**
DONE since v011: DIRECTIVE 1 (v012-v016) + intro QR + Portal Field/Team surface + SELF_AWARD
guard + **P7a Commercial (Cost Plan + Progress Claims, v017)** + **`GET /job-awards/pending`
inbox** (xprojman-11/12) + **Fork A Self-Registration** (xprojman-13/14, v018 — `user.role` on
`/auth/register` w/ allow-list {projectManager,builder,developer} + `422
ROLE_NOT_SELF_REGISTRABLE`; org-admin DECOUPLED from role via `users.is_org_owner` conferring
org/users/devices.manage on a founder; last-admin guards + pairing/oauth gates made
flag-aware). **COMMITTED + PUSHED 2026-07-30 (commit 21be2cb, `server/p5-site-ops` synced
to origin — job-awards inbox + Fork A together, 12 files; SELF_AWARD guard was already in
e802035).** Self-Registration→Introduction→Job Award primitive now has all 3 legs. IDENTITY = single fixed role (xprojman-08/09); the multi-role/active-role detour
(xprojman-05/06/07) was REVERSED — do not resurrect. NEXT: **P7b Procurement**, then P7c
Variations. Step E blocked on PM2-02. The blocks below supersede the older v011/8-suite
figures in this paragraph.):** Phase 1 + AU sign-in · **portal** (`server/dashboard`:
login + Devices + Projects + Programme + **Cost Plan** + **Admin** Users/Settings/Audit
— built 2026-07-24, endpoints verified) · **construction core** (v003) ·
**access-control 6-ROLE model** (v004+v005) · **§10 per-op ownership** (app CREATEs
projects/customers offline; creator auto-enrolled) · **18-STAGE ENGINE BUILT** (v006:
StageProgressionService + StageTemplateService + stageHooks; gate on REST **and**
sync-push; WA_RESIDENTIAL_18 seeded, hold points 11/12/13/15/18; inspector-only
validation; stage cost cols estimated/committed/actual/claimed money-redacted) ·
**SITE OPS BUILT** (v008: SiteOpsService — diary append-only/versioned, geofenced
attendance, deliveries) · **QUALITY P6a BUILT** (v009: InspectionService — a hold-point
inspection pass drives is_validated via the EXISTING §10.5 validate gate;
QualityOpsService — quality.write gate + defect provenance stamping; matrix_version→4)
· **COMPLIANCE P6b BUILT** (v010: ComplianceService.checkNccCompliance/
checkStructuralCompliance wired into StageProgressionService.checkTransition — no
separate sync wiring needed, that function already runs on both REST+sync; ncc_register
rides sync-push like defects; cpc_units/cpc_feature_map seeded) · **PORTAL QUALITY TAB
BUILT** (`/projects/[id]/quality`, read-only, no new endpoints) · **ADMIN-TEAM ROLES
BUILT** (v011: `platform_admins.admin_role` admin/account/staff, `requireAdminRole`
per-route gates in `routes/admin.js`, `GET /admin/me`; seed via
`scripts/seed-admin-team.js` — admin@projman.internal / accountx@projman.internal /
staffx@projman.internal, all `Passwd@1234`). **Refined same day**: `GET /admin/users`
(the full cross-tenant directory) narrowed to `admin`-only — `account`/`staff` keep
the suspend/reactivate/force-logout ACTION via a paste-the-id form
(`admin/users/page.js`), no browse/search — **Dashboard must never expose tenant/App
user data to a non-admin platform role**, reiterated by the owner, see the
`projman2-admin-privacy-rule` cross-session memory. **Portal and Dashboard are fully
split, on purpose** — a shared-nav-shell merge was tried and reverted same day (owner:
"too crowded"), then explicitly reinforced ("Portal should have nothing to do with
admin/account/staff of the Platform Management Team"): `PortalNav.js`/
`(console)/layout.js` carry ZERO reference to `admin_role`/`adminApi` (verified by
grep); `admin/layout.js` has its own separate hand-rolled sidebar; **System Admin has
its own entry point, `/admin/login`** (`admin/login/page.js`) — a different front
door onto the SAME identity/auth as the app and the tenant Portal (one JWT, one
`POST /auth/login`, not a second auth system), landing on `/admin` and confirming a
`platform_admins` row before entering.
All 8 suites green: isolation 16 · domain 29 · access 19 · stages 15 · admin 18 ·
siteops 28 · quality 19 · compliance 18 (run
`DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js`). Dashboard now on **:4110**
(was :3100), branded "ProjMan" not "ProjMan2" in visible UI text. Migrations at **v011**.
**App-team progress board = `docs/decisions/projman-04.md`** — keep updated.

**DIRECTIVE 1 — CORRECTIVE MIGRATION BUILT + VERIFIED (2026-07-28, migrations v012–v016,
NOT yet committed).** Manager's corrective build off the `xprojman-01.md` assessment,
against the revised spec set (`servdesignspecification.md` §7.2/§7.3, `devroadmap.md`).
All 9 suites green (191 tests, throwaway :4199): isolation 16 · domain 29 · access 19 ·
stages 17 · admin 18 · siteops 28 · quality 19 · compliance 18 · **directive1 27** (new).
- **Step A (v012):** +roles `builder`(pair_rank 35)/`developer`/`accountant`; split
  `progress.write`→`progress.tick`+`progress.verify` (wired to **`tasks`**, previously
  UNGUARDED — the stage-advance `progress.write`/`StageProgressionService` gate is
  untouched); +`tax.approve`/`development.read`/`panel.manage`; protected
  `tasks.verified_by`/`verified_at`; **matrix_version→5**; `builder` is a 6th pairable
  field role. `accountant.scope_class='assigned'` NOT spec's literal `engagement` (that
  fails closed until PM2-02 lands — documented in the migration header).
- **Step A code:** `TaskProgressService` (tick-then-verify: `guardPush` needs
  `progress.tick` only when `completion` changes — a create at `completion:0` is NOT a
  tick; `verify()` is the server-mediated action stamping the protected pair). Query-time
  money redaction for `independent_fixed` engagement in `ProjectService.redactStage` +
  `SyncService.pullDeltas`. `programme.write` stage-range scoping (`assertProgrammeWriteScope`:
  PM Stages 1–8, accepted Builder 9–18).
- **Step B (v013):** `introductions` + `job_awards` + `project_payments` (minimal
  TPAR-relevant). `IntroductionService` (idempotent QR swap, peer-to-peer, no panel.manage)
  + `JobAwardService` (create needs `panel.manage` + a pre-existing introduction — the
  cold-stranger constraint; `respond` only by the invitee, accept auto-enrols;
  `recordDeposit` = S9.9 binding event, idempotent). Routes on `projects.js` +
  `routes/introductions.js` (mounted `/api/v1/introductions`).
- **Step A2 (v014):** `subcontractor_engagements` (`subcontractor_pass_through_consent`
  DEFAULT FALSE, `consent_recorded_at`/`consent_document_id`). `builder_engagement_type`
  set once at S9.6 on the job award.
- **Step D (v015):** `DELETE /organisation/users/:id` = **deactivate not erase**
  (`deactivated_at`, status disabled, mobile purged, sessions revoked, evidence retained;
  last-admin protected; idempotent `ALREADY_DEACTIVATED`).
- **Step D2 (v016):** `hold_point_requirements` (checklist per stage, `required_role`/
  `inspection_type`/`jurisdiction`/`blocks_progress`) + `modular_units`. `HoldPointService`
  seeds concrete rows per stage (S10.5 survey set-out=blocking siteSupervisor; S11.9 three
  non-blocking; S12 two non-blocking; S16/S17 jurisdiction; S18.12 accountant-blocking).
  Additive: `allBlockingSatisfied()` is a NEW gate in `StageProgressionService` alongside
  the untouched `is_hold_point`/`is_validated` check; `satisfy()` checks the row's own
  required authority (PERMISSION_BY_ROLE map). `modular_units` seeded at project create
  from `unit_count`.
- **Step E (VeriTrade login endpoints): NOT DONE — blocked on PM2-02** per the directive.
- Test updates for the new Stage-10 blocking gate: `stages.test.js`/`quality.test.js` now
  pair a siteSupervisor early and satisfy S10.5 before completing Stage 10; `access.test.js`
  matrixVersion 4→5 and pairableRoles 5→6.
- **Introduction contract reconciled with the App Team** (xprojman-03 §A → my xprojman-04):
  their invented `POST /introductions/code` + `/scan` + `GET /introductions` QR shape was
  correct; my `POST /introductions {user_id}` was **removed** (a raw create-by-id defeats
  the cold-stranger guard). Now a stateless signed code (5-min JWT, no new migration):
  `IntroductionService.issueCode/scanCode/listContacts`; scan is the only create path. App
  must confirm its scan body key is `code`. directive1 now 30 checks (194 total, all green).

**COMMITTED + PUSHED + STAGING MIGRATED (2026-07-28), per PM directive:**
- `10295e2` server: DIRECTIVE 1 (v012–v016) + intro QR contract (24 files).
- `3aa4095` dashboard: **Portal Field/Team test surface** — new tab `/projects/[id]/field`
  (stages+hold-point checklists with Satisfy, tasks tick→verify with Verify, "Live" 8s
  auto-refresh, action buttons gated on the operator's real permissions). Reads reuse
  `GET /projects/:id`; writes = `fieldApi` (holdPoints/satisfyHoldPoint/verifyTask). Route
  hot-compiles clean; **not browser-confirmed** (no browser tool this session).
- **PUSHED**: branch `server/p5-site-ops` now on origin (first push of the whole arc;
  upstream tracked). Carried the prior unpushed stack too (d03f822 P6, 6cfbdfe P5, plus an
  app commit 6fce9dc in the ancestry).
- **STAGING**: no remote staging box exists (projman-05.md's staging was never real — twice
  flagged). Provisioned + migrated `c1projman2_staging` on localhost to v016 via
  `DB_NAME=c1projman2_staging node scripts/migrate.js`; smoke-tested (server on 4201 →
  directive1 30/30). If the app team needs a *remote* staging DB, that host/creds are still
  needed.
- **P7 Commercial started** (estimates/POs/variations/claims). Step E still blocked on PM2-02.

**IDENTITY MODEL + P7a (2026-07-30) — see xprojman-08/09/10 (committed in docs/decisions):**
- **Single fixed role per identity is the MODEL OF RECORD** (xprojman-08 App-authored,
  owner-confirmed; xprojman-09 Server ACK). A multi-role / active-role-at-login /
  per-project-grant direction (xprojman-05→06→07) was proposed, owner briefly said yes, then
  REVERSED (PM+Builder in one identity ⇒ self-award, breaks appointer≠appointed). **Do not
  resurrect.** `v017`/`project_members.role`/`sessions.active_role`/`/auth/active-role` were
  spec-only, never built. Only guard shipped: `SELF_AWARD` (`from_user_id!==to_user_id`) in
  `JobAwardService.create`.
- **P7a Commercial BUILT** (migration v017, commit 4eb3001): `cost_plans`/`estimate_lines`/
  `progress_claims`; `EstimateService` (money.write, rolls up `estimated_amount`, lock/unlock)
  + `ClaimService` (submit→approve→pay; submit runs `stageHooks.assertClaimAllowed` §10.6
  → `CLAIM_BLOCKED`; pay writes `project_payments` progress_claim/TPAR, idempotent; rolls up
  `claimed_amount`). Perms `claims.submit`(builder)/`claims.approve`(PM); estimating uses
  existing `money.write`; **matrix v6**. Routes on `projects.js` (REST, not sync).
  `tests/commercial.test.js` (17). **NEXT P7b Procurement** (suppliers/POs/supplier-invoices,
  wire `deliveries.po_id`/`supplier_id`) then **P7c Variations/Contracts** (Client-portal P10
  dep) — open decisions in xprojman-10 §7 await owner.

**THE ROLE MODEL (authoritative, 2026-07-23):** 6 roles, camelCase, from
`18StageProjectMangementMatrix.md` (NOT development.md §3's retired 12-role model):
`projectManager`(portfolio, top-actor, CREATES projects) · `siteSupervisor`(assigned)
· `foreperson`(assigned) · `tradie`(self) · `inspector`(assigned, quality.validate) ·
`client`(portal, P10, not pairable/assignable). Matrix is DATA (roles/role_permissions
tables, matrix_version=2); enforcement is `requirePermission(...)` + `scopeFilter`;
pairing uses a `pair_rank` ceiling. Registration creates a `projectManager`.

**SYSTEM ADMIN DASHBOARD BUILT** (2026-07-24, migration_v007 + server + UI):
`platform_admins` allowlist (grant via `scripts/grant-platform-admin.js <email>`),
`adminAuthenticate` gate, `AdminService` (cross-tenant stats/accounts/devices/login-log/
orgs/health — ACCOUNT LAYER ONLY, no project/content), `BillingService` (subscriptions
w/ org fallback + revenue + record-payment + change-plan), `lib/geo.js` (GeoLite2 local,
graceful no-DB fallback — set GEOLITE2_DB + `npm i maxmind` to enable), `/api/v1/admin/*`
routes, `audit_log.user_agent` now captured. UI = `/admin/*` route group (Overview,
Accounts, Devices, Orgs, Billing, Login Log w/ CSV). `tests/admin.test.js` 18/18 incl.
boundary proof (no /admin/* leaks project/user content). Tenant org-admin stays in the
PORTAL. **Migrations now at v007.** Billing gateway (Stripe/eWAY) deferred — manual v1.
(2) **Portal/web-console** spec WRITTEN = `docs/portaldesignspecification.md` — ONE
Next.js app (`server/dashboard`) with 4 route groups (console/client/public/admin), NOT
a new app; roles mapped to the 6-role permission model; ⚠ brief re-opens `estimator`
(recommend NO new role — Estimating = money.write-gated module). Buildable-now: Cost
Plan + Admin modules. Awaiting owner review + the estimator call.

**NEXT after those (18-stage engine DONE):** wire event-hook bodies as their services arrive
(`stageHooks` has the points + audit; Stage 1 OCR/email, Stage 13→14 chaining, Stage
18 capitalise/depreciate) · then domain modules in P-order: site ops (P5:
site_diary/attendance-geofenced/deliveries) → quality (P6: inspections/certificates/
defects behind the existing `/validate` gate) → commercial (P7: estimates/POs/
variations/claims; `stageHooks.assertClaimAllowed` stub already there for the payment
freeze). Spec each into servdesignspec first. `estimator` resolved = projectManager
sub-function (owner locked).

---

## 1. How we work (the collaboration model — don't break it)

- **Contract of record = `docs/decisions/projman-01.md`**, maintained by the **app
  team**. When the wire changes, that file changes first, both sides read it, code
  follows. You **propose** server changes there (clearly attributed "Server dev");
  the app team merges after confirming the client can meet them. Don't rewrite
  app-owned sections — add proposals/responses (see how §8.5 and projman-02 §10 were
  added).
- **"Specify, then build."** For anything sizeable, write/agree the spec first. The
  owner reviews design specs before you build (that's why `servdesignspecification.md`
  exists and was approved).
- The owner runs **their own server on `:4100`** to watch debug output. **NEVER kill
  or hijack `:4100`.** For your own verification, boot a throwaway instance on a
  temp port (`PORT=4199 node src/index.js`) and stop only that.

## 2. What is built + verified

- **Phase 1 identity** (migration_v001): register, login, refresh, logout,
  recovery (incl. device-loss), pairing-with-role, devices, sync (push/pull/status),
  organisation + users + audit. Multi-tenant: every query filters on the token's
  `org_id`; `tests/isolation.test.js` = **16/16**.
- **AU sign-in** (migration_v002, projman-01 §1.8/§8.5): `POST /auth/oauth/:provider`
  (Google/Microsoft/Facebook **only** — token-exchange: app runs native SDK, server
  verifies the token), `/auth/onboarding` (state/business_type/gst_registered/abn),
  `/auth/sms/request`+`/verify` (+61 mobile verification). Tables `auth_identities`,
  `sms_verifications`; `users.password_hash` nullable + `onboarding_complete`/
  `mobile_verified`; `organisations.business_type`/`gst_registered`. Dev bypass:
  `OAUTH_DEV_BYPASS=true` accepts `dev:<provider>:<email>:<name>` (dev only).
- **Service layer extracted** (approved Step C): `src/services/SyncService.js`
  (push/pull/status + the three sync rules + org isolation), `src/services/
  AuthService.js` (`startSession` — the single-writer session issue shared by
  password login and OAuth), `src/services/errors.js` (`ServiceError`→HTTP). Routes
  are thin transport. Re-verified after refactor: 16/16 isolation + full OAuth/SMS/
  onboarding + acceptance, no behaviour change.

## 3. Repo map (`server/api`)

```
src/index.js              entry: mounts routes, rate limits, /health
src/config.js             all config from env (jwt, db, oauth, sms, abn, password…)
src/db/pool.js            mysql2 pool (tz +08:00; dateStrings)
src/middleware/auth.js    authenticate + requireRole/requireOrgAdmin/requireFinancial
src/lib/                  tokens, abn, audit, email, sms, oauth, roles  (helpers)
src/services/             SyncService, AuthService, errors  (business logic)
src/sync/registry.js      the sync table registry — ADD A TABLE HERE, not a handler
src/routes/               auth, oauth, recovery, pairing, devices, sync, organisation
mysql/migration_v001_identity.sql · migration_v002_oauth_sms.sql
scripts/migrate.js        forward-only runner (creates c1projman2 + schema_migrations)
tests/isolation.test.js   16/16 tenant-isolation (server acceptance §7)
tests/acceptance.js       the §5 walk-through, prints a transcript
.env                      LOCAL only (gitignored) — has JWT secrets + DB password
README.md                 endpoint list + deviations
```

## 4. The docs (and who owns them)

| Doc | What | Owner |
|---|---|---|
| `docs/decisions/projman-01.md` | **The live wire contract** (endpoints, schema map, sync envelope, ownership matrix, change log). §8.5 + §1.8/1.9 are your OAuth/surfaces additions. | App team |
| `docs/decisions/projman-02.md` | Cross-tenant **engagement + Verified Work History** architecture (APPROVED). **§10 is your response** to the 4 open items (org keys, signature verify, trust-score, revocation). | App team |
| `docs/decisions/projman-03.md` | Frozen **CPC50220** diploma unit list (reference). **§Server realization (R1–R4) is yours**: cpc_units/cpc_feature_map as system-reference tables, NCC + structural completion gates in ComplianceService, scope validation, cpc_evidence deferred to projman-02. | App team |
| `docs/servdesignspecification.md` | **Your** server & web design spec — APPROVED (§8 decisions locked). | You |
| `docs/development.md` (+ development2.md) | Domain framework of record (§5 schema, §12 CPC gaps). | App team |
| `docs/appdesignspecification.md` | App UI design. | App team |

## 5. Run & test

```bash
cd server/api
# .env already exists locally (gitignored). If missing: cp .env.example .env,
#   fill JWT_SECRET/JWT_REFRESH_SECRET (openssl rand -hex 48), and DB_PASSWORD.
#   The dev DB root password is the same one in ~/Documents/Dev/nexus/api/.env.
npm install                     # node_modules is gitignored
npm run db:migrate              # creates/updates c1projman2 (v001 + v002)

# YOUR verification (never touch the owner's :4100):
PORT=4199 node src/index.js &   # throwaway instance
BASE=http://localhost:4199 node tests/isolation.test.js     # expect 16/16
BASE=http://localhost:4199 LOG=<serverlog> node tests/acceptance.js
kill $(lsof -tiTCP:4199 -sTCP:LISTEN)   # stop ONLY your temp instance
```
- **OAuth without real provider apps:** `OAUTH_DEV_BYPASS=true` (already in `.env`),
  send `token: "dev:google:someone@example.com:Their Name"`.
- **There is no committed OAuth test** (it was run from an ephemeral scratchpad).
  If you need one, write `tests/oauth.test.js` using the dev-bypass token.
- **Recovery/SMS codes** print to the server console in dev (email/SMS disabled).

## 6. Open decisions / immediate next actions

1. **ACCESS-CONTROL REDESIGN — design WRITTEN, awaiting owner approval.** Full
   spec: `docs/servdesignspecification.md` **§9** (permission catalogue, roles ×
   permissions matrix §9.5, scope classes portfolio/assigned/self/engagement/portal,
   `project_members` + scoped pull/push + `requiresFullSync`-on-membership-change,
   roles-as-data migration v004, `GET /auth/permissions`, migration path §9.8).
   Contract side: projman-01 **§9.5** (accepts the app team's §9 role ask through
   this layer; `inspector` currently 422s; camelCase names are display-only —
   snake_case on the wire) + change-log row. **Owner must approve §9 and answer
   §9.9 (strict assigned scope? membership UI web-only v1? inspector C2 path now?)
   before ANY v004 code.** Build order once approved is at the §9 review ask.
2. **projman-01 §2.2a** — construction core built (v003); awaiting app-team
   row-by-row confirm (contact split, financial-redaction rule, stage split-by-field).
3. **projman-01 §9** — role model v2 ask: fold into item 1's spec (additive roles +
   assignability gate + customer-never-pairable all become matrix rows).
4. **Engagement mechanics (projman-02):** unchanged — `engagements`/`identities`/
   `attestations` land with the domain tables; §10 decisions stand (Ed25519 org
   issuer key server-held+encrypted; device key app-generated/public-only; on-demand
   trust score + 24h cache; revocation = stop-serving + session-invalidate +
   tombstone).

## 7. Conventions & traps (the ones that bite)

- **`org_id` comes from the token, NEVER a request body.** It's in the sync
  `PROTECTED_COLUMNS`. This is the whole multi-tenant guarantee — `isolation.test.js`
  proves it. Don't add an endpoint that takes an org from the caller.
- **`/sync/pull` stays generic — NO per-table pull-column allowlist.** The client
  filters unknown columns (its `filterToTableColumns`, symmetric to projman-01 §3.4).
  Decision locked; don't "helpfully" re-add an allowlist.
- **Sync cursor is server epoch-ms** (`UNIX_TIMESTAMP`), timezone-independent — do not
  revert to comparing DATETIME strings (that trap cost Nexus days; see SyncService).
- **Single-writer per entity** (ftpos XF-27): one authoritative session per user may
  push; others handoff. Ownership matrix in projman-01 §4.
- **No cross-org / project-scoped endpoints until projman-02 is BUILT** (it's only
  written). Intra-org pairing (`/pairing/*`) is fine and exists.
- **Pull strips `password_hash` + `server_updated_at`** from `data` — keep it.
- **`.env` is gitignored** — never commit secrets. Legacy ProjMan leaked live creds;
  don't repeat it.
- **Nexus source to port from:** `~/Documents/Dev/nexus/api` (server) and
  `~/Documents/Dev/nexus/dashboard` (web). MQTT is dropped — ProjMan2 polls.

## 8. Also in your ~/.claude memory (auto-recalled)

`projman2-server-phase1` · `projman2-sync-pull-generic` · `projman2-cpc50220-domain`.
This file is the fuller repo-local version; those are the cross-session index.
