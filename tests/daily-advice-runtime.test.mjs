import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { nutritionTargets } from '../js/core.js';

const source = readFileSync(new URL('../js/daily-advice.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace(/export /g, '');
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(predicate) {
  for (let i = 0; i < 50; i++) { if (predicate()) return; await tick(); }
  assert.fail('Daily advice did not settle');
}
function fixture({ blockedStorage = false, fail = false, delayed = false, saved = new Map() } = {}) {
  const handlers = new Map();
  const retry = { hidden: true }, text = { textContent: '' };
  const card = { hidden: true, querySelector: () => null };
  let posts = 0, interval, uid = 'android-user', entries = [], resolve, date = '2026-10-15';
  let failing = fail;
  const context = {
    document: { getElementById: id => ({ dailyAdvice: card, dailyAdviceText: text, retryDailyAdvice: retry })[id] },
    todayKey: () => date, accountDefaults: () => ({ uid }), nutritionTargets,
    activeAnnouncement: () => null, refreshAnnouncement: async () => null,
    call: async name => name === 'loadDiaryEntries' ? entries : name === 'loadProfile' ? { calories: 1800 } : [],
    askAi: async () => {
      posts++;
      if (delayed) await new Promise(done => { resolve = done; });
      if (failing) throw new Error('Service unavailable');
      return { status: 'ok', data: { advice: 'Проверенный совет' } };
    },
    onAuthChanged: fn => handlers.set('auth', fn), onStoreReady: fn => handlers.set('ready', fn),
    navigator: { onLine: true }, localStorage: {
      getItem: key => { if (blockedStorage) throw new Error('Storage unavailable'); return saved.get(key) || null; },
      setItem: (key, value) => { if (blockedStorage) throw new Error('Storage full'); saved.set(key, value); }
    },
    window: { addEventListener: (event, fn) => handlers.set(event, fn), setInterval: fn => { interval = fn; } },
    TextEncoder, crypto: webcrypto,
  };
  vm.runInNewContext(source + '\ninitDailyAdvice();', context);
  return { retry, text, card, posts: () => posts, saved,
    emit: (event, detail) => handlers.get(event)?.({ detail }),
    timer: () => interval(), finish: () => resolve?.(), fail: value => { failing = value; },
    day: value => { date = value; interval(); },
    blockStorage: () => { blockedStorage = true; },
    entries: value => { entries = value; }, account: value => { uid = value; handlers.get('auth')?.(); },
  };
}

test('automatic advice reuses memory when Android local storage is unavailable', async () => {
  const ui = fixture();
  await until(() => ui.text.textContent === 'Проверенный совет');
  ui.blockStorage();
  for (let i = 0; i < 3; i++) { ui.timer(); ui.emit('focus'); await tick(); }
  assert.equal(ui.posts(), 1, 'unchanged menu must not consume more quota');
});

test('unchanged data events during a paid request do not discard its successful response', async () => {
  const ui = fixture({ delayed: true });
  await until(() => ui.posts() === 1);
  for (let i = 0; i < 4; i++) ui.emit('nutrition-data-updated', { uid: 'android-user', collection: 'products' });
  ui.finish();
  await tick(); await tick();
  assert.equal(ui.posts(), 1, 'same fingerprint must reuse the in-flight result');
  assert.equal(ui.text.textContent, 'Проверенный совет');
});

test('service failure does not retry on timers, focus or repeated data events; button retries once', async () => {
  const ui = fixture({ fail: true });
  await until(() => !ui.retry.hidden);
  for (let i = 0; i < 3; i++) {
    ui.timer(); ui.emit('focus');
    ui.emit('nutrition-data-updated', { uid: 'android-user', collection: 'products' });
    await tick();
  }
  assert.equal(ui.posts(), 1, 'failed AI attempts are charged and need an explicit retry');
  assert.equal(ui.retry.hidden, false);
  ui.fail(false);
  ui.retry.onclick();
  await until(() => ui.text.textContent === 'Проверенный совет');
  assert.equal(ui.posts(), 2);
});

test('real menu changes during a request produce one new advice and old context remains deduplicated', async () => {
  const ui = fixture({ delayed: true });
  await until(() => ui.posts() === 1);
  ui.entries([{ title: 'Суп', calories: 300, protein: 10, fat: 10, carbs: 40 }]);
  ui.emit('nutrition-data-updated', { uid: 'android-user', collection: 'foodDiary', scope: '2026-10-15' });
  ui.finish();
  await until(() => ui.posts() === 2);
  ui.finish();
  await until(() => ui.text.textContent === 'Проверенный совет');
  ui.entries([]);
  ui.emit('nutrition-data-updated', { uid: 'android-user', collection: 'foodDiary', scope: '2026-10-15' });
  await tick(); await tick();
  assert.equal(ui.posts(), 2, 'a previously answered context does not need another paid request');
});

test('account change never displays or stores a previous account delayed response', async () => {
  const ui = fixture({ delayed: true });
  await until(() => ui.posts() === 1);
  ui.account(null);
  ui.finish();
  await tick(); await tick();
  assert.equal(ui.card.hidden, true);
  assert.ok([...ui.saved.values()].every(value => !JSON.parse(value).advice));
});


test('automatic advice stops at four attempts per local day and survives restarts', async () => {
  const saved = new Map();
  const ui = fixture({ saved });
  await until(() => ui.text.textContent === 'Проверенный совет');
  for (let i = 1; i < 4; i++) {
    ui.entries([{ title: 'Блюдо ' + i, calories: i * 100 }]);
    ui.emit('nutrition-data-updated', { uid: 'android-user', collection: 'foodDiary', scope: '2026-10-15' });
    await until(() => ui.posts() === i + 1 && ui.text.textContent === 'Проверенный совет');
  }
  ui.entries([{ title: 'Пятый контекст', calories: 500 }]);
  ui.emit('nutrition-data-updated', { uid: 'android-user', collection: 'foodDiary', scope: '2026-10-15' });
  await until(() => ui.text.textContent.includes('все 4'));
  ui.retry.onclick();
  await tick();
  assert.equal(ui.posts(), 4);
  const restarted = fixture({ saved });
  restarted.entries([{ title: 'Другой контекст после перезапуска', calories: 700 }]);
  await until(() => restarted.text.textContent.includes('все 4'));
  assert.equal(restarted.posts(), 0);
});

test('four failed manual retries exhaust the advice cap; missing storage fails closed', async () => {
  const ui = fixture({ fail: true });
  await until(() => !ui.retry.hidden);
  for (let i = 0; i < 3; i++) { ui.retry.onclick(); await tick(); }
  assert.equal(ui.posts(), 4);
  ui.retry.onclick();
  await until(() => ui.text.textContent.includes('все 4'));
  assert.equal(ui.posts(), 4);
  assert.equal(ui.retry.hidden, true);
  const unavailable = fixture({ blockedStorage: true });
  await until(() => unavailable.text.textContent.includes('счётчик'));
  assert.equal(unavailable.posts(), 0);
});


test('daily limit resets for a new local day and stays isolated between accounts', async () => {
  const saved = new Map([['my-nutritionist:account:android-user:daily-advice:2026-10-15:attempts', '{"count":4}']]);
  const ui = fixture({ saved });
  await until(() => ui.text.textContent.includes('все 4'));
  assert.equal(ui.posts(), 0);
  ui.day('2026-10-16');
  await until(() => ui.posts() === 1 && ui.text.textContent === 'Проверенный совет');
  ui.account('other-user');
  await until(() => ui.posts() === 2 && ui.text.textContent === 'Проверенный совет');
  assert.equal(JSON.parse(saved.get('my-nutritionist:account:android-user:daily-advice:2026-10-15:attempts')).count, 4);
});

test('restart after an unsuccessful attempt does not silently send the same context again', async () => {
  const saved = new Map();
  const failed = fixture({ saved, fail: true });
  await until(() => !failed.retry.hidden);
  const restarted = fixture({ saved });
  await until(() => !restarted.retry.hidden);
  assert.equal(restarted.posts(), 0);
  restarted.retry.onclick();
  await until(() => restarted.posts() === 1 && restarted.text.textContent === 'Проверенный совет');
});
