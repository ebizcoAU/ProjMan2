// Mounted at /admin — the System Admin dashboard (dashboardspec §7).
//
// SINGLE TIER: every route requires the `platform_admins` allowlist (adminAuthenticate).
// Cross-tenant by design; ACCOUNT & BILLING layer ONLY — no route here returns a
// project, stage, task, or any construction content. Writes (account actions, billing)
// are audited; `?org_id=` is a view filter, never a security boundary.

const router = require('express').Router();
const { body, query, validationResult } = require('express-validator');

const { adminAuthenticate } = require('../middleware/adminAuth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const AdminService = require('../services/AdminService');
const BillingService = require('../services/BillingService');

router.use(adminAuthenticate);

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}
const wrap = (fn) => async (req, res) => { try { return res.json({ success: true, data: await fn(req) }); } catch (e) { return sendError(res, e); } };

// ── Stats & directory ─────────────────────────────────────────
router.get('/stats', wrap(() => AdminService.stats()));
router.get('/orgs', [query('page').optional().isInt({ min: 1 })],
  wrap((req) => AdminService.listOrgs({ page: req.query.page })));
router.get('/system/health', wrap(() => AdminService.systemHealth()));

// ── User accounts ─────────────────────────────────────────────
router.get('/users',
  [query('role').optional().isString(), query('status').optional().isIn(['active', 'suspended', 'disabled']),
   query('org_id').optional().isString(), query('page').optional().isInt({ min: 1 })],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await AdminService.listUsers({
        orgId: req.query.org_id, role: req.query.role, status: req.query.status, page: req.query.page || 1,
      });
      return res.json({ success: true, data });
    } catch (err) { return sendError(res, err); }
  }
);

// Account actions — account layer only (suspend/reactivate/force-logout).
router.post('/users/:id/:action(suspend|reactivate|force-logout)', async (req, res) => {
  try {
    const result = await AdminService.userAction({ userId: req.params.id, action: req.params.action });
    await audit(req, `admin.user.${req.params.action}`, {
      entity: 'users', entityId: req.params.id, detail: { by_platform_admin: req.admin.userId },
    });
    return res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

// ── Devices ───────────────────────────────────────────────────
router.get('/devices',
  [query('status').optional().isString(), query('role').optional().isString(),
   query('org_id').optional().isString(), query('page').optional().isInt({ min: 1 })],
  wrap((req) => AdminService.listDevices({
    orgId: req.query.org_id, status: req.query.status, role: req.query.role, page: req.query.page || 1,
  })));

// ── Login transaction log ─────────────────────────────────────
router.get('/logs/login',
  [query('page').optional().isInt({ min: 1 }), query('outcome').optional().isIn(['success', 'failed'])],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const q = req.query;
      const data = await AdminService.loginLog({
        orgId: q.org_id, email: q.email, from: q.from, to: q.to,
        outcome: q.outcome, method: q.method, page: q.page || 1,
      });
      // Viewing one org's log is a scoped look at a tenant — audit it (accountability).
      if (q.org_id) {
        await audit(req, 'admin.logs.view', { orgId: q.org_id, detail: { by_platform_admin: req.admin.userId } });
      }
      return res.json({ success: true, data });
    } catch (err) { return sendError(res, err); }
  }
);

// CSV export of the login log (same filters).
router.get('/logs/login/export', async (req, res) => {
  try {
    const q = req.query;
    const { entries } = await AdminService.loginLog({
      orgId: q.org_id, email: q.email, from: q.from, to: q.to,
      outcome: q.outcome, method: q.method, page: 1, limit: 100000,
    });
    await audit(req, 'admin.logs.export', { orgId: q.org_id || null, detail: { rows: entries.length, by_platform_admin: req.admin.userId } });
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['at', 'action', 'outcome', 'email', 'organisation', 'method', 'ip', 'city', 'country', 'device', 'os'];
    const lines = [header.join(',')].concat(entries.map((e) => [
      e.at, e.action, e.outcome, e.email, e.organisation, e.method, e.ip,
      e.location?.city, e.location?.country, e.device, e.os,
    ].map(esc).join(',')));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="login-log.csv"');
    return res.send(lines.join('\n'));
  } catch (err) { return sendError(res, err); }
});

// ── Billing ───────────────────────────────────────────────────
router.get('/billing/subscriptions',
  [query('status').optional().isString(), query('page').optional().isInt({ min: 1 })],
  wrap((req) => BillingService.listSubscriptions({ status: req.query.status, page: req.query.page || 1 })));

router.get('/billing/revenue', wrap(() => BillingService.revenue()));

router.post('/billing/payments',
  [
    body('org_id').trim().notEmpty(),
    body('amount').isFloat({ gt: 0 }),
    body('status').optional().isIn(['paid', 'overdue', 'failed', 'refunded']),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await BillingService.recordPayment({
        orgId: req.body.org_id, amount: req.body.amount, method: req.body.method,
        period: req.body.period, status: req.body.status, note: req.body.note, recordedBy: req.admin.userId,
      });
      await audit(req, 'admin.billing.payment', { orgId: req.body.org_id, entity: 'payments', entityId: result.id, detail: { amount: req.body.amount, status: result.status } });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.patch('/orgs/:id/plan',
  [
    body('plan').optional().isIn(['trial', 'starter', 'builder', 'enterprise']),
    body('status').optional().isIn(['trial', 'active', 'past_due', 'cancelled']),
    body('amount').optional().isFloat({ min: 0 }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await BillingService.changePlan({
        orgId: req.params.id, plan: req.body.plan, status: req.body.status, amount: req.body.amount,
      });
      await audit(req, 'admin.billing.plan_change', { orgId: req.params.id, detail: req.body });
      return res.json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

module.exports = router;
