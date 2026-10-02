// Busca de quadras livres para o agente do WhatsApp (sem banco, para poder testar isolado).
// O cliente escolhe a quadra a partir desta lista; o agente nunca escolhe por ele.

export type SearchCourt = { id: string; name: string; sport: string };
export type SearchSlot = { inicio: string; valor: string; amountCents: number };
import { durationChoices, durationLabel, DEFAULT_MAX_DURATION } from './booking-duration.js';

export type Duration = number;
type Check = (courtId: string, day: string, durationMinutes: number) => Promise<{ slots: SearchSlot[] }>;

export type FreeCourt =
  | (SearchCourt & { mode: 'exato'; slot: SearchSlot })
  | (SearchCourt & { mode: 'duracao'; inicios: string[] })
  | (SearchCourt & { mode: 'inicio'; duracoes: Array<{ minutos: Duration; valor: string; amountCents: number }> });

export { durationLabel };
const endOf = (start: string, minutes: number) => { const total = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + minutes) % 1440; return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; };
const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const bullet = (index: number) => KEYCAPS[index] ?? `${index + 1}.`;

/**
 * Quadras livres conforme o que o cliente informou:
 * - horário e duração: livres naquele intervalo exato;
 * - só duração: com algum horário livre dessa duração no dia;
 * - só horário: livres começando naquele horário (com as durações possíveis até o máximo da arena).
 */
export async function searchFreeCourts(courts: readonly SearchCourt[], day: string, start: string | null, duration: Duration | null, check: Check, maxDuration = DEFAULT_MAX_DURATION): Promise<FreeCourt[]> {
  const results = await Promise.all(courts.map(async (court): Promise<FreeCourt | null> => {
    if (start && duration) {
      const slot = (await check(court.id, day, duration)).slots.find((s) => s.inicio === start);
      return slot ? { ...court, mode: 'exato', slot } : null;
    }
    if (duration) {
      const inicios = (await check(court.id, day, duration)).slots.map((s) => s.inicio);
      return inicios.length ? { ...court, mode: 'duracao', inicios } : null;
    }
    if (start) {
      const duracoes: Array<{ minutos: Duration; valor: string; amountCents: number }> = [];
      for (const minutos of durationChoices(maxDuration)) {
        const slot = (await check(court.id, day, minutos)).slots.find((s) => s.inicio === start);
        // Sem parar no primeiro "não": regras da quadra (horas cheias, horário nobre) podem barrar 1h e liberar 2h.
        // Basta uma duração que caiba para a quadra entrar na lista; as opções completas vêm depois de escolher a quadra.
        if (!slot) continue;
        duracoes.push({ minutos, valor: slot.valor, amountCents: slot.amountCents });
        break;
      }
      return duracoes.length ? { ...court, mode: 'inicio', duracoes } : null;
    }
    return null;
  }));
  return results.filter((r): r is FreeCourt => r !== null);
}

/** Mensagem enviada pelo sistema com a lista numerada (a IA não reescreve). */
export function freeCourtsMessage(dateLabel: string, start: string | null, duration: Duration | null, list: readonly FreeCourt[]) {
  const when = start && duration ? `das ${start} às ${endOf(start, duration)} (${durationLabel(duration)})` : duration ? `com horários livres de ${durationLabel(duration)}` : `livres às ${start}`;
  if (!list.length) return `Não encontrei quadras ${start && duration ? `livres ${when}` : when} em ${dateLabel}. Quer tentar outro horário ou outro dia?`;
  const lines = list.map((court, index) => {
    const base = `${bullet(index)} ${court.name} · ${court.sport}`;
    if (court.mode === 'exato') return `${base} · ${court.slot.valor}`;
    if (court.mode === 'duracao') return `${base} (${court.inicios.length === 1 ? '1 horário livre' : `${court.inicios.length} horários livres`})`;
    return base; // as opções "das 10h às 11h (R$ 100)…" vêm depois de escolher a quadra
  });
  const next = start && duration ? 'Qual quadra você prefere? Envie o número.' : start ? 'Qual quadra você prefere? Envie o número ou o nome.' : 'Qual quadra você prefere? Envie o número que eu mostro os horários livres dela.';
  return `📅 ${dateLabel}, ${start && duration ? `${when}, estas quadras estão livres` : `quadras ${when}`}:\n\n${lines.join('\n')}\n\n${next}`;
}

