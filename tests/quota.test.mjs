import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { userQuota, quotaPeriod, monthlyLimit, QuotaExceededError, QuotaUnavailableError } from '../worker/src/quota.js';
import { createYdbQuotaStore } from '../worker/src/quota-ydb.js';
import worker from '../worker/src/index.js';

function memoryStore() {
  const counts = new Map();
  return {
    async read(uid, month) { return counts.get(`${uid}:${month}`) || 0; },
    async consume(uid, month, limit) {
      const key = `${uid}:${month}`, used = counts.get(key) || 0;
      if (used >= limit) return null;
      counts.set(key, used + 1);
      return used + 1;
    },
  };
}

test('Quota defaults to 1000; rejects invalid configuration', () => {
  assert.equal(monthlyLimit({}), 1000);
  for (const limit of ['0', '-1', 'abc', '1.5', '']) assert.throws(() => monthlyLimit({ AI_MONTHLY_REQUEST_LIMIT: limit }), QuotaUnavailableError);
});

test('Quota is isolated by UID and UTC month; reads are free and rollover needs no job', async () => {
  const env = { AI_QUOTA_STORE: memoryStore(), AI_MONTHLY_REQUEST_LIMIT: '1' };
  const december = new Date('2026-12-31T23:59:59Z');
  const january = new Date('2027-01-01T00:00:00Z');
  assert.deepEqual(quotaPeriod(december), { period: '2026-12', resetsAt: '2027-01-01T00:00:00.000Z' });
  assert.equal((await userQuota(env, 'a', true, december)).remaining, 0);
  await assert.rejects(userQuota(env, 'a', true, december), QuotaExceededError);
  assert.equal((await userQuota(env, 'a', false, december)).used, 1);
  assert.equal((await userQuota(env, 'b', false, december)).used, 0);
  assert.equal((await userQuota(env, 'a', true, january)).used, 1);
});

test('YDB conditional write admits exactly one request for the last slot', async () => {
  let used = 999;
  const calls = [];
  const store = createYdbQuotaStore({
    endpoint: 'https://docapi.serverless.yandexcloud.net/ru-central1/test/database', token: 'test-only-iam',
    fetcher: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-only-iam');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      calls.push(body);
      if (options.headers['X-Amz-Target'].endsWith('GetItem')) {
        assert.equal(body.ConsistentRead, true);
        return Response.json({ Item: { used: { N: String(used) } } });
      }
      assert.equal(body.ConditionExpression, 'attribute_not_exists(#used) OR #used < :limit');
      if (used >= Number(body.ExpressionAttributeValues[':limit'].N)) return Response.json({ __type: 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException' }, { status: 400 });
      used++;
      return Response.json({ Attributes: { used: { N: String(used) } } });
    },
  });
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => userQuota({ AI_QUOTA_STORE: store }, 'account', true)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason instanceof QuotaExceededError).length, 19);
  assert.equal(used, 1000);
  assert.ok(calls.every(call => call.Key.uid.S === 'account'));
});

test('Storage outage, corrupt counters and missing storage fail closed without revealing details', async () => {
  for (const env of [{}, { AI_QUOTA_STORE: { read: async () => -1, consume() {} } }, { AI_QUOTA_STORE: { read: async () => { throw new Error('private storage details'); }, consume() {} } }]) {
    await assert.rejects(userQuota(env, 'a'), error => error instanceof QuotaUnavailableError && !error.message.includes('private'));
  }
  const store = createYdbQuotaStore({ endpoint: 'https://docapi.serverless.yandexcloud.net/test', token: 'test', fetcher: async () => Response.json({ Attributes: {} }) });
  await assert.rejects(userQuota({ AI_QUOTA_STORE: store }, 'a', true), QuotaUnavailableError);
  assert.throws(() => createYdbQuotaStore({ endpoint: 'https://foreign.example', token: 'test' }));
});

