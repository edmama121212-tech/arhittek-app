'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html')),script=fs.readFileSync(path.join(root,'employee-access.js'));
const build=[html,script].map(b=>crypto.createHash('sha256').update(b).digest('hex').slice(0,12)).join('/');
const localRoute=route=>{
    const u=new URL(route.request().url());if(u.origin!=='https://app.test')return route.fulfill({body:''});
    const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);
    return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({status:404,body:''});
};
const cases=[
 ['foreman','Назначить архитектора на должность прораба','Архитектор','Прораб',null,true,true],
 ['reassign','Передать прорабу работу визуализатора','Прораб','Визуализатор',null,true,false],
 ['keep','Сохранить индивидуальный доступ к стройке при смене должности','Менеджер','Комплектатор',true,true,true],
 ['limit','Назначить прораба с ранее отключённой стройкой','Сотрудник','Прораб',false,true,false],
 ['override','Ограничить новую должность до сохранения','Архитектор','Менеджер',null,true,false],
 ['construction','Назначить ведущего с доступом только к стройке и документам','Прораб','Ведущий архитектор',true,false,true],
 ['demote','Передать ведущему дизайнеру рядовую работу с проектами','Ведущий дизайнер','Дизайнер',false,true,false],
 ['legacy','Сменить прежнюю нестандартную должность на штатную','Инженер по освещению','Чертёжник',false,true,false],
 ['cancel','Отказаться от перевода прораба в проектный отдел','Прораб','Архитектор',null,true,true],
 ['salary','Сохранить условия оклада при переводе в ведущие','Архитектор','Ведущий дизайнер',false,true,false],
 ['retry','Сохранить новое назначение после отказа хранилища','Дизайнер','Менеджер',null,true,true],
 ['owner','Изменить должность владельца с сохранением его разделов','Директор','Сотрудник',false,true,true],
 ['namesake','Переименовать должность одноимённого административного сотрудника','Генеральный директор','Архитектор',false,true,false]
];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const rows=[['Элемент','Сборка index/employee-access','UTC','Бизнес-сценарий','Шаги','Результат и последствия','После подтверждения до результата, мс','Вид и удобство','Стенд','Статус']];
 try{for(const [mode,title,old,role,construction,projects,expectedConstruction] of cases){
  const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',reducedMotion:'reduce',serviceWorkers:'block'});
  try{
   const id=mode==='owner'?'admin':'architect';
   await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
   await ctx.route('**/*',localRoute);
   const p=await ctx.newPage();p.setDefaultTimeout(5500);const errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.goto('https://app.test/');await p.waitForFunction(()=>typeof isOwner==='function'&&isOwner()&&!loadAllInFlight);
   await p.evaluate(async({mode,id,old,construction,projects})=>{
    Object.assign(__db.employees.find(e=>e.id===id),{role:old,can_see_construction:construction,can_see_projects:projects,is_admin:mode==='owner'||mode==='namesake',is_salaried:mode==='salary',fixed_salary:mode==='salary'?42500:0});
    if(mode==='namesake')__db.employees.find(e=>e.id===id).name='Мансур';
    __db.projects=[{id:'qa-house',name:'Тестовый дом',employee_id:id,category_id:'arch',status_id:'active'}];await loadAll();
   },{mode,id,old,construction,projects});
   const before=await p.evaluate(()=>JSON.stringify(__db.projects));
   await p.locator('#settingsBtn').click();
   const emp=p.locator('#employeesCard .list-item').filter({hasText:mode==='owner'||mode==='namesake'?'Мансур':'Адам'}).filter({hasText:old});
   await emp.getByRole('button').click();
   const select=p.getByLabel('Должность',{exact:true}),summary=p.locator('#ef-role-access'),constructionBox=p.locator('#ef-see-construction');
   assert.equal(await select.inputValue(),old);
   await select.selectOption(role);
   if(mode==='override')await constructionBox.uncheck();
   if(mode!=='owner')assert.equal(await constructionBox.isChecked(),mode==='cancel'?false:expectedConstruction,'Выбор стройки после смены должности');
   const preview=await summary.innerText();
   if(mode==='owner')assert.match(preview,/все проекты и все разделы/);
   else{
    assert.equal(preview.includes('свои объекты'),mode!=='cancel'&&expectedConstruction);
    assert.equal(preview.includes('свои проекты'),projects);
    assert.equal(preview.includes('КП и Договор'),role.startsWith('Ведущий'));
   }
   await select.scrollIntoViewIfNeeded();
   const visual=await select.evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=100&&r.left>=0&&r.right<=innerWidth;});
   assert.ok(visual);assert.ok(await summary.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
   if(mode==='construction'&&process.env.ROLE_SHOT)await p.screenshot({path:process.env.ROLE_SHOT});
   if(mode==='retry')await p.evaluate(()=>window.__fail={table:'employees',op:'update',error:{message:'Временный отказ'}});
   let steps='Настройки → '+old+' → Должность → '+role+(mode==='override'?' → отключить стройку':'');
   const start=performance.now();
   if(mode==='cancel'){await p.locator('#ef-cancel').click();steps+=' → Отмена';}
   else{
    await p.locator('#ef-save').click();
    if(mode==='retry'){await p.locator('#toast').filter({hasText:'Временный отказ'}).waitFor();assert.equal(await select.inputValue(),role);await p.evaluate(()=>window.__fail=null);await p.locator('#ef-save').click();steps+=' → повторить после ошибки';}
    steps+=' → Сохранить';
   }
   await p.locator('#empSheetOverlay').waitFor({state:'hidden'});await p.waitForFunction(()=>!loadAllInFlight);
   await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const ms=Math.round(performance.now()-start),saved=await p.evaluate(id=>__db.employees.find(e=>e.id===id),id);
   const finalRole=mode==='cancel'?old:role;
   assert.equal(saved.role,finalRole);
   if(construction==null&&mode!=='override')assert.equal(saved.can_see_construction,null);
   const effective=saved.can_see_construction??['Прораб','Менеджер'].includes(saved.role);
   if(mode!=='owner')assert.equal(effective,expectedConstruction);
   assert.equal(saved.fixed_salary,mode==='salary'?42500:0);
   assert.equal(await p.evaluate(()=>JSON.stringify(__db.projects)),before);
   assert.ok(await p.locator('#employeesCard .list-item').filter({hasText:saved.name}).filter({hasText:finalRole}).getByText(/1 проект/).isVisible());
   const audit=await p.evaluate(id=>(__db.audit_log||[]).filter(x=>x.entity_id===id&&x.changes?.role),id);
   if(mode==='cancel')assert.equal(audit.length,0);else assert.deepEqual(audit.at(-1).changes.role,{old,new:role});
   // Reopen the saved card so section state is verified after the next read.
   await p.locator('#employeesCard .list-item').filter({hasText:saved.name}).filter({hasText:finalRole}).getByRole('button').click();
   if(mode!=='owner')assert.equal(await constructionBox.isChecked(),expectedConstruction);
   let navigation='';
   if(['foreman','reassign','construction','demote','namesake','owner'].includes(mode)){
    const staff=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
    try{
     const login={employeeId:id,name:saved.name,token:'qa-role-'+id,createdAt:Date.now()};
     const fixture={employees:await p.evaluate(()=>__db.employees),projects:JSON.parse(before)};
     await staff.addInitScript({content:fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+
      '\nObject.assign(__db,'+JSON.stringify(fixture)+');localStorage.setItem("arhittek_session",'+JSON.stringify(JSON.stringify(login))+');'});
     await staff.route('**/*',localRoute);
     const view=await staff.newPage();await view.goto('https://app.test/');
     await view.waitForFunction(()=>typeof hasVerifiedAccess==='function'&&hasVerifiedAccess()&&!loadAllInFlight);
     const nav=key=>view.locator('.nav-btn[data-view="view-'+key+'"]');
     assert.equal(await nav('construction').isVisible(),expectedConstruction);
     assert.equal(await nav('projects').isVisible(),projects);
     assert.equal(await nav('more').isVisible(),mode==='owner'||role.startsWith('Ведущий'));
     assert.equal(await nav('finance').isVisible(),mode==='owner');
     const target=expectedConstruction?'construction':'projects';
     await nav(target).click();assert.ok(await view.locator('#view-'+target+'.active').isVisible());
     steps+=' → открыть приложение сотрудника → '+(target==='construction'?'Стройка':'Проекты');
     navigation=' В отдельной тестовой сессии проверены вкладки сотрудника.';
    }finally{await staff.close();}
   }
   assert.deepEqual(errors,[]);
   rows.push(['UI-0276',build,new Date().toISOString(),title,steps+' → повторно открыть карточку',
    'Должность «'+finalRole+'». '+(mode==='owner'?'Владелец сохранил полный доступ.':'Стройка '+(effective?'доступна':'выключена')+'.')+' Назначение в проекте сохранено. Изменений должности в журнале: '+audit.length+'.'+(mode==='salary'?' Оклад 42 500 ₽.':'')+navigation,ms,
    'Выбор и пояснение помещаются на 390 px. До подтверждения видно: '+preview,'Локальный Chromium '+browser.version(),'Пройдено']);
  }finally{await ctx.close();}
 }}finally{await browser.close();}
 if(process.env.ROLE_CSV)fs.writeFileSync(process.env.ROLE_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('13 employee role journeys passed',build);
})().catch(e=>{console.error(e);process.exitCode=1;});
