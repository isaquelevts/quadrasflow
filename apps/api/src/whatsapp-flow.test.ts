import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askDurationText, courtPriceRange, isGreeting, isPriceQuestion, isReserveIntent, matchCourt, parseBareTime, priceMessage, timeUnavailableText } from './whatsapp-flow.js';

test('horário solto depois da lista', () => {
  const cases: Array<[string, string | null]> = [['20', '20:00'], ['20h', '20:00'], ['às 20', '20:00'], ['as 17', '17:00'], ['20:30', '20:30'], ['20h30', '20:30'], ['21 horas', '21:00'], ['pode ser 20', null],
    ['2', null], ['1', null], ['3', null], ['25', null], ['20:75', null], ['Carlos', null], ['1 hora', null], ['20 por favor', '20:00'], ['das 19', '19:00']];
  for (const [text, expected] of cases) assert.equal(parseBareTime(text), expected, text);
});

const courts = [{ id: 'a', name: 'Areia 1' }, { id: 's1', name: 'Society 1' }, { id: 's2', name: 'Society 2' }];
test('quadra por número, ordinal ou nome', () => {
  const cases: Array<[string, string | null]> = [['2', 's1'], ['quadra 3', 's2'], ['opção 1', 'a'], ['Pode ser a society 1', 's1'], ['society 2', 's2'], ['Society 2, por favor', 's2'],
    ['a areia', 'a'], ['areia 1', 'a'], ['a primeira', 'a'], ['a terceira', 's2'], ['society', null], ['a society', null], ['9', null], ['quero cancelar', null], ['Carlos Silva', null], ['qual o valor da society 1?', 's1']];
  for (const [text, expected] of cases) assert.equal(matchCourt(text, courts), expected, text);
});

test('intenções claras', () => {
  for (const t of ['quero reservar', 'Reservar', 'quero marcar uma quadra', 'queria agendar', 'tem quadra livre?', 'tem horário?', 'quero fazer uma reserva', 'gostaria de alugar a quadra']) assert.equal(isReserveIntent(t), true, t);
  for (const t of ['quero reservar amanhã', 'quero reservar às 19h', 'reservar dia 5', 'quero cancelar minha reserva', 'quanto custa reservar?', 'oi', 'tem horario as 19 hoje', 'qual o status da minha reserva?', 'tenho uma reserva, já paguei o pix', 'queria remarcar', 'minha reserva foi confirmada?']) assert.equal(isReserveIntent(t), false, t);
  for (const t of ['Quanto custa uma hora?', 'qual o valor?', 'valores', 'preço da quadra', 'quanto é?']) assert.equal(isPriceQuestion(t), true, t);
  for (const t of ['quero reservar', 'sim', 'o valor do pix foi cobrado errado e preciso falar com alguém sobre isso porque paguei duas vezes ontem à noite no total de']) assert.equal(isPriceQuestion(t), false, t);
  for (const t of ['oi', 'Olá!', 'bom dia', 'Boa tarde, tudo bem?', 'Oiii']) assert.equal(isGreeting(t), true, t);
  for (const t of ['oi, tem horário hoje?', 'quero reservar']) assert.equal(isGreeting(t), false, t);
});

test('pergunta de duração sem repetir nem soar robô', () => {
  assert.equal(askDurationText('Society 1', '19:00', [60, 90, 120, 150, 180, 210, 240]), '⏱️ Na Society 1, às 19:00, dá para jogar de 1h até 4h. Qual duração você prefere?');
  assert.equal(askDurationText('Areia 1', '21:00', [60, 90]), '⏱️ Na Areia 1, às 21:00, dá para jogar 1h ou 1h30. Qual duração você prefere?');
  assert.match(timeUnavailableText('20:00', 'ocupado'), /Às 20:00 a quadra já está reservada/);
});

const tariffs = [
  { weekday: 6, startTime: '08:00', endTime: '23:00', priceCents: 15000 },
  ...[0, 1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '08:00', endTime: '23:00', priceCents: 10000 })),
];
const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, isOpen: true, openTime: '08:00', closeTime: '23:00' }));
test('preço: valor único, faixa e dia específico', () => {
  const flat = tariffs.map((t) => ({ ...t, priceCents: 10000 }));
  assert.deepEqual(courtPriceRange({ name: 'A', sport: 'x', priceCents: 9000 }, tariffs, days), { min: 10000, max: 15000 });
  assert.deepEqual(courtPriceRange({ name: 'A', sport: 'x', priceCents: 9000 }, tariffs, days, 3), { min: 10000, max: 10000 });
  assert.deepEqual(courtPriceRange({ name: 'A', sport: 'x', priceCents: 9000 }, [], days), { min: 9000, max: 9000 });
  assert.deepEqual(courtPriceRange({ name: 'A', sport: 'x', priceCents: 9000 }, tariffs, days.map((d) => ({ ...d, isOpen: d.weekday !== 6 }))), { min: 10000, max: 10000 }, 'dia fechado não conta');
  const two = [{ name: 'Areia 1', sport: 'Vôlei', priceCents: 10000 }, { name: 'Society 1', sport: 'Society', priceCents: 10000 }];
  assert.equal(priceMessage(two, flat, days), '💰 Valores:\n\n• Areia 1 · Vôlei — R$ 100 por hora\n• Society 1 · Society — R$ 100 por hora\n\nQuer agendar um horário? 📅');
  assert.match(priceMessage(two, tariffs, days), /Areia 1 · Vôlei — varia de R\$ 100 a R\$ 150 por hora \(depende do dia e do horário\)/);
  assert.match(priceMessage(two, tariffs, days, 'quarta-feira, 30/09/2026', 3), /Valores em quarta-feira, 30\/09\/2026:[\s\S]*R\$ 100 por hora/);
});
