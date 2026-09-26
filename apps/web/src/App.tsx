import { useEffect, type ReactNode } from 'react';
import { CalendarDays, CircleHelp, LayoutDashboard, LogOut, Menu, Settings2, Trophy, UserPlus, Users, WalletCards, Waves } from 'lucide-react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { LoginPage } from '@/pages/LoginPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { SignupPage } from '@/pages/SignupPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { AgendaPage } from '@/pages/AgendaPage';
import { ReservationsPage } from '@/pages/ReservationsPage';
import { CourtsPage } from '@/pages/CourtsPage';
import { ClientsPage } from '@/pages/ClientsPage';
import { FinancePage } from '@/pages/FinancePage';
import { MonthlyMembersPage } from '@/pages/MonthlyMembersPage';
import { TournamentsPage } from '@/pages/TournamentsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { WhatsAppPage } from '@/pages/WhatsAppPage';
import { PublicArenaPage } from '@/pages/PublicArenaPage';
import { UsersPage } from '@/pages/UsersPage';
import { PlatformPage } from '@/pages/PlatformPage';

const navigation = [
  { label: 'Visão geral', icon: LayoutDashboard, path: '/' },
  { label: 'Agenda', icon: CalendarDays, path: '/agenda' },
  { label: 'Reservas', icon: CalendarDays, path: '/reservas' },
  { label: 'Quadras', icon: Waves, path: '/quadras' },
  { label: 'Mensalistas', icon: CalendarDays, path: '/mensalistas' },
  { label: 'Clientes', icon: Users, path: '/clientes' },
  { label: 'Equipe e acessos', icon: UserPlus, path: '/usuarios' },
  { label: 'Financeiro', icon: WalletCards, path: '/financeiro' },
  { label: 'WhatsApp', icon: CircleHelp, path: '/whatsapp' },
  { label: 'Torneios', icon: Trophy, path: '/torneios' },
  { label: 'Configurações', icon: Settings2, path: '/configuracoes' },
];

function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">Carregando sua arena…</main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role === 'platform_admin' && location.pathname !== '/platform') return <Navigate to="/platform" replace />;
  if (user.setupNeeded && user.role !== 'arena_admin') return <main className="grid min-h-svh place-items-center p-5"><section className="max-w-md rounded-xl border bg-card p-7 text-center"><h1 className="text-xl font-bold">Configuração da arena em andamento</h1><p className="mt-2 text-sm text-muted-foreground">O administrador da arena precisa concluir a configuração inicial antes de liberar o painel.</p></section></main>;
  if (user.setupNeeded && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  if (!user.setupNeeded && location.pathname === '/onboarding') return <Navigate to="/" replace />;
  return <Outlet />;
}

function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const page = navigation.find((item) => item.path === location.pathname)?.label ?? 'Sua arena';

  useEffect(() => { document.title = `${page} · QuadrasFlow`; }, [page]);

  async function signOut() { await logout(); navigate('/login', { replace: true }); }
  if (user?.role === 'platform_admin') return <PlatformPage />;

  const migrated: Record<string, ReactNode> = {
    '/': <DashboardPage />, '/agenda': <AgendaPage />, '/reservas': <ReservationsPage />, '/quadras': <CourtsPage />, '/clientes': <ClientsPage />, '/usuarios': <UsersPage />, '/financeiro': <FinancePage />, '/mensalistas': <MonthlyMembersPage />, '/torneios': <TournamentsPage />, '/configuracoes': <SettingsPage />, '/whatsapp': <WhatsAppPage />,
  };
  return <div className="min-h-svh lg:grid lg:grid-cols-[248px_1fr]"><aside className="hidden border-r bg-[#0c382f] px-4 py-5 text-white lg:flex lg:flex-col"><Link to="/" className="mb-8 flex items-center gap-3 px-2 text-lg font-extrabold"><span className="grid size-9 place-items-center rounded-xl bg-lime-400 text-[#0c382f]">Q</span><span>Quadras<span className="text-lime-400">Flow</span></span></Link><p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-white/50">Gestão da arena</p><nav className="grid gap-1">{navigation.map(({ label, icon: Icon, path }) => <Link key={path} to={path} aria-current={location.pathname === path ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${location.pathname === path ? 'bg-white/15 text-lime-300' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}><Icon size={17} aria-hidden="true" />{label}</Link>)}</nav><div className="mt-auto border-t border-white/15 pt-4"><p className="truncate px-3 text-xs font-semibold">{user?.name}</p><p className="truncate px-3 pt-1 text-[11px] text-white/55">{user?.company?.name}</p><Button variant="ghost" className="mt-3 w-full justify-start text-white/75 hover:bg-white/10 hover:text-white" onClick={() => void signOut()}><LogOut /> Sair</Button></div></aside><main className="min-w-0"><header className="flex h-16 items-center justify-between border-b bg-card px-4 sm:px-5 lg:px-8"><div className="flex min-w-0 items-center gap-3"><Sheet><SheetTrigger asChild><Button variant="outline" size="icon" className="lg:hidden" aria-label="Abrir menu"><Menu size={18}/></Button></SheetTrigger><SheetContent side="left" className="w-[280px] bg-[#0c382f] p-4 text-white"><SheetHeader className="px-2"><SheetTitle className="text-left text-lg text-white">Quadras<span className="text-lime-400">Flow</span></SheetTitle></SheetHeader><nav className="mt-4 grid gap-1">{navigation.map(({label,icon:Icon,path})=><SheetClose key={path} asChild><Link to={path} aria-current={location.pathname===path?'page':undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${location.pathname===path?'bg-white/15 text-lime-300':'text-white/75 hover:bg-white/10 hover:text-white'}`}><Icon size={17}/>{label}</Link></SheetClose>)}</nav><div className="mt-auto border-t border-white/15 pt-4"><p className="truncate px-3 text-xs font-semibold">{user?.name}</p><Button variant="ghost" className="mt-2 w-full justify-start text-white/75 hover:bg-white/10 hover:text-white" onClick={()=>void signOut()}><LogOut/> Sair</Button></div></SheetContent></Sheet><p className="truncate text-sm text-muted-foreground">{user?.company?.name || 'Sua arena'} <span className="px-1 text-border">/</span><strong className="text-foreground">{page}</strong></p></div><div className="flex items-center gap-3"><span className="hidden max-w-48 truncate text-xs text-muted-foreground sm:inline">{user?.name}</span><Button variant="outline" size="icon" aria-label="Ajuda"><CircleHelp size={17} /></Button></div></header><div className="mx-auto max-w-7xl p-5 lg:p-8"><Routes>{navigation.map((item) => <Route key={item.path} path={item.path} element={migrated[item.path] || <Navigate to="/" replace />} />)}<Route path="/platform" element={<Navigate to="/" replace />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></div></main></div>;
}

function AppRoutes() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/cadastro" element={<SignupPage />} />
    <Route path="/a/:slug" element={<PublicArenaPage />} />
    <Route path="/avaliar/:token" element={<PublicArenaPage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/*" element={<MainLayout />} />
    </Route>
  </Routes>;
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>;
}
