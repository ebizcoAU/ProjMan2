// BillingService — SaaS billing: eBizco charging the tenant orgs (dashboardspec §5.4).
//
// This is NOT construction payments — it is subscription fees for ProjMan2 itself.
// `organisations` (plan, trial_ends_at) is the baseline; `subscriptions`/`payments`
// are the billing overlay the System Admin maintains (manual reconciliation in v1).
// The subscriptions view LEFT JOINs organisations so an org without an explicit
// subscription row still shows its trial — no migration backfill needed.

const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const FinanceService = require('./FinanceService');

// Every org, with its subscription row if present, else synthesised from the org's
// plan/trial baseline. `effective_status` is what the dashboard shows.
async function listSubscriptions({ status, page = 1, limit = 25 }) {
  const [rows] = await pool.query(
    `SELECT o.id AS org_id, o.name AS org_name, o.trial_ends_at, o.status AS org_status,
            COALESCE(s.plan, o.plan) AS plan,
            s.id AS subscription_id, s.status AS sub_status, s.amount, s.currency,
            s.period_start, s.period_end,
            CASE
              WHEN s.status IS NOT NULL THEN s.status
              WHEN o.trial_ends_at IS NOT NULL AND o.trial_ends_at < NOW() THEN 'past_due'
              WHEN o.plan = 'trial' THEN 'trial'
              ELSE 'active'
            END AS effective_status,
            (SELECT SUM(p.amount) FROM payments p WHERE p.org_id = o.id AND p.status = 'paid') AS paid_total,
            (SELECT COUNT(*) FROM payments p WHERE p.org_id = o.id AND p.status = 'overdue') AS overdue_count
       FROM organisations o
       LEFT JOIN subscriptions s ON s.org_id = o.id
      WHERE o.is_deleted = 0
      ORDER BY o.created_at DESC`
  );

  let list = rows.map((r) => ({
    orgId: r.org_id, orgName: r.org_name, plan: r.plan,
    status: r.effective_status,
    subscriptionId: r.subscription_id,
    amount: r.amount, currency: r.currency || 'AUD',
    periodStart: r.period_start, periodEnd: r.period_end,
    trialEndsAt: r.trial_ends_at,
    paidTotal: Number(r.paid_total) || 0,
    overdueCount: Number(r.overdue_count) || 0,
  }));
  if (status) list = list.filter((r) => r.status === status);

  const total = list.length;
  const start = (Number(page) - 1) * Number(limit);
  return {
    subscriptions: list.slice(start, start + Number(limit)),
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) || 1 },
  };
}

// Revenue + overdue chase list.
async function revenue() {
  const [[paid]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total,
            COALESCE(SUM(CASE WHEN paid_at >= NOW() - INTERVAL 30 DAY THEN amount END), 0) AS last30,
            COALESCE(SUM(CASE WHEN paid_at >= NOW() - INTERVAL 365 DAY THEN amount END), 0) AS last365
       FROM payments WHERE status = 'paid'`
  );
  // MRR ≈ sum of active subscription amounts.
  const [[mrr]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS mrr FROM subscriptions WHERE status = 'active'`
  );
  const [overdue] = await pool.query(
    `SELECT p.id, p.org_id, o.name AS org_name, p.amount, p.currency, p.period, p.created_at
       FROM payments p JOIN organisations o ON o.id = p.org_id
      WHERE p.status = 'overdue' ORDER BY p.created_at DESC LIMIT 100`
  );
  return {
    mrr: Number(mrr.mrr) || 0,
    revenue: { total: Number(paid.total), last30: Number(paid.last30), last365: Number(paid.last365) },
    overdue,
  };
}

