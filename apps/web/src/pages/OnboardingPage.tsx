import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Plus, Sparkles, X } from 'lucide-react';
import { Brand } from '@/components/Brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

const steps = ['Dados da arena', 'Quadras', 'Horários e preços', 'Fotos e estrutura'];
const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const fullWeekdays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const sports = ['Society', 'Futsal', 'Futebol de Campo', 'Beach Tennis', 'Padel', 'Tênis', 'Vôlei', 'Vôlei de Praia', 'Basquete', 'Futvôlei', 'Pickleball', 'Handebol', 'Peteca', 'Futmesa', 'Tênis de Mesa', 'Badminton', 'Squash', 'Outro'];
const amenityOptions = ['Estacionamento', 'Bar / Lanchonete', 'Vestiário', 'Chuveiro', 'Wi-Fi', 'Iluminação'];
const states = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const surfaces = ['Grama sintética', 'Grama natural', 'Piso modular', 'Cimento', 'Areia', 'Madeira', 'Outro'];
const coverings = ['Coberta', 'Descoberta', 'Retrátil'];
const bands = [
  { key: 'morning', label: '08h–12h' },
  { key: 'afternoon', label: '12h–18h' },
  { key: 'evening', label: '18h–23h' },
] as const;
type Band = typeof bands[number]['key'];
type HoursDay = { weekday: number; isOpen: boolean; openTime: string; closeTime: string };
type CourtDraft = { name: string; sports: string[]; surface: string; covering: string; players: string };
type PriceDay = { weekday: number; morning: string; afternoon: string; evening: string };
type ArenaDraft = { name: string; phone: string; zipCode: string; address: string; addressNumber: string; district: string; city: string; state: string; description: string; logoUrl: string; photos: string[]; amenities: string[]; cancellationHours: string; cancellationFeePercent: string };

const defaultCompany: ArenaDraft = { name: '', phone: '', zipCode: '', address: '', addressNumber: '', district: '', city: '', state: '', description: '', logoUrl: '', photos: [], amenities: [], cancellationHours: '24', cancellationFeePercent: '0' };
const defaultHours = (): HoursDay[] => Array.from({ length: 7 }, (_, weekday) => ({ weekday, isOpen: weekday !== 0, openTime: '08:00', closeTime: '23:00' }));
const defaultPrices = (): PriceDay[] => Array.from({ length: 7 }, (_, weekday) => ({ weekday, morning: '100', afternoon: '120', evening: '150' }));
const minutes = Array.from({ length: 36 }, (_, index) => { const value = 6 * 60 + index * 30; return `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`; });

function priceCents(value: string) {
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}
function dollars(value: number) { return (value / 100).toFixed(2).replace('.', ','); }
function digits(value: string) { return value.replace(/\D/g, ''); }

