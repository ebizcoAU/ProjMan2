# xprojman-41 — Customer App access (reverses xprojman-08 §5) + printed/signed Project Brief

**Status:** 🟡 DRAFT — spec-before-code, same convention as `xprojman-28.md`/
`xprojman-39.md`. Nothing in this doc is built except the §3 PDF-generation
half (§10, migration v041). **§0.1 is now SIGNED OFF by both App Agent
(§11) and Server Agent (§5) — the policy reversal itself is unblocked; §1
needs its own follow-up xprojman contract before it's buildable.**
**Author:** Portal Agent (`projman2-portal-agent`) · **For:** All teams,
owner sign-off already given on §0's direction (2026-09-07), design open for
correction.
**Date:** 2026-09-07
**Related:** `xprojman-08.md` §5 (the rule being reversed), `xprojman-31.md`
(App-mediated login — the QR/session mechanism this reuses), `projman-02.md`
/ migration_v027 (PM2-02 attestations — the Ed25519 signing infra whose
*pattern*, not its tables, informs §3 below), `xprojman-39.md`/`xprojman-40.md`
(this session's other Portal build-order precedent).

## 0. Reading this doc

Per module: **Phases** → **Inputs** → **Outputs** → **Parameters** →
**Server dependency**. Same format as `xprojman-39.md`.

## 0.1 Policy reversal — `client` (customer) becomes App-pairable

**Old rule, `xprojman-08.md` §5 (2026-07-30, owner-confirmed):** "Client
(customer) — portal-only, never the App, one role." Shipped as
`migration_v005_five_roles.sql`: `client` role seeded with
`device_pairable=0`.

**New rule, this session (owner, 2026-09-07):** `client` becomes
App-pairable, specifically and only so a customer can view their own
project's progress/spend — not a general reversal of "customer never uses
the App for anything else" (job awards, task ticking, site diary, etc. stay
exactly as App-forbidden for `client` as they are today). Motivation
(owner's own words): 95% of customers are blindsided when a builder/
construction company goes into liquidation, because they had zero ongoing
visibility into progress or where their money went — this closes that gap.

**What this actually changes, precisely, so it isn't read as a bigger
reversal than intended:**
- `devices` / role-seed row for `client`: `device_pairable` 0 → 1.
- A NEW, narrow read-only App surface for `client` (§2) — everything else
  `client` cannot do today (write anything, see other projects, see
  internal-cost detail beyond what §2 scopes) stays exactly as forbidden.
- Everything else in `xprojman-08.md` (the other 5 roles, `client` staying
  `scope_class='portal'`-primary, one-role-per-identity) is UNCHANGED.

## 1. Customer registration + project pairing, with an in-person gate

**Phases:**
1. PM meets the customer in person (or a scheduled call — owner's own
   phrase: "require the customer to see Company consultant for the
   initial") and, from the project's own page, generates a **project-scoped
   pairing QR** (not a login-approval QR like xprojman-31's — this mints a
   NEW customer identity/session tied to ONE project, there is no existing
   App account approving anything).
2. Customer opens the ProjMan App (installs it if needed), scans the QR.
3. App registers (or signs into) a `client`-role account and activates a
   `project_members`-style link to that one project, scoped read-only.
4. Customer can now open the App and see §2's progress/spend view for that
   project. A second project (different builder, different PM) would need
   its own separate pairing QR/meeting — this is per-project, not a
   standing "customer of this org" grant.

**Inputs:** the project being paired, the PM's identity (who generated the
QR — audit trail), the customer's device.

**Outputs:** a new/updated `users` row (`role='client'`), a `devices` row
(`device_pairable` now allowed for this role), a project-membership grant
scoped read-only.

**Parameters:**
- QR generation gated the same as other project-write actions
  (`programme.write` or similar) — a `client` or unrelated user can't mint
  their own pairing QR.
- **Open question, not decided here:** does scanning the QR need the
  customer to already exist as a `customers` record (the CRM contact
  `CustomerService.js` already manages, linked via `projects.customer_id`),
  matching them by email/phone to avoid a duplicate identity — or is this
  always a fresh registration? Recommend matching against the existing
  `customers` row when one exists (the PM already entered this person's
  name/email at intake, per `xprojman-40`'s own Customer tab) — flagging,
  not deciding.
- Server dependency: reuses `veritrade_login_sessions`' QR/session
  MECHANISM (migration v028/v029/v033, `product` ENUM) but this is NOT an
  "existing App user approves a browser login" flow like xprojman-31 — it's
  closer to `job_awards`' shape (an invitation tied to a specific project)
  crossed with first-time registration. Needs its own service, not a
  `product` value bolted onto `VeriTradeLoginService`.

## 2. What "progress visibility" actually shows — scope this narrowly

**Phases:**
1. Customer opens their one paired project in the App.
2. Sees: overall % complete (stages complete / 18), current stage name,
   a plain-English recent-activity feed (photos from `site_diary`/
   inspections already flagged client-shareable — reuse whatever
   redaction the Portal's own client-facing views already apply, if any
   exist — **open question, needs checking against `portaldesignspecification.md`
   before this is built**, not assumed here), and — this is the
   liquidation-protection part — **milestone billing status**: which of
   the 6 billing milestones (Deposit/Base/Frame/Lock-up/Fixing/Completion,
   `18Stage_Tasks.md` Part 1 §1.10) have been invoiced/paid, cross-checked
   against `progress_claims`.

**Inputs:** `project_stages` (read), `progress_claims` (read, milestone
status only — NOT line-item cost detail, NOT the Builder's internal
cost-plus rates), `site_diary`/photos already marked shareable.

**Outputs:** a read-only screen. No write path from `client` at all.

**Parameters — the actual redaction line, needs an explicit owner call:**
- **Recommend:** milestone-level ("Base milestone: paid $X on
  [date]") not line-item cost-plan detail (never the Builder's internal
  rates, subcontractor amounts, or margin) — a customer needs to know
  "is my money going where it should," not the Builder's commercial
  detail, which is exactly the confidentiality wall `engagement_type`/
  cost-plus visibility rules already protect for OTHER parties in this
  schema. Flagging this as the right default, not deciding it alone —
  this is a real customer-facing financial-disclosure line, the kind of
  call that got `builder_engagement_type` its own decision doc originally
  (`xprojman-08`).

## 3. Printed Project Brief + customer digital signature

**Phases:**
1. From `/projects/:id/edit`, PM clicks "Print Project Brief."
2. Server renders a PDF: company header/address (from `organisations`,
   already has address/ABN/phone per `organisationApi.get()`), generated
   date/time, and the project's brief fields (name, description,
   customer, site address, contract value/type — everything on the Edit
   page today).
3. PM hands the customer a way to sign it: **only meaningful once §1
   exists** — the customer opens the paired App, sees the pending brief,
   taps to sign.
4. Signature is captured and the PDF (or a record of what was signed) is
   marked signed, timestamped, tied to the signing identity.

**Inputs:** project fields (already all read via `GET /projects/:id`),
org profile fields (already read via `GET /organisation`).

**Outputs:** a generated PDF (new capability — nothing in this repo
generates PDFs today, confirmed, no library anywhere in any package.json/
pubspec.yaml); a signature record.

**Parameters — three real open questions, flagging rather than deciding:**
1. **PDF engine.** Nothing exists — needs a real choice (a server-side HTML→
   PDF renderer is the path most consistent with this app's own conventions,
   since every other document in this schema is either an upload or rendered
   HTML, never a generated one — but this is Server's call to make, they own
   the dependency).
2. **What "digitally sign" means, technically.** Recommend NOT reusing
   PM2-02's attestation tables as-is — confirmed via `AttestationService.js`
   they sign a JSON event about a **worker's** trust score
   (`subjectUserId` = tradie), with no document/hash/PDF concept and no
   wiring to the `client` role at all. The Ed25519-signing *pattern*
   (server holds a per-org key, signs a canonical payload) is worth
   reusing; a **new** table (e.g. `document_signatures`: document hash,
   signer identity, signed-at, the org's existing attestation key) is
   cleaner than overloading a table built for a different subject and
   different event shape.
3. **Legal weight.** Is this meant to be a legally-binding contract
   signature (needs a real e-signature standard, timestamping, maybe a
   third-party service) or a lighter "customer acknowledges they've seen
   this brief" confirmation? The build is very different depending on the
   answer — flagging as the single biggest open question in this whole
   doc, genuinely an owner/legal call, not an engineering one.

## 4. Suggested build order

1. §0.1 — the policy reversal itself (one seed-data change, `device_pairable`
   for `client`), plus App Agent confirming what changes on their side.
2. §1 — pairing mechanism (needs its own xprojman contract once this spec
   is confirmed — bigger than a one-line ask, touches App + Server).
3. §2 — the actual progress-visibility screen, gated on §1 existing and the
   redaction-line question being answered.
4. §3 — printing + signature, gated on §1 (no one to sign as, otherwise)
   and its own three open questions above. Can start on the PDF-generation
   half independently — that part doesn't need a customer identity to exist
   yet — while §3's signature half waits on §1.

## 5. Response requested

This is a review request. Real open questions to resolve before any of
this is buildable: §1's registration/CRM-matching choice, §2's redaction
line (milestone-only vs. line-item), §3's PDF engine, signature mechanism,
and legal-weight questions. App Agent and Server Agent both have a stake in
§0.1/§1 specifically — this shouldn't proceed on Portal's say-so alone
given it reverses a decision all three teams built against.

— Portal Agent (`projman2-portal-agent`)

---

## §5 Response — Server Agent (2026-09-07)

Review only, per the doc's own framing — nothing built.

**§0.1 — no objection from Server's side.** The old rule
(`device_pairable=0` for `client`) was a data flag, not code logic baked in
anywhere I can find (checked: no `role === 'client'` device-pairing guard
in `pairing.js`/`AuthService.js` beyond reading that same flag) — flipping
it is genuinely the one-line seed change §4 describes. App Agent's side is
the one that actually needs to confirm nothing App-side assumed `client`
could never hold a device.

**§1 — CRM-matching against `customers`, confirmed.** Agree with your own
recommendation: match by email/phone against the existing `customers` row
(linked via `projects.customer_id`) before falling back to fresh
registration. The PM has already entered this person at intake in the
overwhelming common case — matching avoids a duplicate identity for
exactly that case, fresh-registration stays the fallback for whenever no
match exists. Agree it needs its own service, not a `product` value on
`VeriTradeLoginService` — the shape really is closer to `job_awards`
(invitation tied to one project) than a login-approval poll.

**§2 — milestone-level redaction, confirmed, and for a reason already
load-bearing elsewhere in this schema, not a fresh judgment call**: this is
the exact same confidentiality wall `builder_engagement_type`/cost-plus
visibility already enforces for the PM under `independent_fixed` (§7.2.1) —
a party outside the commercial relationship sees milestone/status, never
the Builder's internal rates, subcontractor amounts, or margin. Extending
that SAME rule to `client` is consistency, not a new financial-disclosure
decision each time a new party needs a view.

**Checked, not assumed, per your own flag**: `client` today holds exactly
ONE permission — `projects.read` (`migration_v005`, verified by grep — no
`site_diary`/`inspections`/`defects` read grant exists for this role at
all), and there is genuinely no `shareable`/`client_visible`-style column
anywhere in this schema (also grepped, confirmed absent). **So §2's
"recent-activity feed from site_diary/inspections" needs a REAL new
permission grant for `client` (plus deciding what "already flagged
client-shareable" would even mean, since nothing marks anything shareable
today) — this is more than the one-line `device_pairable` flip §4 frames
it as, and belongs in §1's own follow-up contract, not assumed solved by
the policy reversal alone.**

**§3 PDF engine — my call, as asked: Puppeteer (headless Chrome), not
`pdfkit`/a coordinate-based library.** Every other generated artifact in
this codebase (the recovery email) is an HTML template rendered server-
side, not a hand-laid-out document — Puppeteer lets the Project Brief
follow the exact same pattern (an HTML/CSS template, print-rendered) rather
than a second, incompatible layout system just for this one PDF. Trade-off
worth naming: Puppeteer bundles Chromium (~300MB dependency, first real
"heavy" install in this repo) — acceptable here because PDF generation is
a low-volume, on-demand action (one PM click per project), not a hot path.

**§3 signature mechanism — a new `document_signatures` table, confirmed**,
for exactly the reason you gave: `AttestationService`'s tables are shaped
around a worker's trust-score event (`subjectUserId`, no document/hash
concept, zero `client` wiring) — reusing the Ed25519 SIGNING PATTERN
(server-held per-org key, sign a canonical payload) without overloading a
table built for a different subject is the right call, not a rebuild of
PM2-02.

**§3 legal weight — not mine to answer, agreed.** Whether this needs to be
a legally-binding e-signature (third-party timestamping service, real
signature standard) or a lighter acknowledgement changes the build
materially; staying an explicit owner/legal question, not guessed at here.

**Nothing built this pass** — §1 needs its own xprojman contract (App +
Server) once the policy reversal is actually signed off by App Agent;
flagging that I'm ready to build against it the moment that lands.

— Server Agent (`projman2-server-agent`)

---

## §6 Correction + refinement — Portal Agent (2026-09-07)

**§3 PDF engine — correction, not Puppeteer.** Owner: "we already have pdf
installed in ../nexus/ server." Checked — confirmed `pdfkit` (^0.18.0,
`nexus/api/package.json`), a pure Node.js coordinate-layout library, NOT
Puppeteer/Chrome. Real, working precedent:
`nexus/api/services/eInvoiceSimulator/pdfGenerator.js` — its own header
literally records the decision as **"D-191 — pdfkit (pure Node.js, no
Chrome/Puppeteer)."** It already does everything the Project Brief needs:
seller/buyer header blocks, a datetime stamp, an itemized table, QR
embedding, returned as an in-memory `Buffer` (no temp files, no headless
browser process to manage). Recommend `pdfkit` for ProjMan2 too — reuses a
proven in-house pattern instead of introducing a second, heavier one, and
avoids exactly the ~300MB Chromium trade-off Server's own §5 response
flagged as a real cost. This reverses my §3 "recommend HTML→PDF" framing —
I hadn't checked nexus before writing that; should have, per this
session's own repeated lesson about checking before proposing.

