// Prune audit_log rows older than the retention period (dashboard spec §10 / §11 #5: 12 months,
// AU Privacy Act APP 11.2 — personal information that's no longer needed is destroyed).
// audit_log holds IPs, user agents, emails in `detail` and device ids, across every tenant.
//
// DRY RUN BY DEFAULT: it prints the cutoff and what WOULD be deleted, per action, and deletes
// nothing. Deleting needs --apply, explicitly. Deletion is permanent: take a backup first.
// No cron is installed; scheduling is an ops decision (Owner).
//
//   node scripts/prune-audit-log.js                 dry run, 12-month cutoff
//   node scripts/prune-audit-log.js --apply         delete rows older than 12 months
//   node scripts/prune-audit-log.js --months=18     a longer period (never shorter than 12)

const pool = require('../src/db/pool');
const config = require('../src/config');

const MIN_MONTHS = 12;
const BATCH = 5000;

async function main() {
  const apply = process.argv.includes('--apply');
  const arg = process.argv.find((a) => a.startsWith('--months='));
  const months = arg ? Number(arg.split('=')[1]) : MIN_MONTHS;
  if (!Number.isInteger(months) || months < MIN_MONTHS) {
    console.error(`--months must be a whole number of at least ${MIN_MONTHS}`);
    process.exit(2);
  }

  const [[{ cutoff }]] = await pool.query(
    `SELECT DATE_FORMAT(DATE_SUB(NOW(), INTERVAL ? MONTH), '%Y-%m-%d %H:%i:%s') AS cutoff`, [months]);
  const [byAction] = await pool.query(
    `SELECT action, COUNT(*) AS n, MIN(created_at) AS oldest FROM audit_log
      WHERE created_at < ? GROUP BY action ORDER BY n DESC`, [cutoff]);
  const total = byAction.reduce((s, r) => s + Number(r.n), 0);

  console.log(`audit_log prune — database ${config.db.name}`);
  console.log(`Retention: ${months} months. Cutoff (Perth): rows created before ${cutoff}`);
  console.log(`Mode: ${apply ? 'APPLY (deleting)' : 'DRY RUN (nothing is deleted; add --apply to delete)'}`);
  if (!total) {
    console.log('Nothing older than the cutoff.');
    await pool.end();
    return;
  }
  console.log(`\n${apply ? 'Deleting' : 'Would delete'} ${total} row(s):`);
  for (const r of byAction) console.log(`  ${String(r.n).padStart(8)}  ${r.action}  (oldest ${r.oldest})`);

  if (apply) {
    let deleted = 0;
    for (;;) {
      const [res] = await pool.query('DELETE FROM audit_log WHERE created_at < ? LIMIT ?', [cutoff, BATCH]);
      deleted += res.affectedRows;
      if (res.affectedRows < BATCH) break;
    }
    console.log(`\nDeleted ${deleted} row(s).`);
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error('prune-audit-log failed:', err.message);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
