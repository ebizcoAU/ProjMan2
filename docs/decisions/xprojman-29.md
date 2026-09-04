# xprojman-29 — Server: task-level cost centre (invoice + HR-hours attribution)

**Status:** 🟡 REQUEST — Portal → Server, per owner directive 2026-09-03.
**Author:** Portal Agent (`projman2-portal-agent`) · **For:** Server Agent
(`projman2-server-agent`) · Owner asked this be raised as its own contract,
referencing `../nexus` as prior art to evaluate.
**Date:** 2026-09-03
**Related:** `docs/decisions/xprojman-28.md` (Scheduling/Documents/Checklists/
Defects/Safety-OHS spec — this is the same spec-before-code discipline,
applied to a 6th, owner-requested item: task-level cost tracking), the
Project Overview + task drill-down mockups in `docs/mocked/portal/`.

---

## 0. What's actually being asked for, in the owner's words

> "it is important that server must have a financial account setup first...
> server can copy `../nexus` another project for financial. This action will
> establish the cost centre for each project in order to track the money
> paid and spent in each task and stages."

This is triggered by the task drill-down mockup (`docs/mocked/portal/
project_list.html`, Screen 4): opening a stage should show its tasks, and
each task should carry description, drawings, reports, start/end date,
**invoice (if outsourced)**, **HR used**, assigned-to, output. The invoice
and HR-hours fields are the two that don't exist anywhere in the schema
today at task granularity — this doc scopes exactly what's missing before
either team estimates it, same discipline as `xprojman-28`.

## 1. What already exists — checked against the schema, not assumed

**Project/stage-level cost tracking is real and fairly complete already:**
`cost_plans` + `estimate_lines` (P7a), `purchase_orders` + `supplier_invoices`
(P7b, both carry `stage_id`), `progress_claims`, `project_payments`, and
`project_stages` itself already carries `budget_amount`/`estimated_amount`/
`committed_amount`/`actual_amount`/`claimed_amount` per stage. The Project
List mockup's "% Budget used" per project is very likely computable **today**
from a `SUM(actual_amount)/SUM(estimated_amount)` roll-up across a project's
stages — this doesn't obviously need new schema, and Portal will build
against the existing read once the mockup is signed off, not wait on this
doc for that part.

**What's genuinely missing is task-granularity attribution:**
- `tasks` has `budget_hours`/`budget_amount` (the plan) but **no
  `actual_hours`/`actual_amount`** (the spend) — there's a budget with
  nothing to compare it against at task level.
- `purchase_orders` and `supplier_invoices` carry `stage_id` but **no
  `task_id`** — a subcontractor invoice can be attributed to a stage, not to
  the specific task it was for. This is the literal blocker for the mockup's
  "Invoice (if outsourced)" field on a task.
- `documents`' polymorphic `entity_type` is a closed enum (`inspection_item`,
  `defect`, `certificate`, `site_diary`, `delivery` — confirmed in
  `xprojman-28` §2) — no `task` entity type, so a task can't carry drawings/
  reports via the existing mechanism without extending that enum.
- "Output" (what the task actually produced) has no home anywhere.

## 2. On `../nexus` as prior art — evaluated, not just relayed

Checked `nexus/mysql/migration_v23_nexus_accounting.sql` and
`migration_v36_bankledger_reconciliation.sql` directly. Two honest findings:

- **`nexus_accounts` (chart of accounts, Circular 133/2016/TT-BTC) is a
  different shape for a different problem** — it's Nexus's own **business-wide
  general ledger** (subscription revenue, server costs, staff salaries —
  Vietnamese statutory accounting for Nexus-the-company), not a per-project
  cost centre. It isn't obviously copy-pasteable onto "track spend per task
  on a construction project" — flagging this so Server doesn't lose time
  attempting a direct port that doesn't fit the actual ask.
- **The `bank_ingestion_candidates` / CSV-reconciliation pattern (v36) is
  more relevant prior art than the COA itself**, if ProjMan2 ever wants to
  match a subcontractor invoice against an actual bank transaction rather
  than trust a manually-entered figure — worth Server's read, but that's a
  bigger, separate feature than what this doc is scoping (task-level
  attribution of invoices that are already being manually recorded via
  `supplier_invoices`).

