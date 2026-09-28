import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarPlus, ChevronRight, LoaderCircle, Lock, Phone, Plus } from 'lucide-react';
import { addDays, startOfWeek } from 'date-fns';
import { BookingDialog } from '@/components/BookingDialog';
import { BookingDetailSheet, type DetailItem } from '@/components/app/BookingDetailSheet';
import { CancelBookingDialog, useBookingActions, type CancelTarget } from '@/components/app/booking-actions';
import { DateNav } from '@/components/app/DateNav';
import { PageHeader, Panel, Segmented } from '@/components/app/page';
import { useMediaQuery } from '@/components/app/ResponsiveSheet';
import { usePrimaryAction } from '@/components/app/shell-context';
import { bookingStatus, type BookingStatus } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  activeBookings, bookingMinutes, dateFromKey, fetchArenaBasics, fetchDay, fmtDate, isActiveCourt, keyOf, occupancy, openWindow, todayKey,
  type Block, type Court, type DayBooking, type DayData, type HoursDay,
} from '@/lib/arena';
import { errorMessage, formatCurrency, formatPhone, formatTime, minutesOf, plural, timeOfMinutes } from '@/lib/format';
import { cn } from '@/lib/utils';

const eventTone: Record<string, string> = {
  confirmed: 'border-brand-500 bg-brand-50 text-brand-900 hover:bg-brand-100/70',
  monthly: 'border-lime-500 bg-lime-50 text-lime-950 hover:bg-lime-100/80',
  pending: 'border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100/70',
  completed: 'border-gray-400 bg-gray-50 text-gray-700 hover:bg-gray-100',
  block: 'bg-hatch border-gray-400 text-gray-700',
};
const eventBadge: Record<string, string> = {
  confirmed: 'bg-brand-100 text-brand-800', monthly: 'bg-lime-200/70 text-lime-900', pending: 'bg-amber-100 text-amber-800', completed: 'bg-gray-200 text-gray-700',
};
const labelOf = (status: string) => bookingStatus[status as BookingStatus]?.label || status;
const weekStartKey = (key: string) => keyOf(startOfWeek(dateFromKey(key), { weekStartsOn: 1 }));

type Dialog = { mode: 'booking' | 'block' | 'edit'; courtId?: string; start?: string; booking?: DayBooking } | null;