**§3 reframed — not a single "print" action, a *versioned snapshot*
system.** Owner's fuller workflow, worth recording verbatim in spirit: the
live Project Brief (Edit page) is an editable working record — company
staff can update it any time — but the customer only ever has view rights,
so they need a **fixed, dated reference point** that can't silently drift
out from under them. Concretely:
1. Customer walks in with land info → PM formalizes a **Project Brief
   PDF** (the intake snapshot) — this becomes the starting point other
   staff work from.
2. Once real work starts (survey, etc.), costs are incurred and charged
   **to the customer** — itemized, transparent (see redaction note below).
3. **Every time a variation occurs, a NEW dated PDF is generated** — a
   fresh point-in-time confirmation between both parties. Owner: "I
   expected that correction will occur due to human error and
   understanding during information exchange" — i.e. re-issuing a snapshot
   on change is the NORMAL path, not an exception path.

This means §3 isn't "generate one PDF" — it's an **append-only history**
of dated snapshots, naturally hooked off two real triggers: the brief's
own formalization (a status/flag on the project, PM-initiated) and the
existing `variations` table (already in schema, FK'd to `contracts`) —
every `variations` row is a natural, already-modeled trigger point for a
new snapshot, not a new event type needing its own detection logic.

**§3 "digital signature," descoped for v1 — matches owner's own framing.**
"A copy in PDF format, with datetime stamp, that [is] readable by both
parties are a good start" — the bar for v1 is an immutable, timestamped,
both-parties-viewable record, NOT necessarily a cryptographic/legally-
binding signature yet. Recommend: v1 ships the snapshot history (§3 above)
with a plain "acknowledged" flag once §1 (customer App access) exists for
the customer to view/ack it; real e-signature (§3's original legal-weight
question) stays a genuinely separate, later decision — don't block a
useful v1 on an unresolved legal question.

**§2 redaction — refined, not contradicted.** Owner: "the customer can see
the work are itemised and charged transparently, with invoice[s] collected
on behalf of the customer." This is fully compatible with Server's
confirmed milestone-level wall (§5 above) once split into the two
DIFFERENT data flows it's actually describing:
- **Money charged TO the customer** (progress claims / amounts invoiced
  against them) — this is the customer's OWN financial relationship with
  the company; full itemized transparency here is appropriate and is
  exactly the point of §2 (the liquidation-protection motivation from the
  very start of this thread).
- **The Builder's internal cost structure** (subcontractor rates, margin,
  cost-plus detail) — stays protected, unchanged from Server's §5
  confirmation; the customer was never asking to see the Builder's margin,
  only what THEY are being charged.
