# ProjMan-01 — App ↔ Server sync contract (Phase 1: Identity)

**Status:** 🟢 AGREED — Phase 1 built and verified end to end
**Date:** 2026-07-22
**Maintained by:** ProjMan2 **app team** (FtposPM · Flutter · SQLite)
**Counterpart:** server dev (NexusPM · `server/api` · MySQL)
**Supersedes nothing.** First record in the series.
**Scope of this record:** identity, devices, pairing, recovery, and the sync
envelope. Domain tables (projects, site, safety, quality, costs) are **out of scope
here** and land in **ProjMan-03** once schema v1 is agreed. (ProjMan-02 is the
cross-tenant engagement & Verified Work History architecture — it must be settled
first, as it decides how each domain table is scoped.)

> The app team keeps this file as the **contract of record** between us and the
> server developer. When the wire changes, this file changes first, both sides read
> it, then code follows. It holds three things neither codebase can hold on its own:
> the **agreed endpoints**, the **table/column mapping across our SQLite and the
> server's MySQL**, and **what has actually been achieved** so each of us can watch
> the other's progress and stay in sync.
>
> Convention: the app team edits freely; **server-side changes are proposed here by
> the server dev and merged after we confirm the client can meet them** — the same
> "specify, then build" rule the platform already runs on.

---

## 0. How to read this file

- **§1 Endpoints** — the frozen HTTP surface. The app builds against these shapes.
- **§2 Schema** — the SQLite ⇄ MySQL column map, per synced table.
- **§3 Sync envelope** — the exact push/pull wire format and the three rules.
- **§4 Ownership matrix** — who writes what (the single-writer contract).
- **§5 Achieved** — what is done, tested, and safe to build on. Update this section
  every time a stage completes.
- **§6 In flight / next** — what each side is doing now.
- **§7 Change log** — dated line per contract change.

Base URL (dev): `http://localhost:4100/api/v1` · LAN `http://10.1.1.21:4100/api/v1`
Base URL (prod): `https://ebizco.com.au/projman/api/v1`

Deployment shape is **settled**: a separate database `c1projman2` and a separate
service, not a namespace inside FTPOS. (Answers NEXUSPM-BRIEF §2 / §6.1.)

---

## 1. Agreed endpoints — Phase 1

All responses are `{ success: boolean, ... }`. Errors carry a stable `code` (see
§1.6) so the app branches on the code, never the message string.

### 1.1 Auth

| Method | Path | Auth | Body → Returns |
|---|---|---|---|
| POST | `/auth/register` | none | `{organisation{name,abn?,address?,suburb?,state?,postcode?,phone?,email?}, user{full_name,email,password,mobile?}, device{device_uid,...}}` → `{accessToken, refreshToken, user, organisation}` |
| POST | `/auth/login` | none | `{email, password, device{device_uid,...}}` → `{accessToken, refreshToken, user, organisation, device, handoffPending, authoritative}` |
| POST | `/auth/refresh` | none | `{refreshToken}` → `{accessToken, role}` |
| POST | `/auth/logout` | Bearer | `{refreshToken?}` → `{}` |
| GET  | `/auth/me` | Bearer | → `{user, organisation, device}` |
| GET  | `/auth/session/status` | Bearer | → `{valid, authoritative, reason?, retryAfterSeconds?}` |
| POST | `/auth/session/pending-count` | Bearer | `{pendingCount}` → `{}` |
| POST | `/auth/change-password` | Bearer | `{currentPassword, newPassword}` → `{accessToken}` |

### 1.2 Recovery

| Method | Path | Auth | Body → Returns |
|---|---|---|---|
| POST | `/auth/recovery/request` | none | `{email, purpose?}` → `{maskedEmail, expiresIn}` *(always 200)* |
| POST | `/auth/recovery/verify` | none | `{email, code, purpose?}` → `{recoveryToken, expiresIn}` |
| POST | `/auth/recovery/reset` | none | `{recoveryToken, newPassword}` → `{}` |
| POST | `/auth/recovery/device-loss` | none | `{recoveryToken, device{device_uid,...}}` → `{accessToken, refreshToken, user, organisation, requiresFullSync:true}` |
| POST | `/auth/recovery/handoff-complete` | Bearer | `{}` → `{serverPendingCount, handedTo}` |
| POST | `/auth/recovery/handoff-timeout` | Bearer | `{}` → `{authoritative, staleWarning, unsyncedOnOldDevice}` |

`purpose` ∈ `password_reset` (default) | `device_loss`. Device-loss is a **separate
code** because it revokes the lost device's sessions — see §5.

### 1.3 Pairing (a device gets a role)

