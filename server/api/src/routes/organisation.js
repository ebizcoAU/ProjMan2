// Mounted at /organisation
//
//   GET   /organisation           the caller's org
//   PATCH /organisation           update profile (org_admin)
//   GET   /organisation/users     the org's people
//   POST  /organisation/users     invite/create a user (org_admin)
//   PATCH /organisation/users/:id role and status (org_admin)
//   GET   /organisation/audit     the audit trail
//
// Adapted from Nexus `businesses.js` / `companies.js` / `subscriber.js`. Those three
// existed because FTPOS separated the subscriber (who pays), the business (which
// trades) and the site (where it happens). A builder is all three, so they collapse
// into one organisation — the tenant.
//
// There is no endpoint here that takes an org id. It is always the token's.

const router = require('express').Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { body, query, validationResult } = require('express-validator');

const pool   = require('../db/pool');
const config = require('../config');
const { authenticate, requireOrgAdmin } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { validateAbn } = require('../lib/abn');
const access = require('../lib/access');

// Assignability lives in the roles table now (§9.2): a role a user may be given must
// be is_assignable=1. The post-v1 four (construction_manager/estimator/subcontractor/
// labourer) are refused with ROLE_NOT_ASSIGNABLE until enabled, by data not by code.
function assertAssignable(res, role) {
  if (!access.roleMeta(role)) {
    res.status(422).json({ success: false, message: 'A valid role is required', code: 'VALIDATION_ERROR', field: 'role' });
    return false;
  }
  if (!access.isAssignable(role)) {
    res.status(403).json({ success: false, message: `The role "${role}" is not assignable in this version`, code: 'ROLE_NOT_ASSIGNABLE' });
    return false;
  }
  return true;
}

router.use(authenticate);

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

// ============================================================================
// GET /organisation
// ============================================================================
router.get('/', async (req, res) => {
  try {
    const [[org]] = await pool.query(
      `SELECT id, name, abn, abn_validated, abn_checked_at, address, suburb, state,
              postcode, phone, email, timezone, currency, plan, status, trial_ends_at,
              created_at
         FROM organisations WHERE id = ? LIMIT 1`,
      [req.auth.orgId]
    );

    const [[counts]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users   WHERE org_id = ? AND is_deleted = 0) AS users,
         (SELECT COUNT(*) FROM devices WHERE org_id = ? AND is_deleted = 0
                                         AND status = 'active')             AS devices`,
      [req.auth.orgId, req.auth.orgId]
    );

    return res.json({ success: true, data: { organisation: org, counts } });
  } catch (err) {
    console.error('[ORG/GET] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load organisation' });
  }
});

// ============================================================================
// PATCH /organisation
//
// Re-validating a changed ABN is not optional housekeeping: TPAR reports every
// contractor payment by ABN, and an org that silently changed to an invalid one
// produces a report that fails at lodgement, in July, under time pressure.
// ============================================================================
router.patch(
  '/',
  requireOrgAdmin,
  [
    body('name').optional().trim().notEmpty().withMessage('Organisation name cannot be blank'),
    body('abn').optional({ nullable: true }).isString(),
    body('state').optional({ nullable: true, checkFalsy: true })
      .isIn(['WA', 'SA', 'NT', 'QLD', 'NSW', 'VIC', 'TAS', 'ACT']),
    body('email').optional({ nullable: true, checkFalsy: true }).isEmail(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    const fields = {};
    for (const key of ['name', 'address', 'suburb', 'state', 'postcode', 'phone', 'email']) {
      if (req.body[key] !== undefined) fields[key] = req.body[key];
    }

    try {
      if (req.body.abn !== undefined) {
        const result = await validateAbn(req.body.abn);
        if (req.body.abn && result.level === 'no') {
          return res.status(422).json({
            success: false,
            message: 'That ABN is not valid. Check the 11 digits.',
            code: 'INVALID_ABN', field: 'abn',
          });
        }
        fields.abn = result.abn;
        fields.abn_validated = result.level;
        fields.abn_checked_at = new Date();
      }

      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ success: false, message: 'Nothing to update', code: 'NO_FIELDS' });
      }

      const columns = Object.keys(fields);
      await pool.query(
        `UPDATE organisations
            SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')},
                updated_at = ?, server_updated_at = NOW(3)
          WHERE id = ?`,
        [...Object.values(fields), Date.now(), req.auth.orgId]
      );

      await audit(req, 'organisation.updated', {
        entity: 'organisations', entityId: req.auth.orgId,
        detail: { fields: columns },
      });

      const [[org]] = await pool.query('SELECT * FROM organisations WHERE id = ?', [req.auth.orgId]);
      return res.json({ success: true, data: { organisation: org } });
    } catch (err) {
      console.error('[ORG/PATCH] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to update organisation' });
    }
  }
);

// ============================================================================
// GET /organisation/users
// ============================================================================
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.mobile, u.role, u.status, u.last_login_at,
              u.created_at,
              (SELECT COUNT(*) FROM devices d
                WHERE d.user_id = u.id AND d.status = 'active' AND d.is_deleted = 0) AS device_count
         FROM users u
        WHERE u.org_id = ? AND u.is_deleted = 0
        ORDER BY FIELD(u.role, ${access.allRoles().map(() => '?').join(', ')}), u.full_name`,
      [req.auth.orgId, ...access.allRoles()]
    );
    return res.json({ success: true, data: { users: rows } });
  } catch (err) {
    console.error('[ORG/USERS] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list users' });
  }
});

