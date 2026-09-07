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
