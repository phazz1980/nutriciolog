const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const stubs = {
    '/js/date.js': "export const todayKey=()=> '2026-10-11';",
    '/js/storage.js': "export const accountDefaults=()=>({uid:'test'}); export const onAuthChanged=()=>{};",
    '/js/ui.js': "export const toast=()=>{}; export function openDialog({html}) {const dialog=document.createElement('div');dialog.innerHTML=html;document.body.append(dialog);return {dialog,close:()=>dialog.remove()}}",
  };
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  if (stubs[req.url]) return res.end(stubs[req.url]);
  if (req.url.startsWith('/js/health-')) return res.end(fs.readFileSync(path.join(root, req.url)));
  if (req.url === '/styles.css') { res.setHeader('Content-Type','text/css'); return res.end(fs.readFileSync(path.join(root,'styles.css'))); }
  res.end('<link rel="stylesheet" href="/styles.css"><main class="phone"><section id="today"><section class="card goal"><div><p>Дневная цель</p><b>1 200 <small>из 1 900 ккал</small></b><p>Осталось 700 ккал</p></div><div class="ring">63%</div></section><div class="water"></div></section><section id="profile"><div id="profileDocuments"></div></section></main>');
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel: process.env.BROWSER_CHANNEL || 'chrome', headless:true});
  try {
    const page = await browser.newPage();
    await page.setViewportSize({width:390,height:844});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      window.statusValue = {availability:'available', stepsGranted:false, weightGranted:false};
      window.calls=0;window.exports=[];window.allowNutrition=false;
      window.nutritionStore={loadDiaryEntries:async()=>[{id:'one',date:'2026-10-11',title:'Еда',calories:500,protein:20,fat:10,carbs:60}]};
      window.Capacitor = {getPlatform:()=> 'android',Plugins:{NutritionHealth:{
        getStatus:async()=>window.statusValue,
        connect:async options=>{window.calls++;window.statusValue={availability:'available',stepsGranted:true,weightGranted:true,energyGranted:true,nutritionGranted:options?.nutrition ? window.allowNutrition : window.statusValue.nutritionGranted};return window.statusValue},
        readSummary:async()=>({...window.statusValue,steps:6000,stepsDate:'2026-10-11',weight:85,weightDate:'2026-10-10',energyDate:'2026-10-11',burnedCalories:1800}),
        openSettings:async()=>{},
        writeNutrition:async operation=>window.exports.push(operation),
      }}};
      window.healthModule = await import('/js/health-connect.js');
      window.healthModule.initHealthConnect();
      await window.healthModule.refreshHealth();
    });
    assert.equal(await page.locator('#stepsCount').textContent(), '—');
    assert.equal(await page.locator('#healthActivity').isVisible(), false);
    await page.locator('#healthConnectButton').click();
    assert.equal(await page.evaluate(()=>window.calls),0);
    await page.locator('#cancelHealth').click();
    assert.equal(await page.evaluate(()=>window.calls),0);
    await page.locator('#healthConnectButton').click();
    await page.locator('#confirmHealth').click();
    await page.waitForFunction(()=>document.querySelector('#stepsCount').textContent.includes('6'));
    assert.equal(await page.locator('#healthActivity').isVisible(), true);
    assert.equal(await page.locator('#stepsProgress').count(),0);
    assert.equal(await page.locator('#stepsGoalText').textContent(),' / 8 000');
    assert.equal(await page.locator('#today .activity-card').count(),2);
    assert.equal(await page.locator('#today .activity-card h2').count(),0);
    assert.equal(await page.locator('#today .activity-block > h2').textContent(),'Активность');
    assert.equal(await page.locator('#stepsCount').evaluate(node=>getComputedStyle(node).fontSize),'16px');
    assert.equal(await page.locator('#healthBurnedCalories').evaluate(node=>getComputedStyle(node).fontSize),'16px');
    assert.ok(await page.locator('#stepsOpenProfile').evaluate(button=>{
      const label=button.querySelector('.goal-metric-label').getBoundingClientRect();
      const number=button.querySelector('.goal-metric-value').getBoundingClientRect();
      return label.bottom <= number.y;
    }));
    assert.equal(await page.locator('#healthBurnedCalories').textContent(),'1 800');
    assert.equal(await page.locator('#today .goal #stepsCount').count(),0);
    assert.equal(await page.locator('#today .activity-card #stepsCount').count(),1);
    assert.equal(await page.locator('#today .steps-card').count(),0);
    await page.locator('#healthBurnedDetails').click();
    assert.match(await page.locator('#burnedExplanation').textContent(), /основной обмен/);
    await page.locator('#closeBurnedDetails').click();
    for (const width of [320,390,430]) {
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), `No page overflow at ${width}px`);
      for (const card of await page.locator('#today .activity-card').all()) assert.ok(await card.evaluate(card=>card.scrollWidth<=card.clientWidth), `No activity overflow at ${width}px`);
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('#today .activity-block').screenshot({path:path.join(process.env.TEMP || root,'nutrition-activity.png')});
    await page.locator('#stepsGoalInput').fill('10000');
    await page.evaluate(()=>window.healthModule.refreshHealth());
    assert.equal(await page.locator('#stepsGoalInput').inputValue(),'10000');
    await page.locator('#stepsGoalForm button').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('my-nutritionist:steps-goal:test')),'10000');
    assert.equal(await page.locator('#stepsGoalText').textContent(),' / 10 000');
    assert.equal((await page.evaluate(()=>window.healthModule.getHealthWeight())).weight,85);
    await page.evaluate(async()=>{window.statusValue={availability:'available',stepsGranted:false,weightGranted:false};await window.healthModule.refreshHealth()});
    assert.equal(await page.locator('#stepsCount').textContent(),'—');
    assert.equal(await page.locator('#healthBurnedCalories').textContent(),'—');
    assert.equal(await page.evaluate(()=>window.healthModule.getHealthWeight()),null);
    assert.equal(await page.locator('#healthActivity').isVisible(), false);
    for (const status of [
      {availability:'unavailable'},
      {availability:'install_required'},
      {availability:'available',weightGranted:true},
    ]) {
      await page.evaluate(async status=>{window.statusValue=status;await window.healthModule.refreshHealth()},status);
      assert.equal(await page.locator('#healthActivity').isVisible(), false);
    }
    for (const grant of ['stepsGranted','energyGranted']) {
      await page.evaluate(async grant=>{window.statusValue={availability:'available',[grant]:true};await window.healthModule.refreshHealth()},grant);
      assert.equal(await page.locator('#healthActivity').isVisible(), true);
    }
    await page.evaluate(async()=>{window.statusValue={availability:'available'};await window.healthModule.refreshHealth()});
    await page.locator('#healthNutritionToggle').click();
    await page.waitForFunction(()=>!document.querySelector('#healthNutritionToggle').disabled);
    assert.equal(await page.locator('#healthNutritionToggle').isChecked(),false);
    assert.equal(await page.evaluate(()=>window.exports.length),0);
    await page.evaluate(()=>window.allowNutrition=true);
    await page.locator('#healthNutritionToggle').check();
    await page.waitForFunction(()=>window.exports.length===1);
    assert.equal(await page.evaluate(()=>window.exports[0].entry.calories),500);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nutrition-diary-deleted',{detail:{owner:'test',id:'one'}})));
    await page.waitForFunction(()=>window.exports.length===2);
    assert.equal(await page.evaluate(()=>window.exports[1].deleted),true);
    await page.locator('#healthNutritionToggle').uncheck();
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nutrition-diary-saved',{detail:{owner:'test',entry:{id:'two',date:'2026-10-11',calories:300}}})));
    assert.equal(await page.evaluate(()=>window.exports.length),2);
    console.log('Health UI: consent, denial, steps, goal, weight, nutrition export/deletion and disabling passed');
  } finally { await browser.close(); server.close(); }
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
