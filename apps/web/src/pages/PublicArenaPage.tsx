import { useCallback, useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown, ArrowUpRight, CalendarCheck, Car, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Copy, CupSoda, Info, Lightbulb,
  LoaderCircle, Lock, LogIn, MapPin, MessageCircle, Moon, MoveHorizontal, QrCode, ShieldCheck, Shirt, ShowerHead, Star, Sun, Sunrise, Trophy, Wifi, X, type LucideProps,
} from 'lucide-react';
import { Brand } from '@/components/Brand';
import { localDateValue } from '@/components/DatePicker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { durationLabel, errorMessage, formatCurrency, formatDate, initials, whatsappLink } from '@/lib/format';
import { cn } from '@/lib/utils';
import { firstStart, minDuration, rulesOf, ruleProblem, ruleProblemText, type CourtRules } from '@/lib/court-rules';

type Court = { id: string; name: string; sport: string; price_cents: number; photo_url: string | null; rules?: CourtRules; location?: { name: string; address: string; maps_url: string } };
/** Quadra em endereço próprio: "Unidade Centro — Rua A, 10". */
const placeOf = (c: Court) => c.location?.address ? (c.location.name ? `${c.location.name} — ${c.location.address}` : c.location.address) : '';
type Busy = { court_id: string; start_at: string; end_at: string };
type PriceSlot = { weekday: number; start_time: string; end_time: string; price_cents: number };
type Arena = { name: string; slug: string; description: string; address: string; city: string; state: string; amenities: string[]; photos: string[]; logo_url: string; whatsapp?: string };
type Tournament = { id: string; name: string; sport: string; category: string; start_date: string; entry_fee_cents: number; capacity: number; entries_count: number };
type Policy = { mode: 'full' | 'percent' | 'fixed'; percent: number; fixed_cents: number };
type PublicData = {
  arena: Arena; courts: Court[]; bookings: Busy[]; blocks: Busy[]; hours: { is_open: number | boolean; open_time: string; close_time: string };
  tournaments: Tournament[]; prices: PriceSlot[]; not_before: string; advance_payment?: Policy | null; max_duration_minutes?: number; pix_minutes?: number;
};
type Day = { date: string; open: boolean; has_free: boolean };
type Payment = { qr_code: string; qr_base64: string; amount_cents: number; total_amount_cents: number; expires_at: string | null; token: string };
type Done = { kind: 'pix'; bookingId: string; payment: Payment } | { kind: 'request' };