| Method | Path | Auth | Body → Returns |
|---|---|---|---|
| POST | `/pairing/initiate` | Bearer (admin/dev/PM) | `{role, label?, assign_user_id?, ttl_seconds?}` → `{request_id, qr_payload{v,org,id,nonce}, role, expires_in}` |
| POST | `/pairing/request` | **none** | `{request_id, nonce, device{device_uid,...}}` → `{request_id, status, role}` |
| GET  | `/pairing/pending` | Bearer | → `{pending:[{request_id, role, label, device_uid, device_name, ...}]}` |
| POST | `/pairing/confirm` | Bearer (admin/dev/PM) | `{request_id, role?}` → `{status:'confirmed', device{id,uid,role}}` |
| POST | `/pairing/reject` | Bearer | `{request_id}` → `{status:'rejected'}` |
| GET  | `/pairing/status/:request_id?device_uid=…` | **none** | → confirmed: `{role, device_id, accessToken?, refreshToken?, requiresLogin}` |

`/pairing/request` and `/pairing/status` are **unauthenticated by necessity** — the
new device has no session yet; the nonce is the credential. The QR encodes exactly
`qr_payload`. **MQTT is not used** — the app polls `/pending` (primary) and
`/status/:id` (new device). Same protocol Nexus ran over MQTT, minus the broker.

### 1.4 Devices

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET  | `/devices` | Bearer | `{devices:[{id, uid, name, role, status, isPrimary, lastSeenAt, user}]}` |
| GET  | `/devices/:id` | Bearer | `{device, sessions}` |
| POST | `/devices/:id/revoke` | Bearer (admin/dev/PM) | `{id, status:'revoked', sessionsRevoked}` |
| POST | `/devices/:id/role` | Bearer (admin/dev) | `{id, role, appliesOnNextRefresh:true}` |

### 1.5 Organisation (web console + app profile)

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET   | `/organisation` | Bearer | `{organisation, counts{users,devices}}` |
| PATCH | `/organisation` | Bearer (admin) | `{organisation}` — re-validates ABN if changed |
| GET   | `/organisation/users` | Bearer | `{users:[…]}` |
| POST  | `/organisation/users` | Bearer (admin) | `{user}` |
| PATCH | `/organisation/users/:id` | Bearer (admin) | `{user}` |
| GET   | `/organisation/audit` | Bearer (admin) | `{entries:[…]}` |

### 1.6 Error codes (stable — branch on these)

`NO_TOKEN` · `TOKEN_EXPIRED` · `INVALID_TOKEN` · `SESSION_REVOKED` ·
`DEVICE_REVOKED` · `FORCE_LOGOUT` · `ORG_INACTIVE` · `ORG_MISMATCH` · `DISABLED` ·
`SUSPENDED` · `INVALID_CREDENTIALS` · `TOO_MANY_LOGIN_ATTEMPTS` ·
`DUPLICATE_EMAIL` · `DUPLICATE_ABN` · `INVALID_ABN` · `VALIDATION_ERROR` ·
`INVALID_CODE` · `TOO_MANY_ATTEMPTS` · `INVALID_RECOVERY_TOKEN` ·
`ROLE_NOT_ASSIGNABLE` · `NOT_OWNER` · `NOT_FOUND` · `RATE_LIMITED`

AU sign-in surface (§1.8) adds: `UNSUPPORTED_PROVIDER` · `NO_OAUTH_TOKEN` ·
`INVALID_OAUTH_TOKEN` · `OAUTH_TOKEN_EXPIRED` · `EMAIL_REQUIRED` ·
`EMAIL_NOT_VERIFIED` · `OAUTH_NOT_CONFIGURED` · `PROVIDER_UNAVAILABLE` ·
`USE_SOCIAL_LOGIN` · `INVALID_MOBILE` · `SMS_SEND_FAILED`

### 1.7 The access token (JWT claims)

```
sub        users.id
org_id     organisations.id     ← every server query filters on THIS, never a body field
role       effective role (device role wins over user role on a paired device)
device_id  devices.device_uid   (null for a browser session)
version    users.security_version   (a password reset bumps it → old tokens die)
jti        the session's refresh_token UUID   (revoking the session kills the token)
type       'user'
```

Access token TTL **15m**, refresh **30d**. The refresh token is the opaque session
UUID, not a JWT — valid only against a live, unrevoked `sessions` row.

### 1.8 Australian sign-in surface (OAuth / SMS / onboarding)

**Status: 🔵 built + verified (server dev, dev-bypass), pending app confirmation of
shapes.** Schema is migration_v002. Australian market = no national-ID scan: identity
is email+password, three OAuth providers, and an SMS-verified +61 mobile.

**Providers: Google, Microsoft, Facebook — and only these three.** No GitHub, Apple,
X, TikTok, LinkedIn. The server rejects any other with `400 UNSUPPORTED_PROVIDER`.

