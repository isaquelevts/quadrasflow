// Testes do guardrail de saída: rode com `npx tsx --test src/whatsapp-agent-claims.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsupportedClaim } from './whatsapp-agent-claims.js';

const none = { bookingCreated: false, bookingsListed: false, pixSent: false };
const cases: [string, string, typeof none, string | undefined][] = [
  ['afirma reserva confirmada sem ferramenta', 'Pronto! Sua reserva foi confirmada para amanhã.', none, 'reserva'],
  ['"reservei" em primeira pessoa', 'Reservei a quadra para você às 19h.', none, 'reserva'],
  ['afirma cancelamento', 'Sua reserva foi cancelada com sucesso.', none, 'cancelamento'],
  ['afirma Pix enviado', 'Enviei o Pix para você pagar.', none, 'pix'],
  ['negação não é afirmação', 'Sua reserva ainda não foi confirmada; aguarde a equipe.', none, undefined],
  ['"não se preocupe" antes da afirmação ainda é afirmação', 'Não se preocupe, sua reserva foi confirmada!', none, 'reserva'],
  ['"não" logo antes do verbo', 'O Pix não foi enviado ainda.', none, undefined],
  ['pergunta de cancelamento', 'Cancelar Areia 1, dia 30/09, das 21:00 às 22:00?\nConfirma o cancelamento?', none, undefined],
  ['prazo de cancelamento', 'O prazo de cancelamento é de 24 horas antes do jogo.', none, undefined],
  ['reserva criada nesta rodada', 'Seu pedido foi registrado e está pendente de confirmação pela equipe.', { ...none, bookingCreated: true }, undefined],
  ['status vindo da lista de reservas', 'Sua reserva de sábado está confirmada.', { ...none, bookingsListed: true }, undefined],
  ['Pix realmente enviado', 'O Pix foi enviado em mensagens separadas.', { ...none, pixSent: true }, undefined],
  ['Pix citado sem afirmar envio', 'Depois de confirmar, vou gerar o Pix de R$ 60,00.', none, undefined],
];
for (const [name, text, facts, expected] of cases) test(name, () => assert.equal(unsupportedClaim(text, facts)?.kind, expected));
