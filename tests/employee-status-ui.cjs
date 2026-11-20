'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'));
const build=crypto.createHash('sha256').update(html).digest('hex').slice(0,16);
const cases=[
 ['edit','Сохранить заметку в проекте после архивирования исполнителя'],
 ['co','Оставить прежнего соисполнителя в карточке проекта'],
 ['new','Исключить архивного специалиста из нового назначения'],
 ['other','Исключить перенос прежнего назначения в соседний объект'],
 ['member','Сохранить участие в дополнительной команде'],
 ['restore','Вернуть архитектора в список назначения после перерыва'],
 ['cancel','Отказаться от перевода сотрудника в архив'],
 ['retry','Повторить смену статуса после временной ошибки записи'],
 ['pay','Сохранить условия оклада на период архива'],
 ['twins','Архивировать одного из двух одноимённых специалистов'],
 ['history','Проверить запись о возврате архивного сотрудника в команду']
];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const rows=[['Элемент','Сборка index SHA256','UTC','Цель','Шаги','Бизнес-результат и связи','Подтверждение до результата, мс','Вид и удобство','Браузер','Итог']];
 try{for(const [mode,task] of cases){
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',locale:'ru-RU'});
  try{
   await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
   await ctx.route('**/*',r=>{const u=new URL(r.request().url()),f=path.join(root,u.pathname.slice(1));
    if(u.origin!=='https://app.test')return r.fulfill({body:''});
    if(u.pathname==='/')return r.fulfill({body:html,contentType:'text/html'});
    return fs.existsSync(f)&&fs.statSync(f).isFile()?r.fulfill({path:f}):r.fulfill({status:404,body:''});
   });
   const p=await ctx.newPage();p.setDefaultTimeout(5000);
   const errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.goto('https://app.test');await p.waitForFunction(()=>typeof hasVerifiedAccess==='function'&&hasVerifiedAccess()&&!loadAllInFlight);
   await p.evaluate(async mode=>{
    const employee=__db.employees.find(e=>e.id==='architect');employee.active=!['restore','history'].includes(mode);employee.is_salaried=mode==='pay';employee.fixed_salary=mode==='pay'?37000:0;
    if(mode==='twins')__db.employees.find(e=>e.id==='designer').name=employee.name;
    __db.projects=['one','two'].map((id,i)=>({id,name:i?'Учебный сад':'Учебный дом',category_id:'arch',department_id:'d',status_id:'active',price:15000,advance:0,fee_percent:40,fee_base:'profit',employee_id:i||mode==='member'||mode==='co'?'designer':'architect',co_employee_id:!i&&mode==='co'?'architect':null}));
    __db.project_members=mode==='member'?[{id:'join',project_id:'one',employee_id:'architect'}]:[];await loadAll();
   },mode);
   const before=await p.evaluate(()=>JSON.stringify(__db.projects)), active=['restore','history'].includes(mode);
   await p.locator('#settingsBtn').click();
   const card=p.locator('#employeesCard .list-item').filter({hasText:'Архитектор'}).filter({hasText:'Адам'});
   const openEmp=()=>card.getByRole('button').click();
   await openEmp();
   const status=p.getByRole('combobox',{name:'Статус',exact:true});
   await status.selectOption(String(active));
   const box=await status.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=391);
   if(mode==='retry')await p.evaluate(()=>window.__fail={table:'employees',op:'update',error:{message:'Временный отказ'}});
   let steps='Настройки → Адам, архитектор → Статус → '+(active?'Активен':'Неактивен (архив)');
   let result;
   const start=performance.now();
   if(mode==='cancel'){await p.locator('#ef-cancel').click();steps+=' → Отмена';}
   else{
    await p.locator('#ef-save').click();
    if(mode==='retry'){
     await p.locator('#toast').filter({hasText:/Временный отказ/}).waitFor();assert.equal(await status.inputValue(),'false');
     assert.equal(await p.evaluate(()=>__db.employees.find(e=>e.id==='architect').active),true);
     await p.evaluate(()=>window.__fail=null);
     await p.locator('#ef-save').click();steps+=' → отказ → повторить';
    }
    steps+=' → сохранить';
   }
   await p.locator('#empSheetOverlay').waitFor({state:'hidden'});
   if(mode!=='cancel')await p.waitForFunction(v=>state.employees.find(e=>e.id==='architect').active===v&&!loadAllInFlight,active);
   await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const ms=Math.round(performance.now()-start);
   assert.equal((await card.innerText()).includes('(архив)'),!(active||mode==='cancel'));
   assert.equal(await p.evaluate(()=>JSON.stringify(__db.projects)),before);
   const project=async name=>{await p.locator('.nav-btn[data-view="view-projects"]').click();if(name)await p.locator('.proj-row').filter({hasText:name}).click();else await p.locator('#addProjectFab').click();};
   if(['edit','co','member','other','new','restore'].includes(mode)){
    const newCard=['new','restore'].includes(mode);
    await project(newCard?null:'Учебный дом');steps+=' → Проекты → '+(newCard?'новая карточка':'Учебный дом');
    if(mode==='edit'||mode==='co'||mode==='other'){
     const selector=mode==='co'?'#pf-co-employee-fee':'#pf-employee-fee';
     assert.equal(await p.locator(selector).inputValue(),'architect','Архивный специалист пропал из существующего назначения');
     assert.match(await p.locator(selector+' option:checked').innerText(),/архив/i);
     if(mode==='edit'){
      await p.locator('#pf-notes').fill('Продолжить работы летом');await p.locator('#pf-save').click();await p.locator('#projectSheetOverlay').waitFor({state:'hidden'}).catch(async err=>{throw Error(await p.locator('#toast').innerText()+' '+err.message);});
      const saved=await p.evaluate(()=>__db.projects.find(x=>x.id==='one'));assert.equal(saved.employee_id,'architect');assert.equal(saved.notes,'Продолжить работы летом');
      result='Заметка записана, идентификатор ответственного остался прежним.';steps+=' → изменить и сохранить заметку';
     }else if(mode==='other'){
      await p.locator('#pf-cancel').click();await project('Учебный сад');assert.equal(await p.locator(selector+' option[value=architect]').count(),0);steps+=' → закрыть → Учебный сад';
      result='Архивный ответственный отображается в своём доме, в списке соседнего проекта его нет.';
     }else result='Соисполнитель остался выбранным с отметкой архива, ответственный за объект сохранён.';
    }else if(mode==='member'){
     assert.equal(await p.locator('[data-remove-member=architect]').count(),1);assert.equal(await p.locator('#pf-members-add option[value=architect]').count(),0);
     result='Прежнее участие в команде сохранено, повторно добавить архивного сотрудника нельзя.';
    }else{
     assert.equal(await p.locator('#pf-employee-fee option[value=architect]').count(),Number(active));
     result=active?'В новой карточке исполнителя снова можно назначить.':'В новой карточке нет архивного сотрудника среди исполнителей.';
    }
   }else if(mode==='pay'){await openEmp();assert.equal(await p.locator('#ef-fixed-salary').inputValue(),'37000');assert.ok(await p.locator('#ef-is-salaried').isChecked());steps+=' → вновь открыть карточку';result='В архивной карточке сохранился оклад 37 000 ₽.';}
   else if(mode==='twins'){assert.ok(!(await p.locator('#employeesCard .list-item').filter({hasText:'Ведущий дизайнер'}).innerText()).includes('архив'));result='Одноимённый дизайнер остался активным.';}
   else if(mode==='history'){assert.ok(await p.evaluate(()=>(__db.audit_log||[]).some(h=>h.entity_id==='architect'&&h.changes?.active?.new===true)));result='Сотрудник снова активен. Журнал сохранил переход из архивного статуса.';}
   else result=mode==='cancel'?'Сотрудник остаётся действующим, связанные проекты сохранены.':'После отказа выбранный статус сохранён в форме; повтор перевёл сотрудника в архив.';
   if(mode==='co'&&process.env.STATUS_SHOT){await p.locator('#project-tab-team').click();const field=p.locator('#pf-co-employee-fee');await field.scrollIntoViewIfNeeded();await p.screenshot({path:process.env.STATUS_SHOT});}
   assert.deepEqual(errors,[]);
   rows.push(['UI-0277',build,new Date().toISOString(),task,steps,result,ms,'Поле статуса в пределах окна 390 px; после закрытия статус виден в списке сотрудников.',browser.version(),'Пройдено']);console.log(mode,ms);
  }finally{await ctx.close();}
 }}finally{await browser.close();}
 if(process.env.STATUS_CSV)fs.writeFileSync(process.env.STATUS_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
