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
  const scope = 'Use consultar_informacoes_arena para localização, Instagram e avaliação. Use enviar_fotos_quadra somente a pedido. Para cancelar, use listar_minhas_reservas e preparar_cancelamento; nunca diga que cancelou antes do sistema confirmar. Transfira com chamar_atendente quando pedirem uma pessoa ou quando o assunto estiver fora de informações, regras, fotos, reservas, cancelamentos e pagamentos da arena. Não responda assuntos gerais fora desse escopo.';
  const identity = `Você é o assistente de reservas da *${companyName || 'arena'}*. Atenda pelo WhatsApp em português brasileiro, com cordialidade, clareza e mensagens curtas. Use poucos emojis com sentido consistente: 📅 data, 🕒 horário, ⏱️ duração, 💰 valor, 💚 pagamento confirmado, 👤 equipe. Separe blocos de mensagem com linhas em branco.`;
  const clock = `Hoje é ${displayDate(now.date)}. Amanhã será ${displayDate(tomorrow.toISOString().slice(0, 10))}. Agora são ${now.time} no horário local da arena (${t.bot.timeZone}). Reavalie a data local a cada mensagem. Use somente dados desta arena retornados pelas ferramentas. Nunca invente quadras, valores, horários, disponibilidade ou status de pagamento.`;
  const booking = `Atenda primeiro à intenção expressa pela pessoa. Se ela já perguntar por horários, não reinicie pelo menu: identifique a data e o intervalo mencionados e use interpretar_data para datas naturais. Pergunte somente o dado que estiver faltando: não pergunte a quadra antes de saber data, horário e duração. Quando o intervalo exato vier sem uma quadra escolhida, aguarde o sistema verificar as quadras livres antes de pedir preferência; não apresente o catálogo geral como se fosse disponibilidade. Nunca narre consultas, chamadas de ferramenta, verificações ou o que você fará em seguida; faça o trabalho em silêncio e responda apenas com o resultado ou a pergunta necessária. Se a pessoa pedir uma reserva informando início e fim, primeiro pergunte somente “Você quer reservar das HH:MM às HH:MM, certo?” e aguarde a confirmação. Não consulte horários, não peça nome e não acrescente explicações antes dessa confirmação. Depois do “sim”, confira disponibilidade e valor com as ferramentas. Se estiver livre, peça o nome somente quando não houver nome salvo; quando houver, use o nome salvo. Se informar apenas o início, pergunte se deseja 1h, 1h30 ou 2h antes de pedir o nome. Se o intervalo não corresponder a 1h, 1h30 ou 2h, peça esclarecimento. Salve o nome com salvar_contato assim que a pessoa informar, mesmo antes de concluir a reserva. Nome já salvo para este telefone nesta arena: ${savedCustomerName || 'nenhum'}. Não pergunte novamente quando já existir. Intervalo confirmado e disponibilidade verificada pelo sistema: ${JSON.stringify(c.confirmedInterval || null)}. No primeiro contato, se a pessoa apenas cumprimentar sem dizer o que precisa, ofereça 1️⃣ Reservar uma quadra e 2️⃣ Falar com a equipe. Use interpretar_data para expressões naturais ou numéricas. Quando a data for válida e a quadra estiver escolhida, consulte os horários imediatamente. Diga a data completa junto dos horários. Se a ferramenta pedir esclarecimento, pergunte apenas isso. Não peça confirmação intermediária da data; a confirmação explícita acontece no resumo final da reserva. Mostre todos os horários livres retornados pela ferramenta, um por linha no formato 🕒 HH:MM. Se o cliente pedir um período, liste somente os horários daquele período. Nunca diga que não há vagas em um período sem consultar a ferramenta.`;
  const order = 'Antes de criar o pedido, use as ferramentas para consultar o horário completo, o preço e a disponibilidade. Mostre um resumo com quadra, data, início, fim, duração e valor. Peça confirmação explícita. Se houver cobrança antecipada, o pedido fica pendente até o Mercado Pago confirmar o pagamento. Sem cobrança antecipada, informe que a equipe confirmará o pedido. Nunca prometa Pix quando não houver cobrança ativa. Nunca trate a resposta do cliente como comprovante. Se o horário acabar, consulte novas opções.';
  const payment = `Depois de confirmar o pedido, se a ferramenta informar codigo_e_qr_enviados, avise que o QR Code e o Pix Copia e Cola foram enviados em mensagens separadas; se informar codigo_enviado_sem_imagem, avise que o código foi enviado; se informar falha_no_envio_do_pix, explique que a equipe verificará. Não repita nem invente um código Pix. Não peça senha, código de autenticação, dados de cartão ou chave Pix. Se pedirem atendente, encaminhe. Se a mensagem estiver confusa, repita apenas a pergunta atual com um exemplo curto. Contexto: ${JSON.stringify({ pendingBooking: c.pendingBooking || null, selectedCourtId: c.selectedCourtId || null, selectedCourtName: c.selectedCourtName || null, confirmedDate: c.confirmedDate || null, cancellationFlow: c.cancellationFlow || false, cancellationOptions: c.cancellationOptions || null, photoRequested: c.photoRequested || false, recadoParaEquipe: Boolean(c.awaitingTeam) })}.${c.awaitingTeam ? ` A equipe já recebeu um recado deste cliente e responde no horário de atendimento (das ${t.bot.humanStart} às ${t.bot.humanEnd}); não chame chamar_atendente de novo pelo mesmo assunto e continue ajudando com reservas e informações.` : ''}`;
  return [scope, identity, clock, booking, order, payment].join('\n');
}

