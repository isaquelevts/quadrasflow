import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowUpDown, BadgeCheck, Banknote, CalendarCheck2, CalendarX2, Check, Clock, Ellipsis, Eye, Hourglass, LoaderCircle, MessageCircle, Pencil, Plus, QrCode, Repeat, Search, X,
} from 'lucide-react';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type RowSelectionState, type SortingState } from '@tanstack/react-table';
import { BookingDialog } from '@/components/BookingDialog';
import { BookingDetailSheet, type DetailItem } from '@/components/app/BookingDetailSheet';
import { CancelBookingDialog, useBookingActions, type CancelTarget } from '@/components/app/booking-actions';
import { DateNav } from '@/components/app/DateNav';
import { Avatar, EmptyState, PageHeader, Panel } from '@/components/app/page';
import { usePrimaryAction } from '@/components/app/shell-context';
import { BookingStatusBadge, isActionable, isClosed } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  activeBookings, bookingMinutes, fetchArenaBasics, fetchAwaitingPayment, fetchDay, fmtDate, isActiveCourt, openWindow, todayKey,
  type AwaitingPayment, type Court, type DayBooking, type HoursDay,
} from '@/lib/arena';
import { durationLabel, errorMessage, formatCurrency, formatPhone, formatTime, plural, whatsappLink } from '@/lib/format';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'all', label: 'Todas' }, { key: 'confirmed', label: 'Confirmadas' }, { key: 'monthly', label: 'Mensalistas' },
  { key: 'pending', label: 'Pendentes' }, { key: 'completed', label: 'Concluídas' }, { key: 'cancelled', label: 'Canceladas' },
] as const;
const isDateKey = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

