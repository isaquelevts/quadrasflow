import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, lte, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { appAudit, blockedSlots, bookings, clients, companyHours, courts, financeEntries, monthlyCharges, monthlyMembers } from '@quadrasflow/database';
import { db } from './database.js';
import { adminOf, audit, companyOf, fail, text, userOf } from './arena.js';
const routes = (app: FastifyInstance) => ({ preHandler: app.authenticate });
const bodyOf = (request: { body?: unknown }) => (request.body || {}) as Record<string, unknown>;
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function registerFinanceMonthlyRoutes(app: FastifyInstance) {
  const auth = routes(app);
  app.get('/api/finance', auth, async (request) => {
    const companyId = companyOf(request), q = request.query as { from?: string; to?: string }, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()), from = q.from || `${today.slice(0, 7)}-01`, to = q.to || today;
    if (!datePattern.test(from) || !datePattern.test(to) || from > to) throw fail(400, 'Confira o período do relatório.');
    const entries = await db.select().from(financeEntries).where(and(eq(financeEntries.companyId, companyId), gte(financeEntries.dueDate, from), lte(financeEntries.dueDate, to))).orderBy(sql`${financeEntries.dueDate} DESC`, sql`${financeEntries.createdAt} DESC`);
    const summary = { income_paid: 0, expense_paid: 0, expense_due: 0, income_due: 0, result: 0 };
    for (const e of entries) { const key = `${e.kind}_${e.paidAt ? 'paid' : 'due'}` as keyof typeof summary; if (key in summary) summary[key] += e.amountCents; }
    summary.result = summary.income_paid - summary.expense_paid;
    const mapped = entries.map((e) => ({ id: e.id, kind: e.kind, category: e.category, description: e.description, amount_cents: e.amountCents, due_date: e.dueDate, paid_at: e.paidAt, booking_id: e.bookingId, monthly_charge_id: e.monthlyChargeId, tournament_entry_id: e.tournamentEntryId, created_at: e.createdAt }));
    const categories = new Map<string, { kind: string; category: string; amount_cents: number; count: number }>();
    for (const e of entries.filter((x) => x.paidAt)) { const key = `${e.kind}\0${e.category}`, current = categories.get(key) || { kind: e.kind, category: e.category, amount_cents: 0, count: 0 }; current.amount_cents += e.amountCents; current.count++; categories.set(key, current); }
    return { entries: mapped, summary, categories: [...categories.values()] };
  });
  app.post('/api/finance', auth, async (request, reply) => {
    const user = adminOf(request), companyId = companyOf(request), b = bodyOf(request), kind = String(b.kind || ''), category = text(b.category, 'a categoria', 2, 60), description = text(b.description, 'a descrição', 2, 180), amountCents = Math.round(Number(b.amountCents)), dueDate = String(b.dueDate || ''), paidAt = b.paid ? new Date().toISOString() : null;
    if (!['income', 'expense'].includes(kind)) throw fail(400, 'Tipo de lançamento inválido.');
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 1000000000 || !datePattern.test(dueDate) || Number.isNaN(Date.parse(`${dueDate}T12:00:00Z`))) throw fail(400, 'Confira valor e vencimento.');
    const id = randomUUID(), createdAt = new Date().toISOString();
    await db.insert(financeEntries).values({ id, companyId, bookingId: null, monthlyChargeId: null, tournamentEntryId: null, kind, category, description, amountCents, dueDate, paidAt, createdAt });
    await audit(companyId, user.id, 'finance.created', 'finance_entry', id, { kind, amountCents });
    return reply.code(201).send({ id });
  });
  app.patch('/api/finance/:id/paid', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request), { id } = request.params as { id: string }, b = bodyOf(request), paidAt = b.paid ? new Date().toISOString() : null;
    const updated = await db.update(financeEntries).set({ paidAt }).where(and(eq(financeEntries.id, id), eq(financeEntries.companyId, companyId))).returning({ id: financeEntries.id });
    if (!updated.length) throw fail(404, 'Lançamento não encontrado.');
    await audit(companyId, user.id, b.paid ? 'finance.paid' : 'finance.reopened', 'finance_entry', id);
    return { ok: true };
  });

  app.get('/api/monthly-members', auth, async (request) => {
    const companyId = companyOf(request), q = request.query as { cycle?: string }, cycle = q.cycle || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
    if (!monthPattern.test(cycle)) throw fail(400, 'Mês inválido.');
    const members = await db.select({ member: monthlyMembers, clientName: clients.name, phone: clients.phone, courtName: courts.name }).from(monthlyMembers).innerJoin(clients, eq(monthlyMembers.clientId, clients.id)).innerJoin(courts, eq(monthlyMembers.courtId, courts.id)).where(eq(monthlyMembers.companyId, companyId)).orderBy(asc(monthlyMembers.status), asc(monthlyMembers.weekday), asc(monthlyMembers.startTime));
    const now = new Date().toISOString();
    for (const { member } of members.filter((r) => r.member.status === 'active')) await db.insert(monthlyCharges).values({ id: randomUUID(), companyId, memberId: member.id, cycle, amountCents: member.amountCents, dueDate: `${cycle}-05`, paidAt: null, createdAt: now }).onConflictDoNothing();
    const chargeRows = await db.select({ charge: monthlyCharges, clientId: monthlyMembers.clientId, courtId: monthlyMembers.courtId, clientName: clients.name, courtName: courts.name }).from(monthlyCharges).innerJoin(monthlyMembers, eq(monthlyCharges.memberId, monthlyMembers.id)).innerJoin(clients, eq(monthlyMembers.clientId, clients.id)).innerJoin(courts, eq(monthlyMembers.courtId, courts.id)).where(and(eq(monthlyCharges.companyId, companyId), eq(monthlyCharges.cycle, cycle))).orderBy(asc(clients.name));
    return { cycle, members: members.map(({ member: m, clientName, phone, courtName }) => ({ ...m, client_name: clientName, phone, court_name: courtName, weekday: m.weekday, start_time: m.startTime, duration_minutes: m.durationMinutes, amount_cents: m.amountCents, created_at: m.createdAt })), charges: chargeRows.map(({ charge: c, clientName, courtName, clientId, courtId }) => ({ ...c, client_id: clientId, court_id: courtId, client_name: clientName, court_name: courtName, amount_cents: c.amountCents, due_date: c.dueDate, paid_at: c.paidAt })) };
  });
  app.post('/api/monthly-members', auth, async (request, reply) => {
    const user = adminOf(request), companyId = companyOf(request), b = bodyOf(request), clientId = String(b.clientId || ''), courtId = String(b.courtId || ''), weekday = Number(b.weekday), startTime = String(b.startTime || ''), durationMinutes = Number(b.durationMinutes), amountCents = Math.round(Number(b.amountCents));
    const client = (await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1))[0], court = (await db.select().from(courts).where(and(eq(courts.id, courtId), eq(courts.companyId, companyId), eq(courts.active, true))).limit(1))[0];
    if (!client || !court) throw fail(404, 'Cliente ou quadra não encontrado.');
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^([01]\d|2[0-3]):(00|30)$/.test(startTime) || !Number.isInteger(durationMinutes) || durationMinutes < 60 || durationMinutes > 240 || durationMinutes % 30 || !Number.isInteger(amountCents) || amountCents <= 0) throw fail(400, 'Confira dia, horário, duração e valor do mensalista.');
    const startMin = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)), endMin = startMin + durationMinutes, hours = (await db.select().from(companyHours).where(and(eq(companyHours.companyId, companyId), eq(companyHours.weekday, weekday))).limit(1))[0];
    if (!hours?.isOpen || startTime < hours.openTime || endMin > Number(hours.closeTime.slice(0, 2)) * 60 + Number(hours.closeTime.slice(3))) throw fail(400, 'O horário recorrente fica fora do funcionamento da arena.');
    const existing = await db.select().from(monthlyMembers).where(and(eq(monthlyMembers.companyId, companyId), eq(monthlyMembers.courtId, courtId), eq(monthlyMembers.weekday, weekday), eq(monthlyMembers.status, 'active')));
    if (existing.some((m) => { const start = Number(m.startTime.slice(0, 2)) * 60 + Number(m.startTime.slice(3)); return start < endMin && start + m.durationMinutes > startMin; })) throw fail(409, 'Já existe mensalista nesse horário recorrente.');
    const today = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())}T12:00:00Z`), end = new Date(today); end.setUTCDate(end.getUTCDate() + 90); while (today.getUTCDay() !== weekday) today.setUTCDate(today.getUTCDate() + 1);
    const candidates: string[] = []; for (const cursor = new Date(today); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) candidates.push(cursor.toISOString().slice(0, 10));
    for (const day of candidates) { const from = `${day}T${startTime}:00.000Z`, to = new Date(Date.parse(from) + durationMinutes * 60000).toISOString(); const [conflict, block] = await Promise.all([db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.companyId, companyId), eq(bookings.courtId, courtId), ne(bookings.status, 'cancelled'), sql`${bookings.startAt} < ${to}`, sql`${bookings.endAt} > ${from}`)).limit(1), db.select({ id: blockedSlots.id }).from(blockedSlots).where(and(eq(blockedSlots.companyId, companyId), eq(blockedSlots.courtId, courtId), sql`${blockedSlots.startAt} < ${to}`, sql`${blockedSlots.endAt} > ${from}`)).limit(1)]); if (conflict.length || block.length) throw fail(409, `O horário recorrente conflita com a agenda em ${day}.`); }
    const id = randomUUID(), createdAt = new Date().toISOString(); await db.insert(monthlyMembers).values({ id, companyId, clientId, courtId, weekday, startTime, durationMinutes, amountCents, status: 'active', createdAt }); await audit(companyId, user.id, 'monthly_member.created', 'monthly_member', id); return reply.code(201).send({ id });
  });
  app.patch('/api/monthly-members/:id/status', auth, async (request) => { const user = adminOf(request), companyId = companyOf(request), { id } = request.params as { id: string }, status = String(bodyOf(request).status || ''); if (!['active', 'paused', 'ended'].includes(status)) throw fail(400, 'Estado do mensalista inválido.'); const result = await db.update(monthlyMembers).set({ status }).where(and(eq(monthlyMembers.id, id), eq(monthlyMembers.companyId, companyId))).returning({ id: monthlyMembers.id }); if (!result.length) throw fail(404, 'Mensalista não encontrado.'); await audit(companyId, user.id, `monthly_member.${status}`, 'monthly_member', id); return { ok: true }; });
  app.patch('/api/monthly-charges/:id/paid', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request), { id } = request.params as { id: string }, charge = (await db.select().from(monthlyCharges).where(and(eq(monthlyCharges.id, id), eq(monthlyCharges.companyId, companyId))).limit(1))[0]; if (!charge) throw fail(404, 'Cobrança não encontrada.');
    if (!charge.paidAt) { const paidAt = new Date().toISOString(); await db.transaction(async (tx) => { await tx.update(monthlyCharges).set({ paidAt }).where(eq(monthlyCharges.id, id)); const prior = await tx.select({ id: financeEntries.id }).from(financeEntries).where(eq(financeEntries.monthlyChargeId, id)).limit(1); if (!prior.length) await tx.insert(financeEntries).values({ id: randomUUID(), companyId, bookingId: null, monthlyChargeId: id, tournamentEntryId: null, kind: 'income', category: 'Mensalistas', description: `Mensalidade ${charge.cycle}`, amountCents: charge.amountCents, dueDate: charge.dueDate, paidAt, createdAt: paidAt }); }); await audit(companyId, user.id, 'monthly_charge.paid', 'monthly_charge', id); }
    return { ok: true };
  });
}
