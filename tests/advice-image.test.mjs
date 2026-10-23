import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
function setup(ask = async () => ({ status: 'ok', data: { advice: 'Ответ' } })) {
  const node = () => ({ value: '', textContent: '', style: {}, dataset: {}, children: [], append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; } });
  const fields = Object.fromEntries(['question', 'photoPreview', 'mealPhoto', 'aiDebug'].map(id => [id, node()]));
  const send = node(), requests = [], bubbles = [], transfers = [];
  const context = vm.createContext({
    selectedPhoto: null, photoSelectionVersion: 0, photoPreparing: false, adviceSending: false,
    MAX_PHOTO_BYTES: 4 * 1024 * 1024,
    element: id => fields[id], document: { querySelector: () => send, createElement: node },
    availability: () => ({ busy: false }),
    preparePhoto: async file => ({ dataUrl: file.name, mimeType: 'image/jpeg' }),
    askAi: async request => { requests.push(request); return ask(request); },
    importMealJson: () => false, removeAiDiagnostic() {}, setText() {}, setAiDebug() {},
    appendBubble: (...args) => bubbles.push(args), createMealTimeline: () => ({}),
    openPhotoMealInAddForm: data => transfers.push(data), speak() {}, toast() {}, showScreen() {},
    showProductProposals() {}, showMealProposal() {}, showAiDiagnostic() {},
  });
  vm.runInContext(app.slice(app.indexOf('async function requestAdvice('), app.indexOf('/* ------------------------------------------------------------- AI: voice */')), context);
  vm.runInContext(app.slice(app.indexOf('function updateAdviceSubmitState('), app.indexOf('/* ------------------------------------------------------------- lifecycle */')), context);
  return { context, fields, send, requests, bubbles, transfers };
}

test('attachment removes the HTML text requirement; empty composer sends nothing', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html.match(/<input id="question"[^>]*>/)[0], /required/);
  const { context, requests } = setup();
  await context.requestAdvice();
  assert.equal(requests.length, 0);
});

test('image without caption sends a default prompt, previews and clears after success', async () => {
  const { context, fields, requests, transfers } = setup();
  await context.selectPhoto({ name: 'food.png', size: 100 });
  assert.equal(fields.photoPreview.children[0].src, 'food.png');
  await context.requestAdvice();
  assert.equal(requests.length, 1);
  assert.match(requests[0].message, /Определи блюдо/);
  assert.equal(requests[0].image.dataUrl, 'food.png');
  assert.equal(transfers.length, 1);
  assert.equal(context.selectedPhoto, null);
  assert.equal(fields.photoPreview.children.length, 0);
});

test('caption is preserved and image survives a failed request for retry', async () => {
  const { context, fields, requests, send } = setup(async () => { throw Error('offline'); });
  await context.selectPhoto({ name: 'food.png', size: 100 });
  fields.question.value = 'Что на тарелке?';
  await context.requestAdvice();
  assert.equal(requests[0].message, 'Что на тарелке?');
  assert.equal(context.selectedPhoto.dataUrl, 'food.png');
  assert.equal(send.disabled, false);
});

test('duplicate submit is blocked; successful old request keeps a newer attachment', async () => {
  let finish;
  const { context, requests } = setup(() => new Promise(resolve => { finish = resolve; }));
  await context.selectPhoto({ name: 'first.png', size: 100 });
  const pending = context.requestAdvice();
  await context.requestAdvice();
  assert.equal(requests.length, 1);
  await context.selectPhoto({ name: 'second.png', size: 100 });
  finish({ status: 'ok', data: { advice: 'Ответ' } });
  await pending;
  assert.equal(context.selectedPhoto.dataUrl, 'second.png');
});

test('cancel keeps attachment; removing during preparation prevents a late preview', async () => {
  const { context, fields, requests, send } = setup();
  await context.selectPhoto({ name: 'first.png', size: 100 });
  await context.selectPhoto(undefined);
  assert.equal(context.selectedPhoto.dataUrl, 'first.png');
  let finish;
  context.preparePhoto = () => new Promise(resolve => { finish = resolve; });
  const pending = context.selectPhoto({ name: 'second.png', size: 100 });
  assert.equal(send.disabled, true);
  await context.requestAdvice();
  assert.equal(requests.length, 0);
  context.removePhoto();
  finish({ dataUrl: 'second.png' });
  await pending;
  assert.equal(context.selectedPhoto, null);
  assert.equal(fields.photoPreview.children.length, 0);
  assert.equal(send.disabled, false);
});


test('shared image waits for the restored session, then opens meal recognition in order', async () => {
  const calls = [];
  let state = 'loading', notifyAuth;
  const context = vm.createContext({
    sharedImageQueue: Promise.resolve(), setTimeout, clearTimeout,
    getAuthStatus: () => ({ state }),
    onAuthStatus: handler => { notifyAuth = handler; return () => { notifyAuth = null; }; },
    showScreen: screen => calls.push(`screen:${screen}`),
    recognizeMealPhoto: async file => { calls.push(`recognize:${file.name}`); await new Promise(resolve => setImmediate(resolve)); calls.push(`done:${file.name}`); },
  });
  vm.runInContext(app.slice(app.indexOf('function waitForAuthReady('), app.indexOf('async function recognizeMealPhoto(')), context);
  const first = context.recognizeSharedImage({ name: 'first.png' });
  const second = context.recognizeSharedImage({ name: 'second.png' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['screen:today'], 'No request while the session is still loading');
  state = 'ready'; notifyAuth();
  await first; await second;
  assert.deepEqual(calls, ['screen:today', 'recognize:first.png', 'done:first.png', 'screen:today', 'recognize:second.png', 'done:second.png']);
  assert.equal(notifyAuth, null, 'Auth listener is removed');
});

test('shared image is never sent as an advice question', () => {
  const advice = app.slice(app.indexOf('async function requestAdvice('), app.indexOf('/* ------------------------------------------------------------- AI: voice */'));
  assert.doesNotMatch(advice, /shared/i);
  const recognize = app.slice(app.indexOf('function recognizeSharedImage('), app.indexOf('async function recognizeMealPhoto('));
  assert.match(recognize, /await waitForAuthReady\(\)/);
  assert.match(recognize, /await recognizeMealPhoto\(file\)/);
});
