import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRescheduleIntent, rescheduleSummary, rescheduledText, isCancelIntent, pickBooking, isAllCourts, isPhotoRequest, photoQuestion, photosOutcome, endOptionsText, parseEndAnswer, courtPriceRange, dayScheduleMessage, isGreeting, isPeriodOnly, isPriceQuestion, isReserveIntent, isTimesQuestion, matchCourt, noCourtsMessage, parseBareTime, parsePeriod, priceMessage, timeUnavailableText } from './whatsapp-flow.js';

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

test('quadra citada junto com horário e duração', () => {
  const cases: Array<[string, string | null]> = [['Pode ser areia 1 as 20 hrs', 'a'], ['society 2 às 21h por 1h30', 's2'], ['quero a areia as 20', 'a'], ['Society 1 às 19h', 's1'], ['areia 1 por 2 horas', 'a'], ['pode ser a society 2 as 20:30', 's2'],
    ['society às 21h', null], ['às 20 hrs', null], ['20h por 2 horas', null]];
  for (const [text, expected] of cases) assert.equal(matchCourt(text, courts, false), expected, text);
  assert.equal(matchCourt('2', courts, false), null, 'número solto sem lista numerada não é quadra');
  assert.equal(matchCourt('quadra 3', courts, false), null);
  assert.equal(matchCourt('2', courts, true), 's1', 'com lista numerada continua valendo');
});
test('intenções claras', () => {
  for (const t of ['quero reservar', 'Reservar', 'quero marcar uma quadra', 'queria agendar', 'tem quadra livre?', 'tem horário?', 'quero fazer uma reserva', 'gostaria de alugar a quadra']) assert.equal(isReserveIntent(t), true, t);
  for (const t of ['quero reservar amanhã', 'quero reservar às 19h', 'reservar dia 5', 'quero cancelar minha reserva', 'quanto custa reservar?', 'oi', 'tem horario as 19 hoje', 'qual o status da minha reserva?', 'tenho uma reserva, já paguei o pix', 'queria remarcar', 'minha reserva foi confirmada?']) assert.equal(isReserveIntent(t), false, t);
  for (const t of ['Quanto custa uma hora?', 'qual o valor?', 'valores', 'preço da quadra', 'quanto é?']) assert.equal(isPriceQuestion(t), true, t);
  for (const t of ['quero reservar', 'sim', 'o valor do pix foi cobrado errado e preciso falar com alguém sobre isso porque paguei duas vezes ontem à noite no total de']) assert.equal(isPriceQuestion(t), false, t);
  for (const t of ['oi', 'Olá!', 'bom dia', 'Boa tarde, tudo bem?', 'Oiii']) assert.equal(isGreeting(t), true, t);
  for (const t of ['oi, tem horário hoje?', 'quero reservar']) assert.equal(isGreeting(t), false, t);
});

