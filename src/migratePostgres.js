const { Client } = require('pg');

const TABLES = [
  {
    name: 'users',
    columns: ['id', 'username', 'password_hash', 'created_at'],
    ddl: `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'devices',
    columns: ['id', 'device_name', 'device_id', 'user_id', 'bind_code', 'last_online', 'created_at'],
    ddl: `CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      device_name TEXT NOT NULL,
      device_id TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      bind_code TEXT NOT NULL,
      last_online TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'app_usage',
    columns: ['id', 'device_id', 'package_name', 'app_name', 'category', 'start_time', 'end_time', 'duration_seconds', 'created_at'],
    ddl: `CREATE TABLE IF NOT EXISTS app_usage (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id),
      package_name TEXT NOT NULL,
      app_name TEXT NOT NULL,
      category TEXT DEFAULT '其他',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'web_history',
    columns: ['id', 'device_id', 'url', 'title', 'browser', 'visited_at', 'created_at'],
    ddl: `CREATE TABLE IF NOT EXISTS web_history (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id),
      url TEXT NOT NULL,
      title TEXT,
      browser TEXT,
      visited_at TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'miniprogram_usage',
    columns: ['id', 'device_id', 'program_name', 'category', 'start_time', 'end_time', 'duration_seconds', 'created_at'],
    ddl: `CREATE TABLE IF NOT EXISTS miniprogram_usage (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id),
      program_name TEXT NOT NULL,
      category TEXT DEFAULT '其他',
      start_time TEXT NOT NULL,
      end_time TEXT,
      duration_seconds INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  },
  {
    name: 'sync_log',
    columns: ['id', 'device_id', 'sync_type', 'record_count', 'status', 'created_at'],
    ddl: `CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      sync_type TEXT NOT NULL,
      record_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ok',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  },
];

function createClient(connectionString) {
  return new Client({ connectionString });
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureSchema(client) {
  for (const table of TABLES) {
    await client.query(table.ddl);
  }

  await client.query('CREATE INDEX IF NOT EXISTS idx_app_usage_device ON app_usage(device_id, start_time)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_web_history_device ON web_history(device_id, visited_at)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_mp_usage_device ON miniprogram_usage(device_id, start_time)');
  await ensureMigrationTable(client);
}

async function copyTable(source, target, table) {
  const rows = (await source.query(`SELECT * FROM ${table.name} ORDER BY id ASC`)).rows;
  console.log(`Migrating ${table.name}: ${rows.length}`);
  if (!rows.length) return;

  const columns = table.columns;
  const insertSql = `
    INSERT INTO ${table.name} (${columns.join(', ')})
    VALUES (${columns.map((_, idx) => `$${idx + 1}`).join(', ')})
  `;

  for (const row of rows) {
    await target.query(insertSql, columns.map((column) => row[column]));
  }

  await target.query(`
    SELECT setval(pg_get_serial_sequence('${table.name}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL)
    FROM ${table.name}
  `);
}

async function migrateFromPostgresIfNeeded() {
  const sourceUrl = process.env.MIGRATE_FROM_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl || !targetUrl || sourceUrl === targetUrl) return;

  const target = createClient(targetUrl);

  await target.connect();

  try {
    await ensureSchema(target);

    const existing = await target.query('SELECT name FROM migrations WHERE name = $1', ['render_to_neon_20260730']);
    if (existing.rows.length) {
      console.log('Postgres migration already completed');
      return;
    }

    const source = createClient(sourceUrl);
    await source.connect();

    await target.query('BEGIN');
    try {
      await target.query('TRUNCATE TABLE sync_log, miniprogram_usage, web_history, app_usage, devices, users RESTART IDENTITY CASCADE');
      for (const table of TABLES) {
        await copyTable(source, target, table);
      }
      await target.query('INSERT INTO migrations (name) VALUES ($1)', ['render_to_neon_20260730']);
      await target.query('COMMIT');
      console.log('Postgres migration completed');
    } catch (error) {
      await target.query('ROLLBACK');
      throw error;
    } finally {
      await source.end();
    }
  } finally {
    await target.end();
  }
}

module.exports = { migrateFromPostgresIfNeeded };
