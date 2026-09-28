import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function DatePicker({ value, onChange, label = 'Escolher data', disabled, className }: { value: string; onChange: (value: string) => void; label?: string; disabled?: boolean; className?: string }) {
  const selected = value ? parseISO(`${value}T12:00:00`) : undefined;
  return <Popover><PopoverTrigger asChild><Button type="button" variant="outline" disabled={disabled} className={`min-w-0 max-w-full justify-start gap-2 font-medium ${className || ''}`} aria-label={selected ? format(selected, "d 'de' MMMM 'de' yyyy", { locale: ptBR }) : label}><CalendarDays /><span className="min-w-0 truncate sm:hidden">{selected ? format(selected, 'dd/MM/yy') : label}</span><span className="hidden min-w-0 truncate sm:inline">{selected ? format(selected, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : label}</span></Button></PopoverTrigger><PopoverContent align="end" className="w-auto p-0"><Calendar mode="single" selected={selected} onSelect={(date) => { if (date) onChange(format(date, 'yyyy-MM-dd')); }} /></PopoverContent></Popover>;
}

export function localDateValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
