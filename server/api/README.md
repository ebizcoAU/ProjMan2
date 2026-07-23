# ProjMan2 API — Phase 1 (Identity)

The server for the ProjMan2 field app: **register, log in, recover, pair a device
with a role, and sync**. Ported from the Nexus identity surface
(`~/Documents/Dev/nexus/api`) into a standalone service, stripped to the buy side and
adapted from Vietnamese POS to Australian construction.

This is the deliverable the [NEXUSPM brief](../NEXUSPM-BRIEF.md) asked for. It makes
that brief's §5 acceptance list testable end to end.

```
POST /api/v1/auth/register            create org + first user (org_admin)
POST /api/v1/auth/login               email + password → tokens
POST /api/v1/auth/refresh             refresh → new access token
POST /api/v1/auth/logout
GET  /api/v1/auth/me
GET  /api/v1/auth/session/status      alive? authoritative writer?
POST /api/v1/auth/session/pending-count
POST /api/v1/auth/change-password

POST /api/v1/auth/recovery/request    email → code
POST /api/v1/auth/recovery/verify     code → recovery token
POST /api/v1/auth/recovery/reset      recovery token + new password
POST /api/v1/auth/recovery/device-loss        reclaim onto a replacement device
POST /api/v1/auth/recovery/handoff-complete   outgoing device hands authority over
POST /api/v1/auth/recovery/handoff-timeout    incoming device takes authority

POST /api/v1/pairing/initiate         primary starts pairing → QR payload
POST /api/v1/pairing/request          new device submits scanned payload (no auth)
GET  /api/v1/pairing/pending          primary polls for requests
POST /api/v1/pairing/confirm          approve + ASSIGN ROLE
POST /api/v1/pairing/reject
GET  /api/v1/pairing/status/:id       new device polls its request

GET  /api/v1/devices                  list org devices, roles, last seen
GET  /api/v1/devices/:id
POST /api/v1/devices/:id/revoke       kill a lost device
POST /api/v1/devices/:id/role         change a device's role

POST /api/v1/sync/push                dirty rows up
GET  /api/v1/sync/pull?since=cursor   changes down
GET  /api/v1/sync/status

GET   /api/v1/organisation            the caller's org
PATCH /api/v1/organisation            update profile (org_admin)
GET   /api/v1/organisation/users
POST  /api/v1/organisation/users      (org_admin)
PATCH /api/v1/organisation/users/:id  (org_admin)
GET   /api/v1/organisation/audit      (org_admin)

GET   /api/v1/projects                list (?status=, paginated; money redacted per role)
POST  /api/v1/projects                (org_admin | project_developer)
GET   /api/v1/projects/:id            detail + stages + tasks
PATCH /api/v1/projects/:id            (org_admin | project_developer)
POST  /api/v1/projects/:id/stages     (admin | developer | manager)
PATCH /api/v1/projects/:id/stages/:stageId
GET   /api/v1/customers               list with project counts
POST  /api/v1/customers               (org_admin | project_developer)
PATCH /api/v1/customers/:id           (org_admin | project_developer)
```

## Run it

```bash
cd server/api
npm install
cp .env.example .env          # fill JWT secrets: openssl rand -hex 48
npm run db:migrate            # creates c1projman2 + schema v001
npm run dev                   # http://localhost:4100/api/v1
```

Confirm the acceptance boundary — a token from org A cannot touch org B:

```bash
node tests/isolation.test.js     # 16 tenant-isolation checks
node tests/domain.test.js        # 24 construction-core checks (v003): CRUD scoping,
                                 # ownership refusals, financial redaction, web-never-writer
```

## Deployment shape

Answering the brief's §2 open question: **separate database, separate service.**
ProjMan2 is a different product with a different customer base, so it does not share
the FTPOS schema.

- **Database:** `c1projman2` (new; legacy `c1projman` is not migrated)
- **Dev base URL:** `http://localhost:4100/api/v1` (LAN: `http://10.1.1.21:4100`)
- **Prod base URL:** `https://ebizco.com.au/projman/api/v1`

