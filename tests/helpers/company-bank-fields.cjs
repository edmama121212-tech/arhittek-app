'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const XLSX=require('xlsx');
const columns=[
  ['UI-0263','bank-name','bank_name','Банк'],
  ['UI-0264','bank-account','bank_account','Номер счёта (р/с)'],
  ['UI-0265','bik','bik','БИК банка'],
  ['UI-0266','corr-account','corr_account','Корр. счёт']
];
const values=['Учебный банк «Луч»','00129999000000004567','000004567','00456700000000123456'];
const cases=[
 ['new','Добавить платёжные реквизиты при первом оформлении компании'],
 ['switch','Перевести действующую компанию в другой банк, сохранив данные карты'],
 ['draft','Подготовить отдельную инструкцию на перевод из черновика до вступления новых реквизитов в силу'],
 ['contract','Заключить договор с реквизитами нового банка'],
 ['proposal','Выпустить коммерческое предложение с новым расчётным счётом'],
 ['private','Подготовить справку об организации без черновых платёжных данных'],
 ['cancel','Отказаться от неподтверждённого изменения банка'],
 ['conflict','Сохранить действующие реквизиты коллеги при конкурирующем редактировании'],
 ['retry','Завершить перевод на новый банк после временной ошибки записи'],
 ['retire','Закрыть расчётный счёт, оставив доступной оплату картой'],
 ['excel','Передать таблицу реквизитов для импорта с сохранением ведущих нулей'],
 ['appeared','Сверить реквизиты первой карточки, которую одновременно создал коллега']
];
const vendors=[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']];
module.exports=async({browser,company,root,build,html})=>{
  const rows=[['ID','Сборка index','UTC / Chromium','Задача','Шаги для поля','Результат и связанные разделы','Ввод поля до двух кадров, мс','Операция до результата, мс','Вид и удобство','Итог']];
  for(const [mode,task] of cases){
    const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
    try{
      await ctx.addInitScript({path:path.join(root,'tests/mock.js')});
      await ctx.route('**/*',r=>{
        const url=new URL(r.request().url());if(url.href==='https://app.test/')return r.fulfill({body:html,contentType:'text/html'});
        const vendor=url.hostname==='cdn.jsdelivr.net'&&vendors.find(([s])=>url.pathname.includes(s));
        const file=vendor?path.join(root,'node_modules',vendor[1]):url.hostname==='app.test'?path.join(root,url.pathname.slice(1)):'';
        return file&&fs.existsSync(file)?r.fulfill({path:file}):r.fulfill({body:'',contentType:'text/javascript'});
      });
      const p=await ctx.newPage();p.setDefaultTimeout(7000);
      await p.goto('https://app.test/');await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
      const old={...company,bank_name:'Банк учебного квартала',bik:'008765432',corr_account:'00000000900000000123',updated_at:'2026-01-01T00:00:00Z'};
      const fresh=['new','appeared'].includes(mode);
      await p.evaluate(async data=>{__db.company_info=data;__db.kp_catalog=[{id:'plan',name:'План',unit:'шт',rate:120}];await loadAll();},fresh?[]:[old]);
      const more=p.locator('.nav-btn[data-view="view-more"]');
      const open=async()=>{await more.click();await p.locator('#openCompanyBtn').click();};
      const frame=()=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      await open();
      const ms=[],widths=[],expected=mode==='retire'?values.map(()=> ''):values;
      for(const [i,[id,key,col,label]] of columns.entries()){
        const input=p.locator('#co-'+key),labelEl=input.locator('..').locator('label');assert.equal(await labelEl.textContent(),label);
        const t=performance.now();await labelEl.click();
        assert.equal(await input.evaluate(el=>el===document.activeElement),true,id+': подпись не фокусирует поле');
        await input.fill(mode==='draft'?'  '+expected[i]+'  ':expected[i]);await frame();ms.push(Math.round(performance.now()-t));
        const box=await input.boundingBox();assert.ok(box.x>=0&&box.width>80&&box.x+box.width<=390.5&&box.height>=38);
        assert.ok(await input.evaluate(el=>el.scrollWidth<=el.clientWidth+1),id+': введённое значение не помещается по ширине');
        widths.push(Math.round(box.width)+'×'+Math.round(box.height));
      }
      if(mode==='excel'&&process.env.BANK_FIELDS_SHOT)await p.locator('#co-bank-name').locator('../..').screenshot({path:process.env.BANK_FIELDS_SHOT});
      const current=()=>p.evaluate(()=>__db.company_info[0]||null);
      const start=performance.now();
      const save=async()=>{
        await p.locator('#companySaveBtn').click();await p.locator('#toast').filter({hasText:'Реквизиты сохранены'}).waitFor();await p.waitForFunction(()=>!loadAllInFlight);
      };
      const file=async(selector)=>{
        const [d]=await Promise.all([p.waitForEvent('download'),p.locator(selector).click()]);
        assert.equal(await d.failure(),null);return d.path();
      };
      const word=async scope=>{
        await p.locator('#co-export-scope').selectOption(scope);await p.locator('#co-export-format').selectOption('word');
        return p.evaluate(raw=>Object.fromEntries([...new DOMParser().parseFromString(raw,'text/html').querySelectorAll('tr')].map(row=>[row.cells[0].textContent,row.cells[1].textContent])),fs.readFileSync(await file('#companyExportBtn'),'utf8'));
      };
      const next={...old};for(const [i,[,,col]] of columns.entries())next[col]=expected[i];
      let result,route;
      if(['conflict','appeared'].includes(mode)){
        const theirs={...old,updated_at:'2026-01-02T00:00:00Z',director:'Новый учредитель'};
        await p.evaluate(c=>{__db.company_info=[c];},theirs);await p.locator('#companySaveBtn').click();
        await p.locator('#toast').filter({hasText:'Реквизиты изменились'}).waitFor();
        for(const [i,[,key]] of columns.entries())assert.equal(await p.locator('#co-'+key).inputValue(),expected[i]);
        assert.deepEqual(await current(),theirs);await open();
        for(const [,key,col] of columns)assert.equal(await p.locator('#co-'+key).inputValue(),old[col]);
        route='Сохранить после записи коллеги → проверить отказ → открыть заново';
        result='Черновик остался до выхода. После повторного открытия в карточке и Word действует прежний комплект.';
        const doc=await word('account');for(const [,,col,label] of columns)assert.equal(doc[label],old[col]);
      }else if(mode==='cancel'){
        await p.locator('#companyBack').click();await open();
        const doc=await word('account');
        for(const [,key,col,label] of columns){assert.equal(await p.locator('#co-'+key).inputValue(),old[col]);assert.equal(doc[label],old[col]);}
        assert.deepEqual(await current(),old);route='Назад без сохранения → открыть → скачать банковскую инструкцию';
        result='Вернулась исходная запись. Скачанный Word содержит прежний банк и счета.';
      }else if(['draft','private'].includes(mode)){
        const doc=await word(mode==='draft'?'account':'general');
        for(const [i,[,,,label]] of columns.entries())mode==='draft'?assert.equal(doc[label],expected[i]):assert.equal(doc[label],undefined);
        if(mode==='private')assert.ok(Object.values(doc).includes(old.legal_address));
        assert.deepEqual(await current(),old);
        route=mode==='draft'?'Без сохранения → только расчётный счёт → Word':'Без сохранения → только общие данные → Word';
        result=mode==='draft'?'Word выдаёт четыре новых реквизита без пробелов по краям. Сохранённый банк прежний.':'Word содержит юридический адрес, все четыре банковских реквизита исключены. Сохранённый банк прежний.';
      }else{
        if(mode==='retry'){
          await p.evaluate(()=>{__fail={table:'company_info',op:'update'};});await p.locator('#companySaveBtn').click();
          await p.locator('#toast').filter({hasText:'Ошибка сохранения'}).waitFor();assert.deepEqual(await current(),old);
          for(const [i,[,key]] of columns.entries())assert.equal(await p.locator('#co-'+key).inputValue(),expected[i]);
          await p.evaluate(()=>{__fail=null;});
        }
        await save();const c=await current();for(const [i,[,,col]] of columns.entries())assert.equal(c[col],expected[i]);
        if(!fresh)for(const k of ['card_number','card_bank','inn','legal_address'])assert.equal(c[k],old[k]);
        route=(mode==='retry'?'Отказ → повтор без ввода → ':'')+'Сохранить';
        if(mode==='contract'||mode==='proposal'){
          await more.click();let content;
          if(mode==='contract'){
            await p.locator('#openContractsBtn').click();await p.locator('#ct-client-name').fill('Учебный заказчик');await p.locator('#ct-price').fill('2500');
            content=execFileSync('pdftotext',['-layout',await file('#ct-export-pdf'),'-'],{encoding:'utf8'}).replace(/\s+/g,' ');
            route+=' → Договоры → цена 2500 ₽ → PDF';
          }else{
            await p.locator('#openKpBtn').click();await p.locator('#kpNewBtn').click();await p.locator('#kp-client-name').fill('Учебный заказчик');
            if(!await p.locator('#kp-show-account').isChecked())await p.locator('[for=kp-show-account],label:has(#kp-show-account)').first().click();
            const wb=XLSX.readFile(await file('#kpExportXlsx'));content=XLSX.utils.sheet_to_json(wb.Sheets['КП'],{header:1}).flat().join(' ');
            route+=' → новое КП → показать счёт → Excel';
          }
          for(const [i,[,,col]] of columns.entries()){assert.ok(content.includes(expected[i]),mode+': '+col+' отсутствует в файле');assert.ok(!content.includes(old[col]));}
          result='Скачанный '+(mode==='contract'?'договор PDF':'файл КП Excel')+' содержит новый комплект. Прежние четыре реквизита исключены.';
        }else if(mode==='retire'){
          await p.locator('#co-export-scope').selectOption('account');await p.locator('#companyExportBtn').click();await p.locator('#toast').filter({hasText:'Заполните реквизиты'}).waitFor();
          const d=await word('card');assert.ok(Object.values(d).includes(old.card_number));route+=' → выгрузить закрытый счёт → выгрузить карту';
          result='Программа сообщает, что раздел расчётного счёта пуст. Word для оплаты на карту по-прежнему выдаётся.';
        }else if(mode==='excel'){
          await p.locator('#co-export-scope').selectOption('account');await p.locator('#co-export-format').selectOption('excel');
          const wb=XLSX.readFile(await file('#companyExportBtn'));const pairs=XLSX.utils.sheet_to_json(wb.Sheets['Реквизиты'],{header:1});for(const [i,[,,,label]] of columns.entries()){const value=pairs.find(row=>row[0]===label)[1];assert.equal(typeof value,'string');assert.equal(value,expected[i]);}
          route+=' → скачать только счёт в Excel';result='Четыре ячейки проверены после чтения XLSX: текстовые значения без потери нулей.';
        }else{
          await open();const d=await word('account');for(const [i,[,,,label]] of columns.entries())assert.equal(d[label],expected[i]);
          route+=' → повторно открыть → скачать Word';result=(mode==='new'?'Создана первая карточка. ':'Изменения внесены. ')+'Новый комплект совпадает в карточке и в скачанном Word.';
        }
      }
      await frame();const elapsed=Math.round(performance.now()-start);
      for(const [i,[id,,col,label]] of columns.entries())rows.push([id,build,new Date().toISOString()+' / '+browser.version(),task,'Ещё → Реквизиты → '+label+': '+(fresh?'пусто':old[col])+' → '+(expected[i]||'очистить')+' вместе с остальными реквизитами → '+route,result,ms[i],elapsed,'Подпись «'+label+'» устанавливает курсор. Поле '+widths[i]+' px в пределах экрана 390 px, значение видно целиком.','Пройдено']);
      console.log(mode,elapsed);
    }finally{await ctx.close();}
  }
  if(process.env.BANK_FIELDS_CSV)fs.writeFileSync(process.env.BANK_FIELDS_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
