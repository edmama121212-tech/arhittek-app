'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),index=fs.readFileSync(path.join(root,'index.html'));
const build=crypto.createHash('sha256').update(index).digest('hex').slice(0,16);
const original=['Учебный заказчик','+7 (000) 000-00-01','Учебная улица, 1'];
const revised=['Новый заказчик','+7 (000) 000-00-02','Тестовый переулок, 2'];
const rows=[
 ['first','Заполнить контакты к первому КП'],
 ['transfer','Передать проект новому заказчику с другим телефоном и площадкой'],
 ['clear','Снять устаревшие контакты до повторного согласования'],
 ['trim','Перенести реквизиты из заявки с краевыми пробелами'],
 ['quote','Указать заказчика и площадку с кавычками и амперсандом'],
 ['cancel','Отказаться от несогласованных правок'],
 ['decline','Проверить совпавший адрес и отказаться от замены'],
 ['agree','Зарегистрировать другое задание в том же здании'],
 ['same','Обновить заказчика по уже согласованному общему адресу'],
 ['race','Сохранить данные, поступившие от коллеги'],
 ['retry','Повторить неудачное сохранение без потери ввода'],
 ['lookup','Найти изменённый проект по трём новым реквизитам']
];
const ids=['pf-client-name','pf-phone','pf-address'];
const fields=['client_name','phone','address'];
const twoFrames=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const csv=[['Элемент','Сборка index','UTC / Chromium','Сценарий','Шаги и данные','Проверенный результат','Ввод до двух кадров, мс','Сохранение или отмена, мс','Визуальная проверка','Удобство','Итог']];
 try{
  for(const [i,[mode,goal]] of rows.entries()){
   const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',reducedMotion:'reduce',serviceWorkers:'block'});
   try{
    await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
    await ctx.route('**/*',route=>{const u=new URL(route.request().url()),file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));return u.hostname==='app.test'&&fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill(u.pathname==='/'?{body:index,contentType:'text/html'}:{path:file}):route.fulfill({body:''});});
    const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(4500);
    await p.goto('https://app.test/');await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
    const prior=mode==='first'?['','','']:original,side=[original[0]+' 2','+7 (000) 000-00-03',mode==='same'?prior[2]:'Тестовый корпус, 3'];
    let proposed=[...revised];
    if(mode==='clear')proposed=['','',''];
    if(mode==='trim')proposed=proposed.map(t=>'  '+t+'  ');
    if(mode==='quote')proposed=['Бюро «А & Б»',revised[1],'Учебный центр «А & Б», 1'];
    if(mode==='same')proposed[2]=prior[2];
    if(['agree','decline'].includes(mode))proposed[2]=side[2];
    const [id,other]=['qa-a','qa-b'],titles=['Учебный корпус А','Учебный корпус Б'];
    await p.evaluate(async ({id,other,prior,side,titles,mode})=>{
     const project=(id,name,[client_name,phone,address])=>({id,name,client_name,phone,address,category_id:'arch',status_id:'active',price:1400,advance:100,balance:1300,payment_status:'Частично оплачен',fee_base:'profit',updated_at:'2026-01-01T00:00:00Z'});
     __db.projects=[project(id,titles[0],prior),project(other,titles[1],side)];
     __db.kp_forms=[{id:'signed',project_id:id,client_name:prior[0],client_phone:prior[1],object:prior[2]}];
     window.__contactPrompts=[];
     window.confirm=msg=>{if(/адресом|уже указан в проекте/.test(msg)){__contactPrompts.push(msg);return mode!=='decline';}return true;};
     await loadAll();
    },{id,other,prior,side,titles,mode});
    await p.locator('.nav-btn[data-view="view-projects"]').click();
    const target=p.locator('#projectsCard .proj-row').filter({hasText:titles[0]});
    const form=p.locator('#projectSheetOverlay'),contact=p.locator('#pf-phone-field');
    const get=pfx=>p.locator('#'+pfx);
    async function open(){await target.click();await get('project-tab-overview').click();if(!await contact.isVisible())await form.locator('summary').filter({hasText:'Контакты и адрес'}).click();}
    await open();
    assert.equal(await get('pf-phone').getAttribute('type'),'tel');
    const times=[],widths=[];
    for(const [j,key] of ids.entries()){
     const el=get(key);assert.equal(await el.inputValue(),prior[j]);let t=performance.now();await el.fill(proposed[j]);await twoFrames(p);times.push(Math.round(performance.now()-t));
     const box=await el.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=391);widths.push(Math.round(box.width));
     if(key==='pf-phone')assert.ok(await el.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'Полностью виден учебный номер телефона');
    }
    if(mode==='race')await p.evaluate(()=>Object.assign(__db.projects[0],{client_name:'Согласовано коллегой',phone:'00000004',address:'Учебный адрес 4',updated_at:'2026-02-01T00:00:00Z'}));
    if(mode==='retry')await p.evaluate(()=>{__fail={table:'projects',op:'update'};});
    const snapshot=await p.evaluate(()=>JSON.stringify([__db.kp_forms,__db.ledger_entries,__db.projects[1]]));
    let t=performance.now();
    if(mode==='cancel')await get('pf-cancel').click();else await get('pf-save').click();
    if(mode==='decline'||mode==='race'||mode==='retry'){
     if(mode==='decline')assert.equal(await p.evaluate(()=>__contactPrompts.length),1);
     else await get('toast').filter({hasText:mode==='race'?/обновил/i:/ошиб/i}).waitFor();
     for(const [j,key] of ids.entries())assert.equal(await get(key).inputValue(),proposed[j]);
     if(mode==='retry'){await p.evaluate(()=>{__fail=null;});await get('pf-save').click();}else await get('pf-cancel').click();
    }
    await form.waitFor({state:'hidden'});await p.waitForFunction(()=>!loadAllInFlight);await twoFrames(p);
    const saveMs=Math.round(performance.now()-t);
    const prompts=await p.evaluate(()=>__contactPrompts);assert.equal(prompts.length,['agree','decline'].includes(mode)?1:0,'лишнее подтверждение совпадающего адреса: '+mode);
    if(prompts.length)assert.ok(!prompts[0].includes('создать ещё один'),'редактирование существующего проекта предлагает создать ещё один');
    const expect=mode==='race'?['Согласовано коллегой','00000004','Учебный адрес 4']:['decline','cancel'].includes(mode)?prior:proposed.map(t=>t.trim());
    if(mode==='race')await p.evaluate(()=>loadAll());
    const saved=await p.evaluate(()=>__db.projects[0]);assert.deepEqual(fields.map(k=>saved[k]||''),expect);
    assert.deepEqual([saved.price,saved.advance,saved.balance],[1400,100,1300]);assert.equal(await p.evaluate(()=>JSON.stringify([__db.kp_forms,__db.ledger_entries,__db.projects[1]])),snapshot);
    const list=await target.innerText();
    for(const j of [0,2])if(expect[j])assert.ok(list.includes(expect[j]));
    if(mode==='lookup')for(const q of expect){await get('projectSearch').fill(q);assert.equal(await p.locator('#projectsCard .proj-row').count(),1);assert.ok(await target.isVisible());}
    await open();for(const [j,key] of ids.entries())assert.equal(await get(key).inputValue(),expect[j]);
    if(mode==='quote'&&process.env.PROJECT_CONTACT_SHOT)await contact.screenshot({path:process.env.PROJECT_CONTACT_SHOT});
    await get('project-tab-files').click();await get('pf-create-kp').click();
    const actual=[];for(const key of ['kp-client-name','kp-client-phone','kp-object'])actual.push(await get(key).inputValue());
    assert.deepEqual(actual,[expect[0],expect[1],expect[2]||titles[0]]);assert.deepEqual(errors,[]);
    const action={cancel:'Отмена',decline:'Сохранить → отклонить совпадение адреса → Отмена',agree:'Сохранить → подтвердить общий адрес',race:'Коллега меняет реквизиты → Сохранить → закрыть форму при конфликте → обновить',retry:'Сохранить → сбой → повторить сохранение'}[mode]||'Сохранить';
    for(const [j,key] of ids.entries())csv.push([['UI-0195','UI-0200','UI-0201'][j],build,new Date().toISOString()+' / '+browser.version(),goal,'Проекты → '+titles[0]+' → Обзор → Контакты и адрес → '+key+' = '+(proposed[j]||'(очистить)')+' → '+action+' → список → открыть заново → Документы → Создать КП','Карточка: '+(expect[j]||'(пусто)')+'. Новое КП: '+(actual[j]||'(пусто)')+'. Согласованное КП, другой проект и долг 1300 ₽ сохранены.',times[j],saveMs,'Поле '+widths[j]+' px в пределах мобильного экрана 390 px.'+(j===1?' Для ввода номера используется телефонное поле.':''),'После повторного открытия виден сохранённый контакт. Подтверждений совпадения адреса: '+prompts.length+'.','Пройдено']);
    console.log(mode,saveMs);
   }finally{await ctx.close();}
  }
 }finally{await browser.close();}
 if(process.env.PROJECT_CONTACT_CSV)fs.writeFileSync(process.env.PROJECT_CONTACT_CSV,'\ufeff'+csv.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
