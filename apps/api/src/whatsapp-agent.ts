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
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { appAudit, clients, companies, courts, whatsappDeliveries, whatsappMessages } from '@quadrasflow/database';
import { db } from './database.js';
import { displayDate, localNow, parseArenaDate } from './arena-dates.js';
import { chargeAmountCents, type PaymentPolicy } from './payment-policy.js';
import { arenaInformation, handoff, ownBookings, prepareCancellation, queueCourtPhotos } from './whatsapp-services.js';
import { deliverOne } from './whatsapp-delivery-worker.js';
import { simulationNote } from './whatsapp-simulation.js';
import { unsupportedClaim } from './whatsapp-agent-claims.js';
import { freeCourtsMessage, parseTimeDuration, searchFreeCourts, type Duration } from './whatsapp-court-search.js';
import { dateSaidByClient } from './whatsapp-date-guard.js';
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
  /** Resposta pronta que encerra a rodada imediatamente (atendente, cancelamento, fotos). */
  directReply?: string | undefined;
  /** Respostas formatadas pelo sistema que substituem o texto da IA ao fim da rodada de ferramentas. */
  bookingReply?: string | undefined; availabilityReply?: string | undefined;
  /** O que as ferramentas realmente fizeram, para o guardrail de saída. */
  facts: { bookingCreated: boolean; bookingsListed: boolean; pixSent: boolean };
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

