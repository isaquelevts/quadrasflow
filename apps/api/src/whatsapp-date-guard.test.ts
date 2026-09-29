import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateSaidByClient } from './whatsapp-date-guard.js';

test('data inventada é recusada', () => {
  assert.equal(dateSaidByClient('amanhã', ['Oi', '1']), false, 'cliente só escolheu reservar');
  assert.equal(dateSaidByClient('hoje', ['quero reservar uma quadra']), false);
  assert.equal(dateSaidByClient('sábado', ['quero jogar amanhã']), false, 'palavra diferente da dita');
  assert.equal(dateSaidByClient('30/09', ['Oi', 'quero reservar']), false);
  assert.equal(dateSaidByClient('2026-09-30', ['1']), false);
  assert.equal(dateSaidByClient('próxima semana', ['quero reservar']), false, 'nada verificável');
});

test('data dita pelo cliente é aceita', () => {
  assert.equal(dateSaidByClient('amanhã', ['quero reservar amanhã à noite']), true);
  assert.equal(dateSaidByClient('amanha', ['Amanhã tem vaga?']), true, 'com e sem acento');
  assert.equal(dateSaidByClient('sábado', ['tem horário no sabado?']), true);
  assert.equal(dateSaidByClient('quarta-feira', ['pode ser quarta']), true);
  assert.equal(dateSaidByClient('dia 5', ['quero no dia 5']), true);
  assert.equal(dateSaidByClient('05/10', ['dia 5 de outubro']), true, 'IA completou o mês');
  assert.equal(dateSaidByClient('2026-10-05', ['pode ser dia 05?']), true);
  assert.equal(dateSaidByClient('amanhã', ['quero reservar', 'amanhã']), true, 'dita numa mensagem anterior');
});
