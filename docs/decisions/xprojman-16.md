# xprojman-16 — P7b Procurement: directive corrected + BUILT (owner-approved)

**Status:** 🟢 BUILT + VERIFIED. Corrects one load-bearing error in the xprojman-10 §4 P7b spec, on the owner's call.
**Author:** Server Agent · **For:** Owner · App dev (Flutter)
**Date:** 2026-07-30
**Implements:** devroadmap P7b (Procurement) · `serverdesignspecification.md` §7.2 + **§7.2.1** (engagement-mode money).
**Corrects:** `xprojman-10` §2's claim that P7b needs "no new redaction engine — reuse redactStage."
**Builds on:** P7a (v017), DIRECTIVE 1 engagement modes (`builder_engagement_type`, v014), deliveries FK stubs (v008).

---

## 0. Why this doc exists — I raised my voice on the directive

xprojman-10 §2 said procurement money reads could just **"reuse `redactStage` — no new redaction
engine."** I checked that against the code and the spec before building, and **it is wrong** in a
way that would have leaked the Builder's private cost structure to the PM. The owner reviewed and
approved the corrected model below. This is the "specify, then build" catch working as intended.

**The error:** `redactStage` (`ProjectService.js:47`) only blanks five *aggregate columns on the
stage row*. But `serverdesignspecification.md` §7.2.1 is explicit that under `independent_fixed`
the redaction *"extends to the supplier/subcontractor register in full."* A purchase order or
supplier invoice **is** that register — the Builder's cost breakdown. Those are **document rows in
new tables**, not columns on the stage row, so `redactStage` can neither see nor hide them.
Building P7b "as written" would have shown the PM every PO and supplier invoice the Builder
raised — the exact disclosure §7.2.1 exists to prevent in a fixed-price engagement.

## 1. The corrected model (owner-approved)

Procurement documents carry an **owner dimension** and go through a **new row-level visibility
filter** keyed to the engagement mode:

| Engagement mode | What the PM (non-Builder) sees of PO / supplier-invoice rows |
|---|---|
| `independent_fixed` | **Only their own** (`owner_party='pm'`) rows. The Builder's are invisible — the Builder bears the cost-overrun risk, so owns cost privacy (§7.2.1). Symmetric: the Builder sees only their own. |
| `independent_cost_plus` | **All** rows (full cost disclosure — what makes cost-plus honest). But a row tied to a **subcontractor without pass-through consent** has its *counterparty identity* redacted (amount kept) — §7.2.1's line-attribution gate. |
| `employee` / no Builder engaged | **Shared** — everyone with `money.read` sees all. |

This is **more than "reuse redactStage"**: it's a new ~30-line filter (`ProcurementService
.applyVisibility`) plus one owner column. It *reuses* the mode **resolver**
(`JobAwardService.acceptedBuilderEngagement`), not the stage redactor.

## 2. Schema (migration v019)
- **`suppliers`** — org-level vendor master. NOT engagement-redacted: a vendor *name* isn't
  sensitive; what §7.2.1 protects (which supplier, what amount, this job) lives on the PO/invoice.
- **`purchase_orders`** → `project_stages.committed_amount` (statuses `issued`/`received`).
  Carries **`owner_party` (pm|builder)** + **`raised_by_user_id`** (the visibility keys) and an
  optional **`subcontractor_engagement_id`** (for the consent gate).
- **`supplier_invoices`** → `actual_amount` (statuses `matched`/`approved`). 2-way match to a PO
  via `po_id` (inherits the PO's stage + owner); 3-way (+delivery) deferred (xprojman-10 §7 #3).
- **`deliveries.supplier_id`/`po_id`** stay **soft** references (no hard FK) so legacy free-text
  delivery rows remain valid — the service validates in-org when supplied.
- **`po.write`** added to the matrix for `projectManager` + `builder` (own scope enforced in code);
  **matrix_version 6 → 7**.

## 3. Roll-up ownership (the invariant, stated)
`committed_amount`/`actual_amount` on a stage aggregate **all** of that stage's POs/invoices (the
true total). **Document-level** visibility is the owner×mode filter above; **stage-column**
visibility stays the existing §7.2.1 `redactStage` (in `independent_fixed` the PM has no claim on
cost roll-ups — they pay the fixed head-contract price; they still see their own PO rows and can
total those). No per-owner stage columns — the stage columns remain the single read model
(xprojman-10 §5).

## 4. TPAR correction (a second directive gap)
xprojman-10 §3 implied procurement payments ride `project_payments` like progress claims. They
must not: a materials **supplier** is generally **not** a TPAR-reportable contractor, and
`project_payments.payee_user_id` is `NOT NULL` (a supplier isn't a `users` row). So **supplier
invoices write no `project_payments` row** — the invoice *is* the actual-cost record. Contractor
payments (progress claims, S9.9 deposits) stay the only `project_payments` writers, keeping P9's
TPAR set clean.

## 5. Endpoints
```
GET  /suppliers                                  list vendor master   (money.read | po.write)
POST /suppliers                                  add a supplier       (po.write)
GET  /projects/:id/purchase-orders               list (engagement-mode filtered)
POST /projects/:id/purchase-orders               raise a PO           (po.write)
POST /projects/:id/purchase-orders/:poId/status  issue/receive/cancel (po.write, own scope)
GET  /projects/:id/supplier-invoices             list (engagement-mode filtered)
POST /projects/:id/supplier-invoices             record invoice       (po.write; po_id = 2-way match)
POST /projects/:id/supplier-invoices/:invId/status  match/approve/dispute (po.write, own scope)
```
REST-mediated, not sync (same reasoning as P7a / job_awards).

## 6. Verified
New `tests/procurement.test.js` (18 checks): suppliers + po.write gating; issued PO → committed;
matched invoice → actual; **the correctness fix** — `independent_fixed` hides the Builder's PO from
the PM (and the PM's from the Builder), own-scope mutation refused; `cost_plus` full disclosure;
the subcontractor consent gate (identity redacted → revealed on consent); and no `project_payments`
row for a supplier invoice. Full suite green: **isolation 16 · domain 29 · access 29 · stages 17 ·
admin 18 · siteops 28 · quality 19 · compliance 18 · directive1 36 · commercial 17 · procurement 18
= 245 tests, 0 failures** (throwaway :4199; owner's :4100 untouched). Migration v019 applied to dev DB.

## 7. Boundaries / next
- **2-way match (PO↔invoice) v1**; 3-way (+delivery) deferred (xprojman-10 §7 #3) — `deliveries`
  evidence already exists to add it later.
- **P7c Variations & Contracts** is the remaining P7 phase — gated on the Client portal (P10) for
  `variations.approve`; open decisions xprojman-10 §7 #1 (retention) / #2 (build dormant vs defer)
  still await the owner.
- Not committed yet — staged for the owner's word (server-dev files by explicit path). Files:
  `mysql/migration_v019_procurement.sql`, `src/services/ProcurementService.js`,
  `src/routes/{suppliers,projects}.js`, `src/index.js`, `tests/procurement.test.js`,
  `tests/access.test.js` (matrixVersion 6→7).

© eBizco Australia Pty Ltd
