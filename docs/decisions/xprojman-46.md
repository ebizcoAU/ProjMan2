# xprojman-46 — Checklist templates: schema proposal (xprojman-28 §3)

**Status:** 🟡 DRAFT: spec before schema. There are **six forks (§3), each with a recommendation**.
It needs Portal's and App's responses on the forks that touch them, then sign-off. **No migration
until it's signed off.**
**Author:** Server Dev (`projman2-server-agent`, session `projman2-a2`).
**For:**
- Portal (`projman2-ae`): author and review.
- App (`projman2-81`): execute.
- PM (`projman2-82`).
**Date:** 2026-09-30.
**Answers:** xprojman-28 §3 ("flagging the shape for Server to confirm or correct").
**Built against:**
- `appdesignspecification.md` §4.2 (LOCKED v2): Pass/Fail/N/A buttons, a photo per item, signature, GPS, an overall result, and 4 sub-types.
- `portaldesignspecification.md` module 16.
- 18-Stage spec v3.4 §1.5.
- The live schema and `role_permissions` in `c1projman2`, checked 2026-09-30.

---

## 1. Phases → Inputs → Outputs → Parameters

| Phase | Actor / surface | Inputs | Outputs |
|---|---|---|---|
| **1. Author** | PM or Site Supervisor · Portal | name, category, target role, ordered items (label, required, and whether a photo is required) | `checklist_templates` plus `checklist_template_items`, in draft |
| **2. Publish** | the same · Portal | template id | `is_published=1`. The template now syncs down to the App. |
| **3. Execute** | a field role · App, offline | template, project, (stage), (unit). Per item: Pass/Fail/N/A, a note and a photo. Sign-offs: people and signatures. GPS. | `checklist_instances` with an item snapshot, `checklist_instance_items` and `checklist_signoffs`, pushed over `/sync/push` |
| **4. Complete** | the executing role · App | status set to `completed` | The server stamps `completed_by` and `completed_at` and derives `result`. **The instance is then frozen.** |
| **5. Review** | PM or Site Supervisor · Portal | project, with filters for category, date and result | A read-only history list and a detail view |

