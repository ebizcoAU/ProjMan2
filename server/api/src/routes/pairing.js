// Mounted at /pairing
//
//   POST /pairing/initiate     primary device starts pairing → QR payload
//   POST /pairing/request      new device submits the scanned payload  (unauthenticated)
//   GET  /pairing/pending      primary polls for waiting requests
//   POST /pairing/confirm      approve AND ASSIGN ROLE
//   POST /pairing/reject
//   GET  /pairing/status/:id   new device polls its own request
//
// Ported from Nexus `routes/pairing.js` (XFtposDecisions-06/07/41). This is the piece
// the brief most wanted unchanged, and the shape survives intact:
//
//   primary issues a nonce → new device claims it → primary approves with a role
//
// What changed:
//   • The POS role vocabulary (CASHIER / WAITER / KIOSK / *_DSP) is replaced by the
//     ProjMan2 roles. Those were terminal *types*; these are people's jobs.
//   • Employee-vs-owner token binding is gone. In Nexus a display had no subscriber
//     of its own so it borrowed the owner's; here a device may legitimately have no
//     user (a shared site tablet) and the org is the binding.
//   • MQTT push → polling. `/pending` and `/status/:id` existed in Nexus as the
//     offline fallback; here they are the only path, which removes a broker without
//     changing the protocol.
//
// The raw nonce is never stored. It lives in the QR code and in the claiming
// request; the table holds only its SHA-256.

const router = require('express').Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');

const pool   = require('../db/pool');
const config = require('../config');
const { authenticate, requirePermission } = require('../middleware/auth');
const { audit, clientIp } = require('../lib/audit');
const access = require('../lib/access');
const { readDevice } = require('../lib/tokens');
const AuthService = require('../services/AuthService');
const { ServiceError } = require('../services/errors');

const hashNonce = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

// Who may hand out which role is access.canPair (the pair_rank ceiling) — no map to
// maintain here. projectManager pairs anyone; siteSupervisor pairs foreperson/tradie
// only; inspector/foreperson/tradie hold no devices.manage so never reach this path.

