// Guardrail de saída do agente (sem banco, para poder testar isolado).
/** Saída: a IA não pode afirmar que reservou, cancelou, enviou Pix, ou dizer se um horário está livre ou quanto custa, sem a ferramenta ter feito isso nesta rodada. */
type Kind = 'reserva' | 'cancelamento' | 'pix' | 'disponibilidade' | 'preco' | 'robo';
const CLAIMS: { kind: Kind; pattern: RegExp; negationOk?: boolean }[] = [
  { kind: 'reserva', pattern: /\b(?:reserva|pedido|hor[aá]rio)\b[^.!?\n]{0,40}\b(?:est[aá]|foi|ficou)\s+(?:confirmad[ao]|registrad[ao]|feit[ao]|reservad[ao]|garantid[ao])\b|\b(?:reservei|confirmei|registrei)\b|\b(?:reserva|pedido)\s+(?:confirmad[ao]|registrad[ao]|feit[ao]|garantid[ao])\b/i },
  { kind: 'cancelamento', pattern: /\b(?:foi|est[aá]|ficou)\s+cancelad[ao]\b|\bcancelei\b/i },
  { kind: 'pix', pattern: /\b(?:enviei|mandei)\b[^.!?\n]{0,30}\bpix\b|\bpix\b[^.!?\n]{0,30}\b(?:foi|foram)\s+enviad[oa]s?\b|\breceber[aá]\s+o\s+pix\b/i },
  // "O horário 20:00 não está disponível" / "às 20h está livre": só vale depois de consultar a agenda.
  { kind: 'disponibilidade', negationOk: true, pattern: /(?:\bhor[aá]rio|(?:^|\s)[àa]s?)\s*(?:das\s*)?\d{1,2}(?:[:h]\d{2})?\s*h?[^.!?\n]{0,25}\b(?:(?:n[ãa]o\s+)?est[aá]|ficou|j[aá] foi|j[aá] est[aá])\s+(?:dispon[ií]vel|indispon[ií]vel|livre|ocupad[oa]|reservad[oa]|lotad[oa])\b|\bn[ãa]o (?:tem|h[aá]) (?:mais )?(?:hor[aá]rio|vaga)s?\b[^.!?\n]{0,20}\b(?:livre|dispon[ií]vel)/i },
  // Valor da hora ou da quadra: só o que a ferramenta de preços devolveu.
  { kind: 'preco', negationOk: true, pattern: /R\$\s*\d[^.!?\n]{0,25}(?:por hora|\/\s*h\b|a hora|cada hora)|\b(?:hora|quadra|reserva)\b[^.!?\n]{0,25}\b(?:custa|cobra|sai|fica)\b[^.!?\n]{0,15}R\$\s*\d|\b(?:custa|valor da hora)\b[^.!?\n]{0,25}R\$\s*\d|o valor (?:da hora )?pode variar/i },
  // Frases que entregam que é uma IA ao pedir a data ou a duração.
  { kind: 'robo', negationOk: true, pattern: /pode ser (?:uma )?data|dia da semana|express[ãa]o como|em intervalos de \d+ minutos|por favor,? (?:me )?(?:diga|informe)/i },
];
export type AgentFacts = { bookingCreated: boolean; bookingsListed: boolean; pixSent: boolean; availabilityChecked?: boolean; pricesChecked?: boolean };
export function unsupportedClaim(text: string, facts: AgentFacts) {
  for (const { kind, pattern, negationOk } of CLAIMS) {
    const match = pattern.exec(text); if (!match) continue;
    // Negação logo antes ou dentro da frase ("ainda não foi confirmada") não é afirmação.
    if (!negationOk && /(?:^|[^\p{L}])n[ãa]o(?:[^\p{L}]|$)/iu.test(text.slice(Math.max(0, match.index - 10), match.index + match[0].length))) continue;
    if (kind === 'reserva' && (facts.bookingCreated || facts.bookingsListed)) continue;
    if (kind === 'pix' && facts.pixSent) continue;
    if (kind === 'disponibilidade' && facts.availabilityChecked) continue;
    if (kind === 'preco' && facts.pricesChecked) continue;
    return { kind, excerpt: match[0] };
  }
  return undefined;
}
