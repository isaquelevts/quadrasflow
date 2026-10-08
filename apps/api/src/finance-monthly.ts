import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, lte, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { appAudit, blockedSlots, bookings, clients, companyHours, courts, financeEntries, monthlyCharges, monthlyExceptions, monthlyMemberSlots, monthlyMembers } from '@quadrasflow/database';
import { findMonthlyConflict, monthlyBusyBetween, weekdayOf, type Occurrence } from './monthly-conflict.js';
import { isUniqueViolation } from './db-errors.js';
import { arenaNowTime, arenaToday } from './booking-policy.js';
import { dueDateOf, parsePlanSlots, validDueDay, type PlanSlot } from './monthly-plan.js';
import { bookingEnded, changeBookingStatus, syncBookingReceivable } from './booking-finance.js';
import { db } from './database.js';
import { adminOf, audit, companyOf, fail, text, userOf } from './arena.js';
const routes = (app: FastifyInstance) => ({ preHandler: app.authenticate });
const bodyOf = (request: { body?: unknown }) => (request.body || {}) as Record<string, unknown>;
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export async function registerFinanceMonthlyRoutes(app: FastifyInstance) {
  const auth = routes(app);
  app.get('/api/finance', auth, async (request) => {
    adminOf(request); // Financeiro é só do administrador; a Recepção não vê.
    const companyId = companyOf(request), q = request.query as { from?: string; to?: string }, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()), from = q.from || `${today.slice(0, 7)}-01`, to = q.to || today;
    if (!datePattern.test(from) || !datePattern.test(to) || from > to) throw fail(400, 'Confira o período do relatório.');
    const rows = await db.select({ entry: financeEntries, customerName: bookings.customerName, bookingStatus: bookings.status, startAt: bookings.startAt, endAt: bookings.endAt, courtName: courts.name })
      .from(financeEntries).leftJoin(bookings, eq(bookings.id, financeEntries.bookingId)).leftJoin(courts, eq(courts.id, bookings.courtId))
      .where(and(eq(financeEntries.companyId, companyId), gte(financeEntries.dueDate, from), lte(financeEntries.dueDate, to))).orderBy(sql`${financeEntries.dueDate} DESC`, sql`${financeEntries.createdAt} DESC`);
    const entries = rows.map((r) => r.entry), extra = new Map(rows.map((r) => [r.entry.id, r]));
    const summary = { income_paid: 0, expense_paid: 0, expense_due: 0, income_due: 0, result: 0 };
    for (const e of entries) { const key = `${e.kind}_${e.paidAt ? 'paid' : 'due'}` as keyof typeof summary; if (key in summary) summary[key] += e.amountCents; }
    summary.result = summary.income_paid - summary.expense_paid;
    const mapped = entries.map((e) => ({ id: e.id, kind: e.kind, category: e.category, description: e.description, amount_cents: e.amountCents, due_date: e.dueDate, paid_at: e.paidAt, booking_id: e.bookingId, monthly_charge_id: e.monthlyChargeId, tournament_entry_id: e.tournamentEntryId, created_at: e.createdAt, ...(e.bookingId ? (({ customerName, bookingStatus, startAt, endAt, courtName }) => ({ booking: { customer_name: customerName, status: bookingStatus, start_at: startAt, end_at: endAt, court_name: courtName, ended: endAt ? bookingEnded(endAt) : false } }))(extra.get(e.id)!) : {}) }));
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
  app.delete('/api/finance/:id', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request), { id } = request.params as { id: string };
    const entry = (await db.select().from(financeEntries).where(and(eq(financeEntries.id, id), eq(financeEntries.companyId, companyId))).limit(1))[0];
    if (!entry) throw fail(404, 'Lançamento não encontrado.');
    // Lançamentos automáticos (reserva, mensalidade, torneio) são a prova do pagamento; só os manuais podem ser excluídos.
    if (entry.bookingId || entry.monthlyChargeId || entry.tournamentEntryId) throw fail(409, 'Lançamentos automáticos de reservas, mensalidades e torneios não podem ser excluídos. Use "Desfazer" para reabrir.');
    await db.delete(financeEntries).where(and(eq(financeEntries.id, id), eq(financeEntries.companyId, companyId)));
    await audit(companyId, user.id, 'finance.deleted', 'finance_entry', id, { kind: entry.kind, amountCents: entry.amountCents, description: entry.description });
    return { ok: true };
  });
  app.patch('/api/finance/:id/paid', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request), { id } = request.params as { id: string }, b = bodyOf(request), paidAt = b.paid ? new Date().toISOString() : null;
    const result = await db.transaction(async (tx) => {
      const current = (await tx.select().from(financeEntries).where(and(eq(financeEntries.id, id), eq(financeEntries.companyId, companyId))).limit(1))[0];
      if (!current) return null;
      // Só um "a receber" em aberto por reserva: ao desfazer um pagamento, o saldo aberto é recalculado junto com ele.
      if (!paidAt && current.bookingId) await tx.delete(financeEntries).where(and(eq(financeEntries.bookingId, current.bookingId), sql`${financeEntries.paidAt} IS NULL`, sql`${financeEntries.id} <> ${id}`));
      const entry = (await tx.update(financeEntries).set({ paidAt }).where(eq(financeEntries.id, id)).returning())[0];
      if (!entry) return null;
      let completed = false;
      if (entry.bookingId) {
        // Recebido depois do horário do jogo: a reserva também é concluída (um clique só).
        const booking = (await tx.select().from(bookings).where(eq(bookings.id, entry.bookingId)).limit(1))[0];
        if (paidAt && booking?.status === 'confirmed' && bookingEnded(booking.endAt)) completed = Boolean(await changeBookingStatus(tx, { companyId, userId: user.id, bookingId: booking.id, status: 'completed', source: 'finance' }));
        else await syncBookingReceivable(tx, companyId, entry.bookingId);
      }
      return { completed };
    });
    if (!result) throw fail(404, 'Lançamento não encontrado.');
    await audit(companyId, user.id, b.paid ? 'finance.paid' : 'finance.reopened', 'finance_entry', id);
    return { ok: true, bookingCompleted: result.completed };
  });

  // Garante a cobrança do mês para os planos ativos (uma por plano, vencimento no dia escolhido no plano).
  async function ensureCharges(companyId: string, cycle: string) {
    const active = await db.select().from(monthlyMembers).where(and(eq(monthlyMembers.companyId, companyId), eq(monthlyMembers.status, 'active')));
    const now = new Date().toISOString();
    for (const member of active) await db.insert(monthlyCharges).values({ id: randomUUID(), companyId, memberId: member.id, cycle, amountCents: member.amountCents, dueDate: dueDateOf(cycle, member.dueDay), paidAt: null, createdAt: now }).onConflictDoNothing();
  }
  app.get('/api/monthly-members', auth, async (request) => {
    const companyId = companyOf(request), q = request.query as { cycle?: string }, cycle = q.cycle || (await arenaToday(companyId)).slice(0, 7);
    if (!monthPattern.test(cycle)) throw fail(400, 'Mês inválido.');
    await ensureCharges(companyId, cycle);
    const [members, slotRows] = await Promise.all([
      db.select({ member: monthlyMembers, clientName: clients.name, phone: clients.phone }).from(monthlyMembers).innerJoin(clients, eq(monthlyMembers.clientId, clients.id)).where(eq(monthlyMembers.companyId, companyId)).orderBy(asc(monthlyMembers.status), asc(clients.name)),
      db.select({ slot: monthlyMemberSlots, courtName: courts.name }).from(monthlyMemberSlots).innerJoin(courts, eq(monthlyMemberSlots.courtId, courts.id)).where(eq(monthlyMemberSlots.companyId, companyId)).orderBy(asc(monthlyMemberSlots.weekday), asc(monthlyMemberSlots.startTime)),
    ]);
    const exceptionRows = await db.select({ exception: monthlyExceptions, courtName: courts.name }).from(monthlyExceptions).leftJoin(courts, eq(monthlyExceptions.newCourtId, courts.id))
      .where(and(eq(monthlyExceptions.companyId, companyId), sql`(${monthlyExceptions.day} BETWEEN ${`${cycle}-01`} AND ${`${cycle}-31`} OR ${monthlyExceptions.newDay} BETWEEN ${`${cycle}-01`} AND ${`${cycle}-31`})`));
    const exceptionsOf = (memberId: string) => exceptionRows.filter((r) => r.exception.memberId === memberId).map(({ exception: e, courtName }) => ({ id: e.id, slot_id: e.slotId, day: e.day, kind: e.kind, new_day: e.newDay, new_start_time: e.newStartTime, new_duration_minutes: e.newDurationMinutes, new_court_id: e.newCourtId, new_court_name: courtName, note: e.note }));
    const slotsOf = (memberId: string) => slotRows.filter((r) => r.slot.memberId === memberId).map(({ slot: s, courtName }) => ({ id: s.id, court_id: s.courtId, court_name: courtName, weekday: s.weekday, start_time: s.startTime, duration_minutes: s.durationMinutes }));
    const courtsOf = (memberId: string) => [...new Set(slotsOf(memberId).map((s) => s.court_name))].join(', ');
    const chargeRows = await db.select({ charge: monthlyCharges, clientId: monthlyMembers.clientId, clientName: clients.name }).from(monthlyCharges).innerJoin(monthlyMembers, eq(monthlyCharges.memberId, monthlyMembers.id)).innerJoin(clients, eq(monthlyMembers.clientId, clients.id)).where(and(eq(monthlyCharges.companyId, companyId), eq(monthlyCharges.cycle, cycle))).orderBy(asc(monthlyCharges.dueDate), asc(clients.name));
    return {
      cycle,
      members: members.map(({ member: m, clientName, phone }) => ({ id: m.id, clientId: m.clientId, client_name: clientName, phone, status: m.status, amount_cents: m.amountCents, due_day: m.dueDay, auto_charge: m.autoCharge, created_at: m.createdAt, slots: slotsOf(m.id), exceptions: exceptionsOf(m.id) })),
      charges: chargeRows.map(({ charge: c, clientName, clientId }) => ({ id: c.id, memberId: c.memberId, client_id: clientId, client_name: clientName, court_name: courtsOf(c.memberId), cycle: c.cycle, amount_cents: c.amountCents, due_date: c.dueDate, paid_at: c.paidAt })),
    };
  });
  // Um horário do plano: funcionamento da arena, outro mensalista e agenda dos próximos 90 dias (mesma regra para cadastrar e editar).
  async function validateMonthlySlot(companyId: string, slot: PlanSlot, ignoreMemberId?: string) {
    const { courtId, weekday, startTime, durationMinutes } = slot;
    const court = (await db.select().from(courts).where(and(eq(courts.id, courtId), eq(courts.companyId, companyId), eq(courts.active, true))).limit(1))[0];
    if (!court) throw fail(404, 'Quadra não encontrada ou pausada.');
    const label = `${WEEKDAYS[weekday]} ${startTime} (${court.name})`;
    const startMin = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)), endMin = startMin + durationMinutes, hours = (await db.select().from(companyHours).where(and(eq(companyHours.companyId, companyId), eq(companyHours.weekday, weekday))).limit(1))[0];
    if (!hours?.isOpen || startTime < hours.openTime || endMin > Number(hours.closeTime.slice(0, 2)) * 60 + Number(hours.closeTime.slice(3))) throw fail(400, `O horário de ${label} fica fora do funcionamento da arena.`);
    const existing = await db.select({ memberId: monthlyMemberSlots.memberId, startTime: monthlyMemberSlots.startTime, durationMinutes: monthlyMemberSlots.durationMinutes }).from(monthlyMemberSlots).innerJoin(monthlyMembers, eq(monthlyMemberSlots.memberId, monthlyMembers.id))
      .where(and(eq(monthlyMemberSlots.companyId, companyId), eq(monthlyMemberSlots.courtId, courtId), eq(monthlyMemberSlots.weekday, weekday), eq(monthlyMembers.status, 'active')));
    if (existing.some((m) => { if (m.memberId === ignoreMemberId) return false; const start = Number(m.startTime.slice(0, 2)) * 60 + Number(m.startTime.slice(3)); return start < endMin && start + m.durationMinutes > startMin; })) throw fail(409, `Já existe outro mensalista em ${label}.`);
    const today = new Date(`${await arenaToday(companyId)}T12:00:00Z`), end = new Date(today); end.setUTCDate(end.getUTCDate() + 90); while (today.getUTCDay() !== weekday) today.setUTCDate(today.getUTCDate() + 1);
    const candidates: string[] = []; for (const cursor = new Date(today); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 7)) candidates.push(cursor.toISOString().slice(0, 10));
    for (const day of candidates) { const from = `${day}T${startTime}:00.000Z`, to = new Date(Date.parse(from) + durationMinutes * 60000).toISOString(); const [conflict, block] = await Promise.all([db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.companyId, companyId), eq(bookings.courtId, courtId), ne(bookings.status, 'cancelled'), sql`${bookings.startAt} < ${to}`, sql`${bookings.endAt} > ${from}`)).limit(1), db.select({ id: blockedSlots.id }).from(blockedSlots).where(and(eq(blockedSlots.companyId, companyId), eq(blockedSlots.courtId, courtId), sql`${blockedSlots.startAt} < ${to}`, sql`${blockedSlots.endAt} > ${from}`)).limit(1)]); if (conflict.length || block.length) throw fail(409, `O horário de ${label} conflita com a agenda em ${day.split('-').reverse().join('/')}.`); }
    const moved = candidates.length ? (await monthlyBusyBetween(db, companyId, candidates[0]!, candidates.at(-1)!, courtId)).find((m) => m.moved && m.memberId !== ignoreMemberId && candidates.includes(m.day) && m.start < endMin && m.end > startMin) : undefined;
    if (moved) throw fail(409, `O horário de ${label} conflita com a remarcação de ${moved.clientName} em ${moved.day.split('-').reverse().join('/')}.`);
  }
  // Plano completo (horários, valor, vencimento e cobrança automática), validado do mesmo jeito para cadastrar e editar.
  // `current`: horários atuais do plano (ao editar); os que continuam iguais não são conferidos de novo com a agenda.
  async function validatePlan(companyId: string, body: Record<string, unknown>, clientPhone: string | null, ignoreMemberId?: string, current: PlanSlot[] = []) {
    const parsed = parsePlanSlots(body);
    if ('error' in parsed) throw fail(400, parsed.error);
    const amountCents = Math.round(Number(body.amountCents)), dueDay = body.dueDay === undefined ? 5 : Number(body.dueDay), autoCharge = body.autoCharge === true;
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 100000000) throw fail(400, 'Confira o valor mensal.');
    if (!validDueDay(dueDay)) throw fail(400, 'Escolha um dia de vencimento entre 1 e 31.');
    if (autoCharge && !clientPhone) throw fail(400, 'Cadastre o WhatsApp do cliente para cobrar automaticamente.');
    for (const slot of parsed.slots) if (!current.some((c) => c.courtId === slot.courtId && c.weekday === slot.weekday && c.startTime === slot.startTime && c.durationMinutes === slot.durationMinutes)) await validateMonthlySlot(companyId, slot, ignoreMemberId);
    return { slots: parsed.slots, amountCents, dueDay, autoCharge };
  }
  const slotValues = (companyId: string, memberId: string, slots: PlanSlot[], createdAt: string) => slots.map((s) => ({ id: randomUUID(), companyId, memberId, ...s, createdAt }));
  app.post('/api/monthly-members', auth, async (request, reply) => {
    const user = adminOf(request), companyId = companyOf(request), b = bodyOf(request), clientId = String(b.clientId || '');
    const client = (await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1))[0];
    if (!client) throw fail(404, 'Cliente não encontrado.');
    const plan = await validatePlan(companyId, b, client.phone);
    const id = randomUUID(), createdAt = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.insert(monthlyMembers).values({ id, companyId, clientId, courtId: null, weekday: null, startTime: null, durationMinutes: null, amountCents: plan.amountCents, dueDay: plan.dueDay, autoCharge: plan.autoCharge, status: 'active', createdAt });
      await tx.insert(monthlyMemberSlots).values(slotValues(companyId, id, plan.slots, createdAt));
    });
    await audit(companyId, user.id, 'monthly_member.created', 'monthly_member', id, { slots: plan.slots.length, dueDay: plan.dueDay, autoCharge: plan.autoCharge });
    return reply.code(201).send({ id });
  });
  app.patch('/api/monthly-members/:id', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request), { id } = request.params as { id: string };
    const current = (await db.select({ member: monthlyMembers, phone: clients.phone }).from(monthlyMembers).innerJoin(clients, eq(monthlyMembers.clientId, clients.id)).where(and(eq(monthlyMembers.id, id), eq(monthlyMembers.companyId, companyId))).limit(1))[0];
    if (!current) throw fail(404, 'Mensalista não encontrado.');
    if (current.member.status === 'ended') throw fail(409, 'Um plano encerrado não pode ser editado.');
    const before = await db.select().from(monthlyMemberSlots).where(eq(monthlyMemberSlots.memberId, id)), plan = await validatePlan(companyId, bodyOf(request), current.phone, id, before);
    const cycle = (await arenaToday(companyId)).slice(0, 7), createdAt = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.update(monthlyMembers).set({ amountCents: plan.amountCents, dueDay: plan.dueDay, autoCharge: plan.autoCharge }).where(and(eq(monthlyMembers.id, id), eq(monthlyMembers.companyId, companyId)));
      // Horários que não mudaram continuam os mesmos (e mantêm as faltas e remarcações já marcadas); os removidos levam as suas junto.
      const same = (a: PlanSlot, b: PlanSlot) => a.courtId === b.courtId && a.weekday === b.weekday && a.startTime === b.startTime && a.durationMinutes === b.durationMinutes;
      const removed = before.filter((old) => !plan.slots.some((s) => same(s, old))), added = plan.slots.filter((s) => !before.some((old) => same(s, old)));
      for (const old of removed) await tx.delete(monthlyMemberSlots).where(eq(monthlyMemberSlots.id, old.id));
      if (added.length) await tx.insert(monthlyMemberSlots).values(slotValues(companyId, id, added, createdAt));
      // Novo dia de vencimento vale para as cobranças em aberto deste mês em diante (o valor delas não muda).
      if (plan.dueDay !== current.member.dueDay) for (const charge of await tx.select().from(monthlyCharges).where(and(eq(monthlyCharges.memberId, id), gte(monthlyCharges.cycle, cycle), sql`${monthlyCharges.paidAt} IS NULL`))) await tx.update(monthlyCharges).set({ dueDate: dueDateOf(charge.cycle, plan.dueDay) }).where(eq(monthlyCharges.id, charge.id));
    });
    await audit(companyId, user.id, 'monthly_member.updated', 'monthly_member', id, { before: { amountCents: current.member.amountCents, dueDay: current.member.dueDay, autoCharge: current.member.autoCharge, slots: before.map(({ courtId, weekday, startTime, durationMinutes }) => ({ courtId, weekday, startTime, durationMinutes })) } });
    return { ok: true };
  });
  // Falta ou remarcação de uma data só (a Recepção também pode marcar): as outras semanas do plano não mudam.
  const fmtDay = (day: string) => day.split('-').reverse().slice(0, 2).join('/');
  const hhmm = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  /** O horário (dia, quadra, início, duração) está livre na agenda, fora a própria ocorrência do mensalista? */
  async function assertFree(companyId: string, courtId: string, day: string, startTime: string, durationMinutes: number, ignore: Occurrence, what: string) {
    const from = `${day}T${startTime}:00.000Z`, to = `${day}T${hhmm(Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + durationMinutes)}:00.000Z`;
    const [booking] = await db.select({ name: bookings.customerName }).from(bookings).where(and(eq(bookings.companyId, companyId), eq(bookings.courtId, courtId), ne(bookings.status, 'cancelled'), sql`${bookings.startAt} < ${to}`, sql`${bookings.endAt} > ${from}`)).limit(1);
    if (booking) throw fail(409, `${what} já tem a reserva de ${booking.name}.`);
    const [block] = await db.select({ reason: blockedSlots.reason }).from(blockedSlots).where(and(eq(blockedSlots.companyId, companyId), eq(blockedSlots.courtId, courtId), sql`${blockedSlots.startAt} < ${to}`, sql`${blockedSlots.endAt} > ${from}`)).limit(1);
    if (block) throw fail(409, `${what} está bloqueado (${block.reason || 'bloqueio'}).`);
    const monthly = await findMonthlyConflict(db, companyId, courtId, from, to, ignore);
    if (monthly) throw fail(409, `${what} é do mensalista ${monthly.clientName} (${monthly.startTime}–${monthly.endTime}).`);
  }
  app.post('/api/monthly-members/:id/exceptions', auth, async (request, reply) => {
    const user = userOf(request), companyId = companyOf(request), { id } = request.params as { id: string }, b = bodyOf(request);
    const slotId = String(b.slotId || ''), day = String(b.day || ''), kind = String(b.kind || ''), note = String(b.note ?? '').trim().slice(0, 200);
    const row = (await db.select({ slot: monthlyMemberSlots, member: monthlyMembers }).from(monthlyMemberSlots).innerJoin(monthlyMembers, eq(monthlyMemberSlots.memberId, monthlyMembers.id)).where(and(eq(monthlyMemberSlots.id, slotId), eq(monthlyMemberSlots.memberId, id), eq(monthlyMemberSlots.companyId, companyId))).limit(1))[0];
    if (!row) throw fail(404, 'Horário do mensalista não encontrado.');
    if (row.member.status !== 'active') throw fail(409, 'O plano não está ativo.');
    const today = await arenaToday(companyId), limit = new Date(`${today}T12:00:00Z`); limit.setUTCDate(limit.getUTCDate() + 120);
    if (!datePattern.test(day) || weekdayOf(day) !== row.slot.weekday) throw fail(400, 'Escolha uma data em que o mensalista joga.');
    if (day < today || day > limit.toISOString().slice(0, 10)) throw fail(400, 'Escolha uma data de hoje em diante (até 120 dias).');
    if (!['skip', 'move'].includes(kind)) throw fail(400, 'Escolha se o mensalista não vem ou se vai remarcar.');
    const prior = (await db.select({ id: monthlyExceptions.id }).from(monthlyExceptions).where(and(eq(monthlyExceptions.slotId, slotId), eq(monthlyExceptions.day, day))).limit(1))[0];
    if (prior) throw fail(409, 'Esse dia já foi alterado. Desfaça a alteração antes de marcar outra.');
    let move: { newCourtId: string; newDay: string; newStartTime: string; newDurationMinutes: number } | null = null;
    if (kind === 'move') {
      const newCourtId = String(b.courtId || row.slot.courtId), newDay = String(b.newDay || ''), newStartTime = String(b.startTime || ''), newDurationMinutes = b.durationMinutes === undefined ? row.slot.durationMinutes : Number(b.durationMinutes);
      const court = (await db.select().from(courts).where(and(eq(courts.id, newCourtId), eq(courts.companyId, companyId), eq(courts.active, true))).limit(1))[0];
      if (!court) throw fail(404, 'Quadra não encontrada ou pausada.');
      const last = new Date(`${today}T12:00:00Z`); last.setUTCDate(last.getUTCDate() + 90);
      if (!datePattern.test(newDay) || Number.isNaN(Date.parse(`${newDay}T12:00:00Z`)) || newDay < today || newDay > last.toISOString().slice(0, 10)) throw fail(400, 'Escolha a nova data entre hoje e os próximos 90 dias.');
      if (!/^([01]\d|2[0-3]):(00|30)$/.test(newStartTime) || !Number.isInteger(newDurationMinutes) || newDurationMinutes < 60 || newDurationMinutes > 480 || newDurationMinutes % 30) throw fail(400, 'Confira o novo horário e a duração.');
      const startMin = Number(newStartTime.slice(0, 2)) * 60 + Number(newStartTime.slice(3)), endMin = startMin + newDurationMinutes, hours = (await db.select().from(companyHours).where(and(eq(companyHours.companyId, companyId), eq(companyHours.weekday, weekdayOf(newDay)))).limit(1))[0];
      if (!hours?.isOpen || newStartTime < hours.openTime || endMin > Number(hours.closeTime.slice(0, 2)) * 60 + Number(hours.closeTime.slice(3))) throw fail(400, 'O novo horário fica fora do funcionamento da arena.');
      if (newDay === today && newStartTime <= (await arenaNowTime(companyId))) throw fail(400, 'Esse horário de hoje já passou.');
      await assertFree(companyId, newCourtId, newDay, newStartTime, newDurationMinutes, { slotId, day }, `O horário de ${fmtDay(newDay)} às ${newStartTime} na ${court.name}`);
      move = { newCourtId, newDay, newStartTime, newDurationMinutes };
    }
    const exceptionId = randomUUID();
    try { await db.insert(monthlyExceptions).values({ id: exceptionId, companyId, memberId: id, slotId, day, kind, newCourtId: move?.newCourtId ?? null, newDay: move?.newDay ?? null, newStartTime: move?.newStartTime ?? null, newDurationMinutes: move?.newDurationMinutes ?? null, note, createdBy: user.id, createdAt: new Date().toISOString() }); }
    catch (cause) { if (isUniqueViolation(cause)) throw fail(409, 'Esse dia já foi alterado. Desfaça a alteração antes de marcar outra.'); throw cause; }
    await audit(companyId, user.id, kind === 'skip' ? 'monthly_member.skipped_day' : 'monthly_member.moved_day', 'monthly_member', id, { slotId, day, ...(move || {}) });
    return reply.code(201).send({ id: exceptionId });
  });
  app.delete('/api/monthly-members/:id/exceptions/:exceptionId', auth, async (request) => {
    const user = userOf(request), companyId = companyOf(request), { id, exceptionId } = request.params as { id: string; exceptionId: string };
    const row = (await db.select({ exception: monthlyExceptions, slot: monthlyMemberSlots, courtName: courts.name }).from(monthlyExceptions).innerJoin(monthlyMemberSlots, eq(monthlyExceptions.slotId, monthlyMemberSlots.id)).innerJoin(courts, eq(monthlyMemberSlots.courtId, courts.id)).where(and(eq(monthlyExceptions.id, exceptionId), eq(monthlyExceptions.memberId, id), eq(monthlyExceptions.companyId, companyId))).limit(1))[0];
    if (!row) throw fail(404, 'Alteração não encontrada.');
    if (row.exception.day < await arenaToday(companyId)) throw fail(409, 'Esse dia já passou; a alteração fica no histórico.');
    // Volta ao horário fixo só se ele continua livre (alguém pode ter reservado depois da falta).
    await assertFree(companyId, row.slot.courtId, row.exception.day, row.slot.startTime, row.slot.durationMinutes, { slotId: row.slot.id, day: row.exception.day }, `O horário fixo de ${fmtDay(row.exception.day)} às ${row.slot.startTime} na ${row.courtName}`);
    await db.delete(monthlyExceptions).where(eq(monthlyExceptions.id, exceptionId));
    await audit(companyId, user.id, 'monthly_member.day_restored', 'monthly_member', id, { slotId: row.slot.id, day: row.exception.day, kind: row.exception.kind });
    return { ok: true };
  });
  app.patch('/api/monthly-members/:id/status', auth, async (request) => { const user = adminOf(request), companyId = companyOf(request), { id } = request.params as { id: string }, status = String(bodyOf(request).status || ''); if (!['active', 'paused', 'ended'].includes(status)) throw fail(400, 'Estado do mensalista inválido.'); const result = await db.update(monthlyMembers).set({ status }).where(and(eq(monthlyMembers.id, id), eq(monthlyMembers.companyId, companyId))).returning({ id: monthlyMembers.id }); if (!result.length) throw fail(404, 'Mensalista não encontrado.'); await audit(companyId, user.id, `monthly_member.${status}`, 'monthly_member', id); return { ok: true }; });
  app.patch('/api/monthly-charges/:id/paid', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request), { id } = request.params as { id: string }, charge = (await db.select().from(monthlyCharges).where(and(eq(monthlyCharges.id, id), eq(monthlyCharges.companyId, companyId))).limit(1))[0]; if (!charge) throw fail(404, 'Cobrança não encontrada.');
    if (!charge.paidAt) { const paidAt = new Date().toISOString(); await db.transaction(async (tx) => { await tx.update(monthlyCharges).set({ paidAt }).where(eq(monthlyCharges.id, id)); const prior = await tx.select({ id: financeEntries.id }).from(financeEntries).where(eq(financeEntries.monthlyChargeId, id)).limit(1); if (!prior.length) await tx.insert(financeEntries).values({ id: randomUUID(), companyId, bookingId: null, monthlyChargeId: id, tournamentEntryId: null, kind: 'income', category: 'Mensalistas', description: `Mensalidade ${charge.cycle}`, amountCents: charge.amountCents, dueDate: charge.dueDate, paidAt, createdAt: paidAt }); }); await audit(companyId, user.id, 'monthly_charge.paid', 'monthly_charge', id); }
    return { ok: true };
  });
}
