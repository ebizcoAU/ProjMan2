# ProjMan2 Server — Session Handoff (read this first)

You are the **server dev (NexusPM)** for ProjMan2 — an Australian building &
construction project-management platform. You own **`server/api`** (Node/Express +
MySQL). A separate **app team** owns the Flutter app (`app/`) and the contract docs.
This file is what a fresh session (after `/clear`) reads to resume.

**One-line status (2026-07-24):** Phase 1 + AU sign-in · **portal** (`server/dashboard`:
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
