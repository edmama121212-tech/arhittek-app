'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox']});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    await context.addInitScript({path:path.join(__dirname,'mock.js')});
    await context.route('**/*',route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='app.test'){
        const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
        if(fs.existsSync(f))return route.fulfill({path:f});
      }
      return route.fulfill({body:'',contentType:'text/javascript'});
    });
    const page=await context.newPage();page.setDefaultTimeout(4000);
    await page.goto('https://app.test/');
    await page.waitForFunction(()=>typeof loadAll==='function' && typeof hasVerifiedAccess==='function' && hasVerifiedAccess() && !loadAllInFlight);
    await page.evaluate(async()=>{
      __db.projects=[
        {id:'qa-arch',name:'Клавиатурный тест',category_id:'arch',status_id:'active',employee_id:'architect'},
        {id:'qa-build',name:'Тестовый объект',category_id:'build',status_id:'active',employee_id:'admin'}
      ];
      await loadAll();
    });
    const key=async(locator,k)=>{await locator.focus();await page.keyboard.press(k);};
    const nav=async id=>key(page.locator('.nav-btn[data-view="view-'+id+'"]'),'Enter');
    await nav('projects');await key(page.locator('#projectsCard .proj-row').first(),'Space');
    await page.locator('#projectSheetOverlay.active').waitFor();
    await key(page.locator('#project-tab-overview'),'ArrowRight');
    assert.equal(await page.locator('#project-tab-team').getAttribute('aria-selected'),'true');
    await page.keyboard.press('End');assert.equal(await page.locator('#project-tab-files').getAttribute('aria-selected'),'true');
    await page.keyboard.press('Home');assert.equal(await page.locator('#project-tab-overview').getAttribute('aria-selected'),'true');
    await key(page.locator('#projectSheetClose'),'Enter');
    await nav('cards');const floor=page.locator('#cards-filters [data-floors="2"]');
    await key(floor,'Space');assert.equal(await floor.getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#cards-filters [aria-pressed="true"]').count(),1);
    await nav('construction');await key(page.locator('.obj-card').first(),'Enter');
    const add=page.locator('#objTabs button').filter({hasText:'Добавить'});await key(add,'Space');
    assert.equal(await add.getAttribute('aria-pressed'),'true');await page.getByLabel('Дата',{exact:true}).filter({visible:true}).first().waitFor();
    const upload=page.locator('label[for="inv-photo-obj"]');
    const chooser=page.waitForEvent('filechooser');await key(upload,'Enter');
    assert.equal(await (await chooser).element().getAttribute('id'),'inv-photo-obj');
    console.log('Keyboard routes passed: project Space, roving team/files/overview tabs, menu Enter, catalog selection, object Enter, purchase tab Space, labelled date, keyboard photo chooser.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
