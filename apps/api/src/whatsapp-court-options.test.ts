import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableCourtOptions, courtOptionsMessage } from './whatsapp-court-options.js';

const courts = [
  { id: 'court-1', name: 'Areia 1', sport: 'Vôlei' },
  { id: 'court-2', name: 'Areia 2', sport: 'Futevôlei' },
  { id: 'court-3', name: 'Coberta', sport: 'Tênis' },
];

test('lista somente quadras livres no início exato, preservando a ordem', async () => {
  const options = await availableCourtOptions(courts, '2026-09-29', '19:00', 60, async (id) => ({
    slots: id === 'court-1' || id === 'court-3'
      ? [{ inicio: '19:00', valor: 'R$ 100,00', amountCents: 10000 }]
      : [{ inicio: '20:00', valor: 'R$ 80,00', amountCents: 8000 }],
  }));

  assert.deepEqual(options.map(({ id }) => id), ['court-1', 'court-3']);
  assert.equal(options[0]?.amountCents, 10000);
  const message = courtOptionsMessage('terça-feira, 29/09/2026', '19:00', '20:00', options);
  assert.match(message, /1\. Areia 1 · Vôlei/);
  assert.match(message, /2\. Coberta · Tênis/);
  assert.ok(message.indexOf('2. Coberta') < message.indexOf('Qual você prefere?'));
  assert.equal(message.includes('Areia 2'), false);
});

test('não retorna quadras quando nenhuma tem o intervalo solicitado', async () => {
  const options = await availableCourtOptions(courts, '2026-09-29', '19:00', 90, async () => ({
    slots: [{ inicio: '19:30', valor: 'R$ 120,00', amountCents: 12000 }],
  }));

  assert.deepEqual(options, []);
  assert.match(courtOptionsMessage('29/09/2026', '19:00', '20:30', options), /Não encontrei quadras disponíveis/);
});
