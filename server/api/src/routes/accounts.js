// Mounted at /accounts — org-level accounting artifacts (serverdesignspec §11.3). Transport only;
// the rules live in services/TaxService.js.
//
//   GET  /accounts/bas                  list BAS periods                 (accounts.read)
//   POST /accounts/bas/prepare          classify + roll up a quarter     (accounts.read)
//   GET  /accounts/bas/:id              one period's cached figures      (accounts.read)
//   POST /accounts/bas/:id/lodge        lock it                          (tax.approve)
//   GET  /accounts/bas/:id/export       BAS worksheet + txn listing CSV  (accounts.read)
//   GET  /accounts/tpar                 list TPAR reports                (accounts.read)
//   POST /accounts/tpar/prepare         snapshot an FY's payee lines     (accounts.read)
//   GET  /accounts/tpar/:id             report + its lines               (accounts.read)
//   POST /accounts/tpar/:id/lodge       lock it                          (tax.approve)
//   GET  /accounts/tpar/:id/export      contractor-payments listing CSV  (accounts.read)
//   GET  /accounts/depreciation/export  approved-asset schedule CSV      (accounts.read)
//
// These are ORG-level, not project-level: `accounts.read` exists precisely because `money.read`
// is project-scoped (§9.4) and a BAS is a whole-of-entity aggregate (decision #13). There is no
// projectScope narrowing here by design — an org's BAS covers every job in it.
//
// P8c will add /accounts/tpar alongside; the depreciation export lands here too rather than under
// /projects/:id, for the same whole-of-entity reason.

const router = require('express').Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');

const { authenticate, requirePermission } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const TaxService = require('../services/TaxService');
const TparService = require('../services/TparService');
const DepreciationService = require('../services/DepreciationService');

router.use(authenticate);

// requirePermission resolves via access.grants, so if `accounts.read` is ever added to
// OWNER_CAPABILITIES (open decision #18 — the Builder-founder case), these gates pick it up
// with no change here.
const canReadAccounts = requirePermission('accounts.read');
const canApproveTax   = requirePermission('tax.approve');

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

const actorOf = (req) => ({ role: req.auth.role, userId: req.auth.userId, isOrgOwner: req.auth.isOrgOwner });

router.get('/bas', canReadAccounts, async (req, res) => {
  try {
    const data = await TaxService.listPeriods({ orgId: req.auth.orgId, actor: actorOf(req) });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/bas/prepare',
  canReadAccounts,
  [
    body('period_start').notEmpty().withMessage('period_start is required (YYYY-MM-DD)'),
    body('basis').optional().isIn(['accrual', 'cash']),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await TaxService.prepareBas({
        orgId: req.auth.orgId, actor: actorOf(req),
        periodStart: req.body.period_start, basis: req.body.basis || 'accrual',
      });
      await audit(req, 'bas.prepare', {
        entity: 'tax_periods', entityId: result.id,
        detail: { period_start: result.period_start, net_gst: result.net_gst },
      });
      return res.json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

// Registered AFTER /bas/prepare so the literal path is not swallowed by :id.
router.get('/bas/:id', canReadAccounts, async (req, res) => {
  try {
    const data = await TaxService.getPeriod({
      orgId: req.auth.orgId, periodId: req.params.id, actor: actorOf(req) });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post('/bas/:id/lodge', canApproveTax, async (req, res) => {
  try {
    const result = await TaxService.lodgeBas({
      orgId: req.auth.orgId, periodId: req.params.id, actor: actorOf(req) });
    await audit(req, 'bas.lodge', {
      entity: 'tax_periods', entityId: req.params.id, detail: { status: result.status },
    });
    return res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

router.get('/bas/:id/export', canReadAccounts, async (req, res) => {
  try {
    const { filename, csv } = await TaxService.exportBas({
      orgId: req.auth.orgId, periodId: req.params.id, actor: actorOf(req) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) { return sendError(res, err); }
});

// ── P8c TPAR ─────────────────────────────────────────────────────────────────────────────────
router.get('/tpar', canReadAccounts, async (req, res) => {
  try {
    const data = await TparService.listReports({ orgId: req.auth.orgId, actor: actorOf(req) });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post(
  '/tpar/prepare',
  canReadAccounts,
  [body('fy').notEmpty().withMessage("fy is required (e.g. '2025-26')")],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await TparService.prepare({
        orgId: req.auth.orgId, actor: actorOf(req), fy: req.body.fy });
      await audit(req, 'tpar.prepare', {
        entity: 'tpar_reports', entityId: result.id,
        detail: { fy: result.fy, payees: result.payee_count, missing_abn: result.missing_abn },
      });
      return res.json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

// Registered AFTER /tpar/prepare so the literal path is not swallowed by :id.
router.get('/tpar/:id', canReadAccounts, async (req, res) => {
  try {
    const data = await TparService.getReport({
      orgId: req.auth.orgId, reportId: req.params.id, actor: actorOf(req) });
    return res.json({ success: true, data });
  } catch (err) { return sendError(res, err); }
});

router.post('/tpar/:id/lodge', canApproveTax, async (req, res) => {
  try {
    const result = await TparService.lodge({
      orgId: req.auth.orgId, reportId: req.params.id, actor: actorOf(req) });
    await audit(req, 'tpar.lodge', {
      entity: 'tpar_reports', entityId: req.params.id, detail: { status: result.status },
    });
    return res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

router.get('/tpar/:id/export', canReadAccounts, async (req, res) => {
  try {
    const { filename, csv } = await TparService.exportTpar({
      orgId: req.auth.orgId, reportId: req.params.id, actor: actorOf(req) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) { return sendError(res, err); }
});

// ── P8a depreciation export (the (b1) hand-off file) ─────────────────────────────────────────
router.get('/depreciation/export', canReadAccounts, async (req, res) => {
  try {
    const { filename, csv } = await DepreciationService.exportDepreciation({
      orgId: req.auth.orgId, actor: actorOf(req), fy: req.query.fy });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) { return sendError(res, err); }
});

module.exports = router;
