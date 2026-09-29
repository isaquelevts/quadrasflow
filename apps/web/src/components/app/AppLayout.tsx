import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import {
  Bell, CalendarCheck, CalendarDays, ChevronRight, Headset, LandPlot, LayoutGrid, LogOut, Menu, MessageCircle, Plus, Repeat,
  Settings2, Trophy, UserCog, Users, Wallet, type LucideProps,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import logoMark from '@/assets/logo-mark.svg';
import { useAuth } from '@/auth/AuthProvider';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, useSidebar,
} from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AccountSheet } from '@/components/app/AccountSheet';
import { ShellProvider, useShell, type ShellCounts } from '@/components/app/shell-context';
import { formatPhone, initials } from '@/lib/format';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type NavItem = { label: string; path: string; icon: ComponentType<LucideProps>; extra?: (counts: ShellCounts) => ReactNode; adminOnly?: boolean };

export const navigation: Array<{ group: string; items: NavItem[] }> = [
  { group: 'Operação', items: [
    { label: 'Visão geral', path: '/', icon: LayoutGrid },
    { label: 'Agenda', path: '/agenda', icon: CalendarDays },
    { label: 'Reservas', path: '/reservas', icon: CalendarCheck, extra: (c) => c.pending > 0 ? <SidebarMenuBadge className="rounded-full bg-amber-400/15 px-1.5 text-[10.5px] font-semibold text-amber-300" aria-label={`${c.pending} pendentes`}>{c.pending}</SidebarMenuBadge> : null },
    { label: 'Quadras', path: '/quadras', icon: LandPlot },
    { label: 'Mensalistas', path: '/mensalistas', icon: Repeat },
  ] },
  { group: 'Gestão', items: [
    { label: 'Clientes', path: '/clientes', icon: Users },
    { label: 'Financeiro', path: '/financeiro', icon: Wallet, adminOnly: true },
    { label: 'Torneios', path: '/torneios', icon: Trophy },
    { label: 'WhatsApp', path: '/whatsapp', icon: MessageCircle, extra: (c) => c.whatsapp === 'unknown' ? null : <SidebarMenuBadge className="gap-1.5 text-[10.5px] font-normal text-white/45"><span aria-hidden="true" className={cn('size-1.5 rounded-full', c.whatsapp === 'on' ? 'bg-lime-400' : 'bg-white/30')} />{c.whatsapp === 'on' ? 'on' : 'off'}</SidebarMenuBadge> },
  ] },
  { group: 'Conta', items: [
    { label: 'Equipe e acessos', path: '/usuarios', icon: UserCog, adminOnly: true },
    { label: 'Configurações', path: '/configuracoes', icon: Settings2, adminOnly: true },
  ] },
];

export const allNavItems = navigation.flatMap((group) => group.items);

/** A Recepção (papel "staff") não vê Financeiro, Equipe nem Configurações. */
export const canSee = (item: NavItem, role: string | undefined) => !item.adminOnly || role === 'arena_admin';
export const roleLabel = (role: string | undefined) => role === 'arena_admin' ? 'Administrador' : role === 'staff' ? 'Recepção' : 'Plataforma';

export function AppLayout({ children }: { children: ReactNode }) {
  return <ShellProvider>
    <TooltipProvider delayDuration={300}>
      <SidebarProvider className="bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          <main className="mx-auto w-full min-w-0 max-w-[1280px] flex-1 space-y-4 px-4 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:space-y-5 lg:px-8 lg:pt-8 lg:pb-10">
            {children}
          </main>
        </div>
        <BottomNav />
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  </ShellProvider>;
}

function usePageTitle() {
  const location = useLocation();
  return allNavItems.find((item) => item.path === location.pathname)?.label ?? 'Sua arena';
}

