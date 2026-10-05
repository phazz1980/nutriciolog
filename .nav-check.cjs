// Проверяет навигацию: каждая видимая вкладка открывает свой экран, скрытые
// вкладки недоступны.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'firebase-client.js'), 'utf8');
const authSdk = `import {registry} from './firebase-app.js';
export const getAuth=app=>{if(app.registry!==registry)throw new Error('dup');return {}};
export const browserLocalPersistence={}; export const setPersistence=()=>Promise.resolve();
export class GoogleAuthProvider {}
export function onAuthStateChanged(auth,next){window.test.setUser=user=>next(user);queueMicrotask(()=>next(null));return()=>{}}
export function signInWithPopup(){return new Promise(()=>{})}
export const signOut=()=>Promise.resolve(); export const signInWithEmailAndPassword=()=>{}; export const createUserWithEmailAndPassword=()=>{};`;
const fsSdk = `export const getFirestore=()=>({}); export const doc=(...p)=>p; export const collection=(...p)=>p; export const query=(...p)=>p; export const where=(...p)=>p;
export const getDoc=async()=>({exists:()=>false}); export const getDocs=async()=>({docs:[]}); export const setDoc=async()=>{}; export const deleteDoc=async()=>{}; export const serverTimestamp=()=>0;`;

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://l').pathname.replace(/^\//, '') || 'index.html');
    try {
      const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.test = { user: null, popupCalls: 0, writes: [], profileReads: [] }; });
  await page.route('https://**/*', route => {
    const url = new URL(route.request().url()).pathname;
    if (!url.includes('/firebasejs/')) return route.abort();
    const body = url.endsWith('firebase-app.js') ? 'export const registry={}; export const initializeApp=()=>({registry});'
      : url.endsWith('firebase-auth.js') ? authSdk : fsSdk;
    return route.fulfill({ contentType: 'text/javascript', body, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.route('**/firebase-client.js', route => route.fulfill({ contentType: 'text/javascript', body: source.replace('const AUTH_WAIT_MS = 15000;', 'const AUTH_WAIT_MS = 200;') }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => Boolean(window.nutritionStore));
  await page.waitForTimeout(400);

  const tabs = await page.evaluate(() => [...document.querySelectorAll('.nav')].map(nav => ({
    target: nav.dataset.nav,
    visible: nav.getBoundingClientRect().width > 0,
  })));
  console.log('вкладки:', tabs.map(tab => `${tab.target}${tab.visible ? '' : ' (скрыта)'}`).join(', '));

  let failures = 0;
  for (const tab of tabs.filter(item => item.visible)) {
    const result = await page.evaluate(async target => {
      document.querySelector(`.nav[data-nav="${target}"]`).click();
      await new Promise(resolve => setTimeout(resolve, 200));
      const active = [...document.querySelectorAll('.screen')].filter(screen => screen.classList.contains('active'));
      const shown = active.filter(screen => getComputedStyle(screen).display !== 'none');
      return {
        activeIds: active.map(screen => screen.id),
        visibleIds: shown.map(screen => screen.id),
        navActive: document.querySelector('.nav.active')?.dataset.nav || null,
      };
    }, tab.target);
    const ok = result.visibleIds.length === 1 && result.visibleIds[0] === tab.target && result.navActive === tab.target;
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'СБОЙ'} вкладка «${tab.target}» → видимый экран: ${result.visibleIds.join(',') || '(нет)'}, активная кнопка: ${result.navActive}`);
  }

  // Скрытая вкладка не должна открываться даже программно.
  const hidden = await page.evaluate(async () => {
    window.show('plan');
    await new Promise(resolve => setTimeout(resolve, 150));
    return [...document.querySelectorAll('.screen')].filter(screen => screen.classList.contains('active')).map(screen => screen.id);
  });
  console.log('после window.show("plan") активен экран:', hidden.join(',') || '(нет)');
  const hiddenOk = hidden.length === 1 && hidden[0] !== 'plan';
  if (!hiddenOk) failures++;

  console.log('\nошибки:', errors.length ? errors.join('\n') : 'нет');
  console.log(failures ? `СБОЕВ: ${failures}` : 'все проверки навигации пройдены');
  await page.screenshot({ path: 'nav-check.png' });

  await browser.close();
  await new Promise(resolve => server.close(resolve));
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
