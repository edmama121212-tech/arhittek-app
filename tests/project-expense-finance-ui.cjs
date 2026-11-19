const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const project = { id:'qa-project', name:'Проверка расхода', category_id:'arch', status_id:'active', price:10000, expenses:0 };
const asOf = '2026-11-19';
const scenarios = [
  { name:'architecture', amount:'100', sum:100, rows:1 },
  { name:'interior, fractional amount', category:'design', amount:'125.75', sum:125.75, rows:1 },
  { name:'landscape, one kopeck', category:'land', amount:'0.01', sum:0.01, rows:1 },
  { name:'first day of month', date:'2026-11-01', sum:100, rows:1 },
  { name:'preceding month', date:'2026-10-31', sum:0, rows:1 },
  { name:'later than reporting date', date:'2026-11-20', sum:0, rows:1 },
  { name:'double submit', action:'double', sum:100, rows:1 },
  { name:'zero rejected', amount:'0', sum:0, rows:0 },
  { name:'missing description', description:'', sum:0, rows:0 },
  { name:'edit an existing payment', action:'edit', sum:65.25, rows:1 },
  { name:'delete an existing payment', action:'delete', sum:0, rows:0 },
  { name:'historical costs excluded from current payments', legacy:500, sum:100, rows:2 },
  { name:'second payment to same project', action:'second', sum:165.25, rows:2 },
];
async function run(browser, scenario) {
  const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  try {
    const seed={project:{...project,category_id:scenario.category||'arch',expenses:scenario.legacy||0,created_at:asOf},asOf};
    await context.addInitScript({content: fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+'\n;('+function(seed) {
      const saved=sessionStorage.getItem('fixture-expense-tables');
      if(saved)Object.assign(__db,JSON.parse(saved));
      else __db.projects=[seed.project];
      const balances={reserve:10000};
      window.__journal={version:1,active:true,revision:1,balances,operations:[],workspace:{
        version:2,active:true,revision:1,as_of:seed.asOf,cash:10000,reserve:10000,balances,
        wallets:[{id:'test',name:'Test',balance:10000}],items:[],forecast:Array(91).fill({}),
      }};
    }.toString()+')('+JSON.stringify(seed)+');'});
    await context.route('**/*',route=>{
      const u=new URL(route.request().url()), file=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
      return u.hostname==='app.test'&&fs.existsSync(file)?route.fulfill({path:file,contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'}):route.fulfill({body:''});
    });
    const page=await context.newPage();
    await page.goto('https://app.test');
    const ready=()=>page.waitForFunction(()=>typeof state!=='undefined'&&state.financialDataReady&&!loadAllInFlight);
    const checkFinance=async()=>{
      await page.locator('.nav-btn[data-view="view-finance"]').click();
      const amount=page.locator('#financeWorkspace .studio-money-grid article').filter({hasText:'Расходы за месяц'}).locator('strong');
      await amount.waitFor();
      assert.equal(Number((await amount.innerText()).replace(/[^\d,.-]/g,'').replace(',','.')),scenario.sum);
      const rows=await page.evaluate(()=>__db.ledger_entries?.filter(r=>!r.deleted_at&&r.type==='project_expense').length||0);
      assert.equal(rows,scenario.rows);
    };
    await ready();
    await page.locator('.nav-btn[data-view="view-projects"]').click();
    await page.locator('.proj-row').filter({hasText:project.name}).click();
    await page.locator('#project-tab-money').click();
    const submit=async(amount,description,double=false)=>{
      await page.locator('#pf-expense-desc').fill(description);
      await page.locator('#pf-expense-amount').fill(amount);
      await page.locator('#pf-expense-date').fill(scenario.date||asOf);
      const button=page.locator('#pf-expense-add-btn');
      if(double)await button.evaluate(b=>{b.click();b.click()});
      else await button.click();
      await page.waitForFunction(()=>!projectExpenseSaveInFlight&&!loadAllInFlight);
    };
    await submit(scenario.amount??'100',scenario.description??'Печать альбома',scenario.action==='double');
    if(scenario.action==='edit'){
      await page.getByTitle('Редактировать расход').click();
      await submit('65.25','Уточнённая сумма');
    }
    if(scenario.action==='delete'){
      await page.getByTitle('Удалить расход').click();
      await page.waitForFunction(()=>__db.ledger_entries?.some(r=>r.deleted_at)&&!loadAllInFlight);
    }
    if(scenario.action==='second')await submit('65.25','Копия альбома');
    await page.locator('#projectSheetClose').click();
    await checkFinance();
    await page.evaluate(()=>sessionStorage.setItem('fixture-expense-tables',JSON.stringify(__db)));
    await page.reload();
    await ready();
    await checkFinance();
  }finally{await context.close();}
}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  let failed=0;
  try{
    for(const scenario of scenarios){
      const t=Date.now();
      try{await run(browser,scenario);console.log('PASS',scenario.name,Date.now()-t+'ms');}
      catch(error){failed++;console.error('FAIL',scenario.name,error.message);}
    }
  }finally{await browser.close();}
  if(failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
