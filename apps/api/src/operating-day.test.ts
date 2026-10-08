import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockOf, clockText, dayRange, hoursProblem, minutesFrom, operatingDayOf, resolveClock, wallIso, windowOf, type DayHours } from './operating-day.js';

// sexta (5) das 18h às 02h; sábado (6) das 08h às 24h; domingo fechado; demais 08h–23h
const hours: DayHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => weekday === 5 ? { weekday, isOpen: true, openTime: '18:00', closeTime: '26:00' } : weekday === 6 ? { weekday, isOpen: true, openTime: '08:00', closeTime: '24:00' } : { weekday, isOpen: weekday !== 0, openTime: '08:00', closeTime: '23:00' });
const FRI = '2026-10-16', SAT = '2026-10-17';

test('horários de madrugada: conversão de data e minutos', () => {
  assert.equal(wallIso(FRI, 25 * 60 + 30), `${SAT}T01:30:00.000Z`);
  assert.equal(wallIso(FRI, 23 * 60), `${FRI}T23:00:00.000Z`);
  assert.equal(wallIso(FRI, 24 * 60), `${SAT}T00:00:00.000Z`);
  assert.equal(minutesFrom(FRI, `${SAT}T01:00:00.000Z`), 25 * 60);
  assert.equal(minutesFrom(FRI, `${FRI}T19:00:00.000Z`), 19 * 60);
  assert.equal(clockOf(25 * 60 + 30), '01:30');
  assert.equal(clockText('24:00'), '00:00');
  assert.equal(clockText('19:30'), '19:30');
  assert.deepEqual(windowOf(hours, FRI), { day: FRI, weekday: 5, open: 18 * 60, close: 26 * 60 });
  assert.equal(windowOf(hours, '2026-10-18'), null, 'domingo fechado');
});

test('reserva de madrugada pertence ao funcionamento do dia anterior', () => {
  const r = operatingDayOf(hours, `${SAT}T00:30:00.000Z`, `${SAT}T02:00:00.000Z`);
  assert.equal(r?.day, FRI); assert.equal(r?.start, 24 * 60 + 30); assert.equal(r?.end, 26 * 60);
  const cross = operatingDayOf(hours, `${FRI}T23:00:00.000Z`, `${SAT}T01:00:00.000Z`);
  assert.equal(cross?.day, FRI, '23h–01h atravessa a meia-noite');
  assert.equal(operatingDayOf(hours, `${SAT}T01:00:00.000Z`, `${SAT}T03:00:00.000Z`), null, 'passa das 02h');
  assert.equal(operatingDayOf(hours, `${SAT}T07:00:00.000Z`, `${SAT}T08:00:00.000Z`), null, 'sábado abre às 8h');
  assert.equal(operatingDayOf(hours, `${SAT}T22:00:00.000Z`, `2026-10-18T00:00:00.000Z`)?.day, SAT, 'sábado até 24:00');
  assert.equal(operatingDayOf(hours, `${SAT}T23:00:00.000Z`, `2026-10-18T00:30:00.000Z`), null, 'sábado fecha às 24:00');
  assert.equal(operatingDayOf(hours, '2026-10-14T22:00:00.000Z', '2026-10-14T23:00:00.000Z')?.day, '2026-10-14', 'dia comum segue igual');
  assert.equal(operatingDayOf(hours, '2026-10-14T22:30:00.000Z', '2026-10-14T23:30:00.000Z'), null);
});

test('"00:30" dito para sexta vira a madrugada de sábado; nos outros dias fica igual', () => {
  const fri = windowOf(hours, FRI)!, wed = windowOf(hours, '2026-10-14')!;
  assert.equal(resolveClock(fri, '00:30'), 24 * 60 + 30);
  assert.equal(resolveClock(fri, '01:30'), 25 * 60 + 30);
  assert.equal(resolveClock(fri, '19:00'), 19 * 60);
  assert.equal(resolveClock(fri, '03:00'), 3 * 60, 'depois do fechamento não vira madrugada');
  assert.equal(resolveClock(wed, '00:30'), 30);
});

test('validação do horário semanal', () => {
  assert.equal(hoursProblem(hours), null);
  assert.match(hoursProblem([{ weekday: 1, isOpen: true, openTime: '18:00', closeTime: '31:00' }])!, /Confira|06:00/);
  assert.match(hoursProblem([{ weekday: 1, isOpen: true, openTime: '18:00', closeTime: '17:00' }])!, /depois da abertura/);
  assert.match(hoursProblem([{ weekday: 1, isOpen: true, openTime: '18:00', closeTime: '27:00' }, { weekday: 2, isOpen: true, openTime: '02:00', closeTime: '10:00' }])!, /abertura do dia seguinte/);
  assert.equal(hoursProblem([{ weekday: 1, isOpen: true, openTime: '18:00', closeTime: '30:00' }, { weekday: 2, isOpen: false, openTime: '08:00', closeTime: '23:00' }]), null, 'até 06h se o dia seguinte está fechado');
});

test('faixa da agenda: madrugada fica com o dia de funcionamento', () => {
  assert.deepEqual(dayRange(hours, FRI), { fromIso: `${FRI}T00:00:00.000Z`, toIso: `${SAT}T02:00:00.000Z` });
  assert.deepEqual(dayRange(hours, SAT), { fromIso: `${SAT}T02:00:00.000Z`, toIso: '2026-10-18T00:00:00.000Z' });
  assert.deepEqual(dayRange(hours, '2026-10-14'), { fromIso: '2026-10-14T00:00:00.000Z', toIso: '2026-10-15T00:00:00.000Z' });
});
