import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endOptions, freeStarts, toMinutes } from './public-availability.js';
import type { CourtRules } from './court-rules.js';

const h = (hhmm: string) => toMinutes(hhmm);
const busy = [{ start: h('19:00'), end: h('21:00') }]; // reserva 19–21

test('inícios: 1h livre antes do fechamento e fora das reservas', () => {
  const starts = freeStarts(h('08:00'), h('23:00'), 0, busy);
  assert.equal(starts[0], h('08:00'));
  assert.ok(starts.includes(h('18:00')), '18:00–19:00 cabe');
  assert.ok(!starts.includes(h('18:30')), '18:30 bateria na reserva das 19h');
  assert.ok(!starts.includes(h('19:30')));
  assert.ok(starts.includes(h('21:00')));
  assert.equal(starts.at(-1), h('22:00'), 'último início com 1h até as 23h');
});
test('hoje: não oferece horário que já passou', () => {
  assert.equal(freeStarts(h('08:00'), h('23:00'), h('14:10'), [])[0], h('14:30'));
});
test('fins: de 1h até 8h, parando na próxima reserva ou no fechamento', () => {
  assert.deepEqual(endOptions(h('17:00'), h('23:00'), busy).map((m) => m / 60), [18, 18.5, 19]);
  assert.equal(endOptions(h('21:00'), h('23:00'), busy).at(-1), h('23:00'));
  assert.equal(endOptions(h('08:00'), h('23:00'), []).at(-1), h('16:00'), 'máximo de 8h');
  assert.deepEqual(endOptions(h('22:30'), h('23:00'), []), [], 'menos de 1h até fechar');
});

test('só horas cheias: inícios em hora cheia e fins de hora em hora', () => {
  const r: CourtRules = { step: 60, prime: [] };
  assert.deepEqual(freeStarts(h('08:30'), h('12:00'), 0, [], r), [h('09:00'), h('10:00'), h('11:00')]);
  assert.deepEqual(endOptions(h('09:00'), h('12:00'), [], 480, r), [h('10:00'), h('11:00'), h('12:00')]);
  assert.ok(!freeStarts(h('08:00'), h('23:00'), 0, [{ start: h('19:30'), end: h('20:30') }], r).includes(h('19:00')), '19h não cabe 1h inteira antes das 19:30');
});
test('horário nobre: 19h só aparece se couber o mínimo', () => {
  const r: CourtRules = { step: 30, prime: [{ days: [3], from: '19:00', to: '21:00', minMinutes: 120 }] };
  assert.deepEqual(endOptions(h('19:00'), h('23:00'), [], 480, r, 3).slice(0, 2), [h('21:00'), h('21:30')], 'fins de 20:00 e 20:30 somem');
  assert.deepEqual(endOptions(h('17:00'), h('23:00'), [], 480, r, 3).slice(0, 3), [h('18:00'), h('18:30'), h('19:00')], '17h–18h segue livre (não encosta)');
  assert.ok(endOptions(h('17:00'), h('23:00'), [], 480, r, 3).includes(h('19:30')), '17h–19h30 encosta no nobre com 2h30: aceita');
  assert.ok(!freeStarts(h('08:00'), h('23:00'), 0, [{ start: h('20:00'), end: h('21:00') }], r, 3).includes(h('19:00')), '19h com reserva às 20h: não cabe 2h');
  assert.ok(freeStarts(h('08:00'), h('23:00'), 0, [], r, 4).includes(h('19:00')) && endOptions(h('19:00'), h('23:00'), [], 480, r, 4)[0] === h('20:00'), 'outro dia sem regra');
});

test('blocos de 2h: inícios e fins seguem a grade a partir da abertura', () => {
  const r: CourtRules = { step: 120, prime: [] };
  assert.deepEqual(freeStarts(h('08:00'), h('16:00'), 0, [], r), [h('08:00'), h('10:00'), h('12:00'), h('14:00')]);
  assert.deepEqual(freeStarts(h('08:00'), h('16:00'), h('09:30'), [], r), [h('10:00'), h('12:00'), h('14:00')], 'hoje às 9h30: próximo bloco às 10h');
  assert.deepEqual(endOptions(h('10:00'), h('16:00'), [], 480, r, 3, h('08:00')), [h('12:00'), h('14:00'), h('16:00')]);
  assert.deepEqual(freeStarts(h('08:00'), h('16:00'), 0, [{ start: h('12:00'), end: h('13:00') }], r), [h('08:00'), h('10:00'), h('14:00')], 'bloco ocupado some');
  assert.deepEqual(freeStarts(h('07:00'), h('13:00'), 0, [], { step: 180, prime: [] }), [h('07:00'), h('10:00')], 'abre às 7h, blocos de 3h');
});
