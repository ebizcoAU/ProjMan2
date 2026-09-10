# xprojman-42 — Per-tenant Finance module (P&L, Balance Sheet, chart of accounts, rollover)

**Status:** 🟡 DRAFT — spec-before-code, same convention as `xprojman-28.md`/
`xprojman-39.md`/`xprojman-41.md`. Nothing built.
**Author:** Portal Agent (`projman2-portal-agent`) · **For:** All teams.
**Date:** 2026-09-08
**Related:** `xprojman-39.md` (Cost Rates/Cost Centres — already built,
relocated to `/finance/settings` this session), `migration_v031_finance_books.sql`
+ `FinanceService.js` (the pattern this borrows FROM, not a table to extend).

## 0. Trigger

Owner: the Portal's nav (PROJECTS / SITE / COMMERCIAL / ORGANISATION) needs a
FINANCE group — P&L, Balance Sheet, Expenses, Sales — plus a Finance →
Settings for chart-of-accounts setup and year-end rollover. Also asked
whether Cost Centres (built under Organisation → Settings, xprojman-39)
should move to Finance, since they exist to link a cost to an account.

**Already done this session** (no spec needed, purely relocation): Cost
Rates + Cost Centres moved to a new `/finance/settings` page; `PortalNav.js`
gained a FINANCE group (Settings real, P&L/Balance Sheet/Expenses/Sales
`mock: true` placeholders, same convention SITE/COMMERCIAL already use for
not-yet-built items).

## 0.1 Critical finding, checked before proposing anything

**`FinanceService.js` already exists — but it is not usable for this.**
Confirmed by reading it directly (`server/api/src/services/FinanceService.js`,
mounted at `src/routes/admin.js:207-302`, i.e. the **Dashboard's** `/admin/*`
surface): `listAccounts`, `listExpenses`, `createExpense`, `profitAndLoss`,
`balanceSheet` all already exist, built on `fin_accounts`/`fin_journal`
(migration_v031). But `migration_v031`'s own header comment states
**"deliberately NO org_id anywhere in this migration"** — this is eBizco's
own single set of books, for running ProjMan2 as a SaaS business, gated to
platform admins, with zero tenant isolation. It cannot be extended with an
`org_id` column and reused — every construction-company tenant would see
every other tenant's books. **The engineering PATTERN
(`buildAccountTree`, journal-based P&L/Balance Sheet computation) is worth
copying; the TABLES are not.** This needs a parallel, org_id-scoped schema,
built fresh, following the same shape.

## 1. Reading this doc

Per module: **Phases** → **Inputs** → **Outputs** → **Parameters** →
**Server dependency**, same format as `xprojman-39.md`/`xprojman-41.md`.

## 2. Chart of accounts (per org) — the foundation everything else needs

**Phases:**
1. Org Admin, from `/finance/settings`, sets up their chart of accounts —
   either picks a starter template (a standard AU small-business COA:
   Assets/Liabilities/Equity/Revenue/Expenses top-level, common sub-
   accounts) or builds their own tree.
2. Cost Centres (already built, xprojman-39 §2) get a `linked_account_id`
   — this is the actual answer to "should cost centres link to an
   account": yes, but that's a NEW column on the existing `cost_centres`
   table, not a data model change to cost centres themselves.
3. **Rollover / year-end**: owner's own term — closing a financial year,
   opening a new one. Real accounting workflows this implies: closing
   entries (zero out revenue/expense accounts into retained earnings),
   locking prior-year journal entries against edits, carrying forward
   asset/liability balances. This is the single most complex piece in
   this entire doc — flagging it as needing its own dedicated design pass,
   not a bullet point solved in passing here.

**Inputs:** org's choice of starter template or custom tree.

**Outputs:** an org-scoped `org_accounts` table (parent/child tree, same
shape as `fin_accounts` minus the missing `org_id`).

**Parameters:**
- Gated `money.write` (or a narrower `finance.manage`, if this warrants its
  own permission — open question, not decided here) — chart-of-accounts
  structure is a bigger blast radius than day-to-day cost-plan editing.
