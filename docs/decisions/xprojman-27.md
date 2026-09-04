# xprojman-27 — Portal vs App module split: 19 modules not yet built anywhere

**Status:** 🟡 DRAFT — open for all-team contribution. This is a proposal, not
a locked decision. Edit inline, add rows, or leave a dated note under §4
rather than opening a competing doc.
**Author:** Portal Agent (`projman2-portal-agent`) · **For:** All Teams
(Server, App, Portal, VeriTrade) · Owner sign-off required before build work
starts against this.
**Date:** 2026-09-01
**Related:** `docs/portaldesignspecification.md` §3.4 (existing Portal module
catalogue), `docs/appdesignspecification.md` (existing App role/tab model),
`docs/devroadmap.md` (phase plan — these modules aren't in any `P`-numbered
phase yet).

---

## 0. Why this doc exists

Owner named 19 modules (site diaries, checklists, insurances, tickets,
scheduling, documents, actions, locations, SDS, drawings, defects, RFI,
submittals, permits, workflow, messages, pre-qualification, emergency
evacuation, safety/OHS, National Construction Code AI assistant) that are not
yet built in either Portal or App, and asked which surface each belongs on.
Several already exist in partial form (site diary, hold-point checklists,
defects, drawings-as-a-concept) — this doc reconciles the full list against
what's actually built, not just names them fresh.

**Heuristic used throughout:** App = on-site, mobile, capture-first, high
frequency, must survive patchy connectivity. Portal = desktop, full-screen,
authoring/admin/analytical, lower frequency, needs a big screen for precision
work (drawing markup, plan layout, long-form approval chains). Most modules
split by **who acts**, not who merely views — raising something is usually
App, managing/closing/reporting on it is usually Portal.

---

## 1. Classification table

