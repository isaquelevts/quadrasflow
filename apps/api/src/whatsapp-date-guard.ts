// Trava contra data inventada: a IA só pode resolver uma data que o cliente realmente escreveu
// (sem banco, para poder testar isolado).

const norm = (value: string) => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');
const WORDS = /\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/g;

/** Dia do mês citado na expressão: "dia 5", "05/10", "2026-10-05" ou só "5". */
function dayOf(expression: string) {
  const iso = expression.match(/\b\d{4}-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return Number(iso[2]);
  const match = expression.match(/\b(\d{1,2})(?:\/\d{1,2}(?:\/\d{2,4})?)?\b/);
  return match ? Number(match[1]) : undefined;
}

/**
 * A expressão de data veio das mensagens do cliente?
 * Palavras como "amanhã" ou "sábado" precisam aparecer no que ele escreveu; se for uma data numérica,
 * o dia do mês precisa aparecer. Expressões sem nada verificável não são aceitas.
 */
export function dateSaidByClient(expression: string, clientTexts: readonly string[]) {
  const expr = norm(expression), said = norm(clientTexts.join('\n'));
  const words = expr.match(WORDS) || [];
  if (words.length) return words.every((word) => new RegExp(`\\b${word}\\b`).test(said));
  const day = dayOf(expr);
  if (day === undefined || day < 1 || day > 31) return false;
  return new RegExp(`(^|[^\\d])0?${day}([^\\d]|$)`).test(said);
}
