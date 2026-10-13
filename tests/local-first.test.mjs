import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = fs.readFileSync(new URL('../firebase-client.js', import.meta.url), 'utf8');
const body = source.slice(0, source.search(/\r?\ninitFirebase\(\);/));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const plain = value => JSON.parse(JSON.stringify(value));
function setup() {
  const storage = {};
  Object.defineProperties(storage, {
    getItem: { value: name => storage[name] ?? null },
    setItem: { value: (name, value) => { storage[name] = value; } },
    removeItem: { value: name => { delete storage[name]; } },
    key: { value: index => Object.keys(storage)[index] },
    length: { get: () => Object.keys(storage).length },
  });
  const events = [];
  const elements = new Map();
  const window = { dispatchEvent: event => { events.push(event); }, addEventListener() {} };
  const context = vm.createContext({
    window, localStorage: storage, navigator: { onLine: true }, crypto: { randomUUID },
    document: { getElementById: id => elements.get(id), querySelector: () => ({ prepend: node => elements.set(node.id, node) }), createElement: () => ({ setAttribute() {} }) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    Event: class { constructor(type) { this.type = type; } }, setTimeout, clearTimeout, console,
  });
  vm.runInContext(body.replace('const AUTH_WAIT_MS = 15000;', 'const AUTH_WAIT_MS = 40;') + ';updateStatus=()=>{};user={uid:"A"};db={};authState="ready";', context);
  window.__firestore = {
    collection: (...parts) => parts, doc: (...parts) => parts,
    where: (...parts) => parts, query: (reference, ...filters) => ({ reference, filters }),
    getDocs: async () => ({ docs: [] }), getDoc: async () => ({ exists: () => false }),
  };
  return { context, storage, events, elements, store: window.nutritionStore, sdk: window.__firestore };
}
const meal = { id: 'meal', title: 'Суп', date: '2026-10-12', calories: 200 };

test('unchanged display data with server timestamps does not emit repeated updates', async () => {
  const h = setup();
  let timestamp = 0;
  h.sdk.getDocs = async () => ({ docs: [{ id: meal.id, data: () => ({ ...meal, updatedAt: ++timestamp }) }] });
  await h.store.loadDiaryEntries(meal.date);
  h.events.length = 0;
  await h.store.loadDiaryEntries(meal.date); await tick();
  await h.store.loadDiaryEntries(meal.date); await tick();
  assert.equal(h.events.filter(event => event.type === 'nutrition-data-updated').length, 0);
});

test('read started during a write cannot erase the meal after acknowledgement removes outbox', async () => {
  const h = setup();
  let acknowledge, finishRead;
  h.sdk.setDoc = () => new Promise(resolve => { acknowledge = resolve; });
  h.sdk.serverTimestamp = () => 0;
  const saving = h.store.saveDiaryEntry(meal);
  await tick();
  h.sdk.getDocs = () => new Promise(resolve => { finishRead = resolve; });
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), [meal]);
  await tick();
  acknowledge(); await saving;
  assert.equal(vm.runInContext('pendingWrites().length', h.context), 0);
  finishRead({ docs: [] }); await tick();
  const cached = JSON.parse(h.storage.getItem('my-nutritionist:account:A:read:foodDiary:'+meal.date+':v1:'));
  assert.deepEqual(cached.data, [meal]);
});

test('server data is cached; subsequent startup reads locally before a delayed server and retains it on failure', async () => {
  const h = setup();
  h.sdk.getDocs = async () => ({ docs: [{ id: meal.id, data: () => meal }] });
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), [meal]);
  let reject;
  h.sdk.getDocs = () => new Promise((_, fail) => { reject = fail; });
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), [meal]);
  await tick();
  reject(Object.assign(new Error('offline'), { code: 'unavailable' }));
  await tick();
  assert.equal(h.elements.get('dataNetworkNotice').hidden, false);
  h.sdk.getDocs = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), [meal]);
  await tick();
});

test('read preview works before SDK/session restoration without granting authenticated writes', async () => {
  const h = setup();
  h.sdk.getDocs = async () => ({ docs: [{ id: meal.id, data: () => meal }] });
  await h.store.loadDiaryEntries(meal.date);
  h.storage.setItem('my-nutritionist:account:display-owner:v1:', 'A');
  vm.runInContext('user=null;authState="error";', h.context);
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), [meal]);
  assert.equal(h.store.getAccountProfileDefaults().uid, '');
  await assert.rejects(h.store.saveDiaryEntry({ ...meal, id: 'new' }));
  await tick();
});

