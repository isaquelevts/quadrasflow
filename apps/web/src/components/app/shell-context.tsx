import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

export type ShellCounts = { pending: number; courts: number; whatsapp: 'on' | 'off' | 'unknown' };

type ShellContextValue = {
  counts: ShellCounts;
  refreshCounts: () => void;
  runPrimaryAction: () => void;
  registerPrimaryAction: (handler: (() => void) | null) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [counts, setCounts] = useState<ShellCounts>({ pending: 0, courts: 0, whatsapp: 'unknown' });
  const primary = useRef<(() => void) | null>(null);

  // Contadores do menu vêm da API (nunca fixos no código).
  const refreshCounts = useCallback(() => {
    void api<{ pending: { count: number }; today: { courts_active: number } }>('/api/dashboard')
      .then((data) => setCounts((current) => ({ ...current, pending: data.pending.count, courts: data.today.courts_active })))
      .catch(() => undefined);
    void api<{ status?: string; session?: string }>('/api/integrations/waha')
      .then((data) => setCounts((current) => ({ ...current, whatsapp: !data.session ? 'off' : data.status === 'WORKING' ? 'on' : 'off' })))
      .catch(() => setCounts((current) => ({ ...current, whatsapp: 'unknown' })));
  }, []);

  useEffect(() => { refreshCounts(); }, [refreshCounts, location.pathname]);
  useEffect(() => {
    const timer = window.setInterval(refreshCounts, 60_000);
    window.addEventListener('qf:bookings-changed', refreshCounts);
    return () => { window.clearInterval(timer); window.removeEventListener('qf:bookings-changed', refreshCounts); };
  }, [refreshCounts]);

  const registerPrimaryAction = useCallback((handler: (() => void) | null) => { primary.current = handler; }, []);
  // O "+" da barra inferior chama a criação da tela atual; sem ação definida, leva para uma nova reserva.
  const runPrimaryAction = useCallback(() => {
    if (primary.current) primary.current();
    else navigate('/reservas?nova=1');
  }, [navigate]);

  const value = useMemo(() => ({ counts, refreshCounts, runPrimaryAction, registerPrimaryAction }), [counts, refreshCounts, runPrimaryAction, registerPrimaryAction]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell precisa estar dentro de ShellProvider.');
  return context;
}

/** Define o que o botão "+" faz enquanto a tela estiver montada. */
export function usePrimaryAction(handler: () => void) {
  const { registerPrimaryAction } = useShell();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    registerPrimaryAction(() => latest.current());
    return () => registerPrimaryAction(null);
  }, [registerPrimaryAction]);
}

/** Avisa o shell (contadores) de que reservas mudaram. */
export function notifyBookingsChanged() {
  window.dispatchEvent(new Event('qf:bookings-changed'));
}
