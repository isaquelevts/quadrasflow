import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Banknote, CalendarCheck2, CalendarX2, ClockAlert, Hourglass, LandPlot, LoaderCircle, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { Bar, BarChart, Cell, XAxis } from 'recharts';
import { BookingDialog } from '@/components/BookingDialog';
import { DateNav } from '@/components/app/DateNav';
import { Avatar, EmptyState, PageHeader, Panel, PanelHeader, Segmented, StatCard } from '@/components/app/page';
import { usePrimaryAction } from '@/components/app/shell-context';
import { BookingStatusBadge } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import {
  activeBookings, bookingMinutes, fetchArenaBasics, fetchAwaitingPayment, fetchDay, fmtDate, isActiveCourt, occupancy, openWindow, shiftKey, todayKey,
  type AwaitingPayment, type Court, type DayBooking, type HoursDay,
} from '@/lib/arena';
import { durationLabel, errorMessage, formatCurrency, formatTime, minutesOf, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

type DaySummary = { bookings_count: number; reserved_cents: number; pending_count: number; courts_active: number };
type PendingItem = { id: string; customerName: string; startAt: string; amountCents: number; courtName: string };
type DashboardData = { pending: { count: number; bookings: PendingItem[] }; today: DaySummary; week: Array<{ date: string; count: number; reserved_cents: number }> };

const chartConfig = { value: { label: 'Valor', color: 'var(--color-brand-500)' } } satisfies ChartConfig;

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [date, setDate] = useState(todayKey());
  const [data, setData] = useState<DashboardData | null>(null);
  const [previous, setPrevious] = useState<DaySummary | null>(null);
  const [bookings, setBookings] = useState<DayBooking[]>([]);
  const [awaiting, setAwaiting] = useState<AwaitingPayment[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [hours, setHours] = useState<HoursDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [metric, setMetric] = useState<'count' | 'value'>('count');
  const [courtFilter, setCourtFilter] = useState('all');

  usePrimaryAction(() => setCreateOpen(true));

  async function load() {
    setLoading(true); setError('');
    try {
      const [dashboard, lastWeek, day, basics, pix] = await Promise.all([
        api<DashboardData>(`/api/dashboard?date=${encodeURIComponent(date)}`),
        // Mesmo dia da semana anterior, para a comparação do indicador.
        api<DashboardData>(`/api/dashboard?date=${encodeURIComponent(shiftKey(date, -7))}`).catch(() => null),
        fetchDay(date),
        fetchArenaBasics(),
        fetchAwaitingPayment(),
      ]);
      setData(dashboard); setPrevious(lastWeek?.today ?? null); setBookings(day.bookings); setCourts(basics.courts); setHours(basics.hours); setAwaiting(pix);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [date]);

  const activeCourts = courts.filter(isActiveCourt);
  const opening = openWindow(hours, date);
  const openMinutes = opening ? opening.close - opening.open : 0;
  const dayActive = activeBookings(bookings);
  const regular = dayActive.filter((booking) => booking.status !== 'monthly');
  const monthly = dayActive.filter((booking) => booking.status === 'monthly');
  const occ = occupancy(dayActive, openMinutes, activeCourts.length);
  const occRegular = occupancy(regular, openMinutes, activeCourts.length);
  const reservedMinutes = dayActive.reduce((sum, booking) => sum + bookingMinutes(booking), 0);
  const isToday = date === todayKey();
  const firstName = user?.name?.split(' ')[0] || 'bem-vindo';

  return <div className="space-y-4 lg:space-y-6">
    <PageHeader alwaysShowTitle
      eyebrow={<span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium', opening ? 'border-brand-100 bg-brand-50 text-brand-700' : 'border-border bg-muted text-muted-foreground')}>
        <span aria-hidden="true" className={cn('size-1.5 rounded-full', opening ? 'bg-brand-500' : 'bg-gray-400', opening && isToday && 'animate-pulse')} />
        {opening ? `Arena aberta · ${opening.openTime}–${opening.closeTime}` : 'Arena fechada neste dia'}
      </span>}
      title={<>Olá, {firstName} <span aria-hidden="true">👋</span></>}
      description="Acompanhe o movimento da sua arena."
      actions={<>
        <DateNav value={date} onChange={setDate} className="flex-1 md:flex-none" />
        <Button variant="outline" className="h-10 md:h-9" onClick={() => setDate(todayKey())} disabled={isToday}>Hoje</Button>
        <Button className="hidden md:inline-flex" onClick={() => setCreateOpen(true)} disabled={!activeCourts.length}><Plus /> Nova reserva</Button>
      </>} />

    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    {loading && !data ? <div className="grid min-h-60 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div> : data && <>
      <PendingAlert data={data} awaiting={awaiting} onOpen={(key) => navigate(`/reservas?data=${key}`)} />

      <section className="grid grid-cols-2 gap-3 lg:gap-4 xl:grid-cols-4">
        <StatCard label="Valor reservado" icon={Banknote} value={formatCurrency(data.today.reserved_cents)}
          sub={<Comparison current={data.today.reserved_cents} previous={previous?.reserved_cents} weekday={fmtDate(shiftKey(date, -7), 'EEEE')} />} />
        <StatCard label="Reservas no dia" icon={CalendarCheck2} value={<span className="flex flex-wrap items-baseline gap-x-2">{data.today.bookings_count}{monthly.length > 0 && <span className="text-[12.5px] font-normal text-muted-foreground">+ {plural(monthly.length, 'mensalista', 'mensalistas')}</span>}</span>}
          sub={opening ? `${occ}% dos horários ocupados` : 'Arena fechada neste dia'}>
          {opening && <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Ocupação ${occ}%`}>
            <div className="bg-brand-500" style={{ width: `${occRegular}%` }} /><div className="bg-lime-400" style={{ width: `${Math.max(0, occ - occRegular)}%` }} />
          </div>}
        </StatCard>
        <StatCard label="Quadras ativas" icon={LandPlot} value={<span className="flex flex-wrap items-baseline gap-x-2">{activeCourts.length}<span className="text-[12.5px] font-normal text-muted-foreground">de {courts.length} cadastradas</span></span>}>
          <div className="mt-2.5 flex flex-wrap gap-1.5">{activeCourts.slice(0, 4).map((court) => <span key={court.id} className="rounded-md bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-800">{court.name}</span>)}{activeCourts.length > 4 && <span className="text-[11px] text-muted-foreground">+{activeCourts.length - 4}</span>}</div>
        </StatCard>
        <StatCard label="Reservas pendentes" icon={ClockAlert} tone={data.pending.count ? 'bg-amber-50 text-amber-600' : undefined} value={data.pending.count}
          sub={data.pending.count ? 'Em todas as datas, aguardando confirmação' : 'Nada aguardando confirmação'} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader title="Movimento da arena" description="Últimos 7 dias até a data selecionada"
            actions={<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Segmented label="Métrica do gráfico" size="sm" value={metric} onChange={setMetric} className="grid flex-1 grid-cols-2 sm:inline-flex sm:flex-none" options={[{ value: 'count', label: 'Reservas' }, { value: 'value', label: 'Faturamento' }]} />
              <Button asChild variant="ghost" size="sm" className="text-brand-700 hover:bg-brand-50"><Link to="/agenda">Abrir agenda <ArrowUpRight /></Link></Button>
            </div>} />
          <WeekChart week={data.week} metric={metric} selected={date} />
        </Panel>
        <DaySummaryPanel date={date} occ={occ} reservedMinutes={reservedMinutes} openMinutes={openMinutes} courts={activeCourts.length}
          regular={regular.length} pending={data.today.pending_count} monthly={monthly.length} reservedCents={data.today.reserved_cents} open={Boolean(opening)} />
      </section>

      <UpcomingPanel bookings={dayActive} courts={activeCourts} isToday={isToday} filter={courtFilter} onFilter={setCourtFilter} date={date} />
    </>}

    <BookingDialog open={createOpen} onOpenChange={setCreateOpen} courts={activeCourts} weeklyHours={hours} initialDate={date} onSaved={() => void load()} />
  </div>;
}

function Comparison({ current, previous, weekday }: { current: number; previous?: number; weekday: string }) {
  // Sem dado da semana anterior, o indicador aparece sem a comparação.
  if (!previous) return <>Reservas não canceladas nesta data</>;
  const change = Math.round((current - previous) / previous * 100);
  const up = change >= 0;
  return <span className="inline-flex flex-wrap items-center gap-1.5">
    <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold', up ? 'bg-brand-50 text-brand-700' : 'bg-rose-50 text-rose-700')}>
      {up ? <TrendingUp className="size-3" aria-hidden="true" /> : <TrendingDown className="size-3" aria-hidden="true" />}{up ? '+' : ''}{change}%
    </span>
    <span>vs. {weekday} passada · {formatCurrency(previous)}</span>
  </span>;
}

function PendingAlert({ data, awaiting, onOpen }: { data: DashboardData; awaiting: AwaitingPayment[]; onOpen: (date: string) => void }) {
  // Só aparece se houver pendência; some quando zera.
  if (!data.pending.count) return null;
  const first = data.pending.bookings[0];
  const pix = first ? awaiting.find((item) => item.id === first.id) : undefined;
  const expires = pix?.paymentExpiresAt ? new Date(pix.paymentExpiresAt) : null;
  return <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5 sm:flex-nowrap">
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700"><Hourglass className="size-4" aria-hidden="true" /></span>
    <div className="min-w-0 flex-1">
      <div className="font-medium text-amber-900">{data.pending.count === 1 ? '1 reserva aguardando confirmação' : `${data.pending.count} reservas aguardando confirmação`}</div>
      {first && <div className="text-[13px] text-amber-800/80">
        {first.customerName} · {first.courtName} · {first.startAt.slice(8, 10)}/{first.startAt.slice(5, 7)} às {formatTime(first.startAt)}
        {expires && <> · {expires.getTime() > Date.now() ? `Pix expira às ${expires.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Pix expirado'}</>}
      </div>}
    </div>
    {first && <Button variant="outline" size="sm" className="w-full border-amber-200 bg-white text-amber-900 hover:bg-amber-100/60 sm:w-auto" onClick={() => onOpen(first.startAt.slice(0, 10))}>Ver reserva</Button>}
  </div>;
}

function WeekChart({ week, metric, selected }: { week: DashboardData['week']; metric: 'count' | 'value'; selected: string }) {
  const rows = week.map((day) => ({ date: day.date, label: fmtDate(day.date, 'EEE').replace('.', ''), value: metric === 'count' ? day.count : day.reserved_cents / 100 }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const format = (value: number) => metric === 'count' ? plural(value, 'reserva', 'reservas') : formatCurrency(value * 100);
  return <div className="px-4 pb-4 lg:px-5 lg:pb-5">
    <div className="flex gap-6">
      <div><div className="text-[12px] text-muted-foreground">Total no período</div><div className="text-lg font-semibold tabular-nums">{format(total)}</div></div>
      <div><div className="text-[12px] text-muted-foreground">Média diária</div><div className="text-lg font-semibold tabular-nums">{metric === 'count' ? (total / 7).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : formatCurrency(total / 7 * 100)}</div></div>
    </div>
    <ChartContainer config={chartConfig} className="mt-4 aspect-auto h-44 w-full lg:h-52">
      <BarChart data={rows} margin={{ left: 0, right: 0, top: 8, bottom: 0 }} accessibilityLayer>
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} className="capitalize" />
        <ChartTooltip cursor={{ fill: 'var(--color-muted)' }} content={<ChartTooltipContent hideIndicator labelFormatter={(_, payload) => fmtDate(String(payload?.[0]?.payload?.date || selected), "EEEE, d 'de' MMM")} formatter={(value) => <span className="font-medium tabular-nums">{format(Number(value))}</span>} />} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={44} minPointSize={2}>
          {rows.map((row) => <Cell key={row.date} fill={row.date === selected ? 'var(--color-brand-500)' : 'var(--color-brand-100)'} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  </div>;
}

function DaySummaryPanel(props: { date: string; occ: number; reservedMinutes: number; openMinutes: number; courts: number; regular: number; pending: number; monthly: number; reservedCents: number; open: boolean }) {
  const circumference = 97.4;
  const rows: Array<[string, string, string]> = [
    ['bg-brand-500', 'Reservas registradas', String(props.regular)],
    ['bg-amber-400', 'Aguardando confirmação', String(props.pending)],
    ['bg-lime-400', 'Mensalistas', String(props.monthly)],
  ];
  return <Panel className="flex flex-col">
    <PanelHeader title="Resumo do dia" description={<span className="first-letter:uppercase">{fmtDate(props.date, "EEEE, d 'de' MMMM")}</span>} />
    <div className="flex items-center gap-5 px-5 pb-5">
      <div className="relative size-24 shrink-0" role="img" aria-label={`Ocupação ${props.occ}%`}>
        <svg viewBox="0 0 36 36" className="size-24 -rotate-90" aria-hidden="true">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#eef1ef" strokeWidth="3.5" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-brand-500)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - props.occ / 100)} className="transition-[stroke-dashoffset] duration-700" />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-lg leading-none font-semibold tabular-nums">{props.occ}%</div><div className="mt-0.5 text-[10.5px] text-muted-foreground">ocupação</div></div></div>
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        {props.open ? <><span className="font-medium text-foreground">{durationLabel(props.reservedMinutes)} reservadas</span> de {durationLabel(props.openMinutes * props.courts)} disponíveis {props.courts === 1 ? 'na quadra' : `nas ${props.courts} quadras`}.</> : 'A arena não abre neste dia.'}
      </p>
    </div>
    <dl className="mt-auto divide-y border-t">
      {rows.map(([dot, label, value]) => <div key={label} className="flex items-center justify-between px-5 py-3">
        <dt className="flex items-center gap-2 text-muted-foreground"><span aria-hidden="true" className={cn('size-2 rounded-full', dot)} />{label}</dt><dd className="font-semibold tabular-nums">{value}</dd>
      </div>)}
      <div className="flex items-center justify-between rounded-b-xl bg-muted/60 px-5 py-3"><dt className="font-medium">Valor reservado</dt><dd className="font-semibold text-brand-700 tabular-nums">{formatCurrency(props.reservedCents)}</dd></div>
    </dl>
  </Panel>;
}

function UpcomingPanel({ bookings, courts, isToday, filter, onFilter, date }: { bookings: DayBooking[]; courts: Court[]; isToday: boolean; filter: string; onFilter: (value: string) => void; date: string }) {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const inCourt = bookings.filter((booking) => filter === 'all' || booking.court_id === filter);
  const upcoming = isToday ? inCourt.filter((booking) => minutesOf(booking.end_at, date) > nowMinutes) : inCourt;
  const finished = inCourt.length - upcoming.length;
  const total = upcoming.filter((booking) => booking.status !== 'monthly').reduce((sum, booking) => sum + booking.amount_cents, 0);
  const courtOptions = [{ value: 'all', label: 'Todas' }, ...courts.map((court) => ({ value: court.id, label: court.name }))];

  return <Panel>
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-4 lg:px-5">
      <h2 className="flex min-w-0 flex-1 items-center gap-2 text-[15px] font-semibold">{isToday ? 'Próximas reservas' : 'Reservas do dia'}<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{upcoming.length}</span></h2>
      <Button asChild variant="outline" size="sm" className="md:order-last"><Link to={`/reservas?data=${date}`}>Ver todas <ArrowRight /></Link></Button>
      {courts.length > 1 && <div className="scrollbar-none -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 md:mx-0 md:w-auto md:px-0">
        <Segmented label="Filtrar por quadra" size="sm" value={filter} onChange={onFilter} options={courtOptions} className="border-0 bg-muted shadow-none" />
      </div>}
    </div>
    {upcoming.length ? <>
      <ul className="divide-y md:hidden">{upcoming.map((booking) => <li key={booking.id} className="flex items-center gap-3 px-4 py-3">
        <div className="w-14 shrink-0 rounded-lg bg-muted py-1.5 text-center"><div className="leading-tight font-semibold tabular-nums">{formatTime(booking.start_at)}</div><div className="text-[10.5px] text-muted-foreground tabular-nums">{formatTime(booking.end_at)}</div></div>
        <div className="min-w-0 flex-1"><div className="truncate font-medium capitalize">{booking.customer_name}</div><div className="mt-1 flex flex-wrap items-center gap-1.5"><span className="rounded bg-brand-100 px-1.5 py-px text-[10.5px] font-medium text-brand-800">{booking.court_name}</span><BookingStatusBadge status={booking.status} /></div></div>
        <div className="shrink-0 text-right"><div className="font-semibold tabular-nums">{booking.status === 'monthly' ? '—' : formatCurrency(booking.amount_cents)}</div><div className="text-[11px] text-muted-foreground">{booking.sport}</div></div>
      </li>)}</ul>
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-left">
        <thead><tr className="bg-muted/50 text-[12px] text-muted-foreground"><th className="w-32 px-5 py-2.5 font-medium">Horário</th><th className="px-3 py-2.5 font-medium">Cliente</th><th className="px-3 py-2.5 font-medium">Quadra</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-5 py-2.5 text-right font-medium">Valor</th></tr></thead>
        <tbody className="divide-y">{upcoming.map((booking) => <tr key={booking.id} className="transition hover:bg-muted/50">
          <td className="px-5 py-3"><div className="font-semibold tabular-nums">{formatTime(booking.start_at)}</div><div className="text-[11.5px] text-muted-foreground tabular-nums">até {formatTime(booking.end_at)}</div></td>
          <td className="px-3 py-3"><div className="flex items-center gap-2.5"><Avatar name={booking.customer_name} /><span className="font-medium capitalize">{booking.customer_name}</span></div></td>
          <td className="px-3 py-3"><div className="flex items-center gap-2"><span className="rounded-md bg-brand-100 px-2 py-0.5 text-[11.5px] font-medium text-brand-800">{booking.court_name}</span><span className="text-[12.5px] text-muted-foreground">{booking.sport}</span></div></td>
          <td className="px-3 py-3"><BookingStatusBadge status={booking.status} /></td>
          <td className="px-5 py-3 text-right font-semibold tabular-nums">{booking.status === 'monthly' ? <span className="font-normal text-muted-foreground">mensal</span> : formatCurrency(booking.amount_cents)}</td>
        </tr>)}</tbody>
      </table></div>
    </> : <EmptyState icon={CalendarX2} title={finished ? 'Todas as reservas de hoje já terminaram' : 'Nenhuma reserva nesta data'} text={filter === 'all' ? 'Toque no + para registrar uma nova reserva.' : 'Nenhuma reserva nesta quadra.'} />}
    <div className="flex justify-between gap-3 border-t px-4 py-3 text-[12.5px] text-muted-foreground lg:px-5">
      <span>{finished > 0 ? `${plural(finished, 'reserva já encerrada', 'reservas já encerradas')} hoje` : plural(upcoming.length, 'reserva', 'reservas')}</span>
      <span className="text-right">Total previsto: <b className="text-foreground tabular-nums">{formatCurrency(total)}</b></span>
    </div>
  </Panel>;
}
