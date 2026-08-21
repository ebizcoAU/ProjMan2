// Mounted at /auth/recovery
//
//   POST /auth/recovery/request        identify by email → email a code
//   POST /auth/recovery/verify         code → short-lived recovery token
//   POST /auth/recovery/reset          recovery token + new password
//   POST /auth/recovery/device-loss    reclaim authority onto a replacement device
//   POST /auth/recovery/handoff-complete   old device flushed; hand authority over
//   POST /auth/recovery/handoff-timeout    new device waited long enough; take it
//
// The device-loss half is ported from ftpos XF-36/XF-45 at the brief's request, and
// it earns its place here more than it did there: a site tablet is far likelier to
// be lost, stolen or destroyed than an office machine. The whole point is that a
// builder who dropped a tablet in a trench can put a new one on site the same day
// without losing the site diary.
//
// Nexus drove handoff over MQTT. ProjMan2 has no broker, so the same protocol runs
// over polling — see the note in README §Deviations. Same states, same 90s ceiling,
// one less moving part.

const router = require('express').Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');

const pool   = require('../db/pool');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { audit, clientIp } = require('../lib/audit');
const { sendRecoveryCode, maskEmail } = require('../lib/email');
const { readDevice } = require('../lib/tokens');
const AuthService = require('../services/AuthService');

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

const generateCode = () => String(crypto.randomInt(100000, 1000000));
const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

// ============================================================================
// POST /auth/recovery/request  { email, purpose? }
//
// Always responds 200, whether or not the address is registered. Anything else
// turns this endpoint into a "does this builder use ProjMan2" lookup.
// ============================================================================
router.post(
  '/request',
  [
    body('email').isEmail().normalizeEmail().withMessage('A valid email address is required'),
    body('purpose').optional().isIn(['password_reset', 'device_loss']),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    const { email } = req.body;
    const purpose = req.body.purpose || 'password_reset';

    const genericResponse = {
      success: true,
      message: 'If that address is registered, a code is on its way.',
      data: { expiresIn: config.recovery.codeTtlSeconds, maskedEmail: maskEmail(email) },
    };

    try {
      const [[user]] = await pool.query(
        `SELECT u.id, u.org_id, u.email, u.status, u.full_name
           FROM users u JOIN organisations o ON o.id = u.org_id
          WHERE u.email = ? AND u.is_deleted = 0 AND u.status != 'disabled'
            AND o.status = 'active'
          LIMIT 1`,
        [email]
      );
      if (!user) {
        console.log(`[RECOVERY] request for unknown/ineligible address ${maskEmail(email)} — generic response sent`);
        return res.json(genericResponse);
      }

      // Supersede any outstanding code. Two live codes means the older one is a
      // second valid guess against the same account.
      await pool.query(
        `UPDATE recovery_tokens SET used_at = NOW()
          WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
        [user.id, purpose]
      );

      const code = generateCode();
      await pool.query(
        `INSERT INTO recovery_tokens (id, user_id, code_hash, purpose, expires_at)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [uuidv4(), user.id, await bcrypt.hash(code, 10), purpose, config.recovery.codeTtlSeconds]
      );

      await sendRecoveryCode(user.email, code, purpose, user.full_name);
      await audit(req, 'recovery.requested', {
        orgId: user.org_id, userId: user.id, entity: 'users', entityId: user.id,
        detail: { purpose },
      });

      return res.json(genericResponse);
    } catch (err) {
      console.error('[RECOVERY/REQUEST] Error:', err.message);
      // Still generic: a 500 here would also distinguish known from unknown addresses.
      return res.json(genericResponse);
    }
  }
);

