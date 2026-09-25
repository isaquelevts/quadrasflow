import { CalendarDays, ChartNoAxesColumnIncreasing, CircleHelp, LayoutDashboard, Settings2, Trophy, Users, WalletCards } from 'lucide-react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const navigation = [
  { label: 'Visão geral', icon: LayoutDashboard, path: '/' },
  { label: 'Agenda e reservas', icon: CalendarDays, path: '/agenda' },
  { label: 'Clientes', icon: Users, path: '/clientes' },
  { label: 'Financeiro', icon: WalletCards, path: '/financeiro' },
  { label: 'Torneios', icon: Trophy, path: '/torneios' },
  { label: 'Relatórios', icon: ChartNoAxesColumnIncreasing, path: '/relatorios' },
  { label: 'Configurações', icon: Settings2, path: '/configuracoes' },
];

function ComingSoon({ title }: { title: string }) {
  return <section className="rounded-xl border bg-card p-8 shadow-sm"><p className="text-sm font-semibold text-primary">QuadrasFlow · Nova interface</p><h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1><p className="mt-2 max-w-xl text-sm text-muted-foreground">Esta área está sendo migrada para a nova interface. Enquanto isso, a versão atual do sistema continua disponível.</p><Button asChild className="mt-6"><a href="https://quadras.helioscreative.com.br/login">Acessar a versão atual</a></Button></section>;
}

function SignIn() {
  return <main className="grid min-h-svh place-items-center p-5"><section className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm"><div className="mb-7 flex items-center justify-center gap-2 text-xl font-extrabold text-primary"><span className="grid size-9 place-items-center rounded-xl bg-lime-400 text-base">Q</span>Quadras<span className="-ml-2 text-lime-600">Flow</span></div><h1 className="text-2xl font-bold tracking-tight">Acesse sua arena</h1><p className="mt-2 text-sm text-muted-foreground">Entre com o e-mail e a senha da sua conta.</p><form className="mt-6 grid gap-4" onSubmit={(event) => event.preventDefault()}><label className="grid gap-2 text-sm font-medium">E-mail<input type="email" autoComplete="username" className="h-11 rounded-lg border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" required /></label><label className="grid gap-2 text-sm font-medium">Senha<input type="password" autoComplete="current-password" className="h-11 rounded-lg border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" required /></label><Button type="submit" className="mt-1 h-11">Entrar</Button></form><p className="mt-6 text-center text-xs text-muted-foreground">O novo fluxo de acesso será conectado à API na fase de autenticação.</p></section></main>;
}

function SignupPlaceholder() {
  return <main className="grid min-h-svh place-items-center p-5"><section className="w-full max-w-lg rounded-2xl border bg-card p-8 shadow-sm"><h1 className="text-2xl font-bold">Crie o acesso da sua arena</h1><p className="mt-2 text-sm text-muted-foreground">O cadastro e a configuração em etapas serão conectados à API na fase de migração da autenticação.</p><Button asChild className="mt-6" variant="outline"><Link to="/login">Voltar ao acesso</Link></Button></section></main>;
}

function Shell() {
  const location = useLocation();
  const page = navigation.find((item) => item.path === location.pathname)?.label ?? 'QuadrasFlow';
  return <div className="min-h-svh lg:grid lg:grid-cols-[250px_1fr]"><aside className="hidden border-r bg-[#0c382f] px-4 py-5 text-white lg:flex lg:flex-col"><Link to="/" className="mb-8 flex items-center gap-3 px-2 text-lg font-extrabold"><span className="grid size-9 place-items-center rounded-xl bg-lime-400 text-[#0c382f]">Q</span><span>Quadras<span className="text-lime-400">Flow</span></span></Link><p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-white/50">Gestão da arena</p><nav className="grid gap-1">{navigation.map(({ label, icon: Icon, path }) => <Link key={path} to={path} aria-current={location.pathname === path ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${location.pathname === path ? 'bg-white/15 text-lime-300' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}><Icon size={17} aria-hidden="true" />{label}</Link>)}</nav><div className="mt-auto rounded-xl border border-white/15 bg-white/5 p-3 text-xs text-white/65"><CircleHelp className="mb-2" size={17} />A versão atual segue ativa enquanto esta interface é migrada.</div></aside><main className="min-w-0"><header className="flex h-16 items-center justify-between border-b bg-card px-5 lg:px-8"><p className="text-sm text-muted-foreground">Sua arena <span className="px-1 text-border">/</span><strong className="text-foreground">{page}</strong></p><Button variant="outline" size="icon" aria-label="Ajuda"><CircleHelp size={17} /></Button></header><div className="mx-auto max-w-7xl p-5 lg:p-8"><Routes>{navigation.map((item) => <Route key={item.path} path={item.path} element={<ComingSoon title={item.label} />} />)}<Route path="*" element={<Navigate to="/" replace />} /></Routes></div></main></div>;
}

export default function App() {
  const location = useLocation();
  if (location.pathname === '/login') return <SignIn />;
  if (location.pathname === '/cadastro' || location.pathname === '/onboarding') return <SignupPlaceholder />;
  return <Shell />;
}
