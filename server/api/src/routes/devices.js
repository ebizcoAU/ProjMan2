// Mounted at /devices
//
//   GET    /devices              list org devices, roles, last seen
//   GET    /devices/:id
//   POST   /devices/:id/revoke   kill a lost device
//   POST   /devices/:id/role     change a device's role
//
// Ported from Nexus `routes/devices.js`, with its `pairing-token` endpoints moved to
// routes/pairing.js where the rest of the pairing protocol lives — in Nexus the
// pairing surface was split across two files for historical reasons (two different
// decisions, N-API-022 and XF-06, built months apart) and it made the flow hard to
// follow.
//
// Every query is scoped by `req.auth.orgId`. There is no endpoint here that takes an
// org from the caller.

const router = require('express').Router();
const { body, validationResult } = require('express-validator');

const pool = require('../db/pool');
const { authenticate, requirePermission } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const access = require('../lib/access');

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

// ============================================================================
// GET /devices
// ============================================================================
router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.id, d.device_uid, d.device_name, d.platform, d.model,
              d.os_version, d.app_version, d.role, d.status, d.is_primary,
              d.paired_at, d.last_seen_at, d.revoked_at,
              u.id AS user_id, u.full_name AS user_name, u.email AS user_email,
              pb.full_name AS paired_by_name
         FROM devices d
         LEFT JOIN users u  ON u.id  = d.user_id
         LEFT JOIN users pb ON pb.id = d.paired_by
        WHERE d.org_id = ? AND d.is_deleted = 0
        ORDER BY d.last_seen_at DESC, d.created_at DESC`,
      [req.auth.orgId]
    );

    return res.json({
      success: true,
      data: {
        devices: rows.map((d) => ({
          id: d.id,
          uid: d.device_uid,
          name: d.device_name,
          platform: d.platform,
          model: d.model,
          osVersion: d.os_version,
          appVersion: d.app_version,
          role: d.role,
          status: d.status,
          isPrimary: !!d.is_primary,
          pairedAt: d.paired_at,
          pairedByName: d.paired_by_name,
          lastSeenAt: d.last_seen_at,
          revokedAt: d.revoked_at,
          user: d.user_id ? { id: d.user_id, name: d.user_name, email: d.user_email } : null,
        })),
      },
    });
  } catch (err) {
    console.error('[DEVICES/LIST] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list devices' });
  }
});

// ============================================================================
// GET /devices/:id
// ============================================================================
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [[device]] = await pool.query(
      `SELECT d.*, u.full_name AS user_name, u.email AS user_email
         FROM devices d LEFT JOIN users u ON u.id = d.user_id
        WHERE d.id = ? AND d.org_id = ? AND d.is_deleted = 0 LIMIT 1`,
      [req.params.id, req.auth.orgId]
    );
    if (!device) {
      return res.status(404).json({ success: false, message: 'Device not found', code: 'NOT_FOUND' });
    }

    const [sessions] = await pool.query(
      `SELECT id, issued_at, expires_at, revoked_at, is_authoritative, last_sync_at,
              last_pending_count, ip_address
         FROM sessions
        WHERE org_id = ? AND device_id = ?
        ORDER BY issued_at DESC LIMIT 10`,
      [req.auth.orgId, device.device_uid]
    );

    return res.json({ success: true, data: { device, sessions } });
  } catch (err) {
    console.error('[DEVICES/GET] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load device' });
  }
});

// ============================================================================
// POST /devices/:id/revoke
//
// The device row is marked revoked, not deleted. The auth middleware checks it on
// every request, so the lost tablet fails its very next call rather than continuing
// to work until its access token happens to expire.
//
// Its sessions go too — otherwise `/auth/refresh` would hand it a fresh token.
// ============================================================================
router.post(
  '/:id/revoke',
  authenticate,
  requirePermission('devices.manage'),
  async (req, res) => {
    try {
      const [[device]] = await pool.query(
        `SELECT id, device_uid, is_primary, role FROM devices
          WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
        [req.params.id, req.auth.orgId]
      );
      if (!device) {
        return res.status(404).json({ success: false, message: 'Device not found', code: 'NOT_FOUND' });
      }

      // Revoking the device you are holding locks you out of your own org.
      if (device.device_uid === req.auth.deviceUid) {
        return res.status(409).json({
          success: false,
          message: 'You cannot revoke the device you are using. Do it from another device.',
          code: 'CANNOT_REVOKE_SELF',
        });
      }

      await pool.query(
        `UPDATE devices SET status = 'revoked', revoked_at = NOW() WHERE id = ?`,
        [device.id]
      );
      const [sessions] = await pool.query(
        `UPDATE sessions SET revoked_at = NOW(), is_authoritative = 0
          WHERE org_id = ? AND device_id = ? AND revoked_at IS NULL`,
        [req.auth.orgId, device.device_uid]
      );

      await audit(req, 'device.revoke', {
        entity: 'devices', entityId: device.id,
        detail: { device_uid: device.device_uid, role: device.role, sessions_revoked: sessions.affectedRows },
      });
      console.warn(`[DEVICES] revoked ${device.device_uid} (${sessions.affectedRows} session(s)) by ${req.auth.userId}`);

      return res.json({
        success: true,
        data: { id: device.id, status: 'revoked', sessionsRevoked: sessions.affectedRows },
      });
    } catch (err) {
      console.error('[DEVICES/REVOKE] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to revoke device' });
    }
  }
);

// ============================================================================
// POST /devices/:id/role  { role }
//
// Takes effect on the device's next token refresh, i.e. within one access-token
// lifetime. Live sessions are NOT killed: pulling a supervisor's session mid-shift
// to change a label would cost them whatever they were typing.
// ============================================================================
router.post(
  '/:id/role',
  authenticate,
  requirePermission('devices.manage'),
  [body('role').notEmpty().withMessage('A role is required')],
  async (req, res) => {
    if (validation(req, res)) return;

    // Defined AND device-pairable — the same data-driven gate as pairing.
    // `customer` is a defined role but device_pairable=0, so it is refused here by
    // data, exactly as §9.2 requires (ROLE_NOT_ASSIGNABLE for the pairability sense).
    if (!access.roleMeta(req.body.role)) {
      return res.status(422).json({ success: false, message: 'A valid role is required', code: 'VALIDATION_ERROR', field: 'role' });
    }
    if (!access.isPairable(req.body.role)) {
      return res.status(403).json({ success: false, message: `The role "${req.body.role}" cannot be assigned to a device`, code: 'ROLE_NOT_ASSIGNABLE' });
    }

    try {
      const [[device]] = await pool.query(
        `SELECT id, device_uid, role FROM devices
          WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1`,
        [req.params.id, req.auth.orgId]
      );
      if (!device) {
        return res.status(404).json({ success: false, message: 'Device not found', code: 'NOT_FOUND' });
      }

      await pool.query('UPDATE devices SET role = ? WHERE id = ?', [req.body.role, device.id]);
      await audit(req, 'device.role_changed', {
        entity: 'devices', entityId: device.id,
        detail: { from: device.role, to: req.body.role },
      });

      return res.json({
        success: true,
        data: { id: device.id, role: req.body.role, appliesOnNextRefresh: true },
      });
    } catch (err) {
      console.error('[DEVICES/ROLE] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to change device role' });
    }
  }
);

module.exports = router;
