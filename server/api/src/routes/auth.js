// POST /auth/register, /auth/login, /auth/refresh, /auth/logout
// GET  /auth/me, /auth/session/status
//
// Ported from Nexus `routes/auth.js` (2129 lines → this). What went, and why:
//
//   • POST /auth/login/cccd — REMOVED, not translated. MAOI registers by scanning a
//     Vietnamese national ID QR. ProjMan2 is Australian: organisation (name, ABN,
//     address) plus first user (name, email, password, mobile).
//   • SMS/OTP login, `people`/`personal_people` profile overrides, the app-variant
//     axis (banoi/maoi), and the staff-login branch — all gone with the sell side.
//   • The D-140 device handoff moved to routes/recovery.js, where it belongs: here it
//     was tangled through the login path and made it very hard to read.
//
// What was kept deliberately:
//   • Failure counting keyed on the IDENTIFIER, never the IP. Nexus learned this on
//     shared café WiFi (O-050); a site office is the same problem — one crew, one
//     4G router, and an IP-keyed counter locks everybody out when one person
//     mistypes their password.
//   • A missing user does NOT increment the counter. Doing so turns the lockout into
//     an account-enumeration oracle.

const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');

const pool   = require('../db/pool');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { audit, clientIp } = require('../lib/audit');
const { validateAbn } = require('../lib/abn');
const { readDevice, signAccess } = require('../lib/tokens');
const access = require('../lib/access');
const AuthService = require('../services/AuthService');
const { ServiceError, sendError } = require('../services/errors');

// ── Login failure counter ─────────────────────────────────────
// In-memory for now, exactly as Nexus shipped it. It does not survive a restart and
// is not shared across workers; move it to Redis before running more than one.
const loginFailures = new Map();

function isLockedOut(email) {
  const rec = loginFailures.get(email);
  if (!rec) return false;
  if (Date.now() >= rec.resetAt) {
    loginFailures.delete(email);
    return false;
  }
  return rec.failures >= config.password.maxFailures;
}

function recordFailure(email) {
  const now = Date.now();
  const rec = loginFailures.get(email);
  if (!rec || now >= rec.resetAt) {
    loginFailures.set(email, { failures: 1, resetAt: now + config.password.lockoutMs });
  } else {
    rec.failures += 1;
  }
}

const clearFailures = (email) => loginFailures.delete(email);

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({
    success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path,
  });
  return true;
}

const publicUser = (u, role) => ({
  id: u.id,
  orgId: u.org_id,
  email: u.email,
  fullName: u.full_name,
  mobile: u.mobile || null,
  mobileVerified: u.mobile_verified != null ? !!u.mobile_verified : undefined,
  role: role || u.role,
  status: u.status,
  // Present once the column is loaded (login/me); undefined on the register path
  // where the org details were just collected inline.
  onboardingComplete: u.onboarding_complete != null ? !!u.onboarding_complete : undefined,
});