/** Ferramentas do agente. As de reserva só existem quando fazem sentido nesta rodada (ex.: confirmar só depois do "sim"). */
function buildTools(deps: AgentDeps, t: Turn, courtNames: string[]) {
  const court = courtNames.length ? z.enum(courtNames as [string, ...string[]]) : z.string();
  const duration = z.union([z.literal(60), z.literal(90), z.literal(120)]);
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
    define('interpretar_data', 'Converte a data informada pelo cliente usando o relógio e o fuso da arena. Quando a data for válida, consulte a disponibilidade sem pedir confirmação intermediária. A confirmação explícita ocorre no resumo final da reserva.', z.object({ expressao: z.string() }),
      async (args, turn) => {
        const parsed = parseArenaDate(String(args.expressao || ''), turn.bot.timeZone, turn.receivedAt);
        if (!parsed.date) return { ok: false, esclarecimento: parsed.question };
        turn.context.confirmedDate = parsed.date; delete turn.context.pendingDate;
        return { ok: true, data: parsed.date, apresentacao: displayDate(parsed.date), instrucao: 'Data resolvida. Consulte horários da quadra escolhida agora; a confirmação será pedida no resumo final.' };
      }),
    define('consultar_horarios', 'Consulta todos os horários livres da data informada. Para filtrar por manhã, tarde ou noite, informe periodo. Nunca invente horários ou disponibilidade.',
      z.object({ quadra: court, data: z.string().describe('Data resolvida AAAA-MM-DD'), duracao_minutos: duration, periodo: z.enum(['todos', 'manha', 'tarde', 'noite']).nullable() }),
      async (args, turn) => {
        const day = String(args.data || ''), found = await deps.resolveCourt(turn.companyId, String(args.quadra || '')), period = String(args.periodo || 'todos'), minutes = Number(args.duracao_minutos);
        if (day !== turn.context.confirmedDate) return { ok: false, erro: 'Resolva a data com interpretar_data antes de consultar horários.' };
        if (!found) return { ok: false, erro: 'Não encontrei a quadra indicada. Liste as quadras e peça para o cliente escolher.' };
        const free = await deps.availability(turn.companyId, found.id, day, minutes), preview = deps.previewSlots(free.slots, period);
        turn.context.selectedCourtId = found.id; turn.context.selectedCourtName = found.name; turn.context.awaitingTimeChoice = true;
        turn.availabilityReply = await deps.availableTimesReply(turn.companyId, found.id, day, minutes, period);
        return { ok: true, open: free.open, quadra: free.quadra, ...preview };
      }),
    define('preparar_reserva', 'Prepara uma reserva depois de consultar a disponibilidade, obter o nome e, se houver Pix conectado, o e-mail real do cliente. Retorna um resumo e pede confirmação explícita.',
      z.object({ quadra: court, data: z.string().describe('Data AAAA-MM-DD'), inicio: z.string().describe('Horário HH:MM'), duracao_minutos: duration, nome_cliente: z.string(), email_cliente: t.paymentRequired ? z.string() : z.string().nullable() }),
      async (args, turn) => {
        const found = await deps.resolveCourt(turn.companyId, String(args.quadra || '')), day = String(args.data || ''), startTime = String(args.inicio || ''), minutes = Number(args.duracao_minutos);
        const customerName = String(args.nome_cliente || '').trim().slice(0, 100), customerEmail = String(args.email_cliente || '').trim().toLowerCase();
        if (day !== turn.context.confirmedDate) return { erro: 'Confirme a data com o cliente antes de preparar o pedido.' };
        if (!found || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || customerName.length < 2 || (turn.paymentRequired && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) return { erro: 'Informe uma quadra, horário válido, nome e, se houver Pix, e-mail real do cliente.' };
        const free = await deps.availability(turn.companyId, found.id, day, minutes), slot = free.slots.find((x) => x.inicio === startTime);
        if (!slot) return { erro: 'Esse horário não está livre. Ofereça horários da consulta de disponibilidade.' };
        const pending: PendingBooking = { courtId: found.id, courtName: found.name, date: day, startTime, durationMinutes: minutes, customerName, customerEmail, amountCents: slot.amountCents, createdAt: new Date().toISOString() };
        turn.context.pendingBooking = pending;
        const end = deps.timeHH(Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + minutes);
        return { preparada: true, resumo: `📝 *Confira seu pedido*\n\n🏟️ Quadra: ${found.name}\n📅 Data: ${displayDate(day)}\n🕒 Horário: ${startTime} às ${end}\n⏱️ Duração: ${minutes} minutos\n💰 Valor total: ${slot.valor}\n${turn.paymentRequired ? `💳 Pix agora: ${brl(chargeAmountCents(slot.amountCents, turn.bot))}` : '👤 Confirmação pela equipe, sem pagamento antecipado'}\n\nPeça confirmação explícita antes de registrar.` };
      }),
  ];
  if (t.canConfirm) tools.push(define('confirmar_reserva', 'Registra um pedido de reserva pendente após o cliente confirmar explicitamente o resumo. A arena ou o pagamento ainda precisam confirmar.', empty,
    async (_args, turn) => {
      const pending = turn.context.pendingBooking as PendingBooking | undefined;
      if (!pending) return { erro: 'Não há reserva aguardando confirmação.' };
      try {
        const item = await deps.createConfirmedBooking(turn.companyId, turn.phone, pending);
        let paymentStatus = turn.bot.paymentMode === 'none' ? 'sem_cobranca' : 'sem_mercado_pago';
        if (turn.paymentRequired && item.amountCents > 0) {
          try { paymentStatus = await deps.sendBookingPix(turn.companyId, turn.session, turn.phone, item.id, pending.customerEmail || ''); }
          catch (error) { console.error('whatsapp_pix_send_failed', error instanceof Error ? error.message : 'unknown'); paymentStatus = 'falha_no_envio_do_pix'; }
        }
        await db.insert(appAudit).values({ id: randomUUID(), companyId: turn.companyId, userId: null, action: 'whatsapp.booking.created', entity: 'booking', entityId: item.id, details: { paymentStatus }, createdAt: new Date().toISOString() });
        delete turn.context.pendingBooking;
        turn.facts.bookingCreated = true; turn.facts.pixSent = ['codigo_e_qr_enviados', 'codigo_enviado_sem_imagem', 'ja_enviado'].includes(paymentStatus);
        turn.bookingReply = turn.facts.pixSent ? '' : paymentStatus === 'falha_no_envio_do_pix' ? 'Seu pedido foi registrado e está aguardando pagamento, mas não consegui enviar o Pix. A equipe vai verificar.' : 'Seu pedido foi registrado e está pendente de confirmação pela equipe.';
        return { solicitacao_criada: true, status: 'pendente', quadra: item.courtName, valor_total: brl(item.amountCents), pix_agora: turn.paymentRequired ? brl(chargeAmountCents(item.amountCents, turn.bot)) : null, pagamento: paymentStatus };
      } catch (error) {
        delete turn.context.pendingBooking;
        return { erro: error instanceof Error ? error.message : 'O horário não está mais disponível. Consulte novamente.' };
      }
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
