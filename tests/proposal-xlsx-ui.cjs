'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const XLSX=require('xlsx');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
const company={id:'company',short_name:'Учебное бюро',kpp:'001234567',ogrn:'0012345678901',corr_account:'00000000000000000123',card_number:'0000000000000077',bank_account:'00000000000000000456',office_address:'Учебная улица, 2'};
const cases=[
 ['estimate','Обозначить предварительную площадь рядом с услугой','Отметить площадь предварительной'],
 ['mixed','Отделить предварительную стоимость чертежа от точной стоимости выезда','Отметить предварительную площадь, добавить выезд по фиксированной цене'],
 ['confirmed','Уточнить площадь до отправки версии клиенту','Отметить и снять предварительность после обмера'],
 ['company','Передать только заполненные регистрационные номера','Оставить реквизиты компании; ИНН ещё не указан'],
 ['account','Выдать реквизиты расчётного счёта без сохранённого БИК','Отключить реквизиты компании, выбрать расчётный счёт'],
 ['card','Выдать только карту с начальными нулями','Отключить реквизиты компании, выбрать карту'],
 ['new','Подготовить новое КП после предложения с оплатой на карту','Выбрать карту для первого КП, нажать «Новое КП» для второго клиента'],
 ['terms','Передать срок и условие начала работ','Указать начало «После обмера» и срок «12 рабочих дней»'],
 ['advance','Разделить нечётное число копеек при авансе 50%','Назначить цену 99,99 ₽ и аванс 50%'],
 ['prepay','Указать полную предварительную оплату','Назначить 100% оплаты и проверить остаток'],
 ['fixed','Ограничить скидку стоимостью всего предложения','Выбрать фиксированную скидку 9 999 ₽'],
 ['phone','Сохранить контакт клиента и адрес объекта в выдаваемой версии','Заполнить телефон с начальным нулём и объект'],
];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const rows=[['ID','SHA256 index','Дата UTC','Chromium','Бизнес-сценарий','Шаги','Фактический результат и связи','От кнопки до файла, мс','Визуальная проверка','Удобство','Результат']];
 const failures=[];
 try{for(const [mode,task,setup] of cases){
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',locale:'ru-RU'});
  try{
   await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
   await ctx.route('**/*',r=>{
    const u=new URL(r.request().url());
    const file=u.hostname==='app.test'?path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1)):u.hostname==='cdn.jsdelivr.net'&&u.pathname.includes('xlsx@')?require.resolve('xlsx/dist/xlsx.full.min.js'):null;
    return file&&fs.existsSync(file)?r.fulfill({path:file}):r.fulfill({body:'',contentType:'text/javascript'});
   });
   const p=await ctx.newPage();p.setDefaultTimeout(5000);await p.goto('https://app.test/',{waitUntil:'domcontentloaded',timeout:30000});
   await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
   await p.evaluate(async c=>{__db.company_info=[c];__db.kp_catalog=[{id:'arch',name:'Чертёж',unit:'м²',rate:100,sort_order:1},{id:'visit',name:'Выезд',unit:'шт',rate:75,sort_order:2}];await loadAll();},company);
   await p.locator('.nav-btn[data-view="view-more"]').click();await p.locator('#openKpBtn').click();await p.locator('#kpNewBtn').click();
   const field=id=>p.locator('#kp-'+id);
   if(mode==='new'){await field('client-name').fill('Первый');await field('show-card').check();await p.locator('#kpNewBtn').click();}
   await field('client-name').fill('Учебный клиент');
   const first=p.locator('.kp-service').first();
   if(['estimate','mixed','confirmed'].includes(mode))await first.getByRole('checkbox').check();
   if(mode==='confirmed')await first.getByRole('checkbox').uncheck();
   if(mode==='mixed'){await p.locator('#kpAddService').click();await p.locator('.kp-service').nth(1).locator('select').selectOption('1');}
   if(['account','card'].includes(mode)){await field('show-company').uncheck();await field('show-'+mode).check();}
   if(mode==='terms'){await field('start').fill('После обмера');await field('deadline').fill('12 рабочих дней');}
   if(mode==='advance')await first.locator('input[type=number]').nth(1).fill('99.99');
   if(mode==='prepay')await field('advance-percent').selectOption('100');
   if(mode==='fixed'){await field('discount-type').selectOption('fixed');await field('discount-value').fill('9999');}
   if(mode==='phone'){await field('client-phone').fill('00123456789');await field('object').fill('Дом у реки');}
   const total=mode==='mixed'?175:mode==='advance'?99.99:mode==='fixed'?0:100;
   const screenTotal=await p.locator('#kp-total').innerText();
   assert.equal(Number(screenTotal.replace(/[^\d,]/g,'').replace(',','.')),total);
   const button=p.locator('#kpExportXlsx');await button.scrollIntoViewIfNeeded();
   const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391&&box.height>=40);
   const before=await p.evaluate(()=>JSON.stringify([__db.kp_forms,__db.projects,__db.company_info]));
   const start=performance.now();const [download]=await Promise.all([p.waitForEvent('download'),button.click()]);
   const file=await download.path(),ms=Math.round(performance.now()-start);
   assert.equal(await download.failure(),null);assert.ok(download.suggestedFilename().includes('Учебный_клиент'));
   const wb=XLSX.readFile(file,{cellStyles:true}),grid=XLSX.utils.sheet_to_json(wb.Sheets['КП'],{header:1}),get=k=>grid.find(r=>r[0]===k)?.[1],tot=k=>grid.find(r=>r[5]===k)?.[6],all=grid.flat().join(' ');
   assert.deepEqual(wb.SheetNames,['КП']);assert.ok(wb.Sheets['КП']['!cols'][6].wch>=16);
   assert.equal(tot('Итого:'),total);
   assert.equal(get('Клиент'),'Учебный клиент');
   let result;
   if(mode==='estimate'||mode==='mixed'){
    const item=grid.find(r=>r[0]===1);assert.equal(item[7],'Предварительная площадь');assert.equal(typeof item[6],'number');
    if(mode==='mixed'){const exact=grid.find(r=>r[0]===2);assert.equal(exact[1],'Выезд');assert.ok(!exact[7]);}
    assert.match(all,/итог.*предварительн/i);result='Предварительная строка отмечена, итог помечен как предварительный; суммы остаются числами.';
   }else if(mode==='confirmed'){assert.ok(!all.toLowerCase().includes('предварительн'));result='После обмера пометка снята и в книге.';}
   else if(mode==='company'){assert.equal(get('КПП'),company.kpp);assert.equal(get('ОГРН'),company.ogrn);assert.ok(!all.includes(company.card_number));result='КПП и ОГРН выгружены под своими подписями с начальными нулями.';}
   else if(mode==='account'){assert.equal(get('К/с'),company.corr_account);assert.equal(get('Р/с'),company.bank_account);assert.ok(!all.includes(company.card_number));result='Оба счёта сохранены как текст; карты в книге нет.';}
   else if(mode==='card'){assert.equal(get('Карта для оплаты'),company.card_number);assert.ok(!all.includes(company.bank_account));result='Карта выгружена с начальными нулями, расчётный счёт исключён.';}
   else if(mode==='new'){assert.ok(!all.includes(company.card_number));result='В новом предложении карта первого клиента отсутствует.';}
   else if(mode==='terms'){assert.equal(get('Начало работ'),'После обмера');assert.equal(get('Срок выполнения'),'12 рабочих дней');result='В скачанном предложении видны оба условия.';}
   else if(mode==='advance'){assert.equal(tot('Аванс (50%):'),50);assert.equal(tot('Остаток:'),49.99);result='В книге аванс 50 ₽, остаток 49,99 ₽.';}
   else if(mode==='prepay'){assert.equal(tot('Оплата (100%):'),100);assert.equal(tot('Остаток:'),0);result='Полная оплата 100 ₽, остаток 0 ₽.';}
   else if(mode==='fixed'){assert.equal(tot('Дополнительная скидка:'),-100);assert.equal(tot('Остаток:'),0);result='Скидка 100 ₽, к оплате 0 ₽.';}
   else{assert.equal(get('Телефон'),'00123456789');assert.equal(get('Объект'),'Дом у реки');assert.ok(download.suggestedFilename().includes('Дом_у_реки'));result='Телефон и объект сохранены текстом; объект включён в имя файла.';}
   assert.equal(await p.evaluate(()=>JSON.stringify([__db.kp_forms,__db.projects,__db.company_info])),before);
   if(mode==='estimate'&&process.env.PROPOSAL_XLSX_SHOT)await p.screenshot({path:process.env.PROPOSAL_XLSX_SHOT});
   rows.push(['UI-0153',build,new Date().toISOString(),browser.version(),task,'Ещё → КП → '+setup+' → Скачать Excel → открыть лист КП.',result+' Итог формы и файла '+total+' ₽. Изменений КП, проектов и реквизитов 0.',ms,'Кнопка в границах 390 px, высота '+Math.round(box.height)+' px. Итог формы '+screenTotal+'.','Файл с именем клиента открывается сразу, лист КП один.', 'Пройдено']);
  }catch(err){failures.push(mode+': '+err.message.split('\n').slice(0,4).join(' '));}
  finally{await ctx.close();}
 }}finally{await browser.close();}
 assert.deepEqual(failures,[]);
 if(process.env.PROPOSAL_XLSX_CSV)fs.writeFileSync(process.env.PROPOSAL_XLSX_CSV,'\ufeff'+rows.map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('12 proposal workbooks verified',build);
})().catch(e=>{console.error(e);process.exitCode=1;});
