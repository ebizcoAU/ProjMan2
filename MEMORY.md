# ProjMan2 — Project Memory

Context for any assistant session working in `~/Documents/Dev/Projman2`.
**Read `docs/development.md` first** — it is the framework of record. This file
holds what that document cannot: where things are, what was decided and why, and
the traps.

**Status as of 2026-07-22:** framework + database + port plan written. **No code
yet.** Next action is P1 (port the MAOI skeleton into `app/`), and in parallel
NexusPM starts the server port from `server/NEXUSPM-BRIEF.md`.

---

## 1. Where everything is — read this before touching anything

| Thing | Path | What it actually is |
|---|---|---|
| **MAOI — the app being ported** | `~/Documents/Dev/ftpos` | ⭐ Flutter, two variants in one codebase. MAOI is a **build flavour**, not a folder: `--dart-define=APP_VARIANT=maoi`. **This is the source for the port.** |
| MAOI website | `~/Documents/Dev/maoi` | ⚠ **NOT the app.** Next.js 14 marketing site, static export. Easy and costly to confuse. |
| Legacy ProjMan | `~/Documents/Dev/ProjMan` | The old app being replaced. Express + EJS + jQuery + Bootstrap (Dash-UI) + MySQL `c1projman`, DevExpress Gantt. Built for a **mining engineering design** company. Development halted. |
| Nexus server | `~/Documents/Dev/nexus` | Node + MySQL + React dashboard. Owns auth and the API. **Never edit directly** — specify and hand to NexusPM. |
| This project | `~/Documents/Dev/Projman2` | `app/` Flutter · `server/` Nexus work · `web/` Next.js console · `docs/` |

⚠ **Path trap.** This filesystem is **case-insensitive**. `~/Documents/Dev/Projman`,
`projman` and `ProjMan` all resolve to the **legacy** repo. The new project is
`Projman2` — the trailing 2 is the only thing distinguishing them.

⚠ **MAOI is a flavour, not a directory.** Anyone told to "copy MAOI" must copy the
`ftpos` Flutter tree and strip the BANOI variant axis, not look for a `maoi/` app
folder. The one that exists is the website.

---

## 2. What ProjMan2 is

A multi-tenant **building and construction** project management platform:
Flutter field app + Next.js office console + Nexus server. Each builder is an
organisation running its own projects for its own customers.

**Purpose, in the operator's words:** on schedule, on budget, delivered — through
coordination between subcontractors, quoting and estimating, tracking invoices and
payments, and material information. *"Everything must be in place when one is
needed."*

**Accounting is half the product**, not an adjunct: spending, payments to
subcontractors and own staff, the ledger, and Australian tax. The AU specifics that
are not optional in this industry: **GST/BAS**, **TPAR** (mandatory contractor
reporting for building and construction), PAYG withholding, superannuation,
diminishing-value depreciation.

**Aligned to CPC50220** — the Diploma of Building and Construction (Building). Every
user holds or trains toward it, so the software maps to its **27 units (24 core + 3
elective, Release 4)**. Positioning: first construction software mapping to the
diploma → obvious choice for builders, RTOs and trainees. Frozen unit list +
gap-closure = `docs/decisions/projman-03.md`; feature mapping = development.md §12.
⚠ The official unit list was transcribed from the real training.gov.au PDF — an
automated summary hallucinated the superseded CPC50210 codes (`…A` suffix) and wrong
count. Never re-derive unit codes from memory or web summaries.

**The strategic fusion:** CPC unit-tagging (`cpc_units`/`cpc_feature_map`/
`cpc_evidence`) makes §10 Verified Work History double as a **self-filling diploma
evidence portfolio** — same evidence primitive projected onto the qualification.
Evidence *generation* is gated behind `projman-02` (it's cross-tenant, like all §10
evidence); the reference/tagging tables are not and land with P3.

---

## 3. Locked decisions

1. **English only.** No Vietnamese anywhere. Region AU/WA — AUD, `Australia/Perth`,
   ABN.
2. **`app/` is a port of MAOI**, feature by feature, starting with register /
   recover / authenticate. MAOI supplies ~70% already built: auth, device pairing
   and roles, sync, offline image queue, purchasing, accounting, fixed assets and
   depreciation, staff roster and attendance.
3. **Buy side kept, sell side dropped.** No POS, menus, dishes, rooms, bookings,
   or VN tax.
4. **`server/` is Nexus work**, built by NexusPM from `server/NEXUSPM-BRIEF.md`.
5. **The 18-stage WA construction lifecycle** (from `ftpos/ftposDecisions/ProjMan.md`)
   ships as an optional system **stage template**, `WA_RESIDENTIAL_18` — not as
   hardcoded schema. A renovation builder should not be forced through Fremantle
   breakbulk.
6. **Materials reuse MAOI inventory.** `item_master` → material catalogue,
   `inventory_stocks` / `stock_ledger` → materials on site. (An earlier draft of
   `development.md` wrongly listed these as dropped; corrected.)
7. **`project_stages` replaces legacy `module → phase`.** One ordered stage list per
   project, tasks self-nest via `parent_id`. Legacy's four fixed design phases per
   module suited drafting, not a construction programme.
8. **Field app is capture-first.** Fast entry, photos, offline queue. Analysis,
   Gantt and the ledger are desk work on the web console.

## 4. Design rationale worth not re-deriving

- **The site diary is the most important feature in the field app** — more than
  projects or the programme. It is the legal record behind every delay and
  extension-of-time claim, and it is written at 4pm on a phone with no signal.
- **TPAR drives a schema decision:** the ledger must distinguish a payment to a
  *subcontractor* from one to a *supplier* at the moment it is recorded. Do not
  plan to reconstruct that in July.
- **An open hold point must block** its stage from completing. Hold points are the
  inspection regime's only teeth.
- **The invoice gate** (`ProjMan.md` §4.1) — an invoice against a stage whose
  prerequisites are not validated is flagged and its payment frozen. Server-side
  rule, never client-only.
- **The product is one row:** any stage showing estimated / committed / actual /
  claimed side by side.

## 5. Open questions

Tracked in `docs/development.md` §8. The two that block schema work: do **tradies
get logins** for self check-in (assumed no — supervisor records attendance), and is
the **IVR/CGPA voice engine** in or out (assumed deferred; genuinely good fit for
gloved, noisy sites — "log a hazard", "sign in Dave").

## 6. Conventions

- Decision records: `docs/decisions/PM2-NN-title.md`.
- Nexus work is **specified, never edited** — the ftpos house rule, carried over.
- Secrets from environment variables only. The legacy repo committed live MySQL,
  MQTT and session secrets to a GitHub remote; those should be rotated and must
  never be repeated here.
