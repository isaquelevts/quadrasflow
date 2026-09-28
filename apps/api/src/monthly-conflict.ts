import { and, eq } from 'drizzle-orm';
import { clients, monthlyMembers } from '@quadrasflow/database';
import type { db } from './database.js';

type Reader = Pick<typeof db, 'select'>;

const minutesOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const timeOf = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/**
 * Horário fixo de mensalista ativo que se sobrepõe ao intervalo, na mesma quadra e dia da semana.
 * Mesma regra usada pelo bot do WhatsApp. Encostar (fim = início) não é conflito.
 */
export async function findMonthlyConflict(tx: Reader, companyId: string, courtId: string, startAt: string, endAt: string) {
  const weekday = new Date(`${startAt.slice(0, 10)}T12:00:00Z`).getUTCDay();
  const start = minutesOf(startAt), end = minutesOf(endAt);
  const rows = await tx.select({ startTime: monthlyMembers.startTime, durationMinutes: monthlyMembers.durationMinutes, clientName: clients.name })
    .from(monthlyMembers).innerJoin(clients, eq(monthlyMembers.clientId, clients.id))
    .where(and(eq(monthlyMembers.companyId, companyId), eq(monthlyMembers.courtId, courtId), eq(monthlyMembers.weekday, weekday), eq(monthlyMembers.status, 'active')));
  for (const row of rows) {
    const [hour = 0, minute = 0] = row.startTime.split(':').map(Number);
    const memberStart = hour * 60 + minute, memberEnd = memberStart + row.durationMinutes;
    if (memberStart < end && memberEnd > start) return { clientName: row.clientName, startTime: timeOf(memberStart), endTime: timeOf(memberEnd) };
  }
  return null;
}

export const monthlyConflictMessage = (conflict: { clientName: string; startTime: string; endTime: string }) =>
  `Conflito com o horário fixo do mensalista ${conflict.clientName} (${conflict.startTime}–${conflict.endTime}).`;