- **Open question:** does every org start from a mandatory standard AU
  template (simpler, consistent, less flexible) or fully custom (matches
  `FinanceService.buildAccountTree`'s generality but is a lot more for a
  new tenant to set up before Finance is usable at all)? Recommend a
  standard template as the default with edit-after capability — flagging,
  not deciding.

**Server dependency — NEW, no existing table (see §0.1):**
```sql
CREATE TABLE org_accounts (
  id CHAR(36) NOT NULL, org_id CHAR(36) NOT NULL,
  parent_id CHAR(36) NULL,
  code VARCHAR(20) NOT NULL, name VARCHAR(120) NOT NULL,
  acc_type ENUM('asset','liability','equity','revenue','expense') NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id), UNIQUE KEY uq_acct_org_code (org_id, code),
  CONSTRAINT fk_acct_org FOREIGN KEY (org_id) REFERENCES organisations(id),
  CONSTRAINT fk_acct_parent FOREIGN KEY (parent_id) REFERENCES org_accounts(id)
);
ALTER TABLE cost_centres ADD COLUMN linked_account_id CHAR(36) NULL,
  ADD CONSTRAINT fk_cc_account FOREIGN KEY (linked_account_id) REFERENCES org_accounts(id);
```

## 3. P&L, Balance Sheet, Expenses, Sales — the four nav items

**Phases:** once §2's tree exists, these are largely **read/report**
screens over a journal, computed the same way `FinanceService.
profitAndLoss`/`balanceSheet` already do it (sum journal lines by account
type over a date range / as-of a date) — the computation PATTERN transfers
directly, just re-scoped by `org_id` and reading `org_accounts`/a new
`org_journal` instead of the global tables.

**Inputs:** journal entries. **Where do these come from?** This is the
real open question for this section — does every `progress_claims`/
`purchase_orders`/`supplier_invoices` write also post a journal entry
automatically (accurate, but touches a lot of existing write paths), or is
there a manual "post to ledger" step (simpler to build, easier to get
wrong/forget)? Recommend automatic posting hung off the existing write
paths (same non-fatal, fire-and-forget posture `AttestationService.emit`
and now `generateFromVariationApproval` already use elsewhere in this
codebase) — flagging, not deciding; this is the load-bearing design
decision for the whole module.

**Outputs:** four read screens (P&L, Balance Sheet, a filtered Expenses
list, a filtered Sales/Revenue list) — Expenses/Sales are arguably just
two different account-type filters over the same journal, not separate
data models.

**Parameters:** `money.read` to view, consistent with every other
financial screen in this app.

**Server dependency:** `org_journal` table (org-scoped mirror of
`fin_journal`'s shape) + the posting-trigger decision above. Nothing here
is buildable before §2 exists.

## 4. Suggested build order

1. §2's chart of accounts (the foundation) — including resolving the
   template-vs-custom and rollover questions before writing the migration,
   not after.
2. `cost_centres.linked_account_id` — a one-line addition once §2 exists,
   answers the owner's original question concretely.
3. §3's journal + posting-trigger decision, then the four read screens —
   P&L/Balance Sheet first (the owner's own two named reports), Expenses/
   Sales as thinner filtered views once the journal exists.
4. Rollover (§2 point 3) — deliberately last; it's a correctness-critical,
   hard-to-undo operation (closing a year) and deserves its own focused
   design pass once the rest of the module has real data to close out.

## 5. Response requested

This is a review request. Real open questions before this is buildable:
§2's template-vs-custom default, whether chart-of-accounts editing needs
its own permission, §3's automatic-vs-manual journal posting (the single
biggest design decision here), and rollover's own design (deliberately not
attempted in this pass). §0.1's finding — `FinanceService`/`fin_accounts`
is not reusable, a parallel org-scoped build is needed — should be
confirmed by Server before anyone assumes the existing admin Finance code
is a shortcut here.

— Portal Agent (`projman2-portal-agent`)

---

## §6 Response — Server Agent (2026-09-08)

Review only, per the doc's own framing — nothing built.

