import { copyFileSync, chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import postgres from 'postgres';
import { resolve } from 'node:path';

const [templatePath, outputPath] = process.argv.slice(2);
const databaseUrl = process.env.DATABASE_URL;
if (!templatePath || !outputPath || !databaseUrl) {
  console.error('Usage: DATABASE_URL=postgres://... node packages/database/scripts/export-sqlite.mjs /secure/template.sqlite /secure/rollback.sqlite');
  process.exit(2);
}

const order = [
  'companies', 'users', 'courts', 'clients', 'company_hours', 'sessions', 'bookings', 'blocked_slots',
  'booking_events', 'monthly_members', 'monthly_charges', 'tournaments', 'tournament_entries',
  'tournament_matches', 'finance_entries', 'reviews', 'review_links', 'integration_settings',
  'webhook_events', 'whatsapp_conversations', 'whatsapp_messages', 'message_templates', 'app_audit',
];
const jsonColumns = new Set(['amenities', 'photos', 'public_options', 'sports', 'details', 'settings', 'context']);
const boolColumns = new Set(['onboarding_completed', 'active', 'is_open', 'paid']);
const template = new DatabaseSync(resolve(templatePath), { readOnly: true });
template.exec('PRAGMA query_only=ON;');
if (template.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || template.prepare('PRAGMA foreign_key_check').all().length) {
  throw new Error('SQLite template did not pass integrity checks.');
}
copyFileSync(resolve(templatePath), resolve(outputPath));
chmodSync(resolve(outputPath), 0o600);
const sqlite = new DatabaseSync(resolve(outputPath));
sqlite.exec('PRAGMA foreign_keys=ON;');
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 5 });
try {
  sqlite.exec('BEGIN IMMEDIATE;');
  try {
    for (const table of [...order].reverse()) {
      if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) sqlite.exec(`DELETE FROM "${table}";`);
    }
    const counts = {};
    for (const table of order) {
      if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name);
      const rows = await sql.unsafe(`SELECT ${columns.map((column) => `"${column}"`).join(',')} FROM "${table}"`);
      const insert = sqlite.prepare(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of rows) {
        const values = columns.map((column) => {
          const value = row[column];
          if (value === null || value === undefined) return null;
          if (jsonColumns.has(column)) return typeof value === 'string' ? value : JSON.stringify(value);
          if (boolColumns.has(column)) return value ? 1 : 0;
          return value;
        });
        insert.run(...values);
      }
      counts[table] = rows.length;
    }
    for (const table of order) {
      if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      const actual = sqlite.prepare(`SELECT count(*) AS count FROM "${table}"`).get().count;
      if (actual !== (counts[table] || 0)) throw new Error(`Row-count mismatch in ${table}.`);
    }
    sqlite.exec('COMMIT;');
    const integrity = sqlite.prepare('PRAGMA integrity_check').get().integrity_check;
    const fkErrors = sqlite.prepare('PRAGMA foreign_key_check').all();
    if (integrity !== 'ok' || fkErrors.length) throw new Error('Exported SQLite database did not pass integrity checks.');
    console.log(JSON.stringify({ ok: true, integrity, foreignKeyViolations: fkErrors.length, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((sum, count) => sum + count, 0) }));
  } catch (error) {
    sqlite.exec('ROLLBACK;');
    throw error;
  }
} finally {
  sqlite.close();
  template.close();
  await sql.end();
}
