import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck2, CalendarPlus, ChevronRight, LoaderCircle, MessageCircle, MessageSquareHeart, Pencil, Repeat, Search, Star, UserPlus, UserSearch, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, EmptyState, PageHeader, Panel, StatCard } from '@/components/app/page';
import { ResponsiveSheet } from '@/components/app/ResponsiveSheet';
import { usePrimaryAction } from '@/components/app/shell-context';
import { BookingStatusBadge, ToneBadge, bookingStatus, toneDot, type BookingStatus } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fmtDate, todayKey, shiftKey } from '@/lib/arena';
import { errorMessage, formatCurrency, formatPhone, plural, whatsappLink } from '@/lib/format';
import { cn } from '@/lib/utils';

type Client = { id: string; name: string; phone: string | null; email?: string | null; notes?: string; created_at: string; bookings_count: number; last_booking_at: string | null };
type Member = { clientId: string; status: string; weekday: number; start_time: string; court_name: string };
type Review = { id: string; customer_name: string; rating: number; comment: string; created_at: string };
type Filter = 'all' | 'monthly' | 'with' | 'without';
type Sort = 'last' | 'count' | 'name';

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const phoneKey = (value: string | null | undefined) => (value || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
const isNew = (client: Client) => client.created_at.slice(0, 10) >= shiftKey(todayKey(), -7);
const dateBR = (iso: string | null) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [average, setAverage] = useState({ average: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('last');
  const [viewing, setViewing] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);

  usePrimaryAction(() => setCreating(true));

  async function load() {
    setLoading(true); setError('');
    try {
      const [clientData, memberData, reviewData] = await Promise.all([
        api<{ clients: Client[] }>('/api/clients'),
        api<{ members: Member[] }>('/api/monthly-members').catch(() => ({ members: [] as Member[] })),
        api<{ reviews: Review[]; average: { average: number; count: number } }>('/api/reviews').catch(() => ({ reviews: [] as Review[], average: { average: 0, count: 0 } })),
      ]);
      setClients(clientData.clients); setMembers(memberData.members); setReviews(reviewData.reviews); setAverage(reviewData.average);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const planOf = (clientId: string) => members.find((m) => m.clientId === clientId && m.status === 'active');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase(), digits = q.replace(/\D/g, '');
    const out = clients.filter((c) => (!q || c.name.toLowerCase().includes(q) || (digits.length > 0 && phoneKey(c.phone).includes(digits)))
      && (filter === 'all' || (filter === 'monthly' && planOf(c.id)) || (filter === 'with' && c.bookings_count > 0) || (filter === 'without' && c.bookings_count === 0)));
    return out.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'pt-BR') : sort === 'count' ? (a, b) => b.bookings_count - a.bookings_count || a.name.localeCompare(b.name, 'pt-BR') : (a, b) => (b.last_booking_at || '').localeCompare(a.last_booking_at || ''));
  }, [clients, members, query, filter, sort]);

  const tags = (c: Client) => <>{planOf(c.id) && <ToneBadge tone="lime">Mensalista</ToneBadge>}{isNew(c) && <ToneBadge tone="blue">Novo</ToneBadge>}</>;
  const newCount = clients.filter(isNew).length;
  const monthlyCount = new Set(members.filter((m) => m.status === 'active').map((m) => m.clientId)).size;
  const totalBookings = clients.reduce((sum, c) => sum + c.bookings_count, 0);

  return <div className="space-y-4 lg:space-y-5">
    <PageHeader title="Clientes" description="Cadastro, histórico e avaliações dos jogadores."
      actions={<Button className="hidden md:inline-flex" onClick={() => setCreating(true)}><UserPlus /> Novo cliente</Button>} />
    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <StatCard label="Clientes" icon={Users} value={clients.length} sub={plural(newCount, 'novo nos últimos 7 dias', 'novos nos últimos 7 dias')} />
      <StatCard label="Mensalistas" icon={Repeat} value={monthlyCount} sub="com horário fixo ativo" />
      <StatCard label="Reservas" icon={CalendarCheck2} value={totalBookings} sub={`${clients.filter((c) => c.bookings_count).length} clientes já reservaram`} />
      <StatCard label="Avaliação média" icon={Star} tone="bg-amber-50 text-amber-600" value={average.count ? average.average.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'} sub={plural(average.count, 'avaliação', 'avaliações')} />
    </section>

    <Panel>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 pt-4 pb-3 lg:px-5">
        <h2 className="flex w-full items-center gap-2 text-[15px] font-semibold sm:w-auto sm:flex-1"><Users className="size-4 text-muted-foreground" aria-hidden="true" />Jogadores <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{clients.length}</span></h2>
        <label className="flex h-9 w-full items-center gap-2 rounded-md border bg-card px-3 text-muted-foreground shadow-xs focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 sm:w-64">
          <Search className="size-4" aria-hidden="true" /><span className="sr-only">Buscar</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nome ou telefone" className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground" />
        </label>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}><SelectTrigger className="flex-1 sm:w-40 sm:flex-none" aria-label="Filtrar"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="monthly">Mensalistas</SelectItem><SelectItem value="with">Com reservas</SelectItem><SelectItem value="without">Sem reservas</SelectItem></SelectContent></Select>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}><SelectTrigger className="flex-1 sm:w-44 sm:flex-none" aria-label="Ordenar"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="last">Última reserva</SelectItem><SelectItem value="count">Mais reservas</SelectItem><SelectItem value="name">Nome (A–Z)</SelectItem></SelectContent></Select>
      </div>
      {loading && !clients.length ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div>
        : !list.length ? <EmptyState icon={UserSearch} title={clients.length ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'} text={clients.length ? 'Tente outro nome, telefone ou filtro.' : 'Os clientes são cadastrados aqui ou automaticamente a cada reserva.'} action={!clients.length ? <Button onClick={() => setCreating(true)}><UserPlus /> Novo cliente</Button> : undefined} />
        : <>
          <div className="hidden lg:block"><table className="w-full text-left">
            <thead><tr className="border-b bg-muted/50 text-[12px] text-muted-foreground"><th className="px-5 py-2.5 font-medium">Cliente</th><th className="px-3 py-2.5 font-medium">Reservas</th><th className="px-3 py-2.5 font-medium">Última reserva</th><th className="px-3 py-2.5 font-medium">Cliente desde</th><th className="px-5 py-2.5 text-right font-medium"><span className="sr-only">Ações</span></th></tr></thead>
            <tbody className="divide-y">{list.map((c) => { const wa = whatsappLink(c.phone), plan = planOf(c.id); return <tr key={c.id} className="transition hover:bg-muted/50">
              <td className="px-5 py-3"><button type="button" onClick={() => setViewing(c)} className="flex items-center gap-3 text-left"><Avatar name={c.name} className="size-9" />
                <span><span className="flex flex-wrap items-center gap-2"><span className="font-medium underline-offset-2 hover:underline">{c.name}</span>{tags(c)}</span>{c.phone && <span className="block text-[12px] text-muted-foreground tabular-nums">{formatPhone(c.phone)}</span>}</span></button></td>
              <td className="px-3 py-3 font-semibold tabular-nums">{c.bookings_count}</td>
              <td className="px-3 py-3 tabular-nums">{c.last_booking_at ? dateBR(c.last_booking_at) : <span className="text-muted-foreground">{plan ? `Mensalista · ${WEEKDAYS[plan.weekday]} ${plan.start_time}` : '—'}</span>}</td>
              <td className="px-3 py-3 text-muted-foreground tabular-nums">{dateBR(c.created_at)}</td>
              <td className="px-5 py-3"><div className="flex justify-end gap-1.5">
                {wa && <Button asChild variant="outline" size="icon" aria-label={`WhatsApp de ${c.name}`} title="WhatsApp"><a href={wa} target="_blank" rel="noreferrer"><MessageCircle /></a></Button>}
                <Button variant="outline" onClick={() => setViewing(c)}>Ver ficha</Button></div></td>
            </tr>; })}</tbody>
          </table></div>
          <ul className="divide-y lg:hidden">{list.map((c) => <li key={c.id}><button type="button" onClick={() => setViewing(c)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/60">
            <Avatar name={c.name} className="size-10" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.name}</span>{tags(c)}</span>
              {c.phone && <span className="block text-[12px] text-muted-foreground tabular-nums">{formatPhone(c.phone)}</span>}
              <span className="mt-0.5 block text-[12px] text-muted-foreground">{plural(c.bookings_count, 'reserva', 'reservas')}{c.last_booking_at ? ` · última em ${c.last_booking_at.slice(8, 10)}/${c.last_booking_at.slice(5, 7)}` : ''}</span>
            </span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></button></li>)}</ul>
        </>}
    </Panel>

    <ReviewsPanel reviews={reviews} average={average} loading={loading} />

    <ClientSheet client={viewing} plan={viewing ? planOf(viewing.id) : undefined} onClose={() => setViewing(null)} tags={viewing ? tags(viewing) : null}
      onChanged={(updated) => { setViewing(updated); setClients((list) => list.map((c) => c.id === updated.id ? { ...c, ...updated } : c)); }} />
    <NewClientSheet open={creating} onOpenChange={setCreating} clients={clients} onSaved={() => { setCreating(false); void load(); }} />
  </div>;
}

