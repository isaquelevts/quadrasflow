import { useEffect, useMemo, useState, type ComponentType, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarCheck, Check, CircleDot, CupSoda, Download, Droplet, Hourglass, LoaderCircle, Package, Plus, Receipt, Repeat, Scale, Trash2, Trophy, Undo2, Users, Wrench, Zap, type LucideProps } from 'lucide-react';
import { endOfMonth, format, startOfMonth, subDays, subMonths } from 'date-fns';
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { DatePicker } from '@/components/DatePicker';
import { EmptyState, PageHeader, Panel, Segmented, StatCard } from '@/components/app/page';
import { ResponsiveSheet } from '@/components/app/ResponsiveSheet';
import { usePrimaryAction } from '@/components/app/shell-context';
import { ToneBadge, type Tone } from '@/components/app/status';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { fmtDate, todayKey } from '@/lib/arena';
import { errorMessage, formatCurrency, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

type Kind = 'income' | 'expense';
type Entry = { id: string; kind: Kind; category: string; description: string; amount_cents: number; due_date: string; paid_at: string | null; booking_id: string | null; monthly_charge_id: string | null; tournament_entry_id: string | null; created_at: string };
type Summary = { income_paid: number; expense_paid: number; income_due: number; expense_due: number; result: number };
type Preset = 'month' | 'last' | '7' | '30' | '';

const CATS: Record<Kind, string[]> = {
  income: ['Reservas', 'Mensalistas', 'Torneios', 'Bar e loja', 'Outros'],
  expense: ['Manutenção', 'Energia', 'Água', 'Funcionários', 'Materiais', 'Outros'],
};
const CAT_ICON: Record<string, ComponentType<LucideProps>> = { Reservas: CalendarCheck, Mensalistas: Repeat, Torneios: Trophy, 'Bar e loja': CupSoda, Manutenção: Wrench, Energia: Zap, Água: Droplet, Funcionários: Users, Materiais: Package };
const CAT_COLORS = ['bg-brand-500', 'bg-lime-400', 'bg-sky-400', 'bg-amber-400', 'bg-gray-400', 'bg-rose-400'];
const key = (d: Date) => format(d, 'yyyy-MM-dd');
const PRESETS: Array<{ value: Exclude<Preset, ''>; label: string; range: () => [string, string] }> = [
  { value: 'month', label: 'Este mês', range: () => [key(startOfMonth(new Date())), todayKey()] },
  { value: 'last', label: 'Mês passado', range: () => { const last = subMonths(new Date(), 1); return [key(startOfMonth(last)), key(endOfMonth(last))]; } },
  { value: '7', label: '7 dias', range: () => [key(subDays(new Date(), 6)), todayKey()] },
  { value: '30', label: '30 dias', range: () => [key(subDays(new Date(), 29)), todayKey()] },
];
const statusOf = (e: Entry): { label: string; tone: Tone } => e.paid_at ? { label: 'Pago', tone: 'green' } : e.due_date < todayKey() ? { label: 'Atrasado', tone: 'rose' } : { label: 'Em aberto', tone: 'amber' };
const automatic = (e: Entry) => Boolean(e.booking_id || e.monthly_charge_id || e.tournament_entry_id);
/** Título legível: "Reserva 494f2f92-…" vira "Pagamento de reserva" com a referência curta embaixo. */
function titleOf(e: Entry) {
  if (e.booking_id) return { title: /^reserva [0-9a-f-]{20,}$/i.test(e.description) ? 'Pagamento de reserva' : e.description, ref: `#${e.booking_id.slice(0, 8)}`, full: e.booking_id };
  if (e.monthly_charge_id) return { title: e.description.replace(/^Mensalidade (\d{4})-(\d{2})$/, (_, y, m) => `Mensalidade de ${fmtDate(`${y}-${m}-01`, 'MMMM')}/${y}`), ref: 'Mensalista', full: '' };
  if (e.tournament_entry_id) return { title: e.description, ref: 'Inscrição em torneio', full: '' };
  return { title: e.description, ref: 'Lançamento manual', full: '' };
}
const chartConfig = { realized: { label: 'Realizado', color: 'var(--color-brand-500)' } } satisfies ChartConfig;

export function FinancePage() {
  const [preset, setPreset] = useState<Preset>('month');
  const [[from, to], setRange] = useState<[string, string]>(PRESETS[0].range());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [summary, setSummary] = useState<Summary>({ income_paid: 0, expense_paid: 0, income_due: 0, expense_due: 0, result: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'all' | 'income' | 'expense' | 'open'>('all');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);

  usePrimaryAction(() => setCreating(true));

  async function load() {
    setLoading(true); setError('');
    try { const d = await api<{ entries: Entry[]; summary: Summary }>(`/api/finance?from=${from}&to=${to}`); setEntries(d.entries); setSummary(d.summary); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [from, to]);

  function setDates(nextFrom: string, nextTo: string) { setPreset(''); setRange(nextFrom > nextTo ? [nextTo, nextFrom] : [nextFrom, nextTo]); }
  async function togglePaid(e: Entry) {
    setBusy(true);
    try { await api(`/api/finance/${e.id}/paid`, { method: 'PATCH', body: JSON.stringify({ paid: !e.paid_at }) }); toast.success(e.paid_at ? 'Voltou para em aberto' : e.kind === 'income' ? 'Marcado como recebido' : 'Marcado como pago'); await load(); }
    catch (cause) { toast.error(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  function exportCsv() {
    const rows = [['Vencimento', 'Tipo', 'Categoria', 'Descrição', 'Referência', 'Status', 'Valor (R$)'], ...entries.map((e) => { const t = titleOf(e); return [e.due_date.split('-').reverse().join('/'), e.kind === 'income' ? 'Entrada' : 'Despesa', e.category, t.title, t.full || t.ref, statusOf(e).label, `${e.kind === 'income' ? '' : '-'}${(e.amount_cents / 100).toFixed(2).replace('.', ',')}`]; })];
    const csv = '﻿' + rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `financeiro-${from}-a-${to}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const count = (list: Entry[], fn: (e: Entry) => boolean) => list.filter(fn).length;
  const visible = entries.filter((e) => tab === 'all' || (tab === 'open' ? !e.paid_at : e.kind === tab));
  const forecast = summary.result + summary.income_due - summary.expense_due;

  return <div className="space-y-4 lg:space-y-5">
    <PageHeader title="Financeiro" description="Entradas, despesas e o resultado do período."
      actions={<>
        <Button variant="outline" onClick={exportCsv} disabled={!entries.length}><Download />Exportar CSV</Button>
        <Button className="hidden md:inline-flex" onClick={() => setCreating(true)}><Plus /> Lançamento</Button>
      </>} />

    <section className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="scrollbar-none -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <Segmented label="Período" value={preset as Exclude<Preset, ''>} onChange={(value) => { setPreset(value); setRange(PRESETS.find((p) => p.value === value)!.range()); }} options={PRESETS.map((p) => ({ value: p.value, label: p.label }))} />
      </div>
      <div className="grid grid-cols-2 items-center gap-2 lg:flex">
        <DatePicker className="h-9 w-full lg:w-auto" value={from} onChange={(value) => setDates(value, to)} label="Data inicial" />
        <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground lg:block" aria-hidden="true" />
        <DatePicker className="h-9 w-full lg:w-auto" value={to} onChange={(value) => setDates(from, value)} label="Data final" />
      </div>
    </section>
    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <StatCard label="Receitas recebidas" icon={ArrowDownLeft} value={formatCurrency(summary.income_paid)} sub={plural(count(entries, (e) => e.kind === 'income' && Boolean(e.paid_at)), 'lançamento pago', 'lançamentos pagos')} />
      <StatCard label="Despesas pagas" icon={ArrowUpRight} tone="bg-rose-50 text-rose-600" value={formatCurrency(summary.expense_paid)} sub={summary.expense_due ? `${formatCurrency(summary.expense_due)} a pagar` : 'nada a pagar'} />
      <StatCard label="A receber" icon={Hourglass} tone={summary.income_due ? 'bg-amber-50 text-amber-600' : undefined} value={formatCurrency(summary.income_due)} sub={`${count(entries, (e) => e.kind === 'income' && !e.paid_at)} em aberto`} />
      <div className="relative overflow-hidden rounded-xl bg-brand-900 p-4 text-white shadow-card lg:p-5">
        <div aria-hidden="true" className="absolute -top-6 -right-6 size-24 rounded-full bg-lime-400/10" />
        <div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium text-white/70 lg:text-[13px]">Resultado realizado</span><span className="grid size-8 place-items-center rounded-lg bg-white/10 text-lime-400"><Scale className="size-4" aria-hidden="true" /></span></div>
        <div className={cn('mt-2 text-[22px] font-semibold tracking-tight tabular-nums lg:text-[26px]', summary.result < 0 ? 'text-rose-300' : 'text-lime-400')}>{formatCurrency(summary.result)}</div>
        <div className="mt-0.5 text-[11.5px] text-white/60 lg:text-[12.5px]">previsto com abertos: {formatCurrency(forecast)}</div>
      </div>
    </section>

    <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Panel className="xl:col-span-2"><ResultChart entries={entries} from={from} to={to} forecast={forecast} /></Panel>
      <Panel><Categories entries={entries} /></Panel>
    </section>

    <Panel>
      <div className="space-y-3 px-4 pt-4 lg:px-5">
        <h2 className="text-[15px] font-semibold">Lançamentos</h2>
        <div className="scrollbar-none -mx-4 overflow-x-auto border-b px-4 lg:-mx-5 lg:px-5">
          <div role="tablist" aria-label="Tipo de lançamento" className="flex gap-5 whitespace-nowrap">
            {([['all', 'Todos', entries.length], ['income', 'Entradas', count(entries, (e) => e.kind === 'income')], ['expense', 'Despesas', count(entries, (e) => e.kind === 'expense')], ['open', 'Em aberto', count(entries, (e) => !e.paid_at)]] as const).map(([value, label, n]) => {
              const on = tab === value;
              return <button key={value} type="button" role="tab" aria-selected={on} onClick={() => setTab(value)} className={cn('relative flex items-center gap-2 pt-1 pb-3 font-medium transition', on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {label}<span className={cn('min-w-5 rounded-full px-1.5 text-[11px]', on ? 'bg-brand-900 text-white' : 'bg-muted')}>{n}</span>
                {on && <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand-900" />}
              </button>;
            })}
          </div>
        </div>
      </div>
      {loading && !entries.length ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div>
        : !visible.length ? <EmptyState icon={Receipt} title="Nenhum lançamento no período" text="Ajuste as datas ou registre uma entrada ou despesa." action={<Button onClick={() => setCreating(true)}><Plus /> Lançamento</Button>} />
        : <>
          <div className="hidden lg:block"><table className="w-full text-left">
            <thead><tr className="border-b bg-muted/50 text-[12px] text-muted-foreground"><th className="px-5 py-2.5 font-medium">Descrição</th><th className="px-3 py-2.5 font-medium">Categoria</th><th className="px-3 py-2.5 font-medium">Vencimento</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-3 py-2.5 text-right font-medium">Valor</th><th className="px-5 py-2.5 text-right font-medium"><span className="sr-only">Ações</span></th></tr></thead>
            <tbody className="divide-y">{visible.map((e) => { const t = titleOf(e), st = statusOf(e); return <tr key={e.id} className="transition hover:bg-muted/50">
              <td className="px-5 py-3"><div className="flex items-center gap-3"><EntryIcon entry={e} /><div className="min-w-0"><div className="font-medium">{t.title}</div><div className="max-w-[260px] truncate text-[12px] text-muted-foreground" title={t.full || undefined}>{t.ref}</div></div></div></td>
              <td className="px-3 py-3"><ToneBadge tone="gray" dot={false}>{e.category}</ToneBadge></td>
              <td className="px-3 py-3 tabular-nums">{e.due_date.split('-').reverse().join('/')}</td>
              <td className="px-3 py-3"><ToneBadge tone={st.tone}>{st.label}</ToneBadge></td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums"><Signed entry={e} /></td>
              <td className="px-5 py-3"><div className="flex justify-end gap-1.5">
                {e.paid_at ? <Button variant="outline" disabled={busy} className="text-muted-foreground" onClick={() => void togglePaid(e)}><Undo2 />Desfazer</Button> : <Button disabled={busy} onClick={() => void togglePaid(e)}><Check />{e.kind === 'income' ? 'Recebido' : 'Pago'}</Button>}
                {!automatic(e) && <Button variant="outline" size="icon" disabled={busy} className="text-muted-foreground hover:text-rose-600" aria-label={`Excluir ${t.title}`} title="Excluir" onClick={() => setRemoving(e)}><Trash2 /></Button>}
              </div></td>
            </tr>; })}</tbody>
          </table></div>
          <ul className="divide-y lg:hidden">{visible.map((e) => { const t = titleOf(e), st = statusOf(e); return <li key={e.id} className="flex items-start gap-3 px-4 py-3.5">
            <EntryIcon entry={e} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2"><span className="font-medium">{t.title}</span><span className="shrink-0 font-semibold tabular-nums"><Signed entry={e} /></span></div>
              <div className="truncate text-[12px] text-muted-foreground">{e.category} · {t.ref}</div>
              <div className="mt-2 flex items-center gap-2"><ToneBadge tone={st.tone}>{st.label}</ToneBadge><span className="text-[12px] text-muted-foreground tabular-nums">vence {e.due_date.slice(8)}/{e.due_date.slice(5, 7)}</span>
                <span className="ml-auto flex gap-1.5">
                  {e.paid_at ? <Button variant="outline" size="icon" disabled={busy} aria-label={`Desfazer pagamento de ${t.title}`} onClick={() => void togglePaid(e)}><Undo2 /></Button> : <Button size="sm" disabled={busy} onClick={() => void togglePaid(e)}><Check />{e.kind === 'income' ? 'Recebido' : 'Pago'}</Button>}
                  {!automatic(e) && <Button variant="outline" size="icon" disabled={busy} aria-label={`Excluir ${t.title}`} onClick={() => setRemoving(e)}><Trash2 /></Button>}
                </span></div>
            </div>
          </li>; })}</ul>
        </>}
    </Panel>

    <EntrySheet open={creating} onOpenChange={setCreating} onSaved={() => { setCreating(false); void load(); }} />
    <AlertDialog open={Boolean(removing)} onOpenChange={(value) => { if (!value) setRemoving(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader className="flex flex-row items-start gap-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600"><Trash2 className="size-5" aria-hidden="true" /></span>
          <div className="space-y-1"><AlertDialogTitle>Excluir lançamento?</AlertDialogTitle><AlertDialogDescription>{removing ? `${removing.description} · ${formatCurrency(removing.amount_cents)}` : ''}. Esta ação não pode ser desfeita.</AlertDialogDescription></div>
        </AlertDialogHeader>
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:flex">
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction className="bg-rose-600 text-white hover:bg-rose-700" onClick={async (event) => {
            event.preventDefault(); const target = removing; setRemoving(null); if (!target) return;
            try { await api(`/api/finance/${target.id}`, { method: 'DELETE' }); toast.success('Lançamento excluído'); await load(); } catch (cause) { toast.error(errorMessage(cause)); }
          }}>Excluir</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function EntryIcon({ entry }: { entry: Entry }) {
  const Icon = CAT_ICON[entry.category] || CircleDot;
  return <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', entry.kind === 'income' ? 'bg-brand-50 text-brand-600' : 'bg-rose-50 text-rose-600')}><Icon className="size-4" aria-hidden="true" /></span>;
}
function Signed({ entry }: { entry: Entry }) {
  return <span className={entry.kind === 'income' ? 'text-brand-700' : 'text-rose-600'}>{entry.kind === 'income' ? '+' : '−'} {formatCurrency(entry.amount_cents)}</span>;
}

/** Resultado acumulado dia a dia (recebido menos pago) e o previsto somando o que está em aberto. */
function ResultChart({ entries, from, to, forecast }: { entries: Entry[]; from: string; to: string; forecast: number }) {
  const data = useMemo(() => {
    const days: string[] = [];
    for (let d = new Date(`${from}T12:00:00`); key(d) <= to && days.length < 400; d.setDate(d.getDate() + 1)) days.push(key(d));
    let acc = 0;
    return days.map((day) => { for (const e of entries) if (e.paid_at && e.due_date === day) acc += e.kind === 'income' ? e.amount_cents : -e.amount_cents; return { day, label: day.slice(8) + '/' + day.slice(5, 7), realized: acc / 100 }; });
  }, [entries, from, to]);
  const hasOpen = Math.round(forecast / 100) !== Math.round((data.at(-1)?.realized ?? 0));
  return <>
    <div className="flex flex-wrap items-start gap-3 px-4 pt-4 lg:px-5 lg:pt-5">
      <div className="flex-1"><h2 className="text-[15px] font-semibold">Resultado acumulado</h2><p className="text-[12.5px] text-muted-foreground">Recebido menos pago, dia a dia no período</p></div>
      <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-3 rounded bg-brand-500" />Realizado</span>
        {hasOpen && <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-3 border-t-2 border-dashed border-amber-400" />Com abertos</span>}
      </div>
    </div>
    <div className="px-2 pt-3 pb-4 lg:px-3">
      <ChartContainer config={chartConfig} className="aspect-auto h-48 w-full">
        <AreaChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 0 }} accessibilityLayer>
          <defs><linearGradient id="fillRealized" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--color-brand-500)" stopOpacity={0.25} /><stop offset="1" stopColor="var(--color-brand-500)" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid vertical={false} strokeDasharray="4 4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v) => formatCurrency(Number(v) * 100).replace(',00', '')} />
          <ChartTooltip content={<ChartTooltipContent formatter={(value) => <span className="font-medium tabular-nums">{formatCurrency(Number(value) * 100)}</span>} />} />
          <Area dataKey="realized" type="monotone" stroke="var(--color-brand-500)" strokeWidth={2.5} fill="url(#fillRealized)" />
          {hasOpen && <ReferenceLine y={forecast / 100} stroke="var(--color-amber-400, #fbbf24)" strokeDasharray="5 4" strokeWidth={2} />}
        </AreaChart>
      </ChartContainer>
    </div>
  </>;
}

function Categories({ entries }: { entries: Entry[] }) {
  const incomes = entries.filter((e) => e.kind === 'income');
  const total = incomes.reduce((sum, e) => sum + e.amount_cents, 0) || 1;
  const byCat = [...new Set(incomes.map((e) => e.category))].map((category) => { const list = incomes.filter((e) => e.category === category); return { category, value: list.reduce((s, e) => s + e.amount_cents, 0), open: list.filter((e) => !e.paid_at).reduce((s, e) => s + e.amount_cents, 0) }; }).sort((a, b) => b.value - a.value);
  return <>
    <div className="px-4 pt-4 lg:px-5 lg:pt-5"><h2 className="text-[15px] font-semibold">Entradas por origem</h2><p className="text-[12.5px] text-muted-foreground">Recebidas e em aberto no período</p></div>
    <div className="px-4 pt-4 lg:px-5"><div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Divisão das entradas por origem">{byCat.map((c, i) => <div key={c.category} className={CAT_COLORS[i % CAT_COLORS.length]} style={{ width: `${c.value / total * 100}%` }} />)}</div></div>
    <ul className="space-y-3 p-4 lg:p-5">{byCat.length ? byCat.map((c, i) => <li key={c.category} className="flex items-center gap-3">
      <span aria-hidden="true" className={cn('size-2.5 rounded-sm', CAT_COLORS[i % CAT_COLORS.length])} />
      <span className="flex-1"><span className="block font-medium">{c.category}</span><span className="text-[12px] text-muted-foreground">{c.open ? `${formatCurrency(c.open)} em aberto` : 'tudo recebido'}</span></span>
      <span className="text-right"><span className="block font-semibold tabular-nums">{formatCurrency(c.value)}</span><span className="text-[12px] text-muted-foreground">{Math.round(c.value / total * 100)}%</span></span>
    </li>) : <li className="text-[13px] text-muted-foreground">Sem entradas no período.</li>}</ul>
  </>;
}

function EntrySheet({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [kind, setKind] = useState<Kind>('income');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATS.income[0]);
  const [amount, setAmount] = useState('');
  const [due, setDue] = useState(todayKey());
  const [paid, setPaid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setKind('income'); setDescription(''); setCategory(CATS.income[0]); setAmount(''); setDue(todayKey()); setPaid(true); setError(''); } }, [open]);
  useEffect(() => { if (!CATS[kind].includes(category)) setCategory(CATS[kind][0]); }, [kind, category]);
  const cents = Math.round(Number(amount.replace(/\./g, '').replace(',', '.')) * 100) || 0;

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try { await api('/api/finance', { method: 'POST', body: JSON.stringify({ kind, category, description: description.trim(), amountCents: cents, dueDate: due, paid }) }); toast.success('Lançamento salvo'); onSaved(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }
  return <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="Novo lançamento" description="Entradas e despesas que não vêm das reservas."
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={() => onOpenChange(false)}>Cancelar</Button>
      <Button type="submit" form="entry-form" className="h-10" disabled={saving || description.trim().length < 2 || cents <= 0}>{saving && <LoaderCircle className="animate-spin" />}Salvar lançamento</Button>
    </div>}>
    <form id="entry-form" className="space-y-4 px-5 py-4" onSubmit={(event) => void submit(event)}>
      <Segmented label="Tipo" value={kind} onChange={setKind} className="grid w-full grid-cols-2" options={[{ value: 'income', label: <span className="inline-flex items-center gap-1.5"><ArrowDownLeft className="size-4" aria-hidden="true" />Entrada</span> }, { value: 'expense', label: <span className="inline-flex items-center gap-1.5"><ArrowUpRight className="size-4" aria-hidden="true" />Despesa</span> }]} />
      <div className="grid gap-1.5"><Label htmlFor="entry-desc">Descrição</Label><Input id="entry-desc" className="h-10" maxLength={180} placeholder={kind === 'income' ? 'Ex.: aluguel para evento' : 'Ex.: conta de energia'} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="grid gap-1.5"><Label>Categoria</Label><Select value={category} onValueChange={setCategory}><SelectTrigger className="h-10 w-full" aria-label="Categoria"><SelectValue /></SelectTrigger><SelectContent>{CATS[kind].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label htmlFor="entry-amount">Valor</Label><div className="relative"><span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">R$</span><Input id="entry-amount" className="h-10 pl-9 tabular-nums" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div></div>
        <div className="grid gap-1.5"><Label>Vencimento</Label><DatePicker className="h-10 w-full" value={due} onChange={setDue} label="Vencimento" /></div>
      </div>
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
        <Switch checked={paid} onCheckedChange={setPaid} aria-label={kind === 'income' ? 'Já recebido' : 'Já pago'} />
        <span className="flex-1"><span className="block font-medium">{kind === 'income' ? 'Já recebido' : 'Já pago'}</span><span className="text-[12px] text-muted-foreground">Desligue para lançar como em aberto</span></span>
      </label>
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </form>
  </ResponsiveSheet>;
}
