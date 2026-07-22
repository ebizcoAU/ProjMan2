# ProjMan2

A multi-tenant **project management platform for building and construction**.

Builders run their own projects for their own customers: programme and stages,
site attendance, daily site diary, safety, inspections and defects, and the
commercial chain from purchase order through supplier invoice to progress claim.

**Status:** 🟡 Concept — framework, navigation and database defined. No code yet.
**Language:** English only.
**Region:** Australia (WA first) — AUD, `Australia/Perth`, ABN.

---

## Platform

| Part | Stack | Purpose |
|---|---|---|
| `app/` | Flutter (ported from MAOI) | Field app — capture-first, offline-first. Attendance, site diary, safety, inspections, photos. |
| `server/` | Nexus (Node + MySQL) | Registration, recovery, authentication, device identity, sync, domain API. Built by NexusPM. |
| `web/` | React + Next.js | Office console — Gantt, cost plan, customers, staff, claims, reports. |
| `docs/` | — | Framework and decision records. |

## Lineage

ProjMan2 is a rebuild, not a fork:

- **`~/Documents/Dev/ProjMan`** (legacy) — Express/EJS/jQuery app for a mining
  engineering design company. Its WBS cost-control model and multi-tenant shape
  carry forward; the design-consultancy framing does not.
- **`ftpos` MAOI variant** — supplies roughly 70% of the platform already built
  and proven: authentication, registration, recovery, device pairing and roles,
  sync, offline image queue, purchasing, accounting, fixed assets and
  depreciation, staff roster and attendance. The **buy side** is kept; POS,
  menus, hotel and Vietnamese tax are dropped.
- **`ftpos/ftposDecisions/ProjMan.md`** — the 18-stage WA construction and
  procurement lifecycle, carried as an optional project template rather than
  hardcoded schema.

## Start here

**[`docs/development.md`](docs/development.md)** — the development framework:
roles, navigation, database schema, the Nexus split, and the P1–P8 port plan.

Build order begins with P1 (port the MAOI skeleton, strip to English) and P2
(register / recover / authenticate) — the first working milestone.

## Conventions

- Decision records live in `docs/decisions/` as `PM2-NN-title.md`.
- Nexus server work is **specified here and handed to NexusPM** — never edited
  directly.
- Secrets come from environment variables. Never commit credentials.

---

© eBizco Australia Pty Ltd
