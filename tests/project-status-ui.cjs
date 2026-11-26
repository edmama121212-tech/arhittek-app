'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'));
const build=crypto.createHash('sha256').update(index).digest('hex').slice(0,16);
const names={new:'Запись',active:'В процессе',frozen:'Заморожен',done:'Завершён',legacy:'Согласование эскиза'};
const cases=[
 ['legacy','Сохранить заметку у проекта на прежнем этапе согласования','legacy','legacy'],
 ['debt','Сдать объект, оставив видимой неоплаченную часть договора','active','done'],
 ['cent','Сдать проект с неоплаченным остатком в одну копейку','active','done'],
 ['settled','Закрыть полностью оплаченный объект','active','done'],
 ['start','Перевести заявку в производство','new','active'],
 ['freeze','Приостановить просроченную работу','active','frozen'],
 ['resume','Вернуть просроченную работу после паузы','frozen','active'],
 ['return','Вернуть сданный объект на доработку с долгом','done','active'],
 ['cancel','Отказаться от преждевременного закрытия','active','done'],
 ['move','Перенести проект из прежнего этапа в производство','legacy','active'],
 ['conflict','Сохранить решение коллеги при одновременной смене этапа','active','frozen'],
 ['null','Назначить этап карточке без статуса',null,'new'],
 ['defer','Перенести запланированный старт на паузу','new','frozen']
];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const rows=[['Элемент','SHA256 index','UTC / Chromium','Сценарий','Шаги','Факт и связанные записи','Ответ до результата, мс','Вид и удобство','Итог']];
 try{
 for(const [mode,goal,old,next] of cases){
  const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',reducedMotion:'reduce',serviceWorkers:'block'});
  try{
   await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
   await ctx.route('**/*',route=>{const u=new URL(route.request().url()),file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));return u.hostname==='app.test'&&fs.existsSync(file)?route.fulfill(u.pathname==='/'?{body:index,contentType:'text/html'}:{path:file}):route.fulfill({body:''});});
   const p=await ctx.newPage(),errors=[];p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));
   await p.goto('https://app.test/');await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
   const due=mode==='settled'?0:mode==='cent'?0.01:400;
   await p.evaluate(async({old,due})=>{
    __db.statuses.push({id:'legacy',name:'Согласование эскиза'});
    __db.projects=[{id:'p',name:'Учебная вилла',category_id:'arch',status_id:old,price:1000,advance:1000-due,balance:due,fee_base:'profit',end_date:'2020-01-01',updated_at:'2025-01-01T00:00:00Z'},
    {id:'side',name:'Соседний объект',category_id:'arch',status_id:'active',price:1000,advance:0,balance:1000}];
    __db.audit_log=[];__db.ledger_entries=[];await loadAll();
   },{old,due});
   await p.locator('.bottom-nav [data-view="view-projects"]').click();
   const row=p.locator('#projectsCard .proj-row').filter({hasText:'Учебная вилла'}),status=p.locator('#pf-status');
   await row.click();
   let steps='Проекты → Учебная вилла → '+(names[old]||'без статуса');
   if(mode==='legacy'){await p.locator('#pf-notes').fill('Уточнить срок согласования');steps+=' → изменить только заметку';}
   else{await status.selectOption(next);steps+=' → '+names[next];assert.ok(await p.locator('#project-glance').getByText(new RegExp(names[next])).isVisible());}
   if(mode==='conflict')await p.evaluate(()=>Object.assign(__db.projects[0],{status_id:'new',updated_at:new Date().toISOString()}));
   const start=performance.now();
   if(mode==='cancel'){await p.locator('#pf-cancel').click();steps+=' → Отмена';}
   else {await p.locator('#pf-save').click();steps+=' → Сохранить';}
   if(mode==='conflict'){
    await p.locator('#toast').filter({hasText:'Данные обновились'}).waitFor();
    await p.locator('#pf-cancel').click();
    await p.evaluate(()=>loadAll());
   }
   await p.locator('#projectSheetOverlay').waitFor({state:'hidden'});
   await p.waitForFunction(()=>!loadAllInFlight);
   const expected=mode==='conflict'?'new':mode==='cancel'?old:next;
   const stored=await p.evaluate(()=>({projects:__db.projects,ledger:__db.ledger_entries,history:__db.audit_log}));
   assert.equal(stored.projects[0].status_id,expected,goal);assert.equal(stored.projects[0].balance,due);assert.equal(stored.projects[1].status_id,'active');assert.equal(stored.ledger.length,0);
   await row.locator('[data-status]').filter({hasText:names[expected]}).first().waitFor();
   await p.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
   const ms=Math.round(performance.now()-start);
   assert.equal(await row.locator('.overdue').count(),['done','frozen'].includes(expected)?0:1);
   const rest=await row.locator('.proj-rest').innerText();
   assert.ok(due?rest.includes(due.toLocaleString('ru-RU')):rest.includes('закрыт'),rest);
   const audit=stored.history.filter(e=>e.entity_type==='project'&&e.entity_id==='p'&&e.changes?.status_id);
   assert.equal(audit.length,old===expected||mode==='conflict'?0:1);
   if(audit.length){assert.equal(audit[0].changes.status_id.old,old);assert.equal(audit[0].changes.status_id.new,expected);}
   const width=await row.evaluate(e=>[e.clientWidth,e.scrollWidth]);assert.ok(width[1]<=width[0]+1);
   if(mode==='cent'&&process.env.PROJECT_STATUS_SHOT)await row.screenshot({path:process.env.PROJECT_STATUS_SHOT});
   await row.click();assert.equal(await status.inputValue(),expected);await p.locator('#pf-cancel').click();
   assert.deepEqual(errors,[]);
   rows.push(['UI-0193',build,new Date().toISOString()+' / '+browser.version(),goal,steps+' → список → повторно открыть',names[expected]+'. '+rest+'. В истории изменений статуса '+audit.length+', проводок 0. Соседний проект сохранён.',ms,'Строка шириной '+width[0]+' px, видны этап и остаток; '+(['done','frozen'].includes(expected)?'указатель просрочки скрыт':'виден указатель просрочки')+'.','Пройдено']);
   console.log(mode,ms);
  }finally{await ctx.close();}
 }
 if(process.env.PROJECT_STATUS_CSV)fs.writeFileSync(process.env.PROJECT_STATUS_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
