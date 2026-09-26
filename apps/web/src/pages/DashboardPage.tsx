import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Clock3, LoaderCircle, Plus, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BookingDialog } from '@/components/BookingDialog';
import { DatePicker, localDateValue } from '@/components/DatePicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { errorMessage, formatCurrency, formatTime } from '@/lib/format';
import { useAuth } from '@/auth/AuthProvider';

type DaySummary = { bookings_count: number; reserved_cents: number; pending_count: number; courts_active: number };
type DashboardData = { today: DaySummary; week: Array<{ date: string; count: number; reserved_cents: number }> };
type Court = { id: string; name: string; sport: string; price_cents: number };
type DayBooking = { id: string; customer_name: string; start_at: string; end_at: string; amount_cents: number; status: string; court_name: string; court_id: string; sport: string };
type DayData = { bookings: DayBooking[]; blocks: Array<{ id: string; start_at: string; reason: string; court_name: string }> };
type Settings = { weeklyHours: Array<{ weekday: number; is_open: number | boolean; open_time: string; close_time: string }> };

const statusLabel: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmada', cancelled: 'Cancelada', completed: 'Concluída', monthly: 'Mensalista' };

export function DashboardPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(localDateValue());
  const [data, setData] = useState<DashboardData | null>(null);
  const [bookings, setBookings] = useState<DayBooking[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [weeklyHours, setWeeklyHours] = useState<Settings['weeklyHours']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  async function load() {
    setLoading(true); setError('');
    try {
      const [dashboard, day, courtData, settings] = await Promise.all([
        api<DashboardData>(`/api/dashboard?date=${encodeURIComponent(date)}`),
        api<DayData>(`/api/bookings?date=${encodeURIComponent(date)}`),
        api<{ courts: Court[] }>('/api/courts'),
        api<Settings>('/api/arena/settings'),
      ]);
      setData(dashboard); setBookings(day.bookings.filter((booking) => booking.status !== 'cancelled').slice(0, 6)); setCourts(courtData.courts); setWeeklyHours(settings.weeklyHours);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [date]);

  const weekMax = Math.max(1, ...(data?.week.map((day) => day.count) || [1]));
  const greeting = user?.name?.split(' ')[0] || 'bem-vindo';

  return <div className="grid gap-5"><header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-primary">{user?.company?.name || 'Sua arena'}</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Olá, {greeting} <span aria-hidden="true">☀️</span></h1><p className="mt-1 text-sm text-muted-foreground">Acompanhe o movimento da sua arena.</p></div><div className="flex flex-wrap items-center gap-2"><DatePicker value={date} onChange={setDate} /><Button onClick={() => setCreateOpen(true)} disabled={!courts.length}><Plus /> Nova reserva</Button></div></header>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {loading && !data ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-primary" /></div> : <>
      <Card className="border-emerald-200 bg-emerald-50/60"><CardContent className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Resumo da arena</p><p className="text-sm text-muted-foreground">{data?.today.bookings_count || 0} reservas neste dia. {data?.today.pending_count || 0} aguardando confirmação.</p></div><CalendarDays className="hidden size-6 text-primary sm:block" /></CardContent></Card>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Valor reservado" value={formatCurrency(data?.today.reserved_cents || 0)} foot="Reservas não canceladas nesta data" icon={<WalletCards />} /><MetricCard label="Reservas no dia" value={String(data?.today.bookings_count || 0)} foot="Pedidos registrados" icon={<CalendarDays />} /><MetricCard label="Quadras ativas" value={String(data?.today.courts_active || 0)} foot="Disponíveis para reservas" icon={<Clock3 />} /><MetricCard label="Reservas pendentes" value={String(data?.today.pending_count || 0)} foot="Aguardando confirmação manual" icon={<Clock3 />} /></section>
      <section className="grid gap-4 xl:grid-cols-[1.55fr_1fr]"><Card><CardHeader className="flex flex-row items-start justify-between space-y-0"><div><CardTitle className="text-base">Movimento da arena</CardTitle><p className="mt-1 text-xs text-muted-foreground">Reservas nos últimos sete dias</p></div><Link to="/agenda" className="text-sm font-semibold text-primary">Abrir agenda <ArrowRight className="inline size-4" /></Link></CardHeader><CardContent><div className="flex h-44 items-end gap-2 border-b px-1 pb-2">{data?.week.map((day) => <div key={day.date} className="group flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] text-muted-foreground">{day.count || ''}</span><div title={`${day.count} reservas`} className="w-full max-w-12 rounded-t-md bg-emerald-600/80 transition-all group-hover:bg-emerald-500" style={{ height: `${Math.max(day.count ? 10 : 2, (day.count / weekMax) * 100)}%` }} /><span className="text-[9px] text-muted-foreground">{new Date(`${day.date}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' })}</span></div>)}</div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Resumo do dia</CardTitle><p className="text-xs text-muted-foreground">Reservas e valores na data selecionada</p></CardHeader><CardContent className="grid gap-3">{[['Reservas registradas', String(data?.today.bookings_count || 0)], ['Aguardando confirmação', String(data?.today.pending_count || 0)], ['Quadras ativas', String(data?.today.courts_active || 0)], ['Valor reservado', formatCurrency(data?.today.reserved_cents || 0)]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><strong>{value}</strong></div>)}</CardContent></Card></section>
      <Card><CardHeader className="flex flex-row items-center justify-between space-y-0"><div><CardTitle className="text-base">Próximas reservas do dia</CardTitle><p className="mt-1 text-xs text-muted-foreground">{bookings.length} próximas reservas</p></div><Button asChild variant="outline" size="sm"><Link to="/reservas">Ver todas</Link></Button></CardHeader><CardContent className="grid gap-2">{bookings.length ? bookings.map((booking) => <div key={booking.id} className="flex flex-col justify-between gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><span className="rounded-md bg-muted px-2 py-1 text-sm font-semibold">{formatTime(booking.start_at)}</span><div><p className="text-sm font-semibold">{booking.customer_name}</p><p className="text-xs text-muted-foreground">{booking.court_name} · {booking.sport}</p></div></div><div className="flex items-center gap-3"><Badge variant={booking.status === 'pending' ? 'secondary' : 'outline'}>{statusLabel[booking.status] || booking.status}</Badge><span className="text-sm font-semibold">{formatCurrency(booking.amount_cents)}</span></div></div>) : <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma reserva nesta data.</p>}</CardContent></Card>
    </>}
    <BookingDialog open={createOpen} onOpenChange={setCreateOpen} courts={courts} weeklyHours={weeklyHours} initialDate={date} onSaved={() => void load()} />
  </div>;
}

function MetricCard({ label, value, foot, icon }: { label: string; value: string; foot: string; icon: ReactNode }) {
  return <Card><CardContent className="p-4"><div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground"><span>{label}</span><span className="grid size-8 place-items-center rounded-lg bg-emerald-50 text-primary">{icon}</span></div><p className="mt-3 text-2xl font-bold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{foot}</p></CardContent></Card>;
}