// ============================================================================
// POST /pairing/initiate  { role, label?, assign_user_id?, ttl_seconds? }
// Returns the QR payload. The nonce is shown once and never again.
// ============================================================================
router.post(
  '/initiate',
  authenticate,
  requirePermission('devices.manage'),
  [
    body('role').notEmpty().withMessage('A role is required'),
    body('label').optional({ nullable: true }).isString().isLength({ max: 255 }),
    body('assign_user_id').optional({ nullable: true }).isString(),
    body('ttl_seconds').optional().isInt({ min: 30 }),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    const { orgId, userId, role: myRole } = req.auth;
    const role = req.body.role;

    // The target must be a defined, DEVICE-PAIRABLE role (`customer` is defined but
    // never pairable — refused here by data, §9.2), and within the issuer's ceiling.
    if (!access.roleMeta(role)) {
      return res.status(422).json({ success: false, message: 'A valid role is required', code: 'VALIDATION_ERROR', field: 'role' });
    }
    if (!access.isPairable(role)) {
      return res.status(403).json({
        success: false,
        message: `The role "${role}" cannot be paired to a device`,
        code: 'ROLE_NOT_ASSIGNABLE',
      });
    }
    if (access.pairRank(myRole) < access.pairRank(role)) {
      return res.status(403).json({
        success: false,
        message: `A ${myRole} cannot assign the role ${role}`,
        code: 'ROLE_NOT_ASSIGNABLE',
      });
    }

    const ttl = Math.min(
      parseInt(req.body.ttl_seconds, 10) || config.pairing.nonceTtlSeconds,
      config.pairing.maxTtlSeconds
    );

    try {
      // If the pairing is bound to a specific user, that user must be in this org.
      const assignUserId = req.body.assign_user_id || null;
      if (assignUserId) {
        const [[target]] = await pool.query(
          'SELECT id FROM users WHERE id = ? AND org_id = ? AND is_deleted = 0 LIMIT 1',
          [assignUserId, orgId]
        );
        if (!target) {
          return res.status(404).json({ success: false, message: 'User not found in this organisation', code: 'NO_USER' });
        }
      }

      // Retire this issuer's outstanding requests. Several live QR codes on one desk
      // is how the wrong tablet ends up with the wrong role.
      await pool.query(
        `UPDATE pairing_tokens SET status = 'expired'
          WHERE org_id = ? AND initiated_by = ? AND status IN ('pending','requested')`,
        [orgId, userId]
      );

      const nonce = crypto.randomBytes(24).toString('hex');
      const id = uuidv4();

      await pool.query(
        `INSERT INTO pairing_tokens
           (id, org_id, initiated_by, nonce_hash, role, label, assign_user_id,
            status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [id, orgId, userId, hashNonce(nonce), role, req.body.label || null, assignUserId, ttl]
      );

      await audit(req, 'pairing.initiate', {
        entity: 'pairing_tokens', entityId: id, detail: { role, ttl },
      });

      return res.status(201).json({
        success: true,
        data: {
          request_id: id,
          // This object is what goes in the QR code.
          qr_payload: { v: 1, org: orgId, id, nonce },
          role,
          expires_in: ttl,
        },
      });
    } catch (err) {
      console.error('[PAIRING/INITIATE] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to start pairing' });
    }
  }
);

// ============================================================================
// POST /pairing/request  { request_id, nonce, device }
//
// Unauthenticated by necessity — the new device has no session yet. The nonce IS
// the credential, which is why it is short-lived, single-use and hashed at rest.
// ============================================================================
router.post(
  '/request',
  [
    body('request_id').notEmpty().withMessage('request_id is required'),
    body('nonce').notEmpty().withMessage('nonce is required'),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    const device = readDevice(req.body.device || req.body);
    if (!device.device_uid) {
      return res.status(400).json({ success: false, message: 'device_uid is required', code: 'NO_DEVICE' });
    }

    try {
      const [[token]] = await pool.query(
        `SELECT id, org_id, role, status, expires_at FROM pairing_tokens
          WHERE id = ? AND nonce_hash = ? LIMIT 1`,
        [req.body.request_id, hashNonce(req.body.nonce)]
      );

      if (!token) {
        return res.status(404).json({ success: false, message: 'Pairing request not found', code: 'NOT_FOUND' });
      }
      if (new Date(token.expires_at) <= new Date()) {
        await pool.query(`UPDATE pairing_tokens SET status = 'expired' WHERE id = ?`, [token.id]);
        return res.status(410).json({ success: false, message: 'That pairing code has expired', code: 'EXPIRED' });
      }
      if (token.status !== 'pending') {
        return res.status(409).json({
          success: false, message: 'That pairing code has already been used', code: 'ALREADY_USED', status: token.status,
        });
      }

      await pool.query(
        `UPDATE pairing_tokens
            SET status = 'requested', device_uid = ?, device_name = ?, platform = ?, model = ?
          WHERE id = ? AND status = 'pending'`,
        [device.device_uid, device.device_name, device.platform, device.model, token.id]
      );

      await audit(req, 'pairing.request', {
        orgId: token.org_id, deviceId: device.device_uid,
        entity: 'pairing_tokens', entityId: token.id,
      });

      return res.status(202).json({
        success: true,
        data: { request_id: token.id, status: 'requested', role: token.role },
        message: 'Waiting for approval on the primary device.',
      });
    } catch (err) {
      console.error('[PAIRING/REQUEST] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Pairing request failed' });
    }
  }
);

// ============================================================================
// GET /pairing/pending — what is waiting for this person to approve
// ============================================================================
router.get('/pending', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id AS request_id, role, label, device_uid, device_name, platform, model,
              created_at, expires_at
         FROM pairing_tokens
        WHERE org_id = ? AND initiated_by = ? AND status = 'requested'
          AND expires_at > NOW()
        ORDER BY created_at DESC`,
      [req.auth.orgId, req.auth.userId]
    );
    return res.json({ success: true, data: { pending: rows } });
  } catch (err) {
    console.error('[PAIRING/PENDING] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list pending pairings' });
  }
});