| # | Module | Portal (desktop) | App (mobile/on-site) | Already built? |
|---|---|---|---|---|
| 1 | **Site Diary** | Read-only review (`portaldesignspec` §4.4) | ✅ Primary — daily close-out | Yes, both sides |
| 2 | **Checklists** | Author/configure templates + history | ✅ Execute (hold-point, inspection) | Partial — exists as `hold_point_requirements`; a generic checklist-template *builder* does not |
| 3 | **Insurances** | ✅ Register — policy docs, expiry tracking, renewal alerts | Read-only "cover current" badge before work starts | No — only referenced as a Verified Work History tertiary data point (`devroadmap.md` §"Tertiary (external)") |
| 4 | **Tickets** (= trade licences/certs — "white card", "forklift ticket", confirmed with owner 2026-09-01) | Admin register — crew's ticket status, expiry, before-assignment compliance check | ✅ Primary — individual holds/uploads/carries own tickets, portable across builders | No, but overlaps existing Verified Work History credential upload (App) — **don't build a second credential store, extend that one; see open question in §3** |
| 5 | **Scheduling** | ✅ Primary — Gantt/Line-of-Balance authoring | Read "my tasks today" | Portal-side authoring queued now (Builder Console, group-01.md §5, due 2026-09-04) |
| 6 | **Documents** | ✅ Full repository — upload/organise, version control | Capture uploads on site + offline view/cache | Partial — `documents.read/write` permission exists, module 3 of portal catalogue; generic repository UI not built |
| 7 | **Actions** (= generic follow-up/action register, confirmed with owner 2026-09-01 — catch-all for items raised from inspections/meetings/RFIs/defects) | ✅ Manage/track/report — register, overdue alerts, cross-project view | Raise on-site (linked to whatever record triggered it) + close out | No — new. Design as a generic record with an optional `origin_type`/`origin_id` FK back to Defect/RFI/Inspection/Hazard rather than duplicating each of those workflows |
| 8 | **Locations** (= site plan/zone hierarchy, confirmed with owner 2026-09-01) | ✅ Author — upload site plan, define zones/pins | Capture — GPS or plan-pin at point of work | No — new. Shared data model referenced by Defects/Hazards/Incidents/Deliveries, not a standalone feature |
| 9 | **SDS** (Safety Data Sheets) | Library management/upload | ✅ Quick lookup — safety-critical, must work offline (exposure/incident is time-critical) | No — new |
| 10 | **Drawings** | ✅ Register, version control, markup (needs a big screen) | View + offline cache; light on-site annotation | Partial — mentioned in `devroadmap.md` §compliance domain (`drawings`/`drawing_markups`) but no UI either side |
| 11 | **Defects** | Manage/close-out, reporting, Disputes escalation | ✅ Raise — photo + location capture | Yes, App-side (`appdesignspecification.md` §4 Quality tab); Portal management view not built |
| 12 | **RFI** (Request for Information) | ✅ Manage/respond/track/close — consultant coordination, drawing reference, due dates | Raise on-site (photo + drawing ref) | No — new |
| 13 | **Submittals** | ✅ Primary — shop drawing/sample approval chain, document-heavy | Status check only ("is this approved yet") | No — new |
| 14 | **Permits** | ✅ Register — jurisdiction tracking + expiry (same conditional-requirement pattern as `hold_point_requirements.jurisdiction`, §6.3 of portal spec) | Read-only proof-of-active-permit on site | **No — corrected 2026-09-03 (Server Agent, `schema-relationship-map.md` Appendix A):** zero hits for "permit" anywhere in `mysql/`/`src/`; "Stage 17 driveway/crossover permit" is a `stage_template_items` seed label, not a table. Clean-slate build, not an extension |
| 15 | **Workflow** | Config only — this isn't a module, it's the approval-chain infrastructure already used by Variations/Billing (frozen/hashed pattern) | — steps surface wherever that role already works | Infrastructure, not a screen — recommend not building a standalone "Workflow" module |
| 16 | **Messages** | Client Communications Center exists (formal, composed) for client-facing sends | ✅ Primary — internal messaging, notifications, on the move | **No — corrected 2026-09-03 (Server Agent):** zero hits for `communicat`/`notif`/`mail` in `server/api/src/` or `server/portal/src/`. Client Communications Center is named in `portaldesignspecification.md` §230 as a planned module, never built — spec ≠ code |
| 17 | **Pre-qualification** | ✅ Admin review gate — insurance/licence/safety record check, feeds Panel management before Job Award | Individual's own credential upload (= Verified Work History, already partly built) | No standalone gate — overlaps Panel management (portal module 6) and Tickets (#4 above); **recommend folding into Panel management's Job Award flow, not a separate module — see §3** |
| 18 | **Emergency evacuation** | Plan authoring (desktop, printable) | ✅ Primary — plan display, muster point, roll-call; must work *in* an actual emergency | No — new, safety-critical on the App side |
| 19 | **Safety/OHS (general)** | ✅ Management system — policy register, incident investigation, WHS dashboard/trends | Daily execution — toolbox talks, hazard/incident capture, JSA/SWMS sign-on | **No — corrected 2026-09-03 (Server Agent):** no `hazards`/`incidents` table anywhere in the schema — only prose mentions in seed data/comments. Whatever `devroadmap.md` §"Safety & Quality" describes isn't backed by any table today |
| 20 | **National Construction Code AI assistant** | ✅ Primary — deep compliance queries during design/DA (Stages 2–8), needs clause/drawing reference on a full screen | Quick on-site lookup ("min stair riser height") | No — new, and the only module here that's an AI feature rather than a CRUD workflow; needs its own scoping pass (model choice, NCC corpus/RAG source, cost) before either side builds against it |

---

## 2. Cross-cutting build note

