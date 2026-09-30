import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmsSummary } from './whatsapp-confirm.js';

test('respostas claras confirmam o resumo', () => {
  for (const text of ['sim', 'Sim!', 'sim, pode reservar', 'Confirmo', 'pode sim', 'ok', 'Fechado 👍', 'isso mesmo', 'claro', 'pode mandar o pix', 'sim por favor', 'Beleza, manda', '[Transcrição do áudio] sim pode'])
    assert.equal(confirmsSummary(text), true, text);
});
test('dúvida, mudança ou recusa não confirmam', () => {
  for (const text of ['não', 'sim, mas troca para as 20h', 'pode ser outra quadra?', 'espera', 'quero cancelar', 'ok mas antes me diz o endereço', 'qual o valor?', 'Carlos Silva', '', 'sim '.repeat(30)])
    assert.equal(confirmsSummary(text), false, text);
});
