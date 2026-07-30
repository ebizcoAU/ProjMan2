// Mounted at /suppliers — the org-level vendor master (P7b Procurement, xprojman-16).
// Org-shared, NOT engagement-redacted: a supplier NAME is not sensitive; §7.2.1 protects
// which supplier the Builder used for what amount, which lives on the PO/invoice rows
// (project-scoped, filtered in ProcurementService), not here.
//   GET  /suppliers        list (money.read or po.write)
//   POST /suppliers        add a supplier (po.write)

const router = require('express').Router();
const { body, validationResult } = require('express-validator');

const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const ProcurementService = require('../services/ProcurementService');

router.use(authenticate);

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

router.get('/', async (req, res) => {
  try {
    const data = await ProcurementService.listSuppliers({
      orgId: req.auth.orgId, actor: { userId: req.auth.userId, role: req.auth.role },
    });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('name is required'),
    body('abn').optional({ nullable: true }).isString(),
    body('contact').optional({ nullable: true }).isString(),
    body('email').optional({ nullable: true }).isString(),
    body('phone').optional({ nullable: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await ProcurementService.createSupplier({
        orgId: req.auth.orgId, actor: { userId: req.auth.userId, role: req.auth.role },
        name: req.body.name, abn: req.body.abn, contact: req.body.contact,
        email: req.body.email, phone: req.body.phone,
      });
      await audit(req, 'supplier.create', { entity: 'suppliers', entityId: result.id, detail: { name: result.name } });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

module.exports = router;