test('lista de até que horas, com preço (no máximo 8 e aviso de mais tempo)', () => {
  const opts = (step: number, n: number) => Array.from({ length: n }, (_, k) => ({ minutes: 60 + k * step, amountCents: 10000 + k * 5000 * step / 30 }));
  assert.equal(endOptionsText('Areia 1', '10:00', opts(30, 3)), '⏱️ Areia 1, a partir das 10:00:\n\n10h00 – 11h00 (R$ 100)\n10h00 – 11h30 (R$ 150)\n10h00 – 12h00 (R$ 200)\n\nAté que horas você quer jogar?');
  const many = endOptionsText('Areia 1', '10:00', opts(30, 15));
  assert.equal(many.split('\n').filter((l) => l.startsWith('10h00 –')).length, 8, 'no máximo 8 opções');
  assert.match(many, /Dá para jogar mais tempo também \(até 18h00\): é só me dizer até que horas\./);
  assert.match(endOptionsText('Society 1', '19:00', opts(60, 3)), /19h00 – 20h00 \(R\$ 100\)\n19h00 – 21h00 \(R\$ 200\)\n19h00 – 22h00 \(R\$ 300\)/);
  assert.doesNotMatch(endOptionsText('Society 1', '19:00', opts(60, 3)), /mais tempo/);
  assert.equal(timeUnavailableText('20:00', 'ocupado'), 'Às 20:00 a quadra já está reservada. 😕');
});
test('resposta à lista: horário final ou intervalo', () => {
  const cases: Array<[string, number | null]> = [['12h', 120], ['até 12h', 120], ['ate as 11:30', 90], ['12', 120], ['10 às 12', 120], ['das 10h às 11h30', 90], ['pode ser 11h', 60], ['11h30', 90],
    ['2 horas', null], ['1 hora', null], ['3h', null], ['9h', null], ['das 11 às 12', null], ['areia 1', null], ['sim', null]];
  for (const [text, expected] of cases) assert.equal(parseEndAnswer(text, '10:00'), expected, text);
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

test('período do dia e pedido de horários', () => {
  const cases: Array<[string, string | null]> = [['Quais horários vocês têm amanhã à noite?', 'noite'], ['de manhã', 'manha'], ['hoje à tarde', 'tarde'], ['Boa noite, quero reservar amanhã', null], ['boa tarde', null], ['e de noite?', 'noite']];
  for (const [text, expected] of cases) assert.equal(parsePeriod(text), expected, text);
  for (const t of ['Quais horários vocês têm amanhã à noite?', 'quais horários tem hoje?', 'tem horário livre amanhã?', 'que horas tem sábado', 'tem quadra livre hoje?', 'horários disponíveis amanhã',
    'tem reserva disponivel amanha?', 'quais disponiveis amanha?', 'tem disponível amanhã?', 'o que tem livre amanhã?', 'tem vaga amanhã?', 'quais estão livres hoje?', 'quais tem pra sábado?', 'disponibilidade de amanhã']) assert.equal(isTimesQuestion(t), true, t);
  for (const t of ['tem horario as 19 hoje', 'quero reservar amanhã', 'qual o status da minha reserva?', 'quanto custa', 'oi', 'quero jogar às 20h', 'a society 2 está livre às 20h?', 'quero remarcar para um horário livre', 'qual o valor amanhã?', 'quais as minhas reservas?']) assert.equal(isTimesQuestion(t), false, t);
  assert.equal(isPeriodOnly('e à noite?'), true); assert.equal(isPeriodOnly('de manhã'), true); assert.equal(isPeriodOnly('quero reservar amanhã à noite com meus amigos do trabalho'), false);
});

test('sem quadra no horário: motivo correto e só os horários livres', () => {
  assert.equal(noCourtsMessage({ start: '19:00', reason: 'passou', durationText: null, today: true, times: ['20:00', '20:30', '21:00'] }), 'Às 19:00 já passou 😅\n\n🕒 20:00 · 20:30 · 21:00\n\nQual deles você prefere?');
  assert.equal(noCourtsMessage({ start: '19:00', reason: 'ocupado', durationText: null, today: false, times: ['20:00'] }), 'Às 19:00 não tem quadra livre 😕\n\n🕒 20:00\n\nQual deles você prefere?');
  assert.match(noCourtsMessage({ start: '19:00', reason: 'ocupado', durationText: '2h', today: false, times: ['20:00'] }), /^Às 19:00 não tem quadra livre para 2h 😕/);
  assert.match(noCourtsMessage({ start: null, reason: null, durationText: '2h', today: false, times: ['10:00'], notice: 'Para 2h não tem, mas para 1h tem:' }), /^Não tem quadra livre para 2h nesse dia 😕\nPara 2h não tem, mas para 1h tem:\n\n🕒 10:00/);
  assert.match(noCourtsMessage({ start: '19:00', reason: 'passou', durationText: null, today: true, times: [] }), /Hoje já não tem mais horário livre\. Quer ver amanhã ou outro dia\? 📅$/);
  assert.match(noCourtsMessage({ start: '19:00', reason: 'ocupado', durationText: null, today: false, times: [] }), /Nesse dia não tem mais horário livre\. Quer tentar outro dia\? 📅$/);
  assert.match(noCourtsMessage({ start: '19:00', reason: 'ocupado', durationText: null, today: false, times: [], closed: true }), /^Nesse dia a arena está fechada/);
  const many = Array.from({ length: 20 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  const msg = noCourtsMessage({ start: '12:00', reason: 'ocupado', durationText: null, today: false, times: many });
  assert.ok(msg.includes('🕒 12:00 · 12:30') && msg.split(' · ').length === 12, 'mostra os 12 a partir do pedido');
  const late = noCourtsMessage({ start: '17:00', reason: 'ocupado', durationText: null, today: false, times: [...many, '22:00'] });
  assert.ok(late.includes('22:00') && late.split(' · ').length === 12 && late.includes('17:00'), 'pedido perto do fim: completa com os anteriores');
});

test('horários do dia por quadra, com o esporte', () => {
  const courts = [{ name: 'Areia 1', sport: 'Vôlei', times: ['18:00', '19:00'] }, { name: 'Society 1', sport: 'Society', times: ['19:00', '19:30', '20:30'] }, { name: 'Society 2', sport: 'Society', times: [] }];
  assert.equal(dayScheduleMessage({ dayLabel: 'quinta-feira, 01/10/2026', period: 'noite', durationText: null, courts }),
    '📅 quinta-feira, 01/10/2026. Horários livres à noite:\n\n🏟️ Areia 1 · Vôlei\n🕒 18:00 · 19:00\n\n🏟️ Society 1 · Society\n🕒 19:00 · 19:30 · 20:30\n\n🏟️ Society 2 · Society — sem horários livres à noite\n\nQue horas você quer jogar e por quanto tempo? 🙂');
  assert.match(dayScheduleMessage({ dayLabel: 'x', period: null, durationText: '1h30', courts: courts.slice(0, 1) }), /Horários livres para 1h30:/);
  assert.match(dayScheduleMessage({ dayLabel: 'x', period: 'manha', durationText: null, courts: courts.map((c) => ({ ...c, times: [] })) }), /Não tenho horários livres de manhã nesse dia\. Quer ver outro período ou outro dia\?/);
  const eight = Array.from({ length: 8 }, (_, i) => ({ name: `Q${i + 1}`, sport: 'Society', times: Array.from({ length: 8 - i }, (_, k) => `1${k}:00`) }));
  const big = dayScheduleMessage({ dayLabel: 'x', period: null, durationText: null, courts: eight });
  assert.ok(big.includes('Q1 ·') && big.includes('Q6 ·') && !big.includes('Q7 ·') && big.includes('Tem mais 2 quadras com horários livres'), big);
});

test('pedido de fotos e "todas as quadras"', () => {
  for (const t of ['Me mande fotos das quadras por favor', 'tem foto da quadra?', 'quero ver as imagens', 'manda uma fotinha', 'Quero ver a quadra', 'como é a arena?', 'Foto da society 1']) assert.equal(isPhotoRequest(t), true, t);
  for (const t of ['quero reservar', 'mandei o comprovante em foto', 'oi', 'areia 1', 'qual o valor?', 'quero ver horários']) assert.equal(isPhotoRequest(t), false, t);
  for (const t of ['das 3', 'todas', 'de todas', 'as três', 'todas as quadras', 'pode ser das 3 quadras', 'tudo']) assert.equal(isAllCourts(t, 3), true, t);
  for (const t of ['das 4', 'areia 1', 'às 20h', 'as 2', 'quero a society 2', '3']) assert.equal(isAllCourts(t, 3), false, t);
  assert.equal(isAllCourts('das 3', 1), false, 'com uma quadra só não existe "todas"');
});
test('textos do fluxo de fotos', () => {
  assert.equal(photoQuestion(['Areia 1', 'Society 1', 'Society 2']), 'Claro! De qual quadra você quer ver as fotos? Areia 1, Society 1 ou Society 2? Se preferir, mando de todas. 📸');
  assert.deepEqual(photosOutcome({ sent: 3, failed: 0, without: [] }), { text: 'Quer agendar um horário? 📅', handoff: false });
  assert.equal(photosOutcome({ sent: 2, failed: 0, without: ['Society 2'] }).text, 'Society 2 ainda não tem fotos cadastradas.\n\nQuer agendar um horário? 📅');
  assert.match(photosOutcome({ sent: 1, failed: 0, without: ['Areia 1', 'Society 2'] }).text, /^Areia 1 e Society 2 ainda não têm fotos cadastradas\./);
  assert.equal(photosOutcome({ sent: 0, failed: 0, without: ['Areia 1'] }).text, 'Areia 1 ainda não tem fotos cadastradas.\n\nQuer agendar um horário? 📅');
  assert.deepEqual(photosOutcome({ sent: 0, failed: 2, without: [] }), { text: 'Não consegui enviar as fotos agora. Deixei um recado para a equipe te ajudar. 🙏', handoff: true });
  assert.equal(photosOutcome({ sent: 1, failed: 1, without: [] }).handoff, true);
});

test('pedido de cancelamento', () => {
  for (const t of ['gostaria de cancelar minha reserva tive um imprevisto', 'quero cancelar', 'cancela pra mim', 'preciso desmarcar', 'não vou poder ir', 'nao vamos conseguir jogar', 'tive um imprevisto', 'desisto da reserva']) assert.equal(isCancelIntent(t), true, t);
  for (const t of ['quero reservar', 'quero remarcar', 'não quero cancelar', 'qual o prazo pra cancelamento?'.replace('cancelamento', 'remarcar'), 'oi']) assert.equal(isCancelIntent(t), false, t);
});
test('escolha da reserva na lista', () => {
  const opts = [{ id: 'a', court: 'Society 1', start: '2026-10-02T19:00:00.000Z' }, { id: 'b', court: 'Areia 1', start: '2026-10-03T20:00:00.000Z' }, { id: 'c', court: 'Society 1', start: '2026-10-05T19:00:00.000Z' }];
  const cases: Array<[string, string | null]> = [['1', 'a'], ['2', 'b'], ['a 3', 'c'], ['4', null], ['a da areia', 'b'], ['areia 1', 'b'], ['a de sábado', 'b'], ['a de hoje', 'a'], ['amanhã', 'b'], ['dia 5', 'c'], ['05/10', 'c'], ['society 1 de sexta', 'a'],
    ['society 1', null], ['a das 19h', null], ['sim', null], ['quero cancelar', null]];
  for (const [text, expected] of cases) assert.equal(pickBooking(text, opts, '2026-10-02'), expected, text);
});

test('pedido de remarcação', () => {
  for (const t of ['quero remarcar minha reserva', 'dá pra remarcar?', 'preciso mudar o horário', 'posso trocar o dia da reserva?', 'quero passar pra outro dia', 'reagendar', 'tem como adiar para sábado?']) assert.equal(isRescheduleIntent(t), true, t);
  for (const t of ['quero reservar', 'quero cancelar', 'qual o horário de funcionamento?', 'oi']) assert.equal(isRescheduleIntent(t), false, t);
});
test('resumo e confirmação da remarcação', () => {
  const base = { from: 'Society 1, qui 01/10, 19:00–20:00', to: 'Society 1, sex 02/10, 20:00–21:00' };
  assert.equal(rescheduleSummary({ ...base, amountCents: 10000, paidCents: 0 }), '🔁 Remarcar a reserva:\n\nDe: Society 1, qui 01/10, 19:00–20:00\nPara: Society 1, sex 02/10, 20:00–21:00\n💰 Valor: R$ 100,00 (pago na arena)\n\nConfirma a remarcação?');
  assert.match(rescheduleSummary({ ...base, amountCents: 10000, paidCents: 100 }), /R\$ 100,00 \(R\$ 1,00 já pago; R\$ 99,00 na arena\)/);
  assert.match(rescheduleSummary({ ...base, amountCents: 10000, paidCents: 15000 }), /\(já pago\)\nA diferença de R\$ 50,00 será devolvida pela equipe\./);
  assert.match(rescheduledText({ to: base.to, amountCents: 10000, paidCents: 100 }), /^Pronto! Sua reserva foi remarcada para Society 1, sex 02\/10, 20:00–21:00\. ✅\n\nRestante a pagar na arena: R\$ 99,00\./);
  assert.doesNotMatch(rescheduledText({ to: base.to, amountCents: 10000, paidCents: 0 }), /Restante/);
});