function instructions(t: Turn, companyName: string, savedCustomerName: string) {
  const c = t.context, now = localNow(t.bot.timeZone || 'America/Belem', t.receivedAt);
  const tomorrow = new Date(`${now.date}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const search = c.search as { date?: string; start?: string | null; duration?: number | null } | undefined;
  const pending = c.pendingBooking as PendingBooking | undefined;
  const state = [
    `Data escolhida: ${c.confirmedDate ? `${displayDate(String(c.confirmedDate))} (use ${c.confirmedDate} nas ferramentas)` : 'nenhuma'}.`,
    search ? `Última busca de quadras: ${search.start ? `início ${search.start}` : 'sem horário'}, ${search.duration ? `${search.duration} minutos` : 'sem duração'} (lista numerada já enviada ao cliente).` : 'Nenhuma lista de quadras enviada ainda.',
    `Quadra escolhida pelo cliente: ${c.selectedCourtName || 'nenhuma'}.`,
    `Nome salvo do cliente: ${savedCustomerName || 'nenhum'}.`,
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
1. Se o cliente só cumprimentar, ofereça: 1️⃣ Reservar uma quadra e 2️⃣ Falar com a equipe. Se ele escolher reservar sem dizer a data, pergunte: "Ótimo! Para qual dia você quer reservar a quadra? 📅".
2. Data: chame interpretar_data com a expressão que o cliente escreveu. Nunca presuma a data.
3. Depois de interpretar_data, o sistema já envia a pergunta de horário e duração ou, se o cliente já disse horário ou duração, a lista numerada de quadras livres. Não acrescente nada.
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
- Durações possíveis: 1h, 1h30 ou 2h.
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
export const askTimeAndDuration = (day: string) => `📅 ${displayDate(day)}. Para listar somente as quadras livres, qual horário e duração você prefere: 1h, 1h30 ou 2h?`;

/** Busca as quadras livres, guarda a lista no contexto e devolve a mensagem numerada (passo 4). */
export async function listFreeCourts(deps: AgentDeps, companyId: string, context: Record<string, unknown>, day: string, start: string | null, duration: Duration | null) {
  const active = await db.select({ id: courts.id, name: courts.name, sport: courts.sport }).from(courts).where(and(eq(courts.companyId, companyId), eq(courts.active, true))).orderBy(asc(courts.name));
  const list = await searchFreeCourts(active, day, start, duration, (courtId, date, minutes) => deps.availability(companyId, courtId, date, minutes));
  clearSearch(context);
  context.confirmedDate = day; context.search = { date: day, start, duration }; context.courtOptions = list.map((c) => c.id);
  return { message: freeCourtsMessage(displayDate(day), start, duration, list), list };
}

/** Esquece a busca anterior (data, quadra escolhida, lista) para não arrastar escolhas antigas. */
function clearSearch(context: Record<string, unknown>) {
  for (const key of ['search', 'courtOptions', 'selectedCourtId', 'selectedCourtName', 'pendingBooking', 'awaitingEmail', 'awaitingTimeChoice', 'awaitingCourtChoice', 'intervalStage', 'intervalReservation', 'pendingDate', 'confirmedInterval']) delete context[key];
}
/** Quadra pelo número da última lista enviada ou pelo nome. */
async function pickCourt(deps: AgentDeps, turn: Turn, value: string) {
  const options = Array.isArray(turn.context.courtOptions) ? (turn.context.courtOptions as unknown[]).map(String) : [];
  const number = value.trim().match(/^(?:quadra\s*|op[cç][aã]o\s*)?(\d{1,2})$/i);
  if (number && options.length) { const id = options[Number(number[1]) - 1]; return id ? deps.resolveCourt(turn.companyId, id) : undefined; }
  return deps.resolveCourt(turn.companyId, value);
}

/** Ferramentas do agente. As de reserva só existem quando fazem sentido nesta rodada (ex.: confirmar só depois do "sim"). */
function buildTools(deps: AgentDeps, t: Turn, courtNames: string[]) {
  const court = courtNames.length ? z.enum(courtNames as [string, ...string[]]) : z.string();
  const duration = z.union([z.literal(60), z.literal(90), z.literal(120)]);
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
    define('enviar_fotos_quadra', 'Envia fotos reais da quadra somente quando o cliente pedir. Se a quadra não estiver clara, pergunte qual antes de chamar.', z.object({ quadra: court }),
      async (args, turn) => {
        const c = turn.context;
        if (!c.photoRequested) return reply(turn, 'Você quer ver as fotos de qual quadra?');
        const found = await deps.resolveCourt(turn.companyId, String(args.quadra || ''));
        if (!found) return { erro: 'Pergunte qual quadra o cliente quer ver.' };
        delete c.photoRequested;
        const queued = await queueCourtPhotos(turn.companyId, turn.phone, found.id, String(c.serviceRequestId || randomUUID()));
        if (!queued.ids) return reply(turn, queued.mensagem!);
        for (const id of queued.ids) await deliverOne(id);
        const sent = await db.select({ status: whatsappDeliveries.status }).from(whatsappDeliveries).where(sql`${whatsappDeliveries.id} IN (${sql.join(queued.ids.map((id) => sql`${id}`), sql`,`)})`);
        const count = sent.filter((r) => r.status === 'sent').length;
        return reply(turn, count === queued.ids.length ? '' : count ? `Enviei ${count} foto(s). Não consegui confirmar o envio das demais; a equipe pode ajudar.` : 'Não consegui confirmar o envio das fotos agora. A equipe pode ajudar.');
      }),
    define('listar_minhas_reservas', 'Lista apenas as próximas reservas deste contato nesta arena para escolher qual cancelar.', empty,
      async (_args, turn) => {
        const list = await ownBookings(turn.companyId, turn.phone);
        turn.context.cancellationFlow = true; turn.context.cancellationOptions = list; turn.facts.bookingsListed = true;
        if (!list.length) { delete turn.context.cancellationFlow; return reply(turn, 'Não encontrei reservas futuras para este contato.'); }
        return { reservas: list };
      }),
    define('preparar_cancelamento', 'Verifica a política e pede confirmação para cancelar uma reserva do contato. Ainda não cancela. Use o id retornado por listar_minhas_reservas.', z.object({ reserva_id: z.string() }),
      async (args, turn) => {
        const prepared = await prepareCancellation(turn.companyId, turn.phone, String(args.reserva_id || ''));
        if (prepared.manual) { await handoff(turn.companyId, turn.phone, 'Cancelamento fora do prazo', turn.message); turn.context.handoff = true; return reply(turn, prepared.mensagem!); }
        delete turn.context.pendingBooking; delete turn.context.intervalStage; delete turn.context.intervalReservation;
        turn.context.pendingCancellation = prepared;
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
        return { ok: true, quadras: list.map((c, index) => ({ numero: index + 1, quadra: c.name, esporte: c.sport, preco_hora: brl(c.priceCents) })) };
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
          return { ok: false, erro: 'O cliente ainda não disse a data. Pergunte para qual dia ele quer reservar; não presuma hoje nem amanhã.' };
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
        turn.availabilityReply = askTimeAndDuration(parsed.date);
        return { ok: true, data: parsed.date, apresentacao: displayDate(parsed.date) };
      }),
    define('consultar_quadras_livres', 'Lista as quadras livres na data resolvida, conforme o que o cliente informou: horário e duração, só a duração ou só o horário. Informe null no que o cliente não disse. O sistema envia a lista numerada ao cliente.',
      z.object({ data: z.string().describe('Data resolvida AAAA-MM-DD'), inicio: z.string().nullable().describe('Horário de início HH:MM dito pelo cliente, ou null'), duracao_minutos: duration.nullable().describe('60, 90 ou 120 se o cliente disse a duração, ou null') }),
      async (args, turn) => {
        const day = String(args.data || ''), start = args.inicio ? String(args.inicio) : null, minutes = (args.duracao_minutos ?? null) as Duration | null;
        if (day !== turn.context.confirmedDate) return { ok: false, erro: 'Resolva a data com interpretar_data antes de listar as quadras.' };
        if (start && !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return { ok: false, erro: 'Horário inválido. Pergunte o horário no formato HH:MM.' };
        if (!start && !minutes) return { ok: false, erro: 'Pergunte o horário e a duração (1h, 1h30 ou 2h) antes de listar as quadras.' };
        const found = await listFreeCourts(deps, turn.companyId, turn.context, day, start, minutes);
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
        const free = await deps.availability(turn.companyId, found.id, day, minutes), slot = free.slots.find((x) => x.inicio === startTime);
        if (!slot) return { erro: 'Esse horário não está livre nessa quadra. Ofereça os horários livres dela com consultar_horarios.' };
        turn.context.selectedCourtId = found.id; turn.context.selectedCourtName = found.name;
        const pix = brl(chargeAmountCents(slot.amountCents, turn.bot));
        if (turn.paymentRequired && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
          turn.context.awaitingEmail = true;
          return reply(turn, `Para garantir a reserva, a arena pede um pagamento antecipado de ${pix} via Pix (valor total ${slot.valor}).\n\nQual é o seu e-mail? Ele é usado só para gerar o Pix.`);
        }
        delete turn.context.awaitingEmail;
        const pending: PendingBooking = { courtId: found.id, courtName: found.name, date: day, startTime, durationMinutes: minutes, customerName, customerEmail, amountCents: slot.amountCents, createdAt: new Date().toISOString() };
        turn.context.pendingBooking = pending;
        const end = deps.timeHH(Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + minutes);
        return reply(turn, `📝 Confira seu pedido:\n\n🏟️ Quadra: ${found.name}\n📅 Data: ${displayDate(day)}\n🕒 Horário: ${startTime} às ${end}\n⏱️ Duração: ${minutes} minutos\n💰 Valor total: ${slot.valor}\n${turn.paymentRequired ? `💳 Pix agora: ${pix}` : '👤 O pagamento é feito na arena.'}\n\nConfirma a reserva?`);
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
  const [company, savedClient, bot, courtRows] = await Promise.all([
    db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1).then((r) => r[0]),
    db.select({ name: clients.name }).from(clients).where(and(eq(clients.companyId, companyId), eq(clients.phone, phone))).limit(1).then((r) => r[0]),
    deps.botConfig(companyId),
    db.select({ name: courts.name }).from(courts).where(and(eq(courts.companyId, companyId), eq(courts.active, true))),
  ]);
  const paymentRequired = bot.paymentMode !== 'none' && await deps.mercadoPagoConnected(companyId);
  const turn: Turn = { ...input, bot, paymentRequired, facts: { bookingCreated: false, bookingsListed: false, pixSent: false }, fromSystem: false };
  const session = new WhatsAppHistorySession(companyId, phone, input.message);
  const agent = (correction = '') => new Agent<Turn>({
    name: 'Atendente de reservas',
    instructions: instructions(turn, company?.name || '', savedClient?.name || '') + correction,
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
      return await attempt(`\nATENÇÃO: sua resposta anterior afirmou "${claim.excerpt}", mas o sistema não registrou essa ação. Responda de novo sem afirmar ${claim.kind === 'pix' ? 'envio de Pix' : claim.kind === 'cancelamento' ? 'cancelamento' : 'reserva feita'}; use as ferramentas ou diga o próximo passo real.`);
    }
  } catch (error) {
    if (error instanceof InputGuardrailTripwireTriggered) { simulationNote('note', 'Guardrail de entrada: muitas mensagens seguidas; a IA não foi chamada.'); return FLOOD_REPLY; }
    if (error instanceof OutputGuardrailTripwireTriggered || error instanceof MaxTurnsExceededError) {
      if (error instanceof OutputGuardrailTripwireTriggered) simulationNote('note', 'Guardrail bloqueou a resposta de novo; a equipe foi chamada.');
      await handoff(companyId, phone, 'O agente não conseguiu concluir o pedido', input.message);
      turn.context.handoff = true;
      return HANDOFF_FALLBACK;
    }
    throw error;
  }
}