// ============================================================================
// POST /organisation/users
// ============================================================================
router.post(
  '/users',
  requireOrgAdmin,
  [
    body('email').isEmail().normalizeEmail().withMessage('A valid email address is required'),
    body('full_name').trim().notEmpty().withMessage('Full name is required'),
    body('role').notEmpty().withMessage('A role is required'),
    body('password').isLength({ min: config.password.minLength })
      .withMessage(`Password must be at least ${config.password.minLength} characters`),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    if (!assertAssignable(res, req.body.role)) return;

    try {
      const [[existing]] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [req.body.email]);
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'That email address already has an account.',
          code: 'DUPLICATE_EMAIL',
        });
      }

      const id = uuidv4();
      await pool.query(
        `INSERT INTO users (id, org_id, email, password_hash, full_name, mobile, role, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
          id, req.auth.orgId, req.body.email,
          await bcrypt.hash(String(req.body.password), config.password.bcryptCost),
          req.body.full_name, req.body.mobile || null, req.body.role,
        ]
      );

      await audit(req, 'user.created', {
        entity: 'users', entityId: id,
        detail: { role: req.body.role, email: req.body.email },
      });

      const [[user]] = await pool.query(
        `SELECT id, email, full_name, mobile, role, status, created_at FROM users WHERE id = ?`,
        [id]
      );
      return res.status(201).json({ success: true, data: { user } });
    } catch (err) {
      console.error('[ORG/USERS/CREATE] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to create user' });
    }
  }
);

// ============================================================================
// PATCH /organisation/users/:id
// ============================================================================
router.patch(
  '/users/:id',
  requireOrgAdmin,
  [
    body('role').optional().notEmpty(),
    body('status').optional().isIn(['active', 'suspended', 'disabled']),
  ],
  async (req, res) => {
    if (validation(req, res)) return;
    if (req.body.role !== undefined && !assertAssignable(res, req.body.role)) return;

    try {
      const [[target]] = await pool.query(
        `SELECT id, role, status FROM users WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
        [req.params.id, req.auth.orgId]
      );
      if (!target) {
        return res.status(404).json({ success: false, message: 'User not found', code: 'NOT_FOUND' });
      }

      // An org with nobody holding org.manage is an org nobody can administer, and
      // there is no self-service route back. Guard against demoting the last such
      // user — expressed as the permission, not a role literal, so it survives the
      // role model (any role that grants org.manage counts).
      const adminRoles = access.allRoles().filter((r) => access.hasPermission(r, 'org.manage'));
      const demotingSelf = target.id === req.auth.userId &&
        req.body.role && !adminRoles.includes(req.body.role);
      if (demotingSelf && adminRoles.length) {
        const placeholders = adminRoles.map(() => '?').join(', ');
        const [[{ n }]] = await pool.query(
          `SELECT COUNT(*) AS n FROM users
            WHERE org_id = ? AND role IN (${placeholders})
              AND status = 'active' AND is_deleted = 0`,
          [req.auth.orgId, ...adminRoles]
        );
        if (n <= 1) {
          return res.status(409).json({
            success: false,
            message: 'You are the only administrator. Promote someone else first.',
            code: 'LAST_ADMIN',
          });
        }
      }

      const fields = {};
      for (const key of ['role', 'status', 'full_name', 'mobile']) {
        if (req.body[key] !== undefined) fields[key] = req.body[key];
      }
      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ success: false, message: 'Nothing to update', code: 'NO_FIELDS' });
      }

      const columns = Object.keys(fields);
      await pool.query(
        `UPDATE users SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')},
                          updated_at = ?, server_updated_at = NOW(3)
          WHERE id = ? AND org_id = ?`,
        [...Object.values(fields), Date.now(), target.id, req.auth.orgId]
      );

      // Suspending or disabling somebody has to take their live sessions with it,
      // or they keep working until their token happens to expire.
      if (fields.status && fields.status !== 'active') {
        await pool.query(
          `UPDATE sessions SET revoked_at = NOW(), is_authoritative = 0
            WHERE user_id = ? AND revoked_at IS NULL`,
          [target.id]
        );
      }

      await audit(req, 'user.updated', {
        entity: 'users', entityId: target.id,
        detail: { from: { role: target.role, status: target.status }, to: fields },
      });

      const [[user]] = await pool.query(
        `SELECT id, email, full_name, mobile, role, status FROM users WHERE id = ?`,
        [target.id]
      );
      return res.json({ success: true, data: { user } });
    } catch (err) {
      console.error('[ORG/USERS/PATCH] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to update user' });
    }
  }
);

