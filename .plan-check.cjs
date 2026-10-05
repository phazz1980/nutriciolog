// Проверяет состояние вкладки «План»: видна ли кнопка и что происходит при клике.
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

  const navState = await page.evaluate(() => {
    const navs = [...document.querySelectorAll('.nav')];
    return navs.map(nav => ({
      target: nav.dataset.nav || nav.dataset.target,
      visible: nav.getBoundingClientRect().width > 0,
      display: getComputedStyle(nav).display,
    }));
  });
  console.log('вкладки в навигации:');
  navState.forEach(item => console.log(` ${item.visible ? 'видна  ' : 'скрыта '} ${item.target} (display: ${item.display})`));

  // Что будет при клике по «План»?
  const afterClick = await page.evaluate(() => {
    const planNav = document.querySelector('.nav[data-nav="plan"]');
    if (!planNav) return { error: 'кнопка не найдена' };
    planNav.click();
    const active = [...document.querySelectorAll('.screen')]
      .filter(screen => screen.classList.contains('active'))
      .map(screen => ({ id: screen.id, display: getComputedStyle(screen).display }));
    return { activeScreens: active, planDisplay: getComputedStyle(document.getElementById('plan')).display };
  });
  console.log('\nпосле клика по «План»:', JSON.stringify(afterClick));
  console.log('ошибки:', errors.length ? errors.join('\n') : 'нет');
  await page.screenshot({ path: 'plan-tab.png' });

  await browser.close();
  await new Promise(resolve => server.close(resolve));
})().catch(error => { console.error(error); process.exitCode = 1; });