| Method | Path | Auth | Body → Returns |
|---|---|---|---|
| POST | `/auth/oauth/:provider` | none | `{token, device{device_uid,…}?}` → `{accessToken, refreshToken, user, organisation, isNewUser, onboardingRequired, authoritative}` · `:provider` ∈ `google\|microsoft\|facebook` |
| POST | `/auth/onboarding` | Bearer (org_admin) | `{state, business_type, gst_registered, abn?, organisation_name?}` → `{organisation, user}` |
| POST | `/auth/sms/request` | Bearer | `{mobile}` → `{maskedMobile, expiresIn}` |
| POST | `/auth/sms/verify` | Bearer | `{mobile, code}` → `{mobile, mobileVerified:true}` |

**Sign-in model.** The app runs the provider SDK, gets a provider token, posts it to
`/auth/oauth/:provider`; the server **verifies the token against the provider**
(Google/MS = OIDC ID-token via JWKS + audience check; Facebook = access token via
Graph `debug_token`) and issues our own session. The provider token never becomes our
session. **Email is the identity key** — a provider account links to an existing user
by verified email (sign in with Google then Microsoft on one address → one account).
A brand-new email creates an org + `org_admin` like `/auth/register` but with
`onboarding_complete = 0`, so the response carries `onboardingRequired: true` and the
app shows the AU onboarding screen. **Email must be returned by every provider**
(`EMAIL_REQUIRED` if not) and verified (`EMAIL_NOT_VERIFIED`).

**Onboarding** (post-auth): `state` (8 AU states/territories), `business_type`
(`sole_trader\|partnership\|company\|trust`), `gst_registered` (bool). **ABN optional
in v1** (required for invoicing later) — validated by the same checksum/ABR path as
register. Sets `onboarding_complete = 1`.

**SMS** verifies a **+61 mobile** during onboarding (not a login method). `mobile` is
normalised to E.164 (`04xx… / +61 4xx…` → `+614XXXXXXXX`); a 6-digit code, 10-min TTL,
5-attempt ceiling; success sets `users.mobile` + `mobile_verified = 1`.

**Password login on an OAuth-only account** returns `409 USE_SOCIAL_LOGIN` (not a
generic invalid-credentials) — the user isn't wrong, they signed up with a provider.

**Dev bypass** (dev only, `OAUTH_DEV_BYPASS=true`): a token
`dev:<provider>:<email>:<name>` is accepted so the app team can build the full
login→onboarding UI before the real OAuth apps exist. Never enabled in production.

**Config the deployment must supply:** `GOOGLE_CLIENT_IDS` (per-platform, comma-sep),
`MICROSOFT_CLIENT_ID`, `FACEBOOK_APP_ID`/`SECRET`; SMS provider (`console` in dev; an
AU-resident sender — MessageMedia / SNS Sydney — in prod, per the data-residency rule).

### 1.9 Client surfaces the server serves

Three surfaces hit this API; the server accommodates all three from one service:

| Surface | Who / what | Auth | Writes (sync ownership §4) |
|---|---|---|---|
| **App** (Flutter) | site + office staff on a device | session **with** `device_id` | app-owned tables (device name/OS, and Phase-2 field data) |
| **Dashboard** (`server/dashboard`, Next.js) | office console — org_admin / developer / PM | session **without** `device_id` (browser) | web-owned tables (`organisations`, `users`, and Phase-2 config) |
| **Public portal** (Next.js, web only) | customer read-only view of *their* project | session, `customer` role | **nothing** — read-only; never a sync writer |

`org_id` isolation and the ownership matrix (§4) hold identically across all three —
the surface is derived server-side (device present → app; else web), and the
`customer` role is refused by every write guard. CORS lists all three origins
(`CORS_ORIGINS`, comma-separated). The portal is read-only by role, so it needs no
new ownership rule; if a future portal write appears, it gets its own row in §4 first.

---

## 2. Schema — SQLite (app) ⇄ MySQL (`server/api/mysql/migration_v001_identity.sql`)

Same table and column names on both sides wherever a table syncs — MAOI's rule,
kept. The app's SQLite mirror differs only where noted.

### 2.1 Type conventions (both sides)

| Concept | SQLite (app) | MySQL (server) | Notes |
|---|---|---|---|
| id / FK | `TEXT` (uuid v4) | `CHAR(36)` | app generates the id on create |
| flag | `INTEGER` 0/1 | `TINYINT(1)` | |
| `updated_at` | `INTEGER` (unix ms) | `BIGINT` | **client clock** — display + ordering only |
| `server_updated_at` | — (server only) | `DATETIME(3)` | **server clock** — the pull cursor reads this, never `updated_at` |
| `is_deleted` | `INTEGER` 0/1 | `TINYINT(1)` | soft delete = tombstone; never hard-delete a synced row |
| `device_id` | `TEXT` | `VARCHAR(100)` | the writer's `device_uid`; drives pull echo-skip |

