import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import worker from '../worker/src/index.js';
const { createHandler } = createRequire(import.meta.url)('../yandex/index.cjs');
const origin = 'https://nutriciolog.pages.dev';
test('Yandex: preflight allows Firebase custom header and only allowed origin', async () => {
  const handler = createHandler(worker, {});
  const result = await handler({ httpMethod: 'OPTIONS', headers: { Origin: origin } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['access-control-allow-origin'], origin);
  assert.match(result.headers['access-control-allow-headers'], /X-X20-Authorization/);
  const phone = await handler({ httpMethod: 'OPTIONS', headers: { Origin: 'https://localhost' } });
  assert.equal(phone.headers['access-control-allow-origin'], 'https://localhost');
  const phoneDenied = await handler({ httpMethod: 'POST', headers: { Origin: 'https://localhost' }, body: '{"action":"usage"}' });
  assert.equal(phoneDenied.statusCode, 401);
  assert.equal(phoneDenied.headers['access-control-allow-origin'], 'https://localhost');
  const foreign = await handler({ httpMethod: 'OPTIONS', headers: { Origin: 'https://foreign.example' } });
  assert.notEqual(foreign.headers['access-control-allow-origin'], 'https://foreign.example');
});
test('Yandex: health works; unauthenticated AI and invalid tokens rejected', async () => {
  const handler = createHandler(worker, {});
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 200);
  assert.equal((await handler({ httpMethod: 'POST', body: '{"message":"test"}' })).statusCode, 401);
  assert.equal((await handler({ httpMethod: 'POST', headers: { 'X-X20-Authorization': 'Bearer invalid' }, body: '{}' })).statusCode, 401);
});
test('Yandex: restores token case-insensitively and decodes body', async () => {
  const handler = createHandler({ async fetch(request) {
    assert.equal(request.headers.get('Authorization'), 'Bearer firebase-test');
    assert.equal(await request.text(), '{"message":"Привет"}');
    return new Response('{"advice":"ok","proposedMeal":null}', { status: 200 });
  }});
  const result = await handler({ httpMethod: 'POST', headers: { 'x-x20-authorization': 'Bearer firebase-test' }, body: Buffer.from('{"message":"Привет"}').toString('base64'), isBase64Encoded: true });
  assert.equal(result.statusCode, 200);
  assert.equal(result.isBase64Encoded, false);
  assert.equal(result.headers['Cache-Control'], 'no-store');
});
test('Yandex: oversized body rejected before AI invocation', async () => {
  const handler = createHandler(worker, {});
  const result = await handler({ httpMethod: 'POST', headers: { Origin: origin }, body: 'x'.repeat(1_800_001) });
  assert.equal(result.statusCode, 413);
  assert.equal(result.headers['access-control-allow-origin'], origin);
});
