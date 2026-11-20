'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const mock = fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8');
const basement = 'Цокольный этаж';
const mansard = process.argv.includes('--mansard');
const cards = (mansard ? [
  [15,'Альфа',1,['Мансарда','Современный']],
  [14,'Альфа',1,['Современный']],
  [13,'Старая башня',3,'Классический, Мансарда'],
  [12,'Два уровня',2,[basement,'Мансарда','Классический']],
  [11,'Компактный',1,[' Мансарда ','Классический']],
  [10,'Новая башня',4,['Плоская кровля','Современный']],
  [9,'Мансарда в названии',2,null],
  [8,'Снята с продажи',1,['Мансарда']],
] : [
  [15, 'Склон', 1, [basement,'Современный']],
  [14, 'Склон', 2, ['Плоская кровля','Современный']],
  [13, 'Веранда', 2, ['Классический','Мансарда',basement]],
  [12, 'Террасы', 4, ['Современный',basement,'Плоская кровля']],
  [11, 'Архивный дом', 1, 'Классический, Цокольный этаж'],
  [10, 'Дом без описания', 1, null],
  [9, 'Башня', 3, ['Классический','Мансарда']],
  [8, 'Коттедж с цоколем снят', 2, [basement,'Современный']],
]).map(([n,title,floors,tags]) => ({id:'house-'+n,project_number:n+'26',title,floors,tags,created_at:'2026-10-16',deleted_at:n===8?'2026-10-17':null,images:[],thumbnails:[]}));
const all = [15,14,13,12,11,10,9];
const chosen = [15,13,12,11];
// Each pair is a concrete, ordered shortlist both before and after lifting the requirement.
const cases = mansard ? [
  ['Подготовить полный список мансардных домов',null,[],[15,13,12,11]],
  ['Отобрать только компактные одноэтажные варианты',null,[['floors','1']],[15,11]],
  ['Найти двухэтажный проект с цоколем и мансардой',null,[['floors','2'],['feature','basement']],[12]],
  ['Отличить мансарду от плоской кровли на высоких домах',null,[['floors','3'],['feature','flat']],[13]],
  ['Отделить одноимённый дом без мансарды',null,[['text','Альфа']],[15]],
  ['Открыть редактор ранее внесённой карточки с текстовым перечнем особенностей',null,[['text','1326']],[13]],
  ['Найти особенность из списка с пробелами у старой карточки',null,[['text','Компактный']],[11]],
  ['Отобрать несколько домов в классическом стиле по размеру каталога',null,[['style','classic']],[13,12,11]],
  ['Проверить отсутствие высоких современных домов с жилой мансардой',null,[['style','modern'],['floors','3']],[]],
  ['Проверить заявленное в названии свойство по данным карточки',null,[['text','Мансарда в названии']],[]],
  ['Проверить доступность снятого с продажи предложения',null,[['text','Снята с продажи']],[]],
] : [
  ['Сравнить доступные дома с цоколем','Вернуть каталог со всеми особенностями',[],chosen,all],
  ['Найти одноэтажные дома с подземным уровнем','Вернуть одноэтажный дом без описания',[['floors','1']],[15,11],[15,11,10]],
  ['Сверить цоколь в старой карточке с тегами строкой','Сохранить классический стиль при расширении выбора',[['style','classic']],[13,11],[13,11,9]],
  ['Выбрать высокий дом с цоколем','Сравнить высокий дом с цоколем и трёхэтажный без него',[['floors','3']],[12],[12,9]],
  ['Различить одноимённые проекты по наличию цоколя','Вернуть одноимённый вариант с плоской кровлей',[['text','Склон']],[15],[15,14]],
  ['Обнаружить отсутствие цоколя у двухэтажного современного дома','Снять одно условие, сохранив стиль и этажность',[['floors','2'],['style','modern']],[],[14]],
  ['Сменить плоскую кровлю на цоколь и включить дома с обоими признаками','Вернуть в список дома с мансардой и без признаков',[['feature','flat']],chosen,all],
  ['Найти двухэтажный вариант с цоколем среди действующих, исключая снятый','Оставить только действующие двухэтажные проекты после снятия условия',[['floors','2']],[13],[14,13]],
  ['Проверить пригодность конкретного дома без сведений о цоколе','Вернуться к выбранному номеру, сохранив запрос',[['text','1026']],[],[10]],
  ['Проверить запрос на дом, снятый с продажи','Убедиться, что снятый дом недоступен при любом выборе особенностей',[['text','снят']],[],[]],
];
const quote = value => '"' + String(value).replaceAll('"','""') + '"';
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
(async () => {
  const browser = await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || undefined});
  const index = fs.readFileSync(path.join(root,'index.html'));
  const floorJS = fs.readFileSync(path.join(root,'catalog-floors.js'));
  const build = crypto.createHash('sha256').update(index).update(floorJS).digest('hex').slice(0,16);
  const report = [['Элемент','Сценарий','Сборка SHA256 index и catalog-floors','Дата UTC','Стенд','Шаги','Фактический результат и связи','От клика до двух кадров, мс','Визуальная проверка','Удобство','Итог']];
  const errors = [];
  try {
    for (const [i,[restrictTask,clearTask,criteria,restricted,cleared]] of cases.entries()) {
      const ctx = await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block',isMobile:true,hasTouch:true,reducedMotion:'reduce'});
      try {
        await ctx.addInitScript({content: mock+'\nwindow.__db.project_cards='+JSON.stringify(cards)});
        await ctx.route('**/*',route => {
          const url = new URL(route.request().url());
          const file = path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
          if(url.hostname!=='app.test')return route.fulfill({body:''});
          if(url.pathname==='/'||url.pathname==='/index.html')return route.fulfill({body:index,contentType:'text/html'});
          if(url.pathname==='/catalog-floors.js')return route.fulfill({body:floorJS,contentType:'text/javascript'});
          return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({body:''});
        });
        const page = await ctx.newPage();
        page.on('pageerror',error=>errors.push(error.message));
        page.setDefaultTimeout(4000);
        await page.goto('https://app.test');
        await page.waitForFunction(()=>typeof state !== 'undefined' && state.financialDataReady&&!loadAllInFlight);
        await page.locator('.nav-btn[data-view="view-cards"]').click();
        const view = page.locator('#view-cards');
        const search = view.getByRole('searchbox');
        const rows = view.locator('#cards-list .card');
        await rows.first().waitFor();
        const steps = ['Открыть каталог сотрудников'];
        for(const [type,value] of criteria){
          if(type==='text'){await search.fill(value);steps.push('поиск «'+value+'»');}
          else{
            const filter = view.locator('[data-'+type+'="'+value+'"]');
            steps.push(await filter.innerText());
            await filter.click();
          }
        }
        const actions = mansard ? [['UI-0060','mansard',restrictTask,restricted]] : [['UI-0059','basement',restrictTask,restricted],['UI-0058','all',clearTask,cleared]];
        for(const [control,key,task,expected] of actions){
          const button = view.locator('[data-feature="'+key+'"]');
          await button.evaluate(el=>el.addEventListener('click',()=>{window.featureClicked=performance.now()},{capture:true,once:true}));
          await button.click();
          await frames(page);
          const ms = Math.round(await page.evaluate(()=>performance.now()-window.featureClicked));
          steps.push(await button.innerText());
          const rowNumbers = async () => (await rows.allTextContents()).map(t=>t.match(/№(\d+)/)?.[1]);
          assert.deepEqual(await rowNumbers(),expected.map(n=>n+'26'));
          const hasConstraint = key!=='all'||criteria.some(([type])=>type!=='feature');
          const message = await view.locator('#cards-search-count').innerText();
          assert.equal(message,hasConstraint?'Найдено проектов: '+expected.length:'');
          assert.equal(await view.locator('#cards-stats').isVisible(),!hasConstraint);
          assert.equal(await view.locator('#feature-filters [aria-pressed="true"]').count(),1);
          assert.equal(await button.getAttribute('aria-pressed'),'true');
          if(key==='all')assert.equal(await button.innerText(),'Все особенности');
          const rect = await button.boundingBox();
          assert.ok(rect.width>0&&rect.height>0&&rect.x>=0&&rect.x+rect.width<=390);
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          let result;
          const cardSteps=[];
          if(expected.length){
            const last=expected.at(-1);
            await rows.last().click();
            const record=cards.find(c=>c.id==='house-'+last);
            cardSteps.push('открыть карточку №'+record.project_number);
            const frame=page.frameLocator('#cardViewerFrame');
            await frame.locator('.project-title').getByText(record.title,{exact:true}).waitFor();
            assert.equal((await frame.locator('.swiper-num').innerText()).trim(),'№ '+record.project_number);
            assert.equal(await page.locator('#cardViewerCounter').innerText(),expected.length+' / '+expected.length);
            assert.equal(await page.locator('#cardViewerNext').isVisible(),false);
            if(mansard){
              assert.ok(await frame.locator('.tags').getByText('Мансарда',{exact:true}).isVisible());
              if(criteria.some(([type,value])=>type==='feature'&&value==='basement')){
                assert.ok(await frame.locator('.tags').getByText(basement,{exact:true}).isVisible());
              }
            }
            const editLegacy=mansard && criteria.some(([type,value])=>type==='text'&&value==='1326');
            if(editLegacy){
              await page.locator('#cardViewerEditBtn').click();
              await page.locator('#cardEditorOverlay').waitFor();
              assert.equal(await page.locator('#ce-num').inputValue(),record.project_number);
              assert.ok((await page.locator('#ce-tags').inputValue()).includes('Мансарда'));
              assert.equal(await page.locator('#feature-btn-mansard').getAttribute('aria-pressed'),'true');
              if(process.env.FEATURE_OUTPUT)await page.screenshot({path:path.join(process.env.FEATURE_OUTPUT,'mansard-editor.png')});
              cardSteps.push('открыть редактор, сверить номер и тег, закрыть');
              await page.locator('#cardEditorOverlay button[onclick="closeCardEditor()"]').click();
            }else{
              await page.locator('#cardViewerOverlay').getByTitle('Закрыть').click();
              cardSteps.push('закрыть карточку');
            }
            assert.deepEqual(await rowNumbers(),expected.map(n=>n+'26'));
            result='Открылась карточка №'+record.project_number+(editLegacy?' и её редактор с выбранной мансардой':'')+'; после возврата подборка сохранилась.';
          } else {
            assert.ok(await view.getByText('Проекты не найдены',{exact:true}).isVisible());
            assert.equal(await page.locator('#cardViewerOverlay').isVisible(),false);
            result='Показано «Проекты не найдены»; открыть карточку из списка невозможно.';
          }
          if(process.env.FEATURE_OUTPUT){
            fs.mkdirSync(process.env.FEATURE_OUTPUT,{recursive:true});
            await button.scrollIntoViewIfNeeded();
            await page.screenshot({path:path.join(process.env.FEATURE_OUTPUT,control+'-'+String(i+1).padStart(2,'0')+'.png')});
          }
          for(const [type,value] of criteria){
            if(type==='text')assert.equal(await search.inputValue(),value);
            else if(type!=='feature')assert.equal(await view.locator('[data-'+type+'="'+value+'"]').getAttribute('aria-pressed'),'true');
          }
          const shortList=expected.map(n=>'№'+n+'26').join(', ')||'пусто';
          assert.equal(await page.evaluate(()=>__writes.filter(w=>w.table==='project_cards').length),0);
          report.push([control+'/'+(i+1),task,build,new Date().toISOString(),'Chromium '+browser.version()+'; локальные синтетические карточки; 390×844',
            steps.concat(cardSteps).join(' → '),shortList+'. '+result,ms,
            'Кнопка '+Math.round(rect.width)+'×'+Math.round(rect.height)+' px; активна одна особенность; без горизонтальной прокрутки. '+(hasConstraint?message:'Видна сводка полного каталога.'),
            (hasConstraint?'Размер подборки виден до открытия карточки.':'Весь каталог доступен после одного нажатия.')+' Остальные условия сохранены.','PASS']);
        }
      } catch(error) { errors.push('Сценарий '+(i+1)+': '+error.message); }
      finally { await ctx.close(); }
    }
    if(errors.length)throw Error(errors.join('\n'));
    if(process.env.FEATURE_OUTPUT)fs.writeFileSync(path.join(process.env.FEATURE_OUTPUT,mansard?'QA_CATALOG_MANSARD_RUNS.csv':'QA_CATALOG_FEATURE_RUNS.csv'),'\uFEFF'+report.map(r=>r.map(quote).join(',')).join('\n')+'\n');
    console.log(report.length-1+' сценариев пройдено. Сборка '+build);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
