import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeCourtsMessage, parseTimeDuration, searchFreeCourts, type SearchSlot } from './whatsapp-court-search.js';

const courts = [{ id: 'a', name: 'Areia 1', sport: 'Vôlei' }, { id: 's1', name: 'Society 1', sport: 'Society' }, { id: 's2', name: 'Society 2', sport: 'Society' }];
const slot = (inicio: string, cents: number): SearchSlot => ({ inicio, amountCents: cents, valor: `R$ ${cents / 100},00` });
// Areia 1 livre 19h-22h; Society 1 livre só 21h (1h); Society 2 lotada.
const free: Record<string, Record<number, SearchSlot[]>> = {
  a: { 60: [slot('19:00', 10000), slot('20:00', 10000), slot('21:00', 10000)], 90: [slot('19:00', 15000), slot('20:00', 15000)], 120: [slot('19:00', 20000), slot('20:00', 20000)] },
  s1: { 60: [slot('21:00', 12000)], 90: [], 120: [] },
  s2: { 60: [], 90: [], 120: [] },
};
const check = async (courtId: string, _day: string, minutes: number) => ({ slots: free[courtId]![minutes] ?? [] });

test('horário e duração: só as quadras livres naquele intervalo, com o valor', async () => {
  const list = await searchFreeCourts(courts, '2026-09-30', '21:00', 60, check);
  assert.deepEqual(list.map((c) => c.name), ['Areia 1', 'Society 1']);
  const msg = freeCourtsMessage('quarta-feira, 30/09/2026', '21:00', 60, list);
  assert.match(msg, /das 21:00 às 22:00 \(1h\)/); assert.match(msg, /1️⃣ Areia 1 · Vôlei · R\$ 100,00/); assert.match(msg, /2️⃣ Society 1 · Society · R\$ 120,00/); assert.doesNotMatch(msg, /Society 2/);
});
test('só duração: quadras com algum horário livre dessa duração', async () => {
  const list = await searchFreeCourts(courts, '2026-09-30', null, 90, check);
  assert.deepEqual(list.map((c) => c.name), ['Areia 1']);
  assert.match(freeCourtsMessage('quarta-feira, 30/09/2026', null, 90, list), /com horários livres de 1h30[\s\S]*Areia 1 · Vôlei \(2 horários livres\)[\s\S]*mostro os horários livres dela/);
});
test('só horário: quadras livres naquele início, com as durações possíveis', async () => {
  const list = await searchFreeCourts(courts, '2026-09-30', '20:00', null, check);
  assert.deepEqual(list.map((c) => c.name), ['Areia 1']);
  assert.match(freeCourtsMessage('quarta-feira, 30/09/2026', '20:00', null, list), /livres às 20:00[\s\S]*Areia 1 · Vôlei \(1h, 1h30, 2h\)/);
});
test('só horário com máximo maior: para na primeira duração que não cabe e mostra a faixa', async () => {
  const long = { a: { 60: [slot('18:00', 10000)], 90: [slot('18:00', 15000)], 120: [slot('18:00', 20000)], 150: [slot('18:00', 25000)], 180: [slot('18:00', 30000)] } } as Record<string, Record<number, SearchSlot[]>>;
  const asked: number[] = [];
  const list = await searchFreeCourts([courts[0]!], '2026-09-30', '18:00', null, async (id, _d, m) => { asked.push(m); return { slots: long[id]![m] ?? [] }; }, 480);
  assert.deepEqual(asked, [60, 90, 120, 150, 180, 210]);
  assert.match(freeCourtsMessage('quarta-feira, 30/09/2026', '18:00', null, list), /Areia 1 · Vôlei \(de 1h a 3h\)/);
});
test('nenhuma livre: oferece outro horário ou dia', async () => {
  const list = await searchFreeCourts(courts, '2026-09-30', '23:00', 60, check);
  assert.equal(list.length, 0);
  assert.match(freeCourtsMessage('quarta-feira, 30/09/2026', '23:00', 60, list), /Não encontrei quadras livres das 23:00 às 00:00 \(1h\)[\s\S]*outro horário ou outro dia/);
});
test('sem horário nem duração não busca', async () => {
  assert.deepEqual(await searchFreeCourts(courts, '2026-09-30', null, null, check), []);
});

test('lê horário e duração do jeito que o cliente escreve', () => {
  const cases: Array<[string, string | null, number | null]> = [
    ['às 21h, 1 hora', '21:00', 60], ['21:00 por 1h', '21:00', 60], ['1 hora', null, 60], ['1 hora mesmo', null, 60], ['uma hora e meia', null, 90],
    ['1h30', null, 90], ['2 horas', null, 120], ['2h', null, 120], ['às 20h', '20:00', null], ['tem quadra livre amanhã às 19h?', '19:00', null],
    ['quero reservar amanhã às 20h por 1h30', '20:00', 90], ['19h30', '19:30', null], ['das 18:30 às 20:00', '18:30', null], ['às 2h', '02:00', null],
    ['quero reservar para hoje', null, null], ['Carlos Silva', null, null], ['1', null, null], ['pode ser 22:00', '22:00', null],
    ['3 horas', null, 180], ['3h', null, 180], ['2h30', null, 150], ['duas horas e meia', null, 150], ['por 4h', null, 240], ['150 minutos', null, 150],
    ['às 19h por 3 horas', '19:00', 180], ['das 18h às 21h', '18:00', null], ['8 horas', null, 480], ['às 3h', '03:00', null], ['2 horas e meia', null, 150],
  ];
  for (const [text, start, duration] of cases) assert.deepEqual(parseTimeDuration(text), { start, duration }, text);
});
