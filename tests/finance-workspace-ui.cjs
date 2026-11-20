const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const U=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
const db=new PGlite();await db.waitReady;let checks=0;
await db.exec(fs.readFileSync('tests/fixtures/session-security-baseline.sql','utf8'));
await db.query("insert into public.employees(id,name,role,is_admin) values($1,'Мансур','Генеральный директор',true),($2,'Employee','Архитектор',false)",[U(1),U(2)]);
const token=n=>'isolated-finance-token-'+String(n).repeat(48);
await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day'),($3,$4,now()+interval '1 day')",[U(1),token(1),U(2),token(2)]);
await db.query("insert into public.categories(id,name) values($1,'Архитектура'),($2,'Строительство')",[U(3),U(4)]);
await db.query("insert into public.statuses(id,name) values($1,'Завершён'),($2,'В работе')",[U(5),U(6)]);
await db.query("insert into public.projects(id,name,category_id,status_id,employee_id,price) values($1,'Design',$2,$3,$4,100000),($5,'Build',$6,$7,$4,500000)",[U(10),U(3),U(5),U(2),U(11),U(4),U(6)]);
await db.exec(fs.readFileSync('supabase/install-owner-access.sql','utf8'));
await db.exec(fs.readFileSync('supabase/financial-journal.sql','utf8'));
await db.exec(fs.readFileSync('supabase/financial-journal.sql','utf8'));
async function role(n,header=true){await db.exec('reset role;set role anon');await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-session-token':token(n),...(header?{'x-finance-client':'1'}:{})})]);}
async function denied(fn,codes=['42501','22023','23514','40001']){let e;try{await fn()}catch(x){e=x}assert.ok(e,'must reject');assert.ok(codes.includes(e.code),e.code+': '+e.message);checks++}
const snapshot=async()=>(await db.query('select public.get_financial_journal() j')).rows[0].j;
const cmd=(c,p,id,rev)=>db.query('select public.confirm_financial_operation($1,$2,$3,$4) j',[c,p,U(id),rev]);
const eq=(a,b)=>{assert.deepEqual(a,b);checks++};

await db.exec(fs.readFileSync('supabase/migrations/20261030192422_finance_workspace.sql','utf8'));await db.exec(fs.readFileSync('supabase/receipt-timing.sql','utf8'));await role(1);
let j=await snapshot();const activatePayload={reason:'Isolated verified cash',confirmed:true,fingerprint:j.fingerprint,cash:100000,amortization:0,projects:[]};
const path=require('path'),{chromium,webkit}=require('playwright'),root=path.resolve(__dirname,'..');
const browser=await(process.env.CATALOG_BROWSER==='webkit'?webkit:chromium).launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:process.env.CATALOG_BROWSER==='webkit'?[]:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.protocol==='blob:')return route.continue();let file;
 if(u.hostname==='app.test')file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
 for(const [key,p]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))file=path.join(root,'node_modules',p);
 if(file&&fs.existsSync(file))return route.fulfill({path:file,contentType:/\.js$/.test(file)?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':undefined});return route.fulfill({body:'',contentType:'text/javascript'});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__receiptRows',async()=>(await db.query('select * from public.ledger_entries')).rows);
 await page.exposeFunction('__financeRPC',async({name,args={}})=>{try{let data;
 if(name==='get_financial_journal')data=await snapshot();
 else if(name==='confirm_finance_workspace')data=(await db.query('select public.confirm_finance_workspace($1,$2,$3,$4) j',[args.p_command,args.p_payload,args.p_operation,args.p_revision])).rows[0].j;
 else if(name==='get_financial_journal_history')data=(await db.query('select public.get_financial_journal_history($1) j',[args.p_before])).rows[0].j;
 else if(name==='get_finance_request')data=(await db.query('select public.get_finance_request($1) j',[args.p_operation])).rows[0].j;
 else throw new Error('Unexpected isolated RPC '+name);
 return {data,error:null};}catch(e){return {data:null,error:{message:e.message,code:e.code}}}});
 await page.goto('https://app.test/');await page.waitForFunction(()=>state.financialDataReady);
 await page.evaluate(async()=>{const old=sb.rpc.bind(sb);sb.rpc=async(n,a)=>{if(['get_financial_journal','confirm_finance_workspace','get_financial_journal_history','get_finance_request'].includes(n)){const r=await __financeRPC({name:n,args:a});if(window.__loseOnce&&n==='confirm_finance_workspace'&&!r.error){window.__loseOnce=false;return {data:null,error:{message:'Simulated lost response'}};}return r;}return old(n,a)};await loadAll();});
 await page.locator('.nav-btn[data-view="view-finance"]').click();await page.waitForSelector('#financeWorkspace');
 eq(await page.locator('#financeWorkspace').getByText('Нужна начальная сверка',{exact:true}).isVisible(),true);
 await page.evaluate(()=>{window.__beforeZero=state.financialJournal;const j=state.financialJournal;state.financialJournal={...j,opening_mode:'zero',start_date:'2026-11-01',workspace:{...j.workspace,opening_mode:'zero',start_date:'2026-11-01'}};ARHITTEKFinanceWorkspace.render();});
 eq(await page.locator('#financeWorkspace').getByText('Запланирован старт с нуля',{exact:true}).isVisible(),true);
 eq(await page.locator('#financeWorkspace [data-journal="activate"]').count(),0);
 await page.locator('#financeWorkspace [data-fw-tab="more"]').click();
 await page.locator('#financeWorkspace [data-fw-tab="archive"]').click();eq(await page.locator('#financeWorkspace').getByText(await page.evaluate(()=> 'Операции до '+fmtDate('2026-11-01')),{exact:true}).isVisible(),true);
 await page.evaluate(()=>{state.financialJournal=__beforeZero;ARHITTEKFinanceWorkspace.render();});
 await page.locator('#financeWorkspace [data-fw-tab="overview"]').click();
 await cmd('activate',activatePayload,201,0);await page.evaluate(()=>loadAll());
 eq(await page.locator('#financeWorkspace h1').textContent(),'Финансы');eq(await page.evaluate(()=>ARHITTEKFinanceWorkspace.enabled()),true);
 eq(await page.evaluate(()=>{
  const calculate=ARHITTEKBudget.calculate;
  let calls=0;
  try{
   ARHITTEKBudget.calculate=(...args)=>{calls++;return calculate(...args)};
   ARHITTEKFinanceWorkspace.render();
   return calls;
  }finally{ARHITTEKBudget.calculate=calculate;}
 }),0);
 eq(await page.locator('.studio-money-grid article span').allTextContents(),['Сейф','Расходы за месяц','Ожидаем до конца месяца']);
 // A legacy installation can retain separate wallets. Their funds cannot be attributed to the safe.
 const split=await page.evaluate(()=>{
  const journal=state.financialJournal,workspace=journal.workspace;
  const original=workspace.wallets;
  try{
   const safe=original.find(w=>w.is_default===true);
   workspace.wallets=[{id:'external-bank',name:'Отдельный счёт',active:true,balance:10000,kind:'bank'},
    {...safe,balance:workspace.cash-10000,name:'Общая касса · не распределено по счетам'}];
   ARHITTEKFinanceWorkspace.render();
   const tile=document.querySelector('.studio-money-grid article'),label=tile.querySelector('span').textContent;
   const amount=tile.querySelector('strong').textContent.replace(/\s/g,'');
   document.querySelector('[data-fw-tab="more"]').click();
   document.querySelector('[data-fw="record-income"]').click();
   const picker=document.querySelector('#financeWorkspaceModal select[name="wallet_id"]');
   const choices=[...picker.options].map(option=>option.textContent.split(' · ')[0]);
   const defaultsToSafe=picker.value===safe.id;
   picker.value='external-bank';
   const keptOtherWallet=new FormData(picker.form).get('wallet_id')==='external-bank';
   document.querySelector('#financeWorkspaceModal [data-close]').click();
   document.querySelector('[data-fw-tab="overview"]').click();
   return [label,amount,choices,defaultsToSafe,keptOtherWallet];
  }finally{workspace.wallets=original;ARHITTEKFinanceWorkspace.render();}
 });
 eq(split,['Сейф','90000,00₽',['Сейф','Отдельный счёт'],true,true]);
 // Render outstanding allocations separately from the physical safe, including old signed wallets.
 const priorJournal=await page.evaluate(()=>state.financialJournal);
 for(const [cash,reserve] of [[400,-2400],[-50,-200],[400,100],[0,0]]){
  await page.evaluate(({journal,cash,reserve})=>{
   const balances={reserve,amortization:cash-reserve};
   state.financialJournal={...journal,balances,workspace:{...journal.workspace,balances,cash,reserve,
    wallets:[{...journal.workspace.wallets.find(w=>w.is_default),balance:cash}]}};
   ARHITTEKFinanceWorkspace.render();
  },{journal:priorJournal,cash,reserve});
  const view=page.locator('#financeWorkspace');
  const rubles=text=>Number(text.replace(/[\s₽]/g,'').replace(',','.'));
  const amountFor=async label=>{
   const field=view.locator('.fw-row').filter({has:page.getByText(label,{exact:true})}).locator('strong');
   return await field.count()?rubles(await field.innerText()):null;
  };
  eq(rubles(await view.locator('.studio-money-grid article strong').first().innerText()),Math.max(0,cash));
  eq(await amountFor('Не покрыто деньгами'),reserve<0?-reserve:null);
  eq(await amountFor('Недостача по учёту сейфа'),cash<0?-cash:null);
  await view.getByRole('button',{name:/Ещё/}).click();
  await view.getByRole('button',{name:'Сейф',exact:true}).click();
  eq(await amountFor('Деньги в сейфе'),Math.max(0,cash));
  eq(await amountFor('Недостача по учёту'),cash<0?-cash:null);
  eq(await amountFor('Свободно для расходов'),Math.max(0,reserve));
  eq(await amountFor('Не покрыто деньгами'),reserve<0?-reserve:null);
  eq(await page.evaluate(()=>[state.financialJournal.workspace.wallets[0].balance,state.financialJournal.balances.reserve]),[cash,reserve]);
  await view.getByRole('button',{name:'Финансы',exact:true}).click();
 }
 await page.evaluate(journal=>{state.financialJournal=journal;ARHITTEKFinanceWorkspace.render();},priorJournal);
 await page.locator('[data-fw-tab="more"]').click();
 const workspace=page.locator('#financeWorkspace');
 eq(await page.evaluate(()=>{ARHITTEKFinanceWorkspace.render();return document.activeElement===document.querySelector('#financeWorkspace h1');}),true);
 eq(await workspace.locator('.fw-group h2').allTextContents(),['Поступления','Найти операцию','Запланировать','Настроить']);
 eq(await workspace.locator('.fw-grid').isVisible(),false);
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:844});
  eq(await workspace.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
 }
 await workspace.locator('[data-fw-section="month-report"] summary').click();
 eq(await workspace.locator('.fw-grid').isVisible(),true);
 for(const screen of ['accounts','settings','history']){
  await workspace.locator('[data-fw-tab="'+screen+'"]').click();
  if(screen==='history'){
   const search=workspace.locator('[data-fw-search]');
   const sample=await page.evaluate(()=>{
    const original=state.financialJournal;
    try{
     const deltas=[10000,-10000,0];
     const reserves=[500,-3500,0];
     const reasons=['Аванс [этап 3]','Выплата [salary:2026-11] [funded:0] [plan:bbbbbbbb-cccc-dddd-eeee-ffffffffffff]','Распределение'];
     state.financialJournal={...original,history:[],operations:deltas.map((cash_delta,i)=>({id:'movement-'+i,kind:'activate',reason:reasons[i],cash_delta,revision:i+1,created_at:'2026-11-19T12:00:00Z',balances_after:{reserve:reserves[i]}}))};
     ARHITTEKFinanceWorkspace.render();
     const entries=Array.from(document.querySelectorAll('[data-fw-operation]'));
     const values=entries.map(entry=>[entry.querySelector('.fw-row span').textContent,entry.querySelector('.fw-row strong').textContent.replace(/\s/g,''),entry.querySelectorAll('.fw-row span')[1].textContent]);
     const field=document.querySelector('[data-fw-search]');
     const filter=q=>{field.value=q;field.dispatchEvent(new Event('input'));return entries.filter(e=>!e.hidden).length;};
     const deficits=entries.map(entry=>{
      const deficit=[...entry.querySelectorAll('.fw-row')].find(r=>r.querySelector('span').textContent==='Не покрыто деньгами');
      return deficit?.querySelector('strong').textContent.replace(/\s/g,'')||null;
     });
     const reserveValues=entries.map(entry=>entry.querySelectorAll('.fw-row strong')[1].textContent.replace(/\s/g,''));
     return [values,deficits,reserveValues,filter('10 000'),filter('-10000'),filter('Расход'),
      entries.map(entry=>entry.querySelector('h3').textContent),filter('[salary:2026-11]'),filter('[funded:0]'),filter('[plan:bbbbbbbb-cccc-dddd-eeee-ffffffffffff]'),filter('ноябрь')];
    }finally{state.financialJournal=original;ARHITTEKFinanceWorkspace.render();}
   });
   eq(sample,[[['Поступление','10000,00₽','Свободно для расходов'],['Расход','10000,00₽','Свободно для расходов'],['Движение денег','0,00₽','Свободно для расходов']],[null,'3500,00₽',null],['500,00₽','0,00₽','0,00₽'],2,1,1,['Аванс [этап 3]','Выплата · ноябрь 2026 г.','Распределение'],1,1,1,1]);
   await search.focus();
   await search.press('ControlOrMeta+a');
   await page.evaluate(()=>ARHITTEKFinanceWorkspace.render());
   eq(await search.evaluate(el=>[el===document.activeElement,el.selectionStart,el.selectionEnd]),[true,0,'ноябрь'.length]);
   await page.keyboard.insertText('операция-которой-нет');
   eq(await workspace.locator('[data-fw-no-match]').isVisible(),true);
   await page.evaluate(()=>ARHITTEKFinanceWorkspace.render());
   eq(await search.inputValue(),'операция-которой-нет');
   await search.evaluate(el=>el.setSelectionRange(0,'операция'.length,'backward'));
   await page.evaluate(()=>ARHITTEKFinanceWorkspace.render());
   eq(await search.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]),[0,'операция'.length,'backward']);
   await page.keyboard.insertText('запись');
   eq(await search.inputValue(),'запись-которой-нет');
   await search.fill('');
   eq(await workspace.locator('[data-fw-no-match]').isVisible(),false);
  }
  await workspace.locator('[data-fw-tab="more"]').click();
 }
 for(const [screen,message] of [['history','В истории пока нет подтверждённых операций.'],['calendar','В календаре пока нет платежей.']]){
  await workspace.locator('[data-fw-tab="'+screen+'"]').click();
  const emptyResult=await page.evaluate(()=>{
   const original=state.financialJournal;
   try{
    state.financialJournal={...original,operations:[],history:[],workspace:{...original.workspace,items:[],unmatched:[],unscheduled_projects:[],changes:[],links:[]}};
    ARHITTEKFinanceWorkspace.render();
    const section=document.getElementById('financeWorkspace');
    return [section.textContent,section.querySelectorAll('[data-fw-section="unmatched"],[data-fw-section="payment-links"],[data-fw-section="plan-history"]').length];
   }finally{state.financialJournal=original;ARHITTEKFinanceWorkspace.render();}
  });
  eq(emptyResult[0].includes(message),true);
  eq(emptyResult[1],0);
  await workspace.locator('[data-fw-tab="more"]').click();
 }
 eq(await page.locator('#financeWorkspace .fw-grid small').allTextContents(),['Выручка','Расход','Чистый доход']);
 const cashCases=await page.evaluate(()=>{
  const original={...state},day=financeToday();
  const project={id:'design',name:'Договор',price:50000,advance:0,fee_percent:20,fee_base:'price',employee_id:'worker'};
  const ledger=[],workspace={as_of:day,items:[]};
  try{
   Object.assign(state,{projects:[project],financialProjects:[project],invoices:[],ledger,employees:[{id:'worker',role:'Исполнитель'}],companyIncome:[],companyExpenses:[],financialStatusHistory:[],statuses:[]});
   const totals=()=>{const {revenue,expense,net,forecast}=ARHITTEKFinanceWorkspace.managementSummary(state,workspace);return [revenue,expense,net,forecast]};
   const results=[totals()];
   project.advance=40000;
   ledger.push({id:'receipt',type:'advance',project_id:project.id,amount:40000,entry_date:day});
   results.push(totals());
   workspace.items.push({direction:'expense',origin:'plan',project_id:project.id,remaining:2000.35});
   results.push(totals());
   workspace.items[0].remaining=0;
   ledger.push({type:'project_expense',project_id:project.id,amount:2000.35,entry_date:day});
   project.fee_paid=2500;
   ledger.push({type:'fee_payment',project_id:project.id,payee_employee_id:'worker',amount:2500,entry_date:day});
   results.push(totals());
   project.advance=50000;
   ledger.push({type:'final_payment',project_id:project.id,amount:10000,entry_date:day});
   results.push(totals());
   return results;
  }finally{Object.assign(state,original);}
 });
 eq(cashCases,[[0,0,0,40000],[40000,0,40000,0],[40000,0,40000,-2000.35],[40000,4500.35,35499.65,2500],[50000,4500.35,45499.65,-7500]]);
 await page.locator('#financeWorkspace [data-fw="record-income"]').click();
 const modal=page.locator('#financeWorkspaceModal');
 const amount=modal.locator('[name="amount"]'),paidOn=modal.locator('[name="date"]');
 eq(await amount.evaluate(input=>input.validity.valueMissing),true);
 eq(await modal.locator('[name="label"]').evaluate(input=>input.validity.valueMissing),true);
 const today=await paidOn.inputValue();
 await paidOn.fill('2099-12-31');
 eq(await paidOn.evaluate(input=>input.validity.rangeOverflow),true);
 await paidOn.fill(today);
 await modal.locator('[name="label"]').fill('Actual company income');await modal.locator('[name="amount"]').fill('1000');eq(await modal.locator('[name="employee_id"]').isVisible(),false);await modal.locator('[type="submit"]').click();
 await page.waitForFunction(()=>!document.getElementById('financeWorkspaceModal')&&state.financialJournal.workspace.cash===101000);eq((await snapshot()).workspace.reserve,100950);
 eq(await workspace.locator('[data-fw="record-expense"]').count(),0);
 await workspace.locator('[data-fw="record-income"]').click();await modal.locator('[name="label"]').fill('Lost response receipt');await modal.locator('[name="amount"]').fill('200');await modal.locator('summary').click();await modal.locator('[name="reason"]').fill('Lost response scenario');await page.evaluate(()=>window.__loseOnce=true);await modal.locator('[type="submit"]').click();
 await modal.locator('[role="alert"]').filter({hasText:'Simulated lost response'}).waitFor();eq((await snapshot()).workspace.cash,101200);
 await modal.locator('[data-close]').click();await page.locator('#financeWorkspace [data-fw="retry"]').click();await page.waitForFunction(()=>state.financialJournal.workspace.cash===101200&&!document.querySelector('[data-fw="retry"]'));
 eq((await db.query('select count(*)::int n from public.company_income where amount=200')).rows[0].n,1);
 await page.locator('#financeWorkspace [data-fw-tab="calendar"]').click();await page.locator('#financeWorkspace [data-fw="expense"]').click();await modal.locator('[name="label"]').fill('Known future obligation');await modal.locator('[name="amount"]').fill('3000');await modal.locator('summary').click();await modal.locator('[name="reason"]').fill('Confirmed service agreement');await modal.locator('[type="submit"]').click();await page.waitForSelector('#financeWorkspaceModal',{state:'detached'});
 eq((await snapshot()).workspace.items.some(x=>x.label==='Known future obligation'),true);
 await page.locator('#financeWorkspace [data-fw-tab="more"]').click();
 await page.locator('#financeWorkspace [data-fw-tab="forecast"]').click();eq(await page.locator('#financeWorkspace').getByText('Прогноз по проектам',{exact:true}).isVisible(),true);
 for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});eq(await page.locator('#financeWorkspace').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);}
 await page.setViewportSize({width:390,height:844});await page.locator('#financeWorkspace [data-fw-tab="overview"]').click();
 if(process.env.FINANCE_SCREENSHOT)await page.screenshot({path:process.env.FINANCE_SCREENSHOT,fullPage:true});
 const before=(await snapshot()).workspace.cash;eq(await page.evaluate(()=>{const old=state.financialJournal;return ARHITTEKFinanceWorkspace.accepted({...old,revision:old.revision-1,workspace:{...old.workspace,revision:old.revision-1}},{token:session.token,id:session.employeeId})}),false);eq((await snapshot()).workspace.cash,before);

 // Correct a current receipt as previously received; real DB backs the form.
 const receiptDay=(await snapshot()).workspace.as_of;
 await db.query("insert into public.ledger_entries(id,project_id,type,amount,entry_date,description) values($1,$2,'advance',50000,$3,'Forgotten customer payment')",[U(901),U(10),receiptDay]);
 await page.evaluate(async()=>{__db.ledger_entries=await __receiptRows();await loadAll();});
 const receiptCash=(await snapshot()).workspace.cash;
 await page.locator('[data-fw-tab="more"]').click();
 await page.locator('#financeWorkspace [data-fw-tab="history"]').click();
 await page.locator('#financeWorkspace summary').filter({hasText:'Исправить дату или учёт оплаты клиента'}).click();
 await page.locator('[data-fw="correct-receipt"][data-id="'+U(901)+'"]').click();
 await modal.locator('[name="mode"]').selectOption('before');
 eq(await modal.locator('[name="date"]').isDisabled(),true);
 await modal.locator('[name="reason"]').fill('Was received before opening cash was confirmed');
 await modal.locator('[type="submit"]').click();
 await page.waitForSelector('#financeWorkspaceModal',{state:'detached'});
 eq((await snapshot()).workspace.cash,receiptCash-50000);
 await page.evaluate(async()=>{__db.ledger_entries=await __receiptRows();await loadAll();});
 const receipt=(await db.query('select * from public.ledger_entries where id=$1',[U(901)])).rows[0];
 eq(receipt.received_before_start,true);eq(Number(receipt.amount),50000);
 const excluded=await page.evaluate(()=>!ARHITTEKCash.cashEvents(state).some(x=>x.row.id==='20000000-0000-4000-8000-000000000901'));
 eq(excluded,true);
 eq(errors,[]);console.log(JSON.stringify({passed:checks,failed:[]}));
}finally{await browser.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
