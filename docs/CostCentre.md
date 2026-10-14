# Cost Centre in Project Management — Summary and Best-Practice Setup

**Status:** BACKGROUND (not a spec). This is a general best-practice explainer written for an engineering/drafting firm. PM alignment note added 2026-10-14. **Build from the ProjMan mapping below**, not from the drafting-firm examples.
**Owner:** PM (`projman2-pm`) · **Date:** 2026-10-14 · **Guideline:** 18-Stage spec v3.4 §1.10 (billing milestones), xprojman-42 (org_journal), xprojman-43 (client billing, APPROVED).

## 0. How this maps to ProjMan (PM, 2026-10-14)

| Concept in this doc | ProjMan equivalent | Built? |
|---|---|---|
| Cost centre / project code | `projects.id`: **one project = one cost centre** | ✅ |
| Pre-contract / opportunity cost (§ "opportunity") | Project in `status='draft'` before the S9 Job Award; cost lines tagged pre-contract | ⚠️ not modelled |
| Budget | S5 estimate → `cost_plans` / `estimate_lines`; frozen at S9 contract | ✅ cost plan (Portal live) |
| Committed | Purchase orders (P7), tracked against the cost plan. Bills and payments live in the accounting system. | partial |
| Actual | Actual cost imported/linked from the accounting system against cost-plan lines (no AP ledger in ProjMan) | partial |
| Claimed / revenue | ProjMan tracks **milestone readiness** on the 6 v3.4 milestones (S9.9 / S12.10 / S13.11 / S14.7 / S16.10 / S18.15) and hands claim data to the business's accounting system (Xero/MYOB/QuickBooks/MAVEN), which issues the tax invoice and posts the ledger. Owner scope ruling 2026-10-14. | x43 ON HOLD for re-scope |
| Forecast / EAC | Budget − actual + committed, per cost-plan line | not built |
| Labour cost allocation (staff salaries → projects) | **Out of scope for ProjMan.** Payroll was cancelled 2026-08-05 (devroadmap P9). Crew time comes from attendance hours × a rate card only, never payroll data. A tradie business's payroll belongs in MAVEN (devroadmap §15). | n/a |
| Task / work ledger | 18-stage tasks + site diary + attendance + checklists | ✅ |

**Legal touchpoints:** devroadmap §13 L10–L13 (Security of Payment, retention trust accounts, GST tax invoices, payroll).

---


A cost centre is an accounting and management structure used to identify where money and company resources are being consumed. In project management, it becomes particularly valuable when every project, work package, or major opportunity can be associated with its own cost centre or project code. The purpose is not simply to record expenditure, but to connect resources, work, outputs, budget, revenue, and profitability into one management system.

For an engineering and drafting company, the best approach is to treat the cost centre as the financial identity of a project, while using a separate task-management structure to record the actual work performed.

1. Cost Centre versus Budget

A common misunderstanding is that a cost centre is a pot of money.

It is better understood as an accounting bucket or tracking identity.

For example, an engineering company receives a $10 million project.

The company may establish:

Project 2026-001 — Customer XYZ

with an approved project budget of $8 million.

The $8 million is the budget. The project code/cost centre tells the accounting system:

"Any approved cost associated with this project should be attributed to Project 2026-001."

The company does not necessarily transfer $8 million into a separate bank account.

The cost centre therefore answers:

Where was the company's money and labour consumed?

The budget answers:

How much were we expecting to consume?

2. Recommended Hierarchy

For a 100-person engineering/drafting organisation, I would not create a completely independent cost centre for every small activity.

Instead, use a hierarchy:

COMPANY
│
├── Corporate / Administration
├── Sales & Business Development
├── Engineering Operations
│
└── PROJECTS
      │
      ├── P2026-001 — Customer A
      ├── P2026-002 — Customer B
      ├── P2026-003 — Customer C
      └── P2026-004 — Customer D

Within each project, use work packages and tasks.

P2026-001
│
├── Engineering
├── Drafting
├── Design Review
├── Project Management
├── Procurement
├── Documentation
└── Commissioning

This distinction is important:

Cost centre = financial structure

Work package/task = operational structure

Trying to make the accounting cost centre do everything usually creates unnecessary complexity.

3. Pre-Contract Work

One of the most important areas for an engineering company is work performed before the customer formally awards the project.

For example:

preliminary engineering
feasibility studies
free consultation
preliminary drawings
design concepts
quotations
technical proposals
customer meetings

Suppose the company spends:

Engineering: $40,000
Drafting: $20,000
Management: $10,000
Other: $5,000

Total:

$75,000

If this work is clearly associated with a particular opportunity, create an Opportunity/Pre-contract project code.

For example:

O2026-034 — Customer XYZ — Proposed Plant

The $75,000 can then be tracked against that opportunity.

If the customer eventually awards the $10 million contract, the company has a complete history of the resources consumed before the contract.

If the customer cancels the project, the company can identify the $75,000 acquisition/pre-contract cost that may become an expense or write-off depending on the accounting treatment.

This is much better than allowing those costs to disappear into general engineering wages.

4. Labour Should Be Allocated to Projects

For an engineering/drafting company, labour is probably the most important project cost.

Employees receive their normal wages through payroll.

However, their labour cost should be allocated to the appropriate project based on the work performed.

For example:

Employee annual employment cost = $100,000

