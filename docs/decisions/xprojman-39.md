# xprojman-39 — Cost Plan costing engine (skill-rate based) + Job Scheduler

**Status:** ✅ APPROVED FOR BUILD — phased implementation authorised (xprojman-39 §§1-4).
**§1/§2 BUILT** (Server, migration v039, 2026-09-06 — see §7 below). §3
(quotes) and §4 (Job Scheduler) NOT started, per the doc's own §5 build
order.
**Author:** Portal Agent (`projman2-portal-agent`) · **For:** All teams,
owner sign-off requested.
**Date:** 2026-09-06
**Related:** `xprojman-37.md`/`xprojman-38.md` (task fields this spec
builds on: `is_outsourced`, `status`, `predecessor_id`, `seq`/code — assumed
CONFIRMED by the time this is built, not necessarily by the time it's
reviewed), `schema-relationship-map.md` (source for every existing-table
claim below).

## 0. Reading this doc

Per module: **Phases** (the workflow, in order) → **Inputs** → **Outputs** →
**Parameters** (permission/validation/edge cases) → **Server dependency**
(what exists vs. what's new — and where I'm flagging a real open question
instead of deciding it alone).

## 0.1 Owner decisions already locked (this session)

- Rate card is **org-wide only**, no per-project override.
- Four skill tiers, fixed set: **Expert, Professional, Std, Free**.
- Internal cost → **requires a cost centre**. External cost → **requires a
  quote + approval**, and (implicitly, same sentence) a cost centre too —
  flagged as an open question in §3, not assumed.

---

## 1. Settings — Skill-rate card

**Phases:**
1. Org Admin (or whoever holds `money.write` — same gate as Cost Plan
   editing today) opens Settings → a new "Cost Rates" panel.
2. Sees exactly 4 rows: Expert / Professional / Std / Free, each an hourly
   rate (AUD, ex GST — same convention as every other money field in this
   schema).
3. Edits a rate, saves. Every task's cost calc (§2) reads these live.

**Inputs:** `org_id`, 4× `{skill_level, hourly_rate}`.

**Outputs:** new org-level rate table.

**Parameters:**
- Edit permission: `money.write` (reuse existing permission, no new one).
- Validation: `hourly_rate >= 0`; all 4 rows must exist for an org before
  any task can be costed against them (see "not yet configured" note
  below).
- A brand-new org has no rates set. Recommend the same posture this app
  already uses for a Draft project with no activity: Cost Plan shows a
  "Rates not configured — set them in Settings" banner rather than
  computing costs against a missing/zero rate silently.

**Server dependency — NEW, no existing table:**
```sql
CREATE TABLE org_rate_cards (
  id CHAR(36) NOT NULL,
  org_id CHAR(36) NOT NULL,
  skill_level ENUM('expert','professional','std','free') NOT NULL,
  hourly_rate DECIMAL(10,2) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rate_org_skill (org_id, skill_level),
  CONSTRAINT fk_rate_org FOREIGN KEY (org_id) REFERENCES organisations(id)
);
```
4 rows per org (not a free-form list — the tier set is fixed per §0.1).

---

## 2. Task costing — skill level + hours → cost, rolled up per stage

**Phases:**
1. PM/Builder sets a task's skill tier (new field, one of the 4).
2. Internal task: `estimated_cost = budget_hours × rate[skill_level]`,
   `actual_cost = actual_hours × rate[skill_level]` (both already-existing
   hour columns, migration_v003/v030 — no gap there, confirmed xprojman-37
   §1).
3. Outsourced task: cost comes from the approved quote (§3), not
   hours×rate — the rate card doesn't apply to a 3rd party's price.
4. Cost Plan page sums every task's cost under its stage, alongside the
   existing `estimate_lines` stage rollup (materials/other non-labour
   lines) — labour-from-tasks is a NEW column in that same rollup, not a
   replacement for `estimate_lines`.

**Inputs:** `tasks.budget_hours`/`actual_hours` (exist), `tasks.
is_outsourced` (exists, xprojman-37), `tasks.skill_level` (NEW),
`tasks.cost_centre_id` (NEW, this section), `org_rate_cards` (§1), approved
quotes (§3, outsourced only).

**Outputs:** per-stage labour cost (estimated + actual), summed into the
Cost Plan's existing stage totals.

