// audit_log retention prune (dashboard spec §10 / §11 #5, G4): scripts/prune-audit-log.js.
// Dry run by default (reports, deletes nothing); --apply deletes only rows older than 12 months;
// --months below 12 is refused. Runs the script as a child process against DB_NAME.
//
// Run: DB_NAME=c1projman2_e2e node tests/audit-prune.test.js   (no API server needed)
// It runs --apply, which really deletes: refuse anything but a throwaway *_e2e database.
if (!/_e2e$/.test(process.env.DB_NAME || '')) {
  console.error('audit-prune.test.js runs --apply: set DB_NAME to a throwaway *_e2e database.');
  process.exit(1);
}
const { execFileSync } = require('child_process');
const path = require('path');
const pool = require('../src/db/pool');

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
};
const run = (args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'prune-audit-log.js'), ...args],
      { env: process.env, encoding: 'utf8' }) };
  } catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};

(async () => {
  console.log(`audit_log prune test → ${process.env.DB_NAME}\n`);
  const tag = `test.prune.${Date.now()}`;
  await pool.query(
    `INSERT INTO audit_log (action, detail, created_at) VALUES (?, '{}', DATE_SUB(NOW(), INTERVAL 13 MONTH)),
                                                             (?, '{}', DATE_SUB(NOW(), INTERVAL 11 MONTH))`, [tag, tag]);
  const count = async () => Number((await pool.query('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?', [tag]))[0][0].n);

  const dry = run([]);
  ok('the default is a dry run that names the cutoff and the per-action count',
    dry.code === 0 && /DRY RUN/.test(dry.out) && /Cutoff/.test(dry.out) && dry.out.includes(tag), dry.out);
  ok('…and deletes nothing', (await count()) === 2);
  const short = run(['--months=6']);
  ok('a retention shorter than 12 months is refused', short.code === 2, short.out);
  const apply = run(['--apply']);
  ok('--apply deletes the row older than 12 months, keeping the 11-month one',
    apply.code === 0 && (await count()) === 1, apply.out);

  await pool.query('DELETE FROM audit_log WHERE action = ?', [tag]);
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
