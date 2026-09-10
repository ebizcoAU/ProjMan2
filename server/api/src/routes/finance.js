// Mounted at /finance — per-tenant chart of accounts (xprojman-42 §2,
// migration v042). Not /accounts (already taken — routes/accounts.js is the
// org-level BAS/TPAR/depreciation surface, a different table entirely) and
// not /admin/finance (that's eBizco's OWN books, FinanceService.js, platform-
// admin only). §3's journal + P&L/Balance Sheet/Expenses/Sales read screens
// are NOT built yet — this file is the accounts tree only.
//
//   GET   /finance/accounts        chart of accounts, seeded lazily on first
//                                   read (money.read)
//   POST  /finance/accounts        add an account                (finance.manage)
//   PATCH /finance/accounts/:id    rename/activate/re-parent      (finance.manage)

const router = require('express').Router();
const { body, validationResult } = require('express-validator');

const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const OrgFinanceService = require('../services/OrgFinanceService');

router.use(authenticate);

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

router.get('/accounts', async (req, res) => {
  try {
    const data = await OrgFinanceService.listAccounts({ orgId: req.auth.orgId, actor: { role: req.auth.role } });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/accounts',
  [
    body('code').trim().notEmpty().withMessage('code is required'),
    body('name').trim().notEmpty().withMessage('name is required'),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await OrgFinanceService.createAccount({
        orgId: req.auth.orgId, actor: { role: req.auth.role },
        parentId: req.body.parent_id || null, code: req.body.code, name: req.body.name,
        accType: req.body.acc_type,
      });
      await audit(req, 'org_account.create', { entity: 'org_accounts', entityId: result.id, detail: result });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.patch(
  '/accounts/:id',
  [
    body('name').optional().trim().notEmpty(),
    body('is_active').optional().isBoolean(),
    body('parent_id').optional({ nullable: true }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await OrgFinanceService.updateAccount({
        orgId: req.auth.orgId, actor: { role: req.auth.role }, accountId: req.params.id,
        name: req.body.name, isActive: req.body.is_active, parentId: req.body.parent_id,
      });
      await audit(req, 'org_account.update', { entity: 'org_accounts', entityId: req.params.id, detail: result });
      return res.json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

module.exports = router;
