/**
 * Violação de valor único do Postgres (código 23505).
 * O Drizzle embrulha o erro do driver em DrizzleQueryError, com o erro original em `cause`,
 * então o código pode estar no próprio erro ou em alguma causa.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
