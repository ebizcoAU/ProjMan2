// Issue a recovery code: supersede any outstanding code, store a bcrypt hash of a fresh 6-digit
// code, and email it. Shared by POST /auth/recovery/request (the user asks) and the platform
// admin's "send password reset" action (support asks on the user's behalf), so the two can't drift.

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const config = require('../config');
const { sendRecoveryCode } = require('./email');

async function issueRecoveryCode(user, purpose = 'password_reset') {
  // Two live codes would be a second valid guess against the same account.
  await pool.query(
    `UPDATE recovery_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
    [user.id, purpose]);
  const code = String(crypto.randomInt(100000, 1000000));
  await pool.query(
    `INSERT INTO recovery_tokens (id, user_id, code_hash, purpose, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [uuidv4(), user.id, await bcrypt.hash(code, 10), purpose, config.recovery.codeTtlSeconds]);
  await sendRecoveryCode(user.email, code, purpose, user.full_name);
}

module.exports = { issueRecoveryCode };
