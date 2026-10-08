import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Check, CreditCard, MessageCircle, Star, Trophy, Users, Repeat, BarChart3, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Brand } from '@/components/Brand';

const features = [
  { icon: CalendarDays, title: 'Agenda por quadra', text: 'Veja o dia inteiro de todas as quadras, com reservas, bloqueios e horários livres em um só lugar.' },
  { icon: MessageCircle, title: 'Reservas pelo WhatsApp', text: 'Seus clientes pedem horário, escolhem a quadra e confirmam conversando. Sem você precisar responder.' },
  { icon: Link2, title: 'Página pública de reservas', text: 'Um link com a cara da sua arena para o cliente reservar sozinho, a qualquer hora.' },
  { icon: CreditCard, title: 'Pagamento via Pix', text: 'Integração com Mercado Pago: link Pix e confirmação automática do pagamento.' },
  { icon: Repeat, title: 'Mensalistas', text: 'Controle quem joga toda semana, sem precisar refazer a reserva a cada rodada.' },
  { icon: Trophy, title: 'Torneios', text: 'Organize campeonatos e divulgue pela página pública da arena.' },
  { icon: BarChart3, title: 'Financeiro', text: 'Acompanhe o que entrou, o que está pendente e o desempenho da arena.' },
  { icon: Star, title: 'Avaliações', text: 'Colete a opinião de quem jogou e mostre a qualidade da sua arena.' },
];

const steps = [
  { n: '1', title: 'Crie sua conta', text: 'Cadastre a arena em poucos minutos.' },
  { n: '2', title: 'Configure quadras e preços', text: 'Modalidades, horários e preços por faixa, em quatro etapas guiadas.' },
  { n: '3', title: 'Receba reservas', text: 'Compartilhe o link ou conecte o WhatsApp e acompanhe tudo no painel.' },
];

const benefits = ['Menos tempo no telefone', 'Menos horários vazios', 'Menos reservas perdidas', 'Cada arena com seus dados isolados'];

function Nav() {
  return <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
    <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
      <Link to="/" aria-label="QuadrasFlow"><Brand /></Link>
      <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
        <a href="#recursos" className="hover:text-foreground">Recursos</a>
        <a href="#como-funciona" className="hover:text-foreground">Como funciona</a>
        <a href="#whatsapp" className="hover:text-foreground">WhatsApp</a>
      </nav>
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm"><Link to="/login">Entrar</Link></Button>
        <Button asChild size="sm"><Link to="/cadastro">Criar conta</Link></Button>
      </div>
    </div>
  </header>;
}

function ChatMock() {
  const bubble = 'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-xs';
  return <div className="mx-auto w-full max-w-sm rounded-3xl border bg-white p-4 shadow-xl shadow-primary/10" aria-hidden="true">
    <div className="mb-3 flex items-center gap-2 border-b pb-3">
      <span className="grid size-9 place-items-center rounded-full bg-brand-900 text-sm font-bold text-lime-400">Q</span>
      <div><p className="text-sm font-semibold">Arena Exemplo</p><p className="text-xs text-brand-600">online</p></div>
    </div>
    <div className="grid gap-2.5">
      <p className={`${bubble} bg-muted`}>Oi! Tem quadra livre amanhã à noite?</p>
      <p className={`${bubble} ml-auto bg-brand-100 text-brand-950`}>Tem sim! Amanhã temos 19h, 20h e 21h livres. Qual prefere?</p>
      <p className={`${bubble} bg-muted`}>20h, quadra de society</p>
      <p className={`${bubble} ml-auto bg-brand-100 text-brand-950`}>Reservado para 20h. Segue o link Pix para confirmar.</p>
    </div>
  </div>;
}

export function LandingPage() {
  return <div className="min-h-svh bg-white text-foreground">
    <Nav />
    <main>
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-400/40 bg-white px-3 py-1 text-xs font-semibold text-brand-800">
              <span className="size-1.5 rounded-full bg-lime-400" /> Gestão para arenas esportivas
            </span>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-brand-950 sm:text-5xl lg:text-6xl">Sua arena sempre cheia, <span className="text-brand-600">sem dor de cabeça.</span></h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">Agenda, reservas, pagamentos, mensalistas e torneios em um só sistema. Seus clientes reservam pelo link ou pelo WhatsApp, e você acompanha tudo no painel.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6 text-base"><Link to="/cadastro">Criar minha arena <ArrowRight /></Link></Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base"><Link to="/login">Já tenho conta</Link></Button>
            </div>
            <ul className="mt-8 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              {benefits.map((b) => <li key={b} className="flex items-center gap-2"><Check size={16} className="shrink-0 text-brand-600" />{b}</li>)}
            </ul>
          </div>
          <ChatMock />
        </div>
      </section>

      <section id="recursos" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-brand-950 sm:text-4xl">Tudo o que a arena precisa</h2>
          <p className="mt-3 text-muted-foreground">Da reserva ao financeiro, sem planilhas e sem anotar horário no caderno.</p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, text }) => <article key={title} className="rounded-xl border bg-card p-5 shadow-card transition-shadow hover:shadow-md">
            <span className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon size={20} /></span>
            <h3 className="mt-4 font-semibold text-brand-950">{title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
          </article>)}
        </div>
      </section>

      <section id="whatsapp" className="scroll-mt-20 bg-brand-950 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
          <div>
            <span className="text-sm font-semibold uppercase tracking-wider text-lime-400">Atendimento automático</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">O WhatsApp da arena trabalha por você</h2>
            <p className="mt-4 text-white/75">O cliente pergunta os horários, escolhe a quadra, vê o preço e confirma a reserva. Também dá para remarcar e cancelar, seguindo as regras e prazos que você definir.</p>
          </div>
          <ul className="grid gap-3">
            {['Horários livres do dia na hora', 'Preço por faixa de horário e por quadra', 'Remarcação e cancelamento com regras suas', 'Fotos das quadras enviadas na conversa'].map((t) => <li key={t} className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm ring-1 ring-white/10"><Check size={18} className="shrink-0 text-lime-400" />{t}</li>)}
          </ul>
        </div>
      </section>

      <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-brand-950 sm:text-4xl">Comece em três passos</h2>
        </div>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((s) => <li key={s.n} className="rounded-xl border bg-card p-6">
            <span className="grid size-10 place-items-center rounded-full bg-lime-400 text-lg font-extrabold text-brand-950">{s.n}</span>
            <h3 className="mt-4 text-lg font-semibold text-brand-950">{s.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p>
          </li>)}
        </ol>
      </section>

      <section className="px-4 pb-16 sm:px-6 md:pb-24">
        <div className="mx-auto max-w-6xl rounded-3xl bg-gradient-to-br from-brand-900 to-brand-700 px-6 py-14 text-center text-white sm:px-12">
          <Users className="mx-auto text-lime-400" size={32} />
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Pronto para organizar sua arena?</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/80">Crie sua conta e configure quadras, horários e preços em poucos minutos.</p>
          <Button asChild size="lg" className="mt-8 h-12 bg-lime-400 px-7 text-base font-semibold text-brand-950 hover:bg-lime-300"><Link to="/cadastro">Criar minha arena <ArrowRight /></Link></Button>
        </div>
      </section>
    </main>
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
        <p>© {new Date().getFullYear()} QuadrasFlow. Todos os direitos reservados.</p>
        <div className="flex gap-5"><Link className="hover:text-foreground" to="/login">Entrar</Link><Link className="hover:text-foreground" to="/cadastro">Criar conta</Link></div>
      </div>
    </footer>
  </div>;
}
