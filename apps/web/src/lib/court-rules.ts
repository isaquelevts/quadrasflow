// Espelho de apps/api/src/court-rules.ts (regras de horário por quadra). O servidor também confere: isto só monta a tela.
export type PrimeRule = { days: number[]; from: string; to: string; minMinutes: number };
export type Step = 30 | 60 | 120 | 180;
export const STEPS: readonly Step[] = [30, 60, 120, 180];
export type CourtRules = { step: Step; prime: PrimeRule[] };
export const DEFAULT_RULES: CourtRules = { step: 30, prime: [] };

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hourText = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const DAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export const rulesOf = (raw: Partial<CourtRules> | null | undefined): CourtRules => ({ step: STEPS.includes(raw?.step as Step) ? raw!.step as Step : 30, prime: Array.isArray(raw?.prime) ? raw!.prime : [] });
/** Ponto de partida da grade: 30 min e 1h contam desde 00:00; blocos de 2h e 3h, desde a abertura do dia. */
export const gridBase = (rules: CourtRules, opening = 0) => rules.step > 60 ? opening : 0;
/** Primeiro início válido da grade a partir de `from` (minutos). */
export const firstStart = (rules: CourtRules, from: number, opening = 0) => { const base = gridBase(rules, opening); return base + Math.ceil((from - base) / rules.step) * rules.step; };
/** Menor reserva da quadra: 1h ou um bloco da grade. */
export const minDuration = (rules: CourtRules) => Math.max(60, rules.step);

export function primeMinimum(rules: CourtRules, weekday: number, start: number, end: number) {
  return rules.prime.filter((p) => p.days.includes(weekday) && toMin(p.from) < end && toMin(p.to) > start).reduce((max, p) => Math.max(max, p.minMinutes), 0);
}
export type RuleProblem = { kind: 'start' | 'duration' | 'prime'; minMinutes?: number; rule?: PrimeRule; step?: Step; base?: number };
/** `opening`: abertura do dia em minutos (base da grade de 2h/3h). */
export function ruleProblem(rules: CourtRules, weekday: number, start: number, end: number, opening = 0): RuleProblem | null {
  const base = gridBase(rules, opening);
  if (rules.step > 30 && (start - base) % rules.step) return { kind: 'start', step: rules.step, base };
  if (rules.step > 30 && (end - start) % rules.step) return { kind: 'duration', step: rules.step };
  const min = primeMinimum(rules, weekday, start, end);
  if (min && end - start < min) return { kind: 'prime', minMinutes: min, rule: rules.prime.find((p) => p.days.includes(weekday) && toMin(p.from) < end && toMin(p.to) > start && p.minMinutes === min)! };
  return null;
}
export function primeWhen(rule: PrimeRule) {
  const d = [...rule.days].sort(), consecutive = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  const days = d.length === 7 ? 'todos os dias' : consecutive ? `${DAY_SHORT[d[0]!]} a ${DAY_SHORT[d.at(-1)!]}` : d.map((x) => DAY_SHORT[x]).join(', ');
  return `${days}, das ${hourText(toMin(rule.from))} às ${hourText(rule.to === '24:00' ? 1440 : toMin(rule.to))}`;
}
export function ruleProblemText(problem: RuleProblem, courtName: string) {
  const step = problem.step ?? 60, hours = step / 60;
  if (problem.kind === 'start' && step > 60) { const b = problem.base ?? 0; return `Na ${courtName} os horários são de ${hours} em ${hours} horas, a partir das ${hourText(b)} (${[b, b + step, b + 2 * step].filter((m) => m < 1440).map(hourText).join(', ')}…).`; }
  if (problem.kind === 'start') return `Na ${courtName} os horários começam sempre em hora cheia (19:00, 20:00…).`;
  if (problem.kind === 'duration' && step > 60) return `A ${courtName} é alugada em blocos de ${hours}h (${hours}h, ${hours * 2}h, ${hours * 3}h…).`;
  if (problem.kind === 'duration') return `A ${courtName} é alugada só em horas cheias (1h, 2h, 3h…).`;
  return `No horário nobre (${primeWhen(problem.rule!)}), a ${courtName} é alugada por no mínimo ${hourText(problem.minMinutes!)}.`;
}
