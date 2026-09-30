// Busca de quadras livres para o agente do WhatsApp (sem banco, para poder testar isolado).
// O cliente escolhe a quadra a partir desta lista; o agente nunca escolhe por ele.

export type SearchCourt = { id: string; name: string; sport: string };
export type SearchSlot = { inicio: string; valor: string; amountCents: number };
export type Duration = 60 | 90 | 120;
type Check = (courtId: string, day: string, durationMinutes: number) => Promise<{ slots: SearchSlot[] }>;

export type FreeCourt =
  | (SearchCourt & { mode: 'exato'; slot: SearchSlot })
  | (SearchCourt & { mode: 'duracao'; inicios: string[] })
  | (SearchCourt & { mode: 'inicio'; duracoes: Array<{ minutos: Duration; valor: string; amountCents: number }> });

const DURATIONS: Duration[] = [60, 90, 120];
export const durationLabel = (minutes: number) => (minutes === 60 ? '1h' : minutes === 90 ? '1h30' : minutes === 120 ? '2h' : `${minutes} min`);
const endOf = (start: string, minutes: number) => { const total = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + minutes) % 1440; return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; };
const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const bullet = (index: number) => KEYCAPS[index] ?? `${index + 1}.`;

/**
 * Quadras livres conforme o que o cliente informou:
 * - horário e duração: livres naquele intervalo exato;
 * - só duração: com algum horário livre dessa duração no dia;
 * - só horário: livres começando naquele horário (com as durações possíveis).
 */
export async function searchFreeCourts(courts: readonly SearchCourt[], day: string, start: string | null, duration: Duration | null, check: Check): Promise<FreeCourt[]> {
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
      for (const minutos of DURATIONS) {
        const slot = (await check(court.id, day, minutos)).slots.find((s) => s.inicio === start);
        if (slot) duracoes.push({ minutos, valor: slot.valor, amountCents: slot.amountCents });
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
    return `${base} (${court.duracoes.map((d) => durationLabel(d.minutos)).join(', ')})`;
  });
  const next = start && duration ? 'Qual quadra você prefere? Envie o número.' : 'Qual quadra você prefere? Envie o número que eu mostro os horários livres dela.';
  return `📅 ${dateLabel}, ${start && duration ? `${when}, estas quadras estão livres` : `quadras ${when}`}:\n\n${lines.join('\n')}\n\n${next}`;
}

const norm = (value: string) => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');
/**
 * Horário e duração escritos pelo cliente ("às 21h", "21:00", "19h30", "1 hora", "1h30", "hora e meia", "2 horas").
 * "1h"/"2h" soltos são duração; horário precisa de "às/das" ou ser a partir das 5h (ninguém joga à 1h da manhã por engano).
 */
export function parseTimeDuration(text: string): { start: string | null; duration: Duration | null } {
  const t = norm(text);
  const PREFIX = String.raw`(?:as|das|a partir das|pras|para as|por volta das)\s*`;
  let duration: Duration | null = null;
  if (/\b(?:1h30|1:30 ?h|uma hora e meia|1 hora e meia|hora e meia|90 ?min(?:utos)?)\b/.test(t)) duration = 90;
  else if (new RegExp(String.raw`(?<!${PREFIX})\b(?:2h|2 horas|duas horas|120 ?min(?:utos)?)\b`).test(t) && !new RegExp(String.raw`\b${PREFIX}2h\b`).test(t)) duration = 120;
  else if (/\b(?:1h|1 hora|uma hora|60 ?min(?:utos)?)\b/.test(t) && !new RegExp(String.raw`\b${PREFIX}1h\b`).test(t)) duration = 60;
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
