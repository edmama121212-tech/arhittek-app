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





  const mode=process.argv[2]||'profile';
  await p.evaluate(async()=>{
    __db.projects=[{id:'qa-e',name:'Учебная команда',employee_id:'visual',category_id:'design',status_id:'active'}];
    await loadAll();
  });
  await p.locator('#settingsBtn').click();
  const open=()=>p.locator('#employeesCard button[onclick*="visual"]').click();
  await open();
  const stats={};
  async function act(id,action){
    const field=p.locator('#'+id);
    const details=field.locator('xpath=ancestor::details[not(@open)]').first();
    if(await details.count())await details.locator('summary').first().click();
    await field.scrollIntoViewIfNeeded();const box=await field.boundingBox();
    assert.ok(box.x>=0&&box.x+box.width<=391,id);
    const start=performance.now();await action(field);
    await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    stats[id]={ms:Math.round(performance.now()-start),width:Math.round(box.width)};
  }


  if(mode==='catalog'){
   const field=p.locator('#ef-can-edit-cards');
   const started=performance.now(),visible=await field.isVisible();
   if(visible){
    await act('ef-can-edit-cards',f=>f.check());await p.locator('#ef-save').click();
    await p.waitForFunction(()=>__db.employees.find(e=>e.id==='visual').can_edit_cards===true);
    const staff=await ctx.newPage();
    await staff.addInitScript(()=>{
     if(!window.__db)return;
     __db.employees.find(e=>e.id==='visual').can_edit_cards=true;
     localStorage.setItem('arhittek_session',JSON.stringify({employeeId:'visual',name:'Учебный сотрудник',isAdmin:false,token:'qa-staff',createdAt:Date.now()}));
    });
    await staff.goto('https://qa.test/');await staff.waitForFunction(()=>hasVerifiedAccess()&&!loadAllInFlight);
    assert.equal(await staff.evaluate(()=>session.employeeId),'visual');
    await staff.locator('.nav-btn[data-view="view-cards"]').click();
    const canEdit=await staff.evaluate(()=>canEditCards());
    console.log(JSON.stringify({id:'UI-0280',build,time:new Date().toISOString(),browser:browser.version(),visible,canEdit,ms:Math.round(performance.now()-started)}));
    assert.ok(canEdit,'Форма обещает право на редактирование, действующая роль его не даёт');
   } else {
    assert.ok(await p.locator('#ef-name').isVisible());
    console.log(JSON.stringify({id:'UI-0280',build,time:new Date().toISOString(),browser:browser.version(),visible,ms:Math.round(performance.now()-started)}));
   }
   return;
  }
  await act('ef-name',f=>f.fill('Учебный чертёжник'));
  await act('ef-pin',f=>f.fill('123456'));
  const generator=p.locator('#ef-pin-field button');
  const t=performance.now();await generator.click();const pin=await p.locator('#ef-pin').inputValue();assert.match(pin,/^[0-9]{6}$/);
  stats.generator={ms:Math.round(performance.now()-t),width:Math.round((await generator.boundingBox()).width)};
  await act('ef-is-salaried',f=>f.check());await act('ef-fixed-salary',f=>f.fill('33333.35'));
  await act('ef-save',f=>f.click());await p.waitForFunction(()=>!loadAllInFlight&&__db.employees.find(e=>e.id==='visual').name==='Учебный чертёжник');
  const row=await p.evaluate(()=>__db.employees.find(e=>e.id==='visual'));
  assert.equal(row.fixed_salary,33333.35);assert.equal(row.pin_code,pin);assert.equal(row.is_salaried,true);
  await open();await act('empSheetClose',f=>f.click());assert.ok(await p.locator('#empSheetOverlay').isHidden());
  await open();await p.locator('#ef-name').fill('Не сохранить');p.on('dialog',d=>d.accept());
  await act('ef-cancel',f=>f.click());assert.equal(await p.evaluate(()=>__db.employees.find(e=>e.id==='visual').name),'Учебный чертёжник');
  await open();await act('ef-delete',f=>f.click());await p.waitForFunction(()=>!loadAllInFlight&&__db.employees.find(e=>e.id==='visual').active===false);
  assert.ok(await p.evaluate(()=>__db.projects[0].employee_id==='visual'&&!__db.employees.find(e=>e.id==='visual').deleted_at));
  console.log(JSON.stringify({stats,build,time:new Date().toISOString(),browser:browser.version()}));
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
