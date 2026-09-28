import { addDays, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { api } from '@/lib/api';
import { minutesOf, minutesOfTime } from '@/lib/format';

export type Court = { id: string; name: string; sport: string; price_cents: number; photo_url?: string | null; active?: number | boolean };
export type HoursDay = { weekday: number; is_open: boolean | number; open_time: string; close_time: string };
export type DayBooking = { id: string; customer_name: string; customer_phone?: string | null; start_at: string; end_at: string; amount_cents: number; status: string; source?: string; court_name: string; court_id: string; sport: string };
export type Block = { id: string; reason: string; start_at: string; end_at: string; court_name: string; court_id: string };
export type DayData = { date: string; bookings: DayBooking[]; blocks: Block[] };
export type AwaitingPayment = { id: string; customerName: string; customerPhone?: string | null; courtName: string; startAt: string; endAt: string; amountCents: number; paymentExpiresAt: string | null };

/** Data (AAAA-MM-DD) como objeto Date ao meio-dia, para evitar saltos de fuso. */
export const dateFromKey = (key: string) => parseISO(`${key}T12:00:00`);
export const keyOf = (date: Date) => format(date, 'yyyy-MM-dd');
export const shiftKey = (key: string, days: number) => keyOf(addDays(dateFromKey(key), days));
export const todayKey = () => keyOf(new Date());
export const fmtDate = (key: string, pattern: string) => format(dateFromKey(key), pattern, { locale: ptBR });

export const isActiveCourt = (court: Court) => court.active === undefined || court.active === true || court.active === 1;
export const isOpenDay = (hours: HoursDay | undefined) => Boolean(hours && (hours.is_open === true || hours.is_open === 1));
export const hoursFor = (hours: HoursDay[], key: string) => hours.find((item) => item.weekday === dateFromKey(key).getDay());

/** Janela de funcionamento do dia em minutos, ou null se fechado. */
export function openWindow(hours: HoursDay[], key: string) {
  const day = hoursFor(hours, key);
  if (!isOpenDay(day)) return null;
  return { open: minutesOfTime(day!.open_time), close: minutesOfTime(day!.close_time), openTime: day!.open_time, closeTime: day!.close_time };
}

export const bookingMinutes = (booking: { start_at: string; end_at: string }) => Math.max(0, minutesOf(booking.end_at) - minutesOf(booking.start_at));
export const activeBookings = (list: DayBooking[]) => list.filter((booking) => booking.status !== 'cancelled');

/** Ocupação = soma das durações ÷ (horas de funcionamento × quadras). */
export function occupancy(list: DayBooking[], openMinutes: number, courts: number) {
  const capacity = openMinutes * courts;
  if (capacity <= 0) return 0;
  return Math.min(100, Math.round(activeBookings(list).reduce((sum, booking) => sum + bookingMinutes(booking), 0) / capacity * 100));
}

export async function fetchDay(date: string): Promise<DayData> {
  const result = await api<{ bookings: DayBooking[]; blocks: Block[] }>(`/api/bookings?date=${encodeURIComponent(date)}`);
  return { date, bookings: result.bookings, blocks: result.blocks };
}

export async function fetchArenaBasics() {
  const [courtData, settings] = await Promise.all([
    api<{ courts: Court[] }>('/api/courts'),
    api<{ weeklyHours: HoursDay[]; company: { slug: string } }>('/api/arena/settings'),
  ]);
  return { courts: courtData.courts, hours: settings.weeklyHours, slug: settings.company.slug };
}

/** Pedidos com Pix pendente. Falha silenciosa: sem Mercado Pago o bloco simplesmente não aparece. */
export async function fetchAwaitingPayment() {
  try { return (await api<{ bookings: AwaitingPayment[] }>('/api/bookings/awaiting-payment')).bookings; }
  catch { return []; }
}
