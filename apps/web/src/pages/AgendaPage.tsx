import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, LoaderCircle, Plus } from 'lucide-react';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BookingDialog } from '@/components/BookingDialog';
import { DatePicker, localDateValue } from '@/components/DatePicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { errorMessage, formatCurrency, formatTime } from '@/lib/format';

type Court = { id: string; name: string; sport: string; price_cents: number };
type HoursDay = { weekday: number; is_open: boolean | number; open_time: string; close_time: string };
type Booking = { id: string; customer_name: string; start_at: string; end_at: string; amount_cents: number; status: string; court_name: string; court_id: string; sport: string };
type Block = { id: string; reason: string; start_at: string; end_at: string; court_name: string; court_id: string };
type DayData = { date: string; bookings: Booking[]; blocks: Block[] };

const statusLabel: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmada', completed: 'Concluída', monthly: 'Mensalista' };
const dateFromKey = (date: string) => parseISO(`${date}T12:00:00`);

export function AgendaPage() {
  const [date, setDate] = useState(localDateValue());
  const [view, setView] = useState<'day' | 'week'>('day');
  const [filter, setFilter] = useState('all');
  const [courts, setCourts] = useState<Court[]>([]);
  const [hours, setHours] = useState<HoursDay[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [weekData, setWeekData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(false);
  const [mode, setMode] = useState<'booking' | 'block'>('booking');

  const weekStart = startOfWeek(dateFromKey(date), { weekStartsOn: 1 });
  const weekDates = Array.from({ length: 7 }, (_, index) => localDateValue(addDays(weekStart, index)));

  async function load() {
    setLoading(true);
    setError('');
    try {
      const dates = view === 'week' ? weekDates : [date];
      const [courtData, settings, days] = await Promise.all([
        api<{ courts: Court[] }>('/api/courts'),
        api<{ weeklyHours: HoursDay[] }>('/api/arena/settings'),
        Promise.all(dates.map(async (day) => {
          const result = await api<{ bookings: Booking[]; blocks: Block[] }>(`/api/bookings?date=${day}`);
          return { date: day, bookings: result.bookings, blocks: result.blocks };
        })),
      ]);
      setCourts(courtData.courts);
      setHours(settings.weeklyHours);
      setWeekData(days);
      const selectedDay = days.find((item) => item.date === date) || days[0];
      setBookings(selectedDay?.bookings || []);
      setBlocks(selectedDay?.blocks || []);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [date, view]);

  const weekday = dateFromKey(date).getDay();
  const dayHours = hours.find((item) => item.weekday === weekday);
  const isOpen = Boolean(dayHours && (dayHours.is_open === true || dayHours.is_open === 1));
  const visibleCourts = filter === 'all' ? courts : courts.filter((court) => court.id === filter);
  const hoursStart = isOpen ? Number(dayHours!.open_time.slice(0, 2)) : 8;
  const hoursEnd = isOpen ? Number(dayHours!.close_time.slice(0, 2)) : 22;
  const slots = Array.from({ length: Math.max(1, hoursEnd - hoursStart) }, (_, index) => `${String(hoursStart + index).padStart(2, '0')}:00`);
  const dayBookings = bookings.filter((booking) => booking.status !== 'cancelled');
  const openHours = hours.filter((item) => item.is_open === true || item.is_open === 1);
  const weekStartHour = openHours.length ? Math.min(...openHours.map((item) => Number(item.open_time.slice(0, 2)))) : 8;
  const weekEndHour = openHours.length ? Math.max(...openHours.map((item) => Number(item.close_time.slice(0, 2)))) : 22;
  const weekSlots = Array.from({ length: Math.max(1, weekEndHour - weekStartHour) }, (_, index) => `${String(weekStartHour + index).padStart(2, '0')}:00`);
  const selectedWeekData = weekData.find((item) => item.date === date);
  const selectedWeekHours = hours.find((item) => item.weekday === dateFromKey(date).getDay());

  function openDialog(nextMode: 'booking' | 'block') {
    setMode(nextMode);
    setDialog(true);
  }

  function moveDate(delta: number) {
    const current = dateFromKey(date);
    const next = view === 'week' ? addDays(weekStart, delta * 7) : addDays(current, delta);
    setDate(localDateValue(next));
  }

  function renderBooking(booking: Booking) {
    return <div key={booking.id} className="mb-1 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <strong className="truncate">{booking.customer_name}</strong>
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{statusLabel[booking.status] || booking.status}</Badge>
      </div>
      <p className="mt-1 text-muted-foreground">{formatTime(booking.start_at)}–{formatTime(booking.end_at)} · {booking.court_name} · {formatCurrency(booking.amount_cents)}</p>
    </div>;
  }

  function renderBlock(block: Block) {
    return <div key={block.id} className="mb-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
      <strong>Bloqueado · {block.court_name}</strong>
      <p className="text-muted-foreground">{formatTime(block.start_at)}–{formatTime(block.end_at)} · {block.reason}</p>
    </div>;
  }

  function renderCompactTimeline(day: DayData, opening: HoursDay | undefined) {
    const dayOpen = Boolean(opening && (opening.is_open === true || opening.is_open === 1));
    if (!dayOpen) return <p className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">A arena está fechada neste dia.</p>;
    const start = Number(opening!.open_time.slice(0, 2));
    const end = Number(opening!.close_time.slice(0, 2));
    const compactSlots = Array.from({ length: Math.max(1, end - start) }, (_, index) => `${String(start + index).padStart(2, '0')}:00`);
    const activeBookings = day.bookings.filter((booking) => booking.status !== 'cancelled');
    return <div className="grid gap-2">{compactSlots.map((slot) => <section key={slot} className="grid gap-2 rounded-lg border p-3"><h3 className="text-sm font-semibold">{slot}</h3><div className="grid gap-2 min-[420px]:grid-cols-2">{visibleCourts.map((court) => {
      const matching = activeBookings.filter((booking) => booking.court_id === court.id && formatTime(booking.start_at).slice(0, 2) === slot.slice(0, 2));
      const blocked = day.blocks.filter((block) => block.court_id === court.id && formatTime(block.start_at).slice(0, 2) === slot.slice(0, 2));
      return <div key={court.id} className="min-w-0 rounded-md bg-muted/35 p-2"><p className="mb-1 truncate text-xs font-medium">{court.name}</p>{matching.map(renderBooking)}{blocked.map(renderBlock)}{!matching.length && !blocked.length && <Button type="button" variant="outline" size="sm" className="w-full whitespace-normal" onClick={() => openDialog('booking')} aria-label={`Criar reserva ${court.name} às ${slot}`}>Disponível · reservar</Button>}</div>;
    })}</div></section>)}</div>;
  }

  return <div className="grid gap-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h1 className="text-2xl font-bold tracking-tight">Agenda</h1><p className="mt-1 text-sm text-muted-foreground">Disponibilidade e ocupação das quadras.</p></div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
        <div className="col-span-2 flex rounded-md border p-0.5 sm:col-span-1" aria-label="Visualização da agenda">
          <Button className="flex-1 sm:flex-none" variant={view === 'day' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'day'} onClick={() => setView('day')}>Dia</Button>
          <Button className="flex-1 sm:flex-none" variant={view === 'week' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'week'} onClick={() => setView('week')}>Semana</Button>
        </div>
        <div className="col-span-2 grid min-w-0 grid-cols-[44px_minmax(0,1fr)_44px] gap-2 sm:col-span-1 sm:flex">
          <Button variant="outline" size="icon" className="size-11 sm:size-9" aria-label={view === 'week' ? 'Semana anterior' : 'Dia anterior'} onClick={() => moveDate(-1)}><ChevronLeft /></Button>
          <DatePicker className="min-w-0 w-full justify-center px-2" value={date} onChange={setDate} />
          <Button variant="outline" size="icon" className="size-11 sm:size-9" aria-label={view === 'week' ? 'Próxima semana' : 'Próximo dia'} onClick={() => moveDate(1)}><ChevronRight /></Button>
        </div>
        <Button className="col-span-2 w-full sm:col-span-1 sm:w-auto" onClick={() => openDialog('booking')} disabled={!courts.length}><Plus /> Reserva</Button>
      </div>
    </header>

    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    <Card>
      <CardHeader className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <CardTitle className="text-base">{view === 'day' ? format(dateFromKey(date), "EEEE, d 'de' MMMM", { locale: ptBR }) : `${format(dateFromKey(weekDates[0]), 'd MMM', { locale: ptBR })} – ${format(dateFromKey(weekDates[6]), "d 'de' MMMM", { locale: ptBR })}`}</CardTitle>
          <p className="text-xs text-muted-foreground">{view === 'day' ? isOpen ? `Aberta das ${dayHours!.open_time} às ${dayHours!.close_time}` : 'Arena fechada neste dia' : 'Semana de segunda a domingo'}</p>
        </div>
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Todas as quadras" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todas as quadras</SelectItem>{courts.map((court) => <SelectItem key={court.id} value={court.id}>{court.name}</SelectItem>)}</SelectContent>
          </Select>
          {view === 'day' && <Button className="w-full sm:w-auto" variant="outline" onClick={() => openDialog('block')} disabled={!courts.length}>Bloquear horário</Button>}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? <div className="grid min-h-48 place-items-center"><LoaderCircle className="animate-spin text-primary" /></div> : view === 'day' ? <>
          <div className="mb-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-900">{dayBookings.length} reservas</span><span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">{blocks.length} bloqueios</span></div>
          <div className="md:hidden">{renderCompactTimeline({ date, bookings: dayBookings, blocks }, dayHours)}</div>
          <div className="hidden overflow-x-auto md:block"><div className="min-w-[680px]">
            <div className="grid border-b" style={{ gridTemplateColumns: `64px repeat(${Math.max(1, visibleCourts.length)}, minmax(170px, 1fr))` }}>
              <div className="p-2 text-xs text-muted-foreground">Horário</div>
              {visibleCourts.map((court) => <div key={court.id} className="border-l p-2 text-sm font-semibold">{court.name}<span className="block text-xs font-normal text-muted-foreground">{court.sport}</span></div>)}
            </div>
            {slots.map((slot) => <div key={slot} className="grid min-h-[86px] border-b" style={{ gridTemplateColumns: `64px repeat(${Math.max(1, visibleCourts.length)}, minmax(170px, 1fr))` }}>
              <div className="pt-2 text-xs text-muted-foreground">{slot}</div>
              {visibleCourts.map((court) => {
                const matching = dayBookings.filter((booking) => booking.court_id === court.id && formatTime(booking.start_at).slice(0, 2) === slot.slice(0, 2));
                const blocked = blocks.filter((block) => block.court_id === court.id && formatTime(block.start_at).slice(0, 2) === slot.slice(0, 2));
                return <div key={court.id} className="border-l p-1">{matching.map(renderBooking)}{blocked.map(renderBlock)}{!matching.length && !blocked.length && <button type="button" onClick={() => openDialog('booking')} className="h-full min-h-14 w-full rounded-md text-left text-xs text-transparent hover:bg-muted hover:text-muted-foreground" aria-label={`Criar reserva ${court.name} às ${slot}`}>Disponível</button>}</div>;
              })}
            </div>)}
          </div></div>
        </> : <>
          <div className="mb-4 hidden flex-wrap gap-2 text-xs md:flex">
            {weekData.map((day) => <span key={day.date} className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-900">{format(dateFromKey(day.date), 'EEE d', { locale: ptBR })}: {day.bookings.filter((booking) => booking.status !== 'cancelled').length} reservas · {day.blocks.length} bloqueios</span>)}
          </div>
          <div className="mb-4 grid grid-cols-7 gap-1 lg:hidden" aria-label="Dias desta semana">
            {weekDates.map((day) => {
              const data = weekData.find((item) => item.date === day);
              const count = (data?.bookings || []).filter((booking) => booking.status !== 'cancelled').length;
              const current = day === date;
              return <button type="button" key={day} onClick={() => setDate(day)} aria-pressed={current} aria-label={format(dateFromKey(day), "EEEE, d 'de' MMMM", { locale: ptBR })} className={`grid min-w-0 place-items-center rounded-md border px-0.5 py-2 text-center ${current ? 'border-primary bg-primary text-white' : 'bg-background hover:bg-muted'}`}><span className="text-[10px] capitalize">{format(dateFromKey(day), 'EEE', { locale: ptBR })}</span><strong className="text-sm">{format(dateFromKey(day), 'd')}</strong><span className={`text-[9px] ${current ? 'text-white/80' : 'text-muted-foreground'}`}>{count} res.</span></button>;
            })}
          </div>
          <div className="mb-3 lg:hidden"><h3 className="text-sm font-semibold capitalize">{format(dateFromKey(date), 'EEEE, d MMMM', { locale: ptBR })}</h3><p className="text-xs text-muted-foreground">{(selectedWeekData?.bookings || []).filter((booking) => booking.status !== 'cancelled').length} reservas · {selectedWeekData?.blocks.length || 0} bloqueios</p></div>
          <div className="mb-4 lg:hidden">{selectedWeekData ? renderCompactTimeline(selectedWeekData, selectedWeekHours) : <div className="grid min-h-24 place-items-center text-sm text-muted-foreground">Carregando este dia…</div>}</div>
          <div className="hidden overflow-x-auto lg:block">
            <div className="min-w-[980px]">
              <div className="grid border-b" style={{ gridTemplateColumns: '64px repeat(7, minmax(130px, 1fr))' }}>
                <div className="p-2 text-xs text-muted-foreground">Horário</div>
                {weekDates.map((day) => {
                  const isDayOpen = hours.some((item) => item.weekday === dateFromKey(day).getDay() && (item.is_open === true || item.is_open === 1));
                  return <div key={day} className="border-l p-2 text-sm font-semibold">{format(dateFromKey(day), 'EEEE', { locale: ptBR })}<span className="block text-xs font-normal text-muted-foreground">{format(dateFromKey(day), 'd MMM', { locale: ptBR })} · {isDayOpen ? 'Aberta' : 'Fechada'}</span></div>;
                })}
              </div>
              {weekSlots.map((slot) => <div key={slot} className="grid min-h-[100px] border-b" style={{ gridTemplateColumns: '64px repeat(7, minmax(130px, 1fr))' }}>
                <div className="pt-2 text-xs text-muted-foreground">{slot}</div>
                {weekDates.map((day) => {
                  const data = weekData.find((item) => item.date === day);
                  const dailyBookings = (data?.bookings || []).filter((booking) => booking.status !== 'cancelled' && (filter === 'all' || booking.court_id === filter) && formatTime(booking.start_at).slice(0, 2) === slot.slice(0, 2));
                  const dailyBlocks = (data?.blocks || []).filter((block) => (filter === 'all' || block.court_id === filter) && formatTime(block.start_at).slice(0, 2) === slot.slice(0, 2));
                  return <div key={day} className="border-l p-1">{dailyBookings.map(renderBooking)}{dailyBlocks.map(renderBlock)}</div>;
                })}
              </div>)}
            </div>
          </div>
        </>}
      </CardContent>
    </Card>
    <BookingDialog open={dialog} onOpenChange={setDialog} courts={courts} weeklyHours={hours} initialDate={date} mode={mode} onSaved={() => void load()} />
  </div>;
}
