// Política de cancelamento e remarcação da arena.
// Cancelar é sempre permitido (libera o horário); a política diz só o que acontece com o dinheiro já pago.
// A remarcação pode ser desligada e tem prazo (companies.cancellation_hours, o antigo "prazo de cancelamento").
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { companies, financeEntries, integrationSettings } from '@quadrasflow/database';
import { db } from './database.js';

type Writer = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

/** always: a equipe devolve o valor pago · never: não devolve · team: a equipe decide caso a caso (padrão, como era antes). */
export type RefundPolicy = 'always' | 'never' | 'team';
export type BookingPolicy = { refund: RefundPolicy; allowReschedule: boolean; rescheduleHours: number };

const PROVIDER = 'booking_policy';
export const REFUND_POLICIES: readonly RefundPolicy[] = ['always', 'never', 'team'];
export const validRescheduleHours = (hours: number) => Number.isInteger(hours) && hours >= 0 && hours <= 720;

export async function getBookingPolicy(companyId: string): Promise<BookingPolicy> {
  const [row, company] = await Promise.all([
    db.select({ settings: integrationSettings.settings }).from(integrationSettings).where(and(eq(integrationSettings.companyId, companyId), eq(integrationSettings.provider, PROVIDER))).limit(1).then((r) => r[0]),
    db.select({ hours: companies.cancellationHours }).from(companies).where(eq(companies.id, companyId)).limit(1).then((r) => r[0]),
  ]);
  const s = (row?.settings ?? {}) as Record<string, unknown>;
  return {
    refund: REFUND_POLICIES.includes(s.refund as RefundPolicy) ? (s.refund as RefundPolicy) : 'team',
    allowReschedule: s.allowReschedule !== false,
    rescheduleHours: company?.hours ?? 24,
  };
}

export async function saveBookingPolicy(companyId: string, policy: BookingPolicy) {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.insert(integrationSettings).values({ companyId, provider: PROVIDER, settings: { refund: policy.refund, allowReschedule: policy.allowReschedule }, updatedAt: now })
      .onConflictDoUpdate({ target: [integrationSettings.companyId, integrationSettings.provider], set: { settings: { refund: policy.refund, allowReschedule: policy.allowReschedule }, updatedAt: now } });
    await tx.update(companies).set({ cancellationHours: policy.rescheduleHours }).where(eq(companies.id, companyId));
  });
}

const brl = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

/** O que o cliente lê sobre o dinheiro, antes (confirmação) e depois (cancelada). Vazio quando nada foi pago. */
export function refundText(policy: RefundPolicy, paidCents: number, when: 'before' | 'after') {
  if (paidCents <= 0) return '';
  const value = brl(paidCents);
  if (policy === 'always') return when === 'before' ? `O valor pago de ${value} será devolvido pela equipe.` : `A equipe vai devolver o valor pago de ${value}.`;
  if (policy === 'never') return `O valor pago de ${value} não é devolvido, conforme a política da arena.`;
  return when === 'before' ? `A equipe vai analisar a devolução do valor pago de ${value}.` : `A equipe vai analisar a devolução do valor pago de ${value} e te avisa por aqui.`;
}

/** Total já pago de uma reserva (Pix, sinal ou "Recebido" lançados no Financeiro). */
export async function paidForBooking(tx: Writer, companyId: string, bookingId: string) {
  const rows = await tx.select({ amount: financeEntries.amountCents }).from(financeEntries)
    .where(and(eq(financeEntries.companyId, companyId), eq(financeEntries.bookingId, bookingId), eq(financeEntries.kind, 'income'), sql`${financeEntries.paidAt} IS NOT NULL`));
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

/**
 * Registra no Financeiro o que acontece com o dinheiro de uma reserva cancelada (ou remarcada para menos).
 * - devolver: despesa em aberto "Estorno a devolver" (a equipe devolve e marca como paga). Não fica ligada à
 *   reserva, para não entrar na conta do "a receber" dela; a reserva aparece na descrição.
 * - reter: o pagamento continua como receita e ganha a observação "retido".
 */
export async function recordRefundDecision(tx: Writer, input: { companyId: string; bookingId: string; refund: boolean; amountCents: number; label: string; dueDate: string; reason: string }) {
  if (input.amountCents <= 0) return;
  const now = new Date().toISOString();
  if (input.refund) {
    await tx.insert(financeEntries).values({ id: randomUUID(), companyId: input.companyId, bookingId: null, monthlyChargeId: null, tournamentEntryId: null, kind: 'expense', category: 'Estornos', description: `Estorno a devolver — ${input.label} (${input.reason})`.slice(0, 200), amountCents: input.amountCents, dueDate: input.dueDate, paidAt: null, createdAt: now });
    return;
  }
  await tx.update(financeEntries).set({ description: sql`left(${financeEntries.description} || ' (retido: reserva cancelada)', 200)` })
    .where(and(eq(financeEntries.companyId, input.companyId), eq(financeEntries.bookingId, input.bookingId), eq(financeEntries.kind, 'income'), sql`${financeEntries.paidAt} IS NOT NULL`, sql`${financeEntries.description} NOT LIKE '%(retido%'`));
}