const norm = (value: string) => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');
const WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8 };
const count = (value: string) => WORDS[value] ?? Number(value);
/**
 * Horário e duração escritos pelo cliente ("às 21h", "21:00", "19h30", "1 hora", "1h30", "hora e meia", "3 horas", "2h30").
 * "1h" a "4h" soltos são duração; horário precisa de "às/das" ou ser a partir das 5h (ninguém joga à 1h da manhã por engano).
 */
export function parseTimeDuration(text: string): { start: string | null; duration: Duration | null } {
  const t = norm(text);
  const PREFIX = String.raw`(?:as|das|a partir das|pras|para as|por volta das)\s*`;
  const prefixed = (index: number) => new RegExp(String.raw`\b${PREFIX}$`).test(t.slice(0, index));
  const N = String.raw`(\d|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito)`;
  const find = (pattern: string, minutes: (m: RegExpExecArray) => number) => {
    for (const m of t.matchAll(new RegExp(pattern, 'g'))) if (!prefixed(m.index)) { const value = minutes(m); if (value >= 60 && value <= 480) return value; }
    return null;
  };
  const duration: Duration | null =
    find(String.raw`\b${N}\s*(?:h|horas?)\s*e\s*meia\b`, (m) => count(m[1]!) * 60 + 30)
    ?? find(String.raw`(?<!\d\s*)\bhora e meia\b`, () => 90)
    ?? find(String.raw`\b([1-8])(?:h|:)30\b(?!\s*min)`, (m) => Number(m[1]) * 60 + 30)
    ?? find(String.raw`\b(\d{2,3}) ?min(?:utos)?\b`, (m) => (Number(m[1]) % 30 ? 0 : Number(m[1])))
    ?? find(String.raw`\b${N}\s*horas?\b`, (m) => count(m[1]!) * 60)
    ?? find(String.raw`\b([1-4])h\b(?!\d)`, (m) => Number(m[1]) * 60);
  // Intervalo escrito pelo cliente ("das 19h às 20h", "de 19h até 20h30", "das 19 às 21"): início e duração de uma vez.
  const range = t.match(/\b(?:das?|de|entre)\s*(?:as\s*)?(\d{1,2})(?:(?::|h)(\d{2}))?\s*h?\s*(?:as|a|ate|e|-)\s*(?:as\s*)?(\d{1,2})(?:(?::|h)(\d{2}))?\s*h?\b/);
  if (range) {
    const from = Number(range[1]) * 60 + Number(range[2] || 0), to = Number(range[3]) * 60 + Number(range[4] || 0), span = to - from;
    if (Number(range[1]) >= 5 && Number(range[1]) <= 23 && Number(range[3]) <= 24 && span >= 60 && span <= 480 && span % 30 === 0) {
      const startText = `${String(Math.floor(from / 60)).padStart(2, '0')}:${String(from % 60).padStart(2, '0')}`;
      return { start: startText, duration: duration ?? span };
    }
  }
  const valid = (h: number, m: number) => h >= 0 && h <= 23 && m >= 0 && m <= 59;
  let start: string | null = null;
  const withPrefix = t.match(new RegExp(String.raw`\b${PREFIX}(\d{1,2})(?:[:h](\d{2}))?\s*h?\b`));
  const clock = t.match(/\b(\d{1,2}):(\d{2})\b/) || t.match(/\b(\d{1,2})h(\d{2})?\b/);
  for (const m of [withPrefix, clock]) {
    if (!m) continue;
    const h = Number(m[1]), min = Number(m[2] || 0);
    if (m === clock && !withPrefix && h < 5) continue;
    if (m === clock && m[0].includes('h') && !m[0].includes(':') && [1, 2].includes(h) && (m[2] === undefined || m[2] === '30') && !withPrefix) continue;
    if (valid(h, min)) { start = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`; break; }
  }
  return { start, duration };
}
