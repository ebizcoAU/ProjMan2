// Mounted at /admin — the System Admin dashboard (dashboardspec §7, §2/§3 addendum).
//
// SINGLE TIER: every route requires the `platform_admins` allowlist (adminAuthenticate).
// Within that tier, migration_v011 adds three admin-team roles (`admin_role` —
// admin/account/staff), each route further gated by `requireAdminRole(...)`. Cross-
// tenant by design; ACCOUNT & BILLING layer ONLY — no route here returns a project,
// stage, task, or any construction content. Writes (account actions, billing) are
// audited; `?org_id=` is a view filter, never a security boundary.

const router = require('express').Router();
const { body, query, validationResult } = require('express-validator');

const { adminAuthenticate, requireAdminRole } = require('../middleware/adminAuth');
const { sendError } = require('../services/errors');
const { audit } = require('../lib/audit');
const AdminService = require('../services/AdminService');
const BillingService = require('../services/BillingService');
const FinanceService = require('../services/FinanceService');

router.use(adminAuthenticate);

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}
const wrap = (fn) => async (req, res) => { try { return res.json({ success: true, data: await fn(req) }); } catch (e) { return sendError(res, e); } };

// Admin-team roles (migration_v011): admin (full) · account (money + user actions) ·
// staff (user actions + login-log). Each route lists every role that may reach it —
// no implicit superset, so the list is the whole story at each line.
const anyAdminRole  = requireAdminRole('admin', 'account', 'staff');
const canMoney       = requireAdminRole('admin', 'account');
const canUserActions = requireAdminRole('admin', 'account', 'staff');
const canLoginLog    = requireAdminRole('admin', 'staff');
const adminOnly      = requireAdminRole('admin');

// Who am I — the dashboard nav gates itself on this (no role hard-coded client-side).
router.get('/me', wrap((req) => ({ userId: req.admin.userId, role: req.admin.role })));

// ── Stats & directory ─────────────────────────────────────────
router.get('/stats', anyAdminRole, wrap(() => AdminService.stats()));
router.get('/stats/activity', anyAdminRole, [query('hours').optional().isInt({ min: 1, max: 168 })],
  wrap((req) => AdminService.hourlyTraffic({ hours: req.query.hours })));
router.get('/orgs', canMoney,
  [query('page').optional().isInt({ min: 1 }), query('sort_by').optional().isString(),
   query('sort_dir').optional().isIn(['asc', 'desc']), query('limit').optional().isInt({ min: 1, max: 200 }),
   query('search').optional().isString()],
  wrap((req) => AdminService.listOrgs({
    page: req.query.page, sortBy: req.query.sort_by, sortDir: req.query.sort_dir, limit: req.query.limit || 25,
    search: req.query.search,
  })));
router.get('/orgs/:id', canMoney, wrap((req) => AdminService.getOrg(req.params.id)));
router.get('/system/health', adminOnly, wrap(() => AdminService.systemHealth()));

// ── User accounts ─────────────────────────────────────────────
// Browsing the full cross-tenant account list (names, emails, orgs) is `admin`-only
// — `account`/`staff` keep the ACTION below (they still enable/disable/force-logout),
// just not a directory to browse it from; they act on an id they already have (e.g.
// from a support ticket), never a general list/search.
router.get('/users', adminOnly,
  [query('role').optional().isString(), query('status').optional().isIn(['active', 'suspended', 'disabled']),
   query('org_id').optional().isString(), query('page').optional().isInt({ min: 1 }),
   query('scope').optional().isIn(['internal', 'tenant']),
   query('sort_by').optional().isString(), query('sort_dir').optional().isIn(['asc', 'desc']),
   query('limit').optional().isInt({ min: 1, max: 200 }), query('search').optional().isString()],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await AdminService.listUsers({
        orgId: req.query.org_id, role: req.query.role, status: req.query.status,
        scope: req.query.scope, sortBy: req.query.sort_by, sortDir: req.query.sort_dir,
        page: req.query.page || 1, limit: req.query.limit || 25, search: req.query.search,
      });
      return res.json({ success: true, data });
    } catch (err) { return sendError(res, err); }
  }
);