// One org's payment transactions — the org drill-down's billing tab. `listSubscriptions`
// above is cross-org (one row per org); this is the reverse view, all transactions for
// the one org an admin clicked into.
async function listPayments({ orgId, page = 1, limit = 25 }) {
  const [[org]] = await pool.query('SELECT id, name FROM organisations WHERE id = ? AND is_deleted = 0 LIMIT 1', [orgId]);
  if (!org) throw new ServiceError('NOT_FOUND', 'Organisation not found', 404);

  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM payments WHERE org_id = ?', [orgId]);
  const [rows] = await pool.query(
    `SELECT p.id, p.amount, p.currency, p.status, p.method, p.period, p.paid_at, p.note,
            p.created_at, u.full_name AS recorded_by_name
       FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
      WHERE p.org_id = ?
      ORDER BY COALESCE(p.paid_at, p.created_at) DESC
      LIMIT ? OFFSET ?`,
    [orgId, Number(limit), (Number(page) - 1) * Number(limit)]
  );
  return {
    org: { id: org.id, name: org.name },
    payments: rows,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) || 1 },
  };
}

// Record a payment (manual reconciliation). Ensures a subscription exists.
async function recordPayment({ orgId, amount, method, period, status = 'paid', note, recordedBy }) {
  const [[org]] = await pool.query('SELECT id, plan FROM organisations WHERE id = ? AND is_deleted = 0 LIMIT 1', [orgId]);
  if (!org) throw new ServiceError('NOT_FOUND', 'Organisation not found', 404);
  if (!(amount > 0)) throw new ServiceError('VALIDATION_ERROR', 'A positive amount is required', 422);

  const [[sub]] = await pool.query('SELECT id FROM subscriptions WHERE org_id = ? LIMIT 1', [orgId]);
  let subId = sub?.id;
  if (!subId) {
    subId = uuidv4();
    await pool.query(
      `INSERT INTO subscriptions (id, org_id, plan, status, amount) VALUES (?, ?, ?, 'active', ?)`,
      [subId, orgId, org.plan === 'trial' ? 'starter' : org.plan, amount]
    );
  }
  const id = uuidv4();
  const paidAt = status === 'paid' ? new Date() : null;
  await pool.query(
    `INSERT INTO payments (id, org_id, subscription_id, amount, status, method, period, paid_at, note, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, subId, amount, status, method || 'manual', period || null, paidAt, note || null, recordedBy || null]
  );
  // Posts to eBizco's own Finance ledger (fin_journal, migration v031) — `payments`
  // stays the primary record of what a tenant paid; this is the derived bookkeeping
  // mirror the P&L/Balance Sheet reports read. Non-fatal: the payment itself is
  // already committed, same posture as AttestationService's other cross-cutting
  // side-effect emissions elsewhere in this codebase.
  if (status === 'paid') {
    FinanceService.postSubscriptionRevenue({ paymentId: id, amount, paidAt })
      .catch((err) => console.warn('[FINANCE] postSubscriptionRevenue failed (non-fatal):', err.message));
  }
  return { id, orgId, amount, status };
}

// Change an org's plan/subscription status.
async function changePlan({ orgId, plan, status, amount }) {
  const [[org]] = await pool.query('SELECT id FROM organisations WHERE id = ? AND is_deleted = 0 LIMIT 1', [orgId]);
  if (!org) throw new ServiceError('NOT_FOUND', 'Organisation not found', 404);

  const [[sub]] = await pool.query('SELECT id FROM subscriptions WHERE org_id = ? LIMIT 1', [orgId]);
  if (sub) {
    const sets = [], params = [];
    if (plan)   { sets.push('plan = ?');   params.push(plan); }
    if (status) { sets.push('status = ?'); params.push(status); }
    if (amount !== undefined) { sets.push('amount = ?'); params.push(amount); }
    if (sets.length) {
      await pool.query(`UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ?`, [...params, sub.id]);
    }
  } else {
    await pool.query(
      `INSERT INTO subscriptions (id, org_id, plan, status, amount) VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), orgId, plan || 'starter', status || 'active', amount ?? null]
    );
  }
  // Keep the org's own plan column in step (it's the baseline the tenant surface reads).
  if (plan) await pool.query('UPDATE organisations SET plan = ? WHERE id = ?', [plan, orgId]);
  return { orgId, plan, status };
}

module.exports = { listSubscriptions, revenue, listPayments, recordPayment, changePlan };