// ============================================================================
// POST /auth/register — create an organisation and its first user (org_admin)
//
// One transaction: the org and its first user are meaningless apart. A half-written
// registration leaves an org nobody can log into, which is worse than a failure the
// builder can simply retry.
// ============================================================================
router.post(
  '/register',
  [
    body('organisation.name').trim().notEmpty().withMessage('Organisation name is required'),
    body('organisation.abn').optional({ nullable: true, checkFalsy: true }).isString(),
    body('organisation.state').optional({ nullable: true, checkFalsy: true })
      .isIn(['WA', 'SA', 'NT', 'QLD', 'NSW', 'VIC', 'TAS', 'ACT'])
      .withMessage('State must be an Australian state or territory'),
    body('user.full_name').trim().notEmpty().withMessage('Your full name is required'),
    body('user.email').isEmail().normalizeEmail().withMessage('A valid email address is required'),
    body('user.password').isLength({ min: config.password.minLength })
      .withMessage(`Password must be at least ${config.password.minLength} characters`),
    body('user.mobile').optional({ nullable: true, checkFalsy: true }).isString(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    const org    = req.body.organisation || {};
    const person = req.body.user || {};
    const device = readDevice(req.body.device || req.body);
    const ip     = clientIp(req);

    try {
      const [[existing]] = await pool.query(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [person.email]
      );
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'That email address is already registered. Use password recovery if the account is yours.',
          code: 'DUPLICATE_EMAIL',
        });
      }

      // Validate before opening the transaction — the ABR call can take seconds and
      // must not hold a MySQL connection open while it does.
      const abnResult = org.abn ? await validateAbn(org.abn) : { abn: null, level: 'no' };

      if (org.abn && abnResult.level === 'no') {
        return res.status(422).json({
          success: false,
          message: 'That ABN is not valid. Check the 11 digits, or leave it blank and add it later.',
          code: 'INVALID_ABN',
          field: 'organisation.abn',
        });
      }

      const orgId  = uuidv4();
      const userId = uuidv4();
      const passwordHash = await bcrypt.hash(String(person.password), config.password.bcryptCost);

      const conn = await pool.getConnection();
      await conn.beginTransaction();
      try {
        await conn.query(
          `INSERT INTO organisations
             (id, name, abn, abn_validated, abn_checked_at, address, suburb, state,
              postcode, phone, email, timezone, currency, plan, status, trial_ends_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trial', 'active',
                   DATE_ADD(NOW(), INTERVAL 90 DAY))`,
          [
            orgId, org.name, abnResult.abn, abnResult.level,
            abnResult.abn ? new Date() : null,
            org.address || null, org.suburb || null, org.state || null,
            org.postcode || null, org.phone || null, org.email || person.email,
            config.server.timezone, config.server.currency,
          ]
        );

        // The registering user is the builder's top actor — projectManager (18-Stage
        // Matrix Stage 1: projectManager creates projects). It is the portfolio role
        // that also holds org.manage / users.manage / devices.manage.
        await conn.query(
          `INSERT INTO users
             (id, org_id, email, password_hash, full_name, mobile, role, status)
           VALUES (?, ?, ?, ?, ?, ?, 'projectManager', 'active')`,
          [userId, orgId, person.email, passwordHash,
           person.full_name, person.mobile || null]
        );

        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }

      const [[user]] = await pool.query(
        `SELECT id, org_id, email, full_name, mobile, role, status, security_version
           FROM users WHERE id = ? LIMIT 1`,
        [userId]
      );

      // Session issue goes through AuthService like every other path (Step C). A
      // brand-new user can have no other authority holder, so the 'auto' policy
      // grants the writer role — same behaviour as before, one implementation.
      const { session, deviceRow } = await AuthService.startSession({
        user, device, ip, userAgent: req.headers['user-agent'],
      });

      // The registering device is the org's primary by definition — it is the one
      // that will later issue pairing QRs for every other device.
      if (deviceRow) {
        await pool.query(
          `UPDATE devices SET is_primary = 1, paired_at = NOW(), paired_by = ? WHERE id = ?`,
          [userId, deviceRow.id]
        );
      }

      await audit(req, 'auth.register', {
        orgId, userId, deviceId: device.device_uid,
        entity: 'organisations', entityId: orgId,
        detail: { name: org.name, abn_validated: abnResult.level },
      });

      console.log(`[REGISTER] org="${org.name}" abn=${abnResult.level} user=${person.email}`);

      return res.status(201).json({
        success: true,
        data: {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          user: publicUser(user),
          organisation: {
            id: orgId,
            name: org.name,
            abn: abnResult.abn,
            abnValidated: abnResult.level,
            abnDetails: abnResult.details || null,
            timezone: config.server.timezone,
            currency: config.server.currency,
          },
        },
      });
    } catch (err) {
      // An ABN belongs to exactly one builder. A collision means someone already
      // registered this company — return a clean 409, not a 500.
      if (err.code === 'ER_DUP_ENTRY') {
        const isAbn = /uq_org_abn/.test(err.message);
        return res.status(409).json({
          success: false,
          message: isAbn
            ? 'That ABN is already registered. If it is your company, use password recovery.'
            : 'That email address is already registered.',
          code: isAbn ? 'DUPLICATE_ABN' : 'DUPLICATE_EMAIL',
        });
      }
      console.error('[REGISTER] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Registration failed' });
    }
  }
);

