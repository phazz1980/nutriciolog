import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = file => readFile(new URL(file, root), 'utf8');

test('Web and Android versions agree in the shared source', async () => {
  const core = await source('js/core.js');
  const gradle = await source('android/app/build.gradle');
  assert.equal(core.match(/APP_VERSION = "v([^"]+)"/)[1], gradle.match(/versionName "([^"]+)"/)[1]);
});

test('Every relative client module import exists and named exports match', async () => {
  for (const file of await readdir(new URL('js/', root))) {
    if (!file.endsWith('.js')) continue;
    const code = await source('js/' + file);
    for (const match of code.matchAll(/import\s+(?:\{([^}]+)\}\s+from\s+)?["'](\.\/[\w./-]+\.js)(?:\?[^"']*)?["']/g)) {
      const target = await source('js/' + match[2].slice(2));
      for (const item of (match[1] || '').split(',').filter(item => item.trim())) {
        const name = item.trim().split(/\s+as\s+/)[0];
        assert.ok(new RegExp('export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+' + name + '\\b').test(target), file + ': missing export ' + name);
      }
    }
  }
});

test('PWA shell references existing files and does not cache health/user data or announcements', async () => {
  const sw = await source('service-worker.js');
  const shell = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];'));
  for (const match of shell.matchAll(/"\.\/([^"?]+)(?:\?[^" ]+)?"/g)) await source(match[1]);
  assert.ok(!shell.includes('ai-status.json'));
  assert.ok(!shell.includes('foodDiary'));
});

test('Android assets are generated from the same Web source, not a separate client tree', async () => {
  for (const file of ['index.html','styles.css','firebase-client.js','ai-status.json',...(await readdir(new URL('js/',root))).filter(name=>name.endsWith('.js')).map(name=>'js/'+name)]) {
    assert.equal(await source('www/'+file), await source(file), 'Generated bundle differs: '+file);
  }
});
