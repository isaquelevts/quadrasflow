import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Painel lateral (≥ 768 px, 440 px de largura) ou painel que sobe de baixo (celular, até 92% da altura, com alça). */
export function ResponsiveSheet({ open, onOpenChange, title, description, children, footer }: { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const desktop = useMediaQuery('(min-width: 768px)');
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side={desktop ? 'right' : 'bottom'} showCloseButton={false}
      className={cn('gap-0 overflow-hidden bg-white p-0 shadow-2xl',
        desktop ? 'w-full rounded-l-2xl sm:max-w-[440px]' : 'max-h-[92dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]')}>
      {!desktop && <div className="flex justify-center pt-2.5" aria-hidden="true"><span className="h-1 w-10 rounded-full bg-border" /></div>}
      <div className="flex items-start gap-3 border-b px-5 pt-4 pb-4 md:pt-6">
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
          {description ? <SheetDescription asChild><div className="mt-1 text-[12.5px] text-muted-foreground">{description}</div></SheetDescription> : <SheetDescription className="sr-only">Painel</SheetDescription>}
        </div>
        <SheetClose className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fechar"><X className="size-4" aria-hidden="true" /></SheetClose>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="border-t p-5">{footer}</div>}
    </SheetContent>
  </Sheet>;
}
