// ProcurementService — P7b Procurement (xprojman-10 §4 P7b, CORRECTED by xprojman-16;
// serverdesignspecification.md §7.2 / §7.2.1). The committed → actual half of the money
// loop: purchase_orders feed project_stages.committed_amount, supplier_invoices feed
// actual_amount. Roll-ups recompute on every write; the stage columns stay the single read
// model (xprojman-10 §5).
//
// ⚠ The correctness core the terse directive missed (xprojman-16): a PO / supplier invoice
// IS the Builder's private cost breakdown, which §7.2.1 says is hidden from the PM under an
// `independent_fixed` engagement. redactStage (which only blanks aggregate stage columns)
// CANNOT do this — so this service carries its own row-level `visibility` filter keyed to the
// engagement mode + each row's `owner_party`:
//   independent_fixed      → each party sees only its OWN rows (PM never sees Builder's).
//   independent_cost_plus  → full disclosure; but a row tied to a subcontractor without
//                            pass-through consent has its COUNTERPARTY identity redacted for
//                            non-Builder viewers (amount kept — §7.2.1's line-attribution gate).
//   employee / no-builder  → shared; everyone with money.read sees all.
//
// REST-mediated (not sync). Supplier invoices do NOT write project_payments — a materials
// supplier isn't a TPAR contractor and isn't a `users` row (payee_user_id is NOT NULL).

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const ProjectService = require('./ProjectService');
const JobAwardService = require('./JobAwardService');
const AttestationService = require('./AttestationService');
const OrgFinanceService = require('./OrgFinanceService');

const canWrite = (role) => access.hasPermission(role, 'po.write');
const canRead  = (role) => access.hasPermission(role, 'money.read') || access.hasPermission(role, 'po.write');

// Only projectManager and builder hold po.write; a builder's procurement is their own
// ledger, everyone else's is the PM/org side. Stored on the row so visibility is a plain
// column check, not a role re-derivation at read time.
const partyForRole = (role) => (role === 'builder' ? 'builder' : 'pm');

const PO_COMMITTED  = ['issued', 'received'];     // statuses that count toward committed_amount
const INV_ACTUAL    = ['matched', 'approved'];    // statuses that count toward actual_amount

// xprojman-42 §3 auto-posting: a supplier invoice reaching matched/approved is the
// real cost event — a purchase_orders status change is deliberately NOT posted here
// (a PO is a commitment/encumbrance, already tracked via committed_amount, not yet a
// real expense in either cash or accrual terms). Fire-and-forget, non-fatal; postEntry
// itself is idempotent on (org_id, ref_type, ref_id) so calling this from BOTH
// createSupplierInvoice (created already-matched) and setInvoiceStatus (transitioning
// into it later) never double-posts.
function postInvoiceCost({ orgId, projectId, invoiceId, taskId, amount }) {
  Promise.all([
    OrgFinanceService.resolveExpenseAccount({ orgId, taskId }),
    OrgFinanceService.accountByCode({ orgId, code: '2000' }), // Accounts Payable
  ])
    .then(([debitAccountId, creditAccountId]) => OrgFinanceService.postEntry({
      orgId, projectId, debitAccountId, creditAccountId, amount: Number(amount),
      refType: 'supplier_invoice', refId: invoiceId, memo: 'Supplier invoice matched/approved',
    }))
    .catch((err) => console.warn('[ORG_JOURNAL] supplier_invoice posting failed (non-fatal):', err.message));
}

// ── Engagement resolution + the §7.2.1 visibility model ──────────────────────
async function engagementContext({ orgId, projectId, actor }) {
  const engagement = await JobAwardService.acceptedBuilderEngagement({ orgId, projectId });
  const mode = engagement?.builder_engagement_type || null;
  const isTheBuilder = !!engagement && String(actor.userId) === String(engagement.to_user_id);
  return { mode, isTheBuilder, viewerParty: isTheBuilder ? 'builder' : 'pm' };
}

/**
 * Apply §7.2.1 row-level visibility to a set of procurement rows for a reader.
 * `ctx` = engagementContext result. Returns the rows the reader may see, with counterparty
 * identity redacted where the cost-plus consent gate requires it.
 */
