const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');const root=path.resolve(__dirname,'..');
(async()=>{
 const engine=process.env.TEST_BROWSER==='webkit'?webkit:chromium;
 const browser=await engine.launch({executablePath:process.env.TEST_BROWSER==='webkit'?undefined:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:process.env.TEST_BROWSER==='webkit'?[]:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Europe/Moscow',serviceWorkers:'block'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='app.test'){const file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));if(fs.existsSync(file))return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':undefined});}for(const [key,file]of [['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});return route.fulfill({body:'',contentType:'text/javascript'});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://app.test');await page.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
 let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 await page.evaluate(async()=>{
  __salaryHistory=JSON.parse(JSON.stringify(state.salaryHistory));
  const employee=__db.employees.find(e=>e.id==='designer');employee.fixed_salary=65000;
  const h=__salaryHistory.employees.find(e=>e.id===employee.id);h.fixed_salary=65000;
  h.versions=[{id:'100',effective_from:'2026-01-01',changed_at:'2026-01-01T00:00:00Z',fixed_salary:50000,is_salaried:true,active:true,deleted:false,source:'legacy_baseline',uncertain:true},
   {id:'101',effective_from:'2026-11-15',changed_at:'2026-11-15T08:00:00Z',fixed_salary:65000,is_salaried:true,active:true,deleted:false,source:'server',uncertain:false}];
  await loadAll();
 });
 const amount=month=>page.evaluate(m=>payrollDueForEmployee('designer',m),month);
 eq(await amount('2026-10'),50000,'A later 65k salary does not rewrite October 50k');
 eq(await amount('2026-11'),58000,'Midmonth salary is prorated by calendar days');
 await page.evaluate(async()=>{const h=__salaryHistory.employees.find(e=>e.id==='designer');h.versions.push({...h.versions.at(-1),id:'102',changed_at:'2026-11-15T09:00:00Z',fixed_salary:70000},{...h.versions.at(-1),id:'103',changed_at:'2026-11-15T09:00:00Z',fixed_salary:75000});await loadAll();});
 eq(await amount('2026-11'),63333.33,'Same-day last version wins, including equal timestamps');
 eq(await amount('2026-10'),50000,'Same-day changes keep old month immutable');
 await page.evaluate(async()=>{const h=__salaryHistory.employees.find(e=>e.id==='designer');h.active=false;__db.employees.find(e=>e.id==='designer').active=false;h.versions.push({...h.versions.at(-1),id:'104',effective_from:'2026-11-20',changed_at:'2026-11-20T09:00:00Z',active:false});await loadAll();});
 eq(await amount('2026-11'),35833.33,'Archive stops accrual only from its effective day');
 eq(await amount('2026-10'),50000,'Archive keeps old salary');
 await page.evaluate(async()=>{const h=__salaryHistory.employees.find(e=>e.id==='designer');h.active=true;h.versions.push({...h.versions.at(-1),id:'105',effective_from:'2026-11-25',changed_at:'2026-11-25T09:00:00Z',active:true});await loadAll();});
 eq(await amount('2026-11'),50833.33,'Reactivation resumes salary on its effective day');
 await page.evaluate(async()=>{const h=__salaryHistory.employees.find(e=>e.id==='designer');h.deleted_at='2026-11-28T09:00:00Z';h.versions.push({...h.versions.at(-1),id:'106',effective_from:'2026-11-28',changed_at:'2026-11-28T09:00:00Z',deleted:true});__db.employees=__db.employees.filter(e=>e.id!=='designer');await loadAll();document.getElementById('ts-month').value='2026-10';renderTimesheet();});
 eq(await amount('2026-11'),43333.33,'Deletion uses effective status rather than erasing payroll');
 eq(await amount('2026-10'),50000,'Physical card removal preserves old salary');
 eq(await page.locator('#timesheetCard .payroll-head[onclick*="designer"]').count(),1,'Deleted employee remains visible in historical timesheet');
 eq(await page.locator('[data-salary-history-note]').count(),1,'Uncertain legacy coverage is disclosed');
 await page.evaluate(async()=>{__fail={rpc:'get_employee_salary_history'};await loadAll();renderTimesheet();});
 eq(await page.evaluate(()=>[state.salaryHistory,state.financialDataReady]),[null,false],'Unavailable migration RPC clears history and blocks finance');
 assert.match(await page.locator('#timesheetCard').innerText(),/История окладов недоступна/);checks++;
 eq(await page.locator('#timesheetCard [onclick*="openSalaryPaymentSheet"]').count(),0,'No payment actions survive a failed salary read');
 await page.evaluate(async()=>{__fail=null;await loadAll();});eq(await amount('2026-10'),50000,'Retry restores verified history');
 await page.evaluate(async()=>{__salaryHistory.employees[0].versions=[];await loadAll();});eq(await page.evaluate(()=>[state.salaryHistory,state.financialDataReady]),[null,false],'Malformed history fails closed');
 await page.evaluate(async()=>{__salaryHistory=undefined;await loadAll();__salaryHistory=JSON.parse(JSON.stringify(state.salaryHistory));__salaryHistory.employees[0].versions[0].effective_from='2026-02-31';await loadAll();});
 eq(await page.evaluate(()=>[state.salaryHistory,state.financialDataReady]),[null,false],'Invalid date-only value fails closed');
 await page.evaluate(async()=>{__salaryHistory=undefined;await loadAll();revokeVerifiedAccess();session=null;window.session=null;});eq(await page.evaluate(()=>state.salaryHistory),null,'Logout session revocation removes private salary history');
 eq(await page.locator('#timesheetCard').innerText(),'','Session revocation removes historical payroll from DOM');
 const forbidden=await page.evaluate(()=>{session={employeeId:'architect',token:'staff-token'};window.session=session;return loadSalaryHistorySafe().then(r=>r.error?.code)});eq(forbidden,'42501','Staff RPC denied');
 eq(errors,[],'No uncaught browser failures');
 console.log(checks+' salary-history mobile browser checks passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
