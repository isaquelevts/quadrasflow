// O cliente respondeu "sim" ao resumo? (sem banco, para poder testar isolado)
// Confirmar é uma ação crítica: quando a resposta é clara, o sistema confirma sem depender da IA.

const clean = (value: string) => value.replace(/\[Transcrição do áudio\]\s*/gi, '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const YES = /^(?:sim|s|ss|confirmo|confirmar|confirmado|confirma|pode|pode sim|ok|okay|isso|isso mesmo|fechado|claro|bora|beleza|blz|perfeito|certo|com certeza|manda|pode mandar|quero|pode ser|show|top|1)\b/;
const HESITATION = /\b(?:nao|mas|porem|troca|trocar|muda|mudar|outro|outra|cancela|cancelar|espera|peraí|perai|errado|errada|duvida|antes)\b/;

export function confirmsSummary(message: string) {
  const text = clean(message);
  if (!text || text.length > 80) return false;
  return YES.test(text) && !HESITATION.test(text);
}

/** O cliente confirmou o cancelamento? Aqui "pode cancelar" / "cancela sim" é confirmação, não dúvida. */
export function confirmsCancellation(message: string) {
  const text = clean(message);
  if (!text || text.length > 80 || /\b(?:nao|espera|perai|errado|errada|outra|outro|mantem|manter|deixa)\b/.test(text)) return false;
  return YES.test(text) || /^(?:(?:sim|isso|ok|pode)\s+)*(?:pode\s+)?(?:cancela|cancelar|cancele|cancelado|cancelada)\b/.test(text) || /^confirmo o cancelamento\b/.test(text);
}