async function applyVisibility({ orgId, rows, ctx }) {
  if (rows.length === 0) return rows;

  if (ctx.mode === 'independent_fixed' && !ctx.isTheBuilder) {
    // PM (or any non-Builder) sees only their own party's rows — never the Builder's ledger.
    rows = rows.filter((r) => r.owner_party === ctx.viewerParty);
  } else if (ctx.mode === 'independent_fixed' && ctx.isTheBuilder) {
    rows = rows.filter((r) => r.owner_party === 'builder');
  }

  // Cost-plus: full amounts disclosed, but a specific subcontractor's IDENTITY is redacted
  // for non-Builder viewers unless that subcontractor signed the pass-through clause.
  if (ctx.mode === 'independent_cost_plus' && !ctx.isTheBuilder) {
    const subIds = [...new Set(rows.map((r) => r.subcontractor_engagement_id).filter(Boolean))];
    let consented = new Set();
    if (subIds.length) {
      const [crows] = await pool.query(
        `SELECT id FROM subcontractor_engagements
          WHERE org_id = ? AND subcontractor_pass_through_consent = 1
            AND id IN (${subIds.map(() => '?').join(',')})`,
        [orgId, ...subIds]
      );
      consented = new Set(crows.map((c) => c.id));
    }
    rows = rows.map((r) => {
      if (r.subcontractor_engagement_id && !consented.has(r.subcontractor_engagement_id)) {
        return { ...r, supplier_id: null, supplier_name: null, counterparty_redacted: true };
      }
      return r;
    });
  }
  return rows;
}

// ── Roll-ups (recompute the stage cost columns from the documents) ───────────
async function recomputeStageCommitted({ orgId, projectId, stageId }) {
  if (!stageId) return;
  await pool.query(
    `UPDATE project_stages ps SET ps.committed_amount = (
        SELECT COALESCE(SUM(po.amount), 0) FROM purchase_orders po
         WHERE po.stage_id = ps.id AND po.org_id = ps.org_id AND po.is_deleted = 0
           AND po.status IN ('issued','received'))
      WHERE ps.id = ? AND ps.project_id = ? AND ps.org_id = ?`,
    [stageId, projectId, orgId]
  );
}

async function recomputeStageActual({ orgId, projectId, stageId }) {
  if (!stageId) return;
  await pool.query(
    `UPDATE project_stages ps SET ps.actual_amount = (
        SELECT COALESCE(SUM(si.amount), 0) FROM supplier_invoices si
         WHERE si.stage_id = ps.id AND si.org_id = ps.org_id AND si.is_deleted = 0
           AND si.status IN ('matched','approved'))
      WHERE ps.id = ? AND ps.project_id = ? AND ps.org_id = ?`,
    [stageId, projectId, orgId]
  );
}

