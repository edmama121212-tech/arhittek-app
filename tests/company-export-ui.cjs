'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const XLSX=require('xlsx');
const root=path.resolve(__dirname,'..'), html=fs.readFileSync(path.join(root,'index.html'));
const build=crypto.createHash('sha256').update(html).digest('hex').slice(0,16);
const company={id:'qa-company',full_name:'Учебная компания',short_name:'Учебная',director:'Тестовый Директор',inn:'0077777778',legal_address:'Юридическая улица 15',office_address:'Офисная улица 27',bank_name:'Учебный банк',bank_account:'00123456789012345678',bik:'000000123',card_bank:'Карточный банк',card_number:'0000000000004321',card_holder:'Тестов <А> & Ко',email:'test@example.invalid'};
const address=Array.from({length:720},(_,i)=>'секция'+String(i).padStart(3,'0')).join(' ');
const cases=[
 ['Полная карточка контрагента','all','pdf',{},[company.legal_address,company.office_address,company.bank_account,company.card_number]],
 ['Импорт счёта и БИК с начальными нулями','account','excel',{},[company.bank_account,company.bik],[company.card_number,company.inn]],
 ['Инструкция для оплаты картой с особыми знаками в ФИО','card','word',{},[company.card_holder,company.card_number],[company.bank_account,company.inn]],
 ['Подготовить общую справку без платёжных данных','general','word',{},[company.legal_address,company.email],[company.bank_account,company.card_number]],
 ['Предпросмотр нового банка до сохранения','account','pdf',{'bank-name':'Новый учебный банк'},['Новый учебный банк',company.bank_account],[company.bank_name,company.card_number]],
 ['Учётная таблица компании без КПП','all','excel',{},[company.full_name,company.bank_account,company.card_number]],
 ['Заменить контакт для одной выдачи','general','pdf',{email:'other@example.invalid'},['other@example.invalid'],[company.email,company.card_number]],
 ['Выгрузить длинный адрес с полным перечнем секций','general','pdf',{'legal-addr':address},['секция000','секция719',company.office_address]],
 ['Подготовить исправленный номер карты для реестра','card','excel',{'card-number':'0000000000000099'},['0000000000000099',company.card_holder],[company.card_number,company.bank_account]],
 ['Выгрузить данные без краткого наименования','all','word',{'short-name':''},[company.full_name,company.card_number]],
 ['Получить файл после сохранения нового юридического адреса','general','excel',{'legal-addr':'Переулок Проектный 3'},['Переулок Проектный 3',company.office_address],[company.legal_address]],
 ['Попытаться выдать отсутствующие карточные реквизиты','card','word',{'card-bank':'','card-number':'','card-holder':''},[]],
];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 if(process.argv.includes('--bank-fields')){
   try{await require('./helpers/company-bank-fields.cjs')({browser,company,root,build,html});}
   finally{await browser.close();}
   return;
 }
 if(process.argv.includes('--selection')){
   try{await require('./helpers/company-export-selection.cjs')({browser, company, root, build, html});}
   finally{await browser.close();}
   return;
 }
 const report=[['Элемент','Сборка SHA256 index','UTC','Chromium','Бизнес-сценарий','Шаги','Результат и связи','От кнопки до готового файла или отказа, мс','Визуальная проверка','Удобство','Статус']];
 const failures=[];
 try{
  for(const [i,[task,scope,format,changes,yes,no=[]]] of cases.entries()){
   const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
   try{
    await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
    await ctx.addInitScript(data=>window.__companyFixture=data,company);
    await ctx.route('**/*',route=>{
     const u=new URL(route.request().url());
     const cdns=[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js']];
     const vendor=cdns.find(([key])=>u.hostname==='cdn.jsdelivr.net'&&u.pathname.includes(key));
     const file=vendor?path.join(root,'node_modules',vendor[1]):u.hostname==='app.test'?path.join(root,u.pathname==='/'?'index.html':u.pathname):'';
     if(file&&fs.existsSync(file))return route.fulfill({path:file});
     return route.fulfill({body:'',contentType:'text/javascript'});
    });
    const p=await ctx.newPage();p.setDefaultTimeout(5000);await p.goto('https://app.test/');
    await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
    await p.evaluate(async()=>{__db.company_info=[__companyFixture];await loadAll();});
    await p.locator('.nav-btn[data-view="view-more"]').click();await p.locator('#openCompanyBtn').click();
    for(const [key,value] of Object.entries(changes))await p.locator('#co-'+key).fill(value);
    if(i===10){
     await p.locator('#companySaveBtn').click();await p.waitForFunction(()=>__db.company_info[0].legal_address==='Переулок Проектный 3'&&!loadAllInFlight);
     await p.locator('.nav-btn[data-view="view-more"]').click();await p.locator('#openCompanyBtn').click();
    }
    await p.locator('#co-export-scope').selectOption(scope);await p.locator('#co-export-format').selectOption(format);
    const button=p.locator('#companyExportBtn');await button.scrollIntoViewIfNeeded();
    const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391&&box.height>=40);
    const before=await p.evaluate(()=>JSON.stringify(__db.company_info)), downloads=[];
    p.on('download',d=>downloads.push(d));
    const start=performance.now();
    let ms,result;
    if(i===11){
     await button.click();
     await p.locator('#toast.show').filter({hasText:/заполните/i}).waitFor();
     ms=Math.round(performance.now()-start);assert.equal(downloads.length,0);
     result='Файл не выдан. Форма указывает, что выбранные реквизиты нужно заполнить.';
    }else{
     const [d]=await Promise.all([p.waitForEvent('download'),button.click()]);
     const local=await d.path();ms=Math.round(performance.now()-start);assert.equal(await d.failure(),null);
     const ext={pdf:'pdf',word:'doc',excel:'xlsx'}[format];assert.ok(d.suggestedFilename().endsWith('.'+ext));
     if(i===9)assert.ok(d.suggestedFilename().includes('Учебная_компания'));
     let content;
     if(format==='pdf')content=execFileSync('pdftotext',['-layout',local,'-'],{encoding:'utf8'});
     else if(format==='word'){
      content=await p.evaluate(raw=>new DOMParser().parseFromString(raw,'text/html').body.textContent,fs.readFileSync(local,'utf8'));
     }else{
      const wb=XLSX.readFile(local);const data=XLSX.utils.sheet_to_json(wb.Sheets['Реквизиты'],{header:1});
      content=data.flat().join(' ');if(i===5)assert.equal(data.find(x=>x[0]==='КПП')[1],'');
     }
     for(const fragment of yes)assert.ok(content.includes(fragment),'В файле не найдено '+fragment);
     for(const fragment of no)assert.ok(!content.includes(fragment),'Лишнее поле '+fragment);
     if(i===7)for(const token of address.split(' '))assert.ok(content.includes(token),'Адрес обрезан: '+token);
     if(process.env.COMPANY_EXPORT_SHOTS&&i===7){
      fs.mkdirSync(process.env.COMPANY_EXPORT_SHOTS,{recursive:true});
      await p.screenshot({path:path.join(process.env.COMPANY_EXPORT_SHOTS,'mobile.png')});
      fs.copyFileSync(local,path.join(process.env.COMPANY_EXPORT_SHOTS,'long.pdf'));
     }
     result='Файл '+ext+' прочитан; сверено: '+yes.join(', ')+(no.length?'. Исключены: '+no.join(', '):'')+'.';
    }
    assert.equal(await p.evaluate(()=>JSON.stringify(__db.company_info)),before);
    const steps='Ещё → Реквизиты → '+Object.entries(changes).map(([k,v])=>k+'='+(v.length>100?'720 нумерованных секций':v)).join(', ')+(i===10?' → Сохранить → повторно открыть':'')+' → '+scope+' → '+format+' → Скачать реквизиты';
    report.push(['UI-0273',build,new Date().toISOString(),browser.version(),task,steps,result+' Экспорт сохранил исходные данные.',ms,'Кнопка '+Math.round(box.width)+'×'+Math.round(box.height)+' px в пределах 390 px.',i===11?'Понятное сообщение в форме.':'Выбранные состав и формат доступны непосредственно над кнопкой.', 'PASS']);
   }catch(e){failures.push(task+' — '+e.message.split('\n')[0]);}finally{await ctx.close();}
  }
 }finally{await browser.close();}
 assert.deepEqual(failures,[]);
 if(process.env.COMPANY_EXPORT_CSV)fs.writeFileSync(process.env.COMPANY_EXPORT_CSV,'\ufeff'+report.map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('PASS',report.length-1,build);
})().catch(e=>{console.error(e);process.exitCode=1;});
