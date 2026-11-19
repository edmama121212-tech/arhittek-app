const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.FINANCE_JOURNEY_OUTPUT;
const journalFixture = () => {
  const day = '2026-11-19';
  const balances = {reserve:90000};
  const operations = [{id:'demo',reason:'Аренда студии',revision:2,created_at:day+'T09:00:00Z',kind:'expense',cash_delta:-10000,balances_after:balances}];
  window.__journal = {version:1,revision:2,active:true,balances,operations,fingerprint:'qa',workspace:{
    version:2,active:true,revision:2,as_of:day,generated_at:day+'T12:00:00Z',opening_mode:'reconciled',
    cash:90000,reserve:90000,balances,available_30:90000,minimum:90000,forecast:Array(91).fill({conservative:90000,expected:90000,cash_conservative:90000,cash_expected:90000}),
    rules:[],warnings:[],unscheduled_projects:[],unmatched:[],items:[],wallets:[{id:'fixture-safe',name:'Сейф',kind:'unallocated',is_default:true,balance:90000,active:true}]}};
};
(async () => {
  if(out)fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
  const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,locale:'ru-RU',reducedMotion:'reduce',serviceWorkers:'block'});
  await ctx.addInitScript({content:fs.readFileSync(path.join(__dirname,'mock.js'),'utf8')+';('+journalFixture.toString()+')()'});
  await ctx.route('**/*',r=>{
    const u=new URL(r.request().url());
    const f=path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1));
    if(u.hostname==='app.test'&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({path:f});
    return r.fulfill({body:'',contentType:'text/javascript'});
  });
  let p,fw,dialog;
  const results=[];const errors=[];

  const button=(scope,name)=>scope.getByRole('button',{name:new RegExp('^'+name+'(?:\\s*[›→])?$')});
  const focus=()=>p.evaluate(()=>document.activeElement===document.body?'BODY':document.activeElement?.textContent.trim().slice(0,140));
  const shot=async(name)=>{if(out)await p.screenshot({path:path.join(out,name+'.png'),animations:'disabled'})};
  const cases=[
    ['Расход сейчас','Записать расход','Записать расход','record-expense'],
    ['Поступление сейчас','Записать поступление','Записать поступление','record-income'],
    ['Поиск в журнале','История операций','История операций','history'],
    ['Поиск без результата','История операций','История операций','empty'],
    ['Прогноз по договорам','Прогноз по проектам','Прогноз по проектам','forecast'],
    ['Сейф','Сейф','Сейф','accounts'],
    ['Регулярные платежи','Регулярные платежи','Регулярные платежи','settings'],
    ['Плановый расход','Платёжный календарь','Запланировать расход','plan-expense'],
    ['Плановое поступление','Платёжный календарь','Запланировать поступление','plan-income'],
    ['Плановое распределение','Платёжный календарь','Запланировать распределение','plan-release'],
    ['Месячный отчёт','Отчёт за месяц','Отчёт за месяц','report'],
    ['Обновление справочника','Обновить','Операции и планы','refresh']
  ];
  try {
    for(const [task,entry,title,type] of cases){
      p=await ctx.newPage();p.setDefaultTimeout(6000);p.on('pageerror',e=>errors.push(e.message));fw=p.locator('#financeWorkspace');dialog=p.getByRole('dialog');
      const start=Date.now();let steps=0,goalStarted=0,goalMs=0;const focusIssues=[];const checkFocus=async(expected)=>{const actual=await focus();if(actual!==expected)focusIssues.push({expected,actual})};
      try{
        await p.goto('https://app.test/',{waitUntil:'domcontentloaded',timeout:30000});await p.waitForFunction(()=>typeof hasVerifiedAccess==='function'&&hasVerifiedAccess()&&state.financialDataReady&&!loadAllInFlight);
        await p.locator('.bottom-nav').getByRole('button',{name:/^Финансы/}).click();
        await fw.getByText('Сейф',{exact:true}).waitFor();if(type==='record-expense')await shot('00-safe');
        await fw.getByRole('button',{name:/Ещё/}).click();steps=1;
        await fw.getByRole('heading',{name:'Операции и планы',exact:true}).waitFor();
        await checkFocus('Операции и планы');
        if(type==='record-expense')await shot('01-operations');
        goalStarted=Date.now();
        if(type==='report'){
          await fw.getByText(entry,{exact:true}).click();steps++;
          assert.ok(await fw.getByText('Выручка',{exact:true}).isVisible());
          await fw.getByText(entry,{exact:true}).click();
        }else{
          await button(fw,entry).click();steps++;
          if(type.startsWith('plan-')){await button(fw,title).click();steps++;}
          if(type.startsWith('record-')||type.startsWith('plan-')){
            await dialog.getByRole('heading',{name:title,exact:true}).waitFor();
            await checkFocus(title);
            const record=type.startsWith('record-');
            assert.ok(await dialog.getByLabel(record?'Дата оплаты':'Плановая дата (если известна)',{exact:true}).isVisible());
            assert.ok(await button(dialog,record?'Записать оплату':'Добавить в план').isVisible());
            if(record){
              const walletLabel=type==='record-income'?'Куда поступили деньги':'Откуда оплатили';
              assert.ok((await dialog.innerText()).includes(walletLabel));
              assert.ok((await dialog.innerText()).includes('Сейф'));
              assert.equal(await dialog.locator('select[name="wallet_id"]:visible').count(),0);
              const wallet=await dialog.evaluate(form=>Object.fromEntries(new FormData(form)).wallet_id);
              assert.equal(wallet,'fixture-safe');
            }
            const label=dialog.getByRole('textbox').first();await label.fill(type.includes('expense')?'Печать альбома':'Учебная операция');
            await dialog.getByRole('spinbutton').fill('2400');
            if(type==='record-expense'){await label.blur();await shot('02-expense');}
            await button(dialog,'Закрыть').focus();await p.keyboard.press('Tab');assert.ok(await label.evaluate(e=>e===document.activeElement));
            await p.keyboard.press('Shift+Tab');await checkFocus('Закрыть');
            await p.keyboard.press('Escape');assert.equal(await dialog.count(),0);
            await checkFocus(title);
            if(record){
              // Confirm only against the isolated in-memory journal; inspect the command sent by the real form.
              await p.evaluate(()=>{
                window.__submittedFinance=[];
                const rpc=sb.rpc.bind(sb);
                sb.rpc=async(name,args)=>{
                  if(name!=='confirm_finance_workspace')return rpc(name,args);
                  __submittedFinance.push(structuredClone(args));
                  const journal=__journal,w=journal.workspace,payload=args.p_payload;
                  const delta=(payload.direction==='income'?1:-1)*payload.amount;
                  w.cash+=delta;w.reserve+=delta;w.wallets[0].balance+=delta;
                  journal.balances.reserve=w.reserve;w.balances.reserve=w.reserve;
                  journal.revision+=1;w.revision=journal.revision;
                  return {data:structuredClone(journal),error:null};
                };
              });
              await button(fw,entry).click();
              await dialog.getByRole('textbox').first().fill('Печать альбома');
              await dialog.getByRole('spinbutton').fill('2400');
              await button(dialog,'Записать оплату').click();
              await dialog.waitFor({state:'hidden'});
              const submitted=await p.evaluate(()=>__submittedFinance);
              assert.equal(submitted.length,1);assert.equal(submitted[0].p_command,'record');
              assert.equal(submitted[0].p_payload.wallet_id,'fixture-safe');
              assert.equal(submitted[0].p_payload.amount,2400);
              assert.equal(submitted[0].p_payload.direction,type==='record-income'?'income':'expense');
            }
          }else if(type!=='refresh'){
            await fw.getByRole('heading',{name:title,exact:true}).waitFor();await checkFocus(title);
            if(type==='accounts')await shot('04-safe-details');
            if(type==='history'||type==='empty'){
              const search=fw.getByRole('searchbox');await search.fill(type==='history'?'Аренда':'Несуществующая запись');
              assert.ok(await (type==='history'?fw.getByRole('heading',{name:'Аренда студии'}):fw.getByText('Операций по запросу нет.')).isVisible());
              if(type==='history'){await search.fill('');await search.blur();await shot('03-journal');}
            }
          }
        }
        goalMs=Date.now()-goalStarted;
        if(!['report','refresh'].includes(type)&&!type.startsWith('record-'))await button(fw,'Операции и планы').click();
        await button(fw,'Финансы').click();
        await checkFocus('Финансы');assert.ok(await fw.getByText('Сейф',{exact:true}).isVisible());
        assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        results.push({task,stepsFromFinanceHome:steps,goalAndChecksMs:goalMs,elapsedMs:Date.now()-start,focusIssues,pass:!focusIssues.length});
      }catch(e){console.error(task,e.message.slice(0,190));results.push({task,stepsFromFinanceHome:steps,pass:false,focusIssues,error:e.message.slice(0,550)})}finally{await p.close()}
    }
    console.log(JSON.stringify({results,errors},null,2));
    assert.ok(results.every(r=>r.pass)&&!errors.length);
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