export function AgendaPage() {
  const [date, setDate] = useState(todayKey());
  const [view, setView] = useState<'day' | 'week'>('day');
  const [filter, setFilter] = useState('all');
  const [mobileCourt, setMobileCourt] = useState('');
  const [courts, setCourts] = useState<Court[]>([]);
  const [hours, setHours] = useState<HoursDay[]>([]);
  const [slug, setSlug] = useState('');
  const [week, setWeek] = useState<DayData[]>([]);
  const [loadedWeek, setLoadedWeek] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [, setTick] = useState(0);
  const isMobile = !useMediaQuery('(min-width: 768px)');

  const wsKey = weekStartKey(date);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => keyOf(addDays(dateFromKey(wsKey), i))), [wsKey]);

  async function load(force = false) {
    if (!force && loadedWeek === wsKey && week.length) return;
    setLoading(true); setError('');
    try {
      const [basics, days] = await Promise.all([fetchArenaBasics(), Promise.all(weekDates.map(fetchDay))]);
      setCourts(basics.courts); setHours(basics.hours); setSlug(basics.slug); setWeek(days); setLoadedWeek(wsKey);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [wsKey]);
  // Linha do horário atual se atualiza a cada minuto.
  useEffect(() => { const timer = window.setInterval(() => setTick((n) => n + 1), 60_000); return () => window.clearInterval(timer); }, []);

  const actions = useBookingActions({ slug, onChanged: () => void load(true) });
  usePrimaryAction(() => setDialog({ mode: 'booking', courtId: isMobile && view === 'day' ? mobileCourt : undefined }));

  const activeCourts = courts.filter(isActiveCourt);
  useEffect(() => { if (activeCourts.length && !activeCourts.some((court) => court.id === mobileCourt)) setMobileCourt(activeCourts[0].id); }, [activeCourts, mobileCourt]);

  const day = week.find((item) => item.date === date);
  const opening = openWindow(hours, date);
  const list = day ? activeBookings(day.bookings) : [];
  const blocks = day?.blocks || [];
  const openMinutes = opening ? opening.close - opening.open : 0;
  const isToday = date === todayKey();

  function move(next: string) { setDate(next); }
  function openBooking(booking: DayBooking) { setDetail({ kind: 'booking', booking }); }

  // Deslizar para os lados troca o dia (celular).
  const touchX = useRef<number | null>(null);

  const cols = isMobile ? activeCourts.filter((court) => court.id === mobileCourt) : activeCourts.filter((court) => filter === 'all' || court.id === filter);

  return <div className="space-y-4 lg:space-y-5">
    <PageHeader title="Agenda" description="Disponibilidade e ocupação das quadras."
      actions={<>
        <Segmented label="Visualização" value={view} onChange={setView} options={[{ value: 'day', label: 'Dia' }, { value: 'week', label: 'Semana' }]} />
        <DateNav value={date} onChange={move} step={view === 'week' ? 7 : 1} className="flex-1 xl:flex-none"
          label={view === 'week' ? `${fmtDate(weekDates[0], 'd')} – ${fmtDate(weekDates[6], 'd MMM').replace('.', '')}` : undefined} />
        <Button variant="outline" className="hidden sm:inline-flex" onClick={() => setDate(todayKey())} disabled={isToday}>Hoje</Button>
        <Button className="hidden md:inline-flex" onClick={() => setDialog({ mode: 'booking' })} disabled={!activeCourts.length}><Plus /> Nova reserva</Button>
      </>} />

    {view === 'day' && <div className="grid grid-cols-7 gap-1.5 md:hidden" aria-label="Dias da semana">
      {weekDates.map((key) => {
        const selected = key === date, today = key === todayKey();
        const has = activeBookings(week.find((item) => item.date === key)?.bookings || []).length > 0;
        return <button key={key} type="button" onClick={() => setDate(key)} aria-pressed={selected} aria-label={fmtDate(key, "EEEE, d 'de' MMMM")}
          className={cn('flex flex-col items-center rounded-lg border py-2 transition', selected ? 'border-brand-900 bg-brand-900 text-white shadow-sm' : 'border-border bg-card')}>
          <span className={cn('text-[10.5px] uppercase', selected ? 'text-white/70' : 'text-muted-foreground')}>{fmtDate(key, 'EEE').slice(0, 3)}</span>
          <span className={cn('text-[15px] leading-tight font-semibold', today && !selected && 'text-brand-600')}>{fmtDate(key, 'd')}</span>
          <span aria-hidden="true" className={cn('mt-0.5 size-1 rounded-full', has ? (selected ? 'bg-lime-400' : 'bg-brand-500') : 'bg-transparent')} />
        </button>;
      })}
    </div>}

    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    {loading && !week.length ? <Panel className="grid min-h-72 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></Panel> : view === 'day' ? (
      <Panel>
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-4 lg:px-5 lg:pt-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold first-letter:uppercase">{fmtDate(date, "EEEE, d 'de' MMMM")}</h2>
            <p className="text-[12.5px] text-muted-foreground">{opening ? `Aberta das ${opening.openTime} às ${opening.closeTime}` : 'Arena fechada neste dia'}</p>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-44" aria-label="Filtrar quadra"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas as quadras</SelectItem>{activeCourts.map((court) => <SelectItem key={court.id} value={court.id}>{court.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setDialog({ mode: 'block' })} disabled={!activeCourts.length || !opening}><Lock /> Bloquear horário</Button>
          </div>
          <div className="flex w-full flex-wrap items-center gap-1.5">
            <Pill className="border-brand-100 bg-brand-50 text-brand-700"><span aria-hidden="true" className="size-1.5 rounded-full bg-brand-500" />{plural(list.length, 'reserva', 'reservas')}</Pill>
            <Pill className="border-amber-100 bg-amber-50 text-amber-800"><Lock className="size-3" aria-hidden="true" />{plural(blocks.length, 'bloqueio', 'bloqueios')}</Pill>
            <Pill className="border-border bg-muted text-muted-foreground">Ocupação {occupancy(list, openMinutes, activeCourts.length)}%</Pill>
            <Pill className="border-border bg-muted text-muted-foreground">{formatCurrency(list.filter((b) => b.status !== 'monthly').reduce((sum, b) => sum + b.amount_cents, 0))}</Pill>
          </div>
        </div>

        {activeCourts.length > 1 && <div className="px-4 pb-3 md:hidden">
          <div className="scrollbar-none flex gap-0.5 overflow-x-auto rounded-md bg-muted p-0.5 text-[12.5px] font-medium" role="tablist" aria-label="Quadra">
            {activeCourts.map((court) => {
              const n = list.filter((b) => b.court_id === court.id).length, on = court.id === mobileCourt;
              return <button key={court.id} type="button" role="tab" aria-selected={on} onClick={() => setMobileCourt(court.id)}
                className={cn('flex h-9 min-w-24 flex-1 items-center justify-center gap-1.5 rounded px-2 whitespace-nowrap transition', on ? 'bg-white text-foreground shadow-xs' : 'text-muted-foreground')}>
                {court.name}{n > 0 && <span className={cn('rounded-full px-1.5 text-[10px]', on ? 'bg-brand-100 text-brand-800' : 'bg-white/70')}>{n}</span>}
              </button>;
            })}
          </div>
        </div>}

        <div className="border-t" onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }} onTouchEnd={(e) => {
          if (touchX.current === null) return; const dx = e.changedTouches[0].clientX - touchX.current; touchX.current = null;
          if (Math.abs(dx) > 70) setDate(keyOf(addDays(dateFromKey(date), dx < 0 ? 1 : -1)));
        }}>
          {!opening ? <div className="px-5 py-12 text-center text-[13px] text-muted-foreground">A arena não abre neste dia. Ajuste os horários em Configurações.</div>
            : !cols.length ? <div className="px-5 py-12 text-center text-[13px] text-muted-foreground">Cadastre uma quadra ativa para usar a agenda.</div>
            : <DayGrid cols={cols} bookings={list} blocks={blocks} opening={opening} isToday={isToday} isMobile={isMobile}
                onSlot={(courtId, start) => setDialog({ mode: 'booking', courtId, start })} onBooking={openBooking} onBlock={(block) => setDetail({ kind: 'block', block })} />}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-4 py-3 text-[12px] text-muted-foreground lg:px-5">
          <Legend className="bg-brand-500">Confirmada</Legend><Legend className="bg-lime-400">Mensalista</Legend><Legend className="bg-amber-400">Pendente</Legend>
          <Legend className="bg-hatch border border-gray-300">Bloqueio</Legend>
          <span className="ml-auto hidden md:inline">Clique em um horário vazio para reservar</span>
        </div>
      </Panel>
    ) : <WeekView days={week} dates={weekDates} courts={activeCourts} hours={hours} onDay={(key) => { setDate(key); setView('day'); }} onBooking={openBooking} />}

    <BookingDialog open={Boolean(dialog)} onOpenChange={(open) => { if (!open) setDialog(null); }} courts={activeCourts} weeklyHours={hours} initialDate={date}
      mode={dialog?.mode} booking={dialog?.booking} initialCourtId={dialog?.courtId} initialStart={dialog?.start}
      onSaved={() => { void load(true); }} />
    <BookingDetailSheet item={detail} onClose={() => setDetail(null)} busy={actions.busy}
      onEdit={(booking) => { setDetail(null); setDialog({ mode: 'edit', booking }); }}
      onConfirm={async (booking) => { if (await actions.setStatus([booking.id], 'confirmed')) setDetail(null); }}
      onComplete={async (booking) => { if (await actions.setStatus([booking.id], 'completed')) setDetail(null); }}
      onCancel={(booking) => setCancelTarget({ ids: [booking.id], summary: `${booking.customer_name} · ${booking.court_name} · ${formatTime(booking.start_at)}–${formatTime(booking.end_at)}` })}
      onPix={(booking) => void actions.pixLink(booking.id)}
      onRelease={async (block) => { if (await actions.releaseBlock(block.id)) setDetail(null); }} />
    <CancelBookingDialog target={cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
      onConfirm={async (ids, reason) => { if (await actions.setStatus(ids, 'cancelled', reason)) setDetail(null); }} />
  </div>;
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11.5px] font-medium', className)}>{children}</span>;
}
function Legend({ className, children }: { className: string; children: ReactNode }) {
  return <span className="flex items-center gap-1.5"><span aria-hidden="true" className={cn('size-2.5 rounded-sm', className)} />{children}</span>;
}

