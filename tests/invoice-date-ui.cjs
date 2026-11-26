'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
const cases=[
 ['Завтрашняя доставка вместо сегодняшней','today','future'],
 ['Поставка фактически пришла сегодня','future','today'],
 ['Исправление даты акта выполненных работ','today','yesterday','work'],
 ['Восстановление архивного документа без даты','','past'],
 ['Дата прямой оплаты заказчиком','future','today','client'],
 ['Перенос одной поставки при другой будущей накладной','yesterday','today','other-future'],
 ['Исправление даты при аннулированной соседней накладной','today','yesterday','removed'],
 ['Перенос документа при отдельном расходе на объект','today','future','manual'],
 ['Отказ от переноса на следующий день','today','future','cancel'],
 ['Попытка стереть обязательную дату','today','','invalid'],
 ['Повтор после отказа хранилища','yesterday','today','retry'],
 ['Исправление документа при поступлении второй накладной','yesterday','today','parallel']
];
async function run(){
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const csv=[['ID','SHA256 index','UTC / браузер','Сценарий','Шаги','Факт и последствия','Ввод, мс','От действия до результата, мс','Визуально и удобство','Результат']];
 try{
  for(const [goal,from,to,mode] of cases){
   const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block',reducedMotion:'reduce'});
   try{
    await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
    await ctx.route('**/*',r=>{const u=new URL(r.request().url()),f=path.join(root,u.pathname==='/'?'index.html':u.pathname);return u.hostname==='qa.test'&&fs.existsSync(f)&&fs.statSync(f).isFile()?r.fulfill({path:f}):r.fulfill({body:''});});
    const p=await ctx.newPage();p.setDefaultTimeout(5000);await p.goto('https://qa.test/');await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);
    const day=await p.evaluate(()=>financeToday());
    function shift(n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
    const dates={today:day,yesterday:shift(-1),past:'2024-02-29',future:shift(1),'':''};
    const before=dates[from],after=dates[to],extra=mode==='manual'?35:0;
    await p.evaluate(async({before,mode,day,tomorrow,extra})=>{
     __db.projects=[{id:'qa',name:'Учебная стройка',category_id:'build',status_id:'active',expenses:(before<=day?125:0)+extra,advance:0,balance:0,price:1000}];
     __db.invoices=[{id:'target',number:'ТЕСТ-01',project_id:'qa',invoice_date:before||null,item_type:mode==='work'?'Работа':'Материал',amount:125,paid_by_client:mode==='client'}];
     if(mode==='other-future'||mode==='removed')__db.invoices.push({...__db.invoices[0],id:'side',number:'Другая',amount:70,invoice_date:mode==='removed'?day:tomorrow,deleted_at:mode==='removed'?day:null});
     __db.ledger_entries=extra?[{id:'manual',project_id:'qa',type:'project_expense',amount:extra,entry_date:day}]:[];
     await loadAll();
    },{before,mode,day,tomorrow:dates.future,extra});
    await p.locator('.nav-btn[data-view="view-construction"]').click();await p.locator('.obj-card').filter({hasText:'Учебная стройка'}).click();
    await p.locator('#objTabs').getByRole('button',{name:mode==='work'?/Работы/:/Материалы/}).click();
    const target=p.locator('#objInvList .inv-row').filter({hasText:'ТЕСТ-01'});await target.click();
    const sheet=p.locator('#invoiceSheetOverlay'),field=sheet.locator('#invSheet-date');assert.equal(await field.inputValue(),before);
    const frames=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    let t=performance.now();await field.fill(after);await frames();const input=Math.round(performance.now()-t);
    assert.equal(await sheet.locator('#invSheet-date-hint').isVisible(),after>day);
    const box=await field.boundingBox();assert.ok(box.width>0&&box.x>=0&&box.x+box.width<=391);
    if(mode==='parallel')await p.evaluate(day=>__db.invoices.push({id:'concurrent',number:'ТЕСТ-02',project_id:'qa',item_type:'Материал',amount:30,invoice_date:day}),day);
    if(mode==='retry')await p.evaluate(()=>{__fail={table:'invoices',op:'update'};});
    const save=sheet.getByRole('button',{name:/Сохранить/}),close=sheet.locator('button[onclick="closeInvoiceSheet()"]').first();
    t=performance.now();
    if(mode==='cancel')await close.click();else await save.click();
    if(mode==='invalid'){await p.locator('#toast').filter({hasText:'Укажите дату накладной'}).waitFor();await close.click();}
    if(mode==='retry'){await p.locator('#toast').filter({hasText:/Ошибка сохранения/}).waitFor();assert.equal(await field.inputValue(),after);await p.evaluate(()=>{__fail=null;});await save.click();}
    await sheet.waitFor({state:'hidden'});await p.waitForFunction(()=>!invoiceSheetSavesInFlight.size&&!loadAllInFlight);await frames();
    const elapsed=Math.round(performance.now()-t);
    const saved=['invalid','cancel'].includes(mode)?before:after,expected=(saved<=day?125:0)+extra+(mode==='parallel'?30:0);
    const actual=await p.evaluate(()=>({expenses:__db.projects[0].expenses,date:__db.invoices[0].invoice_date,ledger:__db.ledger_entries.length}));
    assert.equal(actual.date,saved);assert.equal(actual.expenses,expected,goal);assert.equal(actual.ledger,extra?1:0);
    const shown=await p.locator('#objSummary .fee-row').filter({hasText:mode==='work'?'Накладные на работы':'Накладные на материалы'}).locator('.fv').textContent();
    assert.equal(Number(shown.replace(/[^\d,-]/g,'').replace(',','.')),expected-extra);
    await target.click();assert.equal(await field.inputValue(),saved);
    if(from==='today'&&mode===undefined&&process.env.QA_SHOT)await field.locator('xpath=../..').screenshot({path:process.env.QA_SHOT});
    if(mode==='other-future'){
     p.once('dialog',d=>d.accept());
     await sheet.getByRole('button',{name:/Удалить/}).click();
     await sheet.waitFor({state:'hidden'});
     assert.equal(await p.evaluate(()=>__db.projects[0].expenses),0);
     assert.equal(await p.evaluate(()=>__db.invoices.length),1);
    }
    csv.push(['UI-0081',build,new Date().toISOString()+' / '+browser.version(),goal,'Стройка → Учебная стройка → '+(mode==='work'?'Работы':'Материалы')+' → ТЕСТ-01 → дата '+(before||'без даты')+' → '+(after||'очистить')+' → '+(mode==='cancel'?'Закрыть':mode==='invalid'?'Сохранить → предупреждение → Закрыть':mode==='retry'?'Сохранить → отказ → повторить':'Сохранить')+' → сводка → открыть документ', 'Дата '+saved+', расходы проекта '+expected+' ₽, документы в сводке '+shown+', записей денежного журнала '+actual.ledger+'.'+(mode==='other-future'?' После удаления текущей накладной осталась только будущая, текущие расходы 0 ₽.':''),input,elapsed,'Поле '+Math.round(box.width)+' px внутри экрана, результат виден в сводке и при повторном открытии.','Пройдено']);console.log(goal,elapsed);
   }finally{await ctx.close();}
  }
 }finally{await browser.close();}
 if(process.env.QA_CSV)fs.writeFileSync(process.env.QA_CSV,'\ufeff'+csv.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
