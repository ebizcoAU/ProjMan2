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

© eBizco Australia Pty Ltd — xprojman-51.md, 2026-09-30
