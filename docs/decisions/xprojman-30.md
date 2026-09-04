# xprojman-30 — eBizco Finance books + MQTT signalling reintroduced + Admin directory upgrades (built, documented retroactively)

**Status:** 🟡 BUILT, UNCOMMITTED — three same-day, owner-directed pieces of work
(2026-09-03) landed in the working tree without ever getting a contract or a
`serverdesignspecification.md` entry. This is that missing record, written
retroactively — same convention `xprojman-28`'s module 1 (Scheduling) used
("documented here retroactively for review", not a rewrite of what's already
built).
**Author:** Server Agent (`projman2-server-agent`) · **For:** PM / System
Architect, all teams (this touches the Dashboard nav, a new npm dependency,
and a new env-file convention every service now follows)
**Date:** 2026-09-03
**Related:** `dashboarddesignspecification.md` §5.4 (Billing — superseded in
part by §3 below), `xprojman-29` (the anti-drift "don't cache what you can
compute" precedent this reuses twice), `[[projman2-mqtt-port-hazard]]` (memory
— shared Mosquitto broker on this machine, never restart it).

---

## 0. Why this doc exists

Three pieces of work, all dated 2026-09-03 in their own code comments as
"owner directive", are fully built — schema, service, routes, and (for two of
the three) Dashboard UI — but exist only as uncommitted changes with no
xprojman number and no mention in `serverdesignspecification.md`:

1. **eBizco's own Finance books** (migrations v031 + v032) — a real
   chart-of-accounts ledger for eBizco-the-company, separate from every
   tenant's own P7/P8 accounting.
