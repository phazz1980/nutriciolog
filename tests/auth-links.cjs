const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const source = fs.readFileSync(path.join(root, 'firebase-client.js'), 'utf8');
const render = source.slice(source.indexOf('function updateAuthUI()'), source.indexOf('async function save('));
(async () => {
  const browser = await chromium.launch({ channel:'chrome', headless:true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main class="phone"><section id="profile"><div id="profileDocuments"></div></section></main>');
    await page.addStyleTag({content:fs.readFileSync(path.join(root, 'styles.css'), 'utf8')});
    await page.evaluate(render => {
      window.testCalls=[];
      for (const name of ['firebaseSignInWithEmail','firebaseRegisterWithEmail','firebaseSendPasswordReset']) window[name]=async(...args)=>window.testCalls.push({name,args});
      new Function('const configured=true, user=null, authState="ready";let signInAttempt=null, authMessage="";'+render+';window.testRenderAuth=(pending,error="")=>{signInAttempt=pending?Promise.resolve():null;authMessage=error;updateAuthUI();};updateAuthUI();')();
    }, render);
    assert.equal(await page.locator('#googleSignIn').count(),0);
    assert.ok(!source.includes('GoogleAuthProvider'));
    assert.ok(!fs.readFileSync(path.join(root,'js/app.js'),'utf8').includes('Войти через Google'));
    await page.locator('#emailAuthEmail').fill('test@example.com');
    await page.locator('#emailAuthPassword').fill('example-password');
    assert.equal(await page.locator('#emailAuthEmail').getAttribute('autocomplete'),'username');
    assert.equal(await page.locator('#emailAuthEmail').getAttribute('name'),'username');
    assert.equal(await page.locator('#emailAuthPassword').getAttribute('autocomplete'),'current-password');
    await page.evaluate(()=>{window.originalPasswordField=document.getElementById('emailAuthPassword');window.testRenderAuth(true);});
    assert.equal(await page.locator('#emailAuthPassword').inputValue(),'example-password');
    assert.equal(await page.evaluate(()=>window.originalPasswordField===document.getElementById('emailAuthPassword')),true);
    assert.equal(await page.locator('#emailSignIn').isDisabled(),true);
    await page.evaluate(()=>window.testRenderAuth(false,'Неверный пароль'));
    assert.equal(await page.locator('#emailAuthPassword').inputValue(),'example-password');
    assert.equal(await page.locator('#emailSignIn').isDisabled(),false);
    await page.locator('#emailRegister').click();
    await page.locator('#passwordReset').click();
    await page.locator('#emailSignIn').click();
    assert.deepEqual(await page.evaluate(()=>window.testCalls.map(c=>c.name)),['firebaseRegisterWithEmail','firebaseSendPasswordReset','firebaseSignInWithEmail']);
    for(const width of [320,390,430,1440]) {
      await page.setViewportSize({width,height:844});
      for(const id of ['emailRegister','passwordReset']) {
        const style=await page.locator('#'+id).evaluate(node=>({align:getComputedStyle(node).textAlign,decoration:getComputedStyle(node).textDecorationLine,width:node.getBoundingClientRect().width,parent:node.parentElement.getBoundingClientRect().width}));
        assert.equal(style.align,'center'); assert.ok(style.decoration.includes('underline')); assert.ok(Math.abs(style.width-style.parent)<1);
      }
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('#authPanel').screenshot({path:path.join(process.env.TEMP,'nutrition-auth-links.png')});
    console.log('Email auth: no Google login, registration/reset/sign-in handlers preserved, centered underlined links at 320–1440px');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
