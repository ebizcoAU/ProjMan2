# xprojman-51 — Client final sign-off (S18.14): the Completion trigger for xprojman-43

**Status:** 🟡 DRAFT: plan and spec before code. There are **five forks (§3), each with a recommendation**.
- Needs Server's and Portal's responses, then PM and Owner sign-off.
- **F1 is for the Owner.** It asks who signs before pairing exists, and it touches the solicitor list.
- **No migration or build until it's signed off.** Server assigns the migration number.

**Author:** App Dev (`projman2-app-agent`, session `projman2-81`).
**For:** Server (`projman2-a2`), Portal (`projman2-ae`), PM (`projman2-82`).
**Date:** 2026-09-30.
**Why now:** the Owner's go-ahead (2026-09-30): "xprojman-43 is APPROVED. Plan the S18.11 client sign-off against
Server's build. Don't rely on the task-library codes."
**Number:** I took 51 because Portal has been told to use the next free number (50) for the pairing contract (41 §1).
**Built on:**
- The 18-Stage spec v3.4 PDF, Stage 18, pp. 26–27, and S7.3 on p. 12. I read the PDF directly, not
  `18Stage_Tasks.md`.
- xprojman-43 §5, Completion trigger.
- xprojman-43 §10: my review, which found that the trigger has no event to fire on.
- xprojman-45 §2.
- xprojman-46 and xprojman-48 F6: the sign-off and signature shape.
- xprojman-41: customer access, not yet paired.

---

## 0. First, the numbering: this is S18.14, not S18.11

The PDF v3.4 numbering, Stage 18:

| Code | Sub-step | Responsible | Surface | Status today |
|---|---|---|---|---|
| S18.3 | HOLD POINT: Occupation Certificate | Inspector | App | ✅ built (a `hold_point_requirements` row) |
| S18.11 | System prepares the fixed-asset and depreciation **draft** | System | — | ✅ built (`DepreciationService`, v022) |
| S18.12 | Accountant approval gate before ATO lodgement | Accountant | Portal | ✅ built (`tax.approve`) |
| S18.13 | Auto-email of the handover pack (BA3, OC, manuals, as-built record) | System | — | not built |
| **S18.14** | **Client final digital sign-off**: "frozen/hashed, same discipline as Stage 5 and Stage 7" | **Client** | **Portal** | **❌ not built anywhere** |
| S18.15 | `project.status = 'completed'`, **BILLING MILESTONE: Completion** | System | — | — |

- **xprojman-43 §5** reads "Completion — S18.3 OC issued + **S18.11** client final sign-off". That is the
  *pre-v3.4* number. In v3.4, S18.11 is the depreciation draft. The same drift appears in the v034 task
  library (xprojman-45 §2) and in `xprojman-roles` §2.2.
- **This doc uses S18.14 throughout.** Whoever owns xprojman-43 should correct its §5. I haven't edited
  another lane's doc.
- `portaldesignspecification.md:469` already says S18.14 correctly.

## 1. The "Stage 5 / Stage 7 discipline" this has to meet

S7.3 (PDF p. 12), which S18.14 explicitly copies, says:
- `content_hash` is taken against **the exact package version** being signed.
- `frozen_at` is set the instant the signature lands.
- There is **no update path, ever**.
- A decline routes back to rework, using existing mechanisms.

So S18.14 isn't "client ticks a box". The client signs a specific, hash-identified handover pack. It's the
same pattern as `job_awards.document_hash` (S9.7), which the app already shows at the Builder's accept tap.

## 2. Phases → Inputs → Outputs → Parameters

| # | Phase | Actor / surface | Inputs | Outputs |
|---|---|---|---|---|
| 1 | **Pack** (S18.13) | System | the project's handover documents (BA3, OC, electrical and plumbing certificates, manuals, warranties, as-built) | a pack **manifest**: sorted `documents.id` + `sha256`, and a `pack_hash` = SHA-256 of that manifest. The server computes it. |
| 2 | **Review** | Client, with the PM | the pack contents and a short `pack_hash` shown on screen | — |
| 3 | **Sign or decline** | Client (see F1 for where) | a decision (`accepted` or `declined`), a signature, the signer's name or user, decline reasons | a `client_signoffs` row, **frozen on arrival** |
| 4 | **Complete** | System | S18.3 validated **and** an `accepted` S18.14 row whose `pack_hash` matches the current pack | S18.15 `project.status='completed'` → xprojman-43 §5 **Completion draft invoice** |
| 5 | **Decline loop** | PM | the decline reasons | defects raised by the PM (S18.7 loops until clear). A new pack version leads to a new sign-off that **supersedes** the old one. |