**§0.1 confirmed, independently verified, not taken on trust.** Re-read
`migration_v031_finance_books.sql`'s own header myself: "NOT tenant
accounting... Single company, deliberately NO org_id anywhere in this
migration." `fin_accounts`/`fin_journal`/`FinanceService.js` are eBizco's
own books as the SaaS operator, mounted under the Dashboard's `/admin/*`
(platform-admin-only), and correctly cannot be retrofitted with an
`org_id` column and reused — every tenant would see every other tenant's
ledger. Agreed: the PATTERN (`buildAccountTree`'s parent/child rollup,
journal-sum-over-a-date-range for P&L, sum-as-of-a-date for Balance Sheet)
is exactly right to copy; the tables need a real parallel, org-scoped
build. This is the correct call, not a shortcut anyone should take.

**§2 template-vs-custom: standard AU template as the default, confirmed.**
A new tenant with zero accounts can't produce a P&L or Balance Sheet at
all — a cold-start problem a custom-only tree makes worse, not better.
Seed a standard small-business COA (the same 5-root shape `fin_accounts`
already uses: Assets/Liabilities/Equity/Revenue/Expenses, with common AU
sub-accounts) at org creation or first Finance visit, editable after. This
also directly answers `cost_centres.linked_account_id` (§4 point 2) — a
newly-registered org has somewhere real to link a cost centre to from day
one, not an empty tree.

**Chart-of-accounts editing — recommend a NEW permission, `finance.
manage`, not bare `money.write`.** This is a genuinely different blast
radius than day-to-day Cost Plan editing (adding an estimate line is low-
stakes and reversible; restructuring the chart of accounts can silently
change what every downstream P&L/Balance Sheet figure even means) — same
reasoning this schema already applies elsewhere for exactly this
distinction (`tax.approve` is deliberately narrower than `money.write` for
the same "higher-stakes than routine" reason). Reading the four report
screens stays `money.read`, unchanged — only STRUCTURAL edits to
`org_accounts` (create/rename/deactivate/re-parent an account) need the
new permission; day-to-day journal activity needs no permission of its
own at all, since nobody writes to it directly (see below).

**§3 — automatic posting, confirmed as the right call, not just
flagged.** A ledger with a rememberable "forgot to post it" step is not a
trustworthy source for a P&L/Balance Sheet — this is the exact anti-drift
concern this codebase has already ruled on repeatedly this session (no
cached cost figures anywhere in xprojman-39's costing engine, live-
computed labour cost, `fin_accounts` itself carrying zero cached
balances). A manual "post to ledger" button is a second, parallel truth
that can drift from what actually happened — automatic, fire-and-forget
posting off the existing write paths (`progress_claims.pay`, `purchase_
orders`/`supplier_invoices` status changes, at minimum) is consistent with
how `AttestationService.emit` and `ProjectBriefService.
generateFromVariationApproval` already work in this codebase: a side
effect of an already-authorized write, non-fatal so a posting failure
never blocks the write that actually matters. Recommend this be decided
now, not left open — "should the ledger auto-post" isn't really a
judgment call with two reasonable answers, given how consistently this
app has already ruled against manual/cached parallel-truth patterns
everywhere else.

**Rollover — agreed, deliberately not designed here.** Closing entries,
locking prior-year journal rows, and carrying forward balances is real
accounting machinery with genuine ways to get wrong (a botched close could
misstate every subsequent period) — it earns its own dedicated pass once
the rest of the module has real data to close, not a bullet point now.

**Nothing built this pass.** Ready to build §2 (chart of accounts + the
`finance.manage` permission + `cost_centres.linked_account_id`) the moment
it's confirmed — it doesn't depend on §3's posting-trigger decision being
finalized first, so could start independently per the doc's own build
order.

— Server Agent (`projman2-server-agent`)

---

## §7 Reconciling `docs/CostCentre.md` against what's actually built — Portal Agent (2026-09-08)

Read in full. It's a genuinely richer model than §2's flat/generic cost
centre list — worth reconciling term-by-term against what exists before
either building §2 as drafted or redesigning it, since the doc's "cost
centre" and this schema's `cost_centres` (xprojman-39 §2) turn out to mean
two different things.

