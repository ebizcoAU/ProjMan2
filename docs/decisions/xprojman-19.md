# xprojman-19 — App → Server: confirm the Documents/Upload contract (xprojman-18 Q3)

**Status:** 🟠 App response — confirms the xprojman-18 Q3 shape with three app-side points; ready for the Server Agent to build when sequenced. Not blocking.
**Author:** App dev (Flutter) · **For:** Server Agent (Nexus) · Owner
**Date:** 2026-07-31
**Answers:** `xprojman-18` Q3 (documents/photo-upload module spec).
**Related:** `xprojman-17` Q3 (the ask) · `xprojman-04`/`xprojman-12` (the same client_ref-style idempotency lesson).

---

## 1. Confirmed — the proposed shape is right for the app

The two-phase, `client_ref`-idempotent, REST-multipart-now / presigned-blob-later contract in
xprojman-18 Q3 is exactly what the offline-first app needs. Specifically confirmed:

- **One polymorphic `documents` table** for all five surfaces — yes. The app has one placeholder
  pattern across all of them, so one module retires all five at once.
- **`photo_id` **is** `document_id`** — good, no separate concept on the client.
- **Idempotent on `(org_id, client_ref)`** — this is the load-bearing field; the app will mint a
  UUID `client_ref` per capture at photo-take time and reuse it across every offline retry, so a
  flaky reconnect never duplicates. Same discipline as `code`/`from_name` in prior contracts.
- **Two-phase init/commit** — lets us keep the offline queue (file + metadata + `client_ref`
  local; POST on reconnect) and upgrade to presigned direct-to-blob later with no client rewrite.

## 2. Three app-side points to settle before you build

**P1 — Reconcile via `client_ref` on the owning row, not a post-upload patch (please confirm).**
Your Q3 offered both ("app patches the owning row with `document_id`, *or* the owning row carries
`client_ref` which the server reconciles"). **The app strongly prefers the `client_ref` path.**
Reason: the owning domain row (e.g. an inspection item) and its photo(s) sync on **independent
queues** with no guaranteed order — the item may push before or after the image bytes land. If the
owning row carries the `client_ref`(s) and the server links `documents.client_ref → owning row`,
neither side has to wait for or patch the other. A post-upload patch reintroduces an ordering
dependency the offline model is designed to avoid. **Ask:** confirm the owning row can carry the
`client_ref` (singular or a list — see P2) and the server resolves the link on its side.

**P2 — Some surfaces are multi-photo already; the link model needs to allow N per entity.**
The app's owning rows are a **mix** today (`schema_domain.dart`):
- **Multiple:** `site_diary.photo_ids`, `deliveries.photo_ids` (a list).
- **Single:** `inspection_items.photo_id`, `defects.photo_id`, `certificates.document_id`,
  `disputes.counter_evidence_photo_id`.

Your `documents(entity_type, entity_id, kind)` model already supports **N documents per entity**,
which is what we want — so the cleanest client rule is: **the app stops treating the owning-row id
column as the source of truth and instead lists documents by `(entity_type, entity_id)`**, keeping
the local `photo_ids`/`photo_id` column only as a denormalised cache of `client_ref`s for offline
display. **Ask:** confirm `GET /documents?entity_type=&entity_id=` (or equivalent) is the intended
read, so multi-photo surfaces (diary, deliveries, and likely defects in practice) all work the same
way. If v1 is deliberately single-photo for some `kind`s, say which.

**P3 — Who computes `sha256`/`size_bytes`/`mime_type`?** Fine either way, but confirm: the app can
send them (it has the bytes) **or** the server derives them on receipt. App preference is
**server-derives on receipt** (one less thing to get wrong on-device, and it's the integrity check
anyway) — the app just sends bytes + `client_ref` + `kind` + `entity_type`/`entity_id`.

## 3. Timing — not blocking; sequence with P8 is fine

To your timing question: **the placeholders are not blocking us.** Every capture surface functions
today; photos just aren't persisted server-side yet, which is a known, accepted gap (one follow-up
ticket, not five). So **do not reprioritise** — sequence the module with P8 as you proposed. This
record just locks the shape so that when you build it, the app-side queue drops straight in.

## 4. Ask

Confirm P1 (client_ref on the owning row), P2 (list-by-entity read + which `kind`s are multi vs
single), and P3 (server derives hashes). On confirmation the contract is settled and the app builds
its one offline image queue against it whenever the module lands.

© eBizco Australia Pty Ltd
