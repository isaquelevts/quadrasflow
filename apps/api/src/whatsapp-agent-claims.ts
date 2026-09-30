// Guardrail de saída do agente (sem banco, para poder testar isolado).
/** Saída: a IA não pode afirmar que reservou, cancelou ou enviou Pix sem a ferramenta ter feito isso nesta rodada. */
const CLAIMS: { kind: 'reserva' | 'cancelamento' | 'pix'; pattern: RegExp }[] = [
  { kind: 'reserva', pattern: /\b(?:reserva|pedido|hor[aá]rio)\b[^.!?\n]{0,40}\b(?:est[aá]|foi|ficou)\s+(?:confirmad[ao]|registrad[ao]|feit[ao]|reservad[ao]|garantid[ao])\b|\b(?:reservei|confirmei|registrei)\b|\b(?:reserva|pedido)\s+(?:confirmad[ao]|registrad[ao]|feit[ao]|garantid[ao])\b/i },
  { kind: 'cancelamento', pattern: /\b(?:foi|est[aá]|ficou)\s+cancelad[ao]\b|\bcancelei\b/i },
  { kind: 'pix', pattern: /\b(?:enviei|mandei)\b[^.!?\n]{0,30}\bpix\b|\bpix\b[^.!?\n]{0,30}\b(?:foi|foram)\s+enviad[oa]s?\b|\breceber[aá]\s+o\s+pix\b/i },
];
export type AgentFacts = { bookingCreated: boolean; bookingsListed: boolean; pixSent: boolean };
export function unsupportedClaim(text: string, facts: AgentFacts) {
  for (const { kind, pattern } of CLAIMS) {
    const match = pattern.exec(text); if (!match) continue;
    // Negação logo antes ou dentro da frase ("ainda não foi confirmada") não é afirmação.
    if (/(?:^|[^\p{L}])n[ãa]o(?:[^\p{L}]|$)/iu.test(text.slice(Math.max(0, match.index - 10), match.index + match[0].length))) continue;
    if (kind === 'reserva' && (facts.bookingCreated || facts.bookingsListed)) continue;
    if (kind === 'pix' && facts.pixSent) continue;
    return { kind, excerpt: match[0] };
  }
  return undefined;
}
