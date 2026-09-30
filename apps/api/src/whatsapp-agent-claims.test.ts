// Testes do guardrail de saída: rode com `npx tsx --test src/whatsapp-agent-claims.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsupportedClaim } from './whatsapp-agent-claims.js';

const none = { bookingCreated: false, bookingsListed: false, pixSent: false, availabilityChecked: false, pricesChecked: false };
const cases: [string, string, typeof none, string | undefined][] = [
  ['afirma reserva confirmada sem ferramenta', 'Pronto! Sua reserva foi confirmada para amanhã.', none, 'reserva'],
  ['"reservei" em primeira pessoa', 'Reservei a quadra para você às 19h.', none, 'reserva'],
  ['afirma cancelamento', 'Sua reserva foi cancelada com sucesso.', none, 'cancelamento'],
  ['afirma Pix enviado', 'Enviei o Pix para você pagar.', none, 'pix'],
  ['negação não é afirmação', 'Sua reserva ainda não foi confirmada; aguarde a equipe.', none, undefined],
  ['"não se preocupe" antes da afirmação ainda é afirmação', 'Não se preocupe, sua reserva foi confirmada!', none, 'reserva'],
  ['"não" logo antes do verbo', 'O Pix não foi enviado ainda.', none, undefined],
  ['"Reserva confirmada!" sem verbo', 'Reserva confirmada! Qualquer dúvida estou aqui.', none, 'reserva'],
  ['promete que o cliente receberá o Pix', 'Você receberá o Pix para pagamento em instantes.', { ...none, bookingCreated: true }, 'pix'],
  ['pergunta do resumo não é afirmação', 'Confirma a reserva?', none, undefined],
  ['pergunta de cancelamento', 'Cancelar Areia 1, dia 30/09, das 21:00 às 22:00?\nConfirma o cancelamento?', none, undefined],
  ['prazo de cancelamento', 'O prazo de cancelamento é de 24 horas antes do jogo.', none, undefined],
  ['reserva criada nesta rodada', 'Seu pedido foi registrado e está pendente de confirmação pela equipe.', { ...none, bookingCreated: true }, undefined],
  ['status vindo da lista de reservas', 'Sua reserva de sábado está confirmada.', { ...none, bookingsListed: true }, undefined],
  ['Pix realmente enviado', 'O Pix foi enviado em mensagens separadas.', { ...none, pixSent: true }, undefined],
  ['Pix citado sem afirmar envio', 'Depois de confirmar, vou gerar o Pix de R$ 60,00.', none, undefined],
  ['horário indisponível sem consultar (caso real)', 'O horário 20:00 não está disponível. Por favor, escolha um horário entre os disponíveis.', none, 'disponibilidade'],
  ['horário livre sem consultar (caso real)', 'O horário 21:00 está disponível para Society 1 em 30/09/2026.', none, 'disponibilidade'],
  ['"às 20h já está reservado" sem consultar', 'Às 20h já está reservado, que tal outro?', none, 'disponibilidade'],
  ['disponibilidade depois de consultar a agenda', 'O horário 20:00 não está disponível.', { ...none, availabilityChecked: true }, undefined],
  ['pergunta de horário não é afirmação', 'Qual horário você prefere?', none, undefined],
  ['valor inventado por hora (caso real)', 'O valor da hora pode variar conforme a quadra e o horário.', none, 'preco'],
  ['valor da quadra por hora', 'A Areia 1 custa R$ 100 por hora.', none, 'preco'],
  ['preço depois da ferramenta de preços', 'A Areia 1 custa R$ 100 por hora.', { ...none, pricesChecked: true }, undefined],
  ['frase de robô ao pedir a data (caso real)', 'Por favor, me diga para qual dia você quer reservar a quadra? Pode ser uma data ou um dia da semana. 📅', none, 'robo'],
  ['frase de robô na duração (caso real)', 'Pode ser de 1h até 4h, em intervalos de 30 minutos.', none, 'robo'],
  ['pergunta do dia natural', 'Ótimo! Para qual dia você quer reservar a quadra? 📅', none, undefined],
];
for (const [name, text, facts, expected] of cases) test(name, () => assert.equal(unsupportedClaim(text, facts)?.kind, expected));