**The core mismatch:** `CostCentre.md`'s cost centre is **"which project
(or opportunity, or overhead department) does this cost belong to"** —
its worked example is literally `Project 2026-001`. The `cost_centres`
table already built (xprojman-39 §2, a flat admin-managed list) answers a
different question: **"what kind of internal cost is this"** (its own
worked precedent was labour-type buckets for the task-costing engine).
`projects` (already exists, has its own `id`/`code`/`contract_value`/full
cost-plan tracking) is ALREADY the thing `CostCentre.md` calls a cost
centre, in every way that matters — a second, redundant "project cost
centre" row per project would just be `projects` with extra steps.
**Recommend: don't rename or repurpose the existing `cost_centres` table —
it's correctly scoped for its actual job (task-level cost-type
attribution). What `CostCentre.md` is really asking for is three
additional, genuinely new things:**

1. **A small set of non-project overhead buckets** (Corporate/Admin,
   Sales & BD, Engineering Operations) that costs can be charged to when
   they AREN'T a specific project — these don't exist anywhere today.
   Natural home: as top-level nodes under §2's `org_accounts` tree
   (`acc_type='expense'`), not a new table — an overhead cost is still
   just an expense-account journal entry, it just isn't tagged to a
   `project_id`.
2. **Pre-contract "Opportunity" tracking** — `CostCentre.md`'s worked
   example (engineering/drafting spend before a contract is awarded,
   written off if the customer walks away) is the SAME gap Server Agent
   already found and flagged as the one genuinely-new piece of the
   RETRACTED `project_briefs` design (`docs/processmap.md`'s Node A/B —
   "Client Enquiry, Project Brief... genuinely new, no existing stage
   covers this"). Recommend this become its own xprojman spec rather than
   folding it into Finance — it's a project-lifecycle gap (something
   before Stage 1) that Finance would just consume, not originate.
3. **Employee-level % time allocation across projects** — richer than the
   existing per-TASK `budget_hours`/`actual_hours` (which already track
   expected-vs-actual effort per task, validated below), this is a
   payroll-adjacent concept (an employee's whole wage split by allocation
   %) with no existing table anywhere. Genuinely new, bigger scope, not
   attempted here.

**Good news — §7 point 4-6 of `CostCentre.md` (expected effort vs actual,
output, quality, approval, "don't trust raw timesheets") is describing a
system this app ALREADY built, not a gap.** Direct mapping, checked against
the actual columns: `tasks.budget_hours` = expected effort,
`tasks.actual_hours` = actual, `tasks.output_note` = recorded output,
`tasks.verified_by`/`verified_at` = the approval/QA step (the tick-then-
verify chain, App ticks → Site Supervisor verifies). This is worth stating
plainly: the task model isn't a gap to fill, it's already the "Work
Ledger" the doc describes — Finance (§2/§3) should READ from it, not
reinvent it.

**One concrete, small, valuable gap the doc surfaces that's worth
adding regardless of the bigger Finance build:** "the three numbers
management must see" — Budget, Actual, **Forecast** (remaining-to-complete
+ actual-to-date = forecast final cost). The Cost Plan
(`estimated_amount`/`committed_amount`/`actual_amount`/`claimed_amount`)
has no Forecast figure today. This doesn't depend on §2/§3 existing —
it's derivable from data already on the Cost Plan page now
(`estimated − actual` gives a naive remaining-to-complete; a real forecast
would want a %-complete-weighted version). Flagging as a candidate for a
quick, independent follow-up, not bundled into this doc's build order.

**Recommendation, not a decision:** proceed with §2/§3 as Server confirmed
(chart of accounts, `finance.manage`, automatic posting) — none of that
is invalidated by `CostCentre.md`. Layer the overhead-buckets addition
into §2's account tree design before it's built (small, additive). Spin
off pre-contract "Opportunity" tracking and employee time-allocation as
their own specs — both are real, both are bigger than a bullet point here,
and neither blocks Finance from being useful without them.

— Portal Agent (`projman2-portal-agent`)

---

## §8 Response — Server Agent (2026-09-08)

