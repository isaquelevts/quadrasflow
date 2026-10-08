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
const FILLER = new Set(['a', 'o', 'as', 'os', 'na', 'no', 'da', 'do', 'de', 'pode', 'ser', 'quero', 'queria', 'prefiro', 'vou', 'fica', 'com', 'pela', 'pelo', 'por', 'favor', 'quadra', 'opcao', 'numero', 'pra', 'para', 'essa', 'esse', 'mesmo', 'mesma', 'vai', 'pf', 'pfv', 'entao', 'ta', 'ok', 'bom', 'bora', 'hrs', 'hs', 'hora', 'horas', 'h', 'ate', 'das', 'dia']);
/**
 * Quadra escolhida pelo cliente: número da lista ("2", "quadra 2", "opção 2"), ordinal ("a primeira") ou nome
 * ("pode ser a society 1", "a areia"). `courts` está na ordem da última lista enviada. Nome ambíguo devolve null.
 */
export function matchCourt(text: string, courts: ReadonlyArray<{ id: string; name: string }>, allowNumber = true): string | null {
  const t = norm(text).replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const number = allowNumber ? t.match(/^(?:quadra|opcao|numero)?\s*(\d{1,2})$/) : null;
  if (number) return courts[Number(number[1]) - 1]?.id ?? null;
  const ordinal = allowNumber ? t.match(/\b(primeira|primeiro|segunda|segundo|terceira|terceiro|quarta|quarto)\b(?:\s+(?:quadra|opcao))?$/) : null;
  if (ordinal && t.split(' ').length <= 5 && ORDINALS[ordinal[1]!]! <= courts.length) return courts[ORDINALS[ordinal[1]!]! - 1]!.id;
  const names = courts.map((c) => ({ id: c.id, name: norm(c.name) }));
  const exact = names.filter((c) => new RegExp(`(?:^|\\s)${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`).test(t));
  if (exact.length) {
    const longest = Math.max(...exact.map((c) => c.name.length)), best = exact.filter((c) => c.name.length === longest);
    return best.length === 1 ? best[0]!.id : null;
  }
  // Horário ou duração dito na mesma frase ("a areia às 20", "2 horas") não faz parte do nome da quadra.
  const nameWords = new Set(names.flatMap((c) => c.name.split(' ')));
  const words = t.split(' ').filter((w) => w && !FILLER.has(w) && !(/^\d{1,2}(?::\d{2})?(?:h|hs|hrs|horas?)?(?:\d{2})?$/.test(w) && !nameWords.has(w)));
  // Só números não identificam uma quadra: sem lista numerada podem ser duração ou horário.
  if (!words.some((w) => /\D/.test(w)) || words.length > 3) return null;
  const hits = names.filter((c) => words.every((w) => c.name.split(' ').includes(w)));
  return hits.length === 1 ? hits[0]!.id : null;
}

