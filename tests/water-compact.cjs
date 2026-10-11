const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
const render=source.slice(source.indexOf('function renderWater()'),source.indexOf('function ensureWaterDate()'));
const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type',req.url==='/styles.css'?'text/css; charset=utf-8':'text/html; charset=utf-8');
  res.end(req.url==='/styles.css'?fs.readFileSync(path.join(root,'styles.css')):'<link rel="stylesheet" href="/styles.css"><main class="phone"><section id="today"><div class="section-head"><h2>Вода</h2><button id="waterText">1 из 8 стаканов</button></div><section class="card activity-card"><h2>Активность</h2></section><section class="card water"><div class="drops" id="drops"></div><button class="secondary" id="addWaterButton">+ стакан</button></section></section></main>');
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(render=>{window.water=1;window.element=id=>document.getElementById(id);window.toggleWater=index=>{window.water=index+1;window.renderWater()};window.renderWater=new Function(render+';return renderWater')();window.renderWater();window.renderWater();},render);
    assert.equal(await page.locator('#waterText').count(),0);
    assert.equal(await page.locator('.water-title').count(),1);
    assert.equal(await page.locator('.drop').count(),8);
    assert.equal(await page.locator('.drop.full').count(),1);
    await page.locator('.drop').nth(2).click();
    assert.equal(await page.locator('.drop.full').count(),3);
    await page.evaluate(()=>{
      document.querySelector('.activity-card').remove();
      document.querySelector('#today').insertAdjacentHTML('afterbegin','<section class="card goal"><div><p>Дневная цель</p><b>1 200 <small>из 1 900 ккал</small></b><p>Осталось 700 ккал</p></div><div class="ring">63%</div></section><div class="section-head"><h2>Баланс БЖУ</h2></div><section class="macro"><div><small>Белки</small><b>30 / 143 г</b></div><div><small>Жиры</small><b>20 / 63 г</b></div><div><small>Углеводы</small><b>50 / 190 г</b></div></section>');
      document.querySelector('#today').insertAdjacentHTML('beforeend','<button class="primary">Добавить приём пищи</button><section class="card daily-advice"><p>Совет</p></section>');
      document.querySelector('main').insertAdjacentHTML('beforeend','<section id="testOtherPage"><section class="card">Профиль</section></section>');
    });
    for (const selector of ['#today .goal','#today .daily-advice','#today .macro > div']) {
      assert.equal(await page.locator(selector).first().evaluate(node=>getComputedStyle(node).paddingTop),'8px');
      assert.equal(await page.locator(selector).first().evaluate(node=>getComputedStyle(node).paddingBottom),'8px');
    }
    assert.equal(await page.locator('.water').evaluate(node=>getComputedStyle(node).paddingTop),'4px');
    assert.equal(await page.locator('#testOtherPage .card').evaluate(node=>getComputedStyle(node).paddingTop),'18px');
    for(const width of [320,390,430,1440]){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.locator('.water').evaluate(card=>card.scrollWidth<=card.clientWidth),`No overflow at ${width}`);
      assert.ok(await page.locator('.water').evaluate(card=>card.clientHeight<70));
      assert.ok(await page.evaluate(()=>Math.abs(document.querySelector('.water-title').getBoundingClientRect().y+document.querySelector('.water-title').getBoundingClientRect().height/2-(document.querySelector('.drops').getBoundingClientRect().y+document.querySelector('.drops').getBoundingClientRect().height/2))<2));
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('#today').screenshot({path:path.join(process.env.TEMP,'nutrition-web-cards.png')});
    console.log('Web cards: compact padding, working water drops, no duplicates/overflow at 320/390/430/1440px');
  }finally{await browser.close();server.close()}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
