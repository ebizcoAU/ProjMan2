// Mounted at /cost-centres — the org-level cost-centre master list (xprojman-39
// §2, confirmed §6 response: same fixed-list shape as `suppliers`, not project-
// level free text). Org-shared, not project-scoped — a code/name pair is not
// sensitive; what's costed against it lives on the task row (money-gated there).
//   GET  /cost-centres        list (any authenticated org member)
//   POST /cost-centres        add a cost centre (money.write)

const router = require('express').Router();
const { body, validationResult } = require('express-validator');

const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const CostingService = require('../services/CostingService');

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
    const data = await CostingService.listCostCentres({ orgId: req.auth.orgId });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/',
  [
    body('code').trim().notEmpty().withMessage('code is required'),
    body('name').trim().notEmpty().withMessage('name is required'),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await CostingService.createCostCentre({
        orgId: req.auth.orgId, actor: { role: req.auth.role },
        code: req.body.code, name: req.body.name,
      });
      await audit(req, 'cost_centre.create', { entity: 'cost_centres', entityId: result.id, detail: result });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

module.exports = router;
