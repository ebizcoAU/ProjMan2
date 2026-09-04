// AdminService — the System Admin dashboard queries (dashboardspec §5/§6).
//
// EVERY query here is cross-tenant (all orgs) and touches the ACCOUNT LAYER ONLY —
// user accounts, auth events, devices, orgs. It never reads a project, stage, task,
// diary, photo, document, or any construction content. That boundary is the whole
// point of this surface (owner: "the dashboard has nothing to do with projects or user
// content"); the admin test asserts no endpoint here returns domain data.
//
// `orgFilter` is an optional narrowing (view one org), never a security boundary — the
// caller is already a platform admin (adminAuth). It is NOT the tenant `org_id`-from-
// token filter.

const pool = require('../db/pool');
const { ServiceError } = require('./errors');
const geo = require('../lib/geo');

// ── Summary stats (all orgs) ──────────────────────────────────────────────────
async function stats() {
  const [[orgs]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(created_at >= NOW() - INTERVAL 30 DAY) AS new30,
            SUM(trial_ends_at IS NOT NULL AND trial_ends_at BETWEEN NOW() AND NOW() + INTERVAL 30 DAY) AS trials_expiring
       FROM organisations WHERE is_deleted = 0`
  );
  const [[users]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'active')    AS active,
            SUM(status = 'suspended') AS suspended,
            SUM(status = 'disabled')  AS disabled,
            SUM(created_at >= NOW() - INTERVAL 7 DAY)  AS new7,
            SUM(created_at >= NOW() - INTERVAL 30 DAY) AS new30
       FROM users WHERE is_deleted = 0`
  );
  const [usersByRole] = await pool.query(
    `SELECT role, COUNT(*) AS n FROM users WHERE is_deleted = 0 GROUP BY role`
  );
  const [[sessions]] = await pool.query(
    `SELECT COUNT(*) AS active FROM sessions WHERE revoked_at IS NULL AND expires_at > NOW()`
  );
  const [[devices]] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'active') AS active,
            SUM(last_seen_at >= NOW() - INTERVAL 1 DAY) AS active24h
       FROM devices WHERE is_deleted = 0`
  );
  const [[logins]] = await pool.query(
    `SELECT SUM(action = 'auth.login' OR action = 'auth.oauth_login') AS success,
            SUM(action = 'auth.login_failed') AS failed
       FROM audit_log WHERE created_at >= NOW() - INTERVAL 30 DAY`
  );
  const [loginByMethod] = await pool.query(
    `SELECT COALESCE(ai.provider, 'email') AS method, COUNT(*) AS n
       FROM audit_log a
       LEFT JOIN auth_identities ai ON ai.user_id = a.user_id
      WHERE a.action IN ('auth.login', 'auth.oauth_login')
        AND a.created_at >= NOW() - INTERVAL 30 DAY
      GROUP BY method`
  );

  const num = (v) => Number(v) || 0;
  return {
    organisations: { total: num(orgs.total), new30: num(orgs.new30), trialsExpiring: num(orgs.trials_expiring) },
    users: {
      total: num(users.total), active: num(users.active), suspended: num(users.suspended),
      disabled: num(users.disabled), new7: num(users.new7), new30: num(users.new30),
      byRole: usersByRole.map((r) => ({ role: r.role, count: num(r.n) })),
    },
    sessions: { active: num(sessions.active) },
    devices: { total: num(devices.total), active: num(devices.active), active24h: num(devices.active24h) },
    logins30d: { success: num(logins.success), failed: num(logins.failed),
      byMethod: loginByMethod.map((r) => ({ method: r.method, count: num(r.n) })) },
    geoEnabled: geo.enabled(),
    serverTime: Date.now(),
  };
}

// Sortable-column allowlists — never interpolate a caller-given column name directly,
// map through one of these or fall back to the table's natural order.
function orderClause(sortBy, sortDir, allowed, fallback) {
  // `fallback` already carries its own direction (e.g. 'o.created_at DESC', or a
  // multi-column tiebreak like 'd.last_seen_at DESC, d.paired_at DESC') — only a
  // caller-requested column additionally takes the asc/desc toggle.
  if (!sortBy || !allowed[sortBy]) return `ORDER BY ${fallback}`;
  const dir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${allowed[sortBy]} ${dir}`;
}

const USER_SORT = {
  name: 'u.full_name', email: 'u.email', org: 'o.name', role: 'u.role',
  status: 'u.status', last_login: 'u.last_login_at', created: 'u.created_at',
};