### 2.2 Synced tables — Phase 1

Only three tables sync in Phase 1. **Writable** = columns a device push may set;
everything else is server-owned and silently dropped from a push (see §3.4).

**`organisations`** — the tenant. Tenant scope column is `id` (the org *is* the org).
```
id, name, abn, abn_validated('no'|'checksum'|'abr'), address, suburb,
state(WA|SA|NT|QLD|NSW|VIC|TAS|ACT), postcode, phone, email,
timezone('Australia/Perth'), currency('AUD'), plan, status,
device_id, is_deleted, updated_at, server_updated_at
  writable via sync: name, address, suburb, state, postcode, phone, email, is_deleted
  server-owned:      abn, abn_validated, plan, status, timezone, currency
  owner: WEB (console). Created at /auth/register only — never via sync.
```

**`users`** — a login inside one org.
```
id, org_id, email(unique GLOBAL), password_hash, full_name, mobile,
role(org_admin|project_developer|project_manager|supervisor|tradie|customer),
status, security_version, force_logout_flag, last_login_at,
device_id, is_deleted, updated_at, server_updated_at
  writable via sync: full_name, mobile, is_deleted
  server-owned:      email, password_hash, role, status, security_version
  owner: WEB (console). role/status change is an admin action, not a device write.
  ⚠ password_hash NEVER leaves the server — stripped from every pull payload.
```

**`devices`** — a paired handset/tablet. **Role lives here**, not only on the user.
```
id, org_id, user_id(nullable — shared tablet), device_uid, device_name, platform,
model, os_version, app_version, role, is_primary, status(active|revoked|suspended),
paired_at, paired_by, last_seen_at, revoked_at,
device_id, is_deleted, updated_at, server_updated_at
  writable via sync: device_name, platform, model, os_version, app_version,
                     last_seen_at, is_deleted
  server-owned:      role, status, is_primary, paired_at, paired_by, revoked_at
  owner: APP (the device knows its own name/OS best). role/revoke are server-only.
```

### 2.3 Server-only tables (never sync to the device)

`sessions` · `pairing_tokens` · `recovery_tokens` · `audit_log` · `sync_history` ·
`schema_migrations`. The app never sees these; it interacts with them only through
the §1 endpoints.

**migration_v002 (AU sign-in, §1.8) adds:**
- `auth_identities` — server-only. One row per linked OAuth account
  `(provider, provider_sub) → user_id`; the email is the cross-provider key. Reached
  only through `/auth/oauth/*`.
- `sms_verifications` — server-only. Hashed +61 code, TTL, attempt ceiling. Reached
  only through `/auth/sms/*`.
- `users` gains `onboarding_complete`, `mobile_verified` (both **server-owned**, app
  reads); `password_hash` becomes **nullable** (OAuth-only accounts have none).
- `organisations` gains `business_type`, `gst_registered` (**web/server-owned**, app
  reads). If the app mirrors these three read-only columns, add them to its
  `organisations`/`users` SQLite (TEXT / INTEGER); if not, the tolerant reader
  (§5) drops them — either is fine.

### 2.4 Adding a table (the Phase-2 procedure)

A new synced table is **one entry** in `server/api/src/sync/registry.js`
(`{table, columns, owner, pull, scope, orgColumn, idColumn}`) plus a migration and a
row in §2.2 here. No new push/pull handler. This is deliberate: the Nexus `sync.js`
grew to 3281 lines precisely because it lacked a registry. Every domain table
(projects, stages, tasks, site_diary, attendance, …) carries `org_id`, `device_id`,
`is_deleted`, `updated_at`, `server_updated_at` — the five sync columns above — or it
does not sync.

---

## 3. Sync envelope (frozen)

### 3.1 Push — one record up
```
POST /sync/push
{ "table_name": "devices", "operation": "create|update|delete",
  "data": { "id": "<uuid>", ...columns },
  "local_id": "<uuid>"   // optional; used if data.id is absent
}
→ 200 { "success": true, "server_id": "<uuid>", "applied": true }
→ 403 NOT_OWNER          this surface does not own this table (see §4)
→ 404 NOT_FOUND          the id does not exist IN THIS ORG (also the cross-tenant case)
```

### 3.2 Pull — deltas down
```
GET /sync/pull?since=<unix ms>          (omit / 0 = full sync, e.g. after device-loss)
→ 200 {
    "success": true,
    "last_sync_at": <unix ms>,          ← store this, send it as next `since`
    "changes": [
      { "table_name": "...", "operation": "create|delete",
        "server_id": "...", "local_id": "...", "data": {...},
        "updated_at": <unix ms> }
    ]                                    ← sorted oldest-first (parents before children)
  }
```

