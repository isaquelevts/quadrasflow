// O cliente respondeu "sim" ao resumo? (sem banco, para poder testar isolado)
// Confirmar é uma ação crítica: quando a resposta é clara, o sistema confirma sem depender da IA.

const clean = (value: string) => value.replace(/\[Transcrição do áudio\]\s*/gi, '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const YES = /^(?:sim|s|ss|confirmo|confirmar|confirmado|confirma|pode|pode sim|ok|okay|isso|isso mesmo|fechado|claro|bora|beleza|blz|perfeito|certo|com certeza|manda|pode mandar|quero|pode ser|show|top)\b/;
const HESITATION = /\b(?:nao|mas|porem|troca|trocar|muda|mudar|outro|outra|cancela|cancelar|espera|peraí|perai|errado|errada|duvida|antes)\b/;

// Resposta que muda o pedido (horário, dia, duração, quadra) não é confirmação, mesmo começando com "pode ser"/"ok".
const CHANGE = /\b\d{1,2}\s*(?:h\b|hs\b|hrs\b|horas?\b|:\d{2})|\b\d{1,2}h\d{2}\b|\bas\s+\d|\b\d+\s*min|\b(?:meia|minutos?)\b|\b(?:hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|semana)\b|\bdia\s+\d|\b\d{1,2}\s+\d{1,2}\b|\b(?:quadra|society|areia|campo)\b/;
/** Mensagem que é só um número ("1", "2"): escolha de lista, nunca confirmação. */
export const isBareNumber = (message: string) => /^\d{1,2}$/.test(clean(message));
const mentionsName = (text: string, names: readonly string[]) => names.some((n) => { const k = clean(n); return k.length > 1 && new RegExp(`(?:^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`).test(text); });
/** Pede mudança no pedido? (horário, dia, duração, quadra ou número solto) */
export function asksChange(message: string, courtNames: readonly string[] = []) {
  const text = clean(message);
  return isBareNumber(message) || CHANGE.test(text) || mentionsName(text, courtNames);
}

export function confirmsSummary(message: string, courtNames: readonly string[] = []) {
  const text = clean(message);
  if (!text || text.length > 80 || asksChange(message, courtNames)) return false;
  return YES.test(text) && !HESITATION.test(text);
}

/** O cliente confirmou o cancelamento? Aqui "pode cancelar" / "cancela sim" é confirmação, não dúvida. */
export function confirmsCancellation(message: string, courtNames: readonly string[] = []) {
  const text = clean(message);
  if (!text || text.length > 80 || asksChange(message, courtNames) || /\b(?:nao|espera|perai|errado|errada|outra|outro|mantem|manter|deixa)\b/.test(text)) return false;
  return YES.test(text) || /^(?:(?:sim|isso|ok|pode)\s+)*(?:pode\s+)?(?:cancela|cancelar|cancele|cancelado|cancelada)\b/.test(text) || /^confirmo o cancelamento\b/.test(text);
}
