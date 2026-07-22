// audit_log writer.
//
// Present from day one at the brief's insistence, and it is the right call:
// construction disputes are evidentiary. "Who marked that stage complete, from which
// device" gets asked in anger months later, by which time nothing else can answer it.
//
// Writes are best-effort — a failed audit insert must never fail the request that
// caused it — but a failure is logged loudly, because a silently empty audit log is
// worse than none at all.

const pool = require('../db/pool');

/** Client IP, honouring a reverse proxy. */
function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.ip ||
    null
  );
}

/**
 * @param {object} req      Express request (for ip + req.auth)
 * @param {string} action   Dotted verb, e.g. 'auth.login', 'pairing.confirm'
 * @param {object} [opts]   { orgId, userId, deviceId, entity, entityId, detail }
 */
async function audit(req, action, opts = {}) {
  try {
    await pool.query(
      `INSERT INTO audit_log
         (org_id, user_id, device_id, action, entity, entity_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        opts.orgId    ?? req?.auth?.orgId    ?? null,
        opts.userId   ?? req?.auth?.userId   ?? null,
        opts.deviceId ?? req?.auth?.deviceUid ?? null,
        action,
        opts.entity   ?? null,
        opts.entityId != null ? String(opts.entityId) : null,
        opts.detail ? JSON.stringify(opts.detail) : null,
        clientIp(req),
      ]
    );
  } catch (err) {
    console.error(`[AUDIT] FAILED to record ${action}:`, err.message);
  }
}

module.exports = { audit, clientIp };
