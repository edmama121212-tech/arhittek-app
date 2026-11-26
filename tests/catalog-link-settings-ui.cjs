const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.addInitScript({path:path.join(__dirname,'mock.js')});
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='app.test'){
    const file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
    if(fs.existsSync(file))return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':undefined});
   }
   for(const [key,file]of [['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
   return route.fulfill({body:'',contentType:'text/javascript'});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://app.test');await page.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
  page.setDefaultTimeout(4000);
  page.on('dialog',dialog=>dialog.accept());
  const build=require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
  const rows=[];
  async function action(id,dom,apply){
    const control=page.locator('#'+dom);await control.scrollIntoViewIfNeeded();
    const box=await control.boundingBox();
    const start=performance.now();await apply(control);
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.ok(box.width>0 && box.x>=0 && box.x+box.width<=391,dom);
    const row={id,dom,ms:Math.round(performance.now()-start),width:Math.round(box.width),build,time:new Date().toISOString(),browser:browser.version()};
    return row;
  }
  function record(row,result,steps,total=row.ms){rows.push({...row,result,steps,total});console.log(JSON.stringify(rows.at(-1)));}
  const click=control=>control.click();

  const begin=async()=>{
   await page.locator('.nav-btn[data-view="view-cards"]').click();
   await page.locator('#cards-admin-bar button[onclick="createShareLink()"]').click();
  };
  const generate=page.locator('#shareLinkOverlay button[onclick="generateShareLink()"]');
  if(process.argv.includes('--stale')){
   await begin();await generate.click();await page.locator('#sl-url').waitFor();
   const step=await action(44,'sl-filter',c=>c.selectOption('2'));
   const stale=await page.locator('#sl-url').isVisible()&&await page.locator('#sl-url').inputValue()!=='';
   step.failed=stale;
   record(step,stale?'После смены «Все карточки» на «Только 2-этажные» доступна прежняя ссылка на все этажи.':'После смены фильтра прежняя ссылка убрана. Нужно создать ссылку для нового фильтра.',
   'Каталог → Ссылка клиенту → создать для всех этажей → выбрать только 2-этажные → проверить прежний адрес');
   assert.ok(!stale,'Устаревшая ссылка доступна для копирования');return;
  }
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:'https://app.test'});
  await page.evaluate(()=>{__db.project_cards=[1,2].map(n=>({id:'house'+n,title:'Учебный дом '+n,floors:n,total_area:100,project_number:n,category:'Частный дом'}));});
  await begin();
  const name=await action(43,'sl-name',c=>c.fill('Учебная подборка'));
  await page.selectOption('#sl-filter','2');
  const expires=await action(45,'sl-expires',c=>c.selectOption('2'));
  const start=performance.now();await generate.click();await page.locator('#sl-result').waitFor();
  const ms=Math.round(performance.now()-start);
  const url=await page.inputValue('#sl-url');
  const data=await page.evaluate(()=>({links:__db.share_links,cards:__db.project_cards}));
  assert.equal(data.links.length,1);const link=data.links[0];
  assert.equal(link.label,'Учебная подборка');assert.equal(link.floors_filter,'2');
  assert.ok(Math.abs(Date.parse(link.expires_at)-Date.parse(link.created_at)-172800000)<50);
  assert.equal(new URL(url).searchParams.get('t'),link.token);
  const result=await action(47,'sl-url',c=>c.click());
  assert.ok(await page.locator('#sl-url').evaluate(e=>e.readOnly&&document.activeElement===e));
  const copyStart=performance.now();await page.locator('#sl-result button').click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),url);
  const copyMs=Math.round(performance.now()-copyStart);
  const publicPage=await context.newPage();await publicPage.addInitScript(data=>{__db.share_links=data.links;__db.project_cards=data.cards;},data);
  await publicPage.goto(url);await publicPage.locator('#catFeed').getByText('Учебный дом 2',{exact:true}).first().waitFor();
  assert.ok(!(await publicPage.locator('#catFeed').innerText()).includes('Учебный дом 1'));
  const steps='Каталог → Ссылка клиенту → Учебная подборка → 2 этажа → 2 дня → Создать → скопировать → открыть локальную ссылку';
  const outcome='Создана одна ссылка на 48 часов. В клиентской подборке виден только двухэтажный дом.';
  record(name,outcome+' Сохранено название подборки.',steps,ms);record(expires,outcome,steps,ms);
  const other=async(id,control,elapsed,message)=>{
   const width=await control.evaluate(e=>Math.round(e.getBoundingClientRect().width));
   record({id,ms:elapsed,build,time:new Date().toISOString(),browser:browser.version(),width},message,steps);
  };
  await other(46,generate,ms,outcome);record(result,'Адрес доступен для выбора в поле только для чтения. '+outcome,steps);
  await other(48,page.locator('#sl-result button'),copyMs,'В буфере обмена полный адрес выданной ссылки, по нему открывается нужная подборка.');
  const close=page.locator('#shareLinkOverlay .sheet-close'),width=await close.evaluate(e=>e.clientWidth);
  const end=performance.now();await close.click();await page.locator('#shareLinkOverlay').waitFor({state:'hidden'});
  record({id:42,ms:Math.round(performance.now()-end),build,width,time:new Date().toISOString(),browser:browser.version()},'Форма закрыта. Каталог сотрудников доступен.',steps+' → Закрыть');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
