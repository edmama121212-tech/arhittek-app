'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
async function run(){
 const mode=process.argv[2];
 assert.ok(['conflict','correction','amount'].includes(mode));
 const conflict=mode==='conflict';
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
   __db.projects=[{id:'qa',name:'Учебная стройка',category_id:'build',status_id:'active',expenses:125,advance:0,balance:0,price:1000}];
   __db.invoices=[{id:'doc',number:'М-01',project_id:'qa',invoice_date:financeToday(),item_type:'Материал',amount:125,paid_by_client:false,category:'Поставка',description:'Черновик'}];__db.ledger_entries=[];await loadAll();
  });
  await p.locator('.nav-btn[data-view="view-construction"]').click();
  await p.locator('.obj-card').filter({hasText:'Учебная стройка'}).click();
  await p.locator('#objTabs').getByRole('button',{name:/Материалы/}).click();await p.locator('#objInvList .inv-row').click();
  const sheet=p.locator('#invoiceSheetOverlay'),stats={};
  const frames=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  async function change(key,action){
   const field=sheet.locator('#invSheet-'+key);await field.scrollIntoViewIfNeeded();
   const box=await field.boundingBox();assert.ok(box.width>0&&box.x>=0&&box.x+box.width<=391);
   const t=performance.now();await action(field);await frames();stats[key]=Math.round(performance.now()-t);
  }
  if(mode==='correction'){
   await change('number',f=>f.fill('АКТ-24'));await change('type',f=>f.selectOption('Работа'));
   await change('category',f=>f.fill('Монтаж'));await change('paid-client',f=>f.check());
  }
  if(mode==='amount')await change('amount',f=>f.fill('219.48'));
  if(conflict)await change('desc',f=>f.fill('Монтаж перегородки'));
  if(conflict)await p.evaluate(()=>{__db.invoices[0].amount=225;__db.projects[0].expenses=225;});
  const t=performance.now();await sheet.getByRole('button',{name:/Сохранить/}).click();
  await p.waitForFunction(()=>!invoiceSheetSavesInFlight.size&&!loadAllInFlight);await frames();
  const ms=Math.round(performance.now()-t);
  const actual=await p.evaluate(()=>({row:__db.invoices[0],total:__db.projects[0].expenses,ledger:__db.ledger_entries.length,msg:document.querySelector('#toast').textContent}));
  let error='';
  try{
   assert.equal(actual.ledger,0);
   if(conflict){
    assert.equal(actual.row.amount,225);assert.equal(actual.total,225);assert.equal(actual.row.description,'Черновик');
    assert.match(actual.msg,/изменена|обновите/i);assert.equal(await sheet.locator('#invSheet-desc').inputValue(),'Монтаж перегородки');
   }else if(mode==='amount'){
    assert.equal(actual.row.amount,219.48);
    assert.equal(actual.total,219.48);
    const lines=p.locator('#objSummary .fee-row');
    for(const text of ['Накладные на материалы','Оплата накладных не подтверждена']){
     assert.match(await lines.filter({hasText:text}).first().innerText(),/219,48/);
    }
    assert.match(await lines.filter({hasText:'Выплачено из денег объекта'}).innerText(),/0 ₽/);
   }else{
    assert.deepEqual([actual.row.number,actual.row.item_type,actual.row.category,actual.row.description,actual.row.paid_by_client,actual.total],['АКТ-24','Работа','Монтаж','Черновик',true,125]);
    await p.locator('#objTabs').getByRole('button',{name:/Работы/}).click();
    const row=p.locator('#objInvList .inv-row');const text=await row.innerText();
    for(const part of ['АКТ-24','Работа','Монтаж','Черновик','Оплачено заказчиком'])assert.ok(text.includes(part));
    const summary=p.locator('#objSummary .fee-row').filter({hasText:'Заказчик оплатил поставщикам напрямую'});assert.match(await summary.innerText(),/125/);
    if(process.env.QA_SHOT)await row.screenshot({path:process.env.QA_SHOT});
   }
  }catch(e){error=e.message;}
  const data={build,time:new Date().toISOString(),browser:browser.version(),mode,stats,ms,
   actual:{amount:actual.row.amount,total:actual.total,ledger:actual.ledger,desc:actual.row.description,notice:actual.msg},passed:!error};
  console.log(JSON.stringify(data));if(error)throw Error(error);
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
