const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const browserName=process.env.TEST_BROWSER||'chromium',engine=require('playwright')[browserName],root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await engine.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:browserName==='chromium'?['--no-sandbox','--disable-dev-shm-usage']:[]});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const fixture=fs.readFileSync(path.join(root,'tests/mock.js'),'utf8');
 await context.addInitScript({content:fixture+'\n'+`(()=>{
 const create=supabase.createClient;supabase.createClient=function(){const c=create.apply(this,arguments),from=c.from;
 c.from=function(table){const q=from.call(this,table),insert=q.insert,then=q.then;let inserted=false;
 q.insert=function(){inserted=true;return insert.apply(this,arguments)};
 q.then=function(resolve,reject){return then.call(q,r=>r).then(r=>{
 if(table==='projects'&&inserted&&!r.error&&r.data&&!r.data.number_series){const p=r.data,series=window.projectNumberSeries(p.category_id);if(series){const year=Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Europe/Moscow'}).format(new Date())),sequence=++window.__numberCounters[series];Object.assign(p,{number_series:series,number_year:year,number_sequence:sequence,project_title:p.name});p.name=window.projectNumberPrefix(p)+' '+p.project_title;Object.assign(__db.projects.find(row=>row.id===p.id),p);}}
 if(table==='projects'&&inserted&&window.__loseProjectInsertResponse&&!r.error){window.__loseProjectInsertResponse=false;__fail={table:'projects',op:'select'};return {data:null,error:{message:'Insert response lost'}};}
 return r;}).then(resolve,reject);};return q;};return c;};window.__numberCounters={architecture:173,interior:31,landscape:0};})();`});
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.hostname==='app.test'){
   const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));if(fs.existsSync(f))return route.fulfill({path:f,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':undefined});
  }
  for(const [key,file]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage(),errors=[],out=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://app.test/');await page.waitForFunction(()=>typeof refreshProjectNumbers==='function'&&state.financialDataReady&&typeof refreshProjectWorkspace==='function');
 const yy=await page.evaluate(()=>new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Europe/Moscow'}).format(new Date()).slice(-2));
 await page.evaluate(async yy=>{
 __db.projects=[{id:'p173',name:'Проект 173'+yy+' Последний',category_id:'arch',status_id:'done',employee_id:'architect',end_date:'2099-01-01'},
 {id:'p171',name:'Проект 171'+yy+' Без исполнителя',category_id:'arch',status_id:'active',created_at:'2099-01-01'},
 {id:'p172',name:'Проект №172'+yy+' Раньше срока',category_id:'arch',status_id:'active',employee_id:'architect',end_date:'2001-01-01'},
 {id:'p31',name:'Проект ДИ №31'+yy+' Интерьер',category_id:'design',status_id:'active'},
 {id:'old',name:'Старый проект без номера',category_id:'arch',status_id:'active'}];
 await loadAll();await refreshProjectNumbers();document.querySelector('.nav-btn[data-view="view-projects"]').click();
 },yy);
 async function check(name,fn){try{await fn();out.push({name,pass:true});}catch(e){out.push({name,pass:false,error:e.message});}}
 await check('The next numbers panel shows only the number under each direction',async()=>{assert.deepEqual(await page.locator('#nextProjectNumbers .project-number-grid span').allTextContents(),['Архитектура','Дизайн интерьера','Ландшафт']);assert.deepEqual(await page.locator('#nextProjectNumbers strong').allTextContents(),['№174'+yy,'№32'+yy,'№1'+yy]);});
 await check('Numeric descending order ignores status, deadline and missing employee',async()=>{assert.deepEqual(await page.locator('#projectsCard .proj-name').allTextContents(),['✓ Проект 173'+yy+' Последний','Проект №172'+yy+' Раньше срока','Проект 171'+yy+' Без исполнителя','Проект ДИ №31'+yy+' Интерьер','Старый проект без номера']);});
 await page.locator('#addProjectFab').click();
 await check('A new card requires direction first and the prefix is not an editable input',async()=>{assert.equal(await page.locator('#pf-category').inputValue(),'');assert.equal(await page.locator('#pf-name').isDisabled(),true);assert.equal(await page.locator('#pf-number-prefix').evaluate(el=>el.tagName),'DIV');const a=await page.locator('#pf-category').boundingBox(),b=await page.locator('#pf-name').boundingBox();assert.ok(a.y<b.y);});
 await page.locator('#pf-category').selectOption('arch');await page.locator('#pf-name').fill('Только название');
 await check('Changing direction updates the prefix and keeps the entered title',async()=>{assert.equal(await page.locator('#pf-number-prefix').innerText(),'№174'+yy);for(const [cat,prefix]of [['design','№32'],['land','№1']]){await page.locator('#pf-category').selectOption(cat);assert.equal(await page.locator('#pf-number-prefix').innerText(),prefix+yy);assert.equal(await page.locator('#pf-name').inputValue(),'Только название');}});
 await page.locator('#pf-category').selectOption('arch');
 await check('Concurrent clicks insert once and use the authoritative server result',async()=>{await page.evaluate(()=>Promise.all([saveProject(),saveProject()]));const p=await page.evaluate(()=>__db.projects.find(p=>p.project_title==='Только название'));assert.equal(p.name,'Проект №174'+yy+' Только название');assert.equal(await page.evaluate(()=>__db.projects.filter(p=>p.project_title==='Только название').length),1);assert.equal(await page.locator('#projectSheetOverlay').evaluate(el=>el.classList.contains('active')),false);});
 const savedId=await page.evaluate(()=>__db.projects.find(p=>p.project_title==='Только название')?.id);
 assert.ok(savedId,JSON.stringify({checks:out,errors,diagnostics:await page.evaluate(()=>({toast:document.getElementById('toast').textContent,writes:__writes.filter(w=>w.table==='projects'),nextProjectNumbers}))},null,2));
 await page.evaluate(id=>openProjectSheet(id),savedId);
 await check('Existing automatic identity is locked while the title stays editable',async()=>{assert.equal(await page.locator('#pf-name').inputValue(),'Только название');assert.equal(await page.locator('#pf-category').isDisabled(),true);await page.locator('#pf-name').fill('Изменённое название');await page.locator('#pf-save').click();assert.equal(await page.evaluate(()=>__db.projects.find(p=>p.number_sequence===174).name),'Проект №174'+yy+' Изменённое название');});
 await page.evaluate(()=>openProjectSheet('old'));
 await check('Legacy cards retain their complete original names',async()=>{assert.equal(await page.locator('#pf-name').inputValue(),'Старый проект без номера');assert.equal(await page.locator('#pf-number-prefix').isVisible(),false);});
 await page.evaluate(()=>{closeProjectSheet();openProjectSheet(null);});await page.locator('#pf-category').selectOption('design');await page.locator('#pf-name').fill('Сохранить после связи');
 await check('An unavailable number service blocks saving without discarding title',async()=>{const result=await page.evaluate(async()=>{__fail={rpc:'get_next_project_numbers'};await refreshProjectNumbers();const before=__db.projects.length;await saveProject();return [__db.projects.length===before,document.getElementById('pf-name').value,document.getElementById('projectSheetOverlay').classList.contains('active')];});assert.deepEqual(result,[true,'Сохранить после связи',true]);await page.evaluate(async()=>{__fail=null;await refreshProjectNumbers();});});
 await check('A lost save response is recovered without creating a second project',async()=>{
   await page.evaluate(async()=>{window.__loseProjectInsertResponse=true;await saveProject();});
   assert.equal(await page.locator('#projectSheetOverlay').evaluate(el=>el.classList.contains('active')),true);
   assert.equal(await page.locator('#pf-name').inputValue(),'Сохранить после связи');
   await page.evaluate(async()=>{__fail=null;await saveProject();});
   const projects=await page.evaluate(()=>__db.projects.filter(p=>p.project_title==='Сохранить после связи'));
   assert.deepEqual(projects.map(p=>p.name),['Проект ДИ №32'+yy+' Сохранить после связи']);
   assert.equal(await page.locator('#projectSheetOverlay').evaluate(el=>el.classList.contains('active')),false);
 });
 await check('Account change clears next-number data',async()=>{const result=await page.evaluate(()=>{clearPrivateState();return [nextProjectNumbers,document.getElementById('nextProjectNumbers').hidden,document.getElementById('nextProjectNumbers').textContent];});assert.deepEqual(result,[null,true,'']);});
 for(const width of [360,390,768,1440])await check('No horizontal overflow at '+width,async()=>{await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({browser:browserName,checks:out},null,2));await browser.close();if(out.some(r=>!r.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
