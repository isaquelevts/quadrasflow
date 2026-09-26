import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Plus, Star, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { errorMessage, formatDate } from '@/lib/format';

type Client = { id: string; name: string; phone: string | null; bookings_count: number; last_booking_at: string | null };
type Review = { id: string; customer_name: string; rating: number; comment: string; created_at: string };

export function ClientsPage() {
  const [items, setItems] = useState<Client[]>([]), [reviews, setReviews] = useState<Review[]>([]);
  const [average, setAverage] = useState({ average: 0, count: 0 });
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [open, setOpen] = useState(false);
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [saving, setSaving] = useState(false);
  async function load() {
    try {
      const [clientData, reviewData] = await Promise.all([api<{ clients: Client[] }>('/api/clients'), api<{ reviews: Review[]; average: { average: number; count: number } }>('/api/reviews')]);
      setItems(clientData.clients); setReviews(reviewData.reviews); setAverage(reviewData.average); setError('');
    } catch (cause) { setError(errorMessage(cause)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await api('/api/clients', { method: 'POST', body: JSON.stringify({ name: name.trim(), phone }) }); setOpen(false); setName(''); setPhone(''); await load(); }
    catch (cause) { setError(errorMessage(cause)); } finally { setSaving(false); }
  }
  return <div className="grid gap-5">
    <header className="flex justify-between gap-3"><div><h1 className="text-2xl font-bold">Clientes</h1><p className="mt-1 text-sm text-muted-foreground">Cadastro e histórico de clientes da arena.</p></div><Button onClick={() => setOpen(true)}><Plus /> Novo cliente</Button></header>
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users size={18} /> Jogadores · {items.length}</CardTitle></CardHeader><CardContent>{loading ? <div className="grid min-h-36 place-items-center"><LoaderCircle className="animate-spin" /></div> : items.length ? <div className="grid gap-2">{items.map((client) => <article key={client.id} className="flex flex-col justify-between gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"><div><p className="font-semibold">{client.name}</p><p className="text-xs text-muted-foreground">{client.phone || 'Sem telefone cadastrado'}</p></div><p className="text-xs text-muted-foreground">{client.bookings_count} reservas{client.last_booking_at ? ` · última em ${formatDate(client.last_booking_at)}` : ''}</p></article>)}</div> : <p className="py-10 text-center text-sm text-muted-foreground">Os clientes aparecem aqui após o primeiro cadastro ou reserva.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Star size={18} className="text-amber-500" /> Avaliações dos jogadores</CardTitle><p className="text-sm text-muted-foreground">{average.count ? `${average.average} de 5 · ${average.count} avaliações` : 'Ainda sem avaliações'}</p></CardHeader><CardContent>{loading ? <div className="grid min-h-20 place-items-center"><LoaderCircle className="animate-spin" /></div> : reviews.length ? <div className="grid gap-3">{reviews.map((review) => <article key={review.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{review.customer_name}</p><span className="flex items-center gap-1 text-sm" aria-label={`${review.rating} de 5 estrelas`}>{review.rating}<Star size={14} className="fill-amber-400 text-amber-500" /><span className="text-xs text-muted-foreground">{formatDate(review.created_at)}</span></span></div>{review.comment && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{review.comment}</p>}</article>)}</div> : <p className="py-6 text-center text-sm text-muted-foreground">Os comentários dos jogadores serão exibidos aqui.</p>}</CardContent></Card>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Novo cliente</DialogTitle><DialogDescription>Cadastre um cliente para vinculá-lo às reservas.</DialogDescription></DialogHeader><form className="grid gap-4" onSubmit={(event) => void submit(event)}><div className="grid gap-2"><Label htmlFor="client-name">Nome</Label><Input id="client-name" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="client-phone">WhatsApp (opcional)</Label><Input id="client-phone" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving && <LoaderCircle className="animate-spin" />}Salvar cliente</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}