// Account actions — user-account layer only (suspend/reactivate/force-logout).
router.post('/users/:id/:action(suspend|reactivate|force-logout)', canUserActions, async (req, res) => {
  try {
    const result = await AdminService.userAction({ userId: req.params.id, action: req.params.action });
    await audit(req, `admin.user.${req.params.action}`, {
      entity: 'users', entityId: req.params.id, detail: { by_platform_admin: req.admin.userId },
    });
    return res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

// ── Devices ───────────────────────────────────────────────────
router.get('/devices', adminOnly,
  [query('status').optional().isString(), query('role').optional().isString(),
   query('org_id').optional().isString(), query('page').optional().isInt({ min: 1 }),
   query('sort_by').optional().isString(), query('sort_dir').optional().isIn(['asc', 'desc']),
   query('limit').optional().isInt({ min: 1, max: 200 }), query('search').optional().isString()],
  wrap((req) => AdminService.listDevices({
    orgId: req.query.org_id, status: req.query.status, role: req.query.role,
    sortBy: req.query.sort_by, sortDir: req.query.sort_dir,
    page: req.query.page || 1, limit: req.query.limit || 25, search: req.query.search,
  })));

// ── Login transaction log ─────────────────────────────────────
router.get('/logs/login', canLoginLog,
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
router.get('/logs/login/export', canLoginLog, async (req, res) => {
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
router.get('/billing/subscriptions', canMoney,
  [query('status').optional().isString(), query('page').optional().isInt({ min: 1 })],
  wrap((req) => BillingService.listSubscriptions({ status: req.query.status, page: req.query.page || 1 })));

router.get('/billing/revenue', canMoney, wrap(() => BillingService.revenue()));

// One org's payment transactions — the Organisation drill-down page's billing tab.
router.get('/orgs/:id/payments', canMoney,
  [query('page').optional().isInt({ min: 1 }), query('limit').optional().isInt({ min: 1, max: 200 })],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const data = await BillingService.listPayments({
        orgId: req.params.id, page: req.query.page || 1, limit: req.query.limit || 25,
      });
      await audit(req, 'admin.billing.view_payments', { orgId: req.params.id, detail: { by_platform_admin: req.admin.userId } });
      return res.json({ success: true, data });
    } catch (err) { return sendError(res, err); }
  }
);

router.post('/billing/payments', canMoney,
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

router.patch('/orgs/:id/plan', canMoney,
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

// ── Finance — eBizco's own books (migration v031). Money-tier gating, same as
// billing above: this is P&L/payroll/expenses, not a route any tenant ever reaches.
router.get('/finance/accounts', canMoney, wrap(() => FinanceService.listAccounts()));

router.get('/finance/expenses', canMoney,
  [query('page').optional().isInt({ min: 1 }), query('limit').optional().isInt({ min: 1, max: 200 })],
  wrap((req) => FinanceService.listExpenses({ page: req.query.page || 1, limit: req.query.limit || 25 })));

router.post('/finance/expenses', canMoney,
  [
    body('account_id').trim().notEmpty(),
    body('description').trim().notEmpty(),
    body('amount').isFloat({ gt: 0 }),
    body('tax').optional().isFloat({ min: 0 }),
    body('incurred_at').optional().isISO8601(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await FinanceService.createExpense({
        accountId: req.body.account_id, description: req.body.description,
        amount: req.body.amount, tax: req.body.tax, incurredAt: req.body.incurred_at,
        createdBy: req.admin.userId,
      });
      await audit(req, 'admin.finance.expense', { entity: 'fin_expenses', entityId: result.id, detail: { amount: req.body.amount } });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.get('/finance/staff', canMoney,
  [query('status').optional().isIn(['active', 'inactive'])],
  wrap((req) => FinanceService.listStaff({ status: req.query.status })));

router.post('/finance/staff', canMoney,
  [
    body('full_name').trim().notEmpty(),
    body('pay_type').optional().isIn(['hourly', 'salary']),
    body('rate').optional().isFloat({ min: 0 }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await FinanceService.createStaff({
        fullName: req.body.full_name, roleTitle: req.body.role_title,
        payType: req.body.pay_type, rate: req.body.rate, userId: req.body.user_id,
      });
      await audit(req, 'admin.finance.staff_add', { entity: 'fin_staff', entityId: result.id, detail: { full_name: req.body.full_name } });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.get('/finance/payroll', canMoney,
  [query('page').optional().isInt({ min: 1 })],
  wrap((req) => FinanceService.listPayroll({ page: req.query.page || 1 })));

router.post('/finance/payroll', canMoney,
  [
    body('staff_id').trim().notEmpty(),
    body('period_start').isISO8601(), body('period_end').isISO8601(),
    body('items').optional().isArray(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    try {
      const result = await FinanceService.createPayrollRun({
        staffId: req.body.staff_id, periodStart: req.body.period_start, periodEnd: req.body.period_end,
        items: (req.body.items || []).map((i) => ({ workDate: i.work_date, hours: i.hours, rateFactor: i.rate_factor })),
        allowance: req.body.allowance, tax: req.body.tax, superAmount: req.body.super_amount,
        createdBy: req.admin.userId,
      });
      await audit(req, 'admin.finance.payroll_create', { entity: 'fin_payroll', entityId: result.id, detail: { staff_id: req.body.staff_id } });
      return res.status(201).json({ success: true, data: result });
    } catch (err) { return sendError(res, err); }
  }
);

router.post('/finance/payroll/:id/pay', canMoney, async (req, res) => {
  try {
    const result = await FinanceService.markPayrollPaid({ payrollId: req.params.id });
    await audit(req, 'admin.finance.payroll_pay', { entity: 'fin_payroll', entityId: req.params.id });
    return res.json({ success: true, data: result });
  } catch (err) { return sendError(res, err); }
});

router.get('/finance/reports/pnl', canMoney,
  [
    query('from').optional().isISO8601(), query('to').optional().isISO8601(),
    query('gst_mode').optional().isIn(['inclusive', 'exclusive']),
  ],
  wrap((req) => FinanceService.profitAndLoss({
    from: req.query.from, to: req.query.to, gstMode: req.query.gst_mode,
  })));

router.get('/finance/reports/balance-sheet', canMoney,
  [query('as_of').optional().isISO8601()],
  wrap((req) => FinanceService.balanceSheet({ asOf: req.query.as_of })));

module.exports = router;