// ── Suppliers (org-level master; not engagement-redacted) ────────────────────
async function createSupplier({ orgId, actor, name, abn, contact, email, phone }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: po.write', 403);
  if (!name || !String(name).trim()) throw new ServiceError('VALIDATION_ERROR', 'name is required', 400);
  const id = uuidv4();
  await pool.query(
    `INSERT INTO suppliers (id, org_id, name, abn, contact, email, phone, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, String(name).trim(), abn || null, contact || null, email || null, phone || null, actor.userId]
  );
  return { id, name: String(name).trim() };
}

async function listSuppliers({ orgId, actor }) {
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read or po.write', 403);
  const [rows] = await pool.query(
    `SELECT id, name, abn, contact, email, phone FROM suppliers
      WHERE org_id = ? AND is_deleted = 0 ORDER BY name`,
    [orgId]
  );
  return { suppliers: rows };
}

async function assertSupplierInOrg(orgId, supplierId) {
  if (!supplierId) return;
  const [[s]] = await pool.query(
    'SELECT id FROM suppliers WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1', [supplierId, orgId]);
  if (!s) throw new ServiceError('VALIDATION_ERROR', 'supplier_id not found in your organisation', 422);
}
async function assertStageInProject(orgId, projectId, stageId) {
  if (!stageId) return;
  const [[s]] = await pool.query(
    'SELECT id FROM project_stages WHERE id = ? AND project_id = ? AND org_id = ? LIMIT 1',
    [stageId, projectId, orgId]);
  if (!s) throw new ServiceError('VALIDATION_ERROR', 'stage_id not found on this project', 422);
}
async function assertTaskInProject(orgId, projectId, taskId) {
  if (!taskId) return;
  const [[t]] = await pool.query(
    'SELECT id FROM tasks WHERE id = ? AND project_id = ? AND org_id = ? LIMIT 1',
    [taskId, projectId, orgId]);
  if (!t) throw new ServiceError('VALIDATION_ERROR', 'task_id not found on this project', 422);
}

// ── Purchase orders (→ committed_amount) ─────────────────────────────────────
/** POST /projects/:id/purchase-orders (po.write). Raised = 'issued' (a commitment). */
async function createPurchaseOrder({ orgId, projectId, actor, stageId, taskId, supplierId, supplierName,
                                     description, amount, subcontractorEngagementId }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: po.write', 403);
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!(Number(amount) >= 0)) throw new ServiceError('VALIDATION_ERROR', 'amount must be a non-negative number', 400);
  await assertSupplierInOrg(orgId, supplierId);
  await assertStageInProject(orgId, projectId, stageId);
  await assertTaskInProject(orgId, projectId, taskId);

  const [[{ next }]] = await pool.query(
    'SELECT COALESCE(MAX(po_number), 0) + 1 AS next FROM purchase_orders WHERE project_id = ? AND org_id = ?',
    [projectId, orgId]);
  const id = uuidv4();
  const owner = partyForRole(actor.role);
  await pool.query(
    `INSERT INTO purchase_orders
       (id, org_id, project_id, stage_id, task_id, supplier_id, supplier_name, po_number, description,
        amount, status, owner_party, raised_by_user_id, subcontractor_engagement_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
    [id, orgId, projectId, stageId || null, taskId || null, supplierId || null, supplierName || null, next,
     description || null, amount, owner, actor.userId, subcontractorEngagementId || null]
  );
  await recomputeStageCommitted({ orgId, projectId, stageId });
  return { id, po_number: next, status: 'issued', owner_party: owner };
}

async function loadPo({ orgId, projectId, poId }) {
  const [[po]] = await pool.query(
    'SELECT * FROM purchase_orders WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [poId, projectId, orgId]);
  if (!po) throw new ServiceError('NOT_FOUND', 'Purchase order not found', 404);
  return po;
}

/** own-scope mutation guard: a builder acts only on builder-owned rows, PM-side on pm-owned. */
function assertOwnParty(actor, row) {
  if (row.owner_party !== partyForRole(actor.role)) {
    throw new ServiceError('FORBIDDEN', 'You can only act on your own procurement documents', 403);
  }
}

/** POST /projects/:id/purchase-orders/:poId/status { status } (po.write, own scope). */
async function setPoStatus({ orgId, projectId, poId, actor, status }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: po.write', 403);
  if (!PO_COMMITTED.concat('cancelled').includes(status)) {
    throw new ServiceError('VALIDATION_ERROR', "status must be 'issued', 'received' or 'cancelled'", 400);
  }
  const po = await loadPo({ orgId, projectId, poId });
  assertOwnParty(actor, po);
  await pool.query('UPDATE purchase_orders SET status = ? WHERE id = ? AND org_id = ?', [status, poId, orgId]);
  await recomputeStageCommitted({ orgId, projectId, stageId: po.stage_id });
  return { id: poId, status };
}

async function listPurchaseOrders({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read or po.write', 403);
  const ctx = await engagementContext({ orgId, projectId, actor });
  const [rows] = await pool.query(
    `SELECT * FROM purchase_orders WHERE project_id = ? AND org_id = ? AND is_deleted = 0
      ORDER BY po_number DESC`, [projectId, orgId]);
  return { purchase_orders: await applyVisibility({ orgId, rows, ctx }) };
}

// ── Supplier invoices (→ actual_amount; 2-way PO match) ──────────────────────
/** POST /projects/:id/supplier-invoices (po.write). With a po_id it 2-way-matches. */
async function createSupplierInvoice({ orgId, projectId, actor, poId, stageId, taskId, supplierId,
                                       supplierName, invoiceNumber, amount, subcontractorEngagementId }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: po.write', 403);
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!invoiceNumber || !String(invoiceNumber).trim()) {
    throw new ServiceError('VALIDATION_ERROR', 'invoice_number is required', 400);
  }
  if (!(Number(amount) >= 0)) throw new ServiceError('VALIDATION_ERROR', 'amount must be a non-negative number', 400);

  let status = 'received';
  let resolvedStageId = stageId || null;
  let resolvedTaskId = taskId || null;
  let owner = partyForRole(actor.role);
  let resolvedSupplierId = supplierId || null;
  let resolvedSubId = subcontractorEngagementId || null;

  if (poId) {
    const po = await loadPo({ orgId, projectId, poId });        // 2-way match target
    assertOwnParty(actor, po);                                  // can't invoice against the other party's PO
    status = 'matched';
    resolvedStageId = po.stage_id;                              // inherit the PO's stage for the roll-up
    resolvedTaskId = po.task_id;                                // inherit the PO's task the same way, when set
    owner = po.owner_party;
    resolvedSupplierId = resolvedSupplierId || po.supplier_id;
    resolvedSubId = resolvedSubId || po.subcontractor_engagement_id;
  } else {
    await assertStageInProject(orgId, projectId, resolvedStageId);
    await assertTaskInProject(orgId, projectId, resolvedTaskId);
    await assertSupplierInOrg(orgId, resolvedSupplierId);
  }

  const id = uuidv4();
  await pool.query(
    `INSERT INTO supplier_invoices
       (id, org_id, project_id, stage_id, task_id, po_id, supplier_id, supplier_name, invoice_number,
        amount, status, owner_party, raised_by_user_id, subcontractor_engagement_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, projectId, resolvedStageId, resolvedTaskId, poId || null, resolvedSupplierId, supplierName || null,
     String(invoiceNumber).trim(), amount, status, owner, actor.userId, resolvedSubId]
  );
  await recomputeStageActual({ orgId, projectId, stageId: resolvedStageId });

  // PM2-02 evidence emission (§13.3) — a 2-way match is the Builder's financial-
  // diligence record (devroadmap.md §7.1's financial/contractual tier). Only a real
  // match, not a bare 'received' invoice with nothing to reconcile against.
  if (status === 'matched') {
    JobAwardService.acceptedBuilderEngagement({ orgId, projectId })
      .then((eng) => {
        if (!eng) return null;
        return AttestationService.emit({
          subjectUserId: eng.to_user_id, issuingOrgId: orgId,
          sourceType: 'invoice_matched', sourceId: id,
          payload: { project_id: projectId, amount: Number(amount) },
        });
      })
      .catch((err) => console.warn('[ATTESTATION] invoice_matched emit failed (non-fatal):', err.message));
  }
  if (INV_ACTUAL.includes(status)) {
    postInvoiceCost({ orgId, projectId, invoiceId: id, taskId: resolvedTaskId, amount });
  }

  return { id, status, matched: !!poId };
}

async function loadInvoice({ orgId, projectId, invoiceId }) {
  const [[inv]] = await pool.query(
    'SELECT * FROM supplier_invoices WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [invoiceId, projectId, orgId]);
  if (!inv) throw new ServiceError('NOT_FOUND', 'Supplier invoice not found', 404);
  return inv;
}

/** POST /projects/:id/supplier-invoices/:invId/status { status } (po.write, own scope). */
async function setInvoiceStatus({ orgId, projectId, invoiceId, actor, status }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: po.write', 403);
  if (!['matched', 'approved', 'disputed'].includes(status)) {
    throw new ServiceError('VALIDATION_ERROR', "status must be 'matched', 'approved' or 'disputed'", 400);
  }
  const inv = await loadInvoice({ orgId, projectId, invoiceId });
  assertOwnParty(actor, inv);
  await pool.query('UPDATE supplier_invoices SET status = ? WHERE id = ? AND org_id = ?', [status, invoiceId, orgId]);
  await recomputeStageActual({ orgId, projectId, stageId: inv.stage_id });
  if (INV_ACTUAL.includes(status)) {
    postInvoiceCost({ orgId, projectId, invoiceId, taskId: inv.task_id, amount: inv.amount });
  }
  return { id: invoiceId, status };
}

async function listSupplierInvoices({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read or po.write', 403);
  const ctx = await engagementContext({ orgId, projectId, actor });
  const [rows] = await pool.query(
    `SELECT * FROM supplier_invoices WHERE project_id = ? AND org_id = ? AND is_deleted = 0
      ORDER BY created_at DESC`, [projectId, orgId]);
  return { supplier_invoices: await applyVisibility({ orgId, rows, ctx }) };
}

// ── Subcontractor register (§1.4 / §3.1 step-in-rights window) ───────────────
//
// applyVisibility hides a Builder's PO/invoice ROWS from the PM under independent_fixed —
// correct for cost-breakdown privacy, but on its own it also hid the one thing
// portaldesignspec §1.4/§3.1 says the PM MUST retain: the register of WHO the Builder has
// engaged and HOW MUCH is committed/owed to each, so the PM can exercise step-in rights if
// the Builder fails. Owner ruling (2026-08-01) resolves the §1.4-vs-§7.2.1 conflict: the PM
// sees the register (who / committed / owed) but NEVER the PO/invoice line detail.
//
// This is that SEPARATE, aggregate-only view — per-subcontractor identity + committed /
// invoiced / outstanding TOTALS. It returns no rows, no line items, no rates, no margins, so
// the existing full-hide on listPurchaseOrders/listSupplierInvoices stays exactly as built.
// Consent (§7.2.1) is NOT re-checked: that gate protects LINE-level rate attribution (which
// reveals margin) in the cost_plus row-lists; this register carries none of it. The per-sub
// totals do let a PM infer the Builder's cost base against the head contract — that is the
// deliberate, owner-ruled trade-off of step-in rights over margin privacy, not a leak.
async function subcontractorRegister({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read or po.write', 403);

  // Identity: every subcontractor the Builder has engaged on this project (who).
  const [subs] = await pool.query(
    `SELECT id AS engagement_id, subcontractor_name, trade, subcontractor_user_id
       FROM subcontractor_engagements
      WHERE org_id = ? AND project_id = ?
      ORDER BY subcontractor_name`,
    [orgId, projectId]
  );
  if (subs.length === 0) return { subcontractor_register: [] };

  // Committed (Σ Builder PO, issued/received) and invoiced (Σ Builder invoice, matched/
  // approved), grouped by engagement — AGGREGATES only, never the underlying rows.
  const [poAgg] = await pool.query(
    `SELECT subcontractor_engagement_id AS eid, COALESCE(SUM(amount),0) AS committed
       FROM purchase_orders
      WHERE org_id = ? AND project_id = ? AND is_deleted = 0 AND owner_party = 'builder'
        AND subcontractor_engagement_id IS NOT NULL AND status IN ('issued','received')
      GROUP BY subcontractor_engagement_id`,
    [orgId, projectId]
  );
  const [invAgg] = await pool.query(
    `SELECT subcontractor_engagement_id AS eid, COALESCE(SUM(amount),0) AS invoiced
       FROM supplier_invoices
      WHERE org_id = ? AND project_id = ? AND is_deleted = 0 AND owner_party = 'builder'
        AND subcontractor_engagement_id IS NOT NULL AND status IN ('matched','approved')
      GROUP BY subcontractor_engagement_id`,
    [orgId, projectId]
  );
  const committedBy = new Map(poAgg.map((r) => [r.eid, Number(r.committed)]));
  const invoicedBy  = new Map(invAgg.map((r) => [r.eid, Number(r.invoiced)]));

  const register = subs.map((s) => {
    const committed = committedBy.get(s.engagement_id) || 0;
    const invoiced  = invoicedBy.get(s.engagement_id) || 0;
    return {
      engagement_id: s.engagement_id,
      subcontractor_name: s.subcontractor_name,
      trade: s.trade,
      is_platform_user: !!s.subcontractor_user_id,   // raw user id is not exposed — identity is name/trade
      committed_amount: committed,
      invoiced_amount: invoiced,
      outstanding_amount: committed - invoiced,       // §1.4 "owed": remaining committed liability
    };
  });
  return { subcontractor_register: register };
}

module.exports = {
  createSupplier, listSuppliers,
  createPurchaseOrder, setPoStatus, listPurchaseOrders,
  createSupplierInvoice, setInvoiceStatus, listSupplierInvoices,
  subcontractorRegister,
  recomputeStageCommitted, recomputeStageActual,
  PO_COMMITTED, INV_ACTUAL,
  // exported for tests
  applyVisibility, partyForRole,
};
