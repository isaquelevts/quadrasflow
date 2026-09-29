// Reserva ↔ Financeiro: mantém o "a receber" de cada reserva e as mudanças de situação num só lugar.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { appAudit, bookingEvents, bookings, financeEntries, reviewLinks } from '@quadrasflow/database';
import type { db } from './database.js';

type Writer = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;
export type BookingStatus = 'confirmed' | 'cancelled' | 'completed';
type EntryLike = { id: string; amountCents: number; paidAt: string | null; createdAt: string };

export const OPEN_FULL = 'Reserva (pagar na arena)';
export const OPEN_BALANCE = 'Saldo da reserva (pagar na arena)';

/**
 * O que deve existir no Financeiro para a reserva: um único lançamento em aberto com o que falta receber.
 * - Só reservas confirmadas ou concluídas têm valor a receber (pendente pode nunca acontecer; cancelada não deve).
 * - O que já foi pago (Pix, sinal ou "Recebido") é descontado; pagamentos nunca são apagados.
 */
export function planReceivable(booking: { status: string; amountCents: number; startAt: string }, entries: readonly EntryLike[]) {
  const paid = entries.filter((e) => e.paidAt).reduce((sum, e) => sum + e.amountCents, 0);
  const open = entries.filter((e) => !e.paidAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const expected = ['confirmed', 'completed'].includes(booking.status) ? Math.max(0, booking.amountCents - paid) : 0;
  if (!expected) return { upsert: null, remove: open.map((e) => e.id) };
  const [first, ...rest] = open;
  return {
    upsert: { id: first?.id ?? null, amountCents: expected, description: paid > 0 ? OPEN_BALANCE : OPEN_FULL, dueDate: booking.startAt.slice(0, 10) },
    remove: rest.map((e) => e.id),
  };
}

/** Deixa o lançamento em aberto da reserva igual ao plano. Chamar depois de qualquer mudança na reserva ou nos pagamentos dela. */
export async function syncBookingReceivable(tx: Writer, companyId: string, bookingId: string) {
  const booking = (await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.companyId, companyId))).limit(1))[0];
  if (!booking) return;
  const entries = await tx.select().from(financeEntries).where(and(eq(financeEntries.companyId, companyId), eq(financeEntries.bookingId, bookingId)));
  const plan = planReceivable(booking, entries);
  for (const id of plan.remove) await tx.delete(financeEntries).where(and(eq(financeEntries.id, id), sql`${financeEntries.paidAt} IS NULL`));
  if (!plan.upsert) return;
  const { id, ...values } = plan.upsert;
  if (id) await tx.update(financeEntries).set(values).where(eq(financeEntries.id, id));
  else await tx.insert(financeEntries).values({ id: randomUUID(), companyId, bookingId, monthlyChargeId: null, tournamentEntryId: null, kind: 'income', category: 'Reservas', paidAt: null, createdAt: new Date().toISOString(), ...values });
}

/**
 * Muda a situação da reserva (confirmar, cancelar, concluir) e acerta o Financeiro.
 * Devolve null quando a reserva não existe ou já estava encerrada.
 */
export async function changeBookingStatus(tx: Writer, input: { companyId: string; userId: string | null; bookingId: string; status: BookingStatus; reason?: string; source?: string }) {
  const { companyId, userId, bookingId, status } = input, reason = String(input.reason || '').slice(0, 200), now = new Date().toISOString();
  const rows = await tx.update(bookings).set({ status, cancelReason: status === 'cancelled' ? reason : '', updatedAt: now })
    .where(and(eq(bookings.id, bookingId), eq(bookings.companyId, companyId), sql`${bookings.status} IN ('pending','confirmed')`)).returning({ id: bookings.id });
  if (!rows.length) return null;
  await tx.insert(bookingEvents).values({ id: randomUUID(), companyId, bookingId, userId, event: status, details: { reason, ...(input.source ? { source: input.source } : {}) }, createdAt: now });
  await tx.insert(appAudit).values({ id: randomUUID(), companyId, userId, action: `booking.${status}`, entity: 'booking', entityId: bookingId, details: input.source ? { source: input.source } : {}, createdAt: now });
  let reviewToken: string | null = null;
  if (status === 'completed') {
    // O pedido de avaliação é enviado depois do fim do jogo pelo worker de envios.
    reviewToken = randomBytes(32).toString('base64url');
    await tx.insert(reviewLinks).values({ id: randomUUID(), companyId, bookingId, tokenHash: createHash('sha256').update(reviewToken).digest('hex'), expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(), submittedAt: null, createdAt: now }).onConflictDoNothing();
  }
  await syncBookingReceivable(tx, companyId, bookingId);
  return { status, reviewToken };
}

/** A reserva já terminou? (horários são gravados como hora local da arena com sufixo Z) */
export function bookingEnded(endAt: string, now = new Date(), timeZone = 'America/Sao_Paulo') {
  const local = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).replace(' ', 'T');
  return endAt.slice(0, 16) <= local;
}
