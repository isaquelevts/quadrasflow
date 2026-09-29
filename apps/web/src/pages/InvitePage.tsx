import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, LoaderCircle, MailCheck } from 'lucide-react';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/format';

type Invite = { name: string; email: string; role: string; role_label: string; arena: string; expires_at: string };

/** Página pública do convite: a pessoa confere os dados, cria a senha e já entra no painel. */
export function InvitePage() {
  const { token = '' } = useParams();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<{ invite: Invite }>(`/api/public/invites/${encodeURIComponent(token)}`)
      .then((data) => setInvite(data.invite))
      .catch((cause) => setLoadError(errorMessage(cause)));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (password.length < 8) { setError('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (password !== confirm) { setError('As duas senhas não são iguais.'); return; }
    setPending(true);
    try {
      await api(`/api/public/invites/${encodeURIComponent(token)}/accept`, { method: 'POST', body: JSON.stringify({ password }) });
      await refresh();
      navigate('/', { replace: true });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setPending(false); }
  }

  return <main className="grid min-h-svh place-items-center p-3 sm:p-5"><div className="w-full max-w-md">
    <div className="mb-6"><Brand /></div>
    <Card className="rounded-2xl border-border/80 shadow-lg shadow-primary/5">
      {!invite && !loadError ? <CardContent className="grid min-h-48 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando convite" /></CardContent>
        : loadError ? <>
          <CardHeader className="space-y-2 p-4 pb-2 sm:p-7 sm:pb-2"><CardTitle className="text-2xl tracking-tight">Convite indisponível</CardTitle></CardHeader>
          <CardContent className="grid gap-5 p-4 pt-3 sm:p-7 sm:pt-3">
            <p role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{loadError}</p>
            <Button asChild variant="outline" className="h-11"><Link to="/login">Ir para o login</Link></Button>
          </CardContent>
        </> : invite && <>
          <CardHeader className="space-y-2 p-4 pb-2 sm:p-7 sm:pb-2">
            <span className="grid size-10 place-items-center rounded-full bg-brand-50 text-brand-700"><MailCheck className="size-5" aria-hidden="true" /></span>
            <CardTitle className="text-2xl tracking-tight">Olá, {invite.name.split(' ')[0]}!</CardTitle>
            <CardDescription>Você foi convidado para acessar a <b className="text-foreground">{invite.arena}</b> como <b className="text-foreground">{invite.role_label}</b>. Crie sua senha para entrar.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-5 sm:p-7 sm:pt-5">
            <form className="grid gap-5" onSubmit={(event) => void submit(event)} noValidate>
              <div className="grid gap-2"><Label htmlFor="invite-email">E-mail</Label><Input id="invite-email" value={invite.email} readOnly className="bg-muted/60 text-muted-foreground" autoComplete="username" /></div>
              <div className="grid gap-2"><Label htmlFor="invite-password">Crie uma senha</Label><Input id="invite-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /><span className="text-[12px] text-muted-foreground">Pelo menos 8 caracteres.</span></div>
              <div className="grid gap-2"><Label htmlFor="invite-confirm">Repita a senha</Label><Input id="invite-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
              {error && <p role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
              <Button type="submit" className="h-11" disabled={pending}>{pending && <LoaderCircle className="animate-spin" />}Criar senha e entrar</Button>
              <p className="text-center text-[12.5px] text-muted-foreground">O convite vale até {new Date(invite.expires_at).toLocaleDateString('pt-BR')}.</p>
            </form>
          </CardContent>
        </>}
    </Card>
  </div></main>;
}
