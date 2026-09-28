import type { ComponentType, ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';
import { Avatar as AvatarRoot, AvatarFallback } from '@/components/ui/avatar';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Título da página (visível a partir de md) e ações à direita. No celular o título fica no cabeçalho. */
export function PageHeader({ title, description, actions, eyebrow, alwaysShowTitle = false }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; alwaysShowTitle?: boolean }) {
  return <div className="flex flex-col gap-4 md:flex-row md:items-end">
    <div className={cn('min-w-0 flex-1', !alwaysShowTitle && 'hidden md:block')}>
      {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
      <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">{title}</h1>
      {description && <p className="mt-1 text-[13px] text-muted-foreground lg:text-sm">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

export function Panel({ className, children, ...props }: React.ComponentProps<'section'>) {
  return <section className={cn('rounded-xl border bg-card shadow-card', className)} {...props}>{children}</section>;
}

export function PanelHeader({ title, description, actions, icon: Icon, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: ComponentType<LucideProps>; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-3 px-4 pt-4 pb-3 lg:px-5 lg:pt-5', className)}>
    <div className="min-w-0 flex-1">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">{Icon && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}{title}</h2>
      {description && <p className="text-[12.5px] text-muted-foreground">{description}</p>}
    </div>
    {actions}
  </div>;
}

/** Indicador (padrão "Statistic card" do ReUI): rótulo, valor, ícone e texto de apoio. */
export function StatCard({ label, value, sub, icon: Icon, tone = 'bg-brand-50 text-brand-600', children }: { label: string; value: ReactNode; sub?: ReactNode; icon: ComponentType<LucideProps>; tone?: string; children?: ReactNode }) {
  return <div className="rounded-xl border bg-card p-4 shadow-card lg:p-5">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] font-medium leading-tight text-muted-foreground lg:text-[13px]">{label}</span>
      <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', tone)}><Icon className="size-4" aria-hidden="true" /></span>
    </div>
    <div className="mt-2 text-[22px] font-semibold tracking-tight tabular-nums lg:text-[26px]">{value}</div>
    {sub && <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground lg:text-[12.5px]">{sub}</div>}
    {children}
  </div>;
}

export function EmptyState({ icon: Icon, title, text, action, className }: { icon: ComponentType<LucideProps>; title: string; text?: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={cn('px-5 py-12 text-center', className)}>
    <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><Icon className="size-5" aria-hidden="true" /></div>
    <div className="mt-3 font-medium">{title}</div>
    {text && <div className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">{text}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return <AvatarRoot aria-hidden="true" className={cn('size-8 shrink-0', className)}>
    <AvatarFallback className="border border-brand-100 bg-brand-50 text-[11px] font-semibold text-brand-700">{initials(name)}</AvatarFallback>
  </AvatarRoot>;
}

/** Controle segmentado simples (Tabs variante `button`). */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md', label }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: ReactNode }>; className?: string; size?: 'sm' | 'md'; label: string }) {
  return <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-md border bg-card p-0.5 font-medium shadow-xs', className)}>
    {options.map((option) => {
      const on = option.value === value;
      return <button key={option.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(option.value)}
        className={cn('flex-1 rounded px-3 whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-ring', size === 'sm' ? 'h-7 text-[12.5px]' : 'h-9 md:h-8', on ? 'bg-brand-900 text-white shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
        {option.label}
      </button>;
    })}
  </div>;
}
