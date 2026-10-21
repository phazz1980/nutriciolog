import test from 'node:test';
import assert from 'node:assert/strict';
import { AiQuotaObject, createCloudflareQuotaStore } from '../worker/src/quota-cloudflare.js';
import { createRemoteQuotaStore, sharedQuotaRequest, SHARED_QUOTA_ENDPOINT } from '../worker/src/quota-remote.js';
import worker from '../worker/src/cloudflare.js';
import { userQuota, QuotaExceededError, QuotaUnavailableError } from '../worker/src/quota.js';
import { readCosts } from '../worker/src/costs.js';

function namespace() {
  const objects = new Map();
  return { idFromName: uid => uid, get(uid) {
    if (!objects.has(uid)) {
      const values = new Map();
      let tail = Promise.resolve();
      const storage = {
        async get(key) { return values.get(key); },
        async put(key, value) { values.set(key, value); },
        async list({ start, startAfter, end, limit }) {
          return new Map([...values].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) =>
            (!start || key >= start) && (!startAfter || key > startAfter) && key < end).slice(0, limit));
        },
        transaction(callback) {
          const result = tail.then(() => callback(storage));
          tail = result.catch(() => {}); return result;
        },
      };
      const object = new AiQuotaObject({ storage });
      objects.set(uid, { fetch: (url, options) => object.fetch(new Request(url, options)) });
    }
    return objects.get(uid);
  } };
}

const secret = 'unit-test-only-credential-not-a-live-secret';
function stores() {
  const local = createCloudflareQuotaStore(namespace());
  const env = { SHARED_QUOTA_SECRET: secret, SHARED_QUOTA_READY: 'true' };
  const remote = createRemoteQuotaStore({ endpoint: SHARED_QUOTA_ENDPOINT, secret,
    fetcher: (url, options) => sharedQuotaRequest(new Request(url, options), env, local) });
  return { local, remote, env };
}

test('Both gateways share one last slot; UID isolation and month rollover', async () => {
  const { local, remote } = stores();
  const now = new Date('2026-10-11T00:00:00Z');
  for (let i = 0; i < 999; i++) await local.consume('a', '2026-10', 1000);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
    userQuota({ AI_QUOTA_STORE: index % 2 ? remote : local }, 'a', true, now)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.reason instanceof QuotaExceededError).length, 19);
  assert.equal(await remote.read('a', '2026-10'), 1000);
  assert.equal(await local.read('b', '2026-10'), 0);
  assert.equal(await remote.read('a', '2026-11'), 0);
});

test('Shared cost history combines both gateways; incomplete records and settlement are preserved', async () => {
  const { local, remote } = stores();
  const id = 'cost:2026-10-11:00000000-0000-4000-8000-000000000000';
  await remote.startCost('a', id);
  let costs = await readCosts({ AI_QUOTA_STORE: local }, 'a', new Date('2026-10-11'));
  assert.equal(costs.totals.month.unknown, 1);
  await remote.finishCost('a', id, 2000, 0);
  costs = await readCosts({ AI_QUOTA_STORE: local }, 'a', new Date('2026-10-11'));
  assert.equal(costs.totals.month.nanoUsd, 2000);
  assert.equal(costs.totals.month.unknown, 0);
  await assert.rejects(local.finishCost('a', id, 0, 0));
  assert.equal((await readCosts({ AI_QUOTA_STORE: remote }, 'b', new Date('2026-10-11'))).totals.month.requests, 0);
});

