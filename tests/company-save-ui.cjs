'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
const initial={id:'test-studio',full_name:'Учебное бюро',short_name:'Учебное',director:'Учебный директор',legal_address:'Тестовая 1',office_address:'Офисная 2',card_number:'0000000000000022',bank_account:'00000000000000000001',updated_at:'2026-01-01T00:00:00Z'};
const cases=[
 ['double','Создать первую карточку при двойном нажатии','full-name','full_name','Новое учебное бюро'],
 ['appeared','Открыть первую карточку, которую успел создать коллега','phone','phone','Тестовый номер'],
 ['stale','Сохранить чужое изменение при работе со старой карточкой','phone','phone','000 111'],
 ['deleted','Сообщить об исчезновении открытой карточки','email','email','new@example.test'],
 ['retry','Повторить запись после временного отказа','director','director','Новый учебный директор'],
 ['first','Завести компанию перед подготовкой реквизитов','short-name','short_name','Новый офис'],
 ['legal','Сменить юридический адрес без смены офиса','legal-addr','legal_address','Тестовый переулок 6'],
 ['office','Сменить фактический адрес для КП','office-addr','office_address','Учебный офис 9'],
 ['tax','Внести идентификатор с начальными нулями','inn','inn','0000000021'],
 ['bank','Обновить расчётный счёт, сохранив банковскую карту','bank-account','bank_account','00000000000000000801'],
 ['clear','Удалить утративший силу номер карты','card-number','card_number',''],
 ['name','Убрать случайные пробелы в названии бюро','full-name','full_name','  Учебная студия  '],
 ['contact','Добавить почту для связи и проверить в выгрузке','email','email','office@example.test']
];
(async()=>{
 const rows=[['Элемент','Сборка SHA256 index','UTC','Chromium','Задача','Шаги','Результат и связанные разделы','Действие до обратной связи, мс','Визуально','Удобство','Статус']];
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 try{
  for(const [mode,goal,field,column,value] of cases){
   const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
   try{
    await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
    await ctx.route('**/*',route=>{
     const u=new URL(route.request().url()),f=path.join(root,u.pathname==='/'?'index.html':u.pathname);
     return u.hostname==='app.test'&&fs.existsSync(f)&&fs.statSync(f).isFile()?route.fulfill({path:f}):route.fulfill({body:'',contentType:'text/javascript'});
    });
    const p=await ctx.newPage();p.setDefaultTimeout(5000);await p.goto('https://app.test/');
    await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
    const fresh=['double','first','appeared'].includes(mode);
    await p.evaluate(async data=>{__db.company_info=data;await loadAll()},fresh?[]:[initial]);
    const open=async()=>{await p.locator('.nav-btn[data-view="view-more"]').click();await p.locator('#openCompanyBtn').click();};
    await open();const input=p.locator('#co-'+field),button=p.locator('#companySaveBtn');
    await input.fill(value);
    if(mode==='retry')await p.evaluate(()=>{__fail={table:'company_info',op:'update'};});
    if(mode==='appeared')await p.evaluate(data=>{__db.company_info=[data];},initial);
    if(mode==='stale')await p.evaluate(()=>{Object.assign(__db.company_info[0],{director:'Следующий директор',updated_at:'2026-02-03T12:00:00Z'});});
    if(mode==='deleted')await p.evaluate(()=>{__db.company_info=[];});
    await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391&&box.height>=40);
    const finances=await p.evaluate(()=>JSON.stringify([__db.projects,__db.ledger_entries]));
    const start=performance.now();
    if(mode==='double')await button.evaluate(b=>{b.click();b.click();});
    else await button.click();
    let result;
    const reject=['deleted','stale','appeared'].includes(mode);
    if(reject){
     await p.locator('#toast.show').filter({hasText:/Реквизиты изменились/}).waitFor();assert.equal(await input.inputValue(),value);
     assert.deepEqual(await p.evaluate(()=>__db.company_info),mode==='deleted'?[]:mode==='appeared'?[initial]:[{...initial,director:'Следующий директор',updated_at:'2026-02-03T12:00:00Z'}]);
     result='Запись отклонена, черновик в форме сохранён. '+(mode==='deleted'?'Удалённая карточка не воссоздана.':mode==='appeared'?'Сохранена одна карточка коллеги.':'Сохранено изменение директора в другом сеансе.');
    }else{
     if(mode==='retry'){
      await p.locator('#toast.show').filter({hasText:/Ошибка сохранения/}).waitFor();assert.equal(await input.inputValue(),value);
      assert.deepEqual(await p.evaluate(()=>__db.company_info),[initial]);await p.evaluate(()=>{__fail=null;});await button.click();
     }
     await p.locator('#toast.show').filter({hasText:'Реквизиты сохранены'}).waitFor();
     await p.waitForFunction(()=>!loadAllInFlight);
    }
    await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const ms=Math.round(performance.now()-start);
    if(!reject){
     const db=await p.evaluate(()=>__db.company_info);assert.equal(db.length,1,mode+': число карточек');assert.equal(db[0][column],value.trim());
     if(!fresh)for(const [key,v] of Object.entries(initial))if(key!==column&&key!=='updated_at')assert.equal(db[0][key],v);
     await open();assert.equal(await input.inputValue(),value.trim());
     await p.locator('#co-export-scope').selectOption('all');await p.locator('#co-export-format').selectOption('word');
     const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#companyExportBtn').click()]);
     const html=fs.readFileSync(await download.path(),'utf8');
     if(value.trim())assert.ok(html.includes(value.trim()));else assert.ok(!html.includes(initial.card_number));
     result='В базе одна карточка. После повторного открытия и в скачанном Word '+(value.trim()?'подтверждено «'+value.trim()+'».':'прежний номер отсутствует.')+' Прочие исходные поля сверены.';
    }
    assert.equal(await p.evaluate(()=>JSON.stringify([__db.projects,__db.ledger_entries])),finances);
    if(mode==='stale'&&process.env.COMPANY_SAVE_SHOT)await p.screenshot({path:process.env.COMPANY_SAVE_SHOT});
    const action=({retry:' → отказ записи → повторить',double:' → нажать дважды',deleted:' → исходную запись удалили в другом сеансе',stale:' → в другом сеансе изменили директора',appeared:' → в другом сеансе создана компания'})[mode]||'';
    rows.push(['UI-0270',build,new Date().toISOString(),browser.version(),goal,'Ещё → Реквизиты → '+field+'='+value+action+' → Сохранить'+(reject?'':' → открыть снова → Скачать реквизиты (Word)'),result,ms,'Кнопка '+Math.round(box.width)+'×'+Math.round(box.height)+' px в границах экрана. ',reject?'Сообщение объясняет причину отказа.':mode==='retry'?'Данные сохранены со второй попытки без повторного ввода.':'Подтверждение записи видно в форме.','Пройдено']);
   }finally{await ctx.close();}
  }
 }finally{await browser.close();}
 if(process.env.COMPANY_SAVE_CSV)fs.writeFileSync(process.env.COMPANY_SAVE_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('PASS',rows.length-1,build);
})().catch(e=>{console.error(e);process.exitCode=1});
