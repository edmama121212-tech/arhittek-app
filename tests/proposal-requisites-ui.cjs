'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'));
const build = crypto.createHash('sha256').update(index).digest('hex').slice(0, 16);
const groups = ['company', 'account', 'card'];
const labels = ['компания', 'расчётный счёт', 'банковская карта'];
const ids = ['UI-0145', 'UI-0146', 'UI-0147'];
const fields = [
  ['short_name', 'inn', 'kpp', 'ogrn', 'office_address', 'phone'],
  ['bank_name', 'bank_account', 'bik', 'corr_account'],
  ['card_bank', 'card_holder', 'card_number'],
];
const fixture = {
  id: 'qa-company', short_name: 'Бюро Альфа', inn: '0011993355', kpp: '007733119',
  ogrn: '0000123456789', office_address: 'Офис Сирень 31', phone: '0070090033',
  bank_name: 'Банк Вяз', bank_account: '00033344455566677788', bik: '000009998',
  corr_account: '00011122233344455566', card_bank: 'Банк Бук',
  card_holder: 'Бирюза Янтарь', card_number: '0000234567890011',
};
const cases = [
  ['Прайс для тендера без реквизитов и способов оплаты', '000'],
  ['Передача реквизитов юрлица для проверки до выбора оплаты', '100'],
  ['Счёт для бухгалтерии клиента без контактов и карты', '010'],
  ['Инструкция для перевода на карту физическому лицу', '001'],
  ['Предложение организации с оплатой по счёту', '110'],
  ['Предложение частному заказчику с данными фирмы и картой', '101'],
  ['Два способа оплаты без адреса и телефона исполнителя', '011'],
  ['Передача всех реквизитов при согласовании договора', '111'],
  ['Выдать сохранившиеся КПП, ОГРН и корсчёт при частично заполненной карточке', '111', {inn:'', bik:'', card_holder:''}],
  ['Открыть ранее сохранённое КП другого клиента после настройки всех реквизитов', '100', {}, 'other'],
  ['Вернуться к тому же сохранённому КП с индивидуальным выбором двух способов оплаты', '011', {}, 'same'],
  ['Подготовить новое предложение после черновика с двумя способами оплаты', '100', {}, 'new'],
  ['Перевыпустить предложение с обновлёнными реквизитами из раздела компании', '111', {}, 'update'],
  ['Подготовить КП до получения номеров счёта и карты, сохранив названия банков и получателя', '111', {bank_account:'',card_number:''}],
  ['Выдать калькуляцию из ещё пустой карточки компании без инструкции сотруднику в файле клиента', '111', Object.fromEntries(fields.flat().map(k=>[k,'']))],
];
const vendors = [
  ['xlsx@', 'xlsx/dist/xlsx.full.min.js'],
  ['jspdf@', 'jspdf/dist/jspdf.umd.min.js'],
  ['jspdf-autotable@', 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js'],
];

async function flipTo(page, flags) {
  const ms = [], sizes = [];
  for (const [i, key] of groups.entries()) {
    const box = page.locator('#kp-show-' + key);
    const label = box.locator('..');
    const wanted = flags[i] === '1';
    if (await box.isChecked() === wanted) await label.click();
    const start = performance.now();
    await label.click();
    assert.equal(await box.isChecked(), wanted);
    ms.push(Math.round(performance.now()-start));
    const rect = await label.boundingBox();
    assert.ok(rect.x >= 0 && rect.x+rect.width <= 391 && rect.height >= 44);
    sizes.push(Math.round(rect.height));
  }
  return {ms, sizes};
}

async function download(page, ext) {
  const button = page.locator(ext==='pdf'?'#kpExportPdf':'#kpExportXlsx');
  const start = performance.now();
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const temp = await file.path();
  const ms = Math.round(performance.now()-start);
  assert.equal(await file.failure(), null);
  if (ext==='pdf') {
    const content = execFileSync('pdftotext', ['-layout',temp,'-'], {encoding:'utf8'});
    return {ms, content:content.replace(/\s+/g,' '), name:file.suggestedFilename()};
  }
  const wb = XLSX.readFile(temp);
  const grid = XLSX.utils.sheet_to_json(wb.Sheets['КП'], {header:1});
  return {ms, content:grid.flat().join(' '), name:file.suggestedFilename()};
}

async function main(){
  const browser = await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE, args:['--no-sandbox']});
  const report = [['ID','SHA256 index.html','UTC','Chromium','Сценарий','Шаги','Состояние и результат в документах','Флажок до результата, мс','PDF, мс','Excel, мс','Визуальная проверка','Удобство','Статус']];
  const errors = [];
  try {
    for (const [n, [task, flags, overrides, action]] of cases.entries()) {
      const ctx = await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
      try {
        const company = {...fixture, ...overrides};
        await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
        await ctx.route('**/*',r=>{
          const u = new URL(r.request().url());
          if(u.href==='https://app.test/')return r.fulfill({body:index,contentType:'text/html'});
          const vendor = u.hostname==='cdn.jsdelivr.net' && vendors.find(([key])=>u.pathname.includes(key));
          const file = vendor ? path.join(root,'node_modules',vendor[1]) : u.hostname==='app.test' ? path.join(root,u.pathname.slice(1)) : '';
          return file && fs.existsSync(file) ? r.fulfill({path:file}) : r.fulfill({body:'',contentType:'text/javascript'});
        });
        const page = await ctx.newPage();
        page.setDefaultTimeout(7000);
        await page.goto('https://app.test/');
        await page.waitForFunction(()=>typeof state!=='undefined' && state.financialDataReady && !loadAllInFlight);
        await page.evaluate(async c=>{
          __db.company_info=[c];
          __db.kp_forms=[{id:'existing',client_name:'Клиент Исток',services:[{qty:1,snapshot:{name:'План',unit:'шт',rate:157}}]}];
          __db.kp_catalog=[{id:'plan',name:'План',unit:'шт',rate:157}];
          await loadAll();
        },company);
        const more = page.locator('.nav-btn[data-view="view-more"]');
        await more.click();
        if(action==='update'){
          await page.locator('#openCompanyBtn').click();
          for(const [id,key,value] of [['short-name','short_name','Бюро Роса'],['bank-name','bank_name','Банк Липа'],['card-holder','card_holder','Слива Сирень']]){
            await page.locator('#co-'+id).fill(value); company[key]=value;
          }
          await page.locator('#companySaveBtn').click();
          await page.waitForFunction(()=>__db.company_info[0].short_name==='Бюро Роса'&&!loadAllInFlight);
          await more.click();
        }
        await page.locator('#openKpBtn').click();
        const saved = page.locator('#kpSavedList').getByText('Клиент Исток',{exact:true});
        if(action==='same')await saved.click(); else await page.locator('#kpNewBtn').click();
        const selector = action==='other'?'111':action==='new'?'011':flags;
        const {ms,sizes} = await flipTo(page, selector);
        let client = 'Клиент Янтарь';
        if(action==='same'||action==='other'){
          await saved.click();
          client='Клиент Исток';
        }else{
          if(action==='new')await page.locator('#kpNewBtn').click();
          await page.locator('#kp-client-name').fill(client);
        }
        const before=await page.evaluate(()=>JSON.stringify([__db.company_info,__db.projects,__db.kp_forms]));
        for(const [i,key] of groups.entries())assert.equal(await page.locator('#kp-show-'+key).isChecked(), flags[i]==='1',key);
        const hint = page.locator('#kp-requisites-hint');
        const missingAccount = flags[1]==='1' && !company.bank_account;
        const missingCard = flags[2]==='1' && !company.card_number;
        assert.equal(await hint.isVisible(), missingAccount || missingCard);
        if(missingAccount)assert.match(await hint.innerText(), /номер расчётного счёта/);
        if(missingCard)assert.match(await hint.innerText(), /номер карты/);
        const pdf=await download(page,'pdf'),excel=await download(page,'xlsx');
        const selected = fields.flatMap((keys,i)=> flags[i]==='1' ? keys.map(k=>company[k]).filter(Boolean):[]);
        for(const file of [pdf,excel]){
          assert.ok(file.name.includes(client.replace(' ','_')));
          assert.ok(file.content.includes(client));
          assert.equal(file.content.includes('Реквизиты исполнителя'),selected.length>0,'заголовок '+file.name);
          assert.ok(!file.content.includes('Для оплаты укажите') && !file.content.includes('заполните в разделе'),file.name+' содержит служебное указание');
          for(const [i,keys] of fields.entries())for(const key of keys){
            if(company[key])assert.equal(file.content.includes(company[key]), flags[i]==='1',file.name+' / '+key);
            if(company[key]!==fixture[key])assert.ok(!file.content.includes(fixture[key]),'устаревшее поле '+key);
          }
        }
        assert.equal(await page.evaluate(()=>JSON.stringify([__db.company_info,__db.projects,__db.kp_forms])), before);
        if(n===6 && process.env.PROPOSAL_REQ_SHOT){
          await page.locator('#kp-show-account').scrollIntoViewIfNeeded();
          await page.screenshot({path:process.env.PROPOSAL_REQ_SHOT});
        }
        for(const [i,key] of groups.entries()){
          const detail = fields[i].map(k=>company[k]).filter(Boolean);
          const result = flags[i]==='1' && detail.length ? 'В обоих файлах: '+detail.join(', ')+'.' : 'Оба файла исключают данные выбранной группы.';
          const states=flags.split('').map((flag,j)=>labels[j]+' '+(flag==='1'?'вкл.':'выкл.')).join(', ');
          const selection=labels.filter((_,j)=>selector[j]==='1').join(', ')||'ничего';
          const route = action==='other'?'Открыть ранее сохранённое КП другого клиента. ':action==='same'?'Повторно открыть ту же строку сохранённого КП. ':action==='new'?'Начать новое КП. ':action==='update'?'Предварительно сохранить новые название, банк и получателя в «Реквизитах». ':'';
          report.push([ids[i],build,new Date().toISOString(),browser.version(),task,'Ещё → КП. Выбрать: '+selection+'. '+route+'Скачать PDF и Excel; прочитать оба файла.',result+' Все три группы сверены, '+states+'. Количество изменений при экспорте в карточках КП, компаний и проектов: 0.',ms[i],pdf.ms,excel.ms,'Подпись и флажок целиком в пределах 390 px; высота строки '+sizes[i]+' px.','Выбор по нажатию на подпись. Проверено итоговое состояние в двух скачанных файлах.', 'Пройдено']);
        }
      }catch(e){errors.push(task+': '+e.message.split('\n')[0]);}
      finally{await ctx.close();}
    }
  }finally{await browser.close();}
  assert.deepEqual(errors, []);
  if (process.env.PROPOSAL_REQ_CSV)fs.writeFileSync(process.env.PROPOSAL_REQ_CSV, '\ufeff'+report.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
  console.log(cases.length+' different business scenarios, '+(report.length-1)+' control results; PDF + XLSX; build '+build);
}
main().catch(err=>{console.error(err);process.exitCode=1;});
