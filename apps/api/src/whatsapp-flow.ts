// Passos fixos do atendimento do WhatsApp (sem banco, para poder testar isolado).
// O sistema envia estes textos; a IA não os reescreve (evita frases com cara de robô).

import { durationLabel } from './booking-duration.js';

export const DATE_QUESTION = 'Ótimo! Para qual dia você quer reservar a quadra? 📅';
export const NAME_QUESTION = 'Perfeito! Qual é o seu nome para registrar a reserva?';

export const norm = (value: string) => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const brlShort = (cents: number) => `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const joinOu = (items: string[]) => items.join(', ').replace(/, ([^,]*)$/, ' ou $1');

/** Cumprimento puro ("oi", "bom dia", "boa tarde, tudo bem?"): ganha o menu de boas-vindas. */
export const isGreeting = (text: string) => /^(?:oi+|ola+|opa|eai|e ai|hey|hello|bom dia|boa tarde|boa noite)(?:[\s,!.]+(?:tudo bem|td bem|tudo certo))?[\s!?.,😊🙂👋]*$/.test(norm(text));

export const welcomeMenu = (arena: string, welcome: string) => `Olá! Bem-vindo à *${arena}*! 😊\n\n${welcome}\n\n1️⃣ Reservar uma quadra\n2️⃣ Falar com a equipe`;

const DATE_WORDS = /\b(hoje|amanha|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|dia \d|semana que vem)\b|\d{1,2}\/\d{1,2}/;
const TIME_WORDS = /\b\d{1,2}\s*(?::\d{2}|h\d{0,2}|horas?)\b|\b(?:as|das|pras)\s+\d{1,2}\b/;
export const mentionsDate = (text: string) => DATE_WORDS.test(norm(text));

/** Pergunta de preço clara e curta ("quanto custa uma hora?", "qual o valor?"). */
export const isPriceQuestion = (text: string) => {
  const t = norm(text);
  return t.length <= 80 && /\b(quanto (?:custa|e|fica|sai|cobra|cobram|ta|esta)|qual (?:e )?o (?:valor|preco)|valores?|precos?|tabela de precos?)\b/.test(t);
};

/** Pedido claro de reservar sem data: o sistema faz a pergunta do dia. */
export const isReserveIntent = (text: string) => {
  const t = norm(text);
  // Quem fala da reserva que já tem (status, pagamento, cancelamento) não está pedindo uma nova.
  if (t.length > 90 || /\b(cancel|desmarc|desist|remarc|minha|minhas|tenho|tinha|fiz|feita|status|confirm|paguei|pix|mentir)/.test(t) || DATE_WORDS.test(t) || TIME_WORDS.test(t) || isPriceQuestion(t)) return false;
  return /\b(reservar|marcar|agendar|alugar)\b|\b(?:fazer|uma|nova) reserva\b/.test(t) || /\b(tem|ha|existe)\b.*\b(quadra|horario|vaga|livre)\b/.test(t);
};

/** Horário solto depois da lista de horários da quadra: "20", "20h", "às 20", "20:30", "20h30". */
export function parseBareTime(text: string): string | null {
  const m = norm(text).match(/^(?:(?:as|das|pras|para as|a partir das)\s*)?(\d{1,2})(?:(?::|h)(\d{2})|\s*(?:h|hs|hrs|horas?))?\s*(?:por favor|pf|pfv)?[\s.!]*$/);
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2] || 0);
  // Ninguém joga de madrugada por engano: "1", "2" ou "3" soltos são outra coisa (quadra, duração).
  if (hour < 5 || hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const ORDINALS: Record<string, number> = { primeira: 1, primeiro: 1, segunda: 2, segundo: 2, terceira: 3, terceiro: 3, quarta: 4, quarto: 4 };
const FILLER = new Set(['a', 'o', 'as', 'os', 'na', 'no', 'da', 'do', 'de', 'pode', 'ser', 'quero', 'queria', 'prefiro', 'vou', 'fica', 'com', 'pela', 'pelo', 'por', 'favor', 'quadra', 'opcao', 'numero', 'pra', 'para', 'essa', 'esse', 'mesmo', 'mesma', 'vai', 'pf', 'pfv', 'entao', 'ta', 'ok', 'bom', 'bora']);
/**
 * Quadra escolhida pelo cliente: número da lista ("2", "quadra 2", "opção 2"), ordinal ("a primeira") ou nome
 * ("pode ser a society 1", "a areia"). `courts` está na ordem da última lista enviada. Nome ambíguo devolve null.
 */
export function matchCourt(text: string, courts: ReadonlyArray<{ id: string; name: string }>): string | null {
  const t = norm(text).replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const number = t.match(/^(?:quadra|opcao|numero)?\s*(\d{1,2})$/);
  if (number) return courts[Number(number[1]) - 1]?.id ?? null;
  const ordinal = t.match(/\b(primeira|primeiro|segunda|segundo|terceira|terceiro|quarta|quarto)\b(?:\s+(?:quadra|opcao))?$/);
  if (ordinal && t.split(' ').length <= 5 && ORDINALS[ordinal[1]!]! <= courts.length) return courts[ORDINALS[ordinal[1]!]! - 1]!.id;
  const names = courts.map((c) => ({ id: c.id, name: norm(c.name) }));
  const exact = names.filter((c) => new RegExp(`(?:^|\\s)${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`).test(t));
  if (exact.length) {
    const longest = Math.max(...exact.map((c) => c.name.length)), best = exact.filter((c) => c.name.length === longest);
    return best.length === 1 ? best[0]!.id : null;
  }
  const words = t.split(' ').filter((w) => w && !FILLER.has(w));
  if (!words.length || words.length > 3) return null;
  const hits = names.filter((c) => words.every((w) => c.name.split(' ').includes(w)));
  return hits.length === 1 ? hits[0]!.id : null;
}

/** Só o horário é conhecido: pergunta a duração mostrando o que cabe naquela quadra. */
export function askDurationText(court: string, start: string, durations: readonly number[]) {
  const labels = durations.map(durationLabel);
  const fits = labels.length > 3 ? `de ${labels[0]} até ${labels.at(-1)}` : joinOu(labels);
  return `⏱️ Na ${court}, às ${start}, dá para jogar ${fits}. Qual duração você prefere?`;
}

/** Horário escolhido que não dá certo: diz o motivo antes da lista de horários livres. */
export const timeUnavailableText = (start: string, reason: 'passou' | 'ocupado') => (reason === 'passou' ? `Às ${start} já passou. 😅` : `Às ${start} a quadra já está reservada. 😕`);

type PriceCourt = { name: string; sport: string; priceCents: number };
type Tariff = { weekday: number; startTime: string; endTime: string; priceCents: number };
type OpenDay = { weekday: number; isOpen: boolean; openTime: string; closeTime: string };
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Menor e maior valor da hora de uma quadra nos dias e horários em que a arena abre. */
export function courtPriceRange(court: PriceCourt, tariffs: readonly Tariff[], days: readonly OpenDay[], weekday?: number) {
  const prices: number[] = [];
  for (const day of days) {
    if (!day.isOpen || (weekday !== undefined && day.weekday !== weekday)) continue;
    for (let t = minutesOf(day.openTime); t < minutesOf(day.closeTime); t += 30) {
      const hhmm = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      prices.push(tariffs.find((s) => s.weekday === day.weekday && s.startTime <= hhmm && hhmm < s.endTime)?.priceCents ?? court.priceCents);
    }
  }
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : { min: court.priceCents, max: court.priceCents };
}

/** Resposta de preço: uma linha por quadra e o convite para agendar. `dayLabel`/`weekday`: preço de um dia específico. */
export function priceMessage(courts: readonly PriceCourt[], tariffs: readonly Tariff[], days: readonly OpenDay[], dayLabel?: string, weekday?: number) {
  const lines = courts.map((court) => {
    const { min, max } = courtPriceRange(court, tariffs, days, weekday);
    const value = min === max ? `${brlShort(min)} por hora` : `varia de ${brlShort(min)} a ${brlShort(max)} por hora (depende ${weekday === undefined ? 'do dia e ' : ''}do horário)`;
    return `• ${court.name} · ${court.sport} — ${value}`;
  });
  return `💰 ${dayLabel ? `Valores em ${dayLabel}` : 'Valores'}:\n\n${lines.join('\n')}\n\nQuer agendar um horário? 📅`;
}

export type Period = 'manha' | 'tarde' | 'noite';
const PERIOD_LABEL: Record<Period, string> = { manha: 'de manhã', tarde: 'à tarde', noite: 'à noite' };
export const periodOf = (hhmm: string): Period => (hhmm < '12:00' ? 'manha' : hhmm < '18:00' ? 'tarde' : 'noite');
/** "amanhã à noite", "de manhã", "à tarde"; "boa noite" é cumprimento, não período. */
export function parsePeriod(text: string): Period | null {
  const t = norm(text).replace(/\b(?:bom dia|boa tarde|boa noite)\b/g, ' ');
  if (/\bmanha\b/.test(t)) return 'manha';
  if (/\btarde\b/.test(t)) return 'tarde';
  if (/\b(?:noite|noitinha)\b/.test(t)) return 'noite';
  return null;
}
/** Pedido de ver os horários ("quais horários vocês têm amanhã?"), sem um horário específico. */
export const isTimesQuestion = (text: string) => {
  const t = norm(text);
  if (t.length > 120 || TIME_WORDS.test(t) || /\b(cancel|minha reserva|pix|pagamento)\b/.test(t)) return false;
  return /\b(quais|qual|que)\b.*\b(horarios?|horas)\b/.test(t) || /\b(horarios?|vagas?|quadras?)\b.*\b(livres?|disponiveis|disponivel|vagos?)\b/.test(t) || /\btem\b.*\b(horarios?|vagas?)\b/.test(t) || /\bque horas\b/.test(t);
};
/** Só o período ("e à noite?", "de manhã"): pede outra faixa do mesmo dia. */
export const isPeriodOnly = (text: string) => norm(text).length <= 25 && parsePeriod(text) !== null;

const timesLine = (times: readonly string[]) => `🕒 ${times.join(' · ')}`;
const MAX_TIMES = 12;

/** Mensagem quando não há quadra livre no horário (ou duração) pedido: motivo + horários livres do dia. */
export function noCourtsMessage(a: { start: string | null; reason: 'passou' | 'ocupado' | null; durationText: string | null; today: boolean; times: readonly string[]; notice?: string | undefined; closed?: boolean }) {
  const first = a.start
    ? a.reason === 'passou' ? `Às ${a.start} já passou 😅` : `Às ${a.start} não tem quadra livre${a.durationText ? ` para ${a.durationText}` : ''} 😕`
    : `Não tem quadra livre${a.durationText ? ` para ${a.durationText}` : ''} nesse dia 😕`;
  if (a.closed) return 'Nesse dia a arena está fechada. Qual outro dia você prefere? 📅';
  if (!a.times.length) return `${first}\n\n${a.today ? 'Hoje já não tem mais horário livre. Quer ver amanhã ou outro dia? 📅' : 'Nesse dia não tem mais horário livre. Quer tentar outro dia? 📅'}`;
  // Com muitos horários, mostra os 12 mais próximos do pedido (a partir dele; se faltar, completa com os anteriores).
  const idx = a.start ? a.times.findIndex((t) => t >= a.start!) : 0, at = idx < 0 ? a.times.length : idx;
  const from = Math.min(at, Math.max(0, a.times.length - MAX_TIMES)), shown = a.times.slice(from, from + MAX_TIMES);
  return `${first}\n${a.notice ? `${a.notice}\n` : ''}\n${timesLine(shown)}\n\nQual deles você prefere?`;
}

/** Horários livres por quadra (com o esporte), quando o cliente pede para ver os horários do dia ou de um período. */
export function dayScheduleMessage(a: { dayLabel: string; period: Period | null; durationText: string | null; courts: ReadonlyArray<{ name: string; sport: string; times: readonly string[] }> }) {
  const where = a.period ? ` ${PERIOD_LABEL[a.period]}` : '';
  const withTimes = a.courts.filter((c) => c.times.length).sort((x, y) => y.times.length - x.times.length);
  if (!withTimes.length) return `📅 ${a.dayLabel}. Não tenho horários livres${where}${a.durationText ? ` para ${a.durationText}` : ''} nesse dia. Quer ver ${a.period ? 'outro período ou ' : ''}outro dia? 😊`;
  const MAX_COURTS = 6, shown = new Set(withTimes.slice(0, MAX_COURTS));
  const blocks = a.courts.filter((c) => !c.times.length || shown.has(c)).map((c) => c.times.length ? `🏟️ ${c.name} · ${c.sport}\n${timesLine(c.times)}` : `🏟️ ${c.name} · ${c.sport} — sem horários livres${where}`);
  const more = withTimes.length - shown.size;
  return `📅 ${a.dayLabel}. Horários livres${where}${a.durationText ? ` para ${a.durationText}` : ''}:\n\n${blocks.join('\n\n')}${more > 0 ? `\n\nTem mais ${more} ${more === 1 ? 'quadra' : 'quadras'} com horários livres; me diz o horário que eu mostro.` : ''}\n\nQue horas você quer jogar e por quanto tempo? 🙂`;
}