export function ReservationsPage() {
  const [params, setParams] = useSearchParams();
  const [date, setDate] = useState(() => isDateKey(params.get('data')) ? params.get('data')! : todayKey());
  const [tab, setTab] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [court, setCourt] = useState('all');
  const [bookings, setBookings] = useState<DayBooking[]>([]);
  const [awaiting, setAwaiting] = useState<AwaitingPayment[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [hours, setHours] = useState<HoursDay[]>([]);
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ name?: string; phone?: string }>({});
  const [editing, setEditing] = useState<DayBooking | undefined>();
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [openAfterLoad, setOpenAfterLoad] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'start', desc: false }]);
  const [selection, setSelection] = useState<RowSelectionState>({});

  async function load() {
    setLoading(true); setError('');
    try {
      const [day, basics, pix] = await Promise.all([fetchDay(date), fetchArenaBasics(), fetchAwaitingPayment()]);
      setBookings(day.bookings); setCourts(basics.courts); setHours(basics.hours); setSlug(basics.slug); setAwaiting(pix);
      if (openAfterLoad) { const found = day.bookings.find((b) => b.id === openAfterLoad); if (found) setDetail({ kind: 'booking', booking: found }); setOpenAfterLoad(null); }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); setSelection({}); }, [date]);

  // Links vindos de outras telas: ?data=AAAA-MM-DD e ?nova=1 (botão "+").
  useEffect(() => {
    const data = params.get('data');
    if (isDateKey(data) && data !== date) setDate(data);
    if (params.get('nova') === '1') {
      // Vindo da ficha do cliente: já abre com nome e telefone.
      setPrefill({ name: params.get('nome') || undefined, phone: params.get('tel') || undefined });
      setCreateOpen(true); ['nova', 'nome', 'tel'].forEach((key) => params.delete(key)); setParams(params, { replace: true });
    }
  }, [params]);

  const actions = useBookingActions({ slug, onChanged: () => { setSelection({}); void load(); } });
  usePrimaryAction(() => setCreateOpen(true));

  const activeCourts = courts.filter(isActiveCourt);
  const opening = openWindow(hours, date);
  const active = activeBookings(bookings);
  const cancelled = bookings.filter((b) => b.status === 'cancelled');
  const reservedMin = active.reduce((sum, b) => sum + bookingMinutes(b), 0);
  const capacityMin = opening ? (opening.close - opening.open) * activeCourts.length : 0;

  const base = useMemo(() => {
    const q = query.trim().toLowerCase(), digits = q.replace(/\D/g, '');
    return bookings.filter((b) => (court === 'all' || b.court_id === court) && (!q || b.customer_name.toLowerCase().includes(q) || (digits.length > 0 && (b.customer_phone || '').includes(digits))));
  }, [bookings, court, query]);
  const count = (key: string) => key === 'all' ? base.length : base.filter((b) => b.status === key).length;
  const rows = useMemo(() => base.filter((b) => tab === 'all' || b.status === tab), [base, tab]);

  const summary = (b: DayBooking) => `${b.customer_name} · ${b.court_name} · ${formatTime(b.start_at)}–${formatTime(b.end_at)}`;
  const askCancel = (list: DayBooking[]) => setCancelTarget({ ids: list.map((b) => b.id), summary: list.length === 1 ? summary(list[0]) : undefined });

  // Recriadas a cada render: as ações dependem da data e do slug atuais.
  const columns: ColumnDef<DayBooking>[] = [
    {
      id: 'select', enableSorting: false,
      header: ({ table }) => {
        const selectable = table.getRowModel().rows.filter((row) => row.getCanSelect());
        const all = selectable.length > 0 && selectable.every((row) => row.getIsSelected()), some = selectable.some((row) => row.getIsSelected());
        return <Checkbox aria-label="Selecionar todas" disabled={!selectable.length} checked={all ? true : some ? 'indeterminate' : false} onCheckedChange={(value) => selectable.forEach((row) => row.toggleSelected(Boolean(value)))} />;
      },
      cell: ({ row }) => row.getCanSelect() ? <Checkbox aria-label={`Selecionar ${row.original.customer_name}`} checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(Boolean(value))} /> : null,
    },
    {
      id: 'start', accessorFn: (b) => b.start_at, header: 'Horário',
      cell: ({ row: { original: b } }) => <div className={cn('whitespace-nowrap', isClosed(b.status) && 'opacity-50')}><div className="font-semibold tabular-nums">{formatTime(b.start_at)} – {formatTime(b.end_at)}</div><div className="text-[11.5px] text-muted-foreground">{durationLabel(bookingMinutes(b))}</div></div>,
    },
    {
      id: 'name', accessorFn: (b) => b.customer_name.toLowerCase(), header: 'Cliente',
      cell: ({ row: { original: b } }) => <button type="button" onClick={() => setDetail({ kind: 'booking', booking: b })} className={cn('flex items-center gap-2.5 text-left', isClosed(b.status) && 'opacity-50')}>
        <Avatar name={b.customer_name} />
        <span><span className="block font-medium capitalize underline-offset-2 hover:underline">{b.customer_name}</span>{b.customer_phone && <span className="block text-[11.5px] text-muted-foreground tabular-nums">{formatPhone(b.customer_phone)}</span>}</span>
      </button>,
    },
    { id: 'court', accessorFn: (b) => b.court_name, header: 'Quadra', enableSorting: false, cell: ({ row: { original: b } }) => <div className={cn(isClosed(b.status) && 'opacity-50')}><div className="font-medium">{b.court_name}</div><div className="text-[11.5px] text-muted-foreground">{b.sport}</div></div> },
    { id: 'status', header: 'Status', enableSorting: false, cell: ({ row: { original: b } }) => <BookingStatusBadge status={b.status} /> },
    {
      id: 'value', accessorFn: (b) => b.status === 'monthly' ? -1 : b.amount_cents, header: 'Valor',
      cell: ({ row: { original: b } }) => b.status === 'monthly' ? <span className="text-muted-foreground">mensal</span> : <span className={cn('font-semibold tabular-nums', b.status === 'cancelled' && 'font-normal text-muted-foreground line-through')}>{formatCurrency(b.amount_cents)}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Ações</span>, enableSorting: false,
      cell: ({ row: { original: b } }) => <div className="flex items-center justify-end gap-1.5">
        {b.status === 'confirmed' && <Button variant="outline" size="sm" disabled={actions.busy} onClick={() => void actions.setStatus([b.id], 'completed')}><Check />Concluir</Button>}
        {b.status === 'pending' && <Button variant="outline" size="sm" className="border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100" disabled={actions.busy} onClick={() => void actions.setStatus([b.id], 'confirmed')}><BadgeCheck />Confirmar</Button>}
        <RowMenu booking={b} onView={() => setDetail({ kind: 'booking', booking: b })} onEdit={() => setEditing(b)} onPix={() => void actions.pixLink(b.id)} onCancel={() => askCancel([b])} />
      </div>,
    },
  ];

  const table = useReactTable({
    data: rows, columns, state: { sorting, rowSelection: selection }, getRowId: (b) => b.id,
    enableRowSelection: (row) => isActionable(row.original.status),
    onSortingChange: setSorting, onRowSelectionChange: setSelection,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  });
  const selected = rows.filter((b) => selection[b.id] && isActionable(b.status));
  const total = rows.filter((b) => b.status !== 'cancelled' && b.status !== 'monthly').reduce((sum, b) => sum + b.amount_cents, 0);

  return <div className="space-y-4 lg:space-y-5">
    <PageHeader title="Reservas" description="Consulte e atualize as reservas da arena."
      actions={<>
        <DateNav value={date} onChange={(next) => { setDate(next); setParams({ data: next }, { replace: true }); }} className="flex-1 md:flex-none" />
        <Button variant="outline" className="h-10 md:h-9" onClick={() => { setDate(todayKey()); setParams({}, { replace: true }); }} disabled={date === todayKey()}>Hoje</Button>
        <Button className="hidden md:inline-flex" onClick={() => setCreateOpen(true)} disabled={!activeCourts.length}><Plus /> Nova reserva</Button>
      </>} />

    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    <AwaitingBlock items={awaiting} busy={actions.busy} onPix={(id) => void actions.pixLink(id)} onConfirm={(id) => void actions.setStatus([id], 'confirmed')}
      onView={(item) => { const key = item.startAt.slice(0, 10); if (key === date) { const found = bookings.find((b) => b.id === item.id); if (found) setDetail({ kind: 'booking', booking: found }); } else { setOpenAfterLoad(item.id); setDate(key); } }} />

    <section className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card shadow-card lg:grid-cols-4">
      <Stat icon={CalendarCheck2} label="Reservas ativas" value={active.length} sub={`${bookings.length} no total`} className="border-r border-b lg:border-b-0" />
      <Stat icon={Banknote} label="Receita prevista" value={formatCurrency(active.filter((b) => b.status !== 'monthly').reduce((sum, b) => sum + b.amount_cents, 0))} sub="sem canceladas e mensalistas" className="border-b lg:border-r lg:border-b-0" />
      <Stat icon={Clock} label="Horas reservadas" value={durationLabel(reservedMin)} sub={capacityMin ? `de ${durationLabel(capacityMin)} disponíveis` : 'arena fechada neste dia'} className="border-r" />
      <Stat icon={CalendarX2} tone="bg-rose-50 text-rose-600" label="Canceladas" value={cancelled.length} sub={`${formatCurrency(cancelled.reduce((sum, b) => sum + b.amount_cents, 0))} perdidos`} />
    </section>

    <Panel>
      <div className="space-y-3 px-4 pt-4 lg:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="w-full min-w-0 text-[15px] font-semibold sm:w-auto sm:flex-1"><span className="first-letter:uppercase">{fmtDate(date, "EEEE, d 'de' MMMM")}</span></h2>
          <label className="flex h-9 w-full items-center gap-2 rounded-md border bg-card px-3 text-muted-foreground shadow-xs focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 sm:w-64">
            <Search className="size-4" aria-hidden="true" /><span className="sr-only">Buscar</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome ou telefone" className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground" />
          </label>
          <Select value={court} onValueChange={setCourt}>
            <SelectTrigger className="flex-1 sm:w-44 sm:flex-none" aria-label="Filtrar quadra"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todas as quadras</SelectItem>{courts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="scrollbar-none -mx-4 overflow-x-auto border-b px-4 lg:-mx-5 lg:px-5">
          <div role="tablist" aria-label="Status" className="flex gap-5 whitespace-nowrap">
            {TABS.map((t) => {
              const n = count(t.key), on = tab === t.key;
              // Pendentes e Concluídas só aparecem quando têm itens.
              if ((t.key === 'pending' || t.key === 'completed') && !n && !on) return null;
              return <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => { setTab(t.key); setSelection({}); }}
                className={cn('relative flex items-center gap-2 pt-1 pb-3 font-medium transition', on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {t.label}<span className={cn('min-w-5 rounded-full px-1.5 text-[11px]', on ? 'bg-brand-900 text-white' : 'bg-muted')}>{n}</span>
                {on && <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand-900" />}
              </button>;
            })}
          </div>
        </div>
      </div>

      {loading ? <div className="grid min-h-48 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div> : rows.length ? <>
        <div className="hidden lg:block">
          <table className="w-full text-left">
            <thead>{table.getHeaderGroups().map((group) => <tr key={group.id} className="border-b bg-muted/50 text-[12px] text-muted-foreground">
              {group.headers.map((header) => <th key={header.id} className={cn('px-3 py-2.5 font-medium', header.id === 'select' && 'w-10 pr-2 pl-5', header.id === 'actions' && 'pr-5', header.id === 'value' && 'text-right')}
                aria-sort={header.column.getIsSorted() ? (header.column.getIsSorted() === 'asc' ? 'ascending' : 'descending') : undefined}>
                {header.column.getCanSort()
                  ? <button type="button" onClick={header.column.getToggleSortingHandler()} className={cn('flex items-center gap-1 hover:text-foreground', header.id === 'value' && 'ml-auto')}>{flexRender(header.column.columnDef.header, header.getContext())}<ArrowUpDown className="size-3" aria-hidden="true" /></button>
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </th>)}
            </tr>)}</thead>
            <tbody className="divide-y">{table.getRowModel().rows.map((row) => <tr key={row.id} className={cn('transition', row.getIsSelected() ? 'bg-brand-50/60' : 'hover:bg-muted/50')}>
              {row.getVisibleCells().map((cell) => <td key={cell.id} className={cn('px-3 py-3', cell.column.id === 'select' && 'pr-2 pl-5', cell.column.id === 'actions' && 'pr-5', cell.column.id === 'value' && 'text-right')}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <ul className="divide-y lg:hidden">{table.getRowModel().rows.map(({ original: b }) => <li key={b.id} className="px-4 py-3.5">
          <div className="flex items-start gap-3">
            <button type="button" onClick={() => setDetail({ kind: 'booking', booking: b })} className={cn('w-16 shrink-0 rounded-lg bg-muted py-1.5 text-center', isClosed(b.status) && 'opacity-50')} aria-label={`Ver ${b.customer_name}`}>
              <div className="leading-tight font-semibold tabular-nums">{formatTime(b.start_at)}</div><div className="text-[10.5px] text-muted-foreground tabular-nums">até {formatTime(b.end_at)}</div>
            </button>
            <button type="button" onClick={() => setDetail({ kind: 'booking', booking: b })} className="min-w-0 flex-1 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className={cn('truncate font-medium capitalize', isClosed(b.status) && 'text-muted-foreground')}>{b.customer_name}</span>
                <span className={cn('shrink-0 font-semibold tabular-nums', b.status === 'cancelled' && 'font-normal text-muted-foreground line-through')}>{b.status === 'monthly' ? 'mensal' : formatCurrency(b.amount_cents)}</span>
              </div>
              <div className="truncate text-[12px] text-muted-foreground">{b.court_name} · {b.sport}{b.customer_phone ? ` · ${formatPhone(b.customer_phone)}` : ''}</div>
              <div className="mt-1.5"><BookingStatusBadge status={b.status} /></div>
            </button>
          </div>
          {isActionable(b.status) && <div className="mt-3 ml-[76px] grid grid-cols-[1fr_auto] gap-2">
            {b.status === 'confirmed'
              ? <Button variant="outline" disabled={actions.busy} onClick={() => void actions.setStatus([b.id], 'completed')}><Check />Concluir</Button>
              : <Button variant="outline" className="border-amber-200 bg-amber-50 text-amber-900" disabled={actions.busy} onClick={() => void actions.setStatus([b.id], 'confirmed')}><BadgeCheck />Confirmar</Button>}
            <RowMenu booking={b} onView={() => setDetail({ kind: 'booking', booking: b })} onEdit={() => setEditing(b)} onPix={() => void actions.pixLink(b.id)} onCancel={() => askCancel([b])} bordered />
          </div>}
        </li>)}</ul>
        <div className="flex justify-between gap-3 border-t px-4 py-3 text-[12.5px] text-muted-foreground lg:px-5">
          <span>{plural(rows.length, 'reserva', 'reservas')}</span><span className="text-right">Total: <b className="text-foreground tabular-nums">{formatCurrency(total)}</b></span>
        </div>
      </> : <EmptyState icon={CalendarX2} title="Nenhuma reserva encontrada" text={query || court !== 'all' || tab !== 'all' ? 'Tente outro filtro ou outra busca.' : 'Nenhuma reserva nesta data.'}
        action={activeCourts.length ? <Button onClick={() => setCreateOpen(true)}><Plus /> Nova reserva</Button> : undefined} />}
    </Panel>

    {/* Barra flutuante de ações em lote (desktop) */}
    <div role="toolbar" aria-label="Ações em lote" aria-hidden={!selected.length}
      className={cn('fixed bottom-6 left-1/2 z-40 hidden -translate-x-1/2 items-center gap-1 rounded-xl bg-brand-950 py-1.5 pr-1.5 pl-4 text-white shadow-2xl transition-all lg:flex', selected.length ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0')}>
      <span className="mr-3 text-[13px] font-medium">{plural(selected.length, 'selecionada', 'selecionadas')}</span>
      <button type="button" tabIndex={selected.length ? 0 : -1} disabled={actions.busy} onClick={() => void actions.setStatus(selected.map((b) => b.id), 'completed')} className="flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] hover:bg-white/10"><Check className="size-4" aria-hidden="true" />Concluir</button>
      <button type="button" tabIndex={selected.length ? 0 : -1} disabled={actions.busy} onClick={() => askCancel(selected)} className="flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] text-rose-300 hover:bg-white/10"><X className="size-4" aria-hidden="true" />Cancelar</button>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/15" />
      <button type="button" tabIndex={selected.length ? 0 : -1} onClick={() => setSelection({})} aria-label="Limpar seleção" className="grid size-8 place-items-center rounded-md text-white/60 hover:bg-white/10"><X className="size-4" aria-hidden="true" /></button>
    </div>

    <BookingDialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setPrefill({}); }} courts={activeCourts} weeklyHours={hours} initialDate={date} initialName={prefill.name} initialPhone={prefill.phone} onSaved={() => void load()} />
    <BookingDialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(undefined); }} courts={activeCourts} weeklyHours={hours} initialDate={date} mode="edit" booking={editing} onSaved={() => { setEditing(undefined); void load(); }} />
    <BookingDetailSheet item={detail} onClose={() => setDetail(null)} busy={actions.busy}
      onEdit={(b) => { setDetail(null); setEditing(b); }}
      onConfirm={async (b) => { if (await actions.setStatus([b.id], 'confirmed')) setDetail(null); }}
      onComplete={async (b) => { if (await actions.setStatus([b.id], 'completed')) setDetail(null); }}
      onCancel={(b) => askCancel([b])} onPix={(b) => void actions.pixLink(b.id)}
      onRelease={async (block) => { if (await actions.releaseBlock(block.id)) setDetail(null); }} />
    <CancelBookingDialog target={cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
      onConfirm={async (ids, reason) => { if (await actions.setStatus(ids, 'cancelled', reason)) setDetail(null); }} />
  </div>;
}

function Stat({ icon: Icon, label, value, sub, tone = 'bg-brand-50 text-brand-600', className }: { icon: typeof Clock; label: string; value: ReactNode; sub: string; tone?: string; className?: string }) {
  return <div className={cn('p-4 lg:p-5', className)}>
    <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground lg:text-[13px]"><span className={cn('grid size-6 place-items-center rounded-md', tone)}><Icon className="size-3.5" aria-hidden="true" /></span>{label}</div>
    <div className="mt-2 text-xl font-semibold tracking-tight tabular-nums lg:text-2xl">{value}</div>
    <div className="text-[11.5px] text-muted-foreground lg:text-[12.5px]">{sub}</div>
  </div>;
}

function RowMenu({ booking, onView, onEdit, onPix, onCancel, bordered }: { booking: DayBooking; onView: () => void; onEdit: () => void; onPix: () => void; onCancel: () => void; bordered?: boolean }) {
  const wa = whatsappLink(booking.customer_phone);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant={bordered ? 'outline' : 'ghost'} size="icon-sm" className={cn(bordered ? 'size-10 md:size-9' : 'text-muted-foreground')} aria-label={`Mais ações para ${booking.customer_name}`}><Ellipsis /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" collisionPadding={{ bottom: 88 }} className="w-48">
      <DropdownMenuItem onSelect={onView}><Eye />Ver detalhes</DropdownMenuItem>
      {isActionable(booking.status) && <DropdownMenuItem onSelect={onEdit}><Pencil />Editar</DropdownMenuItem>}
      {wa && <DropdownMenuItem asChild><a href={wa} target="_blank" rel="noreferrer"><MessageCircle />Chamar no WhatsApp</a></DropdownMenuItem>}
      {booking.status === 'monthly' && <DropdownMenuItem asChild><Link to="/mensalistas"><Repeat />Ver mensalista</Link></DropdownMenuItem>}
      {booking.status === 'pending' && <DropdownMenuItem onSelect={onPix}><QrCode />Gerar link Pix</DropdownMenuItem>}
      {isActionable(booking.status) && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={onCancel}><X />Cancelar reserva</DropdownMenuItem></>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Pedidos com Pix pendente, de qualquer data, com contagem regressiva. */
function AwaitingBlock({ items, busy, onPix, onConfirm, onView }: { items: AwaitingPayment[]; busy: boolean; onPix: (id: string) => void; onConfirm: (id: string) => void; onView: (item: AwaitingPayment) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!items.length) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [items.length]);
  if (!items.length) return null;
  return <section className="rounded-xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white shadow-card">
    <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-3 lg:px-5">
      <span className="grid size-8 place-items-center rounded-lg bg-amber-100 text-amber-700"><Hourglass className="size-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-amber-950">Aguardando pagamento <span className="ml-1 rounded-full bg-amber-500 px-1.5 py-px align-middle text-[11px] text-white">{items.length}</span></h2>
        <p className="text-[12.5px] text-amber-900/70">Pedidos com Pix pendente, de qualquer data. A reserva só é confirmada quando o pagamento é aprovado.</p>
      </div>
    </div>
    <ul className="space-y-2 px-3 pb-3 lg:px-4 lg:pb-4">{items.map((item) => {
      const key = item.startAt.slice(0, 10), expires = item.paymentExpiresAt ? Date.parse(item.paymentExpiresAt) : null, left = expires ? expires - now : null;
      return <li key={item.id} className="flex flex-col gap-3 rounded-lg border border-amber-200/80 bg-white p-3 md:flex-row md:items-center lg:p-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="w-14 shrink-0 rounded-lg border border-amber-200 bg-amber-50 py-1 text-center">
            <div className="text-[10px] text-amber-800/70 uppercase">{fmtDate(key, 'EEE').slice(0, 3)}</div><div className="leading-tight font-semibold text-amber-950">{fmtDate(key, 'dd/MM')}</div>
          </div>
          <div className="min-w-0">
            <div className="font-medium capitalize">{item.customerName} <span className="font-normal text-muted-foreground">· {item.courtName}</span></div>
            <div className="text-[12.5px] text-muted-foreground tabular-nums">{formatTime(item.startAt)}–{formatTime(item.endAt)} · <b className="font-semibold text-foreground">{formatCurrency(item.amountCents)}</b></div>
            {left !== null && <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
              {left > 0
                ? <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-px font-medium text-amber-800 tabular-nums"><span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-amber-500" />expira em {countdown(left)}</span>
                : <span className="inline-flex items-center gap-1 rounded-md border border-rose-100 bg-rose-50 px-1.5 py-px font-medium text-rose-700"><span aria-hidden="true" className="size-1.5 rounded-full bg-rose-500" />Pix expirado</span>}
              <span className="text-muted-foreground">{left > 0 ? 'até' : 'em'} {new Date(expires!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            </div>}
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 md:flex">
          <Button variant="outline" disabled={busy} onClick={() => onPix(item.id)} aria-label="Gerar e copiar link Pix"><QrCode /><span className="hidden sm:inline">Link Pix</span></Button>
          <Button disabled={busy} onClick={() => onConfirm(item.id)}><BadgeCheck /><span className="sm:hidden">Confirmar Pix</span><span className="hidden sm:inline">Confirmar pagamento</span></Button>
          <Button variant="outline" onClick={() => onView(item)}>Ver</Button>
        </div>
      </li>;
    })}</ul>
  </section>;
}

function countdown(ms: number) {
  const h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
  return `${h ? `${h}h ` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
