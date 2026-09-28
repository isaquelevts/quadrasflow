import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dateFromKey, fmtDate, keyOf, shiftKey } from '@/lib/arena';
import { cn } from '@/lib/utils';

/** ‹ data › com calendário no meio. `step` = 1 (dia) ou 7 (semana). */
export function DateNav({ value, onChange, step = 1, label, className }: { value: string; onChange: (value: string) => void; step?: 1 | 7; label?: string; className?: string }) {
  const unit = step === 7 ? 'Semana' : 'Dia';
  const text = label ?? fmtDate(value, 'EEE, d MMM').replace(/\./g, '');
  return <div className={cn('inline-flex min-w-0 items-center rounded-md border bg-card shadow-xs', className)}>
    <button type="button" onClick={() => onChange(shiftKey(value, -step))} aria-label={`${unit} anterior`} className="grid size-10 shrink-0 place-items-center rounded-l-md hover:bg-muted md:size-9"><ChevronLeft className="size-4" aria-hidden="true" /></button>
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Escolher data. Selecionada: ${fmtDate(value, "d 'de' MMMM 'de' yyyy")}`} className="flex h-10 min-w-0 flex-1 items-center justify-center gap-2 border-x px-3 font-medium whitespace-nowrap hover:bg-muted md:h-9">
          {step === 7 ? <CalendarRange className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="truncate first-letter:uppercase">{text}</span>
          {step === 1 && !label && <span className="hidden sm:inline">{fmtDate(value, 'yyyy')}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto p-0">
        <Calendar mode="single" selected={dateFromKey(value)} onSelect={(date) => { if (date) onChange(keyOf(date)); }} />
      </PopoverContent>
    </Popover>
    <button type="button" onClick={() => onChange(shiftKey(value, step))} aria-label={`Próxim${step === 7 ? 'a semana' : 'o dia'}`} className="grid size-10 shrink-0 place-items-center rounded-r-md hover:bg-muted md:size-9"><ChevronRight className="size-4" aria-hidden="true" /></button>
  </div>;
}
