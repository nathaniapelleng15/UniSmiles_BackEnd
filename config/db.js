const mysql = require('mysql2/promise');

// Hosting panels commonly expose Laravel-style DB_DATABASE/DB_USERNAME
// variables, while this application historically used DB_NAME/DB_USER.
// Accept both so a valid production environment does not connect without a
// default schema merely because the panel uses the alternate names.
const dbHost = process.env.DB_HOST || process.env.MYSQL_HOST;
const dbPort = Number(process.env.DB_PORT || process.env.MYSQL_PORT) || 3306;
const dbName = process.env.DB_NAME || process.env.DB_DATABASE || process.env.MYSQL_DATABASE;
const dbUser = process.env.DB_USER || process.env.DB_USERNAME || process.env.MYSQL_USER;
const dbPassword = process.env.DB_PASSWORD || process.env.DB_PASS || process.env.MYSQL_PASSWORD;

if (!dbHost || !dbName || !dbUser) {
  console.error('[Database] Incomplete MySQL configuration. Set DB_HOST, DB_NAME, and DB_USER (or their documented aliases).');
} else {
  console.log(`[Database] Connecting to MySQL at ${dbHost}:${dbPort}, database '${dbName}'`);
}

const pool = mysql.createPool({
  host: dbHost,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  port: dbPort,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  idleTimeout: 60000,
  // Kolom TIMESTAMP di server live memakai UTC. Tanpa ini, driver mengonversi
  // tanggal pakai zona proses (WIB) dan payment_expires_at tersimpan +7 jam,
  // sehingga sesi pembayaran tidak pernah kedaluwarsa pada waktunya.
  timezone: 'Z',
});

module.exports = pool;
