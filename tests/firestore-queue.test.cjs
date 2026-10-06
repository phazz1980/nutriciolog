const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const sdk = require('firebase/firestore');

// Execute the production store with the real Firestore SDK. Only Auth/DOM are
// supplied by the harness; the database transport and rules are not mocked.
function startClient(db, storage, online) {
  const events = new EventTarget();

  const status = { textContent: '' };
  const window = {
    __firestore: { ...sdk, setDoc: (ref, value, options) => sdk.setDoc(ref, { ...value }, options) },
    dispatchEvent: event => events.dispatchEvent(event),
    addEventListener: (...args) => events.addEventListener(...args),
    removeEventListener: (...args) => events.removeEventListener(...args),
  };
  const context = vm.createContext({
    window, document: { getElementById: id => id === 'firebaseStatus' ? status : null },
    navigator: { onLine: online }, localStorage: storage,
    Event, CustomEvent, crypto, setTimeout, clearTimeout, console, testDb: db,
  });
  const source = readFileSync('firebase-client.js', 'utf8').replace(/\r\n/g, '\n');
  assert.equal(source.split('\ninitFirebase();\n').length, 2, 'Only bypass Firebase Auth bootstrap');
  vm.runInContext(source.replace('\ninitFirebase();\n', '\n'), context);
  vm.runInContext("db = testDb; user = {uid:'queue-owner'}; authState = 'ready';", context);
  return { window, context, status };
}
function localStorage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    key: index => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
}
async function promptly(promise, timeout = 2000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Offline operation waited for the server')), timeout); })]); }
  finally { clearTimeout(timer); }
}
async function eventually(check) {
  const deadline = Date.now() + 15000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Queue did not synchronize');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

test('Real SDK: offline save survives client restart, synchronizes and supports offline deletion', async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run npm run test:rules');
  const env = await initializeTestEnvironment({ projectId: 'demo-x20-rules', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  const db = env.authenticatedContext('queue-owner').firestore();
  const storage = localStorage();
  const pendingKey = 'my-nutritionist:account:queue-owner:pending-writes:v1:';
  const entry = { id: 'offline-restart', date: '2026-10-06', mealType: 'Перекус', title: 'SDK queue test', portion: 1, portionUnit: 'г', unitWeight: null, calories: 0, protein: 0, fat: 0, carbs: 0, source: 'manual' };
  try {
    await sdk.disableNetwork(db);
    const misleadingOnline = startClient(db, storage, true);
    const inFlight = misleadingOnline.window.nutritionStore.saveDiaryEntry({ ...entry, id: 'online-but-disconnected' });
    await eventually(() => JSON.parse(storage.getItem(pendingKey) || '[]').length === 1);
    assert.equal((await promptly(inFlight, 7000)).mode, 'queued');
    const reloaded = startClient(db, storage, false);
    assert.equal((await promptly(reloaded.window.nutritionStore.loadDiaryEntries(entry.date))).some(item => item.id === 'online-but-disconnected'), true);
    await sdk.enableNetwork(db);
    await eventually(() => storage.getItem(pendingKey) === null);
    assert.equal((await sdk.getDocFromServer(sdk.doc(db, 'users/queue-owner/foodDiary', 'online-but-disconnected'))).data().title, entry.title);
    await sdk.deleteDoc(sdk.doc(db, 'users/queue-owner/foodDiary', 'online-but-disconnected'));
    await sdk.disableNetwork(db);
    const first = startClient(db, storage, false);
    assert.equal((await promptly(first.window.nutritionStore.saveDiaryEntry(entry))).mode, 'queued');
    assert.equal(JSON.parse(storage.getItem(pendingKey)).length, 1);
    // New JS context represents a reload with the same persistent storage.
    const restarted = startClient(db, storage, false);
    const visible = await promptly(restarted.window.nutritionStore.loadDiaryEntries(entry.date));
    assert.equal(visible.find(item => item.id === entry.id).title, entry.title);
    await sdk.enableNetwork(db);
    vm.runInContext('navigator.onLine = true;', restarted.context);
    restarted.window.dispatchEvent(new Event('online'));
    await eventually(() => storage.getItem(pendingKey) === null);
    const ref = sdk.doc(db, 'users/queue-owner/foodDiary', entry.id);
    assert.equal((await sdk.getDocFromServer(ref)).data().title, entry.title);
    await sdk.disableNetwork(db);
    vm.runInContext('navigator.onLine = false;', restarted.context);
    assert.equal((await promptly(restarted.window.nutritionStore.deleteDiaryEntry(entry.id))).mode, 'queued');
    const afterDelete = startClient(db, storage, false);
    assert.equal((await promptly(afterDelete.window.nutritionStore.loadDiaryEntries(entry.date))).some(item => item.id === entry.id), false);
    await sdk.enableNetwork(db);
    vm.runInContext('navigator.onLine = true;', afterDelete.context);
    afterDelete.window.dispatchEvent(new Event('online'));
    await eventually(() => storage.getItem(pendingKey) === null);
    assert.equal((await sdk.getDocFromServer(ref)).exists(), false);
  } catch (error) { console.error(error); throw error; } finally { await sdk.terminate(db._delegate); await env.cleanup(); }
});