test('Server bridge denies Firebase/client tokens, missing credentials and preflight; no public CORS', async () => {
  const { local, env } = stores();
  for (const authorization of ['', 'Bearer firebase-client-token', 'Bearer wrong-secret']) {
    const response = await sharedQuotaRequest(new Request(SHARED_QUOTA_ENDPOINT, {
      method: 'POST', headers: { Authorization: authorization }, body: '{}',
    }), env, local);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal((await sharedQuotaRequest(new Request(SHARED_QUOTA_ENDPOINT, { method: 'OPTIONS' }), env, local)).status, 405);
});

test('Invalid shared configuration/outage fails closed; no local counter or YDB fallback', async () => {
  for (const endpoint of ['https://foreign.example', SHARED_QUOTA_ENDPOINT + '/redirect']) {
    assert.throws(() => createRemoteQuotaStore({ endpoint, secret }));
  }
  const remote = createRemoteQuotaStore({ endpoint: SHARED_QUOTA_ENDPOINT, secret,
    fetcher: async (url, options) => {
      assert.equal(options.redirect, 'error'); assert.ok(options.signal);
      return Response.json({}, { status: 503 });
    } });
  await assert.rejects(userQuota({ AI_QUOTA_STORE: remote }, 'a', true), QuotaUnavailableError);
  const { local, env } = stores();
  const response = await sharedQuotaRequest(new Request(SHARED_QUOTA_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${secret}` }, body: '{"uid":"a","operation":"consume","period":"2026-10","limit":1000}',
  }), { ...env, SHARED_QUOTA_READY: 'false' }, local);
  assert.equal(response.status, 503);
  assert.equal(await local.read('a', '2026-10'), 0);
});

test('Common store rejects changed limit and invalid operations', async () => {
  const { local, env } = stores();
  await assert.rejects(local.consume('a', '2026-10', 2000));
  await assert.rejects(local.read('a', '2026-99'));
  const response = await sharedQuotaRequest(new Request(SHARED_QUOTA_ENDPOINT, { method: 'POST',
    headers: { Authorization: `Bearer ${secret}` }, body: '{"uid":"a","operation":"delete"}',
  }), env, local);
  assert.equal(response.status, 400);
});

test('Worker staged configuration and public CORS/auth remain closed', async () => {
  const env = { QUOTA_OBJECTS: namespace(), AI_PROVIDER: 'blackroute' };
  const health = await worker.fetch(new Request('https://example.test/api/health'), env);
  assert.equal((await health.json()).quotaConfigured, false);
  const active = await worker.fetch(new Request('https://example.test/api/health'), { ...env, SHARED_QUOTA_READY: 'true' });
  assert.equal((await active.json()).quotaConfigured, true);
  const denied = await worker.fetch(new Request('https://example.test', { method: 'POST', body: '{}' }), env);
  assert.equal(denied.status, 401);
  const preflight = await worker.fetch(new Request('https://example.test', { method: 'OPTIONS', headers: { Origin: 'https://localhost' } }), env);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://localhost');
});


test('exempt account continues above 1000 in both gateways with one counted history', async () => {
  const {local,remote}=stores();
  const now=new Date('2026-10-16T00:00:00Z');
  for(let i=0;i<1000;i++)await local.consume('owner','2026-10',1000);
  const claims={email:'owner@example.com',email_verified:true}, admins='owner@example.com';
  const results=await Promise.all(Array.from({length:8},(_,i)=>userQuota({AI_QUOTA_STORE:i%2?remote:local,AI_ADMIN_EMAILS:admins},'owner',true,now,claims)));
  assert.ok(results.every(q=>q.unlimited===true && q.remaining>0));
  assert.equal(await remote.read('owner','2026-10'),1008);
  await assert.rejects(userQuota({AI_QUOTA_STORE:remote,AI_ADMIN_EMAILS:admins},'owner',true,now,{email:'another@example.com',email_verified:true}),QuotaExceededError);
  await assert.rejects(userQuota({AI_QUOTA_STORE:remote,AI_ADMIN_EMAILS:admins},'owner',true,now,{email:'owner@example.com'}),QuotaExceededError);
  const wrongEmail=await userQuota({AI_QUOTA_STORE:remote,AI_ADMIN_EMAILS:admins},'fresh',false,now,{email:'owner@example.com.other',email_verified:true});
  assert.equal(wrongEmail.limit,1000);
  assert.equal(wrongEmail.unlimited,undefined);
  await assert.rejects(userQuota({AI_ADMIN_EMAILS:admins},'owner',true,now,claims),QuotaUnavailableError);
});
