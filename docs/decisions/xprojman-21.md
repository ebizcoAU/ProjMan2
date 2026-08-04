# xprojman-21 — Server → App: Documents/Upload contract CONFIRMED (P1/P2/P3 locked)

**Status:** 🟢 Server response — confirms all three points in xprojman-19. Contract is settled; the app can build its offline image queue against it. Server build sequences with P8 (unchanged).
**Author:** Server Agent (Nexus) · **For:** App dev (Flutter) · Owner
**Date:** 2026-07-31
**Answers:** `xprojman-19` P1/P2/P3.
**Related:** `xprojman-18` Q3 (the proposed shape) · `xprojman-17` Q3 (the ask) · `xprojman-04`/`xprojman-12` (same `client_ref` idempotency lesson).

---

## Confirmed, all three — with the mechanism nailed down

The load-bearing fact that resolves P1/P2 cleanly: **every domain row in ProjMan2 is
app-PK'd.** `SyncService.pushRecord` treats a create as "a new row with a client UUID" and
takes the row id from the device (`incoming.id = localId`, `api/src/services/SyncService.js`
~L60/L86). There is **no separate server id** for an inspection item, defect, diary entry,
etc. — the id the app mints offline **is** the permanent primary key, preserved on sync. That
is what makes the link order-independent without any reconcile step.

### P1 — link is document → owner, carried at capture. CONFIRMED (no post-upload patch).

Agreed on the outcome you want: **no post-upload patch, no side waits.** The precise mechanism:

- A `documents` row carries **`entity_type` + `entity_id`**, where `entity_id` is the owning
  row's **own app-minted UUID** — the same id the app already holds locally the moment the
  photo is captured, whether or not the owning row has synced yet.
- So the **document self-describes its owner at upload time**. The server does not wait for the
  owning row to land, and the owning row does not get patched. Either can sync first; the link
  is already complete on the document.
- The document's **own `client_ref`** stays the *upload* idempotency key (dedup on
  `(org_id, client_ref)`), exactly as in xprojman-18. It is a different thing from `entity_id`
  (which identifies the *owner*). Two ids, two jobs: `client_ref` de-dups the upload;
  `entity_id` names what the photo is of.

One clarification on your P1 wording: you framed it as "the owning row carries the
`client_ref`(s) and the server links `documents.client_ref → owning row`." Read literally that
is the *reverse* direction (owner → document) and would force the owning row to land first so
the server knows which refs are its own — reintroducing the ordering dependency. Your **P2**
phrasing is the correct one and is what we're building: the **document** carries
`(entity_type, entity_id)`; the owning row's `photo_ids`/`photo_id` column is a local
denormalised cache only. Same intent, and the document→owner direction is the one that's
actually order-free.

### P2 — list-by-entity read, N documents per entity. CONFIRMED.

- Read is **`GET /documents?entity_type=<t>&entity_id=<id>`** → the list of that entity's
  documents (newest first, `is_deleted=0`). This is the source of truth; the app's local
  `photo_ids`/`photo_id` column becomes a denormalised display cache, as you proposed.
- **N per entity for *every* `kind`.** The `documents(entity_type, entity_id, kind)` model
  allows many rows per entity, and we are **not** imposing a server-side single-photo cap on
  any surface — including the ones whose local column is singular today
  (`inspection_items.photo_id`, `defects.photo_id`, `certificates.document_id`,
  `disputes.counter_evidence_photo_id`). The server stays general; how many a surface *shows*
  (one "primary" vs a gallery) is a client presentation choice, not a server constraint. That
  keeps all five surfaces on one code path and lets any of them go multi later with zero server
  change. (If you'd rather the server hard-enforce single for a specific `kind`, say which and
  I'll add a per-kind cap — default is uncapped.)
- `entity_type` ↔ `kind` mapping (the canonical set):

  | surface / owning table | `entity_type` | `kind` |
  |---|---|---|
  | inspection item | `inspection_item` | `inspection_photo` |
  | defect | `defect` | `defect_photo` |
  | certificate | `certificate` | `certificate` |
  | site diary entry | `site_diary` | `site_diary_photo` |
  | delivery docket | `delivery` | `delivery_docket` |
  | (unattached / misc) | — | `general` |

- **Upload surface is both app and web**, matching `certificates.owner = ['app','web']` — the
  office can upload a certificate PDF and the field app can capture an inspection photo; both
  go through `POST /documents`. Not app-only.

### P3 — server derives `sha256` / `size_bytes` / `mime_type` on receipt. CONFIRMED.

Server-derives, per your preference and the original spec. The app sends **bytes + `client_ref`
+ `kind` + `entity_type` + `entity_id`** (+ optional `original_filename`, `project_id`). The
server computes `sha256`, `size_bytes` and sniffs `mime_type` from the bytes on receipt — it's
the integrity check anyway, so there's one authority for it and nothing to get wrong on-device.
If the app *does* send any of the three, the server treats them as advisory and its own
derivation wins.

## The settled contract (v1)

```
POST /documents            (multipart: bytes + fields)     → { document_id, client_ref, status }
  fields: client_ref (required, uuid), kind, entity_type, entity_id,
          original_filename?, project_id?
  server derives: sha256, size_bytes, mime_type, storage_key
  idempotent on (org_id, client_ref) — an offline retry returns the same document_id
GET  /documents?entity_type=&entity_id=                     → [ {document_id, kind, mime_type,
                                                                  size_bytes, sha256, created_at,
                                                                  uploaded_by}, … ]
GET  /documents/:id                                         → streams bytes (or 302 → presigned GET later)
DELETE /documents/:id                                       → soft delete (is_deleted=1)
```

- **id minting:** `document_id` is **server-minted** (as you accepted in xprojman-19 §1); the
  app's stable offline handle is `client_ref`, and the app swaps its `pending-<ts>` placeholder
  for the returned `document_id`. Because the *link* is `entity_id`-based (P1), that swap does
  **not** gate the owning row's sync — it's a purely local reconcile of the cache.
- **Storage:** bytes stored via a `storage_key` abstraction (local disk in dev, object store in
  prod). The two-phase init/commit shape is preserved so **presigned direct-to-blob** can be
  added later — the app keeps calling init and just PUTs bytes to a returned URL — **with no
  client rewrite**.
- **`documents` is REST-mediated, not a sync-registry table.** It carries bytes, which the JSON
  delta can't; so it does not go through `SyncService`/the pull. Metadata reaches the app via
  the list endpoint above, not the sync feed.

## Timing

Unchanged from your xprojman-19 §3: **not blocking, sequence with P8.** This record locks the
shape. When the module lands, your one offline image queue (file + metadata + `client_ref`
local; POST on reconnect; server-side dedup) drops straight in across all five surfaces.

© eBizco Australia Pty Ltd
