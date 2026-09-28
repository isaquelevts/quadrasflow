import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/DatePicker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { localDateValue } from '@/components/DatePicker';

type Court = { id: string; name: string; sport: string; price_cents: number };
type HoursDay = { weekday: number; is_open: number | boolean; open_time: string; close_time: string };
type EditableBooking = { id: string; customer_name: string; customer_phone?: string; start_at: string; end_at: string; court_id: string };
type Props = { open: boolean; onOpenChange: (open: boolean) => void; courts: Court[]; weeklyHours: HoursDay[]; initialDate?: string; mode?: 'booking' | 'block' | 'edit'; booking?: EditableBooking; onSaved: () => void };
const timeOptions = Array.from({ length: 36 }, (_, i) => { const n = 360 + i * 30; return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; });
const weekdayFor = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const addMinutes = (value: string, delta: number) => { const [hour, minute] = value.split(':').map(Number); const n = hour * 60 + minute + delta; return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };

export function BookingDialog({ open, onOpenChange, courts, weeklyHours, initialDate = localDateValue(), mode = 'booking', booking, onSaved }: Props) {
  const [date, setDate] = useState(initialDate);
  const [courtId, setCourtId] = useState('');
  const [startTime, setStartTime] = useState('19:00');
  const [endTime, setEndTime] = useState('20:00');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isBlock = mode === 'block', isEdit = mode === 'edit';

  useEffect(() => { if (open) { setDate(booking?.start_at.slice(0, 10) || initialDate); setCourtId(booking?.court_id || courts[0]?.id || ''); setStartTime(booking?.start_at.slice(11, 16) || '19:00'); setEndTime(booking?.end_at.slice(11, 16) || '20:00'); setCustomerName(booking?.customer_name || ''); setPhone(booking?.customer_phone || ''); setReason(''); setError(''); } }, [open, initialDate, courts, booking]);
  const hours = weeklyHours.find((item) => item.weekday === weekdayFor(date));
  const available = Boolean(hours && (hours.is_open === true || hours.is_open === 1));
  const openAt = available ? hours!.open_time : '06:00';
  const closeAt = available ? hours!.close_time : '23:30';
  const startOptions = useMemo(() => timeOptions.filter((time) => time >= openAt && time < closeAt), [openAt, closeAt]);
  const endOptions = useMemo(() => timeOptions.filter((time) => time > startTime && time <= closeAt && (!isBlock || time >= addMinutes(startTime, 30))), [startTime, closeAt, isBlock]);

  useEffect(() => { if (!startOptions.includes(startTime) && startOptions.length) setStartTime(startOptions[0]); }, [startOptions, startTime]);
  useEffect(() => { const minimumEnd = addMinutes(startTime, isBlock ? 30 : 60); if (!endOptions.includes(endTime) || endTime < minimumEnd) setEndTime(endOptions.find((time) => time >= minimumEnd) || endOptions.at(-1) || '20:00'); }, [endOptions, startTime, endTime, isBlock]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!courtId) { setError('Cadastre ou selecione uma quadra.'); return; }
    if (!available) { setError('A arena está fechada neste dia. Escolha outra data.'); return; }
    setSaving(true);
    const startAt = `${date}T${startTime}:00.000Z`, endAt = `${date}T${endTime}:00.000Z`;
    try {
      if (isBlock) await api('/api/blocks', { method: 'POST', body: JSON.stringify({ courtId, reason: reason.trim(), startAt, endAt }) });
      else if (isEdit && booking) await api(`/api/bookings/${booking.id}`, { method: 'PATCH', body: JSON.stringify({ courtId, customerName: customerName.trim(), customerPhone: phone, startAt, endAt }) });
      else await api('/api/bookings', { method: 'POST', body: JSON.stringify({ courtId, customerName: customerName.trim(), customerPhone: phone, startAt, endAt }) });
      onOpenChange(false); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); }
    finally { setSaving(false); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{isBlock ? 'Bloquear horário' : isEdit ? 'Editar reserva' : 'Nova reserva'}</DialogTitle><DialogDescription>{isBlock ? 'O horário ficará indisponível para reservas.' : isEdit ? 'Atualize os dados, a quadra e o horário.' : 'Registre um pedido de reserva para sua arena.'}</DialogDescription></DialogHeader><form className="grid gap-4" onSubmit={submit}><div className="grid gap-2"><Label>Data</Label><DatePicker value={date} onChange={setDate} /></div><div className="grid gap-2"><Label>Quadra</Label><Select value={courtId} onValueChange={setCourtId}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione a quadra" /></SelectTrigger><SelectContent>{courts.map((court) => <SelectItem key={court.id} value={court.id}>{court.name} · {court.sport}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-3 min-[420px]:grid-cols-2"><div className="grid gap-2"><Label>Início</Label><Select value={startTime} onValueChange={setStartTime}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{startOptions.map((time) => <SelectItem key={time} value={time}>{time}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>Fim</Label><Select value={endTime} onValueChange={setEndTime}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{endOptions.map((time) => <SelectItem key={time} value={time}>{time}</SelectItem>)}</SelectContent></Select></div></div>{isBlock ? <div className="grid gap-2"><Label htmlFor="block-reason">Motivo</Label><Textarea id="block-reason" maxLength={160} value={reason} onChange={(event) => setReason(event.target.value)} required /></div> : <><div className="grid gap-2"><Label htmlFor="customer-name">Nome do cliente</Label><Input id="customer-name" autoComplete="name" maxLength={100} value={customerName} onChange={(event) => setCustomerName(event.target.value)} required /></div><div className="grid gap-2"><Label htmlFor="customer-phone">WhatsApp</Label><Input id="customer-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(31) 99999-9999" value={phone} onChange={(event) => setPhone(event.target.value)} /></div></>}{!available && <p className="text-sm text-amber-800">A arena não funciona nesse dia.</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" disabled={saving || !available}>{saving && <LoaderCircle className="animate-spin" />}{isBlock ? 'Bloquear horário' : isEdit ? 'Salvar alterações' : 'Salvar reserva'}</Button></DialogFooter></form></DialogContent></Dialog>;
}
