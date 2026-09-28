import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Plus, Save, Waves } from 'lucide-react';
import { ArenaImagePicker } from '@/components/ArenaImagePicker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { errorMessage, formatCurrency } from '@/lib/format';

type Court = { id: string; name: string; sport: string; price_cents: number; photo_url: string | null; active?: number };
const sports = ['Society', 'Futsal', 'Futebol de Campo', 'Beach Tennis', 'Padel', 'Tênis', 'Vôlei', 'Basquete', 'Vôlei de Praia', 'Futevôlei', 'Pickleball', 'Handebol', 'Peteca', 'Squash', 'Outro'];

export function CourtsPage() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [editing, setEditing] = useState<Court | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [sport, setSport] = useState('Society');
  const [price, setPrice] = useState('150');
  const [photo, setPhoto] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api<{ courts: Court[] }>('/api/courts');
      setCourts(result.courts);
      setError('');
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function addCourt() {
    setEditing(null);
    setName('');
    setSport('Society');
    setPrice('150');
    setPhoto([]);
    setError('');
    setOpen(true);
  }

  function editCourt(court: Court) {
    setEditing(court);
    setName(court.name);
    setSport(court.sport);
    setPrice((court.price_cents / 100).toFixed(2));
    setPhoto(court.photo_url ? [court.photo_url] : []);
    setError('');
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const body = JSON.stringify({ name: name.trim(), sport, priceCents: Math.round(Number(price.replace(',', '.')) * 100), photoUrl: photo[0] || null });
    try {
      if (editing) await api(`/api/courts/${editing.id}`, { method: 'PUT', body });
      else await api('/api/courts', { method: 'POST', body });
      setOpen(false);
      await load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  }

  return <div className="grid gap-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><h1 className="text-2xl font-bold tracking-tight">Quadras</h1><p className="mt-1 text-sm text-muted-foreground">Modalidades, preços e disponibilidade.</p></div>
      <Button className="w-full sm:w-auto" onClick={addCourt}><Plus /> Adicionar quadra</Button>
    </header>
    {error && !open && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-primary" /></div> : courts.length ? <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{courts.map((court) => <Card key={court.id} className="overflow-hidden">
      {court.photo_url ? <img src={court.photo_url} alt={`Foto de ${court.name}`} className="h-40 w-full bg-muted object-cover" /> : <div className="grid h-24 place-items-center bg-emerald-50 text-primary"><Waves aria-hidden="true" /></div>}
      <CardHeader className="flex flex-row items-center gap-3 space-y-0"><div className="min-w-0"><CardTitle className="truncate text-base">{court.name}</CardTitle><p className="text-sm text-muted-foreground">{court.sport}</p></div></CardHeader>
      <CardContent className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs text-muted-foreground">Preço por hora</p><strong>{formatCurrency(court.price_cents)}</strong></div><div className="flex items-center gap-2"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">{court.active === 0 ? 'Inativa' : 'Ativa'}</span><Button variant="outline" size="sm" onClick={() => editCourt(court)}>Editar</Button></div></CardContent>
    </Card>)}</section> : <Card><CardContent className="grid min-h-48 place-items-center text-center"><div><Waves className="mx-auto mb-3 text-muted-foreground" /><p className="font-semibold">Nenhuma quadra cadastrada</p><p className="mt-1 text-sm text-muted-foreground">Adicione uma quadra para começar a receber reservas.</p></div></CardContent></Card>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? 'Editar quadra' : 'Adicionar quadra'}</DialogTitle><DialogDescription>Atualize o nome, a modalidade, o preço e a foto desta quadra.</DialogDescription></DialogHeader>
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-2"><Label htmlFor="court-name">Nome</Label><Input id="court-name" autoFocus required maxLength={80} placeholder="Ex.: Society 1" value={name} onChange={(event) => setName(event.target.value)} /></div>
        <div className="grid gap-2"><Label>Esporte principal</Label><Select value={sport} onValueChange={setSport}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{sports.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-2"><Label htmlFor="court-price">Preço por hora (R$)</Label><Input id="court-price" type="number" inputMode="decimal" min="0" max="1000000" step="0.01" required value={price} onChange={(event) => setPrice(event.target.value)} /></div>
        <ArenaImagePicker label="Foto da quadra" images={photo} maxImages={1} onChange={setPhoto} onBusyChange={setUploading} />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <DialogFooter><Button className="w-full sm:w-auto" type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button className="w-full sm:w-auto" type="submit" disabled={saving || uploading}>{saving ? <LoaderCircle className="animate-spin" /> : editing ? <Save /> : <Plus />}{editing ? 'Salvar alterações' : 'Salvar quadra'}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  </div>;
}