// ============================================================================
// POST /auth/login — email + password
// ============================================================================
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('A valid email address is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    const { email, password } = req.body;
    const device = readDevice(req.body.device || req.body);
    const ip     = clientIp(req);

    if (isLockedOut(email)) {
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Try again shortly.',
        code: 'TOO_MANY_LOGIN_ATTEMPTS',
      });
    }

    try {
      const [[user]] = await pool.query(
        `SELECT u.id, u.org_id, u.email, u.password_hash, u.full_name, u.mobile,
                u.mobile_verified, u.role, u.status, u.onboarding_complete,
                u.security_version, u.disabled_reason, u.suspended_until,
                o.name AS org_name, o.status AS org_status, o.abn, o.abn_validated,
                o.timezone, o.currency, o.plan
           FROM users u
           JOIN organisations o ON o.id = u.org_id
          WHERE u.email = ? AND u.is_deleted = 0
          LIMIT 1`,
        [email]
      );

      // Deliberately identical response for unknown-user and wrong-password, and
      // deliberately no failure count on unknown-user — see the header note.
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      }

      // An OAuth-only account has no password. Say so plainly rather than returning a
      // generic "invalid credentials" — the user isn't wrong, they signed up with a
      // provider and need to use it (or set a password via recovery later).
      if (!user.password_hash) {
        return res.status(409).json({
          success: false,
          message: 'This account signs in with Google, Microsoft or Facebook. Use that button, or reset a password via recovery.',
          code: 'USE_SOCIAL_LOGIN',
        });
      }

      if (user.org_status !== 'active') {
        return res.status(403).json({ success: false, message: 'Organisation is not active', code: 'ORG_INACTIVE' });
      }
      if (user.status === 'disabled') {
        return res.status(403).json({
          success: false, message: 'Account disabled', code: 'DISABLED', reason: user.disabled_reason,
        });
      }
      if (user.status === 'suspended') {
        return res.status(403).json({
          success: false, message: 'Account suspended', code: 'SUSPENDED', suspendedUntil: user.suspended_until,
        });
      }

      const valid = await bcrypt.compare(String(password), user.password_hash);
      if (!valid) {
        recordFailure(email);
        await audit(req, 'auth.login_failed', {
          orgId: user.org_id, userId: user.id, deviceId: device.device_uid,
        });
        return res.status(401).json({ success: false, message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      }
      clearFailures(email);

      // Single-writer session issue (upsert device, refuse revoked, handoff if another
      // device holds authority) is AuthService.startSession — shared with OAuth login.
      let started;
      try {
        started = await AuthService.startSession({
          user, device, ip, userAgent: req.headers['user-agent'],
        });
      } catch (err) {
        if (err instanceof ServiceError) return sendError(res, err);
        throw err;
      }
      const { session, deviceRow, handoffPending } = started;

      await audit(req, 'auth.login', {
        orgId: user.org_id, userId: user.id, deviceId: device.device_uid,
        detail: { role: session.role, handoffPending },
      });

      console.log(`[LOGIN] ${user.email} org=${user.org_name} role=${session.role} handoff=${handoffPending}`);

      return res.json({
        success: true,
        data: {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          user: publicUser(user, session.role),
          organisation: {
            id: user.org_id,
            name: user.org_name,
            abn: user.abn,
            abnValidated: user.abn_validated,
            timezone: user.timezone,
            currency: user.currency,
            plan: user.plan,
          },
          device: deviceRow ? { id: deviceRow.id, role: deviceRow.role } : null,
          // The app blocks its sync queue until this clears — see /auth/session/status.
          handoffPending,
          authoritative: session.authoritative,
        },
      });
    } catch (err) {
      console.error('[LOGIN] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Login failed' });
    }
  }
);

// ============================================================================
// POST /auth/refresh — refresh token → new access token
//
// The refresh token is the opaque session UUID, not a JWT. It is only ever valid
// against a live, unrevoked session row, so revoking a device kills refresh too.
// ============================================================================
router.post('/refresh', async (req, res) => {
  const refreshToken = req.body.refreshToken || req.body.refresh_token;
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token required', code: 'NO_REFRESH_TOKEN' });
  }

  try {
    const [[session]] = await pool.query(
      `SELECT s.id, s.user_id, s.org_id, s.device_id, s.refresh_token, s.revoked_at,
              u.role AS user_role, u.status, u.security_version, u.force_logout_flag,
              o.status AS org_status
         FROM sessions s
         JOIN users u         ON u.id = s.user_id
         JOIN organisations o ON o.id = s.org_id
        WHERE s.refresh_token = ? AND s.expires_at > NOW()
        LIMIT 1`,
      [refreshToken]
    );

    if (!session) {
      return res.status(401).json({ success: false, message: 'Session expired', code: 'SESSION_EXPIRED' });
    }
    if (session.revoked_at) {
      return res.status(401).json({ success: false, message: 'Session revoked. Please log in again.', code: 'SESSION_REVOKED' });
    }
    if (session.status !== 'active' || session.org_status !== 'active' || session.force_logout_flag) {
      return res.status(403).json({ success: false, message: 'Account unavailable', code: 'UNAVAILABLE' });
    }

    // Re-read the device role on every refresh. If the org admin re-roles or revokes
    // a site tablet, the change takes effect within one access-token lifetime rather
    // than at the 30-day refresh horizon.
    let role = session.user_role;
    if (session.device_id && session.device_id !== 'unknown') {
      const [[device]] = await pool.query(
        `SELECT role, status FROM devices
          WHERE org_id = ? AND device_uid = ? AND is_deleted = 0 LIMIT 1`,
        [session.org_id, session.device_id]
      );
      if (device?.status && device.status !== 'active') {
        return res.status(401).json({ success: false, message: 'This device has been revoked', code: 'DEVICE_REVOKED' });
      }
      if (device?.role) role = device.role;
    }

    const accessToken = signAccess({
      userId: session.user_id,
      orgId: session.org_id,
      role,
      deviceUid: session.device_id,
      securityVersion: session.security_version,
      jti: session.refresh_token,
    });

    await pool.query('UPDATE sessions SET access_token = ? WHERE id = ?', [accessToken, session.id]);

    return res.json({ success: true, data: { accessToken, role } });
  } catch (err) {
    console.error('[REFRESH] Error:', err.message);
    return res.status(401).json({ success: false, message: 'Invalid refresh token', code: 'INVALID_REFRESH_TOKEN' });
  }
});

