const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {publish}=require('../scripts/publish-catalog-roof.cjs');

(async()=>{
 const db=new PGlite(), directory=await fs.mkdtemp(path.join(os.tmpdir(),'roof-verification-'));
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table project_cards(id uuid primary key, floors integer, total_area text, price text, images jsonb, thumbnails jsonb,
      updated_at timestamptz, deleted_at timestamptz, pdf_import_meta jsonb);`);
  const migration=await fs.readFile('supabase/migrations/20261120000100_catalog_roof.sql','utf8');
  await db.exec(migration);await db.exec(migration);
  const id='00000000-0000-4000-8000-111111111111';
  const digest=buf=>createHash('sha256').update(buf).digest('hex');
  const album=Buffer.from('%PDF-1.5\nTest album'),albumHash=digest(album);
  const main=Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAkAAAAcQ0f/+ByKi/wEA','base64');
  const thumb=Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAkAAAAdQwAIWsP+BiOh/AAA=','base64');
  await Promise.all([['reference.pdf',album],['plan.webp',main],['thumb.webp',thumb]].map(([name,bytes])=>fs.writeFile(path.join(directory,name),bytes)));
  const version='2026-11-17T00:00:00Z',original=['front','back','first','second',null,'basement'];
  await db.query("insert into project_cards values($1,2,'250','30000',$2,$2,$3,null,$4,null)",[id,JSON.stringify(original),version,JSON.stringify({sha256:albumHash})]);
  const read=async()=>(await db.query('select * from project_cards where id=$1',[id])).rows[0];
  const attach=async args=>(await db.query('select publish_catalog_roof($1,$2,$3::jsonb,$4::jsonb) result',[args.p_card,args.p_previous_updated_at,args.p_previous===null?null:JSON.stringify(args.p_previous),JSON.stringify(args.p_review)])).rows[0].result;
  const review={slot:'roof',page:7,revision:'generated-render-v2-gray',album_hash:albumHash,file_sha256:digest(main),
    thumbnail_file_sha256:digest(thumb),review_sha256:digest(main),overall_dimensions:{width_mm:15000,length_mm:17000,source:'test sheet 7',bounds:'west/east; north/south'},
    observations:['First geometry route','Second stair route','Third circulation route','Fourth furniture route','Fifth surface and thumbnail route']};
  const manifest={card_id:id,expected_updated_at:version,previous_plan:null,review,album_file:'reference.pdf',image_file:'plan.webp',thumbnail_file:'thumb.webp'};
  const objects=new Map(),api={upload:async(k,v)=>{if(!objects.has(k))objects.set(k,v)},readFile:async k=>objects.get(k),attach,readCard:read};
  await assert.rejects(publish(manifest,directory,{...api,readFile:async()=>thumb}),/different roof bytes/);
  assert.equal((await read()).catalog_roof_plan,null);
  await assert.rejects(publish({...manifest,expected_updated_at:'2000-01-01'},directory,api),/card changed/);
  await assert.rejects(publish({...manifest,review:{...review,album_hash:'0'.repeat(64)}},directory,api),/album changed/);
  await publish(manifest,directory,api);await publish(manifest,directory,api);
  const card=await read(), pointer=card.catalog_roof_plan;
  assert.equal(card.floors,2);assert.deepEqual(card.images,original);assert.deepEqual(card.thumbnails,original);
  assert.equal(card.price,'30000');assert.equal(card.total_area,'250');
  await db.query("update project_cards set images=$1,thumbnails=$1,pdf_import_meta=$2 where id=$3",[JSON.stringify(original),JSON.stringify({sha256:albumHash}),id]);
  assert.deepEqual((await read()).catalog_roof_plan,pointer);
  await assert.rejects(db.query("update project_cards set catalog_roof_plan='{}'"),/No verified roof/);
  const ctx=vm.createContext({SUPABASE_URL:'https://catalog.example',escapeHtml:x=>String(x??''),catalogProjectNumber:c=>c.project_number});vm.runInContext(await fs.readFile('catalog-floors.js','utf8'),ctx);const floors=ctx.CatalogFloors;
  assert.deepEqual(Array.from(floors.active(card),f=>f.key),['floor1','floor2']);
  assert.match(floors.tabs(card,'_3','showTab_3'),/roof_3/);
  assert.ok(floors.panels(card,'_3').includes(floors.roofPlan(card).image));
  assert.ok(floors.roofPlan(card).thumbnail.endsWith(digest(thumb)+'.webp'));
  assert.equal(floors.roofPlan({...card,pdf_import_meta:{sha256:'0'.repeat(64)}}),null);
  assert.doesNotMatch(floors.tabs({...card,catalog_roof_plan:null,tags:['Плоская кровля']}),/Кровля/);
  // Exercise the actual staff iframe HTML and the public per-card tab handler.
  const {JSDOM}=require('jsdom');
  const staffCode=await fs.readFile('src/features/catalog/ocr-and-card-document.js','utf8');
  vm.runInContext(staffCode.slice(staffCode.indexOf('function buildCardHTML(card)'),staffCode.lastIndexOf('loadAll();')),ctx);
  const staff=new JSDOM(ctx.buildCardHTML(card),{runScripts:'dangerously',url:'https://app.example/'});
  let tab=[...staff.window.document.querySelectorAll('.tab')].find(t=>t.textContent==='Кровля');
  tab.click();assert.ok(staff.window.document.querySelector('#roof.active img').src.endsWith(digest(main)+'.webp'));
  staff.window.close();
  const clientCode=await fs.readFile('catalog.html','utf8');
  const clientFunctions=clientCode.slice(clientCode.indexOf('function buildCardHTML(card, idx)'),clientCode.indexOf('// Generate showTab_N'));
  vm.runInContext(clientFunctions,ctx);
  const customer=new JSDOM(ctx.buildCardHTML(card,3),{runScripts:'dangerously',url:'https://app.example/'});
  const w=customer.window;w.eval(clientFunctions.slice(clientFunctions.indexOf('function makeShowTab')));
  w.showTab_3=w.makeShowTab(3);
  tab=[...w.document.querySelectorAll('.tab')].find(t=>t.textContent==='Кровля');tab.click();
  assert.ok(w.document.querySelector('#roof_3.active img').src.endsWith(digest(main)+'.webp'));
  assert.equal(w.document.querySelectorAll('.panel.active').length,1);
  assert.equal(w.document.querySelector('.header-badge').textContent,'2 этажа');w.close();
  await db.query("update project_cards set deleted_at=now() where id=$1",[id]);
  await assert.rejects(publish(manifest,directory,api),/album changed/);
  await db.query("update project_cards set deleted_at=null where id=$1",[id]);
  const edited=Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAkAAAAdQlZZWpf+BiOh/AAA=','base64');
  await fs.writeFile(path.join(directory,'plan.webp'),edited);
  const edit={...manifest,previous_plan:pointer,expected_updated_at:(await db.query('select updated_at::text dt from project_cards where id=$1',[id])).rows[0].dt,review:{...review,file_sha256:digest(edited),review_sha256:digest(edited)}};
  await publish(edit,directory,api);
  assert.equal((await db.query('select count(*)::int n from catalog_plan_work.roof_reviews')).rows[0].n,2);
  assert.deepEqual((await db.query('select prior_plan from catalog_plan_work.roof_reviews where image_sha256=$1',[digest(edited)])).rows[0].prior_plan,pointer);
  let calls=0;
  await assert.rejects(publish(edit,directory,{...api,readFile:async k=>(++calls===3?thumb:objects.get(k))}),/different roof bytes/);
  assert.equal((await db.query("select has_function_privilege('anon','public.publish_catalog_roof(uuid,timestamptz,jsonb,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
  const sqlBefore=await read();await db.query("update project_cards set pdf_import_meta=$1 where id=$2",[JSON.stringify({sha256:'0'.repeat(64)}),id]);assert.equal(floors.roofPlan(await read()),null);
  await assert.rejects(publish(edit,directory,api),/album changed/);
  assert.deepEqual((await read()).catalog_roof_plan,sqlBefore.catalog_roof_plan);
  console.log('Passed catalog roof review, source and pair SHA checks, readback, idempotency, archive, permissions, concurrency, previous editor and both catalog views.');
 } finally {await db.close();await fs.rm(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