const STEP = 30, MIN_DURATION = 60, MAX_WEEKS = 8;
const inputClass = 'h-12 w-full rounded-xl border bg-white px-3.5 text-base outline-none focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20';
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso: string) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
const fmt = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...options }).format(new Date(`${iso}T12:00:00Z`));
const shortDay = (iso: string) => fmt(iso, { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
const brl = (cents: number) => formatCurrency(cents);
const maskPhone = (value: string) => { const d = value.replace(/\D/g, '').slice(0, 11); return d.length > 6 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d.length > 2 ? `(${d.slice(0, 2)}) ${d.slice(2)}` : d; };
const overlaps = (busy: Array<{ start: number; end: number }>, from: number, to: number) => busy.some((b) => b.start < to && b.end > from);
/** Mesma conta do servidor (payment-policy.ts): o valor mostrado é o que o Pix cobra. */
const signalOf = (total: number, policy: Policy | null | undefined) => {
  if (!policy || total <= 0) return 0;
  if (policy.mode === 'percent') return Math.min(total, Math.max(1, Math.round(total * policy.percent / 100)));
  if (policy.mode === 'fixed') return Math.min(total, policy.fixed_cents);
  return total;
};
const AMENITY_ICON: Array<[RegExp, ComponentType<LucideProps>]> = [[/estacion/i, Car], [/bar|lanch|cantina/i, CupSoda], [/chuveir|banho/i, ShowerHead], [/wi-?fi|internet/i, Wifi], [/vesti/i, Shirt], [/ilumin|luz/i, Lightbulb]];
const amenityIcon = (label: string) => AMENITY_ICON.find(([re]) => re.test(label))?.[1] || Check;

export function PublicArenaPage() {
  const { slug = '', token = '' } = useParams();
  const [search] = useSearchParams();
  const reviewToken = token || search.get('avaliar') || '';
  if (reviewToken) return <ReviewPage token={reviewToken} />;
  return <BookingPage slug={slug} />;
}

function BookingPage({ slug }: { slug: string }) {
  const today = localDateValue();
  const [date, setDate] = useState(today);
  const [week, setWeek] = useState(0);
  const [data, setData] = useState<PublicData | null>(null);
  const [todayHours, setTodayHours] = useState<PublicData['hours'] | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [courtId, setCourtId] = useState('');
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState('');
  const [pageError, setPageError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [notice, setNotice] = useState('');
  const picked = useRef(false);

  const load = useCallback(async (day: string) => {
    try { const d = await api<PublicData>(`/api/public/arenas/${encodeURIComponent(slug)}?date=${day}`); setData(d); if (day === today) setTodayHours(d.hours); setPageError(''); }
    catch (cause) { setPageError(errorMessage(cause)); }
  }, [slug, today]);
  const weekStart = addDays(mondayOf(today), week * 7);
  useEffect(() => { void load(date); }, [load, date]);
  useEffect(() => {
    let alive = true;
    api<{ days: Day[] }>(`/api/public/arenas/${encodeURIComponent(slug)}/days?from=${weekStart}`).then((r) => {
      if (!alive) return; setDays(r.days);
      // Abre já com hoje ou o próximo dia com vaga.
      if (!picked.current) { picked.current = true; const first = r.days.find((d) => d.date >= today && d.has_free); if (first && first.date !== today) setDate(first.date); }
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [slug, weekStart, today]);

  const court = data?.courts.find((c) => c.id === courtId);
  const busyFor = useCallback((id: string) => (data ? [...data.bookings, ...data.blocks].filter((b) => b.court_id === id && b.start_at.slice(0, 10) === date).map((b) => ({ start: toMin(b.start_at.slice(11, 16)), end: toMin(b.end_at.slice(11, 16)) })) : []), [data, date]);
  const open = data && data.hours.is_open ? toMin(data.hours.open_time) : 0, close = data && data.hours.is_open ? toMin(data.hours.close_time) : 0;
  const notBefore = data && date === today ? toMin(data.not_before) : 0;
  const maxDuration = data?.max_duration_minutes || 480;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const rulesFor = useCallback((id: string) => rulesOf(data?.courts.find((c) => c.id === id)?.rules), [data]);
  // Fins válidos: livres até ali e dentro das regras da quadra (só horas cheias, mínimo no horário nobre).
  const endsFor = useCallback((id: string, s: number) => {
    const busy = busyFor(id), rules = rulesFor(id), out: number[] = [];
    for (let e = s + STEP; e <= Math.min(s + maxDuration, close); e += STEP) { if (overlaps(busy, e - STEP, e)) break; if (e - s >= MIN_DURATION && !ruleProblem(rules, weekday, s, e, open)) out.push(e); }
    return out;
  }, [busyFor, rulesFor, open, close, maxDuration, weekday]);
  // Inícios: de 30 em 30 ou só horas cheias, e só os que têm pelo menos um fim válido.
  const startsFor = useCallback((id: string) => {
    if (!data?.hours.is_open) return [] as number[];
    const rules = rulesFor(id), step = rules.step, out: number[] = [];
    for (let t = firstStart(rules, Math.max(open, notBefore), open); t + MIN_DURATION <= close; t += step) if (endsFor(id, t).length) out.push(t);
    return out;
  }, [data, rulesFor, endsFor, open, close, notBefore]);
  // Preço real: faixas de preço da arena por meia hora (a noite pode custar diferente).
  const priceOf = useCallback((c: Court, s: number, e: number) => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); let total = 0;
    for (let m = s; m < e; m += STEP) { const key = hm(m), slot = data?.prices.find((p) => p.weekday === weekday && p.start_time <= key && key < p.end_time); total += Math.round((slot?.price_cents ?? c.price_cents) / 2); }
    return total;
  }, [data, date]);

  // Mudar dia/quadra/início mantém as escolhas seguintes só se continuarem válidas.
  useEffect(() => {
    if (!data) return;
    if (courtId && !data.courts.some((c) => c.id === courtId)) { setCourtId(''); setStart(null); setEnd(null); return; }
    if (courtId && start !== null && !startsFor(courtId).includes(start)) { setStart(null); setEnd(null); return; }
    if (courtId && start !== null && end !== null && !endsFor(courtId, start).includes(end)) setEnd(null);
  }, [data, courtId, start, end, startsFor, endsFor]);

  const total = court && start !== null && end !== null ? priceOf(court, start, end) : 0;
  const policy = data?.advance_payment || null, signal = signalOf(total, policy);
  const ready = Boolean(court && start !== null && end !== null);

  const goTo = (id: string) => { if (window.innerWidth < 1024) window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120); };
  const pickDay = (d: string) => { setDate(d); goTo(courtId ? (start === null ? 'passo-inicio' : end !== null ? 'passo-dados' : 'passo-fim') : 'passo-quadra'); };
  const pickCourt = (id: string) => { setCourtId(id); goTo(start === null ? 'passo-inicio' : end !== null ? 'passo-dados' : 'passo-fim'); };
  const pickStart = (m: number) => { setStart(m); goTo('passo-fim'); };
  const pickEnd = (m: number) => { setEnd(m); goTo('passo-dados'); };

  async function submit(event?: FormEvent) {
    event?.preventDefault(); setFormError('');
    if (!court || start === null || end === null) { setFormError('Escolha o dia, a quadra e o horário.'); return; }
    if (name.trim().length < 2) { setFormError('Informe seu nome.'); return; }
    if (phone.replace(/\D/g, '').length < 10) { setFormError('Informe o WhatsApp com DDD.'); return; }
    if (policy && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setFormError('Informe um e-mail válido para gerar o Pix.'); return; }
    setSaving(true);
    try {
      const r = await api<{ booking: { id: string }; payment: Payment | null }>(`/api/public/arenas/${encodeURIComponent(slug)}/bookings`, {
        method: 'POST', body: JSON.stringify({ courtId: court.id, customerName: name.trim(), customerPhone: phone, customerEmail: email.trim(), startAt: `${date}T${hm(start)}:00.000Z`, endAt: `${date}T${hm(end)}:00.000Z` }),
      });
      setDone(r.payment ? { kind: 'pix', bookingId: r.booking.id, payment: r.payment } : { kind: 'request' });
    } catch (cause) { setFormError(errorMessage(cause)); void load(date); }
    finally { setSaving(false); }
  }
  const closeDone = () => { setDone(null); setStart(null); setEnd(null); void load(date); };

  if (!data && !pageError) return <main className="grid min-h-svh place-items-center bg-muted"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></main>;
  if (!data) return <main className="grid min-h-svh place-items-center bg-muted p-6 text-center"><div><Brand /><p className="mt-6 text-muted-foreground">{pageError}</p></div></main>;

  const arena = data.arena, wa = whatsappLink(arena.whatsapp);
  const place = [arena.address, arena.city].filter(Boolean).join(', ') + (arena.state ? ` · ${arena.state}` : '');
  const openNow = (() => { if (!todayHours?.is_open) return false; const n = new Date(), now = n.getHours() * 60 + n.getMinutes(); return now >= toMin(todayHours.open_time) && now < toMin(todayHours.close_time); })();
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const months = [...new Set(weekDays.map((d) => fmt(d, { month: 'long' })))].join(' / ');
  const next: [string, string] = !courtId ? ['Escolha a quadra', 'passo-quadra'] : start === null ? ['Escolha o início', 'passo-inicio'] : end === null ? ['Escolha o fim', 'passo-fim'] : ['Seus dados', 'passo-dados'];
  const relDay = (d: string) => (d === today ? 'Hoje' : d === addDays(today, 1) ? 'Amanhã' : '');
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const form = <form className="space-y-3" noValidate onSubmit={(e) => void submit(e)}>
    <label className="block space-y-1.5"><span className="font-medium">Seu nome</span>
      <input className={inputClass} placeholder="Como devemos te chamar?" autoComplete="name" enterKeyHint="next" value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label className="block space-y-1.5"><span className="font-medium">WhatsApp</span>
      <span className="relative block"><span className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">+55</span>
        <input className={cn(inputClass, 'pl-12 tabular-nums')} type="tel" inputMode="tel" placeholder="(00) 00000-0000" autoComplete="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} /></span>
      <span className="block text-[12px] text-muted-foreground">A confirmação chega por aqui.</span></label>
    {policy && <label className="block space-y-1.5"><span className="font-medium">E-mail</span>
      <input className={inputClass} type="email" inputMode="email" placeholder="voce@email.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <span className="block text-[12px] text-muted-foreground">Usado só para gerar o Pix.</span></label>}
    {formError && <p role="alert" className="flex items-center gap-1.5 text-[13px] text-rose-600"><CircleAlert className="size-3.5" aria-hidden="true" />{formError}</p>}
    <button type="submit" disabled={!ready || saving} className="hidden h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-900 text-[15px] font-semibold text-white shadow-lg shadow-brand-900/20 hover:bg-brand-800 disabled:opacity-40 lg:flex">
      {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Lock className="size-4" aria-hidden="true" />}{!ready ? 'Escolha o horário' : policy ? `Reservar e pagar ${brl(signal)}` : 'Enviar pedido de reserva'}</button>
  </form>;

  return <div className="min-h-svh bg-muted text-sm text-foreground">
    <header className="sticky top-0 z-30 bg-brand-950 lg:border-b lg:bg-white/90 lg:backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 lg:h-16 lg:px-6">
        <span className="rounded-md bg-white px-2 py-1 [&_img]:h-6 lg:bg-transparent lg:p-0 lg:[&_img]:h-8"><Brand /></span>
        <a href="/login" className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-white/80 hover:bg-white/10 lg:text-brand-700 lg:hover:bg-brand-50"><LogIn className="size-4" aria-hidden="true" />Sou da arena</a>
      </div>
    </header>

    <section className="relative overflow-hidden bg-brand-950 text-white">
      <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgb(255_255_255/.05)_1px,transparent_1px),linear-gradient(rgb(255_255_255/.05)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="relative mx-auto max-w-6xl px-4 pt-4 pb-16 lg:px-6 lg:pt-10 lg:pb-24">
        <div className="flex items-center gap-3">
          <div className="size-14 shrink-0 rounded-2xl bg-white p-1 shadow-lg lg:size-20">
            {arena.logo_url ? <img src={arena.logo_url} alt="" className="size-full rounded-xl object-contain" /> : <span className="grid size-full place-items-center rounded-xl bg-brand-900 text-lg font-extrabold text-lime-400 lg:text-2xl">{initials(arena.name)}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><h1 className="truncate text-2xl font-extrabold tracking-tight lg:text-4xl">{arena.name}</h1><span className="shrink-0 rounded-full bg-lime-400 px-2 py-0.5 text-[10.5px] font-semibold text-brand-950">Arena</span></div>
            {todayHours && <div className="mt-0.5 inline-flex items-center gap-1.5 text-[12.5px] text-white/80"><span className={cn('size-1.5 rounded-full', openNow ? 'animate-pulse bg-lime-400' : 'bg-rose-400')} aria-hidden="true" />{openNow ? 'Aberta agora' : 'Fechada agora'}{todayHours.is_open ? ` · ${todayHours.open_time}–${todayHours.close_time}` : ''}</div>}
          </div>
          {wa && <a href={wa} target="_blank" rel="noreferrer" aria-label="WhatsApp da arena" className="grid size-11 shrink-0 place-items-center gap-2 rounded-xl bg-[#25D366] font-semibold text-white lg:inline-flex lg:h-11 lg:w-auto lg:px-4"><MessageCircle className="size-5" aria-hidden="true" /><span className="hidden lg:inline">WhatsApp</span></a>}
        </div>
        {arena.description && <p className="mt-3 text-[14px] text-white/75 lg:text-[15px]">{arena.description}</p>}
        {place.trim() && <a href={`https://maps.google.com/?q=${encodeURIComponent(place)}`} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] text-white/80 hover:text-white"><MapPin className="size-4" aria-hidden="true" />{place}<ArrowUpRight className="size-3 opacity-60" aria-hidden="true" /></a>}
        {arena.amenities.length > 0 && <ul className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">{arena.amenities.map((a) => { const Icon = amenityIcon(a); return <li key={a} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[.06] px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap"><Icon className="size-3.5 text-lime-300" aria-hidden="true" />{a}</li>; })}</ul>}
      </div>
    </section>

    <main className="relative mx-auto -mt-10 max-w-6xl px-3 pb-36 sm:px-4 lg:-mt-14 lg:px-6 lg:pb-16">
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_380px] lg:gap-5">
        <div className="min-w-0 space-y-3 lg:space-y-4">
          <Step id="passo-dia" n={1} title="Qual dia?" done={relDay(date) ? `${relDay(date)}, ${fmt(date, { day: '2-digit', month: '2-digit' })}` : shortDay(date)}>
            <div className="mb-2 flex items-center gap-2">
              <button type="button" onClick={() => setWeek((w) => Math.max(0, w - 1))} disabled={week === 0} aria-label="Semana anterior" className="grid size-9 place-items-center rounded-full border bg-white active:scale-95 disabled:opacity-30"><ChevronLeft className="size-4" /></button>
              <div className="flex-1 text-center text-[13px] font-semibold first-letter:uppercase">{months} <span className="font-normal text-muted-foreground">{weekDays[6]!.slice(0, 4)}</span></div>
              <button type="button" onClick={() => setWeek((w) => Math.min(MAX_WEEKS, w + 1))} disabled={week === MAX_WEEKS} aria-label="Próxima semana" className="grid size-9 place-items-center rounded-full border bg-white active:scale-95 disabled:opacity-30"><ChevronRight className="size-4" /></button>
            </div>
            <WeekSwipe onSwipe={(dir) => setWeek((w) => Math.max(0, Math.min(MAX_WEEKS, w + dir)))}>
              <div className="grid grid-cols-7 gap-1">
                {weekDays.map((d) => {
                  const info = days.find((x) => x.date === d), free = Boolean(info?.has_free), sel = d === date, isToday = d === today;
                  return <button key={d} type="button" onClick={() => pickDay(d)} disabled={!free && !sel} aria-pressed={sel} aria-label={`${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}${free ? '' : ', indisponível'}`} className={cn('flex flex-col items-center gap-1 rounded-2xl py-1.5 transition active:scale-95', free && !sel && 'hover:bg-muted')}>
                    <span className={cn('text-[11px] font-semibold uppercase', sel ? 'text-brand-700' : free ? 'text-muted-foreground' : 'text-muted-foreground/40')}>{fmt(d, { weekday: 'short' }).slice(0, 3).replace('.', '')}</span>
                    <span className={cn('grid size-10 place-items-center rounded-full text-[16px] font-bold tabular-nums', sel ? 'bg-brand-900 text-white shadow-md' : isToday ? 'text-brand-700 ring-2 ring-brand-500' : free ? '' : 'text-muted-foreground/35 line-through')}>{Number(d.slice(8))}</span>
                    <span aria-hidden="true" className={cn('size-1 rounded-full', free ? (sel ? 'bg-lime-400' : 'bg-brand-500') : 'bg-transparent')} />
                  </button>;
                })}
              </div>
            </WeekSwipe>
            <div className="mt-2 flex items-center justify-center gap-4 text-[11.5px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-brand-500" aria-hidden="true" />Tem horário livre</span>
              <span className="flex items-center gap-1.5"><span className="size-3 rounded-full ring-2 ring-brand-500" aria-hidden="true" />Hoje</span>
            </div>
            {!data.hours.is_open && <p className="mt-2 text-center text-[13px] text-muted-foreground">A arena não abre neste dia.</p>}
          </Step>

          <Step id="passo-quadra" n={2} title="Qual quadra?" done={court?.name}>
            <div className="grid gap-2 sm:grid-cols-3 sm:gap-3" role="radiogroup" aria-label="Quadra">
              {data.courts.map((c) => {
                const sel = c.id === courtId, n = startsFor(c.id).length;
                return <button key={c.id} type="button" role="radio" aria-checked={sel} disabled={!n} onClick={() => pickCourt(c.id)} className={cn('flex items-center overflow-hidden rounded-2xl border-2 text-left transition active:scale-[.98] disabled:opacity-50 sm:block', sel ? 'border-brand-600 bg-brand-50/60 ring-4 ring-brand-500/10' : 'border-border bg-white hover:border-brand-400')}>
                  <div className="relative m-2 size-20 shrink-0 overflow-hidden rounded-xl bg-brand-50 sm:m-0 sm:h-28 sm:w-full sm:rounded-none">
                    {c.photo_url ? <img src={c.photo_url} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-brand-600"><CalendarCheck className="size-6" aria-hidden="true" /></span>}
                  </div>
                  <div className="flex flex-1 items-center justify-between gap-2 p-2 pr-3 sm:items-end sm:p-3">
                    <div className="min-w-0"><div className="text-[15px] font-semibold">{c.name}</div><div className="text-[12.5px] text-muted-foreground">{c.sport}</div>
                      {placeOf(c) && <div className="mt-0.5 flex items-start gap-1 text-[11.5px] text-muted-foreground"><MapPin className="mt-px size-3 shrink-0" aria-hidden="true" /><span className="line-clamp-2">{placeOf(c)}</span></div>}
                      <div className={cn('mt-0.5 text-[12px]', n ? 'font-medium text-brand-600' : 'text-muted-foreground')}>{n ? 'Horários livres' : 'Lotada neste dia'}</div></div>
                    <div className="shrink-0 text-right"><div className="font-bold tabular-nums">{brl(c.price_cents).replace(',00', '')}</div><div className="text-[11px] text-muted-foreground">por hora</div></div>
                    <span aria-hidden="true" className={cn('grid size-6 shrink-0 place-items-center rounded-full border-2 sm:hidden', sel ? 'border-brand-900 bg-brand-900 text-lime-400' : 'border-border')}>{sel && <Check className="size-3.5" />}</span>
                  </div>
                </button>;
              })}
            </div>
            {court && placeOf(court) && <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-brand-50 px-3 py-2 text-[12.5px] text-brand-900"><MapPin className="size-3.5 shrink-0" aria-hidden="true" /><span>A {court.name} fica em <b>{placeOf(court)}</b>.</span>
              {court.location?.maps_url && <a href={court.location.maps_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-brand-700 underline-offset-2 hover:underline">Ver no mapa<ArrowUpRight className="size-3.5" aria-hidden="true" /></a>}</p>}
          </Step>

          <Step id="passo-inicio" n={3} title="Que horas começa?" done={start !== null ? `às ${hm(start)}` : ''} locked={!courtId} lockedText="Escolha o dia e a quadra primeiro.">
            <div className="space-y-4">
              {([['Manhã', Sunrise, 0, 720], ['Tarde', Sun, 720, 1080], ['Noite', Moon, 1080, 1440]] as const).map(([label, Icon, a, b]) => {
                // Só inícios que ainda podem acontecer (não passados e com 1h antes de fechar); riscado = ocupado.
                const starts = startsFor(courtId), step = rulesFor(courtId).step, slots: number[] = []; for (let t = firstStart(rulesFor(courtId), Math.max(a, open, notBefore), open); t < b && t + minDuration(rulesFor(courtId)) <= close; t += step) slots.push(t);
                if (!slots.length) return null;
                if (!slots.some((t) => starts.includes(t))) return <div key={label} className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-muted-foreground/60 uppercase"><Icon className="size-3.5" aria-hidden="true" />{label} · sem horários</div>;
                return <div key={label}><div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase"><Icon className="size-3.5" aria-hidden="true" />{label}</div>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{slots.map((t) => { const ok = starts.includes(t), sel = start === t; return <button key={t} type="button" disabled={!ok} aria-pressed={sel} onClick={() => pickStart(t)} className={cn('h-11 rounded-xl border-2 text-[14px] font-semibold tabular-nums transition active:scale-95', sel ? 'border-brand-900 bg-brand-900 text-white shadow-md' : ok ? 'border-border bg-white hover:border-brand-500' : 'border-transparent bg-muted text-muted-foreground/40 line-through')}>{hm(t)}</button>; })}</div></div>;
              })}
              {startsFor(courtId).length > 0 && <p className="text-[12px] text-muted-foreground">Horários <span className="line-through">riscados</span> já estão reservados.</p>}
            </div>
          </Step>

          <Step id="passo-fim" n={4} title="Até que horas?" done={end !== null && start !== null ? `${hm(end)} · ${durationLabel(end - start)}` : ''} locked={start === null} lockedText={maxDuration === 60 ? "Cada reserva tem 1h." : `Você pode jogar de 1h a ${durationLabel(maxDuration)}.`}>
            {court && start !== null && (() => {
              const ends = endsFor(court.id, start), last = ends.at(-1) ?? start, cut = start + maxDuration > last;
              const why = !cut ? '' : last >= close ? `A arena fecha às ${hm(close)}.` : `A quadra está reservada a partir das ${hm(last)}.`;
              // Regra da quadra que explica por que não há 1h (ou 1h30) para esse início.
              const rules = rulesFor(court.id), shortest = ruleProblem(rules, weekday, start, start + 60, open) ?? ruleProblem(rules, weekday, start, start + 90, open);
              const ruleNote = shortest ? ruleProblemText(shortest, court.name) : '';
              return <>
                <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-4 lg:px-0" role="radiogroup" aria-label="Horário de fim">
                  {ends.map((e) => { const sel = end === e; return <button key={e} type="button" role="radio" aria-checked={sel} onClick={() => pickEnd(e)} className={cn('w-[104px] shrink-0 snap-start rounded-2xl border-2 px-3 py-2.5 text-left transition active:scale-95 lg:w-auto', sel ? 'border-brand-900 bg-brand-900 text-white shadow-md' : 'border-border bg-white hover:border-brand-500')}>
                    <div className="text-[18px] leading-tight font-bold tabular-nums">{hm(e)}</div>
                    <div className={cn('text-[12px] font-medium', sel ? 'text-lime-300' : 'text-brand-700')}>{durationLabel(e - start)}</div>
                    <div className={cn('text-[11.5px] tabular-nums', sel ? 'text-white/70' : 'text-muted-foreground')}>{brl(priceOf(court, start, e))}</div>
                  </button>; })}
                </div>
                {ruleNote && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[12.5px] text-amber-900"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{ruleNote}</p>}
                {why ? <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><Info className="size-3.5" aria-hidden="true" />{why}</p>
                  : ends.length > 3 && <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground lg:hidden"><MoveHorizontal className="size-3.5" aria-hidden="true" />Arraste para ver até {durationLabel(last - start)} de jogo</p>}
              </>;
            })()}
          </Step>

          <div className="lg:hidden"><Step id="passo-dados" n={5} title="Seus dados" locked={!ready} lockedText="Escolha o horário primeiro.">{form}</Step></div>

          <section className="rounded-2xl border bg-white p-4 shadow-xs lg:p-6">
            <h2 className="text-base font-semibold">Como funciona</h2>
            <ol className="mt-3 grid gap-3 sm:grid-cols-3">
              <HowItem icon={CalendarCheck} title="Escolha o horário" text={maxDuration === 60 ? "Reservas de 1h, só aparecem horários livres." : `De 1h a ${durationLabel(maxDuration)}, só aparecem horários livres.`} />
              {policy ? <HowItem icon={QrCode} title={policy.mode === 'full' ? 'Pague no Pix' : 'Pague o sinal no Pix'} text={`O horário fica guardado por ${data.pix_minutes || 15} minutos até o pagamento.`} />
                : <HowItem icon={CircleCheck} title="A arena confirma" text="Sem pagamento antecipado: a equipe confirma o pedido." />}
              <HowItem icon={MessageCircle} title="Confirmação no WhatsApp" text={policy && policy.mode !== 'full' ? 'O restante é pago na arena, no dia.' : 'Você recebe tudo pelo WhatsApp.'} />
            </ol>
          </section>

          {arena.photos?.length > 0 && <section className="rounded-2xl border bg-white p-4 shadow-xs lg:p-6"><h2 className="text-base font-semibold">Fotos da arena</h2>
            <div className="-mx-4 mt-3 flex snap-x gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-4 lg:px-0">{arena.photos.slice(0, 8).map((p, i) => <img key={p} src={p} alt={`Foto ${i + 1} de ${arena.name}`} className="h-40 w-64 shrink-0 snap-start rounded-xl object-cover lg:w-full" />)}</div></section>}

          {data.tournaments.length > 0 && <Tournaments tournaments={data.tournaments} onDone={(msg) => { setNotice(msg); void load(date); }} />}
          {notice && <p role="status" className="rounded-xl bg-brand-50 p-3 text-[13px] text-brand-900">{notice}</p>}
        </div>

        <aside className="hidden overflow-hidden rounded-2xl border bg-white shadow-xs lg:sticky lg:top-24 lg:block" aria-label="Resumo da reserva">
          <div className="bg-brand-950 px-5 pt-5 pb-4 text-white">
            <div className="text-[12px] font-medium tracking-wide text-white/60 uppercase">Sua reserva</div>
            <div className="mt-0.5 text-lg font-bold">{court ? <>{court.name} <span className="text-sm font-normal text-white/60">· {court.sport}</span></> : 'Monte sua reserva'}</div>
          </div>
          <dl className="divide-y px-5">
            <SummaryRow label="Dia" value={shortDay(date)} />
            <SummaryRow label="Horário" value={start !== null ? `${hm(start)} – ${end !== null ? hm(end) : '?'}` : '—'} />
            <SummaryRow label="Duração" value={start !== null && end !== null ? durationLabel(end - start) : '—'} />
          </dl>
          {ready && start !== null && end !== null ? <div className="mx-5 my-3 space-y-1.5 rounded-xl bg-muted p-3.5 text-[13px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Total ({durationLabel(end - start)})</span><span className="font-medium tabular-nums">{brl(total)}</span></div>
            {policy ? <>
              {total - signal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Restante, pago na arena</span><span className="tabular-nums">{brl(total - signal)}</span></div>}
              <div className="flex items-center justify-between border-t pt-1.5"><span className="flex items-center gap-1.5 font-semibold"><QrCode className="size-3.5 text-brand-600" aria-hidden="true" />{signal < total ? 'Sinal agora no Pix' : 'Pix agora'}</span><span className="text-base font-bold text-brand-700 tabular-nums">{brl(signal)}</span></div>
            </> : <div className="border-t pt-1.5 text-muted-foreground">Pago na arena. A equipe confirma o pedido.</div>}
          </div> : <div className="h-3" />}
          <div className="px-5 pb-5">{form}</div>
        </aside>
      </div>
    </main>

    <footer className="border-t bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-2 px-4 py-5 pb-36 text-[12.5px] text-muted-foreground lg:px-6 lg:pb-5">
        <span>Reservas por <b className="font-semibold text-foreground">QuadrasFlow</b></span>
        {policy && <span className="flex items-center gap-1.5 lg:ml-auto"><ShieldCheck className="size-4 text-brand-600" aria-hidden="true" />Pix com confirmação automática</span>}
      </div>
    </footer>

    <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white px-4 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/.06)] lg:hidden">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {ready && court && start !== null && end !== null ? <><div className="truncate text-[12px] text-muted-foreground">{court.name} · {shortDay(date)} · {hm(start)}–{hm(end)}</div>
            <div className="flex items-baseline gap-1.5"><span className="text-lg font-bold tabular-nums">{brl(total)}</span>{policy && signal < total && <span className="text-[12px] whitespace-nowrap text-muted-foreground">sinal {brl(signal)}</span>}</div></>
            : <><div className="flex gap-1" aria-hidden="true">{[Boolean(courtId), start !== null, end !== null, false].map((v, i) => <span key={i} className={cn('h-1.5 w-6 rounded-full', v ? 'bg-brand-500' : 'bg-border')} />)}</div><div className="mt-1 text-[13px] font-medium">{next[0]}</div></>}
        </div>
        {ready ? <button type="button" disabled={saving} onClick={() => { if (name.trim() && phone && (!policy || email.trim())) void submit(); else scrollTo('passo-dados'); }} className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand-900 px-5 text-[15px] font-semibold text-white shadow-lg shadow-brand-900/25 disabled:opacity-50">
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Lock className="size-4" aria-hidden="true" />}{policy ? `Pagar ${brl(signal)}` : 'Enviar pedido'}</button>
          : <button type="button" onClick={() => scrollTo(next[1])} className="inline-flex h-12 items-center gap-2 rounded-xl bg-muted px-5 text-[15px] font-semibold">Continuar<ArrowDown className="size-4" aria-hidden="true" /></button>}
      </div>
    </div>

    {done && court && start !== null && end !== null && <DonePanel slug={slug} done={done} phone={phone} summary={`${court.name} · ${shortDay(date)} · ${hm(start)}–${hm(end)} (${durationLabel(end - start)})`} total={total} onClose={closeDone} />}
  </div>;
}

function Step({ id, n, title, done, locked, lockedText, children }: { id: string; n: number; title: string; done?: string | undefined; locked?: boolean; lockedText?: string; children: ReactNode }) {
  return <section id={id} aria-labelledby={`${id}-titulo`} className={cn('scroll-mt-20 rounded-2xl border bg-white p-4 shadow-xs lg:p-6', locked && 'opacity-60')}>
    <div className="flex items-center gap-3">
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold', done ? 'bg-lime-400 text-brand-950' : 'bg-brand-900 text-lime-400')} aria-hidden="true">{done ? <Check className="size-3.5" /> : n}</span>
      <h2 id={`${id}-titulo`} className="min-w-0 flex-1 text-[15px] font-semibold lg:text-base">{title}</h2>
      {done && <span className="max-w-[45%] truncate text-[13px] font-semibold text-brand-700 first-letter:uppercase">{done}</span>}
    </div>
    <div className="mt-3">{locked ? <p className="text-[13px] text-muted-foreground">{lockedText}</p> : children}</div>
  </section>;
}
function HowItem({ icon: Icon, title, text }: { icon: ComponentType<LucideProps>; title: string; text: string }) {
  return <li className="flex gap-3 sm:flex-col"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><Icon className="size-4" aria-hidden="true" /></span><div><div className="font-medium">{title}</div><div className="text-[13px] text-muted-foreground">{text}</div></div></li>;
}
function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center gap-3 py-2.5"><dt className="flex-1 text-muted-foreground">{label}</dt><dd className="text-right font-medium first-letter:uppercase">{value}</dd></div>;
}
function WeekSwipe({ onSwipe, children }: { onSwipe: (dir: number) => void; children: ReactNode }) {
  const x = useRef<number | null>(null);
  return <div onTouchStart={(e) => { x.current = e.touches[0]?.clientX ?? null; }} onTouchEnd={(e) => { if (x.current === null) return; const dx = (e.changedTouches[0]?.clientX ?? x.current) - x.current; x.current = null; if (Math.abs(dx) > 50) onSwipe(dx < 0 ? 1 : -1); }}>{children}</div>;
}

/** Depois de enviar: Pix com contagem regressiva e confirmação automática, ou aviso de pedido enviado. */
function DonePanel({ slug, done, phone, summary, total, onClose }: { slug: string; done: Done; phone: string; summary: string; total: number; onClose: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [state, setState] = useState<'waiting' | 'paid' | 'expired'>('waiting');
  const [copied, setCopied] = useState(false);
  const expiresAt = done.kind === 'pix' && done.payment.expires_at ? Date.parse(done.payment.expires_at) : 0;
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => {
    if (done.kind !== 'pix' || state !== 'waiting') return;
    const check = () => api<{ status: string; paid: boolean }>(`/api/public/arenas/${encodeURIComponent(slug)}/bookings/${done.bookingId}/payment?token=${encodeURIComponent(done.payment.token)}`)
      .then((r) => { if (r.paid || r.status === 'confirmed') setState('paid'); else if (r.status === 'cancelled') setState('expired'); }).catch(() => undefined);
    const t = window.setInterval(check, 5000); return () => window.clearInterval(t);
  }, [done, slug, state]);
  useEffect(() => { if (state === 'waiting' && expiresAt && now > expiresAt + 90000) setState('expired'); }, [now, expiresAt, state]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', esc); document.body.style.overflow = 'hidden'; return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; }; }, [onClose]);
  const left = Math.max(0, expiresAt - now), mm = String(Math.floor(left / 60000)).padStart(2, '0'), ss = String(Math.floor(left % 60000 / 1000)).padStart(2, '0');
  const balance = done.kind === 'pix' ? done.payment.total_amount_cents - done.payment.amount_cents : 0;
  const badge = (tone: string, text: string, icon?: ReactNode) => <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium', tone)}>{icon}{text}</span>;

  return <div className="fixed inset-0 z-50 grid place-items-end bg-brand-950/50 backdrop-blur-[2px] sm:place-items-center sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="pix-titulo" className="max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-w-md sm:rounded-2xl">
      <div className="flex justify-center pt-2.5 sm:hidden"><span className="h-1 w-10 rounded-full bg-border" /></div>
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            {done.kind === 'request' ? badge('border-brand-100 bg-brand-50 text-brand-800', 'Pedido enviado', <CircleCheck className="size-3" aria-hidden="true" />)
              : state === 'paid' ? badge('border-brand-100 bg-brand-50 text-brand-800', 'Pagamento confirmado', <CircleCheck className="size-3" aria-hidden="true" />)
                : state === 'expired' ? badge('border-rose-200 bg-rose-50 text-rose-700', 'Pix expirado')
                  : badge('border-amber-200 bg-amber-50 text-amber-800', 'Aguardando pagamento', <span className="size-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />)}
            <h3 id="pix-titulo" className="mt-2 text-lg font-bold">{done.kind === 'request' ? 'A arena vai confirmar sua reserva' : state === 'paid' ? 'Reserva confirmada! 🎉' : state === 'expired' ? 'O prazo do Pix acabou' : balance > 0 ? 'Pague o sinal para confirmar' : 'Pague pelo Pix para confirmar'}</h3>
            <p className="text-[13px] text-muted-foreground first-letter:uppercase">{summary}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
        </div>

        {done.kind === 'request' && <p className="mt-4 rounded-2xl bg-muted p-4 text-[13.5px]">Recebemos seu pedido. A confirmação chega no WhatsApp <b className="font-medium">{phone}</b>. O pagamento de {brl(total)} é feito na arena.</p>}

        {done.kind === 'pix' && state === 'waiting' && <>
          <div className="mt-4 flex flex-col items-center rounded-2xl bg-muted p-4">
            <div className="text-3xl font-extrabold text-brand-700 tabular-nums">{brl(done.payment.amount_cents)}</div>
            {expiresAt > 0 && <div className="text-[13px] text-muted-foreground tabular-nums">Horário segurado por {mm}:{ss}</div>}
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(done.payment.qr_code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }); }} className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-900 text-[15px] font-semibold text-white hover:bg-brand-800">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" aria-hidden="true" />}{copied ? 'Código copiado' : 'Copiar código Pix'}</button>
            <p className="mt-2 text-center text-[12px] text-muted-foreground">Cole no app do seu banco em <b className="font-medium text-foreground">Pix copia e cola</b>.</p>
          </div>
          {done.payment.qr_base64 && <details className="group mt-3 rounded-xl border">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium"><QrCode className="size-4" aria-hidden="true" />Pagar com QR Code<ChevronDown className="ml-auto size-4 transition group-open:rotate-180" aria-hidden="true" /></summary>
            <div className="flex justify-center px-4 pb-4"><img src={`data:image/png;base64,${done.payment.qr_base64}`} alt="QR Code do Pix" className="size-48 rounded-xl border bg-white p-2" /></div>
          </details>}
          <p className="mt-4 flex gap-3 text-[13px] text-muted-foreground"><MessageCircle className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden="true" />
            <span>Assim que o Pix cair, esta tela confirma sozinha e você recebe a confirmação no WhatsApp <b className="font-medium text-foreground">{phone}</b>.{balance > 0 ? ` O restante, ${brl(balance)}, é pago na arena.` : ''} Se o pagamento não for feito no prazo, o horário é liberado.</span></p>
        </>}

        {done.kind === 'pix' && state === 'paid' && <p className="mt-4 rounded-2xl bg-brand-50 p-4 text-[13.5px] text-brand-900">Recebemos o seu Pix e a reserva está garantida. Os detalhes também foram enviados para o WhatsApp <b className="font-medium">{phone}</b>.{balance > 0 ? ` O restante, ${brl(balance)}, é pago na arena.` : ''}</p>}
        {done.kind === 'pix' && state === 'expired' && <p className="mt-4 rounded-2xl bg-rose-50 p-4 text-[13.5px] text-rose-800">O Pix não foi pago dentro do prazo e o horário foi liberado. Se ainda quiser jogar, faça um novo pedido.</p>}
        {(done.kind === 'request' || state !== 'waiting') && <Button className="mt-3 h-12 w-full" onClick={onClose}>{state === 'expired' ? 'Fazer novo pedido' : 'Fechar'}</Button>}
      </div>
    </div>
  </div>;
}

function Tournaments({ tournaments, onDone }: { tournaments: Tournament[]; onDone: (message: string) => void }) {
  async function register(id: string) {
    const name = window.prompt('Seu nome completo:'); if (!name) return;
    const phone = window.prompt('Seu WhatsApp com DDD:'); if (!phone) return;
    try { const r = await api<{ payment_required: boolean; entry_fee_cents: number }>(`/api/public/tournaments/${id}/entries`, { method: 'POST', body: JSON.stringify({ name, phone }) }); onDone(r.payment_required ? `Inscrição registrada. A taxa é ${formatCurrency(r.entry_fee_cents)}; a arena enviará as instruções de pagamento.` : 'Inscrição registrada com sucesso.'); }
    catch (cause) { onDone(errorMessage(cause)); }
  }
  return <section className="rounded-2xl border bg-white p-4 shadow-xs lg:p-6"><h2 className="flex items-center gap-2 text-base font-semibold"><Trophy className="size-4 text-brand-600" aria-hidden="true" />Torneios com inscrições abertas</h2>
    <ul className="mt-3 divide-y">{tournaments.map((t) => { const full = t.entries_count >= t.capacity; return <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1"><div className="font-medium">{t.name}</div><div className="text-[12.5px] text-muted-foreground">{t.sport}{t.category ? ` · ${t.category}` : ''} · {formatDate(t.start_date)} · {t.entry_fee_cents ? formatCurrency(t.entry_fee_cents) : 'grátis'} · {t.entries_count}/{t.capacity} vagas</div></div>
      <Button variant="outline" disabled={full} onClick={() => void register(t.id)}>{full ? 'Esgotado' : 'Inscrever-se'}</Button>
    </li>; })}</ul></section>;
}

function ReviewPage({ token }: { token: string }) {
  const [review, setReview] = useState<{ arena: string; customer: string; date: string; submitted: boolean } | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api<{ arena: string; customer: string; date: string; submitted: boolean }>(`/api/public/reviews/${encodeURIComponent(token)}`).then(setReview).catch((e) => setError(errorMessage(e))); }, [token]);
  async function send(e: FormEvent) { e.preventDefault(); try { await api(`/api/public/reviews/${encodeURIComponent(token)}`, { method: 'POST', body: JSON.stringify({ rating, comment }) }); setReview((x) => (x ? { ...x, submitted: true } : x)); } catch (cause) { setError(errorMessage(cause)); } }
  if (!review && !error) return <main className="grid min-h-svh place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></main>;
  return <main className="min-h-svh p-5"><div className="mx-auto max-w-xl"><header className="my-6 flex justify-center"><Brand /></header>
    <Card><CardHeader><CardTitle>Avalie sua experiência</CardTitle>{review && <p className="text-sm text-muted-foreground">{review.arena} · Reserva em {formatDate(review.date)}</p>}</CardHeader>
      <CardContent>{!review ? <p role="alert" className="text-sm text-red-700">{error}</p> : review.submitted ? <p className="py-6 text-center">Esta avaliação já foi enviada. Obrigado!</p>
        : <form className="grid gap-4" onSubmit={(e) => void send(e)}><p className="text-sm">Olá, {review.customer}. Como foi sua experiência?</p>
          <div className="flex gap-2" role="radiogroup" aria-label="Nota">{[1, 2, 3, 4, 5].map((n) => <Button key={n} type="button" variant="ghost" size="icon" aria-label={`${n} estrelas`} aria-pressed={rating === n} onClick={() => setRating(n)}><Star className={rating >= n ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground'} /></Button>)}</div>
          <Textarea maxLength={1000} placeholder="Conte como foi (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}<Button disabled={!rating}>Enviar avaliação</Button></form>}</CardContent></Card></div></main>;
}
