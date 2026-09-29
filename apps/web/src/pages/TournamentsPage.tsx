import { useEffect, useState, type FormEvent } from 'react';
import { Banknote, CalendarDays, Check, CircleX, ExternalLink, Flag, LoaderCircle, Plus, Shuffle, Trophy, Undo2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { DatePicker } from '@/components/DatePicker';
import { EmptyState, PageHeader, Panel, StatCard } from '@/components/app/page';
import { ResponsiveSheet } from '@/components/app/ResponsiveSheet';
import { usePrimaryAction } from '@/components/app/shell-context';
import { ToneBadge, type Tone } from '@/components/app/status';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { fmtDate, todayKey } from '@/lib/arena';
import { errorMessage, formatCurrency, formatPhone, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tournament = { id: string; name: string; sport: string; category: string; start_date: string; entry_fee_cents: number; capacity: number; status: string; entries_count: number };
type Entry = { id: string; tournament_id: string; player_name: string; phone: string; paid: number | boolean };
type Match = { id: string; tournament_id: string; round: number; slot: number; player_a: string | null; player_b: string | null; score_a: number | null; score_b: number | null; winner: string | null };

const SPORTS = ['Society', 'Futsal', 'Beach Tennis', 'Padel', 'Tênis', 'Vôlei', 'Futevôlei', 'Basquete', 'Futebol de Campo', 'Outro'];
const STATUS: Record<string, { label: string; tone: Tone }> = { open: { label: 'Inscrições abertas', tone: 'green' }, in_progress: { label: 'Em andamento', tone: 'blue' }, finished: { label: 'Finalizado', tone: 'gray' }, cancelled: { label: 'Cancelado', tone: 'rose' } };
type Confirm = { title: string; text: string; action: string; danger?: boolean; run: () => Promise<void> } | null;

export function TournamentsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'arena_admin';
  const [items, setItems] = useState<Tournament[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [scoring, setScoring] = useState<Match | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  usePrimaryAction(() => { if (isAdmin) setCreating(true); });

  async function load() {
    setLoading(true); setError('');
    try { const d = await api<{ tournaments: Tournament[]; entries: Entry[]; matches: Match[] }>('/api/tournaments'); setItems(d.tournaments); setEntries(d.entries); setMatches(d.matches); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function run(label: string, path: string, method: 'POST' | 'PATCH', data: unknown) {
    setBusy(true);
    try { await api(path, { method, body: JSON.stringify(data) }); toast.success(label); await load(); }
    catch (cause) { toast.error(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  const open = items.filter((t) => t.status === 'open');
  const confirmedRevenue = items.reduce((sum, t) => sum + entries.filter((e) => e.tournament_id === t.id && e.paid).length * t.entry_fee_cents, 0);
  const upcoming = items.filter((t) => t.start_date >= todayKey() && t.status !== 'cancelled').sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const publicUrl = user?.company?.slug ? `/a/${user.company.slug}` : '';

  return <div className="space-y-4 lg:space-y-5">
    <PageHeader title="Torneios" description="Eventos, inscrições, chave e resultados."
      actions={<>
        {publicUrl && <Button asChild variant="outline"><a href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink /><span className="sm:hidden">Inscrições</span><span className="hidden sm:inline">Página de inscrição</span></a></Button>}
        {isAdmin && <Button className="hidden md:inline-flex" onClick={() => setCreating(true)}><Plus /> Novo torneio</Button>}
      </>} />
    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <StatCard label="Com inscrições abertas" icon={Trophy} value={open.length} sub={plural(items.length, 'torneio cadastrado', 'torneios cadastrados')} />
      <StatCard label="Inscritos" icon={Users} value={entries.length} sub={`${entries.filter((e) => e.paid).length} com pagamento confirmado`} />
      <StatCard label="Inscrições recebidas" icon={Banknote} value={formatCurrency(confirmedRevenue)} sub="lançadas no Financeiro" />
      <StatCard label="Próximo torneio" icon={CalendarDays} value={upcoming ? fmtDate(upcoming.start_date, 'dd/MM') : '—'} sub={upcoming ? upcoming.name : 'nenhum agendado'} />
    </section>

    {loading && !items.length ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div>
      : !items.length ? <Panel><EmptyState icon={Trophy} title="Nenhum torneio cadastrado" text="Crie um torneio para receber inscrições pela página pública da arena." action={isAdmin ? <Button onClick={() => setCreating(true)}><Plus /> Novo torneio</Button> : undefined} /></Panel>
      : <div className="space-y-4">{items.map((t) => {
        const es = entries.filter((e) => e.tournament_id === t.id), ms = matches.filter((m) => m.tournament_id === t.id);
        const eligible = es.filter((e) => e.paid || t.entry_fee_cents === 0).length, st = STATUS[t.status] || { label: t.status, tone: 'gray' as Tone };
        const rounds = [...new Set(ms.map((m) => m.round))].sort((a, b) => a - b);
        const fill = t.capacity ? Math.min(100, Math.round(es.length / t.capacity * 100)) : 0;
        return <Panel key={t.id} className={cn(t.status === 'cancelled' && 'opacity-70')}>
          <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start lg:px-5">
            <div className="flex min-w-0 flex-1 gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Trophy className="size-5" aria-hidden="true" /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-semibold">{t.name}</h2><ToneBadge tone={st.tone}>{st.label}</ToneBadge></div>
                <p className="text-[12.5px] text-muted-foreground">{t.sport}{t.category ? ` · ${t.category}` : ''} · <span className="inline-block first-letter:uppercase">{fmtDate(t.start_date, "EEE, d 'de' MMM")}</span> · inscrição {t.entry_fee_cents ? formatCurrency(t.entry_fee_cents) : 'grátis'}</p>
                <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground"><div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${es.length} de ${t.capacity} vagas`}><div className="h-full rounded-full bg-brand-500" style={{ width: `${fill}%` }} /></div><span className="tabular-nums">{es.length}/{t.capacity} vagas</span></div>
              </div>
            </div>
            {isAdmin && <div className="flex flex-wrap gap-2">
              {t.status === 'open' && !ms.length && <Button disabled={busy || eligible < 2} title={eligible < 2 ? 'Confirme pelo menos duas inscrições' : undefined}
                onClick={() => setConfirm({ title: 'Gerar a chave?', text: `Sorteia ${plural(eligible, 'participante confirmado', 'participantes confirmados')} nos confrontos. Depois de gerada, a chave não pode ser refeita.`, action: 'Gerar chave', run: () => run('Chave gerada', `/api/tournaments/${t.id}/bracket`, 'POST', {}) })}><Shuffle /> Gerar chave</Button>}
              {t.status === 'in_progress' && <Button variant="outline" disabled={busy} onClick={() => setConfirm({ title: `Finalizar ${t.name}?`, text: 'O torneio sai da lista de inscrições abertas e fica como finalizado.', action: 'Finalizar', run: () => run('Torneio finalizado', `/api/tournaments/${t.id}/status`, 'PATCH', { status: 'finished' }) })}><Flag /> Finalizar</Button>}
              {(t.status === 'open' || t.status === 'in_progress') && <Button variant="outline" size="icon" disabled={busy} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" aria-label={`Cancelar ${t.name}`} title="Cancelar torneio"
                onClick={() => setConfirm({ title: `Cancelar ${t.name}?`, text: 'As inscrições deixam de ser aceitas e o torneio fica como cancelado. Pagamentos já recebidos continuam no Financeiro.', action: 'Cancelar torneio', danger: true, run: () => run('Torneio cancelado', `/api/tournaments/${t.id}/status`, 'PATCH', { status: 'cancelled' }) })}><CircleX /></Button>}
            </div>}
          </div>
          <div className="grid gap-0 lg:grid-cols-2 lg:divide-x">
            <section className="p-4 lg:p-5">
              <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Inscrições · {es.length}</h3>
              {es.length ? <ul className="divide-y">{es.map((e) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0"><div className="font-medium">{e.player_name}</div><div className="text-[12px] text-muted-foreground tabular-nums">{formatPhone(e.phone)}</div></div>
                {t.entry_fee_cents > 0 ? (isAdmin
                  ? (e.paid ? <span className="flex items-center gap-2"><ToneBadge tone="green">Pago</ToneBadge><Button variant="ghost" size="icon" disabled={busy} aria-label={`Desfazer pagamento de ${e.player_name}`} onClick={() => void run('Pagamento desfeito', '/api/tournaments/entries', 'PATCH', { entryId: e.id, paid: false })}><Undo2 /></Button></span>
                    : <Button size="sm" disabled={busy} onClick={() => void run('Pagamento confirmado', '/api/tournaments/entries', 'PATCH', { entryId: e.id, paid: true })}><Check /> Confirmar pagamento</Button>)
                  : <ToneBadge tone={e.paid ? 'green' : 'amber'}>{e.paid ? 'Pago' : 'Pendente'}</ToneBadge>) : <ToneBadge tone="gray">Grátis</ToneBadge>}
              </li>)}</ul> : <p className="text-[13px] text-muted-foreground">Sem inscrições até agora. Compartilhe a página de inscrição da arena.</p>}
            </section>
            <section className="border-t p-4 lg:border-t-0 lg:p-5">
              <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Chave e placares</h3>
              {rounds.length ? <div className="space-y-4">{rounds.map((round) => <div key={round}>
                <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{round === rounds.at(-1) && ms.filter((m) => m.round === round).length === 1 ? 'Final' : `Rodada ${round}`}</div>
                <ul className="space-y-1.5">{ms.filter((m) => m.round === round).sort((a, b) => a.slot - b.slot).map((m) => <li key={m.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className={cn('flex justify-between gap-2', m.winner && m.winner === m.player_a && 'font-semibold')}><span className={cn('truncate', m.winner && !m.player_a && 'text-muted-foreground italic')}>{m.player_a || (m.winner ? 'sem adversário (passa direto)' : 'A definir')}</span><span className="tabular-nums">{m.score_a ?? ''}</span></div>
                    <div className={cn('flex justify-between gap-2', m.winner && m.winner === m.player_b && 'font-semibold')}><span className={cn('truncate', m.winner && !m.player_b && 'text-muted-foreground italic')}>{m.player_b || (m.winner ? 'sem adversário (passa direto)' : 'A definir')}</span><span className="tabular-nums">{m.score_b ?? ''}</span></div>
                  </div>
                  {!m.winner && m.player_a && m.player_b && isAdmin && <Button variant="outline" size="sm" onClick={() => setScoring(m)}>Placar</Button>}
                  {m.winner && <Trophy className="size-4 text-amber-500" aria-label={`Vencedor: ${m.winner}`} />}
                </li>)}</ul>
              </div>)}</div> : <p className="text-[13px] text-muted-foreground">A chave aparece depois que houver pelo menos duas inscrições confirmadas e ela for gerada.</p>}
            </section>
          </div>
        </Panel>;
      })}</div>}

    <TournamentSheet open={creating} onOpenChange={setCreating} onSaved={() => { setCreating(false); void load(); }} />
    <ScoreSheet match={scoring} onClose={() => setScoring(null)} onSaved={() => { setScoring(null); void load(); }} />
    <AlertDialog open={Boolean(confirm)} onOpenChange={(value) => { if (!value) setConfirm(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader className="flex flex-row items-start gap-3 text-left">
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-full', confirm?.danger ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-700')}>{confirm?.danger ? <CircleX className="size-5" aria-hidden="true" /> : <Trophy className="size-5" aria-hidden="true" />}</span>
          <div className="space-y-1"><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.text}</AlertDialogDescription></div>
        </AlertDialogHeader>
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:flex">
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction className={confirm?.danger ? 'bg-rose-600 text-white hover:bg-rose-700' : undefined} onClick={async (event) => { event.preventDefault(); const c = confirm; setConfirm(null); await c?.run(); }}>{confirm?.action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function TournamentSheet({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [sport, setSport] = useState('Beach Tennis');
  const [category, setCategory] = useState('');
  const [startDate, setStartDate] = useState(todayKey());
  const [fee, setFee] = useState('0,00');
  const [capacity, setCapacity] = useState('16');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setName(''); setSport('Beach Tennis'); setCategory(''); setStartDate(todayKey()); setFee('0,00'); setCapacity('16'); setError(''); } }, [open]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try { await api('/api/tournaments', { method: 'POST', body: JSON.stringify({ name: name.trim(), sport, category: category.trim(), startDate, entryFeeCents: Math.round(Number(fee.replace(/\./g, '').replace(',', '.')) * 100) || 0, capacity: Number(capacity) }) }); toast.success('Torneio criado'); onSaved(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }
  return <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Novo torneio" description="As inscrições abrem na página pública da arena."
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Cancelar</Button>
      <Button type="submit" form="tournament-form" className="h-10" disabled={saving || name.trim().length < 2}>{saving && <LoaderCircle className="animate-spin" />}Criar torneio</Button>
    </div>}>
    <form id="tournament-form" className="space-y-4 px-5 py-4" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-1.5"><Label htmlFor="t-name">Nome</Label><Input id="t-name" className="h-10" maxLength={100} placeholder="Ex.: Copa de Verão" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label>Modalidade</Label><Select value={sport} onValueChange={setSport}><SelectTrigger className="h-10 w-full" aria-label="Modalidade"><SelectValue /></SelectTrigger><SelectContent>{SPORTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1.5"><Label htmlFor="t-cat">Categoria <span className="font-normal text-muted-foreground">(opcional)</span></Label><Input id="t-cat" className="h-10" maxLength={60} placeholder="Ex.: Mista" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
      </div>
      <div className="grid gap-1.5"><Label>Data de início</Label><DatePicker className="h-10 w-full" value={startDate} onChange={setStartDate} label="Data de início" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label htmlFor="t-fee">Inscrição</Label><div className="relative"><span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">R$</span><Input id="t-fee" className="h-10 pl-9 tabular-nums" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></div><span className="text-[12px] text-muted-foreground">Deixe 0 para inscrição grátis.</span></div>
        <div className="grid gap-1.5"><Label htmlFor="t-cap">Vagas</Label><Input id="t-cap" className="h-10 tabular-nums" type="number" min={2} max={256} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
      </div>
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </form>
  </ResponsiveSheet>;
}

function ScoreSheet({ match, onClose, onSaved }: { match: Match | null; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (match) { setA(''); setB(''); setError(''); } }, [match]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!match) return; setError('');
    const scoreA = Number(a), scoreB = Number(b);
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || a === '' || b === '') { setError('Informe o placar dos dois lados.'); return; }
    if (scoreA === scoreB) { setError('Empate não define vencedor. Informe o placar final com desempate.'); return; }
    setSaving(true);
    try { await api(`/api/tournament-matches/${match.id}`, { method: 'PATCH', body: JSON.stringify({ scoreA, scoreB }) }); toast.success('Placar registrado'); onSaved(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }
  return <ResponsiveSheet open={Boolean(match)} onOpenChange={(open) => { if (!open) onClose(); }} title="Informar placar" description={match ? `Rodada ${match.round}` : ''}
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={onClose}>Cancelar</Button>
      <Button type="submit" form="score-form" className="h-10" disabled={saving}>{saving && <LoaderCircle className="animate-spin" />}Salvar placar</Button>
    </div>}>
    {match && <form id="score-form" className="space-y-4 px-5 py-4" onSubmit={(event) => void submit(event)}>
      {([[match.player_a, a, setA, 'score-a'], [match.player_b, b, setB, 'score-b']] as const).map(([player, value, set, id]) => <div key={id} className="flex items-center gap-3">
        <Label htmlFor={id} className="min-w-0 flex-1 truncate text-sm">{player}</Label>
        <Input id={id} className="h-11 w-20 text-center text-lg tabular-nums" type="number" min={0} max={999} value={value} onChange={(e) => set(e.target.value)} />
      </div>)}
      <p className="text-[12.5px] text-muted-foreground">O vencedor avança automaticamente para a próxima rodada.</p>
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </form>}
  </ResponsiveSheet>;
}
