'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const floorKeys = ['1','2','3','all'];
const controls = {'1':'UI-0055','2':'UI-0056','3':'UI-0057',all:'UI-0054'};
const labels = {'1':'1 этаж','2':'2 этажа','3':'3+ этажей',all:'Все'};
const modern = 'Современный', classic = 'Классический', basement = 'Цокольный этаж', flat = 'Плоская кровля', loft = 'Мансарда';
const cards = [
  [17,1,'Усадьба',[modern,flat,basement]], [16,'2','Усадьба',[classic,loft,basement]],
  [15,3,'Усадьба',[modern,loft]], [14,4,'Дом склона',[classic,basement]],
  [13,1,'Дом долины',[classic,loft]], [12,2,'Дом склона',[modern,flat]],
  [11,5,'Дом долины',[modern,flat,basement]], [10,null,'Альбом без обмера',[classic]],
  [9,1,'Дом под № 926',[modern]], [8,2,'Снятый дом',[modern,flat]]
].map(([n,floors,title,tags])=>({id:'house-'+n,project_number:n+'26',title,floors,tags,deleted_at:n===8?'2026-01-01':null,created_at:'2026-01-01',images:[],thumbnails:[]}));
for(const n of [10,11])Object.assign(cards.find(c=>c.id==='house-'+n),{total_area:'500,00',floor1_area:'120,00',floor2_area:'100,00',floor3_area:'80,00'});
const all = cards.filter(c=>!c.deleted_at).map(c=>Number(c.id.slice(6)));
const groups = [
  ['Сверить доступные уровни по статистике и карточкам',{},[[17,13,9],[16,12],[15,14,11],all]],
  ['Подобрать варианты одной серии с разной этажностью',{search:'усадьба'},[[17],[16],[15],[17,16,15]]],
  ['Сопоставить готовый подбор современного стиля с доступной этажностью',{style:'modern'},[[17,9],[12],[15,11],[17,15,12,11,9]]],
  ['Сравнить предложения с цокольным этажом без включения цоколя в этажность',{feature:'basement'},[[17],[16],[14,11],[17,16,14,11]]],
  ['Выбрать надземные этажи при обязательной мансарде',{feature:'mansard'},[[13],[16],[15],[16,15,13]]],
  ['Проверить плоскую кровлю в заданной этажности и открыть последний подходящий дом',{feature:'flat'},[[17],[12],[11],[17,12,11]]],
  ['Уточнить предложение по номеру пятиэтажного дома',{search:'№ 1126'},[[],[],[11],[11]]],
  ['Сохранить сразу два условия при смене этажности',{style:'classic',feature:'basement'},[[],[16],[14],[16,14]]],
  ['Отделить этажность проекта без обмера от подтверждённой',{search:'без обмера'},[[],[],[],[10]]],
  ['Сверить отсутствие снятого с продажи проекта по его коду',{search:'№ 826'},[[],[],[],[]]],
  ['Сохранить поисковый запрос и стиль в сравнении одноимённых вариантов',{search:'склона',style:'modern'},[[],[12],[],[12]]],
];
const read = file=>fs.readFileSync(path.join(root,file));
const assets = Object.fromEntries(['index.html','catalog-floors.js','catalog.html'].map(file=>[file,read(file)]));
const build = Object.entries(assets).map(([file,buffer])=>file+' '+crypto.createHash('sha256').update(buffer).digest('hex').slice(0,12)).join(', ');
const mock = read('tests/mock.js').toString();
const csv = rows=>rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\n')+'\n';

