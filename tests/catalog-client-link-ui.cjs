'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f));
const assets=['index.html','catalog.html','catalog-floors.js'];
const build=crypto.createHash('sha256');for(const file of assets)build.update(read(file));
const sha=build.digest('hex').slice(0,16);
const cards=[1,2,3,4,2].map((floors,i)=>({id:'fixture-'+i,project_number:(100+i)+'26',title:'Учебный дом '+i,floors,tags:['Дом'],images:[],created_at:'2026-10-01',deleted_at:i===4?'2026-10-07':null}));
const cases=[
 ['fresh','Открыть новую ссылку после бессрочной подборки','all','14'],
 ['one','Подобрать одноэтажный дом','1','2'],
 ['two','Отобрать двухэтажные дома, исключив снятую карточку','2','7'],
 ['tall','Подготовить трёх- и четырёхэтажные варианты','3','14'],
 ['empty','Выдать фильтр без подходящих домов','3','3'],
 ['expiry','Проверить окончание двухдневного доступа','all','2'],
 ['noexpiry','Оставить постоянную подборку доступной через год','all','0'],
 ['cancel','Отменить создание до записи','1','3'],
 ['retry','Сохранить введённые условия после отказа и создать ссылку повторно','2','4'],
 ['twice','Получить одну ссылку при двойном подтверждении','1','5'],
 ['edit','Изменить условия выданной подборки, сохранив первую ссылку','2','30'],
 ['revoke','Остановить действие уже выданной ссылки','all','14'],
 ['copy','Скопировать вручную при недоступном буфере обмена','1','7'],
 ['blank','Создать служебную ссылку без собственного названия','all','6']
];
const quote=x=>'"'+String(x).replaceAll('"','""')+'"';
const frames=p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const report=[['ID','SHA index/catalog/catalog-floors','Сценарий','Шаги','Результат и связи','Открытие формы, мс','Подтверждение или закрытие, мс','Визуально и удобство','Стенд','Итог']];
 try{for(const [mode,goal,filter,days] of cases){
  const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
  try{
   const seed=mode==='empty'?cards.filter(c=>c.floors<3):cards;
   await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
   await ctx.addInitScript(c=>{window.__db.project_cards=c;window.__db.share_links=[];},seed);
   await ctx.route('**/*',route=>{
    const u=new URL(route.request().url()),f=path.join(root,u.pathname==='/'?'index.html':u.pathname);
    return u.hostname==='app.test'&&fs.existsSync(f)&&fs.statSync(f).isFile()?route.fulfill({path:f}):route.fulfill({body:'',contentType:'text/javascript'});
   });
   const p=await ctx.newPage();p.setDefaultTimeout(5000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.goto('https://app.test');await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);
   await p.locator('.nav-btn[data-view="view-cards"]').click();
   const view=p.locator('#view-cards'),open=view.getByRole('button',{name:'+ Ссылка клиенту',exact:true}),sheet=p.locator('#shareLinkOverlay'),close=sheet.locator('.sheet-close'),submit=sheet.getByRole('button',{name:'Создать ссылку'}),result=sheet.locator('#sl-result'),links=()=>p.evaluate(()=>__db.share_links);
   let steps='Каталог → + Ссылка клиенту',existing=0;
   if(mode==='fresh'||mode==='edit'){
    await open.click();await p.locator('#sl-name').fill('Ранее выданная');await p.locator('#sl-filter').selectOption('3');await p.locator('#sl-expires').selectOption('0');await submit.click();await result.waitFor();existing=1;
    if(mode==='fresh')await close.click();steps+=' → выдать бессрочную ссылку 3+ → '+(mode==='fresh'?'закрыть и открыть заново':'изменить условия');
   }
   const t=performance.now();
   if(mode!=='edit')await open.click();await sheet.waitFor();await frames(p);
   const openMs=Math.round(performance.now()-t);
   if(mode==='fresh'){assert.equal(await p.locator('#sl-expires').inputValue(),'14','Новая ссылка наследует прежний бессрочный доступ');assert.equal(await p.locator('#sl-filter').inputValue(),'all','Унаследован фильтр 3+');}
   await p.locator('#sl-name').fill(mode==='blank'?'   ':goal);await p.locator('#sl-filter').selectOption(filter);await p.locator('#sl-expires').selectOption(days);
   if(mode==='edit')assert.equal(await result.isVisible(),false,'Ссылка на старую подборку осталась рядом с новыми условиями');
   const box=await sheet.locator('.sheet').boundingBox();assert.ok(box.width<=390&&box.x>=0);
   if(mode==='retry')await p.evaluate(()=>__fail={table:'share_links',op:'insert'});
   steps+=' → этажность '+filter+' → '+(days==='0'?'бессрочно':days+' дней');
   const t2=performance.now();
   if(mode==='cancel'){await close.click();await sheet.waitFor({state:'hidden'});steps+=' → закрыть';}
   else{
    if(mode==='twice')await submit.dblclick();else await submit.click();
    if(mode==='retry'){
     await p.locator('#toast').filter({hasText:/Ошибка создания/}).waitFor();assert.equal((await links()).length,0);
     assert.equal(await p.locator('#sl-name').inputValue(),goal);await p.evaluate(()=>__fail=null);await submit.click();steps+=' → отказ → повторить';
    }
    await result.waitFor();steps+=' → создать и открыть локальную клиентскую страницу';
   }
   await frames(p);const ms=Math.round(performance.now()-t2);
   const db=await links();assert.equal(db.length,existing+Number(mode!=='cancel'),goal);
   let outcome='Нет новой ссылки; карточки и прежние выдачи сохранены.';
   if(mode!=='cancel'){
    const row=db.at(-1),url=await p.locator('#sl-url').inputValue();
    assert.equal(row.label,mode==='blank'?'Ссылка':goal);assert.equal(row.floors_filter,filter);assert.equal(row.project_id,null);
    assert.ok(url.endsWith('catalog.html?t='+row.token));if(Number(days))assert.ok(Math.abs(Date.parse(row.expires_at)-Date.parse(row.created_at)-86400000*Number(days))<2000);else assert.equal(row.expires_at,null);
    if(existing){assert.equal(db[0].floors_filter,'3');assert.equal(db[0].expires_at,null);}
    const fits=await result.evaluate(el=>[...el.querySelectorAll('button,input')].every(c=>{
      const r=c.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.width>=44;
    }));
    assert.ok(fits,'Адрес и кнопка копирования должны помещаться в окно');
    if(mode==='copy'){
     await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
     await sheet.getByRole('button',{name:'Копировать'}).click();
     assert.equal(await p.locator('#sl-url').evaluate(e=>e.value.slice(e.selectionStart,e.selectionEnd)),url);
     assert.ok(await p.locator('#toast').filter({hasText:/Скопируйте его вручную/}).isVisible());steps+=' → Копировать → проверить выделенный адрес';
    }
    if(process.env.CLIENT_LINK_SHOT&&mode==='two')await sheet.locator('.sheet').screenshot({path:process.env.CLIENT_LINK_SHOT});
    await close.click();await view.locator('#cards-links-list').getByText(row.label,{exact:true}).waitFor();
    if(mode==='revoke'){
     p.once('dialog',d=>d.accept());await view.locator('#cards-links-list').getByRole('button',{name:'✕'}).click();await p.waitForFunction(()=>!!__db.share_links[0].deleted_at);steps+=' → деактивировать и повторно открыть';
    }
    const shared=await ctx.newPage();
    try{
     await shared.addInitScript(records=>{window.__db.share_links=records},await links());
     if(mode==='expiry'||mode==='noexpiry')await shared.clock.setFixedTime(new Date(Date.parse(row.created_at)+(mode==='expiry'?3:366)*86400000));
     await shared.goto(url);
     const feed=shared.locator('#catFeed');
     if(mode==='revoke'||mode==='expiry'){await feed.getByText(mode==='expiry'?/срок действия этой ссылки истёк/i:/ссылка недействительна/i).waitFor();assert.equal(await feed.locator('.card').count(),0);outcome='Клиентская страница показывает причину, карточек 0.';}
     else{
      const expected=seed.filter(c=>!c.deleted_at&&(filter==='all'||(filter==='3'?c.floors>=3:c.floors===Number(filter)))).map(c=>c.title).sort();
      if(expected.length)await feed.locator('.project-title').first().waitFor();else await feed.getByText(/Нет карточек/).waitFor();
      assert.deepEqual((await feed.locator('.project-title').allInnerTexts()).sort(),expected);
      outcome='Подборка по готовой ссылке: '+(expected.join(', ')||'пустая')+'. Действующих ссылок '+db.length+'.';
     }
    }finally{await shared.close();}
   }
   assert.deepEqual(await p.evaluate(()=>__db.project_cards),seed);assert.deepEqual(errors,[]);
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   report.push(['UI-0050',sha,goal,steps,outcome,openMs,ms,'Форма на 390 px; '+(mode==='retry'?'данные доступны для повторной отправки':mode==='cancel'?'закрытие возвращает в каталог':mode==='fresh'?'восстановлены срок и этажность по умолчанию':'после выдачи адрес виден в поле для копирования'),browser.version()+' / '+new Date().toISOString(),'PASS']);
   console.log('PASS',mode,ms);
  }finally{await ctx.close();}
 }}finally{await browser.close();}
 if(process.env.CLIENT_LINK_CSV)fs.writeFileSync(process.env.CLIENT_LINK_CSV,'\ufeff'+report.map(r=>r.map(quote).join(',')).join('\n')+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
