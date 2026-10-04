import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksChange, confirmsCancellation, confirmsSummary, isBareNumber } from './whatsapp-confirm.js';

test('respostas claras confirmam o resumo', () => {
  for (const text of ['sim', 'Sim!', 'sim, pode reservar', 'Confirmo', 'pode sim', 'ok', 'Fechado 👍', 'isso mesmo', 'claro', 'pode mandar o pix', 'sim por favor', 'Beleza, manda', '[Transcrição do áudio] sim pode', 'pode ser', 'ok pode'])
    assert.equal(confirmsSummary(text), true, text);
});
test('dúvida, mudança ou recusa não confirmam', () => {
  for (const text of ['não', 'sim, mas troca para as 20h', 'pode ser outra quadra?', 'espera', 'quero cancelar', 'ok mas antes me diz o endereço', 'qual o valor?', 'Carlos Silva', '', 'sim '.repeat(30)])
    assert.equal(confirmsSummary(text), false, text);
});

test('confirmação de cancelamento', () => {
  for (const t of ['Sim essa mesmo', 'sim', 'pode cancelar', 'sim pode cancelar', 'cancela sim', 'isso, pode cancelar', 'cancela', 'confirmo o cancelamento', 'ok', 'pode']) assert.equal(confirmsCancellation(t), true, t);
  for (const t of ['não', 'não cancela', 'espera', 'é outra reserva', 'deixa quieto', 'mantém', '', '1', '2', 'cancela a de sábado']) assert.equal(confirmsCancellation(t), false, t);
});

test('resposta que muda o pedido não confirma (achado da auditoria)', () => {
  const courts = ['Areia 1', 'Society 1', 'Society 2'];
  for (const t of ['pode ser às 21h', 'ok, 21h então', 'quero às 20h', 'pode ser amanhã', 'sim, na areia 1', 'pode ser 2 horas', '1', 'pode ser 19:30', 'sim mas 1h30', 'ok, sábado', 'pode ser dia 5', 'sim, 02/10', 'pode ser meia hora a mais', 'sim na quadra 2'])
    assert.equal(confirmsSummary(t, courts), false, t);
  assert.equal(confirmsSummary('sim, pode ser na society 2', courts), false);
  assert.equal(confirmsSummary('sim, pode ser na society 2', []), false, 'society é palavra de quadra mesmo sem a lista');
  for (const t of ['sim', 'pode ser', 'ok', 'confirmo', 'isso mesmo', 'pode mandar o pix']) assert.equal(confirmsSummary(t, courts), true, t);
  assert.equal(isBareNumber('1'), true); assert.equal(isBareNumber('1 hora'), false);
  assert.equal(asksChange('sim, na areia 1', courts), true); assert.equal(asksChange('pode sim', courts), false);
});
