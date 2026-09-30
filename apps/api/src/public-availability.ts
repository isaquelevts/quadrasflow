// Horários livres da página pública (sem banco, para poder testar isolado). Minutos desde 00:00.

export type Busy = { start: number; end: number };
export const STEP = 30;
export const MIN_DURATION = 60;
export const MAX_DURATION = 480;

const free = (from: number, to: number, busy: readonly Busy[]) => !busy.some((b) => b.start < to && b.end > from);

/** Inícios possíveis (de 30 em 30 min) com pelo menos 1h livre antes do fechamento e depois de `notBefore`. */
export function freeStarts(open: number, close: number, notBefore: number, busy: readonly Busy[]) {
  const out: number[] = [];
  const first = Math.max(open, Math.ceil(notBefore / STEP) * STEP);
  for (let t = first; t + MIN_DURATION <= close; t += STEP) if (free(t, t + MIN_DURATION, busy)) out.push(t);
  return out;
}

/** Fins possíveis para um início: de 1h até 8h, parando no fechamento ou na próxima reserva. */
export function endOptions(start: number, close: number, busy: readonly Busy[], maxDuration = MAX_DURATION) {
  const out: number[] = [];
  for (let end = start + STEP; end <= Math.min(start + maxDuration, close); end += STEP) {
    if (!free(end - STEP, end, busy)) break;
    if (end - start >= MIN_DURATION) out.push(end);
  }
  return out;
}

export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
