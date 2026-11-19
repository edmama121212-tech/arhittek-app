const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = process.env.REPORT_EVIDENCE;
const day = '2026-11-19';
const income = (amount, more) => ({ table:'company_income', amount, income_date:day, ...more });
const expense = (amount, more) => ({ table:'company_expenses', amount, expense_date:day, ...more });
const entry = (type, amount, more) => ({ table:'ledger_entries', type, amount, entry_date:day, project_id:'design-qa', ...more });
const cases = [
  { task:'Офисная аренда при отсутствии продаж', rows:[expense(55000.05)], expected:[0,55000.05,-55000.05] },
  { task:'Возврат заказчику после аванса', rows:[entry('advance',39000),entry('client_refund',4000.25)], expected:[34999.75,0,34999.75] },
  { task:'Возврат по договору прошлого месяца', rows:[entry('advance',12000,{entry_date:'2026-10-31'}),entry('client_refund',8000)], expected:[-8000,0,-8000] },
  { task:'Оклад и гонорар в день поступления', rows:[income(50000),entry('salary_payment',35000),entry('fee_payment',1550.98)], expected:[50000,36550.98,13449.02] },
  { task:'Строительные деньги и оплата студии', rows:[entry('construction_budget',100000,{project_id:'build-qa'}),entry('expense',8000,{project_id:'build-qa'}),income(2300)], expected:[2300,0,2300] },
  { task:'Сверка сейфа и обычный расход', rows:[income(10000,{category:'Корректировка резерва (+)'}),expense(2000,{description:'[cash:adjustment] пересчёт'}),expense(503)], expected:[0,503,-503] },
  { task:'Вывод собственника отдельно от хозяйственных расходов', rows:[entry('withdrawal',19000),expense(800,{category:'Вывод средств'}),income(1000)], expected:[1000,0,1000] },
  { task:'Перенос старых расходов и сегодняшняя оплата проекта',rows:[entry('project_expense',10000,{description:'Ранее внесённые расходы'}),entry('project_expense',1300.35)],expected:[0,1300.35,-1300.35] },
  { task:'Старт учёта в середине месяца', start:'2026-11-15', rows:[income(14999,{income_date:'2026-11-14'}),income(1500,{income_date:'2026-11-15'}),entry('advance',8000,{received_before_start:true})],expected:[1500,0,1500] },
  { task:'Оплата будущей датой и аннулированный расход', rows:[expense(1999,{expense_date:'2026-11-20'}),expense(300,{deleted_at:day}),income(1500,{income_date:'2026-11-01'})], expected:[1500,0,1500] }
];

function seed({rows,start,day}) {
  window.__db.projects = ['design','build'].map(type=>({
    id:type+'-qa', name:'QA '+type, category_id:type,status_id:'active', created_at:day+'T00:00:00Z'
  }));
  rows.forEach(({table,...data},i)=>{
    (window.__db[table] ||= []).push({id:'qa-'+i,created_at:day+'T06:00:00Z',...data});
  });
  const balances = {reserve:75000};
  window.__journal = {version:1,active:true,revision:2,balances,operations:[],fingerprint:'monthly-qa',
    workspace:{version:2,active:true,revision:2,as_of:day,opening_mode:start?'zero':'reconciled',start_date:start,
      cash:75000,reserve:75000,balances,items:[],forecast:Array(91).fill({}),wallets:[
        {id:'safe',name:'Сейф',is_default:true,balance:75000,active:true}
      ]}};
}

