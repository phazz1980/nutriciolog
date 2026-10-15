import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createUpdateController, initAndroidUpdate } from '../js/android-update.js';

const response = (patch = {}) => ({ currentVersion: '0.4.13', currentCode: 28, version: '0.4.14', versionCode: 29, available: true, ...patch });

test('update checks compare native versionCode, never download or install automatically', async () => {
  let downloads = 0;
  let result = response();
  const control = createUpdateController({ plugin: { checkUpdate: async () => result, openUpdate: async () => { downloads++; } } });
  await control.check();
  assert.equal(control.status().release.version, '0.4.14');
  assert.equal(downloads, 0);
  await control.download();
  assert.equal(downloads, 1);
  for (const code of [28, 27]) {
    result = response({ versionCode: code });
    await control.check(true);
    assert.equal(control.status().release, null);
    await control.download();
    assert.equal(downloads, 1);
  }
});

test('concurrent checks share one request; manual check bypasses the six-hour interval', async () => {
  let clock = 0, calls = 0, release;
  const control = createUpdateController({ now: () => clock, plugin: { checkUpdate() { calls++; return new Promise(resolve => { release = resolve; }); } } });
  const first = control.check();
  assert.equal(control.check(true), first);
  await Promise.resolve();
  release(response());
  await first;
  await control.check();
  assert.equal(calls, 1);
  clock = 6 * 60 * 60 * 1000;
  const second = control.check();
  await Promise.resolve();
  release(response());
  await second;
  const manual = control.check(true);
  await Promise.resolve();
  release(response());
  await manual;
  assert.equal(calls, 3);
});

test('offline and invalid responses preserve a known update; retry and failed download remain available', async () => {
  let fail = true, result = response(), downloads = 0;
  const control = createUpdateController({ plugin: {
    async checkUpdate() { if (fail) throw new Error('offline'); return result; },
    async openUpdate() { downloads++; throw new Error('No browser'); }
  } });
  await control.check();
  assert.equal(control.status().release, null);
  assert.equal(control.status().checking, false);
  fail = false;
  await control.check(); // Failed attempts do not throttle the next online retry.
  assert.equal(control.status().release.version, '0.4.14');
  result = response({ version: '<img src=x>', versionCode: '29' });
  await control.check(true);
  assert.equal(control.status().release.version, '0.4.14');
  assert.match(control.status().message, /Не удалось/);
  await control.download();
  await control.download();
  assert.equal(downloads, 2);
  assert.equal(control.status().opening, false);
});

test('current and incompatible Android versions do not show an update notification', async () => {
  for (const result of [response({ available: false }), response({ available: false, requiresNewerAndroid: true })]) {
    const control = createUpdateController({ plugin: { checkUpdate: async () => result } });
    await control.check();
    assert.equal(control.status().release, null);
    assert.ok(control.status().message);
  }
});

test('ordinary browser never reads Android metadata or mounts native controls', () => {
  initAndroidUpdate({ win: { Capacitor: { getPlatform: () => 'web' } }, doc: { getElementById: () => null, querySelector: () => null } });
});

test('published APK registry matches a real download and is deployed after APKs without caching', async () => {
  const root = new URL('../', import.meta.url);
  const source = file => readFile(new URL(file, root), 'utf8');
  const release = JSON.parse(await source('android-release.json'));
  assert.equal(release.appId, 'ru.phazz.nutriciolog');
  assert.match(release.version, /^[0-9]+[.][0-9]+[.][0-9]+$/);
  assert.ok(Number.isSafeInteger(release.versionCode) && release.versionCode > 0);
  assert.ok(Number.isSafeInteger(release.minSdkVersion) && release.minSdkVersion >= 26);
  assert.equal(release.url, 'https://nutriciolog-x20.website.yandexcloud.net/downloads/nutriciolog-' + release.version + '.apk');
  const bytes = await readFile(new URL('downloads/nutriciolog-' + release.version + '.apk', root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), release.sha256);
  assert.ok((await source('index.html')).includes(release.url));
  const workflow = await source('.github/workflows/deploy-yandex.yml');
  assert.ok(workflow.includes('--exclude "android-release.json"'));
  assert.ok(workflow.indexOf('aws s3 cp android-release.json') > workflow.indexOf('aws s3 sync deploy/'));
  assert.ok(workflow.includes('--cache-control="no-store"'));
  assert.ok(!(await source('service-worker.js')).includes('"./android-release.json"'));
  assert.ok(!(await source('scripts/build-android-web.mjs')).includes('"android-release.json"'));
});
