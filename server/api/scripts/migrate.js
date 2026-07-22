// Minimal forward-only migration runner.
//
// No migration library — the same reasoning Nexus applied to its crons: this needs
// to run a handful of ordered .sql files and record which ran. A library is more
// surface than the job warrants. Files in ../mysql matching migration_v*.sql run in
// filename order; each is recorded in schema_migrations and never re-run.
//
//   node scripts/migrate.js          apply anything pending
//   node scripts/migrate.js --status show what has and hasn't run

const fs   = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'mysql');

async function main() {
  const statusOnly = process.argv.includes('--status');

  // Connect WITHOUT a database first, so this can create c1projman2 on a clean box.
  const admin = await mysql.createConnection({
    host: config.db.host, port: config.db.port,
    user: config.db.user, password: config.db.password,
    multipleStatements: true,
  });

  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.name}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.changeUser({ database: config.db.name });

  await admin.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   VARCHAR(255) NOT NULL PRIMARY KEY,
       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^migration_v\d+.*\.sql$/.test(f))
    .sort();

  const [applied] = await admin.query('SELECT filename FROM schema_migrations');
  const done = new Set(applied.map((r) => r.filename));

  if (statusOnly) {
    console.log(`\nMigrations in ${config.db.name}:\n`);
    for (const f of files) console.log(`  ${done.has(f) ? '✓' : '·'}  ${f}`);
    console.log('');
    await admin.end();
    return;
  }

  let ran = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    const conn = await mysql.createConnection({
      host: config.db.host, port: config.db.port,
      user: config.db.user, password: config.db.password,
      database: config.db.name, multipleStatements: true,
    });
    try {
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log('ok');
      ran++;
    } catch (err) {
      console.log('FAILED');
      console.error(`\n  ${err.message}\n`);
      await conn.end();
      await admin.end();
      process.exit(1);
    }
    await conn.end();
  }

  console.log(ran ? `\n${ran} migration(s) applied.\n` : '\nNothing to apply — schema is current.\n');
  await admin.end();
}

main().catch((err) => {
  console.error('Migration runner failed:', err.message);
  process.exit(1);
});
