import test from 'node:test';
import assert from 'node:assert/strict';
import { createPairingService, PairingError, normalizeCode } from '../pairing.mjs';
import { createHandler } from '../handler.mjs';

function fixture() {
  let clock = 1000000;
  let signingFails = false;
  const records = new Map();
  const limits = new Map();
  let queue = Promise.resolve();
  const serial = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const store = {
    async create(id, record) { assert.ok(!records.has(id)); records.set(id, record); },
    async read(id) { return records.get(id); },
    update: (id, fn) => serial(() => { records.set(id, fn(records.get(id))); }),
    limit: (key, max, now, period) => serial(() => {
      const id = `${key}:${Math.floor(now / period)}`;
      const count = limits.get(id) || 0;
      if (count >= max) throw new PairingError('rate_limited', 429);
      limits.set(id, count + 1);
    }),
  };
  const service = createPairingService({ store, now: () => clock,
    webAppUrl: 'https://example.com/',
    verifyIdToken: async token => { if (!['user-a', 'user-b'].includes(token)) throw new Error('revoked'); return { uid: token }; },
    mintToken: async uid => { if (signingFails) throw new Error('signing unavailable'); return `test-token-for-${uid}`; },
  });
  return { service, records, advance: ms => { clock += ms; }, failSigning: value => { signingFails = value; } };
}
const errorCode = code => error => error.code === code;

test('numeric codes preserve leading zeros and accept the display separator', () => {
  assert.equal(normalizeCode('0000-1234'), '00001234');
  assert.equal(normalizeCode('12345678'), '12345678');
  assert.equal(normalizeCode('ABCDE23456'), 'ABCDE23456', 'in-flight old sessions remain usable');
  for (const code of ['1234567', '123456789', '123a5678', 12345678]) {
    assert.throws(() => normalizeCode(code), errorCode('invalid_code'));
  }
});

test('phone approval uses verified UID and watch gets its own session', async () => {
  const { service, records } = fixture();
  const session = await service.start();
  assert.match(session.code, /^\d{8}$/);
  assert.equal(new URL(session.verificationUrl).hash, `#connect-watch=${session.code}`);
  assert.ok(!JSON.stringify([...records]).includes(session.deviceSecret));
  const inspected = await service.inspect({ code: session.code }, 'user-a');
  assert.equal(inspected.status, 'pending');
  assert.ok(!('deviceSecret' in inspected));
  await service.approve({ code: session.code, uid: 'attacker' }, 'user-a');
  assert.deepEqual(await service.poll(session), { status: 'approved', customToken: 'test-token-for-user-a' });
  assert.ok(!JSON.stringify([...records]).includes('test-token-for-user-a'));
});
test('missing, invalid and revoked phone credentials cannot approve', async () => {
  const { service } = fixture();
  const session = await service.start();
  for (const token of [undefined, '', 'revoked']) await assert.rejects(service.approve(session, token), errorCode('unauthorized'));
  assert.deepEqual(await service.poll(session), { status: 'pending' });
});
test('public code is insufficient to obtain or cancel a session', async () => {
  const { service } = fixture();
  const session = await service.start();
  await service.approve(session, 'user-a');
  for (const action of ['poll', 'cancel']) {
    await assert.rejects(service[action]({ code: session.code, deviceSecret: '0'.repeat(64) }), errorCode('invalid_session'));
    await assert.rejects(service[action]({ code: session.code }), errorCode('invalid_session'));
  }
  assert.equal((await service.poll(session)).customToken, 'test-token-for-user-a');
});
test('another phone cannot replace approval owner', async () => {
  const { service } = fixture(); const session = await service.start();
  await service.approve(session, 'user-a');
  await assert.rejects(service.approve(session, 'user-b'), errorCode('already_approved'));
  assert.equal((await service.poll(session)).customToken, 'test-token-for-user-a');
});
test('expiry blocks inspection, approval and redemption', async () => {
  const { service, advance } = fixture(); const session = await service.start();
  await service.approve(session, 'user-a'); advance(300000);
  for (const action of ['inspect', 'approve']) await assert.rejects(service[action](session, 'user-a'), errorCode('expired'));
  await assert.rejects(service.poll(session), errorCode('expired'));
});
test('concurrent watch requests return at most one token', async () => {
  const { service } = fixture(); const session = await service.start();
  await service.approve(session, 'user-a');
  const results = await Promise.allSettled([service.poll(session), service.poll(session)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  await assert.rejects(service.poll(session), errorCode('closed'));
});
test('cancellation blocks approved tokens', async () => {
  const { service } = fixture(); const session = await service.start();
  await service.approve(session, 'user-a'); await service.cancel(session);
  await assert.rejects(service.poll(session), errorCode('closed'));
});
test('signer failure preserves approval for retry', async () => {
  const { service, failSigning, advance } = fixture(); const session = await service.start();
  await service.approve(session, 'user-a'); failSigning(true);
  await assert.rejects(service.poll(session)); failSigning(false); advance(3000);
  assert.ok((await service.poll(session)).customToken);
});
test('polling is throttled without consuming approval', async () => {
  const { service, advance } = fixture(); const session = await service.start();
  await service.poll(session);
  await assert.rejects(service.poll(session), errorCode('slow_down'));
  advance(3000); assert.deepEqual(await service.poll(session), { status: 'pending' });
});
test('distributed creation cap and authenticated lookup cap', async () => {
  const { service } = fixture();
  const session = await service.start();
  for (let i = 1; i < 120; i++) await service.start();
  await assert.rejects(service.start(), errorCode('rate_limited'));
  for (let i = 0; i < 30; i++) await service.inspect(session, 'user-a');
  await assert.rejects(service.inspect(session, 'user-a'), errorCode('rate_limited'));
});
test('HTTP rejects untrusted origin, malformed input and large bodies', async () => {
  const { service } = fixture(); const handler = createHandler(service, new Set(['https://example.com']));
  const req = (body, origin = 'https://example.com', path = 'start') => new Request(`https://auth.example/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body,
  });
  assert.equal((await handler(req('{}', 'https://attacker.com'))).status, 403);
  assert.equal((await handler(req('{broken'))).status, 400);
  assert.equal((await handler(req('[]'))).status, 400);
  assert.equal((await handler(req(' '.repeat(4097)))).status, 413);
  assert.equal((await handler(req('{}', 'https://example.com', 'toString'))).status, 404);
  const preflight = await handler(new Request('https://auth.example/start', { method: 'OPTIONS', headers: { Origin: 'https://example.com' } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://example.com');
});
test('HTTP never returns raw signer errors or caches credentials', async () => {
  const { service, failSigning } = fixture(); const session = await service.start();
  await service.approve(session, 'user-a'); failSigning(true);
  const handler = createHandler(service, new Set(['https://example.com']));
  const response = await handler(new Request('https://auth.example/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(session) }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'service_unavailable' });
});
