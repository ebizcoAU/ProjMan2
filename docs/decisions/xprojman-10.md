# xprojman-10 — P7 Commercial: spec + phasing — FOR OWNER SIGN-OFF

**Status:** 🟠 SPEC — owner sign-off on **scope + phasing** before build. No code until nod.
**Author:** Server Agent · **For:** Owner · App dev (Flutter)
**Date:** 2026-07-30
**Implements:** devroadmap.md P7 (Commercial) · `serverdesignspecification.md` §7.2 (the
`claims.*`/`variations.*` permissions) + §7.2.1 (engagement-mode money) + §10.6 (claim
freeze). **Builds on:** DIRECTIVE 1 (engagement modes, `project_payments`,
`assertClaimAllowed`), the stage cost columns already on `project_stages`.
**Model of record for identity:** single-role (`xprojman-08/09`) — unaffected here.

---

## 0. What P7 is, in one line
The document layer that **feeds the money numbers the stage engine already carries**.
`project_stages` already has `estimated_amount / budget_amount / committed_amount /
actual_amount / claimed_amount` (and DIRECTIVE 1 already redacts them by engagement mode).
P7 builds the source documents behind each column and the workflows that move money along
the canonical flow:

`estimate → (quote) → contract → committed (PO) → actual (supplier invoice) → claimed (progress claim)`

## 1. Scope (devroadmap canonical table set)
`contracts` · `cost_plans` / `estimate_lines` · `suppliers` · `purchase_orders` ·
`supplier_invoices` · `variations` · `progress_claims` · (`material_selections` — deferred,
§7). Each rolls a total up into the matching `project_stages` cost column, so the Cost Plan
tab and roll-ups are the read model — no parallel truth.

## 2. Permissions to wire (matrix bump v5 → v6)
§7.2 already **names** these; P7 wires them into `role_permissions` (same additive pattern
DIRECTIVE 1 used for tick/verify):
| Permission | Held by | Meaning |
|---|---|---|
| `estimates.write` | projectManager (+ developer read) | build/maintain the estimate & cost plan |
| `po.write` | projectManager, builder (own scope) | raise/receive purchase orders |
| `claims.submit` | builder | submit a progress claim |
| `claims.approve` | projectManager | approve a submitted claim → payable |
| `variations.raise` | projectManager | raise a variation |
| `variations.approve` | client | approve/decline a variation (portal, P10 dependency — §7) |

All money **reads** on these tables ride the **existing engagement-mode redaction**
(`independent_fixed` → PM sees the head figure only, never the breakdown; `cost_plus` → PM
sees actuals/commission; `employee` → shared Cost Plan) plus the
`subcontractor_pass_through_consent` line-level gate — §7.2.1. **No new redaction engine**;
P7 reuses `redactStage`/the `pullDeltas` branch DIRECTIVE 1 built.

## 3. Hooks already in the tree that P7 lights up
- **`stageHooks.assertClaimAllowed(pool,{orgId,stageId})`** — the §10.6 claim-freeze
  interlock is **already written and tested-adjacent**; `progress_claims` submit calls it
  (throws `CLAIM_BLOCKED` if the stage or a prior hold point is unvalidated). This is why
  Claims should be in the first phase — the hard part exists.
- **`deliveries.supplier_id` / `deliveries.po_id`** — nullable "FK wired at P7" columns
  (v008); P7b adds `suppliers`/`purchase_orders` and turns the free-text `supplier_name`/
  `po_reference` into optional real FKs (soft — legacy free-text rows stay valid).
- **`project_payments`** (v013) — already has `purpose='progress_claim'` and
  `tpar_reportable`; an approved claim's payment lands here (TPAR-reportable to a
  Builder/subcontractor), same table the S9.9 deposit uses.

## 4. Proposed phasing (each its own migration + test suite, signed off in turn)

### P7a — Cost Plan + Progress Claims  *(build first; highest value, hooks exist)*
- **Schema (migration v017):** `cost_plans` (per project, optional per-stage rollup),
  `estimate_lines` (project/stage, description/category/qty/unit/rate/amount → feeds
  `estimated_amount`), `progress_claims` (project/stage, amount, status
  `submitted→approved→paid`, `submitted_by`/`approved_by`, `payment_id`→`project_payments`,
  → feeds `claimed_amount`).
- **Service/routes:** estimate CRUD (`estimates.write`); `POST …/progress-claims`
  (`claims.submit`, calls `assertClaimAllowed`), `…/approve` (`claims.approve`), `…/pay`
  (records `project_payments`). Roll-ups recompute the stage cost columns.
- **Redaction:** claim/estimate money read through engagement mode.
- **Why first:** the claim-freeze interlock is already built; no client-portal dependency.

### P7b — Procurement (committed → actual)
- `suppliers`, `purchase_orders` (→ `committed_amount`), `supplier_invoices` (matched to a
  PO → `actual_amount`); wire `deliveries.supplier_id`/`po_id`. `po.write`.
- 2-way match (PO↔invoice) v1; 3-way (PO↔delivery↔invoice) flagged (§7).

### P7c — Variations & Contracts  *(depends on the Client portal, P10)*
- `contracts` (head contract + subcontracts; `party_type` client/subcontractor/supplier;
  `retention_pct`), `variations` (`variations.raise` PM → `variations.approve` client).
- **Gated:** `variations.approve` needs the `client` role on the portal (P10) — buildable
  server-side now, but not exercisable end-to-end until the client portal exists.

## 5. Roll-up rule (the one invariant worth stating now)
Each document total sums into its `project_stages` column; the stage columns stay the single
read model (Portal Cost Plan tab, App). Documents never bypass the stage columns, and the
stage columns are never hand-edited once P7 owns them (they become derived). This avoids the
"two sources of truth" trap.

## 6. TPAR / AU (touch points, not full P9)
Approved progress claims paid to a Builder/subcontractor are **TPAR-reportable** → land in
`project_payments` with `tpar_reportable=1` (already the default). Full BAS/TPAR/PAYG stays
**P9**. P7 only ensures the payment rows carry the right flags for P9 to report on.

## 7. Open decisions (need owner input before/at build)
| # | Question | Leaning |
|---|---|---|
| 1 | **Retention** — held per progress claim at a `contracts.retention_pct`, released at practical completion? | Model `retention_pct` on contract (P7c) + a held-amount on each claim; release flow is its own small step |
| 2 | **Variations approval needs the Client portal (P10)** — build P7c server-side now and leave it dormant, or defer P7c until P10? | Build server-side now, mark dormant (same posture as VeriTrade endpoints) — or defer; owner's call |
| 3 | **Supplier-invoice matching depth** — 2-way (PO↔invoice) vs 3-way (+delivery) | 2-way v1; 3-way later (deliveries evidence already exists) |
| 4 | **`material_selections`** — in P7 or later? | Later — it's client-selection UX, closer to the P10 portal than the money loop |
| 5 | **Estimate library reuse** (the `estimator`/QS role, post-v1) | Out of P7 v1; `estimate_lines` schema leaves room for a library FK later |

## 8. What I need
**Owner: sign off §1 scope + §4 phasing (build P7a first), and answer §7 #1–#2.** On nod I
write the P7a spec's exact DDL into `serverdesignspecification.md`, build migration v017 +
services + routes + `commercial.test.js`, verify the full suite, and wire the Portal Cost
Plan tab to the new reads. Step E (VeriTrade) stays blocked on PM2-02 throughout.

© eBizco Australia Pty Ltd
