# ProjMan — Admin & Monitoring Dashboard Design Specification

**Status:** 🟡 BUILT, PARTIAL against this spec. Re-baselined 2026-10-14 against the code
(c1projman2 at v047). The core (v007 schema, allowlist, `/admin/*` endpoints, login log,
billing) is built, and `tests/admin.test.js` has 18 checks. Two later additions were
built without being specced: the **platform roles** (v011) and the **platform Finance
module** (v031/v032/v036, eBizco's own books). **§13 is the build-status table, and §14
lists the gaps and risks.** Where §1–§12 and §13 disagree, §13 describes the code.
§1–§12 remain the approved design.
**Date:** 27 July 2026 (design) · 14 October 2026 (re-baseline, §13–§15)
**Author:** Server dev (NexusPM)
**Reviewer:** owner (eBizco)
**Companion docs:** `portaldesignspecification.md` (the tenant desk console) ·
`serverdesignspecification.md` (server/API) · `veritradedesignspecification.md`
(a third, unrelated public product — see §0) · `devroadmap.md` (roles, phases)

> This spec covers a **separate surface** from the tenant desk console (**Portal** —
> the Project Manager's, and every other desk role's, construction workspace). This is
> the **System Admin (eBizco platform) interface**: manage platform users, watch the
> login transaction log and authentication activity, and run **fee-paying / SaaS
> billing**. It shows **identity, account, and billing data across all tenants — never
> project/construction data** (that stays in Portal), and each **tenant's own**
> org-admin (their users/devices/settings/audit) lives in **Portal**, not here.
>
> **Refined 2026-07-23 (owner):** this is a **single-tier platform surface** — the
> System Admin (eBizco). The earlier two-tier "tenant admin sees their org" idea is
> dropped: an org's admin manages their own org in **Portal's** Admin module
> (`portaldesignspecification.md`). And **fee-paying is a real module here** (§5.4), not
> a placeholder.
>
> **The hard boundary (owner):** the dashboard has **nothing to do with projects OR
> user content.** It touches the **account layer only** — user *accounts* (registration,
> identity, auth, status, suspension), login/auth events, device pairing status, and
> billing. It never reads a site diary, a photo, a document, a cost plan, or any
> construction data. "Manage the user" here means the **account**, not their work. If a
> query would return domain content, it does not belong on this surface.

---

## 0. Three surfaces sometimes confused with each other — read this first

This project's naming has collided across three genuinely different products more
than once; stated plainly, so this document is never mistaken for either of the
others:

| Surface | Who sees it | What it's for |
|---|---|---|
| **Portal** | Tenant users — PM, Builder, Property Developer, Site Supervisor, Inspector, Client | Running a construction project. Construction/project content lives here, never on the admin dashboard. |
| **This Dashboard** | eBizco's own platform-ops team only, via a `platform_admins` allowlist | Account and billing administration across every tenant. Never construction content, never tenant-facing, never publicly reachable. |
| **VeriTrade** | The public — B2B trade-vetting network | A standalone, public-facing product entirely unrelated to this dashboard. Fed by Portal/App evidence, authenticated through the App, never through this admin surface. |

Nothing below concerns VeriTrade at all — it's listed here only so a reader of this
set of documents never conflates "platform admin dashboard" with "public-facing
product."

**Terminology.** "System Admin" = an **eBizco platform operator**, NOT a tenant
construction role — it must not enter the tenant role registry (§2/§3). The brief's
"Org Admin" (a tenant managing their own org) is **not a dashboard user at all** —
that is `projectManager` working in **Portal's** Admin module. The dashboard is
platform-only.

---

## 1. Scope & audience

| | |
|---|---|
| **Purpose** | **Account & billing administration** for the eBizco platform: manage user *accounts*, watch login/auth activity, and run fee-paying/SaaS billing. |
| **Audience** | **System Admin only** — eBizco platform operators / support. (Not tenant users; an org admin self-serves in **Portal**.) |
| **Shows** | User accounts (by role/status), registration + login/auth activity, device pairing status, the login transaction log, subscription/plan/fee status, revenue, system health. |
| **Does NOT show** | **Anything a user created or any project data** — no diaries, photos, documents, cost plans, stages, tasks. **Account layer only.** |
| **Surface** | A **new mount `/admin/*`**, distinct from the tenant `/api/v1/*`. Its own auth middleware; a gated route group of the same Next.js app (`/admin/*`, per the Portal spec §2). |

---

## 2. The architectural decision — a platform-only surface (read this first)

The dashboard is **entirely a cross-tenant platform surface** (System Admin only), so
two constraints from the existing architecture shape it:

**(a) `org_id` isolation is the platform's core guarantee.** Every tenant query filters
on the token's `org_id`; `isolation.test.js` (16/16) proves nothing crosses the org
boundary, and the server spec forbids cross-org endpoints "until `PM2-02` is BUILT."
This dashboard is the **first legitimate cross-tenant read** in the system — it exists
precisely to look across orgs. That makes its containment critical: it lives on a
**separate mount**, is **read-only for the account layer** (its only writes are billing),
touches **no domain content**, and **audits every view**.

**(b) The tenant role registry is tenant-scoped construction roles** — Property
Developer, Project Manager, Builder, Site Supervisor, Foreperson, Tradie, Inspector,
Client, plus the post-v1 roles (`devroadmap.md` §3). They describe who does what
*inside one Builder's project*. A platform operator (eBizco) is a different kind of
principal. Putting `sys_admin` into the `roles` table would leak a cross-tenant
superuser into the pairing shortlist, the assignable-role list, and the construction
permission matrix.

**The design:**

1. **A separate `/admin/*` mount** with its own `adminAuthenticate` middleware — it
   never touches the tenant `org_id`-from-token filter; it is cross-tenant by design and
   contained by the allowlist below.
2. **One tier: System Admin.** Access = membership of a **`platform_admins` allowlist**
   (not a tenant role, not a tenant permission). Every `/admin/*` caller must be on it;
   everyone else gets 403. There is **no tenant tier** — an org admin uses Portal.
3. **`sys_admin` is NOT added to the `roles` table.** Platform-admin status is a
   `platform_admins` row (`user_id`, `granted_by`, `created_at`), provisioned out-of-
   band (seed/CLI), never via tenant user-management, never device-pairable.
4. **Every cross-tenant read is itself audited.** A platform admin viewing a tenant's
   data writes an `audit_log` row (`admin.view`, the org viewed) — the watchers are
   watched. Read-only: the admin dashboard never mutates tenant construction data.

This makes the platform view a **narrow, auditable, read-only exception** rather than a
weakening of isolation — and leaves the construction role model untouched.

---

## 3. Permission & access model

**✅ BUILT + verified 2026-07-24 (migration_v011 addendum).** The dashboard stays a
**single platform TIER** exactly as designed below (a `projectManager` still has zero
reach here) — what's new is three **admin-team roles WITHIN that one tier**, so a
System Admin operator is no longer all-or-nothing:

| `admin_role` | Reach |
|---|---|
| `admin` | Every `/admin/*` endpoint (the original single-tier behaviour) |
| `account` | Money — `orgs`, `billing/*` (subscriptions/revenue/payments/plan changes) — plus user account actions (suspend/reactivate/force-logout) |
| `staff` | User account actions (suspend/reactivate/force-logout) plus the login transaction log (`logs/login`, export) |

`stats` is common ground — all three roles reach it; `devices` and `system/health`
are `admin`-only. Enforced by `requireAdminRole(...roles)` (`middleware/adminAuth.js`),
one call per route in `routes/admin.js`, each route listing every role that may reach
it explicitly (no implicit superset, so the route file is the whole story).
`platform_admins.admin_role` defaults to the least-privileged `staff` — a bare INSERT
never silently grants full access. `GET /admin/me` reports `{ userId, role }`.

**Full cross-tenant account directory** (`GET /admin/users` — names, emails, orgs) is
**`admin`-only**, even though `account`/`staff` still hold the user-account **action**
(`POST /users/:id/(suspend|reactivate|force-logout)`, which itself returns no PII —
just `{userId, action}`). The `account`/`staff` Accounts page is a narrow act-by-id
form (paste a user id from a support ticket, choose an action) — never a browsable
list.

**Kept separate:** a merge into one shared `PortalNav` sidebar was tried and reverted —
cramming the tenant PROJECTS/SITE/COMMERCIAL/ORGANISATION groups and the platform
Overview/Accounts/Devices/Organisations/Billing/Login-Log group into one sidebar read
as crowded. The System Admin dashboard keeps its **own** dedicated sidebar
(`admin/layout.js`, a plain `<aside>` + `NAV` list filtered by `admin_role`, still
mirroring `routes/admin.js`'s `requireAdminRole(...)` lists exactly) — visually and
structurally separate from the tenant Portal's `PortalNav`, not a shared component. It
also has its **own entry point**, `/admin/login` (`admin/login/page.js`) — a different
front door onto the exact same identity/auth as the app and Portal (one JWT, one
`POST /auth/login`; not a second auth system), landing on `/admin` on success. It
confirms the account actually holds a `platform_admins` row before entering — a valid
tenant login that isn't a platform admin sees a clear message on that page, rather than
a silent bounce, and keeps its (still valid) tenant session. **Portal has nothing to do
with admin/account/staff of the Platform Management Team** — `PortalNav.js` and
`(console)/layout.js` carry zero reference to `admin_role` or `adminApi` (verified).
The split is total: separate nav, separate login, separate layout — the only thing
shared is the underlying identity/auth (one JWT, one `users` table), which is by
design (same as the App).

| Principal | How identified | Dashboard access |
|---|---|---|
| **System Admin** (`admin`/`account`/`staff`) | row in `platform_admins`, `admin_role` column | Per the table above — all orgs, scoped `/admin/*` endpoints |
| **Everyone else** (any tenant role) | — | **No access** (403) — org-admin is done in Portal |

- Access is the **`platform_admins` allowlist**, full stop — not a tenant role, not a
  tenant permission (no `admin.dashboard.view` on the construction matrix). This keeps
  the tenant role registry untouched; `admin_role` is a platform-tier-internal
  refinement, not a second tenant-facing tier.
- `adminAuthenticate` verifies the JWT, then checks `platform_admins`; a hit sets
  `req.admin = { userId, role }`.
- Provisioning is an **out-of-band CLI** step —
  `scripts/grant-platform-admin.js <email> --role=admin|account|staff` (defaults to
  `admin`, the pre-v011 behaviour) — never through tenant sign-up or user-management.
  `scripts/seed-admin-team.js` seeds one of each role under a dedicated
  "eBizco Platform Ops" organisation (a technical home for the `users.org_id` FK — these
  accounts never touch tenant/construction data, only `/admin/*`, which is cross-tenant
  by design and ignores `org_id`).

---

## 4. Data sources — mapped to the actual schema

| Field | Reality in `c1projman2` | Action |
|---|---|---|
| `organisations` (count, trend, plan, trial) | ✅ exists — `plan`, `trial_ends_at`, `created_at` | use as-is |
| `users` (count, role, status, created_at) | ✅ exists | use as-is |
| `auth_identities.provider` / `.identifier` | ✅ `provider`, `provider_sub`, **`email`** (not `identifier`) | map `identifier → email` |
| `sessions` (active, device_info) | ✅ `sessions` — `ip_address`, `user_agent`, `device_id`, `revoked_at`, `expires_at` | use; "active" = `revoked_at IS NULL AND expires_at > NOW()` |
| `devices` (count, role, status, last_seen) | ✅ exists — `role`, `status`, `last_seen_at` | use as-is |
| `pairing_tokens` (pending/confirmed/rejected) — see also `introductions`/`job_awards` per the corrected identity model, `serverdesignspecification.md` §7.3 | ✅ exists — `status` enum | use as-is |
| `audit_log` (login txns, IP, device, outcome) | ✅ has `ip`, `device_id`, `detail` JSON, `action`, `created_at` — **no `user_agent` column** | see gap ↓ |
| `payments`, `licenses` | ❌ **do not exist** | payment metrics are **placeholders** (Open Decision #2) |
| `sync_queue`, `sync_log` | ❌ — we have **`sync_history`** (push/pull cycles + `status` + `error_message`) | use `sync_history` for sync health |
| Geolocation (IP → city) | ❌ not stored — IP is raw | add local resolution (§6) |

**Gaps to close (migration_v007 + small server work):**
1. **`user_agent` on auth events.** `audit_log` records `ip` + `device_id` but not the
   user agent (it lives only in `sessions`, and only for *successful* logins). → add
   `user_agent` to `audit_log`.
2. **Failed-login completeness.** `auth.login_failed` **is** already audited for a wrong
   password. The *unknown-email* path returns without an audit row (deliberate
   non-disclosure) — optionally log those with `reason=unknown_user`, flagged as a
   privacy trade-off.
3. **Geolocation.** Resolve `ip → city/region/country` (§6). No column needed if
   resolved at read time; optionally cache onto the audit row.
4. **`platform_admins` table** (§2/§3).

---

## 5. Metrics & views (mapped to real tables)

All queries here are cross-tenant (all orgs) and touch only the **account layer** —
counts, statuses, auth events, billing — never a row of construction content.

### 5.1 User-account statistics
| Metric | Query |
|---|---|
| Total user accounts (all orgs) | `COUNT(*) users WHERE is_deleted=0` |
| Accounts by role | `GROUP BY role` — bar/pie, *counts, not content* |
| New accounts (7/30d) | `WHERE created_at >= …` + trend |
| Accounts by status | `GROUP BY status` (active/suspended/disabled) |

**Account actions the System Admin can take** (account layer only): suspend / reactivate
/ disable an account, force-logout, trigger a password reset. *Not* edit a user's work,
projects, or org content.

### 5.2 Authentication & registration
| Metric | Query |
|---|---|
| Registered orgs (platform) | `COUNT(*) organisations` |
| Registration trend (30/90d) | `organisations.created_at` line |
| Login success/fail | `audit_log WHERE action IN ('auth.login','auth.login_failed')` counts + trend |
| Login by method | join `auth_identities.provider`; email logins have no identity row → bucket "email" from `auth.login` detail |
| Active sessions | `sessions WHERE revoked_at IS NULL AND expires_at > NOW()` |
| Password resets (7/30d) | `audit_log WHERE action='recovery.password_reset'` (or `recovery_tokens`) |

### 5.3 Device & pairing
| Metric | Query |
|---|---|
| Total paired devices | `COUNT(*) devices WHERE is_deleted=0` |
| Devices by role / status | `GROUP BY role` / `GROUP BY status` |
| Pairing requests | `pairing_tokens GROUP BY status` (pending/requested/confirmed/rejected/expired) |
| Active in 24h | `devices WHERE last_seen_at >= NOW()-INTERVAL 1 DAY` |

### 5.4 Fees & billing — a real module

This is SaaS billing: **eBizco charging the tenant organisations** for ProjMan — not
construction payments (and not VeriTrade's own B2B subscription billing, which is a
separate commercial system owned by VeriTrade itself). It needs a small billing schema
(§10) since `payments`/`licenses` don't exist yet:

| View / action | Data |
|---|---|
| Subscriptions (active/trial/past_due/cancelled) | `subscriptions` (new) — one per org, plan + status + period |
| Plan distribution | `organisations.plan` / `subscriptions.plan` |
| Trials expiring (30d) | `organisations.trial_ends_at` (exists now) |
| Payment status per org (paid/overdue/failed) | `payments` (new) — per-invoice status |
| Record a payment / change a plan / extend a trial | System-Admin **writes** on `subscriptions`/`payments` (the dashboard's only writes) |
| Revenue (MRR, monthly/yearly) | `SUM(payments)` + chart |
| Overdue list | `payments WHERE status='overdue'` → chase list |

Payment *capture* (a gateway — Stripe et al.) is out of scope for the schema itself;
v1 can be **manual reconciliation** with a gateway wired later.

### 5.5 Login transaction log — the key operational view (§6)

### 5.6 System health — platform-only, v1-lite
| Metric | Source |
|---|---|
| API status | `/internal/health` (exists) — MySQL reachable |
| Sync activity / errors | `sync_history` — recent rows, `status='failed'` + `error_message` |
| (uptime, queue depth) | needs a monitoring service — deferred |

---

## 6. The login transaction log

A chronological, filterable list of every authentication event — the most important
operational/support view.

**Row** (one per relevant `audit_log` action):
| Field | Source |
|---|---|
| Timestamp | `audit_log.created_at` (rendered in viewer local time) |
| User (email) | `users.email` via `audit_log.user_id`; for failures, the attempted email from `detail` |
| Organisation | `organisations.name` via `audit_log.org_id` (always shown — cross-tenant view) |
| Method | Google/Microsoft/Facebook/Email — from the action + `auth_identities.provider` |
| IP | `audit_log.ip` |
| Geolocation | `ip → City, Region, Country` (§6.1) |
| Device / OS | `devices.device_name` + `platform`/`os_version` via `device_id`; `user_agent` once added |
| Outcome | `auth.login` = Success · `auth.login_failed` = Failed (+ reason from `detail`) |

**Actions surfaced:** `auth.login`, `auth.login_failed`, `auth.oauth_login`,
`auth.oauth_register`, `auth.register`, `auth.logout`, `recovery.*`, `pairing.confirm`,
`device.revoke`. **Explicit auth events**, not intermediate OAuth redirects — OAuth is
token-exchange, so there are no server-side redirects to log. **VeriTrade login
approvals (`serverdesignspecification.md` §7.4) are a separate event stream on
VeriTrade's own side, not surfaced here** — this log is ProjMan tenant auth only.

### 6.1 Geolocation — local GeoLite2, not an external API
IP is personal information under the AU Privacy Act, and the server spec commits to AU
data residency. Sending user IPs to an external service ships PII offshore — a
residency/privacy regression. **Recommendation: MaxMind GeoLite2 as a local database
file**, resolved server-side at read time (no outbound call, nothing leaves
`ap-southeast-2`). Optionally cache the resolved city onto the audit row.

---

## 7. API endpoints — `/admin/dashboard/*`

All under the `/admin/*` mount with `adminAuthenticate` — **System Admin only**, all
cross-tenant. `org_id` is an optional *filter* here (narrow to one org), never a
security boundary.

| Endpoint | Purpose |
|---|---|
| `GET /admin/stats` | summary counts + trends (§5.1–5.3), all orgs |
| `GET /admin/users?role=&status=&org_id=&page=` | user-account list |
| `POST /admin/users/:id/suspend` · `/reactivate` · `/force-logout` | account actions (account layer only) |
| `GET /admin/devices?status=&role=&org_id=&page=` | device list + status |
| `GET /admin/logs/login?from=&to=&email=&org_id=&outcome=&method=&page=` | login transaction log |
| `GET /admin/logs/login/export?…` | same filters → CSV stream |
| `GET /admin/orgs?page=` | org directory (registration, plan, counts) |
| `GET /admin/billing/subscriptions?status=&page=` | subscriptions + plan/trial/payment status (§5.4) |
| `GET /admin/billing/revenue` | MRR + revenue chart + overdue list |
| `POST /admin/billing/payments` · `PATCH /admin/orgs/:id/plan` | record a payment / change a plan (the dashboard's only writes) |
| `GET /admin/system/health` | API + sync health |

Response envelope: `{ success, data }`, pagination `{ page, pages, total }`.

---

## 8. Filtering, pagination, export

- **Filters:** date range (logs/registrations/logins), user email (logs/devices),
  organisation (narrow to one org), outcome (success/fail), method (provider).
- **Pagination:** server-side, reuse the tenant `{ page, pages, total }` shape.
- **Export:** CSV stream for the login log and reports, same filters as the view;
  streamed so a 12-month export doesn't buffer in memory.

---

## 9. UI layout (high-level)

A **clean, data-dense admin theme — deliberately not construction-themed** (this is ops,
not site work). Reuses the ported Portal kit (`PortalCard`/`PortalKpi`/`PortalTable`/
`PortalPagination`/`usePortalData`) but on a neutral admin palette, in its own route
group (`/admin`) separate from the tenant Portal shell.

```
┌───────────────────────────────────────────────────────────────┐
│  ProjMan System Admin              [Org: All ▾]  [Billing]  🔄60s │  topbar: org filter + billing
├───────────────────────────────────────────────────────────────┤
│  KPI ROW  ┌ Users ┐ ┌ Orgs ┐ ┌ Active sessions ┐ ┌ MRR ┐       │  cards from /stats + /billing
├───────────────────────────────────────────────────────────────┤
│  CHARTS   [ Accounts by role (bar) ]  [ Login method (pie) ]   │  charts middle
│           [ Registration trend (line, 90d) ]                   │
├───────────────────────────────────────────────────────────────┤
│  LOGIN TRANSACTION LOG                                          │  table bottom
│  [ from ][ to ][ email ][ org ][ outcome ][ method ] [Export]  │  filters
│  time · user · org · method · IP · location · device · outcome │
│  … paginated …                                                 │
└───────────────────────────────────────────────────────────────┘
```

- **Auto-refresh 60s** (configurable), manual refresh button.
- **Responsive:** desktop primary, tablet secondary.
- **Charts** follow the `dataviz` design system at build time.
- Single System-Admin surface: an **org filter** (narrow to one org), the always-on
  Organisation column, the **Billing** area, and the system-health panel.

---

## 10. Schema/audit work to close the gaps (migration_v007)

```
platform_admins   id, user_id (FK users), granted_by, note, created_at
                  -- the System-Admin allowlist; seed/CLI provisioned, NOT a role.

audit_log        + user_agent VARCHAR(255) NULL   -- device/OS per auth event
                                                   -- (was only in sessions, success-only)

-- Billing (SaaS: eBizco → tenant orgs). A real module, not a placeholder (§5.4).
subscriptions     id, org_id (FK), plan, status(trial|active|past_due|cancelled),
                  period_start, period_end, amount, currency('AUD'), created_at
payments          id, org_id (FK), subscription_id, amount, currency, status
                  (paid|overdue|failed|refunded), method, paid_at, period, note, created_at
```
NB: **no `admin.dashboard.view` on the construction matrix** — dashboard access is the
`platform_admins` allowlist (§3), so the tenant role registry is untouched.

Plus: capture `user_agent` into audit on auth actions; (optional) log unknown-email
login failures; ship the GeoLite2 file + a `lib/geo.js` resolver; a retention job
pruning `audit_log` older than 12 months (AU Privacy Act).

---

## 11. Open decisions

| # | Open decision | Recommendation |
|---|---|---|
| 1 | Geolocation provider | **GeoLite2 local** (residency; §6.1) |
| 2 | Billing in v1 | **Yes — real module.** Schema + views/actions now; gateway later. Manual reconciliation acceptable for v1. |
| 3 | System Admin as a role? | **No — a `platform_admins` allowlist, not a tenant role** (§2). Keeps the tenant construction matrix clean and isolation honest. |
| 4 | Refresh interval | **60s auto + manual button** |
| 5 | Log retention | **12 months** + a prune job (AU Privacy Act) |
| 6 | Payment gateway | Out of v1 schema — **manual reconciliation** first; Stripe/eWAY wired when billing goes live. |

**Answers on record:**
- **IP/user-agent/device capture** — IP ✅, device ✅, user agent ✗ (add per §4 gap 1).
- **Geolocation provider** — local GeoLite2, no PII leaves AU.
- **Auth events logged** — explicit events only (login, failed login, register, logout,
  recovery, key device actions); no OAuth redirects to log (token-exchange model).
- **Payments in v1** — yes, a real billing module; gateway capture can start manual.

---

## 12. Build order

| Step | Deliverable | Depends on |
|---|---|---|
| 1 | migration_v007: `platform_admins`, `audit_log.user_agent`, `subscriptions` + `payments` | — |
| 2 | `adminAuthenticate` (allowlist check) + every-view auditing | 1 |
| 3 | `AdminService` — stats / user-accounts / devices / login-log queries (cross-tenant, account-layer only) | 1–2 |
| 4 | `/admin/*` routes: stats, users (+account actions), devices, logs | 3 |
| 5 | `lib/geo.js` (GeoLite2) + capture `user_agent` on auth events | 1 |
| 6 | **Billing**: `BillingService` + `/admin/billing/*` (subscriptions, revenue, record-payment, change-plan) | 1 |
| 7 | Admin web app (route group `/admin/*`): KPI row + charts + login-log table + filters + export + billing views | 4, 6 |
| 8 | System health + org directory | 4 |
| 9 | Retention prune job; `tests/admin.test.js` — **allowlist gate, and that NO endpoint returns project/user content** | 4, 6 |

Steps 1–4 are the spine; the test in step 9 is non-negotiable — it must prove
`/admin/*` is reachable **only** by the `platform_admins` allowlist, and that **no
`/admin/*` endpoint ever returns project or user content** (the account/billing boundary).

---

## 13. Build status — re-baselined against the code (2026-10-14)

Checked file by file against `server/api/src/routes/admin.js`, `AdminService.js`,
`BillingService.js`, `FinanceService.js`, `lib/audit.js`, `lib/geo.js` and
`server/dashboard/src/app/admin/*`. ✅ built · 🟡 partial · ❌ not built.

| Spec item | Status | Notes |
|---|---|---|
| §2 allowlist, separate `/admin/*` mount, `sys_admin` not a tenant role | ✅ | `platform_admins` (v007), `admin_role` (v011) |
| §2(4) **every cross-tenant view audited** | 🟡 | Audited: the org-filtered login log, the export and org payments. **Not audited:** `/users`, `/orgs/:id`, `/devices`, `/stats`. |
| §5.1 account stats | ✅ | totals, by role, by status, new 7/30d |
| §5.1 suspend / reactivate / force-logout | ✅ | `POST /users/:id/:action` |
| §5.1 **disable** account, **trigger password reset** | ❌ | `users.status='disabled'` exists and login honours it, but no admin action sets it |
| §5.2 org count, login success/fail, by method, active sessions | ✅ | counts only, no series |
| §5.2 registration trend (30/90d), password resets (7/30d) | ❌ | not returned by `stats()` |
| §5.3 devices total, active 24h | ✅ | |
| §5.3 devices by role/status, pairing requests by status | ❌ | no `pairing_tokens` query |
| §5.4 billing: subscriptions, plan change, record payment, MRR, overdue, trials | ✅ | `BillingService`; UI `finance/sales`, `orgs/[id]` |
| §5.6 system health API | ✅ | `GET /admin/system/health` |
| §5.6 system health **panel** | ❌ | `adminApi.health` is never called by any page |
| §6 login transaction log (rows, actions, outcome, method, device) | ✅ | `/admin/logs` page |
| §6 `user_agent` | 🟡 | captured on audit rows (v007), not shown in the UI or the CSV |
| §6.1 GeoLite2, local | 🟡 | `lib/geo.js` built, no outbound calls; **off unless `GEOLITE2_DB` + `maxmind` are installed**, so location is null today |
| §7 endpoints | ✅ | plus `/me`, `/stats/activity`, `/orgs/:id`, `/orgs/:id/payments`, `/finance/*` (§15) |
| §8 filters | 🟡 | the API accepts them all; the UI has no org filter on the log, no role/org filter on users, search only on devices |
| §8 export | 🟡 | login log only; buffered (capped at 100k rows), not streamed |
| §9 KPI row, role + method charts | ✅ | method is a bar, not a pie |
| §9 **60s auto-refresh** + manual refresh | ❌ | fetches once |
| §9 org filter in the top bar | ❌ | no top bar |
| §9 registration trend line (90d) | ❌ | an hourly sessions chart stands in its place |
| §10 schema | ✅ | v007 |
| §10 **12-month `audit_log` prune job** | ❌ | none anywhere in `server/` |
| §10 log unknown-email failures (optional) | ❌ | `auth.js` returns without an audit row |
| §12 step 9 tests | 🟡 | 18 checks incl. the allowlist gate and the content boundary; **none test the `account`/`staff` 403 limits** |

## 14. Gaps, risks and the "ready" bar

**The "ready" bar (proposed to the PM 2026-10-14):** G1–G5 below + the two legal fixes
L1–L2. Everything else is tracked, not blocking.

| # | Gap | Size |
|---|---|---|
| G1 | System-health panel (API exists; add the page incl. recent `sync_history` failures) | ✅ **Done 2026-10-14:** `/admin/health` (admin), 60s refresh |
| G2 | 60s auto-refresh + manual refresh button on overview and log (§11 #4) | ✅ **Done 2026-10-14:** `usePortalData` `refreshMs` + `RefreshBar` (overview, log, health) |
| G3 | `disable` and `password-reset` account actions (`admin`, `staff`), audited, no PII in the response | ✅ **Done 2026-10-14:** `POST /admin/users/:id/(disable\|password-reset)`. Disable ends sessions and blocks login and recovery; reset emails the user the standard recovery code (support never sees it) |
| G4 | `audit_log` retention prune: 12 months (§11 #5), as a script run daily, with a dry-run flag | ✅ **Done 2026-10-14:** `scripts/prune-audit-log.js`. **Dry run is the default** (prints the cutoff and counts per action); `--apply` deletes; never shorter than 12 months. **Not scheduled**: when to schedule it daily is the Owner's call at production |
| G5 | Registration trend: a daily series in `stats()` + line chart (30/90d) | S |
| G6 | Audit every cross-tenant view (§2(4)): `/users`, `/orgs/:id`, `/devices`, `/stats` | S |
| G7 | Tests for the `account`/`staff` 403 limits | S |
| G8 | Pairing/device breakdowns (§5.3), password-reset counts (§5.2) | S |

**Legal / security risks (flagged to the PM):**

| # | Risk | Why it matters | Fix |
|---|---|---|---|
| L1 | **No `audit_log` retention**. ✅ Tooling done (G4); scheduling is open | The 12-month retention this spec commits to (APP 11.2, destroy PII no longer needed) is not enforced; IPs, emails and devices accumulate indefinitely | G4 |
| L2 | **Platform payroll is not compliant** (§15.2) | Salary runs pay the annual figure; PAYG/super are hand-typed and in practice 0; no PAYG/super liability postings; no STP. The P&L's "PAYG withheld" / "BAS payable" figures rest on these. | Freeze the payroll page for real pay runs until fixed, or replace with an external payroll product (the Owner decides) |
| L3 | `staff` can bulk-export the cross-tenant login log (emails, IPs, orgs) | It contradicts the "non-admin roles act by id only" rule in spirit; the export is audited, but the unfiltered view is not | ✅ **Fixed 2026-10-14:** export is `admin`-only (API + button hidden). Open: `staff` still *views* emails/IPs in the log, see below |
| L4 | CSV formula injection in the export | Tenant-controlled org names starting with `= + - @` run as formulas in Excel | ✅ **Fixed 2026-10-14:** cells starting `= + - @ \t \r` are prefixed with `'` |
| L5 | `audit.js` trusts the first `X-Forwarded-For` value | IP evidence in the log is spoofable | ✅ **Fixed 2026-10-14:** `clientIp` = `req.ip` |
| L6 | `scripts/seed-admin-team.js` hardcodes and prints a known password | Run against prod, it creates known credentials | ✅ **Fixed 2026-10-14:** refuses in production; new accounts get random one-time passwords. **Accounts already seeded on the lab keep the old password: rotate them** |
| L7 | Admin-action audit rows carry the admin's own `org_id`, not the target user's | Per-tenant audit trails miss actions taken on their users | ✅ **Fixed 2026-10-14** |

**Open after L3 (for the PM/Owner):** the Admin Privacy Rule says non-admin platform roles never
see tenant user PII, but `staff`'s core screen, the login log, shows emails and IPs. Options:
mask them for `staff` (e.g. `j***@domain`, IP truncated to /24) and keep full detail for `admin`,
or make the log admin-only.

Also stale: the overview page text says "ProjMan2 has no MQTT broker", but MQTT was
reintroduced (`AdminService.js` comment). §4's "`payments` ❌ do not exist" row is superseded
by v007.

## 15. Built but previously unspecified

### 15.1 Platform roles (v011) — as built

`platform_admins.admin_role ∈ {admin, account, staff}`. The column default is `staff`;
`grant-platform-admin.js` defaults to `admin`.

| Endpoint group | admin | account | staff |
|---|---|---|---|
| `/me`, `/stats`, `/stats/activity` | ✓ | ✓ | ✓ |
| `POST /users/:id/{suspend,reactivate,force-logout}` | ✓ | ✓ | ✓ |
| `GET /users` (directory, PII) | ✓ | – | – |
| `/devices`, `/system/health` | ✓ | – | – |
| `/orgs*`, `/billing/*`, `PATCH /orgs/:id/plan`, `/finance/*` | ✓ | ✓ | – |
| `/logs/login`, `/logs/login/export` | ✓ | – | ✓ |

The PII rule in §3 (non-admin platform roles act by id, no directory) holds for `/users`
only. `staff` reads the login log (emails, IPs) and
`account` sees org details and payroll staff names/rates (L3).

### 15.2 Platform Finance — eBizco's own books (v031, v032, v036)

**Whose books:** eBizco as the SaaS operator. The tables have **no `org_id`** by design
(`fin_accounts` tree, `fin_journal`, `fin_expenses`, `fin_staff`, `fin_payroll`,
`fin_payroll_items`). This is separate from the per-tenant `org_accounts`/`org_journal`
(v042/v044, `serverdesignspecification.md`), and separate from tenant payroll, which stays
**cancelled** (server spec §12).

| Feature | Status | Notes |
|---|---|---|
| Chart of accounts (3-level tree) | ✅ | `POST /finance/accounts` has no UI |
| Expenses → journal (Dr expense / Cr Cash, incl. tax) | ✅ | |
| Subscription payment → journal (Dr Cash / Cr Subscription Revenue) | 🟡 | fire-and-forget, outside the payment's transaction; a failure is only logged |
| P&L, Balance Sheet (live from the journal), GST/PAYG/BAS summary | 🟡 | GST assumes every subscription receipt is GST-inclusive (`/11`); no tax invoice is produced |
| Payroll runs | ⚠️ **Not fit for real pay runs** | see below |

**Payroll as built** (`FinanceService.createPayrollRun`, `markPayrollPaid`):
- salary: `gross = fin_staff.rate`, and v031 defines `rate` as the **annual salary**, so each
  run pays a year's salary;
- hourly: `gross = Σ hours × rate_factor × rate`;
- `tax` and `super_amount` are request fields; the UI never sends them, so they are 0;
- paying a run posts Dr Wages Expense / Cr Cash for **net** only: no PAYG-withholding
  liability, no super liability or expense (the `Superannuation` account is unused);
- no PAYG withholding tables, no Super Guarantee rate, no TFN, no super fund, no STP Phase 2.

Treat this as a **ledger-entry convenience, not a payroll system**, until the Owner decides
between fixing it properly (pay-period proration, ATO withholding schedules, SG, STP via a
gateway) or using an external payroll product and importing the journal (L2).

---

© eBizco Australia Pty Ltd