## 3. Forks

**F1: who signs, and where, before customers can log in? ⚠ Owner (and the solicitor list).**
- The PDF puts S18.14 on the **Portal, by the Client**. But customers can't log in to Portal or the App
  until the 41 §1 pairing ships, and that ruling has only just been made. Until then S18.14 has no actor,
  and **the Completion invoice can never be created**. This is the same shape as Portal's
  `paid_by_user_id` finding in xprojman-43 §10.
- The options:
  - (a) ★ **Assisted signing on the PM's device at handover.** S18.8 (keys, manuals, warranties) is a
    physical, on-site handover with the client present, and S18.6/S18.8 are already App (PM) surfaces.
    The PM opens "Client sign-off" in the App and hands the tablet to the client. The client reviews the
    pack list and the short hash, types their name and signs. The PM is recorded as **witness**, never
    as the signer.
  - (b) **The PM uploads a paper form the client signed**, in Portal. This is the external no-login
    pattern already used for the accountant (S18.12) and the engineer. Weaker, because it's a scan with
    nothing tying it to the pack version beyond the PM's word.
  - (c) **Wait for pairing** and have the client self-sign in Portal, as the PDF describes.
- **Recommend:** (a) for v1, (b) as the fallback when the client isn't on site, and (c) once 41 §1 ships.
  Then (a) stays as an option, and (c) becomes the default for remote clients.
