'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),day='2026-11-20';
const p=(id,price,advance=0,extra={})=>({id,name:id,price,advance,category_id:'design',...extra});
const invoice=(amount,extra={})=>({id:'bill',project_id:'Эскиз',amount,invoice_date:day,...extra});
const cost=(remaining,extra={})=>({project_id:'Эскиз',direction:'expense',origin:'plan',remaining,...extra});
const cases=[
 ['Увидеть нехватку по сданному договору',[p('Эскиз',350,350,{status_id:'done'})],[],[cost(25.50)],0,25.50],
 ['Открыть прогноз до первого договора',[],[],[],0,0],
 ['Увидеть долг по договору без графика',[p('Эскиз',300.05)],[],[],300.05,0],
 ['Учесть полученный аванс',[p('Эскиз',1200,455.05)],[],[],744.95,0],
 ['Учесть оставшуюся сумму накладной',[p('Эскиз',1000)], [invoice(450)],[],1000,450],
 ['Отделить накладную оплачиваемую клиентом',[p('Эскиз',900)], [invoice(450,{paid_by_client:true})],[],900,0],
 ['Сверить частично оплаченную накладную',[p('Эскиз',500)], [invoice(250)],[],500,209.65,[{type:'project_expense',project_id:'Эскиз',amount:40.35,description:'Поставка [invoice-payment:bill]',entry_date:day}]],
 ['Не сложить дважды резерв и связанную накладную',[p('Эскиз',1000)], [invoice(200)], [cost(200,{origin:'funded'})],1000,200],
 ['Оставить отдельный расход сверх обеспеченной накладной',[p('Эскиз',350)], [invoice(105)], [cost(105,{origin:'funded'}),cost(85)],350,190],
 ['Посчитать общий итог двух договоров',[p('Эскиз',110),p('Надзор',80)],[],[cost(140)],190,140],
 ['Исключить строительный договор из проектного отдела',[p('Эскиз',100),p('Стройка',10000,0,{category_id:'build'})],[],[],100,0],
 ['Отделить будущий приход от уже отражённого долга',[p('Эскиз',240)],[],[cost(240,{direction:'income',due_date:day})],240,0],
 ['Сохранить учёт старого объекта без отдела по накладной',[p('Объект до разбивки',1300,0,{category_id:null})],[invoice(160,{project_id:'Объект до разбивки'})],[],0,0],
 ['Показать полностью рассчитанный договор без открытых выплат',[p('Эскиз',450,450)],[],[],0,0]
];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox']});
 const rows=[['ID','Сборка index/finance','Цель','Исходные данные','Шаги','Результат и связи','Открытие до двух кадров, мс','Вид и удобство','Стенд','Статус']];
 const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex').slice(0,12);
 const build=hash('index.html')+'/'+hash('finance-workspace.js');
 const value=txt=>Number(txt.replace(/[\s₽]/gu,'').replace(',','.'));
 try{
  for(const [task,projects,invoices,items,debt,costs,ledger=[]] of cases){
   const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',locale:'ru-RU'});
   try{
    await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
    await ctx.route('**/*',route=>{
     const url=new URL(route.request().url()),file=path.join(root,url.pathname==='/'?'index.html':url.pathname);
     return url.hostname==='app.test'&&fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({body:''});
    });
    const page=await ctx.newPage();
    await page.goto('https://app.test/');
    await page.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);
    await page.evaluate(async({projects,invoices,items,ledger,day})=>{
     Object.assign(__db,{projects,invoices,ledger_entries:ledger});
     const balances={reserve:6000};
     window.__journal={version:1,active:true,revision:1,balances,operations:[],workspace:{version:2,active:true,revision:1,as_of:day,cash:6000,reserve:6000,balances,items,wallets:[{id:'safe',name:'Сейф',is_default:true,active:true,balance:6000}],forecast:Array(91).fill({})}};
     await loadAll();
    },{projects,invoices,items,ledger,day});
    await page.locator('#nav-finance').click();
    const fw=page.locator('#financeWorkspace'),home=fw.locator('.studio-money-grid article').filter({hasText:'Сейф'}).locator('strong');
    const initial=await home.innerText(),writes=await page.evaluate(()=>__writes.length);
    await fw.locator('[data-fw-tab=more]').click();
    const t=performance.now();await fw.getByRole('button',{name:'Прогноз по проектам'}).click();
    const summary=fw.locator('article').first(),details=fw.locator('article').filter({has:page.locator('h3')});
    const sum=debt-costs,headline=sum<0?'Предстоящие выплаты превышают поступления':'Ожидаемый чистый остаток';
    assert.equal(await summary.locator('.fw-row span').innerText(),headline,task);
    assert.equal(value(await summary.locator('.fw-row strong').innerText()),Math.round(Math.abs(sum)*100)/100,task+' '+await fw.innerText());
    let actualDebt=0,actualCosts=0;
    for(const card of await details.all()){
     const nums=(await card.locator('.fw-row strong').allTextContents()).map(value);
     actualDebt+=Math.round(nums[0]*100);actualCosts+=Math.round(nums[1]*100);
     assert.equal(nums[2],Math.round(Math.abs(nums[0]-nums[1])*100)/100);
    }
    assert.equal(actualDebt,Math.round(debt*100),task);assert.equal(actualCosts,Math.round(costs*100),task);
    if(debt===0&&costs===0)assert.ok(await fw.getByText('Открытых поступлений и выплат по проектам нет.').isVisible());
    if(task.includes('строительный'))assert.equal(await fw.getByRole('heading',{name:'Стройка'}).count(),0);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const ms=Math.round(performance.now()-t);assert.ok(await fw.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    if(process.env.FORECAST_SHOT&&task===cases[0][0])await fw.screenshot({path:process.env.FORECAST_SHOT});
    await fw.locator('[data-fw-tab=overview]').click();assert.equal(await home.innerText(),initial);assert.equal(await page.evaluate(()=>__writes.length),writes);
    rows.push(['UI-0331',build,task,JSON.stringify({projects,invoices,items,ledger}),'Финансы → Ещё → Прогноз по проектам → сверить детализацию → Финансы','Долг '+debt+' ₽, выплаты '+costs+' ₽. '+headline+' '+Math.abs(sum).toFixed(2)+' ₽. Сейф '+initial+', записей 0.',ms,'Детализация помещается при ширине 390 px. '+(sum<0?'Нехватка отмечена отдельной подписью.':debt||costs?'Итог можно сверить со строками проектов.':'Причина пустого списка видна.'),'Chromium '+browser.version()+' '+new Date().toISOString(),'Пройдено']);
   }finally{await ctx.close();}
  }
 }finally{await browser.close();}
 if(process.env.FORECAST_CSV)fs.writeFileSync(process.env.FORECAST_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('14 project forecast journeys passed');
})().catch(e=>{console.error(e);process.exitCode=1});
