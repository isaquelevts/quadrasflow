// Regras de passagem para atendimento humano (sem banco, para poder testar isolado).

const clean = (value: string) => value.replace(/\[Transcrição do áudio\]\s*/gi, '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const WHO = String.raw`(?:o |a |um |uma |alguma )?(?:atendente|humano|pessoa(?: de verdade)?|alguem(?: da equipe)?|(?:a )?equipe|gerente|responsavel|dono|dona)`;

/** Pedido claro para falar com alguém. Palavras soltas ("minha equipe quer reservar") não contam. */
const EXPLICIT = [
  /^(?:atendente|humano|atendimento|atendimento humano|equipe|pessoa|falar com alguem|uma pessoa)[.,!? ]*(?:por favor)?[.,!? ]*$/,
  new RegExp(String.raw`\b(?:falar|conversar|atendimento|atender) com ${WHO}\b`),
  new RegExp(String.raw`\b(?:chama|chame|chamar|quero|queria|preciso(?: de)?|me passa (?:para|pra)|me transfere (?:para|pra)|passa (?:para|pra)) ${WHO}\b`),
  /\batendimento humano\b|\bpessoa de verdade\b|\bnao (?:quero|gosto de) (?:falar com )?(?:robo|bot|maquina)\b/,
];

/**
 * O cliente pediu uma pessoa?
 * `loose` (fluxo guiado, sem IA para interpretar): "atendente" ou "humano" em qualquer lugar da frase também contam.
 */
export function wantsHuman(message: string, loose = false) {
  const text = clean(message);
  if (!text) return false;
  if (EXPLICIT.some((pattern) => pattern.test(text))) return true;
  return loose && /\b(?:atendente|humano)\b/.test(text);
}

export type HumanHours = { timeZone: string; humanStart: string; humanEnd: string; outsideHoursMessage: string };

/** Hora local (HH:MM) no fuso da arena; sem fuso configurado, considera dentro do horário. */
export function isOutsideHumanHours(bot: HumanHours, now = new Date()) {
  if (!bot.timeZone) return false;
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: bot.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return local < bot.humanStart || local >= bot.humanEnd;
}

export const LEGACY_OUTSIDE_HOURS_MESSAGE = 'No momento estamos fora do horário de atendimento humano. Você pode agendar pelo nosso app. 😊';
export const DEFAULT_OUTSIDE_HOURS_MESSAGE = 'No momento a equipe está fora do horário de atendimento (das {inicio} às {fim}). Já deixei seu recado para ela. Enquanto isso, posso te ajudar com reservas por aqui. 😊';

/** Mensagem de fora do horário com {inicio} e {fim} preenchidos. */
export function outsideHoursText(bot: HumanHours) {
  return bot.outsideHoursMessage.replace(/\{inicio\}/g, bot.humanStart).replace(/\{fim\}/g, bot.humanEnd);
}

/** O bot continua pausado nesta conversa? */
export function botPaused(conversation: { step: string; updatedAt: string } | undefined, policy: { manualResumeOnly: boolean; reactivateAfterHours: number }, now = Date.now()) {
  if (conversation?.step !== 'human') return false;
  if (policy.manualResumeOnly) return true;
  return now - Date.parse(conversation.updatedAt) < policy.reactivateAfterHours * 3_600_000;
}
