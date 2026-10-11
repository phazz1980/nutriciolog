import test from 'node:test';
import assert from 'node:assert/strict';

// Run only against the local Wrangler runtime, never the working gateway.
test('SQLite Durable Object: concurrent last slot, UID isolation and costs', { skip: process.env.QUOTA_RUNTIME_TEST !== '1' }, async () => {
  const url = 'http://127.0.0.1:8788/internal/quota';
  const uid = `runtime-test-${crypto.randomUUID()}`;
  async function call(operation, fields = {}) {
    const response = await fetch(url, { method: 'POST',
      headers: { Authorization: 'Bearer local-test-credential-only-not-production' },
      body: JSON.stringify({ uid, operation, ...fields }), signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200); return response.json();
  }
  const period = '2026-10';
  assert.equal(await call('consume', { period, limit: 3 }), 1);
  assert.equal(await call('consume', { period, limit: 3 }), 2);
  const results = await Promise.all(Array.from({ length: 20 }, () => call('consume', { period, limit: 3 })));
  assert.equal(results.filter(value => value === 3).length, 1);
  assert.equal(results.filter(value => value === null).length, 19);
  assert.equal(await call('read', { period }), 3);
  assert.equal(await call('read', { period: '2026-11' }), 0);
  const id = `cost:2026-10-11:${crypto.randomUUID()}`;
  await call('startCost', { id });
  let rows = await call('readCosts', { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(rows[0].unknown, 1);
  await call('finishCost', { id, nanoUsd: 2000, unknown: 0 });
  rows = await call('readCosts', { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(rows[0].nanoUsd, 2000);
  assert.equal(rows[0].unknown, 0);
  const other = await fetch(url, { method: 'POST',
    headers: { Authorization: 'Bearer local-test-credential-only-not-production' },
    body: JSON.stringify({ uid: `${uid}-other`, operation: 'read', period }),
  });
  assert.equal(await other.json(), 0);
});