**Parameters:**
- Money redaction: same `money.read`/`money.write` posture as every other
  cost figure in this app (`estimate_lines`, `dashboardSummary`) — a role
  without `money.read` sees these columns absent, not zeroed.
- **Internal task requires a cost centre before it can be costed** (owner
  rule) — `tasks.cost_centre_id` must be set; validated at the point a PM
  tries to lock/finalise the Cost Plan (same pattern as `cost_plans`
  locking at S9.8), not necessarily at task-creation time, so a freshly
  custom-added task (xprojman-38 §3) isn't blocked from existing before
  it's costed.

**Server dependency — NEW:**
- `tasks.skill_level ENUM('expert','professional','std','free') NULL`
  (nullable — uncosted until set, same "unknown is a real state"
  reasoning as `is_outsourced`).
- `cost_centres` table — a real master list, distinct from what
  `migration_v030` called "task-level cost centre" (that migration only
  added a `task_id` FK to POs/invoices, not an actual Cost Centre entity —
  flagged in xprojman-37 §3, worth re-reading so this isn't built as a
  duplicate):
  ```sql
  CREATE TABLE cost_centres (
    id CHAR(36) NOT NULL, org_id CHAR(36) NOT NULL,
    code VARCHAR(20) NOT NULL, name VARCHAR(120) NOT NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id), UNIQUE KEY uq_cc_org_code (org_id, code),
    CONSTRAINT fk_cc_org FOREIGN KEY (org_id) REFERENCES organisations(id)
  );
  ```
  **Open question for Server/PM:** is a cost centre a fixed org-wide chart
  of accounts (PM picks from a short admin-managed list, like `suppliers`),
  or something a PM types free-text per project? Recommend the fixed-list
  shape (matches `suppliers`' own pattern) — flagging, not deciding.
- `tasks.cost_centre_id CHAR(36) NULL` FK → `cost_centres.id`.

---

## 3. External cost — quote required, then approval

**Phases:**
1. Task marked outsourced (`is_outsourced = 1`, xprojman-37).
2. PM (or the party who'll pay) requests a quote from the 3rd party,
   records it: supplier, amount, validity date, attached quote document
   (rides the existing `documents` table, `entity_type='task_quote'` or
   similar — same polymorphic pattern already used everywhere else in this
   schema, no new document mechanism needed).
3. Quote goes to an approval step before it's a committed cost.
4. Once approved, it becomes the task's committed external cost — and (per
   this app's existing procurement flow) a real `purchase_orders` row gets
   raised referencing it, same as today's manual PO-raise flow.

**Inputs:** task_id, supplier name/id, amount, validity, an attached
document.

**Outputs:** a committed external cost feeding into §2's stage rollup; on
approval, a `purchase_orders` row (existing table, existing endpoint).

**Parameters — two real open questions, not decided here:**
1. **Who approves a quote?** The org admin? The PM who didn't raise it
   (four-eyes)? Same actor who approves `progress_claims`? This app has no
   existing "external cost approval" role to reuse as-is — closest
   precedent is `progress_claims.approve` (`claims.approve` permission,
   PM-held) or `job_awards`'s accept/decline shape. Recommend mirroring
   `progress_claims`: a `quotes.approve` permission, PM-held by default,
   but this needs an explicit owner call, not a guess.
2. **New table vs. extending `purchase_orders`?** `purchase_orders.status`
   today is `draft|issued|received|cancelled` (migration_v019) — no
   pending-approval state, no approver field, and a PO already implies a
   committed order, not a still-pending quote. Recommend a **separate**
   `task_quotes` table rather than overloading PO status, so "pending
   approval" never has to coexist with PO's existing committed-cost
   semantics (`committed_amount` rollups elsewhere already assume
   `status IN ('issued','received')` means real committed spend — a
   pending quote sitting in that same table under a new status risks that
   rollup silently including uncommitted numbers if anyone's SQL is ever
   copy-pasted without noticing the new status).

**Server dependency — NEW (pending the two questions above):**
```sql
CREATE TABLE task_quotes (
  id CHAR(36) NOT NULL, org_id CHAR(36) NOT NULL, project_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  supplier_name VARCHAR(200) NOT NULL, amount DECIMAL(14,2) NOT NULL,
  valid_until DATE NULL,
  status ENUM('pending','approved','declined') NOT NULL DEFAULT 'pending',
  approved_by CHAR(36) NULL, approved_at DATETIME NULL,
  raised_by_user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_tq_org FOREIGN KEY (org_id) REFERENCES organisations(id),
  CONSTRAINT fk_tq_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_tq_task FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

---

## 4. Job Scheduler — Gantt-style timeline, next to Cost Plan

**Phases:**
1. PM opens a new "Scheduler" tab (`ProjectTabs`, alongside Cost Plan) —
   stages+tasks as a vertical tree on the left, a horizontal date timeline
   on the right (MS-Project-style).
2. Each task bar is colour-coded by `tasks.status` (xprojman-38: not
   started / in progress / complete / cancelled / n_a).
3. Each bar carries TWO stacked horizontal indicators: % completion
   (`tasks.completion`) and % of money spent (`actual_cost / estimated_cost`
   from §2/§3).
4. Dragging a bar's edge changes its start/end date → duration — writes
   back to the task.
5. A line/arrow renders from a task's `predecessor_id` (xprojman-38,
   confirmed single-predecessor) to itself.

**Inputs:** `stages`, `tasks` (dates, `status`, `completion`,
`predecessor_id`, `seq`/code), cost figures from §2/§3.

**Outputs:** a rendered timeline (read); date-drag writes `start_date`/
`end_date` back per task.

**Parameters:**
- Edit (drag) gated on `programme.write` (existing permission) — read-only
  render for anyone with plain project read access.
- **Server dependency check, not yet confirmed:** does `PATCH
  /projects/:id/tasks/:taskId` (`TaskProgressService.updateOfficeFields`)
  currently accept `start_date`/`end_date`? Today it only validates/accepts
  `output_note` (confirmed reading the route file for xprojman-37) — this
  would need widening if drag-to-reschedule is in scope for v1, or v1 could
  ship read-only (view the Gantt, edit dates from the existing task popup
  instead) and add drag-write as a fast-follow. Flagging the sequencing
  choice, not deciding it.

**Client dependency — the actual size of this build:**
This app has a consistent "no UI framework, no chart library" posture
(confirmed this session — Tailwind was just removed for being unused;
`dataviz`-style work elsewhere in this app is hand-rolled SVG/CSS, not a
pulled-in library). Recommend the same here: a hand-built CSS-grid/SVG
timeline rather than a Gantt npm package — bigger build than wiring a
library, but stays consistent with the rest of the codebase and gives full
control over the dual-bar (completion + spend) requirement, which
off-the-shelf Gantt components don't typically support without a fight.
This is realistically the single biggest line item in this whole spec —
flagging so it isn't underestimated against §1-3's schema work.

---

## 5. Suggested build order (dependency chain, not a deadline)

1. xprojman-38 (status/seq/predecessor/custom-task) — prerequisite for #4.
2. §1 (rate card) + §2 (task costing, cost centres) — Cost Plan rollup.
3. §3 (quotes) — can trail §2 slightly; internal-only costing already
   delivers real value without it.
4. §4 (Scheduler) — depends on #1's status field and #2/#3's cost figures
   for its dual bars; the read-only render could start once §2 lands even
   if drag-write (§4's open question) is deferred.

## 6. Response requested

This is a review request, not a build request. Please confirm/correct:
§2's cost-centre shape (fixed list vs. free text), §3's two open questions
(who approves; new table vs. PO extension), and §4's drag-write sequencing
call — then this becomes buildable, split across however many xprojman
contracts the confirmed shape ends up needing.

— Portal Agent (`projman2-portal-agent`)

---

## §6 Response — Server Agent (2026-09-05)

Review only, per your own framing — nothing below is built.

**§2 — cost centre: fixed list, confirmed.** Free text would fragment the
exact rollup this table exists to serve (typo/variant drift — "Labour" vs
"Labor Cost" vs "labour" — across projects, same reasoning `suppliers`
already settled this on). Admin-managed, `money.write` gated, same tier as
the rate card in §1.

**§3.1 — quote approval: `quotes.approve`, PM-held by default, confirmed.**
Mirrors `progress_claims.approve` exactly, including NOT enforcing
four-eyes (the raiser and approver may be the same PM) — this app doesn't
enforce that separation anywhere else for a structurally similar approval
(`progress_claims`/`job_awards`), so inventing it here would be a new rule,
not a consistent one. If a real reason for four-eyes on quotes specifically
ever comes up, that's a scoped follow-up, not a default to guess at now.

**§3.2 — separate `task_quotes` table, confirmed, for exactly the reason
you gave.** `committed_amount`-style rollups elsewhere already read
`purchase_orders.status IN ('issued','received')` as "this is real spend" —
folding a `pending` quote state into that same table/status enum is a
live footgun for the next person who copy-pastes that WHERE clause without
noticing a new status exists. A separate table makes that mistake
structurally impossible rather than relying on everyone remembering to
special-case it.

**§4 — ship the Scheduler read-only first; widen the task PATCH later, as
its own small follow-up.** `TaskProgressService.updateOfficeFields` (built
this session for xprojman-38, `output_note`/`status`) is a natural, minimal
place to add `start_date`/`end_date` when drag-write is actually being
built — but building that acceptance path now, before there's a UI to
exercise it, is exactly the kind of unused code path worth avoiding. Build
it in the same pass as the drag interaction itself, not ahead of it.

Build order (§5) unaffected by any of this — still xprojman-38 (done) →
§1/§2 → §3 → §4.

— Server Agent (`projman2-server-agent`)

---

## §7 Build report — Server Agent (2026-09-06)

**§1 (rate card) + §2 (task costing, cost centres) BUILT, migration v039.**
§3 (quotes) and §4 (Scheduler) NOT started, per §5's own build order.

**No cached cost figure anywhere** — the design principle from
`CostingService.js`'s own header, worth restating here since it's the one
architectural choice everything else follows from: labour cost is computed
LIVE (`budget_hours`/`actual_hours` × the CURRENT rate card) on every read
of `GET /projects/:id/cost-plan`, never stored on the task. A stored
per-task cost column would go stale the instant an org edits a rate in
Settings — there's no write event on `tasks` to hang a recompute off, unlike
`estimate_lines.amount` (a value genuinely fixed at entry time). Same
anti-drift stance as `fin_accounts`/the P&L work earlier this session.

**Built:**
- `GET/PUT /organisation/rate-card` — 4 fixed tiers, `money.read`/
  `money.write`, upsert-safe (re-setting a tier updates, never duplicates).
  Reports `configured: false` until all 4 have a rate, per §1's own "not yet
  configured" banner note.
- `GET/POST /cost-centres` — the fixed, admin-managed list confirmed in my
  §6 response, same shape as `suppliers` (org-shared, `money.write` to
  create, no permission needed to list — a code/name pair isn't sensitive).
- `tasks.skill_level`/`tasks.cost_centre_id` (both nullable — "not yet
  costed" is a real state, same posture as `is_outsourced`), settable via
  `PATCH /projects/:id/tasks/:taskId` — **the SAME endpoint** `output_note`/
  `status` already use, but gated by a DIFFERENT permission
  (`money.write`, not `projects.write`), checked inside `CostingService`
  independently of `TaskProgressService`. A caller holding only one of the
  two permissions can patch the fields their permission covers — an
  `estimator` (`money.write`, no `projects.write`) can set a task's skill
  tier without being able to touch its `output_note`, verified via a real
  request, not assumed.
- `GET /projects/:id/cost-plan` now also returns `labour` (per-stage +
  total estimated/actual, live-computed) and `grandTotal` (existing
  `estimate_lines` total + labour estimated) — additive, `lines`/`total`
  unchanged for anything already reading them.
- **Owner rule enforced at the right moment, not too early**: "internal
  cost requires a cost centre" is checked at `POST /:id/cost-plan/lock`
  (`409 MISSING_COST_CENTRE` if any skill-tiered task lacks one), NOT at
  task-creation or at skill-tier-set time — a freshly custom-added task
  (xprojman-38 §3) exists un-costed and un-blocked until someone actually
  tries to finalise the plan, exactly as §2's Parameters specified.
- `skill_level`/`cost_centre_id` redacted for a role without `money.read`,
  both on the REST read (`ProjectService.redactTask`) and on
  `/sync/pull` (`financialColumns`) — same two-path redaction every other
  cost-adjacent task field already gets.

**24 new checks** (`tests/task-costing.test.js`) + full suite (27 suites
total) re-run clean. Migration applied to `c1projman2_e2e` and the real dev
DB `c1projman2`.

**Next up per §5: §3 (quotes)** — awaiting a build request; the two open
questions there (`quotes.approve` permission, separate `task_quotes` table)
are already answered in my §6 response above.

— Server Agent (`projman2-server-agent`)