// ============================================================================
// POST /auth/recovery/verify  { email, code, purpose? }  → recovery token
// ============================================================================
router.post(
  '/verify',
  [
    body('email').isEmail().normalizeEmail(),
    body('code').isLength({ min: 6, max: 6 }).withMessage('Enter the 6-digit code'),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    const { email, code } = req.body;
    const purpose = req.body.purpose || 'password_reset';

    try {
      const [[row]] = await pool.query(
        `SELECT rt.id, rt.user_id, rt.code_hash, rt.attempts, u.org_id
           FROM recovery_tokens rt
           JOIN users u ON u.id = rt.user_id
          WHERE u.email = ? AND rt.purpose = ? AND rt.used_at IS NULL
            AND rt.expires_at > NOW()
          ORDER BY rt.created_at DESC LIMIT 1`,
        [email, purpose]
      );

      if (!row) {
        return res.status(401).json({ success: false, message: 'That code is not valid or has expired', code: 'INVALID_CODE' });
      }

      // Per-code attempt ceiling, independent of the IP rate limiter: without it,
      // a six-digit code is brute-forceable from a rotating address pool.
      if (row.attempts >= config.recovery.maxAttempts) {
        await pool.query('UPDATE recovery_tokens SET used_at = NOW() WHERE id = ?', [row.id]);
        return res.status(429).json({ success: false, message: 'Too many attempts. Request a new code.', code: 'TOO_MANY_ATTEMPTS' });
      }

      if (!(await bcrypt.compare(String(code), row.code_hash))) {
        await pool.query('UPDATE recovery_tokens SET attempts = attempts + 1 WHERE id = ?', [row.id]);
        return res.status(401).json({ success: false, message: 'That code is not valid or has expired', code: 'INVALID_CODE' });
      }

      // Burn the code and mint a short-lived token for the actual reset. The code
      // never travels twice, and the reset window is minutes rather than the code's.
      const recoveryToken = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `UPDATE recovery_tokens
            SET used_at = NOW(), code_hash = ?, expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
          WHERE id = ?`,
        [hashToken(recoveryToken), config.recovery.tokenTtlSeconds, row.id]
      );

      await audit(req, 'recovery.verified', {
        orgId: row.org_id, userId: row.user_id, entity: 'users', entityId: row.user_id,
        detail: { purpose },
      });

      return res.json({
        success: true,
        data: { recoveryToken, expiresIn: config.recovery.tokenTtlSeconds, purpose },
      });
    } catch (err) {
      console.error('[RECOVERY/VERIFY] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Verification failed' });
    }
  }
);

