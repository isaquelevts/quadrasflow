import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, ChevronRight, FlaskConical, Info, LoaderCircle, RotateCcw, Send, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Panel } from '@/components/app/page';
import { ToneBadge } from '@/components/app/status';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/format';
import { cn } from '@/lib/utils';

type Message = { direction: string; body: string; created_at: string };
type SimEvent = { kind: 'reply' | 'note' | 'tool'; text: string };
type State = { step: string; context: Record<string, unknown>; messages: Message[]; botEnabled: boolean; aiConfigured: boolean };
type TurnResult = State & { events: SimEvent[]; elapsedMs: number };

const SUGGESTIONS = ['Oi', 'Quais horários vocês têm amanhã à noite?', 'Quero reservar hoje das 19h às 20h', 'Quanto custa uma hora?', 'Onde fica a arena?', 'Quero cancelar minha reserva', 'Quero falar com um atendente'];

const STEPS: Record<string, string> = { '': 'Início', menu: 'Menu', court: 'Escolhendo a quadra', date: 'Escolhendo a data', date_confirm: 'Confirmando a data', time: 'Escolhendo o horário', duration: 'Escolhendo a duração', name: 'Informando o nome', payment_email: 'Informando o e-mail do Pix', human: 'Com a equipe (bot pausado)' };

