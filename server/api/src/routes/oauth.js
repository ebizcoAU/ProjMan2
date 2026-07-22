// Mounted at /auth (alongside auth.js) — the Australian sign-in surface.
//
//   POST /auth/oauth/:provider   Google | Microsoft | Facebook  → session
//   POST /auth/onboarding        the post-auth AU business step (ABN, state, type, GST)
//   POST /auth/sms/request       send a code to a +61 mobile
//   POST /auth/sms/verify        confirm the code → mobile_verified
//
// The three providers are the whole set — no GitHub, Apple, X, TikTok, LinkedIn. The
// login screen the app team is building shows exactly Google / Microsoft / Facebook,
// with email+password beneath, so this router exposes exactly those.
//
// Sign-in model: email is the identity key. A provider account links to a local user
// by verified email, so signing in with Google and later Microsoft on the same
// address lands on ONE account. A brand-new email creates an org + org_admin (like
// /auth/register) but with onboarding_complete = 0 so the app shows the AU onboarding
// screen next.

const router = require('express').Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');

const pool   = require('../db/pool');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { audit, clientIp } = require('../lib/audit');
const { validateAbn } = require('../lib/abn');
const { verify: verifyOAuth, OAuthError } = require('../lib/oauth');
const { normaliseAuMobile, maskMobile, sendVerificationCode } = require('../lib/sms');
const { upsertDevice, readDevice } = require('../lib/tokens');
const AuthService = require('../services/AuthService');
const { sendError } = require('../services/errors');

function validation(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  const first = errors.array()[0];
  res.status(422).json({ success: false, message: first.msg, code: 'VALIDATION_ERROR', field: first.path });
  return true;
}

const publicUser = (u, role) => ({
  id: u.id,
  orgId: u.org_id,
  email: u.email,
  fullName: u.full_name,
  mobile: u.mobile || null,
  mobileVerified: !!u.mobile_verified,
  role: role || u.role,
  status: u.status,
  onboardingComplete: !!u.onboarding_complete,
});

