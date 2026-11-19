const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.env.PROJECT_SEARCH_OUTPUT;
const screenshotDir = process.env.PROJECT_SEARCH_SHOTS;
const projects = [
  {id:'a', name:'Проект №17526 Озёрный дом', category_id:'arch', status_id:'active', employee_id:'architect', client_name:'Тестовая семья', address:'Аллея Макетов 18', phone:'+7 (000) 123-45-67', notes:'Нужен пандус'},
  {id:'b', name:'Проект №17426 Дом у сада', category_id:'arch', status_id:'done', employee_id:'architect', client_name:'Тестовая семья', address:'Аллея Макетов 81'},
  {id:'c', name:'Проект ДИ №17226 Студия у сада', category_id:'design', status_id:'active', employee_id:'designer', client_name:'Эскиз'},
  {id:'d', name:'Архивная мастерская', category_id:'land', status_id:'frozen', client_name:'Эскиз'},
  {id:'f', name:'Проект ДИ №16326 Малый зал', category_id:'design', status_id:'done',employee_id:'designer'},
  {id:'g', name:'Проект ЛД №16026 Тихий двор', category_id:'land', status_id:'active'},
  {id:'e', name:'Дом у сада, стройка', category_id:'build', status_id:'active', employee_id:'architect', client_name:'Тестовая семья'}
];
const all = 'abcfgd';
const scenarios = [
  {task:'Открыть карточку по номеру из заявки', query:'№ 17526', found:'a', card:true, after:all, clear:'Вернуться из карточки и перейти к соседнему номеру', next:'b'},
  {task:'Опознать объект по адресу с номером дома', query:'  АЛЛЕЯ МАКЕТОВ 18  ', found:'a', after:all, clear:'Перейти с дома 18 на дом 81 по той же улице', next:'b'},
  {task:'Найти заявку по телефону без разделителей', query:'80001234567', found:'a', after:all, clear:'Перейти от телефонной заявки к общему списку и выбрать студию', next:'c'},
  {task:'Получить список заказов семьи по фамилии клиента', query:'Тестовая семья', found:'ab', after:all, clear:'Выйти из подборки клиента и открыть заказ другого клиента',next:'d'},
  {task:'Найти проект по требованию в примечании',query:'пандус',found:'a',after:all,clear:'Сбросить поиск с клавиатуры и сразу ввести критерий другой задачи', keyboard:true},
  {task:'Отобрать объект по названию в направлении дизайна',filters:{categoryFilters:'design'},query:'у сада',found:'c',after:'cf',clear:'Вернуться к направлению дизайна с сохранением выбранного направления'},
  {task:'Выбрать среди активных проектов заказ конкретного клиента',filters:{statusFilters:'active'},query:'Тестовая семья',found:'a',after:'acg',clear:'Вернуться к активной очереди студии с сохранением статуса'},
  {task:'Найти завершённый заказ в очереди архитектора',filters:{employeeFilters:'architect'},query:'17426',found:'b',after:'ab',clear:'Восстановить весь портфель выбранного исполнителя'},
  {task:'Найти старую карточку без номера среди свободных объектов',filters:{categoryFilters:'land',employeeFilters:'none'},query:'мастерская',found:'d',after:'gd',clear:'Сохранить связку направления и свободного исполнителя для назначения'},
  {task:'Проверить отсутствие заявки при ошибке в названии',query:'Ненайденная заявка',found:'',after:all,clear:'Восстановить заполненный список из пустого результата и проверить порядок'}
];
const resetScenarios = [
  ['Выйти из направления архитектуры', {categoryFilters:'arch'}, '', 'ab'],
  ['Вернуть общий портфель после списка завершённых', {statusFilters:'done'}, '', 'bf'],
  ['Выйти из очереди неназначенных проектов', {employeeFilters:'none'}, '', 'gd'],
  ['Вернуть весь портфель из личной очереди архитектора', {employeeFilters:'architect'}, '', 'ab'],
  ['Снять ограничение по направлению и статусу', {categoryFilters:'design',statusFilters:'active'}, '', 'c'],
  ['Снять три фильтра после просмотра конкретного заказа', {categoryFilters:'arch',statusFilters:'done',employeeFilters:'architect'}, '', 'b'],
  ['Восстановить список из несовместимой комбинации', {categoryFilters:'land',employeeFilters:'designer'}, '', ''],
  ['Сбросить одновременно имя клиента и выбранный статус', {statusFilters:'active'}, 'Тестовая семья', 'a'],
  ['Сбросить критерии после возврата из архивной карточки', {statusFilters:'frozen'}, '', 'd','card'],
  ['Снять поиск и фильтры с клавиатуры, открыть следующий заказ', {categoryFilters:'design'}, 'зал', 'f','keyboard']
];
const names = ids => [...ids].map(id=>projects.find(p=>p.id===id).name);
const manifest = require('../src/manifest.json');
const snapshot = new Map();
const hash = crypto.createHash('sha256');
for(const name of Object.keys(manifest.outputs).sort()){
  const bytes = fs.readFileSync(path.join(root,name));
  snapshot.set('/'+name, bytes);
  hash.update(name+'\0').update(bytes).update('\0');
}
const digest = hash.digest('hex').slice(0,16);
const results=[];
const csv = value => '"'+String(value).replaceAll('"','""')+'"';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
  if(screenshotDir)fs.mkdirSync(screenshotDir,{recursive:true});
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block',reducedMotion:'reduce'});
  await context.addInitScript({content:fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+'\nwindow.__db.projects='+JSON.stringify(projects)+';'});
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    const pathname=u.pathname==='/'?'/index.html':u.pathname;
    if(u.hostname==='app.test'&&snapshot.has(pathname)){
      // A fast fixture response must not outrun the overview's budget dependency.
      if(pathname==='/project-budget.js')await new Promise(resolve=>setTimeout(resolve,80));
      const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
      return route.fulfill({body:snapshot.get(pathname),contentType:types[path.extname(pathname)]});
    }
    return route.fulfill({body:'',contentType:'text/javascript'});
  });
  const errors=[];
  try{
    for(const [i,current] of [...scenarios,...resetScenarios].entries()){
      const reset=Array.isArray(current);
      const s=reset?{task:current[0],filters:current[1],query:current[2],found:current[3],action:current[4]}:current;
      const page=await context.newPage();
      page.setDefaultTimeout(5000);
      page.on('pageerror',e=>errors.push(e.message));
      const input=page.locator('#projectSearch'),clear=page.locator('#projectSearchClear'),rows=page.locator('#projectsCard .proj-name');
      const shot=async phase=>{if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,String(i+1).padStart(2,'0')+'-'+phase+'.png')})};
      async function verifyList(expected){
        assert.deepEqual(await rows.evaluateAll(els=>els.map(e=>e.title)),names(expected));
        if(!expected)assert.match(await page.locator('#projectsCard').innerText(),/Нет проектов/);
      }
      async function openCard(id){
        const name=names(id)[0];
        await rows.filter({hasText:name}).click();
        await page.locator('#projectSheetOverlay.active').waitFor();
        assert.equal(await page.locator('#pf-name').inputValue(),name);
        await page.locator('#projectSheetClose').click();
        await page.locator('#projectSheetOverlay.active').waitFor({state:'hidden'});
      }
      async function timing(type){
        return page.evaluate(type=>window.__elapsed[type],type);
      }
      async function checkLayout(){
        return page.evaluate(()=>{
          const rect=document.querySelector('#projectSearch').getBoundingClientRect();
          const width=document.documentElement.scrollWidth;
          const result=document.querySelector('#projectsCard').getBoundingClientRect();
          assertLayout(rect);assertLayout(result);
          for(const row of document.querySelectorAll('#projectsCard .proj-row')){
            if(Number(getComputedStyle(row).opacity)<1)throw new Error('Строка с результатом приглушена целиком');
          }
          function assertLayout(r){if(r.width<=0||r.right>innerWidth+1||r.left<0||width>innerWidth+1)throw new Error('Горизонтальное переполнение');}
          const ctx=document.createElement('canvas').getContext('2d');
          for(const select of document.querySelectorAll('.project-filter-grid select')){
            ctx.font=getComputedStyle(select).font;
            if(ctx.measureText(select.selectedOptions[0].text).width+24>select.clientWidth)throw new Error('Обрезано значение фильтра');
          }
          return 'Поле и список внутри экрана '+innerWidth+'×'+innerHeight+'; выбранные значения видны целиком';
        });
      }
      try{
        await page.goto('https://app.test/');
        await page.waitForFunction(()=>typeof hasVerifiedAccess==='function'&&hasVerifiedAccess()&&state.financialDataReady&&!loadAllInFlight);
        await page.locator('.bottom-nav [data-view="view-projects"]').click();
        for(const [id,value] of Object.entries(s.filters||{}))await page.locator('#'+id+' select').selectOption(value);
        if(!reset)await verifyList(s.after);
        await page.evaluate(()=>{
          window.__elapsed={};
          for(const [type,id,key] of [['input','projectSearch','input'],['click','projectSearchClear','click'],['click','filter-active-badge','reset']]){
            const el=document.getElementById(id);
            let start;
            el.addEventListener(type,()=>{start=performance.now();},true);
            el.addEventListener(type,()=>{
              const dom=performance.now()-start;
              requestAnimationFrame(()=>requestAnimationFrame(()=>{__elapsed[key]=[dom,performance.now()-start].map(v=>Math.round(v*10)/10)}));
            });
          }
        });
        const writes=await page.evaluate(()=>__writes.length);
        if(reset){
          if(s.query)await input.fill(s.query);
          await verifyList(s.found);
          if(s.action==='card'){await openCard(s.found);await verifyList(s.found);}
          const button=page.locator('#filter-active-badge');
          assert.ok(await button.isVisible(),'Общий сброс скрыт после выбора фильтра');
          assert.equal(await button.getAttribute('type'),'button');
          const count=Object.keys(s.filters).length;
          const label=s.query?'Сбросить поиск и фильтры':'Сбросить фильтры';
          assert.equal((await button.innerText()).trim(),label+' ('+count+')');
          const box=await button.boundingBox();assert.ok(box.height>=44);
          await shot('before-reset');
          if(s.action==='keyboard'){await button.focus();await page.keyboard.press('Enter');}
          else await button.click();
          await page.waitForFunction(()=>window.__elapsed.reset);
          const [dom,paint]=await timing('reset');
          await verifyList(all);
          for(const id of ['categoryFilters','statusFilters','employeeFilters'])assert.equal(await page.locator('#'+id+' select').inputValue(),'all');
          assert.equal(await input.inputValue(),'');
          assert.ok(await clear.isHidden()&&await button.isHidden());
          assert.ok(await input.evaluate(e=>e===document.activeElement));
          const visual=await checkLayout();
          await shot('after-reset');
          if(s.action==='keyboard')await openCard('a');
          assert.equal(await page.evaluate(()=>__writes.length),writes);
          results.push([digest,'UI-0242',i-scenarios.length+1,s.task,
            'Проекты → '+Object.entries(s.filters).map(([id,value])=>id+'='+value).join(', ')+(s.query?' → «'+s.query+'»':'')+(s.action==='card'?' → открыть и закрыть карточку':'')+' → '+label+(s.action==='keyboard'?' (Enter) → открыть №17526':''),
            'До сброса: '+(names(s.found).join(' / ')||'Нет проектов')+'; после: '+names(all).join(' / '),dom,paint,
            visual+'; кнопка '+Math.round(box.height)+' px по высоте',
            'Одно действие восстанавливает все проекты. Фокус в поиске, строительный объект исключён. Записей изменено 0','PASS']);
          continue;
        }
        await shot('before');
        await input.fill(s.query);
        await page.waitForFunction(()=>window.__elapsed.input);
        await verifyList(s.found);
        const visual=await checkLayout();
        await shot('found');
        if(s.card){await openCard(s.found);await verifyList(s.found);}
        const [dom,paint]=await timing('input');
        const filterDescription=Object.entries(s.filters||{}).map(([id,value])=>id+'='+value).join(', ')||'все проекты';
        results.push([digest,'UI-0240',i+1,s.task,'Проекты → '+filterDescription+' → ввести «'+s.query+'»'+(s.card?' → открыть и закрыть карточку':''),names(s.found).join(' / ')||'Нет проектов',dom,paint,visual,'Один ввод; '+(s.card?'сверено название в карточке':'результат появляется в списке'), 'PASS']);
        const box=await clear.boundingBox();
        assert.ok(box&&box.width>=44&&box.height>=44,'Цель очистки меньше 44×44: '+JSON.stringify(box));
        assert.equal(await clear.getAttribute('aria-label'),'Очистить поиск проектов');
        if(s.keyboard){await input.focus();await page.keyboard.press('Tab');assert.ok(await clear.evaluate(e=>e===document.activeElement));await page.keyboard.press('Enter');}
        else await clear.click();
        await page.waitForFunction(()=>window.__elapsed.click);
        await verifyList(s.after);
        assert.equal(await input.inputValue(),'');
        assert.ok(await input.evaluate(e=>e===document.activeElement));
        assert.ok(await clear.isHidden());
        for(const [id,value] of Object.entries(s.filters||{}))assert.equal(await page.locator('#'+id+' select').inputValue(),value);
        const clearedVisual=await checkLayout();
        await shot('cleared');
        if(s.next)await openCard(s.next);
        if(s.keyboard){await page.keyboard.type('17226');await verifyList('c');}
        assert.equal(await page.evaluate(()=>__writes.length),writes);
        const [clearDom,clearPaint]=await timing('click');
        results.push([digest,'UI-0241',i+1,s.clear,filterDescription+' → «'+s.query+'» → '+(s.keyboard?'Tab, Enter и ввод 17226':'очистка')+(s.next?' → открыть «'+names(s.next)[0]+'»':''),names(s.after).join(' / '),clearDom,clearPaint,clearedVisual+'; кнопка '+Math.round(box.width)+'×'+Math.round(box.height),'Фокус возвращён в поиск; выбор фильтров сохранён; записей изменено 0','PASS']);
      }catch(e){const message='Сценарий '+(i+1)+': '+e.message;errors.push(message);console.error(message);}
      finally{await page.close();}
    }
  }finally{await browser.close();}
  if(errors.length)throw new Error(errors.join('\n'));
  assert.equal(results.length,30);
  if(output)fs.writeFileSync(output,[['SHA256 файлов сборки (16)','ID','№','Задача','Шаги','Сверенный результат','Обработка DOM, мс','До двух кадров, мс','Визуальная проверка','Удобство и связи','Итог'],...results].map(row=>row.map(csv).join(',')).join('\n')+'\n');
  console.log('30/30 сценариев, SHA256 файлов сборки '+digest);
})().catch(error=>{console.error(error);process.exitCode=1});
