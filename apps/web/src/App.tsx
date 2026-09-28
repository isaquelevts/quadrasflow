import type { ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { AppLayout, allNavItems } from '@/components/app/AppLayout';
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
  const { user } = useAuth();
  if (user?.role === 'platform_admin') return <PlatformPage />;

  const pages: Record<string, ReactNode> = {
    '/': <DashboardPage />, '/agenda': <AgendaPage />, '/reservas': <ReservationsPage />, '/quadras': <CourtsPage />, '/clientes': <ClientsPage />, '/usuarios': <UsersPage />, '/financeiro': <FinancePage />, '/mensalistas': <MonthlyMembersPage />, '/torneios': <TournamentsPage />, '/configuracoes': <SettingsPage />, '/whatsapp': <WhatsAppPage />,
  };
  return <AppLayout><Routes>{allNavItems.map((item) => <Route key={item.path} path={item.path} element={pages[item.path] || <Navigate to="/" replace />} />)}<Route path="/platform" element={<Navigate to="/" replace />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></AppLayout>;
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