// ============================================================================
// POST /auth/oauth/:provider   { token, device? }
// ============================================================================
router.post(
  '/oauth/:provider',
  [body('token').notEmpty().withMessage('A provider token is required')],
  async (req, res) => {
    if (validation(req, res)) return;

    const provider = String(req.params.provider || '').toLowerCase();
    const device = readDevice(req.body.device || req.body);
    const ip = clientIp(req);

    let identity;
    try {
      identity = await verifyOAuth(provider, req.body.token);
    } catch (err) {
      if (err instanceof OAuthError) {
        return res.status(err.status).json({ success: false, message: err.message, code: err.code });
      }
      console.error('[OAUTH] verify error:', err.message);
      return res.status(502).json({ success: false, message: 'Could not verify sign-in with the provider', code: 'PROVIDER_UNAVAILABLE' });
    }

    // Google's email_verified can be false for some accounts; a provider that returns
    // an unverified email cannot be trusted to prove the address is the user's.
    if (!identity.emailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Your provider has not verified this email address. Verify it, or sign in another way.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    try {
      // 1. Known external account → sign that user straight in.
      const [[link]] = await pool.query(
        `SELECT ai.id AS identity_id, u.*
           FROM auth_identities ai JOIN users u ON u.id = ai.user_id
          WHERE ai.provider = ? AND ai.provider_sub = ? AND u.is_deleted = 0
          LIMIT 1`,
        [provider, identity.sub]
      );
      if (link) {
        await pool.query('UPDATE auth_identities SET last_login_at = NOW() WHERE id = ?', [link.identity_id]);
        return respondWithSession(req, res, link, device, ip, { provider, isNewUser: false });
      }

      // 2. Same email already has an account → link this provider to it.
      const [[existing]] = await pool.query(
        `SELECT * FROM users WHERE email = ? AND is_deleted = 0 LIMIT 1`,
        [identity.email]
      );
      if (existing) {
        await pool.query(
          `INSERT INTO auth_identities (id, user_id, provider, provider_sub, email, last_login_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [uuidv4(), existing.id, provider, identity.sub, identity.email]
        );
        await audit(req, 'auth.oauth_linked', {
          orgId: existing.org_id, userId: existing.id, deviceId: device.device_uid,
          entity: 'auth_identities', detail: { provider },
        });
        return respondWithSession(req, res, existing, device, ip, { provider, isNewUser: false });
      }

      // 3. Brand-new email → create org + first user, pending onboarding.
      const orgId = uuidv4();
      const userId = uuidv4();
      const conn = await pool.getConnection();
      await conn.beginTransaction();
      try {
        await conn.query(
          `INSERT INTO organisations
             (id, name, timezone, currency, plan, status, trial_ends_at)
           VALUES (?, ?, ?, ?, 'trial', 'active', DATE_ADD(NOW(), INTERVAL 90 DAY))`,
          [orgId, identity.name ? `${identity.name}'s organisation` : 'My organisation',
           config.server.timezone, config.server.currency]
        );
        await conn.query(
          `INSERT INTO users
             (id, org_id, email, password_hash, full_name, role, status, onboarding_complete)
           VALUES (?, ?, ?, NULL, ?, 'org_admin', 'active', 0)`,
          [userId, orgId, identity.email, identity.name || identity.email.split('@')[0]]
        );
        await conn.query(
          `INSERT INTO auth_identities (id, user_id, provider, provider_sub, email, last_login_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [uuidv4(), userId, provider, identity.sub, identity.email]
        );
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }

      const [[user]] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [userId]);
      const dev = await upsertDevice({ orgId, userId, device, role: 'org_admin', ip });
      if (dev) {
        await pool.query('UPDATE devices SET is_primary = 1, paired_at = NOW(), paired_by = ? WHERE id = ?', [userId, dev.id]);
      }
      await audit(req, 'auth.oauth_register', {
        orgId, userId, deviceId: device.device_uid,
        entity: 'users', entityId: userId, detail: { provider },
      });
      console.log(`[OAUTH] new account via ${provider}: ${identity.email}`);
      return respondWithSession(req, res, user, device, ip, { provider, isNewUser: true });
    } catch (err) {
      console.error('[OAUTH] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Sign-in failed', code: 'OAUTH_FAILED' });
    }
  }
);

// Shared session issue + response for all three OAuth branches.
async function respondWithSession(req, res, user, device, ip, { provider, isNewUser }) {
  if (user.status !== 'active') {
    return res.status(403).json({ success: false, message: `Account ${user.status}`, code: user.status.toUpperCase() });
  }

  // Single-writer session issue — the same AuthService.startSession password login
  // uses, so OAuth and password sign-in behave identically re: device roles + handoff.
  let started;
  try {
    started = await AuthService.startSession({ user, device, ip, userAgent: req.headers['user-agent'] });
  } catch (err) {
    return sendError(res, err);
  }
  const { session, deviceRow, handoffPending } = started;

  await audit(req, 'auth.oauth_login', {
    orgId: user.org_id, userId: user.id, deviceId: device.device_uid, detail: { provider },
  });

  const [[org]] = await pool.query(
    `SELECT id, name, abn, abn_validated, state, business_type, gst_registered,
            timezone, currency, plan FROM organisations WHERE id = ?`,
    [user.org_id]
  );

  return res.status(isNewUser ? 201 : 200).json({
    success: true,
    data: {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: publicUser(user, session.role),
      organisation: org,
      device: deviceRow ? { id: deviceRow.id, role: deviceRow.role } : null,
      handoffPending,
      authoritative: session.authoritative,
      isNewUser,
      // The app routes to the AU onboarding screen when this is true. Returned under
      // BOTH names: the contract says `onboardingRequired` (projman-01 §1.8), the app
      // team originally proposed `needsOnboarding` — the alias costs nothing and
      // whichever the client coded against works. Remove the loser once confirmed.
      onboardingRequired: !user.onboarding_complete,
      needsOnboarding: !user.onboarding_complete,
    },
  });
}

// ============================================================================
// POST /auth/onboarding   (authenticated)
// The post-auth AU business step. ABN optional in v1 (required for invoicing later);
// state, business type and GST status collected now.
// ============================================================================
router.post(
  '/onboarding',
  authenticate,
  [
    body('state').isIn(['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'NT', 'ACT'])
      .withMessage('Select your state or territory'),
    body('business_type').isIn(['sole_trader', 'partnership', 'company', 'trust'])
      .withMessage('Select a business type'),
    body('gst_registered').isBoolean().withMessage('Tell us your GST registration status'),
    body('abn').optional({ nullable: true, checkFalsy: true }).isString(),
    body('organisation_name').optional({ nullable: true, checkFalsy: true }).trim().notEmpty(),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    // Onboarding configures the org, so it is an org_admin action. An OAuth first
    // sign-in makes the new user org_admin, so this holds for the intended caller.
    if (req.auth.role !== 'org_admin') {
      return res.status(403).json({ success: false, message: 'Only the organisation owner can complete onboarding', code: 'FORBIDDEN_ROLE' });
    }

    try {
      const fields = {
        state: req.body.state,
        business_type: req.body.business_type,
        gst_registered: req.body.gst_registered ? 1 : 0,
      };
      if (req.body.organisation_name) fields.name = req.body.organisation_name;
      if (req.body.postcode) fields.postcode = req.body.postcode;

      if (req.body.abn !== undefined && req.body.abn !== null && req.body.abn !== '') {
        const abnResult = await validateAbn(req.body.abn);
        if (abnResult.level === 'no') {
          return res.status(422).json({ success: false, message: 'That ABN is not valid. Check the 11 digits, or leave it blank for now.', code: 'INVALID_ABN', field: 'abn' });
        }
        fields.abn = abnResult.abn;
        fields.abn_validated = abnResult.level;
        fields.abn_checked_at = new Date();
      }

      const columns = Object.keys(fields);
      await pool.query(
        `UPDATE organisations SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')},
                                  updated_at = ?, server_updated_at = NOW(3)
          WHERE id = ?`,
        [...Object.values(fields), Date.now(), req.auth.orgId]
      );
      await pool.query('UPDATE users SET onboarding_complete = 1 WHERE id = ?', [req.auth.userId]);

      await audit(req, 'auth.onboarding_complete', {
        entity: 'organisations', entityId: req.auth.orgId,
        detail: { business_type: fields.business_type, gst_registered: !!fields.gst_registered, abn: fields.abn_validated || 'unset' },
      });

      const [[org]] = await pool.query('SELECT * FROM organisations WHERE id = ?', [req.auth.orgId]);
      const [[user]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.auth.userId]);
      return res.json({ success: true, data: { organisation: org, user: publicUser(user, req.auth.role) } });
    } catch (err) {
      console.error('[ONBOARDING] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Onboarding failed' });
    }
  }
);

// ============================================================================
// POST /auth/sms/request   (authenticated)  { mobile }
// ============================================================================
router.post(
  '/sms/request',
  authenticate,
  [body('mobile').notEmpty().withMessage('Enter your mobile number')],
  async (req, res) => {
    if (validation(req, res)) return;

    const mobile = normaliseAuMobile(req.body.mobile);
    if (!mobile) {
      return res.status(422).json({ success: false, message: 'Enter a valid Australian mobile (04xx xxx xxx)', code: 'INVALID_MOBILE', field: 'mobile' });
    }

    try {
      // Supersede any outstanding code for this user.
      await pool.query(
        `UPDATE sms_verifications SET verified_at = NOW()
          WHERE user_id = ? AND verified_at IS NULL`,
        [req.auth.userId]
      );

      const code = String(crypto.randomInt(100000, 1000000));
      await pool.query(
        `INSERT INTO sms_verifications (id, user_id, mobile, code_hash, expires_at)
         VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [uuidv4(), req.auth.userId, mobile, await bcrypt.hash(code, 10), config.sms.codeTtlSeconds]
      );

      await sendVerificationCode(mobile, code);
      await audit(req, 'sms.requested', { entity: 'sms_verifications', detail: { mobile: maskMobile(mobile) } });

      return res.json({
        success: true,
        data: { maskedMobile: maskMobile(mobile), expiresIn: config.sms.codeTtlSeconds },
      });
    } catch (err) {
      console.error('[SMS/REQUEST] Error:', err.message);
      return res.status(502).json({ success: false, message: 'Could not send the verification code', code: 'SMS_SEND_FAILED' });
    }
  }
);

// ============================================================================
// POST /auth/sms/verify   (authenticated)  { mobile, code }
// ============================================================================
router.post(
  '/sms/verify',
  authenticate,
  [
    body('mobile').notEmpty(),
    body('code').isLength({ min: 6, max: 6 }).withMessage('Enter the 6-digit code'),
  ],
  async (req, res) => {
    if (validation(req, res)) return;

    const mobile = normaliseAuMobile(req.body.mobile);
    if (!mobile) {
      return res.status(422).json({ success: false, message: 'Enter a valid Australian mobile', code: 'INVALID_MOBILE', field: 'mobile' });
    }

    try {
      const [[row]] = await pool.query(
        `SELECT id, code_hash, attempts FROM sms_verifications
          WHERE user_id = ? AND mobile = ? AND verified_at IS NULL AND expires_at > NOW()
          ORDER BY created_at DESC LIMIT 1`,
        [req.auth.userId, mobile]
      );
      if (!row) {
        return res.status(401).json({ success: false, message: 'That code is not valid or has expired', code: 'INVALID_CODE' });
      }
      if (row.attempts >= config.sms.maxAttempts) {
        await pool.query('UPDATE sms_verifications SET verified_at = NOW() WHERE id = ?', [row.id]);
        return res.status(429).json({ success: false, message: 'Too many attempts. Request a new code.', code: 'TOO_MANY_ATTEMPTS' });
      }
      if (!(await bcrypt.compare(String(req.body.code), row.code_hash))) {
        await pool.query('UPDATE sms_verifications SET attempts = attempts + 1 WHERE id = ?', [row.id]);
        return res.status(401).json({ success: false, message: 'That code is not valid or has expired', code: 'INVALID_CODE' });
      }

      await pool.query('UPDATE sms_verifications SET verified_at = NOW() WHERE id = ?', [row.id]);
      await pool.query('UPDATE users SET mobile = ?, mobile_verified = 1 WHERE id = ?', [mobile, req.auth.userId]);
      await audit(req, 'sms.verified', { entity: 'users', entityId: req.auth.userId, detail: { mobile: maskMobile(mobile) } });

      return res.json({ success: true, data: { mobile, mobileVerified: true } });
    } catch (err) {
      console.error('[SMS/VERIFY] Error:', err.message);
      return res.status(500).json({ success: false, message: 'Verification failed' });
    }
  }
);

module.exports = router;
