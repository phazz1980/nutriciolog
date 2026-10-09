const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html');
    if (req.url === '/js/wear-config.js') return res.end("export const WEAR_AUTH_ENDPOINT='https://pairing.test';");
    if (req.url === '/js/wear-pairing.js') return res.end(fs.readFileSync(path.join(root, 'js/wear-pairing.js')));
    res.end(`<div id="profileDocuments"></div><script>window.uid='owner';window.getFirebaseIdToken=async()=>window.uid?'test-token':null;window.nutritionStore={getAccountProfileDefaults:()=>({uid:window.uid})};</script><script type="module" src="/js/wear-pairing.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const calls = [];
    await page.route('https://pairing.test/**', async route => {
      calls.push(new URL(route.request().url()).pathname);
      assert.equal(route.request().headers().authorization, 'Bearer test-token');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"pending"}' });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/#connect-watch=ABCDE23456`);
    await page.locator('#wearPairingDialog').waitFor();
    assert.equal(calls.length, 0, 'hash must not automatically approve');
    await page.getByRole('button', { name: 'Проверить код' }).click();
    await page.getByRole('button', { name: 'Подтвердить подключение' }).waitFor();
    assert.deepEqual(calls, ['/inspect']);
    await page.evaluate(() => { window.uid = 'another'; });
    await page.getByRole('button', { name: 'Подтвердить подключение' }).click();
    await page.getByText('Аккаунт изменился. Проверьте код заново.').waitFor();
    assert.deepEqual(calls, ['/inspect'], 'account change must require a fresh confirmation');
    await page.getByRole('button', { name: 'Проверить код' }).click();
    await page.getByRole('button', { name: 'Подтвердить подключение' }).waitFor();
    await page.getByRole('button', { name: 'Подтвердить подключение' }).click();
    await page.getByText('Подтверждено. Дождитесь завершения входа на часах.').waitFor();
    assert.deepEqual(calls, ['/inspect', '/inspect', '/approve']);
    await page.getByRole('button', { name: 'Закрыть' }).click();
    await page.getByRole('button', { name: 'Подключить часы', exact: true }).click();
    await page.locator('input[name=code]').fill('BAD');
    await page.getByRole('button', { name: 'Проверить код' }).click();
    await page.getByText('Введите 10 символов кода с ваших часов.').waitFor();
    await page.evaluate(() => { window.uid = ''; });
    await page.locator('input[name=code]').fill('ABCDE23456');
    await page.getByRole('button', { name: 'Проверить код' }).click();
    await page.getByText('Сначала войдите в аккаунт в профиле приложения.').waitFor();
    assert.equal(calls.length, 3);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#wearPairingDialog').count(), 0);
    console.log('PASS: explicit two-step approval, account change, invalid code, guest, cancellation');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
