export function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(cents) || 0) / 100);
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function formatTime(iso: string) { return iso?.slice(11, 16) || '—'; }

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível carregar os dados.';
}

/** Telefone brasileiro legível: `559488024142` → `(94) 8802-4142`. Mantém o original quando não reconhece. */
export function formatPhone(value: string | null | undefined) {
  const raw = value || '';
  const d = raw.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}

export function initials(name: string | null | undefined) {
  return (name || '?').trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?';
}

/**
 * Minutos desde 00:00 de um horário salvo como `AAAA-MM-DDTHH:MM:…` (hora local da arena).
 * Com `day`, conta a partir de 00:00 desse dia: a madrugada seguinte vira 24:00 em diante.
 */
export function minutesOf(iso: string, day?: string) {
  const own = Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
  return day ? own + Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86_400_000) * 1440 : own;
}
/** Dia + minutos desde 00:00 (de madrugada passa de 1440) → horário salvo. */
export function isoAt(day: string, minutes: number) {
  const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + Math.floor(minutes / 1440));
  return `${d.toISOString().slice(0, 10)}T${clockOf(minutes)}:00.000Z`;
}
/** Minutos → horário de relógio: 1530 → "01:30". */
export function clockOf(total: number) { return timeOfMinutes(((total % 1440) + 1440) % 1440); }
/** "26:00" (fechamento de madrugada) → "02:00"; horários normais ficam iguais. */
export function clockLabel(time: string) { return clockOf(minutesOfTime(time)); }

export function minutesOfTime(time: string) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}

export function timeOfMinutes(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Duração legível: 90 → `1h30`, 60 → `1h`. */
export function durationLabel(minutes: number) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function whatsappLink(phone: string | null | undefined) {
  const d = (phone || '').replace(/\D/g, '');
  if (!d) return undefined;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}
