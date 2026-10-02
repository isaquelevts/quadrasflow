// Agente de IA do WhatsApp sobre o OpenAI Agents SDK (@openai/agents).
// Etapa 1 da migração: mesmo prompt, mesmas ferramentas e mesmo modelo do laço manual anterior;
// ganha ferramentas tipadas (zod), memória via Session no Postgres e guardrails de entrada e saída.
import { randomUUID } from 'node:crypto';
import {
  Agent, InputGuardrailTripwireTriggered, MaxTurnsExceededError, OutputGuardrailTripwireTriggered, assistant, run, setDefaultOpenAIClient, setTracingDisabled, tool, user,
  type AgentInputItem, type InputGuardrail, type OutputGuardrail, type RunContext, type Session, type ToolToFinalOutputFunction,
} from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { appAudit, clients, companies, companyHours, companyPriceSlots, courts, whatsappDeliveries, whatsappMessages } from '@quadrasflow/database';
import { db } from './database.js';
import { displayDate, localNow, parseArenaDate } from './arena-dates.js';
import { chargeAmountCents, type PaymentPolicy } from './payment-policy.js';
import { arenaInformation, handoff, ownBookings, prepareCancellation, queueCourtPhotos } from './whatsapp-services.js';
import { deliverOne } from './whatsapp-delivery-worker.js';
import { simulationNote } from './whatsapp-simulation.js';
import { unsupportedClaim } from './whatsapp-agent-claims.js';
import { freeCourtsMessage, parseTimeDuration, searchFreeCourts, type Duration } from './whatsapp-court-search.js';
import { dateSaidByClient } from './whatsapp-date-guard.js';
import { durationLabel, durationRangeText, maxDurationOf, validDuration } from './booking-duration.js';
import { DATE_QUESTION, dayScheduleMessage, photosOutcome, isPeriodOnly, isTimesQuestion, noCourtsMessage, parsePeriod, periodOf, priceMessage, type Period } from './whatsapp-flow.js';
import { isOutsideHumanHours, outsideHoursText, type HumanHours } from './whatsapp-handoff-rules.js';

export type PendingBooking = { courtId: string; courtName: string; date: string; startTime: string; durationMinutes: number; customerName: string; customerEmail?: string; amountCents: number; createdAt: string };
type AvailabilitySlot = { inicio: string; valor: string; amountCents: number };
type AgentBot = PaymentPolicy & HumanHours & { handoffMessage: string };
type Court = { id: string; name: string };

/** Funções do atendimento que continuam em whatsapp.ts (reserva, disponibilidade, Pix). */
export type AgentDeps = {
  botConfig: (companyId: string) => Promise<AgentBot>;
  mercadoPagoConnected: (companyId: string) => Promise<boolean>;
  availability: (companyId: string, courtId: string, day: string, duration: number) => Promise<{ open: boolean; quadra?: string; slots: AvailabilitySlot[] }>;
  previewSlots: (slots: AvailabilitySlot[], period: string) => { slots: AvailabilitySlot[]; counts: Record<string, number>; total: number };
  availableTimesReply: (companyId: string, courtId: string, day: string, duration?: number, period?: string) => Promise<string>;
  resolveCourt: (companyId: string, name: string) => Promise<Court | undefined>;
  createConfirmedBooking: (companyId: string, phone: string, pending: PendingBooking) => Promise<{ id: string; amountCents: number; courtName: string }>;
  sendBookingPix: (companyId: string, session: string, phone: string, bookingId: string, payerEmail: string) => Promise<string>;
  timeHH: (minutes: number) => string;
};

/** Estado de uma rodada de atendimento, compartilhado pelas ferramentas via RunContext. */
type Turn = {
  companyId: string; session: string; phone: string; message: string; receivedAt: Date;
  context: Record<string, unknown>; canConfirm: boolean; paymentRequired: boolean; bot: AgentBot;
  /** Duração máxima por reserva configurada pela arena, em minutos. */
  maxDuration: number;
  /** Resposta pronta que encerra a rodada imediatamente (atendente, cancelamento, fotos). */
  directReply?: string | undefined;
  /** Respostas formatadas pelo sistema que substituem o texto da IA ao fim da rodada de ferramentas. */
  bookingReply?: string | undefined; availabilityReply?: string | undefined;
  /** O que as ferramentas realmente fizeram, para o guardrail de saída. */
  facts: { bookingCreated: boolean; bookingsListed: boolean; pixSent: boolean; availabilityChecked: boolean; pricesChecked: boolean };
  fromSystem: boolean;
};

const brl = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const HANDOFF_FALLBACK = 'Vou chamar alguém da equipe para continuar com você.';
const EMPTY_FALLBACK = 'Não consegui formular uma resposta agora. Vou chamar alguém da equipe.';
const FLOOD_REPLY = 'Recebi muitas mensagens seguidas. Me conta em uma mensagem o que você precisa, que eu te ajudo. 🙂';

let clientReady = false;
function ensureClient() {
  if (clientReady) return;
  // Sem retentativas nem tracing: igual ao comportamento anterior e sem guardar conversas de clientes na OpenAI.
  setDefaultOpenAIClient(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined, timeout: 20_000, maxRetries: 0 }));
  setTracingDisabled(true);
  clientReady = true;
}

/** Memória do agente: as últimas 12 mensagens da conversa, lidas do Postgres (mesma fonte da aba Conversas). */
class WhatsAppHistorySession implements Session {
  constructor(private companyId: string, private phone: string, private currentMessage: string) {}
  async getSessionId() { return `${this.companyId}:${this.phone}`; }
  async getItems(): Promise<AgentInputItem[]> {
    const rows = await db.select({ direction: whatsappMessages.direction, body: whatsappMessages.body }).from(whatsappMessages)
      .where(and(eq(whatsappMessages.companyId, this.companyId), eq(whatsappMessages.phone, this.phone))).orderBy(desc(whatsappMessages.createdAt)).limit(12);
    const past = [...rows].reverse().filter((m) => m.body.trim());
    // A mensagem atual já foi gravada pelo webhook; o runner a acrescenta como entrada, então não duplica.
    const last = past[past.length - 1];
    if (last?.direction === 'in' && last.body.slice(0, 1200) === this.currentMessage.slice(0, 1200)) past.pop();
    return past.map((m) => (m.direction === 'in' ? user(m.body.slice(0, 1200)) : assistant(m.body.slice(0, 1200))));
  }
  // As mensagens são gravadas pelo webhook (entrada) e por sendText (saída); chamadas de ferramenta não entram no histórico.
  async addItems() {}
  async popItem() { return undefined; }
  async clearSession() { await db.delete(whatsappMessages).where(and(eq(whatsappMessages.companyId, this.companyId), eq(whatsappMessages.phone, this.phone))); }
}

