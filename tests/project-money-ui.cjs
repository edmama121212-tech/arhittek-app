const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{chromium}=require('playwright');
const U=n=>'40000000-0000-4000-8000-'+String(n).padStart(12,'0'),root=path.resolve(__dirname,'..');
(async()=>{const db=new PGlite();await db.waitReady;let passed=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);passed++};let browser;
try{
 await db.exec(fs.readFileSync('tests/fixtures/session-security-baseline.sql','utf8'));
 await db.query("insert into public.employees(id,name,is_admin,role) values($1,'Мансур',true,'Директор'),($2,'Staff',false,'Архитектор')",[U(1),U(2)]);
 await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day')",[U(1),'u'.repeat(64)]);
 await db.query("insert into public.categories(id,name) values($1,'Дизайн интерьера')",[U(3)]);await db.query("insert into public.statuses(id,name) values($1,'В работе')",[U(4)]);
 await db.query("insert into public.projects(id,name,category_id,status_id,employee_id,price,balance,fee_base,area,fee_percent) values($1,'Проект Грозный сити',$2,$3,$4,50000,50000,'m2',100,0)",[U(10),U(3),U(4),U(2)]);
 for(const f of ['supabase/install-owner-access.sql','supabase/financial-journal.sql','supabase/lead-projects-reserve.sql','supabase/migrations/20261030192422_finance_workspace.sql','supabase/migrations/20261031103834_finance_zero_start.sql','supabase/invoice-payment-atomic.sql','supabase/migrations/20261031175258_project_money_integrity.sql'])await db.exec(fs.readFileSync(f,'utf8'));
 await db.exec('set role anon');await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-session-token':'u'.repeat(64),'x-finance-client':'1','x-project-money-client':'2'})]);
 const projects=async()=> (await db.query('select * from public.projects')).rows;
 const categories=(await db.query('select * from public.categories')).rows,statuses=(await db.query('select * from public.statuses')).rows;
 browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.addInitScript({content:'window.__seedProject='+JSON.stringify((await projects())[0])+';window.__seedCategories='+JSON.stringify(categories)+';window.__seedStatuses='+JSON.stringify(statuses)+';window.__db.projects=[__seedProject];window.__db.categories.push(...__seedCategories);window.__db.statuses.push(...__seedStatuses);window.__db.employees[0].is_salaried=false;window.__db.employees.push({id:'+JSON.stringify(U(2))+',name:"Staff",role:"Архитектор",active:true});'});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.protocol==='blob:')return route.continue();let file;if(u.hostname==='app.test')file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));for(const[key,p]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))file=path.join(root,'node_modules',p);return file&&fs.existsSync(file)?route.fulfill({path:file,contentType:/\.js$/.test(file)?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':undefined}):route.fulfill({body:'',contentType:'text/javascript'});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__projectDb',async({op='read',action,payload,operation})=>{
  try{if(op==='payment'){const r=(await db.query('select public.confirm_project_payment($1,$2,$3) j',[action,payload,operation])).rows[0].j;return {data:r,error:null};}
   if(op==='journal')return {data:(await db.query('select public.get_financial_journal() j')).rows[0].j,error:null};
   return {data:await projects(),error:null,count:1};
  }catch(e){return {data:null,error:{code:e.code,message:e.message}}}
 });
 await page.goto('https://app.test/');await page.waitForFunction(()=>state.financialDataReady);
 await page.evaluate(async()=>{const oldFrom=sb.from.bind(sb),oldRpc=sb.rpc.bind(sb);window.__projectRpcCalls=[];
  sb.from=table=>{if(table!=='projects')return oldFrom(table);const q={select(){return q},order(){return q},range(){return q},is(){return q},not(){return q},then(resolve,reject){return __projectDb({op:'read'}).then(resolve,reject)}};return q};
  sb.rpc=async(name,args)=>{if(name==='get_financial_journal')return __projectDb({op:'journal'});if(name==='confirm_project_payment'){__projectRpcCalls.push(JSON.parse(JSON.stringify(args)));const r=await __projectDb({op:'payment',action:args.p_action,payload:args.p_payload,operation:args.p_operation});if(window.__loseProjectOnce&&!r.error){window.__loseProjectOnce=false;return {data:null,error:{code:'network',message:'Committed response lost'}}}return r}return oldRpc(name,args)};await loadAll();
 });
 await page.evaluate(id=>{openProjectSheet(id);openPaymentSheet(id);document.getElementById('payment-amount').value='40000';document.getElementById('payment-note').value='Actual client advance';window.__loseProjectOnce=true;},U(10));
 await page.locator('#payment-save').click();await page.waitForFunction(()=>!paymentSaveInFlight);
 eq((await projects())[0].advance,'40000','Lost response still committed one actual receipt');
 eq(await page.locator('#payment-amount').isDisabled(),true,'Uncertain payload is frozen for confirmation');
 await page.locator('#payment-save').click();await page.waitForFunction(()=>!paymentSaveInFlight&&!document.getElementById('paymentSheetOverlay').classList.contains('active'));
 eq(await page.evaluate(()=>__projectRpcCalls[0].p_operation===__projectRpcCalls[1].p_operation),true,'Retry reused the same operation UUID');
 eq((await db.query("select count(*)::int n from public.ledger_entries where type='advance' and deleted_at is null")).rows[0].n,1,'Actual source was never duplicated');
 eq(await page.evaluate(id=>{const p=state.projects.find(p=>p.id===id);return [Number(p.advance),Number(p.balance)]},U(10)),[40000,10000],'Client refreshed received and debt from the same server payment');
 await page.evaluate(()=>closeProjectSheet());await page.locator('.nav-btn[data-view="view-overview"]').click();
 const debt=await page.locator('#debtCard tr').filter({hasText:'Проект Грозный сити'}).innerText();assert.match(debt.replace(/\s/g,''),/10000/);passed++;
 eq(errors,[],'No browser errors');console.log(JSON.stringify({passed,failed:[]}));
}finally{if(browser)await browser.close();await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
