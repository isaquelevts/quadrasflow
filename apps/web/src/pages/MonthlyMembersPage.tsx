import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { errorMessage, formatCurrency, formatDate } from '@/lib/format';

type Client = { id: string; name: string; phone: string | null };
type Court = { id: string; name: string; sport: string };
type Member = { id: string; client_name: string; court_name: string; weekday: number; start_time: string; duration_minutes: number; amount_cents: number; status: string };
type Charge = { id: string; client_name: string; court_name: string; cycle: string; amount_cents: number; due_date: string; paid_at: string | null };

const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const times = Array.from({ length: 36 }, (_, index) => `${String(6 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);

export function MonthlyMembersPage() {
  const today = new Date();
  const [cycle, setCycle] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
  const [members, setMembers] = useState<Member[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [open, setOpen] = useState(false);
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('existing');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [formNotice, setFormNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [courtId, setCourtId] = useState('');
  const [weekday, setWeekday] = useState('1');
  const [startTime, setStartTime] = useState('19:00');
  const [duration, setDuration] = useState('60');
  const [amount, setAmount] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [memberData, courtData, clientData] = await Promise.all([
        api<{ members: Member[]; charges: Charge[] }>(`/api/monthly-members?cycle=${cycle}`),
        api<{ courts: Court[] }>('/api/courts'),
        api<{ clients: Client[] }>('/api/clients'),
      ]);
      setMembers(memberData.members);
      setCharges(memberData.charges);
      setCourts(courtData.courts);
      setClients(clientData.clients);
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [cycle]);

  function openDialog() {
    setClientId('');
    setClientName('');
    setClientPhone('');
    setCourtId('');
    setAmount('');
    setClientMode(clients.length ? 'existing' : 'new');
    setFormError('');
    setFormNotice('');
    setOpen(true);
  }

  async function createClient() {
    const name = clientName.trim();
    if (!name) {
      setFormError('Informe o nome do cliente.');
      return;
    }
    setSaving(true);
    setFormError('');
    setFormNotice('');
    try {
      const result = await api<{ client: Client }>('/api/clients', {
        method: 'POST',
        body: JSON.stringify({ name, phone: clientPhone }),
      });
      setClients((current) => [...current, result.client].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      setClientId(result.client.id);
      setClientName('');
      setClientPhone('');
      setClientMode('existing');
      setFormNotice('Cliente cadastrado e selecionado. Complete os dados do mensalista.');
    } catch (cause) {
      setFormError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (clientMode === 'new') {
      setFormError('Cadastre o cliente para continuar.');
      return;
    }
    setSaving(true);
    setFormError('');
    setFormNotice('');
    try {
      await api('/api/monthly-members', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          courtId,
          weekday: Number(weekday),
          startTime,
          durationMinutes: Number(duration),
          amountCents: Math.round(Number(amount.replace(',', '.')) * 100),
        }),
      });
      setOpen(false);
      await load();
    } catch (cause) {
      setFormError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function setMember(id: string, status: string) {
    try {
      await api(`/api/monthly-members/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function paid(id: string) {
    try {
      await api(`/api/monthly-charges/${id}/paid`, { method: 'PATCH', body: '{}' });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return <div className="grid gap-5">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><h1 className="text-2xl font-bold">Mensalistas</h1><p className="mt-1 text-sm text-muted-foreground">Horários recorrentes e cobranças mensais.</p></div>
      <div className="grid w-full gap-2 min-[420px]:grid-cols-[160px_1fr] sm:flex sm:w-auto"><Input type="month" className="w-full sm:w-40" value={cycle} onChange={(event) => setCycle(event.target.value)} /><Button className="w-full sm:w-auto" onClick={openDialog}><Plus /> Novo mensalista</Button></div>
    </header>
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <div className="grid min-h-36 place-items-center"><LoaderCircle className="animate-spin" /></div> : <>
      <Card><CardHeader><CardTitle className="text-base">Planos recorrentes · {members.length}</CardTitle></CardHeader><CardContent className="grid gap-2">
        {members.length ? members.map((member) => <article key={member.id} className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
          <div><p className="font-semibold">{member.client_name} <span className="font-normal text-muted-foreground">· {member.court_name}</span></p><p className="text-xs text-muted-foreground">{days[member.weekday]} às {member.start_time} · {member.duration_minutes} min · {formatCurrency(member.amount_cents)}/mês</p></div>
          <div className="flex items-center gap-2"><span className="text-xs capitalize text-muted-foreground">{member.status === 'active' ? 'Ativo' : member.status === 'paused' ? 'Pausado' : 'Encerrado'}</span>{member.status !== 'ended' && <Button size="sm" variant="outline" onClick={() => void setMember(member.id, member.status === 'active' ? 'paused' : 'active')}>{member.status === 'active' ? 'Pausar' : 'Ativar'}</Button>}{member.status !== 'ended' && <Button size="sm" variant="ghost" className="text-red-700" onClick={() => void setMember(member.id, 'ended')}>Encerrar</Button>}</div>
        </article>) : <p className="py-7 text-center text-sm text-muted-foreground">Nenhum horário recorrente cadastrado.</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Cobranças · {cycle}</CardTitle></CardHeader><CardContent className="grid gap-2">
        {charges.length ? charges.map((charge) => <article key={charge.id} className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
          <div><p className="font-semibold">{charge.client_name} <span className="font-normal text-muted-foreground">· {charge.court_name}</span></p><p className="text-xs text-muted-foreground">Vencimento {formatDate(charge.due_date)} · {formatCurrency(charge.amount_cents)}</p></div>
          <Button size="sm" variant={charge.paid_at ? 'outline' : 'secondary'} disabled={Boolean(charge.paid_at)} onClick={() => void paid(charge.id)}>{charge.paid_at ? 'Pago' : 'Marcar recebido'}</Button>
        </article>) : <p className="py-7 text-center text-sm text-muted-foreground">Sem cobranças neste ciclo.</p>}
      </CardContent></Card>
    </>}

    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo mensalista</DialogTitle><DialogDescription>Reserve um horário semanal recorrente e defina o valor mensal.</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
          <div className="grid gap-2">
            <Label>Cliente</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={clientMode === 'existing' ? 'secondary' : 'outline'} disabled={!clients.length} aria-pressed={clientMode === 'existing'} onClick={() => { setClientMode('existing'); setFormError(''); setFormNotice(''); }}>Cliente cadastrado</Button>
              <Button type="button" size="sm" variant={clientMode === 'new' ? 'secondary' : 'outline'} aria-pressed={clientMode === 'new'} onClick={() => { setClientMode('new'); setFormError(''); setFormNotice(''); }}>Novo cliente</Button>
            </div>
            {clientMode === 'existing' ? <Select value={clientId} onValueChange={setClientId} required>
              <SelectTrigger className="w-full"><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
              <SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent>
            </Select> : <div className="grid gap-3 rounded-md border p-3">
              <div className="grid gap-2"><Label htmlFor="monthly-client-name">Nome</Label><Input id="monthly-client-name" autoComplete="name" maxLength={100} value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Nome do cliente" /></div>
              <div className="grid gap-2"><Label htmlFor="monthly-client-phone">Telefone / WhatsApp (opcional)</Label><Input id="monthly-client-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(31) 99999-9999" value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} /></div>
              <Button type="button" variant="outline" className="w-full sm:w-fit" disabled={saving || !clientName.trim()} onClick={() => void createClient()}>{saving && <LoaderCircle className="animate-spin" />}Cadastrar cliente e continuar</Button>
            </div>}
          </div>
          <div className="grid gap-2"><Label>Quadra</Label><Select value={courtId} onValueChange={setCourtId} required><SelectTrigger className="w-full"><SelectValue placeholder="Selecione uma quadra" /></SelectTrigger><SelectContent>{courts.map((court) => <SelectItem key={court.id} value={court.id}>{court.name} · {court.sport}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-3 min-[420px]:grid-cols-2">
            <div className="grid gap-2"><Label>Dia</Label><Select value={weekday} onValueChange={setWeekday}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{days.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label>Início</Label><Select value={startTime} onValueChange={setStartTime}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{times.map((time) => <SelectItem key={time} value={time}>{time}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid gap-3 min-[420px]:grid-cols-2">
            <div className="grid gap-2"><Label>Duração</Label><Select value={duration} onValueChange={setDuration}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[60, 90, 120, 150, 180, 210, 240].map((minutes) => <SelectItem key={minutes} value={String(minutes)}>{minutes} min</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label>Valor mensal (R$)</Label><Input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          </div>
          {formNotice && <p role="status" className="text-sm text-emerald-800">{formNotice}</p>}
          {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={saving || !clientId || !courtId || clientMode === 'new'}>{saving && <LoaderCircle className="animate-spin" />}Salvar mensalista</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
