# ProjMan2 Server — Session Handoff (read this first)

You are the **server dev (NexusPM)** for ProjMan2 — an Australian building &
construction project-management platform. You own **`server/api`** (Node/Express +
MySQL). A separate **app team** owns the Flutter app (`app/`) and the contract docs.
This file is what a fresh session (after `/clear`) reads to resume.

**One-line status (2026-07-22):** Phase 1 identity + the AU sign-in surface (OAuth/
SMS/onboarding) are **built and verified**; the service layer is **extracted**. Next
build is the **dashboard scaffold** (blocked on one location question) and, once the
app signs off schema v1, the **domain tables**.

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

1. **Step B — dashboard scaffold (approved, NOT started).** Port Nexus
   `dashboard/src/app/portal/_components` (PortalTable/Kpi/Card/Filter/Pagination,
   usePortalData, PortalNav-adapted) + the fetch API client + Next shell, and wire a
   **Devices page** to `/devices` as the proof-of-concept. **BLOCKED on ONE answer:**
   dashboard location — `server/dashboard/` (sibling of `server/api`, how the owner
   refers to it) vs `web/` (development.md §1). Ask, then build. Porting plan is
   `servdesignspecification.md` §5.
2. **Step C leftovers (optional):** register/recovery/pairing still issue sessions
   directly; migrate them through `AuthService` incrementally ("emerge per module").
3. **Two OAuth confirmations still open** (projman-01 §8.5): endpoint shape (you kept
   **token-exchange** — app is wiring against it, so effectively confirmed) and the
   flag name **`onboardingRequired`** (app suggested `needsOnboarding`; offer an alias
   if they've already coded it).
4. **Domain tables (ProjMan-03-domain / a future record):** projects → stages →
   tasks first, each = one `sync/registry.js` entry + migration + `<Module>Service` +
   thin route + a projman-01 §2.2 row. **Waits on the app team's schema v1 sign-off**
   of development.md §5.
5. **Engagement mechanics (projman-02):** `engagements`/`identities`/`attestations`
   land with the domain tables; your §10 decisions (Ed25519 org issuer key
   server-held+encrypted; device key app-generated/public-only; verify signatures at
   trust-score + share; on-demand trust score + 24h cache + event-invalidate;
   revocation = stop-serving + session-invalidate + `engagement_revoked` tombstone).

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
