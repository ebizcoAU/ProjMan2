// Mounted at /customers — transport only. The rules live in services/CustomerService.js.
//
//   GET   /customers        list (with project counts)
//   POST  /customers        create  (org_admin | project_developer)
//   PATCH /customers/:id    update  (org_admin | project_developer)
//
// Desk-configured (projman-01 §4): the console owns customers; the field app reads
// them through /sync/pull. No delete endpoint — soft-delete via PATCH later if the
// app team wants it; a customer with projects should never vanish.

const router = require('express').Router();
const { body, validationResult } = require('express-validator');

const { authenticate, requireRole } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const CustomerService = require('../services/CustomerService');

router.use(authenticate);

const canEdit = requireRole('org_admin', 'project_developer');

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

// ── GET /customers ────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const data = await CustomerService.listCustomers({ orgId: req.auth.orgId });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

// ── POST /customers ───────────────────────────────────────────
router.post(
  '/',
  canEdit,
  [
    body('name').trim().notEmpty().withMessage('A customer name is required'),
    body('email').optional({ nullable: true, checkFalsy: true }).isEmail(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const { id } = await CustomerService.createCustomer({ orgId: req.auth.orgId, data: req.body });
      await audit(req, 'customer.create', {
        entity: 'customers', entityId: id, detail: { name: req.body.name },
      });
      return res.status(201).json({ success: true, data: { id } });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// ── PATCH /customers/:id ──────────────────────────────────────
router.patch(
  '/:id',
  canEdit,
  [
    body('name').optional().trim().notEmpty(),
    body('email').optional({ nullable: true, checkFalsy: true }).isEmail(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      await CustomerService.updateCustomer({ orgId: req.auth.orgId, id: req.params.id, data: req.body });
      await audit(req, 'customer.update', {
        entity: 'customers', entityId: req.params.id, detail: { fields: Object.keys(req.body) },
      });
      return res.json({ success: true, data: { id: req.params.id } });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

module.exports = router;
