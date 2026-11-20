'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),day='2026-11-19';
const cases=[
 ['switch','Начать расход другого проекта после закрытия первой карточки','Закрыть карточку с черновиком, открыть соседнюю, отменить правку её чека, повторно открыть его и подтвердить 222 ₽'],
 ['amount','Отказаться от повышения стоимости печати','Изменить сумму с 120,45 до 620 и нажать «Отмена»'],
 ['note','Сохранить исходное назначение расхода','Заменить назначение и отказаться от переименования'],
 ['period','Оставить расход в ноябрьском отчёте','Перенести расход в октябрь и отменить перенос'],
 ['past','Сохранить октябрьский расход вне ноябрьского отчёта','Выбрать архивную оплату и отменить перенос в ноябрь'],
 ['cent','Отменить списание более одной копейки','Открыть платёж на 0,01 ₽, увеличить до 100 ₽ и отменить'],
 ['invalid','Выйти после ошибки нулевой суммы','Ввести 0, попробовать сохранить, проверить сообщение и отменить'],
 ['server','Отказаться от повтора после отказа сервера','Исправить сумму, получить отказ тестового хранилища и закрыть правку'],
 ['twin','Вернуться к правильной из двух одноимённых оплат','Открыть вторую оплату «Печать», изменить описание, отменить и проверить обе суммы'],
 ['new','Добавить новый чек после отмены правки','Отменить замену прежнего чека, затем внести отдельные 70 ₽'],
 ['draft','Продолжить работу над заметкой проекта','Набрать заметку на вкладке обзора, отменить правку расхода и вернуться к заметке'],
 ['keyboard','Проверить сумму и продолжить с той же строки с клавиатуры','Раскрыть правку клавишей Enter, отменить клавишей Enter и вернуться к кнопке строки']
];
const index=fs.readFileSync(path.join(root,'index.html'));
const build=crypto.createHash('sha256').update(index).digest('hex').slice(0,16);
const rows=[['Элемент','Сборка index SHA256','Сценарий','Шаги','Результат и связанные разделы','Отмена до двух кадров, мс','Визуальная проверка','Удобство','Chromium','UTC','Итог']];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox']});
 try{
 for(const [mode,goal,steps] of cases){
  const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
  try{
   await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
   await ctx.route('**/*',route=>{
    const url=new URL(route.request().url()),file=path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
    if(url.hostname!=='app.test'||!fs.existsSync(file))return route.fulfill({body:''});
    if(url.pathname==='/')return route.fulfill({body:index,contentType:'text/html'});
    return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
   });
   const p=await ctx.newPage(),errors=[];p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));
   await p.goto('https://app.test/');
   await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
   await p.evaluate(async({day,mode})=>{
    const entry=(id,project_id,description,amount,entry_date)=>({id,type:'project_expense',project_id,description,amount,entry_date,created_at:entry_date+'T12:00:00Z'});
    __db.ledger_entries=[entry('a','one','Печать',120.45,day),entry('b','one',mode==='twin'?'Печать':'Доставка',0.01,mode==='past'?'2026-10-15':day),entry('c','two','Бумага',31,day)];
    __db.projects=[['one','Тестовый дом',120.46],['two','Тестовый сад',31]].map(([id,name,expenses])=>({id,name,category_id:'arch',status_id:'active',price:10000,expenses,created_at:day}));
    const balances={reserve:10000};
    window.__journal={version:1,active:true,revision:1,balances,operations:[],workspace:{version:2,active:true,revision:1,as_of:day,cash:10000,reserve:10000,balances,wallets:[{id:'safe',name:'Сейф',is_default:true,balance:10000}],items:[],forecast:Array(91).fill({})}};
    await loadAll();
   },{day,mode});
   const field=id=>p.locator('#pf-expense-'+id),list=p.locator('#pf-expenses-list');
   const open=async name=>{await p.locator('.nav-btn[data-view="view-projects"]').click();await p.locator('.proj-row').filter({hasText:name}).click()};
   const stateBefore=()=>p.evaluate(()=>JSON.stringify([__db.ledger_entries,__db.projects,__db.audit_log,__writes]));
   const before=await stateBefore();
   await open('Тестовый дом');
   if(mode==='draft')await p.locator('#pf-notes').fill('Передать заказчику');
   await p.locator('#project-tab-money').click();
   const target=['twin','past','cent'].includes(mode)?'b':'a';
   const opener=(id)=>list.locator('button[onclick="editProjectExpense(\''+id+'\')"]');
   await opener(target).focus();await p.keyboard.press('Enter');
   const cancel=field('cancel-edit');
   if(mode==='switch'){
    await field('desc').fill('Черновик первого объекта');
    await p.locator('#projectSheetClose').click();await open('Тестовый сад');await p.locator('#project-tab-money').click();
    assert.equal(await field('desc').inputValue(),'','Новый проект унаследовал расход первого');
    assert.ok(!await cancel.isVisible());await opener('c').click();
   }
   if(['period','past'].includes(mode))await field('date').fill(mode==='past'?day:'2026-10-01');
   else if(['twin','note'].includes(mode))await field('desc').fill('Новая запись');
   else if(mode!=='keyboard')await field('amount').fill(mode==='invalid'?'0':mode==='cent'?'100':'620');
   if(mode==='invalid'||mode==='server'){
    if(mode==='server')await p.evaluate(()=>{__fail={table:'ledger_entries',op:'update',error:{message:'Отказ в учебном хранилище'}}});
    await field('add-btn').click();await p.waitForFunction(()=>!projectExpenseSaveInFlight);
    assert.match(await p.locator('#toast').innerText(),mode==='server'?/Ошибка изменения/:/Укажите сумму/);
   }
   await cancel.scrollIntoViewIfNeeded();
   const bounds=await cancel.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=391);
   const t=performance.now();
   if(mode==='keyboard'){await cancel.focus();await p.keyboard.press('Enter')}else await cancel.click();
   await cancel.waitFor({state:'hidden'});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const ms=(performance.now()-t).toFixed(1);
   assert.equal(await field('desc').inputValue(),'');assert.equal(await field('amount').inputValue(),'');
   assert.equal(await stateBefore(),before);
   if(mode==='keyboard')assert.ok(await opener('a').evaluate(el=>el===document.activeElement));
   if(mode==='cent')assert.match(await list.innerText(),/0,01/);
   if(mode==='draft'){await p.getByRole('tab',{name:'Обзор'}).click();assert.equal(await p.locator('#pf-notes').inputValue(),'Передать заказчику');}
   if(mode==='switch'){
    await opener('c').click();await field('amount').fill('222');
    await field('add-btn').click();await p.waitForFunction(()=>!projectExpenseSaveInFlight&&!loadAllInFlight);
    assert.deepEqual(await p.evaluate(()=>__db.ledger_entries.map(r=>[r.id,r.amount])),[['a',120.45],['b',0.01],['c',222]]);
   }
   if(mode==='cent'&&process.env.EXPENSE_CANCEL_SHOT){
    await list.scrollIntoViewIfNeeded();
    await list.screenshot({path:process.env.EXPENSE_CANCEL_SHOT});
   }
   if(mode==='new'){
    await field('desc').fill('Отдельный чек');await field('amount').fill('70');await field('date').fill(day);
    await field('add-btn').click();await p.waitForFunction(()=>!projectExpenseSaveInFlight&&!loadAllInFlight);
    assert.equal(await p.evaluate(()=>__db.ledger_entries.length),4);
    assert.equal(await p.evaluate(()=>__db.ledger_entries.find(r=>r.id==='a').amount),120.45);
   }
   await p.locator('#projectSheetClose').click();await p.locator('.nav-btn[data-view="view-finance"]').click();
   const total=p.locator('#financeWorkspace .studio-money-grid article').filter({hasText:'Расходы за месяц'}).locator('strong');
   const expected=mode==='switch'?342.46:mode==='past'?151.45:mode==='new'?221.46:151.46;
   assert.equal(Number((await total.innerText()).replace(/[^\d,]/g,'').replace(',','.')),expected);
   assert.deepEqual(errors,[]);
   rows.push(['UI-0220',build,goal,steps,'Сразу после отмены исходные проводки, проекты и журнал записи прежние. '+(mode==='new'?'Новый чек добавлен отдельно. ':mode==='switch'?'После повторного редактирования изменились только 31 ₽ второго объекта на 222 ₽. ':'')+'В Финансах за ноябрь '+expected+' ₽.',ms,'Кнопка в ширине 390 px, поля после отмены пусты.',mode==='keyboard'?'Фокус вернулся к той же строке.':mode==='switch'?'При переходе виден расход выбранного объекта.':'После отмены доступно добавление нового расхода.',browser.version(),new Date().toISOString(),'PASS']);
   console.log('PASS',mode,ms);
  }finally{await ctx.close()}
 }
 }finally{await browser.close()}
 if(process.env.PROJECT_EXPENSE_CANCEL_CSV)fs.writeFileSync(process.env.PROJECT_EXPENSE_CANCEL_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
})().catch(e=>{console.error(e);process.exitCode=1});
