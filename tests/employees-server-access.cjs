const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));

// All profiles, PIN sentinels and sessions are isolated fixtures. The table
// adapter models the new column grants; no production connection is made.
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const employeeAccessFixture=()=>{
  if(new URL(location.href).searchParams.has('signed-out'))localStorage.removeItem('arhittek_session');
  __db.employees[0].pin_code='isolated-secret-admin';__db.employees[1].pin_code='isolated-secret-colleague';
  __db.employees.push({id:'archived-employee',name:'Archived colleague',active:false,deleted_at:'2026-10-18T10:00:00Z',is_salaried:true,fixed_salary:45000,pin_code:'isolated-secret-archive'});
  window.__employeeRPCMode='safe';window.__employeeTableMode='locked';window.__employeeSelects=[];window.__employeeAttempts=[];window.__employeeCalls=[];
  const create=supabase.createClient;
  supabase.createClient=function(){
   const client=create.apply(this,arguments);if(client.__employeeAccessWrapped)return client;client.__employeeAccessWrapped=true;
   const rpc=client.rpc,from=client.from;
   client.rpc=async function(name,args={}){
    if(['get_employee_login_options','get_employee_profiles'].includes(name)){
     __employeeCalls.push(name);
     if(__employeeRPCMode==='missing')return {data:null,error:{code:'PGRST202',message:'Function is absent from the schema cache'},status:404};
     if(__employeeRPCMode==='missing-http')return {data:null,error:{message:'RPC not found'},status:404};
     if(__employeeRPCMode==='forbidden')return {data:null,error:{code:'42501',message:'Permission denied'},status:403};
     if(__employeeRPCMode==='forbidden-404')return {data:null,error:{code:'42501',message:'Permission denied'},status:404};
     if(__employeeRPCMode==='network')throw new TypeError('Isolated network failure');
     if(__employeeRPCMode==='invalid')return {data:null,error:null,status:200};
     if(__employeeRPCMode==='extra-fields')return {data:__db.employees.map(e=>({...e,session_token:'isolated-unexpected-secret'})),error:null,status:200};
    }
    return rpc.call(this,name,args);
   };
   client.from=function(table){
    const q=from.call(this,table);if(table!=='employees')return q;
    let op='select',columns=null;const select=q.select,insert=q.insert,update=q.update,then=q.then;
    q.select=function(value,...args){columns=value||'*';return select.call(this,value,...args);};
    q.insert=function(){op='insert';return insert.apply(this,arguments);};q.update=function(){op='update';return update.apply(this,arguments);};
    q.then=function(resolve,reject){return(async()=>{
     __employeeAttempts.push({op,columns});if(columns)__employeeSelects.push({op,columns});
     if(__employeeWriteError&&op!=='select')return {data:null,error:__employeeWriteError};
     if(op==='select'&&__employeeTableMode==='locked')return {data:null,error:{code:'42501',message:'Profile columns require the safe RPC'}};
     if(op==='select'&&__employeeSalaryReadError&&/is_salaried|fixed_salary/.test(columns||''))return {data:null,error:__employeeSalaryReadError};
     if(op!=='select'&&columns!=='id')return {data:null,error:{code:'42501',message:'Only id may be returned from an employee write'}};
     const result=await then.call(q,x=>x);
     if(result.error||!columns||columns==='*')return result;
     const keys=columns.split(','),pick=row=>row?Object.fromEntries(keys.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])):row;
     return {...result,data:Array.isArray(result.data)?result.data.map(pick):pick(result.data)};
    })().then(resolve,reject);};
    return q;
   };
   return client;
  };
  window.__employeeWriteError=null;window.__employeeSalaryReadError=null;
 };
 // Playwright does not define the order of separate init scripts. The access
 // fixture depends on __db/session from mock.js, so install them as one script.
 await context.addInitScript({content:fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+'\n;('+employeeAccessFixture.toString()+')();'});
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='app.test'){
   const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(fs.existsSync(f))return route.fulfill({path:f,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':undefined});
  }
  for(const [key,file]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage(),results=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function fresh(signedOut=false){
  await page.goto('https://app.test/'+(signedOut?'?signed-out=1':''));
  try{
   await page.waitForFunction(signedOut?()=>typeof loadEmployeeLoginOptions==='function'&&document.getElementById('loginEmployeeList').children.length>0:()=>typeof loadEmployeesSafe==='function'&&state.financialDataReady,undefined,{timeout:10000});
  }catch(error){
   throw new Error('Employee '+(signedOut?'signed-out':'signed-in')+' fixture failed to initialize. Page errors: '+(errors.join('; ')||'none')+'. '+error.message);
  }
  await page.waitForTimeout(80);
 }
 async function check(name,fn,expected,arg){try{const actual=await page.evaluate(fn,arg);assert.deepEqual(actual,expected);results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
 await fresh(true);
 await check('Signed-out startup loads only safe login choices through the public RPC',()=>[
  __employeeCalls.includes('get_employee_login_options'),__employeeCalls.includes('get_employee_profiles'),__employeeAttempts.length,
  state.employees.every(e=>Object.keys(e).every(k=>['id','name','active'].includes(k))),state.employees.some(e=>e.id==='archived-employee'),state.financialDataReady,
 ],[true,false,0,true,false,false]);
 await check('The login-options adapter drops unexpected roles, salaries and PIN fields',async()=>{
  __employeeRPCMode='extra-fields';const result=await loadEmployeeLoginOptions();return [result.error,result.data.every(e=>Object.keys(e).every(k=>['id','name','active'].includes(k))),result.data.some(e=>e.id==='archived-employee')];
 },[null,true,false]);
 await fresh();
 await check('Signed-in startup and deleted-employee history use the profiles RPC without table SELECT',()=>[
  __employeeCalls.includes('get_employee_profiles'),__employeeAttempts.filter(r=>r.op==='select').length,state.employees.find(e=>e.id==='admin').fixed_salary,
  state.employees.some(e=>e.id==='archived-employee'),state.trash.employees.some(e=>e.id==='archived-employee'),JSON.stringify([state.employees,state.trash.employees]).includes('isolated-secret'),
 ],[true,0,50000,false,true,false]);
 await check('The profile adapter discards unexpected secrets even if the server returns extra fields',async()=>{
  __employeeRPCMode='extra-fields';const r=await loadEmployeesSafe();return [r.error,r.data.some(e=>'pin_code'in e||'session_token'in e),r.data.some(e=>e.id==='archived-employee')];
 },[null,false,false]);
 await fresh();
 await check('Employees retain their own salary and salaried flags while colleague salaries stay masked',async()=>{
  setSession({employeeId:'designer',name:'Lead',isAdmin:false,token:'isolated-designer'});await loadAll();const own=state.employees.find(e=>e.id==='designer'),other=state.employees.find(e=>e.id==='admin');
  return [own.fixed_salary,other.fixed_salary,other.is_salaried,projectFeePercent({category_id:'arch',employee_id:'admin',fee_percent:null}),state.employees.some(e=>'pin_code'in e),state.trash.employees.length];
 },[50000,null,true,0,false,0]);
 for(const mode of ['forbidden','forbidden-404','network','invalid']){
  await fresh();
  await check(mode+' profile failure never falls back to employee table reads',async mode=>{
   const before=__employeeAttempts.length;__employeeRPCMode=mode;const r=await loadEmployeesSafe();await loadAll();return [!!r.error,__employeeAttempts.length===before,state.financialDataReady,document.getElementById('syncDot').classList.contains('off')];
  },[true,true,false,true],mode);
 }
 for(const mode of ['missing','missing-http']){
  await fresh();
  await check(mode+' RPC allows the explicit legacy-column path during staged deployment',async mode=>{
   __employeeRPCMode=mode;__employeeTableMode='legacy';const r=await loadEmployeesSafe();return [r.error,r.data.length,__employeeSelects.some(q=>q.columns.includes('pin')),r.data.some(e=>'pin_code'in e),__employeeAttempts.some(q=>q.op==='select')];
  },[null,4,false,false,true],mode);
 }
 await fresh();
 await check('Legacy salary-column absence is retried without salary fields, never as wildcard SELECT',async()=>{
  __employeeRPCMode='missing';__employeeTableMode='legacy';__employeeSalaryReadError={code:'PGRST204',message:'Could not find fixed_salary in schema cache'};const r=await loadEmployeesSafe();return [r.error,r.data.length,__employeeSelects.filter(q=>q.op==='select').length,__employeeSelects.some(q=>q.columns==='*')];
 },[null,4,2,false]);
 await fresh();
 await check('A legacy salary permission failure is propagated instead of dropping protected columns',async()=>{
  __employeeRPCMode='missing';__employeeTableMode='legacy';__employeeSalaryReadError={code:'42501',message:'Permission denied for fixed_salary'};const r=await loadEmployeesSafe();return [r.error.code,__employeeSelects.filter(q=>q.op==='select').length];
 },['42501',1]);
 await fresh();
 await check('The compatibility read remains complete beyond the server page cap',async()=>{
  __employeeRPCMode='missing';__employeeTableMode='legacy';__rowLimit=200;
  __db.employees=Array.from({length:1205},(_,i)=>({id:'employee-'+String(i).padStart(4,'0'),name:'Employee '+i,active:true,pin_code:'isolated-page-secret'}));
  const r=await loadEmployeesSafe();return [r.error,r.data.length,r.data.some(e=>'pin_code'in e)];
 },[null,1205,false]);
 await fresh(true);
 await check('Login permission errors never fall back to a raw public employee SELECT',async()=>{
  __employeeRPCMode='forbidden';const r=await loadEmployeeLoginOptions();return [r.error.code,__employeeAttempts.length];
 },['42501',0]);
 await check('Missing login RPC retains the old minimal id/name/active login query',async()=>{
  __employeeRPCMode='missing';__employeeTableMode='legacy';const r=await loadEmployeeLoginOptions();return [r.error,r.data.length,__employeeSelects.at(-1).columns,r.data.some(e=>'pin_code'in e||'fixed_salary'in e)];
 },[null,4,'id,name,active',false]);
 await fresh();
 await check('Employee creation requests only its id back and refreshes profiles through the safe RPC',async()=>{
  openEmployeeSheet(null);document.getElementById('ef-name').value='Safe new colleague';document.getElementById('ef-role').value='Сотрудник';document.getElementById('ef-pin').value='1234';await saveEmployee();
  return [__db.employees.filter(e=>e.name==='Safe new colleague').length,__employeeSelects.filter(q=>q.op==='insert').map(q=>q.columns),state.employees.some(e=>'pin_code'in e),__employeeAttempts.filter(q=>q.op==='select').length];
 },[1,['id'],false,0]);
 await fresh();
 await check('Employee update confirms only its id and never reads the submitted PIN back',async()=>{
  openEmployeeSheet('architect');document.getElementById('ef-name').value='Updated safely';document.getElementById('ef-pin').value='5678';await saveEmployee();
  return [__db.employees.find(e=>e.id==='architect').name,__employeeSelects.filter(q=>q.op==='update').map(q=>q.columns),state.employees.some(e=>'pin_code'in e),__employeeAttempts.filter(q=>q.op==='select').length];
 },['Updated safely',['id'],false,0]);
 await fresh();
 await check('A write permission error mentioning salary cannot trigger a weaker employee insert',async()=>{
  openEmployeeSheet(null);document.getElementById('ef-name').value='Forbidden new colleague';document.getElementById('ef-pin').value='1234';__employeeWriteError={code:'42501',message:'Permission denied for fixed_salary'};await saveEmployee();__employeeWriteError=null;
  return [__db.employees.some(e=>e.name==='Forbidden new colleague'),__employeeAttempts.filter(q=>q.op==='insert').length,document.getElementById('empSheetOverlay').classList.contains('active')];
 },[false,1,true]);
 results.push({name:'No uncaught browser errors in employee server-access scenarios',pass:errors.length===0,...(errors.length?{error:errors.join('\n')}:{})});
 console.log(JSON.stringify(results,null,2));const failed=results.filter(r=>!r.pass);console.log(`${results.length-failed.length}/${results.length} passed`);process.exitCode=failed.length?1:0;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