// ============================================================================
// DELETE /organisation/users/:id — Step D, servdesignspecification.md §7.6.
// Deactivation, NOT erasure: a hard DELETE is never correct for anyone who may have
// relied-upon project evidence attached (a verified tick, a signed diary entry, a
// hold-point sign-off) — and there is no cheap way to know in advance which users do
// and don't, so every deactivation follows the same four-step rule.
// ============================================================================
router.delete('/users/:id', requireOrgAdmin, async (req, res) => {
  try {
    const [[target]] = await pool.query(
      `SELECT id, role, status, deactivated_at FROM users WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
      [req.params.id, req.auth.orgId]
    );
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found', code: 'NOT_FOUND' });
    }
    if (target.deactivated_at) {
      return res.status(409).json({ success: false, message: 'This account is already deactivated', code: 'ALREADY_DEACTIVATED' });
    }

    // Same "don't leave the org unadministered" guard as PATCH's role-demotion check,
    // applied to the stronger action of deactivating someone outright.
    const adminRoles = access.allRoles().filter((r) => access.hasPermission(r, 'org.manage'));
    if (adminRoles.includes(target.role)) {
      const placeholders = adminRoles.map(() => '?').join(', ');
      const [[{ n }]] = await pool.query(
        `SELECT COUNT(*) AS n FROM users
          WHERE org_id = ? AND role IN (${placeholders})
            AND status = 'active' AND is_deleted = 0 AND deactivated_at IS NULL`,
        [req.auth.orgId, ...adminRoles]
      );
      if (n <= 1) {
        return res.status(409).json({
          success: false,
          message: 'You are the only administrator. Promote someone else first.',
          code: 'LAST_ADMIN',
        });
      }
    }

    // 1. Stop all future sync/capture — reuses the existing 'disabled' gate
    //    `authenticate()` already refuses, rather than inventing a second one.
    // 2. Force-logout every live session immediately (not "on next expiry").
    // 3. Purge only discretionary fields — this system has no profile photo/bio yet,
    //    so `mobile` (a contact detail) is the one column that qualifies today.
    // 4. VeriTrade is_published=false — N/A, VeriTrade doesn't exist yet (deferred,
    //    not forgotten; see xprojman-01.md S12).
    // Every other row (tasks, inspections, site_diary, audit_log…) is untouched —
    // the whole point is that relied-upon evidence survives this.
    await pool.query(
      `UPDATE users SET deactivated_at = NOW(), status = 'disabled', mobile = NULL,
              security_version = security_version + 1
        WHERE id = ? AND org_id = ?`,
      [target.id, req.auth.orgId]
    );
    await pool.query(
      `UPDATE sessions SET revoked_at = NOW(), is_authoritative = 0
        WHERE user_id = ? AND revoked_at IS NULL`,
      [target.id]
    );

    await audit(req, 'user.deactivated', { entity: 'users', entityId: target.id, detail: {} });
    return res.json({ success: true, data: { id: target.id, deactivated: true } });
  } catch (err) {
    console.error('[ORG/USERS/DELETE] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to deactivate user' });
  }
});

// ============================================================================
// GET /organisation/audit
// ============================================================================
router.get(
  '/audit',
  requireOrgAdmin,
  [
    query('limit').optional().isInt({ min: 1, max: 500 }),
    query('entity').optional().isString(),
  ],
  async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 100;

    try {
      const params = [req.auth.orgId];
      let filter = '';
      if (req.query.entity) {
        filter = ' AND a.entity = ?';
        params.push(req.query.entity);
      }
      params.push(limit);

      const [rows] = await pool.query(
        `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.device_id, a.ip,
                a.created_at, u.full_name AS user_name, u.email AS user_email
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.user_id
          WHERE a.org_id = ?${filter}
          ORDER BY a.created_at DESC
          LIMIT ?`,
        params
      );
      return res.json({ success: true, data: { entries: rows } });
    } catch (err) {
      console.error('[ORG/AUDIT] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to read audit log' });
    }
  }
);

module.exports = router;
