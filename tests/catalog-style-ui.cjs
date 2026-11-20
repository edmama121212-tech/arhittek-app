'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const C='Классический', M='Современный', B='Цокольный этаж', F='Плоская кровля';
const cards=[
 [21,'Усадьба',2,[C]], [20,'Усадьба',2,[M]], [19,'Дом на склоне',2,[C,M,B]],
 [18,'Дом для семьи',1,'  современный , ЦОКОЛЬНЫЙ ЭТАЖ'],[17,'Дом для семьи',1,' классический, классический , Мансарда'],
 [16,'Шале',1,['Современный камин']], [15,'Альбом без описания',null,null],
 [14,'Павильон',3,[M,F]], [13,'Павильон',2,[C,F]], [12,'Резерв',1,[C]],
 [11,'Резерв',1,[M]], [10,'Новый альбом',2,[]]
].map(([n,title,floors,tags])=>({id:'style-'+n,project_number:n+'26',title,floors,tags,total_area:'120',footprint:'10 × 12',deleted_at:n===12?'2025-05-03':null,created_at:'2025-03-01',images:[],thumbnails:[]}));
const groups=[
 ['duals','Сохранить оба стиля при уточнении габаритов',{},19,null,[[21,19,17,13],[20,19,18,14,11],[21,20,19,18,17,16,15,14,13,11,10]]],
 ['homonyms','Различить два варианта одной усадьбы',{search:'Усадьба'},0,null,[[21],[20],[21,20]]],
 ['legacy','Собрать одноэтажные архивные альбомы с тегами строкой',{floors:'1',search:'для семьи'},0,null,[[17],[18],[18,17]]],
 ['word','Отличить стиль здания от тега о камине',{search:'Шале'},0,null,[[],[],[16]]],
 ['unmarked','Открыть альбом без описания и этажности',{search:'без описания'},0,null,[[],[],[15]]],
 ['archived','Проверить пригодные к предложению дома из резерва',{search:'Резерв'},0,null,[[],[11],[11]]],
 ['roof','Сравнить стили павильонов с плоской кровлей',{feature:'flat'},0,null,[[13],[14],[14,13]]],
 ['basement','Подобрать варианты фасада дома с цоколем',{feature:'basement'},0,null,[[19],[19,18],[19,18]]],
 ['assign','Классифицировать новый альбом перед показом',{search:'Новый альбом'},10,'classic',[[10],[],[10]]],
 ['replace','Заменить подтверждённый стиль у конкретной усадьбы',{search:'Усадьба'},21,'modern',[[],[21,20],[21,20]]],
 ['resolve','Согласовать один фасад для дома с двумя метками',{search:'на склоне'},19,'classic',[[19],[],[19]]],
];
const ids=['UI-0063','UI-0064','UI-0062'];
const keys=['classic','modern','all'],names=[C,M,'Все стили'];
const assets=Object.fromEntries(['index.html','catalog.html','catalog-floors.js'].map(f=>[f,fs.readFileSync(path.join(root,f))]));
const build=Object.entries(assets).map(([f,b])=>f+' '+crypto.createHash('sha256').update(b).digest('hex').slice(0,12)).join(' / ');
const mock=fs.readFileSync(path.join(__dirname,'mock.js'),'utf8');
const toNum=s=>Number(s.match(/№\s*(\d+)26/)[1]);
const frames=p=>p.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
(async()=>{
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
const rows=[['ID','Сборка','UTC и Chromium','Задача','Шаги','Фактический результат и связи','Действие до двух кадров, мс','Вид и удобство','Итог']];
try{
 for(const [mode,task,conditions,edit,style,expected] of groups){
  const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,locale:'ru-RU',serviceWorkers:'block'});
  try{
   const links=cards.map(c=>({token:c.id,project_id:c.id,floors_filter:'all',created_at:'2025-03-01',deleted_at:null}));
   await ctx.addInitScript({content:mock+'\n__db.project_cards='+JSON.stringify(cards)+';__db.share_links='+JSON.stringify(links)});
   await ctx.route('**/*',route=>{
    const u=new URL(route.request().url()),name=u.pathname==='/'?'index.html':u.pathname.slice(1);
    if(u.hostname!=='style.test')return route.fulfill({body:''});
    if(assets[name])return route.fulfill({body:assets[name],contentType:name.endsWith('.html')?'text/html':'text/javascript'});
    const file=path.join(root,name);return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({body:''});
   });
   const p=await ctx.newPage();p.setDefaultTimeout(5000);await p.goto('https://style.test/');
   await p.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
   await p.evaluate(()=>{sb.functions={invoke:async()=>({data:{ok:true},error:null})};});
   await p.locator('.nav-btn[data-view=view-cards]').click();
   const view=p.locator('#view-cards'),list=view.locator('#cards-list .card');
   await list.first().waitFor();
   let setup='Каталог';
   if(edit){
    await list.filter({hasText:'№'+edit+'26'}).click();await p.locator('#cardViewerEditBtn').click();
    if(style)await p.locator('#style-btn-'+style).click();else await p.locator('#ce-footprint').fill('11 × 12 м');
    const previewTags=await p.locator('#prev-tags .tag').allTextContents();
    if(!style)assert.ok(previewTags.includes(C)&&previewTags.includes(M));
    else assert.ok(previewTags.includes(names[keys.indexOf(style)])&&!previewTags.includes(style==='classic'?M:C));
    await p.locator('#ce-save-btn').click();await p.locator('#cardEditorOverlay').waitFor({state:'hidden'});
    setup+=' → №'+edit+'26 → редактировать → '+(style?names[keys.indexOf(style)]:'габариты 11 × 12 м')+' → сохранить';
   }
   for(const [key,value] of Object.entries(conditions)){
    if(key==='search')await view.getByRole('searchbox').fill(value);
    else await view.locator('[data-'+key+'="'+value+'"]').click();
    setup+=' → '+key+'='+value;
   }
   for(const [j,key] of keys.entries()){
    const b=view.locator('[data-style='+key+']');
    const start=performance.now();await b.click();await frames(p);
    const elapsed=Math.round(performance.now()-start);
    const found=(await list.allTextContents()).map(toNum);assert.deepEqual(found,expected[j],mode+' '+key);
    assert.equal(await b.getAttribute('aria-pressed'),'true');assert.equal(await view.locator('[data-style].active').count(),1);
    const rect=await b.boundingBox();assert.ok(rect&&rect.x>=0&&rect.x+rect.width<=391);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(mode==='duals'&&key==='modern'&&process.env.STYLE_SHOT)await p.screenshot({path:process.env.STYLE_SHOT});
    const seen='Номера: '+(found.map(n=>n+'26').join(', ')||'нет проектов');
    let result=seen;
    const steps=setup+' → '+names[j];
    if(found.length){
     const index=mode==='duals'?found.indexOf(19):found.length-1, number=found[index];
     await list.nth(index).click();
     const frame=p.frameLocator('#cardViewerFrame');await frame.locator('.swiper-num').getByText('№ '+number+'26',{exact:true}).waitFor();
     assert.equal(await p.locator('#cardViewerCounter').innerText(),(index+1)+' / '+found.length);
     const tags=await frame.locator('.tag').allTextContents();
     if(key!=='all')assert.ok(tags.includes(names[j]),number+' '+tags);
     const close=p.locator('#cardViewerOverlay').getByTitle('Закрыть'),closeBox=await close.boundingBox();
     const t=performance.now();await close.click();await p.locator('#cardViewerOverlay').waitFor({state:'hidden'});await frames(p);
     const closeMs=Math.round(performance.now()-t);
     assert.deepEqual((await list.allTextContents()).map(toNum),found);
     assert.equal(await b.getAttribute('aria-pressed'),'true');
     if(j===2){
      const stored=await p.evaluate(()=>JSON.parse(JSON.stringify(__db.project_cards)));
      const client=await ctx.newPage();
      // The local provider serves the persisted fixture to this second browser tab.
      await client.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({
       body:'__db.project_cards='+JSON.stringify(stored)+';',contentType:'text/javascript'
      }));
      await client.goto('https://style.test/catalog.html?t=style-'+number);
      await client.locator('#catFeed .swiper-num').getByText('№ '+number+'26',{exact:true}).waitFor();
      assert.equal(await client.locator('#catFeed .card').count(),1);
      assert.deepEqual(await client.locator('#catFeed .tag').allTextContents(),tags);
      await client.close();
      rows.push(['UI-0065',build,new Date().toISOString()+' / '+browser.version(),task,steps+' → открыть №'+number+'26 → Закрыть → сверить клиентскую карточку',seen+'. Порядок и условия после возврата сохранены; карточка клиента показывает те же теги.',closeMs,'Видимая кнопка закрытия '+Math.round(closeBox.width)+'×'+Math.round(closeBox.height)+' px. После закрытия виден отобранный список.','PASS']);
     }
     result+='. В просмотрщике №'+number+'26, метки '+(tags.join(', ')||'не указаны')+'. Возврат сохраняет выдачу.';
    }else assert.ok(await view.getByText('Проекты не найдены',{exact:true}).isVisible());
    rows.push([ids[j],build,new Date().toISOString()+' / '+browser.version(),task,steps,result,elapsed,'Активный фильтр '+Math.round(rect.width)+'×'+Math.round(rect.height)+' px, виден без горизонтальной прокрутки. '+(found.length?'Карточку можно открыть из списка.':'Видно сообщение о пустой подборке.'),'PASS']);
   }
  }finally{await ctx.close();}
 }
}finally{await browser.close();}
if(process.env.STYLE_CSV)fs.writeFileSync(process.env.STYLE_CSV,'\ufeff'+rows.map(r=>r.map(s=>'"'+String(s).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
console.log(rows.length-1,'style and viewer outcomes');
})().catch(e=>{console.error(e);process.exitCode=1;});