**What `data` contains, exactly** (server dev, confirmed against live pull 2026-07-22):
- The row's columns as stored in MySQL. `password_hash` and `server_updated_at` are
  **stripped** — never emitted. (`server_updated_at` is a `DATETIME(3)` string, not
  unix ms; the client's cursor is the envelope's top-level `last_sync_at`, so the
  client never needs it and must not persist it into its unix-ms column.)
- **The cursor lives at envelope top level, not in `data`.** Advance `since` from
  `last_sync_at`; order rows by the per-change top-level `updated_at` (unix ms). Do
  not read timing off `data`.
- **`data` may carry read-only server columns the app has no column for** — e.g.
  `organisations` sends `created_at`, `abn_checked_at`, `trial_ends_at`. **The client
  MUST ignore columns it does not recognise** — the exact mirror of the server
  dropping unknown columns on push (§3.4). Do not blind-`INSERT` every `data` key.
- Conversely, a client-local column with no server counterpart (e.g.
  `organisations.is_primary` in the app's SQLite) is simply never populated by pull —
  it stays at its local default. Harmless; noted so nobody hunts for it.

### 3.3 The three rules (why sync stays honest — ftpos XF-27)

1. **Cursor is server epoch-ms, bounded both ends.** The server computes the cursor
   from `UNIX_TIMESTAMP(NOW(3))` *before* the row queries and returns it as
   `last_sync_at`; comparisons are `> since AND <= cursor` on
   `UNIX_TIMESTAMP(server_updated_at)`. Epoch comparison is **timezone-independent** —
   it does not depend on the MySQL server tz matching the driver (the trap that cost
   Nexus days, its O-036). Rows written mid-pull arrive next cycle; the upper bound
   stops re-delivery loops.
2. **A device never receives its own echo.** Pull excludes rows whose `device_id`
   equals the caller's (`NOT (device_id <=> ?)`, NULL-safe so web-written rows still
   reach every device). Without this, a push comes straight back and clobbers a newer
   local edit.
3. **Single writer per entity.** `/sync/push` refuses (`403 NOT_OWNER`) a write to a
   table this surface does not own. Two-way transport, single-writer data.

### 3.4 Column safety on push
- `id`, `org_id`, `user_id`, `role`, `status`, `password_hash`, `security_version`,
  `created_at`, `server_updated_at`, `paired_*`, `revoked_at`, `abn*`, `plan` are
  **never** writable from a push, on any table.
- Unknown / non-writable columns are **dropped silently**, not rejected — the app may
  ship ahead of the server, and a 400 on one field would wedge the whole queue.
- `org_id` is set server-side from the token on every create. A push cannot place a
  row in another org even if it sends one.

---

## 4. Ownership matrix (single-writer — the contract every two-way table obeys)

`W` = system of record. `R` = read-only. Ask **"who physically causes this change?"**

| Table | App (device) | Web console | Server | Rule |
|---|---|---|---|---|
| `organisations` (profile) | R | **W** | R | Config; ABN is a deliberate desk action. |
| `users` (HR, roles) | R | **W** | R | Role/status is an admin action. |
| `devices` (name/OS) | **W** | R | R | The device knows itself. |
| `devices.role`, `.status` | R | R | **W** | Assigned/revoked server-side only. |
| `sessions`, tokens, audit | R | R | **W** | Server-internal. |

Phase 2 extends this table for every domain entity **before** either side builds it.
The rule of thumb: a person standing on site → **App writes**; a remote manager
configuring → **Web writes**; an external system → **Server writes**. If no single
actor can be named, split the table by field until each field has one owner.

---

## 5. Achieved — Phase 1 (P2 in `development.md`)  ✅

**Target (NEXUSPM-BRIEF §5):** the app can register, log in, recover, pair a device
with a role, and sync `organisations`/`users`/`devices` end to end, with tenant
isolation proven server-side.

Delivered by the server dev in `server/api`, **verified by the app team against a
live `c1projman2` on 2026-07-22** (we ran the acceptance script and isolation test
before building the client against these shapes):

| Acceptance item (brief §5) | Result |
|---|---|
| 1. Register org → working session | ✅ 201, org_admin, session issued |
| 2. Login + refresh (expired access refreshes) | ✅ authoritative session, refresh returns new access |
| 3. Reset a forgotten password end to end | ✅ request → verify → reset → login with new password |
| 4. Pair a 2nd device, confirm **as supervisor**, role in session | ✅ role on the device binding |
| 5. Revoke the device → its next call fails | ✅ `DEVICE_REVOKED` on next request |
| 6. Push/pull org/users/devices, cursor advances | ✅ 4 rows full pull, delta after edit, cursor advances |
| 7. **Isolation**: org A cannot read/write org B | ✅ `tests/isolation.test.js` — **16/16 pass** |