type GridProps = {
  cols: Court[]; bookings: DayBooking[]; blocks: Block[]; opening: { open: number; close: number }; isToday: boolean; isMobile: boolean;
  onSlot: (courtId: string, start: string) => void; onBooking: (booking: DayBooking) => void; onBlock: (block: Block) => void;
};

/** Grade de horários: cada reserva ocupa a altura da sua duração (60 px por hora; 56 no celular). */
function DayGrid({ cols, bookings, blocks, opening, isToday, isMobile, onSlot, onBooking, onBlock }: GridProps) {
  const H = isMobile ? 56 : 60, ppm = H / 60;
  const gridStart = Math.floor(opening.open / 60) * 60, gridEnd = Math.ceil(opening.close / 60) * 60;
  const total = (gridEnd - gridStart) * ppm;
  const timeCol = isMobile ? 48 : 64;
  const template = { gridTemplateColumns: `${timeCol}px repeat(${cols.length}, minmax(0, 1fr))` };
  const lines = { height: total, backgroundImage: `linear-gradient(to bottom, #e7eae8 1px, transparent 1px), linear-gradient(to bottom, transparent ${H / 2}px, #f1f3f2 ${H / 2}px, #f1f3f2 ${H / 2 + 1}px, transparent ${H / 2 + 1}px)`, backgroundSize: `100% ${H}px` };
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const openSpan = opening.close - opening.open;

  return <>
    <div className="sticky top-16 z-20 hidden border-b bg-white/95 backdrop-blur md:grid" style={template}>
      <div className="self-end px-3 py-3 text-[11.5px] text-muted-foreground">Horário</div>
      {cols.map((court) => {
        const mine = bookings.filter((b) => b.court_id === court.id);
        const occ = openSpan ? Math.min(100, Math.round(mine.reduce((sum, b) => sum + bookingMinutes(b), 0) / openSpan * 100)) : 0;
        return <div key={court.id} className="min-w-0 border-l px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0"><div className="truncate font-semibold">{court.name}</div><div className="truncate text-[11.5px] text-muted-foreground">{court.sport} · {plural(mine.length, 'reserva', 'reservas')}</div></div>
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">{occ}%</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-brand-500" style={{ width: `${occ}%` }} /></div>
        </div>;
      })}
    </div>

    {isMobile && !bookings.some((b) => b.court_id === cols[0]?.id) && !blocks.some((b) => b.court_id === cols[0]?.id) && <div className="mx-4 my-3 flex items-center gap-2 rounded-lg border border-dashed bg-muted/50 px-4 py-3 text-[12.5px] text-muted-foreground">
      <CalendarPlus className="size-4 shrink-0" aria-hidden="true" />Nenhuma reserva em {cols[0]?.name} neste dia. Toque em um horário para reservar.
    </div>}

    <div className="relative grid" style={template}>
      <div className="relative" style={{ height: total }} aria-hidden="true">
        {Array.from({ length: (gridEnd - gridStart) / 60 }, (_, i) => <span key={i} className="absolute right-2 text-[11px] text-muted-foreground tabular-nums lg:right-3" style={{ top: i * H + 4 }}>{timeOfMinutes(gridStart + i * 60)}</span>)}
      </div>
      {cols.map((court) => {
        const evs = bookings.filter((b) => b.court_id === court.id), bls = blocks.filter((b) => b.court_id === court.id);
        const busy = (t: number) => evs.some((e) => t < minutesOf(e.end_at) && t + 30 > minutesOf(e.start_at)) || bls.some((b) => t < minutesOf(b.end_at) && t + 30 > minutesOf(b.start_at));
        const slots: number[] = []; for (let t = opening.open; t + 60 <= opening.close; t += 30) if (!busy(t)) slots.push(t);
        return <div key={court.id} className="relative border-l" style={lines}>
          {opening.open > gridStart && <div className="absolute inset-x-0 top-0 bg-muted/70" style={{ height: (opening.open - gridStart) * ppm }} aria-hidden="true" />}
          {opening.close < gridEnd && <div className="absolute inset-x-0 bottom-0 bg-muted/70" style={{ height: (gridEnd - opening.close) * ppm }} aria-hidden="true" />}
          {slots.map((t) => <button key={t} type="button" onClick={() => onSlot(court.id, timeOfMinutes(t))} aria-label={`Reservar ${court.name} às ${timeOfMinutes(t)}`}
            className="group absolute inset-x-1 rounded-md focus-visible:outline-2 focus-visible:outline-brand-500" style={{ top: (t - gridStart) * ppm + 2, height: H / 2 - 3 }}>
            <span className="hidden h-full items-center justify-center gap-1 rounded-md border border-dashed border-brand-400 bg-brand-50/70 text-[11px] font-medium text-brand-700 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 md:flex"><Plus className="size-3" aria-hidden="true" />{timeOfMinutes(t)}</span>
          </button>)}
          {bls.map((block) => <EventCard key={block.id} tone="block" top={(minutesOf(block.start_at) - gridStart) * ppm + 2} height={(minutesOf(block.end_at) - minutesOf(block.start_at)) * ppm - 4}
            title={<><Lock className="-mt-0.5 inline size-3" aria-hidden="true" /> {block.reason || 'Bloqueado'}</>} time={`${formatTime(block.start_at)}–${formatTime(block.end_at)}`}
            ariaLabel={`Bloqueio: ${block.reason}, ${formatTime(block.start_at)} a ${formatTime(block.end_at)}, ${court.name}`} onClick={() => onBlock(block)} />)}
          {evs.map((booking) => <EventCard key={booking.id} tone={booking.status} top={(minutesOf(booking.start_at) - gridStart) * ppm + 2} height={bookingMinutes(booking) * ppm - 4}
            title={booking.customer_name} badge={labelOf(booking.status)} time={`${formatTime(booking.start_at)}–${formatTime(booking.end_at)}${booking.status !== 'monthly' && booking.amount_cents ? ` · ${formatCurrency(booking.amount_cents)}` : ''}`}
            phone={booking.customer_phone ? formatPhone(booking.customer_phone) : undefined}
            ariaLabel={`${booking.customer_name}, ${formatTime(booking.start_at)} a ${formatTime(booking.end_at)}, ${court.name}, ${labelOf(booking.status)}`} onClick={() => onBooking(booking)} />)}
        </div>;
      })}
      {isToday && nowMin >= gridStart && nowMin <= gridEnd && <div className="pointer-events-none absolute right-0 z-20 flex items-center" style={{ top: (nowMin - gridStart) * ppm, left: timeCol - 6 }} aria-hidden="true">
        <span className="size-2.5 -translate-y-1/2 rounded-full bg-rose-500 ring-2 ring-white" /><span className="h-px flex-1 -translate-y-1/2 bg-rose-500" />
      </div>}
    </div>
  </>;
}

