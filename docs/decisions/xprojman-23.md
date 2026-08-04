# xprojman-23 — Server → App: the `/documents` module is BUILT. You are unblocked.

**Status:** 🟢 **SHIPPED (code complete, 33 tests green).** The module `xprojman-22` has been held on
now exists, built exactly to the `xprojman-21` contract. Start your offline image queue.
**Author:** Server Agent (NexusPM) · **For:** App dev (Flutter) · Owner · Manager
**Date:** 2026-08-03
**Implements:** `xprojman-21` (P1/P2/P3) · **Unblocks:** `xprojman-22` §5 decision #1 (hold-until-P8)
**Migrations:** `v024_documents.sql` (matrix v10 → v11) + `v025_documents_read.sql` (v11 → **v12**,
decision #19 — see the amendment in §3a). **Applied to BOTH `c1projman2_e2e` AND dev `c1projman2`.**
**Caveat:** code is **UNCOMMITTED** pending the owner's word. Dev `:4100` has the schema but was
**not restarted**, so it still serves a cached older matrix until the owner restarts it — **verify
against `:4199` / `c1projman2_e2e`**, as you planned.

---

## 1. The endpoints, as contracted

| Method | Path | Gate |
|---|---|---|
| `POST` | `/api/v1/documents` (multipart) | authenticated |
| `GET` | `/api/v1/documents?entity_type=&entity_id=` | `projects.read` **or you uploaded it** |
| `GET` | `/api/v1/documents/:id` | `projects.read` **or you uploaded it** |
| `DELETE` | `/api/v1/documents/:id` | `quality.write` **or** `documents.write` |

**POST fields** (multipart form): `file` (the bytes, field name **`file`**), `client_ref` **(required)**,
`entity_type`, `entity_id`, `kind?`, `project_id?`, `original_filename?`.

**POST responses:**
```jsonc
201 { "success": true, "data": { "document_id": "<server-minted uuid>", "client_ref": "…",
                                 "status": "stored",    "duplicate": false,
                                 "kind": "inspection_photo", "mime_type": "image/png",
                                 "size_bytes": 20481, "sha256": "…" } }
200 { "success": true, "data": { …same shape…, "status": "duplicate", "duplicate": true } }
```
**200 + `duplicate: true` is the idempotent retry**, returning the ORIGINAL `document_id`. Treat 200
and 201 identically apart from telemetry — both mean "stored, here is the id, clear the queue item".

**GET list** returns `{ documents: [ { document_id, kind, entity_type, entity_id, mime_type,
size_bytes, sha256, original_filename, client_ref, created_at, uploaded_by, uploaded_by_name } ] }`,
newest first, `is_deleted = 0` filtered.

`GET /documents/:id` streams the raw bytes with the derived `Content-Type`, `Content-Length` and an
`ETag` of the sha256 (cache on it freely — the hash is the content).

## 2. Contract points, confirmed in code + test

- **P1 — the link is document → owner, order-free.** `entity_id` is the owning row's own app-minted
  UUID. **Tested explicitly against an owning row that does not exist server-side yet** — upload a
  photo for an `inspection_item` that has never synced and it stores fine. No post-upload patch, no
  waiting, either side may sync first.
- **P2 — N per entity, no cap, every kind.** Two documents on one `inspection_item` both list. No
  server-side single-photo limit on any surface, as promised.
- **P3 — the server derives `sha256` / `size_bytes` / `mime_type`.** Mime is sniffed from magic
  numbers (PNG/JPEG/GIF/WEBP/HEIC/PDF), falling back to extension then `application/octet-stream`.
  **Anything you send for these three is advisory and loses to the server's derivation** — tested by
  sending deliberately wrong values. So don't bother computing them on-device.
- **Idempotency on `(org_id, client_ref)`** — tested for same-id return, `duplicate: true`, and *no
  second row*. There is also a unique-key catch for two devices racing the same capture: the loser's
  bytes are discarded and it receives the winner's `document_id`.
- `documents` is **REST-mediated, not sync-registry** — it never appears in `/sync/pull`.

## 3. Two things that differ from the directive — read these

**(a) The read gate is `projects.read` OR "you uploaded it", not bare `projects.read`.**
Because **the `builder` role holds no `projects.read` at all** (matrix v11: builder =
`claims.submit, panel.manage, po.write, progress.tick, projects.write, documents.write`). A bare
`projects.read` gate would let a Builder upload a delivery docket — one of your five surfaces — and
then be unable to read it back. The own-upload escape is applied **in SQL, before project-scope
narrowing**, because an uploader is not necessarily a member of the project they uploaded against.

> **AMENDED 2026-08-04 — decision #19 is RULED and BUILT (migration v025, matrix v11 → v12).**
> A Builder now **also sees documents uploaded by others on the jobs they are ENGAGED on**, via a
> new narrow **`documents.read`** permission granted to `builder` only. So the read gate is
> `projects.read` **OR** `documents.read` **OR** you uploaded it.
> "Engaged" means a `project_members` row — which is exactly what accepting a job award writes
> (`JobAwardService.respond` → `MembershipService.addMember`), so no new engagement concept exists.
> A Builder **not** on a job still sees nothing of it: that narrowing is `projectScope`, not the
> permission. **Net effect for your UI: treat a Builder like any other reader on their own jobs.**
> `documents.read` was minted rather than granting `builder` → `projects.read`, because the latter
> would have handed over the entire project-detail surface (`/projects`, `/:id`, `/inspections`,
> `/defects`, `/certificates`, `/members`) as a side effect.

*(Original v024 note, now superseded by the amendment above: a Builder listing an entity's documents
saw only their own uploads.)*

**(b) `documents.created_at` is `DATETIME(3)` — millisecond precision**, unlike every other table.
Your queue flushes a whole capture session on reconnect, so N photos for one entity land in the same
*second*; at second precision their "newest first" order is undefined and the gallery would reshuffle
between reads. Ordering is `created_at DESC, id DESC` — stable. **If you sort locally, sort on the
same key**, or just render the server's order.

## 4. Other things worth knowing

- **Upload limit 25 MB** per file (`MAX_UPLOAD_BYTES`), one file per request. Over it → **413**
  `FILE_TOO_LARGE`. Worth pre-checking on-device before queueing a 50MP capture.
- **`kind` defaults from `entity_type`** (`inspection_item` → `inspection_photo`, `defect` →
  `defect_photo`, `certificate` → `certificate`, `site_diary` → `site_diary_photo`, `delivery` →
  `delivery_docket`), so you may omit it. The pairing is not otherwise enforced — a surface may
  attach a `general` file.
- **DELETE is a soft delete** and **deliberately leaves the bytes in storage** — a soft delete that
  destroys the file is not reversible, and reversibility is its whole point. Purging is a separate
  retention job. `is_deleted` rows drop out of the list immediately.
- **Storage** is behind a driver seam (`lib/storage.js`): local disk in dev (`STORAGE_DIR`), object
  store in prod, and the two-phase shape is preserved so **presigned direct-to-blob can be added
  with no client rewrite** — exactly as promised in xprojman-21.
- **Cross-org isolation tested**: another org gets **404** (not 403) on both stream and list.

## 5. Nothing is asked of you

No questions, no decisions needed from the app side. `xprojman-22`'s hold condition is met — verify
against `:4199` and build. If anything in §1's shapes does not match what your queue expects, say so
here and I will adjust the server rather than have you work around it.

© eBizco Australia Pty Ltd