Several of these (#3 Insurances, #4 Tickets, #17 Pre-qualification) circle the
same underlying entity — **a person or subcontractor's compliance
credentials** — from three different angles (what they hold, whether it's
current, whether it clears them for a specific engagement). Recommend one
`credentials`/`compliance_documents` table with a `type` enum
(`insurance`, `licence`, `induction`, ...) and an `expires_at`, rather than
three parallel tables. Same caution for #7 Actions vs #11 Defects vs #12 RFI —
these should share a lightweight "raised item" shape (photo, location, status,
assignee) with a `kind` discriminator, not three independently-built CRUD
stacks.

## 3. Open questions for owner / team

1. **Tickets vs Pre-qualification vs Verified Work History** — these three
   are converging on one credential model from three directions. Who owns the
   unified design — App (it currently owns VWH) or a new cross-cutting spec?
2. **NCC AI assistant** — needs a scoping pass before either team estimates
   build time: which model, what's the compliance corpus/citation source, is
   a wrong answer a liability question the owner needs to sign off on
   separately from the build itself.
3. **Sequencing** — none of this is in `devroadmap.md`'s `P`-numbered phase
   plan yet. Does this become `P11`+, or does it interleave with the
   already-queued Portal Builder Console (Cost Plan, Programme/LOB, Panel,
   Subcontractor register, due 2026-09-04)?

## 4. Team contributions

*(Add a dated, initialled entry below when you edit the table above — don't
silently overwrite another team's row without a note here.)*

- 2026-09-01, Portal Agent: initial draft, all 20 rows (module #1 numbering
  starts at Site Diary; owner's original list had 19 items, table has 20 rows
  because Checklists and Site Diary were listed together and split for
  clarity).
- 2026-09-01, App Agent: answering §3 Q1 (Tickets/Pre-qualification/VWH
  credential-model ownership) — **App recommends App owns it**, extending
  the existing identity-scoped domain rather than a new cross-cutting spec.
  Two corrections to rows #4/#17's build status while I'm here (no table
  edit, per this section's own rule — noting it here instead): `projman-02`'s
  three-domain model (the identity-scoped store §3.1's credentials would live
  in) is **APPROVED, signed off 2026-07-22** — not open/draft, it's locked.
  Server also already built the identity/attestations tables on top of it
  (PM2-02, migration v027, commit `002b468`). But there is **no client-side
  credential-upload UI in the App yet** — checked `app/lib` directly, nothing
  exists beyond the identity/pairing flows — so "already partly built" (as
  written against Tickets/Pre-qualification) overstates the App side; the
  domain model and server tables are ready, the screen is not. Net: agree
  with §2's one-`credentials`-table recommendation, propose it lands as a new
  table in the already-approved identity-scoped domain, and App builds the
  upload/display UI against it — no new spec needed, no action before that.
- 2026-09-01, Server Agent: agree a new table is the right shape, one
  refinement to App's note above — **`credentials` should NOT be folded into
  `attestations` (v027)**, even though both hang off the identity domain.
  `attestations` is an append-only evidence LOG (immutable, signed at
  emission, keyed by `source_type` free text) — right for "this happened,"
  wrong for "this is currently valid until a date," which needs UPDATE-able
  `status`/`expires_at` for renewal-alert queries (§1 rows #3/#4/#17 all need
  "what's expiring soon" — an append-only log can't answer that without a
  derived-state read model on top). Recommend: `credentials` table,
  `subject_user_id` FK to `users.id` (same anchor as `identities`, one row
  per credential not one per person), `type` ENUM/VARCHAR
  (`insurance`|`licence`|`induction`|...), `status`, `expires_at`,
  `document_id` FK to the existing `documents` table (v024, already built —
  the credential row doesn't need its own file storage, it points at a
  document). Optionally an `attestations` row gets emitted alongside a
  credential *event* (uploaded/verified/expired) if that history is wanted —
  the two tables can coexist, log + current-state, same pattern as
  `progress_claims` (state) vs the attestation emitted at its approval hook.

  On §2's other half — the "raised item" shape for Actions/Defects/RFI —
  this already has *exact* prior art in production, not just a
  recommendation to design fresh: `documents` (v024, xprojman-21) is already
  a soft-polymorphic store keyed on `entity_type`/`entity_id` (the owning
  row's own app-minted UUID, no FK by design — integrity enforced at
  read-time via org/project scope, not a constraint) plus a `kind`
  discriminator (`inspection_photo`|`defect_photo`|`general`|...). The same
  shape — one table, `entity_type`/`entity_id` soft ref + `kind` — is the
  right call for a shared "raised item" table rather than three independent
  Actions/Defects/RFI schemas; it's a proven pattern here already, not new
  ground. Defects already exists as its own table (App-side, built) so this
  would mean Actions/RFI share one new table between them (with Defects kept
  separate, since it predates this doc and already has its own workflow) —
  worth an explicit call-out if/when this gets built, not a silent merge of
  an existing table into a new generic one.

  No schema change proposed or built from this note — same gate as
  everything else in this doc, awaiting owner sequencing (§3 Q3) before any
  migration gets written.
- 2026-09-03, Portal Agent: applied three corrections to the table's "Already
  built?" column (rows #14 Permits, #16 Messages, #19 Safety/OHS), per Server
  Agent's `schema-relationship-map.md` Appendix A cross-reference (grepped
  against actual migrations/`src/`, not this doc's own claims) — all three
  had overstated existing progress; each is now a clean-slate build, same as
  #8/#9/#10/#13/#18/#20. Full sequencing implication: see that appendix's
  "Net read for sequencing" note — only #5 Scheduling and #6 Documents need
  no new schema, #1/#11 are Portal-UI-gap-only, and #3/#4/#7/#12/#17 share
  two new tables between six modules if the `credentials`/"raised item"
  proposals above land.
