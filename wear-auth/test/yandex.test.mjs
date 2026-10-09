import test from 'node:test';
import assert from 'node:assert/strict';
import { ydbStore } from '../ydb-store.mjs';
import { yandexAdapter } from '../yandex-adapter.mjs';
import { createHandler } from '../handler.mjs';
import { createPairingService } from '../pairing.mjs';

function storage() {
  const rows = new Map();
  let conflict = false;
  const fetcher = async (_, request) => {
    assert.equal(request.headers.Authorization, 'Bearer runtime-token');
    const p = JSON.parse(request.body);
    assert.equal(p.TableName, 'wear_pairing');
    const action = request.headers['X-Amz-Target'].split('.').pop();
    const id = (p.Item || p.Key).id.S;
    const old = rows.get(id);
    const fail = () => new Response('{"__type":"ConditionalCheckFailedException"}', { status: 400 });
    if (action === 'GetItem') { assert.equal(p.ConsistentRead, true); return Response.json(old ? { Item: structuredClone(old) } : {}); }
    if (action === 'PutItem') {
      if (p.ConditionExpression.includes('attribute_not_exists') && old) return fail();
      if (p.ExpressionAttributeValues) {
        if (conflict) { conflict = false; rows.set(id, { ...old, revision: { N: String(Number(old.revision.N) + 1) } }); return fail(); }
        if (old?.revision.N !== p.ExpressionAttributeValues[':previous'].N) return fail();
      }
      rows.set(id, structuredClone(p.Item));
    } else if (action === 'UpdateItem') {
      const count = Number(old?.count.N || 0);
      if (count >= Number(p.ExpressionAttributeValues[':max'].N)) return fail();
      rows.set(id, { ...p.Key, count: { N: String(count + 1) }, deleteAt: p.ExpressionAttributeValues[':ttl'] });
    } else throw new Error('Unexpected operation');
    return Response.json({});
  };
  return { rows, collide: () => { conflict = true; }, store: ydbStore({ endpoint: 'https://docapi.serverless.yandexcloud.net/region/db', token: 'runtime-token', fetcher }) };
}

test('YDB pairing CAS retries conflicts, has TTL and blocks concurrent replay', async () => {
  const f = storage();
  const service = createPairingService({ store: f.store, webAppUrl: 'https://example.com/', verifyIdToken: async () => ({ uid: 'owner' }), mintToken: async () => 'custom-test-token' });
  const pairing = await service.start();
  f.collide();
  await service.approve(pairing, 'valid');
  const results = await Promise.allSettled([service.poll(pairing), service.poll(pairing)]);
  assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.customToken).length, 1);
  const session = [...f.rows.values()].find(row => row.record);
  assert.equal(JSON.parse(session.record.S).uid, null);
  assert.equal(JSON.parse(session.record.S).status, 'consumed');
  assert.equal(Number(session.deleteAt.N), Math.ceil((pairing.expiresAt + 60000) / 1000));
  assert.ok(!JSON.stringify([...f.rows]).includes(pairing.deviceSecret));
});

test('YDB distributed limits fail closed; creation cannot replace an existing code', async () => {
  const f = storage();
  await f.store.limit('x', 1, 1000, 60000);
  await assert.rejects(f.store.limit('x', 1, 1000, 60000), error => error.code === 'rate_limited');
  await f.store.limit('x', 1, 61000, 60000);
  await f.store.create('id', { expiresAt: 1000 });
  await assert.rejects(f.store.create('id', { expiresAt: 2000 }));
  assert.throws(() => ydbStore({ endpoint: 'https://attacker.test', token: 'secret' }));
  const broken = ydbStore({ endpoint: 'https://docapi.serverless.yandexcloud.net/db', token: 'x', fetcher: async () => new Response('{"error":"secret-error"}', { status: 500 }) });
  await assert.rejects(broken.read('id'), /storage unavailable/);
});

test('Yandex query routing, custom app token, base64, CORS and body bound', async () => {
  const handle = yandexAdapter(createHandler({ inspect: async (payload, token) => { assert.equal(token, 'phone-token'); assert.equal(payload.code, '01234567'); return { status: 'pending' }; } }, new Set(['https://example.com'])));
  const event = { httpMethod: 'POST', queryStringParameters: { action: 'inspect' }, headers: { 'Content-Type': 'application/json', Origin: 'https://example.com', 'X-X20-Authorization': 'Bearer phone-token', Authorization: 'Bearer platform-token' }, isBase64Encoded: true, body: Buffer.from('{"code":"01234567"}').toString('base64') };
  const response = await handle(event);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
  const preflight = await handle({ ...event, httpMethod: 'OPTIONS', body: '' });
  assert.equal(preflight.statusCode, 204);
  assert.match(preflight.headers['access-control-allow-headers'], /X-X20-Authorization/);
  assert.equal((await handle({ ...event, queryStringParameters: { action: 'unknown' } })).statusCode, 404);
  assert.equal((await handle({ ...event, headers: { ...event.headers, Origin: 'https://other.test' } })).statusCode, 403);
  assert.equal((await handle({ ...event, isBase64Encoded: false, body: 'a'.repeat(4097) })).statusCode, 413);
});
