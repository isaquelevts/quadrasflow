import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { companies, userInvites, users } from '@quadrasflow/database';
import { createSession } from './auth.js';
import { db } from './database.js';
import { isUniqueViolation } from './db-errors.js';
import { adminOf, audit, companyOf, fail, text } from './arena.js';
import { mailConfigured, sendInviteEmail } from './mailer.js';
import { ROLES } from './users.js';

const INVITE_DAYS = 7;
const ROLE_LABEL: Record<string, string> = { arena_admin: 'Administrador', staff: 'Recepção' };
const bodyOf = (request: FastifyRequest) => (request.body || {}) as Record<string, unknown>;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const normalizeEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();
const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;

function baseUrl(request: FastifyRequest) {
  const configured = process.env.APP_BASE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const origin = request.headers.origin;
  return typeof origin === 'string' && /^https?:\/\//.test(origin) ? origin : `http://${request.headers.host}`;
}

function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86400000).toISOString() };
}

type InviteRow = typeof userInvites.$inferSelect;
const toInvite = (row: InviteRow) => ({ id: row.id, name: row.name, email: row.email, role: row.role, expires_at: row.expiresAt, created_at: row.createdAt, expired: row.expiresAt <= new Date().toISOString() });

/** Tenta o e-mail sem derrubar o convite: se o SMTP falhar, o link continua disponível na tela. */
async function deliver(request: FastifyRequest, row: InviteRow, link: string) {
  if (!mailConfigured()) return false;
  const company = (await db.select({ name: companies.name }).from(companies).where(eq(companies.id, row.companyId)).limit(1))[0];
  try {
    return await sendInviteEmail({ to: row.email, name: row.name, arenaName: company?.name || 'sua arena', roleLabel: ROLE_LABEL[row.role] || row.role, link, expiresAt: row.expiresAt });
  } catch (cause) {
    request.log.warn({ err: cause, inviteId: row.id }, 'invite email failed');
    return false;
  }
}

/** Convite válido pelo token do link, ou erro com o motivo. */
async function inviteByToken(token: string) {
  const row = (await db.select({ invite: userInvites, companyName: companies.name, companyStatus: companies.status }).from(userInvites)
    .innerJoin(companies, eq(userInvites.companyId, companies.id)).where(eq(userInvites.tokenHash, hashToken(token))).limit(1))[0];
  if (!row || row.invite.revokedAt) throw fail(404, 'Este convite não é válido. Peça um novo convite ao administrador da arena.');
  if (row.invite.acceptedAt) throw fail(410, 'Este convite já foi usado. Entre com seu e-mail e senha.');
  if (row.invite.expiresAt <= new Date().toISOString()) throw fail(410, 'Este convite venceu. Peça ao administrador para reenviar.');
  if (row.companyStatus !== 'active') throw fail(403, 'Esta arena está com o acesso suspenso.');
  return row;
}

