'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.env.PROJECT_HISTORY_CSV;
const projects = ['Дом','Дом у сада','Новая мастерская','Двойник','Двойник','Пустой объект','Ландшафт'].map((name,i)=>({
  id:'p'+i,name,category_id:'arch',status_id:'active',employee_id:'architect'
}));
const event = (n,type,id,name,action,changes) => ({
  id:'event'+n,entity_type:type,entity_id:id,entity_name:name,action,changes,
  created_at:'2026-11-'+String(n).padStart(2,'0')+'T11:30:00Z'
});
const audit = [
  event(1,'project','p0','Дом','create',{_actor:'Учебный архитектор'}),
  event(2,'ledger_entry','l1','Дом у сада — Оплата','create',{_actor:'Кассир соседнего проекта'}),
  event(3,'ledger_entry','l2','Старая мастерская — Оплата','create',{_actor:'Первоначальная оплата'}),
  event(4,'ledger_entry','l3','Старая мастерская — Удалённая запись','delete',{_actor:'Отменённый платёж'}),
  event(5,'ledger_entry','l4','Ландшафт — Аванс','create',{_actor:'Архивный аванс',_project_id:'p6'}),
  event(6,'ledger_entry','l5','Двойник — Аванс','create',{_actor:'Неопознанный платёж'}),
  event(7,'project','p2','Старая мастерская','update',{_actor:'Автор сметы',price:{old:1000,new:2400}}),
  event(8,'project','p2','Старая мастерская','update',{_actor:'Координатор',co_employee_id:{old:'designer',new:'visual'}}),
  event(9,'project','p6','Ландшафт','restore',{_actor:'Руководитель'}),
  event(10,'project','p1','Дом у сада','update',{_actor:'Согласующий',status_id:{old:'active',new:'done'}}),
  event(11,'ledger_entry','l6','Дом — Оплата','create',{_actor:'Личный расход'}),
  event(12,'project','retired','Одноимённый архив','create',{_actor:'Событие архивной карточки'})
];
const ledger = [['l1','p1'],['l2','p2'],['l3','p2',true],['l6',null]].map(([id,project_id,removed])=>({
  id, project_id, type:'project_expense',amount:70,description:'Печать',entry_date:'2026-11-01',deleted_at:removed?'2026-11-04T11:30:00Z':null
}));
const cases = [
  ['Разделить два дома с похожими названиями','p0',['Учебный архитектор'],['Кассир соседнего проекта','Личный расход']],
  ['Узнать статус второго дома и найти его оплату','p1',['Кассир соседнего проекта','В процессе → Завершён'],['Учебный архитектор']],
  ['Найти прежнюю оплату после переименования объекта','p2',['Первоначальная оплата','Запись финансов: Старая мастерская — Оплата'],['Кассир соседнего проекта']],
  ['Найти отменённую проводку в истории переименованной карточки','p2',['Отменённый платёж','Удалено'],['Личный расход']],
  ['Прочесть прежнюю цену по смете','p2',['Автор сметы','Цена: 1 000 ₽ → 2 400 ₽'],[]],
  ['Узнать, кто сменил соисполнителя','p2',['Амина → Ислам','Координатор'],['designer → visual']],
  ['Найти старый платёж после очистки корзины по сохранённой связи','p6',['Архивный аванс'],['Отменённый платёж','_project_id']],
  ['Проверить восстановление ранее удалённого проекта','p6',['Восстановлено','Руководитель'],[]],
  ['Не приписать старый платёж одному из тёзок','p3',['Изменений пока нет'],['Неопознанный платёж']],
  ['Проверить карточку без записей','p5',['Изменений пока нет'],['Событие архивной карточки']],
  ['Открыть новую заявку после просмотра истории другого проекта',null,['Сохраните проект, чтобы вести историю'],['Учебный архитектор']],
  ['Вернуться к черновику заметки после просмотра истории','p1',['Согласующий'],[],true]
];
function normalize(text) { return text.replace(/\s+/g,' ').trim(); }
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
  try{
    const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block',reducedMotion:'reduce'});
    await ctx.addInitScript({content:fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+'\nObject.assign(__db,'+JSON.stringify({projects,audit_log:audit,ledger_entries:ledger})+');'});
    const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
    await ctx.route('**/*',route=>{
      const url=new URL(route.request().url()),file=path.join(root,url.pathname==='/'?'index.html':url.pathname);
      return url.hostname==='app.test'&&fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({body:'',contentType:'text/javascript'});
    });
    const p=await ctx.newPage(),errors=[];
    p.setDefaultTimeout(6000);
    p.on('pageerror',error=>errors.push(error.message));
    await p.goto('https://app.test/');
    await p.waitForFunction(()=>state.history?.length===12 && !loadAllInFlight);
    await p.locator('.bottom-nav [data-view="view-projects"]').click();
    const rows=[['Элемент','Сборка SHA256 index','Chromium','Задача','Шаги','Результат и связь','Отклик до двух кадров, мс','Визуально','Удобство','Статус']];
    const getDigest=()=>p.evaluate(()=>JSON.stringify([__db.projects,__db.audit_log,__db.ledger_entries]));
    const original=await getDigest(), btn=p.locator('#pf-history-toggle'),list=p.locator('#pf-history-list');
    for(const [task,id,positive,negative,draft] of cases){
      const name=projects.find(row=>row.id===id)?.name;
      if(id)await p.locator('#projectsCard').getByText(name,{exact:true}).first().click();
      else await p.locator('#addProjectFab').click();
      if(draft)await p.locator('#pf-notes').fill('Уточнить покрытие');
      await p.getByRole('tab',{name:'Документы'}).click();
      await btn.scrollIntoViewIfNeeded();
      await p.evaluate(()=>{document.getElementById('pf-history-toggle').addEventListener('click',()=>{const t=performance.now();window.__historyMs=null;requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__historyMs=performance.now()-t;}));},{once:true,capture:true});});
      await btn.focus();await p.keyboard.press('Enter');
      await list.waitFor({state:'visible'});
      await p.waitForFunction(()=>Number.isFinite(window.__historyMs));
      const ms=await p.evaluate(()=>Math.round(window.__historyMs*10)/10);
      const actual=normalize(await list.innerText());
      for(const fragment of positive)assert.ok(actual.includes(fragment),task+' / '+fragment+' / '+actual);
      for(const fragment of negative)assert.ok(!actual.includes(fragment),task+' / чужая запись: '+fragment+' / '+actual);
      assert.equal(await btn.getAttribute('aria-expanded'),'true');
      assert.equal(await btn.getAttribute('aria-controls'),'pf-history-list');
      const visual=await list.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}));
      assert.ok(visual.width>100 && visual.scroll<=visual.width+1 && visual.left>=0 && visual.right<=391);
      if(process.env.PROJECT_HISTORY_SHOT&&draft)await p.screenshot({path:process.env.PROJECT_HISTORY_SHOT});
      await btn.click();
      assert.equal(await btn.getAttribute('aria-expanded'),'false');
      assert.ok(!await list.isVisible());
      if(draft){await p.getByRole('tab',{name:'Обзор'}).click();assert.equal(await p.locator('#pf-notes').inputValue(),'Уточнить покрытие');}
      await p.locator('#pf-cancel').click();
      assert.equal(await getDigest(),original);
      rows.push(['UI-0235',build,browser.version(),task,(id?'Проекты → '+name:'После просмотра карточки → + Новый проект')+(draft?' → набрать заметку':'')+' → Документы → Показать историю (Enter) → Скрыть → Отмена',positive.join(' · ')+(negative.length?' / исключены: '+negative.join(', '):'')+'; сохранённые проекты, журнал и проводки идентичны исходным.',ms,'Блок '+visual.width+' px, текст без горизонтального переполнения, после сворачивания скрыт.',draft?'Заметка сохранилась в форме до отмены.':'Раскрытие клавиатурой, состояние доступно программе чтения с экрана.','PASS']);
    }
    assert.deepEqual(errors,[]);
    if(output)fs.writeFileSync(output,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
    console.log(rows.length-1+' UI journeys passed');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
