// Grant (or revoke) platform-admin — the ONLY way a user gets System Admin access
// (dashboardspec §2/§3). Provisioning is deliberately out-of-band: never via tenant
// sign-up or user-management. migration_v011 adds admin-team sub-roles within this
// one tier — pass --role to pick which (defaults to 'admin', the pre-v011 behaviour).
//
//   node scripts/grant-platform-admin.js <email> [--role=admin|account|staff] [--revoke]
//   node scripts/grant-platform-admin.js --list

const { v4: uuidv4 } = require('uuid');
const pool = require('../src/db/pool');

const ADMIN_ROLES = ['admin', 'account', 'staff'];

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes('--revoke');
  const list = args.includes('--list');
  const roleArg = args.find((a) => a.startsWith('--role='));
  const adminRole = roleArg ? roleArg.split('=')[1] : 'admin';
  const email = args.find((a) => !a.startsWith('--'));

  if (list) {
    const [rows] = await pool.query(
      `SELECT u.email, u.full_name, o.name AS org, pa.admin_role, pa.created_at
         FROM platform_admins pa JOIN users u ON u.id = pa.user_id
         JOIN organisations o ON o.id = u.org_id ORDER BY pa.created_at`
    );
    console.log(`\nPlatform admins (${rows.length}):`);
    for (const r of rows) console.log(`  · ${r.email}  [${r.admin_role}]  (${r.full_name}, ${r.org})  since ${r.created_at}`);
    console.log('');
    await pool.end();
    return;
  }

  if (!email) {
    console.error('Usage: node scripts/grant-platform-admin.js <email> [--role=admin|account|staff] [--revoke] | --list');
    process.exit(1);
  }
  if (!revoke && !ADMIN_ROLES.includes(adminRole)) {
    console.error(`--role must be one of: ${ADMIN_ROLES.join(', ')}`);
    process.exit(1);
  }

  const [[user]] = await pool.query('SELECT id, full_name FROM users WHERE email = ? AND is_deleted = 0 LIMIT 1', [email]);
  if (!user) { console.error(`No user with email ${email}`); await pool.end(); process.exit(1); }

  if (revoke) {
    const [r] = await pool.query('DELETE FROM platform_admins WHERE user_id = ?', [user.id]);
    console.log(r.affectedRows ? `Revoked platform-admin from ${email}` : `${email} was not a platform admin`);
  } else {
    await pool.query(
      `INSERT INTO platform_admins (id, user_id, admin_role, note)
       VALUES (?, ?, ?, 'granted via CLI')
       ON DUPLICATE KEY UPDATE admin_role = VALUES(admin_role), note = VALUES(note)`,
      [uuidv4(), user.id, adminRole]
    );
    console.log(`Granted platform-admin [${adminRole}] to ${email} (${user.full_name})`);
  }
  await pool.end();
}

main().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
