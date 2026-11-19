const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const home = 'https://history.test';
const out = process.env.HISTORY_QA_OUTPUT;
const width = Number(process.env.HISTORY_QA_WIDTH || 390);
const build = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'finance-workspace.js'))).digest('hex');
const rows = [
  [1,'Первичная сверка',20000.75,'2026-11-01T07:00:00Z'],
  [2,'Материалы · краска',-7500.25,'2026-11-04T07:00:00Z'],
  [3,'Аванс · эскиз',12500.5,'2026-11-08T08:40:00Z'],
  [4,'Оплата подрядчика',-10000,'2026-11-15T10:20:00Z'],
  [5,'Возврат от подрядчика',10000,'2026-11-15T10:30:00Z'],
  [6,'Распределение резерва',0,'2026-11-16T11:00:00Z'],
  [7,'Материалы · кабель',-7500.25,'2026-11-18T20:55:00Z'],
  [8,'Отмена закупки кабеля',7500.25,'2026-11-18T21:05:00Z'],
  [9,'Доставка образцов',-2500.25,'2026-11-19T09:00:00Z']
];
let balance = 0;
const operations = rows.map(([revision, reason, cash_delta, created_at]) => {
  balance = Math.round((balance + cash_delta) * 100) / 100;
  return {id:'fixture-'+revision, revision, reason, cash_delta, created_at,
    kind:revision===1?'activate':revision===8?'reverse':'record', reverses:revision===8?'fixture-7':null,
    balances_after:{reserve:balance}};
}).reverse();
const archive = operations.at(-1);
const current = operations.slice(0,-1);
const cases = [
  ['FHS-01','Сверить аванс по денежной сумме, совпадающей с остатком другой записи','12 500,50 ₽',[3]],
  ['FHS-02','Сопоставить отрицательную сумму из расчётной таблицы','-7500.25',[7,2]],
  ['FHS-03','Найти оплату и возврат той же суммы с копейками','7 500,25 ₽',[8,7,2]],
  ['FHS-04','Открыть строку сверки по номеру из сообщения коллеги','№ 8',[8]],
  ['FHS-05','Сверить день возврата после московской полуночи','19.11.2026',[9,8]],
  ['FHS-06','Найти покупку и её отмену по общему основанию','кабел',[8,7]],
  ['FHS-07','Отобрать внутреннее распределение без изменения наличных','движение денег',[6]],
  ['FHS-08','Уточнить закупки по виду затрат','материалы',[7,2]],
  ['FHS-09','Исключить служебную подпись у каждой карточки из найденных операций','Отменить с причиной',[]],
  ['FHS-10','Найти первичную сверку в следующей странице журнала','Первичная сверка',[1]],
  ['FHS-11','Вернуться из отфильтрованной истории к сейфу и заново открыть полный журнал','Доставка образцов',[9]],
  ['FHS-12','Отличить размер аванса от остатка резерва при поиске без знака рубля','12 500,50',[3]]
];
function fixture({current,archive,balance}) {
  const balances={reserve:balance};
  window.__journal={version:1,revision:9,active:true,balances,operations:current,fingerprint:'qa-history',
    workspace:{version:2,revision:9,active:true,as_of:'2026-11-19',opening_mode:'reconciled',cash:balance,reserve:balance,balances,
      forecast:Array(91).fill({conservative:balance,expected:balance}),rules:[],warnings:[],items:[],
      wallets:[{id:'fixture-safe',name:'Сейф',kind:'unallocated',is_default:true,balance,active:true}]}};
  window.__historyReads=[];
  const provider=window.supabase.createClient;
  window.supabase.createClient=(...args)=>{
    const client=provider(...args);
    const rpc=client.rpc.bind(client);
    client.rpc=async(name,params)=>{
      if(name==='get_financial_journal_history'){
        __historyReads.push(params.p_before);
        return {data:[...current.slice(-1),archive],error:null};
      }
      return rpc(name,params);
    };
    return client;
  };
}
(async()=>{
  if(out) fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
  const results=[],errors=[];
  try {
    const ctx=await browser.newContext({viewport:{width,height:844},locale:'ru-RU',timezoneId:'UTC',hasTouch:width<768,serviceWorkers:'block',reducedMotion:'reduce'});
    await ctx.addInitScript({content:fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+';('+fixture.toString()+')('+JSON.stringify({current,archive,balance})+')'});
    await ctx.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==home) return route.fulfill({body:'',contentType:'text/javascript'});
      const file=path.join(root,url.pathname==='/'?'index.html':url.pathname.slice(1));
      return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({status:404,body:''});
    });
    for(const [id,task,query,expected] of cases){
      const p=await ctx.newPage();
      p.setDefaultTimeout(6500);
      p.on('pageerror',e=>errors.push(e.message));
      let elapsed,actual,layout;
      try{
        await p.goto(home,{waitUntil:'domcontentloaded'});
        await p.waitForFunction(()=>typeof hasVerifiedAccess==='function'&&hasVerifiedAccess()&&state.financialDataReady&&!loadAllInFlight);
        const fw=p.locator('#financeWorkspace');
        const goHistory=async()=>{
          await fw.getByRole('button',{name:/Ещё/}).click();
          await fw.getByRole('button',{name:'История операций'}).click();
        };
        await p.locator('.bottom-nav').getByRole('button',{name:/^Финансы/}).click();
        const safeCard=fw.locator('.studio-money-grid article').first();
        const safe=await safeCard.innerText();
        assert.match(safe,/Сейф/);
        const beforeWrites=await p.evaluate(()=>__writes.length);
        await goHistory();
        const input=fw.getByRole('searchbox',{name:'Поиск по загруженным операциям'});
        if(out) await p.screenshot({path:path.join(out,id+'-before.png')});
        // The initiating event and both frames use the same browser clock.
        await p.evaluate(archiveCase=>{
          const root=document.querySelector('#financeWorkspace');
          root.addEventListener(archiveCase?'click':'input',()=>window.__historyStart=performance.now(),{capture:true,once:true});
        },id==='FHS-10');
        await input.fill(query);
        if(id==='FHS-10'){
          assert.ok(await fw.getByText('Операций по запросу нет.').isVisible());
          await fw.getByRole('button',{name:'Более ранние операции'}).click();
          await fw.getByRole('heading',{name:archive.reason}).waitFor();
          assert.deepEqual(await p.evaluate(()=>__historyReads),[2]);
        }
        elapsed=await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(Math.round(performance.now()-__historyStart))))));
        actual=await fw.locator('[data-fw-operation]:visible > p').evaluateAll(nodes=>nodes.map(n=>Number(n.textContent.match(/№(\d+)/)[1])));
        layout=await fw.evaluate(root=>{
          const field=root.querySelector('input[type=search]');
          const inside=el=>{const {left,right}=el.getBoundingClientRect();return left>=0&&right<=innerWidth+1};
          const cards=[...root.querySelectorAll('[data-fw-operation]:not([hidden])')];
          return {width:innerWidth,fieldHeight:Math.round(field.getBoundingClientRect().height),
            contained:inside(field)&&cards.every(inside)&&document.documentElement.scrollWidth<=innerWidth+1,
            focus:field===document.activeElement};
        });
        if(out) await p.screenshot({path:path.join(out,id+'-after.png')});
        assert.deepEqual(actual,expected);
        assert.equal(await fw.getByText('Операций по запросу нет.').isVisible(),expected.length===0);
        assert.equal(await input.inputValue(),query);
        assert.ok(layout.contained&&layout.fieldHeight>=44);
        if(id!=='FHS-10')assert.ok(layout.focus);
        if(id==='FHS-06'){
          assert.equal(await fw.locator('[data-fw-operation]:visible [data-journal="reverse"]').count(),0);
        }
        await fw.getByRole('button',{name:'Финансы',exact:true}).click();
        assert.equal(await safeCard.innerText(),safe);
        if(id==='FHS-11'){
          await goHistory();
          assert.equal(await input.inputValue(),'');
          assert.equal(await fw.locator('[data-fw-operation]:visible').count(),current.length);
        }
        assert.equal(await p.evaluate(()=>__writes.length),beforeWrites);
        results.push({id,task,query,expected,actual,elapsed,layout,pass:true});
      }catch(e){results.push({id,task,query,expected,actual,elapsed,layout,pass:false,error:e.message.slice(0,380)});}
      finally{await p.close();}
    }
    const run={build,browser:browser.version(),results,errors};
    if(out)fs.writeFileSync(path.join(out,'run.json'),JSON.stringify(run,null,2));
    console.log(JSON.stringify(run,null,2));
    assert.ok(results.every(r=>r.pass)&&!errors.length);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