export async function registerInviteRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.get('/api/arena/invites', auth, async (request) => {
    adminOf(request);
    const rows = await db.select().from(userInvites)
      .where(and(eq(userInvites.companyId, companyOf(request)), isNull(userInvites.acceptedAt), isNull(userInvites.revokedAt))).orderBy(desc(userInvites.createdAt));
    return { invites: rows.map(toInvite), emailConfigured: mailConfigured() };
  });

  app.post('/api/arena/invites', auth, async (request, reply) => {
    const actor = adminOf(request), companyId = companyOf(request), body = bodyOf(request);
    const name = text(body.name, 'o nome da pessoa'), email = normalizeEmail(body.email), role = String(body.role || 'staff');
    if (!validEmail(email)) throw fail(400, 'Informe um e-mail válido.');
    if (!(ROLES as readonly string[]).includes(role)) throw fail(400, 'Papel inválido.');
    const existingUser = (await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1))[0];
    if (existingUser) throw fail(409, 'Esse e-mail já tem acesso ao QuadrasFlow.');
    const pending = (await db.select({ id: userInvites.id }).from(userInvites).where(and(eq(userInvites.companyId, companyId), sql`lower(${userInvites.email}) = ${email}`, isNull(userInvites.acceptedAt), isNull(userInvites.revokedAt), sql`${userInvites.expiresAt} > ${new Date().toISOString()}`)).limit(1))[0];
    if (pending) throw fail(409, 'Já existe um convite pendente para esse e-mail. Use "Reenviar".');
    const { token, tokenHash, expiresAt } = newToken();
    const row: InviteRow = { id: randomUUID(), companyId, name, email, role, tokenHash, expiresAt, acceptedAt: null, revokedAt: null, createdBy: actor.id, createdAt: new Date().toISOString() };
    await db.insert(userInvites).values(row);
    await audit(companyId, actor.id, 'invite.created', 'user_invite', row.id, { email, role });
    const link = `${baseUrl(request)}/convite/${token}`;
    const emailSent = await deliver(request, row, link);
    return reply.code(201).send({ invite: toInvite(row), link, emailSent, emailConfigured: mailConfigured() });
  });

  app.post('/api/arena/invites/:id/resend', auth, async (request) => {
    const actor = adminOf(request), companyId = companyOf(request), { id } = request.params as { id: string };
    const current = (await db.select().from(userInvites).where(and(eq(userInvites.id, id), eq(userInvites.companyId, companyId), isNull(userInvites.acceptedAt), isNull(userInvites.revokedAt))).limit(1))[0];
    if (!current) throw fail(404, 'Convite não encontrado.');
    // Reenviar gera um link novo; o anterior deixa de funcionar.
    const { token, tokenHash, expiresAt } = newToken();
    const rows = await db.update(userInvites).set({ tokenHash, expiresAt }).where(eq(userInvites.id, id)).returning();
    await audit(companyId, actor.id, 'invite.resent', 'user_invite', id);
    const link = `${baseUrl(request)}/convite/${token}`;
    const emailSent = await deliver(request, rows[0]!, link);
    return { invite: toInvite(rows[0]!), link, emailSent, emailConfigured: mailConfigured() };
  });

  app.delete('/api/arena/invites/:id', auth, async (request) => {
    const actor = adminOf(request), companyId = companyOf(request), { id } = request.params as { id: string };
    const rows = await db.update(userInvites).set({ revokedAt: new Date().toISOString() })
      .where(and(eq(userInvites.id, id), eq(userInvites.companyId, companyId), isNull(userInvites.acceptedAt), isNull(userInvites.revokedAt))).returning({ id: userInvites.id });
    if (!rows.length) throw fail(404, 'Convite não encontrado.');
    await audit(companyId, actor.id, 'invite.revoked', 'user_invite', id);
    return { ok: true };
  });

  app.get('/api/public/invites/:token', { config: { rateLimit: { max: 30, timeWindow: 15 * 60 * 1000 } } }, async (request) => {
    const { token } = request.params as { token: string };
    const row = await inviteByToken(token);
    return { invite: { name: row.invite.name, email: row.invite.email, role: row.invite.role, role_label: ROLE_LABEL[row.invite.role] || row.invite.role, arena: row.companyName, expires_at: row.invite.expiresAt } };
  });

  app.post('/api/public/invites/:token/accept', { config: { rateLimit: { max: 10, timeWindow: 15 * 60 * 1000 } } }, async (request, reply) => {
    const { token } = request.params as { token: string }, body = bodyOf(request), password = String(body.password ?? '');
    if (password.length < 8 || password.length > 200) throw fail(400, 'A senha precisa ter pelo menos 8 caracteres.');
    const checked = await inviteByToken(token);
    const userId = randomUUID(), now = new Date().toISOString();
    try {
      await db.transaction(async (tx) => {
        // Trava o convite: dois cliques simultâneos não criam duas contas.
        const invite = (await tx.select().from(userInvites).where(eq(userInvites.id, checked.invite.id)).for('update'))[0];
        if (!invite || invite.acceptedAt || invite.revokedAt || invite.tokenHash !== hashToken(token) || invite.expiresAt <= now) throw fail(410, 'Este convite não pode mais ser usado.');
        const salt = randomBytes(16).toString('hex');
        await tx.insert(users).values({ id: userId, companyId: invite.companyId, name: invite.name, email: invite.email, passwordHash: scryptSync(password, salt, 64).toString('hex'), passwordSalt: salt, role: invite.role, active: true, createdAt: now, lastLoginAt: now });
        await tx.update(userInvites).set({ acceptedAt: now }).where(eq(userInvites.id, invite.id));
      });
    } catch (cause) {
      if (isUniqueViolation(cause)) throw fail(409, 'Esse e-mail já possui uma conta no QuadrasFlow. Entre com sua senha.');
      throw cause;
    }
    await audit(checked.invite.companyId, userId, 'invite.accepted', 'user_invite', checked.invite.id);
    await createSession(userId, reply);
    const company = (await db.select({ id: companies.id, name: companies.name, slug: companies.slug, onboardingCompleted: companies.onboardingCompleted }).from(companies).where(eq(companies.id, checked.invite.companyId)).limit(1))[0]!;
    return { user: { id: userId, name: checked.invite.name, email: checked.invite.email, role: checked.invite.role, setupNeeded: !company.onboardingCompleted, company: { id: company.id, name: company.name, slug: company.slug } } };
  });
}
