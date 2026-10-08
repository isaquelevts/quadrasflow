import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { AppLayout, allNavItems, canSee } from '@/components/app/AppLayout';

// Cada tela é carregada só quando é aberta (divide o JavaScript em partes menores).
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })));
const LandingPage = lazy(() => import('@/pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const SignupPage = lazy(() => import('@/pages/SignupPage').then((m) => ({ default: m.SignupPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const AgendaPage = lazy(() => import('@/pages/AgendaPage').then((m) => ({ default: m.AgendaPage })));
const ReservationsPage = lazy(() => import('@/pages/ReservationsPage').then((m) => ({ default: m.ReservationsPage })));
const CourtsPage = lazy(() => import('@/pages/CourtsPage').then((m) => ({ default: m.CourtsPage })));
const ClientsPage = lazy(() => import('@/pages/ClientsPage').then((m) => ({ default: m.ClientsPage })));
const FinancePage = lazy(() => import('@/pages/FinancePage').then((m) => ({ default: m.FinancePage })));
const MonthlyMembersPage = lazy(() => import('@/pages/MonthlyMembersPage').then((m) => ({ default: m.MonthlyMembersPage })));
const TournamentsPage = lazy(() => import('@/pages/TournamentsPage').then((m) => ({ default: m.TournamentsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const WhatsAppPage = lazy(() => import('@/pages/WhatsAppPage').then((m) => ({ default: m.WhatsAppPage })));
const PublicArenaPage = lazy(() => import('@/pages/PublicArenaPage').then((m) => ({ default: m.PublicArenaPage })));
const UsersPage = lazy(() => import('@/pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const InvitePage = lazy(() => import('@/pages/InvitePage').then((m) => ({ default: m.InvitePage })));
const PlatformPage = lazy(() => import('@/pages/PlatformPage').then((m) => ({ default: m.PlatformPage })));

function PageFallback() {
  return <div className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground" role="status">Carregando…</div>;
}

function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">Carregando sua arena…</main>;
  if (!user && location.pathname === '/') return <Suspense fallback={<PageFallback />}><LandingPage /></Suspense>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role === 'platform_admin' && location.pathname !== '/platform') return <Navigate to="/platform" replace />;
  if (user.setupNeeded && user.role !== 'arena_admin') return <main className="grid min-h-svh place-items-center p-5"><section className="max-w-md rounded-xl border bg-card p-7 text-center"><h1 className="text-xl font-bold">Configuração da arena em andamento</h1><p className="mt-2 text-sm text-muted-foreground">O administrador da arena precisa concluir a configuração inicial antes de liberar o painel.</p></section></main>;
  if (user.setupNeeded && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  if (!user.setupNeeded && location.pathname === '/onboarding') return <Navigate to="/" replace />;
  return <Outlet />;
}

function MainLayout() {
  const { user } = useAuth();
  if (user?.role === 'platform_admin') return <Suspense fallback={<PageFallback />}><PlatformPage /></Suspense>;

  const pages: Record<string, ReactNode> = {
    '/': <DashboardPage />, '/agenda': <AgendaPage />, '/reservas': <ReservationsPage />, '/quadras': <CourtsPage />, '/clientes': <ClientsPage />, '/usuarios': <UsersPage />, '/financeiro': <FinancePage />, '/mensalistas': <MonthlyMembersPage />, '/torneios': <TournamentsPage />, '/configuracoes': <SettingsPage />, '/whatsapp': <WhatsAppPage />,
  };
  return <AppLayout><Suspense fallback={<PageFallback />}><Routes>{allNavItems.map((item) => <Route key={item.path} path={item.path} element={canSee(item, user?.role) && pages[item.path] ? pages[item.path] : <Navigate to="/" replace />} />)}<Route path="/platform" element={<Navigate to="/" replace />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Suspense></AppLayout>;
}

function AppRoutes() {
  return <Suspense fallback={<PageFallback />}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/cadastro" element={<SignupPage />} />
    <Route path="/a/:slug" element={<PublicArenaPage />} />
    <Route path="/avaliar/:token" element={<PublicArenaPage />} />
    <Route path="/convite/:token" element={<InvitePage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/*" element={<MainLayout />} />
    </Route>
  </Routes></Suspense>;
}

export default function App() {
  return <AuthProvider><AppRoutes /></AuthProvider>;
}
