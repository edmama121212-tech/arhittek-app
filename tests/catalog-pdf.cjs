// Synthetic albums and isolated databases only. No real catalogue writes.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite'),{chromium}=require('playwright'),{jsPDF}=require('jspdf');
const core=require('../catalog-pdf-core'),root=path.resolve(__dirname,'..');
let passed=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);passed++};
function fixture({number='00157-A',floors=3,basement=true}={}){
 const pdf=new jsPDF({unit:'pt',format:[900,640],orientation:'landscape'});
 const legacy=s=>s.replace(/[А-Яа-яЁё№]/g,c=>c==='№'?'¹':c==='Ё'?'¨':c==='ё'?'¸':String.fromCharCode(c.charCodeAt(0)-0x410+0xc0));
 const text=(s,x,y,size=12)=>{pdf.setTextColor(0);pdf.setFontSize(size);pdf.text(legacy(s),x,y)};
 text('Проект №'+number,60,70,24);text(floors+'-х этажный жилой дом',60,110,18);
 text('Архитектурные решения. Газоблок. Ленточный фундамент. Общие сведения и состав проекта.',60,150);
 for(const label of [...Array.from({length:floors},(_,i)=>(i+1)+'-й этаж'),...(basement?['цокольный этаж']:[])]){
  pdf.addPage();text('План '+label,60,50,18);pdf.setDrawColor(30);pdf.setLineWidth(3);pdf.rect(70,100,420,420);pdf.line(280,100,280,520);pdf.line(70,310,490,310);
  text('Экспликация '+label,570,75);text('№',550,100);text('Наименование',580,100);text('Площадь',760,100);
  [['Спальня','20,00'],['С/У','5,00'],['Кухня гостиная','75,00']].forEach(([n,a],i)=>{const y=125+i*22;text(String(i+1),550,y);text(n,580,y);text(a,765,y)});
  text('Итого',580,191);text('100,00',765,191);text('Стены подвала — условное обозначение',550,250);
  text('Проект №'+number,590,590);text('План '+label,590,610);
 }
 // Bright facade illustrations exercise rendering and image selection.
 for(const color of [[60,120,170],[90,150,100]]){pdf.addPage();pdf.setFillColor(...color);pdf.rect(60,40,780,560,'F');pdf.setFillColor(230,220,200);pdf.rect(220,210,460,300,'F');}
 return Buffer.from(pdf.output('arraybuffer'));
}
async function sqlTests(){
 const db=new PGlite();await db.waitReady;
 try{
 await db.exec(`create role anon;create role authenticated;create table public.project_cards(
 id uuid primary key default gen_random_uuid(),project_number text,title text,floors integer,total_area text,footprint text,beds integer,baths integer,price text,tags jsonb,
 floor1_area text,floor2_area text,floor3_area text,basement_area text,expl1 jsonb,expl2 jsonb,expl3 jsonb,expl_basement jsonb,images jsonb,thumbnails jsonb,
 created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz);
 create function public.has_admin_session() returns boolean language sql as $$ select current_setting('test.owner',true)='yes' $$;
 alter table public.project_cards enable row level security;
 create policy read_cards on public.project_cards for select using(true);
 create policy owner_insert on public.project_cards for insert with check(public.has_admin_session());
 grant select,insert on public.project_cards to anon,authenticated;
 insert into public.project_cards(project_number,title)values('OLD','Original');`);
 const old=(await db.query('select to_jsonb(c) as row from public.project_cards c')).rows[0].row;
 const migration=fs.readFileSync(path.join(root,'supabase/catalog-pdf-import.sql'),'utf8');await db.exec(migration);await db.exec(migration);
 eq((await db.query("select to_jsonb(c)-'pdf_import_meta' as row from public.project_cards c")).rows[0].row,old,'Migration preserves catalogue');
 const card={project_number:'00157-A',title:'Test',floors:3,total_area:'400',tags:['Цокольный этаж'],images:Array(6).fill('https://images.test/image.jpg'),thumbnails:[],expl1:[],expl2:[],expl3:[],expl_basement:[],pdf_import_meta:{sha256:'a'.repeat(64),pages:7,sources:{},warnings:[],filename:'MUST NOT BE STORED'},id:'11111111-1111-1111-1111-111111111111',deleted_at:'2020-01-01'};
 const call=c=>db.query('select public.import_catalog_pdf($1::jsonb) as result',[JSON.stringify(c)]).then(r=>r.rows[0].result);
 await db.exec("set role anon;select set_config('test.owner','no',false)");
 await assert.rejects(call(card),/Нет доступа/);passed++;
 await db.exec("select set_config('test.owner','yes',false)");
 const created=await call(card);eq(created.created,true,'Owner creates import');assert.notEqual(created.id,card.id);passed++;
 const row=(await db.query('select * from public.project_cards where id=$1',[created.id])).rows[0];
 eq([row.project_number,row.deleted_at,row.pdf_import_meta.filename],['00157-A',null,undefined],'Number preserved; unapproved fields discarded');
 eq(await call(card),{id:created.id,created:false},'Retry returns existing card');
 eq(await call({...card,project_number:'00157-a',title:'Overwrite?',pdf_import_meta:{...card.pdf_import_meta,sha256:'b'.repeat(64)}}),{id:created.id,created:false},'Same number in another PDF cannot overwrite');
 eq(await call({...card,project_number:'different'}),{id:created.id,created:false},'Same PDF cannot create another number');
 eq((await db.query('select title from public.project_cards where id=$1',[created.id])).rows[0].title,'Test','Duplicate preserves old card');
 await assert.rejects(call({...card,project_number:''}),/Нужен номер/);passed++;
 await assert.rejects(call({...card,floors:4}),/этажность/);passed++;
 await assert.rejects(call({...card,pdf_import_meta:{sha256:'invalid'}}),/идентификатор/);passed++;
 await db.exec("reset role;update public.project_cards set deleted_at=now() where project_number='00157-A';set role anon;");
 eq((await call(card)).created,true,'Archived card does not block a new import');
 await db.exec('reset role;drop policy owner_insert on public.project_cards;set role anon;');
 await assert.rejects(call({...card,project_number:'new',pdf_import_meta:{sha256:'c'.repeat(64)}}),/row-level security/);passed++;
 }finally{await db.close()}
}
function coreTests(){
 const word=(text,x,y,w=text.length*6)=>({text,x0:x,x1:x+w,y0:y,y1:y+10});
 const p=()=>core.pageFromItems([
  word('Проект',30,20),word('№0008',80,20),word('Одноэтажный жилой дом',30,40),
  word('План',30,70),word('1-го',62,70),word('этажа',90,70),
  word('Экспликация',550,70),word('1-го',625,70),word('этажа',655,70),
  word('№',540,100),word('Наименование',570,100),word('Площадь',750,100),
  word('1',540,125),word('Спальня',570,125),word('20,00',750,125),
  word('2',540,150),word('С/У',570,150),word('5,00',750,150),
  word('Итого',570,175),word('25,00',750,175),word('Стены подвала',30,210),
  word('3-й этаж',30,400),word('4-й этаж',30,420)
 ],900,640,1,true);
 const good=core.analyze([p()]);eq([good.data.project_number,good.data.floors,good.data.total_area,good.data.beds,good.data.baths],['0008',1,'25,00',1,1],'OCR words combine into heading and table');
 eq(good.data.tags.includes('Цокольный этаж'),false,'Section labels and legends cannot fabricate levels');
 const mismatch=p();mismatch.items.find(w=>w.text==='25,00').text='30,00';assert(core.analyze([mismatch]).blocking.some(s=>s.includes('Не сходится')));passed++;
 const other=core.pageFromItems([word('Проект №0009',20,20)],900,640,2);assert(core.analyze([p(),other]).blocking.some(s=>s.includes('Номер проекта')));passed++;
 const upper=core.pageFromItems([word('План 2-го этажа',20,30)],900,640,2);assert(core.analyze([p(),upper]).blocking.some(s=>s.includes('не совпадает')));passed++;
 const missing=core.pageFromItems([word('Жилой дом',20,20)],900,640,1);assert(core.analyze([missing]).blocking.some(s=>s.includes('номер проекта')));passed++;
}
(async()=>{
 eq(core.repairText('Ïðîåêò ¹00157-A'),'Проект №00157-A','Archicad encoding repaired');
 coreTests();
 await sqlTests();
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.addInitScript({content:fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')});
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());let file;
  if(u.hostname==='app.test')file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
  if(u.href.includes('/pdfjs-dist@6.4.299/'))file=path.join(root,'node_modules/pdfjs-dist',u.pathname.split('/pdfjs-dist@6.4.299/')[1]);
  for(const [key,p]of[['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))file=path.join(root,'node_modules',p);
  if(file&&fs.existsSync(file))return route.fulfill({path:file,contentType:/\.m?js$/.test(file)?'text/javascript':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.wasm')?'application/wasm':'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'}});
  if(route.request().resourceType()==='image')return route.fulfill({body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',contentType:'image/svg+xml'});
  return route.fulfill({body:'',contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'}});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://app.test/');await page.waitForFunction(()=>typeof isOwner==='function'&&isOwner()&&state.financialDataReady);
 await page.evaluate(()=>{
  window.__imports=[];window.__syncs=0;
  const original=sb.rpc.bind(sb);sb.rpc=async(n,a)=>{
   if(n!=='import_catalog_pdf')return original(n,a);
   __imports.push(JSON.parse(JSON.stringify(a.p_card)));
   if(window.__importFailure)return {data:null,error:{message:'Simulated import failure'}};
   const rows=__db.project_cards||=[];const c=rows.find(c=>c.project_number===a.p_card.project_number||c.pdf_import_meta?.sha256===a.p_card.pdf_import_meta.sha256);
   if(c)return {data:{id:c.id,created:false},error:null};
   const row={...a.p_card,id:crypto.randomUUID()};rows.push(row);return {data:{id:row.id,created:true},error:null};
  };sb.functions={invoke:async()=>{__syncs++;return {data:{ok:true},error:null}}};
 });
 async function read(buffer,name='album.pdf'){
  await page.evaluate(()=>{let e=document.getElementById('test-pdf');if(!e){e=document.createElement('input');e.type='file';e.id='test-pdf';document.body.append(e)}});
  await page.locator('#test-pdf').setInputFiles(typeof buffer==='string'?buffer:{name,mimeType:'application/pdf',buffer});
  return page.evaluate(async()=>{
   const r=await CatalogPdfImport.read(document.getElementById('test-pdf').files[0]);window.__parsed=r;
   return {...r,images:r.images.map(x=>x?x.slice(0,23):null),thumbnails:[]};
  });
 }
 const album=fixture(),r=await read(album);
 eq([r.data.project_number,r.data.floors,r.data.total_area,r.data.beds,r.data.baths],['00157-A',3,'400,00',4,4],'Real PDF.js extracts number, 3 floors, basement and room counts');
 eq(r.blocking,[],'Complete album has no blockers');eq(r.images.every(Boolean),true,'Facade and all four floor image slots populated');
 eq(r.data.tags.includes('Цокольный этаж'),true,'Basement comes from its actual plan');
 eq(await page.evaluate(()=>{openCardEditor();CatalogPdfImport.apply(__parsed);return [ceFloorsSelected,ceFeatureSelected,document.getElementById('ce-area3').value,document.getElementById('ce-areab').value,document.getElementById('ce-price').value]}),[3,['basement'],'100,00','100,00','60000'],'Card apply uses level data and current catalogue rate');
 await page.locator('#catalog-pdf-file').setInputFiles({name:'album.pdf',mimeType:'application/pdf',buffer:album});
 await page.waitForFunction(()=>document.getElementById('cards-pdf-result').textContent.includes('Создан проект'),null,{timeout:60000});
 eq(await page.evaluate(()=>[__imports.length,__db.project_cards.length,__syncs,__db.project_cards[0].project_number]),[1,1,1,'00157-A'],'Upload alone creates and syncs one card');
 eq(await page.evaluate(()=>JSON.stringify(__imports).includes('data:image')),false,'Only hosted card images, not PDF bytes, reach the database');
 await page.locator('#catalog-pdf-file').setInputFiles({name:'renamed.pdf',mimeType:'application/pdf',buffer:album});
 await page.waitForFunction(()=>document.getElementById('cards-pdf-result').textContent.includes('уже есть'),null,{timeout:60000});
 eq(await page.evaluate(()=>[__db.project_cards.length,__syncs]),[1,1],'Repeated upload does not create or sync duplicate');
 const one=await read(fixture({number:'00002',floors:1,basement:false}));eq([one.data.floors,one.data.tags.includes('Цокольный этаж')],[1,false],'Legend alone cannot enable basement');
 await page.evaluate(()=>{openCardEditor();CatalogPdfImport.apply(__parsed);window.__importFailure=true;});
 const failed=await page.evaluate(()=>saveCard());eq(failed.ok,false,'Failed import reports failure');
 eq(await page.locator('#ce-num').inputValue(),'00002','Failed save preserves extracted draft');
 await page.evaluate(()=>{window.__importFailure=false;});eq((await page.evaluate(()=>saveCard())).ok,true,'Draft can retry saving');
 for(const width of [320,390]){await page.setViewportSize({width,height:844});await page.evaluate(()=>openCardEditor());eq(await page.locator('#cardEditorOverlay').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'No editor overflow at '+width)}
 // Cancellation while PDF.js is reading must not modify a subsequent draft.
 await page.locator('#catalog-pdf-file').setInputFiles({name:'cancel.pdf',mimeType:'application/pdf',buffer:album});
 await page.evaluate(()=>{CatalogPdfImport.cancel();openCardEditor();setVal('ce-num','KEEP');});
 await page.waitForFunction(()=>!CatalogPdfImport.busyReading());
 eq(await page.locator('#ce-num').inputValue(),'KEEP','Cancelled import cannot fill another editor');
 const invalid=await page.evaluate(async()=>{try{await CatalogPdfImport.read(new File(['not PDF'],'bad.pdf'));return ''}catch(e){return e.message}});assert.match(invalid,/Выберите PDF/);passed++;
 if(process.env.CATALOG_REAL_PDF_DIR){
  const out=process.env.CATALOG_SCREENSHOTS||path.resolve(root,'../pdf-import-validation');fs.mkdirSync(out,{recursive:true});
  for(const file of fs.readdirSync(process.env.CATALOG_REAL_PDF_DIR).filter(x=>x.endsWith('.pdf'))){
   const actual=await read(path.join(process.env.CATALOG_REAL_PDF_DIR,file));const id=actual.data.project_number;
   assert(['13225','15226'].includes(id));eq(actual.blocking,[],'Real album '+id+' imports');
   const expected=id==='13225'?[2,'490,14',5,3]:[1,'185,23',3,2];eq([actual.data.floors,actual.data.total_area,actual.data.beds,actual.data.baths],expected,'Real album '+id+' matches checked room tables');
   const images=await page.evaluate(()=>__parsed.images);
   images.forEach((s,i)=>{if(s)fs.writeFileSync(path.join(out,id+'-'+i+'.jpg'),Buffer.from(s.split(',')[1],'base64'))});
   fs.writeFileSync(path.join(out,id+'-summary.json'),JSON.stringify(actual,null,2));
   console.log('REAL_ALBUM',id,JSON.stringify({data:actual.data,sources:actual.sources,warnings:actual.warnings}));
  }
 }
 eq(errors,[],'No browser JavaScript errors');console.log(JSON.stringify({passed,failed:[]}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
