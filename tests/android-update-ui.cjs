const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:43210';

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 850 } });
      await context.route(origin + '/**', route => {
        const file = new URL(route.request().url()).pathname.slice(1) || 'index.html';
        if (file === 'index.html') {
          // Real markup/styles, isolated from Firebase and unrelated app initialization.
          let html = fs.readFileSync(path.join(root, file), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
          html = html.replace('</body>', '<script type="module" src="./js/android-update.js"></script></body>');
          return route.fulfill({ contentType: 'text/html', body: html });
        }
        const target = path.resolve(root, file);
        if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'image/svg+xml', body: fs.readFileSync(target) });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        window.updateTest = { available: true, version: '0.4.14', code: 29, calls: 0, opens: 0, offline: false };
        window.Capacitor = { getPlatform: () => 'android', Plugins: { NutritionAppUpdate: {
          getVersion: async () => ({ currentVersion: '0.4.13' }),
          addListener: async (event, callback) => { window.updateTest.resume = callback; },
          checkUpdate: async () => {
            const test = window.updateTest;
            test.calls++;
            if (test.offline) throw Error('offline');
            return { available: test.available, version: test.version, versionCode: test.code, currentVersion: '0.4.13', currentCode: 28 };
          },
          openUpdate: async () => { window.updateTest.opens++; }
        } } };
      });
      await page.goto(origin);
      await page.evaluate(() => {
        document.querySelectorAll('.screen').forEach(node => node.classList.remove('active'));
        document.getElementById('profile').classList.add('active');
      });
      await page.locator('#androidUpdateNotice').waitFor({ state: 'visible' });
      assert.match(await page.locator('#androidUpdateNotice').textContent(), /0.4.14/);
      assert.match(await page.locator('#androidInstalledVersion').textContent(), /0.4.13/);
      assert.equal(await page.evaluate(() => window.updateTest.opens), 0);
      await page.evaluate(() => window.updateTest.resume());
      assert.equal(await page.evaluate(() => window.updateTest.calls), 1);
      assert.equal(await page.locator('#aiQuotaTitle').evaluate(node => node.closest('section') === document.getElementById('profile').lastElementChild), true);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        for (const id of ['androidUpdateCard', 'androidUpdateNotice']) {
          const box = await page.locator('#' + id).boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width);
        }
      }
      await page.locator('#androidNoticeDismiss').click();
      assert.equal(await page.locator('#androidUpdateNotice').isVisible(), false);
      assert.equal(await page.locator('#androidInstallUpdate').isVisible(), true);
      await page.locator('#androidInstallUpdate').click();
      await page.waitForFunction(() => window.updateTest.opens === 1);
      await page.evaluate(() => { window.updateTest.offline = true; });
      await page.locator('#androidCheckUpdate').click();
      await page.waitForFunction(() => document.getElementById('androidUpdateStatus').textContent.includes('Не удалось'));
      assert.equal(await page.locator('#androidInstallUpdate').isVisible(), true);
      await page.evaluate(() => { window.updateTest.offline = false; window.updateTest.version = '0.4.15'; window.updateTest.code = 30; });
      await page.locator('#androidCheckUpdate').click();
      await page.locator('#androidUpdateNotice').waitFor({ state: 'visible' });
      assert.match(await page.locator('#androidUpdateNotice').textContent(), /0.4.15/);
      await page.reload();
      await page.locator('#androidUpdateCard').waitFor({ state: 'attached' });
      await page.waitForFunction(() => document.getElementById('androidUpdateStatus').textContent.includes('Доступна'));
      assert.equal(await page.locator('#androidUpdateNotice').isVisible(), false); // dismissed 0.4.14 survives restart
      assert.deepEqual(errors, []);
      console.log('PASS Android update notification, dismiss, download, retry, future version, themes: ' + width);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
