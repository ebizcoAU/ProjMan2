# xprojman-45 — S9.10 programme seeding ruling + Stage-patch (D2) build audit

**Status:** 🟡 DRAFT. §1 needs an **Owner ruling** (it is serverdesignspecification.md §14.5 row 31).
§2 is a status report and needs no decision. **No code until §1 is ruled.**
**Author:** Server Dev (`projman2-server-agent`, session `projman2-a2`).
**For:** PM (`projman2-82`), who routes §1 to the SA and then the Owner. Copy to Portal and App.
**Date:** 2026-09-30.
**Sources:**
- `ProjMan_18Stage_Specification_v3.4.pdf`, p.18 (S9.9, S9.10) and the Stage 10–18 tables.
- `serverdesignspecification.md` §8 (Quality row), §9 D2, §14.3 and §14.5 #31.
- `processmap.md` ~l.141–154.
- The live code on `server/p5-site-ops` at `ce5a016`, and a read-only query of the `c1projman2` schema and data.

---

## 1. Handover #7: S9.10 vs `instantiate` (needs an Owner ruling)

### 1.1 What the spec says
S9.10: *"System: seed project_stages 10–18 + tasks from the stage template, now that a Builder is attached.
This is where the Gantt actually comes alive."* For a multi-unit project, S9.10 is also where the
Builder sets each task's scope (project or unit), with defaults the system proposes.

### 1.2 What is built
- `StageTemplateService.instantiate` (`POST /projects/:id/programme`) stamps **all 18 stages** in one
  transaction. It also seeds their hold-point checklist (`HoldPointService.seedForStage`) and their
  task-library rows (`tasks`).
- The App calls it immediately after it creates the project (`create_project_screen.dart:94`).
  Portal calls it from a template picker.
- **Nothing is seeded on Job Award accept.** `JobAwardService.respond` writes `project_members` and,
  since v045, `subcontractor_engagements`. It never touches stages.
- `StageProgressionService` has only the `gate_prev` sequential gate. **No rule requires a Builder
  before Stage 10 starts.**

### 1.3 Evidence from the live data (`c1projman2`, 2026-09-30)
- 267 live projects: 157 have a programme and 110 have none.
- **129 stage rows in Stages 10–18 are already `in_progress` or `complete` on projects with no accepted
  `role_offered='builder'` Job Award.** Much of this is likely test data, but it proves the system
  lets site work start before a Builder exists. That contradicts the Job Award rule the spec builds
  Stage 9 around.

### 1.4 Why the spec's literal reading has a cost of its own
S9.9 (lock the Cost Plan, deposit milestone) comes **before** S9.10. Cost roll-ups
(`CostingService`, v039) and task quotes (`TaskQuoteService`, v043) are **task-level, grouped by
stage**. Portal's Cost Plan page shows *"No programme yet — instantiate stages first"*. Stages 8–9
(BOQ, tender compare, Cost Plan) therefore need the Stage 10–18 task rows to exist before S9.10. If
those rows are only seeded at S9.10, there is nothing to price at S9.9.

The spec's real intent is *"the Builder's work doesn't go live until a Builder is attached"*. It
doesn't strictly require that *"the rows don't exist until then"*.

(§14.3 also says "Stage 9's tender/Job-Award flow isn't built either". That is stale: Job Award send,
accept and deposit are all built, in xprojman-11, xprojman-44 and v045.)

### 1.5 Options

