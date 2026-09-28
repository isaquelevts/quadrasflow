import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';

const states = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'],
  ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'],
  ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'],
  ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'],
  ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'],
  ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'],
  ['SE', 'Sergipe'], ['TO', 'Tocantins'],
] as const;

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

function exactState(value: string) {
  const query = normalize(value);
  return states.find(([uf, name]) => normalize(uf) === query || normalize(name) === query);
}

type Props = { id: string; value: string; disabled?: boolean; onChange: (uf: string) => void };

export function BrazilStateInput({ id, value, disabled = false, onChange }: Props) {
  const listId = useId();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return [...states];
    return states.filter(([uf, name]) => normalize(uf).startsWith(needle) || normalize(name).startsWith(needle));
  }, [query]);

  useEffect(() => { if (!open && value) setQuery(value); }, [value, open]);

  function choose(uf: string) {
    setQuery(uf);
    setOpen(false);
    onChange(uf);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(index + 1, matches.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === 'Enter' && open && matches[active]) { event.preventDefault(); choose(matches[active][0]); }
    else if (event.key === 'Escape') setOpen(false);
  }

  const invalid = !open && Boolean(query.trim()) && !value;

  return <div className="relative">
    <div className="relative">
      <Input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && matches[active] ? `${listId}-${matches[active][0]}` : undefined} aria-invalid={invalid} autoComplete="off" maxLength={40} placeholder="Digite a UF ou o estado" value={query} disabled={disabled} onFocus={() => { setOpen(true); setActive(0); }} onChange={(event) => { const next = event.target.value; setQuery(next); setOpen(true); setActive(0); const exact = exactState(next); if (exact) onChange(exact[0]); else onChange(''); }} onBlur={() => { const exact = exactState(query); if (exact) choose(exact[0]); else if (!query.trim()) onChange(''); setOpen(false); }} onKeyDown={handleKeyDown} />
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
    {open && <div className="absolute z-[100] mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-white p-1 text-[#18231f] shadow-md" id={listId} role="listbox" aria-label="Estados brasileiros">
      {matches.length ? matches.map(([uf, name], index) => <button type="button" role="option" aria-selected={value === uf} id={`${listId}-${uf}`} key={uf} className={`flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none ${index === active ? 'bg-gray-100' : ''}`} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(uf)}>
        <span>{name} <span className="text-muted-foreground">({uf})</span></span>{value === uf && <Check size={16} />}
      </button>) : <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum estado encontrado.</p>}
    </div>}
    {invalid && <p className="mt-1 text-xs text-red-700" role="alert">Selecione uma UF válida na lista.</p>}
  </div>;
}
