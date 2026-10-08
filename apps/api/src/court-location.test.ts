import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtPlaceText, hasOwnLocation, locationJson, validateCourtLocation } from './court-location.js';

test('local da quadra: vazio vale o endereço da arena', () => {
  const r = validateCourtLocation({});
  assert.ok('location' in r);
  assert.deepEqual(r.location, { locationName: '', locationAddress: '', locationMapsUrl: '' });
  assert.equal(hasOwnLocation(r.location), false);
  assert.equal(courtPlaceText(r.location), '');
});

test('local da quadra: normaliza e valida', () => {
  const r = validateCourtLocation({ name: '  Unidade   Centro ', address: 'Rua A, 10 - Centro', mapsUrl: 'https://maps.app.goo.gl/abc123' });
  assert.ok('location' in r);
  assert.equal(r.location.locationName, 'Unidade Centro');
  assert.equal(courtPlaceText(r.location), 'Unidade Centro — Rua A, 10 - Centro');
  assert.deepEqual(locationJson(r.location), { name: 'Unidade Centro', address: 'Rua A, 10 - Centro', maps_url: 'https://maps.app.goo.gl/abc123' });
  assert.equal(courtPlaceText({ locationAddress: 'Rua B, 5' }), 'Rua B, 5');
  assert.ok('error' in validateCourtLocation({ address: 'Rua A', mapsUrl: 'http://maps.app.goo.gl/x' }), 'link sem HTTPS');
  assert.ok('error' in validateCourtLocation({ address: 'Rua A', mapsUrl: 'https://evil.example/x' }), 'link fora do Google');
  assert.ok('error' in validateCourtLocation({ mapsUrl: 'https://maps.app.goo.gl/x' }), 'mapa sem endereço');
  assert.ok('error' in validateCourtLocation({ address: 'x'.repeat(201) }));
});
