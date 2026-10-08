import { and, eq, inArray } from 'drizzle-orm';
import { clients, courts, monthlyMemberSlots, monthlyMembers } from '@quadrasflow/database';
import type { db } from './database.js';

type Reader = Pick<typeof db, 'select'>;

const minutesOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const timeOf = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Horário fixo de um plano ativo num dia (minutos desde 00:00). */
export type MonthlyBusy = { day: string; memberId: string; slotId: string; courtId: string; courtName: string; sport: string; clientName: string; clientPhone: string | null; amountCents: number; start: number; end: number };

/** Dias (AAAA-MM-DD) de `from` até `to`, inclusive. */
export function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (const d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/**
 * Horários fixos de mensalistas ativos entre duas datas (opcionalmente só de uma quadra).
 * Único lugar que transforma plano em ocupação: agenda, conflitos, página pública e WhatsApp passam por aqui.
 */
export async function monthlyBusyBetween(tx: Reader, companyId: string, from: string, to: string, courtId?: string): Promise<MonthlyBusy[]> {
  const days = daysBetween(from, to);
  if (!days.length) return [];
  const weekdays = [...new Set(days.map(weekdayOf))];
  const rows = await tx.select({ slot: monthlyMemberSlots, amountCents: monthlyMembers.amountCents, clientName: clients.name, clientPhone: clients.phone, courtName: courts.name, sport: courts.sport })
    .from(monthlyMemberSlots).innerJoin(monthlyMembers, eq(monthlyMemberSlots.memberId, monthlyMembers.id)).innerJoin(clients, eq(monthlyMembers.clientId, clients.id)).innerJoin(courts, eq(monthlyMemberSlots.courtId, courts.id))
    .where(and(eq(monthlyMemberSlots.companyId, companyId), eq(monthlyMembers.status, 'active'), inArray(monthlyMemberSlots.weekday, weekdays), courtId ? eq(monthlyMemberSlots.courtId, courtId) : undefined));
  return days.flatMap((day) => rows.filter((r) => r.slot.weekday === weekdayOf(day)).map(({ slot, amountCents, clientName, clientPhone, courtName, sport }) => {
    const start = Number(slot.startTime.slice(0, 2)) * 60 + Number(slot.startTime.slice(3, 5));
    return { day, memberId: slot.memberId, slotId: slot.id, courtId: slot.courtId, courtName, sport, clientName, clientPhone, amountCents, start, end: start + slot.durationMinutes };
  })).sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
}
export const monthlyBusyOn = (tx: Reader, companyId: string, day: string, courtId?: string) => monthlyBusyBetween(tx, companyId, day, day, courtId);

/**
 * Horário fixo de mensalista ativo que se sobrepõe ao intervalo, na mesma quadra e dia.
 * Mesma regra usada pelo bot do WhatsApp. Encostar (fim = início) não é conflito.
 */
export async function findMonthlyConflict(tx: Reader, companyId: string, courtId: string, startAt: string, endAt: string) {
  const start = minutesOf(startAt), end = minutesOf(endAt);
  const hit = (await monthlyBusyOn(tx, companyId, startAt.slice(0, 10), courtId)).find((m) => m.start < end && m.end > start);
  return hit ? { clientName: hit.clientName, startTime: timeOf(hit.start), endTime: timeOf(hit.end) } : null;
}

export const monthlyConflictMessage = (conflict: { clientName: string; startTime: string; endTime: string }) =>
  `Conflito com o horário fixo do mensalista ${conflict.clientName} (${conflict.startTime}–${conflict.endTime}).`;
