// Regras de horário por quadra (sem banco, para poder testar isolado). Minutos desde 00:00.
// - step 30: começa de 30 em 30 e dura 1h, 1h30, 2h… (padrão, como antes)
// - step 60: só horas cheias — começa em hora cheia e dura 1h, 2h, 3h…
// - prime (horário nobre): nos dias e no intervalo da regra, a reserva que pegar qualquer parte dele precisa durar
//   pelo menos `minMinutes` no total (ex.: das 19h às 21h, mínimo 2h → 19h–20h não; 18h–20h sim).

export type PrimeRule = { days: number[]; from: string; to: string; minMinutes: number };
export type CourtRules = { step: 30 | 60; prime: PrimeRule[] };
export const DEFAULT_RULES: CourtRules = { step: 30, prime: [] };

const HHMM = /^([01]\d|2[0-3]):(00|30)$/;
export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hourText = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const durText = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const DAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Regras guardadas na quadra, sempre num formato válido (o que não fizer sentido é ignorado). */
export function parseCourtRules(raw: unknown): CourtRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const step = r.step === 60 ? 60 : 30;
  const prime = (Array.isArray(r.prime) ? r.prime : []).flatMap((p): PrimeRule[] => {
    const x = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const days = Array.isArray(x.days) ? [...new Set(x.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    const from = String(x.from ?? ''), to = String(x.to ?? ''), minMinutes = Number(x.minMinutes);
    if (!days.length || !HHMM.test(from) || !(HHMM.test(to) || to === '24:00') || toMin(to) <= toMin(from) || !Number.isInteger(minMinutes) || minMinutes < 60 || minMinutes > 480 || minMinutes % 30) return [];
    return [{ days, from, to, minMinutes }];
  });
  return { step, prime: prime.slice(0, 10) };
}

/** Valida o que vem das Configurações; devolve a mensagem de erro ou as regras normalizadas. */
export function validateCourtRules(input: unknown): { error: string } | { rules: CourtRules } {
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (r.step !== 30 && r.step !== 60) return { error: 'Escolha se a quadra aceita horários de 30 em 30 minutos ou só horas cheias.' };
  const list = Array.isArray(r.prime) ? r.prime : [];
  if (list.length > 10) return { error: 'Use no máximo 10 regras de horário nobre por quadra.' };
  const rules = parseCourtRules(r);
  if (rules.prime.length !== list.length) return { error: 'Confira as regras de horário nobre: escolha os dias, um intervalo válido e a duração mínima (de 1h a 8h).' };
  if (rules.step === 60 && rules.prime.some((p) => p.minMinutes % 60)) return { error: 'Com horas cheias, a duração mínima do horário nobre também precisa ser em horas cheias.' };
  return { rules };
}

/** Maior duração mínima exigida pelo horário nobre para uma reserva [start, end) nesse dia da semana (0 = sem exigência). */
export function primeMinimum(rules: CourtRules, weekday: number, start: number, end: number) {
  return rules.prime.filter((p) => p.days.includes(weekday) && toMin(p.from) < end && toMin(p.to) > start).reduce((max, p) => Math.max(max, p.minMinutes), 0);
}

export type RuleProblem = { kind: 'start' | 'duration' | 'prime'; minMinutes?: number; rule?: PrimeRule };
/** A reserva respeita as regras da quadra? (o funcionamento, conflitos e o mínimo de 1h são checados em outro lugar) */
export function ruleProblem(rules: CourtRules, weekday: number, start: number, end: number): RuleProblem | null {
  if (rules.step === 60 && start % 60) return { kind: 'start' };
  if (rules.step === 60 && (end - start) % 60) return { kind: 'duration' };
  const min = primeMinimum(rules, weekday, start, end);
  if (min && end - start < min) {
    const rule = rules.prime.find((p) => p.days.includes(weekday) && toMin(p.from) < end && toMin(p.to) > start && p.minMinutes === min)!;
    return { kind: 'prime', minMinutes: min, rule };
  }
  return null;
}

/** "seg a sex, das 19h às 21h" */
export function primeWhen(rule: PrimeRule) {
  const d = rule.days, consecutive = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  const days = d.length === 7 ? 'todos os dias' : consecutive ? `${DAY_SHORT[d[0]!]} a ${DAY_SHORT[d.at(-1)!]}` : d.map((x) => DAY_SHORT[x]).join(', ');
  return `${days}, das ${hourText(toMin(rule.from))} às ${hourText(rule.to === '24:00' ? 1440 : toMin(rule.to))}`;
}

/** Explicação para o cliente (WhatsApp, página e servidor). */
export function ruleProblemText(problem: RuleProblem, courtName: string) {
  if (problem.kind === 'start') return `Na ${courtName} os horários começam sempre em hora cheia (19:00, 20:00…).`;
  if (problem.kind === 'duration') return `A ${courtName} é alugada só em horas cheias (1h, 2h, 3h…).`;
  return `No horário nobre (${primeWhen(problem.rule!)}), a ${courtName} é alugada por no mínimo ${durText(problem.minMinutes!)}.`;
}
