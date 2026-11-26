'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).digest('hex').slice(0,16);
async function run(){
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU',serviceWorkers:'block'});
  await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
  await ctx.route('**/*',route=>{
   const u=new URL(route.request().url()),file=path.join(root,u.pathname==='/'?'index.html':u.pathname);
   return u.hostname==='qa.test'&&fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({body:''});
  });
  const p=await ctx.newPage();p.setDefaultTimeout(5000);
  await p.goto('https://qa.test/');await p.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);



  const page=p;
  await page.evaluate(async()=>{
   __db.projects=[{id:'qa',name:'Учебная архитектура',price:900,advance:100,balance:800,category_id:'arch',status_id:'active'}];
   __journal={version:1,revision:1,active:true,balances:{reserve:100},operations:[],fingerprint:'inactive-fixture',workspace:{version:2,revision:1,active:true,as_of:'2026-11-26',opening_mode:'reconciled',cash:100,reserve:100,balances:{reserve:100},forecast:Array(91).fill({conservative:100,expected:100}),rules:[],warnings:[],items:[],wallets:[{id:'safe',name:'Сейф',kind:'unallocated',is_default:true,balance:100,active:true}]}};
   await loadAll();
  });
  const nav=async view=>page.locator('.nav-btn[data-view="view-'+view+'"]').click();
  async function sample(items,route,expected='hidden',tab=page) {
   for(const [id,selector] of items){
    const start=performance.now(),value=await tab.locator(selector).evaluate(e=>{
     const chain=[];for(let n=e;n;n=n.parentElement){
      if(getComputedStyle(n).display==='none'||getComputedStyle(n).visibility==='hidden'||n.hidden)chain.push(n.id||n.tagName);
     }
     const box=e.getBoundingClientRect();
     return {visible:!chain.length&&box.width>0&&box.height>0,chain:chain.join(' > '),href:e.getAttribute('href'),click:e.getAttribute('onclick')};
    });
    console.log(JSON.stringify({id,build,route,ms:Math.round((performance.now()-start)*10)/10,...value}));
    if(expected==='plain')assert.ok(value.visible&&!value.href&&!value.click,selector);
    else assert.equal(value.visible,expected==='visible',selector);
   }
  }
  await nav('finance');await page.locator('#financeWorkspace .studio-money-grid').waitFor();
  const finance=['companyExpenseSheetClose','cex-category','cex-amount','cex-date','cex-desc','cex-save','cex-delete','cex-cancel','companyIncomeSheetClose','cin-category','cin-amount','cin-date','cin-desc','cin-save','cin-delete','cin-cancel'].map((name,i)=>[164+i,'#'+name]);
  finance.push([187,'#financeBack'],[188,'#view-finance button[onclick="openCompanyIncomeSheet(null)"]']);
  await sample(finance,'Финансы → подтверждённый Сейф v2');
  await nav('projects');await page.locator('#projectsCard .proj-row').click();
  const accounts=[[196,'#pf-payment'],[225,'#pf-end'],[229,'#pf-stage-date'],[230,'#pf-task-name'],[231,'#pf-task-priority'],[232,'#pf-task-add-btn']];
  // Open genuine disclosure controls surrounding these fields before checking visibility.
  for(const [,selector] of accounts){
   const ancestor=page.locator(selector).locator('xpath=ancestor::details[not(@open)]').first();
   if(await ancestor.count()&&await ancestor.isVisible())await ancestor.locator('summary').first().click();
  }
  await sample(accounts,'Проекты → Учебная архитектура → Обзор, дополнительные поля');
  await page.locator('#project-tab-team').click();
  await sample([[197,'#pf-employee'],[198,'#pf-co-employee'],[205,'#pf-compensation-method']],'Проекты → Учебная архитектура → Команда');
  await page.locator('#pf-cancel').click();await page.locator('#settingsBtn').click();
  await page.locator('#employeesCard button[onclick*="visual"]').click();
  await sample([[280,'#ef-can-edit-cards']],'Настройки владельца → существующий сотрудник');
  await page.locator('#empSheetClose').click();await page.locator('#settingsBack').click();
  await page.locator('#openContractsBtn').click();await sample([[97,'#ct-project']],'Ещё → Договор');
  await page.locator('#contractsBack').click();await nav('cards');await page.locator('#cards-admin-bar button[onclick="openCardEditor(null)"]').click();
  await page.setViewportSize({width:1280,height:900});
  await sample([[40,'#cardEditorOverlay button:text-is("Получить проект")'],[41,'#cardEditorOverlay button:text-is("Консультация")']],'Редактор → визуальный макет карточки','plain');
  const portal=await ctx.newPage();await portal.goto('https://qa.test/client-portal.html');
  await sample([[70,'a.brand']],'Кабинет заказчика → шапка','plain',portal);
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