// ============================================================================
// POST /auth/recovery/reset  { recoveryToken, newPassword }
// ============================================================================
router.post(
  '/reset',
  [
    body('recoveryToken').notEmpty().withMessage('Recovery token is required'),
    body('newPassword').isLength({ min: config.password.minLength })
      .withMessage(`Password must be at least ${config.password.minLength} characters`),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    try {
      const [[row]] = await pool.query(
        `SELECT rt.id, rt.user_id, u.org_id, u.email
           FROM recovery_tokens rt
           JOIN users u ON u.id = rt.user_id
          WHERE rt.code_hash = ? AND rt.purpose = 'password_reset' AND rt.expires_at > NOW()
          LIMIT 1`,
        [hashToken(req.body.recoveryToken)]
      );

      if (!row) {
        return res.status(401).json({ success: false, message: 'That recovery token is not valid or has expired', code: 'INVALID_RECOVERY_TOKEN' });
      }

      const hash = await bcrypt.hash(String(req.body.newPassword), config.password.bcryptCost);

      const conn = await pool.getConnection();
      await conn.beginTransaction();
      try {
        // Bumping security_version invalidates every access token minted before now,
        // including ones held by whoever prompted the reset.
        await conn.query(
          `UPDATE users SET password_hash = ?, security_version = security_version + 1,
                            force_logout_flag = 0
            WHERE id = ?`,
          [hash, row.user_id]
        );
        await conn.query(
          `UPDATE sessions SET revoked_at = NOW(), is_authoritative = 0
            WHERE user_id = ? AND revoked_at IS NULL`,
          [row.user_id]
        );
        await conn.query('DELETE FROM recovery_tokens WHERE id = ?', [row.id]);
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }

      await audit(req, 'recovery.password_reset', {
        orgId: row.org_id, userId: row.user_id, entity: 'users', entityId: row.user_id,
      });
      console.log(`[RECOVERY] password reset completed for ${maskEmail(row.email)}`);

      return res.json({ success: true, message: 'Password reset. Please log in with your new password.' });
    } catch (err) {
      console.error('[RECOVERY/RESET] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
  }
);

// ============================================================================
// POST /auth/recovery/device-loss  { recoveryToken, device }
//
// The tablet is gone. Its session still holds authority and will never hand it
// over, so we revoke it outright and grant the replacement device authority
// immediately — no handoff, because there is nothing on the other end to ask.
//
// This is why `purpose = 'device_loss'` exists as a separate code: it is a
// deliberately destructive action and should not be reachable from an ordinary
// password-reset code.
// ============================================================================
router.post(
  '/device-loss',
  [body('recoveryToken').notEmpty().withMessage('Recovery token is required')],
  async (req, res) => {
    if (validation(req, res)) return;

    const device = readDevice(req.body.device || req.body);
    const ip = clientIp(req);

    if (!device.device_uid) {
      return res.status(400).json({ success: false, message: 'device_uid is required', code: 'NO_DEVICE' });
    }

    try {
      const [[row]] = await pool.query(
        `SELECT rt.id, rt.user_id
           FROM recovery_tokens rt
          WHERE rt.code_hash = ? AND rt.purpose = 'device_loss' AND rt.expires_at > NOW()
          LIMIT 1`,
        [hashToken(req.body.recoveryToken)]
      );
      if (!row) {
        return res.status(401).json({ success: false, message: 'That recovery token is not valid or has expired', code: 'INVALID_RECOVERY_TOKEN' });
      }

      const [[user]] = await pool.query(
        `SELECT u.id, u.org_id, u.email, u.full_name, u.mobile, u.role, u.status,
                u.security_version, o.name AS org_name, o.timezone, o.currency
           FROM users u JOIN organisations o ON o.id = u.org_id
          WHERE u.id = ? LIMIT 1`,
        [row.user_id]
      );

      // Everything the lost device could still do, it can no longer do.
      const [revoked] = await pool.query(
        `UPDATE sessions SET revoked_at = NOW(), is_authoritative = 0
          WHERE user_id = ? AND revoked_at IS NULL AND device_id != ?`,
        [user.id, device.device_uid]
      );
      await pool.query(
        `UPDATE devices SET status = 'revoked', revoked_at = NOW()
          WHERE org_id = ? AND user_id = ? AND device_uid != ? AND status = 'active'`,
        [user.org_id, user.id, device.device_uid]
      );
      await pool.query('DELETE FROM recovery_tokens WHERE id = ?', [row.id]);

      // Reclaiming a previously revoked device is legitimate here — the recovery
      // token IS the proof of ownership — so reactivate its row first, or
      // AuthService would refuse it as DEVICE_REVOKED.
      await pool.query(
        `UPDATE devices SET status = 'active', revoked_at = NULL
          WHERE org_id = ? AND device_uid = ?`,
        [user.org_id, device.device_uid]
      );

      // Every other session was just revoked above, so the 'auto' policy grants
      // this device the single-writer authority — same behaviour as before.
      const { session, deviceRow } = await AuthService.startSession({
        user, device, ip, userAgent: req.headers['user-agent'], role: user.role,
      });
      await pool.query(
        `UPDATE devices SET status = 'active', revoked_at = NULL, paired_at = NOW(), paired_by = ?
          WHERE id = ?`,
        [user.id, deviceRow.id]
      );

      await audit(req, 'recovery.device_loss', {
        orgId: user.org_id, userId: user.id, deviceId: device.device_uid,
        entity: 'devices', entityId: deviceRow.id,
        detail: { sessions_revoked: revoked.affectedRows },
      });
      console.warn(`[RECOVERY] device-loss: ${revoked.affectedRows} session(s) revoked, authority granted to ${device.device_uid}`);

      return res.json({
        success: true,
        data: {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          user: {
            id: user.id, orgId: user.org_id, email: user.email,
            fullName: user.full_name, mobile: user.mobile, role: user.role, status: user.status,
          },
          organisation: {
            id: user.org_id, name: user.org_name,
            timezone: user.timezone, currency: user.currency,
          },
          authoritative: session.authoritative,
          // The replacement device has no local database. It must pull from since=0.
          requiresFullSync: true,
          sessionsRevoked: revoked.affectedRows,
        },
      });
    } catch (err) {
      console.error('[RECOVERY/DEVICE-LOSS] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Device recovery failed' });
    }
  }
);

// ============================================================================
// POST /auth/recovery/handoff-complete
//
// Called by the OUTGOING device once it has flushed its queue. It gives up
// authority; the waiting device picks it up on its next /session/status poll.
// ============================================================================
router.post('/handoff-complete', authenticate, async (req, res) => {
  const { userId, jti } = req.auth;

  try {
    // The server decides what is still pending — a client-reported count is a hint,
    // not a fact, and this one is reported by the device that wants to leave.
    const [[pending]] = await pool.query(
      `SELECT last_pending_count AS n FROM sessions WHERE refresh_token = ? AND user_id = ?`,
      [jti, userId]
    );
    const serverPendingCount = Number(pending?.n || 0);

    await pool.query(
      `UPDATE sessions SET is_authoritative = 0, revoked_at = NOW()
        WHERE refresh_token = ? AND user_id = ?`,
      [jti, userId]
    );

    // Hand straight to the newest waiting session rather than making it poll again.
    const [[incoming]] = await pool.query(
      `SELECT id, device_id FROM sessions
        WHERE user_id = ? AND is_authoritative = 0 AND revoked_at IS NULL
          AND expires_at > NOW() AND refresh_token != ?
        ORDER BY issued_at DESC LIMIT 1`,
      [userId, jti]
    );

    if (incoming) {
      await pool.query(
        `UPDATE sessions SET is_authoritative = 1, authority_since = NOW() WHERE id = ?`,
        [incoming.id]
      );
    } else {
      console.warn(`[HANDOFF] complete called but no waiting session found — userId=${userId}`);
    }

    await audit(req, 'session.handoff_complete', {
      entity: 'sessions', entityId: incoming?.id || null,
      detail: { serverPendingCount, to_device: incoming?.device_id || null },
    });

    return res.json({
      success: true,
      data: { serverPendingCount, handedTo: incoming?.device_id || null },
      message: serverPendingCount > 0
        ? `Handover done. ${serverPendingCount} record(s) had not synced.`
        : 'Handover done. Everything was synced.',
    });
  } catch (err) {
    console.error('[HANDOFF-COMPLETE] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Handover failed' });
  }
});

