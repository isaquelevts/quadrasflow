import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { appAudit, blockedSlots, bookingEvents, bookings, clients, companies, companyHours, companyPriceSlots, courts, integrationSettings, messageTemplates, monthlyMembers, reviewLinks } from '@quadrasflow/database';
import { db } from './database.js';
import { isUniqueViolation } from './db-errors.js';
import type { AuthUser } from './auth.js';
import { bookingAmountCents } from './pricing.js';

type AuthedRequest = FastifyRequest & { user: AuthUser | null };
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const brazilianUfs = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
const bodyOf = (request: FastifyRequest) => (request.body || {}) as Record<string, unknown>;
const userOf = (request: FastifyRequest) => { const user = (request as AuthedRequest).user; if (!user) throw fail(401, 'Entre na sua conta para continuar.'); return user; };
const companyOf = (request: FastifyRequest, allowSetup = false) => { const user = userOf(request); if (!user.company) throw fail(403, 'Esta conta não pertence a uma arena.'); if (user.setupNeeded && !allowSetup) throw fail(403, 'O administrador precisa concluir a configuração inicial da arena.'); return user.company.id; };
const adminOf = (request: FastifyRequest) => { const user = userOf(request); if (user.role !== 'arena_admin') throw fail(403, 'Somente o administrador da arena pode fazer isso.'); return user; };
function text(value: unknown, label: string, min = 2, max = 100) { const result = String(value ?? '').trim(); if (result.length < min || result.length > max) throw fail(400, `Confira ${label}.`); return result; }
function digits(value: unknown) { return String(value ?? '').replace(/\D/g, ''); }
function validBrazilianUf(value: unknown) { return brazilianUfs.has(String(value ?? '').trim().toUpperCase()); }
function validImageReference(value: string) { return /^https:\/\//i.test(value) || /^\/api\/arena\/media\/[a-f0-9]{32}\/[a-f0-9-]{36}\.webp$/.test(value); }
function validDay(value: unknown): string { const day = String(value ?? ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) throw fail(400, 'Data inválida.'); return day; }
function iso(value: unknown) { const date = new Date(String(value ?? '')); if (Number.isNaN(date.valueOf())) throw fail(400, 'Confira a data e o horário.'); return date.toISOString(); }
function spDay(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date); }
function toClient(row: typeof clients.$inferSelect) { return { id: row.id, name: row.name, phone: row.phone, created_at: row.createdAt }; }
function toCourt(row: typeof courts.$inferSelect) { return { id: row.id, name: row.name, sport: row.sport, price_cents: row.priceCents, photo_url: row.photoUrl, active: row.active ? 1 : 0 }; }
function toHour(row: typeof companyHours.$inferSelect) { return { weekday: row.weekday, is_open: row.isOpen ? 1 : 0, open_time: row.openTime, close_time: row.closeTime }; }
async function audit(companyId: string, userId: string, action: string, entity: string, entityId?: string, details: Record<string, unknown> = {}) { await db.insert(appAudit).values({ id: randomUUID(), companyId, userId, action, entity, entityId: entityId || null, details, createdAt: new Date().toISOString() }); }
async function getCompanyHours(companyId: string) { return db.select().from(companyHours).where(eq(companyHours.companyId, companyId)).orderBy(asc(companyHours.weekday)); }

