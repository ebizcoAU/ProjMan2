# xprojman-32 — Server: WA_RESIDENTIAL_18 task library (`stage_task_templates`, migration v034)

**Status:** 🟢 BUILT + VERIFIED. Owner-directed 2026-09-03, with a correction
mid-directive (see §1) before any schema was written.
**Author:** Server Agent (`projman2-server-agent`) · **For:** Portal Agent
(`projman2-portal-agent` — task drill-down UI, `xprojman-28` module 19) ·
Owner
**Date:** 2026-09-03
**Related:** `docs/researchPaper/18Stage_Tasks.md` (the source content — Portal
draft + PM's Reality Check review, merged), `xprojman-28` module 19 (Portal's
Task drill-down screen this unblocks), `serverdesignspecification.md` §14.3
(the S9.10 seed-timing tension, deliberately not reopened here).

---

## 1. The correction — read this before assuming `stage_template_items` holds tasks

The owner's original directive asked for the 139-task list to be seeded
directly into `stage_template_items`. That table is **stage-granularity**,
not task-granularity: exactly 18 rows per template (`migration_v006`),
`UNIQUE(template_id, seq)` with `seq = 1..18`, and every project's
`project_stages` is instantiated 1:1 from it
(`StageTemplateService.instantiate`). Seeding 139 rows into it under one
`seq` sequence would have:
- **Violated `UNIQUE(template_id, seq)`** the moment a second stage's task #1
  tried to insert alongside the first stage's task #1 at the same `seq`.
- **Broken stage instantiation for every project going forward** — the
  instantiate loop would have stamped 139 "stages" instead of 18.

Caught before any migration was written, corrected in conversation, and
approved by the owner: a **new** table, one level under
`stage_template_items`, same parent/child shape already proven twice in this
schema (`stage_templates`/`stage_template_items`, `cost_plans`/
`estimate_lines`).

## 2. What was built

**Migration v034** — `stage_task_templates` (`template_id`, `stage_seq` —
a soft ref by value to `stage_template_items.seq`, not an FK to its id, so a
cloned template's tasks don't need remapping — `seq`, `code`, `name`,
`actor_role`, `is_hold_point`, `UNIQUE(template_id, stage_seq, seq)`) +
`tasks.template_item_id` (nullable FK, same precedent as
`project_stages.template_item_id` → `stage_template_items.id` — lets a
seeded task resolve its code/actor/hold-point metadata without duplicating
those columns onto every row; `NULL` for anything a PM/Builder adds by hand).

**Seed data** — all 139 tasks from `docs/researchPaper/18Stage_Tasks.md`,
**script-extracted from the document's own markdown tables**, not
hand-typed, specifically to avoid a transcription slip across 139 rows.
Verified against the doc's own claimed totals before writing the migration:
139 rows, 15 hold points, exact per-stage counts (7,8,5,4,3,6,5,8,10,7,11,9,
10,7,8,10,9,12) — all matched on the first extraction pass.

**Instantiation** — `StageTemplateService.instantiate()` now seeds a
project's `tasks` rows from `stage_task_templates` in the **same
transaction, same atomic-at-creation timing** as the 18 stages themselves
(owner's decision — match current behaviour; the `S9.10` spec-vs-build
tension over *when* stages 10–18 should really seed is a separate, existing,
deliberately-not-reopened question, `serverdesignspecification.md` §14.3).

**Read path for Portal** — `GET /stage-templates/:id` now also returns
`taskItems` (the 139 template rows) alongside the existing 18 `items` — one
call resolves both a project's stages and its tasks' template metadata. No
new endpoint: this was a gap the directive's own "Portal UI can now be built
against this content" implied but didn't have a read path for yet, so it's
included here rather than surfaced as a separate ask.

**Not built / explicitly out of scope:**
- No `POST /stage-templates/:id/tasks` (add a template task without a
  migration) — same posture as the stage-level template today.
- `tasks.template_item_id` is not yet added to `sync/registry.js`'s
  `tasks.columns` — there's no App-side task-list consumer for it yet
  (confirmed in `xprojman-29`: the App has no generic task-list screen at
  all today). Add it when one exists, not speculatively now.

## 3. Verified, not just written

Against a fresh `c1projman2_e2e`:
- New `tests/stage-task-templates.test.js` (9/9): template read returns 139
  task items / 15 hold points; instantiate stamps exactly 139 tasks; **every
  individual stage** matches its exact expected task + hold-point count (not
  just the totals); `template_item_id` round-trips through `GET
  /projects/:id` and resolves back to real metadata; re-instantiation still
  correctly refused.
- `UNIQUE(template_id, stage_seq, seq)` confirmed refusing a duplicate insert
  (`ER_DUP_ENTRY`).
- No regression: `stages.test.js` (17/17), `veritrade-login.test.js`
  (12/12), `isolation.test.js` (16/16), `domain.test.js` (34/34) all still
  green — the new task-seeding step inside `instantiate()`'s transaction
  didn't disturb stage progression, org isolation, or anything else in the
  domain surface.

Migration applied to both `c1projman2_e2e` and live dev `c1projman2`.

## 5. Follow-up, 2026-09-03: `PATCH /projects/:id/tasks/:taskId` (`output_note`)

Flagged as the one gap Portal's task drill-down would hit immediately: the
seeded tasks were readable (`GET /projects/:id`) but not editable —
`output_note` (v030) had no write path from the desk at all. Built:
`TaskProgressService.updateOfficeFields` + the PATCH route, gated
`projects.write` (plain task metadata, not the `progress.tick`/
`progress.verify` chain — same permission `canWriteProjects` already gates
elsewhere in this route file). Non-portfolio roles scope-checked via the same
`isProjectMember` guard `verify()` already uses.

Verified (`tests/stage-task-templates.test.js`, extended, 14/14 total in that
file): happy path persists and round-trips through `GET /projects/:id`;
missing `output_note` refused (422); unknown task refused (404);
unauthenticated refused (401). Applied live.

**Incident, self-reported:** restarting the API to pick this up, I ran
`pkill -f "src/index.js"` to stop a throwaway `:4199` e2e instance — too
broad a pattern, since live dev `:5100` runs the identical command and
matched too. `:5100` was down for well under a minute before I caught it via
the next health check and restarted it; no data loss (MySQL untouched, only
the Node process), but flagging it plainly rather than quietly restarting
and moving on. Will scope `pkill` by PID, not command pattern, from here.

## 4. What this unblocks

Portal's Task drill-down (`xprojman-28` module 19, `docs/mocked/portal/
task_detail.html`) can now be built against real seeded `tasks` rows with
real hold-point/actor metadata resolvable via the template read — the
content and the schema both exist; the screen is next, Portal's own lane.

---

© eBizco Australia Pty Ltd
