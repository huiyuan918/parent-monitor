const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const LEGACY_DB_PATH = process.env.LEGACY_DB_PATH || '/tmp/data.db';

let db = null;
let SQL = null;

async function getDb() {
  if (db) return db;

  SQL = await initSqlJs();
  restoreLegacyDbIfNeeded();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  initTables();
  saveDb();
  return db;
}

function saveDb() {
  if (db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

function restoreLegacyDbIfNeeded() {
  if (fs.existsSync(DB_PATH)) return;
  if (DB_PATH === LEGACY_DB_PATH) return;
  if (!fs.existsSync(LEGACY_DB_PATH)) return;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  console.log(`Restored database from legacy path ${LEGACY_DB_PATH} to ${DB_PATH}`);
}

// -- sql.js 包装函数，提供类似 better-sqlite3 的 API --

function prepare(sql) {
  return {
    run: (...params) => {
      db.run(sql, params);
      saveDb();
      return { changes: db.getRowsModified() };
    },
    get: (...params) => {
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(params);
      let row = null;
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        row = {};
        cols.forEach((c, i) => { row[c] = vals[i]; });
      }
      stmt.free();
      return row;
    },
    all: (...params) => {
      const stmt = db.prepare(sql);
      if (params.length) stmt.bind(params);
      const rows = [];
      const cols = stmt.getColumnNames();
      while (stmt.step()) {
        const vals = stmt.get();
        const row = {};
        cols.forEach((c, i) => { row[c] = vals[i]; });
        rows.push(row);
      }
      stmt.free();
      return rows;
    },
  };
}

function exec(sql) {
  db.run(sql);
  saveDb();
}

// 事务支持
function transaction(fn) {
  return (...args) => {
    db.run('BEGIN');
    try {
      const result = fn(...args);
      db.run('COMMIT');
      saveDb();
      return result;
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }
  };
}

function initTables() {
  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_name TEXT NOT NULL,
      device_id TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      bind_code TEXT NOT NULL,
      last_online DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS app_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      app_name TEXT NOT NULL,
      category TEXT DEFAULT '其他',
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      duration_seconds INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(device_id)
    )
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_app_usage_device ON app_usage(device_id, start_time)');

  exec(`
    CREATE TABLE IF NOT EXISTS web_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      browser TEXT,
      visited_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(device_id)
    )
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_web_history_device ON web_history(device_id, visited_at)');

  exec(`
    CREATE TABLE IF NOT EXISTS miniprogram_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      program_name TEXT NOT NULL,
      category TEXT DEFAULT '其他',
      start_time DATETIME NOT NULL,
      end_time DATETIME,
      duration_seconds INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(device_id)
    )
  `);
  ensureColumn('miniprogram_usage', 'category', "TEXT DEFAULT '其他'");
  exec('CREATE INDEX IF NOT EXISTS idx_mp_usage_device ON miniprogram_usage(device_id, start_time)');

  exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      sync_type TEXT NOT NULL,
      record_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ok',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function ensureColumn(table, column, definition) {
  const columns = prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = { getDb, saveDb, prepare, exec, transaction };
