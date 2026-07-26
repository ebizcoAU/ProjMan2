// Admin (System Admin) authentication — the /admin/* gate (dashboardspec §2/§3).
//
// The dashboard is a SINGLE platform TIER — vs the tenant construction surface, a
// `projectManager` still has zero reach here, allowlist-only. Within that one tier,
// migration_v011 adds three admin-team ROLES (`admin_role`): `admin` (full access),
// `account` (money — billing/subscriptions/payments/plan changes — plus user account
// actions), `staff` (user account actions plus the login transaction log). This is a
// refinement of the allowlist, not a second tenant-facing tier.
//
// This composes the normal token `authenticate` (verify JWT, load the live user)
// with one extra check: is this user on the allowlist? Everyone else — including a
// `projectManager` who administers their own org in the portal — gets 403 here.
//
// Crucially, `/admin/*` is cross-tenant BY DESIGN: it does NOT apply the tenant
// `org_id`-from-token filter. Containment is the allowlist + the account/billing-only
// scope of the services (they never read construction content) + auditing of writes.

const pool = require('../db/pool');
const { authenticate } = require('./auth');

async function requirePlatformAdmin(req, res, next) {
  if (!req.auth?.userId) {
    return res.status(401).json({ success: false, message: 'Not authenticated', code: 'NO_AUTH' });
  }
  try {
    const [[row]] = await pool.query(
      'SELECT id, admin_role FROM platform_admins WHERE user_id = ? LIMIT 1',
      [req.auth.userId]
    );
    if (!row) {
      // Do not leak that this surface exists to non-admins beyond a plain 403.
      return res.status(403).json({ success: false, message: 'Platform administration access required', code: 'FORBIDDEN' });
    }
    req.admin = { userId: req.auth.userId, role: row.admin_role };
    return next();
  } catch (err) {
    console.error('[ADMIN AUTH] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Admin authentication failed', code: 'ADMIN_AUTH_ERROR' });
  }
}

/**
 * The admin-role enforcement primitive — same shape as the tenant `requirePermission`.
 * A route declares which admin_role(s) may reach it; `admin` should be listed
 * explicitly wherever it applies (there is no automatic superset here, to keep each
 * route's reachable-roles list self-documenting) — see routes/admin.js.
 */
function requireAdminRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.admin?.role)) {
      return res.status(403).json({
        success: false,
        message: `This action requires the ${roles.join(' or ')} admin role`,
        code: 'FORBIDDEN',
      });
    }
    return next();
  };
}

// The mount uses both, in order: verify the token, then require the allowlist.
const adminAuthenticate = [authenticate, requirePlatformAdmin];

module.exports = { adminAuthenticate, requirePlatformAdmin, requireAdminRole };
