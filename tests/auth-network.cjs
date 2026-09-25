// npm install --no-save playwright; node tests/auth-network.cjs
// Set PLAYWRIGHT_MODULE / BROWSER_CHANNEL when using a shared runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'firebase-client.js'), 'utf8');
const authSdk = `
import {registry} from './firebase-app.js';
export const getAuth=app=>{if(app.registry!==registry)throw new Error('Duplicate Firebase app registry');return {}};
export class GoogleAuthProvider {}
export function onAuthStateChanged(auth, next){
  window.test.setUser=next;
  if(!window.test.delaySession)queueMicrotask(()=>next(window.test.user));
  return ()=>{};
}
export function signInWithPopup(){
  window.test.popupCalls++;
  return new Promise((resolve,reject)=>{window.test.finishLogin=resolve;window.test.failLogin=reject});
}
export const signOut=()=>{window.test.setUser(null);return Promise.resolve()};
export const signInWithEmailAndPassword=()=>{};
export const createUserWithEmailAndPassword=()=>{};
`;
const firestoreSdk = `
export const getFirestore=()=>({});
export const doc=(...parts)=>parts;
export const collection=(...parts)=>parts;
export const query=(...parts)=>parts;
export const where=(...parts)=>parts;
export const getDoc=async parts=>{
  if(parts[3]==='profile'&&window.test.holdProfile){
    return new Promise((resolve,reject)=>window.test.profileReads.push({uid:parts[2],resolve:value=>resolve({exists:()=>value!==null,data:()=>value}),reject}));
  }
  return {exists:()=>false};
};
export const getDocs=async()=>({docs:[]});
export const setDoc=async(...args)=>{if(window.test.failSave)throw new Error('Offline');window.test.writes.push(args)};
export const deleteDoc=async()=>{};
export const serverTimestamp=()=>0;
`;

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/^\//, '') || 'index.html');
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function setup(options = {}) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(opts => {
        window.test = { ...opts, user: null, popupCalls: 0, writes: [], profileReads: [] };
        localStorage.setItem('my-nutritionist:profile:main:', JSON.stringify({ name: 'Guest' }));
      }, options);
      let failImports = Boolean(options.failImports);
      await page.route('https://**/*', async route => {
        const url = new URL(route.request().url()).pathname;
        if (!url.includes('/firebasejs/')) return route.abort();
        if (failImports && (options.failApp || !url.endsWith('firebase-app.js'))) return route.abort();
        const body = url.endsWith('firebase-app.js') ? 'export const registry={}; export const initializeApp=()=>({registry});' : url.endsWith('firebase-auth.js') ? authSdk : firestoreSdk;
        return route.fulfill({ contentType: 'text/javascript', body, headers: { 'Access-Control-Allow-Origin': '*' } });
      });
      // Accelerate only application auth timers; the Firebase response remains manually controlled.
      await page.route('**/firebase-client.js', route => route.fulfill({ contentType: 'text/javascript', body: source.replace('const AUTH_WAIT_MS = 15000;', 'const AUTH_WAIT_MS = 200;') }));
      await page.goto(origin);
      await page.waitForFunction(() => Boolean(window.nutritionStore));
      return { page, errors, context, recover: () => { failImports = false; } };
    }
    async function check(name, options, run) {
      const state = await setup(options);
      try { await run(state); assert.deepEqual(state.errors, []); console.log('PASS', name); }
      finally { await state.context.close(); }
    }

    await check('Pending session is not treated as signed out; no accidental guest write', { delaySession: true }, async ({ page }) => {
      await page.waitForFunction(() => Boolean(window.test.setUser));
      const result = await page.evaluate(async () => {
        const token = window.getFirebaseIdToken().catch(e => e.code);
        const save = window.nutritionStore.saveDiaryEntry({ id: 'pending', title: 'Test', calories: 1 }).catch(e => e.code);
        return { token: await token, save: await save, local: localStorage.getItem('my-nutritionist:foodDiary:pending:') };
      });
      assert.deepEqual(result, { token: 'auth/loading', save: 'auth/loading', local: null });
      assert.equal(await page.locator('#googleSignIn').count(), 0);
      await page.evaluate(() => window.test.setUser({ uid: 'account', displayName: 'Account', email: 'test@example.invalid', getIdToken: async () => 'test-token' }));
      assert.equal(await page.evaluate(() => window.getFirebaseIdToken()), 'test-token');
      assert.equal(await page.evaluate(() => window.nutritionStore.loadProfile()), null);
      await page.evaluate(() => window.nutritionStore.saveDiaryEntry({ id: 'cloud', title: 'Test', calories: 1 }));
      assert.equal(await page.evaluate(() => window.test.writes[0][0][2]), 'account');
    });

    await check('Explicit guest mode stays usable while Firebase is unavailable', { failImports: true }, async ({ page, recover }) => {
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'error');
      await page.evaluate(() => { show('profile'); document.getElementById('guestAuth').click(); });
      assert.equal(await page.evaluate(async () => (await window.nutritionStore.saveDiaryEntry({ id: 'guest', title: 'Test', calories: 1 })).mode), 'local');
      recover();
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'ready');
    });

    await check('A failed base SDK offers an explicit reload and preserves guest access', { failImports: true, failApp: true }, async ({ page, recover }) => {
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'error');
      assert.equal(await page.locator('#retryAuth').textContent(), 'Перезагрузить страницу');
      recover();
      await page.evaluate(() => document.getElementById('retryAuth').click());
      await page.waitForFunction(() => window.getFirebaseAuthStatus?.().state === 'ready');
    });

    await check('Popup is single-flight; a network failure is actionable and retry succeeds', {}, async ({ page }) => {
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'ready');
      await page.evaluate(() => {openMeal();window.showAuthRequiredDialog()});
      if(process.env.AUTH_SCREENSHOT)await page.screenshot({path:process.env.AUTH_SCREENSHOT});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#authRequiredDialog').count(),0);
      await page.evaluate(() => { window.showAuthRequiredDialog(); document.querySelector('#authRequiredDialog .primary').click(); window.firebaseSignInWithGoogle().catch(()=>{}); });
      assert.equal(await page.evaluate(() => window.test.popupCalls), 1);
      assert.equal(await page.locator('#authRequiredDialog .primary').isDisabled(), true);
      await page.waitForFunction(() => window.getFirebaseAuthStatus().message.includes('больше времени'));
      assert.match(await page.locator('#authRequiredDialog [role=status]').textContent(), /больше времени/);
      await page.evaluate(() => window.test.failLogin({ code: 'auth/network-request-failed' }));
      await page.waitForFunction(() => !window.getFirebaseAuthStatus().pending);
      assert.match(await page.locator('#authRequiredDialog [role=status]').textContent(), /Проверьте интернет/);
      await page.locator('#authRequiredDialog .primary').click();
      await page.evaluate(() => { window.test.setUser({ uid: 'account', getIdToken: async () => 'test-token' }); window.test.finishLogin({}); });
      await page.waitForFunction(() => !document.getElementById('authRequiredDialog'));
      assert.equal(await page.evaluate(() => window.test.popupCalls), 2);
    });

    await check('A delayed token or SDK error does not open the signed-out dialog', {}, async ({ page }) => {
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'ready');
      await page.evaluate(() => window.test.setUser({ uid: 'account', getIdToken: () => new Promise(()=>{}) }));
      assert.equal(await page.evaluate(async () => (await getAiToken()) === undefined), true);
      assert.equal(await page.locator('#authRequiredDialog').count(), 0);
      await page.evaluate(() => { window.test.setUser({ uid: 'account', getIdToken: () => Promise.reject({ code: 'auth/network-request-failed' }) }); mealName.value='Test'; portion.value='100'; });
      await page.evaluate(() => window.calculateMealNutrition());
      assert.equal(await page.locator('#authRequiredDialog').count(), 0);
      assert.equal(await page.evaluate(() => window.test.writes.length), 0);
    });

    await check('Popup blocked/closed errors retain the form and allow another attempt', {}, async ({ page }) => {
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'ready');
      await page.evaluate(() => { mealName.value='Salad'; portion.value='200'; window.showAuthRequiredDialog(); });
      for (const code of ['auth/popup-blocked', 'auth/popup-closed-by-user']) {
        await page.locator('#authRequiredDialog .primary').click();
        await page.evaluate(code => window.test.failLogin({ code }), code);
        await page.waitForFunction(() => !window.getFirebaseAuthStatus().pending);
        assert.match(await page.locator('#authRequiredDialog [role=status]').textContent(), /Safari\/Chrome/);
        assert.equal(await page.locator('#mealName').inputValue(), 'Salad');
        assert.equal(await page.locator('#portion').inputValue(), '200');
      }
    });

    await check('Cached profile renders before Firestore and refreshes in the background', { holdProfile: true }, async ({ page }) => {
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'ready');
      await page.evaluate(() => {
        localStorage.setItem('my-nutritionist:account:A:profile:v1:', JSON.stringify({version:1,profile:{name:'Cached',calories:1900}}));
        window.test.setUser({uid:'A',displayName:'Account',getIdToken:async()=>'token'});
      });
      await page.waitForFunction(() => document.getElementById('profileName').textContent === 'Cached');
      assert.equal(await page.evaluate(() => window.test.profileReads.length), 1);
      await page.evaluate(() => window.test.profileReads[0].resolve({name:'Fresh',calories:2100}));
      await page.waitForFunction(() => document.getElementById('profileName').textContent === 'Fresh');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('my-nutritionist:account:A:profile:v1:')).profile.calories), 2100);
      await page.reload();
      await page.waitForFunction(() => window.getFirebaseAuthStatus?.().state === 'ready');
      await page.evaluate(() => window.test.setUser({uid:'A',displayName:'Account'}));
      await page.waitForFunction(() => document.getElementById('profileName').textContent === 'Fresh');
      await page.evaluate(() => window.test.profileReads[0].reject(new Error('Offline')));
      assert.equal(await page.locator('#profileName').textContent(), 'Fresh');
    });

    await check('Switching accounts and sign-out clear the cache and ignore late responses', { holdProfile: true }, async ({ page }) => {
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'ready');
      await page.evaluate(() => {
        localStorage.setItem('my-nutritionist:account:A:profile:v1:', JSON.stringify({version:1,profile:{name:'CachedA'}}));
        window.test.setUser({uid:'A',displayName:'AccountA'});
      });
      await page.waitForFunction(() => document.getElementById('profileName').textContent === 'CachedA');
      await page.evaluate(() => window.test.setUser({uid:'B',displayName:'AccountB'}));
      await page.waitForFunction(() => window.test.profileReads.length === 2);
      await page.evaluate(() => window.test.profileReads[0].resolve({name:'LateA'}));
      assert.equal(await page.locator('#profileName').textContent(), 'AccountB');
      assert.equal(await page.evaluate(() => localStorage.getItem('my-nutritionist:account:A:profile:v1:')), null);
      await page.evaluate(() => window.test.profileReads[1].resolve({name:'FreshB'}));
      await page.waitForFunction(() => document.getElementById('profileName').textContent === 'FreshB');
      await page.evaluate(() => window.firebaseSignOut());
      await page.waitForFunction(() => document.getElementById('profileName').textContent === 'Guest');
      assert.equal(await page.evaluate(() => localStorage.getItem('my-nutritionist:account:B:profile:v1:')), null);
    });

    await check('Saving updates the cache; a late read or failed save cannot replace it', { holdProfile: true }, async ({ page }) => {
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'ready');
      await page.evaluate(() => {
        localStorage.setItem('my-nutritionist:account:A:profile:v1:', JSON.stringify({version:1,profile:{name:'Cached'}}));
        window.test.setUser({uid:'A'});
      });
      await page.waitForFunction(() => window.test.profileReads.length === 1);
      await page.evaluate(() => window.nutritionStore.saveProfile({name:'Saved',calories:2000}));
      await page.evaluate(() => window.test.profileReads[0].resolve({name:'Old'}));
      assert.equal(await page.locator('#profileName').textContent(), 'Saved');
      await page.evaluate(async () => {window.test.failSave=true;await window.nutritionStore.saveProfile({name:'Failed'}).catch(()=>{});});
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('my-nutritionist:account:A:profile:v1:')).profile.name), 'Saved');
    });

    await check('Corrupt or unavailable local storage does not prevent a cloud profile read', { holdProfile: true }, async ({ page }) => {
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'ready');
      await page.evaluate(() => {
        localStorage.setItem('my-nutritionist:account:A:profile:v1:', '{broken');
        window.test.setUser({uid:'A'});
      });
      await page.waitForFunction(() => window.test.profileReads.length === 1);
      await page.evaluate(() => {
        const original=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){if(key.includes(':account:'))throw new Error('Quota');return original.call(this,key,value)};
        window.test.profileReads[0].resolve({name:'Cloud'});
      });
      await page.waitForFunction(() => document.getElementById('profileName').textContent === 'Cloud');
    });

    await check('AI buttons reflect sign-in, offline state, service failure and recovery', {}, async ({ page, context }) => {
      await page.waitForFunction(() => window.getFirebaseAuthStatus().state === 'ready');
      const button=page.locator('#calculateMealButton');
      assert.match(await button.getAttribute('class'), /ai-unavailable/);
      await page.evaluate(() => window.test.setUser({uid:'A',getIdToken:async()=>'token'}));
      await page.waitForFunction(() => !document.getElementById('calculateMealButton').classList.contains('ai-unavailable'));
      await context.setOffline(true);
      await page.waitForFunction(() => document.getElementById('calculateMealButton').classList.contains('ai-unavailable'));
      assert.equal(await page.evaluate(async () => (await getAiToken())===undefined), true);
      await context.setOffline(false);
      await page.waitForFunction(() => !document.getElementById('calculateMealButton').classList.contains('ai-unavailable'));
      let status=502;
      await page.route('**/api/advice',route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{advice:'OK',proposedMeal:null}:{error:'Unavailable'}),headers:{'Access-Control-Allow-Origin':'*'}}));
      await page.evaluate(() => requestAiAdvice({method:'POST'}));
      assert.match(await button.getAttribute('class'), /ai-unavailable/);
      assert.match(await page.locator('#aiMealAvailabilityStatus').textContent(), /временно недоступен/);
      status=200;
      await page.evaluate(() => requestAiAdvice({method:'POST'}));
      assert.equal((await button.getAttribute('class')).includes('ai-unavailable'), false);
    });

    await check('Advice and manual meal share Photo/Gallery picker; macro examples are removed', {}, async ({ page }) => {
      for(const [button,input,open] of [
        ['#advicePhotoButton','#mealPhoto',()=>show('assistant')],
        ['[aria-label="Распознать блюдо по фото"]','#manualMealPhoto',()=>openMeal()],
      ]){
        await page.evaluate(open);
        for(const [label,capture] of [['Снять фото камерой','environment'],['Выбрать фото из галереи или файлов',null]]){
          await page.locator(button).click();
          if(process.env.UI_SCREENSHOT&&input==='#mealPhoto'&&capture)await page.screenshot({path:process.env.UI_SCREENSHOT});
          const chooser=page.waitForEvent('filechooser');
          await page.getByRole('button',{name:label,exact:true}).click();
          await chooser;
          assert.equal(await page.locator(input).getAttribute('capture'),capture);
          assert.equal(await page.locator('#photoSourcePicker').count(),0);
        }
      }
      for(const id of ['protein','fat','carbs'])assert.equal(await page.locator('#'+id).getAttribute('placeholder'),null);
    });

    // SW behavior without a real Google connection or a persistent browser cache.
    const listeners = {}, stored = [];
    const cached = { ok: true, name: 'cached' };
    let fetchResult = () => new Promise(() => {});
    vm.runInNewContext(fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'), {
      URL, Set, Promise,
      setTimeout: callback => setTimeout(callback, 10), clearTimeout,
      self: { registration: { scope: `${origin}/` }, addEventListener: (type, callback) => { listeners[type] = callback; } },
      caches: { open: async () => ({ match: async () => cached, put: async (...args) => stored.push(args) }) },
      fetch: () => fetchResult(),
    });
    function request(url, method = 'GET') {
      let response;
      listeners.fetch({ request: { url, method }, waitUntil() {}, respondWith(value) { response = value; } });
      return response;
    }
    assert.equal(await request(`${origin}/firebase-client.js`), cached);
    assert.equal(request(`${origin}/api/advice`), undefined);
    assert.equal(request('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'), undefined);
    assert.equal(request(`${origin}/index.html`, 'POST'), undefined);
    fetchResult = async () => ({ ok: false });
    assert.equal(await request(`${origin}/index.html`), cached);
    assert.equal(stored.length, 0);
    console.log('PASS Service worker uses cached shell on a slow/error response; excludes API, SDK, and POST');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
