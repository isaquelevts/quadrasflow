import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = resolve('.');
const dataDir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, 'quadrasflow.sqlite'));
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    amenities TEXT NOT NULL DEFAULT '[]',
    photos TEXT NOT NULL DEFAULT '[]',
    public_options TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS company_hours (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0,1)),
    open_time TEXT NOT NULL DEFAULT '08:00',
    close_time TEXT NOT NULL DEFAULT '23:00',
    PRIMARY KEY(company_id, weekday)
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
  CREATE TABLE IF NOT EXISTS courts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sport TEXT NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(company_id, name)
  );
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    court_id TEXT NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
    source TEXT NOT NULL DEFAULT 'staff',
    created_at TEXT NOT NULL,
    CHECK (end_at > start_at)
  );
  CREATE TABLE IF NOT EXISTS blocked_slots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    court_id TEXT NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (end_at > start_at)
  );
  CREATE TABLE IF NOT EXISTS booking_events (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    event TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS finance_entries (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL, kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
    category TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    due_date TEXT NOT NULL, paid_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS monthly_members (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, court_id TEXT NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), start_time TEXT NOT NULL, duration_minutes INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','ended')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS monthly_charges (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES monthly_members(id) ON DELETE CASCADE, cycle TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), due_date TEXT NOT NULL,
    paid_at TEXT, created_at TEXT NOT NULL, UNIQUE(member_id,cycle)
  );
  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL, sport TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', start_date TEXT NOT NULL,
    entry_fee_cents INTEGER NOT NULL DEFAULT 0, capacity INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','finished','cancelled')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tournament_entries (
    id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_name TEXT NOT NULL, phone TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    UNIQUE(tournament_id,phone)
  );
  CREATE TABLE IF NOT EXISTS tournament_matches (
    id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round INTEGER NOT NULL, slot INTEGER NOT NULL, player_a TEXT, player_b TEXT,
    score_a INTEGER, score_b INTEGER, winner TEXT, UNIQUE(tournament_id,round,slot)
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL, customer_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS review_links (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL, submitted_at TEXT, created_at TEXT NOT NULL, UNIQUE(booking_id)
  );
  CREATE TABLE IF NOT EXISTS integration_settings (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, provider TEXT NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, PRIMARY KEY(company_id,provider)
  );
  CREATE TABLE IF NOT EXISTS webhook_events (
    provider TEXT NOT NULL, event_id TEXT NOT NULL, company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    received_at TEXT NOT NULL, PRIMARY KEY(provider,event_id)
  );
  CREATE TABLE IF NOT EXISTS whatsapp_conversations (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, phone TEXT NOT NULL,
    step TEXT NOT NULL DEFAULT '', context TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
    PRIMARY KEY(company_id,phone)
  );
  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL, phone TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('in','out')),
    body TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(company_id,event_id,direction)
  );
  CREATE TABLE IF NOT EXISTS message_templates (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_audit (
    id TEXT PRIMARY KEY, company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, entity TEXT NOT NULL,
    entity_id TEXT, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS bookings_company_date_idx ON bookings(company_id, start_at, end_at);
  CREATE INDEX IF NOT EXISTS bookings_court_date_idx ON bookings(court_id, start_at, end_at);
`);
const bookingColumns = db.prepare('PRAGMA table_info(bookings)').all().map(column => column.name);
if (!bookingColumns.includes('client_id')) db.exec('ALTER TABLE bookings ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL');
if (!bookingColumns.includes('cancel_reason')) db.exec("ALTER TABLE bookings ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT ''");
if (!bookingColumns.includes('updated_at')) db.exec("ALTER TABLE bookings ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
const financeColumns = db.prepare('PRAGMA table_info(finance_entries)').all().map(column => column.name);
if (!financeColumns.includes('monthly_charge_id')) db.exec('ALTER TABLE finance_entries ADD COLUMN monthly_charge_id TEXT REFERENCES monthly_charges(id) ON DELETE SET NULL');
if (!financeColumns.includes('tournament_entry_id')) db.exec('ALTER TABLE finance_entries ADD COLUMN tournament_entry_id TEXT REFERENCES tournament_entries(id) ON DELETE SET NULL');
const companyColumns = db.prepare('PRAGMA table_info(companies)').all().map(column => column.name);
for (const [name, definition] of [['description', "TEXT NOT NULL DEFAULT ''"], ['address', "TEXT NOT NULL DEFAULT ''"], ['city', "TEXT NOT NULL DEFAULT ''"], ['state', "TEXT NOT NULL DEFAULT ''"], ['amenities', "TEXT NOT NULL DEFAULT '[]'"], ['photos', "TEXT NOT NULL DEFAULT '[]'"], ['public_options', "TEXT NOT NULL DEFAULT '{}'" ]]) {
  if (!companyColumns.includes(name)) db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${definition}`);
}
db.exec('CREATE INDEX IF NOT EXISTS clients_company_idx ON clients(company_id,name); CREATE INDEX IF NOT EXISTS bookings_client_idx ON bookings(client_id);');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS finance_booking_once_idx ON finance_entries(booking_id) WHERE booking_id IS NOT NULL;');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS finance_monthly_charge_once_idx ON finance_entries(monthly_charge_id) WHERE monthly_charge_id IS NOT NULL;');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS finance_tournament_entry_once_idx ON finance_entries(tournament_entry_id) WHERE tournament_entry_id IS NOT NULL;');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS reviews_booking_once_idx ON reviews(booking_id) WHERE booking_id IS NOT NULL;');
for (const company of db.prepare('SELECT id FROM companies').all()) {
  for (let weekday = 0; weekday < 7; weekday++) db.prepare(`INSERT OR IGNORE INTO company_hours (company_id,weekday,is_open,open_time,close_time) VALUES (?, ?, 1, '08:00', '23:00')`).run(company.id, weekday);
}
for (const booking of db.prepare('SELECT id,company_id,customer_name,customer_phone FROM bookings WHERE client_id IS NULL').all()) {
  const phone = booking.customer_phone ? String(booking.customer_phone).replace(/\D/g, '') : null;
  let client = phone && phone.length >= 10 && phone.length <= 15
    ? db.prepare('SELECT id FROM clients WHERE company_id=? AND phone=? LIMIT 1').get(booking.company_id, phone)
    : db.prepare('SELECT id FROM clients WHERE company_id=? AND lower(name)=lower(?) AND phone IS NULL LIMIT 1').get(booking.company_id, booking.customer_name);
  if (!client) {
    const id = randomUUID();
    db.prepare('INSERT INTO clients (id,company_id,name,phone,created_at) VALUES (?,?,?,?,?)').run(id, booking.company_id, booking.customer_name, phone, new Date().toISOString());
    client = { id };
  }
  db.prepare('UPDATE bookings SET client_id=? WHERE id=?').run(client.id, booking.id);
}

