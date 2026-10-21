import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = file => readFile(new URL(file, root), 'utf8');

async function shellEntries() {
  const sw = await source('service-worker.js');
  const shell = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];'));
  return new Set([...shell.matchAll(/"\.\/([^"]*)"/g)].map(match => match[1]));
}

// The SHELL list is maintained by hand; these checks keep it in step with the code.
test('Service Worker caches every client module and every versioned import', async () => {
  const shell = await shellEntries();
  const modules = (await readdir(new URL('js/', root))).filter(name => name.endsWith('.js')).map(name => `js/${name}`);
  for (const file of modules) assert.ok(shell.has(file), `Missing from SHELL: ${file}`);
  for (const file of ['index.html', 'styles.css', 'firebase-client.js', 'pwa.js', 'manifest.webmanifest']) {
    assert.ok(shell.has(file), `Missing from SHELL: ${file}`);
  }
  const referenced = new Set();
  for (const file of ['index.html', 'firebase-client.js', ...modules]) {
    const text = await source(file);
    for (const match of text.matchAll(/(?:from\s*|import\(\s*|src=)["']\.{0,2}\/?((?:js\/)?[\w.-]+\.js\?[^"']*)["']/g)) {
      referenced.add(file.startsWith('js/') && !match[1].startsWith('js/') ? `js/${match[1]}` : match[1]);
    }
  }
  for (const file of referenced) assert.ok(shell.has(file), `Versioned import missing from SHELL: ${file}`);
});

test('Browser Firebase SDK matches the version used by emulator tests', async () => {
  const { devDependencies } = JSON.parse(await source('package.json'));
  const version = devDependencies.firebase;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const file of ['firebase-client.js', 'index.html', 'service-worker.js']) {
    const versions = new Set([...(await source(file)).matchAll(/gstatic\.com\/firebasejs\/([\d.]+)\//g)].map(match => match[1]));
    assert.deepEqual([...versions], [version], `${file} must load Firebase ${version}`);
  }
});