export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState<ArenaDraft>(defaultCompany);
  const [courts, setCourts] = useState<CourtDraft[]>([{ name: '', sports: ['Society'], surface: 'Grama sintética', covering: 'Coberta', players: '22' }]);
  const [weeklyHours, setWeeklyHours] = useState<HoursDay[]>(defaultHours);
  const [prices, setPrices] = useState<PriceDay[]>(defaultPrices);
  const [applyPrice, setApplyPrice] = useState('100');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api<{ completed: boolean; company?: Partial<ArenaDraft>; courts?: Array<{ name: string; sports: string[]; surface: string; covering: string; players: number }>; weeklyHours?: HoursDay[]; prices?: Array<{ weekday: number; band: Band; price_cents: number }> }>('/api/arena/onboarding')
      .then((data) => {
        if (!active) return;
        if (data.completed) { navigate('/', { replace: true }); return; }
        if (data.company) setCompany((current) => ({ ...current, ...data.company, photos: data.company?.photos || [], amenities: data.company?.amenities || [] }));
        if (data.courts?.length) setCourts(data.courts.map((court) => ({ ...court, sports: court.sports || [String((court as { sport?: string }).sport || 'Society')], players: String(court.players || 22) })));
        if (data.weeklyHours?.length === 7) setWeeklyHours(data.weeklyHours.map((day) => ({ ...day, isOpen: Boolean(day.isOpen) })));
        if (data.prices) setPrices((current) => {
          const next = current.map((day) => ({ ...day }));
          for (const price of data.prices || []) next[price.weekday][price.band] = dollars(price.price_cents);
          return next;
        });
      })
      .catch(() => { /* New accounts start with a blank local draft until the onboarding API is available. */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [navigate]);

  const openDays = useMemo(() => weeklyHours.filter((day) => day.isOpen).length, [weeklyHours]);
  const updateCompany = <K extends keyof ArenaDraft>(key: K, value: ArenaDraft[K]) => setCompany((current) => ({ ...current, [key]: value }));
  const updateCourt = (index: number, patch: Partial<CourtDraft>) => setCourts((current) => current.map((court, i) => i === index ? { ...court, ...patch } : court));
  const toggleSport = (index: number, sport: string, enabled: boolean) => setCourts((current) => current.map((court, i) => i === index ? { ...court, sports: enabled ? [...new Set([...court.sports, sport])] : court.sports.filter((item) => item !== sport) } : court));
  const updatePrice = (weekday: number, band: Band, value: string) => setPrices((current) => current.map((day) => day.weekday === weekday ? { ...day, [band]: value } : day));

  function validateStep() {
    if (step === 0) {
      if (company.name.trim().length < 2) return 'Informe o nome da arena.';
      if (digits(company.phone).length < 10) return 'Informe um telefone com DDD.';
      if (digits(company.zipCode).length !== 8 || company.address.trim().length < 3 || !company.city.trim() || !/^[A-Z]{2}$/i.test(company.state)) return 'Confira o CEP e o endereço da arena.';
    }
    if (step === 1) {
      if (!courts.length || courts.some((court) => court.name.trim().length < 2 || court.sports.length === 0 || Number(court.players) < 2)) return 'Cada quadra precisa de nome, modalidade e número válido de jogadores.';
      if (new Set(courts.map((court) => court.name.trim().toLocaleLowerCase('pt-BR'))).size !== courts.length) return 'Use um nome diferente para cada quadra.';
    }
    if (step === 2) {
      if (!openDays) return 'Selecione pelo menos um dia de funcionamento.';
      if (weeklyHours.some((day) => day.isOpen && day.closeTime <= day.openTime)) return 'O fechamento precisa ser depois da abertura.';
      if (prices.some((day) => bands.some(({ key }) => priceCents(day[key]) < 2000))) return 'O preço mínimo é R$ 20 por hora em cada faixa.';
    }
    if (step === 3) {
      if (company.logoUrl && !/^https:\/\//i.test(company.logoUrl)) return 'O link do logo precisa começar com https://.';
      if (company.photos.some((photo) => photo && !/^https:\/\//i.test(photo))) return 'Use links https:// para as fotos da arena.';
    }
    return '';
  }

  async function next(event?: FormEvent) {
    event?.preventDefault(); setError('');
    const message = validateStep();
    if (message) { setError(message); return; }
    if (step < steps.length - 1) { setStep((current) => current + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setSaving(true);
    try {
      await api('/api/arena/onboarding', {
        method: 'PUT',
        body: JSON.stringify({
          company: { ...company, phone: digits(company.phone), zipCode: digits(company.zipCode), state: company.state.toUpperCase(), cancellationHours: Number(company.cancellationHours), cancellationFeePercent: Number(company.cancellationFeePercent) },
          courts: courts.map((court) => ({ ...court, players: Number(court.players), sport: court.sports[0] })),
          weeklyHours,
          prices: prices.map((day) => ({ weekday: day.weekday, morning: priceCents(day.morning), afternoon: priceCents(day.afternoon), evening: priceCents(day.evening) })),
        }),
      });
      window.location.assign('/');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a configuração.'); }
    finally { setSaving(false); }
  }

  function addCourt() {
    if (courts.length >= 15) { setError('Você pode cadastrar até 15 quadras nesta etapa.'); return; }
    setCourts((current) => [...current, { name: '', sports: [], surface: 'Grama sintética', covering: 'Coberta', players: '22' }]);
    setError('');
  }
  function toggleDay(weekday: number, checked: boolean) { setWeeklyHours((current) => current.map((day) => day.weekday === weekday ? { ...day, isOpen: checked } : day)); }
  function setAllPrices() { const value = String(applyPrice).replace(',', '.'); setPrices((current) => current.map((day) => ({ ...day, morning: value, afternoon: value, evening: value }))); }
  function addPhoto() { if (company.photos.length < 6) updateCompany('photos', [...company.photos, '']); }

  if (loading) return <main className="grid min-h-svh place-items-center"><LoaderCircle className="animate-spin text-primary" /></main>;

  return <main className="min-h-svh px-4 py-6 sm:px-6 sm:py-8"><div className="mx-auto max-w-3xl"><header className="mb-7 flex justify-center"><Brand /></header><nav aria-label="Etapas da configuração" className="mb-7 grid grid-cols-4 items-start">{steps.map((label, index) => <div key={label} className="relative flex flex-col items-center text-center"><div className="absolute left-1/2 top-4 -z-10 h-0.5 w-full bg-border first:hidden" style={{ display: index === 0 ? 'none' : undefined }} /><span className={`grid size-9 place-items-center rounded-full border-2 text-sm font-semibold ${index < step ? 'border-primary bg-primary text-white' : index === step ? 'border-lime-400 bg-lime-300 text-primary ring-4 ring-lime-200/70' : 'border-border bg-background text-muted-foreground'}`}>{index < step ? <Check size={16} /> : index + 1}</span><span className={`mt-2 hidden text-[11px] sm:block ${index === step ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{label}</span></div>)}</nav>
      <Card className="rounded-2xl border-2 border-foreground shadow-none"><CardContent className="p-5 sm:p-8"><div className="mb-6"><p className="text-xs font-bold uppercase tracking-[.16em] text-primary">Etapa {step + 1} de 4</p><h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{['Dados da sua arena', 'Suas quadras', 'Horários e preços', 'Fotos e estrutura'][step]}</h1><p className="mt-2 text-sm text-muted-foreground">{['Nome, contato e endereço.', 'Cadastre os espaços disponíveis para reserva.', 'Defina o funcionamento semanal e o preço por faixa.', 'Imagens, comodidades e política de cancelamento.'][step]}</p></div>
        {step === 0 && <section className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2 sm:col-span-2"><Label htmlFor="arena-name">Nome da arena *</Label><Input id="arena-name" maxLength={100} placeholder="Ex.: Arena Central" value={company.name} onChange={(event) => updateCompany('name', event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="arena-phone">Telefone *</Label><Input id="arena-phone" type="tel" inputMode="tel" placeholder="(31) 99999-9999" value={company.phone} onChange={(event) => updateCompany('phone', event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="arena-zip">CEP *</Label><Input id="arena-zip" inputMode="numeric" maxLength={9} placeholder="00000-000" value={company.zipCode} onChange={(event) => updateCompany('zipCode', event.target.value)} /></div><div className="grid gap-2 sm:col-span-2"><Label htmlFor="arena-address">Rua / Avenida *</Label><Input id="arena-address" maxLength={180} placeholder="Av. Principal" value={company.address} onChange={(event) => updateCompany('address', event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="arena-number">Número</Label><Input id="arena-number" maxLength={20} placeholder="123" value={company.addressNumber} onChange={(event) => updateCompany('addressNumber', event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="arena-district">Bairro</Label><Input id="arena-district" maxLength={100} placeholder="Centro" value={company.district} onChange={(event) => updateCompany('district', event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="arena-city">Cidade *</Label><Input id="arena-city" maxLength={100} value={company.city} onChange={(event) => updateCompany('city', event.target.value)} /></div><div className="grid gap-2"><Label>UF *</Label><Select value={company.state} onValueChange={(value) => updateCompany('state', value)}><SelectTrigger className="w-full"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{states.map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}</SelectContent></Select></div></section>}
        {step === 1 && <section className="grid gap-4">{courts.map((court, index) => <article key={index} className="rounded-xl border p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[.14em]">Quadra {index + 1}</p>{courts.length > 1 && <Button type="button" variant="ghost" size="icon" aria-label={`Remover quadra ${index + 1}`} onClick={() => setCourts((current) => current.filter((_, i) => i !== index))}><X /></Button>}</div><div className="grid gap-4"><div className="grid gap-2"><Label htmlFor={`court-name-${index}`}>Nome *</Label><Input id={`court-name-${index}`} maxLength={80} placeholder={`Ex.: Society ${index + 1}`} value={court.name} onChange={(event) => updateCourt(index, { name: event.target.value })} /></div><fieldset className="grid gap-2"><legend className="text-sm font-medium">Esportes <span className="text-muted-foreground">(pode marcar mais de um)</span></legend><div className="flex flex-wrap gap-2">{sports.map((sport) => { const id = `sport-${index}-${sport}`; const checked = court.sports.includes(sport); return <Label key={sport} htmlFor={id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${checked ? 'border-primary bg-primary text-white' : 'border-border bg-background hover:bg-muted'}`}><Checkbox id={id} className="sr-only" checked={checked} onCheckedChange={(value) => toggleSport(index, sport, value === true)} />{sport}</Label>; })}</div></fieldset><div className="grid gap-3 sm:grid-cols-3"><div className="grid gap-2"><Label>Piso</Label><Select value={court.surface} onValueChange={(surface) => updateCourt(index, { surface })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{surfaces.map((surface) => <SelectItem key={surface} value={surface}>{surface}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>Cobertura</Label><Select value={court.covering} onValueChange={(covering) => updateCourt(index, { covering })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{coverings.map((covering) => <SelectItem key={covering} value={covering}>{covering}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label htmlFor={`players-${index}`}>Jogadores</Label><Input id={`players-${index}`} type="number" min={2} max={100} value={court.players} onChange={(event) => updateCourt(index, { players: event.target.value })} /></div></div></div></article>)}<Button type="button" variant="outline" className="w-full border-dashed" onClick={addCourt}><Plus /> Adicionar outra quadra</Button></section>}
        {step === 2 && <section className="grid gap-5"><article className="rounded-xl border p-4 sm:p-5"><p className="text-xs font-bold uppercase tracking-[.14em]">Horário de funcionamento</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>Abertura</Label><Select value={weeklyHours.find((day) => day.isOpen)?.openTime || '08:00'} onValueChange={(openTime) => setWeeklyHours((current) => current.map((day) => ({ ...day, openTime })))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{minutes.map((time) => <SelectItem key={time} value={time}>{time}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>Fechamento</Label><Select value={weeklyHours.find((day) => day.isOpen)?.closeTime || '23:00'} onValueChange={(closeTime) => setWeeklyHours((current) => current.map((day) => ({ ...day, closeTime })))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{minutes.filter((time) => time !== '06:00').map((time) => <SelectItem key={time} value={time}>{time}</SelectItem>)}</SelectContent></Select></div></div><div className="mt-4"><p className="mb-2 text-sm font-medium">Dias que a arena abre</p><div className="flex flex-wrap gap-2">{fullWeekdays.map((day, weekday) => <Label key={day} htmlFor={`weekday-${weekday}`} className={`cursor-pointer rounded-full px-3 py-2 text-xs font-semibold ${weeklyHours[weekday].isOpen ? 'bg-primary text-white' : 'border bg-background text-muted-foreground'}`}><Checkbox id={`weekday-${weekday}`} className="sr-only" checked={weeklyHours[weekday].isOpen} onCheckedChange={(checked) => toggleDay(weekday, checked === true)} />{weekdays[weekday]}</Label>)}</div><p className="mt-2 text-xs text-muted-foreground">Dias fechados não aparecem para reserva, nem no app nem no robô do WhatsApp.</p></div></article><article className="rounded-xl border bg-lime-50/50 p-4 sm:p-5"><Label htmlFor="apply-price" className="text-xs font-bold uppercase tracking-[.14em]">Preencher tudo com o mesmo preço</Label><div className="mt-3 flex gap-2"><div className="relative flex-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span><Input id="apply-price" inputMode="decimal" className="pl-10" value={applyPrice} onChange={(event) => setApplyPrice(event.target.value)} /></div><Button type="button" onClick={setAllPrices}>Aplicar a todos</Button></div></article><div className="overflow-hidden rounded-xl border"><div className="overflow-x-auto"><table className="w-full min-w-[610px] border-collapse text-left text-xs"><thead className="bg-muted text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground"><tr><th className="p-3">Faixa</th>{weekdays.map((day) => <th key={day} className="p-3">{day}</th>)}</tr></thead><tbody>{bands.map(({ key, label }) => <tr key={key} className="border-t"><th className="whitespace-nowrap p-2.5 font-medium">{label}</th>{prices.map((day) => <td key={day.weekday} className="p-1.5"><div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">R$</span><Input aria-label={`${label}, ${fullWeekdays[day.weekday]}`} inputMode="decimal" className="h-9 min-w-16 pl-8 text-xs" value={day[key]} onChange={(event) => updatePrice(day.weekday, key, event.target.value)} /></div></td>)}</tr>)}</tbody></table></div></div><p className="text-xs text-muted-foreground">Valores por hora. O valor mínimo é R$ 20.</p></section>}
        {step === 3 && <section className="grid gap-6"><div><h2 className="text-xs font-bold uppercase tracking-[.14em]">Fotos da arena</h2><p className="mt-1 text-xs text-muted-foreground">Você pode adicionar imagens agora ou depois em Configurações. Use links HTTPS públicos.</p><div className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr]"><div className="grid gap-2"><Label htmlFor="logo-url">Logo</Label><div className="grid aspect-square place-items-center rounded-xl border bg-muted/30 p-3 text-center">{company.logoUrl ? <img src={company.logoUrl} alt="Prévia do logo da arena" className="max-h-full max-w-full object-contain" /> : <Input id="logo-url" type="url" placeholder="Link HTTPS do logo" value={company.logoUrl} onChange={(event) => updateCompany('logoUrl', event.target.value)} />}</div>{company.logoUrl && <Input aria-label="Link HTTPS do logo" type="url" value={company.logoUrl} onChange={(event) => updateCompany('logoUrl', event.target.value)} />}</div><div className="grid gap-2"><Label>Fotos de capa</Label>{company.photos.map((photo, index) => <div key={index} className="flex gap-2"><Input type="url" aria-label={`Link HTTPS da foto ${index + 1}`} placeholder="https://..." value={photo} onChange={(event) => updateCompany('photos', company.photos.map((value, i) => i === index ? event.target.value : value))} /><Button type="button" size="icon" variant="ghost" aria-label={`Remover foto ${index + 1}`} onClick={() => updateCompany('photos', company.photos.filter((_, i) => i !== index))}><X /></Button></div>)}{company.photos.length < 6 && <Button type="button" variant="outline" className="w-fit" onClick={addPhoto}><Plus /> Adicionar foto</Button>}</div></div></div><div><h2 className="text-xs font-bold uppercase tracking-[.14em]">Descrição e comodidades</h2><div className="mt-3 grid gap-4"><div className="grid gap-2"><Label htmlFor="description">Sobre a arena</Label><Textarea id="description" rows={3} maxLength={600} value={company.description} onChange={(event) => updateCompany('description', event.target.value)} placeholder="Conte um pouco sobre a arena" /></div><fieldset><legend className="mb-2 text-sm font-medium">Estrutura e comodidades</legend><div className="grid gap-2 sm:grid-cols-2">{amenityOptions.map((amenity) => <Label key={amenity} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"><Checkbox checked={company.amenities.includes(amenity)} onCheckedChange={(checked) => updateCompany('amenities', checked === true ? [...company.amenities, amenity] : company.amenities.filter((item) => item !== amenity))} />{amenity}</Label>)}</div></fieldset></div></div><div><h2 className="text-xs font-bold uppercase tracking-[.14em]">Política de cancelamento</h2><div className="mt-3 grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="cancel-hours">Antecedência mínima (horas)</Label><Input id="cancel-hours" type="number" min={0} max={48} value={company.cancellationHours} onChange={(event) => updateCompany('cancellationHours', event.target.value)} /><p className="text-xs text-muted-foreground">Até 48 horas.</p></div><div className="grid gap-2"><Label htmlFor="cancel-fee">Multa por cancelamento (%)</Label><Input id="cancel-fee" type="number" min={0} max={20} value={company.cancellationFeePercent} onChange={(event) => updateCompany('cancellationFeePercent', event.target.value)} /><p className="text-xs text-muted-foreground">Até 20%.</p></div></div></div></section>}
        {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</p>}
        <footer className="mt-7 flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-between"><Button type="button" variant="outline" className="h-11 sm:min-w-40" disabled={step === 0 || saving} onClick={() => { setError(''); setStep((current) => current - 1); }}><ArrowLeft /> Voltar</Button><Button type="button" className="h-11 sm:min-w-64" disabled={saving} onClick={() => void next()}>{saving ? <LoaderCircle className="animate-spin" /> : step === steps.length - 1 ? <Sparkles /> : null}{step === steps.length - 1 ? 'Finalizar configuração' : `Próximo: ${steps[step + 1]} →`}{step < steps.length - 1 && <ArrowRight />}</Button></footer>
      </CardContent></Card><p className="mt-4 text-center text-xs text-muted-foreground">Você pode editar essas informações depois em Configurações.</p></div></main>;
}