// ============================================================================
// POST /pairing/confirm  { request_id, role? }
//
// Approving creates the device row with its role, and that role is what every
// subsequent request from that device is judged by.
// ============================================================================
router.post(
  '/confirm',
  authenticate,
  requirePermission('devices.manage'),
  [body('request_id').notEmpty().withMessage('request_id is required')],
  async (req, res) => {
    if (validation(req, res)) return;

    const { orgId, userId, role: myRole } = req.auth;

    try {
      const [[token]] = await pool.query(
        `SELECT * FROM pairing_tokens WHERE id = ? AND org_id = ? LIMIT 1`,
        [req.body.request_id, orgId]
      );

      if (!token) {
        return res.status(404).json({ success: false, message: 'Pairing request not found', code: 'NOT_FOUND' });
      }
      if (new Date(token.expires_at) <= new Date()) {
        await pool.query(`UPDATE pairing_tokens SET status = 'expired' WHERE id = ?`, [token.id]);
        return res.status(410).json({ success: false, message: 'That pairing request has expired', code: 'EXPIRED' });
      }
      if (token.status !== 'requested') {
        return res.status(409).json({
          success: false, message: 'No device is waiting on this request', code: 'NOT_AWAITING', status: token.status,
        });
      }
      // Someone other than the issuer may confirm only if they administer the org
      // (org.manage) — the projectManager. Expressed as the permission, not a role.
      if (token.initiated_by !== userId &&
          !access.grants({ role: myRole, isOrgOwner: req.auth.isOrgOwner }, 'org.manage')) {
        return res.status(403).json({ success: false, message: 'Only the issuer or an org administrator can confirm', code: 'NOT_ISSUER' });
      }

      // The role may be changed at approval time — the operator sees the device in
      // front of them and may have picked the wrong one when generating the code.
      // Same data-driven gate as initiate: defined, pairable, within the issuer's
      // ceiling.
      const role = req.body.role || token.role;
      if (!access.roleMeta(role)) {
        return res.status(422).json({ success: false, message: 'A valid role is required', code: 'VALIDATION_ERROR', field: 'role' });
      }
      if (!access.isPairable(role)) {
        return res.status(403).json({
          success: false, message: `The role "${role}" cannot be paired to a device`, code: 'ROLE_NOT_ASSIGNABLE',
        });
      }
      if (access.pairRank(myRole) < access.pairRank(role)) {
        return res.status(403).json({
          success: false, message: `A ${myRole} cannot assign the role ${role}`, code: 'ROLE_NOT_ASSIGNABLE',
        });
      }

      const deviceId = uuidv4();
      await pool.query(
        `INSERT INTO devices
           (id, org_id, user_id, device_uid, device_name, platform, model,
            role, status, paired_at, paired_by, last_seen_at, last_seen_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
           user_id     = VALUES(user_id),
           device_name = COALESCE(VALUES(device_name), device_name),
           platform    = COALESCE(VALUES(platform), platform),
           model       = COALESCE(VALUES(model), model),
           role        = VALUES(role),
           status      = 'active',
           revoked_at  = NULL,
           paired_at   = NOW(),
           paired_by   = VALUES(paired_by)`,
        [
          deviceId, orgId, token.assign_user_id || null, token.device_uid,
          token.device_name, token.platform, token.model, role,
          userId, clientIp(req),
        ]
      );

      const [[device]] = await pool.query(
        `SELECT id, role, device_uid FROM devices WHERE org_id = ? AND device_uid = ? LIMIT 1`,
        [orgId, token.device_uid]
      );

      await pool.query(
        `UPDATE pairing_tokens
            SET status = 'confirmed', role = ?, confirmed_at = NOW(), claimed_device_id = ?
          WHERE id = ?`,
        [role, device.id, token.id]
      );

      await audit(req, 'pairing.confirm', {
        entity: 'devices', entityId: device.id,
        detail: { role, device_uid: token.device_uid, request_id: token.id },
      });
      console.log(`[PAIRING] confirmed device=${token.device_uid} role=${role} org=${orgId}`);

      return res.json({
        success: true,
        data: { status: 'confirmed', device: { id: device.id, uid: device.device_uid, role: device.role } },
      });
    } catch (err) {
      console.error('[PAIRING/CONFIRM] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to confirm pairing' });
    }
  }
);

