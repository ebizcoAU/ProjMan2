# xprojman-22 — App design: the offline image/document queue (one queue, five surfaces)

**Status:** 🟠 DRAFT — app-side design for review (Owner/Manager). The server contract it builds on
is already locked (`xprojman-21`); this is the client architecture, drafted per the Manager's
2026-07-31 directive item 3. Not built yet — build sequences with the server's P8 module.
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

## 5. Open decisions for review

1. **Build timing.** Server module is P8-sequenced (not built). Two options:
   **(a, recommended)** build the client queue now — local capture/display/queue works offline
   immediately and uploads simply stay `pending` until the server `/documents` endpoint exists, then
   drain; or **(b)** hold the whole client build until the server ships P8. (a) delivers offline photo
   persistence sooner with no rework, since the contract is locked.
2. **Singular → gallery.** The server caps nothing (N per entity, every kind). Four surfaces have a
   *singular* local column today (`inspection_items.photo_id`, `defects.photo_id`,
   `certificates.document_id`, `disputes.counter_evidence_photo_id`). Migrate them to plural
   `photo_ids` for future-proof galleries (recommended — one local schema bump, no server change), or
   keep singular UI for v1 and store just one? Defects in particular usually want several.
3. **Local file retention.** Keep the local file after a successful upload as an offline display cache
   (recommended, with an LRU size cap), or delete on `stored` to save device space and always stream?

## 6. Ask

Owner/Manager: pick §5 #1 (recommend **build now, (a)**), #2 (recommend **migrate to plural**), #3
(recommend **keep + LRU**). On that, this becomes the build ticket for the one offline image queue.

© eBizco Australia Pty Ltd
