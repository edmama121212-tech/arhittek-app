'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),index=fs.readFileSync(path.join(root,'index.html'));
const hash=crypto.createHash('sha256').update(index).digest('hex').slice(0,16);
const cases=[
 ['Изменить смету до первого поступления',[],0,0],
 ['Расширить смету после аванса',[['advance',230]],230,230],
 ['Пересогласовать цену после покупки расходников',[['advance',400],['project_expense',125.35]],400,274.65],
 ['Снизить цену после окончательного платежа',[['advance',200],['final_payment',300]],500,500],
 ['Сохранить переданный целевой бюджет',[['materials_budget',315.6],['withdrawal',125.55]],315.6,190.05],
 ['Сохранить остаток после возврата заказчику',[['construction_budget',500],['client_refund',120]],500,380],
 ['Уточнить смету при начисленном гонораре',[['advance',225],['role_payout',75]],225,225],
 ['Проверить бюджет после выплаты гонорара',[['income',225],['fee_payment',75]],225,150],
 ['Отменить правку объекта с неоплаченной накладной',[['advance',650]],650,650,'invoice'],
 ['Исправить смету после покупки заказчиком напрямую',[['advance',275]],275,275,'direct'],
 ['Не включить в бюджет отменённый расход',[['advance',300],['expense',95,'deleted']],300,300],
 ['Сохранить старый объект без направления',[['advance',120],['expense',30]],120,90,'legacy']
];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const rows=[['Элемент','Сборка index SHA256','Сценарий','Шаги','Итог и связанные разделы','Открытие редактора, мс','Сохранение/отмена, мс','Визуально и удобно','Chromium / UTC','Статус']];
 try{
  for(const [i,[title,lines,received,balance,mode]] of cases.entries()){
   const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',locale:'ru-RU'});
   try{
    await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
    await ctx.route('**/*',route=>{const u=new URL(route.request().url()),f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));return u.hostname==='object.test'&&fs.existsSync(f)&&fs.statSync(f).isFile()?route.fulfill({path:f}):route.fulfill({body:'',contentType:'text/javascript'});});
    const p=await ctx.newPage();p.setDefaultTimeout(5000);await p.goto('https://object.test/');await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
    await p.evaluate(async({lines,mode,received,balance})=>{
     __db.projects=[{id:'obj',name:'Площадка',category_id:mode==='legacy'?null:'build',status_id:'active',fee_base:'price',price:1000,advance:received,balance,updated_at:'2025-01-01T00:00:00Z'}];
     __db.ledger_entries=lines.map(([type,amount,removed],i)=>({id:'l'+i,project_id:'obj',type,amount,entry_date:'2026-01-02',deleted_at:removed?'2026-01-03T00:00:00Z':null}));
     __db.invoices=mode?[{id:'inv',project_id:'obj',item_type:'Материал',amount:185.35,invoice_date:'2026-01-03',paid_by_client:mode==='direct'}]:[];
     await loadAll();
    },{lines,mode,received,balance});
    const data=()=>p.evaluate(()=>JSON.stringify([__db.ledger_entries,__db.invoices]));const before=await data();
    const enter=async()=>{await p.locator('.nav-btn[data-view="view-construction"]').click();await p.locator('#constructionList').getByText('Площадка',{exact:true}).click();};
    const edit=p.locator('#objEditBtn'),sum=p.locator('#pf-balance'),price=p.locator('#pf-price'),overlay=p.locator('#projectSheetOverlay');
    const cash=async()=>Number((await p.locator('#objSummary .fee-row').filter({hasText:'Деньги объекта по журналу'}).locator('.fv').innerText()).replace(/[^\d,.-]/g,'').replace(',','.'));
    await enter();assert.equal(await cash(),balance);
    const amountOf=async element=>Number((await element.innerText()).replace(/[^\d,.-]/g,'').replace(',','.'));
    if(i===4)assert.equal(await amountOf(p.locator('#objIncomeHistoryBlock .li-name').first()),315.6,'история одного поступления');
    if(i===2)assert.equal(await amountOf(p.locator('#objSummary .fee-row').filter({hasText:'Расходы без накладной'}).locator('.fv')),125.35);
    if(mode==='direct')assert.equal(await amountOf(p.locator('#objSummary .fee-row').filter({hasText:'Заказчик оплатил поставщикам напрямую'}).locator('.fv')),185.35);
    const box=await edit.boundingBox();assert.ok(box&&box.width>40&&box.x>=0&&box.x+box.width<=391);
    let t=performance.now();await edit.click();await p.locator('#project-tab-money').click();await price.waitFor();const open=Math.round(performance.now()-t);
    assert.equal(Number(await sum.inputValue()),balance);assert.equal(Number(await p.locator('#pf-advance').inputValue()),received);
    const next=i===3?420:1200+i;await price.fill(String(next));assert.equal(Number(await sum.inputValue()),balance,title+' после изменения цены');
    assert.equal(await sum.getAttribute('title'),'Полученные деньги минус выплаты из бюджета объекта');
    if(i===2&&process.env.OBJECT_EDIT_SHOT)await sum.locator('xpath=ancestor::div[contains(@class,"accent-block")]').screenshot({path:process.env.OBJECT_EDIT_SHOT});
    t=performance.now();await p.locator(mode==='invoice'?'#pf-cancel':'#pf-save').click();await overlay.waitFor({state:'hidden'}).catch(async error=>{throw new Error(title+' / '+await p.locator('#toast').innerText()+' / '+error.message);});const saved=Math.round(performance.now()-t);
    await enter();assert.equal(await cash(),balance);await edit.click();await p.locator('#project-tab-money').click();
    assert.equal(Number(await price.inputValue()),mode==='invoice'?1000:next);assert.equal(Number(await sum.inputValue()),balance);assert.equal(await data(),before);
    let contractObservation='';
    if(i<2){
     await p.locator('#pf-cancel').click();
     const oldBalance=i===0?999:null;
     await p.evaluate(async stored=>{
      __db.projects.push({id:'old',name:'Старый договор',category_id:'arch',status_id:'active',price:1000,advance:200,balance:stored});
      await loadAll();
     },oldBalance);
     await p.locator('.nav-btn[data-view="view-projects"]').click();
     await p.locator('#projectsCard .proj-row').filter({hasText:'Старый договор'}).click();
     await p.locator('#project-tab-money').click();
     assert.equal(await sum.inputValue(),'800');
     assert.match(await p.locator('#project-economy .project-metric').filter({hasText:'Долг клиента'}).innerText(),/800/);
     assert.equal(await p.evaluate(()=>__db.projects.find(x=>x.id==='old').balance),oldBalance);
     contractObservation=' Дополнительно открыт старый договор: поле и сводка показали 800 ₽, сохранённое значение '+(oldBalance??'пусто')+' осталось прежним.';
    }
    rows.push(['UI-0095',hash,title,'Стройка → Площадка → Редактировать → Деньги → изменить цену 1000 на '+next+' ₽ → '+(mode==='invoice'?'Отмена':'Сохранить')+' → снова открыть объект и редактор','Получено '+received+' ₽. Бюджет до и после правки '+balance+' ₽. Итоговая цена '+(mode==='invoice'?1000:next)+' ₽. Журнал и накладные не изменились.'+contractObservation,open,saved,'Кнопка видна на 390 px. В поле и сводке объекта совпадает остаток по журналу.',browser.version()+' / '+new Date().toISOString(),'Пройдено']);
   }finally{await ctx.close();}
  }
 }finally{await browser.close();}
 if(process.env.OBJECT_EDIT_CSV)fs.writeFileSync(process.env.OBJECT_EDIT_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('12 object editor balance journeys passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