// ── User accounts (all orgs) ──────────────────────────────────────────────────
// `scope`: 'internal' (platform-ops accounts, @projman.internal — see
// scripts/seed-admin-team.js) | 'tenant' (everyone else) | omitted = both, unfiltered.
// The dashboard calls this twice (once per scope) to render two grouped, independently
// paginated tables — internal accounts are a handful of platform-ops rows and would
// otherwise be lost inside hundreds of tenant rows with no way to tell them apart.
async function listUsers({ orgId, role, status, scope, search, sortBy, sortDir, page = 1, limit = 25 }) {
  const where = ['u.is_deleted = 0'];
  const params = [];
  if (orgId)  { where.push('u.org_id = ?'); params.push(orgId); }
  if (role)   { where.push('u.role = ?');   params.push(role); }
  if (status) { where.push('u.status = ?'); params.push(status); }
  if (scope === 'internal') where.push(`u.email LIKE '%@projman.internal'`);
  if (scope === 'tenant')   where.push(`u.email NOT LIKE '%@projman.internal'`);
  // Free-text: email, phone, role or organisation — one box, matched across all four
  // rather than making the caller pick which field they meant.
  if (search && search.trim()) {
    where.push('(u.email LIKE ? OR u.mobile LIKE ? OR u.role LIKE ? OR o.name LIKE ? OR u.full_name LIKE ?)');
    const like = `%${search.trim()}%`;
    params.push(like, like, like, like, like);
  }
  const whereSql = where.join(' AND ');
  const order = orderClause(sortBy, sortDir, USER_SORT, 'u.created_at DESC');

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM users u JOIN organisations o ON o.id = u.org_id WHERE ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.mobile, u.full_name, u.role, u.status, u.mobile_verified,
            u.last_login_at, u.created_at, o.id AS org_id, o.name AS org_name
       FROM users u JOIN organisations o ON o.id = u.org_id
      WHERE ${whereSql}
      ${order}
      LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Number(page) - 1) * Number(limit)]
  );
  return { users: rows, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) || 1 } };
}

// ── Account actions (account layer only — never touches the user's work) ──────
async function userAction({ userId, action }) {
  const [[user]] = await pool.query('SELECT id, status, security_version FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1', [userId]);
  if (!user) throw new ServiceError('NOT_FOUND', 'User account not found', 404);

  if (action === 'suspend') {
    await pool.query(`UPDATE users SET status = 'suspended' WHERE id = ?`, [userId]);
  } else if (action === 'reactivate') {
    await pool.query(`UPDATE users SET status = 'active' WHERE id = ?`, [userId]);
  } else if (action === 'force-logout') {
    // Bump security_version (invalidates every token) + revoke live sessions.
    await pool.query(`UPDATE users SET security_version = security_version + 1 WHERE id = ?`, [userId]);
    await pool.query(`UPDATE sessions SET revoked_at = NOW(), is_authoritative = 0 WHERE user_id = ? AND revoked_at IS NULL`, [userId]);
  } else {
    throw new ServiceError('VALIDATION_ERROR', 'Unknown action', 400);
  }
  return { userId, action };
}

const DEVICE_SORT = {
  name: 'd.device_name', org: 'o.name', user: 'u.full_name', platform: 'd.platform',
  role: 'd.role', status: 'd.status', last_seen: 'd.last_seen_at', paired: 'd.paired_at',
};

// ── Devices (all orgs) ────────────────────────────────────────────────────────
async function listDevices({ orgId, status, role, search, sortBy, sortDir, page = 1, limit = 25 }) {
  const where = ['d.is_deleted = 0'];
  const params = [];
  if (orgId)  { where.push('d.org_id = ?'); params.push(orgId); }
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (role)   { where.push('d.role = ?');   params.push(role); }
  // Free-text: device name, paired user, organisation, role or platform.
  if (search && search.trim()) {
    where.push('(d.device_name LIKE ? OR u.full_name LIKE ? OR o.name LIKE ? OR d.role LIKE ? OR d.platform LIKE ?)');
    const like = `%${search.trim()}%`;
    params.push(like, like, like, like, like);
  }
  const whereSql = where.join(' AND ');
  const order = orderClause(sortBy, sortDir, DEVICE_SORT, 'd.last_seen_at DESC, d.paired_at DESC');
  const fromSql = `devices d JOIN organisations o ON o.id = d.org_id LEFT JOIN users u ON u.id = d.user_id`;

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM ${fromSql} WHERE ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT d.id, d.device_name, d.platform, d.model, d.os_version, d.role, d.status,
            d.last_seen_at, d.paired_at, o.name AS org_name, u.full_name AS user_name
       FROM ${fromSql}
      WHERE ${whereSql}
      ${order}
      LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Number(page) - 1) * Number(limit)]
  );
  return { devices: rows, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) || 1 } };
}