// ============================================================================
// POST /pairing/reject
// ============================================================================
router.post(
  '/reject',
  authenticate,
  requirePermission('devices.manage'),
  [body('request_id').notEmpty().withMessage('request_id is required')],
  async (req, res) => {
    if (validation(req, res)) return;

    try {
      const [result] = await pool.query(
        `UPDATE pairing_tokens SET status = 'rejected'
          WHERE id = ? AND org_id = ? AND status IN ('pending','requested')`,
        [req.body.request_id, req.auth.orgId]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Pairing request not found or already resolved', code: 'NOT_FOUND' });
      }

      await audit(req, 'pairing.reject', { entity: 'pairing_tokens', entityId: req.body.request_id });
      return res.json({ success: true, data: { status: 'rejected' } });
    } catch (err) {
      console.error('[PAIRING/REJECT] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to reject pairing' });
    }
  }
);

// ============================================================================
// GET /pairing/status/:request_id
//
// Polled by the NEW device, which has no session — so this is unauthenticated and
// must reveal nothing until the pairing is confirmed. Once it is, it returns the
// session, because the device that just got approved has no other way to obtain one.
//
// The `device_uid` query parameter binds the answer to the device that actually
// made the request: without it, anyone holding the request id could collect
// somebody else's session.
// ============================================================================
router.get('/status/:request_id', async (req, res) => {
  const deviceUid = req.query.device_uid || req.query.deviceUid || null;

  try {
    const [[token]] = await pool.query(
      `SELECT id, org_id, role, status, device_uid, assign_user_id, expires_at, claimed_device_id
         FROM pairing_tokens WHERE id = ? LIMIT 1`,
      [req.params.request_id]
    );

    if (!token) {
      return res.status(404).json({ success: false, message: 'Pairing request not found', code: 'NOT_FOUND' });
    }

    if (token.status === 'pending' && new Date(token.expires_at) <= new Date()) {
      await pool.query(`UPDATE pairing_tokens SET status = 'expired' WHERE id = ?`, [token.id]);
      return res.json({ success: true, data: { status: 'expired' } });
    }

    if (token.status !== 'confirmed') {
      return res.json({ success: true, data: { status: token.status, role: token.role } });
    }

    if (!deviceUid || deviceUid !== token.device_uid) {
      return res.status(403).json({ success: false, message: 'Device mismatch', code: 'DEVICE_MISMATCH' });
    }

    // A device paired without an assigned user gets no session — a shared site
    // tablet is claimed by whoever logs into it, and the device's role then caps
    // whatever that person's own role would have allowed.
    if (!token.assign_user_id) {
      return res.json({
        success: true,
        data: {
          status: 'confirmed',
          role: token.role,
          device_id: token.claimed_device_id,
          requiresLogin: true,
        },
      });
    }

    const [[user]] = await pool.query(
      `SELECT u.id, u.org_id, u.email, u.full_name, u.mobile, u.role, u.status, u.security_version,
              o.name AS org_name, o.timezone, o.currency
         FROM users u JOIN organisations o ON o.id = u.org_id
        WHERE u.id = ? LIMIT 1`,
      [token.assign_user_id]
    );

    // Through AuthService like every other session issue (Step C). authority:'never'
    // keeps the prior behaviour exactly: a newly paired device does not seize the
    // writer role — if it needs it, it asks through the normal handoff.
    const { session } = await AuthService.startSession({
      user,
      device: { device_uid: token.device_uid },
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      role: token.role,
      authority: 'never',
    });

    await audit(req, 'pairing.session_issued', {
      orgId: token.org_id, userId: user.id, deviceId: token.device_uid,
      entity: 'devices', entityId: token.claimed_device_id,
    });

    return res.json({
      success: true,
      data: {
        status: 'confirmed',
        role: token.role,
        device_id: token.claimed_device_id,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        user: {
          id: user.id, orgId: user.org_id, email: user.email,
          fullName: user.full_name, role: token.role,
        },
        organisation: {
          id: user.org_id, name: user.org_name,
          timezone: user.timezone, currency: user.currency,
        },
        requiresLogin: false,
      },
    });
  } catch (err) {
    // AuthService refuses a session for a device revoked between confirm and this
    // poll — that refusal must reach the device as itself, not as a 500.
    if (err instanceof ServiceError) {
      return res.status(err.status).json({ success: false, message: err.message, code: err.code });
    }
    console.error('[PAIRING/STATUS] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to read pairing status' });
  }
});

module.exports = router;
