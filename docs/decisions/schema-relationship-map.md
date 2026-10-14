# ProjMan2 — Table Relationship Map

**Author:** Server Agent (`projman2-server-agent`) · **For:** All Teams (App, Portal, VeriTrade, PM)
**Date:** 2026-09-03
**Source of truth:** built directly from `server/api/mysql/migration_v001`…`v029` (all 29
migrations, `CREATE TABLE` + subsequent `ALTER TABLE`) and `server/api/src/sync/registry.js`
— not from any design-spec doc, so this reflects what is actually in the database today, not
what was proposed. Verified against the live `c1projman2` schema at matrix v12.

## How to read this

- **PK** — primary key column(s) as declared in the migration.
- **FK** — every `FOREIGN KEY` constraint, as `column → table.column`. A **soft ref** (commented
  in the source as intentionally *not* a hard FK — usually because the target may not exist yet,
  or is polymorphic across several tables) is called out explicitly; it is not in the FK list.
- **Relationship type** is written from the child's side: `many-to-one → parent` (many rows here,
  one parent row). A `UNIQUE` key across the FK column(s) narrows that to **one-to-one** or
  **one-to-many with a uniqueness cap** — noted where it applies.
- **Owner** — who actually writes the table today, verified against `sync/registry.js` (the
  `owner` field, `app`/`web`/`['app','web']`) for the 16 tables that are genuinely
  sync-registry tables, and against `role_permissions` seed grants + route/service comments for
  everything else (all of which are **REST-only** — there is no sync-registry entry for them at
  all, so "app-writable" there means "an App-paired role calls a REST endpoint," not "syncs
  offline"). `SYSTEM` = server-written only, no client of any kind writes it directly.
- Every synced table also carries `org_id` (tenant scope), `is_deleted`, `created_at`,
  `updated_at` (client clock, display-only) and `server_updated_at` (the real sync cursor) —
  these are omitted from the per-table notes below to avoid repeating them 16 times.

## ⚠ Corrections to how the request grouped these tables

Two of the three "All synced tables" sub-groups you listed are **not sync-registry tables** —
verified directly against `sync/registry.js`, which stops at `ncc_register` (migration v010) and
was never extended for anything built after it:

- **`Purchase_Orders, Supplier_Invoices, Variations, Progress_Claims, Fixed_Assets,
  Depreciation_Schedule, Documents, Introductions, Job_Awards, Engagements, Identities,
  Attestations`** — all 12 are **REST-only**. None has a `registry.js` entry; none rides
  `/sync/push` or `/sync/pull`. They're desk/office workflows (or, for `documents`, explicitly
  REST-mediated because it carries bytes the JSON sync delta can't — see its own note below).
- **`Project_Members`**, which you listed under "server-only," is the opposite mistake — it
  **is** a registered sync table (`owner: 'web'`, `pull: true`) and is moved into §2 below.
- **No `Hazards` or `Incidents` table exists anywhere in the schema** — grepped every migration
  and `src/`; the only hits are prose mentions in stage-template seed data and
  `HoldPointService.js` comments. This matches `xprojman-27`'s own finding (module #19): App-side
  hazard/incident *capture* doesn't have a home yet, Portal-side OHS management doesn't exist at
  all. Nothing to map — flagging so nobody goes looking for a table that isn't there.

---

## 1. Identity & Tenancy

### organisations
- **PK:** `id`
- **FK:** none — this is the tenant root.
- **Relationships:** one-to-many → `users`, `devices`, `customers`, `projects`, `project_members`,
  `stage_templates` (nullable org_id = system template), `subscriptions` (1:1 in practice —
  `uq_subscription_org`), `payments`, and every other table below that carries `org_id`.
  Also one-to-many → `attestations` (as `issuing_org_id`) and `engagements` (as the *engaging*
  org, not the identity's home org).
- **Owner:** WEB (console edits: name/address/ABN/GST fields). App reads only.
- **Notes:** `abn` is globally `UNIQUE`. Carries the org's Ed25519 attestation-signing keypair
  (`attestation_key_public`/`attestation_key_encrypted`, v027) — issued at org creation, used to
  sign every `attestations` row this org emits.

### users
- **PK:** `id`
- **FK:** `org_id → organisations.id`
- **Relationships:** many-to-one → `organisations`. One-to-many (as the referenced side) →
  `devices`, `sessions`, `recovery_tokens`, `auth_identities`, `project_members`, `tasks`
  (`assigned_to`/`verified_by`), `defects` (`raised_by`/`assigned_to`/`closed_by`), `inspections`
  (`inspector_id`), essentially every `*_by`/`*_user_id` column across the whole schema below.
  One-to-one → `identities` (PK there IS `user_id`), one-to-one → `platform_admins`
  (`uq_platform_admin_user`).
- **Owner:** WEB (console creates people, assigns roles). App/device pull-only.
- **Notes:** `email` is **globally unique**, not per-org — it's the login identifier and the
  anchor the whole cross-org identity model (§9 below) hangs off. `role` is `VARCHAR(40)` (not an
  ENUM — was one through v001, loosened at v004 for the matrix-driven role system).
  `is_org_owner` (v018) is a *separate* axis from `role` — see `[[projman2-identity-role-model]]`.

### devices
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `user_id → users.id` (nullable — shared site tablet)
- **Relationships:** many-to-one → `organisations`, many-to-one → `users`.
- **Owner:** APP (device writes its own name/OS/app-version/last-seen). Role/status are
  server/console-only.
- **Notes:** `UNIQUE(org_id, device_uid)` — the same physical device may legitimately be paired
  under two different orgs (a subcontractor's own phone).

### sessions
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `user_id → users.id`
- **Relationships:** many-to-one → `organisations`, `users`.
- **Owner:** SYSTEM — minted/revoked by `AuthService`, never a direct client write.
- **Notes:** `is_authoritative`/`authority_since` is the single-writer lock (per `(user_id,
  org_id)` since the PM2-02 fix, [[projman2_server]] 2026-08-06 block). Not project-scoped.

### pairing_tokens
- **PK:** `id`
- **FK:** `org_id → organisations.id`
- **Relationships:** many-to-one → `organisations`. `claimed_device_id` is a soft pointer to the
  `devices.id` created on confirm (no FK — the row doesn't exist yet when the token is issued).
- **Owner:** SYSTEM (QR pairing flow). `nonce_hash` only, raw nonce never stored.

### recovery_tokens
- **PK:** `id`
- **FK:** `user_id → users.id`
- **Relationships:** many-to-one → `users`.
- **Owner:** SYSTEM (forgot-password/device-loss flow, xprojman-26).

### auth_identities
- **PK:** `id`
- **FK:** `user_id → users.id`
- **Relationships:** many-to-one → `users`.
- **Owner:** SYSTEM (OAuth link, written by the OAuth callback only).
- **Notes:** `UNIQUE(provider, provider_sub)` — one external account links to exactly one local
  user. `provider` is Google/Microsoft/Facebook only (locked, [[projman2-auth-strategy]]).

### sms_verifications
- **PK:** `id`
- **FK:** none (`user_id` nullable, no constraint — pre-account flows have no user yet)
- **Owner:** SYSTEM (ClickSend SMS onboarding flow).

### platform_admins
- **PK:** `id`
- **FK:** `user_id → users.id`
- **Relationships:** one-to-one → `users` (`uq_platform_admin_user`).
- **Owner:** WEB (Dashboard) only — grants `admin`/`account`/`staff` sub-role, seeded via
  `scripts/seed-admin-team.js` or dashboard admin UI. No App or Portal surface touches this.

---

## 2. Access Control & Membership

### roles
- **PK:** `role` (the string itself, e.g. `projectManager`)
- **FK:** none
- **Owner:** SYSTEM — seed data only, populated by migration `INSERT`s, never written at runtime.
  Adding a role means a migration, not a console action.
- **Notes:** `scope_class` (`portfolio`/`assigned`/`self`/`engagement`/`portal`) is what
  `SyncService` reads to decide pull/push scoping — this is the table §9's `engagement` scope
  class was declared on before anything used it (PM2-02 wired the resolver).

### role_permissions
- **PK:** `(role, permission)`
- **FK:** `role → roles.role`
- **Relationships:** many-to-one → `roles`.
- **Owner:** SYSTEM — same as `roles`, migration-seeded only.

### project_members
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `user_id → users.id`
- **Relationships:** many-to-one → `organisations`, `projects`, `users`.
- **Owner:** **WEB** (registry.js: `owner: 'web'`, `pull: true`) — *moved here from your
  "server-only" list, see the correction note above.* This table is also the RESOURCE-scope
  source (§9.4) — an `assigned`/`self` session's device must pull its own membership rows to know
  which projects it may even reach, so it's pulled deliberately un-project-scoped.
- **Notes:** `UNIQUE(project_id, user_id)`. A `JobAwardService.respond` acceptance writes this row
  as a side effect — that's *how* an engaged Builder/Tradie ends up scoped to the job (no separate
  "accept" step needed on this table).

---

## 3. Construction Core

### customers
- **PK:** `id`
- **FK:** `org_id → organisations.id`
- **Relationships:** many-to-one → `organisations`. One-to-many (referenced) → `projects`.
- **Owner:** WEB (edits/deletes) + **APP CREATE** (`customers.write`) — Stage 1 lets a PM create a
  customer on-site from land documents. Single-writer conflict only applies to edits.

### projects
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `customer_id → customers.id`, `pm_user_id → users.id`
- **Relationships:** many-to-one → `organisations`, `customers`, `users` (as PM). Referenced
  one-to-many by nearly every table below that carries `project_id` — `project_stages`, `tasks`,
  `site_diary`, `site_attendance`, `deliveries`, `inspections`, `defects`, `certificates`,
  `ncc_register`, `hold_point_requirements`, `cost_plans` (1:1, `uq_costplan_project`),
  `progress_claims`, `purchase_orders`, `supplier_invoices`, `contracts`, `variations`,
  `fixed_assets`, `documents`, `engagements`, `job_awards`, `project_payments`.
- **Owner:** WEB (edits) + **APP CREATE** (`projects.write`, Stage-1 offline project creation,
  projman-01 §4) + **BUILDER APP-CREATE too** (v020 grants `builder` the same `projects.write`).
  `contract_value` is a financial column, redacted on pull without `money.read`.
- **Notes:** `template_id` soft-references `stage_templates.id` (no FK declared). A project row
  is its own `projectColumn` for membership scoping (`projectColumn: 'id'`) — it scopes itself.

### project_stages
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`
- **Relationships:** many-to-one → `organisations`, `projects`. Referenced one-to-many by `tasks`,
  `inspections`, `defects`, `certificates`, `ncc_register`, `hold_point_requirements`,
  `estimate_lines`, `progress_claims`, `purchase_orders`, `supplier_invoices` (all optional,
  stage-level detail).
- **Owner:** **SPLIT BY FIELD** — APP pushes `status`/`milestone`/dates (site progress); WEB
  writes the programme itself (seq, codes, names) via REST plus all financial columns
  (`budget_amount`/`estimated_amount`/`committed_amount`/`actual_amount`/`claimed_amount` — none
  of these are in the app's sync-registry `columns` set at all, so a device literally cannot push
  them). `is_validated`/`validated_by`/`validated_at` are server-only (inspector sign-off, never a
  bare sync write).
- **Notes:** `template_item_id` soft-refs `stage_template_items.id` (provenance, no FK).

### tasks
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `stage_id → project_stages.id`,
  `verified_by → users.id` (v012)
- **Relationships:** many-to-one → `organisations`, `projects`, `project_stages`, `users`.
  Self-referencing: `parent_id`/`predecessor_id` → `tasks.id` (no FK declared on either — soft).
- **Owner:** APP (owns the sync surface outright) except `budget_hours`/`budget_amount`
  (financial, not in the app's writable `columns`) and the `verified_by`/`verified_at` pair
  (server-set only, via `TaskProgressService.verify` — **tick-then-verify split**: a device ticks
  `completion`, only a `progress.verify` holder — `siteSupervisor` — sets the verify stamp).

### stage_templates / stage_template_items
- **PK:** `id` / `id`
- **FK:** `stage_templates.org_id → organisations.id` (nullable = system template) /
  `stage_template_items.template_id → stage_templates.id` (`ON DELETE CASCADE`)
- **Relationships:** one-to-many, `stage_templates` → `stage_template_items`.
- **Owner:** WEB (template authoring — not in `sync/registry.js` at all, REST-only, office-side
  configuration, not a per-project sync surface).

---

## 4. Site Operations

### site_diary
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `author_id → users.id`
- **Relationships:** many-to-one → `organisations`, `projects`, `users`. Self-referencing
  `supersedes_id → site_diary.id` (no FK — soft, points at the prior version it replaces).
- **Owner:** APP (owns the sync surface; `status` unprotected so the app can push draft→final).
  `is_current`/`author_id`/`finalised_at`/`finalised_by` are server-stamped, never a bare device
  write.
- **Notes:** `UNIQUE(org_id, project_id, entry_date, version)` — append-only versioning per day,
  not an update-in-place row.

### site_attendance
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `person_id → users.id`
  (nullable — subbie/visitor may not be a platform user)
- **Owner:** APP. `geo_verified` is server-derived (nullable tri-state: unknown/pass/fail, never
  a device write).

### deliveries
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`
- **Relationships:** many-to-one → `organisations`, `projects`. `supplier_id`/`po_id` are
  documented as "FK wired at P7" — **still not hard FKs today**, even though `suppliers` and
  `purchase_orders` now exist (v019) — this migration was never revisited to add the constraint.
- **Owner:** APP. `received_by` server-stamped.

---

## 5. Quality & Compliance

### inspections
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `stage_id → project_stages.id`,
  `inspector_id → users.id`
- **Owner:** APP. `inspector_id`/`completed_at`/`result`-driven `is_validated` flip on the parent
  stage are all server-mediated through `InspectionService.complete` — a bare
  `result='pass'` sync push is QA-only, does **not** flip the stage.

### inspection_items
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `inspection_id → inspections.id` (`ON DELETE CASCADE`)
- **Relationships:** many-to-one → `inspections`. **Child-scoped for sync purposes** — carries no
  `project_id` of its own; its project is resolved via `inspections.project_id`
  (`projectViaTable`/`projectViaColumn` in the registry).
- **Owner:** APP.

### defects
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `stage_id → project_stages.id`,
  `raised_by → users.id`, `assigned_to → users.id`, `closed_by → users.id`
- **Owner:** APP (raises the punch-list item). `raised_by`/`closed_at`/`closed_by` server-stamped
  by `QualityOpsService.afterPush`; `status` unprotected so open→in_progress→closed can be pushed.
- **Notes:** Portal's management/close-out view (xprojman-27 module #11) reads this table; no
  Portal write path exists yet.

### certificates
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `stage_id → project_stages.id`
- **Owner:** **APP + WEB** (registry.js literally lists `owner: ['app', 'web']`) — an inspector
  may attach one on-site, the office often uploads the surveyor's signed BA2/BA3.

### ncc_register
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `stage_id → project_stages.id`,
  `cpc_unit → cpc_units.code`
- **Owner:** APP. `raised_by`/`closed_at`/`closed_by` server-stamped, `status` unprotected.
- **Notes:** `CHECK` constraint enforces `building_type` is set iff `ncc_class` is commercial
  (2–9), NULL for residential (1, 10) — the only `CHECK` constraint anywhere in the schema.

### cpc_units / cpc_feature_map
- **PK:** `code` / `(unit_code, feature)`
- **FK:** `cpc_feature_map.unit_code → cpc_units.code`
- **Owner:** SYSTEM — reference data (CPC50220 training-package units), migration-seeded.

### hold_point_requirements
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `stage_id → project_stages.id`,
  `satisfied_by → users.id`
- **Owner:** **REST-only, not in `sync/registry.js` at all** (despite being close cousins of
  `inspections`/`ncc_register` which are synced) — written through `HoldPointService`, gates
  `blocks_progress` on `StageProgressionService.checkTransition`. Effectively APP-facing (the
  inspector/supervisor roles that satisfy these are App-paired) but over REST, not the sync push.
- **Notes:** `triggered_by_finding_id` soft-refs a "Stage 2 hazard-audit finding" that, per the
  §0 correction above, **does not exist as a table** — this column has never had anything to
  point at.

---

## 6. Commercial — Cost & Procurement

*(None of this domain is in `sync/registry.js`. It's REST-mediated office/desk work by design —
cost plans, POs, invoices, claims and variations are authored at a desk, not captured on-site.)*

### cost_plans
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`
- **Relationships:** one-to-one → `projects` (`uq_costplan_project` — one cost plan per project).
  One-to-many (referenced) → `estimate_lines`.
- **Owner:** WEB/Portal (`money.write` — projectManager/developer/org_admin/builder-own).

### estimate_lines
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `cost_plan_id → cost_plans.id`,
  `stage_id → project_stages.id` (nullable — project-level line)
- **Owner:** WEB/Portal, same as `cost_plans`. `amount` is server-computed (`quantity * rate`),
  not client-set.

### suppliers
- **PK:** `id`
- **FK:** `org_id → organisations.id`
- **Owner:** WEB/Portal (procurement admin).

### purchase_orders
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `stage_id → project_stages.id`,
  `raised_by_user_id → users.id`. `supplier_id` is a **soft ref** (nullable, free-text
  `supplier_name` fallback). `subcontractor_engagement_id` — no FK declared, soft.
- **Owner:** WEB/Portal — `po.write` held by `projectManager` **and** `builder`. `owner_party`
  (`pm`/`builder` ENUM) is derived from who raised it at create time — this is the §7.2.1
  visibility key that keeps a PM's own procurement ledger separate from a Builder's.

### supplier_invoices
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `stage_id → project_stages.id`,
  `po_id → purchase_orders.id`, `raised_by_user_id → users.id`
- **Relationships:** many-to-one → `purchase_orders` (nullable — a direct invoice with no PO match
  target is allowed).
- **Owner:** WEB/Portal, same `po.write`-adjacent gating as `purchase_orders`.
- **Notes:** carries its own `gst_treatment`/`gst_amount` (v023) — see BAS note below.

### contracts
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `party_user_id → users.id`
  (nullable — external party fallback via free-text `party_name`)
- **Relationships:** referenced one-to-many by `variations`.
- **Owner:** WEB/Portal (office contract admin — no route grant found narrower than general
  project-write permissions).

### variations
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `contract_id → contracts.id`
- **Owner:** WEB/Portal — `variations.raise` → `projectManager`; `variations.approve` →
  **`client`**. This is the one table in this domain with an explicit client-facing write path
  (approval), not just PM/Builder.

### progress_claims
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `stage_id → project_stages.id`,
  `payment_id → project_payments.id`
- **Owner:** WEB/Portal — `claims.submit` → **`builder`** (Portal Builder Console submits),
  `claims.approve` → **`projectManager`** (approve/decline, then a separate `pay` action — both
  gated on the same `claims.approve`, `routes/projects.js:734-738`).
- **Notes:** `gst_treatment`/`gst_amount` (v023) feed BAS G1/1A directly — only `approved`/`paid`
  claims count as a certified tax invoice for BAS purposes (a `submitted` claim doesn't).

### project_payments
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `payee_user_id → users.id`
- **Relationships:** referenced one-to-many by `job_awards` (`deposit_payment_id`),
  `progress_claims` (`payment_id`), `tpar_lines` (via `source_payment_ids` JSON — soft, not FK).
- **Owner:** WEB/Portal (`recorded_by`, server-stamped from session — a PM or accounts action).
- **Notes:** `tpar_reportable` flag + `gst_treatment`/`gst_amount` feed both BAS 1B and TPAR
  directly — this table is the shared source for both statutory reports below.

---

## 7. Tax & Statutory Reporting

*(REST-only, `accounts.read`/`tax.approve` gated — `projectManager`/`accountant`/`developer` read,
only `accountant` holds `tax.approve` to lock a period. `builder`'s org-owner founders get
`accounts.read` via `OWNER_CAPABILITIES`, not the role grant — see [[projman2_server]] decision
#18.)*

### fixed_assets
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id` (nullable — org-level asset),
  `approved_by → users.id`
- **Relationships:** referenced one-to-many by `depreciation_schedule`. `source_supplier_invoice_id`
  is an explicit **soft ref** (comment: "no hard FK") to `supplier_invoices.id`.
- **Owner:** WEB/Portal. `status` draft→approved is the S18.11→S18.12 gate (`tax.approve`).

### depreciation_schedule
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `fixed_asset_id → fixed_assets.id` (`ON DELETE CASCADE`)
- **Relationships:** many-to-one → `fixed_assets`. `UNIQUE(fixed_asset_id, fy)` — one row per
  asset per financial year.
- **Owner:** SYSTEM-computed (`DepreciationService`, prime-cost or diminishing-value maths) — no
  direct human write of the schedule rows themselves, only of the parent `fixed_assets` row that
  triggers (re)computation.

### tax_periods
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `prepared_by → users.id`, `lodged_by → users.id`
- **Owner:** WEB/Portal, `tax.approve` for lodge. `UNIQUE(org_id, period_start)`. G1/1A/1B/net
  are a **cached roll-up written at prepare time**, not a live view — a lodged BAS must keep
  reporting what was lodged even if underlying rows change later.

### tpar_reports
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `prepared_by → users.id`, `lodged_by → users.id`
- **Relationships:** referenced one-to-many by `tpar_lines`. `UNIQUE(org_id, fy)`.
- **Owner:** WEB/Portal, `tax.approve` for lodge.

### tpar_lines
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `tpar_report_id → tpar_reports.id` (`ON DELETE CASCADE`),
  `payee_user_id → users.id`
- **Owner:** SYSTEM-computed at prepare time (from `project_payments`), same pattern as
  `depreciation_schedule`.
- **Notes:** `payee_abn`/`payee_name` are **snapshots at prepare time** — a lodged TPAR must not
  silently change if the payee later edits their profile.

---

## 8. Documents

### documents
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id` (nullable — org-level/unattached),
  `uploaded_by → users.id`
- **Relationships:** many-to-one → `organisations`, `projects`, `users`. `entity_type`/`entity_id`
  is a **deliberate soft polymorphic ref** — no FK is possible (target table varies per row) and a
  document may legitimately arrive before its owning row has even synced; integrity is enforced
  at read time via org/project scoping, not a constraint.
- **Owner:** **APP + WEB** — the single store behind all 5 on-site capture surfaces (inspection
  photo, defect photo, certificate, site-diary photo, delivery docket) *and* office/web uploads.
  Explicitly REST-mediated, not sync-registry — it carries bytes the JSON sync delta can't.
- **Notes:** `UNIQUE(org_id, client_ref)` is the offline-retry idempotency guarantee — a repeated
  upload of the same capture returns the original `document_id`, no duplicate row.
  `sha256`/`size_bytes`/`mime_type` are server-derived on receipt; anything the client sends is
  advisory only. This table is the exact prior art cited in my `xprojman-27` §4 note for how a
  future "raised item" (Actions/RFI) table should be shaped.

---

## 9. Cross-Org Identity & Verified Work History

*(PM2-02 domain, `projman-02.md` architecture. None of these six tables is in
`sync/registry.js`.)*

### introductions
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `party_a_id → users.id`, `party_b_id → users.id`
- **Owner:** APP (`app_qr_scan` — the on-site QR trust-exchange) or WEB/VeriTrade
  (`veritrade_engage` — the remote equivalent, VeriTrade's own Engage action), per the
  `initiated_by` ENUM.

### subcontractor_engagements
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`,
  `job_award_id → job_awards.id`, `subcontractor_user_id → users.id` (nullable — may still be a
  free-text `subcontractor_name`, not yet a platform user)
- **Owner:** WEB/Portal — pass-through consent recording is an office/PM action, not an on-site
  capture.
- **Notes:** don't confuse with `engagements` (v027) below — this is the narrower, older
  (v014) "does this subbie's engagement have pass-through consent for cost visibility" table,
  unrelated to the cross-org identity bridge.

### job_awards
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `project_id → projects.id`, `from_user_id → users.id`,
  `to_user_id → users.id`, `deposit_payment_id → project_payments.id`
- **Owner:** **APP + WEB explicitly** — `response_channel` ENUM(`app`,`portal`) is a real column,
  not an inference; PM issues from the web/Portal, the invited party may accept/decline from
  either surface.
- **Notes:** accepting one is what writes the `project_members` row (§2) that actually grants
  reach — this table is the offer/response record, membership is the side effect.

### engagements
- **PK:** `id`
- **FK:** `org_id → organisations.id` (the **engaging** org, not the identity's home org),
  `project_id → projects.id`, `identity_user_id → users.id`, `initiated_by → users.id`
- **Relationships:** referenced one-to-many by `attestations` (`engagement_id`, nullable — NULL
  when an attestation is emitted in the person's home org instead of under a cross-org grant).
- **Owner:** WEB/Portal — `panel.manage` holders only (`projectManager`, `builder`).
- **Notes:** **This is the cross-org bridge**, not a per-project role assignment — it's what lets
  an existing `users.id` from one org get a scoped pull slice (`scope_json`) into a *different*
  org's project without a second `users` row ever being created (email is globally unique, so
  that's structurally impossible anyway — see `[[projman2-identity-role-model]]`).
  `UNIQUE(org_id, project_id, identity_user_id)`.

### identities
- **PK:** `user_id` (itself the FK)
- **FK:** `user_id → users.id`
- **Relationships:** **one-to-one → `users`** (the only true 1:1 in the whole schema — PK IS the
  FK, no separate `id`).
- **Owner:** **SPLIT** — `trust_score_cache`/`trust_score_computed_at` are SYSTEM-computed
  (24h cache, event-invalidated on new attestation). The nine `veritrade_*` columns bolted on in
  v028 (`veritrade_published`, `trade_classification`, `service_region`, `licence_*`,
  `veritrade_disclose_financials`) are **WEB/VeriTrade-writable, self-scoped only** — a person
  edits their own row via VeriTrade's Settings page (`GET/PATCH /veritrade/profile`), nobody else
  writes another identity's row.
- **Notes:** explicitly **not** a person record (per its own migration comment) — a thin
  evidence-aggregate companion to the home-org `users.id`.

### attestations
- **PK:** `id`
- **FK:** `subject_user_id → users.id`, `issuing_org_id → organisations.id`,
  `engagement_id → engagements.id` (nullable)
- **Owner:** **SYSTEM only** — emitted by application code at 5 hook points (task complete,
  inspection, diary sign-off, stage completion, invoice match), signed with the issuing org's
  Ed25519 key at emission. No client, App or Portal, ever writes this table directly.
- **Notes:** `source_type` is free-text `VARCHAR(40)`, deliberately not an ENUM — new emitters can
  be added without a migration. `source_id` is a soft polymorphic ref (no FK), same pattern as
  `documents.entity_id`. Primary access key is `subject_user_id`, **not** `org_id` — the evidence
  belongs to the person and outlives any one tenant relationship; `issuing_org_id` exists for the
  org's own "what did I issue" query and is anonymised on third-party reads (e.g. VeriTrade).

---

## 10. Platform / Billing

### subscriptions
- **PK:** `id`
- **FK:** `org_id → organisations.id`
- **Relationships:** one-to-one → `organisations` (`uq_subscription_org`). Referenced by
  `payments.subscription_id`.
- **Owner:** WEB (Dashboard) only — platform-admin billing, no tenant-facing write path at all.

### payments
- **PK:** `id`
- **FK:** `org_id → organisations.id`, `subscription_id → subscriptions.id` (nullable)
- **Owner:** WEB (Dashboard) only, `recorded_by` = the platform admin who logged it.

---

## 11. Audit & Sync Machinery

### audit_log
- **PK:** `id` (BIGINT auto-increment)
- **FK:** none declared (`org_id`/`user_id` are plain columns, not constrained — deliberately,
  since some rows are pre-registration events with no org yet).
- **Owner:** SYSTEM, append-only.

### sync_history
- **PK:** `id` (BIGINT auto-increment)
- **FK:** none declared
- **Owner:** SYSTEM, one row per push/pull/full sync attempt, append-only.

---

## 12. VeriTrade (bonus — not in your request list, exists as of v029)

### veritrade_login_sessions
- **PK:** `id`
- **FK:** `approved_user_id → users.id` (nullable until approved)
- **Owner:** WEB (VeriTrade browser initiates + polls) + APP (the paired device approves/denies).
  No `org_id` at all — this table is intentionally tenant-agnostic, it's a login handshake, not
  tenant data.

---

## Appendix A — `xprojman-27` module → table cross-reference

The 20-module Portal-vs-App split in `xprojman-27.md` is the current PM-driven planning doc for
what to build next. Here's where each of its modules actually sits against the schema above —
verified against the migrations, not the module doc's own "already built?" column, which is
right for most rows but overstates two of them (flagged below).

| # | Module (`xprojman-27`) | Backing table(s) today | Gap |
|---|---|---|---|
| 1 | Site Diary | `site_diary` (§4) | None — built both sides |
| 2 | Checklists | `hold_point_requirements` (§5) — narrow, hold-point only | No generic checklist-template table |
| 3 | Insurances | none | Proposed: `credentials` (§4 of xprojman-27, my note) |
| 4 | Tickets | none | Same `credentials` table as #3 |
| 5 | Scheduling | `project_stages` + `tasks` (§3) — the Gantt/LoB data model already exists | Portal-side *authoring* UI is what's missing, not the schema |
| 6 | Documents | `documents` (§8) | Generic repository UI only; schema is done |
| 7 | Actions | none | Proposed: shared "raised item" table w/ #12, `entity_type`/`entity_id` + `kind` shape (my note, same as `documents`) |
| 8 | Locations | none | No site-plan/zone table anywhere — a real gap, nothing to extend |
| 9 | SDS | none | No table |
| 10 | Drawings | none | Only a stage-template *label* (`ARCH_DRAWINGS` in `stage_template_items` seed data) — not a document/register table. `devroadmap.md`'s "`drawings`/`drawing_markups`" is aspirational, not schema |
| 11 | Defects | `defects` (§5) | None — built App-side; Portal management view is the gap, not the schema |
| 12 | RFI | none | Proposed: shares #7's new table |
| 13 | Submittals | none | No table |
| 14 | Permits | none | **Corrects `xprojman-27`'s "Partial" claim** — grepped `mysql/` and `src/` for `permit`, zero hits anywhere. The "Stage 17 driveway/crossover permit" it refers to is a `stage_template_items` seed row (a checklist item), not a permit register with jurisdiction/expiry tracking. Nothing to extend — this is a clean-slate build, same as #8/#9/#13 |
| 15 | Workflow | n/a — confirmed infrastructure, not data | The frozen/hashed pattern already lives on `job_awards.document_hash`; `variations`/`contracts` follow the same shape ad hoc, not a shared table |
| 16 | Messages | none | **Corrects `xprojman-27`'s "Client Communications Center exists" claim** — grepped `server/api/src/` and `server/portal/src/` for `communicat`/`notif`/`mail`, zero hits. It's named in `portaldesignspecification.md` §230 as a planned module, never built. Same "spec ≠ code" pattern flagged before ([[projman2-review-gate]]) |
| 17 | Pre-qualification | `job_awards` + `project_members` (§2/§9) partially cover the *outcome* (an award response, a membership row) | No admin review-gate table; xprojman-27's own recommendation to fold into Panel/Job-Award rather than build standalone matches what's actually there — there's a flow to extend, not a screen to add a table under |
| 18 | Emergency evacuation | none | No table |
| 19 | Safety/OHS | none | **Corrects `xprojman-27`'s "App-side hazard/incident capture exists" claim** — see the §0 correction above: no `hazards`/`incidents` table anywhere, only prose mentions. Whatever capture `devroadmap.md` is describing isn't backed by schema today |
| 20 | NCC AI assistant | `ncc_register` + `cpc_units`/`cpc_feature_map` (§5) exist, but are a **different thing** — a compliance *checklist/register* (open/closed items gating stage completion), not a queryable AI assistant. Don't read `ncc_register`'s existence as partial progress on #20; it's unrelated prior art at best (the CPC unit/feature reference data could seed a citation source, nothing more) | Full AI feature — model, corpus, RAG source all unscoped per xprojman-27 §3 Q2 |

**Net read for sequencing (§3 Q3 of xprojman-27):** #5 and #6 need no new schema, only Portal UI
— genuinely the cheapest of the 20. #1/#11 are UI-gap-only on the Portal side. #3/#4/#7/#12/#17
share two new tables between six modules if the `credentials`/"raised item" recommendations land.
#8/#9/#10/#13/#14/#15/#16/#18/#20 are clean-slate — no existing schema to lean on, three of them
(#14/#16/#19) resting on a design-doc claim that doesn't hold up against the actual code.

---

## Appendix B — the three "hub" tables, for a quick sanity check on fan-out

If you're trying to eyeball "how deep does a delete cascade," the three tables everything
ultimately hangs off are:

- **`organisations`** — every tenant table's `org_id` traces back here. No `ON DELETE CASCADE`
  anywhere off it — deleting an org is not a supported operation (soft-delete via `is_deleted`
  only, or `status='disabled'`).
- **`users`** — every `*_by`/`*_user_id` column across all 46 tables above traces back here.
  Same posture: no cascade, `deactivated_at` soft-marks instead (v015 — "never a hard delete for
  anyone with relied-upon project evidence").
- **`projects`** — every construction-domain table's `project_id` traces back here. Also no
  cascade off `projects` itself; the only `ON DELETE CASCADE`s in the entire schema are
  narrow parent→child pairs where the child is meaningless alone: `stage_template_items` →
  `stage_templates`, `inspection_items` → `inspections`, `depreciation_schedule` →
  `fixed_assets`, `tpar_lines` → `tpar_reports`.