Extra, delivered beyond the minimum:
- **ABN validation** — modulus-89 checksum always; ABR lookup when `ABR_GUID` set;
  org records which level passed (`no`/`checksum`/`abr`) for TPAR/withholding later.
  Duplicate ABN → `409 DUPLICATE_ABN`.
- **`audit_log` from day one** — every identity action recorded (who, which device).
- **Device-loss recovery** (ftpos XF-36/45) — reclaim authority onto a replacement
  tablet, revoking the lost one; response flags `requiresFullSync`.
- **Single-writer handoff** over polling — `/session/status` force-grants authority
  after a 90s ceiling so a lost tablet can't deadlock its replacement.

**Server dev — review of the app's SQLite mirror (`app/lib/core/db/schema_core.dart`),
2026-07-22.** Read against `migration_v001_identity.sql`. The three synced tables line
up: shared UUID `id`, `abn_validated` as a TEXT enum, the `users` projection without
`password_hash`, and role on the `devices` row. Two points reconciled here rather than
in code, both confirmed harmless:
- The pull payload no longer emits `server_updated_at` (a datetime string) — **server
  changed** so the app's unix-ms `server_updated_at` column is never fed a string. See
  §3.2.
- `organisations.is_primary` exists in the app's SQLite but not in the server's
  `organisations`; pull never populates it. Left as-is (app-local, default 0).
- **Action for the app:** ignore unrecognised columns on pull (§3.2) — the server
  sends `created_at` / `abn_checked_at` / `trial_ends_at` on `organisations`, and
  `force_logout_flag` on `users`, which the app's schema does not mirror. A blind
  `INSERT` of every `data` key would fail on those.

**App team — resolved 2026-07-22 (app owns it; no server allowlist).** The client
filters every pulled row to the local table's real columns before applying it, via
`DatabaseService.filterToTableColumns()` (`app/lib/services/db_service.dart`), which
reads the allowlist from the live schema (`PRAGMA table_info`) so it can never drift.
The P2 sync-apply layer will route all pulls through it; verified there against a live
`c1projman2` pull. **We declined the offered server `pullColumns` allowlist** on
purpose: (1) it is the exact symmetric mirror of §3.4 — both sides tolerate the other
shipping ahead, and a strict-pull/tolerant-push split would break that symmetry;
(2) an allowlist puts app-schema knowledge in the server registry, forcing lockstep
edits whenever the app mirrors a new column — the coupling this doc exists to avoid;
(3) SQLite throws on an unknown column regardless, so the client must guard even with
a perfect server allowlist. Keep `/sync/pull` generic.

Reproduce:
```bash
cd server/api && npm install && cp .env.example .env   # fill JWT secrets
npm run db:migrate && npm run dev
node tests/isolation.test.js      # 16/16
node tests/acceptance.js          # the §5 transcript, printed
```

---

## 6. In flight / next

| Who | Now | Next |
|---|---|---|
| **App team (us)** | P2 auth UI SHIPPED (builds clean): welcome/login/register/recovery screens, OAuth-first per auth-strategy, email register+login+recovery wired to §1; SQLite mirror reconciled to §2.2; tolerant-reader pull filter built (`filterToTableColumns`, §5) | Wire pairing/handoff + sync once §8 asks land. **See §8 for new server asks (OAuth, SMS, org columns, AU residency).** |
| **Server dev** | Phase 1 done ✅ · **§8 delivered** (migration_v002): 3-provider OAuth, SMS mobile verification, `business_type`/`gst_registered`, AU onboarding — built + verified, see §8.5 | Awaiting 2 confirmations (§8.5): OAuth endpoint shape (token-exchange vs redirect) + SMS scope (verification vs also-recovery). Then ProjMan-03 domain tables (projects → stages → tasks); ProjMan-02 architecture signed off. Serves all three surfaces (§1.9). |
| **Web console** | Scaffolding (Next.js) | Consume `/organisation*` + `/devices*`; it is the **W** for `organisations`/`users`. |

**Blocking questions returned to the brief (unchanged assumptions):**
- Tradie/customer logins deferred to post-v1 (role enum + pairing support them; no
  self-service registration). Supervisors record attendance in v1.
- Password policy set here (min 10, bcrypt 12, identifier-keyed lockout ×10), not
  FTPOS's 6-digit PIN.
- No migration of legacy `c1projman` — clean start.

---

## 7. Change log

