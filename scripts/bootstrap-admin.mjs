import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const dataDir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, 'quadrasflow.sqlite'));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('platform_admin','arena_admin','staff')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
`);

const email = String(process.env.BOOTSTRAP_EMAIL || '').trim().toLowerCase();
const name = String(process.env.BOOTSTRAP_NAME || 'Administrador QuadrasFlow').trim();
const password = String(process.env.BOOTSTRAP_PASSWORD || '');
if (!email || !password || password.length < 14) {
  console.error('Configure BOOTSTRAP_EMAIL e BOOTSTRAP_PASSWORD (mínimo de 14 caracteres) no .env.');
  process.exit(1);
}

const exists = db.prepare("SELECT id FROM users WHERE role='platform_admin' LIMIT 1").get();
if (exists) {
  console.log('Já existe um administrador da plataforma. Nenhuma conta foi alterada.');
  process.exit(0);
}

const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');
db.prepare(`INSERT INTO users (id, company_id, name, email, password_hash, password_salt, role, created_at)
  VALUES (?, NULL, ?, ?, ?, ?, 'platform_admin', ?)`)
  .run(randomUUID(), name, email, hash, salt, new Date().toISOString());
console.log(`Administrador da plataforma criado: ${email}`);
