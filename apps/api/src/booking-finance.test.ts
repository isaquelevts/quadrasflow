import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_BALANCE, OPEN_FULL, bookingEnded, planReceivable } from './booking-finance.js';

const booking = (status: string, amountCents = 10000) => ({ status, amountCents, startAt: '2026-10-05T19:00:00.000Z' });
const paid = (id: string, amountCents: number) => ({ id, amountCents, paidAt: '2026-10-01T10:00:00.000Z', createdAt: '2026-10-01T10:00:00.000Z' });
const open = (id: string, amountCents: number, createdAt = '2026-10-01T09:00:00.000Z') => ({ id, amountCents, paidAt: null, createdAt });

test('confirmada sem Pix: valor inteiro a receber na data do jogo', () => {
  assert.deepEqual(planReceivable(booking('confirmed'), []), { upsert: { id: null, amountCents: 10000, description: OPEN_FULL, dueDate: '2026-10-05' }, remove: [] });
});
test('sinal por Pix: só o saldo fica em aberto', () => {
  assert.deepEqual(planReceivable(booking('confirmed'), [paid('pix', 5000)]).upsert, { id: null, amountCents: 5000, description: OPEN_BALANCE, dueDate: '2026-10-05' });
});
test('Pix integral: nada em aberto', () => {
  assert.deepEqual(planReceivable(booking('confirmed'), [paid('pix', 10000)]), { upsert: null, remove: [] });
});
test('pendente não gera a receber (pode nunca acontecer)', () => {
  assert.deepEqual(planReceivable(booking('pending'), []), { upsert: null, remove: [] });
});
test('cancelada: remove o que estava em aberto e mantém o que foi pago', () => {
  assert.deepEqual(planReceivable(booking('cancelled'), [paid('pix', 5000), open('saldo', 5000)]), { upsert: null, remove: ['saldo'] });
});
test('concluída sem pagamento continua a receber', () => {
  assert.equal(planReceivable(booking('completed'), [open('a', 10000)]).upsert?.amountCents, 10000);
});
test('valor da reserva mudou: atualiza o mesmo lançamento', () => {
  assert.deepEqual(planReceivable(booking('confirmed', 15000), [open('a', 10000)]).upsert, { id: 'a', amountCents: 15000, description: OPEN_FULL, dueDate: '2026-10-05' });
});
test('dois em aberto (ex.: Pix desfeito): junta num só', () => {
  const plan = planReceivable(booking('confirmed'), [open('novo', 5000, '2026-10-02T00:00:00.000Z'), open('antigo', 5000, '2026-10-01T00:00:00.000Z')]);
  assert.equal(plan.upsert?.id, 'antigo'); assert.equal(plan.upsert?.amountCents, 10000); assert.deepEqual(plan.remove, ['novo']);
});
test('reserva sem valor não gera lançamento', () => {
  assert.deepEqual(planReceivable(booking('confirmed', 0), []), { upsert: null, remove: [] });
});
test('fim do jogo no horário da arena', () => {
  const now = new Date('2026-10-05T23:30:00Z'); // 20:30 em São Paulo
  assert.equal(bookingEnded('2026-10-05T20:00:00.000Z', now), true);
  assert.equal(bookingEnded('2026-10-05T20:30:00.000Z', now), true);
  assert.equal(bookingEnded('2026-10-05T21:00:00.000Z', now), false);
});
