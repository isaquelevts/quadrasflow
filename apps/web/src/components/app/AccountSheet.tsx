import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { ResponsiveSheet } from '@/components/app/ResponsiveSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/format';

const ROLE: Record<string, string> = { arena_admin: 'Administrador', staff: 'Recepção', platform_admin: 'Plataforma' };

/** "Minha conta": dados da conta e troca de senha (encerra as sessões nos outros aparelhos). */
export function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setCurrent(''); setNext(''); setConfirm(''); setError(''); } }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (next.length < 8) { setError('A nova senha precisa ter pelo menos 8 caracteres.'); return; }
    if (next !== confirm) { setError('As duas senhas novas não são iguais.'); return; }
    setSaving(true);
    try {
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      toast.success('Senha alterada', { description: 'As sessões em outros aparelhos foram encerradas.' });
      onOpenChange(false);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }

  return <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Minha conta" description={user?.company?.name}
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Fechar</Button>
      <Button type="submit" form="password-form" className="h-10" disabled={saving || !current || !next || !confirm}>{saving && <LoaderCircle className="animate-spin" />}Alterar senha</Button>
    </div>}>
    <div className="space-y-5 p-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border p-3 text-[13px]">
        <dt className="text-muted-foreground">Nome</dt><dd className="font-medium">{user?.name}</dd>
        <dt className="text-muted-foreground">E-mail</dt><dd className="truncate">{user?.email}</dd>
        <dt className="text-muted-foreground">Papel</dt><dd>{ROLE[user?.role || ''] || user?.role}</dd>
      </dl>
      <form id="password-form" className="space-y-4" onSubmit={(event) => void submit(event)}>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold"><KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />Trocar senha</h3>
        <div className="grid gap-1.5"><Label htmlFor="current-password">Senha atual</Label><Input id="current-password" className="h-10" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="new-password">Nova senha</Label><Input id="new-password" className="h-10" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /><span className="text-[12px] text-muted-foreground">Pelo menos 8 caracteres.</span></div>
        <div className="grid gap-1.5"><Label htmlFor="confirm-password">Repita a nova senha</Label><Input id="confirm-password" className="h-10" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
      </form>
    </div>
  </ResponsiveSheet>;
}