// ── Login transaction log (dashboardspec §6) ──────────────────────────────────
const LOGIN_ACTIONS = [
  'auth.login', 'auth.login_failed', 'auth.oauth_login', 'auth.oauth_register',
  'auth.register', 'auth.logout', 'recovery.password_reset', 'recovery.requested',
  'pairing.confirm', 'device.revoke',
];

async function loginLog({ orgId, email, from, to, outcome, method, page = 1, limit = 50 }) {
  const where = [`a.action IN (${LOGIN_ACTIONS.map(() => '?').join(',')})`];
  const params = [...LOGIN_ACTIONS];
  if (orgId) { where.push('a.org_id = ?'); params.push(orgId); }
  if (email) { where.push('(u.email LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(a.detail,"$.email")) LIKE ?)'); params.push(`%${email}%`, `%${email}%`); }
  if (from)  { where.push('a.created_at >= ?'); params.push(from); }
  if (to)    { where.push('a.created_at <= ?'); params.push(to); }
  if (outcome === 'success') where.push(`a.action <> 'auth.login_failed'`);
  if (outcome === 'failed')  where.push(`a.action = 'auth.login_failed'`);
  if (method) { where.push('COALESCE(ai.provider, "email") = ?'); params.push(method); }
  const whereSql = where.join(' AND ');

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN auth_identities ai ON ai.user_id = a.user_id
      WHERE ${whereSql}`, params
  );
  const [rows] = await pool.query(
    `SELECT a.id, a.action, a.created_at, a.ip, a.user_agent, a.device_id, a.detail,
            u.email AS user_email, u.full_name AS user_name,
            o.name AS org_name, ai.provider,
            dv.device_name, dv.platform, dv.os_version
       FROM audit_log a
       LEFT JOIN users u  ON u.id = a.user_id
       LEFT JOIN organisations o ON o.id = a.org_id
       LEFT JOIN auth_identities ai ON ai.user_id = a.user_id
       LEFT JOIN devices dv ON dv.device_uid = a.device_id AND dv.org_id = a.org_id
      WHERE ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Number(page) - 1) * Number(limit)]
  );

  const entries = rows.map((r) => {
    let attemptedEmail = null;
    try { attemptedEmail = r.detail && (typeof r.detail === 'object' ? r.detail.email : JSON.parse(r.detail).email); } catch { /* */ }
    const location = geo.resolve(r.ip);
    return {
      id: r.id,
      at: r.created_at,
      action: r.action,
      outcome: r.action === 'auth.login_failed' ? 'failed' : 'success',
      email: r.user_email || attemptedEmail || null,
      user: r.user_name || null,
      organisation: r.org_name || null,
      method: r.provider || 'email',
      ip: r.ip,
      location,
      device: r.device_name || null,
      os: [r.platform, r.os_version].filter(Boolean).join(' ') || null,
      userAgent: r.user_agent || null,
    };
  });
  return { entries, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) || 1 } };
}

const ORG_SORT = {
  name: 'o.name', abn: 'o.abn', state: 'o.state', plan: 'o.plan', status: 'o.status',
  users: 'users', devices: 'devices', created: 'o.created_at',
};

