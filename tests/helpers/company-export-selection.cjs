'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const XLSX = require('xlsx');
const vendors = [['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js']];
const labels = {all:'Всё сразу',general:'Только общие данные компании',account:'Только расчётный счёт',card:'Только банковская карта',pdf:'PDF',word:'Word (.doc)',excel:'Excel (.xlsx)'};
const groups = {
  general:['full_name','short_name','director','inn','kpp','ogrn','tax_system','legal_address','office_address','phone','email'],
  account:['bank_name','bank_account','bik','corr_account'],
  card:['card_bank','card_holder','card_number'],
};
const scenarios=[
  ['Подготовить полный комплект для бухгалтера и отдельно карту для клиента в PDF', [['all','pdf'],['card','pdf']]],
  ['Перевести банковские реквизиты из Word в Excel до сохранения нового банка', [['account','word'],['account','excel']]],
  ['Перейти от пустой карты к общим данным, затем заполнить карту и повторить выгрузку', [['card','pdf'],['general','excel'],['card','word']]],
  ['Сменить расчётный счёт на карту в редактируемой версии и повторно получить полную карточку', [['account','word'],['card','word'],['all','word']]],
];
module.exports=async function runSelection({browser,company,root,build,html}){
  const rows=[['Элементы','SHA256 index','UTC','Chromium','Сценарий','Шаги','Результат и связи','Смена состава, мс','Смена формата, мс','Скачивание или отказ, мс','Визуально','Удобство','Статус']];
  const failures=[];
  for(const [i,[scenario,steps]] of scenarios.entries()){
    const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
    try{
      const record={...company,short_name:'Бюро Ландыш',full_name:'Учебное предприятие',ogrn:'00112233445',kpp:'001122300',tax_system:'Учебный налог',phone:'00750555555',corr_account:'00123400077788899900'};
      const draft={...record};
      if(i===2)for(const key of groups.card)record[key]=draft[key]='';
      await ctx.addInitScript({path:path.join(root,'tests/mock.js')});
      await ctx.route('**/*',route=>{
        const u=new URL(route.request().url());
        if(u.href==='https://app.test/')return route.fulfill({body:html,contentType:'text/html'});
        const vendor=u.hostname==='cdn.jsdelivr.net'&&vendors.find(([key])=>u.pathname.includes(key));
        const file=vendor?path.join(root,'node_modules',vendor[1]):u.hostname==='app.test'?path.join(root,u.pathname.slice(1)):'';
        return file&&fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({body:'',contentType:'text/javascript'});
      });
      const p=await ctx.newPage();p.setDefaultTimeout(5000);
      await p.goto('https://app.test/');
      await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
      await p.evaluate(async c=>{__db.company_info=[c];await loadAll();},record);
      await p.locator('.nav-btn[data-view="view-more"]').click();
      await p.locator('#openCompanyBtn').click();
      const before=await p.evaluate(()=>JSON.stringify([__db.company_info,__db.projects]));
      const files=[],scopeTimes=[],formatTimes=[],exportTimes=[],dimensions=[];
      const scopeControl=p.locator('#co-export-scope'),formatControl=p.locator('#co-export-format');
      const downloads=[];p.on('download',d=>downloads.push(d));
      for(const [j,[scope,format]] of steps.entries()){
        if(i===1&&!j){draft.bank_name='Новый учебный банк';await p.locator('#co-bank-name').fill(draft.bank_name);}
        if(i===2&&j===2){draft.card_number='0011000022223344';await p.locator('#co-card-number').fill(draft.card_number);}
        for(const [key,control,option,timings] of [['Что скачать',scopeControl,scope,scopeTimes],['Формат файла',formatControl,format,formatTimes]]){
          const start=performance.now();
          if(i===3){
            await p.getByText(key,{exact:true}).click();
            assert.equal(await control.evaluate(el=>document.activeElement===el),true,'Подпись не переводит фокус: '+key);
            const position=await control.locator('option').evaluateAll((opts,val)=>opts.findIndex(o=>o.value===val),option);
            await p.keyboard.press('Home');
            for(let n=0;n<position;n++)await p.keyboard.press('ArrowDown');
          }else await control.selectOption(option);
          assert.equal(await control.inputValue(),option);
          timings.push(Math.round(performance.now()-start));
          assert.equal(await control.locator('option:checked').innerText(),labels[option]);
          await control.scrollIntoViewIfNeeded();
          const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391&&box.height>=40);
          dimensions.push(Math.round(box.width)+'×'+Math.round(box.height));
        }
        const button=p.locator('#companyExportBtn'),start=performance.now();
        if(i===2&&!j){
          await button.click();await p.locator('#toast.show').filter({hasText:/заполните/i}).waitFor();
          exportTimes.push(Math.round(performance.now()-start));assert.equal(downloads.length,0);
          continue;
        }
        const [d]=await Promise.all([p.waitForEvent('download'),button.click()]);
        const local=await d.path();exportTimes.push(Math.round(performance.now()-start));
        const name=d.suggestedFilename();
        assert.equal(await d.failure(),null);
        assert.ok(name.endsWith('.'+{pdf:'pdf',word:'doc',excel:'xlsx'}[format]));
        files.push(name);
        let text;
        if(format==='pdf')text=execFileSync('pdftotext',['-layout',local,'-'],{encoding:'utf8'});
        if(format==='excel'){const wb=XLSX.readFile(local);assert.deepEqual(wb.SheetNames,['Реквизиты']);text=XLSX.utils.sheet_to_json(wb.Sheets['Реквизиты'],{header:1}).flat().join(' ');}
        if(format==='word')text=await p.evaluate(raw=>new DOMParser().parseFromString(raw,'text/html').body.textContent,fs.readFileSync(local,'utf8'));
        for(const [group,keys] of Object.entries(groups))for(const k of keys){
          if(draft[k])assert.equal(text.includes(draft[k]),scope==='all'||scope===group,k+' / '+name);
        }
      }
      assert.equal(new Set(files).size,files.length,'Разные комплекты реквизитов получили одинаковые имена');
      assert.equal(await p.evaluate(()=>JSON.stringify([__db.company_info,__db.projects])),before);
      if(i===3&&process.env.COMPANY_SELECTION_SHOT)await p.screenshot({path:process.env.COMPANY_SELECTION_SHOT});
      const actions=steps.map(([s,f])=>labels[s]+' → '+labels[f]+' → Скачать').join(' → ');
      const extra=['','Ввести новое название банка в черновике. ','Открыть незаполненную карту. Перед последней выгрузкой ввести номер карты. ','Выбирать с клавиатуры по видимой подписи. '][i];
      rows.push(['UI-0271 / UI-0272',build,new Date().toISOString(),browser.version(),scenario,'Ещё → Реквизиты. '+extra+actions,
        (i===2?'Пустая карта: показана подсказка, скачиваний 0. ':'')+'Файлы прочитаны: '+files.join(', ')+'. Проверены значения каждой группы, исключены все заполненные значения других групп. Записей в компанию и проекты при смене и скачивании: 0.',
        scopeTimes.join(' / '),formatTimes.join(' / '),exportTimes.join(' / '),'Элементы '+[...new Set(dimensions)].join(', ')+' px полностью находятся в окне 390 px; отображаемые подписи соответствуют выбранным значениям.',
        i===3?'Обе подписи переводят фокус, выбор работает с клавиатуры.':'Можно последовательно выдать документы из одного открытого черновика.', 'Пройдено']);
    }catch(e){failures.push(scenario+': '+e.message.split('\n')[0]);}
    finally{await ctx.close();}
  }
  assert.deepEqual(failures,[]);
  if(process.env.COMPANY_SELECTION_CSV)fs.writeFileSync(process.env.COMPANY_SELECTION_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
  console.log('4 independent selection journeys verified',build);
};
