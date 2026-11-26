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



  const errors=[];p.on('pageerror',err=>errors.push(err.message));
  await p.locator('.nav-btn[data-view="view-more"]').click();
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

  await check('UI-0290','openCompanyBtn',click,async()=>assert.ok(await p.locator('#view-company').isVisible()));
  const fields=[
   [252,'full-name','full_name','Учебная проектная компания'],[253,'short-name','short_name','Учебный проект'],
   [254,'director','director','Тестовый Директор'],[255,'inn','inn','0000000010'],[256,'kpp','kpp','000000002'],
   [257,'ogrn','ogrn','0000000000003'],[258,'tax-system','tax_system','УСН'],
   [259,'legal-addr','legal_address','Учебный переулок 1'],[260,'office-addr','office_address','Учебная площадь 2'],
   [261,'phone','phone','+7 000 000-00-01'],[262,'email','email','office@example.invalid'],
   [267,'card-number','card_number','0000 0000 0000 0001'],[268,'card-holder','card_holder','ТЕСТОВЫЙ ПОЛУЧАТЕЛЬ'],
   [269,'card-bank','card_bank','Учебный банк']
  ];
  const pending=[];
  for(const [id,key,column,value] of fields){
   const el=p.locator('#co-'+key);await el.scrollIntoViewIfNeeded();
   const box=await el.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391);
   const start=performance.now();await el.fill(value);
   await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   pending.push({id:'UI-'+String(id).padStart(4,'0'),column,value,width:Math.round(box.width),ms:Math.round(performance.now()-start)});
  }
  const start=performance.now();await p.locator('#companySaveBtn').click();
  await p.waitForFunction(()=>state.companyInfo?.email==='office@example.invalid'&&!loadAllInFlight);
  const savedMs=Math.round(performance.now()-start);
  const stored=await p.evaluate(()=>({data:__db.company_info[0],office:getKpData().officeAddr,ledger:__db.ledger_entries.length}));
  assert.equal(stored.office,'Учебная площадь 2');assert.equal(stored.ledger,0);
  for(const row of pending){
   assert.equal(stored.data[row.column],row.value);
   console.log(JSON.stringify({...row,build,browser:browser.version(),time:new Date().toISOString(),savedMs,pass:true}));
  }
  await check('UI-0251','companyBack',click,async()=>assert.ok(await p.locator('#view-more').isVisible()));
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
