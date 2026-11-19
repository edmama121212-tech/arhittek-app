'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const csv = process.env.PROJECT_FORM_CSV;
const shots = process.env.PROJECT_FORM_SCREENSHOTS;
const a = 'Учебный дом';
const b = 'Учебная студия';
const cases = [
  ['Пустая новая карточка', 'Создать → сразу Отмена с клавиатуры', 'Форма закрыта без предупреждения. В списке по-прежнему два проекта.', true],
  ['Заполненная заявка', 'Создать → выбрать архитектуру → ввести имя → Отмена → подтвердить → снова создать', 'Имя и направление очищены. Третьего проекта в списке нет.', true],
  ['Продолжение работы', 'Открыть дом → изменить название → Отмена → остаться → Сохранить проект', 'Черновик остался открыт. Сохранённое имя появилось в списке.'],
  ['Приостановка работ', 'Открыть дом → статус «Заморожен» → Отмена → подтвердить', 'В списке дом остался в работе, без отметки заморозки.'],
  ['Состав команды', 'Открыть дом → Команда → убрать участника → Отмена → подтвердить → снова открыть Команду', 'Предупреждение появилось. Назначение сохранилось в карточке и таблице участников.'],
  ['Новый этап в чужой карточке', 'Открыть дом → набрать название нового этапа → Отмена → подтвердить → открыть студию', 'В карточке студии поле этапа пусто. В таблице этапов обеих карточек изменений нет.'],
  ['Перенос сдачи', 'Открыть дом → изменить срок с 11 на 40 дней → Отмена → подтвердить → снова открыть дом', 'Срок сдачи в карточке и её сохранённой записи совпадает с исходным.'],
  ['Вознаграждение архитектора', 'Открыть дом → Команда → изменить процент → Отмена → подтвердить → снова открыть Команду', 'Ставка вернулась к 40%. Сохранённые условия оплаты и проводки прежние.'],
  ['Сохранённый этап и черновик заметок', 'Открыть дом → отметить готовый этап → изменить заметку → Отмена → подтвердить → снова открыть', 'Отметка выполнения сохранилась отдельно. Заметка вернулась к первоначальной.'],
  ['Изменение места работ', 'Открыть дом → Контакты и адрес → изменить адрес → Отмена → подтвердить', 'В строке дома указан исходный адрес. Второй проект и сохранённые адреса остались прежними.']
];
const observations = [
  '2 строки в списке. Предупреждений 0. После Enter фокус на кнопке нового проекта.',
  '2 строки. При повторном создании название и направление пусты.',
  'После отказа от закрытия введённое название «Уточнённый дом» осталось в поле. Сохранение изменило строку первого проекта.',
  'У дома по-прежнему статус «В процессе». Оба проекта и их финансовые записи совпали с исходными.',
  'В окне появилось 1 предупреждение. После повторного открытия участник Амина виден в Команде. В хранилище сохранилось прежнее назначение.',
  'В студии поле для нового этапа пустое. У дома и студии сохранился исходный набор этапов.',
  'После ввода 40 дней карточка показывала 10.06.2027. После отмены вновь показала 12.05.2027.',
  'После ввода 25% и отмены в карточке снова 40%. Состав проводок и данных проектов совпал с исходным.',
  'У этапа «Проверить макет» осталась активная отметка. В карточке показана исходная заметка «Согласовано».',
  'После отмены в строке дома виден «Учебная улица, 1». Оба адреса в хранилище совпали с исходными.'
];
function seed() {
  __db.projects = ['Учебный дом','Учебная студия'].map((name,i)=>({
    id:'project-'+i, name, category_id:'arch',status_id:'active',employee_id:'architect',
    fee_base:'profit',fee_percent:40,price:15000,advance:0,balance:15000,
    address:'Учебная улица, '+(i+1),start_date:'2027-05-01',end_date:'2027-05-12',notes:'Согласовано',area:100
  }));
  __db.project_members=[{id:'member-s',project_id:'project-0',employee_id:'designer'}];
  __db.project_stages=[{id:'stage-s',project_id:'project-0',name:'Проверить макет',done:false,sort_order:20}];
}
async function run() {
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
  const bundle=fs.readFileSync(path.join(root,'index.html'));
  const build=createHash('sha256').update(bundle).digest('hex');
  const rows=[['ID','Сценарий','Шаги','Ожидание','Факт и связь','Скорость от Отмены до результата, мс','Визуальная проверка','Удобство','Сборка SHA256 index.html','Стенд','Статус','Повтор после исправления']];
  const errors=[];
  if(shots) fs.mkdirSync(shots,{recursive:true});
  try {
    for(const [i,[name,steps,expected,isNew]] of cases.entries()){
      const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',locale:'ru-RU',reducedMotion:'reduce'});
      try {
        const mock=fs.readFileSync(path.join(__dirname,'mock.js'),'utf8');
        await context.addInitScript({content:'const qaOriginalConfirm=window.confirm;\n'+mock+'\nwindow.confirm=qaOriginalConfirm;('+seed.toString()+')()'});
        await context.route('**/*',route=>{
          const u=new URL(route.request().url());
          const file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
          if(u.hostname==='app.test' && u.pathname==='/')return route.fulfill({body:bundle,contentType:'text/html'});
          if(u.hostname==='app.test' && fs.existsSync(file) && fs.statSync(file).isFile())return route.fulfill({path:file});
          return route.fulfill({body:'',contentType:'text/javascript'});
        });
        const p=await context.newPage();
        p.setDefaultTimeout(4500);
        p.on('pageerror',e=>errors.push(name+' '+e.message));
        const dialogs=[];
        p.on('dialog',async dialog=>{
          dialogs.push(dialog.message());
          if(i===2)await dialog.dismiss();else await dialog.accept();
        });
        await p.goto('https://app.test/');
        await p.waitForFunction(()=>typeof hasVerifiedAccess==='function' && hasVerifiedAccess() && state.financialDataReady && !loadAllInFlight);
        await p.locator('.bottom-nav [data-view="view-projects"]').click();
        const row=title=>p.locator('#projectsCard .proj-row').filter({hasText:title});
        const open=()=>isNew?p.locator('#addProjectFab').click():row(a).click();
        const field=id=>p.locator('#pf-'+id);
        const team=()=>p.getByRole('tab',{name:'Команда'}).click();
        const sheet=p.locator('#projectSheetOverlay');
        const cancel=field('cancel');
        const db=()=>p.evaluate(()=>structuredClone({projects:__db.projects,members:__db.project_members,ledger:__db.ledger_entries||[],stages:__db.project_stages}));
        const before=await db();
        await open();
        assert.equal(await field('delete').isVisible(),!isNew);
        assert.equal(await field('stage-add').isVisible(),!isNew);
        if(i===1){await field('category').selectOption('arch');await field('name').fill('Черновик заявки');}
        if(i===2)await field('name').fill('Уточнённый дом');
        if(i===3)await field('status').selectOption('frozen');
        if(i===4){await team();await field('members-list').getByRole('button',{name:'Убрать из команды: Амина'}).click();assert.doesNotMatch(await field('members-list').innerText(),/Амина/);}
        if(i===5)await field('stage-name').fill('Только для первого дома');
        if(i===6){await p.waitForFunction(()=>document.getElementById('pf-duration-days').value==='11');await field('duration-days').fill('40');assert.match(await field('end-preview').innerText(),/10.06.2027/);}
        if(i===7){await team();await field('feepercent').fill('25');}
        if(i===8){
          await p.getByRole('button',{name:'Выполнить: Проверить макет'}).click();
          await p.waitForFunction(()=>__db.project_stages.some(s=>s.id==='stage-s'&&s.done));
          await field('notes').fill('Черновик после отметки');
        }
        if(i===9){await p.getByText('Контакты и адрес',{exact:true}).click();await field('address').fill('Новая площадка, 9');}
        await cancel.scrollIntoViewIfNeeded();
        const rect=await cancel.boundingBox();
        assert.ok(rect && rect.x>=0 && rect.x+rect.width<=391 && rect.y>=0 && rect.y+rect.height<=845);
        assert.equal(await cancel.innerText(),'Отмена');
        const shot=async suffix=>{if(shots)await p.screenshot({path:path.join(shots,(i+1)+'-'+suffix+'.png')});};
        await shot('before');
        const started=performance.now();
        if(i===0){await cancel.focus();await p.keyboard.press('Enter');}else await cancel.click();
        if(i===2)assert.ok(await sheet.isVisible());else await sheet.waitFor({state:'hidden'});
        await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const elapsed=Math.round(performance.now()-started);
        await shot('after');
        assert.equal(dialogs.length,i===0?0:1,'Количество предупреждений');
        if(i)assert.match(dialogs[0],/несохранённые изменения/);
        if(i===0)assert.equal(await p.evaluate(()=>document.activeElement.id),'addProjectFab','Фокус после закрытия формы');
        if(i!==2)assert.equal(await p.locator('#projectsCard .proj-row').count(),2);
        assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        if(i===1){await open();assert.equal(await field('name').inputValue(),'');assert.equal(await field('category').inputValue(),'');}
        if(i===2){
          assert.equal(await field('name').inputValue(),'Уточнённый дом');await field('save').click();
          await row('Уточнённый дом').waitFor();
          assert.equal((await db()).projects.find(v=>v.id==='project-0').name,'Уточнённый дом');
        }
        if(i===3)assert.match(await row(a).innerText(),/В процессе/);
        if(i===4){await open();await team();assert.match(await field('members-list').innerText(),/Амина/);}
        if(i===5){await row(b).click();assert.equal(await field('stage-name').inputValue(),'','Черновик другого проекта');}
        if(i===6){await open();await p.waitForFunction(()=>document.getElementById('pf-end-preview').innerText.includes('12.05.2027'));assert.equal(await field('end').inputValue(),'2027-05-12');}
        if(i===7){await open();await team();assert.equal(await field('feepercent').inputValue(),'40');}
        if(i===8){await open();assert.equal(await p.getByRole('button',{name:'Снять отметку: Проверить макет'}).getAttribute('aria-pressed'),'true');assert.equal(await field('notes').inputValue(),'Согласовано');}
        if(i===9)assert.match(await row(a).innerText(),/Учебная улица, 1/);
        const after=await db();
        if(i!==2 && i!==8)assert.deepEqual(after,before);
        if(i===8)assert.deepEqual(after.projects,before.projects);
        assert.deepEqual(after.projects[1],before.projects[1]);
        const ux=i===0?'Enter закрывает без лишнего вопроса.':i===2?'Выбор «Отмена» в предупреждении оставил введённое имя для сохранения.':'Одна кнопка и одно подтверждение до списка.';
        const visual='Кнопка целиком в окне, '+Math.round(rect.width)+'×'+Math.round(rect.height)+' px; '+(i===2?'карточка осталась видна':'форма скрыта, виден список')+'; без горизонтальной прокрутки.';
        rows.push(['UI-0239',name,steps,expected,observations[i],elapsed,visual,ux,build,'app.test; Мансур (фикстура); Chromium '+browser.version()+'; 390×844; локальные данные', 'Пройдено',({0:'До исправления терялся фокус; на новой карточке были видны кнопки удаления и добавления этапа',4:'До исправления отсутствовало предупреждение',5:'До исправления в поле был этап первого проекта'})[i]||'Регрессионный контроль']);
        console.log('PASS',i+1,elapsed);
      } catch(error){errors.push(name+' — '+error.message);console.error('FAIL',i+1,error.message);}
      finally{await context.close();}
    }
    assert.deepEqual(errors,[]);
    if(csv)fs.writeFileSync(csv,rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
  } finally {await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