test('Authenticated gateway enforces quotas before provider calls; ignores claimed UID/limit', async t => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'quota-test', alg: 'RS256', use: 'sig' };
  let modelCalls = 0, providerFails = false;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('googleapis.com')) return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'max-age=3600' } });
    assert.equal(String(url), 'https://blackroute.ironborn.cc/v1/chat/completions');
    modelCalls++;
    if (providerFails) return Response.json({ error: {} }, { status: 500 });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ advice: 'OK', proposedMeal: null }) } }] });
  });
  function token(uid) {
    const now = Math.floor(Date.now() / 1000);
    const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode({ sub: uid, aud: 'my-nutritionist-67ce8', iss: 'https://securetoken.google.com/my-nutritionist-67ce8', exp: now + 3600, iat: now, auth_time: now })}`;
    return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
  }
  const costRecords = [];
  let failCostStart = false;
  const env = { AI_PROVIDER: 'blackroute', BLACKROUTE_API_KEY: 'test-only', AI_QUOTA_STORE: {
    ...memoryStore(),
    async startCost(uid, id) { if (failCostStart) throw new Error('private'); costRecords.push({ uid, id, nanoUsd: 0, unknown: 1 }); },
    async finishCost(uid, id, nanoUsd, unknown) { Object.assign(costRecords.find(row => row.uid === uid && row.id === id), { nanoUsd, unknown }); },
    async readCosts(uid) { return costRecords.filter(row => row.uid === uid).map(row => ({ ...row, day: row.id.slice(5, 15) })); },
  }, AI_MONTHLY_REQUEST_LIMIT: '2' };
  const post = (uid, body, config = env) => worker.fetch(new Request('https://gateway/api/advice', {
    method: 'POST', headers: { Authorization: `Bearer ${token(uid)}`, 'Content-Type': 'application/json', Origin: 'https://nutriciolog-x20.website.yandexcloud.net' }, body: JSON.stringify(body),
  }), config);
  assert.equal((await post('a', { message: '' })).status, 400);
  assert.equal((await (await post('a', { action: 'usage' })).json()).quota.used, 0);
  const accepted = await Promise.all(Array.from({ length: 5 }, () => post('a', { message: 'Еда', uid: 'b', limit: 1000000 })));
  assert.equal(accepted.filter(r => r.status === 200).length, 2);
  assert.equal(accepted.filter(r => r.status === 429).length, 3);
  assert.equal(modelCalls, 2);
  const exhausted = accepted.find(r => r.status === 429);
  assert.equal(exhausted.headers.get('Cache-Control'), 'no-store');
  assert.equal(exhausted.headers.get('Access-Control-Allow-Origin'), 'https://nutriciolog-x20.website.yandexcloud.net');
  assert.equal((await exhausted.json()).quota.remaining, 0);
  assert.equal((await (await post('b', { action: 'usage' })).json()).quota.used, 0);
  const missing = await post('b', { message: 'Еда' }, { ...env, AI_QUOTA_STORE: undefined });
  assert.equal(missing.status, 503);
  assert.equal(modelCalls, 2);
  providerFails = true;
  const failed = await post('b', { message: 'Еда' });
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).quota.used, 1);
  assert.equal((await (await post('b', { action: 'usage' })).json()).quota.used, 1);
  const unauthenticated = await worker.fetch(new Request('https://gateway/api/advice', { method: 'POST', body: '{"action":"usage"}' }), env);
  assert.equal(unauthenticated.status, 401);
  assert.equal(costRecords.length, 3);
  assert.ok(costRecords.every(row => row.unknown === 1));
  const costs = (await (await post('b', { action: 'usage', uid: 'a' })).json()).costs;
  assert.equal(costs.totals.day.requests, 1, 'Only verified UID costs are returned');
  assert.equal(costs.totals.day.unknown, 1, 'Missing usage on provider failure remains unknown');
  failCostStart = true;
  const before = modelCalls;
  assert.equal((await post('c', { message: 'Еда' })).status, 503);
  assert.equal(modelCalls, before, 'No model call if cost reservation cannot be persisted');
});