It reuses Nexus's *shape* — Express + mysql2 pool + JWT — but not its process. The
libraries are re-declared in this `package.json` so the service can be deployed on
its own.

## What was ported, and what changed

Source: the modules the brief marked ✅ / ⚠️ in §1.

| Nexus source | Here | Change |
|---|---|---|
| `routes/auth.js` (2129 ln) | `routes/auth.js` (~560) | CCCD/PIN → email/password. SMS OTP, staff login, app-variant axis, and the `people`/`personal_people` profile joins all dropped. D-140 handoff moved to `recovery.js`. |
| device-loss recovery (XF-36/45) | `routes/recovery.js` | Kept — a site tablet is *more* likely to be lost than an office PC. |
| `routes/pairing.js` (XF-06/07/41) | `routes/pairing.js` | POS role vocabulary (CASHIER/WAITER/*_DSP) → ProjMan2 roles. MQTT push → polling. |
| `routes/devices.js` (N-API-022) | `routes/devices.js` | Pairing-token endpoints folded into `pairing.js`; list/revoke/re-role kept. |
| `routes/sync.js` (3281 ln, XF-27) | `routes/sync.js` (~330) + `sync/registry.js` | Per-table special cases → a declarative registry. Envelope and cursor semantics unchanged. |
| `businesses.js` / `companies.js` / `subscriber.js` | `routes/organisation.js` | subscriber + business + site collapse into one **organisation** (the tenant). |
| `middleware/auth.js` | `middleware/auth.js` | Three token types → one. `org_id` from the token, enforced on every query. |

### Deviations from Nexus worth knowing

1. **No MQTT broker.** Nexus pushed pairing approvals and handoff signals over MQTT.
   ProjMan2 runs the identical protocols over the polling endpoints that already
   existed in Nexus as the offline fallback (`/pairing/status`, `/pairing/pending`,
   `/session/status`). Same states, same 90-second handoff ceiling, one fewer piece
   of infrastructure. If a broker is added later, these endpoints stay as the
   fallback.

2. **`org_id` everywhere; the caller never supplies it.** Every query filters on
   `req.auth.orgId`, which comes from the verified token. `org_id` is in the sync
   layer's `PROTECTED_COLUMNS`, so a device push cannot set it. This is the whole
   multi-tenant guarantee, and `tests/isolation.test.js` is its proof.

3. **Role lives on the device binding.** A shared site tablet holds `supervisor`
   without a shared password (MAOI's contract). A project manager who logs into that
   tablet gets the tablet's scope, not their own — enforced server-side, mirrored by
   the app for UI only.

4. **ABN, not MST.** Modulus-89 checksum always runs; ABR lookup runs only when
   `ABR_GUID` is set. The org records which level passed (`no`/`checksum`/`abr`)
   because TPAR and withholding depend on it later.

5. **The single-writer contract (XF-27) is kept verbatim.** One authoritative
   session per user may push offline work; a second device asks for authority through
   the handoff rather than seizing it. The sync registry names one system-of-record
   surface per table and refuses a push from any other.

## Open questions returned to the brief

- **§6.3 Tradie/customer logins** — deferred, as assumed. The role enum and pairing
  support them; no self-service registration path is built. Supervisors record
  attendance in v1.
- **§6.4 Password policy** — set here, not inherited from FTPOS's 6-digit PIN:
  minimum length (default 10), bcrypt cost 12, identifier-keyed lockout after 10
  failures. Tune in `.env`.
- **§6.5 ABR validation** — store-and-flag by default; live lookup when `ABR_GUID`
  is configured.

## Phase 2 and beyond

The domain tables (projects, stages, tasks, site diary, attendance, safety,
inspections, the ledger) are **not** here — Phase 1 is identity only. When they land,
each is one entry in `sync/registry.js` (table, writable columns, owner, scope), not
a new handler. That is the point of the registry: the 3281-line Nexus `sync.js` grew
that large precisely because it lacked one.
