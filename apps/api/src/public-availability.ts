// Horários livres da página pública (sem banco, para poder testar isolado). Minutos desde 00:00.
import { DEFAULT_MAX_DURATION as MAX_DURATION, MIN_DURATION, STEP } from './booking-duration.js';
import { DEFAULT_RULES, firstStart, gridStep, ruleProblem, type CourtRules } from './court-rules.js';

export { MAX_DURATION, MIN_DURATION, STEP };
export type Busy = { start: number; end: number };

const free = (from: number, to: number, busy: readonly Busy[]) => !busy.some((b) => b.start < to && b.end > from);

/** Fins possíveis para um início: de 1h até o máximo, parando no fechamento ou na próxima reserva, e respeitando as regras da quadra. */
export function endOptions(start: number, close: number, busy: readonly Busy[], maxDuration = MAX_DURATION, rules: CourtRules = DEFAULT_RULES, weekday = 0, opening = 0) {
  const out: number[] = [];
  for (let end = start + STEP; end <= Math.min(start + maxDuration, close); end += STEP) {
    if (!free(end - STEP, end, busy)) break;
    if (end - start >= MIN_DURATION && !ruleProblem(rules, weekday, start, end, opening)) out.push(end);
  }
  return out;
}

/** Inícios possíveis (na grade da quadra: 30 min, 1h, 2h ou 3h) que têm pelo menos um fim válido. */
export function freeStarts(open: number, close: number, notBefore: number, busy: readonly Busy[], rules: CourtRules = DEFAULT_RULES, weekday = 0, maxDuration = MAX_DURATION) {
  const out: number[] = [], step = gridStep(rules);
  for (let t = firstStart(rules, Math.max(open, notBefore), open); t + MIN_DURATION <= close; t += step) if (endOptions(t, close, busy, maxDuration, rules, weekday, open).length) out.push(t);
  return out;
}

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
