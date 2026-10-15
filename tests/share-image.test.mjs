import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initShareImage } from '../js/share-image.js';

function nativeShare(initial = {}) {
  let pending = initial;
  let listener;
  const images = [], errors = [];
  const plugin = {
    async addListener(event, callback) {
      assert.equal(event, 'imageAvailable');
      listener = callback;
    },
    async consumeImage() {
      const image = pending;
      pending = {};
      return image;
    },
  };
  return {
    images, errors,
    options: {
      capacitor: { Plugins: { NutritionShareImage: plugin } },
      onImage: file => images.push(file), onError: error => errors.push(error),
    },
    async share(image) { pending = image; await listener(); },
    async signal() { await listener(); },
  };
}
const screenshot = { mimeType: 'image/png', base64: btoa('screenshot bytes') };

test('cold launch consumes a shared screenshot as a file exactly once', async () => {
  const state = nativeShare(screenshot);
  await initShareImage(state.options);
  assert.equal(state.images.length, 1);
  const file = state.images[0];
  assert.equal(file.type, 'image/png');
  assert.equal(file.name, 'shared-image.png');
  assert.equal(await file.text(), 'screenshot bytes');
  await state.signal();
  assert.equal(state.images.length, 1);
  assert.deepEqual(state.errors, []);
});

test('running application receives new shares without reloading', async () => {
  const state = nativeShare();
  await initShareImage(state.options);
  assert.equal(state.images.length, 0);
  await state.share(screenshot);
  await state.share({ mimeType: 'image/jpeg', base64: btoa('jpeg') });
  assert.deepEqual(state.images.map(file => file.type), ['image/png', 'image/jpeg']);
});

test('permission, format and malformed data errors do not import images', async () => {
  const state = nativeShare({ error: 'Нет доступа к изображению' });
  await initShareImage(state.options);
  await state.share({ mimeType: 'text/html', base64: btoa('<html>') });
  await state.share({ mimeType: 'image/png', base64: '!!!' });
  assert.equal(state.images.length, 0);
  assert.equal(state.errors.length, 3);
  assert.match(state.errors[0], /Нет доступа/);
  assert.match(state.errors[1], /JPEG/);
});

test('ordinary browser needs no native sharing plugin', async () => {
  await initShareImage({ capacitor: {}, onImage() { assert.fail('Unexpected image'); }, onError() { assert.fail('Unexpected error'); } });
});

test('Android share target is registered; app automatically recognizes the received image', () => {
  const root = new URL('../', import.meta.url);
  const manifest = readFileSync(new URL('android/app/src/main/AndroidManifest.xml', root), 'utf8');
  assert.match(manifest, /android.intent.action.SEND/);
  assert.match(manifest, /android:mimeType="image\/\*"/);
  const main = readFileSync(new URL('android/app/src/main/java/ru/phazz/nutriciolog/MainActivity.java', root), 'utf8');
  assert.match(main, /registerPlugin\(ShareImagePlugin.class\)/);
  const app = readFileSync(new URL('js/app.js', root), 'utf8');
  const binding = app.slice(app.indexOf('void initShareImage('), app.indexOf('void initShareImage(') + 320);
  assert.match(binding, /showScreen\("assistant"\)/);
  assert.match(binding, /await selectPhoto\(file\)/);
  assert.match(binding, /await requestAdvice\(\)/);
});
