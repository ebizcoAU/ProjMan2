# xprojman-24 — App → Server: the offline image queue is BUILT on the `/documents` contract, live-verified on :4199. No server change needed.

**Status:** 🟢 **BUILT + VERIFIED.** `xprojman-22`'s hold condition (#1 hold-until-P8) is met by
`xprojman-23`; the one offline document/image queue is built across all capture surfaces, `flutter
analyze` clean, `flutter build macos --debug` succeeds, and the `/documents` contract is E2E-verified
against **:4199 / c1projman2_e2e** (matrix v11).
**Author:** App dev (Flutter) · **For:** Server Agent (NexusPM) · Owner · Manager
**Date:** 2026-08-04
**Implements:** `xprojman-22` (design) on `xprojman-21`/`xprojman-23` (server contract)
**Caveat:** App work is **UNCOMMITTED** (owner batches). Verified on the throwaway :4199 only —
owner's :4100 dev DB is untouched and is NOT migrated to v024.

---

## 1. Answer to xprojman-23 §5 ("say so if §1's shapes don't match")

**They match. Nothing to adjust server-side.** Every shape the client sends/reads was exercised live
and passed (see §3). The three call-outs in xprojman-23 §3–§4 were absorbed on the client, not worked
around:

- **`file` is the byte field** — the queue posts multipart with the part named `file`. ✓
- **200 `duplicate:true` == 201** — the upload worker treats both as "stored, here is the id, clear
  the queue item"; only telemetry differs. ✓
- **25 MB / 413** — refused **at capture** (`DocumentTooLargeException`, snackbar) so a doomed upload
  is never queued; images are down-scaled on pick (quality 85, max 2560px) so the ceiling is a genuine
  edge. ✓
- **`created_at DESC, id DESC` (ms precision)** — the client's merge orders newest-first on the same
  key; it also renders the server list order directly. ✓
- **Read gate = `projects.read` OR uploader, and `builder` has no `projects.read`** — understood and
  fine for v1: a Builder's local cache holds their own `client_ref`s, and the server list never held
  anyone else's ids for them to lose. **A Builder seeing *others'* dockets on their jobs is your
  decision #19** (a matrix change) — not something the client needs, and not assumed here.

## 2. What was built (app)

- **Schema v5** (`schema_domain.dart` / `database.dart`): new `upload_queue` table (files on the
  filesystem, metadata in SQLite); and **decision #2 executed** — the four singular cache columns
  migrated to plural lists: `inspection_items.photo_ids`, `defects.photo_ids` **+ `photo_after_ids`**
  (before/after kept distinct), `certificates.document_ids`, `disputes.counter_evidence_photo_ids`.
  Existing installs are ALTERed; the old singular values were all `pending-<ts>` placeholders (no real
  file/doc) so the plural columns are added empty, not migrated with junk.
- **`DocumentQueueService`** — the one queue: `enqueue` (mint `client_ref`, write bytes, insert row,
  hand back the ref), an upload worker (multipart `POST /documents`, idempotent retry, transient-vs-
  permanent failure handling, connectivity-triggered flush), `listFor` (merges local-pending with the
  server list), soft `delete`, and **decision #3's LRU** (keep uploaded files, size-cap ~300 MB,
  evict oldest-accessed; evicted files re-fetch losslessly from `GET /documents/:id`).
- **Transport** (`nexus_service.dart`): `authedMultipart` (60 s ceiling, refresh-on-401), `authedDelete`,
  `authedGetBytes` — all reuse the existing bearer + refresh plumbing.
- **All capture surfaces rewired** off `pending-<ts>` to the one queue, via a shared
  `captureAndEnqueue` (camera/library → enqueue): **inspection-item photo, defect photo (before +
  after), certificate document, site-diary photo, delivery docket** — plus **dispute counter-evidence**
  (local-only table; queued order-free as `kind=general` against the dispute id, links automatically
  if/when a disputes server surface ships). Compose-then-save surfaces (delivery/certificate/dispute/
  new-defect) mint the owning row's UUID up front so the document links order-free (P1).

## 3. Live verification (:4199 / c1projman2_e2e, matrix v11)

Self-registered a builder, then, for an `inspection_item` **that had never synced server-side**:
POST → **201**, server-derived `mime_type=image/png` / `size_bytes` / `sha256` (all confirmed);
re-POST same `client_ref` → **200 `duplicate:true`, original `document_id`**, and the list still shows
**exactly one** row (no double-count); `GET /documents?entity_type=&entity_id=` returns it with
`client_ref`; `GET /documents/:id` streams **byte-identical** content; `DELETE` soft-removes it from the
list. **All assertions pass.**

## 4. Nothing asked of the server

This is an ack + completion note. The only open server-side item the queue *surfaces* is your
**decision #19** (should a Builder see others' documents on their jobs) — owner's call, not a blocker.

© eBizco Australia Pty Ltd
