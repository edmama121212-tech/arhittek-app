'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'), day='2026-11-18';
const base=(id,name,extra)=>({id,name,price:1000,advance:0,balance:1000,expenses:0,status_id:'active',category_id:'arch',created_at:'2026-09-01T08:00:00Z',updated_at:'2026-09-01T08:00:00Z',...extra});
const entry=(type,amount,extra={})=>({type,amount,entry_date:day,created_at:day+'T08:00:00Z',description:'Учебная оплата',project_id:'p',...extra});
const cases=[
 ['legacy','Увидеть старую сумму без расшифровки',127.41,[],127.41,0],
 ['stale','Сверить фактическую оплату при отставшем итоге карточки',300,[entry('project_expense',51.25)],51.25,51.25],
 ['mixed','Сложить расход из старого журнала с печатью из карточки',0,[entry('expense',45.55),entry('project_expense',5.07)],50.62,50.62],
 ['kopecks','Сложить две мелкие закупки ровно до копейки',0,[entry('project_expense',0.1),entry('project_expense',0.2)],0.30,0.30],
 ['worker','Отделить оплату поставщику от выплаты сотруднику',0,[entry('payment',110),entry('payment',330,{payee_employee_id:'architect'})],110,440],
 ['accrual','Отделить начисление за квадратные метры от расхода',0,[entry('role_payout',200,{payee_employee_id:'architect'}),entry('project_expense',21.8)],21.8,21.8],
 ['trash','Исключить отменённый расход при открытии карточки',0,[entry('project_expense',165,{deleted_at:day+'T12:00:00Z'}),entry('project_expense',75)],75,75],
 ['period','Сверить затраты всего проекта с расходами одного месяца',0,[entry('expense',250,{entry_date:'2026-10-01'}),entry('project_expense',66.1)],316.1,66.1],
 ['other','Разделить затраты двух договоров в одном финансовом месяце',0,[entry('project_expense',76.7),entry('expense',145.4,{project_id:'neighbor'})],76.7,222.1],
 ['refund','Отличить возврат аванса от себестоимости работ',0,[entry('client_refund',117),entry('expense',157.1)],157.1,157.1],
 ['transfer','Отделить вывод средств от себестоимости',0,[entry('withdrawal',80),entry('project_expense',18.4)],18.4,18.4],
 ['new','Внести новый чек после расхода из старого журнала',52,[entry('expense',52)],52,52,14.5],
 ['hand','Дополнить старую сводную сумму первым чеком',70,[],70,0,9.05]
];
const parseMoney=text=>Number(text.replace(/[^\d,.−-]/gu,'').replace('−','-').replace(',','.'));
const bytes=new Map(['index.html','finance-workspace.js'].map(f=>[f,fs.readFileSync(path.join(root,f))]));
const version=[...bytes.values()].map(b=>crypto.createHash('sha256').update(b).digest('hex').slice(0,12)).join('/');
async function setup(ctx){
 await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
 await ctx.route('**/*',route=>{
  const u=new URL(route.request().url()),f=u.pathname==='/'?'index.html':u.pathname.slice(1),file=path.join(root,f);
  if(u.hostname!=='cost.test')return route.fulfill({body:''});
  if(bytes.has(f))return route.fulfill({body:bytes.get(f),contentType:f.endsWith('html')?'text/html':'text/javascript'});
  return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
 });
}
async function prepare(page,saved,ledger){
 await page.goto('https://cost.test');
 await page.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);
 await page.evaluate(async({projects,rows})=>{
  Object.assign(__db,{projects,ledger_entries:rows,company_income:[],company_expenses:[],invoices:[]});
  const balances={reserve:6000};
  window.__journal={version:1,active:true,revision:1,balances,operations:[],workspace:{version:2,active:true,revision:1,as_of:'2026-11-20',opening_mode:'zero',start_date:'2026-11-01',cash:6000,reserve:6000,balances,items:[],wallets:[{id:'safe',name:'Сейф',is_default:true,active:true,balance:6000}],forecast:Array(91).fill({})}};
  await loadAll();
 },{projects:[base('p','Учебная мастерская',{expenses:saved}),base('neighbor','Соседний проект')],rows:ledger.map((row,i)=>({id:'row-'+i,...row}))});
}
async function routeAudit(page){
 await page.locator('#nav-finance').click();
 const fw=page.locator('#financeWorkspace'), more=()=>fw.locator('[data-fw-tab=more]').click();
 const legacy=page.locator('#view-finance :is([onclick*="openCompanyIncomeSheet"],[onclick*="openCompanyExpenseSheet"],[data-pay-office],[data-sf-action=income],[data-sf-action=office]):visible');
 const overlays=page.locator('#companyExpenseSheetOverlay:visible,#companyIncomeSheetOverlay:visible');
 assert.equal(await legacy.count(),0);
 await fw.locator('[data-fw=record-income]').click();
 assert.ok(await page.locator('#financeWorkspaceModal form').isVisible());assert.equal(await overlays.count(),0);
 await page.locator('#financeWorkspaceModal [data-close]').click();await more();
 for(const tab of ['history','archive','calendar','forecast','accounts','settings']){
  await fw.locator('[data-fw-tab='+tab+']').click();
  assert.equal(await legacy.count(),0,tab);assert.equal(await overlays.count(),0);
  await more();
 }
 assert.equal(await fw.locator('[data-fw=record-expense]').count(),0);
 await page.locator('.bottom-nav [data-view=view-projects]').click();
 await page.locator('.proj-row').filter({hasText:'Учебная мастерская'}).click();
 await page.getByRole('tab',{name:'Деньги',exact:true}).click();
 assert.ok(await page.locator('#pf-expense-add-btn').isVisible());assert.equal(await overlays.count(),0);
 await page.locator('#pf-add-payment').click();
 assert.ok(await page.locator('#paymentSheetOverlay').isVisible());assert.equal(await overlays.count(),0);
 console.log('Active v2 owner: Finance home → record-income opens #financeWorkspaceModal; six Finance destinations expose no legacy triggers; project → Money → expense is inline, payment opens #paymentSheetOverlay.');
}
async function run(){
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox']});
 const results=[],errors=[];
 try{
  const runs=process.argv.includes('--routes')?[['routes','Переходы',0,[]]]:cases;
  for(const [key,task,stored,rows,expected,month,add=0] of runs){
   const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});await setup(ctx);
   try{
    const p=await ctx.newPage();p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(task+' — '+e.message));await prepare(p,stored,rows);
    if(key==='routes'){await routeAudit(p);continue;}
    const count=await p.evaluate(()=>__writes.length);
    await p.locator('.bottom-nav [data-view=view-projects]').click();const project=p.locator('.proj-row').filter({hasText:'Учебная мастерская'});
    await project.click();
    const moneyTab=p.getByRole('tab',{name:'Деньги',exact:true});
    await moneyTab.evaluate(el=>el.addEventListener('click',()=>{window.__costPaint=new Promise(r=>{const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>r(Math.round(performance.now()-start))))})},{once:true,capture:true}));
    await moneyTab.click();const ms=await p.evaluate(()=>__costPaint);
    const field=p.locator('#pf-expenses'),gross=p.locator('#project-economy .project-equation span').filter({hasText:'Прямые расходы'}).locator('b');
    const checkTotal=async n=>{
     assert.equal(Number(await field.inputValue()),n,'Поле');assert.ok(await field.evaluate(el=>el.readOnly),'только чтение');
     assert.equal(parseMoney(await gross.innerText()),n,'Сводка');
    };
    await checkTotal(expected);
    if(add){
     await p.locator('#pf-expense-desc').fill('Новая закупка');await p.locator('#pf-expense-date').fill(day);await p.locator('#pf-expense-amount').fill(String(add));
     await p.locator('#pf-expense-add-btn').click();await p.waitForFunction(()=>!projectExpenseSaveInFlight&&!loadAllInFlight);
     await checkTotal(Math.round((expected+add)*100)/100);
    }
    const fits=await field.evaluate(el=>{el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return r.width>120&&r.left>=0&&r.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+1;});assert.ok(fits);
    if(process.env.COST_SHOTS){fs.mkdirSync(process.env.COST_SHOTS,{recursive:true});await p.screenshot({path:path.join(process.env.COST_SHOTS,key+'.png')});}
    await p.locator('#projectSheetClose').click();await p.locator('#nav-finance').click();
    const monthly=p.locator('#financeWorkspace .studio-money-grid article').filter({hasText:'Расходы за месяц'}).locator('strong');
    assert.equal(parseMoney(await monthly.innerText()),Math.round((month+add)*100)/100,'Месяц');
    await p.locator('.bottom-nav [data-view=view-projects]').click();await project.click();await moneyTab.click();await checkTotal(Math.round((expected+add)*100)/100);
    if(!add)assert.equal(await p.evaluate(()=>__writes.length),count);
    else assert.equal(await p.evaluate(()=>__db.projects.find(x=>x.id==='p').expenses),Math.round((expected+add)*100)/100,'Сохранённый итог');
    const sum=Math.round((expected+add)*100)/100;
    results.push(['UI-0215',version,task,'Сохранённый итог '+stored+' ₽, '+JSON.stringify(rows),'Проекты → Учебная мастерская → Деньги → сверить Прямые расходы с расчётом в карточке'+(add?' → внести чек '+add+' ₽':'')+' → Финансы → сверить расход за месяц → снова открыть карточку.',sum+' ₽ в поле и в сводке, расход месяца '+Math.round((month+add)*100)/100+' ₽; '+(add?'итог сохранён и проверен после повторного открытия.':'чтение не создало записей.'),ms,'390 px, поле помещается по ширине. Итог доступен только для чтения.','Chromium '+browser.version()+' / локальные ответы / '+new Date().toISOString(),'Пройдено']);
   }catch(e){errors.push(task+' — '+e.message);}finally{await ctx.close();}
  }
 }finally{await browser.close();}
 if(errors.length)throw Error(errors.join('\n'));
 if(process.env.COST_CSV)fs.writeFileSync(process.env.COST_CSV,'\ufeff'+[['Элемент','Сборка index/finance','Бизнес-сценарий','Данные','Шаги','Результат и последствия','От клика до двух кадров, мс','Вид и удобство','Стенд','Статус'],...results].map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 if(results.length)console.log(results.length+' direct cost journeys passed.');
}
run().catch(e=>{console.error(e.message);process.exitCode=1});
