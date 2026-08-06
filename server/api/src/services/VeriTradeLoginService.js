// VeriTradeLoginService — App-mediated login (veritradedesignspecification.md §4):
// "There is no VeriTrade password, for anyone, on either side of the marketplace."
//
// Flow: a browser calls initiate() (no auth) and renders `code` as a QR. The App
// scans it, calls context() (authenticated — the App's own existing session) to show
// the person what they're approving (device/IP/timestamp), then approve() or deny().
// The browser polls status() (no auth beyond the code itself) until it sees
// 'approved', at which point it collects a normal ProjMan session token pair — same
// shape as any other web login (`AuthService.startSession`, non-authoritative, same
// as Portal) — exactly matching §4's "one auth model, no exception."

const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const config = require('../config');
const { ServiceError } = require('./errors');
const AuthService = require('./AuthService');

const SESSION_TTL_SECONDS = 5 * 60; // a login QR is a face-to-face-with-your-own-phone primitive

function signCode(sessionId) {
  return jwt.sign({ typ: 'veritrade_login', sid: sessionId }, config.jwt.secret, { expiresIn: SESSION_TTL_SECONDS });
}

function verifyCode(code, sessionId) {
  let payload;
  try {
    payload = jwt.verify(String(code || '').trim(), config.jwt.secret);
  } catch {
    throw new ServiceError('INVALID_CODE', 'This login code is invalid or has expired', 400);
  }
  if (payload.typ !== 'veritrade_login' || String(payload.sid) !== String(sessionId)) {
    throw new ServiceError('INVALID_CODE', 'This is not a valid login code for this session', 400);
  }
}

async function loadPendingOrThrow(sessionId) {
  const [[row]] = await pool.query(`SELECT * FROM veritrade_login_sessions WHERE id = ? LIMIT 1`, [sessionId]);
  if (!row) throw new ServiceError('NOT_FOUND', 'Login session not found', 404);
  if (row.status === 'pending' && new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query(`UPDATE veritrade_login_sessions SET status = 'expired' WHERE id = ?`, [sessionId]);
    row.status = 'expired';
  }
  return row;
}

/** POST /veritrade/login/initiate — the browser, unauthenticated. */
async function initiate({ ip, userAgent }) {
  const id = uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await pool.query(
    `INSERT INTO veritrade_login_sessions (id, requested_ip, requested_user_agent, expires_at)
     VALUES (?, ?, ?, ?)`,
    [id, ip || null, userAgent || null, expiresAt]
  );
  return { session_id: id, code: signCode(id), expires_at: expiresAt };
}

/** GET /veritrade/login/:id/context — the App, after scanning, before deciding. */
async function context({ sessionId, code }) {
  verifyCode(code, sessionId);
  const row = await loadPendingOrThrow(sessionId);
  if (row.status !== 'pending') {
    throw new ServiceError('ALREADY_RESOLVED', `This login request is already ${row.status}`, 409);
  }
  return {
    status: row.status,
    requested_ip: row.requested_ip,
    requested_user_agent: row.requested_user_agent,
    requested_at: row.created_at,
    expires_at: row.expires_at,
  };
}

/** POST /veritrade/login/:id/approve — the App user, authenticated, taps Approve. */
async function approve({ sessionId, code, user, ip, userAgent }) {
  verifyCode(code, sessionId);
  const row = await loadPendingOrThrow(sessionId);
  if (row.status !== 'pending') {
    throw new ServiceError('ALREADY_RESOLVED', `This login request is already ${row.status}`, 409);
  }

  // Same posture as any other web surface (Portal): never the offline single writer.
  const { session } = await AuthService.startSession({
    user, device: { device_uid: `veritrade-web-${sessionId}`, platform: 'web' }, ip, userAgent,
  });

  await pool.query(
    `UPDATE veritrade_login_sessions
        SET status = 'approved', approved_user_id = ?, access_token = ?, refresh_token = ?, resolved_at = NOW()
      WHERE id = ?`,
    [user.id, session.accessToken, session.refreshToken, sessionId]
  );
  return { status: 'approved' };
}

/** POST /veritrade/login/:id/deny — the App user, authenticated, taps Deny. */
async function deny({ sessionId, code }) {
  verifyCode(code, sessionId);
  const row = await loadPendingOrThrow(sessionId);
  if (row.status !== 'pending') {
    throw new ServiceError('ALREADY_RESOLVED', `This login request is already ${row.status}`, 409);
  }
  await pool.query(`UPDATE veritrade_login_sessions SET status = 'denied', resolved_at = NOW() WHERE id = ?`, [sessionId]);
  return { status: 'denied' };
}

/** GET /veritrade/login/:id/status — the browser, polling. Consume-once on tokens. */
async function status({ sessionId, code }) {
  verifyCode(code, sessionId);
  const row = await loadPendingOrThrow(sessionId);
  if (row.status !== 'approved') {
    return { status: row.status };
  }
  if (row.redeemed_at) {
    return { status: 'approved', redeemed: true };
  }
  await pool.query(
    `UPDATE veritrade_login_sessions SET redeemed_at = NOW(), access_token = NULL, refresh_token = NULL WHERE id = ?`,
    [sessionId]
  );
  return { status: 'approved', access_token: row.access_token, refresh_token: row.refresh_token };
}

module.exports = { initiate, context, approve, deny, status };
