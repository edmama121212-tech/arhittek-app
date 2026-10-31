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

await db.exec(fs.readFileSync('supabase/migrations/20261030192422_finance_workspace.sql','utf8'));await role(1);
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
 await page.locator('#financeWorkspace [data-fw-tab="archive"]').click();eq(await page.locator('#financeWorkspace').getByText(await page.evaluate(()=> 'Операции до '+fmtDate('2026-11-01')),{exact:true}).isVisible(),true);
 await page.evaluate(()=>{state.financialJournal=__beforeZero;ARHITTEKFinanceWorkspace.render();});
 await page.locator('#financeWorkspace [data-fw-tab="overview"]').click();
 await cmd('activate',activatePayload,201,0);await page.evaluate(()=>loadAll());
 eq(await page.locator('#financeWorkspace h1').textContent(),'Финансы');eq(await page.evaluate(()=>ARHITTEKFinanceWorkspace.enabled()),true);
 await page.locator('#financeWorkspace [data-fw="record-income"]').click();
 const modal=page.locator('#financeWorkspaceModal');await modal.locator('[name="label"]').fill('Actual company income');await modal.locator('[name="amount"]').fill('1000');await modal.locator('[name="reason"]').fill('Confirmed in isolated database');await modal.locator('[type="submit"]').click();
 await page.waitForFunction(()=>!document.getElementById('financeWorkspaceModal')&&state.financialJournal.workspace.cash===101000);eq((await snapshot()).workspace.reserve,100950);
 await page.locator('#financeWorkspace [data-fw="record-expense"]').click();await modal.locator('[name="label"]').fill('Actual company expense');await modal.locator('[name="amount"]').fill('200');await modal.locator('[name="reason"]').fill('Lost response scenario');await page.evaluate(()=>window.__loseOnce=true);await modal.locator('[type="submit"]').click();
 await modal.locator('[role="alert"]').filter({hasText:'Simulated lost response'}).waitFor();eq((await snapshot()).workspace.cash,100800);
 await modal.locator('[data-close]').click();await page.locator('#financeWorkspace [data-fw="retry"]').click();await page.waitForFunction(()=>state.financialJournal.workspace.cash===100800&&!document.querySelector('[data-fw="retry"]'));
 eq((await db.query('select count(*)::int n from public.company_expenses')).rows[0].n,1);
 await page.locator('#financeWorkspace [data-fw-tab="calendar"]').click();await page.locator('#financeWorkspace [data-fw="expense"]').click();await modal.locator('[name="label"]').fill('Known future obligation');await modal.locator('[name="amount"]').fill('3000');await modal.locator('[name="reason"]').fill('Confirmed service agreement');await modal.locator('[type="submit"]').click();await page.waitForSelector('#financeWorkspaceModal',{state:'detached'});
 eq((await snapshot()).workspace.items.some(x=>x.label==='Known future obligation'),true);
 await page.locator('#financeWorkspace [data-fw-tab="forecast"]').click();eq(await page.locator('#financeWorkspace').getByText('Через 30 дней',{exact:true}).isVisible(),true);
 for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});eq(await page.locator('#financeWorkspace').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);}
 await page.setViewportSize({width:390,height:844});await page.locator('#financeWorkspace [data-fw-tab="overview"]').click();
 if(process.env.FINANCE_SCREENSHOT)await page.screenshot({path:process.env.FINANCE_SCREENSHOT,fullPage:true});
 const before=(await snapshot()).workspace.cash;eq(await page.evaluate(()=>{const old=state.financialJournal;return ARHITTEKFinanceWorkspace.accepted({...old,revision:old.revision-1,workspace:{...old.workspace,revision:old.revision-1}},{token:session.token,id:session.employeeId})}),false);eq((await snapshot()).workspace.cash,before);
 eq(errors,[]);console.log(JSON.stringify({passed:checks,failed:[]}));
}finally{await browser.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