function EventCard({ tone, top, height, title, badge, time, phone, ariaLabel, onClick }: { tone: string; top: number; height: number; title: ReactNode; badge?: string; time: string; phone?: string; ariaLabel: string; onClick: () => void }) {
  const compact = height < 50;
  return <button type="button" onClick={onClick} aria-label={ariaLabel}
    className={cn('absolute right-1 left-1 z-10 overflow-hidden rounded-lg border-l-[3px] px-2.5 text-left shadow-xs transition hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-brand-500', compact ? 'py-1' : 'py-2', eventTone[tone] || eventTone.completed)}
    style={{ top, height: Math.max(height, 20) }}>
    <div className="flex items-start justify-between gap-2">
      <span className={cn('truncate text-[12.5px] font-semibold', tone !== 'block' && 'capitalize')}>{title}</span>
      {!compact && badge && <span className={cn('hidden shrink-0 rounded px-1.5 py-px text-[10.5px] font-medium sm:inline', eventBadge[tone])}>{badge}</span>}
    </div>
    <div className="truncate text-[11.5px] tabular-nums opacity-75">{time}</div>
    {height > 100 && phone && <div className="mt-1 flex items-center gap-1 text-[11px] opacity-60"><Phone className="size-3" aria-hidden="true" />{phone}</div>}
  </button>;
}

