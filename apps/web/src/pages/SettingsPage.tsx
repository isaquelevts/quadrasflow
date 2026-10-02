import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarX2, Check, Clock, Copy, CopyCheck, CreditCard, ExternalLink, Image, LoaderCircle, MapPin, Plus, Store, Tags, X, type LucideProps } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { ArenaImagePicker } from '@/components/ArenaImagePicker';
import { BrazilStateInput } from '@/components/BrazilStateInput';
import { PageHeader, Panel } from '@/components/app/page';
import { ToneBadge } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { durationLabel, errorMessage, formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

type Hour = { weekday: number; is_open: boolean | number; open_time: string; close_time: string };
type PriceDay = { weekday: number; morning: number; afternoon: number; evening: number };
type Profile = { description: string; address: string; city: string; state: string; amenities: string[]; photos: string[] };
type MpStatus = { connected: boolean; configured: boolean };
type Section = 'perfil' | 'horarios' | 'precos' | 'cancelamento' | 'pagamentos';
type RefundPolicy = 'always' | 'never' | 'team';
type BookingPolicy = { refund: RefundPolicy; allowReschedule: boolean; rescheduleHours: number };

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const TIMES = Array.from({ length: 36 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const BANDS: Array<['morning' | 'afternoon' | 'evening', string]> = [['morning', 'Manhã · 08h–12h'], ['afternoon', 'Tarde · 12h–18h'], ['evening', 'Noite · 18h–23h']];
const SUGGESTED = ['Estacionamento', 'Vestiário', 'Chuveiro', 'Bar', 'Wi-Fi', 'Iluminação', 'Aluguel de bolas', 'Arquibancada'];
const SECTIONS: Array<[Section, string, ComponentType<LucideProps>]> = [['perfil', 'Perfil público', Store], ['horarios', 'Horários', Clock], ['precos', 'Preços', Tags], ['cancelamento', 'Cancelamento', CalendarX2], ['pagamentos', 'Pagamentos', CreditCard]];
const REFUND_OPTIONS: Array<[RefundPolicy, string, string]> = [
  ['always', 'Sempre devolve', 'Cancelou, a equipe devolve o valor pago (Pix ou sinal), não importa a hora.'],
  ['never', 'Não devolve', 'O cliente pode cancelar e liberar o horário, mas o valor pago fica com a arena.'],
  ['team', 'A equipe decide caso a caso', 'O cliente é avisado de que a equipe vai analisar a devolução.'],
];

export function SettingsPage() {
  const { user } = useAuth();
  const [section, setSection] = useState<Section>('perfil');
  const [hours, setHours] = useState<Hour[]>([]);
  const [prices, setPrices] = useState<PriceDay[]>([]);
  const [maxDuration, setMaxDuration] = useState(480);
  const [policy, setPolicy] = useState<BookingPolicy>({ refund: 'team', allowReschedule: true, rescheduleHours: 24 });
  const [profile, setProfile] = useState<Profile>({ description: '', address: '', city: '', state: '', amenities: [], photos: [] });
  const [mp, setMp] = useState<MpStatus>({ connected: false, configured: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Section | null>(null);
  const [uploading, setUploading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const publicUrl = user?.company?.slug ? `${window.location.origin}/a/${user.company.slug}` : '';

  useEffect(() => {
    Promise.all([api<{ weeklyHours: Hour[]; maxDurationMinutes?: number; prices: PriceDay[]; profile: Profile }>('/api/arena/settings'), api<MpStatus>('/api/integrations/mercadopago'), api<BookingPolicy>('/api/arena/booking-policy')])
      .then(([settings, payment, bookingPolicy]) => {
        setPolicy(bookingPolicy);
        setHours(settings.weeklyHours.map((h) => ({ ...h, is_open: Boolean(h.is_open) })));
        setPrices(settings.prices);
        setMaxDuration(settings.maxDurationMinutes || 480);
        setProfile({ ...settings.profile, amenities: settings.profile.amenities || [], photos: settings.profile.photos || [] });
        setMp(payment);
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setLoading(false));
    // Volta do Mercado Pago: /configuracoes?mercadopago=conectado
    const status = new URLSearchParams(window.location.search).get('mercadopago');
    if (status) { setSection('pagamentos'); if (status === 'connected') toast.success('Mercado Pago conectado'); }
  }, []);

  async function save(which: Section, fn: () => Promise<unknown>, label: string) {
    setSaving(which);
    try { await fn(); toast.success(label); }
    catch (cause) { toast.error(errorMessage(cause)); }
    finally { setSaving(null); }
  }
  const saveHours = () => save('horarios', () => api('/api/arena/settings', { method: 'PUT', body: JSON.stringify({ weeklyHours: hours.map((h) => ({ weekday: h.weekday, isOpen: Boolean(h.is_open), openTime: h.open_time, closeTime: h.close_time })), maxDurationMinutes: maxDuration }) }), 'Horários salvos');
  const savePrices = () => save('precos', () => api('/api/arena/prices', { method: 'PUT', body: JSON.stringify({ prices }) }), 'Preços salvos');
  const savePolicy = () => save('cancelamento', () => api('/api/arena/booking-policy', { method: 'PUT', body: JSON.stringify(policy) }), 'Regras de cancelamento salvas');
  const saveProfile = () => save('perfil', () => api('/api/arena/profile', { method: 'PUT', body: JSON.stringify({ profile }) }), 'Perfil da arena salvo');
  async function connectMp() {
    setConnecting(true);
    try { const result = await api<{ url: string }>('/api/integrations/mercadopago/connect', { method: 'POST', body: '{}' }); window.location.assign(result.url); }
    catch (cause) { toast.error(errorMessage(cause)); setConnecting(false); }
  }
  const updateHour = (weekday: number, patch: Partial<Hour>) => setHours((list) => list.map((h) => h.weekday === weekday ? { ...h, ...patch } : h));
  const copyToAll = (from: Hour) => { setHours((list) => list.map((h) => ({ ...h, is_open: from.is_open, open_time: from.open_time, close_time: from.close_time }))); toast(`Horário de ${DAYS[from.weekday].toLowerCase()} copiado para todos os dias`); };
  const updatePrice = (weekday: number, band: 'morning' | 'afternoon' | 'evening', value: string) => {
    const cents = Math.round(Number(value.replace(/\./g, '').replace(',', '.')) * 100);
    setPrices((list) => list.map((day) => day.weekday === weekday ? { ...day, [band]: Number.isFinite(cents) ? cents : 0 } : day));
  };

  return <div className="space-y-4 lg:space-y-5">
    <PageHeader title="Configurações" description="Perfil público, funcionamento, preços e pagamentos da arena." />
    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    {loading ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div> : <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[220px_1fr] lg:gap-5">
      <nav aria-label="Seções das configurações" className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 lg:sticky lg:top-24 lg:mx-0 lg:flex-col lg:px-0">
        {SECTIONS.map(([value, label, Icon]) => <button key={value} type="button" aria-current={section === value ? 'page' : undefined} onClick={() => setSection(value)}
          className={cn('flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-left font-medium whitespace-nowrap transition', section === value ? 'bg-brand-900 text-white' : 'text-muted-foreground hover:bg-card hover:text-foreground')}>
          <Icon className="size-4" aria-hidden="true" />{label}
        </button>)}
      </nav>

      <div className="min-w-0">
        {section === 'perfil' && <Card icon={Store} title="Perfil público da arena" sub="Aparece na página de reservas e é usado pelo bot para responder dúvidas."
          footer={<SaveButton saving={saving === 'perfil'} disabled={uploading} onClick={() => void saveProfile()} />}>
          {publicUrl && <div className="grid gap-1.5"><Label>Página pública</Label>
            <div className="flex gap-2"><Input readOnly value={publicUrl} className="h-10 bg-muted/60 text-[12.5px]" onFocus={(e) => e.target.select()} aria-label="Endereço da página pública" />
              <CopyButton value={publicUrl} /><Button asChild variant="outline" size="icon" className="size-10" aria-label="Abrir página pública"><a href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink /></a></Button></div></div>}
          <div className="grid gap-1.5"><Label htmlFor="profile-description">Descrição</Label><Textarea id="profile-description" rows={3} maxLength={600} placeholder="Conte o que a arena oferece" value={profile.description} onChange={(e) => setProfile((p) => ({ ...p, description: e.target.value }))} /></div>
          <div className="grid gap-1.5"><Label htmlFor="profile-address"><MapPin className="mr-1 inline size-3.5" aria-hidden="true" />Endereço</Label><Input id="profile-address" className="h-10" maxLength={180} value={profile.address} onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))} /></div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="grid gap-1.5"><Label htmlFor="profile-city">Cidade</Label><Input id="profile-city" className="h-10" maxLength={100} value={profile.city} onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="profile-state">UF</Label><BrazilStateInput id="profile-state" value={profile.state} onChange={(state) => setProfile((p) => ({ ...p, state }))} /></div>
          </div>
          <Amenities value={profile.amenities} onChange={(amenities) => setProfile((p) => ({ ...p, amenities }))} />
          <div className="grid gap-1.5"><span className="flex items-center gap-1.5 text-sm font-medium"><Image className="size-3.5" aria-hidden="true" />Fotos da arena</span>
            <ArenaImagePicker label="Fotos da arena" images={profile.photos} maxImages={6} onChange={(photos) => setProfile((p) => ({ ...p, photos }))} onBusyChange={setUploading} /></div>
        </Card>}

        {section === 'horarios' && <Card icon={Clock} title="Horários de funcionamento" sub="Valem para todas as quadras, para a agenda, o bot e a página pública."
          footer={<SaveButton saving={saving === 'horarios'} onClick={() => void saveHours()} />}>
          <ul className="divide-y rounded-lg border">{ORDER.map((weekday) => hours.find((h) => h.weekday === weekday)).filter((h): h is Hour => Boolean(h)).map((h) => <li key={h.weekday} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <label className="flex w-36 cursor-pointer items-center gap-2.5 font-medium"><Switch checked={Boolean(h.is_open)} onCheckedChange={(v) => updateHour(h.weekday, { is_open: v })} aria-label={`${DAYS[h.weekday]} aberto`} />{DAYS[h.weekday]}</label>
            {h.is_open ? <div className="flex flex-1 items-center gap-2">
              <TimeSelect label={`Abertura de ${DAYS[h.weekday]}`} value={h.open_time} onChange={(v) => updateHour(h.weekday, { open_time: v })} />
              <span className="text-muted-foreground">às</span>
              <TimeSelect label={`Fechamento de ${DAYS[h.weekday]}`} value={h.close_time} onChange={(v) => updateHour(h.weekday, { close_time: v })} options={TIMES.filter((t) => t > h.open_time)} />
              {h.close_time <= h.open_time && <span className="text-[12px] text-rose-600">fechamento antes da abertura</span>}
            </div> : <span className="flex-1 text-[13px] text-muted-foreground">Fechado</span>}
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => copyToAll(h)} aria-label={`Copiar horário de ${DAYS[h.weekday]} para todos os dias`}><CopyCheck /> <span className="hidden sm:inline">Copiar para todos</span></Button>
          </li>)}</ul>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-3">
            <div className="min-w-0 flex-1"><div className="font-medium" id="duracao-maxima">Duração máxima por reserva</div><p className="text-[12.5px] text-muted-foreground">Vale para a página pública e para o WhatsApp. O mínimo é 1h.</p></div>
            <Select value={String(maxDuration)} onValueChange={(v) => setMaxDuration(Number(v))}><SelectTrigger className="h-9 w-28 tabular-nums" aria-labelledby="duracao-maxima"><SelectValue /></SelectTrigger>
              <SelectContent>{DURATIONS.map((m) => <SelectItem key={m} value={String(m)}>{durationLabel(m)}</SelectItem>)}</SelectContent></Select>
          </div>
        </Card>}

        {section === 'precos' && <Card icon={Tags} title="Preços por faixa de horário" sub="Valor por hora em cada faixa. Reservas que cruzam faixas somam cada meia hora pelo preço da sua faixa."
          footer={<SaveButton saving={saving === 'precos'} onClick={() => void savePrices()} />}>
          <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[13px]">
            <thead><tr className="text-left text-[12px] text-muted-foreground"><th className="py-2 pr-3 font-medium">Dia</th>{BANDS.map(([, label]) => <th key={label} className="px-2 py-2 font-medium">{label}</th>)}</tr></thead>
            <tbody className="divide-y">{ORDER.map((weekday) => prices.find((p) => p.weekday === weekday)).filter((p): p is PriceDay => Boolean(p)).map((day) => <tr key={day.weekday}>
              <td className="py-2 pr-3 font-medium">{DAYS[day.weekday]}</td>
              {BANDS.map(([band, label]) => <td key={band} className="px-2 py-2"><div className="relative"><span className="absolute top-1/2 left-2.5 -translate-y-1/2 text-[12px] text-muted-foreground">R$</span>
                <Input key={`${day.weekday}-${band}-${day[band]}`} className="h-9 pl-8 tabular-nums" inputMode="decimal" aria-label={`${DAYS[day.weekday]}, ${label}`} defaultValue={(day[band] / 100).toFixed(2).replace('.', ',')} onBlur={(e) => updatePrice(day.weekday, band, e.target.value)} /></div></td>)}
            </tr>)}</tbody>
          </table></div>
          <p className="text-[12px] text-muted-foreground">Mínimo de {formatCurrency(2000)} por hora em cada faixa. Ex.: 19:00–20:30 à noite = 1h30 pelo preço da noite.</p>
        </Card>}

        {section === 'cancelamento' && <Card icon={CalendarX2} title="Cancelamento e remarcação" sub="Vale para o WhatsApp e para o painel. Cancelar é sempre permitido: o horário volta a ficar livre."
          footer={<SaveButton saving={saving === 'cancelamento'} onClick={() => void savePolicy()} />}>
          <fieldset className="space-y-2"><legend className="mb-2 font-medium" id="refund-legend">Quando o cliente cancela, o valor pago…</legend>
            <RadioGroup aria-labelledby="refund-legend" value={policy.refund} onValueChange={(value) => setPolicy((p) => ({ ...p, refund: value as RefundPolicy }))} className="gap-2">
              {REFUND_OPTIONS.map(([value, title, text]) => <Label key={value} htmlFor={`refund-${value}`} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal leading-normal transition', policy.refund === value ? 'border-brand-500 bg-brand-50/60' : 'hover:bg-muted/40')}>
                <RadioGroupItem id={`refund-${value}`} value={value} className="mt-0.5" />
                <span className="space-y-0.5"><span className="block font-medium leading-snug">{title}</span><span className="block text-[12.5px] leading-snug text-muted-foreground">{text}</span></span></Label>)}
            </RadioGroup>
            <p className="text-[12.5px] text-muted-foreground">A devolução é feita pela equipe: o sistema registra "Estorno a devolver" no Financeiro e avisa no sininho.</p>
          </fieldset>
          <div className="space-y-3 rounded-lg border p-3">
            <label className="flex cursor-pointer items-center justify-between gap-3"><span><span className="block font-medium">Permitir remarcação pelo WhatsApp</span><span className="block text-[12.5px] text-muted-foreground">O cliente troca o dia ou o horário e mantém o que já pagou.</span></span>
              <Switch checked={policy.allowReschedule} onCheckedChange={(v) => setPolicy((p) => ({ ...p, allowReschedule: v }))} aria-label="Permitir remarcação pelo WhatsApp" /></label>
            {policy.allowReschedule && <div className="flex flex-wrap items-center gap-2 text-[13.5px]"><Label htmlFor="reschedule-hours">Até</Label>
              <Input id="reschedule-hours" className="h-9 w-20 text-center tabular-nums" type="number" min={0} max={720} value={policy.rescheduleHours} onChange={(e) => setPolicy((p) => ({ ...p, rescheduleHours: Math.max(0, Math.min(720, Math.round(Number(e.target.value) || 0))) }))} />
              <span className="text-muted-foreground">horas antes do jogo{policy.rescheduleHours === 0 ? ' (até o horário de início)' : ''}</span></div>}
          </div>
        </Card>}

        {section === 'pagamentos' && <Card icon={CreditCard} title="Pagamentos · Mercado Pago" sub="A conta que recebe os Pix das reservas, mensalidades e inscrições.">
          <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border p-3', mp.connected ? 'border-brand-100 bg-brand-50/60' : 'bg-muted/40')}>
            <span className={cn('grid size-10 place-items-center rounded-full', mp.connected ? 'bg-brand-500 text-white' : 'bg-gray-200 text-muted-foreground')}><CreditCard className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2 font-medium">{mp.connected ? 'Conta Mercado Pago conectada' : 'Nenhuma conta conectada'}<ToneBadge tone={mp.connected ? 'green' : 'gray'}>{mp.connected ? 'Ativo' : 'Desligado'}</ToneBadge></div>
              <div className="text-[12.5px] text-muted-foreground">{mp.connected ? 'Os links e QR Codes Pix são gerados nesta conta.' : mp.configured ? 'Conecte a conta vendedora que vai receber os pagamentos.' : 'As credenciais do Mercado Pago ainda não foram configuradas no servidor.'}</div></div>
            <Button disabled={connecting || !mp.configured} onClick={() => void connectMp()}>{connecting && <LoaderCircle className="animate-spin" />}{mp.connected ? 'Reconectar' : 'Conectar Mercado Pago'}</Button>
          </div>
          <p className="flex gap-2 rounded-lg bg-muted/70 px-3 py-2.5 text-[12.5px] text-muted-foreground"><CreditCard className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Quanto cobrar antecipadamente (sem Pix, valor integral, percentual ou valor fixo) fica em <Link to="/whatsapp" className="font-medium text-brand-700 underline">WhatsApp → Pagamento para reservar</Link> e vale para o bot, a página pública e o link Pix da equipe.</span></p>
        </Card>}
      </div>
    </div>}
  </div>;
}

function Card({ icon: Icon, title, sub, children, footer }: { icon: ComponentType<LucideProps>; title: string; sub: string; children: ReactNode; footer?: ReactNode }) {
  return <Panel>
    <div className="flex items-start gap-3 border-b px-4 py-4 lg:px-5"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-4" aria-hidden="true" /></span>
      <div className="min-w-0"><h2 className="text-[15px] font-semibold">{title}</h2><p className="text-[12.5px] text-muted-foreground">{sub}</p></div></div>
    <div className="space-y-4 p-4 lg:p-5">{children}</div>
    {footer && <div className="flex justify-end border-t px-4 py-3 lg:px-5">{footer}</div>}
  </Panel>;
}
function SaveButton({ saving, disabled, onClick }: { saving: boolean; disabled?: boolean; onClick: () => void }) {
  return <Button disabled={saving || disabled} onClick={onClick}>{saving ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar</Button>;
}
function CopyButton({ value }: { value: string }) {
  return <Button type="button" variant="outline" size="icon" className="size-10" aria-label="Copiar endereço" onClick={() => { void navigator.clipboard?.writeText(value).then(() => toast.success('Link copiado'), () => toast.error('Não foi possível copiar')); }}><Copy /></Button>;
}
const DURATIONS = Array.from({ length: 15 }, (_, i) => 60 + i * 30);
function TimeSelect({ label, value, onChange, options = TIMES }: { label: string; value: string; onChange: (value: string) => void; options?: string[] }) {
  const list = options.includes(value) ? options : [value, ...options];
  return <Select value={value} onValueChange={onChange}><SelectTrigger className="h-9 w-24 tabular-nums" aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{list.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>;
}
function Amenities({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (item: string) => { const clean = item.trim(); if (!clean || value.some((v) => v.toLowerCase() === clean.toLowerCase()) || value.length >= 20) return; onChange([...value, clean]); setDraft(''); };
  return <div className="grid gap-1.5">
    <Label htmlFor="amenity-input">Comodidades</Label>
    {value.length > 0 && <div className="flex flex-wrap gap-1.5">{value.map((item) => <span key={item} className="inline-flex items-center gap-1 rounded-md border bg-white py-1 pr-1 pl-2 text-[12.5px]">{item}
      <button type="button" aria-label={`Remover ${item}`} className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted" onClick={() => onChange(value.filter((v) => v !== item))}><X className="size-3" aria-hidden="true" /></button></span>)}</div>}
    <div className="flex gap-2"><Input id="amenity-input" className="h-9" maxLength={40} placeholder="Ex.: Estacionamento" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); } }} />
      <Button type="button" variant="outline" onClick={() => add(draft)}><Plus /> Adicionar</Button></div>
    <div className="flex flex-wrap gap-1.5">{SUGGESTED.filter((s) => !value.includes(s)).slice(0, 6).map((s) => <button key={s} type="button" onClick={() => add(s)} className="rounded-md border border-dashed px-2 py-0.5 text-[12px] text-muted-foreground hover:border-brand-400 hover:text-brand-700">+ {s}</button>)}</div>
  </div>;
}