| | Option | What changes | Migration / build cost |
|---|---|---|---|
| **A** | **Literal spec: split seeding.** Stamp 1–9 at creation. Stamp 10–18 (plus tasks and hold points) inside `JobAwardService.respond` on the first accepted `builder` award. | `instantiate` takes a stage range. `respond` calls it. The App create flow and Portal's picker only seed 1–9. | **High.** The Cost Plan, BOQ and task quotes lose their Stage 10–18 task rows before S9.9, so Portal needs a separate "planned scope" layer or a re-sequenced S9.9. The 157 existing programmes can't be un-seeded: 129 rows have progressed, so those projects would have to be grandfathered as a second code path. Touches Server, App and Portal, plus about 6 test files. |
| **B** ★ | **Keep atomic stamping, add a hard Builder gate.** All 18 stages still exist from creation, so Stages 8–9 can price them. **A Stage with `seq ≥ 10` cannot move to `in_progress` until the project has an accepted `role_offered='builder'` Job Award.** S9.10 becomes the **activation** step on accept: the Builder confirms each task's scope (project or unit) and the Gantt is flagged live. | One check in `StageProgressionService` (new error `BUILDER_NOT_ATTACHED`, 409). **The same check on the `/sync/push` path**, because App can push `project_stages` status offline, the same way `ComplianceService`'s gates are enforced today. A `programme_activated_at` stamp on accept. Spec wording: S9.10 changes from "seed" to "activate". | **Low.** One migration adding one column. Existing progressed rows are untouched, because the gate only fires on the *transition* to `in_progress`. `employee`-type Builders also go through a Job Award (`ENGAGEMENT_TYPES` includes `employee`), so there is no in-house-crew exception to design. About 1 new test file, and Server only. The task-scope confirmation UI (the multi-unit half of S9.10) is a later Portal item. |
| **C** | **Status quo: amend the spec only.** Declare that atomic stamping is correct and drop "now that a Builder is attached". | Documentation only. | **Zero code**, but it leaves Stage 10 startable without a Builder. That undermines the Job Award rule, the commercial visibility walls (which key off the Builder's engagement) and the S9.9 deposit anchor. Not recommended. |

### 1.6 Recommendation
**Option B.** It keeps what the spec actually protects: no site work, and no Gantt going live, before
a Builder has accepted and the deposit has been anchored. It does this without breaking Stages 8–9
costing, which already relies on the rows existing. It is the only option that fixes the live gap
in §1.3 at low cost.

**Owner ruling:** ☐ A ☐ B ☐ C (date, initials).

---

## 2. Handover #8: build status of the Stage patches (§8 / D2)

Checked against the live code and the `c1projman2` schema. Everything below shipped in
**migration v016** (`migration_v016_stage_patches.sql`), plus `HoldPointService` and
`ProjectService`. That work was a deliberate *patch*: a per-stage checklist added on top of the
existing stage gate. It is not the full S10.1–S18.16 sub-step model.

| Patch | Status | What exists | Gap |
|---|---|---|---|
| **S1.3** unit-count declaration | ✅ **Built** | `modular_units` table. `ProjectService.createProject` writes N rows from `unit_count`, with a minimum of 1. | Building *type* isn't stored, only the count. The Portal Line-of-Balance renderer switches on the count (the Portal lane has built the LOB page, `a2287db`). |
| **S10.5** survey set-out hold point | 🟡 **Partly built** | A `hold_point_requirements` row is seeded on Stage 10 with `blocks_progress=1` and verifier `siteSupervisor`, enforced by `StageProgressionService` via `allBlockingSatisfied`. | The v034 **task library** code `S10.5` is "Install temporary fencing and signage", not survey set-out (the known mismatch between the library codes and the PDF codes). The gate works; the label/code mapping is wrong. |
| **S11.9** split into 3 hold points | 🟡 **Partly built** | Three named `hold_point_requirements` rows (electrician, plumber, PC). The task library has S11.9, S11.10 and S11.11 as hold-point tasks, with the pour at S11.12. | The three rows are seeded `blocks_progress=0`, as information only. Stage 11 still blocks through the older stage-level `is_validated` gate, so an individual missing certificate doesn't block on its own. v016 made this choice deliberately so as not to tighten a tested gate. Making them blocking is a small change, if wanted. |
| **S12.8/S12.9** auto-flag via `triggered_by_finding_id` | 🟡 **Partly built (schema only)** | The `hold_point_requirements.triggered_by_finding_id` column exists. Two rows are seeded, information only. | **No S2.4 hazard-audit table exists** (there is no `hazard`/`finding` table in the live schema), so nothing can populate the link or auto-flag. Only manual Inspector judgement works today. This needs the S2.4 hazard-audit module first, which is part of the Stage 2 desk work (Portal lane) and needs Server schema. |
| **S16.7** jurisdiction + state-certificate reference table | 🟡 **Partly built** | The `hold_point_requirements.jurisdiction` column exists. The S16.7 row is seeded `blocks_progress=1` with `jurisdiction` resolved at seed time. | (a) **There is no state-to-certificate reference table** (COES, CCEW, etc.), so the label is a generic "Mains energisation certificate". (b) Jurisdiction resolves from **`organisations.state`, not the project site's state**, and `projects` has no state column, only `site_address`. A WA builder building in NSW would get the wrong state. (c) In the live data, only 2 of the rows have a jurisdiction; the rest are null because most orgs have no `state`. |
| **S17.2** driveway/crossover (manual flag, uses the jurisdiction field) | ✅ **Built as specified** | Seeded as information only, verifier PM (`programme.write`), with `jurisdiction`. | It has the same org-state versus site-state issue as S16.7 (b). |
| **S18.11/S18.12** draft, then accountant approval | ✅ **Built** | `DepreciationService` (v022): S18.11 writes `fixed_assets` as a draft and S18.12 approves it (`tax.approve`, `accountant` role). A blocking Stage 18 hold-point row is seeded. | The v034 task-library codes S18.11/S18.12 are "Client final sign-off" and "Status completed", which is the pre-v3.4 numbering. It is the same library/PDF code mismatch as S10.5, and the xprojman-43 S18.11 sign-off work must not rely on those library codes. |

### 2.1 Follow-ups this surfaces (none need a decision to scope; each would get its own contract)
1. **A project site state.** Add a `projects.site_state` column and resolve jurisdiction from it, falling back to `organisations.state`. It is small and fixes S16.7 and S17.2 (b).
2. **The state-to-certificate reference table for S16.7**: eight state/territory rows with a certificate name and a requirement. It is small, and a seed-only migration.
3. **Task-library code alignment.** Re-map the v034 codes (S10.5, S18.11–S18.16 and others) to the PDF numbering, or document the mapping explicitly (xprojman-roles §2.6 already notes it). Portal leads (it owns `18Stage_Tasks.md`), and Server writes the re-seed migration.
4. **The S2.4 hazard-audit module**, which blocks S12.8/S12.9 auto-flagging. It is larger, and part of the Stage 2 design pass.
5. Optionally, make the three S11.9 rows blocking.

---

## 3. Responses
_(dated, initialled; don't overwrite)_

© eBizco Australia Pty Ltd — xprojman-45.md, 2026-09-30
