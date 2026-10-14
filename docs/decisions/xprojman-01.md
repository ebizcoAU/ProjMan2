# xprojman-01 — Server Team Assessment: current implementation vs. 18-Stage Spec v3.4

**Status:** 🟡 Assessment delivered · **Author:** Server dev (NexusPM) · **For:** Manager
**Date:** 2026-07-27
**Directive:** DIRECTIVE 2 — Server Team (Manager → Server Agent)
**Required reading completed:** `ProjMan_18Stage_Specification_v3.4.pdf` (read in full,
35 pages) · `devroadmap.md` · `serverdesignspecification.md` · `portaldesignspecification.md`
· `dashboarddesignspecification.md`

---

### Server Team Assessment — 2026-07-27

#### Summary
- **Roles in database:** 6 — `projectManager`, `siteSupervisor`, `foreperson`, `tradie`, `inspector`, `client` (`migration_v005_five_roles.sql`)
- **Permission matrix version:** `matrix_version = 4` (unchanged since P6a; v3.4 spec's corrective migration — devroadmap.md's "P10" — has not started)
- **Key tables present:** `roles`, `role_permissions`, `project_members`, `project_stages`, `inspections`, `inspection_items`, `defects`, `certificates`, `ncc_register`, `cpc_units`, `cpc_feature_map`, `platform_admins`
- **Key tables absent:** `job_awards`, `introductions`, `builder_engagements`/`subcontractor_engagements`, `hold_point_requirements`, any VeriTrade table
- **Note on source version:** the directive and PDF filename both say **v3.4** (dated 26 July 2026); `devroadmap.md`/`serverdesignspecification.md` cite "v3.3" as their source throughout. I read the v3.4 PDF directly (35 pages, in full) rather than relying on the companion docs' citation — the two are consistent everywhere I cross-checked, so this looks like the companion docs simply weren't re-stamped when the PDF was finalized as 3.4, not a substantive drift. Flagging it; not treating it as a blocker.

---

#### S1 — Role Enumeration
**Status:** Partially
**Details:** `roles` table has exactly 6 rows (`migration_v005_five_roles.sql`): `projectManager`, `siteSupervisor`, `foreperson`, `tradie`, `inspector`, `client`.
**Gap:** No `builder`, no `developer` (Property Developer), no `accountant`. The v3.4 role model (`devroadmap.md` §3, `serverdesignspecification.md` §7.2) is 9 v1 roles — the 3 missing are exactly the 3 the spec calls out as the corrective additions, `builder` explicitly named "the single biggest correction in this framework."

#### S2 — Permission Matrix
**Status:** Missing
**Details:** Single `progress.write` permission exists, granted to `projectManager`/`siteSupervisor`/`foreperson`/`tradie` (scope-differentiated by `scope_class`, not by a tick/verify split). Checked directly in `StageProgressionService.checkTransition` — one `hasPermission(actor.role, 'progress.write')` call, no second check.
**Gap:** No `progress.tick` / `progress.verify` split, no `verified_by`/`verified_at` protected columns on any progress-bearing table (the only `verified_at` in the codebase belongs to `sms_verifications`, unrelated). This is the server-side form of "tick-then-verify" (18-Stage spec §1.3) and it doesn't exist yet.

#### S3 — PM Programme Write
**Status:** Missing
**Details:** `programme.write` is granted to `projectManager` as a flat permission (`migration_v005`) and checked as a flat `requirePermission('programme.write')` on `POST/PATCH /projects/:id/stages*` (`routes/projects.js`) — no stage-number condition anywhere in that path.
**Gap:** Spec requires `programme.write` scoped **per row**: PM holds it Stages 1–8 only, read-only from Stage 9 on (`serverdesignspecification.md` §7.2). Currently PM holds it unconditionally across all 18 stages — the exact defect the spec calls out by name.

#### S4 — Builder Engagement Mode
**Status:** Missing
**Details:** Neither `job_awards` nor `builder_engagements` exists in any migration (`v001`–`v011`).
**Gap:** No engagement model at all yet, so no `engagement_mode` column either. This is Step A2 of the spec's own proposed build order — not started.

