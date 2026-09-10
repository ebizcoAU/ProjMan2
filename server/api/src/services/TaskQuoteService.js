// TaskQuoteService — external cost for outsourced tasks (xprojman-39 §3,
// migration v043). raise (po.write) → approve/decline (quotes.approve) →
// on approve, a real purchase_orders row is raised through the EXISTING
// ProcurementService.createPurchaseOrder (same flow a manual PO-raise
// already uses) rather than task_quotes feeding §2's rollup directly —
// once approved, it IS a PO, and every existing committed_amount/visibility
// rule (§7.2.1) already knows how to treat one.
//
// Deliberately a SEPARATE table from purchase_orders (confirmed §3.2): a
// 'pending' quote sitting in the same table/status enum PO's own
// committed-amount rollups already trust would be a live footgun for the
// next copy-pasted `status IN ('issued','received')` WHERE clause.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const access = require('../lib/access');
const ProjectService = require('./ProjectService');
const ProcurementService = require('./ProcurementService');

const canWrite = (role) => access.hasPermission(role, 'po.write');
const canApprove = (role) => access.hasPermission(role, 'quotes.approve');
const canRead = (role) => access.hasPermission(role, 'money.read') || access.hasPermission(role, 'po.write');

async function assertOutsourcedTask(orgId, projectId, taskId) {
  const [[task]] = await pool.query(
    'SELECT id, is_outsourced FROM tasks WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [taskId, projectId, orgId]
  );
  if (!task) throw new ServiceError('VALIDATION_ERROR', 'task_id not found on this project', 422);
  if (!task.is_outsourced) {
    throw new ServiceError('VALIDATION_ERROR', 'A quote can only be raised against an outsourced task (is_outsourced)', 422);
  }
}

async function loadQuote({ orgId, projectId, quoteId }) {
  const [[quote]] = await pool.query(
    'SELECT * FROM task_quotes WHERE id = ? AND project_id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
    [quoteId, projectId, orgId]
  );
  if (!quote) throw new ServiceError('NOT_FOUND', 'Task quote not found', 404);
  return quote;
}

/** POST /projects/:id/task-quotes (po.write) — phase 2: record a quote received. */
async function raise({ orgId, projectId, actor, taskId, supplierName, amount, validUntil, documentId }) {
  if (!canWrite(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: po.write', 403);
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!supplierName || !String(supplierName).trim()) throw new ServiceError('VALIDATION_ERROR', 'supplier_name is required', 400);
  if (!(Number(amount) > 0)) throw new ServiceError('VALIDATION_ERROR', 'amount must be a positive number', 400);
  await assertOutsourcedTask(orgId, projectId, taskId);

  const id = uuidv4();
  await pool.query(
    `INSERT INTO task_quotes
       (id, org_id, project_id, task_id, supplier_name, amount, valid_until, document_id, raised_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, projectId, taskId, String(supplierName).trim(), amount, validUntil || null, documentId || null, actor.userId]
  );
  return { id, status: 'pending' };
}

/**
 * POST /projects/:id/task-quotes/:quoteId/approve { accept } (quotes.approve, phases 3-4).
 * On accept, raises a real purchase_orders row through the existing procurement flow
 * and links it back — task_quotes never grows its own committed-cost rollup.
 */
async function approve({ orgId, projectId, quoteId, actor, accept = true }) {
  if (!canApprove(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: quotes.approve', 403);
  const quote = await loadQuote({ orgId, projectId, quoteId });
  if (quote.status !== 'pending') {
    throw new ServiceError('ALREADY_RESOLVED', `This quote is already ${quote.status}`, 409);
  }

  if (!accept) {
    await pool.query(
      'UPDATE task_quotes SET status = \'declined\', approved_by = ?, approved_at = NOW() WHERE id = ? AND org_id = ?',
      [actor.userId, quoteId, orgId]
    );
    return { id: quoteId, status: 'declined' };
  }

  const [[task]] = await pool.query('SELECT stage_id FROM tasks WHERE id = ? AND org_id = ? LIMIT 1', [quote.task_id, orgId]);
  const po = await ProcurementService.createPurchaseOrder({
    orgId, projectId, actor,
    stageId: task?.stage_id || null, taskId: quote.task_id,
    supplierName: quote.supplier_name, description: `Approved quote (${quoteId})`,
    amount: quote.amount,
  });
  await pool.query(
    `UPDATE task_quotes
        SET status = 'approved', approved_by = ?, approved_at = NOW(), purchase_order_id = ?
      WHERE id = ? AND org_id = ?`,
    [actor.userId, po.id, quoteId, orgId]
  );
  return { id: quoteId, status: 'approved', purchase_order_id: po.id, po_number: po.po_number };
}

/** GET /projects/:id/task-quotes — money.read | po.write, same tier as purchase_orders. */
async function listQuotes({ orgId, projectId, actor }) {
  await ProjectService.assertProjectReachable(orgId, projectId, { role: actor.role, userId: actor.userId });
  if (!canRead(actor.role)) throw new ServiceError('FORBIDDEN', 'Requires permission: money.read or po.write', 403);
  const [rows] = await pool.query(
    `SELECT * FROM task_quotes WHERE project_id = ? AND org_id = ? AND is_deleted = 0
      ORDER BY created_at DESC`,
    [projectId, orgId]
  );
  return { task_quotes: rows };
}

module.exports = { raise, approve, listQuotes };