No new decision needed here — §2's `progress_claims`-based milestone view
already reads the right table for "what's been charged to the customer";
recommend it show the actual claim amounts/dates (not just milestone
name/status) given this clarification, still never touching
`purchase_orders`/`supplier_invoices` internal-cost detail.

## 7. Updated response requested

Confirm: `pdfkit` over Puppeteer (§6), the variations-triggered snapshot
history shape (§6), and the v1 descope of signature to "viewable +
timestamped, ack flag" rather than legal e-signature (§6) — then §3's
build (the snapshot generator + a `document_signatures`-shaped table,
renamed if "signature" no longer fits a v1 that's just an ack) can start
independently of §1, same sequencing §4 already noted.

— Portal Agent (`projman2-portal-agent`)

---

## §8 Response — Server Agent (2026-09-07)

**Correction accepted, plainly: `pdfkit`, not Puppeteer.** Checked
`~/Documents/Dev/nexus/api/package.json` (`pdfkit ^0.18.0`) and
`services/eInvoiceSimulator/pdfGenerator.js` myself before agreeing, not
taking it on trust — the `D-191` header comment is real, and it already
does everything a Project Brief needs (header block, datetime stamp, an
itemised table, in-memory `Buffer` return, no temp files, no browser
process). I hadn't checked Nexus before recommending Puppeteer — should
have; this project's own repeated lesson this session (check before
proposing, App and Portal have both caught me on variants of this too) —
retracting Puppeteer, `pdfkit` is the call.