function ReviewsPanel({ reviews, average, loading }: { reviews: Review[]; average: { average: number; count: number }; loading: boolean }) {
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: reviews.filter((r) => r.rating === n).length }));
  const max = Math.max(1, ...dist.map((d) => d.count));
  return <Panel>
    <div className="border-b px-4 py-4 lg:px-5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Star className="size-4 text-amber-500" aria-hidden="true" />Avaliações dos jogadores</h2>
      <p className="text-[12.5px] text-muted-foreground">Enviadas pelo link de avaliação depois que a reserva é concluída.</p>
    </div>
    <div className="grid gap-6 p-4 md:grid-cols-[220px_1fr] lg:p-5">
      <div className="rounded-lg border bg-muted/60 p-4 text-center">
        <div className={cn('text-3xl font-semibold tabular-nums', !average.count && 'text-muted-foreground/60')}>{average.count ? average.average.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}</div>
        <Stars value={average.average} className="mt-1 justify-center" />
        <div className="mt-1 text-[12px] text-muted-foreground">{plural(average.count, 'avaliação', 'avaliações')}</div>
        <div className="mt-3 space-y-1" aria-label="Distribuição das notas">{dist.map((d) => <div key={d.n} className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-2">{d.n}</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${d.count / max * 100}%` }} /></span><span className="w-4 text-right tabular-nums">{d.count}</span>
        </div>)}</div>
      </div>
      {loading && !reviews.length ? <div className="grid place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div>
        : reviews.length ? <ul className="space-y-3">{reviews.slice(0, 8).map((r) => <li key={r.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium capitalize">{r.customer_name}</span><span className="flex items-center gap-2"><Stars value={r.rating} /><span className="text-[12px] text-muted-foreground">{dateBR(r.created_at)}</span></span></div>
          {r.comment && <p className="mt-1 text-[13px] text-muted-foreground">{r.comment}</p>}
        </li>)}</ul>
        : <div className="flex items-start gap-3 self-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600"><MessageSquareHeart className="size-5" aria-hidden="true" /></span>
          <div><div className="font-medium">Ainda sem avaliações</div><p className="mt-0.5 text-[13px] text-muted-foreground">Ao concluir uma reserva, o link de avaliação é gerado e pode ser enviado ao jogador. As notas aparecem aqui.</p></div>
        </div>}
    </div>
  </Panel>;
}