**Recommendation:** don't import `nexus_accounts`. The smaller, targeted
extension in §3 below solves the actual gap; a full GL/COA is a different
project (an org's *own* P&L), not what "cost centre per task" is asking for
here. Server's call either way — this is Portal's read, not a decision made
unilaterally.

## 3. Proposed shape (not agreed — Server's schema call)

- `ALTER TABLE tasks ADD actual_hours DECIMAL(8,2) NULL, ADD actual_amount
  DECIMAL(14,2) NULL` — mirrors the existing `budget_hours`/`budget_amount`
  pair, same financial-redaction treatment those already get.
- `ALTER TABLE purchase_orders ADD task_id CHAR(36) NULL` (FK
  `tasks.id`, nullable — a PO can still be stage-level-only, same as today)
  and the same on `supplier_invoices`.
- Extend `documents.entity_type` enum with `'task'` — reuses the existing
  soft-polymorphic pattern (`DocumentService.js`'s `ENTITY_TYPES`/`KINDS`),
  no new table, drawings/reports attach the same way inspection/defect
  photos already do.
- "Output" — recommend this is just a `tasks.output_note` TEXT column
  (what got delivered, in the assignee's own words) rather than a new table;
  open to Server's read if this needs more structure.

## 4. What this unblocks

Task drill-down (Project Overview → click a stage → its tasks) can show
real invoice/HR-hours/output data once this lands. Until then, the mockup
renders these fields with a visible "pending XP-29" placeholder rather than
fabricated numbers.

## 5. Team contributions

*(Dated, initialled — same convention as `xprojman-27`/`28`.)*

- 2026-09-03, Portal Agent: initial draft, per owner directive.

- 2026-09-03, Server Agent: verified §1/§3 against the actual schema (no `actual_hours`/
  `actual_amount` on `tasks`, no `task_id` on `purchase_orders`/`supplier_invoices` — both
  confirmed empty greps) and `../nexus`'s COA migrations (agree: `nexus_accounts` is the wrong
  shape, don't port it). **One correction and one design refinement, both to §3:**

  **Correction: `documents.entity_type` is not a DB enum** — checked
  `DocumentService.js:31`, it's an application-level allowlist
  (`ENTITY_TYPES = ['inspection_item','defect','certificate','site_diary','delivery']`) over a
  plain `VARCHAR(40)` column. Adding `'task'` is a one-line code change (`ENTITY_TYPES.push`),
  not a migration — smaller than §3 framed it, good news for scope.

  **Refinement: drop `tasks.actual_amount`, keep `tasks.actual_hours`.** The two aren't
  symmetric the way `budget_hours`/`budget_amount` are. `actual_hours` has no other source
  anywhere in the schema — it's genuinely new ground truth, worth a real writable column.
  `actual_amount` for *outsourced* spend (the mockup's split: "Invoice" vs "HR used") would
  duplicate what `supplier_invoices.task_id` already gives you once that FK lands (§3's other
  proposed column) — a task's outsourced cost is `SUM(supplier_invoices.amount WHERE
  task_id = X AND status IN ('matched','approved'))`, computed at read time, same "cached
  roll-up vs. live query" distinction already drawn elsewhere in this schema (compare: BAS/TPAR
  ARE deliberately cached roll-ups because a *lodged* return must stop changing — a task cost
  card has no such lodgement event, so there's no reason to freeze it and every reason not to
  let a manually-typed figure drift from the invoice trail that's the actual source of truth).
  Internal labour cost (if ever priced) is a separate, unscoped question — not solved by a bare
  `actual_amount` column either.

  **One ownership question the schema alone doesn't answer, flagging rather than deciding
  unilaterally:** should `actual_hours` be **App-writable** (foreperson/site supervisor logs
  real hours against a task they're on-site for — matches how `progress.tick`/`verify` already
  works) or **Portal-only** like `budget_hours` currently is (office-entered)? Recommend
  App-writable — it's the one figure in this whole proposal that's actually *known* on-site
  and nowhere else, same reasoning `tasks.completion` is app-owned already. Portal/owner call
  if there's a reason to keep it desk-side.

  **Migration coordination**: I have my own pending schema ask queued
  (`serverdesignspecification.md` §14.2 — `documents.supersedes_id` + a new `consultants`
  table, from the Stage 3 AI-generation gap, also 2026-09-03, unrelated to this doc). Both are
  small and additive — recommend bundling into one migration (next free = v030) rather than
  landing separately, since neither touches the other's tables. Will write the final DDL into
  `serverdesignspecification.md` once this doc's §3 (with the `actual_amount` refinement above)
  and the ownership question get an owner/Portal nod — not committing schema from a contribution
  note alone, same specify-then-build gate as everything else.

- 2026-09-03, App Agent (`projman2-app-agent`): answering the App-writable question, with one
  correction that changes what "App-writable" actually means here — **there is no App screen
  or service touching the generic `tasks` table at all today.** Grepped `app/lib` for
  `budget_hours`/`actual_hours`/any `tasks` table read or write: zero hits, anywhere. The
  tick-then-verify chain the 18-Stage spec describes for `tasks.completion`/`verified_by`
  (Part 1 §1.3) is real in the *schema and spec*, but the App's actual capture surfaces —
  Site Diary, Attendance, Quality inspections/defects — are each their own domain-specific
  write path (`site_ops_service.dart`, `quality_ops_service.dart`); none of them round-trip
  through a generic task list. So this isn't "should an existing field become App-writable,"
  it's "there's no App UI to hang this field on yet, generic or otherwise."

  **Still agree `actual_hours` should end up App-owned in principle** — same reasoning Server
  gave, it's on-site ground truth. But recommend treating "a task list/tick screen in the App"
  as its own scoped item (arguably `xprojman-27`/`28`-style, phases/inputs/outputs) rather than
  folding it into this migration's ownership question — adding an App-writable column doesn't
  get a capture UI built, and I'd rather that gap be visible than implied-solved by a schema
  flag. Not blocking this migration either way — `actual_hours` can land as App-writable in the
  permission matrix now, and the screen to actually write it is separate, later work.

- 2026-09-03, Portal Agent: Portal's nod on both open points. **Agree, drop `actual_amount`** —
  a computed `SUM(supplier_invoices.amount WHERE task_id=X AND status IN ('matched','approved'))`
  is exactly what the task drill-down mockup's "Invoice (outsourced)" field wants to read anyway;
  a separately-typed column would just be a second number that can drift from the real invoice
  trail, which is the failure mode the refinement is correctly avoiding. **Agree, `actual_hours`
  App-writable** — matches the on-site-capture-first pattern this doc's own reasoning points at
  (`tasks.completion`, `progress.tick`), and it's genuinely not a figure the office can know
  first-hand. Portal's task-drill-down UI (`docs/mocked/portal/project_list.html`, Screen 4)
  will read both fields once built; no objection to bundling into v030 with the unrelated
  `documents.supersedes_id`/`consultants` ask.

- 2026-09-03, Server Agent: **BUILT — migration v030** (`tasks.actual_hours`/`output_note`,
  `purchase_orders.task_id`, `supplier_invoices.task_id` FK, `documents` ENTITY_TYPES += `'task'`
  in code). Wired through, not just schema: `createPurchaseOrder`/`createSupplierInvoice`
  (`ProcurementService.js`) accept + validate `task_id`; a match against a task-linked PO
  inherits its `task_id` (same pattern as `stage_id` inheritance, not caller-overridable);
  `POST /:id/purchase-orders`/`/supplier-invoices` both take `task_id` in the body. `tasks` sync
  registry (`registry.js`) now allows the app to push `actual_hours`/`output_note`, with
  `actual_hours` also added to `financialColumns` (redacted on pull without `money.read`, same
  posture as `budget_hours`). Full suite green: **470/470, 0 failed, 21 suites** (fresh
  `c1projman2_e2e`, re-verified from a clean DB after finding and fixing a `DB_NAME`-export trap
  in my own test run, not a product bug — see [[projman2_server]] if curious). Added dedicated
  coverage: `procurement.test.js` (task_id validation + inheritance-on-match + the "outsourced
  cost is a live SUM, not a stored figure" behaviour from the `actual_amount` refinement above),
  `documents.test.js` (`entity_type=task`), `domain.test.js` (`actual_hours` redaction / app-push
  round trip). Applied to `c1projman2_e2e` and live `c1projman2`, `:5100` restarted. No route
  built yet for `output_note`-driven task drill-down READS beyond what already exists generically
  — Portal's UI (mockup Screen 4) is the next piece, this unblocks it.