export async function registerArenaRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };
  app.get('/api/arena/onboarding', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request, true);
    const [companyRows, courtRows, hourRows, priceRows] = await Promise.all([
      db.select().from(companies).where(eq(companies.id, companyId)).limit(1), db.select().from(courts).where(eq(courts.companyId, companyId)).orderBy(asc(courts.name)), getCompanyHours(companyId), db.select().from(companyPriceSlots).where(eq(companyPriceSlots.companyId, companyId)),
    ]);
    const c = companyRows[0]!;
    return { completed: c.onboardingCompleted, company: { name: c.name, phone: c.phone, zipCode: c.zipCode, address: c.address, addressNumber: c.addressNumber, district: c.district, city: c.city, state: c.state, description: c.description, logoUrl: c.logoUrl, photos: c.photos, amenities: c.amenities, cancellationHours: String(c.cancellationHours), cancellationFeePercent: String(c.cancellationFeePercent) }, courts: courtRows.map((x) => ({ name: x.name, sport: x.sport, sports: x.sports, surface: x.surface, covering: x.covering, players: x.players })), weeklyHours: hourRows.map((h) => ({ weekday: h.weekday, isOpen: h.isOpen, openTime: h.openTime, closeTime: h.closeTime })), prices: priceRows.map((p) => ({ weekday: p.weekday, band: p.band, price_cents: p.priceCents })) };
  });
  app.put('/api/arena/onboarding', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request, true), body = bodyOf(request), company = (body.company || {}) as Record<string, unknown>;
    const courtDrafts = Array.isArray(body.courts) ? body.courts as Array<Record<string, unknown>> : [];
    const hoursDraft = Array.isArray(body.weeklyHours) ? body.weeklyHours as Array<Record<string, unknown>> : [];
    const prices = Array.isArray(body.prices) ? body.prices as Array<Record<string, unknown>> : [];
    if (courtDrafts.length < 1 || courtDrafts.length > 15 || hoursDraft.length !== 7) throw fail(400, 'Complete os dados das quadras e dos sete dias de funcionamento.');
    const normalizedCourts = courtDrafts.map((c) => ({ name: text(c.name, 'o nome da quadra'), sport: text(c.sport || (Array.isArray(c.sports) ? c.sports[0] : ''), 'a modalidade'), sports: Array.isArray(c.sports) ? c.sports.map(String).slice(0, 20) : [String(c.sport)], surface: String(c.surface || '').slice(0, 60), covering: String(c.covering || '').slice(0, 40), players: Math.trunc(Number(c.players)) }));
    if (normalizedCourts.some((c) => c.players < 2 || c.players > 100) || new Set(normalizedCourts.map((c) => c.name.toLocaleLowerCase('pt-BR'))).size !== normalizedCourts.length) throw fail(400, 'Confira o nome e o número de jogadores de cada quadra.');
    const normalizedHours = hoursDraft.map((h) => { const weekday = Number(h.weekday), openTime = String(h.openTime || ''), closeTime = String(h.closeTime || ''), isOpen = h.isOpen === true; if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^([01]\d|2[0-3]):(00|30)$/.test(openTime) || !/^([01]\d|2[0-3]):(00|30)$/.test(closeTime) || (isOpen && closeTime <= openTime)) throw fail(400, 'Confira os horários de funcionamento.'); return { weekday, openTime, closeTime, isOpen }; });
    if (new Set(normalizedHours.map((h) => h.weekday)).size !== 7 || !normalizedHours.some((h) => h.isOpen)) throw fail(400, 'Selecione pelo menos um dia aberto para a arena.');
    const phone = digits(company.phone), zip = digits(company.zipCode), cancellationHours = Number(company.cancellationHours), cancellationFeePercent = Number(company.cancellationFeePercent);
    if (phone.length < 10 || phone.length > 15 || zip.length !== 8 || !validBrazilianUf(company.state) || !Number.isInteger(cancellationHours) || cancellationHours < 0 || cancellationHours > 48 || !Number.isInteger(cancellationFeePercent) || cancellationFeePercent < 0 || cancellationFeePercent > 20) throw fail(400, 'Confira o telefone, endereço, UF e as políticas da arena.');
    const photos = Array.isArray(company.photos) ? company.photos.map(String).filter(Boolean).slice(0, 6) : [];
    const logoUrl = String(company.logoUrl || '');
    if ((logoUrl && !validImageReference(logoUrl)) || photos.some((url) => !validImageReference(url))) throw fail(400, 'Selecione imagens enviadas ou use endereços HTTPS.');
    const bands = [{ band: 'morning', startTime: '08:00', endTime: '12:00' }, { band: 'afternoon', startTime: '12:00', endTime: '18:00' }, { band: 'evening', startTime: '18:00', endTime: '23:00' }];
    const priceRows = prices.flatMap((p) => bands.map(({ band, startTime, endTime }) => ({ weekday: Number(p.weekday), band, startTime, endTime, priceCents: Math.round(Number(p[band])) })));
    if (priceRows.length !== 21 || priceRows.some((p) => !Number.isInteger(p.weekday) || p.weekday < 0 || p.weekday > 6 || !Number.isInteger(p.priceCents) || p.priceCents < 2000 || p.priceCents > 100000000)) throw fail(400, 'Os preços devem ser de pelo menos R$ 20 por hora nos sete dias.');
    const createdAt = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.update(companies).set({ name: text(company.name, 'o nome da arena'), phone, zipCode: zip, address: text(company.address, 'o endereço', 3, 180), addressNumber: String(company.addressNumber || '').slice(0, 30), district: String(company.district || '').slice(0, 100), city: text(company.city, 'a cidade', 2, 100), state: String(company.state).toUpperCase(), description: String(company.description || '').slice(0, 600), logoUrl, photos, amenities: Array.isArray(company.amenities) ? company.amenities.map(String).slice(0, 20) : [], cancellationHours, cancellationFeePercent, onboardingCompleted: true }).where(eq(companies.id, companyId));
      await tx.delete(courts).where(eq(courts.companyId, companyId));
      if (normalizedCourts.length) await tx.insert(courts).values(normalizedCourts.map((c) => ({ id: randomUUID(), companyId, ...c, active: true, priceCents: priceRows.find((p) => p.weekday === 1 && p.band === 'morning')?.priceCents || 0, createdAt })));
      await tx.delete(companyHours).where(eq(companyHours.companyId, companyId));
      await tx.insert(companyHours).values(normalizedHours.map((h) => ({ companyId, ...h })));
      await tx.delete(companyPriceSlots).where(eq(companyPriceSlots.companyId, companyId));
      await tx.insert(companyPriceSlots).values(priceRows.map((p) => ({ companyId, weekday: p.weekday, band: p.band, startTime: p.startTime, endTime: p.endTime, priceCents: p.priceCents })));
    });
    await audit(companyId, user.id, 'arena.onboarding_completed', 'company', companyId);
    return { ok: true, completed: true };
  });

  app.get('/api/arena/settings', auth, async (request) => {
    const companyId = companyOf(request), [rows, hours, priceRows, courtRows] = await Promise.all([db.select().from(companies).where(eq(companies.id, companyId)).limit(1), getCompanyHours(companyId), db.select().from(companyPriceSlots).where(eq(companyPriceSlots.companyId, companyId)), db.select({ priceCents: courts.priceCents }).from(courts).where(and(eq(courts.companyId, companyId), eq(courts.active, true))).orderBy(asc(courts.name)).limit(1)]), c = rows[0]!, fallback = courtRows[0]?.priceCents ?? 0;
    const prices = Array.from({ length: 7 }, (_, weekday) => ({ weekday, morning: priceRows.find((p) => p.weekday === weekday && p.band === 'morning')?.priceCents ?? fallback, afternoon: priceRows.find((p) => p.weekday === weekday && p.band === 'afternoon')?.priceCents ?? fallback, evening: priceRows.find((p) => p.weekday === weekday && p.band === 'evening')?.priceCents ?? fallback }));
    return { company: { id: c.id, name: c.name, slug: c.slug }, weeklyHours: hours.map(toHour), prices, profile: { description: c.description, address: c.address, city: c.city, state: c.state, amenities: c.amenities, photos: c.photos, options: c.publicOptions } };
  });
  app.put('/api/arena/settings', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request), body = bodyOf(request), input = Array.isArray(body.weeklyHours) ? body.weeklyHours as Array<Record<string, unknown>> : [];
    if (input.length !== 7) throw fail(400, 'Configure os sete dias da semana.');
    const normalized = input.map((h) => ({ weekday: Number(h.weekday), isOpen: h.isOpen === true, openTime: String(h.openTime || ''), closeTime: String(h.closeTime || '') }));
    if (new Set(normalized.map((d) => d.weekday)).size !== 7 || normalized.some((d) => d.weekday < 0 || d.weekday > 6 || !/^([01]\d|2[0-3]):(00|30)$/.test(d.openTime) || !/^([01]\d|2[0-3]):(00|30)$/.test(d.closeTime) || (d.isOpen && d.closeTime <= d.openTime))) throw fail(400, 'Use intervalos de 30 minutos e confira abertura e fechamento.');
    await db.transaction(async (tx) => { for (const h of normalized) await tx.insert(companyHours).values({ companyId, ...h }).onConflictDoUpdate({ target: [companyHours.companyId, companyHours.weekday], set: { isOpen: h.isOpen, openTime: h.openTime, closeTime: h.closeTime } }); });
    await audit(companyId, user.id, 'arena.hours_updated', 'company', companyId);
    return { weeklyHours: (await getCompanyHours(companyId)).map(toHour) };
  });
  app.put('/api/arena/prices', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request), input = Array.isArray(bodyOf(request).prices) ? bodyOf(request).prices as Array<Record<string, unknown>> : [];
    const bands = [{ band: 'morning', startTime: '08:00', endTime: '12:00' }, { band: 'afternoon', startTime: '12:00', endTime: '18:00' }, { band: 'evening', startTime: '18:00', endTime: '23:00' }];
    if (input.length !== 7 || new Set(input.map((day) => Number(day.weekday))).size !== 7) throw fail(400, 'Informe os preços para os sete dias da semana.');
    const rows = input.flatMap((day) => bands.map(({ band, startTime, endTime }) => ({ weekday: Number(day.weekday), band, startTime, endTime, priceCents: Math.round(Number(day[band])) })));
    if (rows.some((row) => !Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6 || !Number.isInteger(row.priceCents) || row.priceCents < 2000 || row.priceCents > 100000000)) throw fail(400, 'Os preços devem ser de pelo menos R$ 20 por hora em cada faixa.');
    await db.transaction(async (tx) => {
      await tx.delete(companyPriceSlots).where(eq(companyPriceSlots.companyId, companyId));
      await tx.insert(companyPriceSlots).values(rows.map((row) => ({ companyId, ...row })));
    });
    await audit(companyId, user.id, 'arena.prices_updated', 'company', companyId);
    return { ok: true };
  });
  app.put('/api/arena/profile', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request), profile = (bodyOf(request).profile || {}) as Record<string, unknown>;
    const state = String(profile.state || '').trim().toUpperCase(), amenities = Array.isArray(profile.amenities) ? profile.amenities.map(String).filter(Boolean).slice(0, 20) : [], photos = Array.isArray(profile.photos) ? profile.photos.map(String).filter(Boolean).slice(0, 6) : [];
    if (String(profile.description || '').length > 600 || String(profile.address || '').length > 180 || String(profile.city || '').length > 100 || (state && !validBrazilianUf(state)) || amenities.some((x) => x.length > 60) || photos.some((x) => !validImageReference(x) || x.length > 1000)) throw fail(400, 'Confira os limites do perfil, a UF e as imagens selecionadas.');
    const opts = (profile.options || {}) as Record<string, unknown>, options = Object.fromEntries(['description', 'address', 'amenities', 'photos', 'hours', 'prices'].map((key) => [key, opts[key] !== false]));
    await db.update(companies).set({ description: String(profile.description || '').trim(), address: String(profile.address || '').trim(), city: String(profile.city || '').trim(), state, amenities, photos, publicOptions: sql`${companies.publicOptions} || ${JSON.stringify(options)}::jsonb` }).where(eq(companies.id, companyId));
    await audit(companyId, user.id, 'arena.profile_updated', 'company', companyId);
    return { profile: { description: String(profile.description || ''), address: String(profile.address || ''), city: String(profile.city || ''), state, amenities, photos, options } };
  });
  app.get('/api/courts', auth, async (request) => ({ courts: (await db.select().from(courts).where(eq(courts.companyId, companyOf(request))).orderBy(asc(courts.name))).map(toCourt) }));
  app.post('/api/courts', auth, async (request, reply) => {
    const user = adminOf(request), companyId = companyOf(request), body = bodyOf(request), name = text(body.name, 'o nome da quadra'), sport = text(body.sport, 'a modalidade'), priceCents = Math.round(Number(body.priceCents));
    if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100000000) throw fail(400, 'Confira o preço por hora.');
    const photoUrl = String(body.photoUrl || '');
    const photoFolder = createHash('sha256').update(companyId).digest('hex').slice(0, 32);
    if (photoUrl && !new RegExp(`^/api/arena/media/${photoFolder}/[a-f0-9-]{36}\\.webp$`).test(photoUrl)) throw fail(400, 'Envie uma foto da quadra pela galeria de imagens.');
    const row = { id: randomUUID(), companyId, name, sport, priceCents, photoUrl: photoUrl || null, photos: photoUrl ? [photoUrl] : [], surface: '', covering: '', players: 0, sports: [sport], active: true, createdAt: new Date().toISOString() };
    try { await db.insert(courts).values(row); } catch (cause) { if (isUniqueViolation(cause)) throw fail(409, 'Já existe uma quadra com esse nome.'); throw cause; }
    await audit(companyId, user.id, 'court.created', 'court', row.id);
    return reply.code(201).send({ court: toCourt(row) });
  });
  app.put<{ Params: { id: string } }>('/api/courts/:id', auth, async (request) => {
    const user = adminOf(request), companyId = companyOf(request), body = bodyOf(request), { id } = request.params;
    const current = (await db.select().from(courts).where(and(eq(courts.id, id), eq(courts.companyId, companyId))).limit(1))[0];
    if (!current) throw fail(404, 'Quadra não encontrada.');
    const name = text(body.name, 'o nome da quadra'), sport = text(body.sport, 'a modalidade'), priceCents = Math.round(Number(body.priceCents));
    if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100000000) throw fail(400, 'Confira o preço por hora.');
    const photoUrl = String(body.photoUrl || ''), photoFolder = createHash('sha256').update(companyId).digest('hex').slice(0, 32);
    if (photoUrl && !new RegExp(`^/api/arena/media/${photoFolder}/[a-f0-9-]{36}\\.webp$`).test(photoUrl)) throw fail(400, 'Envie uma foto da quadra pela galeria de imagens.');
    const sports = [sport, ...current.sports.filter((item) => item !== current.sport && item !== sport)];
    try {
      const rows = await db.update(courts).set({ name, sport, sports, priceCents, photoUrl: photoUrl || null, photos: photoUrl===current.photoUrl?current.photos:[...(photoUrl?[photoUrl]:[]),...current.photos.filter(url=>url!==current.photoUrl&&url!==photoUrl)].slice(0,6) }).where(and(eq(courts.id, id), eq(courts.companyId, companyId))).returning();
      if (!rows[0]) throw fail(404, 'Quadra não encontrada.');
      await audit(companyId, user.id, 'court.updated', 'court', id);
      return { court: toCourt(rows[0]) };
    } catch (cause) {
      if (isUniqueViolation(cause)) throw fail(409, 'Já existe uma quadra com esse nome.');
      throw cause;
    }
  });
  app.get('/api/clients', auth, async (request) => {
    const companyId = companyOf(request), [clientRows, bookingRows] = await Promise.all([db.select().from(clients).where(eq(clients.companyId, companyId)).orderBy(asc(clients.name)), db.select({ clientId: bookings.clientId, startAt: bookings.startAt }).from(bookings).where(and(eq(bookings.companyId, companyId), ne(bookings.status, 'cancelled')))]);
    return { clients: clientRows.map((c) => { const mine = bookingRows.filter((b) => b.clientId === c.id); return { ...toClient(c), bookings_count: mine.length, last_booking_at: mine.map((b) => b.startAt).sort().at(-1) || null }; }) };
  });
  app.post('/api/clients', auth, async (request, reply) => {
    const user = userOf(request), companyId = companyOf(request), body = bodyOf(request), name = text(body.name, 'o nome do cliente'), phone = digits(body.phone);
    if (phone && (phone.length < 10 || phone.length > 15)) throw fail(400, 'Informe um telefone com DDD.');
    const row = { id: randomUUID(), companyId, name, phone: phone || null, createdAt: new Date().toISOString() };
    try { await db.insert(clients).values(row); } catch (cause) { if (isUniqueViolation(cause)) throw fail(409, 'Esse cliente já está cadastrado.'); throw cause; }
    await audit(companyId, user.id, 'client.created', 'client', row.id);
    return reply.code(201).send({ client: { ...toClient(row), bookings_count: 0, last_booking_at: null } });
  });

  app.get('/api/dashboard', auth, async (request) => {
    const companyId = companyOf(request), query = request.query as { date?: string }, day = validDay(query.date || spDay()), start = new Date(`${day}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - 6); const from = start.toISOString().slice(0, 10);
    const [bookingRows, courtRows, pendingRows] = await Promise.all([db.select().from(bookings).where(and(eq(bookings.companyId, companyId), gte(bookings.startAt, `${from}T00:00:00.000Z`), lt(bookings.startAt, `${day}T24:00:00.000Z`))), db.select().from(courts).where(and(eq(courts.companyId, companyId), eq(courts.active, true))), db.select({id:bookings.id,customerName:bookings.customerName,startAt:bookings.startAt,amountCents:bookings.amountCents,courtName:courts.name}).from(bookings).innerJoin(courts,eq(bookings.courtId,courts.id)).where(and(eq(bookings.companyId,companyId),eq(bookings.status,'pending'))).orderBy(asc(bookings.startAt))]);
    const current = bookingRows.filter((b) => b.startAt.slice(0, 10) === day && b.status !== 'cancelled');
    const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); const key = d.toISOString().slice(0, 10), list = bookingRows.filter((b) => b.startAt.slice(0, 10) === key && b.status !== 'cancelled'); return { date: key, count: list.length, reserved_cents: list.reduce((sum, b) => sum + b.amountCents, 0) }; });
    const comp = (await db.select({ id: companies.id, name: companies.name, slug: companies.slug }).from(companies).where(eq(companies.id, companyId)).limit(1))[0]!;
    return { company: comp, today: { bookings_count: current.length, reserved_cents: current.reduce((sum, b) => sum + b.amountCents, 0), pending_count: current.filter((b) => b.status === 'pending').length, courts_active: courtRows.length }, pending: { count: pendingRows.length, bookings: pendingRows.slice(0, 10) }, week };
  });
  app.get('/api/bookings', auth, async (request) => {
    const companyId = companyOf(request), query = request.query as { date?: string }, day = validDay(query.date || spDay());
    const [rows, blockRows, members] = await Promise.all([db.select({ booking: bookings, courtName: courts.name, sport: courts.sport }).from(bookings).innerJoin(courts, eq(bookings.courtId, courts.id)).where(and(eq(bookings.companyId, companyId), gte(bookings.startAt, `${day}T00:00:00.000Z`), lt(bookings.startAt, `${day}T24:00:00.000Z`))).orderBy(asc(bookings.startAt)), db.select({ block: blockedSlots, courtName: courts.name, sport: courts.sport }).from(blockedSlots).innerJoin(courts, eq(blockedSlots.courtId, courts.id)).where(and(eq(blockedSlots.companyId, companyId), gte(blockedSlots.startAt, `${day}T00:00:00.000Z`), lt(blockedSlots.startAt, `${day}T24:00:00.000Z`))).orderBy(asc(blockedSlots.startAt)), db.select({ member: monthlyMembers, clientName: clients.name, customerPhone: clients.phone, courtName: courts.name, sport: courts.sport }).from(monthlyMembers).innerJoin(clients, eq(monthlyMembers.clientId, clients.id)).innerJoin(courts, eq(monthlyMembers.courtId, courts.id)).where(and(eq(monthlyMembers.companyId, companyId), eq(monthlyMembers.weekday, new Date(`${day}T12:00:00Z`).getUTCDay()), eq(monthlyMembers.status, 'active')))]);
    const regular = rows.map(({ booking: b, courtName, sport }) => ({ id: b.id, customer_name: b.customerName, customer_phone: b.customerPhone, start_at: b.startAt, end_at: b.endAt, amount_cents: b.amountCents, status: b.status, source: b.source, court_id: b.courtId, court_name: courtName, sport }));
    const recurring = members.map(({ member: m, clientName, customerPhone, courtName, sport }) => { const [h = 0, min = 0] = m.startTime.split(':').map(Number), end = h * 60 + min + m.durationMinutes; return { id: `monthly-${m.id}-${day}`, customer_name: clientName, customer_phone: customerPhone, start_at: `${day}T${m.startTime}:00.000Z`, end_at: `${day}T${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}:00.000Z`, amount_cents: m.amountCents, status: 'monthly', source: 'monthly', court_id: m.courtId, court_name: courtName, sport }; });
    return { bookings: [...regular, ...recurring].sort((a, b) => a.start_at.localeCompare(b.start_at)), blocks: blockRows.map(({ block: b, courtName, sport }) => ({ id: b.id, reason: b.reason, start_at: b.startAt, end_at: b.endAt, court_id: b.courtId, court_name: courtName, sport })) };
  });

  async function saveBooking(request: FastifyRequest, input: Record<string, unknown>, source: string) {
    const user = userOf(request), companyId = companyOf(request), courtId = String(input.courtId || ''), customerName = text(input.customerName, 'o nome do cliente'), phone = digits(input.customerPhone), startAt = iso(input.startAt), endAt = iso(input.endAt), start = Date.parse(startAt), end = Date.parse(endAt), duration = (end - start) / 60000;
    if (phone && (phone.length < 10 || phone.length > 15)) throw fail(400, 'Confira o telefone do cliente.');
    if (startAt.slice(0, 10) !== endAt.slice(0, 10) || start % 1800000 !== 0 || duration < 60 || duration % 30) throw fail(400, 'Use blocos de 30 minutos e duração mínima de 1 hora.');
    const createdAt = new Date().toISOString();
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId}), hashtext(${courtId}))`);
      const q = (await tx.select().from(courts).where(and(eq(courts.id, courtId), eq(courts.companyId, companyId), eq(courts.active, true))).limit(1))[0]; if (!q) throw fail(404, 'A quadra não está disponível.');
      const weekday = new Date(`${startAt.slice(0, 10)}T12:00:00Z`).getUTCDay(), hour = (await tx.select().from(companyHours).where(and(eq(companyHours.companyId, companyId), eq(companyHours.weekday, weekday))).limit(1))[0];
      if (!hour?.isOpen || startAt.slice(11, 16) < hour.openTime || endAt.slice(11, 16) > hour.closeTime) throw fail(400, 'O horário escolhido está fora do funcionamento da arena.');
      const conflict = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.companyId, companyId), eq(bookings.courtId, courtId), ne(bookings.status, 'cancelled'), lt(bookings.startAt, endAt), sql`${bookings.endAt} > ${startAt}`)).limit(1);
      const block = await tx.select({ id: blockedSlots.id }).from(blockedSlots).where(and(eq(blockedSlots.companyId, companyId), eq(blockedSlots.courtId, courtId), lt(blockedSlots.startAt, endAt), sql`${blockedSlots.endAt} > ${startAt}`)).limit(1);
      if (conflict.length || block.length) throw fail(409, 'O horário escolhido já está ocupado ou bloqueado.');
      const client = phone ? (await tx.select().from(clients).where(and(eq(clients.companyId, companyId), eq(clients.phone, phone))).orderBy(asc(clients.createdAt)).limit(1))[0] : (await tx.select().from(clients).where(and(eq(clients.companyId, companyId), eq(clients.name, customerName))).orderBy(asc(clients.createdAt)).limit(1))[0];
      const clientId = client?.id || randomUUID();
      if (client) await tx.update(clients).set({ name: customerName }).where(eq(clients.id, clientId)); else await tx.insert(clients).values({ id: clientId, companyId, name: customerName, phone: phone || null, createdAt });
      const tariffs = await tx.select({ weekday: companyPriceSlots.weekday, startTime: companyPriceSlots.startTime, endTime: companyPriceSlots.endTime, priceCents: companyPriceSlots.priceCents }).from(companyPriceSlots).where(eq(companyPriceSlots.companyId, companyId));
      const amountCents = bookingAmountCents(startAt, endAt, q.priceCents, tariffs), id = randomUUID();
      const booking = { id, companyId, courtId, clientId, customerName, customerPhone: phone || null, startAt, endAt, amountCents, status: 'pending', source, cancelReason: '', createdAt, updatedAt: createdAt };
      await tx.insert(bookings).values(booking);
      return { ...booking, court_name: q.name };
    });
    await audit(companyId, user.id, 'booking.created', 'booking', result.id);
    return result;
  }
  app.post('/api/bookings', auth, async (request, reply) => reply.code(201).send({ booking: await saveBooking(request, bodyOf(request), 'staff') }));
  app.patch('/api/bookings/:id', auth, async (request) => {
    const user = userOf(request), companyId = companyOf(request), { id } = request.params as { id: string }, body = bodyOf(request);
    const customerName = text(body.customerName, 'o nome do cliente'), phone = digits(body.customerPhone), courtId = String(body.courtId || ''), startAt = iso(body.startAt), endAt = iso(body.endAt), start = Date.parse(startAt), end = Date.parse(endAt), duration = (end - start) / 60000;
    if (phone && (phone.length < 10 || phone.length > 15)) throw fail(400, 'Confira o telefone do cliente.');
    if (startAt.slice(0, 10) !== endAt.slice(0, 10) || start % 1800000 !== 0 || duration < 60 || duration % 30) throw fail(400, 'Use horários em blocos de 30 minutos e duração mínima de 1 hora.');
    const updated = await db.transaction(async (tx) => {
      const current = (await tx.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.companyId, companyId), sql`${bookings.status} IN ('pending','confirmed')`)).limit(1))[0];
      if (!current) throw fail(404, 'Reserva não encontrada ou já encerrada.');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId}), hashtext(${courtId}))`);
      const court = (await tx.select().from(courts).where(and(eq(courts.id, courtId), eq(courts.companyId, companyId), eq(courts.active, true))).limit(1))[0];
      if (!court) throw fail(404, 'A quadra não está disponível.');
      const weekday = new Date(`${startAt.slice(0, 10)}T12:00:00Z`).getUTCDay(), hour = (await tx.select().from(companyHours).where(and(eq(companyHours.companyId, companyId), eq(companyHours.weekday, weekday))).limit(1))[0];
      if (!hour?.isOpen || startAt.slice(11, 16) < hour.openTime || endAt.slice(11, 16) > hour.closeTime) throw fail(400, 'O horário escolhido está fora do funcionamento da arena.');
      const [conflict, block] = await Promise.all([
        tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.companyId, companyId), eq(bookings.courtId, courtId), ne(bookings.status, 'cancelled'), sql`${bookings.id} <> ${id}`, lt(bookings.startAt, endAt), sql`${bookings.endAt} > ${startAt}`)).limit(1),
        tx.select({ id: blockedSlots.id }).from(blockedSlots).where(and(eq(blockedSlots.companyId, companyId), eq(blockedSlots.courtId, courtId), lt(blockedSlots.startAt, endAt), sql`${blockedSlots.endAt} > ${startAt}`)).limit(1),
      ]);
      if (conflict.length || block.length) throw fail(409, 'O horário escolhido já está ocupado ou bloqueado.');
      const client = phone ? (await tx.select().from(clients).where(and(eq(clients.companyId, companyId), eq(clients.phone, phone))).orderBy(asc(clients.createdAt)).limit(1))[0] : (await tx.select().from(clients).where(and(eq(clients.companyId, companyId), eq(clients.name, customerName))).orderBy(asc(clients.createdAt)).limit(1))[0];
      const clientId = client?.id || randomUUID(), now = new Date().toISOString();
      if (client) await tx.update(clients).set({ name: customerName }).where(eq(clients.id, clientId)); else await tx.insert(clients).values({ id: clientId, companyId, name: customerName, phone: phone || null, createdAt: now });
      const tariffs = await tx.select({ weekday: companyPriceSlots.weekday, startTime: companyPriceSlots.startTime, endTime: companyPriceSlots.endTime, priceCents: companyPriceSlots.priceCents }).from(companyPriceSlots).where(eq(companyPriceSlots.companyId, companyId));
      const amountCents = bookingAmountCents(startAt, endAt, court.priceCents, tariffs);
      await tx.update(bookings).set({ clientId, courtId, customerName, customerPhone: phone || null, startAt, endAt, amountCents, updatedAt: now }).where(and(eq(bookings.id, id), eq(bookings.companyId, companyId)));
      await tx.insert(bookingEvents).values({ id: randomUUID(), companyId, bookingId: id, userId: user.id, event: 'edited', details: { before: { courtId: current.courtId, startAt: current.startAt, endAt: current.endAt }, after: { courtId, startAt, endAt } }, createdAt: now });
      return { id };
    });
    await audit(companyId, user.id, 'booking.edited', 'booking', updated.id);
    return { ok: true };
  });
  app.post('/api/blocks', auth, async (request, reply) => {
    const user = userOf(request), companyId = companyOf(request), body = bodyOf(request), courtId = String(body.courtId || ''), reason = text(body.reason, 'o motivo do bloqueio'), startAt = iso(body.startAt), endAt = iso(body.endAt), start = Date.parse(startAt), end = Date.parse(endAt);
    if (startAt.slice(0, 10) !== endAt.slice(0, 10) || start % 1800000 || end % 1800000 || end - start < 1800000) throw fail(400, 'O bloqueio precisa usar intervalo de pelo menos 30 minutos no mesmo dia.');
    const item = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId}), hashtext(${courtId}))`);
      const q = (await tx.select().from(courts).where(and(eq(courts.id, courtId), eq(courts.companyId, companyId), eq(courts.active, true))).limit(1))[0]; if (!q) throw fail(404, 'A quadra não está disponível.');
      const occupied = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.companyId, companyId), eq(bookings.courtId, courtId), ne(bookings.status, 'cancelled'), lt(bookings.startAt, endAt), sql`${bookings.endAt} > ${startAt}`)).limit(1); if (occupied.length) throw fail(409, 'Este período contém uma reserva.');
      const row = { id: randomUUID(), companyId, courtId, reason, startAt, endAt, createdAt: new Date().toISOString() }; await tx.insert(blockedSlots).values(row); return { ...row, court_name: q.name };
    });
    await audit(companyId, user.id, 'block.created', 'blocked_slot', item.id);
    return reply.code(201).send({ block: { ...item, court_id: item.courtId, start_at: item.startAt, end_at: item.endAt } });
  });
  app.delete('/api/blocks/:id', auth, async (request) => { const user = userOf(request), companyId = companyOf(request), { id } = request.params as { id: string }; const deleted = await db.delete(blockedSlots).where(and(eq(blockedSlots.id, id), eq(blockedSlots.companyId, companyId))).returning({ id: blockedSlots.id }); if (!deleted.length) throw fail(404, 'Bloqueio não encontrado.'); await audit(companyId, user.id, 'block.deleted', 'blocked_slot', id); return { ok: true }; });
  app.patch('/api/bookings/:id/status', auth, async (request) => {
    const user = userOf(request), companyId = companyOf(request), { id } = request.params as { id: string }, body = bodyOf(request), status = String(body.status || '');
    if (!['confirmed', 'cancelled', 'completed'].includes(status)) throw fail(400, 'Status de reserva inválido.');
    const rows = await db.update(bookings).set({ status, cancelReason: status === 'cancelled' ? String(body.reason || '').slice(0, 200) : '', updatedAt: new Date().toISOString() }).where(and(eq(bookings.id, id), eq(bookings.companyId, companyId), sql`${bookings.status} IN ('pending','confirmed')`)).returning({ id: bookings.id });
    if (!rows.length) throw fail(404, 'Reserva não encontrada ou já encerrada.');
    await db.insert(bookingEvents).values({ id: randomUUID(), companyId, bookingId: id, userId: user.id, event: status, details: { reason: String(body.reason || '') }, createdAt: new Date().toISOString() });
    await audit(companyId, user.id, `booking.${status}`, 'booking', id);
    let reviewToken: string | null = null;
    if (status === 'completed') {
      reviewToken = randomBytes(32).toString('base64url');
      const now = new Date();
      await db.insert(reviewLinks).values({ id: randomUUID(), companyId, bookingId: id, tokenHash: createHash('sha256').update(reviewToken).digest('hex'), expiresAt: new Date(now.getTime() + 90 * 86400000).toISOString(), submittedAt: null, createdAt: now.toISOString() }).onConflictDoNothing();
      // Review delivery is scheduled after the booking ends by the durable worker.

    }
    return { ok: true, status, reviewToken };
  });
}

export { adminOf, audit, companyOf, fail, text, userOf, validDay };
