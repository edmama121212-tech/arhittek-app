'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),mock=fs.readFileSync(path.join(__dirname,'mock.js'),'utf8');
const scenarios=[
 ['owner','Открыть финансы владельца','admin'],
 ['lead','Продолжить работу ведущего с договорами','designer'],
 ['employee','Продолжить работу сотрудника с проектами','architect'],
 ['missing','Дополнить пустой ввод','architect'],
 ['bad','Исправить опечатку после отказа','designer'],
 ['offline','Повторить после временного сбоя','admin'],
 ['back','Сменить выбранного сотрудника до входа','designer'],
 ['paste','Вставить код со случайным разделителем','architect'],
 ['duplicate','Дождаться начатого входа при повторном Enter','designer'],
 ['pendingBack','Передумать входить во время проверки кода','designer'],
 ['leading','Войти с ведущим нулём в коде','architect'],
 ['wait','Получить уведомление о временной паузе от сервера','designer']
];
const names={admin:'Мансур',designer:'Амина',architect:'Адам'};
(async()=>{
 const bundle=fs.readFileSync(path.join(root,'index.html')),hash=crypto.createHash('sha256').update(bundle).digest('hex').slice(0,16);
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const rows=[['Элементы','Сборка index','Сценарий','Действия','Итог и связи','От подтверждения до результата, мс','Визуально','Удобство','Стенд','Результат']];
 try{
  for(const [mode,task,actor] of scenarios){
   const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',locale:'ru-RU'});
   try{
    await ctx.addInitScript({content:mock+"\nlocalStorage.removeItem('arhittek_session');"});
    await ctx.route('**/*',route=>{
     const u=new URL(route.request().url()),f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
     return u.hostname==='app.test'&&fs.existsSync(f)&&fs.statSync(f).isFile()?route.fulfill({path:f}):route.fulfill({contentType:'text/javascript',body:''});
    });
    const page=await ctx.newPage();page.setDefaultTimeout(6000);await page.goto('https://app.test');
    await page.locator('#loginEmployeeList .list-item').first().waitFor();
    await page.evaluate(mode=>{
      window.__signIns=0;
      const prior=sb.rpc.bind(sb);
      sb.rpc=async(name,args)=>{
       if(name!=='verify_employee_pin')return prior(name,args);
       __signIns++;
       if(mode==='offline'&&__signIns===1)return {data:null,error:{message:'Учебный временный отказ'}};
       if(mode==='wait')return {data:[{error:'too_many_attempts'}],error:null};
       if(mode==='duplicate'||mode==='pendingBack')await new Promise(r=>setTimeout(r,300));
       if(args.p_pin!==(mode==='leading'?'001122':'1122'))return {data:[{}],error:null};
       const actor=__db.employees.find(e=>e.id===args.p_employee_id);
       return {data:[{employee_id:actor.id,name:actor.name,is_admin:!!actor.is_admin,session_token:'fixture-'+actor.id}],error:null};
      };
    },mode);
    const choose=id=>page.locator('#loginEmployeeList').getByText(names[id],{exact:true}).click();
    const pin=page.locator('#loginPin'),submit=page.locator('#loginSubmitBtn'),overlay=page.locator('#loginOverlay');
    let steps='Выбрать «'+names[actor]+'»';
    if(mode==='back'){
     await choose('admin');await pin.fill('11');await page.locator('#loginBackBtn').click();steps='Выбрать владельца → начать ввод → Назад → '+steps;
    }
    await choose(actor);
    assert.equal(await page.locator('#loginSelectedName').innerText(),names[actor]);assert.equal(await pin.inputValue(),'');
    const visible=await submit.boundingBox();assert.ok(visible&&visible.x>=0&&visible.x+visible.width<=391&&visible.height>=40);
    assert.equal(await pin.evaluate(e=>e.type),'password');
    const expected=mode==='leading'?'001122':'1122';
    if(mode==='missing'||mode==='bad'||mode==='offline'){
     if(mode!=='missing')await pin.fill(mode==='bad'?'1102':expected);
     await submit.click();await page.locator('#toast.show').filter({hasText:{missing:'Введите PIN-код',bad:'Неверный PIN-код',offline:'Ошибка входа'}[mode]}).waitFor();
     assert.ok(await overlay.isVisible());assert.equal(await page.evaluate(()=>window.session),null);
     assert.equal(await pin.inputValue(),mode==='offline'?expected:'');
     steps+=' → '+{missing:'пустое поле',bad:'ошибочный учебный PIN',offline:'временный отказ стенда'}[mode]+' → повтор';
    }
    await pin.fill(mode==='paste'?'11-22':expected);assert.equal(await pin.inputValue(),expected);
    const start=performance.now();
    if(mode==='duplicate'){
     await pin.press('Enter');await pin.press('Enter');steps+=' → Enter дважды во время входа';
    }else{await submit.click();steps+=' → Войти';}
    let outcome;
    if(mode==='pendingBack'){
     await page.locator('#loginBackBtn').click();
     await page.waitForFunction(()=>__writes.some(w=>w.rpc==='logout_session'));
     assert.ok(await page.locator('#loginEmployeeList').isVisible());
     assert.equal(await page.evaluate(()=>window.session),null);
     steps+=' → Назад до подтверждения';
     outcome='Возврат к выбору имени. Поздний ответ погашен, вход не выполнен.';
    }else if(mode==='wait'){
     await page.locator('#toast.show').filter({hasText:/Подождите/}).waitFor();assert.ok(await overlay.isVisible());assert.equal(await pin.inputValue(),'');assert.equal(await page.evaluate(()=>window.session),null);
     outcome='Остался экран входа. Причина задержки видна. Подтверждённого сеанса нет.';
    }else{
     await overlay.waitFor({state:'hidden'});await page.waitForFunction(()=>hasVerifiedAccess()&&!loadAllInFlight);
     assert.equal(await page.evaluate(()=>session.employeeId),actor);
     assert.equal(await page.evaluate(()=>isOwner()),actor==='admin');
     assert.equal(await page.evaluate(()=>canUseDocuments()),actor!=='architect');
     const menu=page.locator('.nav-btn[data-view="view-finance"]');assert.equal(await menu.isVisible(),actor==='admin');
     outcome='Открыт рабочий сеанс '+names[actor]+'. '+(actor==='admin'?'Видны финансы и доступны договоры.':actor==='designer'?'Доступны документы ведущего. Финансы скрыты.':'Финансы и подготовка договоров недоступны.');
    }
    const calls=await page.evaluate(()=>__signIns);
    assert.equal(calls,['bad','offline'].includes(mode)?2:1,task+' · число отправок');
    rows.push(['UI-0001 / UI-0002',hash,task,steps,outcome+' Запросов входа '+calls+'.',Math.round(performance.now()-start),'Поле с маской. Кнопка '+Math.round(visible.width)+'×'+Math.round(visible.height)+' px.','Имя выбранного сотрудника находится над полем ввода.',browser.version()+' / локальный ответ службы входа / '+new Date().toISOString(),'Пройдено']);
   }finally{await ctx.close();}
  }
 }finally{await browser.close();}
 if(process.env.LOGIN_FORM_CSV)fs.writeFileSync(process.env.LOGIN_FORM_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('12 synthetic login journeys passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
