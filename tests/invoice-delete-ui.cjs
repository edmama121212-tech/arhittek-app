'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
const cases=[
 ['race','Коллега исправил сумму до подтверждения удаления'],
 ['material','Удалить ошибочную поставку'],
 ['work','Удалить повторный акт работ'],
 ['cancel','Сохранить документ, отклонив подтверждение'],
 ['future','Снять будущую поставку, оставив сегодняшнюю'],
 ['manual','Удалить документ, сохранив отдельный расход'],
 ['client','Отозвать накладную прямой оплаты заказчиком'],
 ['part','Защитить частично оплаченную закупку'],
 ['paid','Защитить полностью оплаченный акт'],
 ['reversed','Удалить закупку после отмены связанной оплаты'],
 ['retry','Повторить удаление после сбоя записи'],
 ['foreign','Сохранить одноимённый документ соседнего объекта'],
 ['gone','Другой сотрудник уже удалил накладную']
];
async function run(){
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const csv=[['ID','SHA256 index','UTC / браузер','Сценарий','Шаги','Факт и последствия','Открытие, мс','От действия до результата, мс','Визуально и удобство','Результат']];
 try{
  for(const [mode,goal] of cases){
   const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block',reducedMotion:'reduce'});
   try{
    const fixture=fs.readFileSync(path.join(__dirname,'mock.js'),'utf8');
    await ctx.addInitScript({content:'const nativeConfirm=window.confirm;\n'+fixture+'\nwindow.confirm=nativeConfirm;'});
    await ctx.route('**/*',r=>{const u=new URL(r.request().url()),f=path.join(root,u.pathname==='/'?'index.html':u.pathname);return u.hostname==='qa.test'&&fs.existsSync(f)&&fs.statSync(f).isFile()?r.fulfill({path:f}):r.fulfill({body:''});});
    const p=await ctx.newPage();p.setDefaultTimeout(5000);await p.goto('https://qa.test/');await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);

    const seed=await p.evaluate(async mode=>{
      const day=financeToday(),future='2099-01-01',work=['work','paid'].includes(mode);
      const project={id:'qa',name:'Учебная стройка',category_id:'build',status_id:'active',expenses:mode==='future'?30:mode==='manual'?160:125,advance:0,balance:0,price:1000};
      const inv={id:'target',number:'ТЕСТ-01',project_id:'qa',invoice_date:mode==='future'?future:day,item_type:work?'Работа':'Материал',amount:125,paid_by_client:mode==='client'};
      __db.projects=[project];__db.invoices=[inv];__db.ledger_entries=[];
      if(mode==='future')__db.invoices.push({...inv,id:'side',number:'Доставлено',invoice_date:day,amount:30});
      if(mode==='manual')__db.ledger_entries.push({id:'manual',project_id:'qa',type:'project_expense',amount:35,entry_date:day});
      if(['paid','part','reversed'].includes(mode))__db.ledger_entries.push({id:'debit',project_id:'qa',type:'expense',amount:mode==='part'?45:125,entry_date:day,description:'Оплата [invoice-payment:target]',deleted_at:mode==='reversed'?day:null});
      if(mode==='foreign'){
        __db.projects.push({...project,id:'other',name:'Соседняя стройка',expenses:600});__db.invoices.push({...inv,id:'other-doc',project_id:'other',amount:600});
      }
      await loadAll();return {ledger:JSON.stringify(__db.ledger_entries),work};
    },mode);
    await p.locator('.nav-btn[data-view="view-construction"]').click();
    await p.locator('.obj-card').filter({hasText:'Учебная стройка'}).click();
    await p.locator('#objTabs').getByRole('button',{name:seed.work?/Работы/:/Материалы/}).click();
    const target=p.locator('#objInvList .inv-row').filter({hasText:'ТЕСТ-01'}),sheet=p.locator('#invoiceSheetOverlay'),del=sheet.getByRole('button',{name:/Удалить/});
    const frames=()=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    let t=performance.now();await target.click();await del.waitFor();await frames();const openMs=Math.round(performance.now()-t);
    await del.scrollIntoViewIfNeeded();const box=await del.boundingBox();
    if(mode==='race')await p.evaluate(()=>{__db.invoices[0].amount=225;__db.projects[0].expenses=225;});
    if(mode==='gone')await p.evaluate(()=>{__db.invoices=[];__db.projects[0].expenses=0;});
    if(mode==='retry')await p.evaluate(()=>{__fail={table:'invoices',op:'delete'};});
    if(mode==='material'&&process.env.QA_SHOT)await del.locator('..').screenshot({path:process.env.QA_SHOT});
    assert.ok(await del.locator('..').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'обе кнопки внутри строки');
    const prompts=[];p.on('dialog',async d=>{prompts.push(d.message());if(mode==='cancel')await d.dismiss();else await d.accept();});
    t=performance.now();await del.click();
    if(mode==='retry'){await p.locator('#toast').filter({hasText:/Ошибка удаления/}).waitFor();assert.equal(await p.evaluate(()=>__db.invoices.length),1);await p.evaluate(()=>{__fail=null;});await del.click();}
    assert.equal(prompts.length,['part','paid'].includes(mode)?0:mode==='retry'?2:1);
    if(prompts.length){assert.match(prompts[0],/ТЕСТ-01/);assert.match(prompts[0],/125/);}
    const blocked=['part','paid','cancel','race','gone'].includes(mode);
    if(!blocked)await sheet.waitFor({state:'hidden'});
    if(['part','paid'].includes(mode))await p.locator('#toast').filter({hasText:/связанные оплаты/}).waitFor();
    if(['race','gone'].includes(mode))await p.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Накладная'));
    await p.waitForFunction(()=>!loadAllInFlight);await frames();const ms=Math.round(performance.now()-t);
    const state=await p.evaluate(()=>({docs:__db.invoices,project:__db.projects[0],neighbor:__db.projects[1],ledger:JSON.stringify(__db.ledger_entries),notice:document.querySelector('#toast').textContent}));
    const kept=blocked&&mode!=='gone',actual=state.docs.find(d=>d.id==='target');
    assert.equal(Boolean(actual),kept,goal);
    const expected=mode==='race'?225:kept?125:mode==='manual'?35:mode==='future'?30:0;
    assert.equal(state.project.expenses,expected);assert.equal(state.ledger,seed.ledger);
    if(mode==='foreign'){assert.equal(state.neighbor.expenses,600);assert.equal(state.docs.find(d=>d.id==='other-doc').amount,600);}
    if(['race','gone'].includes(mode))assert.match(state.notice,/изменена|уже удалена/);
    if(await sheet.isVisible())await sheet.locator('button[onclick="closeInvoiceSheet()"]').first().click();
    assert.equal(await target.count(),Number(kept),'список после действия');
    assert.ok(box.x>=0&&box.x+box.width<=391,'кнопка целиком на экране');
    const visual=Math.round(box.width)+' × '+Math.round(box.height)+' px. Подтверждений: '+prompts.length+'.';
    csv.push(['UI-0090',build,new Date().toISOString()+' / '+browser.version(),goal,'Стройка → Учебная стройка → '+(seed.work?'Работы':'Материалы')+' → ТЕСТ-01 → '+goal+' → Удалить → '+(mode==='cancel'?'Отмена':'подтверждение, если доступно')+' → список и расходы',
      'Документ '+(kept?'сохранён':'отсутствует')+'. Расходы объекта '+expected+' ₽, денежный журнал без изменений.'+(mode==='foreign'?' Соседний документ 600 ₽ сохранён.':''),openMs,ms,visual,'Пройдено']);console.log(mode,openMs,ms);
   }finally{await ctx.close();}
  }
 }finally{await browser.close();}

 if(process.env.QA_CSV)fs.writeFileSync(process.env.QA_CSV,'\ufeff'+csv.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
