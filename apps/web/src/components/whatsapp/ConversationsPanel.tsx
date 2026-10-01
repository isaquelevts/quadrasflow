import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, Bot, Check, LoaderCircle, MessageCircle, MessagesSquare, Search, Send, User } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/app/page';
import { ToneBadge } from '@/components/app/status';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { errorMessage, formatPhone } from '@/lib/format';
import { cn } from '@/lib/utils';

export type Conversation = { phone: string; step: string; updated_at: string; last_message: string; last_direction?: string; awaiting_team?: boolean };
export type Message = { direction: string; body: string; created_at: string };

const REFRESH_MS = 15_000;
const withTeam = (c: Conversation) => c.step === 'human' || Boolean(c.awaiting_team);
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "14:32" hoje, "Ontem", ou "30/09" nas conversas antigas. */
function listTime(iso: string) {
  const date = new Date(iso), now = new Date(), yesterday = new Date(now.getTime() - 86_400_000);
  if (sameDay(date, now)) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(date, yesterday)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
/** Rótulo do separador de dia dentro da conversa. */
function dayLabel(iso: string) {
  const date = new Date(iso), now = new Date(), yesterday = new Date(now.getTime() - 86_400_000);
  if (sameDay(date, now)) return 'Hoje';
  if (sameDay(date, yesterday)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

/** Aba Conversas: lista à esquerda e histórico com resposta à direita (layout "Mail" do shadcn). */
export function ConversationsPanel({ conversations, phone, messages, onSelect, onChanged, onRefresh }: {
  conversations: Conversation[]; phone: string; messages: Message[]; onSelect: (phone: string) => void; onChanged: () => void; onRefresh: (phone: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'team'>('all');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const current = useMemo(() => conversations.find((c) => c.phone === phone), [conversations, phone]);
  const teamCount = useMemo(() => conversations.filter(withTeam).length, [conversations]);
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase(), digits = text.replace(/\D/g, '');
    return conversations.filter((c) => (filter === 'all' || withTeam(c)) && (!text || c.last_message.toLowerCase().includes(text) || formatPhone(c.phone).toLowerCase().includes(text) || (digits.length > 1 && c.phone.includes(digits))));
  }, [conversations, filter, query]);
  const days = useMemo(() => messages.reduce<Array<{ key: string; label: string; items: Message[] }>>((groups, m) => {
    const key = dayKey(m.created_at), last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(m); else groups.push({ key, label: dayLabel(m.created_at), items: [m] });
    return groups;
  }, []), [messages]);

  // Sempre mostra a mensagem mais recente ao abrir uma conversa ou quando chega algo novo.
  useEffect(() => { const el = viewport.current; if (el) el.scrollTo({ top: el.scrollHeight }); }, [phone, messages.length]);
  // Atualiza sozinha enquanto a aba está aberta e visível.
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) onRefresh(phone); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [phone, onRefresh]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!reply.trim() || sending) return;
    setSending(true);
    try { await api('/api/whatsapp/reply', { method: 'POST', body: JSON.stringify({ phone, message: reply }) }); setReply(''); onSelect(phone); onChanged(); }
    catch (cause) { toast.error(errorMessage(cause)); }
    finally { setSending(false); }
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } };
  async function resume() {
    try { await api(`/api/whatsapp/conversations/${phone}/resume`, { method: 'PATCH', body: '{}' }); toast.success(current?.step === 'human' ? 'Automação retomada nesta conversa' : 'Pedido marcado como resolvido'); onChanged(); }
    catch (cause) { toast.error(errorMessage(cause)); }
  }

  return <div className="grid h-[min(720px,calc(100svh-15rem))] min-h-[480px] overflow-hidden rounded-xl border bg-card shadow-card lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
    <aside className={cn('flex min-h-0 min-w-0 flex-col border-r', phone && 'hidden lg:flex')} aria-label="Conversas">
      <div className="space-y-3 p-4">
        <div className="flex items-baseline justify-between gap-2"><h2 className="text-[15px] font-semibold">Conversas</h2><span className="text-[12px] text-muted-foreground tabular-nums">{conversations.length} no total</span></div>
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Buscar conversa" className="h-9 pl-9" placeholder="Buscar por telefone ou mensagem" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as 'all' | 'team')}>
          <TabsList className="w-full"><TabsTrigger value="all" className="flex-1">Todas</TabsTrigger><TabsTrigger value="team" className="flex-1">Com a equipe{teamCount > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[11px] text-amber-800 tabular-nums">{teamCount}</span>}</TabsTrigger></TabsList>
        </Tabs>
      </div>
      <Separator />
      {visible.length ? <ScrollArea className="min-h-0 flex-1"><ul className="divide-y">{visible.map((c) => <li key={c.phone}>
        <button type="button" onClick={() => onSelect(c.phone)} aria-current={phone === c.phone} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition-colors', phone === c.phone ? 'bg-brand-50/70' : 'hover:bg-muted/50')}>
          <Avatar className="size-10"><AvatarFallback className="bg-brand-50 text-brand-700"><User className="size-4" aria-hidden="true" /></AvatarFallback></Avatar>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2"><span className="truncate font-medium tabular-nums">{formatPhone(c.phone)}</span><span className="shrink-0 text-[11.5px] text-muted-foreground">{listTime(c.updated_at)}</span></span>
            <span className={cn('block truncate text-[12.5px]', c.last_message ? 'text-muted-foreground' : 'text-muted-foreground/70 italic')}>{c.last_message ? `${c.last_direction === 'out' ? 'Você: ' : ''}${c.last_message.replace(/\s+/g, ' ')}` : 'Nenhuma mensagem registrada'}</span>
            {c.step === 'human' ? <ToneBadge tone="amber" className="mt-1.5">Atendimento humano</ToneBadge> : c.awaiting_team && <ToneBadge tone="blue" className="mt-1.5">Pediu atendente · bot ativo</ToneBadge>}
          </span>
        </button></li>)}</ul></ScrollArea>
        : conversations.length ? <EmptyState icon={Search} title="Nenhuma conversa encontrada" text="Tente outro telefone ou texto, ou veja todas as conversas." className="m-auto border-0" />
        : <EmptyState icon={MessagesSquare} title="Nenhuma conversa ainda" text="Quando clientes escreverem para o número da arena, as conversas aparecem aqui." className="m-auto border-0" />}
    </aside>

    <section className={cn('flex min-h-0 min-w-0 flex-col bg-card', phone ? 'max-lg:fixed max-lg:inset-0 max-lg:z-[60]' : 'hidden lg:flex')} aria-label="Histórico da conversa">
      {phone ? <>
        <header className="flex items-center gap-3 border-b px-3 py-3 lg:px-5">
          <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" aria-label="Voltar para a lista" onClick={() => onSelect('')}><ArrowLeft /></Button>
          <Avatar className="size-10 max-sm:hidden"><AvatarFallback className="bg-brand-50 text-brand-700"><User className="size-4" aria-hidden="true" /></AvatarFallback></Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold tabular-nums">{formatPhone(phone)}</h2>
            <p className={cn('truncate text-[12px]', current?.step === 'human' ? 'text-amber-700' : current?.awaiting_team ? 'text-sky-700' : 'text-muted-foreground')}>
              {current?.step === 'human' ? 'Atendimento humano: o bot está pausado.' : current?.awaiting_team ? 'Pediu atendente fora do horário. Responder aqui assume a conversa.' : 'O bot responde esta conversa.'}</p>
          </div>
          {current?.step === 'human' ? <Button variant="outline" size="sm" onClick={() => void resume()}><Bot /> <span className="max-sm:hidden">Retomar bot</span><span className="sm:hidden">Retomar</span></Button>
            : current?.awaiting_team && <Button variant="outline" size="sm" onClick={() => void resume()}><Check /> <span className="max-sm:hidden">Marcar como resolvido</span><span className="sm:hidden">Resolvido</span></Button>}
        </header>
        <ScrollArea className="min-h-0 flex-1 bg-muted/40" viewportRef={viewport}>
          <div className="space-y-1 p-3 lg:p-5" aria-live="polite">
            {days.length ? days.map((group) => <div key={group.key} className="space-y-1.5">
              <div className="flex justify-center py-2"><span className="rounded-full border bg-card px-3 py-0.5 text-[11.5px] font-medium text-muted-foreground first-letter:uppercase">{group.label}</span></div>
              {group.items.map((m, i) => <div key={`${group.key}-${i}`} className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] shadow-xs sm:max-w-[75%]', m.direction === 'out' ? 'rounded-br-md bg-brand-900 text-white' : 'rounded-bl-md border bg-card')}>
                  <div className="break-words whitespace-pre-wrap">{m.body}</div>
                  <span className={cn('mt-0.5 block text-right text-[10.5px] tabular-nums', m.direction === 'out' ? 'text-white/65' : 'text-muted-foreground')}>{new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                </div></div>)}
            </div>) : <p className="py-16 text-center text-[13px] text-muted-foreground">Nenhuma mensagem registrada nesta conversa.</p>}
          </div>
        </ScrollArea>
        <form className="flex items-end gap-2 border-t bg-card p-3 max-lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))]" onSubmit={(event) => void send(event)}>
          <Textarea aria-label="Mensagem" className="max-h-32 min-h-10 resize-none" rows={1} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={onKey} placeholder="Digite sua resposta" title="Ctrl+Enter envia" />
          <Button type="submit" size="icon" className="size-10 shrink-0" aria-label="Enviar" disabled={!reply.trim() || sending}>{sending ? <LoaderCircle className="animate-spin" /> : <Send />}</Button>
        </form>
      </> : <EmptyState icon={MessageCircle} title="Selecione uma conversa" text="Escolha uma conversa à esquerda para ver o histórico e responder." className="m-auto border-0" />}
    </section>
  </div>;
}
