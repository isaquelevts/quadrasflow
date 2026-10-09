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
/** Passo dos inícios e das durações: 30 min ou hora cheia (as opções de 2h e 3h também começam em qualquer hora cheia). */
export const gridStep = (rules: CourtRules) => Math.min(rules.step, 60);
/** Duração mínima exigida pela opção da quadra (2h ou 3h); nas demais, 0. */
export const courtMinimum = (rules: CourtRules) => rules.step > 60 ? rules.step : 0;
/** Mantido para quem ainda passa a abertura: a grade sempre conta de 00:00. */
export const gridBase = (_rules: CourtRules, _opening = 0) => 0;
/** Primeiro início válido da grade a partir de `from` (minutos). */
export const firstStart = (rules: CourtRules, from: number, _opening = 0) => Math.ceil(from / gridStep(rules)) * gridStep(rules);
/** Menor reserva da quadra: 1h ou um bloco da grade. */
export const minDuration = (rules: CourtRules) => Math.max(60, rules.step);

export function primeMinimum(rules: CourtRules, weekday: number, start: number, end: number) {
  return rules.prime.filter((p) => p.days.includes(weekday) && toMin(p.from) < end && toMin(p.to) > start).reduce((max, p) => Math.max(max, p.minMinutes), 0);
}
export type RuleProblem = { kind: 'start' | 'duration' | 'prime' | 'minimum'; minMinutes?: number; rule?: PrimeRule; step?: Step; base?: number };
/** `opening`: abertura do dia em minutos (base da grade de 2h/3h). */
export function ruleProblem(rules: CourtRules, weekday: number, start: number, end: number, _opening = 0): RuleProblem | null {
  if (rules.step > 30 && start % 60) return { kind: 'start', step: 60 };
  if (rules.step > 30 && (end - start) % 60) return { kind: 'duration', step: 60 };
  if (courtMinimum(rules) && end - start < courtMinimum(rules)) return { kind: 'minimum', minMinutes: courtMinimum(rules) };
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
  if (problem.kind === 'minimum') return `A ${courtName} é alugada por no mínimo ${problem.minMinutes! / 60}h (pode começar em qualquer hora cheia).`;
  if (problem.kind === 'start') return `Na ${courtName} os horários começam sempre em hora cheia (19:00, 20:00…).`;
  if (problem.kind === 'duration') return `A ${courtName} é alugada só em horas cheias (1h, 2h, 3h…).`;
  return `No horário nobre (${primeWhen(problem.rule!)}), a ${courtName} é alugada por no mínimo ${hourText(problem.minMinutes!)}.`;
}
