// All database rows, uploads and browser requests in this suite are isolated.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),results=[];
const eq=(actual,expected,name)=>{assert.deepEqual(actual,expected,name);results.push(name)};
(async()=>{
 const db=new PGlite();await db.waitReady;
 await db.exec(`create table public.project_cards(id text primary key,title text,project_number text,floors integer,total_area text,floor1_area text,floor2_area text,expl1 jsonb,expl2 jsonb,images jsonb,thumbnails jsonb,tags jsonb);
 alter table public.project_cards enable row level security;
 create policy original_policy on public.project_cards for select using(false);
 insert into public.project_cards values('legacy','Existing','00157-A',2,'150','80','70','[{"name":"Kitchen","area":"20"}]','[]','["a","b","p1","p2"]','[]','[]');`);
 const old=(await db.query('select to_jsonb(c) as row from public.project_cards c')).rows[0].row;
 const policies=(await db.query("select policyname,qual,cmd from pg_policies where tablename='project_cards'")).rows;
 const migration=fs.readFileSync(path.join(root,'supabase/catalog-floors.sql'),'utf8');
 await db.exec(migration);await db.exec(migration);
 const migrated=(await db.query('select to_jsonb(c) as row from public.project_cards c')).rows[0].row;
 const additions=['floor3_area','basement_area','expl3','expl_basement'];
 eq(Object.fromEntries(Object.entries(migrated).filter(([k])=>!additions.includes(k))),old,'Migration preserves all existing values');
 eq([migrated.floor3_area,migrated.basement_area,migrated.expl3,migrated.expl_basement],[null,null,[],[]],'Empty new levels do not fabricate old data');
 eq((await db.query("select policyname,qual,cmd from pg_policies where tablename='project_cards'")).rows,policies,'Migration preserves access policies');
 await db.query("update public.project_cards set floor3_area='45,25',basement_area='60',expl3=$1::jsonb,expl_basement=$2::jsonb where id='legacy'",[JSON.stringify([{name:'Bedroom',area:'45,25'}]),JSON.stringify([{name:'Storage',area:'60'}])]);
 eq((await db.query("select floor3_area,basement_area,expl3->0->>'name' as third,expl_basement->0->>'name' as basement from public.project_cards where id='legacy'")).rows[0],{floor3_area:'45,25',basement_area:'60',third:'Bedroom',basement:'Storage'},'Postgres stores each new level separately');
 await db.close();
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await context.addInitScript({content:'if(window===window.top){\n'+fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+'\nconst stored=localStorage.getItem("catalog-floor-test");if(stored)__db.project_cards=[JSON.parse(stored)];\n}'});
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='app.test'){
   const file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(fs.existsSync(file))return route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':undefined});
  }
  if(route.request().resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect x="40" y="40" width="520" height="320" fill="#e8edf4" stroke="#3d8fe0" stroke-width="8"/><text x="80" y="100" font-size="25">TEST PLAN</text></svg>'});
  for(const [key,file]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))return route.fulfill({path:path.join(root,'node_modules',file),contentType:'text/javascript'});
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function fresh(){await page.goto('https://app.test/');await page.waitForFunction(()=>typeof isOwner==='function'&&isOwner()&&state.financialDataReady);await page.evaluate(()=>{sb.functions={invoke:async()=>({data:{ok:true},error:null})}});}
 await fresh();
 for(const floors of [1,2,3])for(const basement of [false,true]){
  const actual=await page.evaluate(({floors,basement})=>{
   openCardEditor();selectFloors(floors);if(basement)toggleFeature('basement');
   const sections=[...document.querySelectorAll('.ce-floor-section')].filter(e=>e.style.display!=='none').map(e=>e.id);
   const tabs=[...document.querySelectorAll('#prev-tabs>div')].filter(e=>e.style.display!=='none').map(e=>e.textContent.trim());
   return {sections,tabs,floors:ceFloorsSelected};
  },{floors,basement});
  eq(actual,{sections:[...(basement?['ce-section-basement']:[]),...Array.from({length:floors},(_,i)=>'ce-section-floor'+(i+1))],tabs:['Фасад',...(basement?['Цоколь']:[]),...Array.from({length:floors},(_,i)=>(i+1)+'-й этаж')],floors},`Editor has ${floors} floors, basement ${basement}`);
 }
 const saved=await page.evaluate(async()=>{
  openCardEditor();selectFloors(3);toggleFeature('basement');
  setVal('ce-num','00157-A');setVal('ce-title','Тестовый дом');setVal('ce-area','215,50');setVal('ce-price','77777');
  for(const [suffix,area,name]of[['1','80','Кухня'],['2','70','Спальня'],['3','45,25','Кабинет'],['b','60','Кладовая']]){setVal('ce-area'+suffix,area);setVal('ce-expl'+suffix,`${name}: ${area}`);}
  ceImages=['facade1','facade2','plan1','plan2','plan3','basement'].map(x=>'https://images.test/'+x+'.jpg');ceThumbs=ceImages.slice();cePreview();
  await saveCard();const card=__db.project_cards.find(c=>c.project_number==='00157-A');localStorage.setItem('catalog-floor-test',JSON.stringify(card));return card;
 });
 assert(saved?.id,'New card persisted');results.push('Create succeeds');
 eq([saved.project_number,saved.floors,saved.price,saved.floor3_area,saved.basement_area],['00157-A',3,'77777','45,25','60'],'Project number, manual price and separate areas survive save');
 eq([saved.expl3,saved.expl_basement],[[{name:'Кабинет',area:'45,25'}],[{name:'Кладовая',area:'60'}]],'Separate new explications survive save');
 eq(saved.images.map(x=>x.split('/').pop()),['facade1.jpg','facade2.jpg','plan1.jpg','plan2.jpg','plan3.jpg','basement.jpg'],'Existing and new image slots are preserved');
 await fresh();await page.evaluate(async id=>{await loadCards();openCardEditor(id)},saved.id);
 eq(await page.evaluate(()=>[document.getElementById('ce-area3').value,document.getElementById('ce-areab').value,document.getElementById('ce-expl3').value,ceImages[5]]),['45,25','60','Кабинет: 45,25','https://images.test/basement.jpg'],'Full page reload restores all new fields');
 await page.locator('#prev-tab-floor3').click();
 eq(await page.locator('#prev-floor3 .expl-name').textContent(),'Кабинет','Third floor preview shows its own explication');
 await page.locator('#prev-tab-basement').click();
 eq(await page.locator('#prev-basement .expl-name').textContent(),'Кладовая','Basement preview shows its own explication');
 await page.evaluate(()=>{selectFloors(1);toggleFeature('basement');});
 eq(await page.locator('#prev-tags').innerText().then(text=>text.includes('Цокольный этаж')),false,'Disabling basement also removes its preview tag');
 await page.evaluate(async()=>{await saveCard();localStorage.setItem('catalog-floor-test',JSON.stringify(__db.project_cards[0]));});
 await fresh();await page.evaluate(async id=>{await loadCards();openCardEditor(id)},saved.id);
 eq(await page.evaluate(()=>[document.getElementById('ce-area3').value,document.getElementById('ce-explb').value,ceImages[4],ceFeatureSelected.includes('basement')]),['45,25','Кладовая: 60','https://images.test/plan3.jpg',false],'Hidden floor data survives save and reload without enabling it');
 eq(await page.evaluate(()=>CatalogFloors.active(cardsData[0]).map(f=>f.key)),['floor1'],'Hidden levels are absent from client output');
 await page.evaluate(()=>{selectFloors(3);toggleFeature('basement');});
 eq(await page.locator('#ce-area3').inputValue(),'45,25','Re-enabling restores the stored third floor');
 await page.evaluate(async()=>{__fail={table:'project_cards',op:'update'};setVal('ce-area3','46,50');await saveCard();__fail=null;});
 eq(await page.evaluate(()=>[document.getElementById('cardEditorOverlay').style.display,document.getElementById('ce-area3').value,document.getElementById('toast').textContent.includes('Ошибка')]),['flex','46,50',true],'Failed save keeps the editable floor draft');
 // Real image decoding into the two new slots, without touching the old plans.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0WQAAAAASUVORK5CYII=','base64');
 for(const [key,slot]of[['floor3',4],['basement',5]]){
  await page.locator('#ce-section-'+key+' .ce-floor-upload input').setInputFiles({name:key+'.png',mimeType:'image/png',buffer:png});
  await page.waitForFunction(slot=>ceImages[slot]?.startsWith('data:image/jpeg'),slot);
 }
 eq(await page.evaluate(()=>ceImages.slice(2,4)),saved.images.slice(2,4),'Uploading new level plans leaves old floor images intact');
 await page.evaluate(()=>{openCardEditor();});
 eq(await page.evaluate(()=>[ceImages,document.getElementById('ce-area3').value,document.getElementById('prev-planb-img').getAttribute('src')]),[Array(6).fill(null),'',null],'New card has no stale floor image or text');
 // Internal standalone viewer uses exactly the same level data.
 const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));
 const html=await page.evaluate(card=>buildCardHTML(card),saved);await viewer.setContent(html);
 eq(await viewer.locator('.tab').allTextContents(),['Фасад','Цоколь','1-й этаж','2-й этаж','3-й этаж'],'Internal viewer contains all four levels');
 await viewer.locator('.tab').getByText('3-й этаж',{exact:true}).click();
 eq(await viewer.locator('#floor3 .plan-img').getAttribute('src'),saved.images[4],'Internal third-floor tab uses third-floor plan');
 // Public catalog keeps each card's tabs independent, including filtered results.
 const catalog=await context.newPage();catalog.on('pageerror',e=>errors.push(e.message));await catalog.goto('https://app.test/catalog.html');
 await catalog.evaluate(card=>{allCards=[card,{...card,id:'other',floors:1,tags:[]}];renderFeed()},saved);
 await catalog.locator('.card').first().locator('.tab').getByText('Цоколь',{exact:true}).click();
 eq(await catalog.locator('#basement_0 .expl-name').textContent(),'Кладовая','Public basement tab renders its own table');
 eq(await catalog.locator('.card').nth(1).locator('.tab.active').textContent(),'Фасад','Public tab changes affect only the chosen card');
 await catalog.evaluate(()=>setFilter('3'));
 await catalog.locator('.tab').getByText('3-й этаж',{exact:true}).click();
 eq(await catalog.locator('#floor3_0 .plan-img').getAttribute('src'),saved.images[4],'Filtered public catalogue retains third-floor navigation');
 const screenshotDir=process.env.CATALOG_SCREENSHOTS;if(screenshotDir)fs.mkdirSync(screenshotDir,{recursive:true});
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});await page.evaluate(card=>{cardsData=[card];openCardEditor(card.id)},saved);
  eq(await page.locator('#cardEditorOverlay').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'Editor has no horizontal overflow at '+width);
  for(const surface of [viewer,catalog]){
   await surface.setViewportSize({width,height:844});
   eq(await surface.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Catalogue has no horizontal overflow at '+width);
  }
  if(screenshotDir){await catalog.screenshot({path:path.join(screenshotDir,`catalog-${width}.png`),fullPage:true});await page.screenshot({path:path.join(screenshotDir,`editor-${width}.png`)});}
 }
 const unsafe={...saved,expl3:[{name:'<img src=x onerror=alert(1)>',area:'" onerror="alert(2)'}],images:[...saved.images.slice(0,4),'x" onerror="alert(3)',saved.images[5]]};
 const safe=await page.evaluate(card=>{const el=document.createElement('div');el.innerHTML=buildCardHTML(card);return [el.querySelector('#floor3 img').getAttribute('onerror'),el.querySelectorAll('#floor3 .expl-name img').length]},unsafe);
 eq(safe,[null,0],'New plans and room text cannot inject HTML events');
 const legacy={id:'legacy',project_number:'001',title:'Old',floors:2,images:saved.images.slice(0,4),expl1:[{name:'Old kitchen',area:'20'}],expl2:[],tags:[]};
 eq(await page.evaluate(card=>{const el=document.createElement('div');el.innerHTML=buildCardHTML(card);return [[...el.querySelectorAll('.tab')].map(t=>t.textContent),el.querySelector('#floor2 img').getAttribute('src')]},legacy),[['Фасад','1-й этаж','2-й этаж'],saved.images[3]],'Legacy four-image cards keep original navigation and images');
 eq(errors,[],'No browser JavaScript errors');
 console.log(JSON.stringify({passed:results.length,total:results.length,failed:[]}));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
