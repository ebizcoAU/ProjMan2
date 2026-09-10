Client Billing (PM → Client invoicing against the 6 billing milestones) + Revenue Posting
Status: 🟡 DRAFT — spec-before-code, same convention as xprojman-28.md/xprojman-39.md/xprojman-41.md/xprojman-42.md. Nothing built.
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

Design consequence: the Completion milestone invoice is gated on S18.3 (Occupation Certificate hold point) and S18.11 (client final sign-off) — both already in the 18-stage spec.

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

Completion — S18.3 OC issued + S18.11 client final sign-off

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