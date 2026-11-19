'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const records = [
  ['pine', '10126', 'Сосны', 2, 'Современный,Плоская кровля'],
  ['pine-old', '99925', 'Сосны', 1, 'Классический'],
  ['hill', '10026', 'Проект №10026 — Зелёный склон', 4, 'Современный,Цокольный этаж'],
  ['hill-small', '9726', 'Проект №9726 — Зелёный двор', 3, 'Классический,Мансарда'],
  ['legacy', '', 'Проект №9826 — Старый сад', 2, 'Классический'],
  ['park', '6626', 'Сад у парка', 1, 'Современный'],
  ['album', '00157-A', 'Дом по альбому', 1, 'Классический'],
  ['retired', '7226', 'Каменный водопад', 1, 'Современный'],
].map(([id, project_number, title, floors, tags]) => ({
  id, project_number, title, floors, tags: id === 'legacy' ? tags : tags.split(','), images: [], thumbnails: [],
  created_at:'2026-11-01', deleted_at: id === 'retired' ? '2026-11-02' : null,
}));
const scenarios = [
  ['01','Различить одноимённые дома разных лет','Сосны',['pine','pine-old']],
  ['02','Вставить номер из переписки с символом № и неразрывным пробелом','№\u00a010126',['pine']],
  ['03','Найти номер архивного формата, сохранённый только в заголовке','№ 9826',['legacy']],
  ['04','Отобрать серию по части названия без буквы ё','ЗЕЛЕН',['hill','hill-small']],
  ['05','Уточнить запрос номером и словами в другом порядке','двор  9726',['hill-small']],
  ['06','Найти четырёхэтажный дом среди проектов от трёх этажей','склон',['hill'],'[data-floors="3"]'],
  ['07','Сопоставить два названия с выбранным стилем','сад',['park'],'[data-style="modern"]'],
  ['08','Оставить только дома с мансардой из найденной серии','зелен',['hill-small'],'[data-feature="mansard"]'],
  ['09','Проверить исключение снятого с каталога дома и исправить запрос','водопад',[],null,'парка',['park']],
  ['10','Снять ограничение по имени, сохранив этажность','Сосны',['pine'],'[data-floors="2"]','',['pine','legacy']],
  ['11','Найти импортированный альбом по исходному буквенно-цифровому шифру','00157-a',['album']],
];
const card = id => records.find(row => row.id === id);
const numberOf = row => row.project_number || row.title.match(/№(\d+)/)[1];
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const csv = rows => rows.map(row => row.map(value => '"' + String(value).replaceAll('"','""') + '"').join(',')).join('\n') + '\n';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || undefined });
  const index = fs.readFileSync(path.join(root,'index.html'));
  const floorJS = fs.readFileSync(path.join(root, 'catalog-floors.js'));
  const build = 'index.html + catalog-floors.js sha256:' + crypto.createHash('sha256').update(index).update(floorJS).digest('hex').slice(0,16);
  const mock = fs.readFileSync(path.join(__dirname,'mock.js'),'utf8');
  const report = [['ID','Сценарий','Сборка','Стенд','Шаги','Бизнес-результат','Ожидание (порядок номеров)','Факт (порядок номеров)','Связь со следующим экраном','Ввод → 2 кадра, мс','Путь до возврата, мс','Визуально','Удобство','Статус']];
  const errors = [];
  try {
    for (const [id,task,query,selected,filter,correction,corrected] of scenarios) {
      const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',locale:'ru-RU'});
      try {
        await context.addInitScript({content: mock + '\nwindow.__db.project_cards=' + JSON.stringify(records)});
        await context.route('**/*', route => {
          const u = new URL(route.request().url());
          const file = path.join(root,u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
          if (u.hostname === 'app.test' && ['/', '/index.html'].includes(u.pathname)) return route.fulfill({body:index,contentType:'text/html'});
          if (u.hostname === 'app.test' && u.pathname === '/catalog-floors.js') return route.fulfill({body:floorJS,contentType:'text/javascript'});
          if (u.hostname === 'app.test' && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({path:file});
          return route.fulfill({body:''});
        });
        const page = await context.newPage();
        page.setDefaultTimeout(4000);
        await page.goto('https://app.test');
        await page.waitForFunction(() => typeof state !== 'undefined' && state.financialDataReady && !loadAllInFlight);
        await page.locator('.nav-btn[data-view="view-cards"]').click();
        const search = page.getByRole('searchbox',{name:'Поиск по номеру или названию'});
        const rows = page.locator('#cards-list .card');
        await rows.first().waitFor();
        if (filter) await page.locator('#view-cards '+filter).click();
        const verify = async expected => {
          if (!expected.length) assert.ok(await page.getByText('Проекты не найдены',{exact:true}).isVisible());
          const contents = await rows.allInnerTexts();
          assert.equal(contents.length, expected.length);
          for (const [i,key] of expected.entries()) {
            const row = card(key);
            assert.ok(contents[i].includes(row.title), contents[i]+' ≠ '+row.title);
            assert.ok(contents[i].includes(numberOf(row)), 'В выдаче отсутствует №'+numberOf(row)+': '+contents[i]);
          }
          return contents.map(text => text.match(/№\s*(\d+(?:-[a-zа-я0-9]+)?)/i)?.[1]);
        };
        await search.evaluate(el => el.addEventListener('input',() => {window.searchStarted=performance.now()},true));
        const start = Date.now();
        await search.fill(query);
        await frame(page);
        const ms = Math.round(await page.evaluate(() => performance.now()-window.searchStarted));
        const first = await verify(selected);
        assert.equal(await page.locator('#cards-search-count').textContent(), 'Найдено проектов: '+selected.length);
        let final = first;
        if (correction !== undefined) {
          await search.fill(correction);
          await frame(page);
          final = await verify(corrected);
        }
        const wanted = corrected || selected;
        const visible = await search.evaluate(el => {
          const rect=el.getBoundingClientRect();
          return [Math.round(rect.width),Math.round(rect.height),document.documentElement.scrollWidth<=innerWidth];
        });
        assert.ok(visible[0]>0 && visible[1]>0 && visible[2], 'Геометрия поиска');
        await rows.first().click();
        const viewer = page.locator('#cardViewerOverlay');
        const checkViewer = async (key,i) => {
          const row = card(key);
          await page.frameLocator('#cardViewerFrame').locator('.project-title').getByText(row.title,{exact:true}).waitFor();
          assert.equal(await page.locator('#cardViewerCounter').innerText(),(i+1)+' / '+wanted.length);
          assert.equal((await page.frameLocator('#cardViewerFrame').locator('.swiper-num').innerText()).trim(), '№ '+numberOf(row));
        };
        await checkViewer(wanted[0],0);
        if (wanted.length>1) {
          await page.locator('#cardViewerNext').click();
          await checkViewer(wanted[1],1);
        }
        assert.equal(await page.locator('#cardViewerNext').isVisible(),false);
        await viewer.getByTitle('Закрыть').click();
        await viewer.waitFor({state:'hidden'});
        assert.equal(await search.inputValue(),correction ?? query);
        assert.deepEqual(await verify(wanted), final);
        assert.equal(await page.evaluate(() => __writes.filter(w=>w.table==='project_cards').length),0);
        const elapsed = Date.now()-start;
        if (process.env.CATALOG_SEARCH_SCREENSHOTS) {
          const dir = process.env.CATALOG_SEARCH_SCREENSHOTS;
          fs.mkdirSync(dir,{recursive:true});
          await search.focus();
          await search.scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(dir,id+'.png'),animations:'disabled'});
          await page.locator('#cards-list').screenshot({path:path.join(dir,id+'-list.png'),animations:'disabled'});
        }
        const values = (a,b) => (a.join(', ')||'∅')+(b ? ' → '+b.join(', ') : '');
        const steps = ['Каталог',filter && 'выбрать «'+(await page.locator('#view-cards '+filter).innerText())+'»','ввести «'+query+'»',correction!==undefined && 'изменить на «'+correction+'»','открыть первую карточку',wanted.length>1 && 'следующая','закрыть'].filter(Boolean);
        report.push(['UI-0053/'+id,task,build,'Chromium '+browser.version()+'; 390×844; владелец; локальный mock; 7 активных + 1 удалённая',steps.join(' → '),task,values(selected.map(k=>numberOf(card(k))),corrected?.map(k=>numberOf(card(k)))),values(first,corrected ? final : null),'В просмотрщике '+final.join(' → ')+'; последняя стрелка скрыта; после возврата запрос и порядок сохранены',ms,elapsed,'Поле '+visible[0]+'×'+visible[1]+' px; документ без горизонтальной прокрутки; номера читаются из строк','Экспертная оценка: контекст сохранён; '+(steps.length-1)+' действий от каталога','PASS']);
      } catch (e) { errors.push(id+' '+task+': '+e.message); }
      finally { await context.close(); }
    }
    console.log(csv(report));
    if (errors.length) throw new Error(errors.join('\n'));
    if (process.env.CATALOG_SEARCH_CSV) fs.writeFileSync(process.env.CATALOG_SEARCH_CSV,'\uFEFF'+csv(report));
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1});