| Date | Change | By |
|---|---|---|
| 2026-07-22 | Record created by the app team. Phase 1 endpoints, schema v001 and the sync envelope captured from the server dev's delivery and verified by us (16/16 isolation, §5 acceptance transcript green). Frozen as the Phase-1 contract. | App team |
| 2026-07-22 | Moved to `docs/decisions/` (decision-record home). App SQLite mirror (`schema_core.dart`) reconciled to §2.2 — adopted `devices` (was `device_registry`), `abn_validated` TEXT enum, added local `users` projection, switched to the shared-UUID `id` / `device_id` / `server_updated_at` / unix-ms `updated_at` sync convention. §6 app row updated. | App team |
| 2026-07-22 | Server dev reviewed the app SQLite mirror against `migration_v001_identity.sql`. **Server change:** `/sync/pull` no longer emits `server_updated_at` or `password_hash` in `data` (retested 16/16 isolation). Documented the exact pull-`data` contract and the client's must-ignore-unknown-columns rule (§3.2), and the `organisations.is_primary` / read-only-column reconciliation (§5). No app-facing endpoint or wire-shape change. | Server dev |
| 2026-07-22 | App team accepted the `server_updated_at` pull fix and **resolved the §5 pull-column action app-side**: built `filterToTableColumns` (tolerant reader over `PRAGMA table_info`); every P2 pull applies through it. **Declined** the offered server `pullColumns` allowlist — keep `/sync/pull` generic; reasoning in §5. No server change requested. | App team |
| 2026-07-22 | App team built the P2 auth UI (welcome/login/register/recovery) against §1, OAuth-first per the new auth strategy. **Opened §8 — new server asks:** 3 OAuth providers (Google/Microsoft/Facebook only), SMS verification for +61 mobiles, `organisations.business_type` + `gst_registered` columns, and AU data-residency. Email register/login/recovery need no server change. | App team |
| 2026-07-22 | Server dev **delivered §8** (migration_v002): `POST /auth/oauth/:provider` (token-exchange; Google/MS via JWKS ID-token, FB via Graph), `/auth/onboarding`, `/auth/sms/request`+`/verify` (+61); `auth_identities` + `sms_verifications` tables; `users.onboarding_complete`/`mobile_verified` + nullable `password_hash`; `organisations.business_type`/`gst_registered`. Full flow verified via dev-bypass; 16/16 isolation still green. Added §1.8 (AU sign-in), §1.9 (three surfaces: app/dashboard/portal), §8.5 (response). **2 confirmations wanted:** OAuth shape + SMS recovery-or-just-verification. **Residency:** code region-agnostic, PII stays in `c1projman2`; hosting to AU is a deploy commitment (§8.5). | Server dev |

---

## 8. Auth strategy — App team → Server dev (Phase 2 asks)

The app now ships an **OAuth-first** auth surface. The **email** path
(register/login/recovery in §1) already works against your live server and needs
**no change**. The items below are new and need your side. **None block the email
path** — the app degrades gracefully (OAuth buttons show "coming soon", SMS reset is
a disabled option) until each lands, so ship them independently.

**Product constraint to hold the line on:** exactly **three** OAuth providers —
**Google, Microsoft, Facebook** — and no others. Not Apple, GitHub, TikTok, X,
LinkedIn. (Google = universal AU coverage; Microsoft = Office 365 builders +
Outlook/Hotmail tradies; Facebook = tradie penetration.) If a provider is added
server-side it must not appear unless the app adds its button too.

### 8.1 OAuth sign-in / sign-up (3 providers)
- Endpoints (shape your call; proposed): `POST /auth/oauth/:provider/start` →
  redirect/PKCE params; `POST /auth/oauth/:provider/callback` → same session shape
  as `/auth/login` (§1.1: `{accessToken, refreshToken, user, organisation, device}`).
  `:provider ∈ google | microsoft | facebook`.
- **Every provider MUST return the user's email** (non-negotiable) — the app keys
  the account on email and will reject a provider response without one.
- **First OAuth sign-in with no org yet** must route into the same **AU onboarding**
  the email path collects (§8.3) before a session is fully usable — i.e. OAuth
  proves identity; it does not skip org creation. Suggest the callback return a
  `needsOnboarding: true` flag when the email has no organisation.
- App side is skin-only today (`services/oauth_service.dart` returns `pending`);
  wiring the real flow is fast once the endpoints + provider app IDs exist.

### 8.2 SMS verification for Australian mobiles (+61)
- Extend recovery to a phone channel: `recovery/request` accepting
  `{mobile}` (E.164 `+61…`) alongside `{email}`, delivering a 6-digit code by SMS;
  `verify`/`reset` unchanged. Also usable for **mobile verification at signup** later.
- AU mobile format the app validates before sending: `+61 4xx xxx xxx` / `04xx…`.
- App shows an SMS option on recovery today, disabled ("coming soon"), until this
  lands. Needs an AU SMS sender (e.g. an Australian-registered sender ID).

