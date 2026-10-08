import { useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, CircleCheck, CircleX, Clock, Hourglass, Info, LandPlot, LoaderCircle, MessageCircle, Pause, Pencil, Play, Plus, Receipt, Repeat, Trash2, TrendingUp } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { addMonths, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { Avatar, EmptyState, PageHeader, Panel, Segmented, StatCard } from '@/components/app/page';
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
import { Switch } from '@/components/ui/switch';
import { DatePicker } from '@/components/DatePicker';
import { api } from '@/lib/api';
import { isActiveCourt, todayKey, type Court } from '@/lib/arena';
import { errorMessage, formatCurrency, formatPhone, minutesOfTime, plural, timeOfMinutes } from '@/lib/format';
import { cn } from '@/lib/utils';

type Client = { id: string; name: string; phone: string | null };
type Slot = { id?: string; court_id: string; court_name?: string; weekday: number; start_time: string; duration_minutes: number };
/** Falta ("skip") ou remarcação ("move") de uma data só do horário fixo. */
type Exception = { id: string; slot_id: string; day: string; kind: 'skip' | 'move'; new_day: string | null; new_start_time: string | null; new_duration_minutes: number | null; new_court_id: string | null; new_court_name: string | null; note: string };
type Member = { id: string; clientId: string; client_name: string; phone: string | null; amount_cents: number; due_day: number; auto_charge: boolean; status: 'active' | 'paused' | 'ended'; created_at: string; slots: Slot[]; exceptions: Exception[] };
type DayTarget = { member: Member; slot: Slot; day: string };
type Charge = { id: string; memberId: string; client_name: string; court_name: string; cycle: string; amount_cents: number; due_date: string; paid_at: string | null };

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const everyDay = (weekday: number) => weekday === 0 || weekday === 6 ? `Todo ${DAYS[weekday].toLowerCase()}` : `Toda ${DAYS[weekday].toLowerCase()}-feira`;
const MEMBER: Record<Member['status'], { label: string; tone: Tone }> = { active: { label: 'Ativo', tone: 'green' }, paused: { label: 'Pausado', tone: 'gray' }, ended: { label: 'Encerrado', tone: 'rose' } };
const cycleOf = (date: Date) => format(date, 'yyyy-MM');
const monthDate = (cycle: string) => parseISO(`${cycle}-01T12:00:00`);
const monthLabel = (cycle: string, pattern = "MMMM 'de' yyyy") => format(monthDate(cycle), pattern, { locale: ptBR });

/** Datas (AAAA-MM-DD) do mês que caem no dia da semana. */
function datesIn(cycle: string, weekday: number) {
  const out: string[] = [];
  const d = monthDate(cycle);
  for (let day = 1; day <= 31; day += 1) {
    const current = new Date(d.getFullYear(), d.getMonth(), day, 12);
    if (current.getMonth() !== d.getMonth()) break;
    if (current.getDay() === weekday) out.push(format(current, 'yyyy-MM-dd'));
  }
  return out;
}
/** Todas as datas do mês em que o plano joga (um plano pode ter vários dias da semana). */
const gamesIn = (cycle: string, slots: Array<Pick<Slot, 'weekday'>>) => slots.flatMap((s) => datesIn(cycle, s.weekday)).sort();
/** Cada data do mês com o horário fixo correspondente. */
const occurrencesIn = (cycle: string, slots: Slot[]) => slots.flatMap((slot) => datesIn(cycle, slot.weekday).map((day) => ({ day, slot }))).sort((a, b) => a.day.localeCompare(b.day) || a.slot.start_time.localeCompare(b.slot.start_time));
const dm = (day: string) => `${day.slice(8)}/${day.slice(5, 7)}`;
const chargeStatus = (charge: Charge): { label: string; tone: Tone } => charge.paid_at ? { label: 'Pago', tone: 'green' } : charge.due_date < todayKey() ? { label: 'Atrasada', tone: 'rose' } : { label: 'Pendente', tone: 'amber' };

type Confirm = { title: string; text: string; action: string; danger?: boolean; run: () => Promise<void> } | null;

export function MonthlyMembersPage() {
  const [cycle, setCycle] = useState(cycleOf(new Date()));
  const [members, setMembers] = useState<Member[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const isAdmin = useAuth().user?.role === 'arena_admin';
  const navigate = useNavigate();
  const [showEnded, setShowEnded] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [dayTarget, setDayTarget] = useState<DayTarget | null>(null);
  // Vindo da agenda ("Faltar ou remarcar este dia"): abre o mês da data e, depois de carregar, o diálogo do dia.
  const [search, setSearch] = useSearchParams();
  const linkSlot = search.get('horario'), linkDay = search.get('dia');
  useEffect(() => { if (linkDay && /^\d{4}-\d{2}-\d{2}$/.test(linkDay)) setCycle(linkDay.slice(0, 7)); }, [linkDay]);
  useEffect(() => {
    if (!linkSlot || !linkDay || loading || cycle !== linkDay.slice(0, 7)) return;
    const member = members.find((m) => m.slots.some((s) => s.id === linkSlot));
    const slot = member?.slots.find((s) => s.id === linkSlot);
    if (member && slot) setDayTarget({ member, slot, day: linkDay });
    setSearch({}, { replace: true });
  }, [linkSlot, linkDay, loading, members, cycle]);

  // A Recepção só consulta mensalistas; para ela o "+" abre uma nova reserva.
  usePrimaryAction(() => isAdmin ? setFormOpen(true) : navigate('/reservas?nova=1'));

  async function load() {
    setLoading(true); setError('');
    try {
      const [memberData, courtData, clientData] = await Promise.all([
        api<{ members: Member[]; charges: Charge[] }>(`/api/monthly-members?cycle=${cycle}`),
        api<{ courts: Court[] }>('/api/courts'),
        api<{ clients: Client[] }>('/api/clients'),
      ]);
      setMembers(memberData.members); setCharges(memberData.charges); setCourts(courtData.courts); setClients(clientData.clients);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [cycle]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); toast.success(label); await load(); }
    catch (cause) { toast.error(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  const setStatus = (member: Member, status: Member['status'], label: string) => run(label, () => api(`/api/monthly-members/${member.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }));

  const active = members.filter((m) => m.status === 'active');
  const paused = members.filter((m) => m.status === 'paused');
  const ended = members.filter((m) => m.status === 'ended');
  const visible = members.filter((m) => m.status !== 'ended' || showEnded);
  const paid = charges.filter((c) => c.paid_at), open = charges.filter((c) => !c.paid_at);
  const late = open.some((c) => c.due_date < todayKey());
  const sum = (list: Array<{ amount_cents: number }>) => list.reduce((total, item) => total + item.amount_cents, 0);

  return <div className="space-y-4 lg:space-y-5">
    <PageHeader title="Mensalistas" description="Horários fixos toda semana e cobranças mensais."
      actions={<>
        <div className="inline-flex flex-1 items-center rounded-md border bg-card shadow-xs md:flex-none">
          <button type="button" onClick={() => setCycle(cycleOf(addMonths(monthDate(cycle), -1)))} aria-label="Mês anterior" className="grid size-10 place-items-center rounded-l-md hover:bg-muted md:size-9"><ChevronLeft className="size-4" aria-hidden="true" /></button>
          <span className="flex h-10 flex-1 items-center justify-center gap-2 border-x px-4 font-medium whitespace-nowrap md:h-9" aria-live="polite"><CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" /><span className="first-letter:uppercase">{monthLabel(cycle)}</span></span>
          <button type="button" onClick={() => setCycle(cycleOf(addMonths(monthDate(cycle), 1)))} aria-label="Próximo mês" className="grid size-10 place-items-center rounded-r-md hover:bg-muted md:size-9"><ChevronRight className="size-4" aria-hidden="true" /></button>
        </div>
        {isAdmin && <Button className="hidden md:inline-flex" onClick={() => setFormOpen(true)}><Plus /> Novo mensalista</Button>}
      </>} />
    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    {loading && !members.length && !error ? <div className="grid min-h-60 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div> : <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard label="Mensalistas ativos" icon={Repeat} value={active.length} sub={plural(paused.length, 'pausado', 'pausados')} />
        <StatCard label="Receita recorrente" icon={TrendingUp} value={formatCurrency(sum(active))} sub="por mês, dos ativos" />
        <StatCard label="Recebido no mês" icon={CircleCheck} value={formatCurrency(sum(paid))} sub={`${paid.length} de ${plural(charges.length, 'cobrança paga', 'cobranças pagas')}`} />
        <StatCard label="Em aberto" icon={Hourglass} tone={open.length ? (late ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600') : undefined} value={formatCurrency(sum(open))} sub={late ? 'há cobranças atrasadas' : open.length ? 'nenhuma atrasada' : 'tudo recebido'} />
      </section>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-4 lg:px-5">
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold">Planos recorrentes <span className="ml-1 rounded-full bg-muted px-2 py-0.5 align-middle text-[11px] font-semibold text-muted-foreground">{active.length + paused.length}</span></h2>
          {ended.length > 0 && <Button variant="ghost" size="sm" onClick={() => setShowEnded((v) => !v)} aria-pressed={showEnded} aria-label={showEnded ? 'Ocultar encerrados' : `Mostrar encerrados (${ended.length})`}>{showEnded ? 'Ocultar encerrados' : <><span className="sm:hidden">Encerrados ({ended.length})</span><span className="hidden sm:inline">Mostrar encerrados ({ended.length})</span></>}</Button>}
        </div>
        {visible.length ? <ul className="divide-y">{visible.map((m) => <PlanRow key={m.id} member={m} cycle={cycle} busy={busy} isAdmin={isAdmin} onEdit={() => setEditingMember(m)} onDay={(slot, day) => setDayTarget({ member: m, slot, day })}
          onPause={() => void setStatus(m, m.status === 'active' ? 'paused' : 'active', m.status === 'active' ? 'Plano pausado — horários liberados na agenda' : 'Plano retomado')}
          onEnd={() => setConfirm({ title: `Encerrar o plano de ${m.client_name}?`, text: 'Os horários futuros são liberados na agenda. As cobranças já pagas continuam no histórico.', action: 'Encerrar plano', danger: true, run: () => setStatus(m, 'ended', 'Plano encerrado') })} />)}</ul>
          : <EmptyState icon={Repeat} title="Nenhum mensalista ainda" text="Cadastre os horários fixos da semana (um ou vários dias). A cobrança do mês é gerada automaticamente." action={isAdmin ? <Button onClick={() => setFormOpen(true)}><Plus /> Novo mensalista</Button> : undefined} />}
      </Panel>

      <Panel>
        <div className="border-b px-4 py-4 lg:px-5">
          <h2 className="text-[15px] font-semibold">Cobranças de {monthLabel(cycle, 'MMMM')}</h2>
          <p className="text-[12.5px] text-muted-foreground">Uma cobrança por plano ativo, no dia de vencimento de cada plano.</p>
        </div>
        {charges.length ? <ul className="divide-y">{charges.map((c) => {
          const st = chargeStatus(c);
          return <li key={c.id} className="flex items-center gap-3 px-4 py-3 lg:px-5">
            <div className={cn('w-12 shrink-0 rounded-lg border py-1 text-center', st.tone === 'rose' ? 'border-rose-200 bg-rose-50' : 'bg-muted')}>
              <div className="text-[10px] text-muted-foreground uppercase">vence</div><div className="leading-tight font-semibold tabular-nums">{c.due_date.slice(8)}/{c.due_date.slice(5, 7)}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{c.client_name} <span className="font-normal text-muted-foreground">· {c.court_name}</span></div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2"><ToneBadge tone={st.tone}>{st.label}</ToneBadge>{c.paid_at && <span className="text-[12px] text-muted-foreground">pago em {format(new Date(c.paid_at), 'dd/MM')}</span>}</div>
            </div>
            <div className="font-semibold tabular-nums">{formatCurrency(c.amount_cents)}</div>
            {!c.paid_at && isAdmin && <Button disabled={busy} aria-label={`Marcar pago: ${c.client_name}`} onClick={() => setConfirm({ title: 'Registrar pagamento?', text: `${c.client_name} · ${formatCurrency(c.amount_cents)}. O valor entra no Financeiro como recebido e não pode ser desfeito por aqui.`, action: 'Marcar pago', run: () => run('Pagamento registrado', () => api(`/api/monthly-charges/${c.id}/paid`, { method: 'PATCH', body: '{}' })) })}>
              <CircleCheck /><span className="hidden sm:inline">Marcar pago</span></Button>}
          </li>;
        })}</ul> : <EmptyState icon={Receipt} title="Nenhuma cobrança neste mês" text={active.length ? 'As cobranças aparecem quando o mês é aberto.' : 'Não há mensalistas ativos para cobrar.'} />}
      </Panel>
    </>}

    <DayDialog target={dayTarget} courts={courts.filter(isActiveCourt)} onClose={() => setDayTarget(null)} onSaved={() => { setDayTarget(null); void load(); }} />
    <MemberSheet open={formOpen || Boolean(editingMember)} member={editingMember} onOpenChange={(open) => { if (!open) { setFormOpen(false); setEditingMember(null); } }} cycle={cycle} courts={courts.filter(isActiveCourt)} clients={clients}
      onClientCreated={(client) => setClients((list) => [...list, client].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))} onSaved={() => { setFormOpen(false); setEditingMember(null); void load(); }} />
    <AlertDialog open={Boolean(confirm)} onOpenChange={(value) => { if (!value) setConfirm(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader className="flex flex-row items-start gap-3 text-left">
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-full', confirm?.danger ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-700')}>{confirm?.danger ? <CircleX className="size-5" aria-hidden="true" /> : <CircleCheck className="size-5" aria-hidden="true" />}</span>
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

function PlanRow({ member: m, cycle, busy, isAdmin, onEdit, onPause, onEnd, onDay }: { member: Member; cycle: string; busy: boolean; isAdmin: boolean; onEdit: () => void; onPause: () => void; onEnd: () => void; onDay: (slot: Slot, day: string) => void }) {
  const dates = occurrencesIn(cycle, m.slots), today = todayKey(), idle = m.status !== 'active';
  return <li className={cn('flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:px-5', idle && 'bg-muted/40')}>
    <div className="flex min-w-0 items-center gap-3 lg:w-64">
      <Avatar name={m.client_name} className="size-10" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate font-medium">{m.client_name}</span><ToneBadge tone={MEMBER[m.status].tone}>{MEMBER[m.status].label}</ToneBadge></div>
        {m.phone && <div className="text-[12px] text-muted-foreground tabular-nums">{formatPhone(m.phone)}</div>}
      </div>
    </div>
    <div className={cn('min-w-0 flex-1', idle && 'opacity-60')}>
      <ul className="space-y-1" aria-label={`Horários de ${m.client_name}`}>{m.slots.map((s) => <li key={s.id ?? `${s.weekday}-${s.start_time}-${s.court_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span className="inline-flex items-center gap-1.5 font-medium"><Repeat className="size-4 text-brand-600" aria-hidden="true" />{everyDay(s.weekday)}</span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground tabular-nums"><Clock className="size-4" aria-hidden="true" />{s.start_time}–{timeOfMinutes(minutesOfTime(s.start_time) + s.duration_minutes)}</span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground"><LandPlot className="size-4" aria-hidden="true" />{s.court_name}</span>
      </li>)}</ul>
      {m.status !== 'ended' && <div className="mt-2 flex flex-wrap gap-1.5">
        {dates.map(({ day: d, slot }) => {
          const past = d < today, isToday = d === today, ex = m.exceptions.find((e) => e.slot_id === slot.id && e.day === d);
          const label = `${DAYS[slot.weekday]} ${dm(d)} às ${slot.start_time} na ${slot.court_name}${ex?.kind === 'skip' ? ': não vem' : ex?.kind === 'move' ? `: remarcado para ${dm(ex.new_day!)} às ${ex.new_start_time}` : ''}`;
          const tone = ex?.kind === 'skip' ? 'border-amber-200 bg-amber-50 text-amber-800' : ex?.kind === 'move' ? 'border-sky-200 bg-sky-50 text-sky-800' : isToday ? 'border-brand-900 bg-brand-900 text-white' : past ? 'border-border bg-muted text-muted-foreground line-through decoration-muted-foreground/40' : 'border-brand-100 bg-white text-brand-700';
          const text = <>{dm(d)}{ex?.kind === 'skip' ? ' · não vem' : ex?.kind === 'move' ? ` → ${dm(ex.new_day!)} ${ex.new_start_time}` : isToday ? ' · hoje' : ''}</>;
          return past || m.status !== 'active'
            ? <span key={`${slot.id}-${d}`} aria-label={label} className={cn('rounded-md border px-2 py-0.5 text-[11.5px] font-medium tabular-nums', tone)}>{text}</span>
            : <button key={`${slot.id}-${d}`} type="button" aria-label={`${label}. Faltar ou remarcar`} title="Faltar ou remarcar este dia" onClick={() => onDay(slot, d)} className={cn('rounded-md border px-2 py-0.5 text-[11.5px] font-medium tabular-nums transition hover:border-brand-500 hover:shadow-xs', tone)}>{text}</button>;
        })}
        <span className="ml-1 self-center text-[11.5px] text-muted-foreground">{plural(dates.length, 'jogo', 'jogos')} · {formatCurrency(dates.length ? m.amount_cents / dates.length : 0)}/jogo{m.status === 'active' && ' · toque numa data para faltar ou remarcar'}</span>
      </div>}
    </div>
    <div className="flex items-center gap-2 lg:justify-end">
      <div className="mr-2 flex-1 lg:flex-none lg:text-right"><div className="font-semibold tabular-nums">{formatCurrency(m.amount_cents)}<span className="text-[12px] font-normal text-muted-foreground">/mês</span></div>
        <div className="text-[11.5px] text-muted-foreground">vence dia {m.due_day}{m.auto_charge && <> · <span className="inline-flex items-center gap-0.5 text-brand-700"><MessageCircle className="size-3" aria-hidden="true" />cobra no WhatsApp</span></>}</div></div>
      {m.status !== 'ended' && isAdmin && <>
        <Button variant="outline" size="icon" disabled={busy} aria-label={`Editar plano de ${m.client_name}`} title="Editar" onClick={onEdit}><Pencil /></Button>
        <Button variant="outline" disabled={busy} onClick={onPause}>{m.status === 'active' ? <><Pause />Pausar</> : <><Play />Retomar</>}</Button>
        <Button variant="outline" size="icon" disabled={busy} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" aria-label={`Encerrar plano de ${m.client_name}`} title="Encerrar" onClick={onEnd}><CircleX /></Button>
      </>}
    </div>
  </li>;
}

const TIMES = Array.from({ length: 36 }, (_, i) => 360 + i * 30); // 06:00 → 23:30
const DUE_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
type SlotDraft = { key: number; courtId: string; weekday: number; start: number; end: number };
let slotKey = 0;
const newSlot = (courtId: string, weekday = 1, start = 19 * 60, end = 20 * 60): SlotDraft => ({ key: ++slotKey, courtId, weekday, start, end });

function MemberSheet({ open, member, onOpenChange, cycle, courts, clients, onClientCreated, onSaved }: { open: boolean; member: Member | null; onOpenChange: (open: boolean) => void; cycle: string; courts: Court[]; clients: Client[]; onClientCreated: (client: Client) => void; onSaved: () => void }) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState(5);
  const [autoCharge, setAutoCharge] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode(clients.length ? 'existing' : 'new'); setClientId(''); setClientName(''); setClientPhone('');
    if (member) {
      setSlots(member.slots.map((s) => { const start = minutesOfTime(s.start_time); return newSlot(s.court_id, s.weekday, start, start + s.duration_minutes); }));
      setAmount((member.amount_cents / 100).toFixed(2).replace('.', ',')); setDueDay(member.due_day); setAutoCharge(member.auto_charge);
    } else { setSlots([newSlot(courts[0]?.id || '')]); setAmount(''); setDueDay(new Date().getDate()); setAutoCharge(false); }
    setError('');
  }, [open, member]);

  const patchSlot = (key: number, patch: Partial<SlotDraft>) => setSlots((list) => list.map((s) => {
    if (s.key !== key) return s;
    const next = { ...s, ...patch };
    if (next.end <= next.start || next.end - next.start > 480) next.end = next.start + 60;
    return next;
  }));
  const games = gamesIn(cycle, slots).length;
  const cents = Math.round(Number(amount.replace(/\./g, '').replace(',', '.')) * 100) || 0;
  const phone = member ? member.phone : mode === 'existing' ? clients.find((c) => c.id === clientId)?.phone ?? null : clientPhone.replace(/\D/g, '') || null;

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    setSaving(true);
    const plan = { slots: slots.map((s) => ({ courtId: s.courtId, weekday: s.weekday, startTime: timeOfMinutes(s.start), durationMinutes: s.end - s.start })), amountCents: cents, dueDay, autoCharge: autoCharge && Boolean(phone) };
    try {
      if (member) {
        await api(`/api/monthly-members/${member.id}`, { method: 'PATCH', body: JSON.stringify(plan) });
        toast.success('Plano atualizado');
        onSaved(); return;
      }
      let id = clientId;
      if (mode === 'new') {
        const created = await api<{ client: Client }>('/api/clients', { method: 'POST', body: JSON.stringify({ name: clientName.trim(), phone: clientPhone }) });
        onClientCreated(created.client); id = created.client.id; setMode('existing'); setClientId(id);
      }
      await api('/api/monthly-members', { method: 'POST', body: JSON.stringify({ clientId: id, ...plan }) });
      toast.success('Mensalista cadastrado');
      onSaved();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }

  const ready = (member ? true : mode === 'existing' ? Boolean(clientId) : clientName.trim().length >= 2) && slots.length > 0 && slots.every((s) => s.courtId) && cents > 0;
  return <ResponsiveSheet open={open} onOpenChange={onOpenChange} title={member ? 'Editar plano' : 'Novo mensalista'} description={member ? member.client_name : 'Horários fixos toda semana, com uma cobrança mensal.'}
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Cancelar</Button>
      <Button type="submit" form="member-form" className="h-10" disabled={saving || !ready}>{saving && <LoaderCircle className="animate-spin" />}{member ? 'Salvar alterações' : 'Cadastrar mensalista'}</Button>
    </div>}>
    <form id="member-form" className="space-y-4 px-5 py-4" onSubmit={(event) => void submit(event)}>
      {member ? <p className="rounded-md bg-muted/70 px-3 py-2.5 text-[12.5px] text-muted-foreground">A alteração vale a partir de agora. Cobranças já geradas não mudam de valor.</p> : <div className="grid gap-1.5">
        <Label>Cliente</Label>
        <Segmented label="Tipo de cliente" value={mode} onChange={setMode} className="grid w-full grid-cols-2" options={[{ value: 'existing', label: 'Já cadastrado' }, { value: 'new', label: 'Novo cliente' }]} />
        {mode === 'existing'
          ? <Select value={clientId} onValueChange={setClientId}><SelectTrigger className="h-10 w-full" aria-label="Cliente"><SelectValue placeholder={clients.length ? 'Selecione o cliente' : 'Nenhum cliente cadastrado'} /></SelectTrigger><SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${formatPhone(c.phone)}` : ''}</SelectItem>)}</SelectContent></Select>
          : <div className="grid gap-3 rounded-lg border p-3">
            <div className="grid gap-1.5"><Label htmlFor="member-name">Nome</Label><Input id="member-name" className="h-10" maxLength={100} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nome do cliente" /></div>
            <div className="grid gap-1.5"><Label htmlFor="member-phone">WhatsApp <span className="font-normal text-muted-foreground">(opcional)</span></Label><Input id="member-phone" className="h-10" type="tel" inputMode="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} onBlur={() => setClientPhone(formatPhone(clientPhone))} placeholder="(00) 00000-0000" /></div>
          </div>}
      </div>}
      <fieldset className="grid gap-2"><legend className="mb-1 text-sm font-medium">Horários fixos</legend>
        {slots.map((slot, index) => <div key={slot.key} className="grid gap-2.5 rounded-lg border p-3" role="group" aria-label={`Horário ${index + 1}`}>
          <div className="flex items-center gap-2">
            <Select value={slot.courtId} onValueChange={(v) => patchSlot(slot.key, { courtId: v })}><SelectTrigger className="h-10 min-w-0 flex-1" aria-label={`Quadra do horário ${index + 1}`}><SelectValue placeholder="Selecione a quadra" /></SelectTrigger><SelectContent>{courts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.sport}</SelectItem>)}</SelectContent></Select>
            {slots.length > 1 && <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-rose-600" aria-label={`Remover horário ${index + 1}`} onClick={() => setSlots((list) => list.filter((s) => s.key !== slot.key))}><Trash2 /></Button>}
          </div>
          <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label={`Dia da semana do horário ${index + 1}`}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <button key={d} type="button" role="radio" aria-checked={slot.weekday === d} aria-label={DAYS[d]} onClick={() => patchSlot(slot.key, { weekday: d })}
              className={cn('grid h-9 place-items-center rounded-md border text-[12.5px] font-medium transition', slot.weekday === d ? 'border-brand-900 bg-brand-900 text-white' : 'hover:bg-muted')}>{DAYS[d].slice(0, 3)}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={String(slot.start)} onValueChange={(v) => patchSlot(slot.key, { start: Number(v) })}><SelectTrigger className="h-10 w-full tabular-nums" aria-label={`Início do horário ${index + 1}`}><SelectValue /></SelectTrigger><SelectContent>{TIMES.map((t) => <SelectItem key={t} value={String(t)}>{timeOfMinutes(t)}</SelectItem>)}</SelectContent></Select>
            <Select value={String(slot.end)} onValueChange={(v) => patchSlot(slot.key, { end: Number(v) })}><SelectTrigger className="h-10 w-full tabular-nums" aria-label={`Fim do horário ${index + 1}`}><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 15 }, (_, i) => slot.start + 60 + i * 30).filter((t) => t <= 24 * 60).map((t) => <SelectItem key={t} value={String(t)}>{timeOfMinutes(t)}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>)}
        {slots.length < 14 && <Button type="button" variant="outline" className="h-10" onClick={() => setSlots((list) => [...list, newSlot(list.at(-1)?.courtId || courts[0]?.id || '', ((list.at(-1)?.weekday ?? 0) + 1) % 7, list.at(-1)?.start, list.at(-1)?.end)])}><Plus /> Adicionar outro dia</Button>}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label htmlFor="member-amount">Valor mensal</Label>
          <div className="relative"><span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">R$</span><Input id="member-amount" className="h-10 pl-9 tabular-nums" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div></div>
        <div className="grid gap-1.5"><Label>Vence todo dia</Label>
          <Select value={String(dueDay)} onValueChange={(v) => setDueDay(Number(v))}><SelectTrigger className="h-10 w-full tabular-nums" aria-label="Dia de vencimento"><SelectValue /></SelectTrigger><SelectContent>{DUE_DAYS.map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <label className={cn('flex items-start justify-between gap-3 rounded-lg border p-3', phone ? 'cursor-pointer' : 'opacity-60')}>
        <span><span className="block text-sm font-medium">Cobrar automaticamente no WhatsApp</span>
          <span className="block text-[12px] text-muted-foreground">{phone ? `No dia ${dueDay}, às 9h, o cliente recebe a mensagem com o valor. O texto fica em WhatsApp → Serviços.` : 'Cadastre o WhatsApp do cliente para ligar a cobrança automática.'}</span></span>
        <Switch checked={autoCharge && Boolean(phone)} disabled={!phone} onCheckedChange={setAutoCharge} aria-label="Cobrar automaticamente no WhatsApp" />
      </label>
      <div className="flex gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5 text-[12.5px] text-brand-800">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>Em <b>{monthLabel(cycle, 'MMMM')}</b> são <b>{plural(games, 'jogo', 'jogos')}</b>{cents > 0 && games > 0 ? <> — {formatCurrency(Math.round(cents / games))} por jogo</> : null}. Os horários ficam reservados na agenda e a cobrança vence todo dia {dueDay}{dueDay > 28 ? ' (ou no último dia do mês)' : ''}.</span>
      </div>
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </form>
  </ResponsiveSheet>;
}

/** Uma data do horário fixo: "não vem" (libera o horário) ou "remarcar só este dia"; com alteração, mostra e permite desfazer. */
function DayDialog({ target, courts, onClose, onSaved }: { target: DayTarget | null; courts: Court[]; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<'skip' | 'move'>('skip');
  const [newDay, setNewDay] = useState('');
  const [courtId, setCourtId] = useState('');
  const [start, setStart] = useState(19 * 60);
  const [end, setEnd] = useState(20 * 60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ex = target ? target.member.exceptions.find((e) => e.slot_id === target.slot.id && e.day === target.day) : undefined;
  useEffect(() => {
    if (!target) return;
    const s = minutesOfTime(target.slot.start_time);
    setMode('skip'); setNewDay(target.day); setCourtId(target.slot.court_id); setStart(s); setEnd(s + target.slot.duration_minutes); setError('');
  }, [target]);
  useEffect(() => { if (end <= start || end - start > 480) setEnd(start + (target?.slot.duration_minutes ?? 60)); }, [start, end]);
  if (!target) return null;
  const { member, slot, day } = target, when = `${DAYS[slot.weekday]}, ${dm(day)} · ${slot.start_time}–${timeOfMinutes(minutesOfTime(slot.start_time) + slot.duration_minutes)} · ${slot.court_name}`;
  async function save() {
    setSaving(true); setError('');
    try {
      if (ex) { await api(`/api/monthly-members/${member.id}/exceptions/${ex.id}`, { method: 'DELETE' }); toast.success('Horário fixo de volta neste dia'); }
      else {
        await api(`/api/monthly-members/${member.id}/exceptions`, { method: 'POST', body: JSON.stringify(mode === 'skip' ? { slotId: slot.id, day, kind: 'skip' } : { slotId: slot.id, day, kind: 'move', newDay, courtId, startTime: timeOfMinutes(start), durationMinutes: end - start }) });
        toast.success(mode === 'skip' ? 'Horário liberado só neste dia' : 'Jogo remarcado só nesta semana');
      }
      onSaved();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }
  return <ResponsiveSheet open onOpenChange={(open) => { if (!open) onClose(); }} title={member.client_name} description={when}
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={onClose}>Voltar</Button>
      <Button type="button" className="h-10" disabled={saving || (!ex && mode === 'move' && !newDay)} onClick={() => void save()}>{saving && <LoaderCircle className="animate-spin" />}{ex ? 'Desfazer alteração' : mode === 'skip' ? 'Liberar este dia' : 'Remarcar'}</Button>
    </div>}>
    <div className="space-y-4 px-5 py-4">
      {ex ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
        {ex.kind === 'skip' ? <>Marcado como <b>não vem</b> neste dia. O horário está livre para outras reservas.</> : <>Remarcado para <b>{DAYS[new Date(`${ex.new_day}T12:00:00`).getDay()].toLowerCase()}, {dm(ex.new_day!)}, {ex.new_start_time}–{timeOfMinutes(minutesOfTime(ex.new_start_time!) + ex.new_duration_minutes!)}</b> na {ex.new_court_name}.</>}
        <span className="mt-1 block text-[12px]">Desfazer devolve o horário fixo deste dia (se ainda estiver livre).</span></p>
        : <>
          <Segmented label="O que aconteceu" value={mode} onChange={setMode} className="grid w-full grid-cols-2" options={[{ value: 'skip', label: 'Não vem neste dia' }, { value: 'move', label: 'Remarcar só este dia' }]} />
          {mode === 'skip' ? <p className="text-[13px] text-muted-foreground">O horário fica livre só em {dm(day)} para outras reservas (agenda, página e WhatsApp). As outras semanas continuam iguais e a mensalidade não muda.</p>
            : <div className="grid gap-3">
              <div className="grid gap-1.5"><Label>Nova data</Label><DatePicker value={newDay} onChange={setNewDay} label="Nova data" className="h-10 w-full" /></div>
              <div className="grid gap-1.5"><Label>Quadra</Label><Select value={courtId} onValueChange={setCourtId}><SelectTrigger className="h-10 w-full" aria-label="Quadra da remarcação"><SelectValue /></SelectTrigger><SelectContent>{courts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.sport}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5"><Label>Início</Label><Select value={String(start)} onValueChange={(v) => setStart(Number(v))}><SelectTrigger className="h-10 w-full tabular-nums" aria-label="Início da remarcação"><SelectValue /></SelectTrigger><SelectContent>{TIMES.map((t) => <SelectItem key={t} value={String(t)}>{timeOfMinutes(t)}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid gap-1.5"><Label>Fim</Label><Select value={String(end)} onValueChange={(v) => setEnd(Number(v))}><SelectTrigger className="h-10 w-full tabular-nums" aria-label="Fim da remarcação"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 15 }, (_, i) => start + 60 + i * 30).filter((t) => t <= 24 * 60).map((t) => <SelectItem key={t} value={String(t)}>{timeOfMinutes(t)}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <p className="text-[12.5px] text-muted-foreground">Só esta semana muda: {dm(day)} fica livre e o novo horário fica reservado para {member.client_name}.</p>
            </div>}
        </>}
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </div>
  </ResponsiveSheet>;
}
