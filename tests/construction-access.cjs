const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(process.env.TEST_APP_ROOT||path.join(__dirname,'..'));

// Client-side construction permission checks against an isolated local fixture.
// These are not server RLS tests and make no production requests or writes.
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'],headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript({path:path.join(__dirname,'mock.js')});
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
 async function fresh(){
  await page.goto('https://app.test/');await page.waitForFunction(()=>state.financialDataReady&&typeof canAccessConstructionProject==='function');await page.waitForTimeout(80);
  await page.evaluate(async()=>{
   __db.employees.push({id:'foreman',name:'Прораб',role:'Прораб',active:true,can_see_construction:true},{id:'colleague',name:'Другой прораб',role:'Прораб',active:true,can_see_construction:true});
   __db.projects=[{id:'own-build',name:'Own build',category_id:'build',status_id:'active',employee_id:'foreman'},
    {id:'co-build',name:'Co build',category_id:'build',status_id:'active',co_employee_id:'foreman'},
    {id:'team-build',name:'Team build',category_id:'build',status_id:'active'},
    {id:'foreign-build',name:'Foreign build',category_id:'build',status_id:'active',employee_id:'colleague'},
    {id:'not-build',name:'Design project',category_id:'design',status_id:'active',employee_id:'foreman'},
    {id:'deleted-build',name:'Deleted build',category_id:'build',status_id:'active',employee_id:'foreman',deleted_at:'2026-10-19T10:00:00Z'}];
   __db.project_members=[{id:'member-a',project_id:'team-build',employee_id:'foreman'},{id:'member-b',project_id:'own-build',employee_id:'colleague'}];
   __db.invoices=[{id:'own-invoice',project_id:'own-build',description:'Own material',number:'Own',amount:5000,item_type:'Материал',invoice_date:'2026-10-19'},
    {id:'foreign-invoice',project_id:'foreign-build',description:'Foreign material',number:'Foreign',amount:7000,item_type:'Материал',invoice_date:'2026-10-19'}];
   await loadAll();window.__setActor=actor=>{session=actor;window.session=actor;};window.__staff=()=>__setActor({employeeId:'foreman',name:'Прораб',isAdmin:false,token:'staff-token'});
   window.__admin=()=>__setActor({employeeId:'admin',name:'Мансур',isAdmin:true,token:'admin-token'});
   window.__other=()=>__setActor({employeeId:'colleague',name:'Другой прораб',isAdmin:false,token:'other-token'});
   __writes.length=0;window.__uploads=[];const storage=sb.storage.from;sb.storage.from=function(bucket){const api=storage.call(this,bucket),upload=api.upload;api.upload=async function(name,file,options){__uploads.push({bucket,name});return upload.call(this,name,file,options);};return api;};
  });
 }
 async function check(name,fn,expected){let timer;if(process.env.TEST_TRACE)console.log('RUN: '+name);try{const actual=await Promise.race([page.evaluate(fn),new Promise((resolve,reject)=>timer=setTimeout(()=>reject(new Error('Isolated scenario timed out')),15000))]);assert.deepEqual(actual,expected);results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}finally{clearTimeout(timer);}}
 await fresh();
 await check('Admin can access every live construction object, even without membership',()=>{
  __admin();return ['own-build','co-build','team-build','foreign-build','not-build','deleted-build','missing'].map(id=>canAccessConstructionProject(id));
 },[true,true,true,true,false,false,false]);
 await check('Staff access includes main, co-executor and confirmed team memberships only',()=>{
  __staff();return ['own-build','co-build','team-build','foreign-build','not-build','deleted-build','missing'].map(id=>canAccessConstructionProject(id));
 },[true,true,true,false,false,false,false]);
 await check('An explicitly hidden construction department denies even an assigned staff object',()=>{
  const employee=state.employees.find(e=>e.id==='foreman');employee.can_see_construction=false;const allowed=canAccessConstructionProject('own-build');employee.can_see_construction=true;return allowed;
 },false);
 await check('An unavailable membership read fails closed for staff but keeps admin access',()=>{
  state.projectMembersDataError='Connection failed';const staff=['own-build','co-build','team-build'].map(id=>canAccessConstructionProject(id));__admin();const admin=canAccessConstructionProject('foreign-build');state.projectMembersDataError=null;return [staff,admin];
 },[[false,false,false],true]);
 await check('Signed-out direct object and invoice calls do not open private views',()=>{
  __setActor(null);const before=[currentObjectId,invSheetCurrentId,document.querySelector('.view.active').id];openObjectView('own-build');openInvoiceSheet('own-invoice');
  return [before,[currentObjectId,invSheetCurrentId,document.querySelector('.view.active').id],__writes.length];
 },[[null,null,'view-overview'],[null,null,'view-overview'],0]);
 await fresh();
 await check('A staff member cannot open a foreign object or foreign invoice',()=>{
  __staff();openObjectView('own-build');const view=document.getElementById('objTitle').textContent;openObjectView('foreign-build');openInvoiceSheet('foreign-invoice');
  return [currentObjectId,document.getElementById('objTitle').textContent===view,invSheetCurrentId,document.getElementById('invoiceSheetOverlay').style.display,__writes.length];
 },['own-build',true,null,'none',0]);
 await fresh();
 await check('Own-object staff can add, edit and delete an unlinked invoice',async()=>{
  __staff();openObjectView('own-build');switchObjTab('add');document.getElementById('inv-desc-obj').value='Staff invoice';document.getElementById('inv-amount-obj').value='900';await addInvoice('own-build');
  const created=__db.invoices.find(i=>i.description==='Staff invoice');openInvoiceSheet(created.id);document.getElementById('invSheet-desc').value='Edited staff invoice';await saveInvoiceSheet();const edited=__db.invoices.find(i=>i.id===created.id).description;openInvoiceSheet(created.id);await deleteInvoiceSheet();
  return [!!created,edited,__db.invoices.some(i=>i.id===created.id)];
 },[true,'Edited staff invoice',false]);
 await fresh();
 await check('Foreign invoice insert, stale edit and stale delete create no database writes',async()=>{
  __admin();openObjectView('foreign-build');switchObjTab('add');document.getElementById('inv-desc-obj').value='Should not save';document.getElementById('inv-amount-obj').value='1000';openInvoiceSheet('foreign-invoice');__staff();
  await addInvoice('foreign-build');await saveInvoiceSheet();await deleteInvoiceSheet();
  return [__writes.length,__db.invoices.find(i=>i.id==='foreign-invoice').amount,__db.invoices.length];
 },[0,7000,2]);
 await fresh();
 await check('Signed-out stale edit and delete create no writes',async()=>{
  __admin();openInvoiceSheet('own-invoice');__setActor(null);await saveInvoiceSheet();await deleteInvoiceSheet();await addInvoice('own-build');return __writes.length;
 },0);
 await fresh();
 await check('Failed membership cannot use a previously opened invoice form',async()=>{
  __staff();openInvoiceSheet('own-invoice');state.projectMembersDataError='Unavailable';await saveInvoiceSheet();await deleteInvoiceSheet();await addInvoice('own-build');return __writes.length;
 },0);
 await fresh();
 await check('A staff change during photo upload stops the invoice edit before its write',async()=>{
  __staff();openInvoiceSheet('own-invoice');document.getElementById('invSheet-desc').value='Never committed';invSheetNewPhotoBlob=new Blob(['image'],{type:'image/jpeg'});
  const original=compressAndUpload;let release;compressAndUpload=async()=>{await new Promise(r=>release=r);return 'https://example.invalid/photo.jpg';};const pending=saveInvoiceSheet();
  __other();release();await pending;compressAndUpload=original;
  return [canAccessConstructionProject('own-build'),__writes.length,__db.invoices.find(i=>i.id==='own-invoice').description];
 },[true,0,'Own material']);
 await fresh();
 await check('A changed session token during compression prevents the Storage upload and invoice insert',async()=>{
  __staff();openObjectView('own-build');switchObjTab('add');document.getElementById('inv-desc-obj').value='Compressed private invoice';document.getElementById('inv-amount-obj').value='1000';
  const photo=new File(['photo'],'invoice.jpg',{type:'image/jpeg'}),transfer=new DataTransfer();transfer.items.add(photo);document.getElementById('inv-photo-obj').files=transfer.files;
  const original=compressImage;let release;compressImage=async()=>{await new Promise(r=>release=r);return photo;};const pending=addInvoice('own-build');__setActor({employeeId:'foreman',name:'Прораб',isAdmin:false,token:'new-token'});release();await pending;compressImage=original;
  return [__uploads.length,__writes.length,__db.invoices.length];
 },[0,0,2]);
 await fresh();
 await check('Foreign object photos are denied before Storage or database access',async()=>{
  __staff();await uploadExpensePhoto('foreign-build',{files:[new File(['photo'],'photo.jpg',{type:'image/jpeg'})]});return [__uploads.length,__writes.length];
 },[0,0]);
 await fresh();
 await check('Own-object staff can upload photo metadata without creating a cash movement',async()=>{
  __staff();openObjectView('own-build');switchObjTab('photos');
  await uploadExpensePhoto('own-build',{files:[new File(['photo'],'photo.jpg',{type:'image/jpeg'})],value:'selected'});
  return [__uploads.length,(__db.expense_photos||[]).length,__writes.filter(w=>['ledger_entries','company_income','company_expenses'].includes(w.table)).length];
 },[1,1,0]);
 await fresh();
 await check('Session loss after Storage upload prevents a new photo database row',async()=>{
  __staff();openObjectView('own-build');switchObjTab('photos');let release;const original=sb.storage.from;
  sb.storage.from=function(bucket){const api=original.call(this,bucket),upload=api.upload;api.upload=async function(){const response=await upload.apply(this,arguments);await new Promise(r=>release=r);return response;};return api;};
  const pending=uploadExpensePhoto('own-build',{files:[new File(['photo'],'photo.jpg',{type:'image/jpeg'})],value:'selected'});while(!release)await new Promise(r=>setTimeout(r,0));__setActor(null);release();await pending;sb.storage.from=original;
  return [__uploads.length,(__db.expense_photos||[]).length,__writes.length];
 },[1,0,0]);
 await fresh();
 await check('Full financial construction PDF requires admin and a live construction project',async()=>{
  let downloaded=0;const original=jspdf.jsPDF.API.save;jspdf.jsPDF.API.save=function(){downloaded++;return this;};
  __staff();await exportConstrPdf('own-build');await exportConstrPdf('foreign-build');__setActor(null);await exportConstrPdf('own-build');__admin();await exportConstrPdf('not-build');const denied=downloaded;await exportConstrPdf('own-build');jspdf.jsPDF.API.save=original;return [denied,downloaded];
 },[0,1]);
 await fresh();
 await check('A captured actor cannot reuse another staff session with membership on the same object',()=>{
  __staff();const actor={employeeId:session.employeeId,token:session.token,isAdmin:session.isAdmin};__other();return [canAccessConstructionProject('own-build'),canAccessConstructionProject('own-build',actor)];
 },[true,false]);
 await fresh();
 await check('Deprecated inline object updates cannot write a foreign row or arbitrary money fields, even as admin',async()=>{
  const before=JSON.stringify(__db.projects);__staff();const foreign=await updateObjField('foreign-build','floors_done','2');
  const own=await updateObjField('own-build','price','999999');__admin();const admin=await updateObjField('own-build','advance','999999');const oldFloor=await updateObjField('own-build','floors_total','2');
  return [foreign,own,admin,oldFloor,__writes.length,JSON.stringify(__db.projects)===before];
 },[false,false,false,false,0,true]);
 await browser.close();console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,total:results.length,failed:results.filter(r=>!r.pass),errors},null,2));if(results.some(r=>!r.pass)||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
