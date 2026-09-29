import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { companies, sessions, users } from '@quadrasflow/database';
import { db } from './database.js';
import { isUniqueViolation } from './db-errors.js';
import { AccountLockout } from './security.js';

export type AuthUser = { id: string; name: string; email: string; role: string; setupNeeded: boolean; company: { id: string; name: string; slug: string } | null };
declare module 'fastify' {
  interface FastifyRequest { user: AuthUser | null }
  interface FastifyInstance { authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function safeText(value: unknown, label: string, max = 120) {
  const result = String(value ?? '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, max);
  if (!result) throw Object.assign(new Error(`Informe ${label}.`), { statusCode: 400 });
  return result;
}
function safeEmail(value: unknown) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!emailPattern.test(email) || email.length > 254) throw Object.assign(new Error('Informe um e-mail válido.'), { statusCode: 400 });
  return email;
}
function passwordCheck(password: string, salt: string, expected: string) {
  const candidate = scryptSync(password, salt, 64);
  const known = Buffer.from(expected, 'hex');
  return candidate.length === known.length && timingSafeEqual(candidate, known);
}
// Hash descartável: quando o e-mail não existe, a checagem gasta o mesmo tempo (não revela quais e-mails têm conta).
const DUMMY_SALT = randomBytes(16).toString('hex'), DUMMY_HASH = scryptSync(randomBytes(16).toString('hex'), DUMMY_SALT, 64).toString('hex');
const loginLockout = new AccountLockout(8, 15 * 60_000);
function parseToken(request: FastifyRequest) {
  const cookie = request.headers.cookie || '';
  const item = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('qf_session='));
  return item ? decodeURIComponent(item.slice('qf_session='.length)) : '';
}
export async function createSession(userId: string, reply: FastifyReply) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await db.insert(sessions).values({ tokenHash: hash(token), userId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString() });
  reply.header('set-cookie', `qf_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
async function readUser(request: FastifyRequest) {
  const token = parseToken(request);
  if (!token) return null;
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, companyId: users.companyId, active: users.active, status: companies.status, companyName: companies.name, slug: companies.slug, onboardingCompleted: companies.onboardingCompleted })
    .from(sessions).innerJoin(users, eq(sessions.userId, users.id)).leftJoin(companies, eq(users.companyId, companies.id))
    .where(and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, new Date().toISOString()))).limit(1);
  const user = rows[0];
  if (!user || !user.active || (user.companyId && user.status !== 'active')) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, setupNeeded: Boolean(user.companyId && !user.onboardingCompleted), company: user.companyId ? { id: user.companyId, name: user.companyName!, slug: user.slug! } : null };
}
function bodyOf(request: FastifyRequest) { return (request.body || {}) as Record<string, unknown>; }

export async function registerAuthRoutes(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.get('/api/auth/me', async (request) => ({ user: await readUser(request) }));
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: 15 * 60 * 1000 } } }, async (request, reply) => {
    const body = bodyOf(request), email = safeEmail(body.email), password = String(body.password ?? '');
    const rows = await db.select({ user: users, companyStatus: companies.status, companyName: companies.name, slug: companies.slug, onboardingCompleted: companies.onboardingCompleted })
      .from(users).leftJoin(companies, eq(users.companyId, companies.id)).where(eq(users.email, email)).limit(1);
    const row = rows[0];
    const wait = loginLockout.retryAfter(email);
    if (wait) return reply.code(429).header('retry-after', String(wait)).send({ error: { code: 'AUTH_LOCKED', message: `Muitas tentativas para este e-mail. Tente de novo em ${Math.ceil(wait / 60)} minuto(s).` } });
    const passwordOk = passwordCheck(password, row?.user.passwordSalt ?? DUMMY_SALT, row?.user.passwordHash ?? DUMMY_HASH);
    if (!row || !passwordOk || !row.user.active || (row.user.companyId && row.companyStatus !== 'active')) {
      loginLockout.fail(email);
      return reply.code(401).send({ error: { code: 'AUTH_INVALID', message: 'E-mail ou senha não conferem.' } });
    }
    loginLockout.succeed(email);
    await createSession(row.user.id, reply);
    await db.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, row.user.id));
    return { user: { id: row.user.id, name: row.user.name, email: row.user.email, role: row.user.role, setupNeeded: Boolean(row.user.companyId && !row.onboardingCompleted), company: row.user.companyId ? { id: row.user.companyId, name: row.companyName!, slug: row.slug! } : null } };
  });
  app.post('/api/auth/register', { config: { rateLimit: { max: 5, timeWindow: 60 * 60 * 1000 } } }, async (request, reply) => {
    const body = bodyOf(request), arenaName = safeText(body.arenaName, 'o nome da arena'), name = safeText(body.adminName, 'seu nome'), email = safeEmail(body.email), password = String(body.password ?? ''), phone = String(body.phone ?? '').replace(/\D/g, '');
    if (password.length < 8 || password.length > 200) throw Object.assign(new Error('A senha precisa ter pelo menos 8 caracteres.'), { statusCode: 400 });
    if (phone.length < 10 || phone.length > 15) throw Object.assign(new Error('Informe um telefone com DDD.'), { statusCode: 400 });
    const slug = String(body.slug || arenaName).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    if (!slug) throw Object.assign(new Error('Informe um identificador válido para sua arena.'), { statusCode: 400 });
    const salt = randomBytes(16).toString('hex'), passwordHash = scryptSync(password, salt, 64).toString('hex'), companyId = randomUUID(), userId = randomUUID(), createdAt = new Date().toISOString();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(companies).values({ id: companyId, name: arenaName, slug, phone, status: 'active', onboardingCompleted: false, createdAt });
        await tx.insert(users).values({ id: userId, companyId, name, email, passwordHash, passwordSalt: salt, role: 'arena_admin', active: true, createdAt });
      });
    } catch (cause) {
      if (isUniqueViolation(cause)) throw Object.assign(new Error('Esse e-mail ou identificador já está cadastrado.'), { statusCode: 409 });
      throw cause;
    }
    await createSession(userId, reply);
    return reply.code(201).send({ user: { id: userId, name, email, role: 'arena_admin', setupNeeded: true, company: { id: companyId, name: arenaName, slug } } });
  });
  // Troca de senha da própria conta: confere a senha atual e encerra as sessões em outros aparelhos.
  app.post('/api/auth/password', { config: { rateLimit: { max: 10, timeWindow: 15 * 60 * 1000 } } }, async (request, reply) => {
    const current = await readUser(request);
    if (!current) return reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'Entre na sua conta para continuar.' } });
    const body = bodyOf(request), currentPassword = String(body.currentPassword ?? ''), newPassword = String(body.newPassword ?? '');
    if (newPassword.length < 8 || newPassword.length > 200) throw Object.assign(new Error('A nova senha precisa ter pelo menos 8 caracteres.'), { statusCode: 400 });
    const row = (await db.select().from(users).where(eq(users.id, current.id)).limit(1))[0];
    if (!row || !passwordCheck(currentPassword, row.passwordSalt, row.passwordHash)) throw Object.assign(new Error('A senha atual não confere.'), { statusCode: 400 });
    if (passwordCheck(newPassword, row.passwordSalt, row.passwordHash)) throw Object.assign(new Error('A nova senha precisa ser diferente da atual.'), { statusCode: 400 });
    const salt = randomBytes(16).toString('hex');
    await db.update(users).set({ passwordHash: scryptSync(newPassword, salt, 64).toString('hex'), passwordSalt: salt }).where(eq(users.id, row.id));
    const token = parseToken(request);
    await db.delete(sessions).where(and(eq(sessions.userId, row.id), ne(sessions.tokenHash, hash(token))));
    return { ok: true };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const token = parseToken(request);
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hash(token)));
    reply.header('set-cookie', `qf_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return { ok: true };
  });
  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    const user = await readUser(request);
    if (!user) return reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'Entre na sua conta para continuar.' } });
    request.user = user;
  });
}