function Stars({ value, className }: { value: number; className?: string }) {
  return <span className={cn('flex gap-0.5', className)} role="img" aria-label={`${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} de 5 estrelas`}>
    {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn('size-3.5', n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-border')} aria-hidden="true" />)}
  </span>;
}

type HistoryItem = { id: string; start_at: string; end_at: string; status: string; amount_cents: number; court_name: string; cancel_reason: string };

function ClientSheet({ client, plan, onClose, onChanged, tags }: { client: Client | null; plan?: Member; onClose: () => void; onChanged: (client: Client) => void; tags: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState('');
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!client) return;
    setEditing(false); setName(client.name); setPhone(client.phone ? formatPhone(client.phone) : ''); setEmail(client.email || ''); setNotes(client.notes || ''); setError(''); setHistory(null);
    api<{ bookings: HistoryItem[] }>(`/api/clients/${client.id}/bookings`).then((data) => setHistory(data.bookings)).catch(() => setHistory([]));
  }, [client?.id]);

  async function save(patch: Record<string, string>, label: string) {
    if (!client) return;
    setSaving(true); setError('');
    try {
      const data = await api<{ client: Client }>(`/api/clients/${client.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      onChanged({ ...client, ...data.client }); setEditing(false); toast.success(label);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }

  const wa = whatsappLink(client?.phone);
  const reserveLink = client ? `/reservas?nova=1&nome=${encodeURIComponent(client.name)}${client.phone ? `&tel=${encodeURIComponent(client.phone)}` : ''}` : '/reservas';
  const notesChanged = client ? notes !== (client.notes || '') : false;
  return <ResponsiveSheet open={Boolean(client)} onOpenChange={(open) => { if (!open) onClose(); }} title={client?.name}
    description={client && <span className="flex flex-wrap items-center gap-1.5">{client.phone && <span className="tabular-nums">{formatPhone(client.phone)}</span>}{client.email && <span className="break-all">· {client.email}</span>}{tags}</span>}>
    {client && <div className="space-y-4 p-5">
      {editing ? <form className="space-y-3 rounded-lg border p-3" onSubmit={(event) => { event.preventDefault(); void save({ name: name.trim(), phone, email: email.trim() }, 'Cliente atualizado'); }}>
        <div className="grid gap-1.5"><Label htmlFor="edit-client-name">Nome</Label><Input id="edit-client-name" className="h-10" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="edit-client-phone">WhatsApp</Label><Input id="edit-client-phone" className="h-10" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhone(formatPhone(phone))} /></div>
        <div className="grid gap-1.5"><Label htmlFor="edit-client-email">E-mail <span className="font-normal text-muted-foreground">(usado só para gerar o Pix)</span></Label><Input id="edit-client-email" className="h-10" type="email" inputMode="email" autoComplete="off" maxLength={200} placeholder="cliente@email.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2"><Button type="button" variant="outline" onClick={() => { setEditing(false); setName(client.name); setPhone(client.phone ? formatPhone(client.phone) : ''); setEmail(client.email || ''); setError(''); }}>Cancelar</Button><Button type="submit" disabled={saving || name.trim().length < 2}>{saving && <LoaderCircle className="animate-spin" />}Salvar</Button></div>
      </form> : <div className="grid grid-cols-3 gap-2">
        {wa ? <Button asChild className="h-10"><a href={wa} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a></Button> : <Button className="h-10" disabled><MessageCircle /> Sem tel.</Button>}
        <Button asChild variant="outline" className="h-10"><Link to={reserveLink}><CalendarPlus /> Reservar</Link></Button>
        <Button variant="outline" className="h-10" onClick={() => setEditing(true)}><Pencil /> Editar</Button>
      </div>}
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
      <div className="grid grid-cols-3 divide-x rounded-lg border text-center">
        <div className="py-3"><div className="text-lg font-semibold tabular-nums">{client.bookings_count}</div><div className="text-[11.5px] text-muted-foreground">reservas</div></div>
        <div className="py-3"><div className="text-lg font-semibold tabular-nums">{history ? history.filter((h) => h.status === 'cancelled').length : '—'}</div><div className="text-[11.5px] text-muted-foreground">canceladas</div></div>
        <div className="py-3"><div className="text-lg font-semibold tabular-nums">{client.created_at.slice(8, 10)}/{client.created_at.slice(5, 7)}/{client.created_at.slice(2, 4)}</div><div className="text-[11.5px] text-muted-foreground">cliente desde</div></div>
      </div>
      {plan && <div className="flex items-center gap-2 rounded-lg border border-lime-300/60 bg-lime-300/15 px-3 py-2.5 text-[13px]"><Repeat className="size-4 text-lime-700" aria-hidden="true" />
        <span><b>Mensalista</b> · {WEEKDAYS[plan.weekday]} às {plan.start_time} · {plan.court_name}</span><Link to="/mensalistas" className="ml-auto font-medium whitespace-nowrap text-brand-700">Ver plano</Link></div>}
      <div className="grid gap-1.5">
        <Label htmlFor="client-notes" className="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Observações</Label>
        <Textarea id="client-notes" rows={3} maxLength={1000} placeholder="Ex.: prefere a quadra 2, traz o próprio time" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {notesChanged && <Button variant="outline" size="sm" className="justify-self-end" disabled={saving} onClick={() => void save({ notes }, 'Observações salvas')}>{saving && <LoaderCircle className="animate-spin" />}Salvar observações</Button>}
      </div>
      <div>
        <div className="mb-2 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Histórico</div>
        {history === null ? <div className="grid min-h-20 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando histórico" /></div>
          : history.length ? <ol className="relative">{history.map((h, i) => <li key={h.id} className={cn('relative ml-1.5 pb-4 pl-6', i < history.length - 1 && 'border-l')}>
            <span aria-hidden="true" className={cn('absolute top-1 -left-[5px] size-2.5 rounded-full ring-4 ring-white', toneDot[bookingStatus[h.status as BookingStatus]?.tone || 'gray'])} />
            <div className="-mt-0.5 flex items-start justify-between gap-2">
              <div><div className="font-medium tabular-nums capitalize">{fmtDate(h.start_at.slice(0, 10), 'EEE, dd/MM/yy')} · {h.start_at.slice(11, 16)}–{h.end_at.slice(11, 16)}</div>
                <div className="text-[12px] text-muted-foreground">{h.court_name}{h.cancel_reason ? ` · motivo: ${h.cancel_reason}` : ''}</div></div>
              <div className="text-right"><div className={cn('font-semibold tabular-nums', h.status === 'cancelled' && 'font-normal text-muted-foreground line-through')}>{formatCurrency(h.amount_cents)}</div><div className="mt-0.5"><BookingStatusBadge status={h.status} /></div></div>
            </div></li>)}</ol>
          : <div className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">Nenhuma reserva avulsa ainda.</div>}
      </div>
    </div>}
  </ResponsiveSheet>;
}

function NewClientSheet({ open, onOpenChange, clients, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; clients: Client[]; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setName(''); setPhone(''); setError(''); } }, [open]);
  const dup = phoneKey(phone).length >= 10 ? clients.find((c) => phoneKey(c.phone) === phoneKey(phone)) : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (dup) { setError(`Esse telefone já pertence a ${dup.name}.`); return; }
    setSaving(true);
    try {
      await api('/api/clients', { method: 'POST', body: JSON.stringify({ name: name.trim(), phone }) });
      toast.success('Cliente cadastrado'); onSaved();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }
  return <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Novo cliente" description="Clientes também são cadastrados automaticamente a cada reserva."
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Cancelar</Button>
      <Button type="submit" form="client-form" className="h-10" disabled={saving || name.trim().length < 2 || Boolean(dup)}>{saving && <LoaderCircle className="animate-spin" />}Cadastrar cliente</Button>
    </div>}>
    <form id="client-form" className="space-y-4 px-5 py-4" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-1.5"><Label htmlFor="client-name">Nome</Label><Input id="client-name" className="h-10" required maxLength={100} placeholder="Nome do jogador" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="client-phone">WhatsApp <span className="font-normal text-muted-foreground">(opcional)</span></Label><Input id="client-phone" className="h-10" type="tel" inputMode="tel" placeholder="(00) 00000-0000" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhone(formatPhone(phone))} /></div>
      {dup && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">Esse telefone já pertence a {dup.name}.</p>}
      {error && error !== `Esse telefone já pertence a ${dup?.name}.` && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </form>
  </ResponsiveSheet>;
}
