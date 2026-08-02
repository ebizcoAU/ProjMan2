# xprojman-22 — App design: the offline image/document queue (one queue, five surfaces)

**Status:** 🟢 Design complete, **all decisions resolved** — this is the build ticket for the one
offline image queue. Build **held until the server's P8 `/documents` module lands** (then execute,
verify against `:4199`). Server contract locked in `xprojman-21`.
**Decisions (see §5):** #1 build timing → **HOLD until P8** (App Agent's call, 2026-07-31, Manager
left it open) · #2 columns → **migrate singular → plural** (Manager, 2026-08-03) · #3 retention →
**keep local file + LRU cap** (Manager, 2026-08-03). If the Owner later wants offline photo
*persistence* sooner, the local-capture+queue half alone is verifiable and could ship ahead of the
upload path — an explicit Owner call, not assumed here.
**Author:** App dev (Flutter) · **For:** Owner · Manager (+ Server Agent for awareness)
**Date:** 2026-07-31
**Builds on:** `xprojman-21` (documents contract: `POST /documents` + `GET /documents?entity_type=&entity_id=`,
`client_ref` idempotency, server-minted `document_id`, N-per-entity, server-derived hashes).

---

## 1. Goal

Replace the `pending-<timestamp>` placeholder pattern — used today across **five** capture surfaces
(inspection-item photo, defect photo, certificate document, site-diary photo, delivery docket) — with
**one** offline-first upload queue, so a photo captured with no signal is persisted locally, shown
immediately, and uploaded exactly once when connectivity returns. One queue, one code path, all five
surfaces (as agreed in xprojman-19/21).

## 2. Local model

**Files on the filesystem, metadata in SQLite** (the established rule — camera → app-documents dir +
a metadata row, never a SQLite blob).

New local table **`upload_queue`** (DB schema bump):

```
upload_queue(
  client_ref    TEXT PRIMARY KEY,   -- app-minted uuid v4, the stable offline handle & upload idempotency key
  local_path    TEXT NOT NULL,      -- file in the app documents dir
  kind          TEXT NOT NULL,      -- inspection_photo | defect_photo | certificate | site_diary_photo | delivery_docket | general
  entity_type   TEXT NOT NULL,      -- inspection_item | defect | certificate | site_diary | delivery
  entity_id     TEXT NOT NULL,      -- the OWNING row's app-minted UUID (already held at capture)
  project_id    TEXT,
  original_filename TEXT,
  document_id   TEXT,               -- server-minted, filled on successful upload
  status        TEXT DEFAULT 'pending', -- pending | uploading | stored | failed
  attempts      INTEGER DEFAULT 0,
  last_error    TEXT,
  created_at    INTEGER
)
```

The `(entity_type, entity_id, kind)` triple mirrors the server's `documents` row exactly
(xprojman-21 §P2 mapping table), so enqueue → upload is a straight field copy.

## 3. Flows

**Capture.** On photo/doc capture the service: (1) mints `client_ref = Uuid().v4()`; (2) writes the
bytes to `<appdocs>/uploads/<client_ref>`; (3) inserts an `upload_queue` row; (4) appends
`client_ref` to the owning row's local `photo_ids`/`photo_id` **display cache**. The UI renders from
the local file immediately — no network needed.

**Upload worker.** Triggered on connectivity-regained + app-foreground + post-capture. For each
`pending`/`failed` row: multipart `POST /documents` with the file bytes + `client_ref`, `kind`,
`entity_type`, `entity_id`, `project_id?`, `original_filename?`. On success → store `document_id`,
`status='stored'`, swap the owning-row cache entry `client_ref → document_id` (purely local, ungated).
On network failure → `status='failed'`, `attempts++`, exponential backoff. **Idempotent on
`(org_id, client_ref)`** (xprojman-21) → retries never duplicate, so we can retry freely.

**Display / source of truth.** `GET /documents?entity_type=&entity_id=` is authoritative
(xprojman-21 §P2). The local `photo_ids` column is a denormalised cache: show the local file while
`client_ref` is un-uploaded, else stream `GET /documents/:id`. On refresh/pull, re-hydrate the cache
from the list endpoint (documents ride REST, **not** the sync feed — xprojman-21).

**Delete.** Local-only (not yet uploaded) → drop queue row + file + cache entry. Uploaded →
`DELETE /documents/:id` (soft) + drop cache entry; queue the delete if offline.

**Order-independence.** The document carries `entity_id` (the owning row's app UUID, held at
capture), so the document self-describes its owner and neither side waits on the other — the owning
row (JSON sync) and the document (REST) can land in any order (xprojman-21 §P1).

## 4. Integration

One `DocumentQueueService` with `enqueue({kind, entityType, entityId, bytes, projectId})` +
`listFor(entityType, entityId)` (merges local-pending + server list). The five capture screens each
drop their bespoke `pending-<ts>` logic and call this one service — a single follow-up that upgrades
all five at once, never a per-feature partial (the standing rule).

## 5. Decisions — ALL RESOLVED

1. **Build timing → HOLD until the server's P8 `/documents` module lands** (App Agent's call,
   2026-07-31 — Manager left it open; see the Status block). The upload path can't be verified live
   until the endpoint exists, and it's a large 5-surface refactor. The design is complete and drops
   straight in when P8 arrives. *(If the Owner later wants offline photo persistence sooner, the
   local-capture+queue half alone is verifiable and could ship first — an explicit Owner call.)*

2. **Singular → plural columns → MIGRATE to plural** (Manager-approved, 2026-08-03). At build time,
   migrate the four singular cache columns — `inspection_items.photo_id`, `defects.photo_id`,
   `certificates.document_id`, `disputes.counter_evidence_photo_id` — to plural list columns
   (`*_ids`, holding a JSON/CSV of `client_ref`s pre-upload and `document_id`s after), one
   `schema_domain` version bump. Future-proofs all five surfaces for galleries with **zero server
   change** (server is already uncapped, N-per-entity). The list column stays a denormalised display
   cache; `GET /documents?entity_type=&entity_id=` remains the source of truth. Per-surface UI still
   chooses "primary only" vs "gallery" — the storage no longer constrains it.

3. **Local file retention → KEEP after upload, with an LRU cap** (Manager-approved, 2026-08-03).
   Retain the local file past `status='stored'` as an offline display cache; enforce a size-based LRU
   prune (cap TBD at build, e.g. ~a few hundred MB) evicting oldest-first. A pruned file re-fetches on
   demand from `GET /documents/:id` (safe — it's uploaded), so eviction is lossless. Offline display
   keeps working; device space stays bounded.

## 6. Status — ready to build when P8 lands

All three decisions resolved: **#1 hold-until-P8**, **#2 migrate-to-plural**, **#3 keep+LRU**. This
record is now the build ticket for the one offline image queue across all five surfaces; execution
begins when the server's `/documents` module ships (verify against `:4199`).

© eBizco Australia Pty Ltd