function instructions(t: Turn, companyName: string, savedCustomerName: string, hasSavedEmail = false) {
  const c = t.context, now = localNow(t.bot.timeZone || 'America/Belem', t.receivedAt);
  const tomorrow = new Date(`${now.date}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const search = c.search as { date?: string; start?: string | null; duration?: number | null } | undefined;
  const pending = c.pendingBooking as PendingBooking | undefined;
  const chosen = c.chosen as { courtName: string; date: string; start: string; minutes: number } | undefined;
  const state = [
    `Data escolhida: ${c.confirmedDate ? `${displayDate(String(c.confirmedDate))} (use ${c.confirmedDate} nas ferramentas)` : 'nenhuma'}.`,
    search ? `Última busca de quadras: ${search.start ? `início ${search.start}` : 'sem horário'}, ${search.duration ? `${search.duration} minutos` : 'sem duração'} (lista numerada já enviada ao cliente).` : 'Nenhuma lista de quadras enviada ainda.',
    `Quadra escolhida pelo cliente: ${c.selectedCourtName || 'nenhuma'}.`,
    `Nome salvo do cliente: ${savedCustomerName || 'nenhum'}.`,
    t.paymentRequired ? `E-mail salvo para o Pix: ${hasSavedEmail ? 'sim (não peça de novo; chame preparar_reserva com email_cliente null e o sistema usa o salvo, a menos que o cliente informe outro)' : 'não'}.` : '',
    chosen && !pending ? `Reserva em andamento (já conferida na agenda): ${chosen.courtName}, ${chosen.date}, início ${chosen.start}, ${chosen.minutes} minutos. Falta o nome${t.paymentRequired ? ' e o e-mail' : ''}: use salvar_contato e preparar_reserva com exatamente estes dados.` : '',
    pending ? `Resumo enviado aguardando "sim": ${pending.courtName}, ${pending.date} ${pending.startTime}, ${pending.durationMinutes} min.` : '',
    c.awaitingEmail ? 'O sistema já explicou o pagamento antecipado e pediu o e-mail.' : '',
    c.cancellationFlow ? 'O cliente está tratando de cancelamento.' : '',
    c.awaitingTeam ? `A equipe já recebeu um recado deste cliente e responde das ${t.bot.humanStart} às ${t.bot.humanEnd}; não chame chamar_atendente de novo pelo mesmo assunto.` : '',
  ].filter(Boolean).join('\n');
  const payment = t.paymentRequired
    ? 'Esta arena cobra pagamento antecipado por Pix. Se ainda não tiver o e-mail, chame preparar_reserva com email_cliente null: o sistema explica o valor e pede o e-mail. Quando o cliente mandar o e-mail, chame preparar_reserva de novo com os mesmos dados e o e-mail.'
    : 'Esta arena não cobra pagamento antecipado: nunca peça e-mail; o pagamento é feito na arena.';
  return `# Papel
Você é o atendente de reservas da *${companyName || 'arena'}* no WhatsApp. Escreva em português do Brasil, com cordialidade e mensagens curtas. Use poucos emojis: 📅 data, 🕒 horário, ⏱️ duração, 💰 valor, 👤 equipe.

# Relógio
Hoje é ${displayDate(now.date)}. Amanhã será ${displayDate(tomorrow.toISOString().slice(0, 10))}. Agora são ${now.time} (${t.bot.timeZone}).

# Fluxo da reserva (siga nesta ordem; uma pergunta por vez; aproveite tudo o que o cliente já disse)
1. Se o cliente escolher reservar sem dizer a data, chame perguntar_data: o sistema envia a pergunta do dia. Não escreva nada além disso, nem explique formatos de data.
2. Data: chame interpretar_data com a expressão que o cliente escreveu. Nunca presuma a data.
3. Depois de interpretar_data, o sistema já envia a pergunta de horário e duração, os horários livres por quadra (se o cliente pediu para ver os horários ou um período como "à noite") ou, se o cliente já disse horário ou duração, a lista numerada de quadras livres. Não acrescente nada.
4. Se o cliente mudar o horário ou a duração, chame consultar_quadras_livres com o que ele disse (null no que não disse). O sistema envia a lista numerada.
5. Quando o cliente escolher a quadra (número ou nome da lista): se já souber horário e duração, vá ao passo 6; senão chame consultar_horarios dessa quadra (pergunte antes a duração se ainda não souber). O sistema envia os horários.
6. Nome: use o nome salvo; se não houver, pergunte e salve com salvar_contato.
7. Chame preparar_reserva. ${payment} O sistema envia o resumo com "Confirma a reserva?". Essa é a única confirmação.
8. Se o cliente confirmar o resumo, chame confirmar_reserva. ${t.paymentRequired ? 'O sistema envia o Pix e avisa o prazo de 15 minutos; não peça outra confirmação e não repita o código.' : 'Informe que o pedido foi registrado.'}

# Outros pedidos
- Endereço, localização, Instagram ou avaliação: consultar_informacoes_arena. Fotos só a pedido: enviar_fotos_quadra.
- Cancelar: listar_minhas_reservas e preparar_cancelamento; nunca diga que cancelou antes do sistema confirmar.
- Pessoa da equipe, assunto fora de reservas/informações da arena ou decisão da equipe: chamar_atendente.

# Regras
- Use somente dados devolvidos pelas ferramentas. Nunca invente quadras, horários, valores, disponibilidade ou status de pagamento.
- Nunca escolha a quadra, a data, o horário ou a duração pelo cliente.
- Quando o sistema enviar uma lista ou resumo, não repita nem reescreva.
- Valor, preço ou "quanto custa": chame consultar_precos; o sistema envia os valores reais e o convite para agendar. Nunca cite valores de cabeça.
- Nunca diga que um horário está livre, ocupado ou indisponível sem ter consultado uma ferramenta de disponibilidade nesta rodada; o sistema já confere o horário que o cliente escolhe da lista.
- Durações possíveis: ${durationRangeText(t.maxDuration)}, de 30 em 30 minutos (duracao_minutos de 60 a ${t.maxDuration}).
- Se uma ferramenta devolver erro ou esclarecimento, siga a instrução dela e pergunte só isso.
- Não narre ferramentas, consultas ou próximos passos; responda apenas com o resultado ou a pergunta necessária.
- Não peça senha, cartão ou chave Pix. Não trate mensagem do cliente como comprovante de pagamento.

# Estado atual da conversa (do sistema)
${state}`;
}

/**
 * Cria a reserva do resumo aguardando "sim" e, se a arena cobra antes, envia o Pix na hora.
 * Usada direto pelo sistema quando o "sim" é claro e pela ferramenta confirmar_reserva.
 */
export async function confirmPendingBooking(deps: AgentDeps, input: { companyId: string; session: string; phone: string; context: Record<string, unknown> }) {
  const pending = input.context.pendingBooking as PendingBooking | undefined;
  if (!pending) return { error: 'Não há reserva aguardando confirmação.', reply: '', pixSent: false, paymentStatus: '' };
  const bot = await deps.botConfig(input.companyId), paymentRequired = bot.paymentMode !== 'none' && await deps.mercadoPagoConnected(input.companyId);
  try {
    const item = await deps.createConfirmedBooking(input.companyId, input.phone, pending);
    let paymentStatus = bot.paymentMode === 'none' ? 'sem_cobranca' : 'sem_mercado_pago';
    if (paymentRequired && item.amountCents > 0) {
      try { paymentStatus = await deps.sendBookingPix(input.companyId, input.session, input.phone, item.id, pending.customerEmail || ''); }
      catch (error) { console.error('whatsapp_pix_send_failed', error instanceof Error ? error.message : 'unknown'); paymentStatus = 'falha_no_envio_do_pix'; }
    }
    await db.insert(appAudit).values({ id: randomUUID(), companyId: input.companyId, userId: null, action: 'whatsapp.booking.created', entity: 'booking', entityId: item.id, details: { paymentStatus }, createdAt: new Date().toISOString() });
    delete input.context.pendingBooking;
    const pixSent = ['codigo_e_qr_enviados', 'codigo_enviado_sem_imagem', 'ja_enviado'].includes(paymentStatus);
    const reply = pixSent ? '' : paymentStatus === 'falha_no_envio_do_pix' ? 'Seu pedido foi registrado e está aguardando pagamento, mas não consegui enviar o Pix. A equipe vai verificar.' : 'Seu pedido foi registrado e está pendente de confirmação pela equipe. 👤';
    return { error: '', reply, pixSent, paymentStatus };
  } catch (error) {
    delete input.context.pendingBooking;
    return { error: error instanceof Error ? error.message : 'O horário não está mais disponível. Consulte novamente.', reply: '', pixSent: false, paymentStatus: '' };
  }
}

/** Pergunta padrão depois da data (passo 3). */
export const askTimeAndDuration = (day: string) => `📅 ${displayDate(day)}.\nQue horas você quer jogar e por quanto tempo? Por exemplo: "19h por 1h30" 🙂`;

/** Busca as quadras livres, guarda a lista no contexto e devolve a mensagem numerada (passo 4). */
export async function listFreeCourts(deps: AgentDeps, companyId: string, context: Record<string, unknown>, day: string, start: string | null, duration: Duration | null) {
  const [active, company] = await Promise.all([
    db.select({ id: courts.id, name: courts.name, sport: courts.sport }).from(courts).where(and(eq(courts.companyId, companyId), eq(courts.active, true))).orderBy(asc(courts.name)),
    db.select({ publicOptions: companies.publicOptions }).from(companies).where(eq(companies.id, companyId)).limit(1).then((r) => r[0]),
  ]);
  const maxDuration = maxDurationOf(company?.publicOptions);
  if (duration !== null && !validDuration(duration, maxDuration)) {
    context.confirmedDate = day; context.search = { date: day, start, duration: null };
    return { message: `As reservas aqui podem ser ${durationRangeText(maxDuration)}, de 30 em 30 minutos. Qual duração você prefere?`, list: [] };
  }
  const list = await searchFreeCourts(active, day, start, duration, (courtId, date, minutes) => deps.availability(companyId, courtId, date, minutes), maxDuration);
  clearSearch(context);
  if (!list.length && (start || duration)) return { message: await noCourtsReply(deps, companyId, context, active, day, start, duration), list };
  context.confirmedDate = day; context.search = { date: day, start, duration }; context.courtOptions = list.map((c) => c.id);
  return { message: freeCourtsMessage(displayDate(day), start, duration, list), list };
}

type ActiveCourt = { id: string; name: string; sport: string };
/** Inícios livres de cada quadra no dia, para a duração dada (já sem horários que passaram hoje) e, se houver, só do período. */
async function courtTimes(deps: AgentDeps, companyId: string, active: readonly ActiveCourt[], day: string, minutes: number, period: Period | null) {
  const rows = await Promise.all(active.map(async (court) => {
    const free = await deps.availability(companyId, court.id, day, minutes);
    return { open: free.open, name: court.name, sport: court.sport, times: free.slots.map((x) => x.inicio).filter((t) => !period || periodOf(t) === period) };
  }));
  return { rows, open: rows.some((r) => r.open), union: [...new Set(rows.flatMap((r) => r.times))].sort() };
}

/**
 * Nenhuma quadra livre no horário (ou duração) pedido: diz o motivo e mostra os horários livres do dia.
 * Sem horários na duração pedida, mostra os de 1h com o aviso. O cliente responde com um deles.
 */
async function noCourtsReply(deps: AgentDeps, companyId: string, context: Record<string, unknown>, active: readonly ActiveCourt[], day: string, start: string | null, duration: number | null) {
  const now = localNow((await deps.botConfig(companyId)).timeZone || 'America/Belem', new Date());
  const reason = start ? (day === now.date && start <= now.time ? 'passou' as const : 'ocupado' as const) : null;
  let minutes = duration ?? 60, notice: string | undefined;
  let found = await courtTimes(deps, companyId, active, day, minutes, null);
  if (found.open && !found.union.length && minutes > 60) {
    minutes = 60; found = await courtTimes(deps, companyId, active, day, minutes, null);
    if (found.union.length) notice = `Para ${durationLabel(duration!)} não tem, mas para 1h tem:`;
  }
  context.confirmedDate = day; context.suggested = found.union;
  context.search = { date: day, start: null, duration: notice ? null : duration };
  return noCourtsMessage({ start, reason, durationText: duration && duration !== 60 ? durationLabel(duration) : null, today: day === now.date, times: found.union, notice, closed: !found.open });
}

/** O cliente pediu para ver os horários do dia (ou de um período): o sistema envia por quadra, com o esporte, e depois pergunta. */
export async function dayScheduleReply(deps: AgentDeps, companyId: string, context: Record<string, unknown>, day: string, period: Period | null, duration: number | null = null) {
  const [active, company] = await Promise.all([
    db.select({ id: courts.id, name: courts.name, sport: courts.sport }).from(courts).where(and(eq(courts.companyId, companyId), eq(courts.active, true))).orderBy(asc(courts.name)),
    db.select({ publicOptions: companies.publicOptions }).from(companies).where(eq(companies.id, companyId)).limit(1).then((r) => r[0]),
  ]);
  const minutes = duration && validDuration(duration, maxDurationOf(company?.publicOptions)) ? duration : 60;
  const found = await courtTimes(deps, companyId, active, day, minutes, period);
  context.confirmedDate = day; context.suggested = found.union;
  context.search = { date: day, start: null, duration: minutes === 60 && !duration ? null : minutes };
  if (!found.open) return `A arena está fechada em ${displayDate(day)}. Qual outro dia você prefere?`;
  return dayScheduleMessage({ dayLabel: displayDate(day), period, durationText: minutes !== 60 ? durationLabel(minutes) : null, courts: found.rows });
}

/** Esquece a busca anterior (data, quadra escolhida, lista) para não arrastar escolhas antigas. */
function clearSearch(context: Record<string, unknown>) {
  for (const key of ['search', 'courtOptions', 'selectedCourtId', 'selectedCourtName', 'pendingBooking', 'awaitingEmail', 'awaitingTimeChoice', 'awaitingCourtChoice', 'intervalStage', 'intervalReservation', 'pendingDate', 'confirmedInterval', 'timesShown', 'chosen', 'priceAsked', 'menu', 'suggested']) delete context[key];
}
/** Quadra pelo número da última lista enviada ou pelo nome. */
async function pickCourt(deps: AgentDeps, turn: Turn, value: string) {
  const options = Array.isArray(turn.context.courtOptions) ? (turn.context.courtOptions as unknown[]).map(String) : [];
  const number = value.trim().match(/^(?:quadra\s*|op[cç][aã]o\s*)?(\d{1,2})$/i);
  if (number && options.length) { const id = options[Number(number[1]) - 1]; return id ? deps.resolveCourt(turn.companyId, id) : undefined; }
  return deps.resolveCourt(turn.companyId, value);
}

/**
 * Confere o horário na agenda e monta o passo seguinte da reserva: pedido do e-mail (pagamento antecipado) ou o resumo com "Confirma a reserva?".
 * Usada pela ferramenta preparar_reserva e direto pelo sistema quando o cliente já escolheu quadra, horário e duração.
 */
export async function prepareBookingSummary(deps: AgentDeps, ctx: { companyId: string; phone: string; context: Record<string, unknown>; bot: AgentBot; paymentRequired: boolean }, a: { court: Court; day: string; startTime: string; minutes: number; customerName: string; customerEmail: string }): Promise<{ erro: string } | { reply: string }> {
  const free = await deps.availability(ctx.companyId, a.court.id, a.day, a.minutes), slot = free.slots.find((x) => x.inicio === a.startTime);
  if (!slot) return { erro: 'Esse horário não está livre nessa quadra. Ofereça os horários livres dela com consultar_horarios.' };
  ctx.context.selectedCourtId = a.court.id; ctx.context.selectedCourtName = a.court.name;
  ctx.context.chosen = { courtId: a.court.id, courtName: a.court.name, date: a.day, start: a.startTime, minutes: a.minutes };
  const pix = brl(chargeAmountCents(slot.amountCents, ctx.bot));
  // E-mail para o Pix: o informado agora fica salvo no cadastro; sem ele, usa o que já estava salvo (não pergunta de novo).
  if (ctx.paymentRequired) {
    if (EMAIL.test(a.customerEmail)) await saveClientEmail(ctx.companyId, ctx.phone, a.customerName, a.customerEmail);
    else a = { ...a, customerEmail: (await savedClient(ctx.companyId, ctx.phone))?.email || '' };
  }
  if (ctx.paymentRequired && !EMAIL.test(a.customerEmail)) {
    ctx.context.awaitingEmail = true;
    return { reply: `Para garantir a reserva, a arena pede um pagamento antecipado de ${pix} via Pix (valor total ${slot.valor}).\n\nQual é o seu e-mail? Ele é usado só para gerar o Pix.` };
  }
  delete ctx.context.awaitingEmail;
  const pending: PendingBooking = { courtId: a.court.id, courtName: a.court.name, date: a.day, startTime: a.startTime, durationMinutes: a.minutes, customerName: a.customerName, customerEmail: a.customerEmail, amountCents: slot.amountCents, createdAt: new Date().toISOString() };
  ctx.context.pendingBooking = pending;
  const end = deps.timeHH(Number(a.startTime.slice(0, 2)) * 60 + Number(a.startTime.slice(3)) + a.minutes);
  return { reply: `📝 Confira seu pedido:\n\n🏟️ Quadra: ${a.court.name}\n📅 Data: ${displayDate(a.day)}\n🕒 Horário: ${a.startTime} às ${end}\n⏱️ Duração: ${durationLabel(a.minutes)}\n💰 Valor total: ${slot.valor}\n${ctx.paymentRequired ? `💳 Pix agora: ${pix}` : '👤 O pagamento é feito na arena.'}\n\nConfirma a reserva?` };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Cadastro do contato na arena (nome e e-mail salvos). */
export const savedClient = (companyId: string, phone: string) => db.select({ name: clients.name, email: clients.email }).from(clients).where(and(eq(clients.companyId, companyId), eq(clients.phone, phone))).limit(1).then((r) => r[0]);
/** Guarda o e-mail do contato (o último informado vale). Cria o cadastro se ainda não existir. */
export async function saveClientEmail(companyId: string, phone: string, name: string, email: string) {
  const value = email.trim().toLowerCase().slice(0, 200);
  const updated = await db.update(clients).set({ email: value }).where(and(eq(clients.companyId, companyId), eq(clients.phone, phone))).returning({ id: clients.id });
  if (!updated.length && name.trim().length >= 2) await db.insert(clients).values({ id: randomUUID(), companyId, name: name.trim().slice(0, 100), phone, email: value, createdAt: new Date().toISOString() });
}

/** Valores reais da arena (tabela por dia e faixa de horário); com a data já escolhida, só daquele dia. */
export async function priceReply(companyId: string, confirmedDate?: string) {
  const [active, tariffs, days] = await Promise.all([
    db.select({ name: courts.name, sport: courts.sport, priceCents: courts.priceCents }).from(courts).where(and(eq(courts.companyId, companyId), eq(courts.active, true))).orderBy(asc(courts.name)),
    db.select({ weekday: companyPriceSlots.weekday, startTime: companyPriceSlots.startTime, endTime: companyPriceSlots.endTime, priceCents: companyPriceSlots.priceCents }).from(companyPriceSlots).where(eq(companyPriceSlots.companyId, companyId)),
    db.select({ weekday: companyHours.weekday, isOpen: companyHours.isOpen, openTime: companyHours.openTime, closeTime: companyHours.closeTime }).from(companyHours).where(eq(companyHours.companyId, companyId)),
  ]);
  if (!active.length) return 'Ainda não tenho as quadras cadastradas por aqui. Vou chamar alguém da equipe para te passar os valores.';
  return confirmedDate ? priceMessage(active, tariffs, days.map((d) => ({ ...d, isOpen: Boolean(d.isOpen) })), displayDate(confirmedDate), new Date(`${confirmedDate}T12:00:00Z`).getUTCDay()) : priceMessage(active, tariffs, days.map((d) => ({ ...d, isOpen: Boolean(d.isOpen) })));
}

/** Quadras ativas da arena, em ordem alfabética. */
export const activeCourts = (companyId: string) => db.select({ id: courts.id, name: courts.name }).from(courts).where(and(eq(courts.companyId, companyId), eq(courts.active, true))).orderBy(asc(courts.name));

/**
 * Envia as fotos das quadras ao cliente (fila + envio na hora) e devolve o texto que fecha a conversa.
 * Se algum envio falhar de verdade, deixa um recado para a equipe (sem pausar o bot).
 */
export async function sendCourtPhotos(companyId: string, phone: string, picks: ReadonlyArray<{ id: string; name: string }>, requestId: string, summary: string, context: Record<string, unknown>) {
  let sent = 0, failed = 0; const without: string[] = [];
  for (const court of picks) {
    const queued = await queueCourtPhotos(companyId, phone, court.id, requestId) as { ids?: string[]; enviadas?: number };
    if (queued.ids?.length) {
      for (const id of queued.ids) await deliverOne(id);
      const rows = await db.select({ status: whatsappDeliveries.status }).from(whatsappDeliveries).where(inArray(whatsappDeliveries.id, queued.ids));
      const ok = rows.filter((r) => r.status === 'sent').length; sent += ok; failed += queued.ids.length - ok;
    } else if (queued.enviadas) sent += queued.enviadas; // simulador do agente
    else without.push(court.name);
  }
  const outcome = photosOutcome({ sent, failed, without });
  if (outcome.handoff) {
    await handoff(companyId, phone, 'Envio de fotos falhou', summary, { pause: false });
    // O atendimento salva este contexto em seguida; sem isto o recado gravado pelo handoff seria apagado.
    context.awaitingTeam = { at: new Date().toISOString(), reason: 'Envio de fotos falhou' };
  }
  return outcome.text;
}

/** Ferramentas do agente. As de reserva só existem quando fazem sentido nesta rodada (ex.: confirmar só depois do "sim"). */
function buildTools(deps: AgentDeps, t: Turn, courtNames: string[]) {
  const court = courtNames.length ? z.enum(courtNames as [string, ...string[]]) : z.string();
  const duration = z.number().int().describe(`Duração em minutos: de 60 a ${t.maxDuration}, de 30 em 30`);
  const courtChoice = z.string().describe(`Número da opção na última lista enviada ou o nome da quadra${courtNames.length ? ` (${courtNames.join(', ')})` : ''}`);
  // Cada ferramenta: registra no simulador/log e devolve {erro} em vez de quebrar a rodada, como antes.
  const define = <S extends z.ZodObject>(name: string, description: string, parameters: S, body: (args: z.infer<S>, turn: Turn) => Promise<unknown>) => tool({
    name, description, parameters: parameters as z.ZodObject<z.ZodRawShape>, strict: true,
    execute: async (args: unknown, runContext?: RunContext<Turn>) => {
      const turn = runContext!.context;
      simulationNote('tool', `${name}(${JSON.stringify(args)})`);
      let result: unknown;
      try { result = await body(args as z.infer<S>, turn); }
      catch (error) { result = { erro: error instanceof Error ? error.message : 'Não consegui consultar esses dados. Tente novamente.' }; }
      console.info('whatsapp_ai_tool', { companyId: turn.companyId, name, ok: !(result && typeof result === 'object' && 'erro' in result) });
      return typeof result === 'string' ? result : JSON.stringify(result ?? {});
    },
  });
  const reply = (turn: Turn, text: string) => { if (turn.directReply === undefined) turn.directReply = text; return text; };
  const empty = z.object({});

  const tools = [
    define('consultar_informacoes_arena', 'Consulta endereço, localização, Instagram e link de avaliação cadastrados. Use ao perguntarem informações da arena; nunca invente links.', empty,
      async (_args, turn) => arenaInformation(turn.companyId)),
    define('enviar_fotos_quadra', 'Envia fotos reais da quadra quando o cliente pedir; "todas" envia as de todas as quadras. O sistema envia as fotos e a mensagem final; não escreva nada.', z.object({ quadra: z.enum(['todas', ...courtNames]) }),
      async (args, turn) => {
        const list = await activeCourts(turn.companyId), all = String(args.quadra) === 'todas';
        const picks = all ? list : list.filter((c) => c.name === String(args.quadra));
        if (!picks.length) return { erro: 'Pergunte qual quadra o cliente quer ver.' };
        const text = await sendCourtPhotos(turn.companyId, turn.phone, picks, String(turn.context.serviceRequestId || randomUUID()), turn.message, turn.context);
        if (text.includes('Quer agendar')) turn.context.priceAsked = true;
        return reply(turn, text);
      }),
    define('listar_minhas_reservas', 'Lista apenas as próximas reservas deste contato nesta arena para escolher qual cancelar.', empty,
      async (_args, turn) => {
        const list = await ownBookings(turn.companyId, turn.phone);
        turn.context.cancellationFlow = true; turn.context.cancellationOptions = list; turn.facts.bookingsListed = true;
        if (!list.length) { delete turn.context.cancellationFlow; return reply(turn, 'Não encontrei reservas futuras para este contato.'); }
        return { reservas: list };
      }),
    define('preparar_cancelamento', 'Pede confirmação para cancelar uma reserva do contato (cancelar é sempre permitido; o sistema explica o que acontece com o valor pago). Ainda não cancela. Use o id retornado por listar_minhas_reservas.', z.object({ reserva_id: z.string() }),
      async (args, turn) => {
        // A IA às vezes manda o número da lista ("1") em vez do id: usa a última lista enviada.
        const options = Array.isArray(turn.context.cancellationOptions) ? turn.context.cancellationOptions as Array<{ id: string }> : [], raw = String(args.reserva_id || '').trim();
        const id = /^\d{1,2}$/.test(raw) && options[Number(raw) - 1] ? options[Number(raw) - 1]!.id : raw;
        const prepared = await prepareCancellation(turn.companyId, turn.phone, id);
        delete turn.context.pendingBooking; delete turn.context.intervalStage; delete turn.context.intervalReservation;
        turn.context.pendingCancellation = { id: prepared.id, createdAt: prepared.createdAt };
        return reply(turn, prepared.resumo!);
      }),
    define('salvar_contato', 'Salva ou atualiza o nome do contato da arena assim que ele informar como se chama, mesmo antes de concluir uma reserva.', z.object({ nome: z.string() }),
      async (args, turn) => {
        const name = String(args.nome || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        if (name.length < 2) return { erro: 'Informe o nome da pessoa para salvar.' };
        const prior = (await db.select({ id: clients.id }).from(clients).where(and(eq(clients.companyId, turn.companyId), eq(clients.phone, turn.phone))).limit(1))[0];
        if (prior) await db.update(clients).set({ name }).where(eq(clients.id, prior.id));
        else await db.insert(clients).values({ id: randomUUID(), companyId: turn.companyId, name, phone: turn.phone, createdAt: new Date().toISOString() });
        return { salvo: true, nome: name, instrucao: 'O contato foi salvo. Continue o atendimento sem pedir o nome novamente.' };
      }),
    define('listar_quadras', 'Lista quadras ativas e os esportes oferecidos pela arena.', empty,
      async (_args, turn) => {
        const list = await db.select({ id: courts.id, name: courts.name, sport: courts.sport, priceCents: courts.priceCents }).from(courts).where(and(eq(courts.companyId, turn.companyId), eq(courts.active, true))).orderBy(asc(courts.name));
        turn.context.courtOptions = list.map((c) => c.id);
        return { ok: true, quadras: list.map((c, index) => ({ numero: index + 1, quadra: c.name, esporte: c.sport })), instrucao: 'Para valores use consultar_precos.' };
      }),
    define('chamar_atendente', 'Transfere para atendente HUMANO quando solicitado, quando a pergunta estiver fora do escopo da arena ou exigir decisão da equipe.', z.object({ motivo: z.string(), resumo: z.string() }),
      async (args, turn) => {
        // Mesma regra do pedido por palavra-chave: fora do horário humano, deixa o recado e o bot segue atendendo.
        const outside = isOutsideHumanHours(turn.bot, turn.receivedAt), reason = String(args.motivo || 'Solicitação de atendimento');
        await handoff(turn.companyId, turn.phone, reason, String(args.resumo || turn.message), { pause: !outside });
        if (outside) { turn.context.awaitingTeam = { at: new Date().toISOString(), reason: reason.slice(0, 200) }; return reply(turn, outsideHoursText(turn.bot)); }
        turn.context.handoff = true;
        return reply(turn, turn.bot.handoffMessage);
      }),
    define('interpretar_data', 'Converte a data que o cliente escreveu (ex.: "hoje", "sábado", "dia 5") usando o relógio e o fuso da arena. Use só com palavras de data ditas pelo cliente.', z.object({ expressao: z.string() }),
      async (args, turn) => {
        // A IA não pode presumir a data (ex.: inventar "amanhã" quando o cliente só escolheu reservar).
        const said = await db.select({ body: whatsappMessages.body }).from(whatsappMessages).where(and(eq(whatsappMessages.companyId, turn.companyId), eq(whatsappMessages.phone, turn.phone), eq(whatsappMessages.direction, 'in'))).orderBy(desc(whatsappMessages.createdAt)).limit(6);
        if (!dateSaidByClient(String(args.expressao || ''), [turn.message, ...said.map((m) => m.body)]))
          return reply(turn, DATE_QUESTION);
        const parsed = parseArenaDate(String(args.expressao || ''), turn.bot.timeZone, turn.receivedAt);
        if (!parsed.date) return { ok: false, esclarecimento: parsed.question };
        if (parsed.date !== turn.context.confirmedDate) clearSearch(turn.context);
        turn.context.confirmedDate = parsed.date;
        // Passos 3 e 4 feitos pelo sistema: com horário/duração na mesma mensagem, já lista as quadras; senão, a pergunta padrão.
        const asked = parseTimeDuration(turn.message);
        if (asked.start || asked.duration) {
          const found = await listFreeCourts(deps, turn.companyId, turn.context, parsed.date, asked.start, asked.duration);
          turn.availabilityReply = found.message;
          return { ok: true, data: parsed.date, quadras_livres: found.list.length };
        }
        // "Quais horários tem amanhã à noite?": primeiro os horários (por quadra), depois a pergunta.
        const period = parsePeriod(turn.message);
        if (period || isTimesQuestion(turn.message)) {
          turn.availabilityReply = await dayScheduleReply(deps, turn.companyId, turn.context, parsed.date, period);
          turn.facts.availabilityChecked = true;
          return { ok: true, data: parsed.date, horarios_enviados: true };
        }
        turn.availabilityReply = askTimeAndDuration(parsed.date);
        return { ok: true, data: parsed.date, apresentacao: displayDate(parsed.date) };
      }),
    define('perguntar_data', 'Pergunta para qual dia o cliente quer reservar. Use quando ele quiser reservar e ainda não disse a data. O sistema envia a pergunta pronta; não escreva nada.', empty,
      async (_args, turn) => reply(turn, DATE_QUESTION)),
    define('consultar_precos', 'Envia os valores reais por hora de cada quadra (com a variação por dia e horário, quando houver). Use quando o cliente perguntar preço, valor ou quanto custa. O sistema envia a mensagem pronta; não escreva nada.', empty,
      async (_args, turn) => { turn.facts.pricesChecked = true; turn.context.priceAsked = true; return reply(turn, await priceReply(turn.companyId, turn.context.confirmedDate ? String(turn.context.confirmedDate) : undefined)); }),
    define('consultar_quadras_livres', 'Lista as quadras livres na data resolvida, conforme o que o cliente informou: horário e duração, só a duração ou só o horário. Informe null no que o cliente não disse. O sistema envia a lista numerada ao cliente.',
      z.object({ data: z.string().describe('Data resolvida AAAA-MM-DD'), inicio: z.string().nullable().describe('Horário de início HH:MM dito pelo cliente, ou null'), duracao_minutos: duration.nullable().describe(`Minutos (de 60 a ${t.maxDuration}) se o cliente disse a duração, ou null`) }),
      async (args, turn) => {
        const day = String(args.data || ''), start = args.inicio ? String(args.inicio) : null, minutes = (args.duracao_minutos ?? null) as Duration | null;
        if (day !== turn.context.confirmedDate) return { ok: false, erro: 'Resolva a data com interpretar_data antes de listar as quadras.' };
        if (start && !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return { ok: false, erro: 'Horário inválido. Pergunte o horário no formato HH:MM.' };
        if (!start && !minutes) return { ok: false, erro: `Pergunte o horário e a duração (${durationRangeText(turn.maxDuration)}) antes de listar as quadras.` };
        const found = await listFreeCourts(deps, turn.companyId, turn.context, day, start, minutes);
        turn.facts.availabilityChecked = true;
        turn.availabilityReply = found.message;
        return { ok: true, quadras: found.list.map((c, index) => ({ numero: index + 1, quadra: c.name, esporte: c.sport })) };
      }),
    define('consultar_horarios', 'Lista os horários livres de uma quadra escolhida pelo cliente, na data resolvida e na duração. Use depois que o cliente escolher a quadra (quando ainda não houver horário definido). O sistema envia os horários ao cliente.',
      z.object({ quadra: courtChoice, data: z.string().describe('Data resolvida AAAA-MM-DD'), duracao_minutos: duration, periodo: z.enum(['todos', 'manha', 'tarde', 'noite']).nullable() }),
      async (args, turn) => {
        const day = String(args.data || ''), found = await pickCourt(deps, turn, String(args.quadra || '')), period = String(args.periodo || 'todos'), minutes = Number(args.duracao_minutos);
        if (day !== turn.context.confirmedDate) return { ok: false, erro: 'Resolva a data com interpretar_data antes de consultar horários.' };
        if (!found) return { ok: false, erro: 'Não sei qual quadra o cliente escolheu. Pergunte o número da lista enviada.' };
        const free = await deps.availability(turn.companyId, found.id, day, minutes), preview = deps.previewSlots(free.slots, period);
        turn.context.selectedCourtId = found.id; turn.context.selectedCourtName = found.name;
        turn.facts.availabilityChecked = true; turn.context.timesShown = true;
        turn.context.search = { ...(turn.context.search as object | undefined), date: day, duration: minutes };
        turn.availabilityReply = await deps.availableTimesReply(turn.companyId, found.id, day, minutes, period);
        return { ok: true, open: free.open, quadra: free.quadra, ...preview };
      }),
    define('preparar_reserva', 'Monta o pedido com quadra, data, início, duração e nome. Se a arena cobra pagamento antecipado e ainda não houver e-mail, chame com email_cliente null: o sistema explica o valor e pede o e-mail. O sistema envia o resumo com a pergunta "Confirma a reserva?".',
      z.object({ quadra: courtChoice, data: z.string().describe('Data AAAA-MM-DD'), inicio: z.string().describe('Horário HH:MM'), duracao_minutos: duration, nome_cliente: z.string(), email_cliente: z.string().nullable() }),
      async (args, turn) => {
        const found = await pickCourt(deps, turn, String(args.quadra || '')), day = String(args.data || ''), startTime = String(args.inicio || ''), minutes = Number(args.duracao_minutos);
        const customerName = String(args.nome_cliente || '').trim().slice(0, 100), customerEmail = String(args.email_cliente || '').trim().toLowerCase();
        if (day !== turn.context.confirmedDate) return { erro: 'Resolva a data com interpretar_data antes de preparar o pedido.' };
        if (!found) return { erro: 'Não sei qual quadra o cliente escolheu. Pergunte o número da lista enviada.' };
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return { erro: 'Horário inválido. Pergunte o horário de início.' };
        if (customerName.length < 2) return { erro: 'Pergunte o nome do cliente antes de preparar o pedido.' };
        const done = await prepareBookingSummary(deps, turn, { court: found, day, startTime, minutes, customerName, customerEmail });
        if ('erro' in done) return done;
        turn.facts.availabilityChecked = true;
        return reply(turn, done.reply);
      }),
  ];
  if (t.canConfirm) tools.push(define('confirmar_reserva', 'Registra o pedido depois que o cliente confirmar o resumo. Com pagamento antecipado, o sistema já envia o Pix.', empty,
    async (_args, turn) => {
      const done = await confirmPendingBooking(deps, turn);
      if (done.error) return { erro: done.error };
      turn.facts.bookingCreated = true; turn.facts.pixSent = done.pixSent;
      turn.bookingReply = done.reply;
      return { solicitacao_criada: true, pagamento: done.paymentStatus };
    }));
  return tools;
}

/** Depois de cada rodada de ferramentas: respostas prontas do sistema encerram a rodada; senão, a IA continua. */
const finishWithSystemReply: ToolToFinalOutputFunction = (runContext) => {
  const t = (runContext as RunContext<Turn>).context;
  const text = t.directReply ?? t.bookingReply ?? t.availabilityReply;
  if (text === undefined) return { isFinalOutput: false, isInterrupted: undefined };
  t.fromSystem = true;
  return { isFinalOutput: true, isInterrupted: undefined, finalOutput: text };
};

/** Entrada: corta rajadas de mensagens (robôs, colar texto em partes) sem gastar a IA. */
const floodGuard: InputGuardrail = {
  name: 'excesso_de_mensagens', runInParallel: false,
  execute: async ({ context }) => {
    const t = (context as RunContext<Turn>).context, since = new Date(Date.now() - 2 * 60_000).toISOString();
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(whatsappMessages).where(and(eq(whatsappMessages.companyId, t.companyId), eq(whatsappMessages.phone, t.phone), eq(whatsappMessages.direction, 'in'), gte(whatsappMessages.createdAt, since)));
    return { tripwireTriggered: (row?.n ?? 0) > 20, outputInfo: { recent: row?.n ?? 0 } };
  },
};

const SOFT_KINDS = new Set(['disponibilidade', 'preco', 'robo']);
const CORRECTIONS: Record<string, string> = {
  disponibilidade: 'Você não consultou a agenda nesta rodada, então não pode dizer se um horário está livre ou ocupado. Use consultar_horarios ou consultar_quadras_livres, ou pergunte o que falta.',
  preco: 'Você não consultou os valores. Chame consultar_precos; nunca cite valores de cabeça.',
  robo: 'Não explique formatos nem dê exemplos ("pode ser uma data…", "em intervalos de 30 minutos"). Para a data chame perguntar_data; para o resto responda de forma curta e natural.',
  pix: 'O Pix não foi enviado por você. Não afirme envio de Pix.',
  cancelamento: 'Nada foi cancelado. Não afirme cancelamento.',
  reserva: 'Nenhuma reserva foi feita. Não afirme reserva feita.',
};

const honestyGuard: OutputGuardrail = {
  name: 'sem_promessas_falsas',
  execute: async ({ agentOutput, context }) => {
    const t = (context as RunContext<Turn>).context;
    const claim = t.fromSystem ? undefined : unsupportedClaim(String(agentOutput ?? ''), t.facts);
    return { tripwireTriggered: Boolean(claim), outputInfo: claim ?? {} };
  },
};

export type AgentTurnInput = { companyId: string; session: string; phone: string; context: Record<string, unknown>; message: string; canConfirm: boolean; receivedAt: Date };

/** Atende uma mensagem com o agente de IA e devolve o texto a enviar ('' = nada a enviar). */
export async function runWhatsAppAgent(deps: AgentDeps, input: AgentTurnInput): Promise<string> {
  ensureClient();
  const { companyId, phone } = input;
  const [company, contact, bot, courtRows] = await Promise.all([
    db.select({ name: companies.name, publicOptions: companies.publicOptions }).from(companies).where(eq(companies.id, companyId)).limit(1).then((r) => r[0]),
    db.select({ name: clients.name, email: clients.email }).from(clients).where(and(eq(clients.companyId, companyId), eq(clients.phone, phone))).limit(1).then((r) => r[0]),
    deps.botConfig(companyId),
    db.select({ name: courts.name }).from(courts).where(and(eq(courts.companyId, companyId), eq(courts.active, true))),
  ]);
  const paymentRequired = bot.paymentMode !== 'none' && await deps.mercadoPagoConnected(companyId);
  const turn: Turn = { ...input, bot, paymentRequired, maxDuration: maxDurationOf(company?.publicOptions), facts: { bookingCreated: false, bookingsListed: false, pixSent: false, availabilityChecked: false, pricesChecked: false }, fromSystem: false };
  const session = new WhatsAppHistorySession(companyId, phone, input.message);
  const agent = (correction = '') => new Agent<Turn>({
    name: 'Atendente de reservas',
    instructions: instructions(turn, company?.name || '', contact?.name || '', Boolean(contact?.email)) + correction,
    model: process.env.WHATSAPP_AI_MODEL || 'gpt-4.1-mini',
    // store:false — a API Responses guardaria as conversas na OpenAI por padrão; o histórico fica só no nosso banco.
    modelSettings: { temperature: 0.3, toolChoice: 'auto', store: false },
    tools: buildTools(deps, turn, courtRows.map((c) => c.name)),
    toolUseBehavior: finishWithSystemReply,
    inputGuardrails: [floodGuard],
    outputGuardrails: [honestyGuard],
  });
  const attempt = async (correction = '') => {
    turn.directReply = turn.bookingReply = turn.availabilityReply = undefined; turn.fromSystem = false;
    const result = await run(agent(correction), input.message, { context: turn, session, maxTurns: 5 });
    const text = typeof result.finalOutput === 'string' ? result.finalOutput.trim() : '';
    return turn.fromSystem ? text : (text || EMPTY_FALLBACK).slice(0, 1800);
  };
  try {
    try { return await attempt(); }
    catch (error) {
      if (!(error instanceof OutputGuardrailTripwireTriggered)) throw error;
      const claim = error.result.output.outputInfo as { kind: string; excerpt: string };
      simulationNote('note', `Guardrail: a IA afirmou "${claim.excerpt}" sem o sistema ter feito isso. Pedindo nova resposta.`);
      console.warn('whatsapp_ai_guardrail', { companyId, kind: claim.kind });
      return await attempt(`\nATENÇÃO: sua resposta anterior continha "${claim.excerpt}". ${CORRECTIONS[claim.kind] ?? 'O sistema não registrou essa ação. Não a afirme; use as ferramentas ou diga o próximo passo real.'}`);
    }
  } catch (error) {
    if (error instanceof InputGuardrailTripwireTriggered) { simulationNote('note', 'Guardrail de entrada: muitas mensagens seguidas; a IA não foi chamada.'); return FLOOD_REPLY; }
    if (error instanceof OutputGuardrailTripwireTriggered && SOFT_KINDS.has((error.result.output.outputInfo as { kind?: string }).kind ?? '')) {
      // Disponibilidade, preço e frases de robô não justificam chamar a equipe: o sistema responde com o texto certo.
      simulationNote('note', 'Guardrail bloqueou a resposta de novo; o sistema respondeu com o texto padrão.');
      if ((error.result.output.outputInfo as { kind?: string }).kind === 'preco') { turn.facts.pricesChecked = true; return priceReply(companyId, turn.context.confirmedDate ? String(turn.context.confirmedDate) : undefined); }
      return turn.context.confirmedDate ? askTimeAndDuration(String(turn.context.confirmedDate)) : DATE_QUESTION;
    }
    if (error instanceof OutputGuardrailTripwireTriggered || error instanceof MaxTurnsExceededError) {
      if (error instanceof OutputGuardrailTripwireTriggered) simulationNote('note', 'Guardrail bloqueou a resposta de novo; a equipe foi chamada.');
      await handoff(companyId, phone, 'O agente não conseguiu concluir o pedido', input.message);
      turn.context.handoff = true;
      return HANDOFF_FALLBACK;
    }
    throw error;
  }
}