// ============================================================================
// POST /auth/logout
//
// The session row is marked revoked, never deleted: an access token already in
// flight is valid for up to 15 more minutes, and the row is what lets the auth
// middleware reject it.
// ============================================================================
router.post('/logout', authenticate, async (req, res) => {
  const refreshToken = req.body.refreshToken || req.body.refresh_token || req.auth.jti;

  try {
    if (refreshToken) {
      await pool.query(
        `UPDATE sessions SET revoked_at = NOW(), is_authoritative = 0
          WHERE refresh_token = ? AND user_id = ?`,
        [refreshToken, req.auth.userId]
      );
    }
    await audit(req, 'auth.logout', { entity: 'sessions', entityId: refreshToken });
    return res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    console.error('[LOGOUT] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Logout failed' });
  }
});

// ============================================================================
// GET /auth/me
// ============================================================================
router.get('/me', authenticate, async (req, res) => {
  const { user } = req.auth;
  return res.json({
    success: true,
    data: {
      user: publicUser(user, req.auth.role),
      organisation: {
        id: user.org_id,
        name: user.org_name,
        timezone: user.timezone,
        currency: user.currency,
      },
      device: req.auth.deviceUid
        ? { uid: req.auth.deviceUid, id: req.auth.deviceId, role: req.auth.role }
        : null,
    },
  });
});

// ============================================================================
// GET /auth/permissions   (authenticated)
//
// The server side of "roles as data" (§9.7). The app's RoleVisibility and the
// pairing screen render from THIS — the 5-role shortlist and the effective
// permission set become server data, so the client stops hard-coding a copy that
// drifts (which is how `inspector` shipped ahead of the server enum).
//
//   matrixVersion    bump it and the app knows its cached copy is stale
//   permissions      what THIS session's role may do (drives UI enablement only —
//                    the server still enforces every one server-side)
//   scopeClass       portfolio | assigned | self | engagement | portal
//   pairableRoles    the device-pairable shortlist (label + enum) for the QR screen
//   assignableRoles  roles a user may currently be given (user-management UI)
// ============================================================================
router.get('/permissions', authenticate, async (req, res) => {
  const role = req.auth.role;
  const meta = access.roleMeta(role);
  return res.json({
    success: true,
    data: {
      matrixVersion: access.matrixVersion(),
      role,
      scopeClass: meta?.scopeClass || null,
      permissions: [...access.permissionsFor(role)],
      pairableRoles: access.pairableRoles(),
      assignableRoles: access.assignableRoles(),
    },
  });
});