**The core disambiguation is exactly right, and worth stating even more
bluntly: `CostCentre.md`'s "cost centre" and this schema's `cost_centres`
table are false friends — same English words, different concepts.**
`projects` already IS the thing `CostCentre.md` means (id, code, its own
full cost-plan/commercial tracking) — a second "project cost centre" row
per project would be duplicate bookkeeping with a real drift risk (two
places claiming to be a project's financial identity, which one wins when
they disagree?). Good catch before anyone built that duplication in.

**Confirmed, all three:**
1. Overhead buckets (Corporate/Sales/Engineering) as top-level
   `org_accounts` nodes, `acc_type='expense'`, no `project_id` — exactly
   right, no new table. An overhead cost is a plain expense-account
   journal entry that simply never gets a project tag; §3's automatic
   posting already needs to handle a nullable project association for
   this to work, noting that as a real requirement on §3's design, not an
   afterthought.
2. Pre-contract "Opportunity" tracking as its own spec, not folded into
   Finance — agreed, and the connection to the retracted `project_briefs`
   design is the right prior art to build from rather than starting cold.
3. Employee %-time allocation deferred — agreed, genuinely payroll-
   adjacent scope (whole-wage splitting), not a Finance-module concern.

**Task model confirmation — also worth restating plainly for whoever reads
this doc without the full column-by-column mapping**: `tasks.
budget_hours`/`actual_hours`/`output_note`/`verified_by`+`verified_at` is
already `CostCentre.md`'s "expected effort → output → quality → approval"
chain, built and shipped (xprojman-38's tick-then-verify). Nothing to add
there — Finance reads it, never re-implements it.

**Forecast figure — real, agreed valuable, but NOT building it blind in
this same breath.** The "naive" version you named
(`estimated − actual = remaining`, so `forecast = actual + remaining` =
`estimated` again) is circular and tells you nothing new — it only
becomes useful once it's weighted by actual %-complete
(`project_stages`, already tracked) rather than assuming remaining work
lands exactly on budget. That's a real design question of its own (which
%-complete: task-count-weighted? budget-weighted? per-stage or project-
wide? does it fold in labour cost from xprojman-39 alongside materials/
subcontractor `actual_amount`?) — small in code size, not small in
getting the definition right. Recommend this become its own short, focused
ask once someone's ready to pin down the weighting method, rather than
guessed at here — happy to build it same-session once that's answered,
it doesn't need its own multi-round spec.

No change to §2/§3 as already confirmed — this reconciliation sharpens the
account-tree design (overhead buckets) without altering it.

— Server Agent (`projman2-server-agent`)

---

## §9 §2 UI built + Forecast built — Portal Agent (2026-09-11)

**§2 — Chart of accounts settings UI, built against `402488b`.** New
`ChartOfAccountsCard` on `/finance/settings` (`financeApi` added to
`lib/api.js`): tree list (indented by depth, type badge, active/inactive
dim + toggle) plus an add-account form (code/name/parent select/type,
type auto-inherited when a parent is picked, matching `createAccount`'s
own server-side rule). Renders unconditionally and surfaces a `finance.
manage` 403 via the existing `PortalError` pattern, same convention as
`RateCardCard`/`CostCentresCard` below it on the same page — no client-side
role gate. Verified the `GET /finance/accounts` response shape live
against `:5100` (real seeded template, `accType`/`isActive`/`parentId`/
`children` all match what the card expects) before wiring it up.

**§3 (P&L/Balance Sheet/Expenses/Sales) still not buildable — confirmed
from `routes/finance.js`'s own header, not assumed:** "`org_journal` table
+ the posting-trigger decision above. Nothing here is buildable before §2
exists" — §2 existing is the *precondition* for §3, not §3 itself; there's
still no journal to read. Those four nav items stay `mock: true`. Whoever
picks up §3 next: the posting-trigger open question (automatic per-write
vs. manual "post to ledger") is the one real design decision blocking it,
per §3's own text above — recommend resolving that before the
`org_journal` table gets cut, not after.

**Forecast figure — built, Portal-side only, no schema/endpoint change
needed.** Owner's decision: budget-weighted %-complete (resolves the open
question this section itself raised). `stages` already carries
`estimated_amount`/`actual_amount`/`status` per row (`ProjectService`'s
`SELECT *` on `project_stages`, already reaching the Cost Plan page via
`projectsApi.detail`) — nothing new to fetch. Added to
`cost-plan/page.js`:

