'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { chromium } = require('playwright');
const root = path.resolve(__dirname,'..');
const output = process.env.SAFE_QA_OUTPUT;
const width = Number(process.env.SAFE_QA_WIDTH || 390);
const uuid = n => '74100000-0000-4000-8000-'+String(n).padStart(12,'0');
const cents = n => Math.round(Number(n)*100);
const rubles = text => Number(text.replace(/[^\d,−-]/g,'').replace('−','-').replace(',','.'));
const cases = [
  ['SAFE-01','Оприходовать излишек после пересчёта','50200.10','commit'],
  ['SAFE-02','Зафиксировать недостачу','49500.50','commit'],
  ['SAFE-03','Подтвердить совпадающий остаток без второй проводки','49500.50','same'],
  ['SAFE-04','Остановить отрицательный фактический остаток','-1','negative'],
  ['SAFE-05','Не принять пустую сумму за ноль','','missing'],
  ['SAFE-06','Отложить неподтверждённый пересчёт','48900','unchecked'],
  ['SAFE-07','Уточнить основание и подтвердить без повторного ввода суммы','49000','reason'],
  ['SAFE-08','Отказаться от несогласованной корректировки','30500','cancel'],
  ['SAFE-09','Учесть расхождение в одну копейку','49000.01','commit'],
  ['SAFE-10','Внести фактически пустой сейф при наличии обязательства','0','commit'],
  ['SAFE-11','Восстановить подтверждение после потери ответа','6000','lost'],
  ['SAFE-12','Перепроверить результат в другой вкладке','6055.55','other']
];
(async()=>{
 const db=new PGlite();
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const errors=[],evidence=[],hashes={};
 try{
  if(output)fs.mkdirSync(output,{recursive:true});
  const read=name=>fs.readFileSync(path.join(root,name),'utf8');
  await db.exec(read('tests/fixtures/session-security-baseline.sql'));
  const token='qa-offline-safe-'+'a'.repeat(48);
  await db.query("insert into public.employees(id,name,role,is_admin) values($1,'Мансур','Директор',true)",[uuid(1)]);
  await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day')",[uuid(1),token]);
  const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>/finance_|project_completion_accrual|employee_salary_history|company_safe_name/.test(n));
  for(const file of ['supabase/install-owner-access.sql','supabase/financial-journal.sql',...migrations.sort().map(n=>'supabase/migrations/'+n)]){
    await db.exec(read(file));
  }
  await db.exec('set role anon');
  await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-session-token':token,'x-finance-client':'1'})]);
  const snapshot=async()=>(await db.query('select public.get_financial_journal() as j')).rows[0].j;
  const command=async(name,data,id,rev)=>(await db.query('select public.confirm_finance_workspace($1,$2,$3,$4) as j',[name,data,id,rev])).rows[0].j;
  const initial=await snapshot(),wallet=initial.workspace.wallets.find(w=>w.is_default).id,day=initial.workspace.as_of;
  const cash=await command('record',{direction:'income',label:'Начальный сейф',amount:50000,date:day,wallet_id:wallet,funding:'reserve',certainty:'confirmed',reason:'Тестовая наличность'},uuid(2),initial.revision);
  await command('plan',{direction:'expense',label:'Печать проекта',amount:1000,due_date:day,funding:'reserve',certainty:'confirmed',obligation:true,reason:'Тестовое обязательство'},uuid(3),cash.revision);
  const ctx=await browser.newContext({viewport:{width,height:844},locale:'ru-RU',reducedMotion:'reduce',serviceWorkers:'block'});
  await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
  await ctx.route('**/*',route=>{
    const u=new URL(route.request().url());
    const file=u.hostname==='safe.test'?path.join(root,u.pathname==='/'?'index.html':u.pathname.slice(1)):null;
    if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({body:'',contentType:'text/javascript'});
    if(['index.html','finance-workspace.js'].includes(path.basename(file))){
      const body=fs.readFileSync(file);
      hashes[path.basename(file)]=crypto.createHash('sha256').update(body).digest('hex').slice(0,16);
      return route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':'text/html'});
    }
    return route.fulfill({path:file});
  });
  const calls=[];
  await ctx.exposeFunction('safeRpc',async(name,args={})=>{
    try{
      if(name==='get_financial_journal')return {data:await snapshot(),error:null};
      calls.push(structuredClone(args));
      return {data:await command(args.p_command,args.p_payload,args.p_operation,args.p_revision),error:null};
    }catch(e){return {data:null,error:{code:e.code,message:e.message}};}
  });
  await ctx.addInitScript({content:`
    document.addEventListener('DOMContentLoaded',()=>{
      if(typeof sb==='undefined')return;
      const rpc=sb.rpc.bind(sb);
      sb.rpc=async(name,args)=>{
        if(!['get_financial_journal','confirm_finance_workspace'].includes(name))return rpc(name,args);
        const result=await safeRpc(name,args);
        if(window.dropSafeReply&&name==='confirm_finance_workspace'&&!result.error){window.dropSafeReply=false;return {data:null,error:{message:'Ответ на сверку не получен'}};}
        return result;
      };
    });
  `});
  const openPage=async()=>{
    const page=await ctx.newPage();
    page.setDefaultTimeout(6500);page.on('pageerror',e=>errors.push(e.message));
    await page.goto('https://safe.test/');
    await page.waitForFunction(()=>state.financialDataReady&&!loadAllInFlight);
    await page.evaluate(()=>loadAll());
    await page.locator('.bottom-nav').getByRole('button',{name:/^Финансы/}).click();
    return page;
  };
  const page=await openPage(),fw=page.locator('#financeWorkspace');
  const tile=p=>p.locator('.studio-money-grid article').first().locator('strong');
  const btn=(el,name)=>el.getByRole('button',{name,exact:true});
  const frames=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(performance.now())))));
  const shot=async(page,id)=>{if(output)await page.screenshot({path:path.join(output,id+'.png')});};
  for(const [id,task,target,kind] of cases){
    const before=await snapshot(),start=cents(before.workspace.cash),n=calls.length;
    assert.equal(cents(rubles(await tile(page).innerText())),start);
    assert.equal(await fw.locator('.studio-money-grid article').first().locator('small').innerText(),'По учёту');
    await fw.getByRole('button',{name:/Ещё/}).click();await btn(fw,'Сейф').click();
    const opener=btn(fw,'Сверить сейф');
    await opener.evaluate(e=>e.addEventListener('click',()=>window.safeOpen=performance.now(),{once:true,capture:true}));
    await opener.click();
    const dialog=page.getByRole('dialog'),number=dialog.getByRole('spinbutton'),reason=dialog.getByLabel('Основание операции'),confirmed=dialog.getByRole('checkbox');
    await dialog.waitFor();
    const openMs=Math.round((await frames(page))-await page.evaluate(()=>safeOpen));
    assert.ok(await dialog.getByText(/Сейф ·/).isVisible());
    assert.equal(await dialog.getByRole('combobox').count(),0);
    const geometry=await dialog.evaluate(el=>[el,...el.querySelectorAll('input:not([type="hidden"]),button')].every(n=>{const b=n.getBoundingClientRect();return b.left>=-1&&b.right<=innerWidth+1&&b.width>0}));
    assert.ok(geometry);
    assert.ok(await dialog.getByRole('heading',{name:'Сверка сейфа',exact:true}).isVisible());
    const confirmationBox=await confirmed.evaluate(el=>{
      const mark=el.getBoundingClientRect(),label=el.closest('label').getBoundingClientRect();
      return {mark:mark.width,row:label.height,aligned:Math.abs(label.left-mark.left)<=1};
    });
    assert.ok(confirmationBox.mark<=24&&confirmationBox.row>=44&&confirmationBox.aligned);
    await number.fill(target);await reason.fill(kind==='reason'?'ДО':task);
    const preview=dialog.locator('[data-fw-count-preview]');
    if(target===''||Number(target)<0){
      assert.equal(await preview.isVisible(),false);
    }else{
      const delta=cents(target)-start;
      const description=await preview.innerText();
      if(delta===0)assert.equal(description,'Пересчёт совпадает с учётом.');
      else{
        assert.ok(description.includes(delta<0?'меньше на':'больше на'));
        assert.equal(cents(rubles(description)),Math.abs(delta));
      }
    }
    assert.equal(calls.length,n,'Предпросмотр не должен проводить сверку');
    if(kind!=='unchecked')await confirmed.check();
    if(kind==='lost')await page.evaluate(()=>window.dropSafeReply=true);
    await shot(page,id+'-form');
    const submit=btn(dialog,'Подтвердить');
    const trigger=kind==='cancel'?btn(dialog,'Закрыть'):submit;
    await trigger.evaluate(b=>b.addEventListener('click',()=>window.safeSubmit=performance.now(),{capture:true,once:true}));
    await trigger.click();
    let observation='',success=['commit','reason','lost','other'].includes(kind);
    if(['same','missing','reason','lost'].includes(kind)){
      const alert=dialog.getByRole('alert');
      const expected={same:'Сумма уже совпадает',missing:'Введите фактическую сумму',reason:'Укажите основание',lost:'Ответ на сверку не получен'}[kind];
      await page.waitForFunction(t=>document.querySelector('#financeWorkspaceModal [role="alert"]')?.textContent.includes(t),expected);
      observation=await alert.innerText();
      assert.equal(await number.inputValue(),target);
    }
    if(['negative','unchecked'].includes(kind)){
      assert.ok(await dialog.isVisible());
      const field=kind==='negative'?number:confirmed;
      assert.equal(await field.evaluate(el=>el.validity.valid),false);
      assert.equal(await field.evaluate(el=>el===document.activeElement),true);
      observation=kind==='negative'?'Остановлен отрицательный ввод':'Запрошено подтверждение пересчёта';
    }
    let responseMs=null;
    if(observation)responseMs=Math.round((await frames(page))-await page.evaluate(()=>safeSubmit));
    if(kind==='reason'){
      await reason.fill(task);
      await submit.click();
    }else if(kind==='lost'){
      await btn(dialog,'Закрыть').click();
      assert.equal((await snapshot()).revision,before.revision+1);
      await btn(fw,'Проверить').click();
      await page.waitForFunction(()=>!document.querySelector('#financeWorkspace .fw-warning'));
    }else if(observation){
      await btn(dialog,'Закрыть').click();
    }
    await dialog.waitFor({state:'hidden'});
    const doneMs=Math.round((await frames(page))-await page.evaluate(()=>safeSubmit));
    await shot(page,id+'-result');
    const after=await snapshot(),end=success?cents(target):start,delta=end-start;
    assert.equal(cents(after.workspace.cash),end);
    assert.equal(cents(after.workspace.wallets.find(w=>w.is_default).balance),end);
    assert.equal(cents(after.workspace.reserve),cents(before.workspace.reserve)+delta);
    assert.equal(after.revision,before.revision+(success?1:0));
    for(const [key,value] of Object.entries(before.balances))if(key!=='reserve')assert.equal(after.balances[key],value);
    assert.equal(after.balances['obligation:'+uuid(3)],1000);
    assert.deepEqual(after.workspace.items,before.workspace.items);
    assert.equal(cents(rubles(await fw.locator('.fw-row').first().locator('strong').innerText())),end);
    const formCalls=calls.slice(n);
    assert.equal(formCalls.length,kind==='same'?1:kind==='lost'?2:success?1:0);
    if(kind==='lost')assert.deepEqual(formCalls[0],formCalls[1]);
    if(success) {
      assert.equal(formCalls[0].p_command,'wallet_reconcile');
      assert.equal(formCalls[0].p_payload.wallet_id,wallet);
      await btn(fw,'Операции и планы').click();await btn(fw,'История операций').click();
      const card=fw.locator('[data-fw-operation]').filter({has:page.getByRole('heading',{name:task,exact:true})});
      assert.equal(await card.count(),1);
      assert.equal(cents(await card.getAttribute('data-fw-delta')),delta);
      const signedReserve=cents(before.workspace.reserve)+delta;
      const free=card.locator('.fw-row').filter({hasText:'Свободно для расходов'}).locator('strong');
      const deficit=card.locator('.fw-row').filter({hasText:'Не покрыто деньгами'}).locator('strong');
      assert.equal(cents(rubles(await free.innerText())),Math.max(0,signedReserve));
      assert.equal(await deficit.count(),signedReserve<0?1:0);
      if(signedReserve<0)assert.equal(cents(rubles(await deficit.innerText())),-signedReserve);
    }
    await btn(fw,'Финансы').click();
    assert.equal(cents(rubles(await tile(page).innerText())),end);
    if(kind==='other'){
      const secondary=await openPage();
      assert.equal(cents(rubles(await tile(secondary).innerText())),end);
      await secondary.close();
    }
    evidence.push({id,task,target,kind,start:start/100,end:end/100,delta:delta/100,reserve:(cents(before.workspace.reserve)+delta)/100,revisionBefore:before.revision,revisionAfter:after.revision,openMs,responseMs,doneMs,observation,geometry,confirmationBox,commands:formCalls.length});
    console.log(id,start/100,end/100,openMs,doneMs);
  }
  assert.deepEqual(errors,[]);
  if(output)fs.writeFileSync(path.join(output,'run.json'),JSON.stringify({width,browser:browser.version(),hashes,evidence},null,2));
 }finally{await browser.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