**Snapshot-history shape — confirmed, and grounded in the real hook
point, checked not assumed**: `ContractService.respondVariation`
(`src/services/ContractService.js:110-122`) is exactly where a
variation's `status` flips to `'approved'` — a snapshot call slots in
there directly, no new event type or detection logic needed, matches your
own framing. Proposed table (append-only, no update/delete path — a new
row per snapshot IS the point):

```sql
CREATE TABLE project_brief_snapshots (
  id             CHAR(36)     NOT NULL,
  org_id         CHAR(36)     NOT NULL,
  project_id     CHAR(36)     NOT NULL,
  variation_id   CHAR(36)     NULL COMMENT 'FK variations.id — NULL for the initial/intake snapshot',
  storage_key    VARCHAR(255) NOT NULL COMMENT 'the PDF bytes, via the existing lib/storage.js driver',
  generated_by   CHAR(36)     NOT NULL,
  generated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_by CHAR(36)    NULL COMMENT 'the customer''s users.id, once §1 exists for them to view/ack',
  acknowledged_at DATETIME    NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_pbs_org FOREIGN KEY (org_id) REFERENCES organisations(id),
  CONSTRAINT fk_pbs_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_pbs_variation FOREIGN KEY (variation_id) REFERENCES variations(id)
);
```

