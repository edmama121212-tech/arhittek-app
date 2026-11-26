'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
const cases=[
  ['Аванс без пояснения','advance','','Аванс получен'],
  ['Закрытие долга по акту','final_payment','  По акту № 17  ','По акту № 17'],
  ['Средства на материалы','materials_budget','Кирпич & доставка'],
  ['Вывод с длинным банковским номером','withdrawal','Банк № '+'0123456789'.repeat(7)],
  ['Вывод без причины','withdrawal','   ','','invalid'],
  ['Исправление назначения до выдачи','withdrawal','Выезд на объект',undefined,'edit'],
  ['Переход от аванса к выплате исполнителю','fee_payment','За эскиз',undefined,'switch'],
  ['Архивная оплата с неизвестной датой','advance','Оплачено до сверки',undefined,'historical'],
  ['Отмена черновика с причиной','withdrawal','Отозванная заявка','','cancel'],
  ['Сохранение пояснения после ошибки ввода суммы','advance','Аванс по приложению № 3',undefined,'retry'],
  ['Вторая оплата с другим назначением','advance','Второй этап',undefined,'second']
];
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function run(){
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
 const report=[['Элемент','SHA256 index','UTC / Chromium','Бизнес-сценарий','Шаги','Результат и связи','Ввод до отрисовки, мс','Действие до результата, мс','Вид и удобство','Итог']];
 try{
  for(const [goal,type,raw,expected=raw,mode] of cases){
   const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
   try{
    await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
    await ctx.route('**/*',route=>{
     const u=new URL(route.request().url()),file=path.join(root,u.pathname==='/'?'index.html':u.pathname);
     return u.hostname==='qa.test'&&fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({body:''});
    });
    const p=await ctx.newPage();p.setDefaultTimeout(4000);
    await p.goto('https://qa.test/');await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);
    await p.evaluate(async()=>{
     __db.projects=[{id:'qa',name:'Учебный договор',category_id:'arch',status_id:'active',employee_id:'architect',price:150,advance:100,balance:50,fee_paid:0,fee_base:'profit'}];
     __db.ledger_entries=[];await loadAll();
    });
    await p.locator('.nav-btn[data-view="view-projects"]').click();await p.locator('#projectsCard .proj-row').click();
    await p.locator('#project-tab-money').click();
    const launch=p.locator('#pf-add-payment'),sheet=p.locator('#paymentSheetOverlay'),field=sheet.locator('#payment-note');
    const amount=sheet.locator('#payment-amount'),save=sheet.locator('#payment-save');
    await launch.click();
    if(mode==='second'){
     await amount.fill('1');await field.fill('Первый этап');await save.click();await sheet.waitFor({state:'hidden'});await p.waitForFunction(()=>!paymentSaveInFlight);
     await launch.click();assert.equal(await field.inputValue(),'');
    }
    if(mode!=='switch')await sheet.locator('[data-value="'+type+'"]').click();
    if(mode==='historical')await sheet.locator('#payment-before-start').check();
    if(mode==='edit')await field.fill('Ошибочная причина');
    const start=performance.now();await field.fill(raw);await frames(p);const inputMs=Math.round(performance.now()-start);
    const box=await field.boundingBox();assert.ok(box.width>150&&box.x>=0&&box.x+box.width<=391);
    if(mode==='switch'){await sheet.locator('[data-value="'+type+'"]').click();assert.equal(await field.inputValue(),raw);}
    if(mode==='retry'){
     await save.click();await p.locator('#toast').filter({hasText:'Укажите сумму'}).waitFor();assert.equal(await field.inputValue(),raw);
    }
    await amount.fill('50');
    const t=performance.now();
    if(mode==='cancel')await sheet.locator('#paymentSheetClose').click();else await save.click();
    if(mode==='invalid'){
     await p.locator('#toast').filter({hasText:/причину/}).waitFor();await sheet.locator('#paymentSheetClose').click();
    }
    await sheet.waitFor({state:'hidden'});await p.waitForFunction(()=>!paymentSaveInFlight&&!loadAllInFlight);await frames(p);
    const elapsed=Math.round(performance.now()-t);
    const posted=!['invalid','cancel'].includes(mode),incoming=posted&&!['fee_payment','withdrawal'].includes(type);
    const actual=await p.evaluate(()=>({entries:__db.ledger_entries.filter(e=>!e.deleted_at),project:__db.projects[0]}));
    const entries=actual.entries;assert.deepEqual(entries.map(e=>e.description),!posted?[]:mode==='second'?['Первый этап',expected]:[expected]);
    assert.equal(actual.project.balance,incoming?0:50);assert.equal(actual.project.advance,100+(incoming?50:0)+(mode==='second'?1:0));
    assert.equal(actual.project.fee_paid,type==='fee_payment'?50:0);
    if(posted)assert.equal(entries.at(-1).received_before_start,mode==='historical');
    const history=p.locator('#pf-payment-history');await history.getByText(posted?expected:'Платежей пока нет',{exact:false}).waitFor();
    assert.ok(await history.evaluate(el=>el.scrollWidth<=el.clientWidth+1),goal+' — история выходит за границу');
    if(raw.length>60&&process.env.QA_SHOT)await history.screenshot({path:process.env.QA_SHOT});
    report.push(['UI-0185',build,new Date().toISOString()+' / '+browser.version(),goal,'Карточка → Деньги → Принять платёж → '+type+' → '+goal+' → пояснение «'+raw+'» → 50 ₽ → '+(mode==='cancel'?'Закрыть':'Сохранить')+' → история',
     'Записей '+entries.length+', получено '+actual.project.advance+' ₽, долг '+actual.project.balance+' ₽, выплата исполнителю '+actual.project.fee_paid+' ₽. '+(posted?'В истории «'+expected+'».':'История пуста.'),inputMs,elapsed,'Поле '+Math.round(box.width)+' px. История в границах экрана.','Пройдено']);console.log(goal,elapsed);
   }finally{await ctx.close();}
  }
 }finally{await browser.close();}
 if(process.env.QA_CSV)fs.writeFileSync(process.env.QA_CSV,'\ufeff'+report.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