function WeekView({ days, dates, courts, hours, onDay, onBooking }: { days: DayData[]; dates: string[]; courts: Court[]; hours: HoursDay[]; onDay: (key: string) => void; onBooking: (booking: DayBooking) => void }) {
  const dayList = (key: string) => activeBookings(days.find((item) => item.date === key)?.bookings || []).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const dayOcc = (key: string) => { const w = openWindow(hours, key); return w ? occupancy(dayList(key), w.close - w.open, courts.length) : null; };
  const all = dates.flatMap(dayList);
  const chip = (booking: DayBooking) => <button key={booking.id} type="button" onClick={() => onBooking(booking)} aria-label={`${booking.customer_name}, ${formatTime(booking.start_at)} a ${formatTime(booking.end_at)}`}
    className={cn('w-full rounded-md border-l-[3px] px-2 py-1 text-left text-[11.5px]', eventTone[booking.status] || eventTone.completed)}>
    <div className="font-semibold tabular-nums">{formatTime(booking.start_at)}–{formatTime(booking.end_at)}</div><div className="truncate capitalize opacity-80">{booking.customer_name}</div>
  </button>;

  return <Panel>
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-4 lg:px-5">
      <div className="min-w-0 flex-1"><h2 className="text-[15px] font-semibold">Semana de {fmtDate(dates[0], "d 'de' MMMM")}</h2><p className="text-[12.5px] text-muted-foreground">Toque em um dia para abrir a agenda dele</p></div>
      <div className="flex flex-wrap gap-1.5">
        <Pill className="border-brand-100 bg-brand-50 text-brand-700">{plural(all.length, 'reserva', 'reservas')}</Pill>
        <Pill className="border-border bg-muted text-muted-foreground">{formatCurrency(all.filter((b) => b.status !== 'monthly').reduce((sum, b) => sum + b.amount_cents, 0))}</Pill>
      </div>
    </div>
    <div className="hidden md:block">
      <table className="w-full table-fixed">
        <thead><tr className="border-b"><th className="w-32" />{dates.map((key) => {
          const today = key === todayKey(), occ = dayOcc(key);
          return <th key={key} className="px-1.5 py-3 font-normal"><button type="button" onClick={() => onDay(key)} className={cn('w-full rounded-lg py-1.5 transition hover:bg-muted', today && 'bg-brand-50')}>
            <div className="text-[11px] text-muted-foreground uppercase">{fmtDate(key, 'EEE').slice(0, 3)}</div>
            <div className={cn('text-lg font-semibold', today && 'text-brand-700')}>{fmtDate(key, 'd')}</div>
            <div className="text-[11px] text-muted-foreground">{occ === null ? 'Fechada' : `${occ}%`}</div>
          </button></th>;
        })}</tr></thead>
        <tbody className="divide-y">{courts.map((court) => <tr key={court.id}>
          <td className="px-4 py-3 align-top"><div className="font-medium">{court.name}</div><div className="text-[11.5px] text-muted-foreground">{court.sport}</div></td>
          {dates.map((key) => {
            const evs = dayList(key).filter((b) => b.court_id === court.id);
            return <td key={key} className="h-24 border-l px-1.5 py-2 align-top"><div className="space-y-1">
              {evs.length ? evs.map(chip) : <button type="button" onClick={() => onDay(key)} className="h-16 w-full rounded-md text-[11px] text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground">Livre</button>}
            </div></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <ul className="divide-y md:hidden">{dates.map((key) => {
      const evs = dayList(key), today = key === todayKey(), occ = dayOcc(key);
      return <li key={key} className="px-4 py-3">
        <button type="button" onClick={() => onDay(key)} className="flex w-full items-center gap-3 text-left">
          <div className={cn('w-11 rounded-lg py-1 text-center', today ? 'bg-brand-900 text-white' : 'bg-muted')}>
            <div className={cn('text-[10px] uppercase', today ? 'text-white/70' : 'text-muted-foreground')}>{fmtDate(key, 'EEE').slice(0, 3)}</div><div className="leading-tight font-semibold">{fmtDate(key, 'd')}</div>
          </div>
          <div className={cn('flex-1 text-[12.5px]', !evs.length && 'text-muted-foreground')}>{evs.length ? <><b>{evs.length}</b> {evs.length === 1 ? 'reserva' : 'reservas'}{occ !== null && ` · ${occ}% ocupado`}</> : occ === null ? 'Arena fechada' : 'Sem reservas'}</div>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
        {evs.length > 0 && <div className="mt-2 ml-14 space-y-1.5">{evs.map((booking) => <button key={booking.id} type="button" onClick={() => onBooking(booking)}
          className={cn('flex w-full items-center gap-2 rounded-md border-l-[3px] px-2.5 py-1.5 text-left text-[12px]', eventTone[booking.status] || eventTone.completed)}>
          <span className="font-semibold tabular-nums">{formatTime(booking.start_at)}</span><span className="flex-1 truncate capitalize">{booking.customer_name}</span><span className="opacity-70">{booking.court_name}</span>
        </button>)}</div>}
      </li>;
    })}</ul>
  </Panel>;
}
