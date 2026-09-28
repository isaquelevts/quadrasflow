import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/format';

type Props = {
  label: string;
  images: string[];
  maxImages: number;
  disabled?: boolean;
  onChange: (images: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
};

async function prepareImage(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Escolha uma imagem JPEG, PNG ou WebP.');
  }
  if (file.size > 15 * 1024 * 1024) throw new Error('A imagem original deve ter até 15 MB.');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Não foi possível abrir esta imagem. Use JPEG, PNG ou WebP.');
  }

  try {
    if (bitmap.width * bitmap.height > 30_000_000) throw new Error('A resolução da imagem é muito grande.');
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar esta imagem.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível preparar esta imagem.')), 'image/webp', 0.84));
    if (result.type !== 'image/webp') throw new Error('Este navegador não consegue preparar a imagem. Tente outro navegador.');
    if (result.size > 6 * 1024 * 1024) throw new Error('A imagem otimizada ultrapassa 6 MB.');
    return result;
  } finally {
    bitmap.close();
  }
}

export function ArenaImagePicker({ label, images, maxImages, disabled = false, onChange, onBusyChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remaining = Math.max(0, maxImages - images.length);

  async function selectFiles(files: FileList | null) {
    if (!files?.length || !remaining || busy) return;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    const uploaded: string[] = [];
    try {
      for (const file of Array.from(files).slice(0, remaining)) {
        const body = await prepareImage(file);
        const result = await api<{ url: string }>('/api/arena/media', {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'image/webp' },
        });
        uploaded.push(result.url);
      }
      if (uploaded.length) onChange([...images, ...uploaded]);
    } catch (cause) {
      if (uploaded.length) onChange([...images, ...uploaded]);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      if (input.current) input.current.value = '';
    }
  }

  return <div className="grid gap-2">
    <p className="text-sm font-medium">{label}</p>
    <div className="flex flex-wrap gap-3">
      {images.map((src, index) => <figure key={`${src}-${index}`} className="relative grid size-28 place-items-center overflow-hidden rounded-lg border bg-background p-2">
        <img src={src} alt={`${label} ${index + 1}`} className="max-h-full max-w-full object-contain" />
        {!disabled && <Button type="button" size="icon" variant="destructive" className="absolute right-1 top-1 size-7" disabled={busy} aria-label={`Remover ${label.toLocaleLowerCase()} ${index + 1}`} onClick={() => onChange(images.filter((_, imageIndex) => imageIndex !== index))}><X size={14} /></Button>}
      </figure>)}
      {remaining > 0 && <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()} className="grid size-28 place-items-center rounded-lg border border-dashed bg-background p-3 text-center text-sm text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? <LoaderCircle className="animate-spin" /> : <ImagePlus className="mb-1" />}
        <span>{busy ? 'Enviando…' : images.length ? 'Adicionar imagem' : 'Escolher imagem'}</span>
      </button>}
    </div>
    <input ref={input} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" multiple={maxImages > 1} disabled={disabled || busy} onChange={(event) => void selectFiles(event.currentTarget.files)} />
    <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP. Até 15 MB por arquivo; a imagem será otimizada ao enviar.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
