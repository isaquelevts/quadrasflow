// Plano de mensalista (sem banco, para poder testar isolado): horários fixos, vencimento e texto da cobrança.

export type PlanSlot = { courtId: string; weekday: number; startTime: string; durationMinutes: number };
export const MAX_SLOTS = 14;
// Início de 00:00 a 29:30: depois de 23:30 é a madrugada seguinte, no dia de funcionamento do horário fixo.
const HHMM = /^([01]\d|2\d):(00|30)$/;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Dia de vencimento válido: 1 a 31 (em mês mais curto, cai no último dia). */
export const validDueDay = (day: unknown) => Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 31;

/** Vencimento (AAAA-MM-DD) da mensalidade do mês `cycle` (AAAA-MM). */
export function dueDateOf(cycle: string, dueDay: number) {
  const [year, month] = cycle.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${cycle}-${String(Math.min(Math.max(1, dueDay), last)).padStart(2, '0')}`;
}

/** Horários enviados pela tela; aceita o formato antigo (um horário solto no corpo). */
export function parsePlanSlots(body: Record<string, unknown>): { error: string } | { slots: PlanSlot[] } {
  const raw = Array.isArray(body.slots) ? body.slots : body.weekday !== undefined ? [body] : [];
  if (!raw.length) return { error: 'Adicione pelo menos um horário fixo ao plano.' };
  if (raw.length > MAX_SLOTS) return { error: `Use no máximo ${MAX_SLOTS} horários por plano.` };
  const slots: PlanSlot[] = [];
  for (const item of raw) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const slot = { courtId: String(r.courtId || ''), weekday: Number(r.weekday), startTime: String(r.startTime || ''), durationMinutes: Number(r.durationMinutes) };
    if (!slot.courtId || !Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6 || !HHMM.test(slot.startTime) || !Number.isInteger(slot.durationMinutes) || slot.durationMinutes < 60 || slot.durationMinutes > 480 || slot.durationMinutes % 30) return { error: 'Confira dia, horário e duração de cada horário do mensalista.' };
    slots.push(slot);
  }
  const clash = slots.find((a, i) => slots.some((b, k) => k > i && a.courtId === b.courtId && a.weekday === b.weekday && toMin(a.startTime) < toMin(b.startTime) + b.durationMinutes && toMin(b.startTime) < toMin(a.startTime) + a.durationMinutes));
  if (clash) return { error: 'Dois horários do plano se sobrepõem na mesma quadra e dia.' };
  return { slots: slots.sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)) };
}

export const DEFAULT_CHARGE_MESSAGE = 'Olá, {nome}! Passando para lembrar da mensalidade de {mes} na {arena_name}: {valor}, com vencimento hoje ({vencimento}). Qualquer dúvida é só responder aqui. 🙂';
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Texto da cobrança automática, com as variáveis preenchidas. */
export function chargeMessage(template: string, v: { name: string; arena: string; amountCents: number; dueDate: string; cycle: string }) {
  const values: Record<string, string> = {
    nome: v.name.split(' ')[0] || v.name,
    arena_name: v.arena,
    valor: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v.amountCents / 100),
    vencimento: v.dueDate.split('-').reverse().join('/'),
    mes: MONTHS[Number(v.cycle.slice(5, 7)) - 1] ?? v.cycle,
  };
  return template.replace(/\{(nome|arena_name|valor|vencimento|mes)\}/g, (_, key: string) => values[key]!);
}

/** A cobrança automática deve ser enfileirada agora? Só no dia do vencimento, a partir das 9h da arena. */
export const chargeDueNow = (dueDate: string, local: { date: string; time: string }) => dueDate === local.date && local.time >= '09:00';