2. **MQTT signalling, reintroduced** — dropped from the Nexus port originally
   (per `src/index.js`'s own comment history), brought back the same day as a
   thin "something changed, go pull now" nudge layer over the existing
   poll-based sync.
3. **Admin directory upgrades** — sortable/searchable Users/Devices/Orgs
   lists, a new org drill-down page, and the standalone Billing page folded
   into a "Finance" nav group.

None of this conflicts with anything already specified — it's additive, all
inside the Server Agent's own `server/api/` + `server/dashboard/` lane — but
per the spec-before-schema convention this project has been using since
2026-09-03 itself, it shouldn't stay undocumented.

---

## 1. Module A — eBizco's own Finance books (migrations v031, v032)

**Phases:**
1. *Chart of accounts* — a real 3-level tree (Revenue / Expenses / Assets /
   Liabilities / Equity → category → leaf), seeded by migration, rendered as
   an expandable tree in the Dashboard (`PortalAccountTree.js`, new).
2. *Record* — an operator logs an office expense (auto-posts a 2-sided
   journal entry: debit the expense category, credit Cash & Bank) or drafts a
   payroll run (gross pay computed from a staff member's hourly rate × logged
   hours, or a flat salary).
3. *Post* — marking a payroll run `paid` posts its own 2-sided entry (debit
   Wages Expense, credit Cash & Bank). The pre-existing
   `BillingService.recordPayment` (subscription revenue, v007) is retrofitted
   to post here too (debit Cash, credit Subscription Revenue) — the one link
   between the old Billing module and this new ledger.
4. *Report* — Profit & Loss (a period delta) and Balance Sheet (an as-of
   snapshot) are both computed **live** by walking the account tree and
   summing `fin_journal` at read time — no cached balance anywhere.

**Inputs:** operator-entered expense/payroll data (`fin_expenses`,
`fin_staff`, `fin_payroll`, `fin_payroll_items`); existing `payments` rows
(`BillingService`) as an automatic feed, not a manual entry.

**Outputs:** `fin_journal` rows — the one source of truth; P&L / Balance
Sheet JSON trees the Dashboard renders directly.

**Parameters:** every Finance route is gated `canMoney` (the existing
`admin`/`account` platform-admin tier, `dashboarddesignspecification.md` §3)
— **not** a tenant permission. No `org_id` anywhere in this module by
design: single company, not multi-tenant, same boundary the rest of
`/admin/*` already enforces.

**Anti-drift design choice** (stated in the migration/service comments,
worth carrying into the spec): `fin_accounts` deliberately holds **no**
cached `balance`/`debits`/`credits` column, unlike the `../ihms` system it
was modelled on — the exact same reasoning `xprojman-29` used to drop
`tasks.actual_amount` in favour of a live `SUM()`. A parallel figure next to
its own source of truth just drifts; every reported figure here is computed
at read time instead.

**Server dependency / what's genuinely NOT built yet:**
- No `POST /admin/finance/accounts` — the chart of accounts is
  migration-seeded only, not operator-editable.
- **No test coverage at all** for `FinanceService.js` or the new
  `/admin/finance/*` routes — unlike `xprojman-29`'s task-cost work, which
  shipped dedicated suite coverage the same session it landed.
- No PAYGW/SG tax calculation on this payroll — and to head off a real
  confusion risk: **this is not `serverdesignspecification.md` §12's P9
  payroll** (that one was scoped for tenant construction-worker payroll and
  cancelled by owner directive 2026-08-05). This is a much smaller thing —
  eBizco's own handful of internal staff — that was never proposed as P9 and
  is therefore not affected by that cancellation. Worth a one-line note in
  §12 itself so a future reader doesn't conflate the two.

---

## 2. Module B — MQTT signalling, reintroduced

**Phases:**
1. Server boots; `mqttClient.connect()` fires non-blocking (`index.js`'s own
   comment: a broker outage must never block boot).
2. Every `SyncService.pushRecord` (an app/portal write already durably
   applied) now also fires `mqttClient.nudgeSync(orgId, {table, action,
   recordId})` — fire-and-forget, never awaited, never retried.
3. A device/browser subscribed to `projman2/{orgId}/sync/nudge` learns
   "something changed" and calls its normal `GET /sync/pull` immediately,
   instead of waiting out its next poll interval.

**Inputs:** none new from a client's perspective — this only shortens the
existing poll's wait; it never replaces the pull itself and carries no
payload beyond a `{table, action, id}` pointer.

**Outputs:** MQTT publishes only. No new REST endpoint, no schema change of
its own.

**Parameters:** `MQTT_ENABLED` env flag (default `true`). Broker is
**eBizco's existing shared Mosquitto instance on this machine** (real ozlock
ESP32 hardware and other live projects already depend on it) — ProjMan2
connects as a client under its own `projman2/...` topic prefix and never
starts, stops, or restarts the broker itself. Production target is
`mqtts://mqtt.ebizco.com.au:8883` (owner-confirmed as the real endpoint —
not Nexus's older plain `:1883`, which is dev/legacy-only).

**Server dependency / correction needed:** `AdminService.hourlyTraffic`
(Module C, below) still carries a code comment claiming *"ProjMan2 has no
MQTT broker or any other push/signalling layer — dropped from Nexus on
purpose."* That's now **stale**, directly contradicted by this same
session's reintroduction. The metric itself (session-starts-per-hour) is
still the right signal to show — MQTT nudges aren't "traffic" in the sense
that chart means — so only the comment needs a follow-up fix, not the code.

---

## 3. Module C — Admin directory upgrades (Users / Devices / Orgs) + Billing folded in

**Phases:**
1. *List* — Users/Devices/Orgs each gain server-side sort (`sort_by`/
   `sort_dir`, resolved through a column allowlist — never a raw
   caller-given column name interpolated into SQL) plus free-text `search`
   and a configurable `limit`.
2. *Drill down* — `GET /admin/orgs/:id` (org header) + `GET
   /admin/orgs/:id/payments` (that org's payment history) back a new
   `/admin/orgs/[id]` page — this is where the old standalone `/admin/billing`
   page's per-org payment view now lives.
3. *Overview chart* — `GET /admin/stats/activity` (`hourlyTraffic`) feeds a
   new `PortalHourlyChart.js`, zero-filled via a recursive SQL CTE so a quiet
   hour renders as `0`, not a gap in the series.

**Inputs:** existing `users` / `devices` / `organisations` / `payments`
tables — no schema change in this module.

**Outputs:** richer JSON list responses (pagination envelope unchanged); the
Dashboard's standalone "Billing" nav item is now a "Finance" submenu group
(Profit & Loss / Balance Sheet / Payroll / Expenses / Sale Records) —
`admin/billing/page.js` was deleted, its content redistributed between the
org drill-down (per-org payments) and `finance/sales` (cross-org
subscription revenue — `BillingService.revenue()`, unchanged).

**Parameters:** `listUsers`'s new `scope=internal|tenant` filter
distinguishes eBizco's own platform-ops accounts (`@projman.internal`
emails, per `scripts/seed-admin-team.js`) from real tenant accounts — same
`platform_admins` allowlist gate as before, no new permission introduced.

**Server dependency:** none — self-contained on top of existing tables.

---

## 4. Cross-cutting, not specific to any one module above

- **Env-file split** — `config.js` now loads `.env.development` /
  `.env.production` (by `NODE_ENV`) before falling back to the legacy flat
  `.env`, mirroring Nexus's own convention. Every service in the monorepo
  (`api`, `dashboard`, `portal`, `veritrade`) picked up matching
  `.env.development.example` / `.env.production.example` pairs this session.
  Infrastructure hygiene, not a design decision — flagged only because it
  touches every service's boot path.
- **`server/shared/constants.js`** (new) — the one place every Node/Next.js
  service in the monorepo reads default cross-service URLs (`API_URL`,
  `DASHBOARD_URL`, `PORTAL_URL`, `VERITRADE_URL`) and `MQTT_BROKER_URL` /
  `MQTT_WS_URL` from, always env-var-overridable. Production values are
  explicitly marked placeholder except the MQTT broker URL, which the owner
  confirmed as real.
- **New npm dependency:** `mqtt@^5.15.2` in `server/api/package.json`.

---

## 5. Open items for owner / team

| # | Item | Recommendation |
|---|---|---|
| 1 | No test coverage for `FinanceService`/the new admin Finance routes | Add before this is committed — every other money-touching module in this codebase (P7/P8, `xprojman-29`) shipped with its own test file in the same pass |
| 2 | Stale "no MQTT broker" comment in `AdminService.hourlyTraffic` | Fix the comment only — the metric itself stays correct |
| 3 | `POST /admin/finance/accounts` (add a chart-of-accounts leaf without a migration) | Not built. Flag if the owner wants the chart operator-editable, or if migration-only is fine for v1 |
| 4 | This whole body of work is uncommitted | Recommend committing once #1 lands, same specify-then-build/test-before-commit gate used elsewhere in this project |
| 5 | §12 of `serverdesignspecification.md` (P9 payroll, cancelled) doesn't mention this smaller eBizco-internal payroll exists | Add a one-line disambiguation note so the two aren't conflated by a future reader |

---

## 6. Team contributions

*(Dated, initialled entry per contribution — same convention as
`xprojman-27`/`28`/`29` — don't silently overwrite, add below.)*

- 2026-09-03, Server Agent: initial write-up, documenting already-built work
  retroactively per the review-gate/spec-before-schema convention. No new
  code in this pass — this doc only, per the open items in §5.

---

© eBizco Australia Pty Ltd