// ── Org directory (all orgs) ──────────────────────────────────────────────────
async function listOrgs({ search, sortBy, sortDir, page = 1, limit = 25 }) {
  const where = ['o.is_deleted = 0'];
  const params = [];
  // Free-text: organisation name, ABN, state or plan.
  if (search && search.trim()) {
    where.push('(o.name LIKE ? OR o.abn LIKE ? OR o.state LIKE ? OR o.plan LIKE ?)');
    const like = `%${search.trim()}%`;
    params.push(like, like, like, like);
  }
  const whereSql = where.join(' AND ');
  const order = orderClause(sortBy, sortDir, ORG_SORT, 'o.created_at DESC');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM organisations o WHERE ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT o.id, o.name, o.abn, o.state, o.plan, o.status, o.trial_ends_at, o.created_at,
            (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.is_deleted = 0) AS users,
            (SELECT COUNT(*) FROM devices d WHERE d.org_id = o.id AND d.is_deleted = 0 AND d.status = 'active') AS devices
       FROM organisations o
      WHERE ${whereSql}
      ${order}
      LIMIT ? OFFSET ?`,
    [...params, Number(limit), (Number(page) - 1) * Number(limit)]
  );
  return { organisations: rows, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) || 1 } };
}

// ── One org's detail (header for the drill-down page) ────────────────────────
async function getOrg(orgId) {
  const [[org]] = await pool.query(
    `SELECT o.id, o.name, o.abn, o.state, o.address, o.suburb, o.postcode, o.plan,
            o.status, o.trial_ends_at, o.created_at,
            (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.is_deleted = 0) AS users,
            (SELECT COUNT(*) FROM devices d WHERE d.org_id = o.id AND d.is_deleted = 0 AND d.status = 'active') AS devices
       FROM organisations o WHERE o.id = ? AND o.is_deleted = 0 LIMIT 1`,
    [orgId]
  );
  if (!org) throw new ServiceError('NOT_FOUND', 'Organisation not found', 404);
  return org;
}

// ── Hourly traffic (Overview chart) ───────────────────────────────────────────
// ProjMan2 has no MQTT broker or any other push/signalling layer — dropped from Nexus
// on purpose (see api/README.md "No MQTT broker"). App/Portal/Dashboard/VeriTrade all
// stay current via periodic polling (/sync/pull, and each surface's own data fetches).
// "Traffic" here is therefore new SESSION STARTS per hour (sessions.issued_at) — the
// honest signal for how busy the platform actually is, given there's no broker to show
// a connection count for. Zero-filled so a quiet hour renders as 0, not a gap.
async function hourlyTraffic({ hours = 24 }) {
  const h = Math.min(168, Math.max(1, Number(hours) || 24));
  // Zero-filled entirely in SQL via a recursive CTE, deliberately — building the hour
  // series in JS (Date/UTC math) and matching it against MySQL's own NOW()/DATETIME
  // values is exactly the class of timezone bug pool.js's own header comment warns
  // about (O-036, Nexus lost days to it). Keeping both the series and the count in one
  // query, one timezone frame, sidesteps it rather than being careful about it.
  const [rows] = await pool.query(
    `WITH RECURSIVE hours AS (
       SELECT CAST(DATE_FORMAT(NOW() - INTERVAL ? HOUR, '%Y-%m-%d %H:00:00') AS DATETIME) AS hour_start, 0 AS n
       UNION ALL
       SELECT hour_start + INTERVAL 1 HOUR, n + 1 FROM hours WHERE n < ?
     )
     SELECT DATE_FORMAT(h.hour_start, '%Y-%m-%dT%H:00:00') AS hour, COUNT(s.id) AS n
       FROM hours h
       LEFT JOIN sessions s
         ON s.issued_at >= h.hour_start AND s.issued_at < h.hour_start + INTERVAL 1 HOUR
      GROUP BY h.hour_start
      ORDER BY h.hour_start`,
    [h, h]
  );
  return { series: rows.map((r) => ({ hour: r.hour, count: Number(r.n) })), hours: h };
}

// ── System health ─────────────────────────────────────────────────────────────
async function systemHealth() {
  let mysql = 'ok';
  try { await pool.query('SELECT 1'); } catch { mysql = 'error'; }
  const [[sync]] = await pool.query(
    `SELECT SUM(status = 'failed') AS failed24h, COUNT(*) AS cycles24h
       FROM sync_history WHERE started_at >= NOW() - INTERVAL 1 DAY`
  );
  const [recentErrors] = await pool.query(
    `SELECT org_id, sync_type, table_name, error_message, started_at
       FROM sync_history WHERE status = 'failed'
      ORDER BY started_at DESC LIMIT 10`
  );
  return {
    mysql,
    geo: geo.enabled() ? 'local' : 'disabled',
    sync: { cycles24h: Number(sync.cycles24h) || 0, failed24h: Number(sync.failed24h) || 0, recentErrors },
    serverTime: Date.now(),
  };
}

module.exports = {
  stats, listUsers, userAction, listDevices, loginLog, listOrgs, getOrg, hourlyTraffic,
  systemHealth, LOGIN_ACTIONS,
};
