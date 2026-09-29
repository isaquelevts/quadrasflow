import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { AccountLockout, crossSiteWriteBlocked, trustProxySetting } from './security.js';

/** IP que a API enxerga para uma cadeia de proxies (socket = quem conectou; X-Forwarded-For = os anteriores). */
async function seenIp(setting: string, socket: string, xff: string) {
  const app = Fastify({ trustProxy: trustProxySetting(setting) });
  app.get('/', async (request) => request.ip);
  const res = await app.inject({ method: 'GET', url: '/', remoteAddress: socket, headers: xff ? { 'x-forwarded-for': xff } : {} });
  await app.close();
  return res.body;
}

test('produção: Cloudflare → Traefik → nginx → API enxerga o IP real do cliente', async () => {
  // cliente 200.1.2.3 → Cloudflare 172.70.1.1 → Traefik 10.0.1.5 → nginx 10.0.1.9 (socket)
  assert.equal(await seenIp('cloudflare', '10.0.1.9', '200.1.2.3, 172.70.1.1, 10.0.1.5'), '200.1.2.3');
});
test('produção: cliente que forja X-Forwarded-For não escolhe o próprio IP', async () => {
  assert.equal(await seenIp('cloudflare', '10.0.1.9', '9.9.9.9, 200.1.2.3, 172.70.1.1, 10.0.1.5'), '200.1.2.3');
});
test('produção: quem pula o Cloudflare e forja o cabeçalho aparece com o IP verdadeiro', async () => {
  assert.equal(await seenIp('cloudflare', '10.0.1.9', '1.1.1.1, 45.6.7.8, 10.0.1.5'), '45.6.7.8');
});
test('sem confiança no proxy (configuração antiga): todo mundo vira o IP do nginx', async () => {
  assert.equal(await seenIp('false', '10.0.1.9', '200.1.2.3, 172.70.1.1, 10.0.1.5'), '10.0.1.9');
});
test('lista explícita de faixas', () => assert.deepEqual(trustProxySetting(' loopback, 10.0.0.0/8 '), ['loopback', '10.0.0.0/8']));

test('CSRF: escrita de outro site é bloqueada', () => {
  const allowedOrigins = ['https://quadrasflow.com.br'];
  const base = { method: 'POST', url: '/api/bookings', allowedOrigins, host: 'quadrasflow.com.br' };
  assert.equal(crossSiteWriteBlocked({ ...base, origin: 'https://quadrasflow.com.br' }), false);
  assert.equal(crossSiteWriteBlocked({ ...base, host: 'www.quadrasflow.com.br', origin: 'https://www.quadrasflow.com.br' }), false, 'outro domínio do próprio app');
  assert.equal(crossSiteWriteBlocked({ ...base, host: 'www.quadrasflow.com.br', origin: 'https://site-malicioso.com' }), true);
  assert.equal(crossSiteWriteBlocked({ ...base, origin: 'null' }), true, 'origem opaca (iframe sandbox/arquivo)');
  assert.equal(crossSiteWriteBlocked({ ...base, origin: 'https://site-malicioso.com' }), true);
  assert.equal(crossSiteWriteBlocked({ ...base, origin: 'https://outro.quadrasflow.com.br' }), true);
  assert.equal(crossSiteWriteBlocked({ ...base, fetchSite: 'cross-site' }), true);
  assert.equal(crossSiteWriteBlocked({ ...base }), false, 'sem Origin (servidor/integração)');
  assert.equal(crossSiteWriteBlocked({ ...base, method: 'GET', origin: 'https://site-malicioso.com' }), false);
  assert.equal(crossSiteWriteBlocked({ ...base, url: '/api/webhooks/mercadopago', origin: 'https://mercadopago.com' }), false);
});

test('bloqueio por conta depois de 8 senhas erradas, liberado depois da janela', () => {
  let now = 0; const lock = new AccountLockout(8, 15 * 60_000, () => now);
  for (let i = 0; i < 7; i++) { lock.fail('ana@x.com'); now += 1000; }
  assert.equal(lock.retryAfter('ana@x.com'), 0);
  lock.fail('ana@x.com');
  assert.ok(lock.retryAfter('ana@x.com') > 0);
  assert.equal(lock.retryAfter('bruno@x.com'), 0, 'outras contas não são afetadas');
  now += 15 * 60_000;
  assert.equal(lock.retryAfter('ana@x.com'), 0);
  lock.fail('carla@x.com'); lock.succeed('carla@x.com');
  assert.equal(lock.retryAfter('carla@x.com'), 0);
});
