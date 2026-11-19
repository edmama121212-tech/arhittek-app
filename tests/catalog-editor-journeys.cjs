'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const cases=[
 ['Одноэтажный',1,'99,99',1,1,'classic','flat'],
 ['Ровно сто',2,'100',2,1,'modern','basement'],
 ['Больше ста',3,'100,01',2,2,'modern','mansard'],
 ['Почти четыреста',2,'399,99',4,3,'classic','basement'],
 ['Ровно четыреста',3,'400',5,3,'classic','mansard'],
 ['Больше четырёхсот',1,'400,01',5,2,'modern','flat'],
 ['Студия',1,'42,50',0,1,'modern','flat'],
 ['С пробелами в названии',2,'170',3,2,'classic','basement'],
 ['Дом «А» & «Б»',3,'215,75',3,2,'classic','mansard'],
 ['Два одинаковых клика',1,'89,50',2,1,'modern','flat'],
];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
  await ctx.route('**/*',r=>{
   const u=new URL(r.request().url()),f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
   if(u.hostname==='app.test'&&fs.existsSync(f))return r.fulfill({path:f,contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'text/javascript'});
   return r.fulfill({body:''});
  });
  const p=await ctx.newPage();p.setDefaultTimeout(5000);
  await p.goto('https://app.test');await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
  await p.locator('.nav-btn[data-view="view-cards"]').click();
  const create=p.locator('#cards-admin-bar button[onclick="openCardEditor(null)"]'),save=p.locator('#ce-save-btn'),overlay=p.locator('#cardEditorOverlay');
  const fill=async(id,v)=>p.locator('#'+id).fill(String(v));
  const visible=async()=>{await overlay.waitFor();assert.equal(await p.locator('#ce-title').isEditable(),true);};
  const details=async number=>{
   await fill('cards-search',number);
   await p.locator('#cards-list .card').filter({hasText:number}).click();
   await p.locator('#cardViewerEditBtn').click();await visible();
  };
  let failures=0;
  for(const [i,[title,floors,area,beds,baths,style,feature]] of cases.entries()){
   const t=Date.now(),number=(810+i)+'26',tags='Газоблок, Тест '+i,footprint='10×'+(12+i),price=String(10001+i);
   try{
    await create.click();await visible();
    for(const [id,value] of Object.entries({'ce-num':number,'ce-title':title,'ce-area':area,'ce-footprint':footprint,'ce-beds':beds,'ce-baths':baths,'ce-price':price,'ce-tags':tags}))await fill(id,value);
    await p.locator('#floors-btn-'+floors).click();await p.locator('#style-btn-'+style).click();await p.locator('#feature-btn-'+feature).click();
    const floorArea=floors===1?area:'18,50';
    await fill('ce-area1',floorArea);await fill('ce-expl1','Гостиная: '+floorArea);
    await fill('ce-price',price);
    if(i===9){
     await p.evaluate(()=>{const from=sb.from.bind(sb);sb.from=table=>{const q=from(table);if(table==='project_cards'){const insert=q.insert.bind(q);q.insert=(...args)=>{const chain=insert(...args),single=chain.single.bind(chain);chain.single=async()=>{await new Promise(resolve=>setTimeout(resolve,400));return single();};return chain;};}return q;};});
     await save.dblclick({delay:10});
    }else await save.click();
    await overlay.waitFor({state:'hidden'});
    await details(number);
    for(const [id,value] of Object.entries({'ce-num':number,'ce-title':title,'ce-area':area,'ce-footprint':footprint,'ce-beds':beds,'ce-baths':baths,'ce-price':price})){
     const actual=await p.locator('#'+id).inputValue();
     if(id==='ce-area')assert.equal(Number(actual.replace(',','.')),Number(area.replace(',','.')),id);
     else assert.equal(actual,String(value),id);
    }
    assert((await p.locator('#ce-tags').inputValue()).includes('Тест '+i));
    assert.equal(Number((await p.locator('#ce-area1').inputValue()).replace(',','.')),Number(floorArea.replace(',','.')));
    assert((await p.locator('#ce-expl1').inputValue()).includes('Гостиная'));
    await fill('ce-title',title+' — правка');
    await save.click();await overlay.waitFor({state:'hidden'});
    await details(number);assert.equal(await p.locator('#ce-title').inputValue(),title+' — правка');
    const rows=await p.evaluate(n=>(__db.project_cards||[]).filter(r=>r.project_number===n),number);
    assert.equal(rows.length,1);assert.equal(rows[0].floors,floors);
    assert(rows[0].tags.includes(style==='classic'?'Классический':'Современный'));
    assert(rows[0].tags.includes({basement:'Цокольный этаж',mansard:'Мансарда',flat:'Плоская кровля'}[feature]));
    console.log('PASS',number,title,Date.now()-t+'ms');
   }catch(e){failures++;console.error('FAIL',number,e.message);}
   if(await overlay.isVisible())await p.locator('#cardEditorOverlay button[onclick="closeCardEditor()"]').click();
  }
  await create.click();await visible();
  const before=await p.evaluate(()=>__db.project_cards.length);
  await save.click();
  const emptyCount=await p.evaluate(()=>__db.project_cards.length);
  if(await overlay.isVisible()&&emptyCount===before)console.log('PASS empty form blocked');
  else{failures++;console.error('FAIL empty form saved',emptyCount-before);}
  if(await overlay.isVisible())await p.locator('#cardEditorOverlay button[onclick="closeCardEditor()"]').click();
  if(failures)process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