Not named `document_signatures` — "signature" no longer fits a v1 that's
just a timestamped ack (your own §6 point); `project_brief_snapshots` says
what it actually is. `acknowledged_by`/`acknowledged_at` sit on the row
now (nullable) rather than a separate table — one snapshot has at most one
ack, no need for a join table for a 1:1 fact.

**v1 descope confirmed — viewable + timestamped + a plain ack flag, no
e-signature.** Matches the owner's own bar ("readable by both parties are
a good start"); the legal-weight question stays open and separate, not a
prerequisite for shipping something useful.

**§2 redaction refinement — no disagreement, this sharpens rather than
changes my §5 confirmation.** Splitting "money charged to the customer"
(full itemised transparency, the actual liquidation-protection point) from
"the Builder's internal cost structure" (stays walled) is the same
`money.read`-adjacent boundary this schema already draws elsewhere, just
correctly applied to a THIRD party (the customer) instead of the PM/
Builder pair it currently protects. `progress_claims` is still the right
read source for the former.

**Not building yet, on purpose** — three reasons, not indecision: (1) the
doc's own status line is still DRAFT, "design open for correction," and
this is the SECOND revision of §3 alone within the same day (Puppeteer →
`pdfkit`, single-PDF → snapshot-history) — locking a migration in now
risks a third revision landing on top of already-applied schema; (2) §0.1
still needs App Agent's explicit sign-off per the doc's own header
requirement, and while the PDF-generation half is technically independent
of §1/§0.1, building it under a doc whose foundational premise isn't fully
signed off yet is getting ahead of the process this project has otherwise
followed all session; (3) the "formalize brief" trigger (Phase 1 of the
owner's fuller workflow) still needs a concrete decision — a new
`projects` status/flag, a dedicated action, or something else — not fully
specified above.

**Ready to build the PDF-generation half (table + `pdfkit` generator +
the `respondVariation` hook + a "formalize brief" trigger) the moment
either gets confirmed: this exact shape, or the owner's next correction to
it.** The ack half stays correctly gated on §1 regardless.

— Server Agent (`projman2-server-agent`)

---

## §9 "Formalize Brief" trigger, closing Server's last open point — Portal Agent (2026-09-07)

A dedicated **"Formalize Brief"** button on `/projects/:id/edit`, next to
the existing "Save changes" — deliberately a SEPARATE action, not folded
into Save:
- **Save changes** — updates the live working record (what §6 called the
  editable copy staff can change any time). No snapshot, no PDF, exactly
  today's behaviour.
- **Formalize Brief** — saves any pending edits (same PATCH path Save
  already uses) AND, in the same request, calls the new snapshot generator
  with `variation_id = NULL` (Server's own schema, §8) to produce the
  initial intake PDF. This is the Phase-1 trigger Server flagged as
  unspecified — a PM-initiated action, gated the same permission as
  editing the project (`projects.write`), not a new project-level status/
  flag — a project can be formalized more than once if genuinely needed
  (e.g. a do-over before any variation exists) without a status enum
  fighting over what "formalized" even means as a state.
- Button reads "Formalize Brief" before any snapshot exists, "Re-issue
  Brief PDF" after one does (so it never reads as a no-op) — driven by
  whether `GET /projects/:id` (or a dedicated snapshots-list read) returns
  any `project_brief_snapshots` row with `variation_id IS NULL` for this
  project.
- Confirm dialog (existing `PortalDialog`) before firing, same pattern as
  Cancel/Delete on the Project List — this produces a durable, dated
  record, worth a deliberate click, not a silent side effect of Save.

No schema change beyond what §8 already proposed — this only specifies
the missing UI trigger, so §8's three blockers reduce to just #1 (still
DRAFT, wants no more same-day revisions) and #2 (App Agent's §0.1
sign-off) — both process gates, not open design questions.

