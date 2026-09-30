// Duração das reservas (página pública e WhatsApp): de 1h até o máximo da arena, de 30 em 30 minutos.
// O máximo fica em companies.public_options.maxDurationMinutes (sem migração); padrão 8h.

export const MIN_DURATION = 60;
export const STEP = 30;
export const DEFAULT_MAX_DURATION = 480;
export const MAX_DURATION_LIMIT = 480;

/** Máximo configurado pela arena, sempre um valor válido. */
export function maxDurationOf(publicOptions: unknown) {
  const raw = Number((publicOptions as Record<string, unknown> | null)?.maxDurationMinutes);
  return validMaxDuration(raw) ? raw : DEFAULT_MAX_DURATION;
}
export const validMaxDuration = (minutes: number) => Number.isInteger(minutes) && minutes >= MIN_DURATION && minutes <= MAX_DURATION_LIMIT && minutes % STEP === 0;
export const validDuration = (minutes: number, max: number) => Number.isInteger(minutes) && minutes >= MIN_DURATION && minutes <= max && minutes % STEP === 0;
/** Durações possíveis: 60, 90, ..., max. */
export const durationChoices = (max: number) => Array.from({ length: Math.max(0, (max - MIN_DURATION) / STEP + 1) }, (_, i) => MIN_DURATION + i * STEP);

/** 60 → "1h", 90 → "1h30", 150 → "2h30". */
export const durationLabel = (minutes: number) => `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`;
/** Como o cliente lê: "1h, 1h30 ou 2h" (máximo de 2h) ou "de 1h a 8h". */
export const durationRangeText = (max: number) => (max <= 120 ? durationChoices(max).map(durationLabel).join(', ').replace(/, ([^,]*)$/, ' ou $1') : `de 1h a ${durationLabel(max)}`);
/** Mensagem de erro quando a duração passa do limite. */
export const durationError = (max: number) => `A duração deve ser ${durationRangeText(max)}, de 30 em 30 minutos.`;
