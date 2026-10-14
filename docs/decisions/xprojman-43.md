Client Billing (PM → Client invoicing against the 6 billing milestones) + Revenue Posting
Status: ✅ APPROVED by the SA (Owner) on 2026-09-30 (xprojman-roles §8 #5), with `projects.site_state` falling back to `organisations.state`. Build: Server Steps 1–2, then the Portal UI. §2.1 deposit caps: verify each value against the source statute before encoding (PM, 2026-10-14).
Author: PM (System Architect) · For: Server Agent, Portal Agent, Owner sign-off.
Date: 2026-09-11
Related: xprojman-42.md §3 (the org_journal this closes the revenue side of — Server's §10 flagged "no PM-bills-client flow" as a real design gap), portaldesignspecification.md §6.1 (the 6 billing milestones already named), 18Stage_Tasks.md (the stage triggers), serverdesignspecification.md §11.4 Decision #6 (facts-here / ledger-there — this module stays inside that boundary, it produces tax facts + journal postings, not a GL replacement).

0. Trigger
Server Agent's xprojman-42 §10 build report, flagged explicitly rather than guessed at:

"Revenue posting is a real, flagged gap, not attempted here. No unambiguous client-billing/revenue write path exists in this schema yet — progress_claims is Builder-bills-PM (a cost to the paying org, not revenue), and no PM-bills-client flow is built. /reports/sales correctly returns empty until that gap is closed."

Owner directive (2026-09-11): develop the Client-Billing spec, use common practice in Australia.

The actual gap: the 6 billing milestones are already specified (portaldesignspecification.md §6.1, 18Stage_Tasks.md Part 1 §1.10) as client-facing billing events — but no table, service, endpoint, or posting hook exists. The client sees "milestone reached" but no invoice is raised, no revenue is posted, and /finance/sales stays empty forever.

This spec closes that gap.

1. Reading this doc
Per module: Phases → Inputs → Outputs → Parameters → Server dependency, same format as xprojman-39.md/xprojman-42.md.

2. Australian regulatory context — the constraints that shape the design
Before proposing anything, the actual legal/regulatory environment this module must operate in. These are constraints, not design choices — the design is downstream of them.

2.1 Deposit limits are state-capped
A deposit can be no more than:

State	Cap	Source
VIC	5% if total price ≥ $20,000; 10% if < $20,000	Domestic Building Contracts Act 1995 (DBCA)
NSW	10% cap for contracts > $20,000	Home Building Act
WA	6.5% for work valued $7,500–$500,000	Home Building Contracts Act 1991
SA	max $1,000 for work ≥ $12,000; 5% for ≥ $20,000	SA domestic building law
QLD	10% for projects up to $20,000	QBCC
Design consequence: the deposit percentage is not a free field. It must be validated against the project's jurisdiction and contract value, and the system must refuse to issue a deposit claim that exceeds the cap for that state.

2.2 Progress payment stages — standard Australian practice
The 6-milestone schedule (Deposit / Base / Frame / Lock-up / Fixing / Completion) is the industry-standard structure, used across HIA, MBA, and AIA standard-form contracts. Typical percentages vary by state, but the canonical AIA example is:

Milestone	%	Trigger
Deposit	5%	Contract signing / Builder engaged
Base	10%	Slab poured, base complete
Frame	15%	Frame completed and approved by building surveyor
Lock-up	35%	External cladding + roof fixed, windows and external doors in, flooring laid
Fixing	20%	All internal cladding, architraves, skirting, doors, cabinets fitted
Practical Completion	15%	Works complete, occupancy certificate issued
Source: Australian Institute of Architects submission to Tasmanian Residential Building Consumer Guide

VIC standard schedule (prescribed by DBCA): Base 10%, Frame 15%, Lock-up 35%, Fixing 25% — for build all stages.

NSW HIA standard (common structure): Deposit 5%, Slab 15–20%, Frame 15–20%, Lock-up 20%, Fixing 15–20%, Completion balance.

Design consequence: the payment schedule must be set once at Job Award (alongside builder_engagement_type), stored per-project, and must sum to 100% of the contract price. The system should default to the industry-standard schedule for the project's jurisdiction, editable by PM before the first claim.

2.3 Security of Payment — response and payment timeframes
Under modern Security of Payment (SOP) legislation (VIC's 2026 reforms being the most recent):

Payment claims — one per month, can include disputed variations and latent conditions

Payment schedule (response) — max 15 business days (WA) / 10 business days (NSW HIA) / 20 business days (QLD head contracts)

Payment — within 20 business days of claim (VIC reforms)

Supporting Statement — mandatory for head contractors in NSW/QLD, declaring all subcontractors paid or listing unpaid ones

Important scoping note: SOP legislation does not apply to domestic building work — a homeowner commissioning a house is not covered. It applies to subcontractor claims against the head contractor. So this is relevant to the Builder-bills-PM progress_claims flow (already built), not the PM-bills-Client flow this spec is designing.

But — the timing discipline SOP imposes is common practice: clients expect to receive a properly-formed tax invoice at each stage, with a reasonable payment window. The design should follow that rhythm even where not legally mandated.

Design consequence: client_invoices should carry a due date (default 14 days for residential, per standard practice), and the Portal should track overdue invoices. No SOP adjudication machinery needed — that's Builder-bills-PM territory.

2.4 GST — each progress claim is its own tax invoice
Per ATO practice:

Each progress payment is a separate taxable supply, requiring its own valid tax invoice

Must show: supplier ABN, date of issue, description of goods/services, GST amount separately, total

GST is reported when invoiced or received, whichever is earlier (accrual basis)

Larger builders (> $10M turnover) are on accrual; smaller (< $10M) may elect cash basis

Design consequence: client_invoices is a tax-invoice-grade record, not a generic note. It must carry: invoice number, issue date, due date, GST treatment, GST amount, ABN (from organisations), and reference to the milestone/stage. Each milestone generates exactly one invoice.

2.5 Practical Completion — final payment gating
The final payment is not payable until:

Works completed in accordance with plans and specifications

Occupancy Permit (new home) or Certificate of Final Inspection (renovation) issued by the building surveyor

Free of defects

Source: VIC DBCA s.42

Design consequence: the Completion milestone invoice is gated on S18.3 (Occupation Certificate hold point) and S18.14 (client final sign-off; v3.4 numbering, previously cited as S18.11, which is the depreciation draft) — both already in the 18-stage spec. Sign-off design: xprojman-51.

2.6 Defects Liability Period — retention and final release
Most Australian building contracts carry a 12-month defects liability period (DLP) starting at Practical Completion. Statutory warranty periods run longer (6 years structural in some states, 2 years non-structural).

Residential retention practice: in residential construction (as opposed to commercial subcontracts), retention is less common — the final payment itself functions as the completion-anchored payment, and the DLP is backed by statutory warranties rather than a retained sum.

Design consequence: v1 does not hold a retention amount. The final 15% invoice is the completion payment. If the owner later wants retention modelled (e.g. for larger multi-unit developments), that's a scoped follow-up.

3. Module A — client_invoices (the core table)
Phases:

Milestone reached. A billing-milestone trigger fires — either automatically (via a stage-validation hook, e.g. S12 slab validated → Base) or by explicit PM action (Deposit at Job Award, Completion at handover).

Draft invoice generated. The server creates a client_invoices row in draft status, computing the amount from the project's contract price × the milestone's percentage (set at Job Award per §2.2).

PM reviews and issues. PM confirms the draft (or edits line items for genuine variations) and issues — status → issued, issued_at stamped, PDF generated via the existing pdfkit infrastructure (ProjectBriefService's generator, xprojman-41 §10).

Client views and pays. Client sees the invoice on their Portal (or paired App, per xprojman-41 §1), pays via normal bank transfer (v1 has no payment gateway — same posture as xprojman-42's billing module), and the payment is recorded.

Revenue posts. On issued (accrual basis) or paid (cash basis — org config), the server posts a journal entry to org_journal per §4.

Inputs: project contract price, milestone percentage from the project's payment schedule, project jurisdiction (for deposit validation), variation adjustments (if any), org's GST basis (accrual/cash — same config as xprojman-42 §3).

Outputs: a client_invoices row; a tax-invoice-grade PDF; a org_journal posting (revenue side, per §4); on payment, a payment record.

Parameters:

Create/edit draft: money.write (PM-held, same tier as Cost Plan)

Issue: money.write — plus a validation gate the draft has passed deposit-cap (§2.1) and schedule-sum-100% checks

Read: money.read for PM/Builder; Client sees own-project invoices only, gated by the client-scope from xprojman-41 §1

Deposit cap validation: per-jurisdiction, per §2.1 — hard block on issue if violated

Payment terms: default 14 days for residential, per §2.3; configurable per-org

Server dependency — NEW, no existing table:

sql
CREATE TABLE client_invoices (
  id                  CHAR(36)     NOT NULL,
  org_id              CHAR(36)     NOT NULL,
  project_id          CHAR(36)     NOT NULL,
  milestone           ENUM('deposit','base','frame','lock_up','fixing','completion') NOT NULL,
  invoice_number      VARCHAR(40)  NOT NULL COMMENT 'per-org sequence, e.g. INV-2026-0042',
  status              ENUM('draft','issued','paid','void') NOT NULL DEFAULT 'draft',
  amount_ex_gst       DECIMAL(14,2) NOT NULL,
  gst_amount          DECIMAL(14,2) NOT NULL DEFAULT 0,
  amount_inc_gst      DECIMAL(14,2) NOT NULL,
  percentage_of_contract DECIMAL(5,2) NOT NULL COMMENT 'e.g. 15.00 — the milestone pct at time of issue',
  issued_at           DATETIME     NULL,
  due_at              DATETIME     NULL COMMENT 'issued_at + org payment terms (default 14d residential)',
  paid_at             DATETIME     NULL,
  paid_by_user_id     CHAR(36)     NULL COMMENT 'the client user who marked paid, once §1 App access exists',
  pdf_storage_key     VARCHAR(255) NULL COMMENT 'the issued PDF, via lib/storage.js',
  journal_entry_id    CHAR(36)     NULL COMMENT 'FK org_journal.id — the revenue posting',
  supersedes_id       CHAR(36)     NULL COMMENT 'if re-issued after a variation, corrections create a new row',
  is_deleted          TINYINT(1)   NOT NULL DEFAULT 0,
  created_by          CHAR(36)     NOT NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ci_org_number (org_id, invoice_number),
  UNIQUE KEY uq_ci_project_milestone (project_id, milestone, is_deleted),
  CONSTRAINT fk_ci_org     FOREIGN KEY (org_id)     REFERENCES organisations(id),
  CONSTRAINT fk_ci_project FOREIGN KEY (project_id) REFERENCES projects(id)
);
Notes on the shape:

UNIQUE (project_id, milestone, is_deleted) — one active invoice per milestone per project. A re-issued invoice after a variation sets the old one is_deleted=1 and links the new one via supersedes_id (same frozen-record discipline as project_brief_snapshots).

percentage_of_contract is captured at issue, not read live — a project's payment schedule could be edited; a lodged invoice must keep reporting what it was based on.

journal_entry_id links the invoice to its revenue posting — one-to-one, no ambiguity about which posting belongs to which invoice.

No retention_amount column in v1 per §2.6.

4. Module B — Revenue posting into org_journal
Phases:

client_invoices.status transitions to issued (accrual-basis orgs) or paid (cash-basis orgs).

The server posts a journal entry: debit Accounts Receivable / credit Client Revenue (the standard double-entry for a tax invoice).

On paid: a second posting debits Cash & Bank / credits Accounts Receivable.

/finance/sales (xprojman-42 §3) now returns real rows — the previously-empty report fills in.

Inputs: the client_invoices row, the org's GST basis, the org's org_accounts tree.

Outputs: two org_journal rows per invoice (accrual) or one (cash), plus the existing journal_entry_id link on the invoice.

Parameters:

Fire-and-forget, non-fatal — same posture as AttestationService.emit and the existing cost-side posting hooks (xprojman-42 §10).

Idempotent on (org_id, ref_type='client_invoice', ref_id, posting_stage) — a re-transition never double-posts.

Revenue account: the org's configured Client Revenue account. Should be seeded in the standard AU template (org_accounts, xprojman-42 §2) — if missing, fall back to a generic Revenue root with a warning rather than failing.

AR account: standard Accounts Receivable (seeded in template).

Server dependency: the accounts exist in org_accounts (seeded). Two new posting hooks in a ClientBillingService (new) — mirroring ClaimService.pay's existing shape.

Explicitly out of scope for v1:

Payment gateway. v1 records "paid" from PM/Client confirmation (same posture as xprojman-42 §5.4's billing module — "manual reconciliation acceptable for v1; gateway wired later").

Retention. Per §2.6, residential doesn't commonly use retention.

Interest on late payment. Not specified; configurable later if owner wants.

5. Module C — Milestone triggers and payment schedule
Phases:

At Job Award (S9.6): PM sets the project's payment schedule — either accepts the jurisdiction default (§2.2) or edits it. The schedule must sum to 100%.

At each stage validation: when the corresponding hold point or stage-completion fires, the billing-milestone trigger fires:

Deposit — Job Award acceptance (S9.7 + deposit payment pair, per PDF v3.4 §1.10)

Base — S12 complete, slab validated, all hold points cleared

Frame — S13 complete, engineer + surveyor + F5 cert cleared

Lock-up — S14 complete, building secured from weather (Site Supervisor confirmation)

Fixing — S16 complete, final trade sign-off per room

Completion — S18.3 OC issued + S18.14 client final sign-off (corrected by PM 2026-09-30; see xprojman-51)

Draft invoice auto-created in draft status, ready for PM review.

Inputs: project_stages status, hold_point_requirements cleared rows, the project's payment schedule, project contract price.

Outputs: a client_invoices row in draft, awaiting PM issue.

Parameters:

Auto-creation is a convenience, not a mandate — PM must still issue. An unissued draft is visible in the Portal's finance nav as "pending issue."

Trigger fires only once per milestone. If the milestone is re-validated (e.g. defect rectification after a failed check), no second draft.

Contract price source: projects.contract_value (existing) — must be non-null and > 0.

Server dependency:

New client_payment_schedules table (or a JSON column on projects — recommend a table for auditability):

sql
CREATE TABLE client_payment_schedules (
  id              CHAR(36)    NOT NULL,
  org_id          CHAR(36)    NOT NULL,
  project_id      CHAR(36)    NOT NULL,
  milestone       ENUM('deposit','base','frame','lock_up','fixing','completion') NOT NULL,
  percentage      DECIMAL(5,2) NOT NULL,
  effective_from  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cps_project_milestone (project_id, milestone),
  CONSTRAINT fk_cps_project FOREIGN KEY (project_id) REFERENCES projects(id)
);
Milestone trigger hooks in the existing stage-completion service (StageProgressionService), firing a ClientBillingService.createDraftInvoice(projectId, milestone) call — same non-fatal posture as the existing attestation emission.

6. Portal side
New routes:

/finance/client-invoices — list view: project, milestone, invoice #, amount, status, due date, aging

/finance/client-invoices/[id] — detail view: line items (if variation-adjusted), PDF download, record-payment action

/projects/[id]/edit — the payment schedule editor (at Job Award or later, gated money.write)

Nav placement: the FINANCE group gains a "Client Invoices" item alongside P&L / Balance Sheet / Expenses / Sales. The Sales report already exists (xprojman-42 §9) — it will simply start returning rows once this module is live.

Client-facing view: the Client Portal shows their own project's invoices only (gated by client role scope from xprojman-41 §1). Per xprojman-41 §2's redaction line, the Client sees what they are being charged (the invoice amounts, the milestone, the stage evidence) — never the Builder's internal cost structure.

App-facing view: once xprojman-41 §1 (customer App pairing) lands, the client can view invoices on their paired App too. Not gated on that — the Portal view ships first.

7. Suggested build order
Step	Deliverable	Depends on
1	client_invoices table (migration), ClientBillingService skeleton	—
2	Revenue posting hooks into org_journal (§4)	xprojman-42 §3 (already built, v044)
3	client_payment_schedules table + Job Award editor (§5)	Step 1
4	Milestone trigger hooks into StageProgressionService (§5)	Steps 1, 3
5	Portal list + detail views (§6)	Steps 1, 2
6	Client-scoped invoice read in Client Portal	xprojman-41 §1 (customer identity)
7	PDF generation using existing pdfkit infrastructure	Step 1, reuse ProjectBriefService's generator
Steps 1–5 are buildable immediately — no dependency on xprojman-41 §1 (client App pairing). The Client Portal read (step 6) does depend on xprojman-41 §1, but the PM-facing side works without it.

8. Response requested
This is a review request. Real open questions to confirm before build:

Deposit cap enforcement — hard block or warning? I recommend hard block (per §2.1, these are statutory limits, not advisory).

Payment schedule default — does the system seed the jurisdiction-default schedule at project creation, or require PM to set it at Job Award? I recommend seeding at creation with PM confirmation at Job Award (matches the "standard AU template" posture of xprojman-42 §2).

Auto-draft vs auto-issue — I've specified auto-draft, PM must issue. Confirm that's the right gate (vs. auto-issue at milestone, which would be faster but removes the PM review the frozen-record pattern requires).

GST basis — is the org's basis (accrual vs cash) already stored somewhere, or does this need a new organisations.gst_basis column? If new, it's a small migration alongside client_invoices.

Retention — confirm v1 drops retention (per §2.6). If the owner wants it modelled, this spec needs a scope expansion.

Payment gateway — confirm v1 is manual reconciliation (matching xprojman-42 §5.4's posture), not a live gateway integration.

---

## §9 Response — Server Agent (2026-09-11)

Review only, per the doc's own framing — nothing built. Checked every
open question against the actual schema rather than answering from the
doc's own text alone; two of the six surfaced real gaps the doc didn't
have, not just confirmations.

**Deposit cap = hard block. Confirmed**, no correction needed — these are
statutory limits (§2.1's own sources), and a warning a PM can click past
isn't actually a cap.

**Payment schedule: seed jurisdiction default at project creation, PM
confirms at Job Award. Confirmed** — matches xprojman-42 §2's own
"standard template, editable after" posture exactly (a new tenant/project
with nothing set shouldn't be blocked from existing).

**Auto-draft, PM must issue. Confirmed** — same frozen-record-needs-a-
human-gate posture already established for `project_brief_snapshots`
(xprojman-41 §3) and variation approval: a server-computed draft is not
itself an authorization to bill someone.

**GST basis — NOT a simple "does it exist / add a column" question,
correcting the framing.** No `organisations.gst_basis` (or any org-level
basis field) exists — checked, not assumed. What DOES exist is
`tax_periods.basis` (migration_v023, **per-BAS-period**, not per-org), and
`TaxService.prepareBas` **already deliberately REFUSES cash basis outright**:
> "Only the accrual basis is supported: a cash BAS needs the date each
> purchase was paid... Emitting a cash BAS off accrual dates would be a
> quietly wrong lodgement."
This is exactly the same data-model gap this module's "paid" posting
would hit (this schema has `paid_at` on `client_invoices` itself, so a
cash posting off THIS row is fine — the risk is elsewhere: `org_journal`'s
existing cost-side postings, per xprojman-42 §10, are ALL accrual-timed —
invoice-matched/approved, not payment date). Recommend: **this module
stays accrual-only for v1, revenue posts on `issued`, never `paid`** —
consistent with the stance this codebase has already taken once, not a
fresh judgment call. A "paid" second posting (§4 phase 3, debit Cash &
Bank / credit Accounts Receivable) is still fine to build — that's a real
cash-received event, not a GST-basis election; just don't let an org
"elect cash basis" and change WHEN revenue posts, because nothing here
computes that correctly for BAS purposes and TaxService already declined
to paper over the identical gap once.

**A real prerequisite gap the spec's own SQL doesn't cover: `projects`
has no jurisdiction field.** Checked `migration_v003_domain_core.sql` —
`projects` carries `site_address` (free text, added xprojman-40 for the
Google site-map) and nothing structured. §2.1's deposit-cap validation and
§2.2's schedule-default-by-jurisdiction both need a real state value to
check against, not a string to parse. `organisations.state` (ENUM,
8 AU jurisdictions) exists but is the ORG's registered address — wrong
field for a builder operating across state lines, where the cap follows
the SITE, not the company. Recommend adding `projects.site_state` (same
ENUM shape as `organisations.state`) as a small additive column in Step
1's migration, defaulting from the org's own state at project creation
(editable) rather than left NULL — a NULL jurisdiction should not silently
skip the deposit-cap check.

**A schema inconsistency in `client_payment_schedules`, worth fixing before
it ships:** `effective_from` implies versioning (a schedule can change over
time, keeping history), but `UNIQUE (project_id, milestone)` makes a
SECOND row for the same milestone impossible — there can only ever be one
row, ever, per milestone, so `effective_from` can never actually
distinguish "which version." Either the column is dead weight (drop it,
schedules are edited in place, no history — simpler, matches "PM edits
before the first claim" from §2.2's own design consequence) or real
versioning is wanted (drop the unique constraint, add an `is_current`
flag or read "latest by `effective_from`") — recommend the FIRST option
for v1: `client_invoices.percentage_of_contract` already freezes what
actually got charged at issue time, which is the auditability that
matters; the schedule itself is just a working default, not itself an
evidentiary record. Simpler is correct here, not a compromise.

**Retention — confirmed, v1 drops it.** **Payment gateway — confirmed,
manual reconciliation for v1**, same posture as xprojman-42 §5.4.

**Build order (§7) unaffected** by any of the above — Step 1's migration
just gains `projects.site_state` and loses `client_payment_schedules.
effective_from`; nothing here changes the sequencing.

Ready to build Steps 1-2 (table + skeleton + revenue posting into the
already-built `org_journal`) the moment the owner signs off — Step 2 has
no dependency beyond what's already shipped (xprojman-42 §3, v044).

— Server Agent (`projman2-server-agent`)
— PM (System Architect)

---

## §10 App Agent review — 2026-09-11

No App code, schema, or build-order impact from this spec — checked, not
assumed: every trigger point in §5 (Job Award acceptance, S12/S13/S14/S16
stage-completion, S18.3) fires off writes/hold-points the App already
exercises today, and §6's App-facing invoice view is explicitly sequenced
behind xprojman-41 §1 (which itself still needs its own contract, per my
§11 sign-off there) — nothing here is waiting on the App or vice versa.

**One real gap found, checked against the actual code, not just this
doc's text: §5's Completion trigger cites "S18.11 client final sign-off"
as an existing thing to hook into — it isn't built anywhere.**
`18Stage_Tasks.md`'s own definition of S18.11 is "the system should
capture the client's sign-off (frozen/hashed)" — grepped the whole schema
and every service for `sign_off`/`signature`/`acknowledged` and found
nothing matching that shape. The only place the literal label "S18.11"
exists in code today is `DepreciationService.js`/`routes/projects.js`,
where it means something entirely unrelated — the system-prepared
depreciation-schedule draft for fixed assets — a same-number, different-
concept collision that's easy to grep straight into by mistake. By
contrast, S18.3 (Occupation Certificate) checks out fine — it's a real
`hold_point_requirements` row, same generic mechanism every other
statutory hold point already uses.

Practically: the Completion invoice's second gating condition (§2.5) has
no event to fire on yet. This isn't an App gap — `xprojman-33` §5 already
judged S18.11 as rightly Portal-surfaced, not App-surfaced ("genuinely
fine, arguably better, on a bigger screen at home"), so building the
capture mechanism itself isn't App's lane — but whoever builds §5 Step 4
(milestone triggers) will hit this the moment they wire the Completion
condition, so flagging now rather than letting it surface as a build-time
surprise. Also worth resolving alongside the still-open `xprojman-33` §8
question #1 (the adjacent S18.4 walkthrough companion view) rather than as
two separate owner asks later — both are gaps in the same Stage-18
client-facing moment.

Build order (§7) unaffected for Steps 1-3, 5-7 — only Step 4's Completion
condition (not Deposit/Base/Frame/Lock-up) is blocked on this being
resolved.

— App Agent (`projman2-app-agent`)

## §10 Response — Portal Agent (2026-09-11)

Review only, checked against the actual Portal code that exists today
(just built the Finance nav this session), not just the doc's own text.
No objection to Server's §9 corrections (accrual-only v1, `projects.
site_state`, dropping `effective_from`) — schema-side, not mine to weigh
in on, and none of them change what Portal needs to build.

**Real gap: `client_invoices` has no path to `paid` for v1, as specified.**
`paid_by_user_id`'s own column comment says "the client user who marked
paid, once §1 App access exists" — but §1 (customer App/Portal pairing)
isn't built (checked xprojman-41 §11 just this session — App Agent signed
off §0.1 only, §1 pairing itself is still an unbuilt Phases outline), and
v1 explicitly has no payment gateway (§4's own "manual reconciliation,"
confirmed by Server). Read together: nothing can ever reach `paid` until
§1 ships, since the only actor the schema lets mark it is a client who
can't log in yet. This is the exact same shape `progress_claims`/
`ClaimService.pay` already solved — PM/office records a bank-transfer
payment they observed, `money.write`, no client action needed. Recommend
`paid_by_user_id` accept a PM/office user too (or add a separate `recorded_
by_user_id` alongside it if keeping "who the payment came from" and "who
recorded it" distinct matters later) — otherwise Module B's "paid" second
posting (§4 phase 3) is dead code for the entire time §1 is unbuilt.

**§6's routes are missing a project-scoped entry point — same gap Progress
Claims already solved differently.** `progress_claims` lives at
`/projects/[id]/claims`, inside `ProjectTabs` — a PM working one project
expects to find that project's billing there, not only in a global
`/finance/client-invoices` list filtered by eye. Recommend either (a) a
new `Invoices` tab in `_ProjectTabs.js` (would sit next to the existing
money-gated `Cost Plan`/`Claims` tabs — same `seesMoney` gate) alongside
the global Finance list for cross-project aging/collections, or at minimum
(b) the global list accepting a `?project_id=` filter so a project page can
deep-link into it. Global-only, as currently specified, makes sense for
P&L/Balance Sheet/Expenses/Sales (org-wide aggregates by nature) but
`client_invoices` is fundamentally project-scoped data, same as claims.

**§6's payment-schedule editor placement needs one more level of
specificity.** `/projects/[id]/edit` already exists with 4 tabs (`Customer`
/ `Project Brief` / `Land & Site Info` / `Contract`) — `contract_value`
(what the milestone percentages multiply against) already lives in
`Contract`. Recommend the schedule editor lives inside that existing tab
rather than as a new standalone page, same field-parity discipline this
edit page already follows against the New Project wizard.

**Minor: §6's "the Sales report already exists (xprojman-42 §9)" cites the
wrong section** — §9 of xprojman-42 is Portal's chart-of-accounts-UI/
Forecast entry; the actual `org_journal`+all-four-reports build (including
Sales) is Server's §10 there. Doesn't affect anything here, just a
cross-reference fix for whoever reads xprojman-42 off this pointer later.

**No blockers on Portal's side.** Steps 1-4 (schema + posting + triggers)
are Server's; once `client_invoices`/`client_payment_schedules` exist,
Portal can build the list/detail views, nav item, and edit-tab integration
in the same session — same pattern as this session's Finance nav build
(xprojman-42 §9/§10 landing same-day and getting built immediately after).

— Portal Agent (`projman2-portal-agent`)
---

## §11 Portal: UI built mockup-first + proposed REST contract (2026-10-14)

The SA approved this doc on 2026-09-30 (xprojman-roles §8 #5), although the Status line
above still reads DRAFT. Portal built the §6 screens mockup-first on
`CLIENT_INVOICES_MOCK = true` (`server/portal/src/lib/clientInvoices.js`). The mock bills
the org's real projects with sample invoices; nothing is saved. Screens:
`/finance/client-invoices` (list + KPIs + status/project filter),
`/finance/client-invoices/[id]` (detail + actions), and a money-gated **Invoices** tab on
the project (invoices + payment schedule). This answers Portal §10's project-scoped entry
point. The schedule editor sits on the Invoices tab rather than in Edit → Contract, beside
the invoices it drives. Say so if you'd rather have it in Contract.

§6 doesn't define the REST shapes, so these are Portal's proposal. Server, please confirm
or correct them; the mock follows them exactly. Dates use the API's existing
`'YYYY-MM-DD HH:MM:SS'` form.

| Route | Perm | Body / query | Returns `data` |
|---|---|---|---|
| `GET /client-invoices` | money.read | `?project_id=&status=draft\|issued\|paid\|void\|overdue` | `{ client_invoices: [Invoice], totals: { draft_count, outstanding_inc_gst, overdue_inc_gst, paid_inc_gst } }` (totals ignore `status`) |
| `GET /client-invoices/:id` | money.read | — | `{ client_invoice: Invoice + { contract_value, site_state, supplier: { name, abn } } }` |
| `PATCH /client-invoices/:id` | money.write | `{ amount_ex_gst, variation_note }` (draft only, GST recomputed) | Invoice · `INVOICE_FROZEN` 409 if not draft |
| `POST /client-invoices/:id/issue` | money.write | — | Invoice · `SCHEDULE_NOT_100` / `DEPOSIT_CAP_EXCEEDED` (`details.cap_pct`) 409 |
| `POST /client-invoices/:id/payment` | money.write | `{ paid_at, payment_reference }` | Invoice · `INVOICE_NOT_ISSUED` 409 |
| `POST /client-invoices/:id/void` | money.write | `{ reason }` (required) | Invoice · `INVOICE_PAID` 409 |
| `GET /projects/:id/payment-schedule` | money.read | — | `{ schedule: [{ milestone, percentage, invoiced }], contract_value, site_state, deposit_cap_pct }` |
| `PUT /projects/:id/payment-schedule` | money.write | `{ schedule: [{ milestone, percentage }] }` (all six) | same as GET · `SCHEDULE_NOT_100` 400 / `DEPOSIT_CAP_EXCEEDED` 409 |

`Invoice` = the §3 row, plus `project_code`, `project_name`, `days_overdue` (0 unless
issued and past `due_at`), `has_pdf`, `variation_note`, `payment_reference`, `void_reason`,
and `recorded_by` / `created_by` as `{ id, name }`.

Three choices follow from the reviews above. Flag any you disagree with:
1. **Recording a payment is a PM/office action** (Portal §10). That is `recorded_by`, so
   `paid_by_user_id` stays for the future client-side mark. The "paid" posting (§4
   phase 3) is reachable in v1.
2. **Void** is new: it covers an issued invoice that was wrong. A voided milestone needs
   a new draft. I'd suggest `supersedes_id`, the same as re-issue, but I've left the
   mechanism to Server.
3. **`deposit_cap_pct`** is computed server-side from `site_state` (falling back to
   `organisations.state`). The Portal only displays it. The mock's per-state table is
   for display only, and the server check on issue/save is authoritative.

Not built yet: PDF download (Step 7). `has_pdf` is shown but there's no button until the
route exists.

— Portal Agent (`projman2-portal-agent`, session `projman2-55`)

---

## §12 Response — Server Agent: §11 REST contract confirmed, with corrections (2026-10-14)

Agreed with Portal by message on 2026-10-14 and recorded here. **§13 re-scopes the module after
two Owner rulings the same day.** The corrections below still hold, but they apply to *client
claims*, and nothing is posted to a ledger.

1. **Void-safe uniqueness.** §3's `UNIQUE (project_id, milestone, is_deleted)` blocks a fresh
   draft after a void, and allows only one deleted row per milestone. Replace it with a generated
   `live_milestone` (= milestone unless void/deleted, else NULL) and `UNIQUE (project_id,
   live_milestone)`. A void sets `void_reason`/`voided_at`/`voided_by` and auto-creates a
   replacement draft with `supersedes_id`. The response is `{ client_invoice, replacement }`.
   Drafts can be voided too.
2. **The number is assigned at issue**, so drafts don't consume numbers and carry
   `invoice_number: null`.
3. **The deposit cap is a data table** (PM ruling): `deposit_caps (jurisdiction, min_price,
   max_price, pct, abs_cap_amount, source, verified_at)`. Only VIC and WA are seeded as verified.
   The response carries `deposit_cap: { pct|null, amount_inc_gst|null, rule, source, verified } | null`.
   A verified row over the cap gives `DEPOSIT_CAP_EXCEEDED` 409 (`details.cap_pct,
   cap_amount_inc_gst, rule`). An unverified state, or no row, gives an envelope
   `warnings: [{ code: 'DEPOSIT_CAP_UNVERIFIED' }]` and does not block.
4. **`SCHEDULE_LOCKED` 409** (`details.milestones`) when a PUT changes the % of an issued or
   paid milestone. Drafts are re-priced. Schedule rows carry `invoiced` (issued|paid, the lock
   flag) and `invoice_status` (null|draft|issued|paid).
5. **GST** = 10% only if `organisations.gst_registered`. The detail response carries
   `supplier: { name, abn, gst_registered }`. `overdue` is a derived filter, not a stored status.
6. **Full payment only** in v1: `{ paid_at, payment_reference }`, where `paid_at` is wall-clock
   or ISO (normalised to Perth), and `payment_recorded_by` is set. `paid_by_user_id` is
   reserved for the client side.

The schedule editor on the Invoices tab is fine.

— Server Agent (`projman2-server-agent`, session `projman2-d3`)

---

## §13 Server — re-scope after the Owner rulings of 2026-10-14 (DRAFT for Owner/SA)

**Rulings:** (1) ProjMan is project management. Builders' books live in Xero/MYOB/QuickBooks
and tradies' books in MAVEN, and ProjMan doesn't rebuild accounting. (2) ProjMan and
MAVEN/AURA are separate systems with an API exchange (`xprojman-55`).
**Effect:** ProjMan keeps the *construction money records* and **exports** them. It never posts
a ledger, files BAS, or issues a tax invoice of its own. **Superseded:** §4 (revenue posting),
`journal_entry_id`, and the "invoice" framing of §3. **Kept:** §2 (the regulatory constraints),
§5 (milestones, schedule, auto-draft) and §12 (the REST corrections, renamed per 13.2).

### 13.1 What ProjMan keeps — two claim directions

| Direction | Record | Today | Change |
|---|---|---|---|
| Builder → payer (PM/developer org) | `progress_claims` (v017) | built, hold-point freeze, GST cols (v023) | **add the optional SOP template** (13.3), the RCTI flag (13.3a) + `retention_withheld` |
| Payer → client, at the 6 milestones | **`client_claims`** (was `client_invoices`, §3) | not built (Portal mock only) | build per §3 + §12, **minus** `journal_entry_id` |
| Deposit (S9.9) | `project_payments` (v013) | built, TPAR-flagged | unchanged; feeds the TPAR export |
| Variations | `variations` (v021) | built | unchanged; an approved variation adjusts the next claim (`variation_note`) |
| Retention | `contracts.retention_pct` (v021) | modelled, not withheld | **add** `retention_withheld` on both claim tables + `retention_releases (contract_id, amount, released_at, reason: practical_completion\|dlp_end)` |
| Supplier bills / POs | `purchase_orders`, `supplier_invoices` (v019) | built, against the cost plan | unchanged; future MAVEN F2 inbound lands here (`xprojman-55`) |
| GST amounts | `gst_treatment`/`gst_amount` on four tables (v023) | built | **kept**: the export needs them |

### 13.2 Client claims — the §11/§12 contract, renamed

ProjMan records the claim. The accounting system issues the tax invoice from the export, so
"invoice" becomes "claim" end to end, and the shapes are otherwise unchanged:
`/client-claims` (list/detail/PATCH/issue/payment/void), `client_claim`, `claim_number`,
`CLAIM_FROZEN`, `CLAIM_NOT_ISSUED`, `CLAIM_PAID`. `/projects/:id/payment-schedule`,
`deposit_cap`, `SCHEDULE_NOT_100`, `SCHEDULE_LOCKED`, `DEPOSIT_CAP_EXCEEDED` and
`DEPOSIT_CAP_UNVERIFIED` stay as they are. New field: `exported_at` (13.4). Portal: rename the
mock when this is approved; it stays on `CLIENT_INVOICES_MOCK` until then.
*Open (O3):* if the Owner prefers to keep the word "invoice", only the names change.

### 13.3 Security of Payment — an optional per-state claim template

Input from Nexus Finance (`xprojman-55` §4.1, MEDIUM confidence, from law-firm commentary;
**the solicitor confirms**). The SOP Acts **exclude owner-occupier / resident-owner
contracts** in NSW, QLD and ACT. SOP claims run sub → builder and builder → developer, never
builder → homeowner. So SOP is **opt-in per claim, never the default**:

- **Where it applies:** `progress_claims` (Builder → payer org). On `client_claims` it is
  allowed only when the project is flagged not owner-occupier (`projects.client_is_owner_occupier`,
  default 1).
- **Fields:** `sop_state` (NSW|QLD|ACT|NULL; NULL means not an SOP claim), `reference_date`,
  `schedule_due_at`, `scheduled_amount`, `schedule_reason`, `payment_due_at`.
- **Templates, stored as data in `sop_templates` (state, required_fields, statement_text,
  source, verified_at), not hard-coded:**
  - **NSW** (1999 Act s13(2)): the work, the amount, and the "made under the Act" statement.
    Monthly. A head contractor also needs the s13(7) supporting statement.
  - **QLD** (BIF Act s68): the work, the amount, and a request for payment (strict, per
    *MWB Everton Park v Devcon* [2024] QCA 94).
  - **ACT** (2009 Act s15): the work, the amount, and the Act statement.
  - On issue, the server checks the required fields and renders the statement onto the
    claim/export (`SOP_TEMPLATE_INCOMPLETE` 409).
- **Due dates** come from `sop_periods (state, schedule_days, payment_days, business_days,
  source, verified_at)`. Every row is **unverified until legal review**, so dates are computed
  and shown with a `SOP_PERIOD_UNVERIFIED` warning and nothing is enforced. Other states can be
  added as rows later.

### 13.3a RCTI — recipient-created tax invoices

A builder that issues RCTIs to subcontractors makes ProjMan the source of the tax document, and
under the ATO RCTI determination that needs a **written agreement per subcontractor**.
- `rcti_agreements (org_id, supplier_id, agreed_at, document_id, ends_at, created_by)`, with the
  signed agreement held as a document.
- An `rcti_issued` flag on `supplier_invoices` / `progress_claims` can only be set while a
  current agreement exists (`RCTI_NO_AGREEMENT` 409). The export marks those rows so the
  accounting system records them as RCTIs.

### 13.4 Accounting export (v1 CSV, v2 unified API)

`AccountingExportService` with a pluggable adapter interface `{ format, kinds, toRows() }`.
The kinds are seen from the exporting org's side:

| Kind | Source rows (exportable when) | Accounting side |
|---|---|---|
| `sales` | `client_claims` issued (a void → credit-note row) | sales invoices |
| `bills` | `progress_claims` approved (Builder → this org) + `supplier_invoices` approved | bills / purchases |
| `purchase_orders` | `purchase_orders` issued | POs (presets only where the package imports POs; generic CSV always) |
| `contractor_payments` | `project_payments` + paid `progress_claims` with `tpar_reportable` | TPAR (the existing TPAR export is reused) |

**Row shape** (generic CSV; the presets rename and reorder): `kind, source_type, source_id,
reference` (claim/invoice/PO number) `, date, due_date, contact_name, contact_abn,
description, amount_ex_gst, gst_amount, amount_inc_gst, gst_code`
(mapped from `gst_treatment`) `, account_code` (from the cost-centre → account mapping, blank
if unmapped) `, tracking` (project code + name) `, project_id, rcti` (13.3a) `, sop_state`
(13.3).

- **Endpoint:** `GET /accounting-export?kind=&format=generic|xero|myob|qbo&from=&to=&project_id=&only_new=1`
  streams the CSV. `GET /accounting-export/preview?…` returns the same rows as JSON for the
  screen. Permission is `accounts.read` (org owner, accountant, developer).
- **Double-post guard:** each source row gets `exported_at` / `exported_by` / `export_id`.
  Every run writes `accounting_exports (id, org, kind, format, filters, row_count, sha256,
  created_by)`. With `only_new=1` (the default), rows already exported are skipped. A full
  re-export is allowed but flagged in the response (`warnings: [EXPORT_INCLUDES_EXPORTED]`).
  Rows carry `exported_at` in the normal list/detail responses too.
- **Account-code mapping (the codes are the builder's, from THEIR package, not ProjMan's):**
  `cost_centres.export_account_code VARCHAR(20) NULL` (new) feeds `account_code` on bills,
  POs and contractor payments. Org defaults live in `accounting_export_settings (org_id,
  sales_account_code, bills_account_code, gst_code_map JSON)`. `gst_code_map` maps each
  `gst_treatment` to the package's tax-code names, **per direction**, because packages name
  sales and purchase codes differently: `{ sales: { gst, gst_free, input_taxed, out_of_scope },
  bills: { …same keys } }` (e.g. Xero sales.gst = "GST on Income", bills.gst = "GST on
  Expenses"). The `sales` kind uses `sales`; `bills`, `purchase_orders` and
  `contractor_payments` use `bills`. A row with no cost-centre code falls back to the org default, and stays blank
  ("unmapped") only if both are missing. The existing `cost_centres.linked_account_id` (v042,
  → `org_accounts`) belongs to the hidden ledger and is not used by the export.
  Endpoints: `GET/PUT /accounting-export/settings`, and `PATCH /cost-centres/:id
  { export_account_code }` (permission `money.write`). Built in R4.
- **Column templates:** each vendor's current import format must be checked before the
  presets ship (O4). The generic CSV ships first, then Xero.
- **v2:** a unified-API adapter (Codat/Apideck/Merge) behind the same interface; routes and
  data stay the same.
- **Payment-schedule readiness** (the Portal screen): `GET /projects/:id/payment-schedule`
  rows gain `gates: [{ code, label, met, met_at }]`. Example: Base → S12.10 hold point;
  Frame → S13.11; Completion → S18.3 OC + S18.14 sign-off (not met until `xprojman-51` is
  built). `ready = all gates met`.

### 13.5 Hidden behind feature flags (nothing deleted)

| Flag (default **off**) | Hides | Off behaviour |
|---|---|---|
| `FEATURE_TENANT_LEDGER` | `org_journal` auto-posting hooks (Costing, Procurement, Claim) + `/finance/*` reports and chart of accounts (x42) | hooks no-op; routes `404 FEATURE_DISABLED`. Portal's matching flag is `NEXT_PUBLIC_ACCOUNTING_SCREENS`; flip both together |
| `FEATURE_BAS` | `/accounts/bas*` incl. lodge | `404 FEATURE_DISABLED` |
| `FEATURE_TPAR_LODGE` | `POST /accounts/tpar/:id/lodge` | the TPAR **export stays** |
| `FEATURE_DEPRECIATION` | fixed-asset routes + `/accounts/depreciation/export` | **stays ON until S18.12 is ruled** (13.6) |

Tables and data stay. The existing suites (org-finance-journal, tax, tpar, depreciation) run with
the flags on; a new test proves the flags-off behaviour. Portal hides the matching nav when the
API reports a flag off (via `GET /organisation` `features`).

### 13.6 S18.12 — proposal, NOT ruled

Today S18.11 (depreciation draft) → S18.12 (`tax.approve`) is a **blocking**
`hold_point_requirements` row on Stage 18 (v016). Hiding depreciation while it blocks would
leave every project unable to complete Stage 18.
**Proposal:** S18.11 becomes "asset register prepared". S18.12 becomes "asset register exported
to the accountant", **non-blocking**, using the existing asset data and depreciation export. The
accountant's approval happens in the accountant's own system. **Nothing changes until the
Owner/SA rules**, and `FEATURE_DEPRECIATION` stays on until then. This departs from v3.4 S18.12
("no ATO lodgement without accountant approval"). Because ProjMan no longer lodges, that rule is
met outside ProjMan.

### 13.7 Build order (after v048 → inspector fix → dashboard security fixes)

| Step | Deliverable |
|---|---|
| R1 | Feature flags + hiding (13.5) + tests |
| R2 | `client_claims`, `deposit_caps` (VIC/WA seeded), payment schedule, `projects.site_state`; **re-key the v034 task library to v3.4 codes** (seed "S18.11" is v3.4 S18.14) |
| R3 | SOP template + `sop_templates`/`sop_periods` (unverified) + RCTI agreements/flag + retention columns/table |
| R4 | `AccountingExportService` + CSV (Xero first) + `accounting_exports` |
| R5 | Milestone auto-draft triggers (§5); Completion waits on S18.14 (`xprojman-51`) |

### 13.8 Open for Owner / SA

| # | Question | Recommendation |
|---|---|---|
| O1 | S18.12 (13.6) | non-blocking export |
| O2 | SOP templates (NSW/QLD/ACT) and periods; owner-occupier exclusion; RCTI agreement wording | solicitor review; warn-only until then |
| O3 | "claim" vs "invoice" naming | "claim" |
| O4 | Which accounting package first; vendor CSV templates | Xero first |
| O5 | Retention model (13.1) | as proposed; release at PC + DLP end |
| O6 | Retire the hidden ledger/BAS tables later, or keep them hidden indefinitely | keep hidden; revisit at v2 |

No MAVEN integration is built until `xprojman-55` is agreed with Nexus.

— Server Agent (`projman2-server-agent`, session `projman2-d3`)

### 13.9 Portal — screens against §13 (Portal Agent, 2026-10-14)

All mockup-first and committed (not pushed). Each screen uses §13's shapes, so going live
means flipping a flag and checking field names.

| Screen | Route | Status | Reads / writes |
|---|---|---|---|
| **Payment schedule** (project tab) | `/projects/[id]/payment-schedule` | Mock | `GET/PUT /projects/:id/payment-schedule`. Per milestone: %, amount, live claim status (`invoice_status`), lock (`invoiced`), **readiness gates** (`gates[]`: ✓/○ code + label, met date), deposit cap + `DEPOSIT_CAP_UNVERIFIED` banner. Also lists the project's claims |
| **Progress claims** (to the client) list + detail | `/finance/progress-claims`, `/finance/progress-claims/[id]` | Mock | §12 routes. Issue / adjust a draft, record payment, void → replacement. Under §13.2 these **stay** (not behind the ledger flag). The journal/Sales line in the detail only shows with the ledger on |
| **Accounting export** (new) | `/finance/export` | Mock (`ACCOUNTING_EXPORT_MOCK`) | `GET /accounting-export/preview` for the table, `GET /accounting-export` for the CSV. Filters: kind, format (generic, Xero), from/to, project, "only rows not yet exported" (default on → `only_new=1`). Shows the RCTI / SOP badges, "unmapped" for a blank `account_code`, the `exported_at` column, and the `EXPORT_INCLUDES_EXPORTED` warning. Needs `accounts.read`. MYOB/QBO get added to the format list once O4 checks their templates |
| Ledger screens: CoA, P&L, Balance Sheet, Expenses, Sales | `/finance/*` | Live, flaggable | Hidden by `NEXT_PUBLIC_ACCOUNTING_SCREENS=off` (nav items removed; bookmarked URLs show a "moved to your accounting system" notice). Flip it together with `FEATURE_TENANT_LEDGER`. Since 2026-10-14 Portal reads `GET /organisation` `features.tenantLedger` (server wins; the env value is only the fallback when no flag comes back; hidden while loading) |

**Portal follow-ups once Server builds:**
- (1) ✅ Done 2026-10-14 after O3: Portal labels say "Progress claims", and the mock uses the
  §13.2 shapes (`/client-claims`, `client_claim(s)`, `claim_number`, `CLAIM_*`).
- (2) ✅ Built 2026-10-14 against the §15 R3 log (not yet live-tested, no logins): Progress Claims (Builder → payer) gains the optional SOP template fields (13.3:
  `sop_state`, reference date, schedule/payment due dates with the `SOP_PERIOD_UNVERIFIED`
  banner, `SOP_TEMPLATE_INCOMPLETE`), plus the RCTI flag (`RCTI_NO_AGREEMENT`) and
  `retention_withheld`.
- (3) ✅ Built 2026-10-14 as `/finance/rcti` (Finance nav; supplier or claimant, add with an optional
  signed copy, revoke); the supplier-invoice RCTI tick sits on the Cost plan tab.
  Client claims (R3) also built: SOP + retention on the draft in the claim detail (SOP hidden while
  `client_is_owner_occupier`), and project edit → Contract has that setting (default on; switching
  it off asks for confirmation, legal register L10). Was: an RCTI agreements list on the supplier/subcontractor screen (`/builder/subcontractors`
  or the panel).
- (4) The cost-centre → account-code mapping that feeds `account_code` needs an editor in
  Finance → Settings. **Server: which table holds it?** It isn't named in 13.4.
- (5) The S18.14 gate shows unmet until xprojman-51 is built.

— Portal Agent (`projman2-portal-agent`, session `projman2-55`)

## 14. Owner/SA rulings on §13.8 O1–O6 (2026-10-14), recorded by the PM

The Owner (who is also the SA) ruled "O1–O6 as recommended":

| # | Ruling |
|---|---|
| O1 | **S18.12 becomes NON-BLOCKING.** The step is "asset register exported to the accountant". Remove the blocking `hold_point_requirements` row in a migration, and after that FEATURE_DEPRECIATION may go off. The 18-Stage v3.4 S18.11/S18.12 is annotated as superseded by this ruling (devroadmap §12). |
| O2 | SOP templates and RCTI go to **solicitor review** (devroadmap §13 L10, L23) before any template is marked verified. Until then they warn only. |
| O3 | Naming: **"Progress claim"**, for client milestone claims as well. The tax invoice comes from the builder's accounting system. Portal relabels "Client Invoices" → "Progress claims". |
| O4 | Accounting package order: **Xero first**, then MYOB, then QuickBooks. |
| O5 | Retention: **Server's §13 model**: retention withheld per claim, released in parts (typically 50% at Practical Completion, the balance after the defects-liability period). |
| O6 | Hidden ledger/BAS/depreciation tables: **keep them hidden until v1 launch**, then retire them by migration. Nothing is deleted before then. |

## 15. Server build log

**R1, feature flags: landed a77a3c1 (2026-10-14).** Built as §13.5, with one difference. The
**code default is ON** (`FEATURE_*` unset means on), so landing changes nothing on a running
server. The lab turns the flags off in `server/api/.env` *together with* Portal's
`NEXT_PUBLIC_ACCOUNTING_SCREENS` in one restart (the PM's call). `.env.production.example` ships
them `false`. `GET /organisation` returns `features` for Portal. Flags-off behaviour is
`tests/features.test.js` (13 checks). `FEATURE_DEPRECIATION` can go off now, because S18.12
stopped blocking in v050 (x43 §14 O1).
— Server Dev (`projman2-server-agent`, session `projman2-d3`)

**R2, progress claims: landed 768439a, c1projman2 migrated to v053 (2026-10-14).** As §12/§13 with
the names from §14 O3: `client_claims` (`PC-YYYY-NNNN` assigned at issue, 14-day terms),
`client_payment_schedules` (the §2.2 default until saved), `deposit_caps` (VIC + WA verified only),
`projects.site_state` (defaults to the org's state). **One addition to Portal's §11 contract:**
`POST /projects/:id/client-claims { milestone }` raises a draft by hand, until the R5 triggers draft
them. Re-keying the task library moved to xprojman-56 (v052). Tests: `client-claims.test.js` (26 checks).
— Server Dev (`projman2-d3`)

**R3, SOP templates, RCTI and retention: built on v054 (2026-10-14).** Everything legal is data and
**unverified** (§14 O2): it warns, it never blocks a claim that didn't opt in.
- **SOP (13.3).** `GET /sop-templates` returns the rules: per state, `required_fields`, `statement_text`,
  `source`, `verified`, and `period { schedule_days, payment_days, business_days, verified }`. Seeded:
  NSW, QLD, ACT. A progress claim opts in on `POST /projects/:id/progress-claims` with `sop_state`,
  `work_description`, `reference_date` and (NSW) `supporting_statement_document_id`. A client claim
  opts in on `PATCH /client-claims/:id` with the same fields, and is checked at issue. Missing fields →
  `SOP_TEMPLATE_INCOMPLETE` 409 (`details.missing`). The response carries `sop_statement`,
  `schedule_due_at`, `payment_due_at` and `warnings[]`: `SOP_TEMPLATE_UNVERIFIED`, `SOP_PERIOD_UNVERIFIED`,
  and `SOP_STATE_MISMATCH` (`sop_state` ≠ `site_state`). Business days skip weekends only, not public
  holidays. Client claims: `projects.client_is_owner_occupier` (default `true`, set on `PATCH /projects/:id`);
  while it is true, `SOP_OWNER_OCCUPIER` 409. **Payment schedule** (the respondent):
  `POST /projects/:id/progress-claims/:claimId/schedule { scheduled_amount, schedule_reason }`
  (claims.approve). Less than claimed needs the reason (`SCHEDULE_REASON_REQUIRED` 400); after
  `schedule_due_at` it only warns (`SOP_SCHEDULE_LATE`).
- **RCTI (13.3a).** `GET /rcti-agreements?supplier_id=&party_user_id=&current=1`,
  `POST /rcti-agreements { supplier_id | party_user_id, agreed_at, ends_at?, document_id?, note? }`
  (supplier: money.write or po.write; claimant: money.write), `POST /rcti-agreements/:id/revoke`. With no
  `document_id` it warns `RCTI_AGREEMENT_NO_DOCUMENT`. (The signed copy is uploaded as an ordinary document,
  for now `entity_type: project, kind: general`.) Flag: `POST /projects/:id/progress-claims/:claimId/rcti
  { issued }` (claims.approve) and `POST /projects/:id/supplier-invoices/:invId/rcti { issued }` (po.write).
  Turning it on needs a current agreement (not revoked, `agreed_at` ≤ today ≤ `ends_at`), otherwise
  `RCTI_NO_AGREEMENT` 409. Turning it off is always allowed. Rows carry `rcti_issued` + `rcti_agreement_id`.
- **Retention (§14 O5).** Both claim tables have `contract_id` + `retention_withheld` (ex GST). Progress
  claims: on submit or approve, give `contract_id` (a subcontractor or supplier contract) and optionally
  `retention_withheld`; the default is amount × `retention_pct`. **Pay records amount − retention**
  (`paid_amount` in the response). Client claims: set on the draft via PATCH; with no `contract_id`, the
  project's sole client contract is used. Retention above 0 with no contract → `CONTRACT_REQUIRED` 409.
  `GET /projects/:id/retention` (money.read) returns per contract `withheld / released / held`, plus
  `releases[]` and `totals`. `POST /projects/:id/retention-releases { contract_id, amount, reason:
  practical_completion|dlp_end|other, released_at?, note? }` (money.write); more than held →
  `RETENTION_EXCEEDS_HELD` 409. Releasing to a claimant user writes a TPAR-reportable
  `project_payments` row (`purpose: retention_release`).
- **For R4:** the export reads `rcti_issued`, `sop_state` and `retention_withheld` from these columns.
  Tests: `sop-rcti-retention.test.js` (44 checks).
— Server Dev (`projman2-d3`)

**R4, accounting export: built on v055 (2026-10-14).** As §13.4, with these specifics:
- **Routes.** `GET /accounting-export?kind=&format=generic|xero&from=&to=&project_id=&only_new=1` streams the
  CSV (accounts.read: org owner, PM, accountant, developer). It sets the headers `X-Export-Id`,
  `X-Export-Rows`, `X-Export-Sha256` and `X-Export-Warnings` (comma-separated codes), and they are
  CORS-exposed. `GET /accounting-export/preview?…` returns the same rows as JSON (`rows[]`, `row_count`,
  `skipped_already_exported`, `totals`, `warnings[]`) and marks nothing. `GET /accounting-export/history`
  lists the runs. `GET /accounting-export/settings` (accounts.read or money.read) returns `settings`,
  `cost_centres[]` (with `export_account_code`), `formats[]` (`{ id, label, kinds, verified }`) and
  `format_gst_defaults`. `PUT /accounting-export/settings { sales_account_code, bills_account_code,
  gst_code_map: { sales: {…}, bills: {…} }, xero_tracking_category }` and
  `PATCH /cost-centres/:id { export_account_code }` need money.write. **Portal follow-up (4):** the
  mapping lives in those two places.
- **Rows.** Generic columns are the §13.4 row shape plus `retention_withheld` and `exported_at`.
  - `sales`: issued and paid client claims. A **void of an already-exported claim** gives one credit
    row (`<number>-CR`, negative amounts, `is_credit`). A void that was never exported is skipped,
    since there is nothing to reverse.
  - `bills`: approved and paid progress claims (reference `CODE-PC<n>`) plus matched and approved
    supplier invoices.
  - `purchase_orders`: issued and received POs (reference `CODE-PO<n>`). POs have no GST columns, so
    `gst_code` is blank.
  - `contractor_payments`: `project_payments` with `tpar_reportable`, including retention releases.
  - **Procurement rows are the org's own (`owner_party = pm`).** A builder's private cost rows (§7.2.1)
    are never exported by the PM org.
- **Guard.** The first CSV a row appears in stamps `exported_at`/`exported_by`/`export_id`, and a
  credit row stamps `client_claims.void_exported_at`. Preview never stamps. `only_new=0` repeats rows
  and warns `EXPORT_INCLUDES_EXPORTED`. Runs are serialised per org (`EXPORT_BUSY` 409). An empty export
  records no run.
- **Codes.** `account_code` comes from the cost centre (via the task on a supplier invoice or PO), else
  the org default for the direction, else blank, with the warning `EXPORT_UNMAPPED_ACCOUNTS`.
  `gst_code` comes from the org's map for the direction, else the format default.
- **Xero (O4) is UNVERIFIED.** It is built from Xero's published sales-invoice and bill import
  templates, but I couldn't confirm the current column list from Xero itself. It warns
  `EXPORT_FORMAT_UNVERIFIED` until someone runs a test import into a Xero demo company. Details:
  sales and bills only (`EXPORT_KIND_UNSUPPORTED` for POs and payments); dates DD/MM/YYYY; one line per
  document, tax-exclusive (choose "Tax exclusive" on import); credits as negative unit amounts; GST
  defaults "GST on Income" / "GST on Expenses" / "GST Free …" / "Input Taxed" / "BAS Excluded";
  `TrackingName1/Option1` filled only when `xero_tracking_category` is set (that category must already
  exist in Xero).
- **CSV safety.** Every cell is quoted, and a text cell starting with `= + - @` gets a leading
  apostrophe. Numbers, including negatives, go out unchanged.
  Tests: `accounting-export.test.js` (29 checks).
— Server Dev (`projman2-d3`)
