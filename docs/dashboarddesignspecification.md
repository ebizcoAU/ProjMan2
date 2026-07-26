# ProjMan2 — Admin & Monitoring Dashboard Design Specification

**Status:** ✅ BUILT + verified 2026-07-24 (migration_v007 + admin server + admin UI).
`tests/admin.test.js` 18/18 — incl. the allowlist gate and the boundary proof that no
`/admin/*` endpoint returns project/user content. Design below was approved; this
header marks it delivered.
**Date:** 2026-07-23
**Author:** Server dev (NexusPM)
**Reviewer:** owner (eBizco)
**Companion docs:** `servdesignspecification.md` (the tenant web console & server) ·
`docs/decisions/projman-01.md` (wire contract) · `projman-04.md` (server progress).

> This spec covers a **separate surface** from the tenant web console
> (`server/dashboard`, the Project Manager's construction workspace). This is the
> **System Admin (eBizco platform) interface**: manage platform users, watch the login
> transaction log and authentication activity, and run **fee-paying / SaaS billing**.
> It shows **identity, account, and billing data across all tenants — never
> project/construction data** (that stays in the tenant portal), and each **tenant's
> own** org-admin (their users/devices/settings/audit) lives in the **portal**, not
> here.
>
> **Refined 2026-07-23 (owner):** this is a **single-tier platform surface** — the
> System Admin (eBizco). The earlier two-tier "tenant admin sees their org" idea is
> dropped: an org's admin manages their own org in the **portal Admin module**
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

## 1. Scope & audience

| | |
|---|---|
| **Purpose** | **Account & billing administration** for the eBizco platform: manage user *accounts*, watch login/auth activity, and run fee-paying/SaaS billing. |
| **Audience** | **System Admin only** — eBizco platform operators / support. (Not tenant users; an org admin self-serves in the **portal**.) |
| **Shows** | User accounts (by role/status), registration + login/auth activity, device pairing status, the login transaction log, subscription/plan/fee status, revenue, system health. |
| **Does NOT show** | **Anything a user created or any project data** — no diaries, photos, documents, cost plans, stages, tasks. **Account layer only.** |
| **Surface** | A **new mount `/admin/*`**, distinct from the tenant `/api/v1/*`. Its own auth middleware; a gated route group of the same Next.js app (`/admin/*`, per the portal spec §1). |

**Terminology.** "System Admin" = an **eBizco platform operator**, NOT a tenant
construction role — it must not enter the 6-role registry (§2/§3). The brief's "Org
Admin" (a tenant managing their own org) is **not a dashboard user at all** — that is
`projectManager` working in the **portal Admin module**. The dashboard is platform-only.

---

## 2. The architectural decision — a platform-only surface (read this first)

The dashboard is **entirely a cross-tenant platform surface** (System Admin only), so
two constraints from the existing architecture shape it:

**(a) `org_id` isolation is the platform's core guarantee.** Every tenant query filters
on the token's `org_id`; `isolation.test.js` (16/16) proves nothing crosses the org
boundary, and projman-01 §7 forbids cross-org endpoints "until projman-02 is BUILT."
This dashboard is the **first legitimate cross-tenant read** in the system — it exists
precisely to look across orgs. That makes its containment critical: it lives on a
**separate mount**, is **read-only for the account layer** (its only writes are billing),
touches **no domain content**, and **audits every view**.

**(b) The 6-role registry is tenant-scoped construction roles.** `projectManager …
client` describe who does what *inside one builder's project*. A platform operator
(eBizco) is a different kind of principal. Putting `sys_admin` into the `roles` table
would leak a cross-tenant superuser into the pairing shortlist, the assignable-role
list, and the construction permission matrix.

**The design:**

1. **A separate `/admin/*` mount** with its own `adminAuthenticate` middleware — it
   never touches the tenant `org_id`-from-token filter; it is cross-tenant by design and
   contained by the allowlist below.
2. **One tier: System Admin.** Access = membership of a **`platform_admins` allowlist**
   (not a tenant role, not a tenant permission). Every `/admin/*` caller must be on it;
   everyone else gets 403. There is **no tenant tier** — an org admin uses the portal.
3. **`sys_admin` is NOT added to the `roles` table.** Platform-admin status is a
   `platform_admins` row (`user_id`, `granted_by`, `created_at`), provisioned out-of-
   band (seed/CLI), never via tenant user-management, never device-pairable. (Open
   Decision #3 — my counter-recommendation to "add sys_admin as a role".)
4. **Every cross-tenant read is itself audited.** A platform admin viewing a tenant's
   data writes an `audit_log` row (`admin.view`, the org viewed) — the watchers are
   watched. Read-only: the admin dashboard never mutates tenant construction data.

This makes the platform view a **narrow, auditable, read-only exception** rather than a
weakening of isolation — and leaves the construction role model untouched.

---

## 3. Permission & access model

**✅ BUILT + verified 2026-07-24 (migration_v011 addendum).** The dashboard stays a
**single platform TIER** exactly as designed below (a `projectManager` still has zero
reach here) — what's new is three **admin-team roles WITHIN that one tier**,
requested directly by the owner, so a System Admin operator is no longer all-or-
nothing:

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

**Refined same day (owner):** browsing the full cross-tenant account directory
(`GET /admin/users` — names, emails, orgs) is **`admin`-only**, even though
`account`/`staff` still hold the user-account **action**
(`POST /users/:id/(suspend|reactivate|force-logout)`, which itself returns no PII —
just `{userId, action}`). The `account`/`staff` Accounts page is a narrow act-by-id
form (paste a user id from a support ticket, choose an action) — never a browsable
list. This keeps "manage user (enable/disable)" for both roles per the original ask,
without handing every admin-team member a directory of every tenant's people.

**Kept separate (owner, same day):** a merge into one shared `PortalNav` sidebar was
tried and reverted — cramming the tenant PROJECTS/SITE/COMMERCIAL/ORGANISATION groups
and the platform Overview/Accounts/Devices/Organisations/Billing/Login-Log group into
one sidebar read as crowded. The System Admin dashboard keeps its **own** dedicated
sidebar (`admin/layout.js`, a plain `<aside>` + `NAV` list filtered by `admin_role`,
still mirroring `routes/admin.js`'s `requireAdminRole(...)` lists exactly) — visually
and structurally separate from the tenant Portal's `PortalNav`, not a shared
component. It also has its **own entry point**, `/admin/login` (`admin/login/page.js`)
— a different front door onto the exact same identity/auth as the app and the tenant
Portal (one JWT, one `POST /auth/login`; not a second auth system), landing on `/admin`
on success. It confirms the account actually holds a `platform_admins` row before
entering — a valid tenant login that isn't a platform admin sees a clear message on
that page, rather than a silent bounce, and keeps its (still valid) tenant session.
The tenant Portal's `/login` is unchanged and unaware any of this exists. **Reinforced
by the owner directly: "Portal should have nothing to do with admin/account/staff of
the Platform Management Team"** — `PortalNav.js` and `(console)/layout.js` carry zero
reference to `admin_role` or `adminApi` (verified). The split is total: separate nav,
separate login, separate layout — the only thing shared is the underlying identity/
auth (one JWT, one `users` table), which is by design (same as the app).

| Principal | How identified | Dashboard access |
|---|---|---|
| **System Admin** (`admin`/`account`/`staff`) | row in `platform_admins`, `admin_role` column | Per the table above — all orgs, scoped `/admin/*` endpoints |
| **Everyone else** (any tenant role, incl. `projectManager`) | — | **No access** (403) — org-admin is done in the portal |

- Access is the **`platform_admins` allowlist**, full stop — not a tenant role, not a
  tenant permission (no `admin.dashboard.view` on the construction matrix). This keeps
  the 6-role model untouched; `admin_role` is a platform-tier-internal refinement, not
  a second tenant-facing tier.
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

## 4. Data sources — brief's assumptions mapped to our ACTUAL schema

The brief lists an idealised schema. Here is the reconciliation with what exists today,
and the **gaps to close** (migration_v007, §10):

| Brief table/field | Reality in `c1projman2` | Action |
|---|---|---|
| `organisations` (count, trend, plan, trial) | ✅ exists — `plan`, `trial_ends_at`, `created_at` | use as-is |
| `users` (count, role, status, created_at) | ✅ exists | use as-is |
| `auth_identities.provider` / `.identifier` | ✅ `provider`, `provider_sub`, **`email`** (not `identifier`) | map `identifier → email` |
| `sessions` (active, device_info) | ✅ `sessions` — `ip_address`, `user_agent`, `device_id`, `revoked_at`, `expires_at` | use; "active" = `revoked_at IS NULL AND expires_at > NOW()` |
| `devices` (count, role, status, last_seen) | ✅ exists — `role`, `status`, `last_seen_at` | use as-is |
| `pairing_tokens` (pending/confirmed/rejected) | ✅ exists — `status` enum | use as-is |
| `audit_log` (login txns, IP, device, outcome) | ✅ has `ip`, `device_id`, `detail` JSON, `action`, `created_at` — **no `user_agent` column** | see gap ↓ |
| `payments`, `licenses` | ❌ **do not exist** | payment metrics are **placeholders** (Open Decision #2) |
| `sync_queue`, `sync_log` | ❌ — we have **`sync_history`** (push/pull cycles + `status` + `error_message`) | use `sync_history` for sync health |
| Geolocation (IP → city) | ❌ not stored — IP is raw | add local resolution (§6, gap ↓) |

**Gaps to close (migration_v007 + small server work), §10:**
1. **`user_agent` on auth events.** `audit_log` records `ip` + `device_id` but not the
   user agent (it lives only in `sessions`, and only for *successful* logins). The login
   log wants device/OS per event including failures. → add `user_agent` to `audit_log`
   (or write it into `detail` for auth actions). Small, do it now so history accrues.
2. **Failed-login completeness.** `auth.login_failed` **is** already audited for a wrong
   password (good). The *unknown-email* path returns without an audit row (deliberate
   non-disclosure). → optionally log those as `auth.login_failed` `reason=unknown_user`
   so the security view is complete — flagged as a privacy trade-off for your call.
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
| Accounts by role | `GROUP BY role` — bar/pie (the 6 roles) — *counts, not content* |
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

### 5.4 Fees & billing — **a real module** (owner: fee-paying is core to the dashboard)
This is SaaS billing: **eBizco charging the tenant organisations** for ProjMan2 — not
construction payments. It needs a small billing schema (§10) since `payments`/`licenses`
don't exist yet:

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
v1 can be **manual reconciliation** (System Admin records a received payment) with a
gateway wired later. The **billing schema + the fee views/actions are the real
deliverable** here, not a placeholder.

### 5.5 Login transaction log — **the key operational view** (§6)

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
`device.revoke`. (Answer to Q3: **explicit auth events**, not intermediate OAuth
redirects — our OAuth is token-exchange, so there are no server-side redirects to log.)

### 6.1 Geolocation — recommend **local GeoLite2**, not an external API
IP is personal information under the AU Privacy Act, and §8.4 of the server spec commits
to AU data residency. Sending user IPs to an external service (ipapi.co and similar)
ships PII offshore — a residency/privacy regression. **Recommendation: MaxMind GeoLite2
as a local database file**, resolved server-side at read time (no outbound call, nothing
leaves `ap-southeast-2`). Optionally cache the resolved city onto the audit row to avoid
re-lookups. (Open Decision #1.)

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

Response envelope: `{ success, data }`, pagination `{ page, pages, total }` (the ported
`PortalPagination` shape).

---

## 8. Filtering, pagination, export

- **Filters:** date range (logs/registrations/logins), user email (logs/devices),
  organisation (narrow to one org), outcome (success/fail), method (provider).
- **Pagination:** server-side, reuse the tenant `{ page, pages, total }` shape; the
  ported `PortalPagination` renders it.
- **Export:** CSV stream for the login log and reports (`…/export` endpoints), same
  filters as the view; streamed so a 12-month export doesn't buffer in memory. Excel =
  CSV opened in Excel (no XLSX lib needed v1).

---

## 9. UI layout (high-level)

A **clean, data-dense admin theme — deliberately not construction-themed** (this is ops,
not site work). Reuses the ported portal kit (`PortalCard`/`PortalKpi`/`PortalTable`/
`PortalPagination`/`usePortalData`) but on a neutral admin palette, in its own route
group (`/admin`) separate from the tenant console shell.

```
┌───────────────────────────────────────────────────────────────┐
│  ProjMan2 System Admin              [Org: All ▾]  [Billing]  🔄60s │  topbar: org filter + billing
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

- **Auto-refresh 60s** (configurable), manual refresh button. (Open Decision #4.)
- **Responsive:** desktop primary, tablet secondary.
- **Charts** follow the `dataviz` design system at build time (one visual system, light
  + dark, accessible) — not hand-rolled colours.
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
`platform_admins` allowlist (§3), so the 6-role model is untouched.

Plus: capture `user_agent` into audit on auth actions; (optional) log unknown-email
login failures; ship the GeoLite2 file + a `lib/geo.js` resolver; a retention job
pruning `audit_log` older than 12 months (Open Decision #5, AU Privacy Act).

---

## 11. Answers to your questions + the open decisions

**Q1 — Is the audit log capturing IP, user agent, device info?** IP ✅ (`audit_log.ip`),
device ✅ (`audit_log.device_id` → join `devices`). **User agent ✗** in `audit_log`
(only in `sessions`, success-only). → add it now (§10). Failed logins: wrong-password
**is** audited; unknown-email is not (non-disclosure) — flagged.

**Q2 — Geolocation provider?** **Local MaxMind GeoLite2** — no PII leaves AU. Avoid
external IP-lookup APIs for residency (§6.1).

**Q3 — All auth events or explicit logins?** **Explicit auth events** (login, failed
login, register, logout, recovery, key device actions). Our OAuth is token-exchange —
no server-side redirects exist to log.

**Q4 — Payments in v1?** **Revised (owner): yes — a real billing module.** Fee-paying is
core to this surface, so v1 ships the billing schema (`subscriptions`/`payments`, §10)
and the fee views/actions (§5.4). Payment-gateway *capture* (Stripe etc.) can start as
manual reconciliation and wire a gateway later; the schema + admin actions are real now.

| # | Open decision | My recommendation |
|---|---|---|
| 1 | Geolocation provider | **GeoLite2 local** (residency; §6.1) |
| 2 | Billing in v1 | **Yes — real module** (owner). Schema + views/actions now; gateway later. Manual reconciliation acceptable for v1. |
| 3 | System Admin as a role? | **No — a `platform_admins` allowlist, not a tenant role** (§2). Keeps the 6-role construction matrix clean and isolation honest. |
| 4 | Refresh interval | **60s auto + manual button** |
| 5 | Log retention | **12 months** + a prune job (AU Privacy Act) |
| 6 | Payment gateway | Out of v1 schema — **manual reconciliation** first; Stripe/eWAY wired when billing goes live. Confirm the gateway preference when we get there. |

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

## 13. Review ask

Approve §2 (the platform-only architecture), §3 (allowlist access), §5.4 + §10 (the
billing schema), §7 (endpoints), and answer §11's open decisions. Then I build steps
1–4 (+6 billing) and bring the access/boundary test green before any UI.

**Filename note:** saved as `dashboarddesignspecification.md` to match its siblings
(`servdesignspecification.md`, `appdesignspecification.md`). Rename if you'd prefer
`dashboardspecification.md`.

---

© eBizco Australia Pty Ltd
