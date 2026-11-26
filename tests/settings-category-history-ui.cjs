'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
async function run(){
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
  await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
  await ctx.route('**/*',route=>{
   const u=new URL(route.request().url()),file=path.join(root,u.pathname==='/'?'index.html':u.pathname);
   return u.hostname==='qa.test'&&fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({body:''});
  });
  const p=await ctx.newPage();p.setDefaultTimeout(5000);
  await p.goto('https://qa.test/');await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);




  await p.evaluate(async()=>{
    __db.projects=[{id:'qa-house',name:'Учебный объект',category_id:'arch',status_id:'active',price:0}];
    __db.audit_log=['Учебный объект','Другой договор'].map((entity_name,i)=>({id:'qa-log-'+i,entity_type:'project',entity_id:'qa-'+i,entity_name,action:'update',created_at:new Date().toISOString()}));
    await loadAll();
  });
  const errors=[];p.on('pageerror',err=>errors.push(err.message));

  async function check(id,element,action,verify){
   const control=p.locator('#'+element);await control.scrollIntoViewIfNeeded();
   const box=await control.boundingBox(),start=performance.now();
   await action(control);
   await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const ms=Math.round(performance.now()-start);
   const row={id,build,time:new Date().toISOString(),browser:browser.version(),ms,width:Math.round(box.width)};
   try{
    assert.ok(box.x>=0&&box.x+box.width<=391);
    await verify();assert.deepEqual(errors,[]);row.pass=true;
   }catch(error){row.pass=false;row.error=error.message;}
   console.log(JSON.stringify(row));assert.ok(row.pass);
  }
  const click=el=>el.click();

  await check('UI-0004','settingsBtn',click,async()=>assert.ok(await p.locator('#categoriesCard').isVisible()));
  const employees=p.locator('#employeesCard .list-item');const count=await employees.count();assert.ok(count>1);
  await p.locator('#employeeSearch').fill('Амина');assert.equal(await employees.count(),1);
  await check('UI-0300','employeeSearchClear',click,async()=>{assert.equal(await employees.count(),count);assert.ok(await p.locator('#employeeSearch').evaluate(e=>e===document.activeElement));});
  const category=p.locator('#categoriesCard .list-item').filter({hasText:'Архитектурное'}).getByRole('button');
  await category.click();
  await check('UI-0249','cf-delete',click,async()=>{
    assert.match(await p.locator('#toast').innerText(),/есть проекты/);
    assert.ok(await p.evaluate(()=>!__db.categories.find(c=>c.id==='arch').deleted_at && __db.projects[0].category_id==='arch'));
  });
  await check('UI-0243','catSheetClose',click,async()=>assert.ok(await p.locator('#catSheetOverlay').isHidden()));
  await category.click();const before=await p.locator('#cf-name').inputValue();await p.locator('#cf-name').fill('Несохранённое имя');
  p.on('dialog',d=>d.accept());
  await check('UI-0250','cf-cancel',click,async()=>{assert.ok(await p.locator('#catSheetOverlay').isHidden());assert.equal(await p.evaluate(()=>__db.categories.find(c=>c.id==='arch').name),before);});
  await check('UI-0298','settingsBack',click,async()=>assert.ok(await p.locator('#view-more').isVisible()));
  const rows=p.locator('#historyCard .history-item');
  await check('UI-0295','historyToggle',click,async()=>{assert.ok(await p.locator('#historySectionBody').isVisible());assert.equal(await rows.count(),2);});
  await check('UI-0296','historySearch',el=>el.fill('ОБЪЕКТ'),async()=>{assert.equal(await rows.count(),1);assert.match(await rows.innerText(),/Учебный объект/);});
  await check('UI-0297','historySearchClear',click,async()=>{assert.equal(await rows.count(),2);assert.ok(await p.locator('#historySearch').evaluate(e=>e===document.activeElement));});
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
