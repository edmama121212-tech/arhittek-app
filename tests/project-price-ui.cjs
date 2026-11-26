'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'));
const build=crypto.createHash('sha256').update(index).digest('hex').slice(0,16);
const cases=[
 ['cent','Показать последнюю копейку до сохранения',500,399.99,400],
 ['contract','Согласовать стоимость после бесплатной оценки',0,0,7400],
 ['extra','Добавить авторский надзор к частично оплаченному договору',1000,400,1800],
 ['discount','Уменьшить смету на копейки после аванса',1000,200,715.35],
 ['match','Закрыть долг скидкой до суммы аванса',1000,600,600],
 ['credit','Снизить цену ниже уже принятой суммы',1000,650,620],
 ['reopen','Добавить этап к ранее оплаченному проекту',1000,1000,1250],
 ['zero','Перевести неоплаченный заказ в бесплатный',300,0,0],
 ['undo','Отменить черновое повышение цены',500,200,560],
 ['negative','Сохранить цену при ошибочном минусе',800,50,-60],
 ['fraction','Не записывать доли меньше одной копейки',800,50,800.125],
 ['retry','Исправить лишний знак и согласовать цену',800,50,760.145],
 ['race','Сохранить параллельное согласование цены коллегой',800,50,750]
];
const debt=(price,received)=>Math.max(0,Math.round(price*100)-Math.round(received*100))/100;
const status=(price,received)=>price>0&&received>=price?'Оплачен':received>0?'Частично оплачен':'Ждём оплату';
const valueOf=text=>Number(text.replace(/[^\d,.-]/g,'').replace(',','.'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const rows=[['Элемент','Сборка SHA256 index','UTC / Chromium','Бизнес-сценарий','Шаги','Факт и связанные записи','Отклик до результата, мс','Визуально и удобство','Итог']];
 try{
  for(const [mode,task,old,advance,next] of cases){
   const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block',reducedMotion:'reduce'});
   try{
    await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
    await ctx.route('**/*',route=>{const u=new URL(route.request().url()),file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));return u.hostname==='app.test'&&fs.existsSync(file)?route.fulfill(u.pathname==='/'?{body:index,contentType:'text/html'}:{path:file}):route.fulfill({body:''});});
    const p=await ctx.newPage(),errors=[];p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));
    await p.goto('https://app.test/');await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
    const stored={id:'p',name:'Учебный договор',category_id:'arch',status_id:'active',price:old,advance,balance:debt(old,advance),payment_status:status(old,advance),fee_base:'profit',updated_at:'2025-01-01T00:00:00Z'};
    await p.evaluate(async project=>{__db.projects=[project,{...project,id:'side',name:'Соседний проект'}];__db.audit_log=[];__db.ledger_entries=[];await loadAll();},stored);
    await p.locator('.bottom-nav [data-view="view-projects"]').click();
    const row=p.locator('#projectsCard .proj-row').filter({hasText:'Учебный договор'}),price=p.locator('#pf-price'),save=p.locator('#pf-save'),cancel=p.locator('#pf-cancel'),summary=p.locator('#project-economy .project-metric').filter({hasText:'Долг клиента'}).locator('strong');
    await row.click();await p.getByRole('tab',{name:'Деньги',exact:true}).click();await price.fill(String(next));
    const visual=await price.evaluate(e=>({width:e.clientWidth,section:e.closest('section').scrollWidth,available:e.closest('section').clientWidth}));
    assert.ok(visual.width>30&&visual.section<=visual.available+1);
    let steps='Проекты → Учебный договор → Деньги → цена '+old+' → '+next+' ₽ при авансе '+advance+' ₽',result='';
    const invalid=['negative','fraction','retry'].includes(mode);
    if(!invalid){
     assert.equal(Number(await p.locator('#pf-balance').inputValue()),debt(next,advance),'Предпросмотр долга');
     assert.equal(valueOf(await summary.innerText()),debt(next,advance),'Сводка денег в карточке');
    }
    if(mode==='cent'&&process.env.PROJECT_PRICE_SHOT)await p.locator('#project-economy').screenshot({path:process.env.PROJECT_PRICE_SHOT});
    if(mode==='race')await p.evaluate(()=>Object.assign(__db.projects[0],{price:900,balance:850,updated_at:new Date().toISOString()}));
    let finalPrice=next;
    const t=performance.now();
    if(mode==='undo'){await cancel.click();finalPrice=old;steps+=' → Отмена';}
    else{
     await save.click();steps+=' → Сохранить';
     if(invalid){
      await p.locator('#toast').filter({hasText:mode==='negative'?/отрицательн/:/копе/}).waitFor();
      assert.equal(await p.evaluate(()=>__db.projects[0].price),old);assert.equal(await price.inputValue(),String(next));
      if(mode==='retry'){finalPrice=760.14;await price.fill(String(finalPrice));await save.click();steps+=' → исправить на 760,14 ₽ → Сохранить';}
      else{finalPrice=old;await cancel.click();steps+=' → сообщение об ошибке → Отмена';}
     }else if(mode==='race'){
      await p.locator('#toast').filter({hasText:/Данные обновились/}).waitFor();await cancel.click();await p.evaluate(()=>loadAll());finalPrice=900;steps+=' → конфликт → закрыть и обновить';
     }
    }
    await p.locator('#projectSheetOverlay').waitFor({state:'hidden'});await p.waitForFunction(()=>!loadAllInFlight);
    await p.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    const ms=Math.round(performance.now()-t),after=await p.evaluate(()=>({project:__db.projects[0],side:__db.projects[1],entry:__db.ledger_entries,log:__db.audit_log.filter(x=>x.changes?.price)}));
    assert.equal(after.project.price,finalPrice);assert.equal(after.project.balance,debt(finalPrice,advance));assert.equal(after.project.advance,advance);assert.equal(after.project.payment_status,status(finalPrice,advance));assert.equal(after.side.price,old);assert.equal(after.entry.length,0);
    assert.equal(after.log.length,mode==='race'||old===finalPrice?0:1);
    assert.equal(valueOf(await row.locator('.proj-sum').innerText()),finalPrice);
    await row.locator('.status-chip').filter({hasText:after.project.payment_status}).waitFor();
    assert.equal(valueOf(await row.locator('.proj-rest').innerText()),debt(finalPrice,advance));
    await row.click();await p.getByRole('tab',{name:'Деньги',exact:true}).click();assert.equal(Number(await price.inputValue()),finalPrice);assert.equal(valueOf(await summary.innerText()),debt(finalPrice,advance));assert.deepEqual(errors,[]);
    result='Цена '+finalPrice+' ₽; принято '+advance+' ₽; долг '+after.project.balance+' ₽; '+after.project.payment_status+'. Изменений цены в истории '+after.log.length+'; новых проводок 0. Соседний договор '+old+' ₽.';
    rows.push(['UI-0202',build,new Date().toISOString()+' / '+browser.version(),task,steps+' → список → повторно открыть карточку',result,ms,'Поле '+visual.width+' px без переполнения секции. '+(invalid?'Ошибочный ввод сохранён для исправления.':mode==='race'?'Доступна обратная связь о конфликте.':'Вкладка и список показывают денежный итог.'),'Пройдено']);
    console.log(mode,ms);
   }finally{await ctx.close();}
  }
  if(process.env.PROJECT_PRICE_CSV)fs.writeFileSync(process.env.PROJECT_PRICE_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
