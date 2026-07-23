// Access control — the roles/permissions matrix, loaded from data (migration_v004).
//
// This replaces the hard-coded role logic that was scattered across routes and
// lib/roles.js. Roles, their scope class, their pairability/assignability, and the
// roles×permissions matrix are all rows now (§9). This module loads them once at
// boot into an in-process cache and answers three questions:
//
//   permissionsFor(role)   → Set of capability strings   (WHAT the role may do)
//   scopeClassFor(role)    → 'portfolio'|'assigned'|'self'|'engagement'|'portal'
//   role metadata          → is_assignable, device_pairable, label   (the gates)
//
// The cache is seed data: a restart reloads it, and `matrixVersion` lets the app
// cache-bust GET /auth/permissions. There is no per-request DB hit for a permission
// check — the whole point is that enforcement is cheap enough to put everywhere.

const pool = require('../db/pool');

let CACHE = {
  loaded: false,
  matrixVersion: 0,
  roles: new Map(),        // role → { role, label, scopeClass, surface, isAssignable, devicePairable, sort }
  permissions: new Map(),  // role → Set(permission)
};

/** Load (or reload) the matrix from the DB. Call once at boot; safe to re-call. */
async function loadMatrix() {
  const [roleRows] = await pool.query(
    `SELECT role, label, scope_class, surface, is_assignable, device_pairable, pair_rank, sort
       FROM roles ORDER BY sort`
  );
  const [permRows] = await pool.query('SELECT role, permission FROM role_permissions');
  const [[meta]] = await pool.query(
    `SELECT v FROM access_meta WHERE k = 'matrix_version' LIMIT 1`
  );

  const roles = new Map();
  for (const r of roleRows) {
    roles.set(r.role, {
      role: r.role,
      label: r.label,
      scopeClass: r.scope_class,
      surface: r.surface,
      isAssignable: !!r.is_assignable,
      devicePairable: !!r.device_pairable,
      pairRank: r.pair_rank,
      sort: r.sort,
    });
  }
  const permissions = new Map();
  for (const p of permRows) {
    if (!permissions.has(p.role)) permissions.set(p.role, new Set());
    permissions.get(p.role).add(p.permission);
  }

  CACHE = {
    loaded: true,
    matrixVersion: Number(meta?.v) || 1,
    roles,
    permissions,
  };
  return CACHE;
}

function ensureLoaded() {
  if (!CACHE.loaded) {
    throw new Error('access matrix not loaded — call loadMatrix() at boot');
  }
}

const roleMeta       = (role) => (ensureLoaded(), CACHE.roles.get(role) || null);
const permissionsFor = (role) => (ensureLoaded(), CACHE.permissions.get(role) || new Set());
const hasPermission  = (role, perm) => permissionsFor(role).has(perm);
const scopeClassFor  = (role) => roleMeta(role)?.scopeClass || 'assigned'; // safest default: least reach
const isAssignable   = (role) => !!roleMeta(role)?.isAssignable;
const isPairable     = (role) => !!roleMeta(role)?.devicePairable;
const pairRank       = (role) => roleMeta(role)?.pairRank ?? 0;
const matrixVersion  = () => (ensureLoaded(), CACHE.matrixVersion);

/**
 * May `issuerRole` pair a device as `targetRole`? Target must be pairable, and the
 * issuer must out-rank (or equal) it — the anti-escalation ceiling. Rank is separate
 * from permissions on purpose: an inspector holds an authority the PM lacks, yet the
 * PM must still be able to bring one onto a job (pair_rank pm 100 > inspector 50),
 * while a siteSupervisor (40) may pair only foreperson/tradie (30/20), never an
 * inspector (50) or a projectManager (100).
 */
function canPair(issuerRole, targetRole) {
  return isPairable(targetRole) && pairRank(issuerRole) >= pairRank(targetRole);
}

/** Roles a device may be paired as (the app's 5-role shortlist, from data). */
function pairableRoles() {
  ensureLoaded();
  return [...CACHE.roles.values()]
    .filter((r) => r.devicePairable)
    .map((r) => ({ role: r.role, label: r.label }));
}

/** Roles a user may be assigned (v1 = 8). */
function assignableRoles() {
  ensureLoaded();
  return [...CACHE.roles.values()]
    .filter((r) => r.isAssignable)
    .map((r) => ({ role: r.role, label: r.label }));
}

/** Every known role id — for validators that accept any defined role. */
function allRoles() {
  ensureLoaded();
  return [...CACHE.roles.keys()];
}

module.exports = {
  loadMatrix,
  roleMeta,
  permissionsFor,
  hasPermission,
  scopeClassFor,
  isAssignable,
  isPairable,
  pairRank,
  canPair,
  matrixVersion,
  pairableRoles,
  assignableRoles,
  allRoles,
};
