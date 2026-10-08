// Local próprio da quadra (arenas com quadras em endereços diferentes). Vazio = vale o endereço da arena.
import { safePublicLink } from './whatsapp-service-rules.js';

export type CourtLocation = { locationName: string; locationAddress: string; locationMapsUrl: string };
export const NO_LOCATION: CourtLocation = { locationName: '', locationAddress: '', locationMapsUrl: '' };

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Valida o local enviado pela tela de Quadras; devolve a mensagem de erro ou o local normalizado. */
export function validateCourtLocation(input: unknown): { error: string } | { location: CourtLocation } {
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const locationName = clean(r.name), locationAddress = clean(r.address);
  if (locationName.length > 80) return { error: 'Use no máximo 80 caracteres no nome do local.' };
  if (locationAddress.length > 200) return { error: 'Use no máximo 200 caracteres no endereço da quadra.' };
  let locationMapsUrl = '';
  try { locationMapsUrl = safePublicLink(r.mapsUrl, 'maps'); } catch { return { error: 'Use um link HTTPS do Google Maps na localização da quadra.' }; }
  if (locationMapsUrl && !locationAddress) return { error: 'Informe o endereço da quadra junto com o link do mapa.' };
  return { location: { locationName, locationAddress, locationMapsUrl } };
}

/** A quadra tem endereço próprio? */
export const hasOwnLocation = (court: Partial<CourtLocation>) => Boolean(court.locationAddress);

/** "Unidade Centro — Rua A, 10" (só quando a quadra tem endereço próprio). */
export function courtPlaceText(court: Partial<CourtLocation>) {
  if (!hasOwnLocation(court)) return '';
  return court.locationName ? `${court.locationName} — ${court.locationAddress}` : court.locationAddress!;
}

/** Formato enviado ao front e às ferramentas do WhatsApp. */
export const locationJson = (court: Partial<CourtLocation>) => ({ name: court.locationName || '', address: court.locationAddress || '', maps_url: court.locationMapsUrl || '' });
