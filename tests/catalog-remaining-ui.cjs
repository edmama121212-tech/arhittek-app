const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const mode=process.argv[2];
  const context=await browser.newContext({viewport:{width:['editor','preview','facade'].includes(mode)?1280:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await context.addInitScript({path:path.join(__dirname,'mock.js')});
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.pathname.includes('/legacy/build/pdf.min.mjs') && (mode==='import'||mode==='draft')){
    return new Promise(resolve=>context.once('close',resolve));
   }
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
  async function check(id,locator,steps,act,verify){
   await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox(),t=performance.now();
   let ok=true,reason;
   try {await act(locator);await verify();}catch(e){ok=false;reason=e.message;}
   const ms=Math.round(performance.now()-t);const width=Math.round(box.width),viewport=page.viewportSize().width;
   console.log(JSON.stringify({id,build,time:new Date().toISOString(),browser:browser.version(),steps,ms,width,viewport,ok,reason}));
   assert.ok(ok,reason);
  }
  const click=f=>f.click(),add=page.locator('#cards-admin-bar button[onclick="openCardEditor(null)"]');
  const css=s=>page.locator(s),wait=s=>css(s).waitFor();
  await page.evaluate(()=>{
    __db.project_cards=[1,2].map(n=>({id:'house'+n,project_number:'9900'+n,title:'Учебный дом '+n,total_area:100+n,floors:n,category:'Частный дом',created_at:'2026-01-0'+n}));
  });
  await page.locator('.nav-btn[data-view="view-cards"]').click();
  if(mode==='draft'||mode==='import'){
   const {jsPDF}=require('jspdf');const doc=new jsPDF();doc.text('Synthetic QA',10,10);
   const file={name:'album.pdf',mimeType:'application/pdf',buffer:Buffer.from(doc.output('arraybuffer'))};
   const draft=mode==='draft';if(draft){await add.click();await css('#ce-title').fill('Учебный черновик');}
   const el=draft?page.getByRole('button',{name:'Заполнить из PDF'}):css('#cards-pdf-button');
   let picker;
   await check(draft?15:51,el,'Каталог → '+(draft?'новый проект → название → выбрать PDF':'Заполнить карточку из PDF'),async f=>{
    [picker]=await Promise.all([page.waitForEvent('filechooser'),f.click()]);
    if(draft)await picker.setFiles(file);
   },async()=>{
    assert.equal(await picker.element().getAttribute('id'),'catalog-pdf-file');
    if(draft){await page.waitForTimeout(75);assert.equal(await css('#ce-title').inputValue(),'Учебный черновик');assert.match(await css('#toast').innerText(),/сохраните|закройте/i);}
   });
   if(!draft){
    await check(52,el,'Выбрать синтетический PDF-альбом в открытом диалоге',()=>picker.setFiles(file),async()=>{await wait('#ce-pdf-cancel');assert.ok(await css('#ce-save-btn').isDisabled());});
    await check(16,css('#ce-pdf-cancel'),'Импорт → Отменить импорт',click,async()=>{assert.ok(await css('#ce-pdf-cancel').isHidden());assert.ok(await css('#ce-save-btn').isEnabled());assert.equal(await page.evaluate(()=>__db.project_cards.length),2);});
   }
  }
  if(mode==='viewer'){
   const cards=css('#cards-list .card');await cards.first().click();const counter=css('#cardViewerCounter');
   const initial=await page.evaluate(()=>cardViewerList[0].project_number);
   await check(69,css('#cardViewerNext'),'Первая карточка → Следующий',click,async()=>{assert.match(await counter.innerText(),/2 \/ 2/);assert.ok(await css('#cardViewerNext').isHidden());assert.notEqual(await page.evaluate(()=>cardViewerList[cardViewerIndex].project_number),initial);});
   await check(68,css('#cardViewerPrev'),'Вторая карточка → Предыдущий',click,async()=>{assert.match(await counter.innerText(),/1 \/ 2/);assert.ok(await css('#cardViewerPrev').isHidden());assert.equal(await page.evaluate(()=>cardViewerList[cardViewerIndex].project_number),initial);});
   let pdf;
   await check(66,css('#cardViewerPdfBtn'),'Карточка владельца → Скачать PDF',async f=>{[pdf]=await Promise.all([page.waitForEvent('download',{timeout:6000}),f.click()]);},async()=>{assert.ok(pdf.suggestedFilename().includes(initial));const text=require('node:child_process').execFileSync('pdftotext',[await pdf.path(),'-'],{encoding:'utf8'});assert.ok(text.includes(initial));});
   await css('#cardViewerEditBtn').click();
   await check(38,page.getByRole('button',{name:'Удалить проект',exact:true}).filter({visible:true}),'Карточка владельца → Редактировать → Удалить проект → подтвердить',click,async()=>{await page.waitForFunction(()=>__db.project_cards.filter(c=>c.deleted_at).length===1);assert.equal(await cards.count(),1);const removed=await page.evaluate(()=>__db.project_cards.find(c=>c.deleted_at).project_number);assert.equal(removed,initial);});
  }
  if(mode==='editor'){
   await add.click();
   for(const [i,id] of [[0,35],[1,36]]){
    const preview=i?'#ce-facade2-preview':'#ce-facade-preview',input=css('input[onchange*="'+preview.slice(1)+'"]');
    const pixel=await page.evaluate(color=>{const c=document.createElement('canvas');c.width=c.height=100;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,100,100);return c.toDataURL('image/png').split(',')[1];},i?'blue':'red');
    await check(id,input,'Новая карточка → загрузить '+(i?'второй':'первый')+' фасад PNG',f=>f.setInputFiles({name:'facade-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(pixel,'base64')}),async()=>{await wait(preview);assert.ok(await page.evaluate(i=>ceImages[i].startsWith('data:image/jpeg')&&ceThumbs[i].startsWith('data:image/jpeg'),i));if(i)assert.ok(await page.evaluate(()=>ceImages[0]!==ceImages[1]));});
   }
   await check(17,page.getByRole('button',{name:/Сканировать и вставить/}),'Редактор → Сканировать и вставить',click,async()=>{await wait('#ce-shot-panel');assert.ok(await css('#ce-shot-drop').evaluate(e=>e===document.activeElement));});
  }
  if(mode==='preview'||mode==='facade'){
   await add.click();await css('#ce-title').fill('Учебный предпросмотр');
   if(mode==='preview')await check(18,page.getByRole('button',{name:/Перепроверить карточку/}),'Ручной черновик → Перепроверить карточку',click,async()=>{await wait('#ce-quality-status');assert.match(await css('#ce-quality-status').innerText(),/геометрии доступна для планов из PDF/i);assert.equal(await page.evaluate(()=>__db.project_cards.length),2);});
   await css('#prev-tab-floor1').click();
   await check(39,css('#prev-tabs > div').first(),'Предпросмотр → план → Фасад клавишей Enter',async e=>{await e.focus();await page.keyboard.press('Enter');},async()=>{assert.ok(await css('#prev-facade').isVisible());assert.ok(await css('#prev-floor1').isHidden());});
  }
  if(mode==='contacts'){
   const publicPage=await context.newPage();await publicPage.goto('https://app.test/catalog.html');
   // Capture protocol activation locally, before a telephone handler can be launched.
   await publicPage.evaluate(()=>{document.querySelector('a[href^="tel:"]').addEventListener('click',e=>{e.preventDefault();window.qaTel=e.currentTarget.href;});});
   for(const [id,selector] of [[11,'#catalogContact'],[12,'a[href^="tel:"]'],[13,'a[href="https://arhittek.ru"]']]){
    let url;
    await check(id,publicPage.locator(selector),'Подвал каталога → '+({11:'WhatsApp',12:'Позвонить',13:'arhittek.ru'}[id]),async f=>{
     if(id===12){await f.click();url=await publicPage.evaluate(()=>qaTel);}else{const [tab]=await Promise.all([publicPage.waitForEvent('popup'),f.click()]);await tab.waitForLoadState();url=tab.url();await tab.close();}
    },async()=>assert.match(url,({11:/^https:\/\/wa.me\/79226593872/,12:/^tel:\+79226593872$/,13:/^https:\/\/arhittek.ru\/$/}[id])));
   }
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