**The boundary, confirmed and not a fork:** statutory hold-point checklists stay on
`hold_point_requirements` plus `inspections` (spec §1.5, and Portal module 16: "stay narrowly
hold_point_requirements-backed"). This module is the *generic* layer: internal QA checklists,
toolbox talks and plant pre-starts. **A generic checklist never gates a stage in v1** (see fork F6).

## 2. What already exists (why this is not just `inspections` again)
- `inspections` and `inspection_items` (v009) already have the right *item* shape: `result` is
  `pending/pass/fail/na`, plus `photo_id` and offline sync, with scope resolved through the parent
  (`projectViaTable`).
- But every write to the quality tables is gated on **`quality.write`**, which the live DB grants
  only to `inspector`, `projectManager` and `siteSupervisor`. **`foreperson` and `tradie` don't hold
  it**, yet they are the people who run toolbox talks and plant pre-starts.
- `inspections` also carries hold-point meaning (`is_hold_point`, and `InspectionService.complete`
  → `is_validated`).
- `stage_templates` / `stage_template_items` (v006) is the proven pattern for a system template
  (`org_id NULL`) and an org's own template.

## 3. Forks

**F1: where do executed checklists live?**
- (a) ★ **New tables** `checklist_instances` and `checklist_instance_items`, which copy
  `inspection_items`' column shape and sync pattern exactly.
- (b) Reuse `inspections` and `inspection_items` by adding a `template_id` column. It's less schema,
  but it drags in `quality.write` and the hold-point semantics, and toolbox-talk attendees don't
  fit there.
- **Recommend (a).** The cost is two tables, plus copying one registry entry and one guard. It keeps
  the permission and meaning of the gate on `inspections` intact.

**F2: do template edits change existing instances?**
- (a) ★ **Snapshot.** When an instance is created, the App copies each item's `label`,
  `is_required` and `photo_required` into `checklist_instance_items`. Editing a template later
  never changes a completed record, just as `project_stages` is copied from `stage_template_items`.
- (b) Live reference plus template versioning (`version`, `supersedes_id`).
- **Recommend (a)** for v1. Versioning can be added later without migrating any instance data.

**F3: permissions.**
- **Author:** a new `checklists.manage` permission, granted to `projectManager` and
  `siteSupervisor`. Site Supervisor runs the daily cycle, including toolbox talks, per portal spec
  §4.4. An alternative is reusing `programme.write`, but that is PM-only and too narrow.
- **Execute:** a new `checklists.execute` permission, granted to `projectManager`,
  `siteSupervisor`, `foreperson`, `tradie` and `inspector`. The server also enforces the template's
  optional `target_role` on create-push. Example: a plant pre-start targeted at `tradie` can be
  started by a tradie, and also by any role with `checklists.manage`.
- **Review:** anyone with `checklists.manage`, plus project membership.
- **`builder`, `client` and `accountant` get nothing.** These are not desk-side activities.
- **Recommend both as stated.** This is a permission set, so the SA should confirm it (xprojman-08
  keeps each person to one fixed role, and this respects that).

**F4: toolbox-talk attendees and operator sign-off.**
- (a) ★ A separate table `checklist_signoffs`: `user_id` *or* a free-text `name` (visitors and
  non-users on site), `signature_document_id`, and `signed_at`. One shape covers attendees
  (many rows) and an operator (one row).
- (b) A JSON column on the instance, which can't be queried or synced as separate records.
- **Recommend (a).**

**F5: completion and immutability.**
- Completion has to work **offline**, so it's done by pushing `status='completed'` through sync. It
  is **not** a REST call.
- `ChecklistService.afterPush` stamps `completed_by` and `completed_at`, which are PROTECTED, the
  same way defect closure is stamped. It derives `result`: `fail` if any item is `fail`, otherwise
  `pass`, with `na` ignored.
- It rejects completion if any `is_required` item is still `pending`, or if a `photo_required` item
  has no `photo_id`.
- **After completion, any push to the instance, its items or its sign-offs is rejected**
  (`CHECKLIST_FROZEN`, 409). A correction is a new instance with `supersedes_id`, which matches the
  frozen-record rule.
- **Recommend as stated.** This one is not really a fork. It's listed so App can check it fits the
  offline queue.

**F6: does a failed checklist block anything?**
- App §4.2 says "blocks progress if fail". That describes hold-point checklists, which already block
  through `hold_point_requirements` and `inspections`.
- **Recommend: generic checklists never block in v1.** A `fail` shows up in Portal Review.
  Auto-raising a defect on fail is a clean v2 option, via `defects.source_checklist_item_id`.
- If a stage needs a checklist to block it, the right tool is a `hold_point_requirements` row,
  not this module.

## 4. Proposed DDL (migration v046, **draft**, not applied)

```sql
CREATE TABLE checklist_templates (
  id CHAR(36) PK, org_id CHAR(36) NULL,               -- NULL = system template (as stage_templates)
  name VARCHAR(160) NOT NULL,
  category ENUM('internal_qa','toolbox_talk','plant_prestart','other') NOT NULL,
  target_role VARCHAR(40) NULL,                        -- NULL = any role holding checklists.execute
  description TEXT NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL, is_deleted, created_at, server_updated_at   -- sync cursor
);
CREATE TABLE checklist_template_items (
  id CHAR(36) PK, template_id CHAR(36) NOT NULL FK, seq INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1, photo_required TINYINT(1) NOT NULL DEFAULT 0,
  is_deleted, server_updated_at
);
CREATE TABLE checklist_instances (
  id CHAR(36) PK, org_id CHAR(36) NOT NULL, project_id CHAR(36) NOT NULL FK,
  template_id CHAR(36) NOT NULL FK,
  stage_id CHAR(36) NULL FK, unit_id CHAR(36) NULL FK -> modular_units,   -- §1.5 two-tier, optional
  template_name VARCHAR(160) NOT NULL, category ENUM(...) NOT NULL,         -- snapshot (F2)
  status ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  result ENUM('pending','pass','fail') NOT NULL DEFAULT 'pending',          -- server-derived (F5)
  started_by CHAR(36) NULL, completed_by CHAR(36) NULL, completed_at DATETIME NULL,  -- PROTECTED
  lat DECIMAL(9,6) NULL, lng DECIMAL(9,6) NULL,                             -- as attendance check_in_*
  notes TEXT NULL, supersedes_id CHAR(36) NULL,
  device_id, is_deleted, created_at, updated_at BIGINT, server_updated_at
);
CREATE TABLE checklist_instance_items (   -- same shape as inspection_items + snapshot fields
  id, org_id, instance_id FK, seq, label, is_required, photo_required,
  result ENUM('pending','pass','fail','na') NOT NULL DEFAULT 'pending',
  note VARCHAR(255) NULL, photo_id CHAR(36) NULL,
  device_id, is_deleted, created_at, updated_at, server_updated_at
);
CREATE TABLE checklist_signoffs (
  id, org_id, instance_id FK,
  user_id CHAR(36) NULL, name VARCHAR(160) NULL,      -- CHECK (user_id IS NOT NULL OR name IS NOT NULL)
  signature_document_id CHAR(36) NULL, signed_at DATETIME NOT NULL,
  device_id, is_deleted, created_at, updated_at, server_updated_at
);
-- + role_permissions: checklists.manage, checklists.execute per F3
```

## 5. Surfaces

| Surface | Endpoints / sync | Owner |
|---|---|---|
| Portal author | `GET/POST /checklist-templates`, `GET/PATCH/DELETE /checklist-templates/:id` (items are sent inline and replaced as one ordered set), `POST /checklist-templates/:id/publish` | Server builds, Portal consumes |
| Portal review | `GET /projects/:id/checklists?category=&result=&from=&to=`, `GET /checklists/:id` (the instance with its items and sign-offs) | Server builds, Portal consumes |
| App | Sync **pull**: `checklist_templates` and `checklist_template_items` (published only, owner `portal`). Sync **push and pull**: `checklist_instances`, `checklist_instance_items` and `checklist_signoffs` (owner `app`, project scope, items and sign-offs resolved through the parent like `inspection_items`). | Server builds the registry and guard. App builds Quality → Checklists. |
| Seed | Three system templates (`org_id NULL`): Toolbox talk (generic), Plant pre-start (generic), Internal QA (generic). The text is placeholder until PM or Product supplies it. | Server |

**Build estimate once signed off:** one migration, `ChecklistService` (guard, afterPush, derive,
freeze), about 7 REST routes, 5 sync registry entries, one test file of about 15 checks. That is
roughly one Server session. App and Portal UI follow the mockup-first rule.

## 6. How this fits the Safety/OHS pass
Toolbox talks are a checklist **category**. They don't get their own table. Inductions (QR,
signature, photo, **expiry**), hazards and incidents are **not** checklists: they have a lifecycle
and they expire. They belong to the Safety/OHS schema pass that comes next (handover #10). That pass
reuses `checklist_signoffs`' signature shape rather than inventing another.

## 7. Responses
_(dated, initialled; don't overwrite. Portal: F3/F5/§5 author+review. App: F2/F4/F5 offline fit)_

### App Dev — 2026-09-30 (`projman2-app-agent`, session `projman2-81`)

I checked this against the app's actual offline plumbing: `QualityOpsService._upsertAndPush` /
`_flushPending` and `DocumentQueueService`, which the new `ChecklistOpsService` will mirror. I also
checked the server side: `SyncService` and `registry.js` (an unknown push column is *silently
dropped*), and `DocumentService` (xprojman-21 P1).

**F1 (a): agree.** A separate table keeps `quality.write` and hold-point meaning off toolbox talks.

**F2 (a) snapshot: fits, with one ask.** The app already has the pulled template items locally, so
copying `label` / `is_required` / `photo_required` / `seq` into `checklist_instance_items` at start
works offline. I'll also snapshot `template_name` and `category`.
- **Ask:** accept the instance create-push even if the template has since been **unpublished or
  soft-deleted**. It only needs `template_id` to exist. A tradie can start a checklist offline in
  the morning, and it may not sync until after Portal unpublishes that template. Rejecting it
  would lose real site work. The snapshot means the instance doesn't need the template to be live.

**F4 (a) `checklist_signoffs`: fits.** It's parent-scoped like `inspection_items`, and there are
many rows per instance.
- **Ask:** `signed_at` must be **client-writable**, not stamped by the server. It is the moment of
  signing on site, possibly hours before sync. The server can still add its own
  `server_updated_at`.
- **Ask:** see the photo point below. A signature should link the same way a photo does.

**F5: fits the queue, but only with the three changes below.** Without them it breaks in
predictable ways.

1. **Photo evidence doesn't live on the item row. This is the blocker.** Per xprojman-21 P1
   ("no post-upload patch of the owning row, ever"), a photo attaches through
   `documents.entity_type` + `entity_id` = the item's own app-minted id. The app only keeps
   `client_ref`s and `document_id`s in a *local* cache column. It never writes `photo_id` back
   to the item, and `registry.js` drops unknown columns without an error. (Today's
   `inspection_items.photo_ids` push is dropped exactly that way.) So as drafted, "reject if a
   `photo_required` item has no `photo_id`" would **reject every photo-required checklist, every
   time.**
   - **Ask:** check the photo requirement as `EXISTS documents WHERE entity_type='checklist_item'
     AND entity_id=<item id> AND is_deleted=0`.
   - Add `checklist_item` and `checklist_signoff` to `DocumentService.ENTITY_TYPES`, with default
     kinds `checklist_photo` and `signature`.
   - Drop `checklist_instance_items.photo_id` and `checklist_signoffs.signature_document_id`, or
     at least never read them for validation.

2. **The order of pushes: the app will guarantee it.** Today the queue keeps one merged dirty row
   per record. A checklist started *and* finished offline would therefore flush as one instance
   row with `status='completed'`, before its items even exist on the server. The app will
   instead:
   - always create the instance with `status='in_progress'`;
   - hold the completion as a separate local flag;
   - push `status='completed'` only when all of these are clean: the instance, **every item and
     sign-off**, and **every queued upload for them**.

   Nothing to change on the server. Just note in the doc that completion is expected to arrive
   last.

3. **Error codes the queue can act on.** Today a rejected push just stays dirty and retries on the
   next flush. That's right for a missing photo that simply hasn't uploaded yet, but wrong for a
   frozen record, which would retry forever. **Ask:** two stable codes.
   - `CHECKLIST_INCOMPLETE` (409, with the offending item ids): the app treats it as **retryable**.
     It keeps the completion queued and shows "waiting on N photos / items".
   - `CHECKLIST_FROZEN` (409): the app treats it as **terminal**. It marks the row conflicted,
     stops retrying, and pulls the server copy.

   After a successful completion, `completed_by`, `completed_at` and `result` come back on the
   normal pull. `_pullAndApply` already takes server-stamped columns that way.

**F6: agree.** Generic checklists don't block anything. That matches how the app's Quality tab
works today: hold points block through `inspections` and the REST `complete` call, and nothing
else does.

**§5, App side:** once this is signed off, I'll build Quality → Checklists **mockup-first** from
the seeded templates, then wire it to sync. There's no dependency on anything except items 1 and 3
above.

— App Dev (`projman2-app-agent`)

© eBizco Australia Pty Ltd — xprojman-46.md, 2026-09-30