// ============================================================================
// POST /auth/recovery/handoff-timeout
//
// Called by the INCOMING device after it has waited out the ceiling. Takes
// authority and reports whether the outgoing device had recently been syncing —
// if it had, it probably still holds work, and the user should be told.
// ============================================================================
router.post('/handoff-timeout', authenticate, async (req, res) => {
  const { userId, jti } = req.auth;

  try {
    const [[holder]] = await pool.query(
      `SELECT id, device_id, last_sync_at, last_pending_count
         FROM sessions
        WHERE user_id = ? AND is_authoritative = 1 AND revoked_at IS NULL
        LIMIT 1`,
      [userId]
    );

    // "Recently active" means it probably had data. A device that has not synced in
    // over a day was already stale, and displacing it costs nothing.
    const hoursSinceSync = holder?.last_sync_at
      ? (Date.now() - new Date(holder.last_sync_at).getTime()) / 3_600_000
      : Infinity;
    const staleWarning = hoursSinceSync <= 24;

    if (holder) {
      await pool.query(
        `UPDATE sessions SET is_authoritative = 0, revoked_at = NOW() WHERE id = ?`,
        [holder.id]
      );
    }
    await pool.query(
      `UPDATE sessions SET is_authoritative = 1, authority_since = NOW()
        WHERE refresh_token = ? AND user_id = ?`,
      [jti, userId]
    );

    await audit(req, 'session.handoff_timeout', {
      entity: 'sessions', entityId: holder?.id || null,
      detail: { displaced_device: holder?.device_id || null, staleWarning },
    });

    return res.json({
      success: true,
      data: {
        authoritative: true,
        // true → show a non-blocking banner: the old device may still hold unsaved work.
        staleWarning,
        unsyncedOnOldDevice: holder?.last_pending_count ?? 0,
      },
    });
  } catch (err) {
    console.error('[HANDOFF-TIMEOUT] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Handover timeout failed' });
  }
});

module.exports = router;
