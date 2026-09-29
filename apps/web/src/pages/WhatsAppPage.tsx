import { useEffect, useMemo, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Banknote, BellRing, Bot, Check, ChevronRight, CircleDollarSign, Clock, Copy, CreditCard, FileText, Hand, Headset, Info, LoaderCircle, MessageCircle,
  MessagesSquare, Pencil, Percent, Phone, Plus, QrCode, Send, Smartphone, Trash2, TriangleAlert, Workflow, X, type LucideProps,
} from 'lucide-react';
import { toast } from 'sonner';
import { WhatsAppServices } from '@/components/WhatsAppServices';
import { EmptyState, PageHeader, Panel } from '@/components/app/page';
import { ResponsiveSheet } from '@/components/app/ResponsiveSheet';
import { ToneBadge, type Tone } from '@/components/app/status';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/auth/AuthProvider';
import { ApiError, api } from '@/lib/api';
import { errorMessage, formatCurrency, formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';

type Config = { session: string; enabled: boolean; status: string; connected: boolean; serviceConfigured: boolean; aiConfigured: boolean; webhookUrl: string };
type PaymentMode = 'none' | 'full' | 'percent' | 'fixed';
type BotConfig = { paymentMode: PaymentMode; paymentPercent: number; paymentFixedCents: number; timeZone: string; enabled: boolean; testMode: boolean; testPhones: string[]; welcome: string; handoffMessage: string; reactivateAfterHours: number; humanStart: string; humanEnd: string; outsideHoursMessage: string; notifyPayment: boolean; remindUnpaid: boolean; menuOptions: { id: string; label: string; response: string }[]; aiConfigured?: boolean; aiModel?: string };
type Conversation = { phone: string; step: string; updated_at: string; last_message: string };
type Message = { direction: string; body: string; created_at: string };
type Template = { id: string; title: string; category: string; body: string; active: boolean | number };
type Tab = 'config' | 'services' | 'conversas' | 'modelos';

const defaultBot: BotConfig = { paymentMode: 'none', paymentPercent: 50, paymentFixedCents: 5000, timeZone: '', enabled: true, testMode: false, testPhones: [], welcome: 'Como posso te ajudar?\n1 – Agendar horário\n2 – Falar com atendente.', handoffMessage: 'Certo! Me conta rapidinho o que você precisa que já encaminho para o responsável. 👇', reactivateAfterHours: 4, humanStart: '06:00', humanEnd: '23:00', outsideHoursMessage: 'No momento estamos fora do horário de atendimento humano. Você pode agendar pelo nosso app. 😊', notifyPayment: true, remindUnpaid: true, menuOptions: [] };
const ZONES = ['America/Noronha', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Maceio', 'America/Bahia', 'America/Santarem', 'America/Araguaina', 'America/Sao_Paulo', 'America/Campo_Grande', 'America/Cuiaba', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Manaus', 'America/Eirunepe', 'America/Rio_Branco'];
const FLOW: Array<[string, string]> = [['Menu', 'bg-brand-50 text-brand-700 border-brand-100'], ['Data', 'bg-sky-50 text-sky-700 border-sky-100'], ['Horário', 'bg-violet-50 text-violet-700 border-violet-100'], ['Duração', 'bg-amber-50 text-amber-700 border-amber-100'], ['Reserva', 'bg-rose-50 text-rose-700 border-rose-100'], ['Pix', 'bg-lime-300/20 text-lime-900 border-lime-300/60']];
const PAY: Array<{ value: PaymentMode; title: string; desc: string; icon: ComponentType<LucideProps> }> = [
  { value: 'none', title: 'Sem Pix antecipado', desc: 'A equipe confirma a reserva manualmente', icon: Hand },
  { value: 'full', title: 'Valor integral', desc: 'O cliente paga a reserva inteira pelo Pix', icon: CircleDollarSign },
  { value: 'percent', title: 'Percentual do valor', desc: 'Uma parte da reserva, o resto na arena', icon: Percent },
  { value: 'fixed', title: 'Valor fixo', desc: 'Um sinal em reais por reserva', icon: Banknote },
];
const STATUS: Record<string, { label: string; tone: Tone }> = {
  WORKING: { label: 'Conectado', tone: 'green' }, SCAN_QR_CODE: { label: 'Aguardando leitura do QR', tone: 'amber' }, STARTING: { label: 'Iniciando', tone: 'amber' },
  STOPPED: { label: 'Desconectado', tone: 'rose' }, FAILED: { label: 'Falha na conexão', tone: 'rose' }, not_configured: { label: 'Não configurado', tone: 'gray' }, unavailable: { label: 'Serviço indisponível', tone: 'rose' },
};
const TEMPLATE_CATS: Record<string, string> = { personalizado: 'Personalizado', menu: 'Menu', reserva_criada: 'Reserva criada', reserva_confirmada: 'Reserva confirmada', lembrete: 'Lembrete', pagamento: 'Pagamento', avaliacao: 'Avaliação' };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function WhatsAppPage() {
  const { user } = useAuth();
  const editable = user?.role === 'arena_admin';
  const tabs: Array<[Tab, string, ComponentType<LucideProps>]> = editable
    ? [['config', 'Bot & configuração', Bot], ['services', 'Informações & automações', Workflow], ['conversas', 'Conversas', MessagesSquare], ['modelos', 'Modelos de mensagem', FileText]]
    : [['conversas', 'Conversas', MessagesSquare], ['modelos', 'Modelos de mensagem', FileText]];
  const [tab, setTab] = useState<Tab>(editable ? 'config' : 'conversas');
  const [config, setConfig] = useState<Config>({ session: '', enabled: false, status: 'unknown', connected: false, serviceConfigured: false, aiConfigured: false, webhookUrl: '' });
  const [bot, setBot] = useState<BotConfig>(defaultBot);
  const [savedBot, setSavedBot] = useState<BotConfig>(defaultBot);
  const [status, setStatus] = useState('unknown');
  const [qr, setQr] = useState('');
  const [mpConnected, setMpConnected] = useState<boolean | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [phone, setPhone] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateDraft, setTemplateDraft] = useState<Template | null>(null);
  const [removingTemplate, setRemovingTemplate] = useState<Template | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = editable && !same(bot, savedBot);

  async function load() {
    setLoading(true);
    const results = await Promise.allSettled([
      api<Config>('/api/integrations/waha'), api<{ status: string }>('/api/integrations/waha/status'), api<{ conversations: Conversation[] }>('/api/whatsapp/conversations'),
      api<{ templates: Template[] }>('/api/message-templates'), api<BotConfig>('/api/whatsapp/bot-settings'), api<{ connected: boolean }>('/api/integrations/mercadopago'),
    ]);
    const labels = ['estado da conexão', 'estado da sessão', 'conversas', 'modelos de mensagem', 'configurações do bot'];
    const errors = results.slice(0, 5).flatMap((result, index) => result.status === 'rejected' ? [`${labels[index]}: ${errorMessage(result.reason)}`] : []);
    if (results[0].status === 'fulfilled') setConfig(results[0].value);
    if (results[1].status === 'fulfilled') setStatus(results[1].value.status);
    if (results[2].status === 'fulfilled') setConversations(results[2].value.conversations);
    if (results[3].status === 'fulfilled') setTemplates(results[3].value.templates);
    if (results[4].status === 'fulfilled') { const next = { ...defaultBot, ...results[4].value }; setBot(next); setSavedBot(next); }
    if (results[5].status === 'fulfilled') setMpConnected(results[5].value.connected);
    setError(errors.join(' · ')); setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  // Link direto para uma conversa: /whatsapp?phone=5594...
  useEffect(() => {
    const contact = new URLSearchParams(window.location.search).get('phone');
    if (contact && /^\d{10,15}$/.test(contact)) { setTab('conversas'); void selectConversation(contact); }
  }, []);
  // O navegador avisa ao sair com alterações pendentes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function selectConversation(value: string) {
    setPhone(value);
    try { setMessages((await api<{ messages: Message[] }>(`/api/whatsapp/conversations?phone=${encodeURIComponent(value)}`)).messages); }
    catch (cause) { toast.error(errorMessage(cause)); }
  }

  async function connectWhatsApp() {
    setConnecting(true); setQr(''); setError(''); setNotice('Preparando a conexão com o WhatsApp…');
    try {
      const saved = await api<{ session: string }>('/api/integrations/waha/connect', { method: 'POST', body: '{}' });
      setConfig((current) => ({ ...current, session: saved.session, enabled: true }));
      for (let attempt = 0; attempt < 20; attempt++) {
        try { const result = await api<{ image: string }>('/api/integrations/waha/qr'); setQr(result.image); setStatus('SCAN_QR_CODE'); setNotice('QR Code pronto. No celular, abra WhatsApp → Aparelhos conectados → Conectar aparelho.'); return; }
        catch (cause) { if (!(cause instanceof ApiError) || cause.status !== 425) throw cause; setNotice('A sessão está iniciando. Aguardando o QR Code…'); if (attempt < 19) await new Promise((resolve) => window.setTimeout(resolve, 1500)); }
      }
      setNotice(''); setError('A sessão foi iniciada, mas o QR Code ainda não ficou pronto. Aguarde alguns segundos e tente atualizar.');
    } catch (cause) { setNotice(''); setQr(''); setError(errorMessage(cause)); }
    finally { setConnecting(false); }
  }
  // Enquanto o QR está na tela, acompanha a leitura a cada 10 s e renova o código.
  useEffect(() => {
    if (!qr) return;
    let stopped = false, busy = false;
    const refresh = async () => {
      if (stopped || busy) return; busy = true;
      try {
        const latest = await api<{ status: string }>('/api/integrations/waha/status');
        if (stopped) return; setStatus(latest.status);
        if (latest.status === 'WORKING') { setQr(''); setNotice(''); toast.success('WhatsApp conectado'); return; }
        if (latest.status === 'FAILED') { setQr(''); setNotice(''); setError('A conexão do WhatsApp falhou. Atualize o QR Code para reiniciar a sessão e tente conectar novamente.'); return; }
        if (latest.status === 'SCAN_QR_CODE') { try { const image = await api<{ image: string }>('/api/integrations/waha/qr'); if (!stopped) setQr(image.image); } catch (cause) { if (cause instanceof ApiError && cause.status === 425) return; throw cause; } }
      } catch (cause) { if (!stopped) { setQr(''); setNotice(''); setError(errorMessage(cause)); } }
      finally { busy = false; }
    };
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [qr]);

  async function saveBot(event?: FormEvent) {
    event?.preventDefault(); setSaving(true);
    try { const result = await api<BotConfig>('/api/whatsapp/bot-settings', { method: 'PUT', body: JSON.stringify(bot) }); const next = { ...defaultBot, ...result, aiModel: bot.aiModel }; setBot(next); setSavedBot(next); toast.success('Configurações do bot salvas'); }
    catch (cause) { toast.error(errorMessage(cause)); }
    finally { setSaving(false); }
  }
  const setField = <K extends keyof BotConfig>(key: K, value: BotConfig[K]) => setBot((current) => ({ ...current, [key]: value }));

  return <div className="space-y-4 lg:space-y-5">
    <PageHeader title="WhatsApp & bot de agendamento" description="O bot responde pelo número da arena. Quando o cliente pede uma pessoa, a automação pausa para a equipe assumir." alwaysShowTitle
      actions={editable && tab === 'config' ? <Button variant="outline" className="xl:hidden" onClick={() => setPreviewOpen(true)}><Smartphone /> Ver prévia</Button> : undefined} />
    {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    <div className="scrollbar-none -mx-4 overflow-x-auto border-b px-4 lg:mx-0 lg:px-0">
      <div role="tablist" aria-label="Seções do WhatsApp" className="flex gap-5 whitespace-nowrap">
        {tabs.map(([value, label, Icon]) => { const on = tab === value; return <button key={value} type="button" role="tab" aria-selected={on} onClick={() => setTab(value)} className={cn('relative flex items-center gap-2 pt-1 pb-3 font-medium transition', on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          <Icon className="size-4" aria-hidden="true" />{label}{on && <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand-900" />}
        </button>; })}
      </div>
    </div>

    {loading ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-brand-600" aria-label="Carregando" /></div> : <>
      {tab === 'services' && editable && <WhatsAppServices editable={editable} />}
      {tab === 'config' && editable && <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_340px]">
        <form className="min-w-0 space-y-4 lg:space-y-5" onSubmit={(event) => void saveBot(event)}>
          {!config.aiConfigured && <p role="status" className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>O agente de IA ainda não está configurado. O fluxo guiado atende reservas; para respostas em linguagem natural, o responsável pela hospedagem precisa definir OPENAI_API_KEY no servidor.</span></p>}

          <Block icon={Smartphone} title={<>Conexão do número <ToneBadge tone={(STATUS[status] || { tone: 'gray' as Tone }).tone}>{(STATUS[status] || { label: status }).label}</ToneBadge></>} sub="O número continua funcionando normalmente no celular da arena.">
            {!config.serviceConfigured && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">O servidor WhatsApp ainda não está configurado. O responsável pela hospedagem precisa ativar a instância WAHA do QuadrasFlow.</p>}
            <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border p-3', status === 'WORKING' ? 'border-brand-100 bg-brand-50/60' : 'border-border bg-muted/40')}>
              <span className={cn('relative grid size-10 place-items-center rounded-full text-white', status === 'WORKING' ? 'bg-[#25D366]' : 'bg-gray-300')}><MessageCircle className="size-5" aria-hidden="true" />{status === 'WORKING' && <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-lime-400 ring-2 ring-white" />}</span>
              <div className="min-w-0 flex-1 basis-48"><div className="font-medium">{status === 'WORKING' ? 'WhatsApp conectado' : 'Nenhum número conectado'}</div><div className="text-[12.5px] text-muted-foreground">{status === 'WORKING' ? <>Sessão <b className="font-medium text-foreground">{config.session}</b></> : 'Escaneie o QR Code com o WhatsApp da arena.'}</div></div>
              <Button type="button" className="w-full sm:w-auto" disabled={connecting || !config.serviceConfigured || status === 'WORKING'} onClick={() => void connectWhatsApp()}>{connecting ? <LoaderCircle className="animate-spin" /> : <QrCode />}{connecting ? 'Preparando…' : status === 'WORKING' ? 'Conectado' : config.session ? 'Atualizar QR Code' : 'Conectar WhatsApp'}</Button>
            </div>
            {notice && <p role="status" aria-live="polite" className="text-[13px] text-muted-foreground">{notice}</p>}
            {qr && <div className="flex flex-col items-center gap-3 rounded-xl border bg-white p-4 sm:flex-row"><img src={qr} alt="QR Code para conectar o WhatsApp" className="size-48 object-contain" /><p className="max-w-md text-[13px] text-muted-foreground">No celular, abra <b>WhatsApp → Aparelhos conectados → Conectar aparelho</b> e escaneie. O código se renova sozinho.</p></div>}
            <div className="grid gap-1.5"><Label htmlFor="waha-session">Identificador da sessão</Label>
              <div className="flex gap-2"><Input id="waha-session" readOnly className="h-10 bg-muted/60 text-muted-foreground" value={config.session || user?.company?.slug || ''} />
                <Button type="button" variant="outline" size="icon" className="size-10" aria-label="Copiar identificador" onClick={() => { void navigator.clipboard?.writeText(config.session || user?.company?.slug || '').then(() => toast.success('Copiado'), () => undefined); }}><Copy /></Button></div>
              <span className="text-[12px] text-muted-foreground">Criado automaticamente. Não precisa editar nem salvar antes de conectar.</span></div>
            {config.webhookUrl && <details className="group rounded-lg border"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[13px] font-medium"><ChevronRight className="size-4 transition group-open:rotate-90" aria-hidden="true" />Detalhes técnicos da conexão</summary>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 px-3 pb-3 text-[12.5px]"><dt className="text-muted-foreground">Sessão</dt><dd className="font-mono">{config.session || '—'}</dd><dt className="text-muted-foreground">Status</dt><dd>{status}</dd><dt className="text-muted-foreground">Webhook</dt><dd className="font-mono break-all">{config.webhookUrl}</dd>{config.aiConfigured && <><dt className="text-muted-foreground">Modelo do agente</dt><dd className="font-mono">{bot.aiModel || 'gpt-4.1-mini'}</dd></>}</dl></details>}
          </Block>

          <Block icon={Bot} title="Bot automático" sub="Responde perguntas e conduz o cliente até a reserva com os dados da arena.">
            <ToggleRow checked={bot.enabled} onChange={(v) => setField('enabled', v)} title="Bot ativo" desc={config.aiConfigured ? 'Responde sozinho 24h e conduz o cliente até a reserva.' : 'Agente de IA indisponível; o fluxo guiado continua ativo.'} />
            <div className="grid gap-1.5"><Label>Fuso horário da arena</Label>
              <Select value={bot.timeZone || undefined} onValueChange={(v) => setField('timeZone', v)}><SelectTrigger className="h-10 w-full max-w-md" aria-label="Fuso horário da arena"><SelectValue placeholder="Selecione o fuso da cidade" /></SelectTrigger>
                <SelectContent>{ZONES.map((zone) => <SelectItem key={zone} value={zone}>{zone.replace('America/', '').replaceAll('_', ' ')}</SelectItem>)}</SelectContent></Select>
              <span className="text-[12px] text-muted-foreground">O bot usa este fuso para entender "hoje", "amanhã" e os horários disponíveis.</span></div>
            <TestMode bot={bot} setField={setField} />
            <div className="rounded-lg border p-3">
              <div className="mb-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Fluxo de agendamento</div>
              <div className="flex flex-wrap items-center gap-1.5">{FLOW.map(([step, cls], i) => <span key={step} className="flex items-center gap-1.5"><span className={cn('rounded-full border px-2.5 py-1 text-[12px] font-medium', cls)}>{i + 1}. {step}</span>{i < FLOW.length - 1 && <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />}</span>)}</div>
              <p className="mt-2.5 text-[12px] text-muted-foreground">O bot coleta quadra, data, horário e duração; a reserva fica pendente até o pagamento ou a confirmação da arena.</p>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="bot-welcome">Pergunta do menu</Label><Textarea id="bot-welcome" rows={3} maxLength={500} value={bot.welcome} onChange={(e) => setField('welcome', e.target.value)} /><span className="text-[12px] text-muted-foreground">Primeira mensagem, com as opções de agendar e falar com a equipe.</span></div>
            <div className="rounded-lg border">
              <div className={cn('flex flex-wrap items-center gap-2 p-3', bot.menuOptions.length > 0 && 'border-b')}>
                <div className="flex-1"><div className="font-medium">Opções extras do menu</div><div className="text-[12px] text-muted-foreground">Respostas rápidas para valores, endereço ou regras.</div></div>
                <Button type="button" variant="outline" disabled={bot.menuOptions.length >= 10} onClick={() => setField('menuOptions', [...bot.menuOptions, { id: crypto.randomUUID(), label: '', response: '' }])}><Plus /> Adicionar opção</Button>
              </div>
              {bot.menuOptions.map((option, index) => <div key={option.id} className={cn('grid gap-2 p-3', index > 0 && 'border-t')}>
                <div className="flex gap-2"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-[12px] font-semibold text-muted-foreground">{index + 3}</span>
                  <Input className="h-9" maxLength={24} aria-label={`Título da opção ${index + 3}`} placeholder="Título da opção (ex.: Valores)" value={option.label} onChange={(e) => setField('menuOptions', bot.menuOptions.map((o, i) => i === index ? { ...o, label: e.target.value } : o))} />
                  <Button type="button" variant="outline" size="icon" aria-label={`Remover opção ${index + 3}`} className="text-muted-foreground hover:text-rose-600" onClick={() => setField('menuOptions', bot.menuOptions.filter((_, i) => i !== index))}><Trash2 /></Button></div>
                <Textarea rows={2} maxLength={2000} aria-label={`Resposta da opção ${index + 3}`} placeholder="Resposta que o bot envia" value={option.response} onChange={(e) => setField('menuOptions', bot.menuOptions.map((o, i) => i === index ? { ...o, response: e.target.value } : o))} />
              </div>)}
            </div>
          </Block>

          <Block icon={Headset} title="Quando o cliente pede um atendente" sub="A automação pausa enquanto a equipe conversa.">
            <p className="flex gap-2 rounded-lg bg-muted/70 px-3 py-2.5 text-[12.5px] text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Em <b className="font-medium text-foreground">Informações & automações</b> você escolhe se a equipe libera a retomada manualmente. O prazo abaixo só vale com a retomada automática ligada.</span></p>
            <div className="grid gap-1.5"><Label htmlFor="handoff-message">Mensagem de encaminhamento</Label><Textarea id="handoff-message" rows={3} maxLength={1000} value={bot.handoffMessage} onChange={(e) => setField('handoffMessage', e.target.value)} /></div>
            <div className="flex flex-wrap items-center gap-2 text-[13px]"><Clock className="size-4 text-muted-foreground" aria-hidden="true" /><Label htmlFor="reactivate-hours">Retomar automação após</Label>
              <Input id="reactivate-hours" className="h-9 w-20 text-center tabular-nums" type="number" min={1} max={48} value={bot.reactivateAfterHours} onChange={(e) => setField('reactivateAfterHours', Number(e.target.value))} /><span className="text-muted-foreground">horas sem mensagem</span></div>
          </Block>

          <Block icon={Clock} title="Horário de atendimento humano" sub="Vale quando o cliente pede um atendente. O bot de agendamento continua 24h.">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="human-start">Início</Label><Input id="human-start" className="h-10 tabular-nums" type="time" value={bot.humanStart} onChange={(e) => setField('humanStart', e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="human-end">Fim</Label><Input id="human-end" className="h-10 tabular-nums" type="time" value={bot.humanEnd} onChange={(e) => setField('humanEnd', e.target.value)} /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="outside-hours">Resposta fora do horário humano</Label><Textarea id="outside-hours" rows={2} maxLength={1000} value={bot.outsideHoursMessage} onChange={(e) => setField('outsideHoursMessage', e.target.value)} /></div>
          </Block>

          <Block icon={CreditCard} title="Pagamento para reservar" sub="Quanto o cliente paga antecipadamente pelo Pix. Vale para o bot, a página pública e o link Pix da equipe.">
            {mpConnected === false && bot.paymentMode !== 'none' && <p role="status" className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>O Mercado Pago não está conectado, então nenhum Pix é cobrado ainda. <Link to="/configuracoes" className="font-medium underline">Conectar em Configurações</Link>.</span></p>}
            <div role="radiogroup" aria-label="Cobrança antecipada" className="grid gap-2 sm:grid-cols-2">
              {PAY.map((option) => { const on = bot.paymentMode === option.value; return <button key={option.value} type="button" role="radio" aria-checked={on} onClick={() => setField('paymentMode', option.value)}
                className={cn('relative flex flex-col gap-1 rounded-lg border p-3 text-left transition', on ? 'border-brand-500 bg-brand-50/50 ring-2 ring-brand-500/15' : 'hover:bg-muted/60')}>
                <span aria-hidden="true" className={cn('absolute top-3 right-3 size-4 rounded-full border bg-white', on && 'border-[5px] border-brand-900')} />
                <option.icon className="size-4 text-muted-foreground" aria-hidden="true" /><span className="mt-1 font-medium">{option.title}</span><span className="text-[12px] text-muted-foreground">{option.desc}</span>
              </button>; })}
            </div>
            {bot.paymentMode === 'percent' && <div className="grid gap-1.5"><Label htmlFor="payment-percent">Percentual antecipado</Label>
              <div className="relative w-40"><Input id="payment-percent" className="h-10 pr-8 tabular-nums" type="number" min={1} max={100} value={bot.paymentPercent} onChange={(e) => setField('paymentPercent', Number(e.target.value))} /><span className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">%</span></div>
              <span className="text-[12px] text-muted-foreground">Ex.: {bot.paymentPercent || 0}% de uma reserva de R$ 200,00 cobra {formatCurrency(Math.round(20000 * (bot.paymentPercent || 0) / 100))} pelo Pix; o restante é pago na arena.</span></div>}
            {bot.paymentMode === 'fixed' && <div className="grid gap-1.5"><Label htmlFor="payment-fixed">Valor do sinal</Label>
              <div className="relative w-40"><span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">R$</span><Input id="payment-fixed" className="h-10 pl-9 tabular-nums" inputMode="decimal" defaultValue={(bot.paymentFixedCents / 100).toFixed(2).replace('.', ',')} key={savedBot.paymentFixedCents} onChange={(e) => setField('paymentFixedCents', Math.round(Number(e.target.value.replace(/\./g, '').replace(',', '.')) * 100) || 0)} /></div>
              <span className="text-[12px] text-muted-foreground">Se a reserva custar menos que o sinal, cobra só o valor da reserva.</span>
              {bot.paymentFixedCents > 0 && bot.paymentFixedCents < 1000 && <p className="mt-1 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>Sinal de {formatCurrency(bot.paymentFixedCents)} parece ser de teste. Lembre de ajustar antes de abrir para os clientes.</span></p>}</div>}
            {bot.paymentMode === 'full' && <p className="text-[12.5px] text-muted-foreground">O cliente paga a reserva inteira pelo Pix e ela é confirmada automaticamente quando o pagamento é aprovado.</p>}
            {bot.paymentMode === 'none' && <p className="text-[12.5px] text-muted-foreground">O bot não envia Pix; a reserva fica pendente até a equipe confirmar. A equipe ainda pode gerar um link Pix do valor total em Reservas.</p>}
          </Block>

          <Block icon={BellRing} title="Confirmação e lembrete de pagamento" sub="Mensagens automáticas ligadas ao Pix da reserva.">
            <ToggleRow checked={bot.notifyPayment} onChange={(v) => setField('notifyPayment', v)} title="Avisar quando o Pix for pago" desc="Envia a confirmação assim que o Mercado Pago aprova o pagamento." />
            <ToggleRow checked={bot.remindUnpaid} onChange={(v) => setField('remindUnpaid', v)} title="Lembrar quem gerou o Pix e não pagou" desc="Depende de a cobrança Pix estar vinculada à reserva e ainda pendente." />
          </Block>
        </form>
        <aside className="sticky top-24 hidden xl:block" aria-label="Prévia no WhatsApp">
          <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">Prévia no WhatsApp</div>
          <Preview bot={bot} arena={user?.company?.name || 'Sua arena'} />
          <p className="mt-3 text-center text-[12px] text-muted-foreground">Atualiza enquanto você edita.</p>
        </aside>
      </div>}

      {tab === 'conversas' && <Conversations conversations={conversations} phone={phone} messages={messages} onSelect={(value) => void selectConversation(value)} onChanged={() => void load()} />}
      {tab === 'modelos' && <Templates templates={templates} editable={editable} onEdit={setTemplateDraft} onRemove={setRemovingTemplate} onChanged={() => void load()} />}
    </>}

    {/* Barra de alterações não salvas */}
    <div role="region" aria-label="Alterações não salvas" aria-hidden={!dirty}
      className={cn('fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-2 rounded-xl bg-brand-950 py-2 pr-2 pl-4 text-white shadow-2xl transition-all lg:bottom-6', dirty ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0')}>
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-amber-400" />
      <span className="flex-1 text-[13px] font-medium">Alterações não salvas</span>
      <button type="button" tabIndex={dirty ? 0 : -1} className="h-9 rounded-md px-3 text-[13px] hover:bg-white/10" onClick={() => { setBot(savedBot); toast('Alterações descartadas'); }}>Descartar</button>
      <button type="button" tabIndex={dirty ? 0 : -1} disabled={saving} className="flex h-9 items-center gap-1.5 rounded-md bg-lime-400 px-3.5 text-[13px] font-semibold text-brand-950 hover:bg-lime-300" onClick={() => void saveBot()}>{saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}Salvar</button>
    </div>

    <ResponsiveSheet open={previewOpen} onOpenChange={setPreviewOpen} title="Prévia no WhatsApp"><div className="bg-muted/50 p-5"><Preview bot={bot} arena={user?.company?.name || 'Sua arena'} /></div></ResponsiveSheet>
    <TemplateSheet draft={templateDraft} onClose={() => setTemplateDraft(null)} onSaved={() => { setTemplateDraft(null); void load(); }} />
    <AlertDialog open={Boolean(removingTemplate)} onOpenChange={(value) => { if (!value) setRemovingTemplate(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader className="flex flex-row items-start gap-3 text-left">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600"><Trash2 className="size-5" aria-hidden="true" /></span>
          <div className="space-y-1"><AlertDialogTitle>Excluir o modelo "{removingTemplate?.title}"?</AlertDialogTitle><AlertDialogDescription>O bot e a equipe deixam de usar este texto.</AlertDialogDescription></div>
        </AlertDialogHeader>
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:flex">
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction className="bg-rose-600 text-white hover:bg-rose-700" onClick={async (event) => { event.preventDefault(); const t = removingTemplate; setRemovingTemplate(null); if (!t) return; try { await api(`/api/message-templates/${t.id}`, { method: 'DELETE' }); toast.success('Modelo excluído'); await load(); } catch (cause) { toast.error(errorMessage(cause)); } }}>Excluir</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function Block({ icon: Icon, title, sub, children }: { icon: ComponentType<LucideProps>; title: ReactNode; sub: string; children: ReactNode }) {
  return <Panel>
    <div className="flex items-start gap-3 px-4 pt-4 lg:px-5 lg:pt-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-4" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1"><h2 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">{title}</h2><p className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</p></div>
    </div>
    <div className="space-y-4 px-4 pt-4 pb-4 lg:px-5 lg:pb-5">{children}</div>
  </Panel>;
}

function ToggleRow({ checked, onChange, title, desc }: { checked: boolean; onChange: (value: boolean) => void; title: string; desc: string }) {
  return <label className="flex cursor-pointer items-start gap-3">
    <Switch className="mt-0.5" checked={checked} onCheckedChange={onChange} aria-label={title} />
    <span className="flex-1"><span className="block font-medium">{title}</span><span className="text-[12.5px] text-muted-foreground">{desc}</span></span>
  </label>;
}

/** Modo de teste: números autorizados como etiquetas, com validação de DDD e duplicidade. */
function TestMode({ bot, setField }: { bot: BotConfig; setField: <K extends keyof BotConfig>(key: K, value: BotConfig[K]) => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  function add() {
    const digits = draft.replace(/\D/g, ''), full = digits.length <= 11 ? `55${digits}` : digits;
    if (full.length < 12 || full.length > 13) { setError('Informe DDD + número, ex.: (94) 98802-4142.'); return; }
    if (bot.testPhones.some((p) => p.replace(/\D/g, '') === full)) { setError('Esse número já está na lista.'); return; }
    setField('testPhones', [...bot.testPhones, full]); setDraft(''); setError('');
  }
  return <div className={cn('space-y-3 rounded-lg border p-3', bot.testMode ? 'border-amber-200 bg-amber-50/50' : 'border-border')}>
    <ToggleRow checked={bot.testMode} onChange={(v) => setField('testMode', v)} title="Modo de teste" desc="O bot só responde aos números autorizados. Mensagens de outros contatos são ignoradas." />
    {bot.testMode && <div className="space-y-2 sm:pl-12">
      <span className="text-[13px] font-medium">Números autorizados</span>
      {bot.testPhones.length > 0 ? <div className="flex flex-wrap gap-1.5">{bot.testPhones.map((p, i) => <span key={p} className="inline-flex items-center gap-1 rounded-md border bg-white py-1 pr-1 pl-2 text-[12.5px] tabular-nums">
        {p.startsWith('55') ? `+55 ${formatPhone(p)}` : formatPhone(p)}
        <button type="button" aria-label={`Remover ${formatPhone(p)}`} className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted" onClick={() => setField('testPhones', bot.testPhones.filter((_, j) => j !== i))}><X className="size-3" aria-hidden="true" /></button>
      </span>)}</div> : <p className="text-[12px] text-amber-800">Adicione ao menos um número antes de salvar com o modo de teste ligado.</p>}
      <div className="flex gap-2"><Input className="h-9" inputMode="tel" aria-label="Adicionar número com DDD" placeholder="Adicionar número com DDD" value={draft} onChange={(e) => { setDraft(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button type="button" variant="outline" onClick={add}><Plus /> Adicionar</Button></div>
      {error && <p role="alert" className="text-[12px] text-rose-600">{error}</p>}
    </div>}
  </div>;
}

/** Prévia da conversa no WhatsApp, atualizada enquanto se digita. */
function Preview({ bot, arena }: { bot: BotConfig; arena: string }) {
  const options = ['Agendar um horário', 'Falar com a equipe', ...bot.menuOptions.map((o) => o.label || 'Nova opção')];
  const initials = arena.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const bubble = 'w-fit max-w-[85%] rounded-lg bg-white px-2.5 py-1.5 shadow-sm';
  const mine = 'ml-auto w-fit max-w-[80%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 shadow-sm';
  return <div className="mx-auto max-w-[320px] overflow-hidden rounded-[2rem] border-[6px] border-brand-950 bg-brand-950 shadow-2xl">
    <div className="flex items-center gap-2.5 bg-[#075e54] px-3 py-2.5 text-white">
      <ArrowLeft className="size-4 opacity-80" aria-hidden="true" />
      <span className="grid size-8 place-items-center rounded-full bg-lime-400 text-xs font-bold text-brand-950">{initials}</span>
      <div className="min-w-0 flex-1"><div className="truncate text-[13px] leading-tight font-semibold">{arena}</div><div className="text-[10.5px] opacity-80">{bot.enabled ? 'online · bot ativo' : 'bot desligado'}</div></div>
      <Phone className="size-4 opacity-80" aria-hidden="true" />
    </div>
    <div className="min-h-[420px] space-y-1.5 bg-[#efeae2] px-2.5 py-3 text-[12.5px] leading-snug" style={{ backgroundImage: 'radial-gradient(#d9d2c5 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
      {bot.testMode && <div className="mx-auto mb-1 w-fit rounded-md bg-amber-100 px-2 py-0.5 text-[10.5px] text-amber-800">Modo de teste · só números autorizados</div>}
      <div className={mine}>Oi, queria marcar um horário<span className="-mb-0.5 block text-right text-[9.5px] text-gray-500">19:02 ✓✓</span></div>
      {bot.enabled ? <>
        <div className={cn(bubble, 'rounded-tl-none')}><div className="break-words whitespace-pre-wrap">{bot.welcome || '…'}</div>
          {bot.menuOptions.length > 0 && <div className="mt-1.5 space-y-0.5">{bot.menuOptions.map((o, i) => <div key={o.id}><b>{i + 3}</b> · {o.label || 'Nova opção'}</div>)}</div>}
          <span className="-mb-0.5 block text-right text-[9.5px] text-gray-500">19:02</span></div>
        <div className="grid w-fit max-w-[85%] gap-1">{options.slice(0, 3).map((o) => <span key={o} className="rounded-lg bg-white/90 px-3 py-1.5 text-center font-medium text-[#027eb5] shadow-sm">{o}</span>)}</div>
        <div className={mine}>2<span className="-mb-0.5 block text-right text-[9.5px] text-gray-500">19:03 ✓✓</span></div>
        <div className={cn(bubble, 'rounded-tl-none')}><div className="break-words whitespace-pre-wrap">{bot.handoffMessage}</div><span className="-mb-0.5 block text-right text-[9.5px] text-gray-500">19:03</span></div>
      </> : <div className="mx-auto mt-6 w-fit rounded-md bg-white/80 px-2 py-1 text-[11px] text-gray-500">O bot está desligado — a equipe responde manualmente.</div>}
    </div>
  </div>;
}

function Conversations({ conversations, phone, messages, onSelect, onChanged }: { conversations: Conversation[]; phone: string; messages: Message[]; onSelect: (phone: string) => void; onChanged: () => void }) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const current = useMemo(() => conversations.find((c) => c.phone === phone), [conversations, phone]);
  async function send(event: FormEvent) {
    event.preventDefault(); setSending(true);
    try { await api('/api/whatsapp/reply', { method: 'POST', body: JSON.stringify({ phone, message: reply }) }); setReply(''); onSelect(phone); onChanged(); }
    catch (cause) { toast.error(errorMessage(cause)); }
    finally { setSending(false); }
  }
  async function resume() {
    try { await api(`/api/whatsapp/conversations/${phone}/resume`, { method: 'PATCH', body: '{}' }); toast.success('Automação retomada nesta conversa'); onChanged(); }
    catch (cause) { toast.error(errorMessage(cause)); }
  }
  return <div className="grid grid-cols-1 gap-4 xl:grid-cols-[.8fr_1.2fr]">
    <Panel className={cn(phone && 'hidden xl:block')}>
      <div className="border-b px-4 py-4 lg:px-5"><h2 className="text-[15px] font-semibold">Conversas recentes</h2><p className="text-[12.5px] text-muted-foreground">As marcadas em âmbar estão com a equipe.</p></div>
      {conversations.length ? <ul className="max-h-[560px] divide-y overflow-auto">{conversations.map((c) => <li key={c.phone}>
        <button type="button" onClick={() => onSelect(c.phone)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition lg:px-5', phone === c.phone ? 'bg-brand-50/60' : 'hover:bg-muted/50')}>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700"><MessageCircle className="size-4" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="font-medium tabular-nums">{formatPhone(c.phone)}</span><span className="text-[11px] text-muted-foreground">{new Date(c.updated_at).toLocaleDateString('pt-BR')}</span></span>
            <span className="block truncate text-[12.5px] text-muted-foreground">{c.last_message || 'Sem mensagens'}</span>
            {c.step === 'human' && <ToneBadge tone="amber" className="mt-1.5">Atendimento humano</ToneBadge>}</span>
        </button></li>)}</ul> : <EmptyState icon={MessagesSquare} title="Nenhuma conversa ainda" text="Quando clientes escreverem para o número da arena, as conversas aparecem aqui." />}
    </Panel>
    <Panel className={cn(!phone && 'hidden xl:block')}>
      {phone ? <>
        <div className="flex items-center gap-2 border-b px-4 py-3 lg:px-5">
          <Button variant="ghost" size="icon" className="xl:hidden" aria-label="Voltar para a lista" onClick={() => onSelect('')}><ArrowLeft /></Button>
          <div className="min-w-0 flex-1"><h2 className="truncate text-[15px] font-semibold tabular-nums">{formatPhone(phone)}</h2>{current?.step === 'human' && <p className="text-[12px] text-amber-700">Atendimento humano: o bot está pausado.</p>}</div>
          {current?.step === 'human' && <Button variant="outline" size="sm" onClick={() => void resume()}><Bot /> Retomar bot</Button>}
        </div>
        <div className="max-h-[440px] space-y-2 overflow-auto bg-[#efeae2] p-4" aria-live="polite">
          {messages.length ? messages.map((m, i) => <div key={i} className={cn('w-fit max-w-[85%] rounded-lg px-3 py-2 text-[13px] shadow-sm', m.direction === 'out' ? 'ml-auto rounded-tr-none bg-[#d9fdd3]' : 'rounded-tl-none bg-white')}>
            <div className="break-words whitespace-pre-wrap">{m.body}</div><span className="block text-right text-[10px] text-gray-500">{new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          </div>) : <p className="py-10 text-center text-[13px] text-muted-foreground">Sem mensagens nesta conversa.</p>}
        </div>
        <form className="flex gap-2 border-t p-3" onSubmit={(event) => void send(event)}>
          <Textarea aria-label="Mensagem" rows={2} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Digite sua resposta" />
          <Button type="submit" size="icon" className="size-11 self-end" aria-label="Enviar" disabled={!reply.trim() || sending}>{sending ? <LoaderCircle className="animate-spin" /> : <Send />}</Button>
        </form>
      </> : <EmptyState icon={MessageCircle} title="Selecione uma conversa" text="Escolha uma conversa à esquerda para ver o histórico e responder." />}
    </Panel>
  </div>;
}

function Templates({ templates, editable, onEdit, onRemove, onChanged }: { templates: Template[]; editable: boolean; onEdit: (t: Template) => void; onRemove: (t: Template) => void; onChanged: () => void }) {
  async function toggle(t: Template) {
    try { await api(`/api/message-templates/${t.id}`, { method: 'PATCH', body: JSON.stringify({ active: !t.active }) }); toast.success(t.active ? 'Modelo desativado' : 'Modelo ativado'); onChanged(); }
    catch (cause) { toast.error(errorMessage(cause)); }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-[15px] font-semibold">Modelos de mensagem</h2><p className="text-[12.5px] text-muted-foreground">Textos prontos enviados pelo bot ou pela equipe.</p></div>
      {editable && <Button onClick={() => onEdit({ id: '', title: '', category: 'personalizado', body: '', active: true })}><Plus /> Novo modelo</Button>}
    </div>
    {templates.length ? <div className="grid gap-4 sm:grid-cols-2">{templates.map((t) => <Panel key={t.id} className={cn('flex flex-col gap-3 p-4', !t.active && 'opacity-70')}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.title}</span><span className="text-[12px] text-muted-foreground">{TEMPLATE_CATS[t.category] || t.category}</span></span>
        {editable ? <>
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground"><Switch checked={Boolean(t.active)} onCheckedChange={() => void toggle(t)} aria-label={t.active ? `Desativar ${t.title}` : `Ativar ${t.title}`} />{t.active ? 'Ativo' : 'Inativo'}</label>
          <Button variant="outline" size="icon" aria-label={`Editar ${t.title}`} onClick={() => onEdit({ ...t, active: Boolean(t.active) })}><Pencil /></Button>
          <Button variant="outline" size="icon" aria-label={`Excluir ${t.title}`} className="text-muted-foreground hover:text-rose-600" onClick={() => onRemove(t)}><Trash2 /></Button>
        </> : <ToneBadge tone={t.active ? 'green' : 'gray'}>{t.active ? 'Ativo' : 'Inativo'}</ToneBadge>}
      </div>
      <div className="rounded-lg bg-[#efeae2] p-2.5"><div className="w-fit max-w-[95%] rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 text-[12.5px] break-words whitespace-pre-wrap shadow-sm">
        {t.body.split(/(\{\w+\})/g).map((part, i) => /^\{\w+\}$/.test(part) ? <span key={i} className="rounded bg-brand-50 px-1 font-medium text-brand-700">{part}</span> : part)}
      </div></div>
    </Panel>)}</div> : <Panel><EmptyState icon={FileText} title="Nenhum modelo ainda" text="Crie textos prontos para confirmação, lembrete, pagamento ou avaliação." /></Panel>}
  </div>;
}

function TemplateSheet({ draft, onClose, onSaved }: { draft: Template | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('personalizado');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (draft) { setTitle(draft.title); setCategory(draft.category); setBody(draft.body); setError(''); } }, [draft]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!draft) return; setSaving(true); setError('');
    try {
      if (draft.id) await api(`/api/message-templates/${draft.id}`, { method: 'PATCH', body: JSON.stringify({ title, body }) });
      else await api('/api/message-templates', { method: 'POST', body: JSON.stringify({ title, category, body }) });
      toast.success('Modelo salvo'); onSaved();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }
  return <ResponsiveSheet open={Boolean(draft)} onOpenChange={(open) => { if (!open) onClose(); }} title={draft?.id ? 'Editar modelo' : 'Novo modelo'} description={<>Use variáveis como {'{arena_name}'}, {'{quadra}'}, {'{data}'}, {'{horario}'} e {'{valor}'}.</>}
    footer={<div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" className="h-10" onClick={onClose}>Cancelar</Button>
      <Button type="submit" form="template-form" className="h-10" disabled={saving || title.trim().length < 2 || !body.trim()}>{saving && <LoaderCircle className="animate-spin" />}Salvar modelo</Button>
    </div>}>
    <form id="template-form" className="space-y-4 px-5 py-4" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-1.5"><Label htmlFor="template-name">Título</Label><Input id="template-name" className="h-10" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      {!draft?.id && <div className="grid gap-1.5"><Label>Categoria</Label><Select value={category} onValueChange={setCategory}><SelectTrigger className="h-10 w-full" aria-label="Categoria"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TEMPLATE_CATS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>}
      <div className="grid gap-1.5"><Label htmlFor="template-body">Mensagem</Label><Textarea id="template-body" rows={7} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} /><span className="text-[12px] text-muted-foreground">{body.length} caracteres</span></div>
      {error && <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{error}</p>}
    </form>
  </ResponsiveSheet>;
}
