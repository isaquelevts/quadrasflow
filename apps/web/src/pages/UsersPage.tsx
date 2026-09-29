import { useEffect, useState, type FormEvent } from 'react';
import { Check, ConciergeBell, Copy, LoaderCircle, Mail, MailPlus, MessageCircle, Minus, Send, ShieldCheck, Sparkles, Trash2, UserCheck, UserPlus, UserX, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar, PageHeader, Panel } from '@/components/app/page';
import { ResponsiveSheet } from '@/components/app/ResponsiveSheet';
import { usePrimaryAction } from '@/components/app/shell-context';
import { ToneBadge } from '@/components/app/status';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { errorMessage, formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';

type Role = 'arena_admin' | 'staff';
type TeamUser = { id: string; name: string; email: string; role: Role; active: boolean; created_at: string; last_login_at: string | null; owner: boolean };
type Invite = { id: string; name: string; email: string; role: Role; expires_at: string; created_at: string; expired: boolean };
type InviteResult = { invite: Invite; link: string; emailSent: boolean; emailConfigured: boolean };

const ROLES: Record<Role, { label: string; tone: 'green' | 'blue'; icon: typeof ShieldCheck; desc: string }> = {
  arena_admin: { label: 'Administrador', tone: 'green', icon: ShieldCheck, desc: 'Acesso total, inclusive financeiro, preços, quadras e equipe.' },
  staff: { label: 'Recepção', tone: 'blue', icon: ConciergeBell, desc: 'Opera agenda, reservas, clientes e conversas no dia a dia. Não vê o financeiro.' },
};
const PERMS: Array<[string, boolean, boolean | 'view']> = [
  ['Agenda e reservas', true, true], ['Clientes e observações', true, true], ['Conversas do WhatsApp', true, true],
  ['Mensalistas', true, 'view'], ['Quadras', true, 'view'], ['Financeiro', true, false],
  ['Conectar e configurar o bot', true, false], ['Equipe e acessos', true, false], ['Configurações da arena', true, false],
];
const dateBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
function lastSeen(iso: string | null) {
  if (!iso) return 'nunca entrou';
  const d = new Date(iso), now = new Date();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5);
  return days === 0 ? `hoje às ${time}` : days === 1 ? `ontem às ${time}` : `em ${dateBR(iso)}`;
}
type Confirm = { title: string; text: string; action: string; run: () => Promise<void> } | null;

