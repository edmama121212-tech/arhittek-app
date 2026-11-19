const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const output = process.env.ROLE_EVIDENCE_DIR;
const sheet = '#empSheetOverlay';
const cases = [
  ['standard', 'Включить нового архитектора в команду', 'Выбрать должность архитектора, заполнить имя и PIN, сохранить'],
  ['lead', 'Назначить ведущего дизайнера для подготовки договоров', 'Выбрать должность ведущего дизайнера, сверить доступ к КП и договору, сохранить'],
  ['archive', 'Занести архивного сотрудника', 'Указать неактивный статус, сохранить, найти пометку архива в команде'],
  ['salary', 'Оформить сотрудника на фиксированный оклад', 'Включить фиксированную зарплату, ввести 45000, сохранить, заново открыть карточку'],
  ['name', 'Исправить пропуск имени', 'Ввести PIN, сохранить без имени, проверить сообщение, добавить имя, сохранить'],
  ['pin', 'Исправить пропуск обязательного PIN при создании', 'Ввести имя, сохранить без PIN, проверить сообщение и подсказку, ввести PIN, сохранить'],
  ['paste', 'Оформить доступ при вставке кода с разделителем', 'Вставить тестовый PIN с пробелом, сверить пять отображаемых цифр, сохранить'],
  ['retry', 'Завершить найм после ошибки записи', 'Сохранить при отказе тестовой записи, проверить черновик, восстановить связь, сохранить повторно'],
  ['cancel', 'Отозвать несохранённое назначение', 'Заполнить имя и PIN, выбрать Отмена, подтвердить, открыть создание снова'],
  ['legacy', 'Открыть создание после просмотра сотрудника со старой должностью', 'Открыть архивную должность в существующей карточке, закрыть, нажать Добавить сотрудника, сверить список должностей'],
  ['staff', 'Проверить границу управления командой у архитектора', 'Открыть рабочее пространство архитектора, проверить Проекты и отсутствие входа в управление командой'],
  ['lead-access', 'Подготовить документы без права добавления сотрудников', 'Открыть Ещё под ведущим дизайнером, проверить доступность Договора и отсутствие входа в управление командой']
];

function actorFixture() {
  const actor = new URL(location.href).searchParams.get('actor') || 'admin';
  const person = __db.employees.find(e => e.id === actor);
  localStorage.setItem('arhittek_session', JSON.stringify({employeeId:actor,name:person.name,isAdmin:!!person.is_admin,token:'fixture-session-'+actor,createdAt:Date.now()}));
  __db.employees.push({id:'legacy-employee',name:'Учебный ветеран',role:'Прежняя должность',active:true});
}

