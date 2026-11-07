/* Isolated browser evidence for the main staff and owner journeys. No live requests. */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.TEST_APP_ROOT || path.join(__dirname, '..'));
const out = path.resolve(process.env.AUDIT_SCREENSHOT_DIR || 'visual-evidence');
const {chromium} = require(path.join(root, 'node_modules/playwright'));
const fixture = () => {
  const actor = new URL(location.href).searchParams.get('actor') || 'admin';
  const day = '2026-11-07', timestamp = day + 'T10:00:00Z';
  const employees = __db.employees;
  for (const [id,name] of [['admin','Алексей'],['designer','Мария'],['architect','Антон'],['visual','Елена']])
    employees.find(e=>e.id===id).name=name;
  employees.push({id:'foreman',name:'Игорь',role:'Прораб',active:true,can_see_projects:false,can_see_construction:true});
  const project = (id,name,category_id,employee_id,extra={}) => ({
    id,name,category_id,employee_id,status_id:'active',client_name:'Учебный заказчик',address:'Северная улица, 12',
    start_date:'2026-11-01',end_date:'2026-11-20',price:480000,advance:120000,balance:360000,
    fee_base:'profit',fee_percent:40,payment_status:'Частично оплачено',created_at:timestamp,updated_at:timestamp,...extra});
  __db.projects = [project('home','Дом у озера','arch','architect'),
    project('flat','Квартира на Садовой','design','designer',{unit:'м²',area:94}),
    project('site','Ремонт загородного дома','build','foreman',{price:1200000,advance:420000,balance:780000,fee_percent:15,fee_base:'expenses'})];
  __db.project_stages = [{id:'stage-1',project_id:'home',name:'Эскиз',done:false,due_date:'2026-11-03'},
    {id:'stage-2',project_id:'site',name:'Подготовка объекта',done:false,due_date:'2026-11-15'}];
  __db.invoices = [{id:'invoice-material',project_id:'site',number:'42',description:'Кирпич для перегородок',
    supplier:'Учебный склад',item_type:'Материал',amount:37000,invoice_date:day,created_at:timestamp}];
  __db.ledger_entries = [{id:'build-advance',project_id:'site',type:'construction_budget',amount:420000,entry_date:day,created_at:timestamp},
    {id:'home-advance',project_id:'home',type:'advance',amount:120000,entry_date:day,created_at:timestamp}];
  const balances={reserve:215000,amortization:15000,'project:site':120000};
  const cash=350000, forecast=Array.from({length:91},()=>({conservative:185000,expected:215000,cash_conservative:320000,cash_expected:350000}));
  window.__journal={version:1,active:true,revision:2,balances,operations:[],fingerprint:'isolated-visual-fixture',
    workspace:{version:2,active:true,revision:2,as_of:day,generated_at:timestamp,opening_mode:'reconciled',
      cash,reserve:215000,balances,available_30:185000,minimum:185000,forecast,rules:[],warnings:[],unscheduled_projects:[],unmatched:[],
      items:[{key:'rent',label:'Аренда студии',direction:'expense',remaining:30000,amount:30000,due_date:'2026-11-12',status:'planned',origin:'manual',funding:'reserve'}],
      wallets:[{id:'studio-bank',name:'Расчётный счёт',kind:'bank',balance:cash,active:true}]}};
  const e=employees.find(e=>e.id===actor);
  if(e)localStorage.setItem('arhittek_session',JSON.stringify({employeeId:e.id,name:e.name,isAdmin:e.id==='admin',token:'isolated-'+e.id,createdAt:Date.now()}));
  else localStorage.removeItem('arhittek_session');
  sessionStorage.removeItem('arhittek_ui_route_v1');
};
function geometry(){
  const visible=e=>!!e.getClientRects().length && e.checkVisibility();
  const fmt=n=>Math.round(n*10)/10;
  const name=e=>e.getAttribute('aria-label')||e.innerText?.trim().replace(/\s+/g,' ').slice(0,100)||e.title||e.placeholder||e.id||'';
  const base=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName.toLowerCase(),id:e.id,cls:[...e.classList].slice(0,4).join(' '),name:name(e),x:fmt(r.x),y:fmt(r.y),w:fmt(r.width),h:fmt(r.height),font:s.fontSize,client:e.clientWidth,scroll:e.scrollWidth,tab:e.tabIndex}};
  const sel=['header','.brand-left','#userPill','#syncLabel','.bottom-nav','.nav-btn','.view.active','.section-label','.view.active .proj-row','.view.active .proj-name','.view.active .obj-card','.view.active .proj-meta','.view.active .proj-right','.view.active .section-label','.view.active .filter-chip','.view.active .payroll-head','.view.active .payroll-line','.view.active .payroll-pay','.view.active .fw-tabs','.view.active .fw-amount','.view.active .fw-row','.view.active button','.sheet-overlay.active .sheet','.sheet-overlay.active .sheet-header','.sheet-overlay.active label','.sheet-overlay.active button','.sheet-overlay.active input','.sheet-overlay.active select','#financeWorkspaceModal button','#financeWorkspaceModal label','#financeWorkspaceModal input','#financeWorkspaceModal select','#objTitle','#objTabs','#objTabContent','#obj-client-access','#fab','.filters-scroll'];
  const active=document.querySelector('.view.active');
  const els=[...new Set(document.querySelectorAll(sel.join(',')))].filter(visible);
  const outside=[...new Set([...(active?.querySelectorAll('button,input,select,textarea,a,.proj-name,.section-label,.li-name,.status-chip,.fw-row,.fw-amount,th,td')||[]),...document.querySelectorAll('.sheet-overlay.active button,.sheet-overlay.active input,.sheet-overlay.active select,.sheet-overlay.active label,.bottom-nav .nav-btn,header button,header .brand-title')])].filter(visible)
    .filter(e=>{const r=e.getBoundingClientRect();return r.x< -1||r.right>innerWidth+1}).map(base);
  const nodes=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); const clips=[];
  for(let n;(n=nodes.nextNode());){const t=n.textContent.trim(),e=n.parentElement;if(!t||!e||['SCRIPT','STYLE','OPTION'].includes(e.tagName)||!visible(e))continue;
    const range=document.createRange();range.selectNodeContents(n);for(const r of range.getClientRects()){for(let p=e;p&&p!==document.documentElement;p=p.parentElement){const s=getComputedStyle(p);if(!['hidden','clip'].includes(s.overflowX))continue;const c=p.getBoundingClientRect();if((r.right>c.right+2||r.left<c.left-2)&&c.width<innerWidth+1){clips.push({text:t.slice(0,75),parent:p.id||p.className||p.tagName,available:fmt(c.width),left:fmt(r.left),right:fmt(r.right),end:fmt(c.right),cut:fmt(Math.max(c.left-r.left,r.right-c.right)),y:fmt(r.top)});break}}}}
  const bodyText=(active?.innerText||'').trim().replace(/\n{3,}/g,'\n\n');
  return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,scrollY:Math.round(scrollY),access:document.documentElement.dataset.access,view:active?.id,els:els.slice(0,260).map(base),outside:outside.slice(0,45),clips:clips.slice(0,65),text:bodyText.slice(0,4200)};
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const report={browser:browser.version(),shots:{},failures:[],pageErrors:[]};
  const widths=(process.env.AUDIT_WIDTHS||'320,390,1440').split(',').map(Number);
  try{for(const width of widths){const height=width===320?680:width===390?844:900;
    for(const actor of ['admin','architect','designer','foreman']){
      const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:width<600,hasTouch:width<600,locale:'ru-RU',timezoneId:'Europe/Moscow',serviceWorkers:'block',reducedMotion:'reduce'});
      try{
      await context.addInitScript({content:'if(window===window.top){\n'+fs.readFileSync(path.join(root,'tests/mock.js'),'utf8')+'\n;('+fixture.toString()+')();\n}'});
      await context.route('**/*',r=>{const u=new URL(r.request().url());let f=u.hostname==='app.test'?path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1)):null;
        for(const [key,file] of [['xlsx@','xlsx/dist/xlsx.full.min.js'],['jspdf@','jspdf/dist/jspdf.umd.min.js'],['jspdf-autotable@','jspdf-autotable/dist/jspdf.plugin.autotable.min.js']])if(u.href.includes(key))f=path.join(root,'node_modules',file);
        if(f&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({path:f,contentType:f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':undefined});
        return r.fulfill({body:'',contentType:u.pathname.includes('css')?'text/css':'text/javascript'});});
      const page=await context.newPage();page.setDefaultTimeout(3500);
      await page.clock.setFixedTime(new Date('2026-11-07T10:00:00Z'));
      page.on('pageerror',e=>report.pageErrors.push({width,actor,message:e.message}));
      const start=async()=>{await page.goto('https://app.test/?actor='+actor);await page.waitForFunction(()=>typeof hasVerifiedAccess==='function'&&hasVerifiedAccess()&&!loadAllInFlight);await page.waitForTimeout(130)};
      const nav=id=>page.locator('.nav-btn[data-view="view-'+id+'"]').click();
      const top=()=>page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      const grab=async(key,scrollTop=true)=>{if(scrollTop)await top();await page.waitForTimeout(220);const tag=[actor,key,width].join('-');const d=await page.evaluate(geometry);report.shots[tag]=d;await page.screenshot({path:path.join(out,tag+'.png'),animations:'disabled'});};
      const use=async(key,fn)=>{try{await fn();}catch(e){report.failures.push({width,actor,key,error:String(e.message).slice(0,400)});}};
      await start();
      if(actor==='admin'){
        await use('overview',async()=>{await grab('overview')});
        await use('projects',async()=>{await nav('projects');await grab('projects');await page.locator('.proj-row').filter({hasText:'Дом у озера'}).first().click();await grab('project');await page.locator('#projectSheetClose').click()});
        await use('payroll',async()=>{await nav('more');await grab('more');await page.locator('#openTimesheetBtn').click();await grab('payroll');const pay=page.locator('.payroll-pay').first();if(await pay.isVisible()){await pay.click();await grab('payroll-payment',false);await start()}});
        await use('finance',async()=>{await nav('finance');await page.locator('#financeWorkspace').waitFor();await grab('finance');await page.locator('[data-fw-tab="calendar"]').click();await grab('calendar');await page.locator('[data-fw-tab="overview"]').click();await page.locator('[data-fw="record-expense"]').click();await grab('expense-form',false);await start()});
        await use('construction',async()=>{await nav('construction');await grab('construction');await page.locator('.obj-card').first().click();await grab('object');const tabs=page.locator('#objTabs');await tabs.scrollIntoViewIfNeeded();await grab('object-tabs',false);await page.locator('#objTabs .filter-chip[onclick*="add"]').click();const amount=page.locator('#inv-amount-obj');if(await amount.isVisible())await amount.scrollIntoViewIfNeeded();await grab('add-purchase',false)});
        await use('catalog',async()=>{await start();await nav('cards');await grab('catalog')});
      }else if(actor==='foreman'){
        await use('foreman',async()=>{await nav('construction');await grab('list');await page.locator('.obj-card').first().click();await grab('object');await page.locator('#objTabs .filter-chip[onclick*="add"]').click();const a=page.locator('#inv-amount-obj');if(await a.isVisible())await a.scrollIntoViewIfNeeded();await grab('add-purchase',false)});
      }else{
        await use('employee',async()=>{await grab('projects');await page.locator('#projectsCard .proj-row').first().click();await grab('project');await page.locator('#projectSheetClose').click()});
        if(actor==='designer')await use('documents',async()=>{await nav('more');await grab('tools');await page.locator('#openKpBtn').click();await grab('proposal')});
      }
      }catch(e){report.failures.push({width,actor,key:'startup',error:String(e.message).slice(0,500)});}finally{await context.close();fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(report,null,2));}
    }}
  }finally{await browser.close();}
  console.log(JSON.stringify({screens:Object.keys(report.shots).length,failures:report.failures,pageErrors:report.pageErrors}));
  if(!Object.keys(report.shots).length || report.failures.length || report.pageErrors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
