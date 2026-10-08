// Regras de horário por quadra (sem banco, para poder testar isolado). Minutos desde 00:00.
// - step 30: começa de 30 em 30 e dura 1h, 1h30, 2h… (padrão, como antes)
// - step 60: só horas cheias — começa em hora cheia e dura 1h, 2h, 3h…
// - step 120/180: blocos de 2h ou 3h contados a partir da abertura do dia (abre às 8h → 8h, 10h, 12h…) e dura 2h, 4h… (ou 3h, 6h…)
// - prime (horário nobre): nos dias e no intervalo da regra, a reserva que pegar qualquer parte dele precisa durar
//   pelo menos `minMinutes` no total (ex.: das 19h às 21h, mínimo 2h → 19h–20h não; 18h–20h sim).

export type PrimeRule = { days: number[]; from: string; to: string; minMinutes: number };
export type Step = 30 | 60 | 120 | 180;
export const STEPS: readonly Step[] = [30, 60, 120, 180];
export type CourtRules = { step: Step; prime: PrimeRule[] };
export const DEFAULT_RULES: CourtRules = { step: 30, prime: [] };

const HHMM = /^([01]\d|2[0-3]):(00|30)$/;
export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hourText = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const durText = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const DAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Regras guardadas na quadra, sempre num formato válido (o que não fizer sentido é ignorado). */
export function parseCourtRules(raw: unknown): CourtRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const step = STEPS.includes(r.step as Step) ? r.step as Step : 30;
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
  if (!STEPS.includes(r.step as Step)) return { error: 'Escolha se a quadra aceita horários de 30 em 30 minutos, de hora em hora, de 2 em 2 horas ou de 3 em 3 horas.' };
  const list = Array.isArray(r.prime) ? r.prime : [];
  if (list.length > 10) return { error: 'Use no máximo 10 regras de horário nobre por quadra.' };
  const rules = parseCourtRules(r);
  if (rules.prime.length !== list.length) return { error: 'Confira as regras de horário nobre: escolha os dias, um intervalo válido e a duração mínima (de 1h a 8h).' };
  if (rules.step === 60 && rules.prime.some((p) => p.minMinutes % 60)) return { error: 'Com horas cheias, a duração mínima do horário nobre também precisa ser em horas cheias.' };
  if (rules.step > 60 && rules.prime.some((p) => p.minMinutes % rules.step)) return { error: `Com blocos de ${rules.step / 60}h, a duração mínima do horário nobre precisa ser ${rules.step / 60}h, ${rules.step / 30}h…` };
  return { rules };
}

/** Maior duração mínima exigida pelo horário nobre para uma reserva [start, end) nesse dia da semana (0 = sem exigência). */
export function primeMinimum(rules: CourtRules, weekday: number, start: number, end: number) {
  return rules.prime.filter((p) => p.days.includes(weekday) && toMin(p.from) < end && toMin(p.to) > start).reduce((max, p) => Math.max(max, p.minMinutes), 0);
}

/** Ponto de partida da grade: 30 min e 1h contam desde 00:00; blocos de 2h e 3h, desde a abertura do dia. */
export const gridBase = (rules: CourtRules, opening = 0) => rules.step > 60 ? opening : 0;
/** Primeiro início válido da grade a partir de `from` (minutos). */
export const firstStart = (rules: CourtRules, from: number, opening = 0) => { const base = gridBase(rules, opening); return base + Math.ceil((from - base) / rules.step) * rules.step; };

export type RuleProblem = { kind: 'start' | 'duration' | 'prime'; minMinutes?: number; rule?: PrimeRule; step?: Step; base?: number };
/** A reserva respeita as regras da quadra? `opening`: abertura do dia em minutos (base da grade de 2h/3h). O funcionamento, conflitos e o mínimo de 1h são checados em outro lugar. */
export function ruleProblem(rules: CourtRules, weekday: number, start: number, end: number, opening = 0): RuleProblem | null {
  const base = gridBase(rules, opening);
  if (rules.step > 30 && (start - base) % rules.step) return { kind: 'start', step: rules.step, base };
  if (rules.step > 30 && (end - start) % rules.step) return { kind: 'duration', step: rules.step };
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
  const step = problem.step ?? 60, hours = step / 60;
  if (problem.kind === 'start' && step > 60) { const b = problem.base ?? 0; return `Na ${courtName} os horários são de ${hours} em ${hours} horas, a partir das ${hourText(b)} (${[b, b + step, b + 2 * step].filter((m) => m < 1440).map(hourText).join(', ')}…).`; }
  if (problem.kind === 'start') return `Na ${courtName} os horários começam sempre em hora cheia (19:00, 20:00…).`;
  if (problem.kind === 'duration' && step > 60) return `A ${courtName} é alugada em blocos de ${hours}h (${hours}h, ${hours * 2}h, ${hours * 3}h…).`;
  if (problem.kind === 'duration') return `A ${courtName} é alugada só em horas cheias (1h, 2h, 3h…).`;
  return `No horário nobre (${primeWhen(problem.rule!)}), a ${courtName} é alugada por no mínimo ${durText(problem.minMinutes!)}.`;
}
