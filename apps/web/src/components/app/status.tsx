import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Tone = 'green' | 'lime' | 'amber' | 'rose' | 'gray' | 'blue';

const toneClass: Record<Tone, string> = {
  green: 'border-brand-100 bg-brand-50 text-brand-700',
  lime: 'border-lime-300/60 bg-lime-300/20 text-lime-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  rose: 'border-rose-100 bg-rose-50 text-rose-700',
  gray: 'border-border bg-muted text-muted-foreground',
  blue: 'border-sky-100 bg-sky-50 text-sky-700',
};

export const toneDot: Record<Tone, string> = {
  green: 'bg-brand-500', lime: 'bg-lime-400', amber: 'bg-amber-400', rose: 'bg-rose-500', gray: 'bg-gray-400', blue: 'bg-sky-500',
};

/** Etiqueta clara com ponto (Badge ReUI `light` + `dot`). O texto sempre acompanha a cor. */
export function ToneBadge({ tone, children, dot = true, className }: { tone: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11.5px] font-medium', toneClass[tone], className)}>
    {dot && <span aria-hidden="true" className={cn('size-1.5 rounded-full', toneDot[tone])} />}{children}
  </span>;
}

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'monthly';

export const bookingStatus: Record<BookingStatus, { label: string; tone: Tone }> = {
  confirmed: { label: 'Confirmada', tone: 'green' },
  monthly: { label: 'Mensalista', tone: 'lime' },
  pending: { label: 'Pendente', tone: 'amber' },
  completed: { label: 'Concluída', tone: 'gray' },
  cancelled: { label: 'Cancelada', tone: 'rose' },
};

export function BookingStatusBadge({ status, className }: { status: string; className?: string }) {
  const info = bookingStatus[status as BookingStatus] || { label: status, tone: 'gray' as Tone };
  return <ToneBadge tone={info.tone} className={className}>{info.label}</ToneBadge>;
}

/** Só reservas pendentes ou confirmadas aceitam concluir, confirmar ou cancelar (regra do backend). */
export const isActionable = (status: string) => status === 'pending' || status === 'confirmed';
export const isClosed = (status: string) => status === 'cancelled' || status === 'completed';