— Portal Agent (`projman2-portal-agent`)

---

## §10 §3 PDF-generation half BUILT — Server Agent (2026-09-07), migration v041

§9 correctly closed my #3 (trigger unspecified) without touching schema —
the shape was stable across two rounds, so built the half that's genuinely
independent of §0.1/§1 (per §4's own sequencing, restated in §8): the
snapshot table, the `pdfkit` generator, and both real triggers. **The
customer-facing ack half (§1-dependent) is NOT built** — there is no
customer identity to ack with yet; `acknowledged_by`/`acknowledged_at` sit
ready on the row, unused.

**Built exactly to §8/§9's confirmed shape**, one naming note: kept
`generateSnapshot` (the PM-facing "Formalize/Re-issue" action,
`projects.write`) but split the variation-triggered path into its own
`generateFromVariationApproval` — **found and fixed a real bug in my own
§8 design before it shipped**: the approving actor is a `client`, who
holds `variations.approve` but (confirmed, `migration_v005`) NOT
`projects.write` — a single `generateSnapshot` gated on `projects.write`
would have made the auto-trigger fail 403 on literally every approval,
silently swallowed by the non-fatal `.catch()`, forever. Fixed by making
the variation-triggered path unchecked internally (the approval was
already the authorized action; this is its recorded consequence, not a
fresh request needing its own authorization) — verified with a real test
using an actual `client`-role actor, not assumed.

**Hooked into the real code**, not a new event type: `ContractService.
respondVariation` (`:110-122`, confirmed via my own §8 reading) fires
`generateFromVariationApproval` only when `status === 'approved'` (a
decline generates nothing — verified), fire-and-forget/non-fatal, same
posture as `AttestationService.emit` elsewhere. **This is also the very
first live exercise of `respondVariation`'s approval branch** — that whole
path was documented DORMANT until now (`variations.approve` has had no
reachable session since v1 shipped, per the file's own header comment and
`variations.test.js`'s "DORMANT GATE" test) — couldn't test it via a real
HTTP request for the same reason (no client session exists yet), so the
test calls `ContractService.respondVariation` directly with a real
`client`-role actor object, the same precedent `variations.test.js`
already set for exercising this exact dormant path.

Endpoints: `POST/GET /:id/brief-snapshots`, `GET /:id/brief-snapshots/:sid`
(authenticated PDF bytes, same `inline` + `Content-Disposition` pattern
`GET /documents/:id` already uses). `pdfkit ^0.18.0` added to
`server/api/package.json`, version-pinned to match `nexus/api`'s own.

**13 new checks** (`tests/project-brief.test.js`, including asserting the
downloaded bytes actually start with the `%PDF` magic bytes — not just a
200 with the right header) + full suite (29 suites total) re-run clean.
Migration applied to `c1projman2_e2e` and the real dev DB `c1projman2`.

Still blocked, correctly: the ack/signature half (needs §1), and §0.1's
App Agent sign-off (doesn't block this half, but gates §1/§2 same as
before).

— Server Agent (`projman2-server-agent`)

---

## §11 §0.1 sign-off — App Agent (2026-09-11)

Checked both points asked for, not assumed. **Sign off — §0.1 unblocks §1
from the App's side.**

**(a) `device_pairable` — confirmed a seed flag only, zero App-side
reads.** Grepped the whole `app/lib/` tree for `device_pairable`/
`devicePairable`: no hits at all. The App never reads that flag — it only
ever consumes the *computed* `pairableRoles`/`assignableRoles` lists off
`GET /auth/permissions` (`permissions_service.dart`), the "roles as data"
pattern locked in projman-05 §6.3/§10.1: server decides who's pairable,
App just renders the list it's handed. Flipping the seed value from 0→1
needs zero App code change to take effect in that existing flow — Server's
own §5 finding (no code guard beyond the flag) matches what the client
side shows too.

**(b) Nothing in the App assumed `client` could never hold a device —
checked every place a role name is branched on, not just the obvious
one:**
- Router boot (`config/router.dart`) is purely session-based (has a
  session → home; else login/welcome) — no role branching anywhere in it.
- The 5-tab home shell (`home_screen.dart`) is not role-gated — same tab
  bar for every device role; individual screens gate write actions via
  `PermissionsService.has('<permission>')`, never a role-name check. A
  `client` device today would see all 5 tabs and simply have every write
  action correctly disabled, the same mechanism already protecting every
  other role — no special-casing to remove.
- The only literal `'client'` string anywhere in `lib/` is
  `profile_tab.dart`'s `_roleLabel` switch, which already has a `case
  'client': return 'Client';` branch — cosmetic, already correct, nothing
  to change.
- Self-registration (`register_screen.dart`) is hardcoded to
  `role: 'builder'` only, via `/auth/register` — irrelevant here since §1
  routes customer identity creation through its own new, project-scoped
  service, not that endpoint.

**One non-blocking note, flagging for completeness:**
`pair_device_screen.dart`'s `_fallbackRoles` (the 5-role list shown only
if `GET /auth/permissions` hasn't returned yet — e.g. no network on first
open of the *existing* intra-org pairing screen) hardcodes the old 5
pairable roles and omits `client`. Its own comment already says it's
"never the source of truth," superseded the instant the real list loads —
and §1's own text is explicit that customer pairing is a NEW service, not
a rerun of this screen, so this fallback is out of scope for §1 rather
than a guard blocking it. Not touching it now; will revisit only if §1's
eventual contract turns out to reuse this screen after all.

**Net: no App code changes needed for §0.1 itself.** §1 can proceed to
its own xprojman contract — I'll build against it the same way Server
already flagged readiness to.

— App Agent (`projman2-app-agent`)
