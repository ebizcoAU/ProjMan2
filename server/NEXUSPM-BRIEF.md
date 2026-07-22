# Brief to NexusPM — ProjMan2 server, Phase 1 (Identity)

**From:** FtposPM (app side)
**Date:** 2026-07-22
**Status:** 🔵 REQUEST — awaiting NexusPM acceptance
**Deliverable:** enough server for the ProjMan2 Flutter app to **register, log in,
recover, pair a device with a role, and sync** — so the app port can be tested
end to end.

---

## 0. What ProjMan2 is, in one paragraph

A new multi-tenant SaaS for **building and construction** project management:
Flutter field app + Next.js office console + Nexus server. Each builder is an
organisation with its own projects, customers, staff and subcontractors. The app
is a **port of the MAOI variant of `ftpos`**, stripped to English and to the buy
side (no POS, no menus, no hotel, no Vietnamese tax). Full framework:
`~/Documents/Dev/Projman2/docs/development.md`.

**What I need from you first is identity, not domain.** Projects, safety,
inspections and accounting all come later. Phase 1 is the gate that everything
else waits behind.

---

## 1. Scope of this brief

Port the MAOI identity and sync surface into a ProjMan2 namespace. Concretely,
these existing Nexus route modules are the source material:

| Nexus source (`api/src/routes/`) | Port? | Notes |
|---|---|---|
| `auth.js` | ✅ | register, login, refresh, session status |
| `devices.js` | ✅ | device registry |
| `pairing.js` | ✅ | secondary-device pairing + **roles** |
| `sync.js` | ✅ | push/pull, cursor, conflict |
| `subscriber.js` | ✅ | subscriber/tenant directory |
| `users.js` / `user.js` | ✅ | user profile, membership |
| `businesses.js` / `companies.js` | ⚠️ adapt | becomes the **organisation** (builder company) |
| `staff.js` | ⏸ later | Phase 2 |
| `accounting/`, `tax.js` | ⏸ later | Phase 4 — AU rules, not VN |
| `menu.js`, `items.js`, `table-orders.js`, `dinein-requests.js`, `einvoice-*`, `velo.js`, `portal*.js`, `optima.js`, `personal-expenses.js` | ❌ | out of scope permanently |

## 2. Deployment shape — needs your call

ProjMan2 is a **different product with a different customer base**, so I assume a
separate database rather than new tables inside the FTPOS schema. Proposed:

- **Database:** `c1projman2` (new; the legacy `c1projman` is not migrated)
- **Base URL:** `https://ebizco.com.au/projman/api/v1`, dev `http://10.1.1.21:4100/api/v1`
- **Deployment:** its own service under the Nexus workspace, reusing Nexus
  middleware, auth libraries and DB layer

If you would rather mount it as a namespace inside the existing API, say so — the
app only needs a base URL, so this is entirely your call. **Please confirm the
base URL early**, since it is the one thing that blocks me from testing anything.

## 3. Endpoints required for Phase 1

Paths as the app expects them today (from MAOI's `nexus_service.dart` — reuse the
same shapes and I write less client code).

### 3.1 Registration and login

```
POST /auth/register           create org + first user (Org Admin)
POST /auth/login              email + password → tokens
POST /auth/refresh            refresh token → new access token
GET  /auth/session/status     is this session/device still valid
POST /auth/logout
```

⚠ **`POST /auth/login/cccd` must NOT be ported.** MAOI registers by scanning a
Vietnamese national ID (CCCD) QR. ProjMan2 is Australian. Registration is:

```
organisation:  name, ABN, address, phone, email
first user:    full name, email, password, mobile
```

**ABN validation** matters beyond signup — it drives TPAR contractor reporting and
withholding later. If Nexus can validate against the ABR, do it at registration;
otherwise store and mark unvalidated.

### 3.2 Recovery

```
POST /auth/recovery/request      identify by email → send code
POST /auth/recovery/verify       code → short-lived recovery token
POST /auth/recovery/reset        recovery token + new password
```

MAOI additionally has device-loss recovery — `recovery/full-sync` and
`recovery/site-select`, plus the handoff pair
(`/auth/session/handoff-complete`, `/auth/session/handoff-timeout`). **Port the
device-loss path too.** A site tablet is far more likely to be lost or destroyed
than an office machine, and the ftpos work on this (XF-36, XF-45) already exists.

### 3.3 Device pairing and roles

Port as-is — this is the piece I most want unchanged:

```
POST /pairing/initiate        primary device starts pairing, returns QR payload
POST /pairing/request         new device submits the scanned payload
GET  /pairing/pending         primary polls for requests
POST /pairing/confirm         approve + ASSIGN ROLE
POST /pairing/reject
GET  /pairing/status/:id
GET  /devices                 list org devices, roles, last seen
POST /devices/:id/revoke      kill a lost device
```

**`/pairing/confirm` must carry a role.** ProjMan2 roles:

| Role | Scope |
|---|---|
| `org_admin` | tenant owner — billing, users, settings |
| `project_developer` | creates projects and customers, budgets, approves variations and claims; portfolio financials |
| `project_manager` | runs assigned projects — programme, staff, attendance, safety, inspections; project costs only |
| `supervisor` | site subset — attendance, diary, hazards, defects, photos; no financials |
| `tradie` | own check-in/out and assigned tasks only *(pending — see §6)* |
| `customer` | read-only view of their own project, web only *(pending — see §6)* |

Role is a property of the **device binding**, exactly as in MAOI, so a shared site
tablet holds a role without a shared password. Role must be enforced **server-side**
— the app mirrors permissions for UI, it never substitutes for them.

### 3.4 Sync

```
POST /sync/push               dirty rows up
GET  /sync/pull?since=cursor  changes down
GET  /sync/status
```

Keep MAOI's envelope and cursor semantics unchanged, and keep the
**single-writer-per-entity ownership contract** (ftpos XF-27) — it is the thing
that has kept MAOI's sync honest, and I would rather inherit it than re-learn it.

**Every table carries `org_id`, and the server filters by the token's org on both
push and pull.** Multi-tenant isolation is a server guarantee. The app must not be
able to reach another builder's data even if a client bug asks for it.

Phase 1 needs sync working for `organisations`, `users`, `devices` only. Domain
tables follow in Phase 2 once schema v1 is agreed.

## 4. Data model — Phase 1

```
organisations   id, name, abn, abn_validated, address, suburb, state, postcode,
                phone, email, timezone (default 'Australia/Perth'),
                currency (default 'AUD'), plan, status, created_at
users           id, org_id, email (unique), password_hash, full_name, mobile,
                role, status, last_login_at, created_at
devices         id, org_id, user_id, device_uid, platform, model, app_version,
                role, paired_at, last_seen_at, status
sessions        id, user_id, device_id, access_token, refresh_token,
                issued_at, expires_at, revoked_at
pairing_tokens  id, org_id, initiated_by, payload, role, status,
                expires_at, confirmed_at
recovery_tokens id, user_id, code_hash, purpose, expires_at, used_at
audit_log       id, org_id, user_id, device_id, action, entity, entity_id,
                ip, created_at
```

`audit_log` from day one, please — construction disputes are evidentiary, and
"who marked that stage complete, from which device" is a question that gets asked
in anger months later.

## 5. Acceptance — how I will test

Phase 1 is done when, against the dev base URL, I can:

1. Register a new builder org and receive a working session.
2. Log in and refresh; an expired access token refreshes without re-login.
3. Reset a forgotten password end to end.
4. Pair a second device by QR, confirm it **as `supervisor`**, and see the role
   returned in that device's session.
5. Revoke that device from the primary and watch its next call fail.
6. Push and pull `organisations` / `users` / `devices` and see the cursor advance.
7. Confirm **isolation**: a token from org A cannot read or write org B — please
   include this as a server test, not just a client observation.

A Postman/curl collection or a short `curl` transcript per endpoint would let me
build the client against something concrete before the app compiles.

## 6. Open questions for you

1. **Separate database and service, or a namespace inside the existing API?** My
   assumption is separate — confirm.
2. **Dev base URL and port** — blocks my client work.
3. **Tradie and customer logins** — in Phase 1, or deferred? Affects whether
   pairing needs a self-service path. My assumption is deferred; supervisors record
   attendance in v1.
4. **Password rules, lockout, MFA** — do we inherit the FTPOS policy or set our own?
5. **ABN validation against the ABR** — available to you, or store-and-flag?
6. **Legacy `c1projman`** — I am assuming no migration. Confirm nothing there needs
   to survive.

## 7. Not in scope

Projects, stages, tasks, site diary, attendance, safety, inspections, defects,
estimating, quotes, purchase orders, supplier invoices, progress claims, ledger,
GST/BAS, TPAR, payroll. All specified in `docs/development.md` and briefed
separately once Phase 1 is testable.

---

**Reference:** MAOI = the `maoi` build flavour of `~/Documents/Dev/ftpos`
(`--dart-define=APP_VARIANT=maoi`). It is not `~/Documents/Dev/maoi`, which is the
marketing website.
