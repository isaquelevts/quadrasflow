import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargeDueNow, chargeMessage, DEFAULT_CHARGE_MESSAGE, dueDateOf, parsePlanSlots, validDueDay } from './monthly-plan.js';

test('vencimento: dia escolhido, ou o último dia em mês mais curto', () => {
  assert.equal(dueDateOf('2026-10', 5), '2026-10-05');
  assert.equal(dueDateOf('2026-10', 31), '2026-10-31');
  assert.equal(dueDateOf('2026-11', 31), '2026-11-30');
  assert.equal(dueDateOf('2027-02', 30), '2027-02-28');
  assert.equal(dueDateOf('2028-02', 31), '2028-02-29', 'ano bissexto');
  assert.ok(validDueDay(1) && validDueDay(31));
  assert.ok(!validDueDay(0) && !validDueDay(32) && !validDueDay(5.5) && !validDueDay('5'));
});

test('horários do plano: vários dias, ordenados, sem sobreposição', () => {
  const r = parsePlanSlots({ slots: [
    { courtId: 'c1', weekday: 5, startTime: '20:00', durationMinutes: 60 },
    { courtId: 'c1', weekday: 1, startTime: '19:00', durationMinutes: 60 },
    { courtId: 'c2', weekday: 2, startTime: '19:00', durationMinutes: 120 },
  ] });
  assert.ok('slots' in r);
  assert.deepEqual(r.slots.map((s) => s.weekday), [1, 2, 5]);
  assert.ok('error' in parsePlanSlots({ slots: [] }), 'sem horário');
  assert.ok('error' in parsePlanSlots({ slots: [{ courtId: 'c1', weekday: 1, startTime: '19:15', durationMinutes: 60 }] }), 'minuto inválido');
  assert.ok('error' in parsePlanSlots({ slots: [{ courtId: 'c1', weekday: 7, startTime: '19:00', durationMinutes: 60 }] }), 'dia inválido');
  assert.ok('error' in parsePlanSlots({ slots: [{ courtId: 'c1', weekday: 1, startTime: '19:00', durationMinutes: 30 }] }), 'menos de 1h');
  const clash = parsePlanSlots({ slots: [{ courtId: 'c1', weekday: 1, startTime: '19:00', durationMinutes: 120 }, { courtId: 'c1', weekday: 1, startTime: '20:00', durationMinutes: 60 }] });
  assert.ok('error' in clash && clash.error.includes('se sobrepõem'));
  assert.ok('slots' in parsePlanSlots({ slots: [{ courtId: 'c1', weekday: 1, startTime: '19:00', durationMinutes: 60 }, { courtId: 'c1', weekday: 1, startTime: '20:00', durationMinutes: 60 }] }), 'encostar não é sobreposição');
  assert.ok('error' in parsePlanSlots({ slots: Array.from({ length: 15 }, (_, i) => ({ courtId: 'c1', weekday: i % 7, startTime: `${String(6 + i).padStart(2, '0')}:00`, durationMinutes: 60 })) }), 'mais de 14');
});

test('horários do plano: formato antigo (um horário solto) continua aceito', () => {
  const r = parsePlanSlots({ courtId: 'c1', weekday: 3, startTime: '18:00', durationMinutes: 90 });
  assert.ok('slots' in r);
  assert.deepEqual(r.slots, [{ courtId: 'c1', weekday: 3, startTime: '18:00', durationMinutes: 90 }]);
});

test('mensagem da cobrança e horário de envio', () => {
  assert.equal(chargeMessage(DEFAULT_CHARGE_MESSAGE, { name: 'Pedro Alves', arena: 'JogaJunto', amountCents: 40000, dueDate: '2026-11-10', cycle: '2026-11' }),
    'Olá, Pedro! Passando para lembrar da mensalidade de novembro na JogaJunto: R$ 400,00, com vencimento hoje (10/11/2026). Qualquer dúvida é só responder aqui. 🙂');
  assert.ok(chargeDueNow('2026-11-10', { date: '2026-11-10', time: '09:00' }));
  assert.ok(!chargeDueNow('2026-11-10', { date: '2026-11-10', time: '08:59' }), 'antes das 9h');
  assert.ok(!chargeDueNow('2026-11-10', { date: '2026-11-11', time: '10:00' }), 'dia seguinte não manda');
});
