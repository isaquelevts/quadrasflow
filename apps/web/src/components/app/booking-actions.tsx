import { useEffect, useState } from 'react';
import { CalendarX2, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { notifyBookingsChanged } from '@/components/app/shell-context';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { errorMessage, formatCurrency } from '@/lib/format';

type Status = 'confirmed' | 'cancelled' | 'completed';
export type CancelTarget = { ids: string[]; summary?: string };

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** Ações de reserva com aviso (toast) após cada uma. Mantém o comportamento atual: link de avaliação ao concluir e link Pix sob demanda. */
export function useBookingActions({ slug, onChanged }: { slug?: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function setStatus(ids: string[], status: Status, reason?: string, refund?: boolean) {
    setBusy(true);
    let ok = 0, reviewToken: string | null | undefined;
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const result = await api<{ reviewToken?: string | null }>(`/api/bookings/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason, ...(refund === undefined ? {} : { refund }) }) });
        ok += 1; reviewToken ||= result.reviewToken;
      } catch (cause) { failures.push(errorMessage(cause)); }
    }
    setBusy(false);
    if (ok) {
      const noun = ok === 1 ? 'Reserva' : `${ok} reservas`;
      const verb = { confirmed: ok === 1 ? 'confirmada' : 'confirmadas', completed: ok === 1 ? 'concluída' : 'concluídas', cancelled: ok === 1 ? 'cancelada' : 'canceladas' }[status];
      if (status === 'completed' && reviewToken && slug && ids.length === 1) {
        const url = `${window.location.origin}/a/${encodeURIComponent(slug)}?avaliar=${encodeURIComponent(reviewToken)}`;
        const copied = await copy(url);
        toast.success(`${noun} ${verb}`, { description: copied ? 'Link de avaliação copiado.' : undefined, action: copied ? undefined : { label: 'Abrir link de avaliação', onClick: () => window.open(url, '_blank', 'noopener') } });
      } else toast.success(`${noun} ${verb}`);
      notifyBookingsChanged(); onChanged();
    }
    if (failures.length) toast.error(failures[0]);
    return ok;
  }

  async function pixLink(id: string) {
    setBusy(true);
    try {
      const result = await api<{ url: string }>(`/api/bookings/${id}/pix-link`, { method: 'POST', body: '{}' });
      const copied = await copy(result.url);
      toast.success(copied ? 'Link Pix copiado' : 'Link Pix gerado', { description: 'Envie ao cliente para concluir o pagamento.', action: { label: 'Abrir', onClick: () => window.open(result.url, '_blank', 'noopener') } });
    } catch (cause) { toast.error(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function releaseBlock(id: string) {
    setBusy(true);
    try { await api(`/api/blocks/${id}`, { method: 'DELETE' }); toast.success('Horário liberado'); notifyBookingsChanged(); onChanged(); return true; }
    catch (cause) { toast.error(errorMessage(cause)); return false; }
    finally { setBusy(false); }
  }

  return { busy, setStatus, pixLink, releaseBlock };
}

type CancelPreview = { paid_cents: number; with_paid: number; refund_policy: 'always' | 'never' | 'team' };
/** Cancelar sempre passa por confirmação, com motivo opcional (gravado no histórico da reserva). Com valor pago, a equipe escolhe se devolve. */
export function CancelBookingDialog({ target, onOpenChange, onConfirm }: { target: CancelTarget | null; onOpenChange: (open: boolean) => void; onConfirm: (ids: string[], reason: string, refund?: boolean) => Promise<unknown> }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [refund, setRefund] = useState(false);
  const many = (target?.ids.length || 0) > 1;
  const key = target?.ids.join(',') || '';
  useEffect(() => {
    setPreview(null);
    if (!key) return;
    let alive = true;
    api<CancelPreview>(`/api/bookings/cancel-preview?ids=${encodeURIComponent(key)}`).then((p) => { if (alive) { setPreview(p); setRefund(p.refund_policy === 'always'); } }).catch(() => undefined);
    return () => { alive = false; };
  }, [key]);
  const paid = preview?.paid_cents || 0;
  return <AlertDialog open={Boolean(target)} onOpenChange={(open) => { if (!open) setReason(''); onOpenChange(open); }}>
    <AlertDialogContent className="max-sm:top-auto max-sm:bottom-0 max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <AlertDialogHeader className="flex flex-row items-start gap-3 text-left">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600"><CalendarX2 className="size-5" aria-hidden="true" /></span>
        <div className="space-y-1">
          <AlertDialogTitle>{many ? `Cancelar ${target!.ids.length} reservas?` : 'Cancelar esta reserva?'}</AlertDialogTitle>
          <AlertDialogDescription>{target?.summary ? <><span className="capitalize">{target.summary}</span>. </> : null}{many ? 'Os horários voltam a ficar livres na agenda.' : 'O horário volta a ficar livre na agenda.'}</AlertDialogDescription>
        </div>
      </AlertDialogHeader>
      {paid > 0 && <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
        <span><span className="block font-medium">Devolver {formatCurrency(paid)} ao cliente</span>
          <span className="block text-[12.5px] text-muted-foreground">{refund ? 'Entra no Financeiro como "Estorno a devolver" para a equipe fazer a devolução.' : 'O valor pago fica com a arena (registrado como retido).'}{preview?.refund_policy === 'team' ? ' A regra da arena é decidir caso a caso.' : ''}</span></span>
        <Switch checked={refund} onCheckedChange={setRefund} aria-label={`Devolver ${formatCurrency(paid)} ao cliente`} /></label>}
      <div className="grid gap-1.5">
        <Label htmlFor="cancel-reason">Motivo (opcional)</Label>
        <Textarea id="cancel-reason" rows={2} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: chuva, pedido do cliente" />
      </div>
      <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:flex">
        <AlertDialogCancel disabled={saving}>Voltar</AlertDialogCancel>
        <AlertDialogAction disabled={saving} className="bg-rose-600 text-white hover:bg-rose-700" onClick={async (event) => {
          event.preventDefault();
          if (!target) return;
          setSaving(true);
          await onConfirm(target.ids, reason.trim(), paid > 0 ? refund : undefined);
          setSaving(false); setReason(''); onOpenChange(false);
        }}>{saving && <LoaderCircle className="animate-spin" />}{many ? 'Cancelar reservas' : 'Cancelar reserva'}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