If the person's productive work is:

Project A: 40%
Project B: 35%
Project C: 15%
Internal: 10%

then management can attribute approximately:

Project A: $40,000
Project B: $35,000
Project C: $15,000
Internal: $10,000

The employee's salary hasn't changed. The allocation of the cost has changed.

This allows the company to determine the real labour cost of every project.

5. Do Not Depend Entirely on Timesheets

This connects directly with the system we discussed earlier.

A conventional company may ask:

"How many hours did you work on Project A?"

The employee enters:

8 hours.

That is useful, but it is still a self-reported number.

A stronger system records:

Task → expected effort → employee → output → quality → approval

For example:

Task: Structural GA Drawing S-104
Expected effort: 8 hours
Employee: Engineer 037
Output: Drawing revision
Actual effort: 7.4 hours
QA: Approved
Rework: None

Now the company has much stronger evidence of productive work.

6. Use Expected Hours, Not Rigid Hours

Every significant task should ideally have an expected effort.

For example:

Task	Expected effort
Simple drawing	3 h
Standard GA drawing	8 h
Complex detail	15 h
Drawing review	2 h
Engineering report	10 h
Design calculation	6 h

However, these should be treated as benchmarks rather than absolute quotas.

An 8-hour drawing may legitimately take 15 hours because of unusual complexity.

The objective is to measure:

Expected effort versus actual effort versus quality.

Eventually, historical project data can provide better estimates than management guesses.

7. Measure Output and Quality

For your particular business, I believe this is one of the strongest parts of the system.

Instead of monitoring whether employees are sitting at their computers, monitor the engineering outputs:

drawings produced
drawings revised
3D models completed
documents reviewed
reports generated
calculations completed
RFIs resolved
engineering packages submitted
QA approvals
rework
rejected deliverables

AI can assist in evaluating the output.

For example:

10 drawings submitted
9 accepted first time
1 returned for correction

The system can calculate a quality indicator.

AI can also help identify obvious inconsistencies, missing information, document standards, revision errors and other measurable characteristics.

However, AI should support engineering QA, not replace the responsible engineer's professional approval.

8. Progress Payments Are Separate from Cost

Suppose the project is worth:

$10 million

and the customer makes a $2 million progress payment.

The $2 million is project revenue/cash, while the project cost centre continues accumulating:

labour
materials
subcontractors
equipment
other project costs.

Do not simply subtract the $2 million payment from the cost centre.

Instead maintain:

PROJECT

Revenue / Billing       $10.0M
                         │
                         │
Project Costs            $8.0M
                         │
                         ↓
Gross Project Profit     $2.0M

This separation makes the project's financial position much clearer.

9. The Three Numbers Management Must See

Every project dashboard should continuously show:

Budget

What did we expect to spend?

Actual

What have we spent so far?

Forecast

What do we now expect the final cost to be?

For example:

Project value                 $10.0M

Original cost budget           $8.0M
Actual cost to date            $4.2M
Remaining forecast              $3.1M
                              -------
Forecast final cost            $7.3M

Forecast profit                $2.7M

This is considerably more useful than simply looking at the company's bank balance.

10. Recommended Digital Architecture

For your company, I would build the system around a Project Work Ledger.

Employee
    │
    ↓
Project / Cost Centre
    │
    ↓
Work Package
    │
    ↓
Task
    │
    ├── Expected hours
    ├── Actual hours
    ├── Output
    ├── Quality
    ├── Revision
    └── Approval
            │
            ↓
       Work Ledger
            │
      ┌─────┴─────┐
      ↓           ↓
 Accounting     AI Analysis
      │           │
      ↓           ↓
Project Cost   Productivity
      │         Quality
      └────┬──────┘
           ↓
      Project Dashboard

This creates a bridge between HR, project management, engineering production and accounting.

11. The Long-Term Advantage

The most valuable aspect is that the company gradually builds its own historical database.

After thousands of completed tasks, you might discover:

Standard GA drawing: median 6.4 hours

Complex structural detail: median 12.7 hours

Design review: median 2.1 hours

Engineering report: median 9.3 hours

Now future quotations become more accurate.

The company can estimate:

Project price = expected work × historical production cost + overhead + margin

And after completion, actual results can be compared against the original estimate.

That creates a continuous learning loop:

QUOTE
  ↓
PROJECT
  ↓
TASKS
  ↓
WORK
  ↓
OUTPUT
  ↓
ACTUAL COST
  ↓
PROJECT PROFIT
  ↓
HISTORICAL DATA
  ↓
BETTER FUTURE QUOTES
Conclusion

The best cost-centre system for a 100-person engineering/drafting company is not simply an accounting structure. It should become the financial backbone of project management.

Each project should have a unique project/cost-centre identity. Labour, materials, subcontractors and other direct costs should be allocated to that project. Pre-contract work should be tracked separately by opportunity so management knows how much it spends pursuing projects that may never proceed.

At the operational level, however, the company should go beyond traditional timesheets. Each task should have an expected effort, identifiable output and quality/approval status. AI can analyse drawings, documents, reports and other deliverables to help assess productivity and quality.

The ultimate objective is:

Don't measure whether people appear to be working. Measure the work they produce, the resources consumed, the quality achieved, and the financial result.

That gives management a much stronger system for cost control, employee productivity, project profitability, quotation accuracy and continuous organisational learning.