const port = Number(process.env.PORT || 3000);
const appBaseUrl = process.env.APP_BASE_URL || '';
const wahaBaseUrl = process.env.WAHA_BASE_URL || '';
const wahaApiKey = process.env.WAHA_API_KEY || '';
const wahaWebhookSecret = process.env.WAHA_WEBHOOK_SECRET || '';
const mpAppId = process.env.MERCADOPAGO_APP_ID || '';
const mpClientSecret = process.env.MERCADOPAGO_CLIENT_SECRET || '';
const mpEncryptionKey = process.env.MERCADOPAGO_ENCRYPTION_KEY || '';
const mpWebhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
const prod = process.env.NODE_ENV === 'production';
const sessionDays = 7;
const loginAttempts = new Map();
const publicBookingAttempts = new Map();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (res, status, data, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', ...(prod ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}), ...headers });
  res.end(JSON.stringify(data));
};
const slugify = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const hashToken = (s) => createHash('sha256').update(s).digest('hex');
function encryptSecret(value) {
  if (!/^[a-f0-9]{64}$/i.test(mpEncryptionKey)) throw new HttpError(503, 'Configure uma chave AES de 32 bytes para armazenar credenciais Pix com segurança.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(mpEncryptionKey, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${encrypted.toString('hex')}`;
}
function decryptSecret(value) {
  if (!/^[a-f0-9]{64}$/i.test(mpEncryptionKey)) throw new HttpError(503, 'A chave de criptografia Mercado Pago não está configurada.');
  const [iv, tag, data] = String(value || '').split('.');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(mpEncryptionKey, 'hex'), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
}
async function mpAccessToken(companyId) {
  const cfg = integration(companyId, 'mercadopago');
  if (!cfg.connected || !cfg.access_token) throw new HttpError(409, 'Conecte a conta Mercado Pago da arena.');
  if (Date.parse(cfg.expires_at) > Date.now() + 30 * 60_000) return decryptSecret(cfg.access_token);
  if (!mpAppId || !mpClientSecret) throw new HttpError(503, 'Credenciais Mercado Pago não configuradas no servidor.');
  const response = await fetch('https://api.mercadopago.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: mpAppId, client_secret: mpClientSecret, grant_type: 'refresh_token', refresh_token: decryptSecret(cfg.refresh_token) }), signal: AbortSignal.timeout(12000) });
  const renewed = await response.json().catch(() => ({}));
  if (!response.ok || !renewed.access_token || !renewed.refresh_token) throw new HttpError(502, 'A autorização Mercado Pago expirou. Reconecte a conta da arena.');
  cfg.access_token = encryptSecret(renewed.access_token); cfg.refresh_token = encryptSecret(renewed.refresh_token); cfg.expires_at = new Date(Date.now() + Number(renewed.expires_in || 15552000) * 1000).toISOString();
  db.prepare('UPDATE integration_settings SET settings=?,updated_at=? WHERE company_id=? AND provider=?').run(JSON.stringify(cfg), new Date().toISOString(), companyId, 'mercadopago');
  return renewed.access_token;
}
const hashPassword = (password, salt = randomBytes(16).toString('hex')) => ({ salt, hash: scryptSync(password, salt, 64).toString('hex') });
function passwordMatches(password, salt, expected) {
  const candidate = Buffer.from(hashPassword(password, salt).hash, 'hex');
  const known = Buffer.from(expected, 'hex');
  return candidate.length === known.length && timingSafeEqual(candidate, known);
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('='); return [decodeURIComponent(v.slice(0, i)), decodeURIComponent(v.slice(i + 1))];
  }));
}
function cookieHeader(value, maxAge) {
  return `qf_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${prod ? '; Secure' : ''}`;
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) throw new HttpError(413, 'A solicitação é muito grande.'); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Não foi possível ler os dados enviados.'); }
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = appBaseUrl ? new URL(appBaseUrl).host : req.headers.host;
  if (new URL(origin).host !== allowed) throw new HttpError(403, 'Origem não autorizada.');
}
function getUser(req) {
  const token = parseCookies(req.headers.cookie).qf_session;
  if (!token) return null;
  const user = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.company_id, c.name AS company_name, c.slug AS company_slug, c.status AS company_status
    FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN companies c ON c.id=u.company_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(hashToken(token), new Date().toISOString());
  if (!user || (user.company_id && user.company_status !== 'active')) return null;
  return user;
}
function requireUser(req, role) {
  const user = getUser(req);
  if (!user) throw new HttpError(401, 'Entre novamente para continuar.');
  if (role && user.role !== role) throw new HttpError(403, 'Você não tem permissão para esta ação.');
  return user;
}
function safeUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, company: u.company_id ? { id: u.company_id, name: u.company_name, slug: u.company_slug } : null };
}
function sendSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date(); const expires = new Date(now.getTime() + sessionDays * 86400000);
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    .run(hashToken(token), userId, expires.toISOString(), now.toISOString());
  res.setHeader('Set-Cookie', cookieHeader(token, sessionDays * 86400));
}
function validateDateTime(s) { return typeof s === 'string' && !Number.isNaN(Date.parse(s)); }
function saoPauloNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${value.year}-${value.month}-${value.day}`, time: `${value.hour}:${value.minute}` };
}
function companyHours(companyId) {
  return db.prepare('SELECT weekday,is_open,open_time,close_time FROM company_hours WHERE company_id=? ORDER BY weekday').all(companyId);
}
function publicProfile(company) {
  let amenities = [], photos = [], options = {};
  try { amenities = JSON.parse(company.amenities || '[]'); } catch {}
  try { photos = JSON.parse(company.photos || '[]'); } catch {}
  try { options = JSON.parse(company.public_options || '{}'); } catch {}
  return { description: company.description || '', address: company.address || '', city: company.city || '', state: company.state || '', amenities, photos, options: { description: true, address: true, amenities: true, photos: true, hours: true, prices: true, ...options } };
}
function assertWithinHours(companyId, startAt, endAt) {
  const start = new Date(startAt), end = new Date(endAt);
  if (startAt.slice(0, 10) !== endAt.slice(0, 10)) throw new HttpError(400, 'A reserva deve terminar no mesmo dia em que começa.');
  const weekday = start.getUTCDay(); const hours = db.prepare('SELECT is_open,open_time,close_time FROM company_hours WHERE company_id=? AND weekday=?').get(companyId, weekday);
  if (!hours || !hours.is_open) throw new HttpError(400, 'A arena não funciona nesse dia.');
  const startClock = startAt.slice(11, 16), endClock = endAt.slice(11, 16);
  if (startClock < hours.open_time || endClock > hours.close_time) throw new HttpError(400, `A arena funciona das ${hours.open_time} às ${hours.close_time} neste dia.`);
}
function assertNoConflict(companyId, courtId, start, end) {
  const conflict = db.prepare(`SELECT id FROM bookings WHERE company_id=? AND court_id=? AND status!='cancelled' AND start_at<? AND end_at>? LIMIT 1`)
    .get(companyId, courtId, end, start);
  const block = db.prepare(`SELECT id FROM blocked_slots WHERE company_id=? AND court_id=? AND start_at<? AND end_at>? LIMIT 1`)
    .get(companyId, courtId, end, start);
  const startDate = new Date(start), weekday = startDate.getUTCDay(), startMinute = Number(start.slice(11, 13)) * 60 + Number(start.slice(14, 16)), endMinute = Number(end.slice(11, 13)) * 60 + Number(end.slice(14, 16));
  const memberConflict = db.prepare("SELECT start_time,duration_minutes FROM monthly_members WHERE company_id=? AND court_id=? AND weekday=? AND status='active'").all(companyId, courtId, weekday).some(member => { const [h, m] = member.start_time.split(':').map(Number), memberStart = h * 60 + m; return memberStart < endMinute && memberStart + member.duration_minutes > startMinute; });
  if (conflict || block || memberConflict) throw new HttpError(409, block ? 'Este horário está bloqueado para a quadra.' : memberConflict ? 'Este horário é reservado para um mensalista.' : 'Este horário já foi reservado. Escolha outro horário.');
}
function reserve(companyId, courtId, customerName, customerPhone, startAt, endAt, source) {
  const court = db.prepare('SELECT id, price_cents FROM courts WHERE id=? AND company_id=? AND active=1').get(courtId, companyId);
  if (!court) throw new HttpError(404, 'A quadra não está disponível.');
  if (!customerName || customerName.trim().length < 2 || customerName.length > 100) throw new HttpError(400, 'Informe o nome do cliente.');
  if (!validateDateTime(startAt) || !validateDateTime(endAt) || Date.parse(endAt) <= Date.parse(startAt)) throw new HttpError(400, 'Confira a data e o horário da reserva.');
  const startMs = Date.parse(startAt); const endMs = Date.parse(endAt); const durationMinutes = (endMs - startMs) / 60000;
  if (startMs % 1_800_000 !== 0 || durationMinutes < 60 || durationMinutes % 30 !== 0) throw new HttpError(400, 'Use horários em blocos de 30 minutos e duração mínima de 1 hora.');
  const normalizedStart = new Date(startMs).toISOString(); const normalizedEnd = new Date(endMs).toISOString();
  assertWithinHours(companyId, normalizedStart, normalizedEnd);
  assertNoConflict(companyId, courtId, normalizedStart, normalizedEnd);
  const amountCents = Math.round(court.price_cents * durationMinutes / 60);
  const phone = customerPhone ? String(customerPhone).replace(/\D/g, '') : null;
  if (phone && (phone.length < 10 || phone.length > 15)) throw new HttpError(400, 'Confira o telefone do cliente.');
  let client = phone
    ? db.prepare('SELECT id FROM clients WHERE company_id=? AND phone=? ORDER BY created_at LIMIT 1').get(companyId, phone)
    : db.prepare('SELECT id FROM clients WHERE company_id=? AND lower(name)=lower(?) AND phone IS NULL ORDER BY created_at LIMIT 1').get(companyId, customerName.trim());
  if (client) db.prepare('UPDATE clients SET name=? WHERE id=? AND company_id=?').run(customerName.trim(), client.id, companyId);
  else {
    const clientId = randomUUID();
    db.prepare('INSERT INTO clients (id,company_id,name,phone,created_at) VALUES (?,?,?,?,?)').run(clientId, companyId, customerName.trim(), phone, new Date().toISOString());
    client = { id: clientId };
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO bookings (id,company_id,court_id,client_id,customer_name,customer_phone,start_at,end_at,amount_cents,status,source,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, companyId, courtId, client.id, customerName.trim(), phone, normalizedStart, normalizedEnd, amountCents, 'pending', source, new Date().toISOString());
  return db.prepare(`SELECT b.*, c.name AS court_name FROM bookings b JOIN courts c ON c.id=b.court_id WHERE b.id=?`).get(id);
}
function validatePublicName(value, label) {
  if (typeof value !== 'string' || value.trim().length < 2 || value.length > 100) throw new HttpError(400, `Confira ${label}.`);
  return value.trim();
}
function audit(companyId, userId, action, entity, entityId, details = {}) {
  db.prepare('INSERT INTO app_audit (id,company_id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(randomUUID(), companyId || null, userId || null, action, entity, entityId || null, JSON.stringify(details), new Date().toISOString());
}
function integration(companyId, provider) {
  const row = db.prepare('SELECT settings FROM integration_settings WHERE company_id=? AND provider=?').get(companyId, provider);
  try { return JSON.parse(row?.settings || '{}'); } catch { return {}; }
}
async function createBookingPixLink(company, booking) {
  const config = integration(company.id, 'mercadopago'); if (!config.connected) return null;
  if (booking.amount_cents < 1) return null;
  const saved = integration(company.id, 'mp_payments'); if (saved[booking.id]) return saved[booking.id];
  const startTime = booking.start_at.slice(11,16), endTime = booking.end_at.slice(11,16), base = appBaseUrl.replace(/\/$/, '');
  const preference = { items: [{ id: booking.id, title: `Reserva ${booking.court_name} · ${booking.sport}`, quantity: 1, currency_id: 'BRL', unit_price: booking.amount_cents / 100 }], external_reference: booking.id, notification_url: `${base}/api/webhooks/mercadopago`, back_urls: { success: `${base}/a/${company.slug}?pagamento=sucesso`, pending: `${base}/a/${company.slug}?pagamento=pendente`, failure: `${base}/a/${company.slug}?pagamento=erro` }, payment_methods: { excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'ticket' }, { id: 'atm' }, { id: 'prepaid_card' }], default_payment_method_id: 'pix', installments: 1 }, statement_descriptor: 'QUADRASFLOW' };
  const response = await fetch('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { Authorization: `Bearer ${await mpAccessToken(company.id)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(preference), signal: AbortSignal.timeout(12000) }); const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.init_point) throw new HttpError(502, 'Não foi possível criar a cobrança no Mercado Pago.');
  const link = { url: result.init_point, preferenceId: result.id, amountCents: booking.amount_cents, date: booking.start_at.slice(0,10), startTime, endTime };
  db.prepare('INSERT INTO integration_settings (company_id,provider,settings,updated_at) VALUES (?,?,?,?) ON CONFLICT(company_id,provider) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at').run(company.id, 'mp_payments', JSON.stringify({ ...saved, [booking.id]: link }), new Date().toISOString());
  return link;
}
function messageText(companyId, category, fallback, variables = {}) {
  const template = db.prepare('SELECT body FROM message_templates WHERE company_id=? AND category=? AND active=1 ORDER BY created_at DESC LIMIT 1').get(companyId, category);
  return String(template?.body || fallback).replace(/\{([a-z_]+)\}/gi, (match, key) => Object.hasOwn(variables, key) ? String(variables[key]) : match);
}
async function sendWahaText(companyId, session, phone, message) {
  if (!wahaBaseUrl || !wahaApiKey) return false;
  const response = await fetch(`${wahaBaseUrl.replace(/\/$/, '')}/api/sendText`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': wahaApiKey }, body: JSON.stringify({ chatId: `${phone}@c.us`, text: message, session }), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`WAHA respondeu ${response.status}`);
  db.prepare('INSERT INTO whatsapp_messages (id,company_id,event_id,phone,direction,body,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), companyId, randomUUID(), String(phone).replace(/\D/g,''), 'out', String(message).slice(0,2000), new Date().toISOString());
  return true;
}
async function processWahaMessage(company, session, payload) {
  const phone = String(payload.from || '').split('@')[0].replace(/\D/g, ''), text = String(payload.body || '').trim().slice(0, 1000), key = text.toLocaleLowerCase('pt-BR');
  if (!phone || phone.length < 10 || !text || String(payload.from || '').endsWith('@g.us')) return;
  let conv = db.prepare('SELECT * FROM whatsapp_conversations WHERE company_id=? AND phone=?').get(company.id, phone), context = {};
  try { context = JSON.parse(conv?.context || '{}'); } catch {}
  let reply = '';
  if (conv?.step === 'human' && !/^(menu|reservar)$/i.test(key)) return;
  if (/\b(atendente|pessoa|humano|equipe)\b/i.test(key)) { conv = conv || {}; conv.step = 'human'; reply = `Certo. Avisei a equipe da ${company.name}; uma pessoa continuará esta conversa por aqui.`; }
  else if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|menu|reservar|agendar)$/i.test(key) || !conv?.step) {
    const courts = db.prepare('SELECT id,name,sport FROM courts WHERE company_id=? AND active=1 ORDER BY name').all(company.id);
    if (!courts.length) reply = `Olá! ${company.name} ainda não cadastrou quadras para reserva.`;
    else { context = { courts: courts.map(item => item.id) }; conv = { step: 'court' }; const options = courts.map((item, i) => `${i + 1}. ${item.name} · ${item.sport}`).join('\n'); reply = messageText(company.id, 'menu', 'Olá! Vou ajudar com sua reserva na {arena_name}. Escolha a quadra enviando o número:\n{quadras}', { arena_name: company.name, quadras: options }); }
  } else if (conv.step === 'court') {
    const courts = db.prepare('SELECT id,name,sport FROM courts WHERE company_id=? AND active=1 ORDER BY name').all(company.id), selected = courts[Number(key) - 1];
    if (!selected) reply = 'Não reconheci a quadra. Envie o número de uma das opções ou escreva “menu”.';
    else { context.courtId = selected.id; conv.step = 'date'; reply = `Qual data você prefere para ${selected.name}? Envie no formato AAAA-MM-DD.`; }
  } else if (conv.step === 'date') {
    const day = key, now = saoPauloNow(), last = new Date(`${now.date}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 90);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || day < now.date || day > last.toISOString().slice(0, 10)) reply = 'Envie uma data entre hoje e os próximos 90 dias, no formato AAAA-MM-DD.';
    else {
      const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(), hours = db.prepare('SELECT * FROM company_hours WHERE company_id=? AND weekday=?').get(company.id, weekday);
      if (!hours?.is_open) reply = 'A arena está fechada nesse dia. Envie outra data (AAAA-MM-DD).';
      else {
        const opening = Number(hours.open_time.slice(0, 2)) * 60 + Number(hours.open_time.slice(3)), closing = Number(hours.close_time.slice(0, 2)) * 60 + Number(hours.close_time.slice(3)), [nh, nm] = now.time.split(':').map(Number), min = day === now.date ? Math.ceil((nh * 60 + nm) / 30) * 30 : opening;
        const bookings = db.prepare("SELECT start_at,end_at FROM bookings WHERE company_id=? AND court_id=? AND status!='cancelled' AND substr(start_at,1,10)=?").all(company.id, context.courtId, day), blocks = db.prepare('SELECT start_at,end_at FROM blocked_slots WHERE company_id=? AND court_id=? AND substr(start_at,1,10)=?').all(company.id, context.courtId, day), slots = [];
        for (let minute = Math.max(opening, min); minute <= closing - 60; minute += 30) { const startAt = `${day}T${timeHH(minute)}:00.000Z`, endAt = `${day}T${timeHH(minute + 60)}:00.000Z`; if (![...bookings, ...blocks].some(item => item.start_at < endAt && item.end_at > startAt)) slots.push(timeHH(minute)); }
        if (!slots.length) reply = 'Não há horários livres nesse dia. Envie outra data (AAAA-MM-DD).';
        else { context.date = day; context.slots = slots.slice(0, 8); conv.step = 'time'; reply = `Horários livres (1h) em ${day}:\n${context.slots.join(', ')}\nEnvie o horário escolhido (HH:MM).`; }
      }
    }
  } else if (conv.step === 'time') {
    if (!context.slots?.includes(key)) reply = `Escolha um horário da lista: ${context.slots?.join(', ') || 'envie “menu” para recomeçar'}.`;
    else { context.startTime = key; conv.step = 'duration'; reply = `Qual duração?\n1. 1 hora\n2. 1 hora e 30 minutos\n3. 2 horas`; }
  } else if (conv.step === 'duration') {
    const duration = ({ '1': 60, '2': 90, '3': 120 })[key];
    if (!duration) reply = 'Escolha 1, 2 ou 3 para informar a duração.';
    else {
      const startMinute = Number(context.startTime.slice(0, 2)) * 60 + Number(context.startTime.slice(3)), startAt = `${context.date}T${context.startTime}:00.000Z`, endAt = `${context.date}T${timeHH(startMinute + duration)}:00.000Z`, name = String(payload._data?.notifyName || payload.notifyName || 'Cliente WhatsApp').slice(0, 100);
      try { db.exec('BEGIN IMMEDIATE'); const booking = reserve(company.id, context.courtId, name, phone, startAt, endAt, 'whatsapp'); db.prepare('INSERT INTO booking_events (id,company_id,booking_id,event,details,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), company.id, booking.id, 'whatsapp_request', '{}', new Date().toISOString()); db.exec('COMMIT'); const amount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(booking.amount_cents / 100); reply = messageText(company.id, 'reserva_criada', 'Pedido recebido para {data}, das {horario}. Valor estimado: {valor}. A equipe da {arena_name} vai confirmar pelo WhatsApp.', { data: context.date, horario: `${context.startTime} às ${timeHH(startMinute + duration)}`, valor: amount, arena_name: company.name }); conv.step = ''; context = {}; let pixLink = null; try { pixLink = await createBookingPixLink(company, booking); } catch {} if (pixLink) reply += '\nPix: ' + pixLink.url; }
      catch (error) { try { db.exec('ROLLBACK'); } catch {} conv.step = 'date'; reply = `${error instanceof HttpError ? error.message : 'Esse horário acabou de ficar indisponível.'}\nEnvie outra data no formato AAAA-MM-DD.`; }
    }
  } else { conv.step = ''; reply = 'Vamos começar novamente. Escreva “reservar”.'; }
  db.prepare('INSERT INTO whatsapp_conversations (company_id,phone,step,context,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(company_id,phone) DO UPDATE SET step=excluded.step,context=excluded.context,updated_at=excluded.updated_at').run(company.id, phone, conv?.step || '', JSON.stringify(context), new Date().toISOString());
  await sendWahaText(company.id, session, phone, reply);
}
const timeHH = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

async function api(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname;
  if (method !== 'GET' && method !== 'HEAD' && !pathname.startsWith('/api/webhooks/')) checkOrigin(req);

  if (pathname === '/api/integrations/mercadopago/callback' && method === 'GET') {
    const state = String(url.searchParams.get('state') || ''), saved = db.prepare("SELECT company_id,settings FROM integration_settings WHERE provider='mp_oauth_state'").all().find(row => { try { return JSON.parse(row.settings).hash === hashToken(state); } catch { return false; } });
    if (!saved || !state) throw new HttpError(400, 'Conexão Mercado Pago expirada ou inválida.');
    const pending = JSON.parse(saved.settings);
    db.prepare("DELETE FROM integration_settings WHERE company_id=? AND provider='mp_oauth_state'").run(saved.company_id);
    if (Date.parse(pending.expires_at) < Date.now() || !url.searchParams.get('code')) throw new HttpError(400, 'A autorização expirou ou foi cancelada no Mercado Pago.');
    if (!mpAppId || !mpClientSecret || !mpEncryptionKey) throw new HttpError(503, 'Configure as credenciais Mercado Pago no servidor.');
    const redirectUri = `${appBaseUrl.replace(/\/$/, '')}/api/integrations/mercadopago/callback`;
    const response = await fetch('https://api.mercadopago.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: mpAppId, client_secret: mpClientSecret, grant_type: 'authorization_code', code: String(url.searchParams.get('code')), redirect_uri: redirectUri, state }), signal: AbortSignal.timeout(12000) });
    const credentials = await response.json().catch(() => ({}));
    if (!response.ok || !credentials.access_token || !credentials.refresh_token) throw new HttpError(502, 'O Mercado Pago não concluiu a conexão. Tente novamente.');
    const settings = { connected: true, user_id: String(credentials.user_id || ''), access_token: encryptSecret(credentials.access_token), refresh_token: encryptSecret(credentials.refresh_token), expires_at: new Date(Date.now() + Number(credentials.expires_in || 15552000) * 1000).toISOString() };
    db.prepare('INSERT INTO integration_settings (company_id,provider,settings,updated_at) VALUES (?,?,?,?) ON CONFLICT(company_id,provider) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at').run(saved.company_id, 'mercadopago', JSON.stringify(settings), new Date().toISOString());
    res.writeHead(302, { Location: `${appBaseUrl.replace(/\/$/, '')}/?mercadopago=connected`, 'Cache-Control': 'no-store' }); res.end(); return;
  }
  if (pathname === '/api/health' && method === 'GET') return json(res, 200, { ok: true });
  if (pathname === '/api/integrations/mercadopago' && method === 'GET') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const config = integration(user.company_id, 'mercadopago');
    return json(res, 200, { configured: Boolean(mpAppId && mpClientSecret && mpEncryptionKey && mpWebhookSecret), connected: Boolean(config.connected), accountId: config.user_id ? `••••${config.user_id.slice(-4)}` : '', expiresAt: config.expires_at || null });
  }
  if (pathname === '/api/integrations/mercadopago/connect' && method === 'POST') {
    const user = requireUser(req, 'arena_admin');
    if (!mpAppId || !mpClientSecret || !mpEncryptionKey || !mpWebhookSecret || !appBaseUrl) throw new HttpError(503, 'Configure credenciais OAuth, chave de criptografia e segredo do webhook Mercado Pago no servidor.');
    const state = randomBytes(32).toString('hex'), redirectUri = `${appBaseUrl.replace(/\/$/, '')}/api/integrations/mercadopago/callback`;
    db.prepare('INSERT INTO integration_settings (company_id,provider,settings,updated_at) VALUES (?,?,?,?) ON CONFLICT(company_id,provider) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at').run(user.company_id, 'mp_oauth_state', JSON.stringify({ hash: hashToken(state), expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }), new Date().toISOString());
    const auth = new URL('https://auth.mercadopago.com.br/authorization'); auth.search = new URLSearchParams({ client_id: mpAppId, response_type: 'code', platform_id: 'mp', redirect_uri: redirectUri, state }).toString();
    return json(res, 200, { url: auth.toString() });
  }
  const mpWebhookPath = pathname === '/api/webhooks/mercadopago' && method === 'POST';
  if (mpWebhookPath) {
    if (!mpWebhookSecret) throw new HttpError(503, 'Webhook Mercado Pago sem segredo configurado.');
    const paymentId = String(url.searchParams.get('data.id') || url.searchParams.get('id') || ''), signature = String(req.headers['x-signature'] || ''), requestId = String(req.headers['x-request-id'] || ''), parts = Object.fromEntries(signature.split(',').map(part => part.trim().split('=')));
    if (!/^\d+$/.test(paymentId) || !parts.ts || !parts.v1 || !requestId) throw new HttpError(401, 'Assinatura do webhook inválida.');
    const manifest = `id:${paymentId};request-id:${requestId};ts:${parts.ts};`, expected = createHmac('sha256', mpWebhookSecret).update(manifest).digest('hex');
    const supplied = Buffer.from(parts.v1), expectedBytes = Buffer.from(expected);
    if (supplied.length !== expectedBytes.length || !timingSafeEqual(supplied, expectedBytes)) throw new HttpError(401, 'Assinatura do webhook inválida.');
    const event = await readBody(req), sellerId = String(event.user_id || '');
    const companyRows = db.prepare("SELECT company_id,settings FROM integration_settings WHERE provider='mercadopago'").all();
    const row = companyRows.find(item => { try { const cfg = JSON.parse(item.settings); return cfg.connected && cfg.user_id === sellerId; } catch { return false; } });
    if (!row) return json(res, 200, { ok: true, ignored: true });
    let payment; try { const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${await mpAccessToken(row.company_id)}` }, signal: AbortSignal.timeout(10000) }); if (response.ok) payment = await response.json(); } catch {}
    const matchedCompany = row.company_id;
    if (!payment || String(payment.collector_id) !== sellerId || payment.status !== 'approved') return json(res, 200, { ok: true, ignored: true });
    const booking = db.prepare('SELECT * FROM bookings WHERE id=? AND company_id=?').get(String(payment.external_reference || ''), matchedCompany);
    if (!booking || Math.round(Number(payment.transaction_amount) * 100) !== booking.amount_cents || payment.currency_id !== 'BRL') return json(res, 200, { ok: true, ignored: true });
    db.prepare("UPDATE bookings SET status='confirmed',updated_at=? WHERE id=? AND status='pending'").run(new Date().toISOString(), booking.id);
    db.prepare("INSERT OR IGNORE INTO finance_entries (id,company_id,booking_id,kind,category,description,amount_cents,due_date,paid_at,created_at) VALUES (?,?,?,'income','Reservas',?,?,?, ?,?)").run(randomUUID(), matchedCompany, booking.id, `Reserva ${booking.id}`, booking.amount_cents, booking.start_at.slice(0,10), new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT OR IGNORE INTO webhook_events (provider,event_id,company_id,received_at) VALUES (?,?,?,?)').run('mercadopago', `${paymentId}:${payment.status}`, matchedCompany, new Date().toISOString());
    return json(res, 200, { ok: true });
  }
  const pixLinkMatch = pathname.match(/^\/api\/bookings\/([a-f0-9-]+)\/pix-link$/i);
  if (pixLinkMatch && method === 'POST') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const booking = db.prepare('SELECT b.*,c.name AS court_name,c.sport FROM bookings b JOIN courts c ON c.id=b.court_id WHERE b.id=? AND b.company_id=?').get(pixLinkMatch[1], user.company_id);
    if (!booking) throw new HttpError(404, 'Reserva não encontrada.'); if (booking.status !== 'pending') throw new HttpError(409, 'A cobrança Pix só pode ser criada para reservas pendentes.'); if (booking.amount_cents < 1) throw new HttpError(400, 'Defina o valor da quadra antes de gerar uma cobrança Pix.');
    const config = integration(user.company_id, 'mercadopago'); if (!config.connected) throw new HttpError(409, 'Conecte a conta Mercado Pago da arena antes de cobrar por Pix.');
    const savedLinks = integration(user.company_id, 'mp_payments'); if (savedLinks[booking.id]) return json(res, 200, savedLinks[booking.id]);
    const date = booking.start_at.slice(0,10), startTime = booking.start_at.slice(11,16), endTime = booking.end_at.slice(11,16), preference = { items: [{ id: booking.id, title: `Reserva ${booking.court_name} · ${booking.sport}`, quantity: 1, currency_id: 'BRL', unit_price: booking.amount_cents / 100 }], external_reference: booking.id, notification_url: `${appBaseUrl.replace(/\/$/, '')}/api/webhooks/mercadopago`, back_urls: { success: `${appBaseUrl.replace(/\/$/, '')}/a/${user.company_slug}?pagamento=sucesso`, pending: `${appBaseUrl.replace(/\/$/, '')}/a/${user.company_slug}?pagamento=pendente`, failure: `${appBaseUrl.replace(/\/$/, '')}/a/${user.company_slug}?pagamento=erro` }, payment_methods: { excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'ticket' }, { id: 'atm' }, { id: 'prepaid_card' }], default_payment_method_id: 'pix', installments: 1 }, statement_descriptor: 'QUADRASFLOW' };
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { Authorization: `Bearer ${await mpAccessToken(user.company_id)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(preference), signal: AbortSignal.timeout(12000) }); const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.init_point) throw new HttpError(502, 'Não foi possível criar a cobrança no Mercado Pago. Confira a conexão da arena.');
    const link = { url: result.init_point, preferenceId: result.id, amountCents: booking.amount_cents, expiresAt: null, date, startTime, endTime };
    db.prepare('INSERT INTO integration_settings (company_id,provider,settings,updated_at) VALUES (?,?,?,?) ON CONFLICT(company_id,provider) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at').run(user.company_id, 'mp_payments', JSON.stringify({ ...savedLinks, [booking.id]: link }), new Date().toISOString());
    if (booking.customer_phone) { const waha = integration(user.company_id, 'waha'); if (waha.enabled && waha.session) await sendWahaText(user.company_id, waha.session, booking.customer_phone, `Olá, ${booking.customer_name}! Pague sua reserva de ${booking.court_name}, dia ${date} das ${startTime} às ${endTime}, pelo Pix: ${result.init_point}`); }
    return json(res, 201, link);
  }
  const wahaWebhookMatch = pathname.match(/^\/api\/webhooks\/waha\/([a-z0-9-]+)$/i);
  if (wahaWebhookMatch && method === 'POST') {
    if (!wahaWebhookSecret) throw new HttpError(503, 'Webhook WAHA sem segredo configurado.');
    const supplied = Buffer.from(String(req.headers['x-quadrasflow-secret'] || ''));
    const expected = Buffer.from(wahaWebhookSecret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(401, 'Webhook não autorizado.');
    const company = db.prepare("SELECT id,slug,name FROM companies WHERE slug=? AND status='active'").get(wahaWebhookMatch[1]);
    if (!company) throw new HttpError(404, 'Arena não encontrada.');
    const body = await readBody(req), config = integration(company.id, 'waha');
    if (!config.enabled || !config.session || body.session !== config.session) throw new HttpError(403, 'Sessão WAHA não autorizada para esta arena.');
    const eventId = String(body.id || body.payload?.id || '');
    if (body.event === 'message' && eventId && !body.payload?.fromMe) {
      try { db.prepare('INSERT INTO webhook_events (provider,event_id,company_id,received_at) VALUES (?,?,?,?)').run('waha', eventId, company.id, new Date().toISOString()); }
      catch (error) { if (String(error.message).includes('UNIQUE')) return json(res, 200, { ok: true, duplicate: true }); throw error; }
      db.prepare('INSERT OR IGNORE INTO whatsapp_messages (id,company_id,event_id,phone,direction,body,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), company.id, eventId, String(body.payload.from || '').split('@')[0].replace(/\D/g, ''), 'in', String(body.payload.body || '').slice(0, 1000), new Date().toISOString());
      try { await processWahaMessage(company, config.session, body.payload || {}); }
      catch (error) { console.error('Falha ao processar webhook WAHA:', error.message); }
    } else if (body.event === 'session.status') {
      db.prepare('UPDATE integration_settings SET settings=json_set(settings,\'$.status\',?),updated_at=? WHERE company_id=? AND provider=\'waha\'').run(String(body.payload?.status || 'unknown').slice(0, 40), new Date().toISOString(), company.id);
    }
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/integrations/waha' && method === 'GET') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const config = integration(user.company_id, 'waha');
    return json(res, 200, { session: config.session || '', enabled: Boolean(config.enabled), status: config.status || 'unknown', connected: Boolean(wahaBaseUrl && wahaApiKey), webhookUrl: appBaseUrl && user.company_slug ? `${appBaseUrl.replace(/\/$/, '')}/api/webhooks/waha/${user.company_slug}` : '' });
  }
  if (pathname === '/api/message-templates' && method === 'GET') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const defaults = [['menu','Boas-vindas','Olá! Escolha a quadra enviando o número:\n{quadras}'],['reserva_criada','Pedido de reserva','Pedido recebido para {data}, das {horario}. Valor estimado: {valor}. A arena {arena_name} vai confirmar pelo WhatsApp.'],['avaliacao','Solicitar avaliação','Como foi sua experiência na {arena_name}? Avalie aqui: {review_link}']];
    const addDefault = db.prepare('INSERT INTO message_templates (id,company_id,title,category,body,active,created_at) SELECT ?,?,?,?,?,1,? WHERE NOT EXISTS (SELECT 1 FROM message_templates WHERE company_id=? AND category=?)');
    for (const [category,title,body] of defaults) addDefault.run(randomUUID(), user.company_id, title, category, body, new Date().toISOString(), user.company_id, category);
    return json(res, 200, { templates: db.prepare('SELECT id,title,category,body,active,created_at FROM message_templates WHERE company_id=? ORDER BY created_at,title').all(user.company_id) });
  }
  if (pathname === '/api/message-templates' && method === 'POST') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req), title = validatePublicName(body.title, 'o título do modelo'), category = String(body.category || ''), content = String(body.body || '').trim();
    if (!['menu', 'reserva_criada', 'avaliacao', 'reserva_confirmada', 'lembrete', 'pagamento'].includes(category) || !content || content.length > 2000) throw new HttpError(400, 'Confira a categoria e o texto do modelo (até 2.000 caracteres).');
    const id = randomUUID(); db.prepare('INSERT INTO message_templates (id,company_id,title,category,body,active,created_at) VALUES (?,?,?,?,?,1,?)').run(id,user.company_id,title,category,content,new Date().toISOString());
    audit(user.company_id,user.id,'message_template.created','message_template',id); return json(res,201,{id});
  }
  const messageTemplateMatch = pathname.match(/^\/api\/message-templates\/([a-f0-9-]+)$/i);
  if (messageTemplateMatch && method === 'PATCH') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req), active = body.active;
    if (typeof active !== 'boolean') throw new HttpError(400, 'Informe se o modelo está ativo.');
    const result = db.prepare('UPDATE message_templates SET active=? WHERE id=? AND company_id=?').run(active?1:0,messageTemplateMatch[1],user.company_id);
    if (!result.changes) throw new HttpError(404,'Modelo não encontrado.'); audit(user.company_id,user.id,active?'message_template.activated':'message_template.deactivated','message_template',messageTemplateMatch[1]); return json(res,200,{ok:true});
  }
  if (pathname === '/api/whatsapp/conversations' && method === 'GET') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const phone = String(url.searchParams.get('phone') || '').replace(/\D/g, '');
    if (phone) return json(res, 200, { messages: db.prepare('SELECT direction,body,created_at FROM whatsapp_messages WHERE company_id=? AND phone=? ORDER BY created_at LIMIT 300').all(user.company_id, phone) });
    const conversations = db.prepare(`SELECT c.phone,c.step,c.updated_at,(SELECT body FROM whatsapp_messages m WHERE m.company_id=c.company_id AND m.phone=c.phone ORDER BY m.created_at DESC LIMIT 1) last_message
      FROM whatsapp_conversations c WHERE c.company_id=? ORDER BY c.updated_at DESC LIMIT 100`).all(user.company_id);
    return json(res, 200, { conversations });
  }
  if (pathname === '/api/whatsapp/reply' && method === 'POST') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const body = await readBody(req), phone = String(body.phone || '').replace(/\D/g, ''), message = String(body.message || '').trim();
    if (phone.length < 10 || phone.length > 15 || !message || message.length > 2000) throw new HttpError(400, 'Confira o telefone e o texto da mensagem.');
    const config = integration(user.company_id, 'waha'); if (!config.enabled || !config.session) throw new HttpError(409, 'Conecte a sessão WAHA da arena antes de responder.');
    try { await sendWahaText(user.company_id, config.session, phone, message); }
    catch { throw new HttpError(502, 'O WAHA não conseguiu enviar esta mensagem. Verifique a sessão.'); }
    db.prepare('INSERT INTO whatsapp_conversations (company_id,phone,step,context,updated_at) VALUES (?,?,\'human\',\'{}\',?) ON CONFLICT(company_id,phone) DO UPDATE SET step=\'human\',updated_at=excluded.updated_at').run(user.company_id,phone,new Date().toISOString());
    audit(user.company_id,user.id,'whatsapp.reply_sent','conversation',phone); return json(res,200,{ok:true});
  }
  const conversationResumeMatch = pathname.match(/^\/api\/whatsapp\/conversations\/([0-9]{10,15})\/resume$/);
  if (conversationResumeMatch && method === 'PATCH') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const result = db.prepare('UPDATE whatsapp_conversations SET step=\'\',context=\'{}\',updated_at=? WHERE company_id=? AND phone=?').run(new Date().toISOString(),user.company_id,conversationResumeMatch[1]);
    if (!result.changes) throw new HttpError(404,'Conversa não encontrada.'); return json(res,200,{ok:true});
  }
  if (pathname === '/api/integrations/waha' && method === 'PUT') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req), session = String(body.session || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(session)) throw new HttpError(400, 'Informe o nome válido da sessão WAHA.');
    if (session !== user.company_slug && !session.startsWith(`${user.company_slug}-`)) throw new HttpError(400, `A sessão precisa começar com o identificador desta arena: ${user.company_slug}-`);
    if (!wahaBaseUrl || !wahaApiKey || !wahaWebhookSecret) throw new HttpError(503, 'Configure WAHA_BASE_URL, WAHA_API_KEY e WAHA_WEBHOOK_SECRET no servidor.');
    for (const row of db.prepare("SELECT company_id,settings FROM integration_settings WHERE provider='waha' AND company_id!=?").all(user.company_id)) { try { if (JSON.parse(row.settings).session === session) throw new HttpError(409, 'Essa sessão WAHA já está vinculada a outra arena.'); } catch (error) { if (error instanceof HttpError) throw error; } }
    const current = integration(user.company_id, 'waha');
    const config = { session, enabled: body.enabled !== false, status: current.status || 'unknown' };
    db.prepare('INSERT INTO integration_settings (company_id,provider,settings,updated_at) VALUES (?,?,?,?) ON CONFLICT(company_id,provider) DO UPDATE SET settings=excluded.settings,updated_at=excluded.updated_at').run(user.company_id, 'waha', JSON.stringify(config), new Date().toISOString());
    audit(user.company_id, user.id, 'integration.waha.configured', 'integration', user.company_id, { session });
    return json(res, 200, { ok: true, session, enabled: config.enabled });
  }
  if (pathname === '/api/integrations/waha/status' && method === 'GET') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const config = integration(user.company_id, 'waha'); if (!config.session || !wahaBaseUrl || !wahaApiKey) return json(res, 200, { configured: false, status: 'not_configured' });
    try { const response = await fetch(`${wahaBaseUrl.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(config.session)}`, { headers: { 'X-Api-Key': wahaApiKey }, signal: AbortSignal.timeout(6000) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`WAHA respondeu ${response.status}`); return json(res, 200, { configured: true, status: data.status || data.state || 'unknown', session: config.session }); }
    catch { return json(res, 200, { configured: true, status: 'unavailable', session: config.session }); }
  }
  if (pathname === '/api/integrations/waha/qr' && method === 'GET') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const config = integration(user.company_id, 'waha'); if (!config.session || !wahaBaseUrl || !wahaApiKey) throw new HttpError(503, 'Configure a sessão WAHA primeiro.');
    const response = await fetch(`${wahaBaseUrl.replace(/\/$/, '')}/api/${encodeURIComponent(config.session)}/auth/qr?format=image`, { headers: { 'X-Api-Key': wahaApiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    const image = await response.json().catch(() => ({})); if (!response.ok || !image.data || !/^image\/(png|jpeg|webp)$/.test(image.mimetype || '')) throw new HttpError(409, 'O QR Code ainda não está disponível. Confira o estado da sessão.');
    return json(res, 200, { image: `data:${image.mimetype};base64,${image.data}` });
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now(); const attempts = (loginAttempts.get(ip) || []).filter(t => now - t < 15 * 60_000);
    if (attempts.length >= 10) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    const body = await readBody(req); const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || '');
    const user = db.prepare(`SELECT u.*, c.status AS company_status, c.name AS company_name, c.slug AS company_slug FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE u.email=?`).get(email);
    if (!user || !user.active || (user.company_id && user.company_status !== 'active') || !passwordMatches(password, user.password_salt, user.password_hash)) {
      attempts.push(now); loginAttempts.set(ip, attempts); throw new HttpError(401, 'E-mail ou senha não conferem.');
    }
    loginAttempts.delete(ip); sendSession(res, user.id);
    return json(res, 200, { user: safeUser(user) });
  }
  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = getUser(req); if (!user) return json(res, 200, { user: null });
    return json(res, 200, { user: safeUser(user) });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req.headers.cookie).qf_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
  }

  const publicReviewMatch = pathname.match(/^\/api\/public\/reviews\/([A-Za-z0-9_-]{30,80})$/);
  if (publicReviewMatch && ['GET', 'POST'].includes(method)) {
    const reviewLink = db.prepare('SELECT r.*,b.customer_name,b.start_at,c.name AS company_name FROM review_links r JOIN bookings b ON b.id=r.booking_id JOIN companies c ON c.id=r.company_id WHERE r.token_hash=? AND r.expires_at>?').get(hashToken(publicReviewMatch[1]), new Date().toISOString());
    if (!reviewLink) throw new HttpError(404, 'Este link de avaliação expirou ou não existe.');
    if (method === 'GET') return json(res, 200, { arena: reviewLink.company_name, customer: reviewLink.customer_name, date: reviewLink.start_at.slice(0, 10), submitted: Boolean(reviewLink.submitted_at) });
    if (reviewLink.submitted_at) throw new HttpError(409, 'Esta avaliação já foi enviada.');
    const body = await readBody(req), rating = Number(body.rating), comment = String(body.comment || '').trim().slice(0, 1000);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Escolha uma nota de 1 a 5.');
    const createdAt = new Date().toISOString(); db.exec('BEGIN IMMEDIATE');
    try { db.prepare('INSERT INTO reviews (id,company_id,booking_id,customer_name,rating,comment,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), reviewLink.company_id, reviewLink.booking_id, reviewLink.customer_name, rating, comment, createdAt); db.prepare('UPDATE review_links SET submitted_at=? WHERE id=? AND submitted_at IS NULL').run(createdAt, reviewLink.id); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); if (String(error.message).includes('reviews_booking_once_idx')) throw new HttpError(409, 'Esta avaliação já foi enviada.'); throw error; }
    return json(res, 201, { ok: true });
  }
  if (pathname === '/api/reviews' && method === 'GET') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const reviews = db.prepare('SELECT id,customer_name,rating,comment,created_at FROM reviews WHERE company_id=? ORDER BY created_at DESC LIMIT 100').all(user.company_id);
    const average = db.prepare('SELECT ROUND(AVG(rating),1) average,COUNT(*) count FROM reviews WHERE company_id=?').get(user.company_id);
    return json(res, 200, { reviews, average });
  }

  const publicArenaMatch = pathname.match(/^\/api\/public\/arenas\/([a-z0-9-]+)$/i);
  const publicBookingMatch = pathname.match(/^\/api\/public\/arenas\/([a-z0-9-]+)\/bookings$/i);
  if (publicArenaMatch && method === 'GET') {
    const slug = publicArenaMatch[1];
    const company = db.prepare("SELECT * FROM companies WHERE slug=? AND status='active'").get(slug);
    if (!company) throw new HttpError(404, 'Arena não encontrada.');
    const now = saoPauloNow(); const day = url.searchParams.get('date') || now.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00.000Z`))) throw new HttpError(400, 'Data inválida.');
    const courts = db.prepare('SELECT id,name,sport,price_cents FROM courts WHERE company_id=? AND active=1 ORDER BY name').all(company.id);
    const bookings = db.prepare("SELECT court_id,start_at,end_at FROM bookings WHERE company_id=? AND status!='cancelled' AND substr(start_at,1,10)=?").all(company.id, day);
    const blocks = db.prepare('SELECT court_id,start_at,end_at FROM blocked_slots WHERE company_id=? AND substr(start_at,1,10)=?').all(company.id, day);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    for (const member of db.prepare("SELECT court_id,start_time,duration_minutes FROM monthly_members WHERE company_id=? AND weekday=? AND status='active'").all(company.id, weekday)) { const startMinute = Number(member.start_time.slice(0, 2)) * 60 + Number(member.start_time.slice(3)), startAt = `${day}T${member.start_time}:00.000Z`; bookings.push({ court_id: member.court_id, start_at: startAt, end_at: `${day}T${timeHH(startMinute + member.duration_minutes)}:00.000Z` }); }
    const hours = db.prepare('SELECT weekday,is_open,open_time,close_time FROM company_hours WHERE company_id=? AND weekday=?').get(company.id, weekday) || { weekday, is_open: 1, open_time: '08:00', close_time: '23:00' };
    const [hour, minute] = now.time.split(':').map(Number), nextSlot = Math.ceil((hour * 60 + minute) / 30) * 30;
    const opening = Number(hours.open_time.slice(0, 2)) * 60 + Number(hours.open_time.slice(3));
    const closing = Number(hours.close_time.slice(0, 2)) * 60 + Number(hours.close_time.slice(3));
    const firstSlot = day === now.date ? Math.max(opening, nextSlot) : opening;
    const notBefore = hours.is_open && firstSlot + 60 <= closing ? `${String(Math.floor(firstSlot / 60)).padStart(2, '0')}:${String(firstSlot % 60).padStart(2, '0')}` : '24:00';
    const profile = publicProfile(company);
    const tournaments = db.prepare("SELECT t.id,t.name,t.sport,t.category,t.start_date,t.entry_fee_cents,t.capacity,(SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id=t.id) entries_count FROM tournaments t WHERE t.company_id=? AND t.status='open' ORDER BY t.start_date").all(company.id);
    return json(res, 200, { arena: { name: company.name, slug: company.slug, ...profile }, courts, bookings, blocks, hours, tournaments, not_before: notBefore });
  }
  if (publicBookingMatch && method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now();
    const attempts = (publicBookingAttempts.get(ip) || []).filter(time => now - time < 10 * 60_000);
    if (attempts.length >= 20) throw new HttpError(429, 'Muitas solicitações. Aguarde alguns minutos e tente novamente.');
    attempts.push(now); publicBookingAttempts.set(ip, attempts);
    const company = db.prepare("SELECT id FROM companies WHERE slug=? AND status='active'").get(publicBookingMatch[1]);
    if (!company) throw new HttpError(404, 'Arena não encontrada.');
    const body = await readBody(req); const name = validatePublicName(body.customerName, 'seu nome');
    const phone = String(body.customerPhone || '').replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) throw new HttpError(400, 'Informe um WhatsApp válido com DDD.');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(body.startAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(body.endAt)) throw new HttpError(400, 'Escolha horários disponíveis.');
    const day = body.startAt.slice(0, 10); const today = saoPauloNow();
    const lastDay = new Date(`${today.date}T00:00:00Z`); lastDay.setUTCDate(lastDay.getUTCDate() + 90);
    if (day < today.date || day > lastDay.toISOString().slice(0, 10) || body.endAt.slice(0, 10) !== day) throw new HttpError(400, 'Escolha uma data entre hoje e os próximos 90 dias.');
    if (day === today.date && body.startAt.slice(11, 16) <= today.time) throw new HttpError(400, 'Escolha um horário futuro.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const booking = reserve(company.id, String(body.courtId || ''), name, phone, body.startAt, body.endAt, 'public');
      db.exec('COMMIT'); return json(res, 201, { booking: { id: booking.id, status: booking.status, start_at: booking.start_at, end_at: booking.end_at, amount_cents: booking.amount_cents } });
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  if (pathname === '/api/platform/companies' && method === 'GET') {
    requireUser(req, 'platform_admin');
    const companies = db.prepare(`SELECT c.id,c.name,c.slug,c.status,c.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.company_id=c.id AND u.active=1) AS users_count,
      (SELECT COUNT(*) FROM courts q WHERE q.company_id=c.id AND q.active=1) AS courts_count,
      (SELECT u.name FROM users u WHERE u.company_id=c.id AND u.role='arena_admin' ORDER BY u.created_at LIMIT 1) AS admin_name,
      (SELECT u.email FROM users u WHERE u.company_id=c.id AND u.role='arena_admin' ORDER BY u.created_at LIMIT 1) AS admin_email
      FROM companies c ORDER BY c.created_at DESC`).all();
    return json(res, 200, { companies });
  }
  if (pathname === '/api/platform/companies' && method === 'POST') {
    const platformUser = requireUser(req, 'platform_admin'); const body = await readBody(req);
    const companyName = validatePublicName(body.companyName, 'o nome da empresa');
    const adminName = validatePublicName(body.adminName, 'o nome do administrador');
    const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Informe um e-mail válido.');
    if (password.length < 14 || password.length > 200) throw new HttpError(400, 'A senha inicial deve ter pelo menos 14 caracteres.');
    let slug = slugify(body.slug || companyName); if (!slug) throw new HttpError(400, 'Informe um identificador válido para a arena.');
    if (db.prepare('SELECT id FROM companies WHERE slug=?').get(slug)) throw new HttpError(409, 'Esse identificador público já está em uso.');
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new HttpError(409, 'Esse e-mail já possui acesso ao QuadrasFlow.');
    const companyId = randomUUID(); const userId = randomUUID(); const createdAt = new Date().toISOString(); const credentials = hashPassword(password);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO companies (id,name,slug,status,created_at) VALUES (?,?,?,\'active\',?)').run(companyId, companyName, slug, createdAt);
      db.prepare(`INSERT INTO users (id,company_id,name,email,password_hash,password_salt,role,active,created_at) VALUES (?,?,?,?,?,?,'arena_admin',1,?)`)
        .run(userId, companyId, adminName, email, credentials.hash, credentials.salt, createdAt);
      for (let weekday = 0; weekday < 7; weekday++) db.prepare(`INSERT INTO company_hours (company_id,weekday,is_open,open_time,close_time) VALUES (?, ?, 1, '08:00', '23:00')`).run(companyId, weekday);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Esse nome, identificador ou e-mail já está cadastrado.'); throw error; }
    audit(null, platformUser.id, 'company.created', 'company', companyId, { slug });
    return json(res, 201, { company: { id: companyId, name: companyName, slug, status: 'active', created_at: createdAt }, admin: { name: adminName, email } });
  }
  const companyStatusMatch = pathname.match(/^\/api\/platform\/companies\/([a-f0-9-]+)\/status$/i);
  if (companyStatusMatch && method === 'PATCH') {
    const platformUser = requireUser(req, 'platform_admin'); const body = await readBody(req);
    if (!['active', 'suspended'].includes(body.status)) throw new HttpError(400, 'Status inválido.');
    const result = db.prepare('UPDATE companies SET status=? WHERE id=?').run(body.status, companyStatusMatch[1]);
    if (!result.changes) throw new HttpError(404, 'Empresa não encontrada.');
    audit(null, platformUser.id, `company.${body.status}`, 'company', companyStatusMatch[1]);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/monthly-members' && method === 'GET') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const now = saoPauloNow(), cycle = url.searchParams.get('cycle') || now.date.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cycle)) throw new HttpError(400, 'Mês inválido.');
    const members = db.prepare(`SELECT m.*,cl.name AS client_name,cl.phone,q.name AS court_name FROM monthly_members m
      JOIN clients cl ON cl.id=m.client_id JOIN courts q ON q.id=m.court_id WHERE m.company_id=? ORDER BY m.status,m.weekday,m.start_time`).all(user.company_id);
    const createCharge = db.prepare('INSERT OR IGNORE INTO monthly_charges (id,company_id,member_id,cycle,amount_cents,due_date,created_at) VALUES (?,?,?,?,?,?,?)');
    for (const member of members) if (member.status === 'active') createCharge.run(randomUUID(), user.company_id, member.id, cycle, member.amount_cents, `${cycle}-05`, new Date().toISOString());
    const charges = db.prepare(`SELECT mc.*,m.client_id,cl.name AS client_name,m.court_id,q.name AS court_name FROM monthly_charges mc
      JOIN monthly_members m ON m.id=mc.member_id JOIN clients cl ON cl.id=m.client_id JOIN courts q ON q.id=m.court_id WHERE mc.company_id=? AND mc.cycle=? ORDER BY cl.name`).all(user.company_id, cycle);
    return json(res, 200, { members, charges, cycle });
  }
  if (pathname === '/api/monthly-members' && method === 'POST') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req), clientId = String(body.clientId || ''), courtId = String(body.courtId || ''), weekday = Number(body.weekday), startTime = String(body.startTime || ''), duration = Number(body.durationMinutes), amount = Math.round(Number(body.amountCents));
    const client = db.prepare('SELECT id FROM clients WHERE id=? AND company_id=?').get(clientId, user.company_id), court = db.prepare('SELECT id FROM courts WHERE id=? AND company_id=? AND active=1').get(courtId, user.company_id);
    if (!client || !court) throw new HttpError(404, 'Cliente ou quadra não encontrado.');
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^([01]\d|2[0-3]):(00|30)$/.test(startTime) || !Number.isInteger(duration) || duration < 60 || duration > 240 || duration % 30 || !Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'Confira dia, horário, duração e valor do mensalista.');
    const [sh, sm] = startTime.split(':').map(Number), startMin = sh * 60 + sm, endMin = startMin + duration;
    const hours = db.prepare('SELECT is_open,open_time,close_time FROM company_hours WHERE company_id=? AND weekday=?').get(user.company_id, weekday);
    if (!hours?.is_open || startTime < hours.open_time || endMin > Number(hours.close_time.slice(0, 2)) * 60 + Number(hours.close_time.slice(3))) throw new HttpError(400, 'O horário recorrente fica fora do funcionamento da arena.');
    const membershipConflict = db.prepare("SELECT start_time,duration_minutes FROM monthly_members WHERE company_id=? AND court_id=? AND weekday=? AND status='active'").all(user.company_id, courtId, weekday).some(m => { const [h, min] = m.start_time.split(':').map(Number), ms = h * 60 + min; return ms < endMin && ms + m.duration_minutes > startMin; });
    if (membershipConflict) throw new HttpError(409, 'Já existe mensalista nesse horário recorrente.');
    const today = saoPauloNow().date, cursor = new Date(`${today}T12:00:00Z`), end = new Date(cursor); end.setUTCDate(end.getUTCDate() + 90);
    while (cursor.getUTCDay() !== weekday) cursor.setUTCDate(cursor.getUTCDate() + 1);
    for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
      const day = cursor.toISOString().slice(0, 10), startAt = `${day}T${startTime}:00.000Z`, endAt = `${day}T${timeHH(endMin)}:00.000Z`;
      const conflict = db.prepare("SELECT id FROM bookings WHERE company_id=? AND court_id=? AND status!='cancelled' AND start_at<? AND end_at>? LIMIT 1").get(user.company_id, courtId, endAt, startAt);
      const block = db.prepare('SELECT id FROM blocked_slots WHERE company_id=? AND court_id=? AND start_at<? AND end_at>? LIMIT 1').get(user.company_id, courtId, endAt, startAt);
      if (conflict || block) throw new HttpError(409, `O horário recorrente conflita com a agenda em ${day}.`);
    }
    const id = randomUUID(); db.prepare('INSERT INTO monthly_members (id,company_id,client_id,court_id,weekday,start_time,duration_minutes,amount_cents,status,created_at) VALUES (?,?,?,?,?,?,?,?,\'active\',?)').run(id, user.company_id, clientId, courtId, weekday, startTime, duration, amount, new Date().toISOString());
    audit(user.company_id, user.id, 'monthly_member.created', 'monthly_member', id);
    return json(res, 201, { id });
  }
  const monthlyStatusMatch = pathname.match(/^\/api\/monthly-members\/([a-f0-9-]+)\/status$/i);
  if (monthlyStatusMatch && method === 'PATCH') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req);
    if (!['active', 'paused', 'ended'].includes(body.status)) throw new HttpError(400, 'Estado do mensalista inválido.');
    const result = db.prepare('UPDATE monthly_members SET status=? WHERE id=? AND company_id=?').run(body.status, monthlyStatusMatch[1], user.company_id);
    if (!result.changes) throw new HttpError(404, 'Mensalista não encontrado.');
    audit(user.company_id, user.id, `monthly_member.${body.status}`, 'monthly_member', monthlyStatusMatch[1]);
    return json(res, 200, { ok: true });
  }
  const monthlyPaidMatch = pathname.match(/^\/api\/monthly-charges\/([a-f0-9-]+)\/paid$/i);
  if (monthlyPaidMatch && method === 'PATCH') {
    const user = requireUser(req, 'arena_admin'), charge = db.prepare('SELECT * FROM monthly_charges WHERE id=? AND company_id=?').get(monthlyPaidMatch[1], user.company_id);
    if (!charge) throw new HttpError(404, 'Cobrança não encontrada.');
    if (!charge.paid_at) {
      const paidAt = new Date().toISOString(); db.exec('BEGIN IMMEDIATE');
      try { db.prepare('UPDATE monthly_charges SET paid_at=? WHERE id=? AND company_id=?').run(paidAt, charge.id, user.company_id); db.prepare('INSERT OR IGNORE INTO finance_entries (id,company_id,monthly_charge_id,kind,category,description,amount_cents,due_date,paid_at,created_at) VALUES (?,?,?,\'income\',\'Mensalistas\',?,?,?,?,?)').run(randomUUID(), user.company_id, charge.id, `Mensalidade ${charge.cycle}`, charge.amount_cents, charge.due_date, paidAt, paidAt); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
      audit(user.company_id, user.id, 'monthly_charge.paid', 'monthly_charge', charge.id);
    }
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/tournaments' && method === 'GET') {
    const user = requireUser(req); if (!user.company_id) throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const tournaments = db.prepare(`SELECT t.*,(SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id=t.id) AS entries_count FROM tournaments t WHERE t.company_id=? ORDER BY t.start_date`).all(user.company_id);
    const entries = db.prepare(`SELECT e.*,t.name AS tournament_name,t.entry_fee_cents FROM tournament_entries e JOIN tournaments t ON t.id=e.tournament_id WHERE t.company_id=? ORDER BY e.created_at DESC`).all(user.company_id);
    const matches = db.prepare(`SELECT m.*,t.name AS tournament_name FROM tournament_matches m JOIN tournaments t ON t.id=m.tournament_id WHERE t.company_id=? ORDER BY t.start_date,m.round,m.slot`).all(user.company_id);
    return json(res, 200, { tournaments, entries, matches });
  }
  if (pathname === '/api/tournaments' && method === 'POST') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req), name = validatePublicName(body.name, 'o nome do torneio'), sport = validatePublicName(body.sport, 'a modalidade'), category = String(body.category || '').trim().slice(0, 80), startDate = String(body.startDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))) throw new HttpError(400, 'Informe a data do torneio.');
    const fee = Math.round(Number(body.entryFeeCents || 0)), capacity = Math.trunc(Number(body.capacity || 0));
    if (!Number.isInteger(fee) || fee < 0 || fee > 100000000 || !Number.isInteger(capacity) || capacity < 2 || capacity > 512) throw new HttpError(400, 'Confira taxa de inscrição e limite de participantes.');
    const id = randomUUID(); db.prepare('INSERT INTO tournaments (id,company_id,name,sport,category,start_date,entry_fee_cents,capacity,status,created_at) VALUES (?,?,?,?,?,?,?, ?,\'open\',?)').run(id, user.company_id, name, sport, category, startDate, fee, capacity, new Date().toISOString());
    audit(user.company_id, user.id, 'tournament.created', 'tournament', id); return json(res, 201, { id });
  }
  const tournamentMatch = pathname.match(/^\/api\/tournaments\/([a-f0-9-]+)(?:\/(status|bracket))?$/i);
  if (tournamentMatch && method === 'PATCH' && tournamentMatch[2] === 'status') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req);
    if (!['open', 'in_progress', 'finished', 'cancelled'].includes(body.status)) throw new HttpError(400, 'Status inválido.');
    const result = db.prepare('UPDATE tournaments SET status=? WHERE id=? AND company_id=?').run(body.status, tournamentMatch[1], user.company_id);
    if (!result.changes) throw new HttpError(404, 'Torneio não encontrado.'); audit(user.company_id, user.id, `tournament.${body.status}`, 'tournament', tournamentMatch[1]); return json(res, 200, { ok: true });
  }
  if (tournamentMatch && method === 'POST' && tournamentMatch[2] === 'bracket') {
    const user = requireUser(req, 'arena_admin'), tournament = db.prepare('SELECT * FROM tournaments WHERE id=? AND company_id=?').get(tournamentMatch[1], user.company_id);
    if (!tournament) throw new HttpError(404, 'Torneio não encontrado.');
    const entries = db.prepare('SELECT player_name FROM tournament_entries WHERE tournament_id=? AND paid=1 ORDER BY created_at').all(tournament.id);
    if (entries.length < 2) throw new HttpError(400, 'Confirme o pagamento de pelo menos duas inscrições antes de gerar a chave.');
    if (db.prepare('SELECT id FROM tournament_matches WHERE tournament_id=? LIMIT 1').get(tournament.id)) throw new HttpError(409, 'A chave já foi gerada.');
    db.prepare('DELETE FROM tournament_matches WHERE tournament_id=?').run(tournament.id);
    const size = 2 ** Math.ceil(Math.log2(entries.length)), rounds = Math.log2(size), players = entries.map(e => e.player_name);
    for (let i = players.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [players[i], players[j]] = [players[j], players[i]]; }
    const insert = db.prepare('INSERT INTO tournament_matches (id,tournament_id,round,slot,player_a,player_b) VALUES (?,?,?,?,?,?)');
    for (let slot = 0; slot < size / 2; slot++) insert.run(randomUUID(), tournament.id, 1, slot + 1, players[slot * 2] || null, players[slot * 2 + 1] || null);
    for (let round = 2; round <= rounds; round++) for (let slot = 1; slot <= size / (2 ** round); slot++) insert.run(randomUUID(), tournament.id, round, slot, null, null);
    for (const match of db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? AND round=1').all(tournament.id)) { const winner = match.player_a || match.player_b; if (winner && !(match.player_a && match.player_b)) { db.prepare('UPDATE tournament_matches SET winner=? WHERE id=?').run(winner, match.id); const next = db.prepare('SELECT id FROM tournament_matches WHERE tournament_id=? AND round=2 AND slot=?').get(tournament.id, Math.ceil(match.slot / 2)); if (next) db.prepare(match.slot % 2 ? 'UPDATE tournament_matches SET player_a=? WHERE id=?' : 'UPDATE tournament_matches SET player_b=? WHERE id=?').run(winner, next.id); } }
    db.prepare("UPDATE tournaments SET status='in_progress' WHERE id=?").run(tournament.id); audit(user.company_id, user.id, 'tournament.bracket_generated', 'tournament', tournament.id, { players: entries.length });
    return json(res, 201, { matches: db.prepare('SELECT * FROM tournament_matches WHERE tournament_id=? ORDER BY round,slot').all(tournament.id) });
  }
  if (pathname === '/api/tournaments/entries' && method === 'PATCH') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req), entry = db.prepare('SELECT e.*,t.company_id,t.name AS tournament_name FROM tournament_entries e JOIN tournaments t ON t.id=e.tournament_id WHERE e.id=? AND t.company_id=?').get(String(body.entryId || ''), user.company_id);
    if (!entry) throw new HttpError(404, 'Inscrição não encontrada.');
    db.prepare('UPDATE tournament_entries SET paid=? WHERE id=?').run(body.paid ? 1 : 0, entry.id);
    if (body.paid && entry.entry_fee_cents > 0) { const paidAt = new Date().toISOString(); db.prepare('INSERT OR IGNORE INTO finance_entries (id,company_id,tournament_entry_id,kind,category,description,amount_cents,due_date,paid_at,created_at) SELECT ?,t.company_id,e.id,\'income\',\'Torneios\',t.name,t.entry_fee_cents,date(\'now\'),?,? FROM tournament_entries e JOIN tournaments t ON t.id=e.tournament_id WHERE e.id=?').run(randomUUID(), paidAt, paidAt, entry.id); }
    else db.prepare('DELETE FROM finance_entries WHERE tournament_entry_id=? AND company_id=?').run(entry.id, user.company_id);
    audit(user.company_id, user.id, 'tournament.entry_payment_updated', 'tournament_entry', entry.id, { paid: Boolean(body.paid) }); return json(res, 200, { ok: true });
  }
  const matchScore = pathname.match(/^\/api\/tournament-matches\/([a-f0-9-]+)$/i);
  if (matchScore && method === 'PATCH') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req), match = db.prepare('SELECT m.*,t.company_id FROM tournament_matches m JOIN tournaments t ON t.id=m.tournament_id WHERE m.id=? AND t.company_id=?').get(matchScore[1], user.company_id);
    const scoreA = Number(body.scoreA), scoreB = Number(body.scoreB);
    if (!match) throw new HttpError(404, 'Partida não encontrada.'); if (match.winner) throw new HttpError(409, 'Esta partida já tem resultado.'); if (!match.player_a || !match.player_b || !Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA === scoreB) throw new HttpError(400, 'Informe um placar válido para uma partida com dois participantes.');
    const winner = scoreA > scoreB ? match.player_a : match.player_b; db.exec('BEGIN IMMEDIATE');
    try { db.prepare('UPDATE tournament_matches SET score_a=?,score_b=?,winner=? WHERE id=?').run(scoreA, scoreB, winner, match.id); if (match.round > 0) { const next = db.prepare('SELECT id,player_a,player_b FROM tournament_matches WHERE tournament_id=? AND round=? AND slot=?').get(match.tournament_id, match.round + 1, Math.ceil(match.slot / 2)); if (next) db.prepare(match.slot % 2 ? 'UPDATE tournament_matches SET player_a=? WHERE id=?' : 'UPDATE tournament_matches SET player_b=? WHERE id=?').run(winner, next.id); else db.prepare("UPDATE tournaments SET status='finished' WHERE id=?").run(match.tournament_id); } db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; } audit(user.company_id, user.id, 'tournament.match_scored', 'tournament_match', match.id, { scoreA, scoreB }); return json(res, 200, { ok: true, winner });
  }
  const publicTournamentsMatch = pathname.match(/^\/api\/public\/arenas\/([a-z0-9-]+)\/tournaments$/i);
  const publicTournamentEntryMatch = pathname.match(/^\/api\/public\/tournaments\/([a-f0-9-]+)\/entries$/i);
  if (publicTournamentsMatch && method === 'GET') { const company = db.prepare("SELECT id FROM companies WHERE slug=? AND status='active'").get(publicTournamentsMatch[1]); if (!company) throw new HttpError(404, 'Arena não encontrada.'); return json(res, 200, { tournaments: db.prepare("SELECT t.id,t.name,t.sport,t.category,t.start_date,t.entry_fee_cents,t.capacity,(SELECT COUNT(*) FROM tournament_entries e WHERE e.tournament_id=t.id) entries_count FROM tournaments t WHERE t.company_id=? AND t.status='open' ORDER BY t.start_date").all(company.id) }); }
  if (publicTournamentEntryMatch && method === 'POST') { const tournament = db.prepare("SELECT t.* FROM tournaments t JOIN companies c ON c.id=t.company_id WHERE t.id=? AND t.status='open' AND c.status='active'").get(publicTournamentEntryMatch[1]); if (!tournament) throw new HttpError(404, 'Inscrições não estão abertas.'); const body = await readBody(req), name = validatePublicName(body.name, 'seu nome'), phone = String(body.phone || '').replace(/\D/g, ''); if (phone.length < 10 || phone.length > 15) throw new HttpError(400, 'Informe WhatsApp válido.'); const id = randomUUID(); db.exec('BEGIN IMMEDIATE'); try { if (db.prepare('SELECT id FROM tournament_entries WHERE tournament_id=? AND phone=?').get(tournament.id,phone)) throw new HttpError(409,'Este WhatsApp já está inscrito.'); const count = db.prepare('SELECT COUNT(*) count FROM tournament_entries WHERE tournament_id=?').get(tournament.id).count; if (count >= tournament.capacity) throw new HttpError(409, 'As vagas desse torneio acabaram.'); db.prepare('INSERT INTO tournament_entries (id,tournament_id,player_name,phone,created_at) VALUES (?,?,?,?,?)').run(id, tournament.id, name, phone, new Date().toISOString()); db.exec('COMMIT'); } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; } return json(res, 201, { id, payment_required: tournament.entry_fee_cents > 0, entry_fee_cents: tournament.entry_fee_cents }); }
  if (pathname === '/api/finance' && method === 'GET') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Acesse o painel da plataforma.');
    const from = url.searchParams.get('from') || `${saoPauloNow().date.slice(0, 7)}-01`, to = url.searchParams.get('to') || saoPauloNow().date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new HttpError(400, 'Confira o período do relatório.');
    const entries = db.prepare('SELECT * FROM finance_entries WHERE company_id=? AND due_date BETWEEN ? AND ? ORDER BY due_date DESC,created_at DESC').all(user.company_id, from, to);
    const summary = db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind='income' AND paid_at IS NOT NULL THEN amount_cents ELSE 0 END),0) AS income_paid,
      COALESCE(SUM(CASE WHEN kind='expense' AND paid_at IS NOT NULL THEN amount_cents ELSE 0 END),0) AS expense_paid,
      COALESCE(SUM(CASE WHEN kind='expense' AND paid_at IS NULL THEN amount_cents ELSE 0 END),0) AS expense_due,
      COALESCE(SUM(CASE WHEN kind='income' AND paid_at IS NULL THEN amount_cents ELSE 0 END),0) AS income_due
      FROM finance_entries WHERE company_id=? AND due_date BETWEEN ? AND ?`).get(user.company_id, from, to);
    const categories = db.prepare(`SELECT kind,category,SUM(amount_cents) amount_cents,COUNT(*) count FROM finance_entries WHERE company_id=? AND due_date BETWEEN ? AND ? AND paid_at IS NOT NULL GROUP BY kind,category ORDER BY kind,category`).all(user.company_id, from, to);
    return json(res, 200, { entries, summary: { ...summary, result: summary.income_paid - summary.expense_paid }, categories });
  }
  if (pathname === '/api/finance' && method === 'POST') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req);
    if (!['income', 'expense'].includes(body.kind)) throw new HttpError(400, 'Tipo de lançamento inválido.');
    const category = validatePublicName(body.category, 'a categoria').slice(0, 60), description = validatePublicName(body.description, 'a descrição').slice(0, 180);
    const amountCents = Math.round(Number(body.amountCents));
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 1000000000) throw new HttpError(400, 'Informe um valor válido.');
    const dueDate = String(body.dueDate || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`))) throw new HttpError(400, 'Informe uma data válida.');
    const id = randomUUID(), paidAt = body.paid ? new Date().toISOString() : null;
    db.prepare('INSERT INTO finance_entries (id,company_id,kind,category,description,amount_cents,due_date,paid_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, user.company_id, body.kind, category, description, amountCents, dueDate, paidAt, new Date().toISOString());
    audit(user.company_id, user.id, 'finance.created', 'finance_entry', id, { kind: body.kind, amountCents });
    return json(res, 201, { id });
  }
  const financePaidMatch = pathname.match(/^\/api\/finance\/([a-f0-9-]+)\/paid$/i);
  if (financePaidMatch && method === 'PATCH') {
    const user = requireUser(req, 'arena_admin'), body = await readBody(req);
    const result = db.prepare('UPDATE finance_entries SET paid_at=? WHERE id=? AND company_id=?').run(body.paid ? new Date().toISOString() : null, financePaidMatch[1], user.company_id);
    if (!result.changes) throw new HttpError(404, 'Lançamento não encontrado.');
    audit(user.company_id, user.id, body.paid ? 'finance.paid' : 'finance.reopened', 'finance_entry', financePaidMatch[1]);
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/dashboard' && method === 'GET') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Acesse o painel da plataforma.');
    const day = url.searchParams.get('date') || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Data inválida.');
    const summary = db.prepare(`SELECT SUM(CASE WHEN status!='cancelled' THEN 1 ELSE 0 END) AS bookings_count,
      COALESCE(SUM(CASE WHEN status!='cancelled' THEN amount_cents ELSE 0 END),0) AS reserved_cents,
      COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS pending_count,
      COUNT(DISTINCT CASE WHEN status!='cancelled' THEN court_id END) AS courts_used FROM bookings WHERE company_id=? AND substr(start_at,1,10)=?`)
      .get(user.company_id, day);
    const courts = db.prepare('SELECT COUNT(*) AS count FROM courts WHERE company_id=? AND active=1').get(user.company_id).count;
    const start = new Date(`${day}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - 6);
    const from = start.toISOString().slice(0, 10);
    const rows = db.prepare(`SELECT substr(start_at,1,10) AS date, COUNT(*) AS count,
      COALESCE(SUM(amount_cents),0) AS reserved_cents FROM bookings
      WHERE company_id=? AND status!='cancelled' AND substr(start_at,1,10) BETWEEN ? AND ? GROUP BY date`).all(user.company_id, from, day);
    const byDate = new Map(rows.map(row => [row.date, row]));
    const week = Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setUTCDate(date.getUTCDate() + index); const key = date.toISOString().slice(0,10); return { date:key, count:byDate.get(key)?.count || 0, reserved_cents:byDate.get(key)?.reserved_cents || 0 }; });
    return json(res, 200, { company: { id: user.company_id, name: user.company_name, slug: user.company_slug }, today: { ...summary, courts_active: courts }, week });
  }
  if (pathname === '/api/arena/settings' && method === 'GET') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const company = db.prepare('SELECT * FROM companies WHERE id=?').get(user.company_id);
    return json(res, 200, { company: { id: company.id, name: company.name, slug: company.slug }, weeklyHours: companyHours(user.company_id), profile: publicProfile(company) });
  }
  if (pathname === '/api/arena/profile' && method === 'PUT') {
    const user = requireUser(req, 'arena_admin'); const body = await readBody(req), profile = body.profile || {};
    const description = String(profile.description || '').trim(), address = String(profile.address || '').trim(), city = String(profile.city || '').trim(), state = String(profile.state || '').trim();
    if (description.length > 600 || address.length > 180 || city.length > 100 || state.length > 2) throw new HttpError(400, 'Confira os limites dos campos do perfil.');
    const amenities = Array.isArray(profile.amenities) ? profile.amenities.map(value => String(value).trim()).filter(Boolean).slice(0, 20) : [];
    if (amenities.some(value => value.length > 60)) throw new HttpError(400, 'Cada comodidade pode ter até 60 caracteres.');
    const photos = Array.isArray(profile.photos) ? profile.photos.map(value => String(value).trim()).filter(Boolean).slice(0, 6) : [];
    if (photos.some(value => value.length > 1000 || !/^https:\/\//i.test(value))) throw new HttpError(400, 'Use links de fotos HTTPS.');
    const allowedOptions = ['description', 'address', 'amenities', 'photos', 'hours', 'prices'];
    const options = Object.fromEntries(allowedOptions.map(key => [key, profile.options?.[key] !== false]));
    db.prepare('UPDATE companies SET description=?,address=?,city=?,state=?,amenities=?,photos=?,public_options=? WHERE id=?').run(description, address, city, state.toUpperCase(), JSON.stringify(amenities), JSON.stringify(photos), JSON.stringify(options), user.company_id);
    return json(res, 200, { profile: publicProfile(db.prepare('SELECT * FROM companies WHERE id=?').get(user.company_id)) });
  }
  if (pathname === '/api/arena/settings' && method === 'PUT') {
    const user = requireUser(req, 'arena_admin'); const body = await readBody(req);
    if (!Array.isArray(body.weeklyHours) || body.weeklyHours.length !== 7) throw new HttpError(400, 'Configure os sete dias da semana.');
    const seen = new Set();
    const hours = body.weeklyHours.map(item => {
      if (!item || typeof item !== 'object') throw new HttpError(400, 'Confira os horários enviados.');
      const weekday = Number(item.weekday), isOpen = item.isOpen ? 1 : 0, openTime = String(item.openTime || ''), closeTime = String(item.closeTime || '');
      if (typeof item.isOpen !== 'boolean' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday)) throw new HttpError(400, 'Dia da semana inválido.');
      if (!/^([01]\d|2[0-3]):(00|30)$/.test(openTime) || !/^([01]\d|2[0-3]):(00|30)$/.test(closeTime) || (isOpen && closeTime <= openTime)) throw new HttpError(400, 'Use horários em intervalos de 30 minutos e fechamento depois da abertura.');
      seen.add(weekday); return { weekday, isOpen, openTime, closeTime };
    });
    db.exec('BEGIN IMMEDIATE');
    try {
      const save = db.prepare('INSERT INTO company_hours (company_id,weekday,is_open,open_time,close_time) VALUES (?,?,?,?,?) ON CONFLICT(company_id,weekday) DO UPDATE SET is_open=excluded.is_open,open_time=excluded.open_time,close_time=excluded.close_time');
      for (const day of hours) save.run(user.company_id, day.weekday, day.isOpen, day.openTime, day.closeTime);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return json(res, 200, { weeklyHours: companyHours(user.company_id) });
  }
  if (pathname === '/api/courts' && method === 'GET') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    return json(res, 200, { courts: db.prepare('SELECT id,name,sport,price_cents,active FROM courts WHERE company_id=? ORDER BY name').all(user.company_id) });
  }
  if (pathname === '/api/courts' && method === 'POST') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const body = await readBody(req); const name = validatePublicName(body.name, 'o nome da quadra'); const sport = validatePublicName(body.sport, 'a modalidade');
    const priceCents = Math.round(Number(body.priceCents)); if (!Number.isFinite(priceCents) || priceCents < 0 || priceCents > 100000000) throw new HttpError(400, 'Confira o valor por hora em centavos.');
    const id = randomUUID();
    try { db.prepare('INSERT INTO courts (id,company_id,name,sport,price_cents,created_at) VALUES (?,?,?,?,?,?)').run(id, user.company_id, name, sport, priceCents, new Date().toISOString()); }
    catch (error) { if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Já existe uma quadra com esse nome.'); throw error; }
    return json(res, 201, { court: { id, name, sport, price_cents: priceCents, active: 1 } });
  }
  if (pathname === '/api/clients' && method === 'GET') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const clients = db.prepare(`SELECT cl.id,cl.name,cl.phone,cl.created_at,COUNT(b.id) AS bookings_count,MAX(b.start_at) AS last_booking_at
      FROM clients cl LEFT JOIN bookings b ON b.client_id=cl.id AND b.status!='cancelled'
      WHERE cl.company_id=? GROUP BY cl.id ORDER BY cl.name COLLATE NOCASE`).all(user.company_id);
    return json(res, 200, { clients });
  }
  if (pathname === '/api/clients' && method === 'POST') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const body = await readBody(req); const name = validatePublicName(body.name, 'o nome do cliente');
    const phone = body.phone ? String(body.phone).replace(/\D/g, '') : null;
    if (phone && (phone.length < 10 || phone.length > 15)) throw new HttpError(400, 'Informe um telefone com DDD.');
    if (phone && db.prepare('SELECT id FROM clients WHERE company_id=? AND phone=?').get(user.company_id, phone)) throw new HttpError(409, 'Esse telefone já está cadastrado para outro cliente.');
    const id = randomUUID();
    db.prepare('INSERT INTO clients (id,company_id,name,phone,created_at) VALUES (?,?,?,?,?)').run(id, user.company_id, name, phone, new Date().toISOString());
    return json(res, 201, { client: { id, name, phone, bookings_count: 0, last_booking_at: null } });
  }
  const bookingStatusMatch = pathname.match(/^\/api\/bookings\/([a-f0-9-]+)\/status$/i);
  if (bookingStatusMatch && method === 'PATCH') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const body = await readBody(req);
    if (!['confirmed', 'cancelled', 'completed'].includes(body.status)) throw new HttpError(400, 'Status de reserva inválido.');
    const cancelReason = body.status === 'cancelled' ? String(body.reason || '').trim().slice(0, 200) : '';
    const result = db.prepare(`UPDATE bookings SET status=?,cancel_reason=?,updated_at=? WHERE id=? AND company_id=? AND status IN ('pending','confirmed')`)
      .run(body.status, cancelReason, new Date().toISOString(), bookingStatusMatch[1], user.company_id);
    if (!result.changes) throw new HttpError(404, 'Reserva não encontrada ou já encerrada.');
    db.prepare('INSERT INTO booking_events (id,company_id,booking_id,user_id,event,details,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), user.company_id, bookingStatusMatch[1], user.id, body.status, JSON.stringify({ reason: cancelReason }), new Date().toISOString());
    let reviewToken = null;
    if (body.status === 'completed') {
      reviewToken = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO review_links (id,company_id,booking_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), user.company_id, bookingStatusMatch[1], hashToken(reviewToken), new Date(Date.now() + 90 * 86400000).toISOString(), new Date().toISOString());
      const booking = db.prepare('SELECT b.customer_phone,c.slug,c.name FROM bookings b JOIN companies c ON c.id=b.company_id WHERE b.id=?').get(bookingStatusMatch[1]), waha = integration(user.company_id, 'waha');
      if (booking.customer_phone && waha.enabled && waha.session && wahaBaseUrl && wahaApiKey) {
        try { await sendWahaText(user.company_id, waha.session, booking.customer_phone.replace(/\D/g, ''), messageText(user.company_id, 'avaliacao', 'Como foi sua experiência na {arena_name}? Avalie aqui: {review_link}', { arena_name: booking.name, review_link: `${appBaseUrl || `https://${req.headers.host}`}/a/${booking.slug}?avaliar=${reviewToken}` })); }
        catch (error) { console.error('Falha ao enviar pedido de avaliação WAHA:', error.message); }
      }
    }
    audit(user.company_id, user.id, `booking.${body.status}`, 'booking', bookingStatusMatch[1], { reason: cancelReason });
    return json(res, 200, { ok: true, status: body.status, reviewToken });
  }
  const bookingEditMatch = pathname.match(/^\/api\/bookings\/([a-f0-9-]+)$/i);
  if (bookingEditMatch && method === 'PATCH') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const body = await readBody(req), booking = db.prepare("SELECT * FROM bookings WHERE id=? AND company_id=? AND status IN ('pending','confirmed')").get(bookingEditMatch[1], user.company_id);
    if (!booking) throw new HttpError(404, 'Reserva não encontrada ou já encerrada.');
    const customerName = validatePublicName(body.customerName, 'o nome do cliente'), phone = String(body.customerPhone || '').replace(/\D/g, '');
    if (phone && (phone.length < 10 || phone.length > 15)) throw new HttpError(400, 'Confira o telefone do cliente.');
    const courtId = String(body.courtId || ''), court = db.prepare('SELECT id,price_cents FROM courts WHERE id=? AND company_id=? AND active=1').get(courtId, user.company_id);
    if (!court) throw new HttpError(404, 'A quadra não está disponível.');
    if (!validateDateTime(body.startAt) || !validateDateTime(body.endAt) || body.startAt.slice(0, 10) !== body.endAt.slice(0, 10)) throw new HttpError(400, 'Confira a data e o horário.');
    const startMs = Date.parse(body.startAt), endMs = Date.parse(body.endAt), duration = (endMs - startMs) / 60000;
    if (startMs % 1800000 || duration < 60 || duration % 30) throw new HttpError(400, 'Use horários em blocos de 30 minutos e duração mínima de 1 hora.');
    const startAt = new Date(startMs).toISOString(), endAt = new Date(endMs).toISOString();
    assertWithinHours(user.company_id, startAt, endAt);
    const conflict = db.prepare("SELECT id FROM bookings WHERE company_id=? AND court_id=? AND id!=? AND status!='cancelled' AND start_at<? AND end_at>? LIMIT 1").get(user.company_id, courtId, booking.id, endAt, startAt);
    const block = db.prepare('SELECT id FROM blocked_slots WHERE company_id=? AND court_id=? AND start_at<? AND end_at>? LIMIT 1').get(user.company_id, courtId, endAt, startAt);
    if (conflict || block) throw new HttpError(409, 'O horário escolhido já está ocupado ou bloqueado.');
    const cents = Math.round(court.price_cents * duration / 60), normalizedPhone = phone || null;
    let client = normalizedPhone ? db.prepare('SELECT id FROM clients WHERE company_id=? AND phone=? ORDER BY created_at LIMIT 1').get(user.company_id, normalizedPhone)
      : db.prepare('SELECT id FROM clients WHERE company_id=? AND lower(name)=lower(?) AND phone IS NULL ORDER BY created_at LIMIT 1').get(user.company_id, customerName);
    if (!client) { const id = randomUUID(); db.prepare('INSERT INTO clients (id,company_id,name,phone,created_at) VALUES (?,?,?,?,?)').run(id, user.company_id, customerName, normalizedPhone, new Date().toISOString()); client = { id }; }
    db.prepare('UPDATE bookings SET client_id=?,court_id=?,customer_name=?,customer_phone=?,start_at=?,end_at=?,amount_cents=?,updated_at=? WHERE id=? AND company_id=?')
      .run(client.id, courtId, customerName, normalizedPhone, startAt, endAt, cents, new Date().toISOString(), booking.id, user.company_id);
    db.prepare('INSERT INTO booking_events (id,company_id,booking_id,user_id,event,details,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), user.company_id, booking.id, user.id, 'edited', JSON.stringify({ before: { court_id: booking.court_id, start_at: booking.start_at, end_at: booking.end_at }, after: { court_id: courtId, start_at: startAt, end_at: endAt } }), new Date().toISOString());
    audit(user.company_id, user.id, 'booking.edited', 'booking', booking.id);
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/bookings' && method === 'GET') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const day = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Data inválida.');
    const bookings = db.prepare(`SELECT b.id,b.customer_name,b.customer_phone,b.start_at,b.end_at,b.amount_cents,b.status,b.source,c.id AS court_id,c.name AS court_name,c.sport
      FROM bookings b JOIN courts c ON c.id=b.court_id WHERE b.company_id=? AND substr(b.start_at,1,10)=? ORDER BY b.start_at`).all(user.company_id, day);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const recurring = db.prepare(`SELECT m.id,m.start_time,m.duration_minutes,m.amount_cents,cl.name customer_name,cl.phone customer_phone,q.id court_id,q.name court_name,q.sport
      FROM monthly_members m JOIN clients cl ON cl.id=m.client_id JOIN courts q ON q.id=m.court_id WHERE m.company_id=? AND m.weekday=? AND m.status='active'`).all(user.company_id, weekday);
    for (const m of recurring) { const startAt = `${day}T${m.start_time}:00.000Z`, minutes = Number(m.start_time.slice(0,2))*60+Number(m.start_time.slice(3))+m.duration_minutes; bookings.push({ ...m, id: `monthly-${m.id}-${day}`, start_at: startAt, end_at: `${day}T${timeHH(minutes)}:00.000Z`, status: 'monthly', source: 'monthly' }); }
    const blocks = db.prepare(`SELECT b.id,b.reason,b.start_at,b.end_at,c.id AS court_id,c.name AS court_name,c.sport
      FROM blocked_slots b JOIN courts c ON c.id=b.court_id WHERE b.company_id=? AND substr(b.start_at,1,10)=? ORDER BY b.start_at`).all(user.company_id, day);
    return json(res, 200, { bookings, blocks });
  }
  if (pathname === '/api/bookings' && method === 'POST') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const body = await readBody(req); db.exec('BEGIN IMMEDIATE');
    try {
      const booking = reserve(user.company_id, String(body.courtId || ''), String(body.customerName || ''), body.customerPhone ? String(body.customerPhone).slice(0, 30) : null, body.startAt, body.endAt, 'staff');
      db.exec('COMMIT'); return json(res, 201, { booking });
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (pathname === '/api/blocks' && method === 'POST') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const body = await readBody(req); const courtId = String(body.courtId || '');
    const reason = validatePublicName(body.reason, 'o motivo do bloqueio');
    const court = db.prepare('SELECT id FROM courts WHERE id=? AND company_id=? AND active=1').get(courtId, user.company_id);
    if (!court) throw new HttpError(404, 'A quadra não está disponível.');
    if (!validateDateTime(body.startAt) || !validateDateTime(body.endAt) || Date.parse(body.endAt) <= Date.parse(body.startAt)) throw new HttpError(400, 'Confira a data e o horário do bloqueio.');
    const startMs = Date.parse(body.startAt), endMs = Date.parse(body.endAt), durationMinutes = (endMs-startMs)/60000;
    if (startMs % 1_800_000 !== 0 || endMs % 1_800_000 !== 0 || durationMinutes < 30) throw new HttpError(400, 'O bloqueio deve usar intervalos de pelo menos 30 minutos.');
    const startAt = new Date(startMs).toISOString(), endAt = new Date(endMs).toISOString();
    const id = randomUUID(); db.exec('BEGIN IMMEDIATE');
    try {
      assertWithinHours(user.company_id, startAt, endAt);
      assertNoConflict(user.company_id, courtId, startAt, endAt);
      db.prepare('INSERT INTO blocked_slots (id,company_id,court_id,reason,start_at,end_at,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, user.company_id, courtId, reason, startAt, endAt, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return json(res, 201, { block: { id, court_id: courtId, court_name: db.prepare('SELECT name FROM courts WHERE id=?').get(courtId).name, reason, start_at: startAt, end_at: endAt } });
  }
  const blockMatch = pathname.match(/^\/api\/blocks\/([a-f0-9-]+)$/i);
  if (blockMatch && method === 'DELETE') {
    const user = requireUser(req); if (user.role === 'platform_admin') throw new HttpError(403, 'Esta conta não pertence a uma arena.');
    const result = db.prepare('DELETE FROM blocked_slots WHERE id=? AND company_id=?').run(blockMatch[1], user.company_id);
    if (!result.changes) throw new HttpError(404, 'Bloqueio não encontrado.');
    return json(res, 200, { ok: true });
  }
  if (pathname.startsWith('/api/')) throw new HttpError(404, 'A página solicitada não existe.');
  return false;
}

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) { await api(req, res, url); return; }
    if (!['GET', 'HEAD'].includes(req.method || '')) throw new HttpError(405, 'Método não permitido.');
    const publicPage = url.pathname.match(/^\/a\/[a-z0-9-]+\/?$/i);
    const requested = decodeURIComponent(url.pathname);
    const relative = publicPage ? '/public.html' : ({ '/': '/index.html', '/index.html': '/index.html', '/platform.html': '/platform.html' }[requested] || '');
    if (!relative) throw new HttpError(404, 'Arquivo não encontrado.');
    const target = resolve(root, `.${relative}`);
    if (target !== root && !target.startsWith(root + sep)) throw new HttpError(403, 'Acesso negado.');
    if (!existsSync(target)) throw new HttpError(404, 'Arquivo não encontrado.');
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(target).pipe(res);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Ocorreu um erro interno.' : error.message }); else res.destroy();
  }
});
server.listen(port, '0.0.0.0', () => console.log(`QuadrasFlow disponível na porta ${port}`));
process.on('SIGINT', () => { server.close(() => { db.close(); process.exit(0); }); });
process.on('SIGTERM', () => { server.close(() => { db.close(); process.exit(0); }); });
