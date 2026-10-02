// Espelho de apps/api/src/court-rules.ts (regras de horário por quadra). O servidor também confere: isto só monta a tela.
export type PrimeRule = { days: number[]; from: string; to: string; minMinutes: number };
export type CourtRules = { step: 30 | 60; prime: PrimeRule[] };
export const DEFAULT_RULES: CourtRules = { step: 30, prime: [] };

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hourText = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const DAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export const rulesOf = (raw: Partial<CourtRules> | null | undefined): CourtRules => ({ step: raw?.step === 60 ? 60 : 30, prime: Array.isArray(raw?.prime) ? raw!.prime : [] });

export function primeMinimum(rules: CourtRules, weekday: number, start: number, end: number) {
  return rules.prime.filter((p) => p.days.includes(weekday) && toMin(p.from) < end && toMin(p.to) > start).reduce((max, p) => Math.max(max, p.minMinutes), 0);
}
export type RuleProblem = { kind: 'start' | 'duration' | 'prime'; minMinutes?: number; rule?: PrimeRule };
export function ruleProblem(rules: CourtRules, weekday: number, start: number, end: number): RuleProblem | null {
  if (rules.step === 60 && start % 60) return { kind: 'start' };
  if (rules.step === 60 && (end - start) % 60) return { kind: 'duration' };
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
  if (problem.kind === 'start') return `Na ${courtName} os horários começam sempre em hora cheia (19:00, 20:00…).`;
  if (problem.kind === 'duration') return `A ${courtName} é alugada só em horas cheias (1h, 2h, 3h…).`;
  return `No horário nobre (${primeWhen(problem.rule!)}), a ${courtName} é alugada por no mínimo ${hourText(problem.minMinutes!)}.`;
}