async function exercise(browser){
  const report = [['ID','Задача','Сборка SHA256','UTC','Стенд','Шаги','Фактический бизнес-результат','Связанный экран','Клик → два кадра, мс','Визуально','Удобство','Итог']];
  const errors = [];
  for(const [index,[task,criteria,expectedByFloor]] of groups.entries()){
    if(process.env.FLOOR_CASE && Number(process.env.FLOOR_CASE)!==index+1)continue;
    const ctx = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',locale:'ru-RU',reducedMotion:'reduce'});
    try {
      const links = index===0 ? floorKeys.map(key=>({token:'floor-'+key,created_at:'2026-11-01T08:00:00Z',floors_filter:key,deleted_at:null})) : [];
      await ctx.addInitScript({content:mock+'\n__db.project_cards='+JSON.stringify(cards)+';__db.share_links='+JSON.stringify(links)});
      await ctx.route('**/*',route=>{
        const u = new URL(route.request().url()), file=u.pathname==='/'?'index.html':u.pathname.slice(1);
        if(u.hostname!=='app.test')return route.fulfill({body:''});
        if(assets[file])return route.fulfill({body:assets[file],contentType:file.endsWith('.js')?'text/javascript':'text/html'});
        const target=path.join(root,file);
        return fs.existsSync(target)&&fs.statSync(target).isFile()?route.fulfill({path:target}):route.fulfill({body:''});
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(4000);
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto('https://app.test');
      await page.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
      await page.evaluate(()=>{
        window.catalogSyncCalls=[];
        sb.functions={invoke:async(name,{body})=>{
          window.catalogSyncCalls.push({name,body});
          return {data:{ok:true},error:null};
        }};
      });
      await page.locator('.nav-btn[data-view="view-cards"]').click();
      const view=page.locator('#view-cards'), rows=view.locator('#cards-list .card');
      const numbers=async()=> (await rows.allTextContents()).map(t=>t.match(/№\s*(\d+)/)?.[1]);
      await rows.first().waitFor();
      const setup=['Каталог'];
      for(const [key,value] of Object.entries(criteria)){
        if(key==='search'){
          await view.getByRole('searchbox').fill(value);
          setup.push('поиск «'+value+'»');
        }else{
          const filter=view.locator('[data-'+key+'="'+value+'"]');
          setup.push(await filter.innerText());
          await filter.click();
        }
      }
      for(const [i,key] of floorKeys.entries()){
        const expected=expectedByFloor[i].map(n=>n+'26'), button=view.locator('[data-floors="'+key+'"]');
        const steps=setup.concat(i?'после «'+labels[floorKeys[i-1]]+'»':'из «Все»','нажать «'+labels[key]+'»');
        await button.evaluate(el=>{window.storeyLatency=new Promise(resolve=>el.addEventListener('click',()=>{
          const start=performance.now();
          requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)));
        },{capture:true,once:true}));});
        await button.click();
        const ms=Math.round(await page.evaluate(()=>window.storeyLatency));
        assert.deepEqual(await numbers(),expected);
        assert.equal(await view.locator('[data-floors][aria-pressed="true"].active').count(),1);
        assert.equal(await button.getAttribute('aria-pressed'),'true');
        const anyFilter=key!=='all'||Object.keys(criteria).length>0;
        assert.equal(await view.locator('#cards-stats').isVisible(),!anyFilter);
        assert.equal(await view.locator('#cards-search-count').innerText(),anyFilter?'Найдено проектов: '+expected.length:'');
        for(const [name,value] of Object.entries(criteria)){
          if(name==='search')assert.equal(await view.getByRole('searchbox').inputValue(),value);
          else assert.equal(await view.locator('[data-'+name+'="'+value+'"]').getAttribute('aria-pressed'),'true');
        }
        const rect=await button.boundingBox();
        assert.ok(rect.width>0&&rect.height>0&&rect.x>=0&&rect.x+rect.width<=391);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        let linked;
        if(expected.length){
          const last=expected.at(-1), row=rows.last();
          if(last==='1026')assert.match(await row.innerText(),/Этажность не указана/);
          if(last==='1126')assert.match(await row.innerText(),/5 этажей/);
          await row.click();
          const frame=page.frameLocator('#cardViewerFrame');
          await frame.locator('.swiper-num').getByText('№ '+last,{exact:true}).waitFor();
          assert.equal(await page.locator('#cardViewerCounter').innerText(),expected.length+' / '+expected.length);
          assert.equal(await page.locator('#cardViewerNext').isVisible(),false);
          const record=cards.find(c=>c.project_number===last);
          assert.equal(await frame.locator('.stat-val').nth(2).innerText(),String(record.floors||'—'));
          if(expected.length>1){
            await page.locator('#cardViewerPrev').click();
            await frame.locator('.swiper-num').getByText('№ '+expected.at(-2),{exact:true}).waitFor();
          }
          await page.locator('#cardViewerOverlay').getByTitle('Закрыть').click();
          assert.deepEqual(await numbers(),expected);
          steps.push('открыть последнюю карточку №'+last,...(expected.length>1?['сравнить предыдущую']:[]),'закрыть');
          linked='Просмотрщик №'+last+' ('+expected.length+'/'+expected.length+'), этажность '+(record.floors??'не указана')+'. После возврата порядок сохранён.';
        }else{
          assert.ok(await view.getByText('Проекты не найдены',{exact:true}).isVisible());
          assert.equal(await page.locator('#cardViewerOverlay').isVisible(),false);
          linked='Виден пустой список, карточка из предыдущей подборки не открыта.';
        }
        const editLegacy=(index===6||index===8)&&key==='all';
        if(editLegacy){
          const id=index===6?'house-11':'house-10';
          const original=cards.find(c=>c.id===id);
          await rows.first().click();
          await page.locator('#cardViewerEditBtn').click();
          await page.locator('#ce-footprint').fill('12 × 14 м');
          await page.locator('#ce-save-btn').click();
          await page.locator('#cardEditorOverlay').waitFor({state:'hidden'});
          await page.waitForFunction(id=>__db.project_cards.find(c=>c.id===id).footprint==='12 × 14 м',id);
          const stored=await page.evaluate(id=>__db.project_cards.find(c=>c.id===id),id);
          assert.deepEqual([stored.floors,stored.total_area],[original.floors,original.total_area]);
          const sync=await page.evaluate(()=>catalogSyncCalls);
          assert.equal(sync.length,1);
          assert.deepEqual([sync[0].name,sync[0].body.floors,sync[0].body.total_area],['sync-card',original.floors,original.total_area]);
          assert.deepEqual(await numbers(),expected);
          steps.push('редактор → изменить только габариты → сохранить → сверить карточку, этажи и общую площадь');
          linked+=' Изменены габариты, прежние этажность и площадь 500 м² сохранились и совпали в запросе к локальной имитации сайта.';
        }
        if(!anyFilter){
          assert.deepEqual(await view.locator('.cat-sb-val').allInnerTexts(),['3','2','3','1']);
          assert.match(await view.locator('#cards-stats').innerText(),/не указана/i);
        }
        if(index===0){
          const client=await ctx.newPage();
          await client.goto('https://app.test/catalog.html?t=floor-'+key);
          await client.locator('#catFeed .card').first().waitFor();
          assert.deepEqual((await client.locator('#catFeed .swiper-num').allInnerTexts()).map(s=>s.replace('№ ','')).sort(),expected.slice().sort());
          if(key==='all')assert.ok(await client.locator('#catFeed .header-badge').getByText('Этажность не указана',{exact:true}).isVisible());
          await client.close();
          steps.push('сверить локальную клиентскую подборку этой этажности');
          linked+=' Состав клиентской подборки совпал.';
        }
        assert.equal(await page.evaluate(()=>__writes.filter(w=>w.table==='project_cards').length),editLegacy?1:0);
        if(index===8&&key==='all'&&process.env.FLOOR_SHOT)await page.screenshot({path:process.env.FLOOR_SHOT});
        report.push([controls[key]+'/'+(index+1),task+' · '+labels[key],build,new Date().toISOString(),'Chromium '+browser.version()+' 390×844, локальные данные',steps.join(' → '),
          'Подборка '+labels[key]+': '+(expected.map(n=>'№'+n).join(', ')||'пусто')+'.',linked,ms,
          'Видимая активная кнопка '+Math.round(rect.width)+'×'+Math.round(rect.height)+' px; без горизонтального скролла; '+(anyFilter?'счётчик '+expected.length:'общая сводка'),
          'Одно нажатие меняет этажность; '+(expected.length?'можно сразу открыть подходящий дом':'сразу видно отсутствие вариантов')+(Object.keys(criteria).length?', прочие условия сохранены.':'.'),'PASS']);
      }
    }catch(e){errors.push('Маршрут '+(index+1)+': '+e.message);if(process.env.FLOOR_STOP)break;}
    finally{await ctx.close();}
  }
  if(errors.length)throw Error(errors.join('\n'));
  if(process.env.FLOOR_CSV && !process.env.FLOOR_CASE)fs.writeFileSync(process.env.FLOOR_CSV,'\uFEFF'+csv(report));
  console.log((report.length-1)+' PASS · '+build);
}
(async()=>{const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined});try{await exercise(browser);}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
