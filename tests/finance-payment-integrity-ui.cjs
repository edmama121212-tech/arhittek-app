'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.addInitScript({path:path.join(__dirname,'mock.js')});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   const file=url.hostname==='app.test'?path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1)):null;
   if(file&&fs.existsSync(file))return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
   return route.fulfill({body:'',contentType:'text/javascript'});
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://app.test/');
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
  await page.evaluate(async()=>{
   const day=financeToday();
   __db.ledger_entries=[{id:'paid-a',type:'fee_payment',project_id:'project-a',payee_employee_id:'architect',amount:100,entry_date:day}];
   const plan=(key,project,employee)=>({key,label:key,project_id:project,employee_id:employee,direction:'expense',origin:'plan',amount:200,remaining:200,funding:'reserve',certainty:'confirmed',due_date:day});
   const balances={reserve:1000};
   __journal={version:1,active:true,revision:1,balances,operations:[],workspace:{version:2,active:true,revision:1,as_of:day,cash:1000,reserve:1000,balances,wallets:[{id:'test-wallet',name:'Test account',active:true,balance:1000}],rules:[],warnings:[],forecast:Array.from({length:91},()=>({conservative:1000,expected:1000,cash_conservative:1000,cash_expected:1000})),unscheduled_projects:[],
    items:[plan('same-person-project','project-a','architect'),plan('other-person','project-a','designer'),plan('other-project','project-b','architect'),plan('generic',null,null)],
    unmatched:[{id:'journal-payment',source_table:'ledger_entries',source_id:'paid-a',reason:'Recorded payment',cash_delta:-100,remaining:100,changes:{reserve:-100}}]}};
   await loadAll();
  });
  await page.locator('.nav-btn[data-view="view-finance"]').click();
  await page.locator('#financeWorkspace [data-fw-tab="calendar"]').click();
  const openLink=async()=>{
   await page.getByText('Оплаты, внесённые вне календаря',{exact:true}).click();
   await page.locator('#financeWorkspace [data-fw="link"]').click();
  };
  await openLink();
  assert.deepEqual(await page.locator('#financeWorkspaceModal select[name="key"] option').evaluateAll(options=>options.map(o=>o.value)),['same-person-project']);
  assert.equal(await page.locator('#financeWorkspaceModal input[name="amount"]').inputValue(),'100');
  await page.locator('#financeWorkspaceModal [data-close]').click();
  await page.evaluate(async()=>{__journal.workspace.unmatched[0].source_table='company_expenses';__journal.workspace.unmatched[0].source_id='office';await loadAll();});
  await openLink();
  assert.deepEqual(await page.locator('#financeWorkspaceModal select[name="key"] option').evaluateAll(options=>options.map(o=>o.value)),['generic']);
  await page.locator('#financeWorkspaceModal [data-close]').click();
  await page.evaluate(async()=>{__journal.workspace.items=__journal.workspace.items.filter(x=>x.key!=='generic');await loadAll();});
  await openLink();
  assert.equal(await page.locator('#financeWorkspaceModal').count(),0);
  assert.match(await page.locator('#toast').textContent(),/Нет неоплаченного плана/);
  await page.evaluate(async()=>{delete __journal.workspace.unmatched[0].source_table;await loadAll();});
  await openLink();
  assert.equal(await page.locator('#financeWorkspaceModal').count(),0);
  assert.match(await page.locator('#toast').textContent(),/Обновите журнал/);
  assert.deepEqual(errors,[]);
  console.log('8 payment-identity mobile UI checks passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