function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { counts } = useShell();
  const { setOpenMobile, isMobile } = useSidebar();
  const company = user?.company?.name || 'Sua arena';
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => { if (isMobile) setOpenMobile(false); }, [location.pathname, isMobile, setOpenMobile]);

  async function signOut() { await logout(); navigate('/login', { replace: true }); }

  return <Sidebar className="border-r-0">
    <SidebarHeader className="gap-0 p-0">
      <Link to="/" className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <img src={logoMark} alt="" aria-hidden="true" className="size-8" />
        <span className="text-[15px] font-semibold tracking-tight text-white">Quadras<span className="text-lime-400">Flow</span></span>
      </Link>
      <div className="px-3 pt-4">
        {/* Seletor de arena: hoje cada conta pertence a uma arena, então mostra a arena ativa. */}
        <div className="flex w-full items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-700 text-xs font-semibold text-lime-300">{initials(company)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-white">{company}</span>
            <span className="block text-[11px] text-white/50">{counts.courts === 1 ? '1 quadra ativa' : `${counts.courts} quadras ativas`}</span>
          </span>
        </div>
      </div>
    </SidebarHeader>
    <SidebarContent className="scrollbar-none gap-4 px-1 py-3">
      {navigation.map((group) => ({ ...group, items: group.items.filter((item) => canSee(item, user?.role)) })).filter((group) => group.items.length).map((group) => <SidebarGroup key={group.group} className="py-0">
        <SidebarGroupLabel className="px-3 text-[10.5px] font-semibold tracking-[0.08em] text-white/35 uppercase">{group.group}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu className="gap-0.5">
            {group.items.map((item) => {
              const active = location.pathname === item.path;
              return <SidebarMenuItem key={item.path}>
                <SidebarMenuButton asChild isActive={active} className={cn(
                  'relative h-9 gap-3 px-3 text-[14px] text-white/80 hover:bg-white/[0.05] hover:text-white',
                  'data-[active=true]:bg-white/[0.07] data-[active=true]:font-medium data-[active=true]:text-lime-400',
                  'focus-visible:ring-2 focus-visible:ring-brand-500',
                )}>
                  <Link to={item.path} aria-current={active ? 'page' : undefined}>
                    {active && <span aria-hidden="true" className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r bg-lime-400" />}
                    <item.icon className="size-4" aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
                {item.extra?.(counts)}
              </SidebarMenuItem>;
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>)}
    </SidebarContent>
    <SidebarFooter className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-1 rounded-lg">
        <button type="button" onClick={() => setAccountOpen(true)} aria-label="Minha conta" title="Minha conta" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-brand-500">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lime-400/90 text-xs font-semibold text-brand-950">{initials(user?.name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-white">{user?.name}</span>
            <span className="block truncate text-[11px] text-white/45">{roleLabel(user?.role)} · {company}</span>
          </span>
        </button>
        <button type="button" onClick={() => void signOut()} aria-label="Sair" title="Sair" className="grid size-8 place-items-center rounded-md text-white/50 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-brand-500">
          <LogOut className="size-4" aria-hidden="true" />
        </button>
      </div>
    </SidebarFooter>
    <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
  </Sidebar>;
}

function AppHeader() {
  const { user } = useAuth();
  const { setOpenMobile } = useSidebar();
  const title = usePageTitle();

  useEffect(() => { document.title = `${title} · QuadrasFlow`; }, [title]);

  return <header className="sticky top-0 z-30 h-16 border-b bg-white/85 backdrop-blur">
    <div className="mx-auto flex h-full max-w-[1280px] items-center gap-3 px-4 lg:gap-4 lg:px-8">
      <button type="button" onClick={() => setOpenMobile(true)} aria-label="Abrir menu" className="grid size-10 place-items-center rounded-md border bg-white shadow-xs lg:hidden">
        <Menu className="size-4" aria-hidden="true" />
      </button>
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <img src={logoMark} alt="" aria-hidden="true" className="size-7 shrink-0" />
        <span className="truncate font-semibold tracking-tight">{title}</span>
      </div>
      <nav aria-label="Caminho" className="hidden items-center gap-1.5 text-[13px] lg:flex">
        <span className="text-muted-foreground">{user?.company?.name || 'Sua arena'}</span>
        <ChevronRight className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
        <span className="font-medium" aria-current="page">{title}</span>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <NotificationsBell />
      </div>
    </div>
  </header>;
}

/** Sininho: reservas pendentes e clientes esperando a equipe no WhatsApp. */
function NotificationsBell() {
  const { counts } = useShell();
  const [open, setOpen] = useState(false);
  const waiting = counts.attention.length, total = counts.pending + waiting;
  const label = total ? [counts.pending ? `${counts.pending} reserva(s) pendente(s)` : '', waiting ? `${waiting} cliente(s) esperando a equipe` : ''].filter(Boolean).join(', ') : 'Nenhum aviso';
  const since = (iso: string) => { const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return minutes < 1 ? 'agora' : minutes < 60 ? `há ${minutes} min` : minutes < 1440 ? `há ${Math.round(minutes / 60)} h` : new Date(iso).toLocaleDateString('pt-BR'); };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger aria-label={`Avisos: ${label}`} title="Avisos" className="relative grid size-10 place-items-center rounded-md border bg-white shadow-xs hover:bg-muted lg:size-9">
      <Bell className="size-4" aria-hidden="true" />
      {waiting > 0 ? <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 grid size-[18px] place-items-center rounded-full bg-rose-500 text-[10px] font-semibold text-white ring-2 ring-white">{waiting > 9 ? '9+' : waiting}</span>
        : counts.pending > 0 && <span aria-hidden="true" className="absolute top-2 right-2 size-2 rounded-full bg-amber-500 ring-2 ring-white" />}
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
      <div className="border-b px-4 py-3 text-[14px] font-semibold">Avisos</div>
      <div className="max-h-[60vh] overflow-auto">
        {waiting > 0 && <section aria-label="Esperando a equipe" className="border-b py-1">
          <p className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Esperando a equipe no WhatsApp</p>
          {counts.attention.slice(0, 8).map((item) => <Link key={item.phone} to={`/whatsapp?phone=${encodeURIComponent(item.phone)}`} onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/60">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600"><Headset className="size-4" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1 text-[13px]"><span className="flex justify-between gap-2"><span className="font-medium tabular-nums">{formatPhone(item.phone)}</span><span className="shrink-0 text-[11px] text-muted-foreground">{since(item.at)}</span></span>
              <span className={cn('mt-0.5 inline-block rounded px-1.5 text-[11px] font-medium', item.paused ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-800')}>{item.paused ? 'Bot pausado' : 'Fora do horário · bot segue atendendo'}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{item.reason}</span></span>
          </Link>)}
          {waiting > 8 && <Link to="/whatsapp" onClick={() => setOpen(false)} className="block px-4 py-2 text-[12.5px] font-medium text-brand-700 hover:underline">Ver todas as {waiting} conversas</Link>}
        </section>}
        <Link to="/reservas" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600"><CalendarCheck className="size-4" aria-hidden="true" /></span>
          <span className="flex-1 text-[13px]">{counts.pending ? <><b className="font-semibold">{counts.pending}</b> reserva(s) aguardando confirmação</> : 'Nenhuma reserva pendente'}</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </Link>
      </div>
    </PopoverContent>
  </Popover>;
}

function BottomNav() {
  const location = useLocation();
  const { counts, runPrimaryAction } = useShell();
  const { setOpenMobile } = useSidebar();
  const tab = (path: string, label: string, Icon: ComponentType<LucideProps>, badge?: number) => {
    const active = location.pathname === path;
    return <Link to={path} aria-current={active ? 'page' : undefined} className={cn('relative flex flex-col items-center justify-center gap-1', active ? 'text-brand-700' : 'text-muted-foreground')}>
      <span className={cn('relative grid h-7 w-12 place-items-center rounded-full', active && 'bg-brand-50')}>
        <Icon className="size-[18px]" aria-hidden="true" />
        {badge ? <span aria-label={`${badge} pendentes`} className="absolute top-0 right-2.5 grid size-4 place-items-center rounded-full bg-amber-500 text-[9.5px] text-white ring-2 ring-white">{badge > 9 ? '9+' : badge}</span> : null}
      </span>{label}
    </Link>;
  };
  return <nav aria-label="Navegação rápida" className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
    <div className="grid h-16 grid-cols-5 text-[10.5px] font-medium">
      {tab('/', 'Início', LayoutGrid)}
      {tab('/agenda', 'Agenda', CalendarDays)}
      <div className="grid place-items-center">
        <button type="button" onClick={runPrimaryAction} aria-label="Criar novo" title="Criar novo"
          className="-mt-6 grid size-14 place-items-center rounded-2xl bg-brand-900 text-lime-400 shadow-lg ring-4 shadow-brand-900/30 ring-white transition active:scale-95">
          <Plus className="size-6" aria-hidden="true" />
        </button>
      </div>
      {tab('/reservas', 'Reservas', CalendarCheck, counts.pending)}
      <button type="button" onClick={() => setOpenMobile(true)} className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
        <span className="grid h-7 w-12 place-items-center"><Menu className="size-[18px]" aria-hidden="true" /></span>Menu
      </button>
    </div>
  </nav>;
}