#### S5 — Cost Plan Resolution
**Status:** Missing
**Details:** `money.read`/`money.write` are flat permissions (`projectManager` only, in the current matrix); no query resolves visibility conditionally.
**Gap:** Depends entirely on S4 (`engagement_mode` doesn't exist to condition on). No `independent_fixed` / `independent_cost_plus` / `employee` resolution logic anywhere.

#### S6 — Identity Tables
**Status:** Missing
**Details:** Only `pairing_tokens` + `devices` exist (MAOI-style device pairing, Phase 1). No `introductions`, no `job_awards`.
**Gap:** The full Self-Registration → Introduction → Job Award three-event model (`serverdesignspecification.md` §7.3) isn't built. Current pairing is a single-step "PM issues a pairing QR, device gets a role" — closer to the *retired* two-step Register/Assign model the v3.4 spec explicitly replaces.

#### S7 — Job Award Constraint
**Status:** Missing
**Details:** N/A — no `job_awards` table exists to enforce a constraint on.
**Gap:** The "PM cannot Job-Award a cold stranger" server-side teeth (an `introductions` row must pre-exist) has nothing to attach to yet.

#### S8 — Deposit Anchor
**Status:** Missing
**Details:** N/A — no `job_awards` table, no `deposit_payment_id` FK, and no TPAR-reportable payment table wired to an award/acceptance event.
**Gap:** `job_awards.status='accepted'` + `deposit_payment_id` (S9.9's binding anchor, per the PDF pages 17–18) isn't modelled at all.

#### S9 — Tick-Verify Enforcement
**Status:** Missing
**Details:** Same root cause as S2 — one `progress.write` permission, not two. `siteSupervisor` and `foreperson`/`tradie` are differentiated today only by `scope_class` (assigned vs. self), not by a tick-vs-verify capability split.
**Gap:** No enforcement exists that `progress.verify` (the protected `verified_by`/`verified_at` write) is Site-Supervisor-only, or that `progress.tick` is Tradie/Foreperson-only, because neither permission exists as a distinct capability yet.
**Adjacent note:** `quality.validate` (the `is_validated` flip) **is** already correctly narrow — checked once in `StageProgressionService.validate()`, inspector-only, nothing else touches that column. That part of Open Decision #4 (`serverdesignspecification.md` §10) checks out clean. What I also found: P6a added a separate `quality.write` permission (inspector + PM + siteSupervisor) for inspections/defects/certificates CRUD via sync-push — broader than "is_validated-only," but a distinct permission from `quality.validate`, not a scope leak on it. Worth the audit item #4 explicitly confirming that distinction is intentional, since the spec's phrasing could be read either way.

#### S10 — Deactivation vs. Erasure
**Status:** Missing
**Details:** There is no `DELETE /users/:id` route at all in the codebase (checked all of `src/routes/*.js`). The closest existing behaviour is `POST /admin/users/:id/suspend` (System Admin dashboard, `admin_role` gated), which sets `status='suspended'` — an account-status flip, not a deactivation flow.
**Gap:** No `deactivated_at` column, no VeriTrade-pull step (N/A, VeriTrade doesn't exist yet), no discretionary-vs-relied-upon-evidence purge distinction (`serverdesignspecification.md` §7.6). This is a fair gap to log, but low-severity right now since there's no hard-delete path to begin with — nothing to actively rectify before it's built for the first time correctly.

#### S11 — Subcontractor Consent
**Status:** Missing
**Details:** No `subcontractor_engagements` table exists.
**Gap:** `upward_disclosure_consent`/`consent_recorded_at`/`consent_document_id` (§7.2.1) has nothing to land on yet. Depends on S4/S6 landing first.

#### S12 — VeriTrade Login Endpoint
**Status:** Missing
**Details:** Zero references to "veritrade" anywhere in `server/api/src` or `mysql/`.
**Gap:** Entire surface absent — expected, per the spec's own build order (`serverdesignspecification.md` §9, step F), gated behind `PM2-02` which is itself still an open decision record, not yet resolved. This is the furthest-out item on the list by design, not an oversight.

#### S13 — Stage 16 Energisation
**Status:** Missing
**Details:** No `hold_point_requirements` table exists at all. What's built instead: `inspections` (free-text `type` column, e.g. `'slab'`, `'frame'`, `'structural'`) + `ncc_register` (P6b, has `ncc_class`/`building_type` but no `jurisdiction` column) + `certificates`. None of these model "a checklist per stage, each item flagged `statutory`/`internal_qa`, with a `required_inspector_type`" the way the v3.4 spec's §1.5 describes.
**Gap:** No `jurisdiction` column anywhere, no state → certificate reference table (COES/CCEW/Certificate of Testing & Compliance/CoC/CES). This is P6a/P6b's actual schema shape (built against the *pre-correction* spec) being superseded by a materially different hold-point model (checklist-of-named-items vs. a single `is_hold_point` boolean per stage) — the biggest structural gap on this list, not just a missing column.

#### S14 — Stage 10 Survey Set-out
**Status:** Missing
**Details:** `project_stages.is_hold_point` exists at the **whole-stage** level only (hold points seeded at stages 11/12/13/15/18 in `WA_RESIDENTIAL_18`). There is no sub-step granularity in the current engine at all — no `S10.5` equivalent, because the engine doesn't model stages 1–18 at the sub-step (`S10.1`...`S10.6`) level the v3.4 spec decomposes them to.
**Gap:** Confirmed directly from the PDF (p.19): `S10.5` is explicitly a corrected, elevated hard hold point blocking Stage 11 ("cost asymmetry drove the decision — verifying setout here is cheap; discovering a wrong boundary/setback at Stage 12's slab pour is not"). This can't be expressed in the current schema without the sub-step model existing first.

#### S15 — Stage 18 Split
**Status:** Missing
**Details:** Current `project_stages` has one row for Stage 18 total; no sub-step rows, no `accountant` role, no `tax.approve` permission.
**Gap:** `S18.11` (system prepares draft, no transmission) separate from `S18.12` (accountant/BAS-agent approval gate before ATO lodgement) — per the PDF (p.27) this was **the single most consequential fix in the whole document**: "the single most consequential external event in the matrix no longer fires without independent, licensed human review." None of it exists yet — same root cause as S14 (no sub-step model).

---

#### Root Cause Analysis

**This is design evolution, not implementation drift or a porting defect.** Every gap above traces to one fact: the server was built — correctly, and tested (162 tests, 8 suites, all green) — against an **earlier version of the domain model**, before the v3.3/v3.4 corrective pass existed. `devroadmap.md` and `serverdesignspecification.md` both say this explicitly and in their own words:

- `devroadmap.md` §11: role/permission correction is **"P10 — depends on P4–P9 must be stable first."** P4–P9 (projects, site ops, safety/quality, commercial, accounting, tax) are exactly what's built. P10 hasn't started, by the roadmap's own dependency order.
- `serverdesignspecification.md` header: **"§5 onward describes already-built modules; §1–4 and §7–8 are the corrected architecture layer, ships as a migration on top of what exists."**
- The v3.4 PDF's own Part 3 log (p.29–30) frames every one of S2/S3/S9/S13/S14/S15's underlying corrections as items **"Resolved following external and founder review"** — meaning these are recent design decisions, not requirements the server was ever asked to meet and missed.

Two genuinely distinct kinds of gap sit inside this one root cause, worth keeping separate for planning:

1. **Additive, no schema conflict** (S1/S4/S6/S7/S8/S11/S12): new tables/columns/roles that layer on top of what exists — `job_awards`, `introductions`, `engagement_mode`, `builder`/`developer`/`accountant` roles, VeriTrade endpoints. None of this requires touching P4–P9's existing schema.
2. **Structural, conflicts with what's built** (S13/S14/S15, and to a lesser extent S9): the v3.4 spec's hold-point model is **sub-step-level and checklist-based** (`S10.5`, `S16.7`, a `hold_point_requirements` list per stage). The current engine is **whole-stage-level and boolean** (`project_stages.is_hold_point`). P6a/P6b (`inspections`/`ncc_register`) were built faithfully against the older, coarser model and now need re-architecture, not just an additive column, to reach the sub-step granularity the v3.4 spec requires.

#### Recommended Corrections

Priority order follows `serverdesignspecification.md` §9's own proposed build order, which I independently agree with — Steps A–D2 have no dependency on the still-open `PM2-02` decision and can start now:

1. **Step A (do first, unblocks S1/S2/S3/S9):** corrective migration — add `builder`/`developer`/`accountant` roles, split `progress.write` → `progress.tick`/`progress.verify` + `verified_by`/`verified_at` columns, scope `programme.write` per stage range, add `tax.approve`. Additive migration, no rewrite of `roles`/`role_permissions`.
2. **Step A2 (unblocks S4/S5/S11):** `engagement_mode` column + query-time `money.read`/`money.write` resolution + `subcontractor_engagements.upward_disclosure_consent`.
3. **Step B (unblocks S6/S7/S8):** the `introductions`/`job_awards` data model + the cold-stranger constraint + the deposit-anchor FK.
4. **Step D2, the structural piece (unblocks S13/S14/S15):** decide whether `project_stages` grows a genuine sub-step child table (`stage_substeps` or similar, one row per `S10.5`-style code) or whether hold points move into a proper `hold_point_requirements` table keyed to the existing stage rows. **This is the one item I'd escalate for a design call before writing any migration** — it's the piece with the most blast radius against P6a/P6b's existing schema, and the spec itself (§9) treats it as a single build-order line item without specifying the exact table shape.
5. **Step D (unblocks S10):** deactivation endpoint — low effort, no dependency, could be done in parallel with anything above.
6. **Steps E–G (S12), deliberately last:** `PM2-02` is a decision record, not code — per the spec's own instruction, schedule it as a design conversation before any VeriTrade endpoint work, not discovered mid-build.

#### Team Readiness

**Can proceed with corrections.** Nothing above is blocked on missing information — the three companion docs plus the PDF are internally consistent everywhere I cross-checked them against real code, and the existing P4–P9 foundation (18-stage engine, sync registry, roles-as-data mechanism, `StageProgressionService.checkTransition` as the one shared gate for both REST and sync-push) is exactly the substrate the corrective layer is designed to sit on top of, per §3 of the server spec. The one open item genuinely needing a decision *before* code — not blocking start, but blocking Step D2's specific shape — is the sub-step hold-point table design (item 4 above). Recommend Steps A/A2/B/D start immediately in that order; I'll write D2's schema as a short design note for sign-off before migrating it, given it's the one piece touching already-shipped tables.

---

### Timeline

| Item | Timeline |
|---|---|
| Assessment completion | Within 24 hours of receipt — met, delivered same day |
| Report submission | This document |
| Review by Manager | Within 12 hours of receipt |

© eBizco Australia Pty Ltd
