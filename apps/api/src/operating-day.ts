// Dia de funcionamento da arena (sem banco, para poder testar isolado).
// Abertura e fechamento são minutos desde 00:00 do dia; o fechamento pode passar de 24:00 até 30:00
// ("26:00" = 02:00 da madrugada seguinte). Uma reserva das 00:30 de sábado numa arena que na sexta
// fecha às 02:00 pertence ao funcionamento de sexta.

export const DAY = 1440;
export const MAX_CLOSE = 30 * 60;
/** "HH:MM" com HH de 00 a 30 (acima de 23 = madrugada do dia seguinte). */
export const EXTENDED_HHMM = /^([01]\d|2\d|30):(00|30)$/;

export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** 1530 → "25:30" (formato guardado). */
export const hhmmOf = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
/** 1530 → "01:30" (o que o cliente lê no relógio). */
export const clockOf = (total: number) => hhmmOf(((total % DAY) + DAY) % DAY);
/** "25:30" → "01:30"; horários normais ficam iguais. */
export const clockText = (hhmm: string) => clockOf(toMin(hhmm));

export function shiftDay(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T12:00:00Z`) / 86_400_000);
export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
/** Data e minutos relativos a `day` (podem passar de 24:00) → horário guardado `AAAA-MM-DDTHH:MM:00.000Z`. */
export const wallIso = (day: string, minutes: number) => `${shiftDay(day, Math.floor(minutes / DAY))}T${clockOf(minutes)}:00.000Z`;
/** Minutos de um horário guardado contados a partir de 00:00 de `day` (madrugada seguinte = 24:00 em diante). */
export const minutesFrom = (day: string, iso: string) => (dayNumber(iso.slice(0, 10)) - dayNumber(day)) * DAY + toMin(iso.slice(11, 16));

export type DayHours = { weekday: number; isOpen: boolean; openTime: string; closeTime: string };
export type OpenWindow = { day: string; weekday: number; open: number; close: number };

/** Janela de funcionamento de uma data, ou null se fechada. */
export function windowOf(hours: readonly DayHours[], day: string): OpenWindow | null {
  const weekday = weekdayOf(day), h = hours.find((x) => x.weekday === weekday);
  return h?.isOpen ? { day, weekday, open: toMin(h.openTime), close: toMin(h.closeTime) } : null;
}

/**
 * Dia de funcionamento em que cabe a reserva [startIso, endIso): o próprio dia do início ou, de madrugada,
 * o dia anterior. Devolve os minutos relativos a esse dia, ou null se cair fora do funcionamento.
 */
export function operatingDayOf(hours: readonly DayHours[], startIso: string, endIso: string) {
  for (const day of [startIso.slice(0, 10), shiftDay(startIso.slice(0, 10), -1)]) {
    const w = windowOf(hours, day);
    if (!w) continue;
    const start = minutesFrom(day, startIso), end = minutesFrom(day, endIso);
    if (start >= w.open && end <= w.close && end > start) return { ...w, start, end };
  }
  return null;
}

/**
 * Horário dito pelo cliente ("00:30") para um dia de funcionamento: se for antes da abertura e couber na
 * madrugada (fechamento depois de 24:00), é a madrugada seguinte (24:30). Caso contrário fica como está.
 */
export function resolveClock(w: Pick<OpenWindow, 'open' | 'close'>, hhmm: string) {
  const t = toMin(hhmm);
  return t < w.open && t + DAY < w.close ? t + DAY : t;
}

/** Valida o horário semanal (Configurações e cadastro): fechamento depois da abertura, até 06:00 do dia seguinte, sem invadir a abertura do dia seguinte. */
export function hoursProblem(list: readonly DayHours[]): string | null {
  for (const h of list) {
    if (!h.isOpen) continue;
    if (!/^([01]\d|2[0-3]):(00|30)$/.test(h.openTime) || !EXTENDED_HHMM.test(h.closeTime)) return 'Confira os horários de abertura e fechamento.';
    const open = toMin(h.openTime), close = toMin(h.closeTime);
    if (close <= open) return 'O fechamento precisa ser depois da abertura.';
    if (close > MAX_CLOSE) return 'O fechamento pode ir no máximo até as 06:00 da madrugada seguinte.';
    const next = list.find((x) => x.weekday === (h.weekday + 1) % 7);
    if (close > DAY && next?.isOpen && close - DAY > toMin(next.openTime)) return 'O fechamento de madrugada não pode passar da abertura do dia seguinte.';
  }
  return null;
}

/**
 * Faixa de horários guardados que pertence ao funcionamento de `day`: começa depois da madrugada do dia
 * anterior (se ele fecha depois de 24:00) e vai até a madrugada seguinte (se `day` fecha depois de 24:00).
 */
export function dayRange(hours: readonly DayHours[], day: string) {
  const prev = windowOf(hours, shiftDay(day, -1)), own = windowOf(hours, day);
  const from = prev && prev.close > DAY ? prev.close - DAY : 0, extra = own && own.close > DAY ? own.close - DAY : 0;
  return { fromIso: wallIso(day, from), toIso: wallIso(day, DAY + extra) };
}
