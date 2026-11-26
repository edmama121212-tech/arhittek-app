const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {PGlite} = require('@electric-sql/pglite');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'..');
const assets = new Set(['catalog.html','catalog-floors.js','data-access.js','catalog-floors.css','client.css']);
const cards = [
  {id:'legacy-house',project_number:'91526',floors:4,title:'Учебный дом с мастерской',price:'33776',total_area:'482,51',tags:' МАНСАРДА ,Газоблок',category:'Частный дом'},
  {id:'other',project_number:'92326',floors:2,title:'Учебный двухэтажный дом',price:'17500',total_area:'301',category:'Частный дом'}
];
(async()=>{
  const db=new PGlite();
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
  try{
    await db.exec(`
      create role anon;create role authenticated;
      create table kp_catalog(id uuid primary key,group_name text,name text,unit text,rate numeric,sort_order integer,deleted_at timestamptz);
      create table catalog_pricing(id integer primary key);
      create table project_cards(id text primary key,project_number text,floors integer,title text,price text,total_area text,tags text,created_at timestamptz,deleted_at timestamptz,pdf_import_meta jsonb);
      create table share_links(id text primary key,token text,project_id text,floors_filter text,expires_at timestamptz,deleted_at timestamptz);
      insert into catalog_pricing values(1);
      insert into kp_catalog values('00000000-0000-0000-0000-000000000450','Архитектурное проектирование','Архитектурное решение','м²',450,1,null);
    `);
    for(const c of cards) await db.query('insert into project_cards(id,project_number,floors,title,price,total_area,tags) values($1,$2,$3,$4,$5,$6,$7)',[c.id,c.project_number,c.floors,c.title,c.price,c.total_area,c.tags||'']);
    await db.exec(fs.readFileSync(path.join(root,'supabase/instagram-catalog-token-gateway.sql'),'utf8'));
    const size={width:390,height:844};
    const staff=await browser.newContext({viewport:size,serviceWorkers:'block'});
    await staff.addInitScript({path:path.join(__dirname,'mock.js')});
    await staff.route('**/*',async route=>{
      const url=new URL(route.request().url()),file=path.join(root,url.pathname==='/'?'index.html':url.pathname);
      if(url.hostname==='app.test'&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});
      return route.fulfill({body:''});
    });
    const page=await staff.newPage();
    await page.goto('https://app.test');
    await page.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);
    await page.evaluate(rows=>{__db.project_cards=rows;},cards);
    await page.locator('.nav-btn[data-view="view-cards"]').click();
    await page.locator('#view-cards [data-floors="3"]').click();
    const result=page.locator('#cards-list .card');assert.equal(await result.count(),1);assert.match(await result.innerText(),/91526/);
    await page.locator('#cards-admin-bar button[onclick="createShareLink()"]').click();
    await page.locator('#sl-filter').selectOption('3');await page.locator('#sl-expires').selectOption('2');
    const start=performance.now();await page.locator('#sl-create').click();await page.locator('#sl-result').waitFor();
    const url=await page.locator('#sl-url').inputValue();const issued=Math.round(performance.now()-start);
    const l=await page.evaluate(()=>__db.share_links.at(-1));
    assert.equal(l.floors_filter,'3');assert.ok(Math.abs(Date.parse(l.expires_at)-Date.parse(l.created_at)-172800000)<50);
    await db.query('insert into share_links(id,token,project_id,floors_filter,expires_at) values($1,$2,$3,$4,$5)',[l.id,l.token,l.project_id,l.floors_filter,l.expires_at]);
    const publicPage=await browser.newPage({viewport:size,serviceWorkers:'block'});
    await publicPage.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>({rpc:async(name,args)=>({data:await fetch('/fixture',{method:'POST',body:JSON.stringify(args)}).then(r=>r.json())}),from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})})}`});
      if(u.hostname!=='app.test')return route.abort();
      if(u.pathname==='/fixture'){
        const args=route.request().postDataJSON();
        const {rows}=await db.query('select public.get_public_catalog($1,$2) as result',[args.p_token,!!args.p_prices_only]);
        return route.fulfill({json:rows[0].result});
      }
      if(assets.has(u.pathname.slice(1)))return route.fulfill({path:path.join(root,u.pathname.slice(1))});
      return route.abort();
    });
    const opened=performance.now();await publicPage.goto(url);
    const card=publicPage.locator('#catFeed .card');
    await card.locator('.catalog-prices s').waitFor({timeout:5000});
    const openMs=Math.round(performance.now()-opened);
    assert.equal(await card.count(),1);assert.equal(await card.getAttribute('data-id'),'legacy-house');
    assert.equal(await card.locator('.project-title').innerText(),cards[0].title);
    assert.match(await card.locator('.header-badge').innerText(),/4 этажа/i);
    assert.ok((await card.locator('.tag').allTextContents()).includes('Мансарда'));
    assert.equal((await card.locator('.price').innerText()).replace(/\s/g,''),'34000₽');
    assert.equal((await card.locator('.catalog-prices s').innerText()).replace(/\s/g,''),'217000₽');
    assert.equal(await card.locator('.stat-area').innerText(),'482,51');
    const fits=await card.locator('.catalog-prices').evaluate(el=>{const rect=el.getBoundingClientRect();return rect.x>=0&&rect.right<=innerWidth+1&&el.scrollWidth<=el.clientWidth+1;});assert.ok(fits);
    const hashes=['index.html','catalog.html','catalog-floors.js'].map(file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex').slice(0,16));
    console.log(JSON.stringify({hashes,time:new Date().toISOString(),browser:browser.version(),issued,openMs}));
  }finally{await browser.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