export function UsersPage() {
  const { user } = useAuth();
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  usePrimaryAction(() => setInviting(true));

  async function load() {
    setLoading(true); setError('');
    try {
      const [teamData, inviteData] = await Promise.all([api<{ users: TeamUser[] }>('/api/arena/users'), api<{ invites: Invite[]; emailConfigured: boolean }>('/api/arena/invites')]);
      setTeam(teamData.users.map((u) => ({ ...u, active: Boolean(u.active) }))); setInvites(inviteData.invites); setEmailConfigured(inviteData.emailConfigured);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); toast.success(label); await load(); }
    catch (cause) { toast.error(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  async function resend(invite: Invite) {
    setBusy(true);
    try { const data = await api<InviteResult>(`/api/arena/invites/${invite.id}/resend`, { method: 'POST', body: '{}' }); setResult(data); await load(); }
    catch (cause) { toast.error(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4 lg:space-y-5">
    <PageHeader title="Equipe e acessos" description="Convide quem ajuda a operar a arena e defina o que cada pessoa pode fazer."
      actions={<Button className="hidden md:inline-flex" onClick={() => setInviting(true)}><UserPlus /> Convidar pessoa</Button>} />
    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    <div className="grid grid-cols-1 items-start gap-4 lg:gap-5 xl:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-4 lg:space-y-5">
        <Panel>
          <div className="flex items-center gap-2 border-b px-4 py-4 lg:px-5">
            <h2 className="flex-1 text-[15px] font-semibold">Pessoas com acesso <span className="ml-1 rounded-full bg-muted px-2 py-0.5 align-middle text-[11px] font-semibold text-muted-foreground">{team.length}</span></h2>
            <Button variant="outline" size="sm" className="md:hidden" onClick={() => setInviting(true)}><UserPlus /> Convidar</Button>
          </div>
          {loading && !team.length ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div>
            : <ul className="divide-y">{team.map((member) => {
              const me = member.id === user?.id, locked = me || member.owner;
              return <li key={member.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3.5 lg:px-5', !member.active && 'bg-muted/40')}>
                <div className="relative"><Avatar name={member.name} className="size-10" /><span aria-hidden="true" className={cn('absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-white', member.active ? 'bg-brand-500' : 'bg-gray-300')} /></div>
                <div className={cn('min-w-0 flex-1', !member.active && 'opacity-60')}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{member.name}</span>
                    {me && <span className="rounded bg-brand-900 px-1.5 py-px text-[10.5px] font-semibold text-lime-400">você</span>}
                    <ToneBadge tone={ROLES[member.role]?.tone || 'gray'}>{ROLES[member.role]?.label || member.role}</ToneBadge>
                    {!member.active && <ToneBadge tone="gray">Desativado</ToneBadge>}
                  </div>
                  <div className="truncate text-[12.5px] text-muted-foreground">{member.email}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">Desde {dateBR(member.created_at)} · último acesso {lastSeen(member.last_login_at)}</div>
                </div>
                {locked ? <span className="text-[12px] text-muted-foreground">{member.owner ? 'Dono da conta' : 'Sua conta'}</span> : <div className="flex items-center gap-2">
                  <Select value={member.role} onValueChange={(role) => void run(`${member.name} agora é ${ROLES[role as Role].label}`, () => api(`/api/arena/users/${member.id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }))} disabled={busy}>
                    <SelectTrigger className="w-40" aria-label={`Papel de ${member.name}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(ROLES) as Role[]).map((role) => <SelectItem key={role} value={role}>{ROLES[role].label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" disabled={busy} aria-label={member.active ? `Desativar ${member.name}` : `Reativar ${member.name}`} title={member.active ? 'Desativar' : 'Reativar'}
                    onClick={() => member.active
                      ? setConfirm({ title: `Desativar ${member.name}?`, text: 'A pessoa sai do painel na hora e não consegue entrar até ser reativada.', action: 'Desativar', run: () => run(`${member.name} desativado`, () => api(`/api/arena/users/${member.id}/status`, { method: 'PATCH', body: JSON.stringify({ active: false }) })) })
                      : void run(`${member.name} reativado`, () => api(`/api/arena/users/${member.id}/status`, { method: 'PATCH', body: JSON.stringify({ active: true }) }))}>
                    {member.active ? <UserX /> : <UserCheck />}</Button>
                  <Button variant="outline" size="icon" disabled={busy} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" aria-label={`Remover ${member.name}`} title="Remover acesso"
                    onClick={() => setConfirm({ title: `Remover ${member.name}?`, text: 'A pessoa perde o acesso ao painel imediatamente. O histórico de ações continua registrado.', action: 'Remover acesso', run: () => run('Acesso removido', () => api(`/api/arena/users/${member.id}`, { method: 'DELETE' })) })}><Trash2 /></Button>
                </div>}
              </li>;
            })}</ul>}
          {!loading && team.length === 1 && !invites.length && <div className="m-4 mt-0 flex flex-col gap-3 rounded-lg border border-dashed px-4 py-5 sm:flex-row sm:items-center lg:m-5 lg:mt-0">
            <p className="flex-1 text-[13px] text-muted-foreground">Convide quem cuida da recepção para confirmar reservas e atender clientes sem acessar o financeiro.</p>
            <Button variant="outline" onClick={() => setInviting(true)}><MailPlus /> Convidar</Button>
          </div>}
        </Panel>

        {invites.length > 0 && <Panel>
          <div className="border-b px-4 py-4 lg:px-5">
            <h2 className="text-[15px] font-semibold">Convites pendentes <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[11px] font-semibold text-amber-800">{invites.length}</span></h2>
            <p className="text-[12.5px] text-muted-foreground">O acesso é liberado quando a pessoa abre o link e cria a senha.{emailConfigured ? '' : ' O envio por e-mail ainda não está configurado: compartilhe o link.'}</p>
          </div>
          <ul className="divide-y">{invites.map((invite) => <li key={invite.id} className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-5">
            <span className="grid size-10 place-items-center rounded-full border-2 border-dashed text-muted-foreground"><Mail className="size-4" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{invite.name} <span className="font-normal text-muted-foreground">· {invite.email}</span></div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2"><ToneBadge tone={ROLES[invite.role].tone}>{ROLES[invite.role].label}</ToneBadge>
                {invite.expired ? <ToneBadge tone="rose">Vencido</ToneBadge> : <span className="text-[12px] text-muted-foreground">vale até {dateBR(invite.expires_at)}</span>}</div>
            </div>
            <Button variant="outline" disabled={busy} onClick={() => void resend(invite)}><Send /> Reenviar</Button>
            <Button variant="outline" size="icon" disabled={busy} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" aria-label={`Cancelar convite de ${invite.name}`} title="Cancelar convite"
              onClick={() => setConfirm({ title: 'Cancelar este convite?', text: `${invite.name} · ${invite.email}. O link deixa de funcionar.`, action: 'Cancelar convite', run: () => run('Convite cancelado', () => api(`/api/arena/invites/${invite.id}`, { method: 'DELETE' })) })}><X /></Button>
          </li>)}</ul>
        </Panel>}
      </div>

      <div className="space-y-4 lg:space-y-5">
        <Panel>
          <div className="border-b px-4 py-4 lg:px-5"><h2 className="text-[15px] font-semibold">Permissões por papel</h2><p className="text-[12.5px] text-muted-foreground">O que cada tipo de acesso pode fazer.</p></div>
          <table className="w-full text-[13px]">
            <thead><tr className="text-[11.5px] text-muted-foreground"><th className="px-4 py-2 text-left font-medium lg:px-5"><span className="sr-only">Área</span></th>
              {(Object.keys(ROLES) as Role[]).map((role) => { const R = ROLES[role]; return <th key={role} className="w-24 px-2 py-2 font-medium"><span className="inline-flex flex-col items-center gap-1"><R.icon className={cn('size-4', R.tone === 'green' ? 'text-brand-600' : 'text-sky-600')} aria-hidden="true" />{R.label}</span></th>; })}</tr></thead>
            <tbody className="divide-y">{PERMS.map(([area, admin, staff]) => <tr key={area}><td className="px-4 py-2.5 lg:px-5">{area}</td>
              {[admin, staff].map((value, i) => <td key={i} className="text-center">{value === true
                ? <span className="inline-grid size-5 place-items-center rounded-full bg-brand-50 text-brand-600" role="img" aria-label="Pode"><Check className="size-3" aria-hidden="true" /></span>
                : value === 'view' ? <span className="text-[11px] font-medium text-muted-foreground">só ver</span>
                : <span className="inline-grid size-5 place-items-center rounded-full bg-muted text-muted-foreground/60" role="img" aria-label="Não pode"><Minus className="size-3" aria-hidden="true" /></span>}</td>)}</tr>)}</tbody>
          </table>
        </Panel>
        <section className="flex gap-3 rounded-xl border border-brand-100 bg-brand-50/70 p-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-brand-100 bg-white text-brand-700"><Sparkles className="size-4" aria-hidden="true" /></span>
          <p className="text-[13px] leading-relaxed text-brand-900/80">A configuração inicial da arena (quadras, horários e preços) é feita uma vez pelo administrador. Quem entra por convite usa o mesmo painel e <b className="text-brand-900">não precisa repetir a configuração</b>.</p>
        </section>
      </div>
    </div>

    <InviteSheet open={inviting} onOpenChange={setInviting} onCreated={(data) => { setInviting(false); setResult(data); void load(); }} />
    <InviteResultSheet result={result} onClose={() => setResult(null)} />
    <AlertDialog open={Boolean(confirm)} onOpenChange={(value) => { if (!value) setConfirm(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader className="flex flex-row items-start gap-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600"><UserX className="size-5" aria-hidden="true" /></span>
          <div className="space-y-1"><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.text}</AlertDialogDescription></div>
        </AlertDialogHeader>
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:flex">
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction className="bg-rose-600 text-white hover:bg-rose-700" onClick={async (event) => { event.preventDefault(); const c = confirm; setConfirm(null); await c?.run(); }}>{confirm?.action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function InviteSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (result: InviteResult) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setName(''); setEmail(''); setRole('staff'); setError(''); } }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try { onCreated(await api<InviteResult>('/api/arena/invites', { method: 'POST', body: JSON.stringify({ name: name.trim(), email: email.trim(), role }) })); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }
  return <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Convidar pessoa" description="A pessoa recebe um link para criar a própria senha."
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Cancelar</Button>
      <Button type="submit" form="invite-form" className="h-10" disabled={saving || name.trim().length < 2 || !email.includes('@')}>{saving && <LoaderCircle className="animate-spin" />}Enviar convite</Button>
    </div>}>
    <form id="invite-form" className="space-y-4 px-5 py-4" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-1.5"><Label htmlFor="invite-name">Nome</Label><Input id="invite-name" className="h-10" maxLength={100} placeholder="Nome do funcionário" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="invite-email">E-mail</Label><Input id="invite-email" className="h-10" type="email" placeholder="nome@email.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <fieldset className="space-y-2"><legend className="mb-1.5 text-sm font-medium">Papel</legend>
        <div role="radiogroup" aria-label="Papel" className="space-y-2">
          {(['staff', 'arena_admin'] as Role[]).map((key) => { const R = ROLES[key], on = role === key; return <button key={key} type="button" role="radio" aria-checked={on} onClick={() => setRole(key)}
            className={cn('flex w-full items-start gap-3 rounded-lg border p-3 text-left transition', on ? 'border-brand-500 bg-brand-50/50 ring-2 ring-brand-500/15' : 'hover:bg-muted/60')}>
            <span aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0 rounded-full border bg-white', on && 'border-[5px] border-brand-900')} />
            <span className="flex-1"><span className="flex items-center gap-2 font-medium"><R.icon className="size-4" aria-hidden="true" />{R.label}</span><span className="mt-0.5 block text-[12.5px] text-muted-foreground">{R.desc}</span></span>
          </button>; })}
        </div>
      </fieldset>
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </form>
  </ResponsiveSheet>;
}

/** Depois de criar ou reenviar: mostra se o e-mail saiu e oferece o link para copiar ou mandar pelo WhatsApp. */
function InviteResultSheet({ result, onClose }: { result: InviteResult | null; onClose: () => void }) {
  const [phone, setPhone] = useState('');
  useEffect(() => { setPhone(''); }, [result]);
  if (!result) return <ResponsiveSheet open={false} onOpenChange={onClose} title=""><span /></ResponsiveSheet>;
  const message = `Olá, ${result.invite.name.split(' ')[0]}! Você foi convidado para acessar o painel da arena no QuadrasFlow. Crie sua senha por este link (vale 7 dias): ${result.link}`;
  const digits = phone.replace(/\D/g, '');
  const wa = `https://wa.me/${digits ? (digits.length <= 11 ? `55${digits}` : digits) : ''}?text=${encodeURIComponent(message)}`;
  async function copy() {
    try { await navigator.clipboard.writeText(result!.link); toast.success('Link copiado'); } catch { toast.error('Não foi possível copiar. Selecione o link e copie manualmente.'); }
  }
  return <ResponsiveSheet open onOpenChange={(open) => { if (!open) onClose(); }} title="Convite criado" description={`${result.invite.name} · ${result.invite.email}`}
    footer={<Button className="h-10 w-full" onClick={onClose}>Concluir</Button>}>
    <div className="space-y-4 p-5">
      {result.emailSent
        ? <p className="flex gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5 text-[13px] text-brand-800"><Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Enviamos o convite por e-mail para <b>{result.invite.email}</b>. Você também pode mandar o link pelo WhatsApp.</span></p>
        : <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900"><Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{result.emailConfigured ? 'Não conseguimos enviar o e-mail agora.' : 'O envio por e-mail ainda não está configurado.'} Envie o link abaixo para a pessoa.</span></p>}
      <div className="grid gap-1.5"><Label htmlFor="invite-link">Link do convite</Label>
        <div className="flex gap-2"><Input id="invite-link" readOnly value={result.link} className="h-10 bg-muted/60 text-[12.5px]" onFocus={(e) => e.target.select()} /><Button variant="outline" className="h-10" onClick={() => void copy()}><Copy /> Copiar</Button></div>
        <span className="text-[12px] text-muted-foreground">Vale 7 dias e só pode ser usado uma vez.</span></div>
      <div className="grid gap-1.5"><Label htmlFor="invite-phone">WhatsApp da pessoa <span className="font-normal text-muted-foreground">(opcional)</span></Label>
        <Input id="invite-phone" className="h-10" type="tel" inputMode="tel" placeholder="(00) 00000-0000" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhone(formatPhone(phone))} /></div>
      <Button asChild variant="outline" className="h-10 w-full"><a href={wa} target="_blank" rel="noreferrer"><MessageCircle /> Enviar pelo WhatsApp</a></Button>
    </div>
  </ResponsiveSheet>;
}

