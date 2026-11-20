'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const before = '2026-10-31', start = '2026-11-01';
const project = (id,name) => ({id,name,price:1000,advance:0,category_id:'arch',status_id:'active'});
const entry = (id,type,amount,extra={}) => ({id,type,amount,entry_date:before,project_id:'a',...extra});
const income = (id,description,amount,date=before) => ({id,description,amount,income_date:date});
const expense = (id,description,amount,date=before) => ({id,description,amount,expense_date:date});
const backlog = Array.from({length:145},(_,i)=>expense('expense-'+i,'Чек №'+(i+1),0.01));
backlog.push(expense('old','Первая закупка',412.75,'2025-03-12'));
const cases = [
 {task:'Открыть архив при пустом прежнем учёте',desc:'До старта записей нет.',data:{},count:0,needle:['Архивных операций пока нет.']},
 {task:'Сверить аренду в последний день старого периода',desc:'Аренда 10 500,25 ₽ 31.10, связь 250 ₽ 01.11.',data:{company_expenses:[expense('e','Аренда',10500.25),expense('n','Связь текущего месяца',250,start)]},count:1,cards:[['Аренда','Расход','10 500,25']],absent:['Связь текущего месяца'],totals:[0,250]},
 {task:'Разделить старую выручку и приход в первый день нового учёта',desc:'Субаренда 7 500 ₽ 31.10, новый приход 852,25 ₽ 01.11.',data:{company_income:[income('p','Субаренда',7500),income('c','Первый новый приход',852.25,start)]},count:1,cards:[['Субаренда','Поступление','7 500,00']],absent:['Первый новый приход'],totals:[852.25,0]},
 {task:'Найти аванс с неизвестной датой получения',desc:'Аванс 353,81 ₽ помечен ранее полученным, техническая дата 18.11.',data:{ledger_entries:[entry('unknown','advance',353.81,{description:'Архивный аванс',received_before_start:true,entry_date:'2026-11-18'})]},count:1,cards:[['Архивный аванс','Дата неизвестна','Учебная баня','353,81']],absent:['18.11.2026']},
 {task:'Отличить старый перевод бюджета от новой суммы на материалы',desc:'Бюджет материалов 512 ₽ ранее получен, новая выручка 135 ₽.',data:{ledger_entries:[entry('u','materials_budget',512,{received_before_start:true,entry_date:start}),entry('a','income',135,{entry_date:start,description:'Новая выручка'})]},count:1,cards:[['Бюджет на материалы','Дата неизвестна','Поступление','512,00']],absent:['Новая выручка'],totals:[135,0]},
 {task:'Сверить возврат заказчику с частичной оплатой',desc:'Оплата остатка 445,99 ₽ и возврат 125,50 ₽ по одной карточке.',data:{ledger_entries:[entry('p','final_payment',445.99),entry('r','client_refund',125.50)]},count:2,cards:[['Оплата остатка','Поступление','445,99'],['Возврат заказчику','Расход','125,50']]},
 {task:'Различить одинаковые авансы по двум проектам',desc:'Два аванса по 250 ₽, одинаковая дата и назначение, разные проекты.',data:{ledger_entries:[entry('a','advance',250,{description:'Аванс по договору'}),entry('b','advance',250,{description:'Аванс по договору',project_id:'b'})]},count:2,cards:[['Учебная баня','Аванс по договору','250,00'],['Учебная дача','Аванс по договору','250,00']]},
 {task:'Исключить удалённые и нулевые записи при сверке оплаты',desc:'100 ₽ сохранены, 105 ₽ в корзине, черновой аванс 0 ₽.',data:{ledger_entries:[entry('v','advance',100,{description:'Принятый аванс'}),entry('d','advance',105,{description:'Удалённый платёж',received_before_start:true,deleted_at:'2026-11-01T09:00:00Z'}),entry('z','advance',0,{description:'Нулевая запись'})]},count:1,cards:[['Принятый аванс','100,00']],absent:['Удалённый платёж','Нулевая запись']},
 {task:'Найти выдачу гонорара среди начислений',desc:'Гонорар выплачен 115,01 ₽, начисление без движения денег 700 ₽.',data:{ledger_entries:[entry('p','fee_payment',115.01),entry('accrual','role_payout',700,{description:'Только начислено'})]},count:1,cards:[['Выплата сотруднику по проекту','Расход','115,01']],absent:['Только начислено']},
 {task:'Распознать назначение индексированного оклада',desc:'Старая выплата сотруднику по служебной записи [salary:2026-10] и [funded:0].',data:{ledger_entries:[entry('salary','salary_payment',2600,{description:'[salary:2026-10] Оплата макета [funded:0]'})]},count:1,cards:[['Оплата макета','октябрь','2 600,00']],absent:['[salary:','[funded:']},
 {task:'Дойти до самой старой закупки в длинном архиве',desc:'145 одинаковых по дате чеков и первая закупка 412,75 ₽ годом раньше.',data:{company_expenses:backlog},count:146,cards:[['Первая закупка','12.03.2025','412,75']],last:'Первая закупка'},
 {task:'Сверить архив до будущего запуска',desc:'Старт запланирован на 01.12, 19.11 получено 412 ₽.',pending:true,data:{company_income:[income('x','Ноябрьская оплата',412,'2026-11-19')]},count:1,cards:[['Ноябрьская оплата','19.11.2026','412,00']]},
 {task:'Найти платёж старого проекта из корзины',desc:'Карточка проекта помещена в корзину, аванс 71,30 ₽ сохранён.',data:{archived:true,ledger_entries:[entry('z','advance',71.30,{description:'Старый договор',project_id:'removed'})]},count:1,cards:[['Снятый с работы дом','Старый договор','71,30']]}
];

