import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayIn } from './arena-dates.js';

test('dia da arena, não o de UTC (achado da auditoria)', () => {
  assert.equal(dayIn('America/Belem', new Date('2026-10-01T02:30:00Z')), '2026-09-30', '23h30 de 30/09 em Belém continua sendo 30/09 (o mês certo)');
  assert.equal(dayIn('America/Belem', new Date('2026-10-01T03:00:00Z')), '2026-10-01');
  assert.equal(dayIn('America/Manaus', new Date('2026-10-01T03:30:00Z')), '2026-09-30', 'fuso de Manaus (UTC-4)');
  assert.equal(dayIn('', new Date('2026-10-01T02:30:00Z')), '2026-09-30', 'sem fuso: São Paulo');
});
