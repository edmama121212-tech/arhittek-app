'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const out=process.env.HISTORY_PAGE_OUTPUT;
const cases=[
 ['empty','Открыть историю до первой денежной операции'],
 ['end','Проверить отсутствие более ранних чеков после открытия сейфа'],
 ['older','Найти более ранний расход на бумагу'],
 ['reversal','Сверить отмену расхода с его исходным чеком'],
 ['boundary','Сверить соседние записи на границе двух страниц'],
 ['pages','Дойти до первоначального взноса через две страницы'],
 ['exact','Определить конец журнала после полной страницы с пропусками номеров'],
 ['twice','Дважды нажать при медленной загрузке'],
 ['retry','Восстановить историю после временного отказа'],
 ['away','Вернуться на главную пока загружается старая выплата'],
 ['filter','Догрузить вторую оплату поставщику при действующем фильтре'],
];
function fixture(mode){
 const op=(n,reason='Операция '+n)=>({id:'op'+n,revision:n,kind:'record',reason,cash_delta:-10,created_at:'2026-11-19T09:00:00Z',changes:{reserve:-10},balances_after:{reserve:1000}});
 const first=mode==='empty'?[]:mode==='end'?[op(1,'Открытие сейфа')]:[op(205,'Сверка поставщика'),op(204)];
 let pages=[];
 if(['pages','exact'].includes(mode)){
  pages=Array.from({length:100},(_,i)=>op(203-i));
  if(mode==='pages')pages.push(op(2,'Первоначальный взнос'));
 }else pages=[op(202,mode==='filter'?'Второй счёт поставщика':'Покупка бумаги')];
 if(mode==='boundary')pages.unshift(first.at(-1));
 if(mode==='reversal')first[0]={...first[0],kind:'reverse',cash_delta:10,changes:{reserve:10},reverses:'op202',reason:'Возврат по чеку'};
 const balances={reserve:1000};
 window.__journal={version:1,revision:205,active:true,balances,operations:first,workspace:{version:2,revision:205,active:true,as_of:'2026-11-19',cash:1000,reserve:1000,balances,forecast:Array(91).fill({conservative:1000,expected:1000}),rules:[],warnings:[],items:[],wallets:[{id:'safe',name:'Сейф',is_default:true,kind:'cash',active:true,balance:1000}]}};
 window.__historyPageReads=[];
 const original=window.supabase.createClient;
 window.supabase.createClient=(...a)=>{
  const client=original(...a),rpc=client.rpc.bind(client);
  client.rpc=async(name,params)=>{
   if(name!=='get_financial_journal_history')return rpc(name,params);
   const before=params.p_before;
   __historyPageReads.push(before);
   if(['twice','away'].includes(mode))await new Promise(resolve=>{window.__finishHistory=resolve;});
   if(mode==='retry'&&__historyPageReads.length===1)return {data:null,error:{message:'Временный отказ учебного журнала'}};
   const data=pages.filter(o=>o.revision<before||(mode==='boundary'&&o.revision===before)).slice(0,100);
   return {data,error:null};
  };
  return client;
 };
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const rows=[['Элемент','Сборка index/finance SHA256','Сценарий','Шаги','Результат и связи','До видимого результата, мс','Визуальная проверка','Удобство','Стенд','Итог']];
 const build=['index.html','finance-workspace.js'].map(f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex').slice(0,12)).join('/');
 try{
 for(const [mode,task] of cases){
  const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block',reducedMotion:'reduce'});
  try{
   await ctx.addInitScript({content:fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+';('+fixture+')('+JSON.stringify(mode)+')'});
   await ctx.route('**/*',route=>{
    const url=new URL(route.request().url()),file=path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
    return url.hostname==='journal.test'&&fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({body:''});
   });
   const p=await ctx.newPage();p.setDefaultTimeout(5000);
   await p.goto('https://journal.test');await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);
   await p.locator('.bottom-nav').getByRole('button',{name:/^Финансы/}).click();
   const fw=p.locator('#financeWorkspace'),safe=fw.locator('.studio-money-grid article').first();
   const initial=await safe.innerText(),writes=await p.evaluate(()=>__writes.length);
   const history=async()=>{await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name:'История операций',exact:true}).click();};
   const home=()=>fw.locator('[data-fw-tab="overview"]').click();
   const next=fw.locator('[data-fw="history"]'),cards=fw.locator('[data-fw-operation]'),done=fw.locator('[data-fw-history-end]');
   let steps='Финансы → Ещё → История операций',result,ux;
   await history();
   if(mode==='filter')await fw.getByRole('searchbox').fill('поставщика');
   const t=performance.now();
   if(['empty','end'].includes(mode)){
    assert.equal(await next.count(),0,task);assert.equal(await cards.count(),mode==='empty'?0:1);
    await (mode==='empty'?fw.locator('[data-fw-empty]'):done).waitFor();
    assert.deepEqual(await p.evaluate(()=>__historyPageReads),[]);
    result='Список содержит '+await cards.count()+' записей. Запросов архива 0.';
    ux='Сразу видно состояние журнала.';steps+=' → проверить конец списка';
   }else{
    await next.click();steps+=' → Более ранние операции';
    if(mode==='retry'){await p.locator('#toast.show').filter({hasText:/Временный отказ/}).waitFor();await next.click();steps+=' → повторить после сообщения об ошибке';}
    if(mode==='twice'){await next.evaluate(b=>{b.click();window.__finishHistory();});steps+=' → повторно нажать в ожидании ответа';}
    if(mode==='away'){await home();assert.equal(await safe.innerText(),initial);await p.evaluate(()=>window.__finishHistory());await p.waitForFunction(()=>state.financialJournal.history?.length);await history();steps+=' → Финансы → вернуться в историю';}
    if(['pages','exact'].includes(mode)){await p.waitForFunction(()=>state.financialJournal.history?.length===100);await next.click();steps+=' → загрузить следующую страницу';}
    await done.waitFor();
    const count=await cards.count();
    assert.equal(count,mode==='pages'?103:mode==='exact'?102:3);
    if(mode==='reversal')assert.equal(await cards.filter({hasText:'Покупка бумаги'}).locator('[data-journal="reverse"]').count(),0);
    if(mode==='filter')assert.equal(await fw.locator('[data-fw-operation]:visible').count(),2);
    if(mode==='pages')await fw.getByRole('heading',{name:'Первоначальный взнос'}).waitFor();
    const reads=await p.evaluate(()=>__historyPageReads);
    assert.deepEqual(reads,['pages','exact'].includes(mode)?[204,104]:mode==='retry'?[204,204]:[204]);
    result='Строк '+count+', номера границ запроса '+reads.join(' / ')+'. '+(mode==='reversal'?'Чек уже отменён; повторной отмены в истории нет.':mode==='filter'?'По запросу видны оба счёта поставщика.':mode==='boundary'?'Пограничная операция осталась в одном экземпляре.':'Показан конец истории.');
    ux=mode==='retry'?'Ошибка допускает повтор той же страницы.':mode==='twice'?'При повторном нажатии ушёл один запрос.':'Конец истории обозначен после догрузки.';
   }
   await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const ms=Math.round(performance.now()-t);
   const mark=mode==='empty'?fw.locator('[data-fw-empty]'):done;
   await mark.evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));
   await p.waitForFunction(selector=>{
    const e=document.querySelector(selector),b=e.getBoundingClientRect();
    return b.left>=0&&b.right<=innerWidth+1&&b.top>=0&&b.bottom<=innerHeight+1&&
     e.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2));
   },mode==='empty'?'[data-fw-empty]':'[data-fw-history-end]');
   if(process.env.HISTORY_PAGE_SHOT&&mode==='reversal')await p.screenshot({path:process.env.HISTORY_PAGE_SHOT});
   const width=await fw.evaluate(el=>[el.clientWidth,el.scrollWidth]);assert.ok(width[1]<=width[0]+1);
   await home();assert.equal(await safe.innerText(),initial);assert.equal(await p.evaluate(()=>__writes.length),writes);
   rows.push(['UI-0324',build,task,steps+' → сверить сейф',result+' Остаток сейфа сохранён, записей от действия 0.',ms,'Ширина области '+width[0]+' px, содержимое помещается.',ux,'Локальный Chromium '+browser.version()+' / '+new Date().toISOString(),'Пройдено']);
   console.log(mode,ms);
  }finally{await ctx.close();}
 }
 if(out)fs.writeFileSync(out,'\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
