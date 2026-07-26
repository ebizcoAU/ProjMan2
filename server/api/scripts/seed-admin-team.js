// Seed the eBizco admin-team accounts (dashboardspec §2/§3 addendum, migration_v011).
// Creates a dedicated 'eBizco Platform Ops' organisation to hold them (users.org_id
// is NOT NULL in the shared table, but these accounts never touch tenant/construction
// data — they only ever use /admin/*, which is cross-tenant and ignores org_id) plus
// three users, each granted a platform_admins row with the requested admin_role.
// Idempotent — safe to re-run; skips anything that already exists.
//
//   node scripts/seed-admin-team.js

const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const pool = require('../src/db/pool');
const config = require('../src/config');

const ORG_NAME = 'eBizco Platform Ops';
const PASSWORD = 'Passwd@1234';

const ACCOUNTS = [
  { email: 'admin@projman.internal',    full_name: 'Platform Admin',   admin_role: 'admin' },
  { email: 'accountx@projman.internal', full_name: 'Platform Account', admin_role: 'account' },
  { email: 'staffx@projman.internal',   full_name: 'Platform Staff',   admin_role: 'staff' },
];

async function ensureOrg() {
  const [[existing]] = await pool.query('SELECT id FROM organisations WHERE name = ? LIMIT 1', [ORG_NAME]);
  if (existing) return existing.id;
  const id = uuidv4();
  await pool.query(
    `INSERT INTO organisations (id, name, plan, status) VALUES (?, ?, 'enterprise', 'active')`,
    [id, ORG_NAME]
  );
  console.log(`Created organisation "${ORG_NAME}" (${id})`);
  return id;
}

async function ensureUser(orgId, { email, full_name }) {
  const [[existing]] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing) return existing.id;
  const id = uuidv4();
  const passwordHash = await bcrypt.hash(PASSWORD, config.password.bcryptCost);
  // `role` is the tenant-facing role column — irrelevant for a platform-ops account
  // (it never reaches the tenant surface), set to the assignable default so the row
  // satisfies the same shape every other user does.
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, full_name, role, status)
     VALUES (?, ?, ?, ?, ?, 'projectManager', 'active')`,
    [id, orgId, email, passwordHash, full_name]
  );
  console.log(`Created user ${email} (${id})`);
  return id;
}

async function grant(userId, adminRole) {
  await pool.query(
    `INSERT INTO platform_admins (id, user_id, admin_role, note)
     VALUES (?, ?, ?, 'seeded via scripts/seed-admin-team.js')
     ON DUPLICATE KEY UPDATE admin_role = VALUES(admin_role)`,
    [uuidv4(), userId, adminRole]
  );
}

async function main() {
  const orgId = await ensureOrg();
  for (const acct of ACCOUNTS) {
    const userId = await ensureUser(orgId, acct);
    await grant(userId, acct.admin_role);
    console.log(`Granted platform-admin [${acct.admin_role}] to ${acct.email}`);
  }
  console.log('\nLogin at /login with any of:');
  for (const acct of ACCOUNTS) console.log(`  ${acct.email}  /  ${PASSWORD}  [${acct.admin_role}]`);
  await pool.end();
}

main().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