function parseRubles(text) { return Number(text.replace(/[\s₽]/gu,'').replace(',','.')); }
async function run(browser, spec, index) {
  const width=index%2===0?390:1280;
  const context=await browser.newContext({viewport:{width,height:844},locale:'ru-RU',timezoneId:'Europe/Moscow',serviceWorkers:'block',reducedMotion:'reduce'});
  try {
    await context.addInitScript({content:fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+';('+seed.toString()+')('+JSON.stringify({...spec,day})+')'});
    await context.route('**/*', async route=>{
      const url=new URL(route.request().url());
      if (url.hostname!=='app.test') return route.fulfill({body:'',contentType:'text/javascript'});
      const file=path.join(root, url.pathname==='/'?'index.html':url.pathname);
      if(!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status:404,body:''});
      return route.fulfill({path:file});
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('https://app.test/');
    await page.waitForFunction(()=>typeof hasVerifiedAccess==='function'&&hasVerifiedAccess()&&state.financialDataReady&&!loadAllInFlight);
    await page.locator('#nav-finance').click();
    const workspace=page.locator('#financeWorkspace');
    const homeExpenses=parseRubles(await workspace.locator('.studio-money-grid article').filter({hasText:'Расходы за месяц'}).locator('strong').innerText());
    assert.equal(homeExpenses,spec.expected[1],spec.task);
    await workspace.getByRole('button',{name:/Ещё/}).click();
    const report=workspace.locator('details[data-fw-section="month-report"]'), summary=report.locator('summary');
    await summary.scrollIntoViewIfNeeded();
    assert.equal(await report.locator('.fw-grid').isVisible(),false);
    if(output)await summary.screenshot({path:path.join(output,'before-'+index+'.png')});
    await summary.evaluate(el=>el.addEventListener('click',()=>{window.__reportClickTime=performance.now()}, {capture:true,once:true}));
    await summary.click();
    const elapsed=await report.evaluate(async el=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      if(!el.open)throw Error('Отчёт не раскрылся');
      return Math.round(performance.now()-window.__reportClickTime);
    });
    const labels=await report.locator('.fw-grid small').allTextContents();
    assert.deepEqual(labels,['Выручка','Расход','Чистый доход']);
    const actual=(await report.locator('.fw-amount').allTextContents()).map(parseRubles);
    assert.deepEqual(actual,spec.expected,spec.task);
    const layout=await report.evaluate(element=>{
      const cards=[...element.querySelectorAll('article')], boxes=cards.map(c=>c.getBoundingClientRect());
      const fits=cards.every(c=>c.scrollWidth<=c.clientWidth+1 && [...c.querySelectorAll('small,strong,p')].every(el=>{
        const range=document.createRange();range.selectNodeContents(el);
        const bounds=c.getBoundingClientRect();
        return [...range.getClientRects()].every(b=>b.left>=bounds.left && b.right<=bounds.right+1);
      }));
      return {columns:new Set(boxes.map(b=>Math.round(b.x))).size,fits,pageFits:document.documentElement.scrollWidth<=innerWidth+1};
    });
    assert.ok(layout.fits && layout.pageFits,JSON.stringify(layout));
    const bottomNote=report.locator('.fw-grid article:last-child p');
    await bottomNote.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
    assert.ok(await bottomNote.evaluate(el=>{
      const box=el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
    }), 'Нижнюю подпись после прокрутки закрывает интерфейс');
    if(output)await page.screenshot({path:path.join(output,'after-'+index+'.png')});
    await summary.press('Enter');
    assert.equal(await report.locator('.fw-grid').isVisible(),false);
    assert.deepEqual(errors,[]);
    return [spec.task,JSON.stringify(spec.rows),spec.start||'2026-11-01','Финансы → сверить расходы → Ещё → Отчёт за месяц → Enter',spec.expected.join(' / '),actual.join(' / '),homeExpenses,width,elapsed,
      'Карточки в '+layout.columns+' кол.; суммы и подписи в границах, страница без переполнения',
      'Два нажатия от финансов; три подписанные суммы, сворачивание с клавиатуры','Пройдено'];
  } finally { await context.close(); }
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
  try {
    if(output)fs.mkdirSync(output,{recursive:true});
    const build=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'index.html'))).update(fs.readFileSync(path.join(root,'finance-workspace.js'))).update(fs.readFileSync(path.join(root,'cash-finance.js'))).digest('hex').slice(0,16);
    const rows=[['ID','SHA256 index+finance-workspace+cash-finance','Сценарий','Синтетические записи','Начало расчётного периода','Действия','Эталон выручка / расход / чистый доход, ₽','Факт в отчёте, ₽','Расход на Главной финансов, ₽','Ширина CSS px','Клик → два кадра, мс','Визуальная проверка','Удобство (экспертная проверка)','Итог']];
    for(const [i,spec] of cases.entries()) rows.push(['FW-MONTH-REPORT',build,...await run(browser,spec,i)]);
    if(output)fs.writeFileSync(path.join(output,'QA_MONTH_REPORT_RUNS.csv'),'\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
    console.log(rows.length-1,'monthly report journeys passed. Build',build);
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