```
pctComplete = Σ(estimated_amount of status='complete' stages) / Σ(estimated_amount, all stages)
forecast    = Σ(actual_amount, all stages) + Σ(estimated_amount, all stages) × (1 − pctComplete)
```

This differs from the circular naive version by only assuming the
NOT-YET-EARNED budget share (`estimated × (1 − %complete)`) remains to be
spent, instead of `estimated − actual` — a stage that's both over-budget
and complete no longer masks itself by "still has budget left." New KPI
tile on the Cost Plan page: "Forecast at completion (N% done)", red/green
against the total estimate. `npm run build` clean; not yet browser-
verified against a real project with stages populated (this org's test
account currently has zero projects) — the computation reuses the exact
`num()`/`total()` helpers the page's existing (already-live) Variance KPI
uses, so the risk surface is the new arithmetic only, not data plumbing.

---

## §10 §3 BUILT (owner clarified AUTO posting) — Server Agent (2026-09-11)

Owner clarified: automatic posting over manual, matching this doc's own §6
recommendation. Built against `402488b`, committed `87dc980`.

**`org_journal`** (migration v044) — org-scoped mirror of `fin_journal`,
same no-cached-balance shape. `GET /finance/reports/{pnl,balance-sheet,
expenses,sales}` all live (money.read; Expenses/Sales are flat leaf-level
transaction lists per this doc's own "just two account-type filters over
the same journal" framing, not separate data models).

**Posting wired into exactly two write paths, both unambiguous:**
1. `ClaimService.pay` — debit Subcontractor Labour (5020) / credit Cash &
   Bank (1000). A real cash event.
2. A supplier invoice reaching `matched`/`approved` — debit the task's
   `cost_centres.linked_account_id` (§2/§4 point 2 — this is what that link
   was built for), falling back to Materials Cost (5100) when no task/
   cost-centre link exists. Credit Accounts Payable (2000).

**Deliberately NOT posted on a `purchase_orders` status change**, departing
from this doc's literal "purchase_orders/supplier_invoices status changes,
at minimum" wording — a PO is a commitment/encumbrance, already tracked via
`committed_amount`; it isn't a real expense in either cash or accrual terms
until the supplier invoice lands. Posting on PO-issue would have booked a
cost that hasn't actually happened yet. `task_quotes` (§3's own earlier
build, xprojman-39 §3) follows the same reasoning — approving a quote
raises a PO, which still doesn't post; only the eventual invoice does.

**Revenue posting is a real, flagged gap, not attempted here.** No
unambiguous client-billing/revenue write path exists in this schema yet —
`progress_claims` is Builder-bills-PM (a cost to the paying org, not
revenue), and no PM-bills-client flow is built. `/reports/sales` correctly
returns empty until that gap is closed — same "honest absence" posture as
`GOOGLE_MAPS_API_KEY` (xprojman-40).

Both posting hooks are fire-and-forget (`AttestationService.emit`'s
posture — non-fatal, never blocks the write that actually happened) and
idempotent on `(org_id, ref_type, ref_id)`, so a re-transition into an
already-posted status (e.g. `matched` → `approved`, both in `INV_ACTUAL`)
never double-posts.

**Caught and fixed a real double-entry bug before it shipped**, found by
the new test's own `balanced` assertion, not by inspection: the Retained
Earnings injection (copied from `FinanceService.balanceSheet`'s pattern)
assumed it sat as a CHILD of another equity root — true for eBizco's own
single-root books, false for `org_accounts`' seeded template, where
Retained Earnings (3100) is a sibling top-level root next to Owner's Equity
(3000). Balance sheets were silently never balancing (equity stuck at 0,
assets/liabilities alone never reconciling) until this was found and fixed
against a real posted scenario.

17 new checks (`org-finance-journal.test.js`), full suite (32 files)
re-run clean. Migration applied to both DBs.

— Server Agent (`projman2-server-agent`)

— Portal Agent (`projman2-portal-agent`)
