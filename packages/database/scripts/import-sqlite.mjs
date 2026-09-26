import { DatabaseSync } from 'node:sqlite';
import postgres from 'postgres';
import { resolve } from 'node:path';

const sqlitePath = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!sqlitePath || !databaseUrl) {
  console.error('Usage: DATABASE_URL=postgres://... node packages/database/scripts/import-sqlite.mjs /secure/path/quadrasflow.sqlite');
  process.exit(2);
}
const source = new DatabaseSync(resolve(sqlitePath), { readOnly: true });
source.exec('PRAGMA foreign_keys=ON; PRAGMA query_only=ON;');
const check = source.prepare('PRAGMA integrity_check').all();
if (check.length !== 1 || check[0].integrity_check !== 'ok') throw new Error('SQLite integrity_check failed; import stopped.');
const fkErrors = source.prepare('PRAGMA foreign_key_check').all();
if (fkErrors.length) throw new Error(`SQLite has ${fkErrors.length} foreign key violation(s); import stopped.`);
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 5 });
const order = [
  'companies', 'users', 'courts', 'clients', 'company_hours', 'company_price_slots', 'sessions',
  'bookings', 'blocked_slots', 'booking_events', 'monthly_members', 'monthly_charges', 'tournaments',
  'tournament_entries', 'tournament_matches', 'finance_entries', 'reviews', 'review_links',
  'integration_settings', 'webhook_events', 'whatsapp_conversations', 'whatsapp_messages', 'message_templates', 'app_audit',
];
const jsonColumns = new Set(['amenities', 'photos', 'public_options', 'sports', 'details', 'settings', 'context']);
const boolColumns = new Set(['onboarding_completed', 'active', 'is_open', 'paid']);
try {
  const expected = {};
  const imported = await sql.begin(async (tx) => {
    const occupied = [];
    for (const table of order) {
      const rows = await tx.unsafe(`SELECT count(*)::int AS count FROM "${table}"`);
      if (rows[0].count) occupied.push(table);
    }
    if (occupied.length) throw new Error(`Target database must be empty. Found existing rows in: ${occupied.join(', ')}.`);
    const counts = {};
    for (const table of order) {
      const sourceExists = source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!sourceExists) { counts[table] = 0; continue; }
      const rows = source.prepare(`SELECT * FROM "${table}"`).all();
      expected[table] = rows.length;
      const columns = rows.length ? Object.keys(rows[0]) : source.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name);
      for (const row of rows) {
        const values = columns.map((column) => {
          const value = row[column];
          if (value === null || value === undefined) return null;
          if (jsonColumns.has(column)) {
            if (typeof value !== 'string') return value;
            try { return JSON.parse(value); } catch { throw new Error(`Invalid JSON in ${table}.${column}; import stopped.`); }
          }
          if (boolColumns.has(column)) return Boolean(value);
          if (Buffer.isBuffer(value)) return value;
          return value;
        });
        const names = columns.map((column) => `"${column}"`).join(',');
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
        await tx.unsafe(`INSERT INTO "${table}" (${names}) VALUES (${placeholders})`, values);
      }
      counts[table] = rows.length;
    }
    const mismatches = [];
    for (const table of order) {
      const result = await tx.unsafe(`SELECT count(*)::int AS count FROM "${table}"`);
      const actual = result[0].count;
      if (actual !== (expected[table] || 0)) mismatches.push(`${table}: source ${expected[table] || 0}, target ${actual}`);
    }
    if (mismatches.length) throw new Error(`Post-import row-count mismatch: ${mismatches.join('; ')}`);
    return counts;
  });
  console.log(JSON.stringify({ ok: true, integrity: 'ok', foreignKeyViolations: 0, imported }, null, 2));
} finally {
  source.close();
  await sql.end();
}
