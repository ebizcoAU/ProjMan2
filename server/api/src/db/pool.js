const mysql  = require('mysql2/promise');
const config = require('../config');

// The pool timezone must match the MySQL server's `time_zone`. Nexus lost days to
// this (O-036): the server ran on the dev machine's local offset while mysql2
// serialised JS Date params using a different one, so every DATETIME comparison
// was silently hours out and recovery tokens were dead on arrival.
//
// ProjMan2 pins both sides to +08:00 (Australia/Perth, no DST).
// ALSO REQUIRED on the MySQL server:
//   SET GLOBAL time_zone = '+08:00';
//   my.cnf → [mysqld] default-time-zone = '+08:00'
const pool = mysql.createPool({
  host:     config.db.host,
  port:     config.db.port,
  user:     config.db.user,
  password: config.db.password,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+08:00',
  charset: 'utf8mb4',
  // Return DATE/DATETIME as plain strings. Without this, mysql2 builds a JS Date
  // using the offset above and JSON-serialises it back as UTC — a date entered as
  // 2026-07-22 renders to the console as the 21st.
  dateStrings: true,
});

pool.getConnection()
  .then((conn) => {
    console.log(`✅ MySQL connected → ${config.db.name}`);
    conn.release();
  })
  .catch((err) => {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  });

module.exports = pool;