- **For the Owner:** does a signature taken on the PM's device count as the client's sign-off? It's the
  same question as `devroadmap` §12 #14 ("is the in-app tap a valid contract?"). Please add it to the
  solicitor list the PM is drafting (roles §8 #13).

**F2: where the record lives.**
- (a) ★ A new small table, **`client_signoffs`**:
  - `id`, `org_id`, `project_id`, `step_code` (`'S18.14'`, and S7.3 later)
  - `pack_hash` and a `manifest` JSON
  - `decision` ENUM(`accepted`, `declined`), `decline_reasons` TEXT
  - `signer_user_id` NULL / `signer_name`, `witnessed_by` (the PM, server-stamped from the pusher)
  - `signed_at` (client-writable, the moment of signing)
  - `frozen_at` (server-stamped), `supersedes_id`
  - `device_id`, `created_at`, `server_updated_at`
  - **No update path.** The signature image is a `documents` row with `entity_type='client_signoff'`.
- (b) Reuse the shared `signoffs` table (xprojman-48 F6). But it has no decision, no content hash and no
  pack binding, and adding them would put them on every toolbox-talk attendee row.
- **Recommend (a).** It's also the right shape for S7.3 (DA sign-off, the same discipline) when Stage 7 is
  built, so it's one table for both "the client signs a hashed package" moments.

**F3: what exactly is hashed.**
- **Recommend:** the server builds the manifest: the pack's documents sorted by id, each as
  `id:sha256`. `documents` already store a server-derived `sha256` (xprojman-21 P3).
  `pack_hash` = SHA-256 of the canonical manifest.
- The app shows the first 8 characters and the document list. It never computes the hash itself.
- If a document is added to or removed from the pack after signing, the hashes no longer match. The
  Completion trigger won't fire, and the PM sees "pack changed since the client signed, sign-off needed
  again".

**F4: offline, since handovers happen at the house.**
- The pack manifest and `pack_hash` sync down (pull) once S18.3 is validated, so the App can take a
  signature with no signal.
- The sign-off is a **create-only** push, frozen on arrival. Any later push to it gets `SIGNOFF_FROZEN`
  (409, terminal).
- **If the pack changed between the pull and the push**, the server stores the row but refuses to
  count it: `PACK_CHANGED` (409, terminal for that row). The app shows "The handover pack changed.
  Please sign again", and a new row supersedes it. **The app never silently re-signs.**
- The signature image rides the existing document queue, the same way as xprojman-46 §7 #2. The app
  sends the sign-off row only after the signature upload has succeeded.

**F5: what a decline does.**
- **Recommend:** a decline is a frozen row with reasons, just like an acceptance. The PM gets it as a task
  and raises defects (S18.7) from the reasons.
- No auto-raising in v1. That's the same call as xprojman-46 F6 for failed checklist items.
- The next sign-off, on the same or a new pack, supersedes the decline.

## 4. Who builds what (after sign-off)

- **Server:**
  - The `client_signoffs` table and its sync registry entry: create-only; `witnessed_by` and
    `frozen_at` PROTECTED.
  - The S18.13 pack manifest and `pack_hash`, pulled per project.
  - `DocumentService.ENTITY_TYPES += 'client_signoff'`.
  - The two codes, `SIGNOFF_FROZEN` and `PACK_CHANGED`.
  - The **S18.15 / Completion trigger**: S18.3 validated AND the latest non-superseded S18.14 row is
    `accepted` AND its `pack_hash` matches the current pack. That creates the xprojman-43 §5 Completion
    draft invoice.
  - The permission for "take an assisted client sign-off": `projectManager`, plus `siteSupervisor` if
    the Owner wants.
- **App (me), mockup-first:**
  - A **"Client handover sign-off"** screen: Projects → project → Stage 18. It's visible only after S18.3
    is validated.
  - It shows the pack list, the short hash, and the client name or picker.
  - It reuses `SignaturePad` (`app/lib/widgets/signature_pad.dart`, built for checklists), with
    Accept/Decline and decline reasons.
  - A PM witness line, the offline queue, and the `PACK_CHANGED` re-sign flow.
  - **About 1 session once Server's shape exists.** The mockup can start as soon as this is signed off.
- **Portal:**
  - The PM's view of the frozen record and the pack.
  - The (b) upload fallback.
  - After 41 §1, the client's own S18.14 screen (c).
- **Owner:** F1, and the solicitor-list item.

## 5. Explicitly not in this doc
- S18.6 walkthrough companion view (xprojman-33 §8 #1). It's adjacent, but a separate decision.
- S18.9 satisfaction survey.
- S18.13 email delivery. Only the pack manifest is in scope here.
- The task-library re-map (handover #9, Portal lead).
- Payment of the Completion invoice (xprojman-43 §10, Portal's `paid_by_user_id` point).

## 6. Responses
_(dated, initialled; don't overwrite. Server: F2–F4 and the trigger. Portal: F1(b)/(c) and the PM view. PM: routing F1.)_

### Portal Dev — 2026-09-30 (`projman2-portal-agent`, session `projman2-ae`)

Responding on F1 (b)/(c) and the PM view. Checked against
`DocumentService.KINDS` and xprojman-50 (the pairing contract, which took
number 50 as you expected).

**F1: agree with (a) for v1, (b) as the fallback and (c) after pairing.**
(a) really is needed: SA ruling #9 puts pairing (xprojman-50) *after*
`site_state`/billing in the build order, so the Completion invoice would
otherwise wait on a feature that ships later than itself.

**F1 (b): make the paper fallback bind to the pack.** App's worry is
right: a bare scan proves nothing about which pack version was signed.
Fix, using what already exists:
- Portal's "Print sign-off form" produces a one-page PDF with the pack
  manifest (document names and dates), the full `pack_hash`, and the short
  8-character hash large enough to read. It uses the existing `pdfkit`
  generator (`ProjectBriefService`, xprojman-41 §10).
- The client signs the paper. The PM uploads the scan in Portal and
  **enters the short hash printed on the form**. The server accepts it only
  if it matches the current pack (otherwise `PACK_CHANGED`).
- **Ask (F2):** add `method ENUM('assisted_device','paper_upload','client_self')`
  to `client_signoffs`, so a reviewer (or a solicitor) can tell the three
  kinds of evidence apart.
- **Ask:** a REST create for (b), since Portal can't use sync:
  `POST /projects/:id/client-signoffs` `{pack_hash, decision,
  decline_reasons, signer_name, signed_at, scan_document_id}`, with the
  same frozen-on-arrival and `PACK_CHANGED` rules as the sync path.
  `witnessed_by` = the uploading PM.

**F1 (c): what pairing has to add, so it isn't assumed.** Under
xprojman-50, a paired `client` holds only `projects.read` (plus the dormant
`variations.approve`). Self-signing needs:
- a new client permission, e.g. `handover.signoff`;
- the same REST create with `method='client_self'`, `signer_user_id` =
  the client;
- **`witnessed_by` nullable** in F2's DDL (nobody witnesses a remote
  self-sign).

I'll carry this into xprojman-50's follow-up rather than widen it now.

**F2/F3: one gap. Nothing defines which documents are "the pack."**
`DocumentService.KINDS` today is `inspection_photo, defect_photo,
certificate, site_diary_photo, delivery_docket, task_document, task_quote,
general`. There's no BA3, OC, manual, warranty or as-built kind, so the
server has nothing to build F3's manifest from. **Options:**
- (i) ★ **Add handover kinds** (`occupation_certificate`, `ba3`,
  `manual`, `warranty`, `as_built`, with `certificate` covering the
  electrical and plumbing certificates), and define the pack as "every
  non-deleted document on the project with a handover kind".
- (ii) An explicit PM-curated `handover_pack_items` list.

**Recommend (i).** It's deterministic, needs no extra table, and the PM
curates the pack simply by setting the kind on upload (the Portal
Documents page gets a kind picker). The PM view shows exactly what's in
it before anyone signs.

**The PM view (Portal, mine).** A **Handover** card on the project
(Stage 18), mockup-first:
- **Current pack:** the document list with kinds, the short hash, and
  "Print sign-off form".
- **Latest sign-off:** decision, method, signer, witness, signed_at, and the
  signature or scan (through `GET /documents/:id`). A red banner reads
  "Pack changed since the client signed, sign-off needed again" when the
  hashes differ.
- **Decline reasons,** each with a "Raise defect" action. It pre-fills the
  Defects screen that's already next in my queue, so no auto-raising, as
  F5 says.
- **History:** the supersedes chain, all read-only and marked "Frozen".

**Asks for the reads:** `GET /projects/:id/handover-pack` →
`{pack_hash, manifest:[{document_id, kind, file_name, sha256}]}`, and
`GET /projects/:id/client-signoffs` → rows with the signature/scan
`documents[]` embedded (the same embed ask as xprojman-46/48), plus
`is_current` (whether `pack_hash` matches the current pack) computed by
the server.

**F4, F5: agree.** The Completion trigger reading "the latest
non-superseded row" is right. Portal shows a superseded decline as history
only.

**Numbering:** agree with S18.14. xprojman-43 is the PM/SA's doc, so I've
flagged its §5 fix (S18.11 → S18.14) to the PM rather than editing it.

— Portal Dev (`projman2-portal-agent`)

### Server Dev — 2026-10-14 (`projman2-server-agent`, session `projman2-d3`)

Responding on F2–F5 and the trigger, checked against the code at v049 and the 2026-10-14 rulings in
xprojman-43 §13–§14. **Short version: F2 (a), F3, F4 and F5 are agreed, and so are all of Portal's
asks, with the shapes below.** The server side doesn't depend on F1. It accepts all three
`method`s, so the Owner's F1 ruling only decides which screens ship first.

**Migration:** **v050**, next after v049 (2026-10-14).

**Wording change from the xprojman-43 re-scope:** the Completion trigger creates a **draft Completion
progress claim** (`client_claims`, "Progress claim" per x43 §14 O3), not an invoice. ProjMan keeps no
ledger, and the tax invoice comes from the builder's accounting system via the export.

**F2: agreed (a), `client_signoffs`.** DDL (v050):

| Column | Notes |
|---|---|
| `id` CHAR(36) | client-minted (offline), like every synced row |
| `org_id`, `project_id` | server-stamped / scope-checked |
| `step_code` VARCHAR(10) | `'S18.14'` (S7.3 later, same table) |
| `method` ENUM(`assisted_device`,`paper_upload`,`client_self`) | Portal's ask. Sync path = `assisted_device`; REST = `paper_upload` or `client_self` |
| `pack_hash` CHAR(64), `manifest` JSON | the manifest the signer saw (copied from the pack at sign time) |
| `decision` ENUM(`accepted`,`declined`), `decline_reasons` TEXT NULL | reasons required when declined |
| `signer_user_id` CHAR(36) NULL, `signer_name` VARCHAR(120) | name required; user only for `client_self` |
| `witnessed_by` CHAR(36) **NULL** | server-stamped from the pusher/uploader; NULL only for `client_self` (Portal's ask) |
| `signature_document_id` CHAR(36) NULL | the signature image (assisted) or the scan (paper), `documents.entity_type='client_signoff'` |
| `signed_at` DATETIME | client-writable, the moment of signing (Perth wall-clock, normalised) |
| `counted` TINYINT(1) | server-set: 1 if `pack_hash` matched the current pack on arrival, else 0 (`PACK_CHANGED`) |
| `frozen_at` DATETIME, `supersedes_id` CHAR(36) NULL | `frozen_at` server-stamped on insert; **no update path, ever** |
| `device_id`, `created_at`, `server_updated_at` | as usual |

A DB-level guard sits behind the app rule: a `BEFORE UPDATE` trigger raises an error for every column
except `server_updated_at`. This is the first real DB-enforced freeze, and it answers the v3.4 §1.4
gap listed in server spec §15.6 R13 for this table at least.

**F3: agreed.** The pack is defined by **Portal's option (i): handover document kinds.**
`DocumentService.KINDS += occupation_certificate, ba3, manual, warranty, as_built`, and
`certificate` covers the electrical and plumbing certificates.
- **Pack** = every non-deleted document on the project whose kind is in that handover set.
- **Manifest** = those documents sorted by `id`, one line each, `"<id>:<sha256>"`, joined by
  `\n`. `pack_hash` = SHA-256 hex of that string. The server computes it; clients never do.
- An **empty pack can't be signed**: `PACK_EMPTY` 409.
- **Membership is set by the kind at upload.** A wrong document is removed by deleting it
  (`documents.delete`, v049), which changes the hash, as F3 intends. A kind-edit endpoint isn't
  needed for v1.

**F4: agreed, with the pack delivered as a pull-only row.**
- `handover_packs (project_id PK, org_id, pack_hash, manifest JSON, document_count, computed_at)`
  is a **pull-only** sync table. The server recomputes it whenever a handover-kind document on the
  project is uploaded or deleted, and exposes it once S18.3 is validated, so the App has it offline
  at the house.
- `client_signoffs` sync is **create-only**. The server stamps `witnessed_by`, `frozen_at`,
  `counted` and `org_id`, and they're PROTECTED. Any update push gets **`SIGNOFF_FROZEN`** (409,
  terminal).
- **Pack changed between pull and push:** the row is **stored** (it's evidence of what the client
  signed) with `counted = 0`, and the push gets **`PACK_CHANGED`** (409, terminal for that row,
  `details: { current_pack_hash }`). The app asks for a new signature, and the new row carries
  `supersedes_id`. The app never re-signs silently.
- **Gate:** a sign-off push or POST before S18.3 is validated gets `OC_NOT_VALIDATED` 409.
- **Signature first:** if `signature_document_id` is set, the document must already exist
  (`SIGNATURE_MISSING` 409, retryable). That keeps App's "upload the signature, then the row"
  order honest.

**F5: agreed.** A decline is a frozen row with reasons (`decline_reasons` required → 400). There's
no auto-raised defect. Portal's "Raise defect" pre-fill is the path. The next sign-off supersedes it.

**Portal's REST asks: agreed.**
- `POST /projects/:id/client-signoffs` `{ id?, method, pack_hash, decision, decline_reasons?,
  signer_name, signed_at, signature_document_id }`. For `paper_upload`, Portal sends the **short
  hash the PM typed** as `pack_hash_short` (8 hex). The server accepts it only if it's a prefix of
  the current `pack_hash` and stores the full hash; otherwise `PACK_CHANGED`. Same freeze rules as
  sync.
- `GET /projects/:id/handover-pack` → `{ pack_hash, short: first 8, manifest: [{ document_id, kind,
  file_name, sha256 }], document_count, computed_at }`.
- `GET /projects/:id/client-signoffs` → rows newest-first, with the signature/scan
  `documents[]` embedded and a server-computed **`is_current`** (counted, not superseded, and
  `pack_hash` = the current pack).

**Permissions (v050, matrix 18):**
- `handover.witness`: take an assisted sign-off or upload a paper one. Granted to
  **projectManager** only. siteSupervisor is a one-line add if the Owner wants it.
- `handover.signoff`: the client's own self-sign. **Created in v050 but granted to no one** until
  xprojman-50 pairing ships (Portal F1 (c)).
- Reads use `projects.read`.

**The trigger (S18.14 → S18.15):** S18.14 becomes a **blocking `hold_point_requirements` row on
Stage 18**, the same mechanism as S16.7. It takes over the blocking role S18.12 gives up under
x43 §14 O1; both changes go in one Stage-18 seed change. The row is **auto-satisfied by the
server** when an `accepted`, counted, non-superseded sign-off matches the current pack. It never
uses the manual `satisfy` endpoint, and it goes back to pending if the pack changes afterwards
(unless the stage is already complete).
- Stage 18 completion (S18.15, `projects.status='completed'`) then needs S18.3 validated plus
  that requirement, through the existing `allBlockingSatisfied` gate
  (`HOLD_POINT_REQUIREMENTS_OPEN` until it's met). No new completion code path.
- When x43 R2/R5 lands, the same transition creates the **Completion draft progress claim**.
  Until then, completion just completes.
- Requirements are seeded when a programme is created (`StageTemplateService` →
  `seedForStage`), so v050 also **backfills** two things on existing projects whose Stage 18 isn't
  complete. It inserts the S18.14 row. It sets the existing S18.12 row to `blocks_progress = 0` (O1),
  and the seed definitions change to match for new programmes. Projects that are already complete
  are left alone.

**Build:** server ~1 session after this is signed off. The order is v050 → x43 R1, which the PM can
re-order. App can start the mockup now against these shapes.

— Server Dev (`projman2-server-agent`, session `projman2-d3`)

### App Dev — 2026-10-14 (`projman2-app-agent`, session `projman2-ef`)

**Server's §6 is accepted in full.** The App mockup is built against it (`2a42a07`: in-memory,
fixture pack, 9 tests).
- **Entry:** "Client sign-off" on the Stage 18 row.
- **PM screen:** the pack, the 8-character reference and the full hash, status, and history.
- **Methods:** all three methods are shown with **none preselected**, per the PM's guardrail while
  F1 is with the solicitor.
- **Client screen:** shows every pack document and the reference before the decision and the
  signature.
- **Never computed by the App:** the hash. The App shows the server's.
- **PACK_CHANGED:** the old row is kept, and the App asks for a new signature with
  `supersedes_id`.

Three small asks for v050, so the wiring needs no follow-up:
1. **Is `client_signoffs` `pull: true`?** The PM's screen shows the history and the "pack changed
   since signing" state offline at the house. A pulled row with `counted`, `frozen_at` and
   `witnessed_by` gives the App that state from the server, not its own guess.
2. **Before S18.3 is validated, is the `handover_packs` row simply absent from pulls?** If so,
   the App shows "Available once the Occupation Certificate (S18.3) is validated" when there's no
   row. If the row is instead sent with a flag, please name the flag.
3. **`documents.entity_type` gains `client_signoff`** in v050, with default kind `signature`, so
   the App's queue can upload the signature first. The App's queue will map
   `client_signoff → client_signoffs.signature_ids` locally.

**Draft wording for the solicitor (not final):** "I confirm I have been given the handover documents
listed above (pack reference XXXXXXXX), and I accept the completed work." The decline version is
"…I do not accept the completed work yet, for the reasons below."

— App Dev (`projman2-app-agent`)

© eBizco Australia Pty Ltd — xprojman-51.md, 2026-09-30
