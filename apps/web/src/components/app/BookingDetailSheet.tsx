import type { ComponentType, ReactNode } from 'react';
import { BadgeCheck, Banknote, Calendar, Check, Clock, LandPlot, Lock, MessageCircle, Pencil, Phone, QrCode, Repeat, Unlock, X, type LucideProps } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ResponsiveSheet } from '@/components/app/ResponsiveSheet';
import { BookingStatusBadge, ToneBadge, isActionable } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { fmtDate, type Block, type DayBooking } from '@/lib/arena';
import { durationLabel, formatCurrency, formatPhone, formatTime, minutesOf, whatsappLink } from '@/lib/format';

export type DetailItem = { kind: 'booking'; booking: DayBooking } | { kind: 'block'; block: Block };

type Props = {
  item: DetailItem | null; onClose: () => void; busy?: boolean;
  onEdit: (booking: DayBooking) => void; onConfirm: (booking: DayBooking) => void; onComplete: (booking: DayBooking) => void;
  onCancel: (booking: DayBooking) => void; onPix: (booking: DayBooking) => void; onRelease: (block: Block) => void;
};

function Row({ icon: Icon, label, children }: { icon: ComponentType<LucideProps>; label: string; children: ReactNode }) {
  return <div className="flex items-center gap-3 py-3">
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span>
    <span className="flex-1 text-muted-foreground">{label}</span><span className="text-right font-medium">{children}</span>
  </div>;
}

export function BookingDetailSheet({ item, onClose, busy, onEdit, onConfirm, onComplete, onCancel, onPix, onRelease }: Props) {
  const open = Boolean(item);
  if (item?.kind === 'block') {
    const b = item.block;
    return <ResponsiveSheet open={open} onOpenChange={(value) => { if (!value) onClose(); }} title={<span className="inline-flex items-center gap-2"><Lock className="size-4" aria-hidden="true" />Horário bloqueado</span>} description={<ToneBadge tone="gray">Bloqueio</ToneBadge>}
      footer={<Button variant="outline" className="h-10 w-full" disabled={busy} onClick={() => onRelease(b)}><Unlock /> Liberar horário</Button>}>
      <div className="divide-y px-5">
        <Row icon={Calendar} label="Data"><span className="capitalize">{fmtDate(b.start_at.slice(0, 10), 'EEE, dd/MM/yyyy')}</span></Row>
        <Row icon={Clock} label="Horário"><span className="tabular-nums">{formatTime(b.start_at)} – {formatTime(b.end_at)}</span></Row>
        <Row icon={LandPlot} label="Quadra">{b.court_name}</Row>
        <Row icon={Lock} label="Motivo">{b.reason || '—'}</Row>
      </div>
    </ResponsiveSheet>;
  }

  const booking = item?.kind === 'booking' ? item.booking : null;
  const wa = whatsappLink(booking?.customer_phone);
  const monthly = booking?.status === 'monthly';
  const actionable = booking ? isActionable(booking.status) : false;
  return <ResponsiveSheet open={open} onOpenChange={(value) => { if (!value) onClose(); }}
    title={<span className="capitalize">{booking?.customer_name}</span>} description={booking && <BookingStatusBadge status={booking.status} />}
    footer={booking && <div className="space-y-2">
      {wa && <Button asChild className="h-10 w-full"><a href={wa} target="_blank" rel="noreferrer"><MessageCircle /> Chamar no WhatsApp</a></Button>}
      {monthly && <Button asChild variant="outline" className="h-10 w-full"><Link to="/mensalistas"><Repeat /> Ver mensalista</Link></Button>}
      {actionable && <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" className="h-10" disabled={busy} onClick={() => onEdit(booking)}><Pencil />Editar</Button>
        {booking.status === 'pending'
          ? <Button variant="outline" className="h-10" disabled={busy} onClick={() => onConfirm(booking)}><BadgeCheck />Confirmar</Button>
          : <Button variant="outline" className="h-10" disabled={busy} onClick={() => onComplete(booking)}><Check />Concluir</Button>}
        <Button variant="outline" className="h-10 border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800" disabled={busy} onClick={() => onCancel(booking)}><X />Cancelar</Button>
      </div>}
      {booking.status === 'pending' && <Button variant="ghost" className="h-10 w-full" disabled={busy} onClick={() => onPix(booking)}><QrCode /> Gerar link Pix</Button>}
    </div>}>
    {booking && <div className="divide-y px-5">
      <Row icon={Calendar} label="Data"><span className="capitalize">{fmtDate(booking.start_at.slice(0, 10), 'EEE, dd/MM/yyyy')}</span></Row>
      <Row icon={Clock} label="Horário"><span className="tabular-nums">{formatTime(booking.start_at)} – {formatTime(booking.end_at)} <span className="font-normal text-muted-foreground">· {durationLabel(minutesOf(booking.end_at) - minutesOf(booking.start_at))}</span></span></Row>
      <Row icon={LandPlot} label="Quadra">{booking.court_name} · {booking.sport}</Row>
      <Row icon={Banknote} label="Valor">{monthly ? <span className="font-normal text-muted-foreground">Mensalidade</span> : <span className={booking.status === 'cancelled' ? 'text-muted-foreground line-through' : 'tabular-nums'}>{formatCurrency(booking.amount_cents)}</span>}</Row>
      {booking.customer_phone && <Row icon={Phone} label="Telefone"><span className="tabular-nums">{formatPhone(booking.customer_phone)}</span></Row>}
    </div>}
  </ResponsiveSheet>;
}