### 8.3 AU onboarding columns on `organisations`
The register form now collects these; the app sends them in the `organisation`
block and mirrors them locally (`schema_core.dart`), but your `organisations` table
needs the columns or they are dropped:
- `business_type` — enum `Sole Trader | Partnership | Company | Trust`.
- `gst_registered` — boolean.
- (`abn` already exists and stays **optional in v1**; `state` already exists.)
Please add both to `migration_v001_identity.sql`'s successor and echo them on pull
(they're server-owned config like the rest of `organisations`).

### 8.4 Privacy & data residency (compliance, not code)
- **Australian data residency:** `c1projman2` and all identity data on Australian
  infrastructure (AWS Sydney `ap-southeast-2` / Azure Australia East). Please confirm
  where `c1projman2` is hosted — it's a compliance commitment we're making to users
  on the signup screen ("your details stay in Australia").
- **Australian Privacy Act** compliance for stored PII; OAuth tokens/PII not routed
  through non-AU regions. Flagging early so it's a design input, not a retrofit.

**App-side status:** all of the above are present in the UI as skin and validated
client-side; email auth is fully functional against the live server now.

### 8.5 Server dev response — built + verified 2026-07-22 (migration_v002)

All of §8 is built and tested on a live `c1projman2` (dev-bypass path; 16/16 isolation
still green). Endpoint shapes are in §1.8. Status per ask:

**§8.1 OAuth — DELIVERED, one shape decision to confirm.** I built a single
**token-exchange** endpoint, not `/start`+`/callback`:
`POST /auth/oauth/:provider` `{token, device?}`, `:provider ∈ google|microsoft|facebook`.
The app runs the **native provider SDK** (google_sign_in / MSAL / flutter_facebook_auth),
gets the provider token, and posts it; the server **verifies** it (Google/MS = OIDC
ID-token via JWKS + audience check; Facebook = Graph `debug_token`) and returns the
**same session shape as `/auth/login`** plus `isNewUser` + `onboardingRequired`. I chose
token-exchange over redirect/PKCE because it is the standard for a native app and needs
no webview — `oauth_service.dart` calls the SDK then this one endpoint. **If you'd
rather have the redirect/`/start`+`/callback` flow, say so** and I'll add it.
- Email enforced from every provider (`EMAIL_REQUIRED`); unverified email refused
  (`EMAIL_NOT_VERIFIED`).
- **Naming:** I return `onboardingRequired`; you proposed `needsOnboarding`. One-line
  change — tell me which the client uses and I'll match it.
- **"No org yet":** I keep the Phase-1 invariant that every user has an org, so a first
  OAuth sign-in creates the org immediately (placeholder name) with
  `onboarding_complete = 0` and flags `onboardingRequired: true`. Same result for you —
  route to onboarding off the flag — with no null-org special case in the token/middleware.
- Providers hard-limited to the three; anything else → `400 UNSUPPORTED_PROVIDER`.

**§8.2 SMS — partial; please confirm scope.** I built **mobile verification** (your
"…at signup later" use): `POST /auth/sms/request` + `/auth/sms/verify` (authenticated,
+61 normalised, 6-digit / 10-min / 5-try) → sets `mobile_verified`. I did **not** wire
SMS as a **password-recovery** channel, because the auth-strategy doc you shared says
recovery is **email**, while §8.2 asks for **SMS recovery** — the two disagree. **Which
do you want?** Email recovery already covers everyone; SMS recovery is a small extension
of `recovery/request` to also accept `{mobile}` (needs a unique verified mobile on
file). Say the word and I'll add it.

**§8.3 org columns — DELIVERED exactly.** `organisations.business_type`
(`sole_trader|partnership|company|trust`) + `gst_registered` (bool) added in v002,
collected by `POST /auth/onboarding`, server-owned, echoed on pull. Your mirrored
columns receive them; if unmirrored, the tolerant reader drops them. ABN stays optional
in v1; `state` unchanged.

**§8.4 residency — a deploy commitment, not code; I can't assert it yet.** The service
is region-agnostic and `c1projman2` currently runs on the **dev box (localhost)**, not
in AU cloud — that hosting decision is yours/ops. What the code guarantees for the
Privacy Act line: **all PII at rest lives in `c1projman2`** (users, auth_identities,
organisations, sms_verifications). The only outbound calls are (a) OAuth **token
verification** to Google/MS/FB and (b) **ABR** ABN lookup (AU gov) — neither stores PII
externally (verification just sends the provider back its own token to check the
signature/audience). Deploy the MySQL + this service to `ap-southeast-2` (AWS Sydney) /
Azure Australia East and the "your details stay in Australia" claim holds; I'll add a
one-line `/health` region tag once you tell me the target so it's auditable.

**Config you must supply before real (non-bypass) OAuth/SMS works:** `GOOGLE_CLIENT_IDS`
(per-platform, comma-sep), `MICROSOFT_CLIENT_ID`, `FACEBOOK_APP_ID`/`SECRET`, and an
AU SMS sender (`SMS_PROVIDER=messagemedia` + creds). Until then the app builds the whole
flow against `OAUTH_DEV_BYPASS=true` (dev only).
