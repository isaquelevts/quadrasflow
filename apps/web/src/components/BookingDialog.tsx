import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Info, LoaderCircle, Lock, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { DatePicker } from '@/components/DatePicker';
import { ResponsiveSheet } from '@/components/app/ResponsiveSheet';
import { Segmented } from '@/components/app/page';
import { notifyBookingsChanged } from '@/components/app/shell-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fetchDay, fmtDate, openWindow, operatingStart, todayKey, type Court, type DayData, type HoursDay } from '@/lib/arena';
import { rulesOf, ruleProblem, ruleProblemText } from '@/lib/court-rules';
import { clockOf, errorMessage, formatPhone, formatTime, isoAt, minutesOf, minutesOfTime } from '@/lib/format';

type EditableBooking = { id: string; customer_name: string; customer_phone?: string | null; start_at: string; end_at: string; court_id: string };
type Mode = 'booking' | 'block' | 'edit';
type Props = {
  open: boolean; onOpenChange: (open: boolean) => void; courts: Court[]; weeklyHours: HoursDay[];
  initialDate?: string; mode?: Mode; booking?: EditableBooking; initialCourtId?: string; initialStart?: string; initialName?: string; initialPhone?: string; onSaved: () => void;
};

const range = (from: number, to: number, step = 30) => { const out: number[] = []; for (let t = from; t <= to; t += step) out.push(t); return out; };

