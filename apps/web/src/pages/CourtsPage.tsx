import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banknote, CalendarCheck2, CalendarDays, Clock, Gauge, LandPlot, LoaderCircle, MapPin, Pencil, Plus, Timer, Trash2 } from 'lucide-react';
import { addDays, startOfWeek } from 'date-fns';
import { toast } from 'sonner';
import { ArenaImagePicker } from '@/components/ArenaImagePicker';
import { EmptyState, PageHeader, StatCard } from '@/components/app/page';
import { ResponsiveSheet } from '@/components/app/ResponsiveSheet';
import { usePrimaryAction } from '@/components/app/shell-context';
import { ToneBadge } from '@/components/app/status';
import { useAuth } from '@/auth/AuthProvider';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import {
  activeBookings, bookingMinutes, courtPlace, dateFromKey, fetchArenaBasics, fetchDay, isActiveCourt, keyOf, openWindow, todayKey,
  type Court, type DayData, type HoursDay,
} from '@/lib/arena';
import { clockOf, errorMessage, formatCurrency, minutesOf, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

const SPORTS = ['Society', 'Futsal', 'Futebol de Campo', 'Beach Tennis', 'Padel', 'Tênis', 'Vôlei', 'Basquete', 'Vôlei de Praia', 'Futevôlei', 'Pickleball', 'Handebol', 'Peteca', 'Squash', 'Outro'];
type Surface = 'sand' | 'grass' | 'hard';
const surfaceOf = (sport: string): Surface => ['Vôlei', 'Vôlei de Praia', 'Futevôlei', 'Beach Tennis', 'Peteca'].includes(sport) ? 'sand' : ['Society', 'Futebol de Campo'].includes(sport) ? 'grass' : 'hard';

export function CourtsPage() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [hours, setHours] = useState<HoursDay[]>([]);
  const [today, setToday] = useState<DayData | null>(null);
  const [weekCount, setWeekCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Court | 'new' | null>(null);
  const isAdmin = useAuth().user?.role === 'arena_admin';
  const navigate = useNavigate();

  // Só o administrador cadastra quadra; para a Recepção o "+" segue para uma nova reserva.
  usePrimaryAction(() => isAdmin ? setEditing('new') : navigate('/reservas?nova=1'));

  async function load() {
    setLoading(true); setError('');
    try {
      const key = todayKey();
      const monday = startOfWeek(dateFromKey(key), { weekStartsOn: 1 });
      const [basics, days] = await Promise.all([fetchArenaBasics(), Promise.all(Array.from({ length: 7 }, (_, i) => fetchDay(keyOf(addDays(monday, i)))))]);
      setCourts(basics.courts); setHours(basics.hours);
      setToday(days.find((d) => d.date === key) || null);
      setWeekCount(days.reduce((sum, d) => sum + activeBookings(d.bookings).filter((b) => b.status !== 'monthly').length, 0));
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function toggle(court: Court, active: boolean) {
    // Otimista: a chave muda na hora e volta se a API recusar.
    setCourts((list) => list.map((c) => c.id === court.id ? { ...c, active: active ? 1 : 0 } : c));
    try {
      await api(`/api/courts/${court.id}/status`, { method: 'PATCH', body: JSON.stringify({ active }) });
      toast.success(active ? `${court.name} voltou a aceitar reservas` : `${court.name} pausada — some do bot e não aceita novas reservas`);
    } catch (cause) {
      setCourts((list) => list.map((c) => c.id === court.id ? { ...c, active: court.active } : c));
      toast.error(errorMessage(cause));
    }
  }

  const opening = openWindow(hours, todayKey());
  const active = courts.filter(isActiveCourt);
  const avgPrice = active.length ? active.reduce((sum, c) => sum + c.price_cents, 0) / active.length : 0;
  const occOf = (courtId: string) => {
    if (!opening || !today) return 0;
    const minutes = activeBookings(today.bookings).filter((b) => b.court_id === courtId).reduce((sum, b) => sum + bookingMinutes(b), 0);
    return Math.min(100, Math.round(minutes / (opening.close - opening.open) * 100));
  };
  const avgOcc = active.length ? Math.round(active.reduce((sum, c) => sum + occOf(c.id), 0) / active.length) : 0;

  return <div className="space-y-4 lg:space-y-5">
    <PageHeader title="Quadras" description="Modalidades, preços e ocupação de hoje."
      actions={isAdmin ? <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to="/configuracoes?secao=regras"><Timer /> Regras de horário</Link></Button><Button className="hidden md:inline-flex" onClick={() => setEditing('new')}><Plus /> Adicionar quadra</Button></div> : undefined} />
    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    {loading && !courts.length ? <div className="grid min-h-60 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div> : <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Quadras ativas" icon={LandPlot} value={<>{active.length}<span className="text-base font-normal text-muted-foreground"> / {courts.length}</span></>} sub="disponíveis para reserva" />
        <StatCard label="Preço médio" icon={Banknote} value={formatCurrency(avgPrice)} sub="por hora, nas quadras ativas" />
        <StatCard label="Ocupação hoje" icon={Gauge} value={opening ? `${avgOcc}%` : '—'} sub={opening ? 'média entre as quadras' : 'arena fechada hoje'} />
        <StatCard label="Reservas na semana" icon={CalendarCheck2} value={weekCount} sub="de segunda a domingo, sem canceladas" />
      </section>

      {courts.length ? <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {courts.map((court) => <CourtCard key={court.id} court={court} today={today} opening={opening} occ={occOf(court.id)} isAdmin={isAdmin} onEdit={() => setEditing(court)} onToggle={(active) => void toggle(court, active)} />)}
        {isAdmin && <button type="button" onClick={() => setEditing('new')} className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed text-muted-foreground transition hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-500">
          <span className="grid size-12 place-items-center rounded-full border bg-white shadow-xs"><Plus className="size-5" aria-hidden="true" /></span>
          <span className="font-medium">Adicionar quadra</span>
          <span className="max-w-[220px] text-center text-[12.5px]">Cadastre modalidade, preço e foto.</span>
        </button>}
      </section> : <div className="rounded-xl border bg-card shadow-card"><EmptyState icon={LandPlot} title="Nenhuma quadra cadastrada" text={isAdmin ? 'Adicione uma quadra para começar a receber reservas.' : 'O administrador da arena cadastra as quadras.'} action={isAdmin ? <Button onClick={() => setEditing('new')}><Plus /> Adicionar quadra</Button> : undefined} /></div>}
    </>}

    <CourtSheet court={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
  </div>;
}

function CourtCard({ court, today, opening, occ, isAdmin, onEdit, onToggle }: { court: Court; today: DayData | null; opening: ReturnType<typeof openWindow>; occ: number; isAdmin: boolean; onEdit: () => void; onToggle: (active: boolean) => void }) {
  const active = isActiveCourt(court);
  const bookings = today ? activeBookings(today.bookings).filter((b) => b.court_id === court.id) : [];
  const blocks = today ? today.blocks.filter((b) => b.court_id === court.id) : [];
  const slots = opening ? Array.from({ length: Math.ceil((opening.close - opening.open) / 30) }, (_, i) => opening.open + i * 30) : [];
  const stateAt = (t: number) => {
    const inRange = (s: string, e: string) => t >= minutesOf(s, today?.date) && t < minutesOf(e, today?.date);
    if (blocks.some((b) => inRange(b.start_at, b.end_at))) return 'block';
    const hit = bookings.find((b) => inRange(b.start_at, b.end_at));
    return hit ? (hit.status === 'monthly' ? 'monthly' : 'booked') : 'free';
  };
  return <article className={cn('flex flex-col overflow-hidden rounded-xl border bg-card shadow-card transition', !active && 'opacity-70')}>
    <div className={cn('relative h-40', !active && 'grayscale')}>
      {court.photo_url ? <img src={court.photo_url} alt={`Foto da quadra ${court.name}`} className="absolute inset-0 size-full object-cover" /> : <CourtArt sport={court.sport} />}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-white/90 px-2 py-1 text-[11.5px] font-medium shadow-xs backdrop-blur">{court.sport}</span>
        <ToneBadge tone={active ? 'green' : 'gray'} className="bg-white/90">{active ? 'Aberta' : 'Pausada'}</ToneBadge>
      </div>
    </div>
    <div className="flex flex-1 flex-col p-4 lg:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><h3 className="truncate text-base font-semibold">{court.name}</h3>
          <p className="flex items-center gap-1 text-[12.5px] text-muted-foreground"><Clock className="size-3" aria-hidden="true" />{opening ? `Hoje, ${opening.openTime} às ${opening.closeTime}` : 'Arena fechada hoje'}</p>
          {courtPlace(court) && <p className="mt-0.5 flex items-start gap-1 text-[12.5px] text-muted-foreground"><MapPin className="mt-0.5 size-3 shrink-0" aria-hidden="true" /><span className="line-clamp-2">{courtPlace(court)}</span></p>}</div>
        <div className="text-right"><div className="text-[11px] text-muted-foreground">por hora</div><div className="text-lg leading-tight font-semibold tabular-nums">{formatCurrency(court.price_cents)}</div></div>
      </div>
      {opening && <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[12px]">
          <span className="text-muted-foreground">Hoje · {plural(bookings.length, 'reserva', 'reservas')}</span>
          <span className="font-medium tabular-nums">{occ}% ocupada</span>
        </div>
        <div className="flex gap-0.5" role="img" aria-label={`Ocupação de hoje: ${occ}%`}>
          {slots.map((t) => { const s = stateAt(t); return <span key={t} className={cn('h-2 flex-1 rounded-sm', s === 'booked' ? 'bg-brand-500' : s === 'monthly' ? 'bg-lime-400' : s === 'block' ? 'bg-gray-300' : 'bg-muted')} />; })}
        </div>
        <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground tabular-nums"><span>{opening.openTime}</span><span>{clockOf(Math.floor((opening.open + opening.close) / 60 / 2) * 60)}</span><span>{opening.closeTime}</span></div>
      </div>}
      <div className="-mx-4 mt-auto flex items-center justify-end gap-2 border-t px-4 pt-4 lg:-mx-5 lg:px-5" style={{ marginTop: opening ? undefined : '1rem' }}>
        {isAdmin && <label className="mr-auto flex min-w-0 cursor-pointer items-center gap-2 text-[13px]">
          <Switch checked={active} onCheckedChange={onToggle} aria-label={active ? `Pausar ${court.name}` : `Reabrir ${court.name}`} />
          <span className="truncate">{active ? 'Aberta' : 'Pausada'}</span>
        </label>}
        {!isAdmin && !active && <span className="mr-auto text-[12.5px] text-muted-foreground">Pausada pelo administrador</span>}
        <Button asChild variant="outline" size="icon" aria-label={`Ver ${court.name} na agenda`} title="Ver na agenda"><Link to="/agenda"><CalendarDays /></Link></Button>
        {isAdmin && <Button variant="outline" onClick={onEdit}><Pencil /> Editar</Button>}
      </div>
    </div>
  </article>;
}

/** Ilustração no lugar da foto, quando a quadra não tem uma. */
function CourtArt({ sport }: { sport: string }) {
  const s = surfaceOf(sport);
  const [from, to] = { sand: ['#e9d3a8', '#d7b77e'], grass: ['#3f9a5c', '#2b7a45'], hard: ['#3f7fae', '#2d6690'] }[s];
  const line = s === 'sand' ? '#1d4f8a' : '#ffffff';
  const id = `art-${s}`;
  return <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient></defs>
    <rect width="400" height="200" fill={`url(#${id})`} />
    {s === 'grass' && Array.from({ length: 8 }, (_, i) => <rect key={i} x={i * 50} width="25" height="200" fill="#fff" opacity=".05" />)}
    <rect x="40" y="40" width="320" height="130" fill="none" stroke={line} strokeWidth="3" opacity=".8" />
    <line x1="200" y1="40" x2="200" y2="170" stroke={line} strokeWidth="3" opacity=".8" />
    {s !== 'sand' && <circle cx="200" cy="105" r="24" fill="none" stroke={line} strokeWidth="3" opacity=".8" />}
    <rect width="400" height="200" fill="#000" opacity=".08" />
  </svg>;
}

function CourtSheet({ court, onClose, onSaved }: { court: Court | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const editing = court && court !== 'new' ? court : null;
  const [name, setName] = useState('');
  const [sport, setSport] = useState('Society');
  const [price, setPrice] = useState('150,00');
  const [photo, setPhoto] = useState<string[]>([]);
  const [ownPlace, setOwnPlace] = useState(false);
  const [place, setPlace] = useState({ name: '', address: '', maps_url: '' });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sports = useMemo(() => editing && !SPORTS.includes(editing.sport) ? [editing.sport, ...SPORTS] : SPORTS, [editing]);

  useEffect(() => {
    if (!court) return;
    setName(editing?.name || ''); setSport(editing?.sport || 'Society');
    setPrice(editing ? (editing.price_cents / 100).toFixed(2).replace('.', ',') : '150,00');
    setPhoto(editing?.photo_url ? [editing.photo_url] : []); setError('');
    setPlace({ name: editing?.location?.name || '', address: editing?.location?.address || '', maps_url: editing?.location?.maps_url || '' }); setOwnPlace(Boolean(editing?.location?.address));
  }, [court]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    const cents = Math.round(Number(price.replace(/\./g, '').replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setError('Confira o preço por hora.'); return; }
    if (ownPlace && place.address.trim().length < 5) { setError('Informe o endereço da quadra ou desmarque "Fica em outro endereço".'); return; }
    setSaving(true);
    const location = ownPlace ? { name: place.name.trim(), address: place.address.trim(), mapsUrl: place.maps_url.trim() } : { name: '', address: '', mapsUrl: '' };
    const body = JSON.stringify({ name: name.trim(), sport, priceCents: cents, photoUrl: photo[0] || null, location });
    try {
      if (editing) await api(`/api/courts/${editing.id}`, { method: 'PUT', body });
      else await api('/api/courts', { method: 'POST', body });
      toast.success(editing ? 'Quadra atualizada' : 'Quadra adicionada');
      onSaved();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }

  return <ResponsiveSheet open={Boolean(court)} onOpenChange={(open) => { if (!open) onClose(); }}
    title={editing ? 'Editar quadra' : 'Nova quadra'} description={editing ? editing.name : 'Ela aparece na agenda e no bot assim que for salva.'}
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={onClose}>Cancelar</Button>
      <Button type="submit" form="court-form" className="h-10" disabled={saving || uploading}>{saving && <LoaderCircle className="animate-spin" />}{editing ? 'Salvar alterações' : 'Adicionar quadra'}</Button>
    </div>}>
    <form id="court-form" className="space-y-4 px-5 py-4" onSubmit={(event) => void submit(event)}>
      <ArenaImagePicker label="Foto da quadra" images={photo} maxImages={1} onChange={setPhoto} onBusyChange={setUploading} />
      <div className="grid gap-1.5"><Label htmlFor="court-name">Nome</Label><Input id="court-name" className="h-10" required maxLength={80} placeholder="Ex.: Areia 2" value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label>Modalidade</Label><Select value={sport} onValueChange={setSport}><SelectTrigger className="h-10 w-full"><SelectValue /></SelectTrigger><SelectContent>{sports.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1.5"><Label htmlFor="court-price">Preço por hora</Label>
        <div className="relative"><span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">R$</span><Input id="court-price" className="h-10 pl-9 tabular-nums" inputMode="decimal" required value={price} onChange={(event) => setPrice(event.target.value)} /></div>
        <span className="text-[12px] text-muted-foreground">Usado quando a tabela de preços da arena não cobre o horário.</span></div>
      <div className="grid gap-3 rounded-lg border p-3">
        <label className="flex cursor-pointer items-start justify-between gap-3">
          <span><span className="block text-sm font-medium">Fica em outro endereço</span><span className="block text-[12px] text-muted-foreground">Desligado: a quadra fica no endereço da arena.</span></span>
          <Switch checked={ownPlace} onCheckedChange={setOwnPlace} aria-label="Quadra em outro endereço" />
        </label>
        {ownPlace && <>
          <div className="grid gap-1.5"><Label htmlFor="court-place-name">Nome do local <span className="font-normal text-muted-foreground">(opcional)</span></Label><Input id="court-place-name" className="h-10" maxLength={80} placeholder="Ex.: Unidade Centro" value={place.name} onChange={(event) => setPlace((p) => ({ ...p, name: event.target.value }))} /></div>
          <div className="grid gap-1.5"><Label htmlFor="court-place-address">Endereço</Label><Input id="court-place-address" className="h-10" maxLength={200} placeholder="Rua, número, bairro, cidade" value={place.address} onChange={(event) => setPlace((p) => ({ ...p, address: event.target.value }))} /></div>
          <div className="grid gap-1.5"><Label htmlFor="court-place-maps">Link do Google Maps <span className="font-normal text-muted-foreground">(opcional)</span></Label><Input id="court-place-maps" className="h-10" type="url" inputMode="url" maxLength={1000} placeholder="https://maps.app.goo.gl/…" value={place.maps_url} onChange={(event) => setPlace((p) => ({ ...p, maps_url: event.target.value }))} /></div>
          <span className="text-[12px] text-muted-foreground">Aparece na página de reservas e o bot do WhatsApp informa esse endereço para quem reservar esta quadra.</span>
        </>}
      </div>
      <p className="rounded-md bg-muted/70 px-3 py-2.5 text-[12.5px] text-muted-foreground">O horário de funcionamento vale para todas as quadras e é ajustado em Configurações.</p>
      {editing && <div className="border-t pt-4">
        <Button type="button" variant="outline" className="h-10 w-full border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800" onClick={() => setConfirmDelete(true)}><Trash2 /> Excluir quadra</Button>
        <p className="mt-1.5 text-[12px] text-muted-foreground">Só é possível excluir uma quadra sem reservas nem mensalistas. Para parar de receber reservas, use a chave Aberta/Pausada no card.</p>
      </div>}
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </form>
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <AlertDialogContent>
        <AlertDialogHeader className="flex flex-row items-start gap-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600"><Trash2 className="size-5" aria-hidden="true" /></span>
          <div className="space-y-1"><AlertDialogTitle>Excluir {editing?.name}?</AlertDialogTitle><AlertDialogDescription>A quadra sai da agenda e do bot. Esta ação não pode ser desfeita.</AlertDialogDescription></div>
        </AlertDialogHeader>
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:flex">
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction className="bg-rose-600 text-white hover:bg-rose-700" onClick={async (event) => {
            event.preventDefault(); setConfirmDelete(false);
            try { await api(`/api/courts/${editing!.id}`, { method: 'DELETE' }); toast.success('Quadra excluída'); onSaved(); }
            catch (cause) { setError(errorMessage(cause)); }
          }}>Excluir quadra</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </ResponsiveSheet>;
}
