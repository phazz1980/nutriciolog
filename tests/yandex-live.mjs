// Read-only deployment checks: no credentials, model calls or diary writes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const site = 'https://nutriciolog-x20.website.yandexcloud.net';
const client = await readFile(new URL('../js/ai-client.js', import.meta.url), 'utf8');
const endpoint = client.match(/export const AI_ENDPOINT = "([^"]+)"/)[1];
assert.equal(new URL(endpoint).hostname, 'functions.yandexcloud.net');
async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
}

const published = await request(`${site}/js/ai-client.js`);
assert.equal(published.status, 200);
assert.ok((await published.text()).includes(`AI_ENDPOINT = "${endpoint}"`), 'Published endpoint differs from local client');
const health = await request(endpoint, { headers: { Origin: site } });
assert.equal(health.status, 200);
assert.equal(health.headers.get('access-control-allow-origin'), site);
assert.match(health.headers.get('cache-control') || '', /no-store/);
const status = await health.json();
assert.equal(status.status, 'ok');
assert.equal(status.provider, 'blackroute');
assert.equal(status.apiKeyConfigured, true);

const preflight = await request(endpoint, { method: 'OPTIONS', headers: {
  Origin: site, 'Access-Control-Request-Method': 'POST',
  'Access-Control-Request-Headers': 'content-type,x-x20-authorization',
} });
assert.equal(preflight.status, 200);
assert.equal(preflight.headers.get('access-control-allow-origin'), site);
assert.match(preflight.headers.get('access-control-allow-headers') || '', /x-x20-authorization/i);
const foreign = await request(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://foreign.example' } });
assert.notEqual(foreign.headers.get('access-control-allow-origin'), '*');
assert.notEqual(foreign.headers.get('access-control-allow-origin'), 'https://foreign.example');
for (const token of [null, 'Bearer invalid']) {
  const response = await request(endpoint, { method: 'POST', headers: {
    Origin: site, 'Content-Type': 'application/json',
    ...(token ? { 'X-X20-Authorization': token } : {}),
  }, body: JSON.stringify({ message: 'Проверка авторизации' }) });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), site);
  assert.equal(typeof (await response.json()).error, 'string');
}
console.log('Yandex deployment OK: published endpoint, health, CORS, missing/invalid token.');
console.log('Authenticated text/photo requests and physical-device checks are separate.');
