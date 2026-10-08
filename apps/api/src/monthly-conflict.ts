import { and, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { clients, courts, monthlyExceptions, monthlyMemberSlots, monthlyMembers } from '@quadrasflow/database';
import type { db } from './database.js';

type Reader = Pick<typeof db, 'select'>;

const minutesOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const timeOf = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/**
 * Horário fixo de um plano ativo num dia (minutos desde 00:00).
 * `originalDay`: a data do horário fixo; difere de `day` quando o jogo foi remarcado só naquela semana (`moved`).
 */
export type MonthlyBusy = { day: string; originalDay: string; moved: boolean; memberId: string; slotId: string; courtId: string; courtName: string; sport: string; clientName: string; clientPhone: string | null; amountCents: number; start: number; end: number };
/** Uma ocorrência (horário fixo + data original) que não deve contar, ao conferir a própria remarcação. */
export type Occurrence = { slotId: string; day: string };

/** Dias (AAAA-MM-DD) de `from` até `to`, inclusive. */
export function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (const d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Horários fixos de mensalistas ativos entre duas datas (opcionalmente só de uma quadra), já com as faltas
 * ("não vem": o horário fica livre) e as remarcações da semana (o jogo ocupa o novo dia/horário/quadra).
 * Único lugar que transforma plano em ocupação: agenda, conflitos, página pública e WhatsApp passam por aqui.
 */
export async function monthlyBusyBetween(tx: Reader, companyId: string, from: string, to: string, courtId?: string, ignore?: Occurrence): Promise<MonthlyBusy[]> {
  const days = daysBetween(from, to);
  if (!days.length) return [];
  const weekdays = [...new Set(days.map(weekdayOf))];
  const [rows, exceptions] = await Promise.all([
    tx.select({ slot: monthlyMemberSlots, amountCents: monthlyMembers.amountCents, clientName: clients.name, clientPhone: clients.phone, courtName: courts.name, sport: courts.sport })
      .from(monthlyMemberSlots).innerJoin(monthlyMembers, eq(monthlyMemberSlots.memberId, monthlyMembers.id)).innerJoin(clients, eq(monthlyMembers.clientId, clients.id)).innerJoin(courts, eq(monthlyMemberSlots.courtId, courts.id))
      .where(and(eq(monthlyMemberSlots.companyId, companyId), eq(monthlyMembers.status, 'active'), inArray(monthlyMemberSlots.weekday, weekdays), courtId ? eq(monthlyMemberSlots.courtId, courtId) : undefined)),
    tx.select({ exception: monthlyExceptions, slot: monthlyMemberSlots, amountCents: monthlyMembers.amountCents, clientName: clients.name, clientPhone: clients.phone, courtName: courts.name, sport: courts.sport })
      .from(monthlyExceptions).innerJoin(monthlyMemberSlots, eq(monthlyExceptions.slotId, monthlyMemberSlots.id)).innerJoin(monthlyMembers, eq(monthlyExceptions.memberId, monthlyMembers.id)).innerJoin(clients, eq(monthlyMembers.clientId, clients.id)).leftJoin(courts, eq(monthlyExceptions.newCourtId, courts.id))
      .where(and(eq(monthlyExceptions.companyId, companyId), eq(monthlyMembers.status, 'active'), or(and(gte(monthlyExceptions.day, from), lte(monthlyExceptions.day, to)), and(gte(monthlyExceptions.newDay, from), lte(monthlyExceptions.newDay, to))))),
  ]);
  const changed = new Set(exceptions.map((e) => `${e.exception.slotId}|${e.exception.day}`));
  const skip = (slotId: string, day: string) => (ignore?.slotId === slotId && ignore.day === day);
  const fixed = days.flatMap((day) => rows.filter((r) => r.slot.weekday === weekdayOf(day) && !changed.has(`${r.slot.id}|${day}`) && !skip(r.slot.id, day)).map(({ slot, amountCents, clientName, clientPhone, courtName, sport }): MonthlyBusy => {
    const start = toMin(slot.startTime);
    return { day, originalDay: day, moved: false, memberId: slot.memberId, slotId: slot.id, courtId: slot.courtId, courtName, sport, clientName, clientPhone, amountCents, start, end: start + slot.durationMinutes };
  }));
  const moved = exceptions.filter(({ exception: e }) => e.kind === 'move' && e.newDay && e.newDay >= from && e.newDay <= to && e.newCourtId && e.newStartTime && e.newDurationMinutes && (!courtId || e.newCourtId === courtId) && !skip(e.slotId, e.day))
    .map(({ exception: e, slot, amountCents, clientName, clientPhone, courtName, sport }): MonthlyBusy => {
      const start = toMin(e.newStartTime!);
      return { day: e.newDay!, originalDay: e.day, moved: true, memberId: slot.memberId, slotId: slot.id, courtId: e.newCourtId!, courtName: courtName ?? '', sport: sport ?? '', clientName, clientPhone, amountCents, start, end: start + e.newDurationMinutes! };
    });
  return [...fixed, ...moved].sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
}
export const monthlyBusyOn = (tx: Reader, companyId: string, day: string, courtId?: string) => monthlyBusyBetween(tx, companyId, day, day, courtId);

/**
 * Horário fixo de mensalista ativo que se sobrepõe ao intervalo, na mesma quadra e dia.
 * Mesma regra usada pelo bot do WhatsApp. Encostar (fim = início) não é conflito.
 */
export async function findMonthlyConflict(tx: Reader, companyId: string, courtId: string, startAt: string, endAt: string, ignore?: Occurrence) {
  const start = minutesOf(startAt), end = minutesOf(endAt);
  const day = startAt.slice(0, 10), hit = (await monthlyBusyBetween(tx, companyId, day, day, courtId, ignore)).find((m) => m.start < end && m.end > start);
  return hit ? { clientName: hit.clientName, startTime: timeOf(hit.start), endTime: timeOf(hit.end) } : null;
}

export const monthlyConflictMessage = (conflict: { clientName: string; startTime: string; endTime: string }) =>
  `Conflito com o horário fixo do mensalista ${conflict.clientName} (${conflict.startTime}–${conflict.endTime}).`;
