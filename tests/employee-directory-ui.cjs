'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const port = 'https://app.test';
const filepath = name => path.join(root, name);

function fixture() {
  const targets = [
    ['lead-a','Семён Тестов','Ведущий архитектор',{is_salaried:true,fixed_salary:45000}],
    ['art-a','Семён Тестов','Дизайнер',{}],
    ['archive-a','Бывший Тестов','Инженер',{active:false}],
    ['legacy-a','Историк Тестов','Мастер макетов',{}],
    ['trash-a','Удалённый Тестов','Мастер макетов',{deleted_at:'2026-01-02T10:00:00Z'}]
  ];
  for (const [id,name,role,extra] of targets) __db.employees.push({id,name,role,active:true,created_at:'2025-01-01T00:00:00Z',...extra});
  __db.projects.push(
    {id:'qa-house',name:'Учебный дом',category_id:'arch',status_id:'active',employee_id:'lead-a',co_employee_id:'art-a'},
    {id:'qa-office',name:'Учебный офис',category_id:'arch',status_id:'active',employee_id:'archive-a'}
  );
  __db.project_members = [{id:'qa-team-1',project_id:'qa-office',employee_id:'lead-a'},{id:'qa-team-2',project_id:'qa-house',employee_id:'lead-a'}];
}

const scenarios = [
  ['load','Оценить загрузку перед назначением','Семён','У ведущего архитектора два разных объекта, включая участие в команде. Совмещение на одном объекте учитывается один раз.'],
  ['namesake','Открыть оклад нужного тёзки','Тестов','У ведущего архитектора оклад 45 000 ₽, у дизайнера с таким же именем оклад выключен.'],
  ['combine','Найти человека по имени и специальности','Семён дизайнер','Единственный результат ведёт к карточке дизайнера.'],
  ['spelling','Найти сотрудника по написанию имени из переписки','семен','Показаны оба сотрудника с именем Семён.'],
  ['archived','Проверить статус бывшего исполнителя','Бывший','Архивная карточка хранит связь с одним проектом, в карточке установлен неактивный статус.'],
  ['historical','Посмотреть старую должность после изменения справочника','Мастер макетов','Доступна историческая должность, сотрудник из корзины исключён.'],
  ['recover','Исправить ошибку в запросе без потери списка','Тестовв','Пустое состояние сменяется списком из четырёх записей после исправления запроса.'],
  ['order','Найти архитектора по фамилии и имени в обратном порядке','Тестов   Семён   ведущий','Открывается одна подходящая карточка ведущего архитектора.'],
  ['cancel','Отказаться от изменения должности найденного сотрудника','Мастер макетов','После отмены сохранены прежняя должность, запрос и результат, записей изменений нет.'],
  ['promote','Проверить движение сотрудника между должностями после повышения','Визуализатор','После сохранения исчез из прежней выборки и найден по новой должности. В журнале есть изменение.'],
  ['reset','Вернуться к полному составу после выбора специалиста','Бывший','Очистка возвращает восемь сотрудников, включая архивного; удалённая запись скрыта, фокус в поле поиска.'],
];

const feedback = {
  load:'Нагрузка обоих специалистов видна до открытия карточек.',
  namesake:'Совпадающие имена различаются должностями; для проверки оклада требуется открыть карточку.',
  combine:'Имя и должность можно уточнить в одном поле, результат один.',
  spelling:'Обе записи с «ё» находятся при вводе «е».',
  archived:'Статус архива виден рядом с именем, число связанных проектов — под ним.',
  historical:'По старой должности находится действующая карточка с прежним названием роли.',
  recover:'Пустое состояние видно сразу; исправление одного символа возвращает результат.',
  order:'Порядок слов не требуется помнить, дополнительные пробелы допустимы.',
  cancel:'После отмены запрос и найденная карточка доступны на прежнем месте.',
  promote:'После повышения прежняя выдача очищается; новая должность находится из того же поля.',
  reset:'Одна кнопка возвращает весь состав и фокус для следующего запроса.'
};

