import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestPhone, testPhoneMatches } from './whatsapp-test-mode.js';

test('o mesmo celular com e sem o 9º dígito é a mesma pessoa (caso real das fotos)', () => {
  assert.equal(testPhoneMatches('559481234142', '5594981234142'), true, 'entregue com 12, cadastrado com 13');
  assert.equal(testPhoneMatches('5594981234142', '559481234142'), true, 'cadastrado com 12, entregue com 13');
  assert.equal(testPhoneMatches('5594981234142', '5594981234142'), true);
  assert.equal(testPhoneMatches('(94) 98123-4142', '5594981234142'), false, 'sem o 55 só vale com o mesmo formato');
});
test('números diferentes não casam', () => {
  assert.equal(testPhoneMatches('559481234143', '5594981234142'), false, 'último dígito diferente');
  assert.equal(testPhoneMatches('558581234142', '5594981234142'), false, 'DDD diferente');
  assert.equal(testPhoneMatches('559481234142', '5594881234142'), false, 'o 9 faltante precisa ser o 9º dígito');
  assert.equal(testPhoneMatches('5594981234142', '5594971234142'), false);
});
test('lista de números de teste', () => {
  assert.equal(isTestPhone('559481234142', ['5594999990000', '5594981234142']), true);
  assert.equal(isTestPhone('559481234142', []), false);
  assert.equal(isTestPhone('559481234142', undefined), false);
});
