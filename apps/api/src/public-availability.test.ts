import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endOptions, freeStarts, toMinutes } from './public-availability.js';

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