export function BookingDialog({ open, onOpenChange, courts, weeklyHours, initialDate = todayKey(), mode: initialMode = 'booking', booking, initialCourtId, initialStart, initialName, initialPhone, onSaved }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [date, setDate] = useState(initialDate);
  const [courtId, setCourtId] = useState('');
  const [start, setStart] = useState(19 * 60);
  const [end, setEnd] = useState(20 * 60);
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [day, setDay] = useState<DayData | null>(null);
  const isBlock = mode === 'block', isEdit = mode === 'edit';
  const minDuration = isBlock ? 30 : 60;

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    const at = booking ? operatingStart(weeklyHours, booking.start_at) : null;
    setDate(at?.date || initialDate);
    setCourtId(booking?.court_id || initialCourtId || courts[0]?.id || '');
    const s = at ? at.minutes : initialStart ? minutesOfTime(initialStart) : 19 * 60;
    setStart(s);
    setEnd(booking && at ? minutesOf(booking.end_at, at.date) : s + 60);
    setCustomerName(booking?.customer_name || initialName || ''); setPhone(booking?.customer_phone ? formatPhone(booking.customer_phone) : initialPhone ? formatPhone(initialPhone) : '');
    setReason(''); setError('');
  }, [open, initialDate, courts, booking, initialCourtId, initialStart, initialMode, initialName, initialPhone]);

  // Reservas e bloqueios do dia escolhido, para avisar do conflito antes de enviar.
  useEffect(() => {
    if (!open || !date) return;
    let alive = true;
    setDay(null);
    fetchDay(date).then((data) => { if (alive) setDay(data); }).catch(() => undefined);
    return () => { alive = false; };
  }, [open, date]);

  const opening = openWindow(weeklyHours, date);
  const startOptions = useMemo(() => opening ? range(opening.open, opening.close - minDuration) : [], [opening?.open, opening?.close, minDuration]);
  const endOptions = useMemo(() => opening ? range(start + minDuration, opening.close) : [], [opening?.close, start, minDuration]);

  // Início fora da janela vai para o primeiro horário; Fim só lista horários depois do início e se ajusta para +1h se ficar inválido.
  useEffect(() => { if (startOptions.length && !startOptions.includes(start)) setStart(startOptions[0]); }, [startOptions, start]);
  useEffect(() => { if (endOptions.length && !endOptions.includes(end)) setEnd(endOptions.includes(start + 60) ? start + 60 : endOptions[0]); }, [endOptions, end, start]);

  const clash = useMemo(() => {
    if (!day || !courtId) return null;
    const overlaps = (s: string, e: string) => start < minutesOf(e, date) && end > minutesOf(s, date);
    const blockHit = day.blocks.find((block) => block.court_id === courtId && overlaps(block.start_at, block.end_at));
    if (blockHit) return { hard: true, text: `Conflito com bloqueio "${blockHit.reason}" (${formatTime(blockHit.start_at)}–${formatTime(blockHit.end_at)}).` };
    const bookingHit = day.bookings.find((item) => item.court_id === courtId && item.status !== 'cancelled' && item.status !== 'monthly' && item.id !== booking?.id && overlaps(item.start_at, item.end_at));
    if (bookingHit) return { hard: true, text: `Conflito com reserva de ${bookingHit.customer_name} (${formatTime(bookingHit.start_at)}–${formatTime(bookingHit.end_at)}).` };
    const monthlyHit = day.bookings.find((item) => item.court_id === courtId && item.status === 'monthly' && overlaps(item.start_at, item.end_at));
    // Horário fixo de mensalista bloqueia como qualquer outra reserva (mesma regra da API e do bot).
    if (monthlyHit && !isBlock) return { hard: true, text: `Conflito com o horário fixo do mensalista ${monthlyHit.customer_name} (${formatTime(monthlyHit.start_at)}–${formatTime(monthlyHit.end_at)}).` };
    if (monthlyHit) return { hard: false, text: `Atenção: este bloqueio cobre o horário fixo do mensalista ${monthlyHit.customer_name} (${formatTime(monthlyHit.start_at)}–${formatTime(monthlyHit.end_at)}).` };
    // Regra da quadra (horas cheias, horário nobre): a equipe pode abrir exceção, só avisa.
    const court = courts.find((c) => c.id === courtId), problem = !isBlock && court ? ruleProblem(rulesOf(court.rules), new Date(`${date}T12:00:00Z`).getUTCDay(), start, end, opening?.open ?? 0, opening?.close) : null;
    if (problem && court) return { hard: false, text: `Fora da regra da quadra: ${ruleProblemText(problem, court.name)} Você pode salvar mesmo assim.` };
    return null;
  }, [day, courtId, start, end, booking?.id, isBlock, courts, date, opening?.open, opening?.close]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!courtId) { setError('Cadastre ou selecione uma quadra.'); return; }
    if (!opening) { setError('A arena está fechada neste dia. Escolha outra data.'); return; }
    if (clash?.hard) { setError(clash.text); return; }
    setSaving(true);
    const startAt = isoAt(date, start), endAt = isoAt(date, end);
    const customerPhone = phone.replace(/\D/g, '');
    try {
      if (isBlock) await api('/api/blocks', { method: 'POST', body: JSON.stringify({ courtId, reason: reason.trim(), startAt, endAt }) });
      else if (isEdit && booking) await api(`/api/bookings/${booking.id}`, { method: 'PATCH', body: JSON.stringify({ courtId, customerName: customerName.trim(), customerPhone, startAt, endAt }) });
      else await api('/api/bookings', { method: 'POST', body: JSON.stringify({ courtId, customerName: customerName.trim(), customerPhone, startAt, endAt }) });
      toast.success(isBlock ? 'Horário bloqueado' : isEdit ? 'Reserva atualizada' : 'Reserva criada');
      notifyBookingsChanged();
      onOpenChange(false); onSaved();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }

  const title = isBlock ? 'Bloquear horário' : isEdit ? 'Editar reserva' : 'Nova reserva';
  return <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={title} description={<span className="first-letter:uppercase">{fmtDate(date, "EEEE, d 'de' MMMM")}</span>}
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Cancelar</Button>
      <Button type="submit" form="booking-form" className="h-10" disabled={saving || !opening || Boolean(clash?.hard)}>{saving && <LoaderCircle className="animate-spin" />}{isBlock ? 'Bloquear' : isEdit ? 'Salvar alterações' : 'Salvar reserva'}</Button>
    </div>}>
    <form id="booking-form" className="space-y-4 px-5 py-4" onSubmit={submit}>
      {!isEdit && <Segmented label="Tipo" value={mode as 'booking' | 'block'} onChange={setMode} className="grid w-full grid-cols-2" options={[{ value: 'booking', label: 'Reserva' }, { value: 'block', label: <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" aria-hidden="true" />Bloqueio</span> }]} />}
      {isBlock ? <div className="grid gap-1.5"><Label htmlFor="block-reason">Motivo</Label><Textarea id="block-reason" rows={2} maxLength={160} placeholder="Ex.: manutenção" value={reason} onChange={(event) => setReason(event.target.value)} required /></div> : <>
        <div className="grid gap-1.5"><Label htmlFor="customer-name">Cliente</Label><Input id="customer-name" className="h-10" autoComplete="name" maxLength={100} placeholder="Nome do cliente" value={customerName} onChange={(event) => setCustomerName(event.target.value)} required /></div>
        <div className="grid gap-1.5"><Label htmlFor="customer-phone">WhatsApp</Label><Input id="customer-phone" className="h-10" type="tel" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" value={phone} onChange={(event) => setPhone(event.target.value)} onBlur={() => setPhone(formatPhone(phone))} /></div>
      </>}
      <div className="grid gap-1.5"><Label>Quadra</Label><Select value={courtId} onValueChange={setCourtId}><SelectTrigger className="h-10 w-full"><SelectValue placeholder="Selecione a quadra" /></SelectTrigger><SelectContent>{courts.map((court) => <SelectItem key={court.id} value={court.id}>{court.name} · {court.sport}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1.5"><Label>Data</Label><DatePicker className="h-10 w-full" value={date} onChange={setDate} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label>Início</Label><Select value={String(start)} onValueChange={(value) => setStart(Number(value))} disabled={!opening}><SelectTrigger className="h-10 w-full tabular-nums"><SelectValue /></SelectTrigger><SelectContent>{startOptions.map((t) => <SelectItem key={t} value={String(t)}>{clockOf(t)}{t >= 1440 ? ' (madrugada)' : ''}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1.5"><Label>Fim</Label><Select value={String(end)} onValueChange={(value) => setEnd(Number(value))} disabled={!opening}><SelectTrigger className="h-10 w-full tabular-nums"><SelectValue /></SelectTrigger><SelectContent>{endOptions.map((t) => <SelectItem key={t} value={String(t)}>{clockOf(t)}{t >= 1440 ? ' (madrugada)' : ''}</SelectItem>)}</SelectContent></Select></div>
      </div>
      {!isBlock && <p className="flex gap-2 text-[12.5px] text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />O valor é calculado pela tabela de preços da arena. Duração mínima de 1 hora, em blocos de 30 minutos.</p>}
      {!opening && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">A arena não funciona neste dia.</p>}
      {clash && <p role={clash.hard ? 'alert' : 'status'} className={clash.hard ? 'flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700' : 'flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800'}><TriangleAlert className="size-4 shrink-0" aria-hidden="true" />{clash.text}</p>}
      {error && error !== clash?.text && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </form>
  </ResponsiveSheet>;
}