test('cache is isolated by account/date; late reads and server failures cannot replace another account', async () => {
  const h = setup();
  h.sdk.getDocs = async () => ({ docs: [{ id: meal.id, data: () => meal }] });
  await h.store.loadDiaryEntries(meal.date);
  let finish;
  h.sdk.getDocs = () => new Promise(resolve => { finish = resolve; });
  await h.store.loadDiaryEntries(meal.date);
  await tick();
  vm.runInContext('user={uid:"B"};profileGeneration++;', h.context);
  finish({ docs: [{ id: 'late', data: () => ({ ...meal, id: 'late' }) }] });
  await tick();
  h.sdk.getDocs = async () => ({ docs: [] });
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), []);
  vm.runInContext('user={uid:"A"};profileGeneration++;', h.context);
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), [meal]);
  assert.deepEqual(plain(await h.store.loadDiaryEntries('2026-10-11')), []);
});

test('successful background refresh emits update, clears network notice, and caches authoritative empty data', async () => {
  const h = setup();
  h.sdk.getDocs = async () => ({ docs: [{ id: meal.id, data: () => meal }] });
  await h.store.loadDiaryEntries(meal.date);
  h.sdk.getDocs = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  await h.store.loadDiaryEntries(meal.date); await tick();
  h.sdk.getDocs = async () => ({ docs: [] });
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), [meal]);
  await tick();
  assert.equal(h.elements.get('dataNetworkNotice').hidden, true);
  assert.ok(h.events.some(event => event.type === 'nutrition-data-updated'));
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), []);
});

test('water, weights and products are local-first; successful local writes remain after outbox acknowledgement', async () => {
  const h = setup();
  h.sdk.getDoc = async () => ({ exists: () => true, data: () => ({ date: meal.date, glasses: 4 }) });
  assert.equal((await h.store.loadWaterLog(meal.date)).glasses, 4);
  h.sdk.getDocs = async parts => ({ docs: [{ id: 'x', data: () => parts[3] === 'products' ? { title: 'Яблоко', calories: 50 } : { date: meal.date, weight: 85 } }] });
  await h.store.listProducts(); await h.store.loadWeightEntries();
  h.sdk.getDoc = h.sdk.getDocs = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  assert.equal((await h.store.loadWaterLog(meal.date)).glasses, 4);
  assert.equal((await h.store.listProducts())[0].title, 'Яблоко');
  assert.equal((await h.store.loadWeightEntries())[0].weight, 85);
  await tick();
  h.sdk.setDoc = async () => {}; h.sdk.serverTimestamp = () => 0;
  await h.store.saveDiaryEntry(meal);
  assert.equal(vm.runInContext('pendingWrites().length', h.context), 0);
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), [meal]);
  await tick();
});

test('stalled server times out and a later retry can recover without restarting', async () => {
  const h = setup();
  h.sdk.getDocs = () => new Promise(() => {});
  await assert.rejects(h.store.loadDiaryEntries(meal.date), /unavailable/);
  assert.equal(h.elements.get('dataNetworkNotice').hidden, false);
  h.sdk.getDocs = async () => ({ docs: [{ id: meal.id, data: () => meal }] });
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), [meal]);
  assert.equal(h.elements.get('dataNetworkNotice').hidden, true);
});

test('Firestore empty local snapshot cannot erase the durable diary; authoritative server reads are preferred', async () => {
  const h = setup();
  h.sdk.getDocs = async () => ({ docs: [{ id: meal.id, data: () => meal }] });
  await h.store.loadDiaryEntries(meal.date);
  h.sdk.getDocs = async () => ({ docs: [], metadata: { fromCache: true } });
  await h.store.loadDiaryEntries(meal.date); await tick();
  assert.deepEqual(plain(await h.store.loadDiaryEntries(meal.date)), [meal]);
  await tick();
  assert.equal(h.elements.get('dataNetworkNotice').hidden, false);
  let usedServer = false;
  h.sdk.getDocsFromServer = async () => { usedServer=true; return { docs:[{id:meal.id,data:()=>({...meal,calories:250})}], metadata:{fromCache:false} }; };
  await h.store.loadDiaryEntries(meal.date); await tick();
  assert.equal(usedServer,true);
  assert.equal((await h.store.loadDiaryEntries(meal.date))[0].calories,250);
  await tick();
});
