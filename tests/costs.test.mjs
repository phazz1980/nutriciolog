import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateUsage, costPeriods, readCosts } from '../worker/src/costs.js';
import { createBlackrouteProvider } from '../worker/src/providers/blackroute.js';
import { createYdbQuotaStore } from '../worker/src/quota-ydb.js';

test('User rates reproduce the supplied examples; missing tokens are not free', () => {
  assert.equal(estimateUsage('deepseek-v3.2-maas', { prompt_tokens: 406, completion_tokens: 284 }), 422020);
  assert.equal(estimateUsage('gemini-2.5-flash', { prompt_tokens: 263, completion_tokens: 2044 }), 20768750);
  for (const usage of [undefined, {}, { prompt_tokens: null, completion_tokens: 1 }, { prompt_tokens: -1, completion_tokens: 1 }, { prompt_tokens: '406', completion_tokens: 284 }]) {
    assert.equal(estimateUsage('deepseek-v3.2-maas', usage), null);
  }
  assert.equal(estimateUsage('unknown', { prompt_tokens: 1, completion_tokens: 1 }), null);
  assert.equal(estimateUsage('deepseek-v3.2-maas', { prompt_tokens: 0, completion_tokens: 0 }), 0);
});

test('Calendar weeks start Monday, including year and month boundaries', async () => {
  assert.deepEqual(costPeriods(new Date('2027-01-03T23:59:59Z')), { day: '2027-01-03', week: '2026-12-28', month: '2027-01-01' });
  const costs = await readCosts({ AI_QUOTA_STORE: { readCosts: async (uid, start, end) => {
    assert.equal(uid, 'owner'); assert.equal(start, '2026-12-28'); assert.equal(end, '2027-01-03');
    return [{ day: '2026-12-31', nanoUsd: 100, unknown: 0 }, { day: '2027-01-02', nanoUsd: 200, unknown: 0 }, { day: '2027-01-03', nanoUsd: 0, unknown: 1 }];
  } } }, 'owner', new Date('2027-01-03T12:00:00Z'));
  assert.equal(costs.totals.day.nanoUsd, 0);
  assert.equal(costs.totals.day.unknown, 1);
  assert.equal(costs.totals.week.nanoUsd, 300);
  assert.equal(costs.totals.month.nanoUsd, 200);
  assert.equal((await readCosts({}, 'owner')).status, 'unavailable');
  assert.equal((await readCosts({ AI_QUOTA_STORE: { readCosts() { throw new Error('private'); } } }, 'owner')).status, 'unavailable');
});

test('Blackroute reports usage for both format attempts and for network errors', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ usage: { prompt_tokens: 10, completion_tokens: 20 }, choices: [{ message: { content: calls === 1 ? 'invalid' : '{"advice":"OK"}' } }] });
  });
  const usages = [];
  const result = await createBlackrouteProvider('test-only').advise('test', null, undefined, (model, usage) => usages.push(estimateUsage(model, usage)));
  assert.equal(result.advice, 'OK'); assert.deepEqual(usages, [24700, 24700]);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network'); });
  await assert.rejects(createBlackrouteProvider('test-only').advise('test', null, undefined, (model, usage) => usages.push(estimateUsage(model, usage))));
  assert.equal(usages.at(-1), null);
});

test('YDB records are isolated by UID, settled once, and read through every query page', async () => {
  const items = new Map();
  let queries = 0;
  const store = createYdbQuotaStore({ endpoint: 'https://docapi.serverless.yandexcloud.net/test', token: 'test', fetcher: async (_, options) => {
    const action = options.headers['X-Amz-Target'].split('.').at(-1), body = JSON.parse(options.body);
    if (action === 'PutItem') {
      const key = body.Item.uid.S + body.Item.period.S;
      if (items.has(key)) return Response.json({ __type: 'ConditionalCheckFailedException' }, { status: 400 });
      items.set(key, body.Item); return Response.json({});
    }
    if (action === 'UpdateItem') {
      const item = items.get(body.Key.uid.S + body.Key.period.S);
      if (!item.pending.BOOL) return Response.json({ __type: 'ConditionalCheckFailedException' }, { status: 400 });
      assert.equal(body.ConditionExpression, '#pending = :pending');
      item.nanoUsd = body.ExpressionAttributeValues[':nano']; item.unknown = body.ExpressionAttributeValues[':unknown']; item.pending = { BOOL: false };
      return Response.json({});
    }
    assert.equal(action, 'Query'); assert.equal(body.ConsistentRead, true);
    assert.equal(body.ExpressionAttributeValues[':uid'].S, 'a');
    queries++;
    if (!body.ExclusiveStartKey) return Response.json({ Items: [], LastEvaluatedKey: { uid: { S: 'a' }, period: { S: 'cursor' } } });
    return Response.json({ Items: [...items.values()].filter(item => item.uid.S === 'a') });
  } });
  const id = 'cost:2026-10-06:test';
  await Promise.all([store.startCost('a', id), store.startCost('b', id)]);
  await store.finishCost('a', id, 422020, 0);
  await assert.rejects(store.finishCost('a', id, 844040, 0));
  assert.deepEqual(await store.readCosts('a', '2026-10-01', '2026-10-06'), [{ day: '2026-10-06', nanoUsd: 422020, unknown: 0 }]);
  assert.equal(queries, 2);
});