const buildFiles=new Map(['index.html','finance-workspace.js'].map(file=>[file,fs.readFileSync(path.join(root,file))]));
const build=[...buildFiles.values()].map(bytes=>crypto.createHash('sha256').update(bytes).digest('hex').slice(0,12)).join('/');
const normalize=text=>text.replace(/\s+/gu,' ');
const rubles=text=>Number(text.replace(/[\s₽]/gu,'').replace(',','.'));
async function run(){
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox']});
 const results=[],errors=[];
 try{
  for(const c of cases){
   const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
   try{
    await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
    await ctx.route('**/*',route=>{
     const url=new URL(route.request().url()),file=path.join(root,url.pathname==='/'?'index.html':url.pathname);
     if(url.origin!=='https://archive.test')return route.fulfill({body:''});
     const name=path.relative(root,file);
     if(buildFiles.has(name))return route.fulfill({body:buildFiles.get(name),contentType:name.endsWith('.html')?'text/html':'text/javascript'});
     return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({body:''});
    });
    const p=await ctx.newPage();
    p.setDefaultTimeout(5000);
    p.on('pageerror',e=>errors.push(c.task+' — '+e.message));
    await p.goto('https://archive.test/');
    await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);
    const projects=[project('a','Учебная баня'),project('b','Учебная дача')];
    if(c.data.archived)projects.push({...project('removed','Снятый с работы дом'),deleted_at:'2026-11-01T08:00:00Z'});
    await p.evaluate(async({data,projects,pending,start})=>{
     const {archived,...tables}=data;
     Object.assign(__db,tables,{projects});
     const active=!pending,cash=active?6000:0,balances={reserve:cash};
     window.__journal={version:1,active,revision:1,balances,operations:[],workspace:{version:2,active,revision:1,as_of:'2026-11-20',opening_mode:'zero',start_date:pending?'2026-12-01':start,cash,reserve:cash,balances,items:[],wallets:[{id:'safe',name:'Сейф',is_default:true,active:true,balance:cash}],forecast:Array(91).fill({})}};
     await loadAll();
    },{data:c.data,projects,pending:c.pending,start});
    await p.locator('#nav-finance').click();
    const fw=p.locator('#financeWorkspace'),safe=fw.locator('.studio-money-grid article').first().locator('strong');
    const initial=c.pending?0:rubles(await safe.innerText());
    const writes=await p.evaluate(()=>__writes.length);
    await fw.locator('[data-fw-tab=more]').click();
    await fw.evaluate(el=>el.addEventListener('click',()=>{window.__archivePaint=new Promise(r=>{const then=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>r(Math.round(performance.now()-then))))})},{once:true,capture:true}));
    await fw.getByRole('button',{name:'Архив до начала учёта'}).click();
    const ms=await p.evaluate(()=>__archivePaint);
    assert.equal(await fw.getByRole('heading',{level:1}).innerText(),'Архив операций');
    const text=normalize(await fw.innerText()),cards=fw.locator('article').filter({has:p.locator('.fw-row')});
    assert.equal(await cards.count(),c.count,c.task);
    const cardTexts=(await cards.allTextContents()).map(normalize);
    for(const parts of c.cards||[])assert.ok(cardTexts.some(t=>parts.every(part=>t.includes(part))),JSON.stringify(parts)+' '+cardTexts.slice(0,3));
    for(const s of c.needle||[])assert.ok(text.includes(s),s);
    for(const s of c.absent||[])assert.ok(!text.includes(s),s);
    if(c.last){assert.ok(cardTexts.at(-1).includes(c.last));await cards.last().scrollIntoViewIfNeeded();assert.ok(await cards.last().isVisible());}
    const visual=await fw.evaluate(node=>({fit:document.documentElement.scrollWidth<=innerWidth+1&&Array.from(node.querySelectorAll('.fw-row')).every(row=>row.scrollWidth<=row.clientWidth+1),focus:node.querySelector('h1')===document.activeElement}));
    assert.ok(visual.fit&&visual.focus,JSON.stringify(visual));
    if(process.env.ARCHIVE_SHOTS){
     fs.mkdirSync(process.env.ARCHIVE_SHOTS,{recursive:true});
     await p.screenshot({path:path.join(process.env.ARCHIVE_SHOTS,'archive-'+String(cases.indexOf(c)+1).padStart(2,'0')+'.png')});
    }
    await fw.locator('[data-fw-tab=more]').click();
    await fw.getByText('Отчёт за месяц',{exact:true}).click();
    const actual=(await fw.locator('.fw-report .fw-amount').allTextContents()).map(rubles),[revenue,cost]=c.totals||[0,0];
    assert.deepEqual(actual,[revenue,cost,Math.round((revenue-cost)*100)/100]);
    await fw.locator('[data-fw-tab=overview]').click();
    if(c.pending)assert.ok(await fw.getByRole('heading',{name:'Начальные остатки — 0 ₽'}).isVisible());
    else assert.equal(rubles(await safe.innerText()),initial);
    assert.equal(await p.evaluate(()=>__writes.length),writes);
    results.push(['UI-0333',build,c.task,c.desc,'Финансы → Ещё → Архив до начала учёта → '+(c.last?'прокрутить до последней карточки → ':'')+'сверить содержание → Операции и планы → Отчёт за месяц → Финансы',c.count+' записей. '+(c.cards||[]).map(a=>a.join(' · ')).join(' / ')+'. Выручка '+revenue+' ₽, расход '+cost+' ₽. '+(c.pending?'Начальный остаток 0 ₽.':'Сейф '+initial+' ₽.')+' Новых записей 0.',ms,'390 px, горизонтальной прокрутки нет. Заголовок архива получает фокус. '+(c.last?'Последняя закупка доступна в списке.':c.needle?'Есть сообщение о пустом архиве.':'Сумма и направление указаны в карточке.'),'Chromium '+browser.version()+' / локальные ответы / '+new Date().toISOString(),'Пройдено']);
   }catch(e){errors.push(c.task+' — '+e.message);}finally{await ctx.close();}
  }
 }finally{await browser.close();}
 if(errors.length)throw Error(errors.join('\n'));
 const header=['Элемент','Сборка index/finance','Бизнес-сценарий','Исходные данные','Шаги','Результат и последствия','От клика до двух кадров, мс','Визуально и удобство','Стенд','Итог'];
 if(process.env.ARCHIVE_CSV)fs.writeFileSync(process.env.ARCHIVE_CSV,'\ufeff'+[header,...results].map(row=>row.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log(results.length+' archive journeys passed');
}
run().catch(e=>{console.error(e.message);process.exitCode=1});
