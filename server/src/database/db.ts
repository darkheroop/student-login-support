import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

export interface Statement<T = unknown> {
  all(...params: unknown[]): T[];
  get(...params: unknown[]): T | undefined;
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export interface DatabaseInstance {
  exec(sql: string): void;
  prepare<T = unknown>(sql: string): Statement<T>;
  close(): void;
}

const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'support.db');

// Node.js v22.5+ provides built-in node:sqlite (DatabaseSync) with zero native compilation dependencies
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');
const db: DatabaseInstance = new DatabaseSync(dbPath);

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'support',
    created_at TEXT NOT NULL,
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (admin_id) REFERENCES admins(id)
  );

  CREATE TABLE IF NOT EXISTS diagnostic_runs (
    id TEXT PRIMARY KEY,
    operator_id INTEGER NOT NULL,
    mobile_masked TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_ms INTEGER,
    request_count INTEGER DEFAULT 0,
    response_count INTEGER DEFAULT 0,
    result TEXT,
    error_code TEXT,
    FOREIGN KEY (operator_id) REFERENCES admins(id)
  );

  CREATE TABLE IF NOT EXISTS diagnostic_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER,
    duration_ms INTEGER,
    response_body TEXT,
    response_type TEXT,
    retry_attempt INTEGER,
    FOREIGN KEY (run_id) REFERENCES diagnostic_runs(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operator_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    mobile_masked TEXT,
    request_id TEXT,
    operation TEXT NOT NULL,
    result TEXT NOT NULL,
    ip_address TEXT,
    details TEXT
  );
`);

// Seed default admin if table is empty
const adminCountResult = db.prepare<{ count: number }>('SELECT COUNT(*) as count FROM admins').get();
if (!adminCountResult || adminCountResult.count === 0) {
  const hash = bcrypt.hashSync('Admin@123!', 10);
  db.prepare(`
    INSERT INTO admins (username, password_hash, role, created_at)
    VALUES (?, ?, ?, ?)
  `).run('admin', hash, 'admin', new Date().toISOString());
}

export default db;