(async () => {
  const browser = await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || undefined,args:['--no-sandbox']});
  const rows = [], failures = [];
  const html = fs.readFileSync(filepath('index.html'));
  const build = crypto.createHash('sha256').update(html).digest('hex').slice(0,16);
  try {
    for (const [key,goal,query,result] of scenarios) {
      const ctx = await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block',reducedMotion:'reduce'});
      await ctx.addInitScript({content:fs.readFileSync(filepath('tests/mock.js'),'utf8')+';if(window===top)('+fixture.toString()+')();'});
      await ctx.route('**/*',route=>{
        const url = new URL(route.request().url());
        if(url.origin===port && url.pathname==='/')return route.fulfill({body:html,contentType:'text/html'});
        const file = filepath(url.pathname.slice(1));
        return url.origin===port && fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({path:file}) : route.fulfill({body:''});
      });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on('pageerror',e=>pageErrors.push(e.message));
      page.setDefaultTimeout(3000);
      try {
        await page.goto(port);
        await page.waitForFunction(()=>hasVerifiedAccess()&&!loadAllInFlight);
        await page.locator('#settingsBtn').click();
        const input=page.locator('#employeeSearch'), list=page.locator('#employeesCard .list-item');
        const edit=async row=>row.getByRole('button').click();
        const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const start=performance.now();
        await input.fill(query);
        await frame();
        const elapsed=performance.now()-start;
        const count=await list.count();
        const field=await input.boundingBox();
        const visual=await page.locator('#employeesCard').evaluate(card=>({
          available:innerWidth,width:Math.round(card.getBoundingClientRect().width),
          visible:card.getBoundingClientRect().width>0 && card.scrollWidth<=card.clientWidth+1,
          rows:[...card.querySelectorAll('.li-name,.li-meta')].every(x=>x.getBoundingClientRect().width>0 && x.scrollWidth<=x.clientWidth+1)
        }));
        assert.ok(field && field.x>=0 && field.x+field.width<=visual.available+1 && visual.visible && visual.rows);
        let captureMs=0;
        if(process.env.DIRECTORY_QA_SHOTS){
          const directory=process.env.DIRECTORY_QA_SHOTS;
          fs.mkdirSync(directory,{recursive:true});
          const started=performance.now();
          await page.screenshot({path:path.join(directory,key+'.png'),animations:'disabled'});
          captureMs=performance.now()-started;
        }
        let steps='Настройки → поиск «'+query+'»';
        const role=page.locator('#ef-role');
        if(key==='load'){
          assert.equal(count,2);
          assert.match(await list.filter({hasText:'Ведущий архитектор'}).innerText(),/2 проект/);
          assert.match(await list.filter({hasText:'Дизайнер'}).innerText(),/1 проект/);
          steps+=' → сверить число проектов обеих строк';
        } else if(key==='namesake'){
          assert.equal(count,4);
          await edit(list.filter({hasText:'Ведущий архитектор'}));
          assert.equal(await page.locator('#ef-fixed-salary').inputValue(),'45000');
          await page.locator('#empSheetClose').click();
          await edit(list.filter({hasText:'Дизайнер'}));
          assert.equal(await page.locator('#ef-is-salaried').isChecked(),false);
          steps+=' → карточка архитектора → закрыть → карточка одноимённого дизайнера → сверить оклады';
        } else if(key==='combine'||key==='order'){
          assert.equal(count,1,'Число найденных сотрудников');
          await edit(list);
          assert.equal(await role.inputValue(),key==='combine'?'Дизайнер':'Ведущий архитектор');
          steps+=' → открыть результат → сверить должность в карточке';
        } else if(key==='spelling'){
          assert.equal(count,2,'Поиск ё/е');
          assert.ok((await list.allInnerTexts()).every(x=>x.includes('Семён Тестов')));
          steps+=' → сверить имена и число результатов';
        } else if(key==='archived'){
          assert.equal(count,1);
          assert.match(await list.innerText(),/архив/);
          assert.match(await list.innerText(),/1 проект/);
          await edit(list);
          assert.equal(await page.locator('#ef-active').inputValue(),'false');
          steps+=' → проверить отметку архива, число проектов и статус в карточке';
        } else if(key==='historical'||key==='cancel'){
          assert.equal(count,1);
          assert.ok((await list.innerText()).includes('Историк'));
          await edit(list);
          assert.equal(await role.inputValue(),'Мастер макетов');
          steps+=' → открыть карточку исторической должности';
          if(key==='cancel'){
            await role.selectOption('Архитектор');
            await page.locator('#ef-cancel').click();
            assert.equal(await input.inputValue(),query);
            assert.match(await list.innerText(),/Мастер макетов/);
            steps+=' → выбрать «Архитектор» → Отмена → сверить прежнюю строку';
          }
        } else if(key==='recover'){
          assert.equal(count,0);
          await page.getByText('Сотрудники не найдены',{exact:true}).waitFor();
          await input.fill('Тестов');
          assert.equal(await list.count(),4);
          steps+=' → сверить сообщение → поправить на «Тестов»';
        } else if(key==='promote'){
          assert.equal(count,1);
          await edit(list);
          await role.selectOption('Ведущий архитектор');
          await page.locator('#ef-save').click();
          await page.getByText('Сотрудники не найдены',{exact:true}).waitFor();
          await input.fill('Ведущий архитектор');
          assert.equal(await list.count(),2);
          assert.match(await list.filter({hasText:'Ислам'}).innerText(),/Ведущий архитектор/);
          assert.ok(await page.evaluate(()=>__db.audit_log.some(r=>r.entity_id==='visual')));
          steps+=' → изменить должность на «Ведущий архитектор» → сохранить → проверить старую и новую выборки и журнал';
        } else if(key==='reset'){
          await page.locator('#employeeSearchClear').click();
          assert.equal(await list.count(),8);
          assert.equal(await input.inputValue(),'');
          assert.ok(await input.evaluate(e=>document.activeElement===e));
          assert.equal(await list.filter({hasText:'Удалённый'}).count(),0);
          steps+=' → очистить → проверить полный состав и фокус';
        }
        if(key!=='promote')assert.equal(await page.evaluate(()=>__writes.filter(x=>x.table==='employees').length),0);
        assert.deepEqual(pageErrors,[]);
        await frame();
        rows.push([build,'UI-0299',key,goal,steps,result,elapsed.toFixed(1),(performance.now()-start-captureMs).toFixed(1),
          'Поле и список в ширине 390 px, карточка '+visual.width+' px, текст без обрезки; результатов '+count+'.',
          feedback[key],
          browser.version(),new Date().toISOString(),'PASS']);
      } catch(e){failures.push(key+': '+e.message.split('\n')[0]);}
      finally {await ctx.close();}
    }
  } finally {await browser.close();}
  if(failures.length)throw new Error(failures.join('\n'));
  if(process.env.DIRECTORY_QA_CSV){
    const header=['SHA256 index.html','Элемент','Сценарий','Цель','Шаги','Фактический результат и связи','Поиск до двух кадров, мс','Маршрут после открытия настроек, мс','Визуальная проверка','Удобство','Chromium','UTC','Итог'];
    const quote=v=>'"'+String(v).replaceAll('"','""')+'"';
    fs.writeFileSync(process.env.DIRECTORY_QA_CSV,[header,...rows].map(r=>r.map(quote).join(',')).join('\n')+'\n');
  }
  console.log(rows.length+' employee directory journeys passed');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