/** Aba "Testar agente": conversa com o bot como se fosse um cliente, sem enviar nada para fora. */
export function AgentSimulator() {
  const [state, setState] = useState<State | null>(null);
  // Anotações (ferramentas, Pix simulado, equipe chamada) exibidas depois da mensagem de índice N.
  const [notes, setNotes] = useState<Record<number, SimEvent[]>>({});
  const [pending, setPending] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { api<State>('/api/whatsapp/simulator').then(setState, (cause) => toast.error(errorMessage(cause))); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [state?.messages.length, pending, notes]);

  async function send(message: string) {
    const body = message.trim(); if (!body || busy) return;
    setBusy(true); setPending(body); setText('');
    try {
      const result = await api<TurnResult>('/api/whatsapp/simulator', { method: 'POST', body: JSON.stringify({ message: body }) });
      const extra = result.events.filter((e) => e.kind !== 'reply');
      if (extra.length) setNotes((prev) => ({ ...prev, [result.messages.length - 1]: extra }));
      setState(result); setElapsed(result.elapsedMs);
    } catch (cause) { toast.error(errorMessage(cause)); setText(body); }
    finally { setBusy(false); setPending(''); }
  }
  async function reset() {
    setResetting(true);
    try {
      const result = await api<{ bookingsRemoved: number }>('/api/whatsapp/simulator', { method: 'DELETE' });
      setNotes({}); setElapsed(null);
      setState((prev) => prev && { ...prev, step: '', context: {}, messages: [] });
      toast.success('Memória apagada', { description: result.bookingsRemoved ? `${result.bookingsRemoved} reserva(s) de teste removida(s) da agenda.` : 'A próxima mensagem começa uma conversa nova.' });
    } catch (cause) { toast.error(errorMessage(cause)); }
    finally { setResetting(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(text); }

  const human = state?.step === 'human';
  const contextKeys = Object.keys(state?.context || {}).filter((k) => k !== 'serviceRequestId');

  return <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.3fr_.7fr]">
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 lg:px-5">
        <span className="grid size-9 place-items-center rounded-full bg-brand-50 text-brand-700"><FlaskConical className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="text-[15px] font-semibold">Simulador do agente</h2>
          <p className="text-[12.5px] text-muted-foreground">Você é o cliente. Nada é enviado pelo WhatsApp.</p>
        </div>
        <Button variant="outline" onClick={() => void reset()} disabled={resetting || busy}>{resetting ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}Apagar memória e recomeçar</Button>
      </div>
      {state && !state.botEnabled && <p role="status" className="flex gap-2 border-b bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900 lg:px-5"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />O bot automático está desligado em "Bot & configuração", então ele não responde.</p>}
      <div className="h-[55vh] min-h-80 space-y-2 overflow-auto bg-[#efeae2] p-4 xl:h-[520px]" aria-live="polite" aria-label="Conversa simulada">
        {!state ? <p className="py-10 text-center text-[13px] text-muted-foreground"><LoaderCircle className="mx-auto mb-2 animate-spin" aria-hidden="true" />Carregando…</p>
          : !state.messages.length && !pending ? <div className="mx-auto max-w-sm py-10 text-center text-[13px] text-gray-600"><Bot className="mx-auto mb-2 size-8 text-gray-400" aria-hidden="true" />Escreva como um cliente escreveria, ou use uma das sugestões ao lado.</div>
          : state.messages.map((m, i) => <Fragment key={i}>
            <div className={cn('w-fit max-w-[85%] rounded-lg px-3 py-2 text-[13px] shadow-sm', m.direction === 'out' ? 'rounded-tl-none bg-white' : 'ml-auto rounded-tr-none bg-[#d9fdd3]')}>
              <div className="break-words whitespace-pre-wrap">{m.body}</div>
              <span className="block text-right text-[10px] text-gray-500">{new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {(notes[i] || []).filter((n) => showTools || n.kind !== 'tool').map((n, j) => <div key={j} className={cn('mx-auto flex w-fit max-w-[92%] items-start gap-1.5 rounded-md px-2.5 py-1 text-[11.5px]', n.kind === 'tool' ? 'bg-slate-800/85 font-mono text-slate-100' : 'bg-amber-100 text-amber-900')}>
              {n.kind === 'tool' ? <Wrench className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> : <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />}<span className="break-all">{n.text}</span>
            </div>)}
          </Fragment>)}
        {pending && <><div className="ml-auto w-fit max-w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-[13px] opacity-70 shadow-sm"><div className="whitespace-pre-wrap">{pending}</div></div>
          <div className="flex w-fit items-center gap-2 rounded-lg rounded-tl-none bg-white px-3 py-2 text-[12.5px] text-gray-500 shadow-sm"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />digitando…</div></>}
        <div ref={end} />
      </div>
      <div className="flex gap-1.5 overflow-x-auto border-t px-3 pt-3 xl:hidden">{SUGGESTIONS.map((s) => <button key={s} type="button" disabled={busy || !state} onClick={() => void send(s)} className="shrink-0 rounded-full border bg-background px-3 py-1 text-[12.5px] disabled:opacity-50">{s}</button>)}</div>
      <form className="flex gap-2 border-t p-3 max-xl:border-t-0" onSubmit={submit}>
        <Textarea aria-label="Mensagem do cliente" rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva como o cliente" disabled={!state}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
        <Button type="submit" size="icon" className="size-11 self-end" aria-label="Enviar" disabled={!text.trim() || busy || !state}>{busy ? <LoaderCircle className="animate-spin" /> : <Send />}</Button>
      </form>
    </Panel>

    <div className="space-y-4">
      <Panel className="hidden p-4 lg:p-5 xl:block">
        <h3 className="text-[14px] font-semibold">Sugestões</h3>
        <div className="mt-3 flex flex-wrap gap-1.5">{SUGGESTIONS.map((s) => <button key={s} type="button" disabled={busy || !state} onClick={() => void send(s)} className="rounded-full border bg-background px-3 py-1 text-[12.5px] transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50">{s}</button>)}</div>
      </Panel>
      <Panel className="p-4 lg:p-5">
        <div className="flex items-center justify-between gap-2"><h3 className="text-[14px] font-semibold">Estado da conversa</h3>
          {state && <ToneBadge tone={human ? 'amber' : state.aiConfigured ? 'green' : 'gray'}>{human ? 'Com a equipe' : state.aiConfigured ? 'Agente de IA' : 'Fluxo guiado'}</ToneBadge>}</div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
          <dt className="text-muted-foreground">Passo</dt><dd>{STEPS[state?.step || ''] ?? state?.step}</dd>
          {elapsed !== null && <><dt className="text-muted-foreground">Última resposta</dt><dd>{(elapsed / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s</dd></>}
        </dl>
        {contextKeys.length > 0 && <details className="group mt-3 rounded-lg border"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12.5px] font-medium"><ChevronRight className="size-4 transition group-open:rotate-90" aria-hidden="true" />O que o agente lembrou ({contextKeys.length})</summary>
          <pre className="max-h-64 overflow-auto px-3 pb-3 text-[11px] whitespace-pre-wrap">{JSON.stringify(Object.fromEntries(contextKeys.map((k) => [k, state!.context[k]])), null, 2)}</pre></details>}
        <label className="mt-3 flex items-center justify-between gap-3 text-[12.5px]"><span>Mostrar ferramentas usadas pelo agente</span><Switch checked={showTools} onCheckedChange={setShowTools} aria-label="Mostrar ferramentas usadas pelo agente" /></label>
      </Panel>
      <Panel className="p-4 text-[12.5px] text-muted-foreground lg:p-5">
        <h3 className="mb-2 text-[14px] font-semibold text-foreground">Como funciona</h3>
        <ul className="list-disc space-y-1 pl-4">
          <li>Usa as suas quadras, horários, preços e configurações do bot. Salve uma mudança e a próxima mensagem já segue ela.</li>
          <li>Reservas feitas aqui entram na agenda como <b>[Teste]</b> e ocupam o horário até você apagar a memória.</li>
          <li>Pix, fotos e aviso para a equipe são só simulados: nada sai do sistema.</li>
        </ul>
      </Panel>
    </div>
  </div>;
}
