import { useEffect, useState } from 'react';
import { LoaderCircle, Plus } from 'lucide-react';
import { BookingDialog } from '@/components/BookingDialog';
import { DatePicker, localDateValue } from '@/components/DatePicker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { errorMessage, formatCurrency, formatTime } from '@/lib/format';

type Booking = { id: string; customer_name: string; customer_phone?: string; start_at: string; end_at: string; amount_cents: number; status: string; court_name: string; court_id: string; sport: string };
type AwaitingPayment = { id: string; customerName: string; customerPhone?: string; courtName: string; startAt: string; endAt: string; amountCents: number; paymentExpiresAt: string | null };
type Court = { id: string; name: string; sport: string; price_cents: number };
type HoursDay = { weekday: number; is_open: boolean | number; open_time: string; close_time: string };
const labels: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmada', cancelled: 'Cancelada', completed: 'Concluída', monthly: 'Mensalista' };

export function ReservationsPage() {
  const [date, setDate] = useState(localDateValue());
  const [status, setStatus] = useState('all');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [awaitingPayment, setAwaitingPayment] = useState<AwaitingPayment[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [hours, setHours] = useState<HoursDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [followupLink, setFollowupLink] = useState<{ label: string; url: string }>();
  const [slug, setSlug] = useState('');
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Booking | undefined>();

  async function load() {
    setLoading(true); setError('');
    try {
      const [day, courtData, settings, pending] = await Promise.all([api<{ bookings: Booking[] }>(`/api/bookings?date=${date}`), api<{ courts: Court[] }>('/api/courts'), api<{ weeklyHours: HoursDay[]; company: { slug: string } }>('/api/arena/settings'), api<{ bookings: AwaitingPayment[] }>('/api/bookings/awaiting-payment')]);
      setBookings(day.bookings); setCourts(courtData.courts); setHours(settings.weeklyHours); setSlug(settings.company.slug); setAwaitingPayment(pending.bookings);
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [date]);
  const visible = bookings.filter((booking) => status === 'all' || booking.status === status);
  async function update(id: string, next: 'confirmed' | 'cancelled' | 'completed') {
    const reason = next === 'cancelled' ? window.prompt('Motivo do cancelamento (opcional):') || '' : undefined;
    try {
      const result = await api<{ reviewToken?: string | null }>(`/api/bookings/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next, reason }) });
      setFollowupLink(undefined);
      if (next === 'completed' && result.reviewToken) {
        const url = `${window.location.origin}/a/${encodeURIComponent(slug)}?avaliar=${encodeURIComponent(result.reviewToken)}`;
        setFollowupLink({ label: 'Abrir ou copiar link de avaliação', url });
        try { await navigator.clipboard.writeText(url); setNotice('Reserva concluída. Link de avaliação copiado.'); }
        catch { setNotice('Reserva concluída. O link de avaliação está disponível abaixo.'); }
      }
      await load();
    }
    catch (cause) { setError(errorMessage(cause)); }
  }
  async function createPixLink(id: string) {
    setError(''); setNotice('');
    try {
      const result = await api<{ url: string }>(`/api/bookings/${id}/pix-link`, { method: 'POST', body: '{}' });
      setFollowupLink({ label: 'Abrir link Pix', url: result.url });
      try { await navigator.clipboard.writeText(result.url); setNotice('Link Pix copiado. Envie ao cliente para concluir o pagamento.'); }
      catch { setNotice('O link Pix está disponível abaixo para abrir ou copiar.'); }
    } catch (cause) { setError(errorMessage(cause)); }
  }

  return <div className="grid gap-5"><header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold tracking-tight">Reservas</h1><p className="mt-1 text-sm text-muted-foreground">Consulte e atualize as reservas da arena.</p></div><div className="grid w-full gap-2 min-[420px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap"><DatePicker className="w-full sm:w-auto" value={date} onChange={setDate} /><Button className="w-full sm:w-auto" onClick={() => setDialog(true)} disabled={!courts.length}><Plus /> Nova reserva</Button></div></header>
    {awaitingPayment.length > 0 && <Card><CardHeader><CardTitle className="text-base">Aguardando pagamento · {awaitingPayment.length}</CardTitle><p className="text-sm text-muted-foreground">Pedidos com Pix pendente, de qualquer data. A reserva só é confirmada quando o pagamento é aprovado.</p></CardHeader><CardContent className="grid gap-2">{awaitingPayment.map((item) => <article key={item.id} className="flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"><div className="min-w-0"><p className="font-semibold">{item.customerName} · {item.courtName}</p><p className="text-sm text-muted-foreground">{item.startAt.slice(0, 10).split('-').reverse().join('/')} · {formatTime(item.startAt)}–{formatTime(item.endAt)} · {formatCurrency(item.amountCents)}</p><p className="text-xs text-muted-foreground">{item.paymentExpiresAt ? (Date.parse(item.paymentExpiresAt) > Date.now() ? `Pix disponível até ${new Date(item.paymentExpiresAt).toLocaleString('pt-BR')}` : 'Pix vencido — confira o pagamento antes de liberar o horário') : 'Aguardando confirmação do Pix'}</p></div><Button size="sm" variant="outline" onClick={() => setDate(item.startAt.slice(0, 10))}>Ver reserva</Button></article>)}</CardContent></Card>}
    <Card><CardHeader className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><CardTitle className="text-base">Reservas do dia <span className="font-normal text-muted-foreground">· {visible.length}</span></CardTitle><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os status</SelectItem><SelectItem value="pending">Pendentes</SelectItem><SelectItem value="confirmed">Confirmadas</SelectItem><SelectItem value="completed">Concluídas</SelectItem><SelectItem value="cancelled">Canceladas</SelectItem><SelectItem value="monthly">Mensalistas</SelectItem></SelectContent></Select></CardHeader><CardContent>{error && <p role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mb-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}{followupLink && <p className="mb-3 break-all text-sm"><a className="font-medium text-primary underline" href={followupLink.url} target="_blank" rel="noreferrer">{followupLink.label}</a></p>}{loading ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-primary" /></div> : visible.length ? <div className="grid gap-2">{visible.map((b) => <article key={b.id} className="flex flex-col justify-between gap-3 rounded-lg border p-4 md:flex-row md:items-center"><div className="flex min-w-0 items-center gap-3"><span className="rounded-md bg-muted px-2.5 py-2 text-sm font-bold">{formatTime(b.start_at)}–{formatTime(b.end_at)}</span><div className="min-w-0"><p className="truncate font-semibold">{b.customer_name}</p><p className="truncate text-xs text-muted-foreground">{b.court_name} · {b.sport}{b.customer_phone ? ` · ${b.customer_phone}` : ''}</p></div></div><div className="flex flex-wrap items-center gap-2"><Badge variant={b.status === 'pending' ? 'secondary' : 'outline'}>{labels[b.status] || b.status}</Badge><strong className="mr-1 text-sm">{formatCurrency(b.amount_cents)}</strong>{['pending', 'confirmed'].includes(b.status) && <Button size="sm" variant="outline" onClick={() => setEditing(b)}>Editar</Button>}{b.status === 'pending' && <><Button size="sm" onClick={() => void update(b.id, 'confirmed')}>Confirmar</Button><Button size="sm" variant="outline" onClick={() => void createPixLink(b.id)}>Gerar Pix</Button></>}{b.status === 'confirmed' && <Button size="sm" variant="outline" onClick={() => void update(b.id, 'completed')}>Concluir</Button>}{['pending', 'confirmed'].includes(b.status) && <Button size="sm" variant="ghost" className="text-red-700" onClick={() => void update(b.id, 'cancelled')}>Cancelar</Button>}</div></article>)}</div> : <p className="py-12 text-center text-sm text-muted-foreground">Nenhuma reserva para os filtros selecionados.</p>}</CardContent></Card>
    <BookingDialog open={dialog} onOpenChange={setDialog} courts={courts} weeklyHours={hours} initialDate={date} onSaved={() => void load()} />
    <BookingDialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(undefined); }} courts={courts} weeklyHours={hours} initialDate={date} mode="edit" booking={editing} onSaved={() => { setEditing(undefined); void load(); }} /></div>;
}