export const MAX_END_OPTIONS = 8;
const clockText = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}h${String(min % 60).padStart(2, '0')}`;
/**
 * Só o horário de início é conhecido (e a quadra escolhida): mostra até onde dá para jogar, com o preço.
 * "10h00 – 11h00 (R$ 100)". Até 8 opções; se couber mais tempo, avisa.
 */
export function endOptionsText(court: string, start: string, options: ReadonlyArray<{ minutes: number; amountCents: number }>) {
  const s0 = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)), shown = options.slice(0, MAX_END_OPTIONS);
  const lines = shown.map((o) => `${clockText(s0)} – ${clockText(s0 + o.minutes)} (${brlShort(o.amountCents)})`);
  const more = options.length > shown.length ? `\n\nDá para jogar mais tempo também (até ${clockText(s0 + options.at(-1)!.minutes)}): é só me dizer até que horas.` : '';
  return `⏱️ ${court}, a partir das ${start}:\n\n${lines.join('\n')}${more}\n\nAté que horas você quer jogar?`;
}
/** Resposta à lista de fins: "12h", "até 12h", "12", "10 às 12", "das 10h às 11h30" → minutos de jogo a partir do início (ou null). */
export function parseEndAnswer(text: string, start: string): number | null {
  const t = norm(text).replace(/^(?:pode ser |vou querer |quero |entao |então )/, '').trim();
  const s0 = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const range = t.match(/^(?:das?\s*)?(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:as|a|ate|-|–)\s*(?:as\s*)?(\d{1,2})(?:[:h](\d{2}))?\s*h?$/);
  const end = range ? Number(range[3]) * 60 + Number(range[4] || 0) : (() => { const m = t.match(/^(?:ate\s*(?:as\s*)?|as\s*)?(\d{1,2})(?:[:h](\d{2}))?\s*(?:h|hs|horas?)?$/); return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null; })();
  if (range && Number(range[1]) * 60 + Number(range[2] || 0) !== s0) return null;
  if (end === null || end <= s0 || end > 24 * 60) return null;
  return end - s0;
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
/** Pedido para ver os horários ("quais horários vocês têm amanhã?", "tem reserva disponível amanhã?", "quais disponíveis?"), sem um horário específico. */
export const isTimesQuestion = (text: string) => {
  const t = norm(text);
  if (t.length > 120 || TIME_WORDS.test(t) || /\b(cancel|minha reserva|minhas reservas|pix|pagamento|remarc|reagend|endereco|valor|preco|quanto)/.test(t)) return false;
  return /\b(quais|qual|que)\b.*\b(horarios?|horas)\b/.test(t)
    || /\b(livres?|disponiveis|disponivel|disponibilidade|vagos?|vagas?|desocupad[ao]s?)\b/.test(t)
    || /\btem\b.*\b(horarios?|vagas?)\b/.test(t) || /\bque horas\b/.test(t)
    || (DATE_WORDS.test(t) && /\b(quais|o que tem|que tem|oque tem|o que voces tem|tem algo|tem alguma coisa)\b/.test(t));
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
export function dayScheduleMessage(a: { dayLabel: string; period: Period | null; durationText: string | null; courts: ReadonlyArray<{ name: string; sport: string; times: readonly string[]; block?: string | null }> }) {
  const where = a.period ? ` ${PERIOD_LABEL[a.period]}` : '';
  const withTimes = a.courts.filter((c) => c.times.length).sort((x, y) => y.times.length - x.times.length);
  if (!withTimes.length) return `📅 ${a.dayLabel}. Não tenho horários livres${where}${a.durationText ? ` para ${a.durationText}` : ''} nesse dia. Quer ver ${a.period ? 'outro período ou ' : ''}outro dia? 😊`;
  const MAX_COURTS = 6, shown = new Set(withTimes.slice(0, MAX_COURTS));
  const blocks = a.courts.filter((c) => !c.times.length || shown.has(c)).map((c) => c.times.length ? `🏟️ ${c.name} · ${c.sport}${c.block ? ` (reservas de ${c.block})` : ''}\n${timesLine(c.times)}` : `🏟️ ${c.name} · ${c.sport} — sem horários livres${where}`);
  const more = withTimes.length - shown.size;
  return `📅 ${a.dayLabel}. Horários livres${where}${a.durationText ? ` para ${a.durationText}` : ''}:\n\n${blocks.join('\n\n')}${more > 0 ? `\n\nTem mais ${more} ${more === 1 ? 'quadra' : 'quadras'} com horários livres; me diz o horário que eu mostro.` : ''}\n\nQue horas você quer jogar e por quanto tempo? 🙂`;
}

/** Pedido de fotos ("me mande fotos das quadras", "tem imagem?", "quero ver a quadra"). */
export const isPhotoRequest = (text: string) => {
  const t = norm(text);
  if (t.length > 140 || /\b(comprovante|pix|pagamento|paguei)\b/.test(t)) return false;
  return /\b(fotos?|fotinhas?|imagens?)\b/.test(t) || /\b(quero|queria|posso|pode|da pra|dá pra) (?:eu )?(?:ver|conhecer)\b.*\b(quadras?|arena)\b/.test(t) || /\bcomo (?:e|sao|ficam?) (?:a|as|o|os) (?:quadras?|arena)\b/.test(t);
};
/** "todas", "das 3", "as três", "de todas as quadras": o cliente quer as fotos de todas as quadras. */
export function isAllCourts(text: string, count: number) {
  const t = norm(text).replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(todas|todos|tudo|todinhas)\b/.test(t)) return true;
  const words: Record<string, number> = { duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };
  const m = t.match(/\b(?:das|as|de|nas|com as)\s+(\d{1,2}|duas|dois|tres|quatro|cinco|seis)(?:\s+quadras?)?$/);
  if (!m) return false;
  const n = words[m[1]!] ?? Number(m[1]);
  return count > 1 && n === count;
}
/** Pergunta fixa quando o cliente pede fotos sem dizer de qual quadra. */
export const photoQuestion = (names: readonly string[]) => `Claro! De qual quadra você quer ver as fotos? ${joinOu([...names])}? Se preferir, mando de todas. 📸`;
/** Texto depois do envio (ou da falha): o sistema sempre fecha a conversa, sem laço de perguntas. */
export function photosOutcome(a: { sent: number; failed: number; without: readonly string[] }): { text: string; handoff: boolean } {
  const names = a.without.join(', ').replace(/, ([^,]*)$/, ' e $1');
  const missing = a.without.length ? `${names} ainda ${a.without.length === 1 ? 'não tem' : 'não têm'} fotos cadastradas.` : '';
  if (a.failed > 0 && a.sent === 0) return { text: 'Não consegui enviar as fotos agora. Deixei um recado para a equipe te ajudar. 🙏', handoff: true };
  if (a.failed > 0) return { text: 'Enviei parte das fotos, mas não consegui enviar todas. Deixei um recado para a equipe completar. 🙏', handoff: true };
  if (a.sent === 0) return { text: `${missing || 'Ainda não tenho fotos dessa quadra.'}\n\nQuer agendar um horário? 📅`, handoff: false };
  return { text: `${missing ? `${missing}\n\n` : ''}Quer agendar um horário? 📅`, handoff: false };
}

/** Pedido de cancelamento ("cancelar minha reserva", "desmarcar", "não vou poder ir", "tive um imprevisto"). */
export const isCancelIntent = (text: string) => {
  const t = norm(text);
  if (t.length > 160 || /\bn[aã]o (?:quero|vou|precisa) (?:mais )?(?:cancelar|desmarcar)\b/.test(t) || /\bremarc|\breagend/.test(t)) return false;
  return /\b(cancelar|cancela|cancelamento|cancele|desmarcar|desmarca|desmarque|desistir|desisto)\b/.test(t) || /\bnao (?:vou|vamos|vai) (?:mais )?(?:poder|conseguir|dar pra|dar para)? ?(?:ir|jogar|comparecer)\b/.test(t) || /\bimprevisto\b/.test(t);
};

export type BookingOption = { id: string; court: string; start: string };
const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
/** Reserva escolhida pelo cliente numa lista: número ("1"), quadra ("a da society 1"), dia ("a de sexta", "dia 2", "02/10") ou os dois. */
export function pickBooking(text: string, options: readonly BookingOption[], today: string): string | null {
  const t = norm(text).replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const number = t.match(/^(?:a |o |reserva |opcao |numero )?(\d{1,2})(?:a|o)?$/);
  if (number) return options[Number(number[1]) - 1]?.id ?? null;
  let list = [...options];
  const courts = [...new Map(options.map((o) => [o.court, { id: o.court, name: o.court }])).values()];
  const court = courts.length > 1 ? matchCourt(t, courts, false) : null;
  if (court) list = list.filter((o) => o.court === court);
  const day = (iso: string) => iso.slice(0, 10), tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const weekday = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})\b/) || t.match(/\bdia (\d{1,2})\b/);
  let byDay: ((o: BookingOption) => boolean) | null = null;
  if (/\bhoje\b/.test(t)) byDay = (o) => day(o.start) === today;
  else if (/\bamanha\b/.test(t)) byDay = (o) => day(o.start) === tomorrow.toISOString().slice(0, 10);
  else if (weekday >= 0) byDay = (o) => new Date(`${day(o.start)}T12:00:00Z`).getUTCDay() === weekday;
  else if (dm) byDay = (o) => Number(o.start.slice(8, 10)) === Number(dm[1]) && (!dm[2] || Number(o.start.slice(5, 7)) === Number(dm[2]));
  if (byDay) list = list.filter(byDay);
  const time = t.match(/\b(\d{1,2})(?:[:h](\d{2}))?\s*h?\b/);
  if (time && !dm && Number(time[1]) >= 5 && Number(time[1]) <= 23) { const hh = `${time[1]!.padStart(2, '0')}:${time[2] ?? '00'}`, at = list.filter((o) => o.start.slice(11, 16) === hh); if (at.length) list = at; }
  return (court || byDay || time) && list.length === 1 ? list[0]!.id : null;
}

/** Pedido de remarcação ("remarcar", "mudar o horário", "passar para outro dia", "adiar"). */
export const isRescheduleIntent = (text: string) => {
  const t = norm(text);
  if (t.length > 160) return false;
  return /\b(remarcar|remarca|remarque|remarcacao|reagendar|reagenda|adiar|antecipar)\b/.test(t)
    || /\b(mudar|trocar|alterar|passar|mover)\b.{0,25}\b(horario|hora|dia|data|reserva)\b/.test(t)
    || /\bpassar (?:a reserva )?(?:para|pra) outro (?:dia|horario)\b/.test(t);
};

const money = (cents: number) => `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Resumo da remarcação: de → para, valor e o que acontece com o que já foi pago. */
export function rescheduleSummary(a: { from: string; to: string; amountCents: number; paidCents: number }) {
  const value = a.paidCents <= 0 ? `💰 Valor: ${money(a.amountCents)} (pago na arena)`
    : a.paidCents >= a.amountCents ? `💰 Valor: ${money(a.amountCents)} (já pago)${a.paidCents > a.amountCents ? `\nA diferença de ${money(a.paidCents - a.amountCents)} será devolvida pela equipe.` : ''}`
    : `💰 Valor: ${money(a.amountCents)} (${money(a.paidCents)} já pago; ${money(a.amountCents - a.paidCents)} na arena)`;
  return `🔁 Remarcar a reserva:\n\nDe: ${a.from}\nPara: ${a.to}\n${value}\n\nConfirma a remarcação?`;
}
/** Texto depois de remarcar. */
export function rescheduledText(a: { to: string; amountCents: number; paidCents: number }) {
  const extra = a.paidCents > a.amountCents ? `\n\nA diferença de ${money(a.paidCents - a.amountCents)} será devolvida pela equipe.` : a.paidCents > 0 && a.amountCents > a.paidCents ? `\n\nRestante a pagar na arena: ${money(a.amountCents - a.paidCents)}.` : '';
  return `Pronto! Sua reserva foi remarcada para ${a.to}. ✅${extra}\n\nAté lá! 🙂`;
}