// ============================================================================
// GET /auth/session/status
//
// The app polls this on resume. It answers two questions at once: is this session
// still alive, and does this device currently hold the right to push?
//
// The server-side timeout is the important half. The old authoritative device is
// supposed to hand over when asked — but a site tablet that was dropped off a
// scaffold never will, and without a ceiling its replacement polls forever.
// ============================================================================
router.get('/session/status', authenticate, async (req, res) => {
  const { userId, jti } = req.auth;

  if (!jti) {
    return res.json({ success: true, data: { valid: true, authoritative: false, reason: 'no_session' } });
  }

  try {
    const [[session]] = await pool.query(
      `SELECT id, device_id, is_authoritative, revoked_at, authority_since,
              TIMESTAMPDIFF(SECOND, issued_at, NOW()) AS age_s
         FROM sessions WHERE refresh_token = ? AND user_id = ? LIMIT 1`,
      [jti, userId]
    );

    if (!session) {
      return res.json({ success: true, data: { valid: false, authoritative: false, reason: 'session_not_found' } });
    }
    if (session.revoked_at) {
      return res.json({ success: true, data: { valid: false, authoritative: false, reason: 'revoked' } });
    }
    if (session.is_authoritative) {
      return res.json({
        success: true,
        data: { valid: true, authoritative: true, authoritySince: session.authority_since },
      });
    }

    const [[holder]] = await pool.query(
      `SELECT id, device_id FROM sessions
        WHERE user_id = ? AND is_authoritative = 1 AND revoked_at IS NULL AND expires_at > NOW()
        LIMIT 1`,
      [userId]
    );

    if (!holder) {
      // Nobody holds authority — take it rather than deadlock.
      await pool.query(
        `UPDATE sessions SET is_authoritative = 1, authority_since = NOW() WHERE id = ?`,
        [session.id]
      );
      return res.json({
        success: true,
        data: { valid: true, authoritative: true, reason: 'uncontested' },
      });
    }

    if (Number(session.age_s) >= config.handoff.timeoutSeconds) {
      await pool.query(
        `UPDATE sessions SET is_authoritative = 0, revoked_at = NOW() WHERE id = ?`,
        [holder.id]
      );
      await pool.query(
        `UPDATE sessions SET is_authoritative = 1, authority_since = NOW() WHERE id = ?`,
        [session.id]
      );
      await audit(req, 'session.authority_forced', {
        entity: 'sessions', entityId: session.id,
        detail: { displaced_device: holder.device_id, after_seconds: Number(session.age_s) },
      });
      console.warn(`[SESSION] Authority force-granted to device=${session.device_id}; old device=${holder.device_id} never responded`);
      return res.json({
        success: true,
        data: { valid: true, authoritative: true, reason: 'handoff_timeout' },
      });
    }

    return res.json({
      success: true,
      data: {
        valid: true,
        authoritative: false,
        reason: 'handoff_pending',
        holderDevice: holder.device_id,
        retryAfterSeconds: config.handoff.timeoutSeconds - Number(session.age_s),
      },
    });
  } catch (err) {
    console.error('[SESSION/STATUS] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to check session status' });
  }
});

// ============================================================================
// POST /auth/session/pending-count
// The authoritative device reports its unsynced queue depth after each cycle.
// The handoff logic reads last_sync_at to decide whether to warn the incoming
// device that the outgoing one probably still held unsaved work.
// ============================================================================
router.post('/session/pending-count', authenticate, async (req, res) => {
  const count = parseInt(req.body.pendingCount ?? req.body.pending_count ?? 0, 10) || 0;
  try {
    if (req.auth.jti) {
      await pool.query(
        `UPDATE sessions SET last_pending_count = ?, last_sync_at = NOW()
          WHERE refresh_token = ? AND user_id = ?`,
        [count, req.auth.jti, req.auth.userId]
      );
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[PENDING-COUNT] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update pending count' });
  }
});

// ============================================================================
// POST /auth/change-password — logged in, requires the current password
// ============================================================================
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: config.password.minLength })
      .withMessage(`Password must be at least ${config.password.minLength} characters`),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    try {
      const [[row]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.auth.userId]);
      const valid = await bcrypt.compare(String(req.body.currentPassword), row.password_hash);
      if (!valid) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect', code: 'INVALID_CREDENTIALS' });
      }

      const hash = await bcrypt.hash(String(req.body.newPassword), config.password.bcryptCost);
      await pool.query(
        `UPDATE users SET password_hash = ?, security_version = security_version + 1 WHERE id = ?`,
        [hash, req.auth.userId]
      );

      // Every other session dies; this one is reissued so the user is not logged out
      // of the device they are standing in front of.
      await pool.query(
        `UPDATE sessions SET revoked_at = NOW(), is_authoritative = 0
          WHERE user_id = ? AND refresh_token != ? AND revoked_at IS NULL`,
        [req.auth.userId, req.auth.jti || '']
      );

      await audit(req, 'auth.password_changed', { entity: 'users', entityId: req.auth.userId });

      const [[user]] = await pool.query(
        `SELECT id, org_id, role, security_version FROM users WHERE id = ?`,
        [req.auth.userId]
      );
      const accessToken = signAccess({
        userId: user.id, orgId: user.org_id, role: req.auth.role,
        deviceUid: req.auth.deviceUid, securityVersion: user.security_version, jti: req.auth.jti,
      });

      return res.json({ success: true, message: 'Password changed', data: { accessToken } });
    } catch (err) {
      console.error('[CHANGE-PASSWORD] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to change password' });
    }
  }
);

module.exports = router;
