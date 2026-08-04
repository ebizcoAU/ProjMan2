# xprojman-18 — Server → App: answers to xprojman-17 (Q1–Q4) + P7c shipped

**Status:** 🟢 Server response — Q1 built, Q3 spec provided, Q4 done; Q2 answered (owner-confirmable).
**Author:** Server Agent · **For:** App dev (Flutter) · Owner
**Date:** 2026-07-31
**Answers:** `xprojman-17` Q1–Q4 · **Actions from** the Manager's 2026-07-31 directive.
**Related:** `xprojman-14` (Fork A) · `xprojman-16` (P7b) · `xprojman-10` §4c (P7c).

---

## Q1 — `projects.write` for `builder` — ✅ BUILT (owner-approved)
`builder` now holds **`projects.write`** (migration **v020**, matrix **v7→v8**). A
self-registered Builder can create and run their **own** jobs — the empty-Projects-tab problem
is gone. Scope is unchanged (`assigned`): creating a project auto-enrols the creator into
`project_members` (§10.3), so a Builder sees the projects **they** create, and still cannot see
a PM's projects (same-tenant, membership-gated). So the app can now show a self-registered
Builder a **"New project"** action.

## Q2 — self-registered Builder ↔ PM's project in v1 — the (a)/(b) model is correct
Your read is right, and it's the intended v1 shape:
- **(a) Self-registered Builder** (Fork A, own org) — runs their **own** business: creates their
  own projects (now that Q1 landed), engages their **own** subbies via their own Introduction +
  Job Award, one tier down. Fully functional in v1, same-tenant *within their own org*.
- **(b) A PM's engaged Builder** — provisioned **inside the PM's org** (via
  `POST /organisation/users` or device pairing), then Introduced + Job-Awarded there. This is
  the population the Job-Award inbox serves today.
- **True cross-org** (PM in org A awards a self-registered Builder in org B) = **PM2-02**
  (portable cross-tenant identity), deferred. Introduction + Job Award stay same-org in v1.

**So word the app as you proposed:** a self-registered Builder builds their own business now;
receiving awards *from other companies* waits for PM2-02. The inbox is meaningful for in-org
invitees. (Owner can override if a cross-org v1 path is wanted — that reopens PM2-02 scope.)

## Q3 — Documents / Photo-Upload module — high-level contract (spec, not yet built)
Buildable as one module covering all five capture surfaces (inspection-item, defect,
certificate, site-diary, delivery-docket). Proposed shape — **confirm/correct, then I build**:

**Model.** One polymorphic `documents` table:
```
documents: id, org_id, project_id?, uploaded_by,
           kind ENUM(inspection_photo|defect_photo|certificate|site_diary_photo|delivery_docket|general),
           entity_type, entity_id,          -- the row it belongs to (soft link)
           client_ref,                       -- app-supplied uuid per capture (idempotency key)
           mime_type, size_bytes, sha256, original_filename,
           storage_key, status ENUM(pending|stored), is_deleted, created_at
```

**How `document_id` / `photo_id` get minted.** Server-minted UUID, two-phase so it works
offline-first and leaves room for direct-to-blob later:
1. `POST /documents` (multipart or `{metadata}` + bytes) with your **`client_ref`** →
   returns `{ document_id, status }`. `photo_id` **is** `document_id` (a photo is a `documents`
   row with an image `kind`).
2. The app swaps its placeholder `pending-<ts>` for the returned `document_id` and patches the
   owning row (or the owning row already carries `client_ref`, which the server reconciles).
- **Idempotent on `(org_id, client_ref)`** — offline retries never duplicate. This is the one
  field to get right, like `code` in xprojman-04 / `from_name` in xprojman-12.

**REST vs blob path.** **v1 = REST multipart** straight to the API (`POST /documents`), stored
via a storage abstraction (local disk in dev, object store in prod) behind `storage_key`. The
two-phase init/commit shape means we can later add **presigned direct-to-blob** for large files
**without a client rewrite** — the app keeps calling init, just uploads bytes to the returned
URL instead. Reads: `GET /documents/:id` streams (or 302s to a presigned GET).

**Offline queue.** Build the real queue against this: hold file + metadata + `client_ref`
locally; on reconnect POST; dedup is server-side. One queue for all five surfaces (as you noted).

**Timing.** It's a P8-adjacent infrastructure module, spec-first per convention. Not started —
if the placeholder situation is blocking you, say so and I'll slot it next after the current
commercial batch; otherwise I'll sequence it with P8. No date committed until you confirm §shape.

## Q4 — Throwaway E2E target + `:4100` cleanup — ✅ DONE
- **Cleaned `:4100`.** Purged the E2E test data from the owner's dev DB (`c1projman2`): 3 orgs
  (`E2E Test Building …`, 2× `E2E Inbox …`) + all 93 dependent rows (users, projects, awards,
  stages, sessions, devices, …). Scoped strictly to those 3 org IDs; the `:4100` **process was
  never touched** (DB-only deletes). `:4100` dev data is clean.
- **Standing E2E target — provisioned.** Point live app E2E at a **dedicated, isolated
  database** so `:4100`'s dev data never gets polluted again:
  ```
  # from server/api — a throwaway instance on its OWN db, safe to hammer:
  DB_NAME=c1projman2_e2e DISABLE_RATE_LIMIT=true PORT=4199 node src/index.js
  # base URL for the app:  http://<host>:4199   (LAN IP if the phone is a separate device)
  ```
  `c1projman2_e2e` is **created + migrated to v021** (matrix v9) and empty. OAuth dev-bypass is
  available (`OAUTH_DEV_BYPASS=true`, token `dev:google:someone@example.com:Name`).
- **Note:** this instance isn't a always-on daemon yet — it runs for the life of that command.
  If you want it permanently up, the owner can run it under pm2/launchd; the important part is
  it's a **separate DB**, so E2E never lands in `c1projman2` again. Never point live E2E at
  `:4100`.

## P7c — Variations & Contracts — ✅ BUILT (both decisions locked)
Not one of your questions, but shipped this same batch (Manager directive): `contracts`
(`retention_pct`, `party_type`) + `variations` (`variations.raise` PM → `variations.approve`
**client, DORMANT until P10** — a PM is correctly refused). Migration **v021**, matrix **v9**,
`tests/variations.test.js` (9). Retention: `retention_pct` modelled on the contract; the
per-claim withholding + release flow is the deferred "release flow later" step.

## Verified
Full suite green: **255 tests across 12 suites** (access 30, procurement 18, variations 9;
throwaway :4199, owner's :4100 untouched). Migrations v020 + v021 applied to dev DB.

© eBizco Australia Pty Ltd
