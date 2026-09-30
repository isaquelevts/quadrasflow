import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationChoices, durationLabel, durationRangeText, maxDurationOf, validDuration } from './booking-duration.js';

test('máximo da arena: valor válido ou 8h', () => {
  assert.equal(maxDurationOf({ maxDurationMinutes: 180 }), 180);
  for (const bad of [undefined, null, {}, { maxDurationMinutes: 45 }, { maxDurationMinutes: 500 }, { maxDurationMinutes: 100 }]) assert.equal(maxDurationOf(bad), 480);
});
test('durações de 30 em 30 até o máximo', () => {
  assert.deepEqual(durationChoices(120), [60, 90, 120]);
  assert.equal(durationChoices(480).length, 15);
  assert.ok(validDuration(180, 180) && !validDuration(210, 180) && !validDuration(30, 180) && !validDuration(75, 180));
});
test('rótulos', () => {
  assert.deepEqual([60, 90, 150, 480].map(durationLabel), ['1h', '1h30', '2h30', '8h']);
  assert.equal(durationRangeText(120), '1h, 1h30 ou 2h');
  assert.equal(durationRangeText(60), '1h');
  assert.equal(durationRangeText(480), 'de 1h a 8h');
});
