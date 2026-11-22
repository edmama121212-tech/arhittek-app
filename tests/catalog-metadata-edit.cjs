'use strict';
// Isolated browser regression: old PDF metadata may be incomplete, but
// changing roof/style/descriptive text must never rewrite plans.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const original={
 id:'legacy-15726',project_number:'15726',title:'Проект №15726 — Двухэтажный дом',
 floors:2,total_area:'482,51',floor1_area:'240,00',floor2_area:'242,51',
 footprint:'20 X 16,1',beds:5,baths:3,price:'38601',
 tags:['Красный кирпич','Ленточный фундамент','Классический','Плоская кровля'],
 expl1:[{name:'Спальня',area:'240,00'}],expl2:[{name:'Спальня',area:'242,51'}],expl3:[],expl_basement:[],
 images:['https://images.test/facade.jpg',null,'https://images.test/plan1.jpg','https://images.test/plan2.jpg',null,null],
 thumbnails:['https://images.test/thumb.jpg',null,'https://images.test/th1.jpg','https://images.test/th2.jpg',null,null],
 pdf_import_meta:{version:1,sources:{plans:{}}},created_at:'2026-01-01T10:00:00Z'
};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1360,height:900},serviceWorkers:'block'});
  const init=fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+'\nwindow.__db.project_cards=['+JSON.stringify(original)+'];\n';
  await ctx.addInitScript({content:init});
  await ctx.route('**/*',route=>{
   const u=new URL(route.request().url());
   const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(u.hostname==='app.test'&&fs.existsSync(f))return route.fulfill({path:f,contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'text/javascript'});
   return route.fulfill({body:'',contentType:'text/javascript'});
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://app.test/');
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
  await page.evaluate(async()=>{await loadCards();openCardEditor('legacy-15726')});
  const save=page.locator('#ce-save-btn'),overlay=page.locator('#cardEditorOverlay');
  assert.equal(await page.locator('#feature-btn-flat').getAttribute('aria-pressed'),'true');
  assert.equal((await page.locator('#ce-tags').inputValue()).includes('Плоская кровля'),false,'System tags belong to switches');
  await page.locator('#feature-btn-flat').click();
  assert.equal((await page.locator('#prev-tags').innerText()).includes('Плоская кровля'),false,'Flat roof disappears from preview');
  assert.deepEqual(await page.evaluate(()=>{const q=CatalogQuality.checkEditor();return [q.scope,q.passed]}),['metadata-card',true]);
  await save.click();await overlay.waitFor({state:'hidden'});
  const after=await page.evaluate(()=>__db.project_cards.find(c=>c.id==='legacy-15726'));
  assert(!after.tags.includes('Плоская кровля'),'Wrong roof label removed');
  assert(after.tags.includes('Классический'),'Style retained');
  for(const field of ['images','thumbnails','pdf_import_meta','expl1','expl2','floor1_area','floor2_area','total_area','footprint']){
   assert.deepEqual(after[field],original[field],field+' must not be overwritten');
  }
  const update=await page.evaluate(()=>__writes.filter(w=>w.table==='project_cards'&&w.op==='update').at(-1)?.val);
  assert.deepEqual(Object.keys(update).sort(),['price','tags','title','updated_at'],'Metadata-only writes must be narrow');
  await page.evaluate(()=>openCardEditor('legacy-15726'));
  await page.locator('#ce-expl1').fill('Спальня: 999');
  assert.deepEqual(await page.evaluate(()=>{const q=CatalogQuality.checkEditor();return [q.scope,q.passed]}),['pdf-card',false],'Plan change still requires PDF review');
  await save.click();assert(await overlay.isVisible(),'Plan change rejected');
  const unchanged=await page.evaluate(()=>__db.project_cards.find(c=>c.id==='legacy-15726'));
  assert.equal(unchanged.floor1_area,original.floor1_area);
  await page.evaluate(()=>openCardEditor('legacy-15726'));
  await page.locator('#ce-price').fill('-1');
  assert.deepEqual(await page.evaluate(()=>{const q=CatalogQuality.checkEditor();return [q.scope,q.passed]}),['metadata-card',false],'Negative price rejected');
  await save.click();assert(await overlay.isVisible(),'Invalid price must not save');
  assert.equal(await page.evaluate(()=>__db.project_cards.find(c=>c.id==='legacy-15726').price),'38601');
  assert(fs.readFileSync(path.join(root,'catalog.html'),'utf8').includes('Возможны правки'));
  assert(!fs.readFileSync(path.join(root,'catalog.html'),'utf8').includes('До 3 правок — включены'));
  assert.equal(errors.length,0,'Browser should have no page errors: '+errors.join('; '));
  console.log(JSON.stringify({catalogMetadataSave:'passed',checks:18}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});