(async () => {
  const browser = await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || undefined,args:['--no-sandbox']});
  const html = fs.readFileSync(path.join(root,'index.html'));
  const build = 'index.html sha256:'+crypto.createHash('sha256').update(html).digest('hex').slice(0,16);
  const rows = [];
  const failures = [];
  if (output) fs.mkdirSync(output,{recursive:true});
  try {
    for (const [key,goal,steps] of cases) {
      const ctx = await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block',reducedMotion:'reduce'});
      await ctx.addInitScript({content:'if(window===window.top){'+fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+';('+actorFixture.toString()+')();}'});
      await ctx.route('**/*',route=>{
        const url = new URL(route.request().url());
        if (url.hostname === 'app.test') {
          if (url.pathname === '/') return route.fulfill({body:html,contentType:'text/html'});
          const file = path.join(root,url.pathname.slice(1));
          if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});
        }
        return route.fulfill({body:'',contentType:'text/javascript'});
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(4000);
      const $ = selector=>page.locator(selector);
      const frame = () => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      const loc = [sheet,'#ef-name','#ef-pin','#ef-save'].map($);
      const [form,name,pin,save] = loc;
      const roster = $('#employeesCard');
      const label = 'Учебный '+key;
      let actions = 0;
      const click = async selector=>{await $(selector).click();actions++;};
      const type = async (field,value)=>{await field.fill(value);actions++;};
      const select = async (selector,value)=>{await $(selector).selectOption(value);actions++;};
      const createCount = ()=>page.evaluate(()=>__writes.filter(w=>w.table==='employees'&&w.op==='insert').length);
      const msg = async value=>{await page.getByText(value,{exact:true}).waitFor();};
      const shot = async phase=>{if(output)await page.screenshot({path:path.join(output,key+'-'+phase+'.png'),animations:'disabled'});};
      const nonOwner = ['staff','lead-access'].includes(key);
      const actor = key==='staff'?'architect':key==='lead-access'?'designer':'admin';
      try {
        await page.goto('https://app.test/?actor='+actor);
        await page.waitForFunction(()=>typeof hasVerifiedAccess==='function' && hasVerifiedAccess() && !loadAllInFlight);
        const start=performance.now();
        let screenshotMs=0;
        let feedback, result, ux,visual;
        if (nonOwner) {
          if(key==='lead-access')await click('.bottom-nav [data-view="view-more"]');
          const target = key==='staff'?'#view-projects.active':'#openContractsBtn';
          await $(target).waitFor();
          assert.ok(!(await $('#settingsBtn').isVisible())&&!(await $('#addEmployeeBtn').isVisible()));
          await frame();
          feedback = performance.now()-start;
          result = key==='staff'?'Открыты свои проекты. Настройки и создание сотрудника скрыты.':'Договор доступен в Ещё. Настройки и создание сотрудника скрыты.';
          ux = 'Проверка доступных действий в рабочей навигации.';
          visual = 'Видим целевой раздел роли. Управление командой скрыто.';
        } else {
          await click('#settingsBtn');
          if(key==='legacy') {
            await roster.locator('.list-item').filter({hasText:'Учебный ветеран'}).getByRole('button').click();actions++;
            assert.equal(await $('#ef-role').inputValue(),'Прежняя должность');
            await click('#empSheetClose');
          }
          const begun=performance.now();
          await click('#addEmployeeBtn');
          await $('#empSheetTitle').getByText('Новый сотрудник',{exact:true}).waitFor();
          await frame();
          feedback=performance.now()-begun;
          assert.ok(await name.isVisible()&&await pin.isVisible());
          const shotStart=performance.now();
          await shot('open');
          screenshotMs=performance.now()-shotStart;
          const rect=await form.locator('.sheet').boundingBox();
          assert.ok(rect.x>=-1 && rect.x+rect.width<=391);
          visual='Форма целиком по ширине '+Math.round(rect.width)+' px, заголовок и поля видимы.';
          ux='Форма открылась одним нажатием. ';
          if(key==='legacy') {
            assert.equal(await $('#ef-role option').filter({hasText:'Прежняя должность'}).count(),0,'Legacy-only role leaked to new hires');
            assert.equal(await $('#ef-role').inputValue(),'Сотрудник');
            result='Старая должность доступна при просмотре исходного сотрудника. В новой карточке только штатные должности.';
            ux+='Список должностей соответствует созданию.';
          } else {
            if(key!=='name')await type(name,label);
            if(key!=='pin')await type(pin,key==='paste'?'12 456':'123456');
            if(key==='cancel') {
              await click('#ef-cancel');
              assert.ok(!await form.isVisible());
              await click('#addEmployeeBtn');
              assert.equal(await name.inputValue(),'');
              assert.equal(await pin.inputValue(),'');
              result='Создание отменено. Следующий черновик пуст, в списке нет новой записи.';
              ux+='Отмена очищает черновик.';
            } else {
              if(key==='paste')assert.equal(await pin.inputValue(),'12456');
              if(key==='standard')await select('#ef-role','Архитектор');
              if(key==='lead'){
                await select('#ef-role','Ведущий дизайнер');
                assert.match(await $('#ef-role-access').innerText(),/КП и Договор/);
              }
              if(key==='archive')await select('#ef-active','false');
              if(key==='salary'){
                await click('#ef-is-salaried');
                await type($('#ef-fixed-salary'),'45000');
              }
              if(key==='retry')await page.evaluate(()=>{__fail={table:'employees',op:'insert'};});
              await click('#ef-save');
              const warnings={name:'Введите имя',pin:'Укажите PIN-код для нового сотрудника',retry:'Ошибка сохранения: Simulated database failure'};
              if(warnings[key]){
                await msg(warnings[key]);
                assert.ok(await form.isVisible());
                assert.equal(await createCount(),0);
                if(key!=='name')assert.equal(await name.inputValue(),label);
                if(key==='pin')assert.match(await $('#ef-pin-field label').first().innerText(),/обязател/i);
                if(key==='name')await type(name,label);
                if(key==='pin')await type(pin,'123456');
                if(key==='retry')await page.evaluate(()=>{__fail=null;});
                await click('#ef-save');
                ux+='Сообщение видно, данные для исправления сохранены.';
              } else ux+='Сохранённый сотрудник найден в списке.';
              const row=roster.locator('.list-item').filter({hasText:label});
              await row.waitFor();
              assert.ok(!await form.isVisible());
              assert.equal(await createCount(),1);
              const record=await page.evaluate(n=>__db.employees.find(e=>e.name===n),label);
              assert.equal(record.pin_code,key==='paste'?'12456':'123456');
              assert.equal(record.active,key!=='archive');
              assert.match(await row.innerText(),new RegExp(record.role));
              const audit=await page.evaluate(id=>__db.audit_log.some(log=>log.entity_id===id),record.id);
              assert.ok(audit,'Created employee linked to audit log');
              if(key==='archive')assert.match(await row.innerText(),/архив/);
              if(key==='salary'){
                await row.getByRole('button').click();actions++;
                assert.equal(await $('#ef-fixed-salary').inputValue(),'45000');
                assert.ok(await $('#ef-is-salaried').isChecked());
              }
              result='В списке 1 новый сотрудник, должность '+record.role+', статус '+(record.active?'активен':'архив')+'. Есть запись создания в истории.';
              if(key==='paste')result+=' Код состоит из пяти цифр и совпадает с отображённым в форме.';
              if(key==='salary')result+=' При повторном открытии оклад 45000.';
              if(key==='lead')result+=' Резюме доступа указывает КП и Договор.';
              if(warnings[key])result+=' До исправления записей 0.';
            }
            if(key==='cancel')assert.equal(await createCount(),0);
          }
        }
        if(key==='legacy'||nonOwner)assert.equal(await createCount(),0);
        await frame();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        const elapsed=performance.now()-start-screenshotMs;
        await shot('result');
        rows.push([build,'UI-0301',key,actor,goal,(nonOwner?'':'Настройки → ')+(key==='legacy'||nonOwner?'':'Добавить сотрудника → ')+steps,result,Math.round(feedback),Math.round(elapsed),visual+' Страница без горизонтальной прокрутки.',actions+' действий. '+ux,'PASS']);
      } catch (error) {failures.push(key+': '+error.message.split('\n')[0]);console.error(key,error.message.split('\n')[0]);}
      finally {await ctx.close();}
    }
  } finally {await browser.close();}
  if(failures.length)throw new Error(failures.join('\n'));
  if(process.env.ROLE_EVIDENCE_CSV) {
    const header=['Сборка','ID','Сценарий','Сессия','Цель','Шаги','Фактический итог и связи','Отклик до двух кадров, мс','Маршрут с проверками, мс','Визуальная проверка Chromium 390×844','Удобство (экспертно)','Итог'];
    const quote=s=>'"'+String(s).replaceAll('"','""')+'"';
    fs.writeFileSync(process.env.ROLE_EVIDENCE_CSV,[header,...rows].map(r=>r.map(quote).join(',')).join('\n')+'\n');
  }
  console.log(rows.length+' employee onboarding and role journeys passed');
})().catch(err=>{console.error(err);process.exitCode=1;});
