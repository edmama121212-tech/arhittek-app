'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID,createHash} = require('node:crypto');
const {PGlite} = require('@electric-sql/pglite');
const root = path.resolve(__dirname,'..');
const read = file=>fs.readFileSync(path.join(root,file),'utf8');
const patch = 'supabase/migrations/20261120020000_finance_spending_limits.sql';

(async()=>{
  const db = new PGlite();
  await db.waitReady;
  const row = async(sql,args=[]) => (await db.query(sql,args)).rows[0];
  const apply = file => db.exec(read(file));
  const owner=randomUUID(),project=randomUUID(),other=randomUUID(),token='spending-test-'+'q'.repeat(55);
  const journal=async()=>(await row('select public.get_financial_journal() as j')).j;
  const workspace=async(name,payload,id=randomUUID(),revision)=> (await row(
    'select public.confirm_finance_workspace($1,$2,$3,$4) as j',[name,{reason:'Испытание ограничения',...payload},id,revision??(await journal()).revision])).j;
  const operation=async(name,payload,id=randomUUID())=>(await row(
    'select public.confirm_financial_operation($1,$2,$3,$4) as j',[name,{reason:'Испытание ограничения',...payload},id,(await journal()).revision])).j;
  const signature=async()=>{
    // Inspect rollback across private tables as the test fixture's owner.
    await db.exec('reset role');
    try{
      const tables=['arhittek_finance.operations','arhittek_finance.wallet_entries','arhittek_finance.settlements',
        'arhittek_finance.workspace_requests','arhittek_finance.plans','arhittek_finance.plan_history',
        'arhittek_finance.settings','public.ledger_entries','public.company_income','public.company_expenses','public.projects'];
      const result=[];
      for(const table of tables)result.push((await row('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t))::text,\'\')) as digest from '+table+' t')).digest);
      return result;
    }finally{await db.exec('set role anon');}
  };
  const deny=async(run,expected,code='23514')=>{
    const before=await signature();
    await db.exec('savepoint rejected_action');
    let error;
    try{await run();}catch(e){error=e;}
    await db.exec('rollback to savepoint rejected_action');
    await db.exec('release savepoint rejected_action');
    assert.ok(error,'Ожидался отказ сервера');
    assert.equal(error.code,code,error.message);
    assert.match(error.message,expected);
    assert.deepEqual(await signature(),before,'Поля и суммы после отказа');
  };
  let count=0,day,wallet;
  const results=[];
  const hash=createHash('sha256').update(read(patch)).digest('hex').slice(0,12);
  const check=async(title,run)=>{
    await db.exec('begin');
    const start=performance.now();
    try{
      await run();
      results.push([hash,title,Math.round(performance.now()-start),'Прошло']);
      console.log(++count,title);
    }finally{await db.exec('rollback');}
  };
  const expense=(a,id=randomUUID(),description='Расход без проекта')=>db.query(
    'insert into public.company_expenses(id,amount,expense_date,category,description) values($1,$2,$3,$4,$5)',[id,a,day,'Материалы',description]);
  const income=(a)=>db.query('insert into public.company_income(amount,income_date,category,description) values($1,$2,$3,$4)',[a,day,'Доход','Поступление компании']);
  const ledger=(type,a,p=project)=>db.query('insert into public.ledger_entries(project_id,type,amount,entry_date,description) values($1,$2,$3,$4,$5)',[p,type,a,day,'Проверка карточки']);
  const plan=(amount,obligation=false)=>({label:'План проверки',direction:'expense',amount,funding:'reserve',certainty:'confirmed',due_date:day,obligation});
  const getReserve=async()=>Number((await journal()).balances.reserve||0);
  const walletBalance=async(id)=>Number((await journal()).workspace.wallets.find(w=>w.id===id).balance);
  const spendErr=/Недостаточно свободных денег/;
  try{
    await apply('tests/fixtures/session-security-baseline.sql');
    await db.query("insert into public.employees(id,name,is_admin) values($1,'Мансур',true)",[owner]);
    await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '2 hour')",[owner,token]);
    await db.query("insert into public.projects(id,name,price,balance) values($1,'Объект А',1000,1000),($2,'Объект Б',1000,1000)",[project,other]);
    for(const file of ['supabase/install-owner-access.sql','supabase/financial-journal.sql','supabase/lead-projects-reserve.sql',
      ...fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>/finance_workspace|finance_zero_start|project_completion_accrual|finance_payment_integrity|company_safe_name|recurring_replacement/.test(n)).sort().map(n=>'supabase/migrations/'+n),
      'supabase/receipt-timing.sql'])await apply(file);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-session-token':token,'x-finance-client':'1'})]);
    await db.exec('set role anon');
    await check('Первоначальный пересчёт признаёт непокрытое резервирование при реальном остатке',async()=>{
      // A second installation mode, in a transaction which is rolled back completely.
      await db.exec('reset role');
      await db.exec("update arhittek_finance.settings set opening_mode='reconciled' where singleton");
      await db.exec(read(patch).replace(/^begin;/,'').replace(/commit;\s*$/,''));
      await db.exec('set role anon');
      const j=await journal();
      assert.equal(j.active,false);
      await operation('activate',{cash:20,amortization:25,projects:[],fingerprint:j.fingerprint,confirmed:true});
      assert.equal(await getReserve(),-5);
      assert.equal(Number((await journal()).workspace.cash),20);
    });
    const first=await journal();
    day=first.workspace.as_of;
    wallet=first.workspace.wallets.find(w=>w.is_default).id;

    // Create an authentic negative reserve with the previous release, then install
    // twice and compare the rows. The test database is discarded after this run.
    await ledger('advance',100);
    await expense(12);
    assert.equal(await getReserve(),-12);
    const legacy=await signature();
    await db.exec('reset role');
    await apply(patch);await apply(patch);
    await db.exec('set role anon');
    assert.deepEqual(await signature(),legacy);
    await check('Исторический минус: частичное пополнение, отказ в углублении и восстановление',async()=>{
      await income(5);assert.equal(await getReserve(),-7.25);
      await deny(()=>expense(0.01),spendErr);
      await income(10);assert.equal(await getReserve(),2.25);
    });
    await check('Фактический пересчёт меньше при уже отрицательном резерве',async()=>{
      const cash=await walletBalance(wallet);
      await workspace('wallet_reconcile',{wallet_id:wallet,target:cash-5,confirmed:true});
      assert.equal(await walletBalance(wallet),cash-5);
      assert.equal(await getReserve(),-17);
      await deny(()=>expense(0.01),spendErr);
      assert.equal((await journal()).operations[0].kind,'wallet_reconcile');
    });
    await check('Запрет отрицательной цели даже при приближении к нулю',async()=>{
      await deny(()=>workspace('reserve_adjust',{wallet_id:wallet,target:-3,confirmed:true}),/не меньше нуля/,'22023');
      await deny(()=>operation('adjust_reserve',{target:-3,confirmed:true}),/не меньше нуля/,'22023');
      await deny(()=>workspace('wallet_reconcile',{wallet_id:wallet,target:-1,confirmed:true}),/не меньше нуля/,'22023');
      await workspace('reserve_adjust',{wallet_id:wallet,target:0,confirmed:true});
      assert.equal(await getReserve(),0);
    });
    // Clear the carried shortfall through an explicit correction for the rest of the matrix.
    await workspace('reserve_adjust',{wallet_id:wallet,target:0,confirmed:true});
    await check('Корпоративный расход: 0 свободных денег, имя сверки не даёт права на списание',async()=>{
      await deny(()=>expense(0.01,randomUUID(),'wallet_reconcile'),spendErr);
      await deny(()=>expense(0.01,randomUUID(),'Подтверждённая сверка сейфа'),spendErr);
    });
    await check('Корпоративный расход: ровно доступно, копейка сверх',async()=>{
      await income(10);
      await deny(()=>expense(9.51),spendErr);
      await expense(9.50);assert.equal(await getReserve(),0);
    });
    await check('Расход карточки: деньги другого проекта и амортизация защищены',async()=>{
      await deny(()=>ledger('project_expense',0.01,other),spendErr);
      await deny(()=>ledger('project_expense',95.01),spendErr);
      await ledger('project_expense',95);
      assert.equal(Number((await journal()).balances['project:'+project]),0);
    });
    await check('Частичное финансирование карточки из её проекта и остатка компании',async()=>{
      await income(20);
      await deny(()=>ledger('project_expense',114.01),spendErr);
      await ledger('project_expense',114);
      assert.equal(await getReserve(),0);
    });
    await check('Возврат клиенту разрешён в пределах доступного, его отмена восполняет кассу',async()=>{
      await deny(()=>ledger('client_refund',95.01),spendErr);
      await ledger('client_refund',95);
      const j=await journal();
      await operation('reverse',{operation:j.operations[0].id});
      assert.equal(Number((await journal()).balances['project:'+project]),95);
    });
    await check('Внутренний перевод из резерва и резервирование долга не могут образовать дефицит',async()=>{
      await deny(()=>operation('transfer',{from:'reserve',to:'amortization',amount:0.01}),/Недостаточно свободного резерва/);
      await deny(()=>operation('transfer',{from:'amortization',to:'reserve',amount:5.01}),/Недостаточно средств/);
      await deny(()=>workspace('plan',plan(0.01,true)),spendErr);
      await operation('transfer',{from:'amortization',to:'reserve',amount:5});
      await workspace('plan',plan(5,true));
      assert.equal(await getReserve(),0);
    });
    await check('Частичная оплата плана: отказ атомарен, повтор UUID списывает один раз',async()=>{
      await income(20);
      const id=randomUUID(),op=randomUUID(),args={key:id,amount:10,wallet_id:wallet,date:day};
      await workspace('plan',plan(40),id);
      const rev=(await journal()).revision;
      await workspace('pay',args,op,rev);
      const after=await signature();
      await workspace('pay',args,op,rev);
      assert.deepEqual(await signature(),after);
      await deny(()=>workspace('pay',{...args,amount:9.01}),spendErr);
      assert.equal(Number((await journal()).workspace.items.find(x=>x.key===id).remaining),30);
      await workspace('pay',{...args,amount:9});
      assert.equal(Number((await journal()).workspace.items.find(x=>x.key===id).remaining),21);
    });
    await check('Зарегистрировать и оплатить сразу: при отказе нет плана, источника, проводки или запроса',async()=>{
      await deny(()=>workspace('record',{...plan(1),date:day,wallet_id:wallet}),spendErr);
    });
    await check('Кошельки: дебет пустого места при достаточном резерве, перевод и ровно доступная выплата',async()=>{
      await income(40);
      const bank=randomUUID();
      await workspace('wallet',{name:'Банк',kind:'bank'},bank);
      await deny(()=>workspace('record',{...plan(5),date:day,wallet_id:bank}),/Недостаточно денег в месте хранения/);
      await deny(()=>workspace('wallet_transfer',{from:bank,to:wallet,amount:0.01}),/доступную сумму/);
      await workspace('wallet_transfer',{from:wallet,to:bank,amount:5});
      await workspace('record',{...plan(5),date:day,wallet_id:bank});
      assert.equal(await walletBalance(bank),0);
    });
    await check('Подтверждённая сверка обнаруживает первый разрыв, в том числе при пересчёте до нуля',async()=>{
      await income(10);
      assert.equal(await getReserve(),9.5);
      await workspace('wallet_reconcile',{wallet_id:wallet,target:0,confirmed:true});
      assert.equal(await walletBalance(wallet),0);
      assert.ok(await getReserve()<0);
      await deny(()=>expense(1),spendErr);
    });
    await check('Исторический минус в отдельном месте: частичное пополнение разрешено, расход запрещён',async()=>{
      const bank=randomUUID();
      await workspace('wallet',{name:'Исторический кошелёк',kind:'bank'},bank);
      // Private fixture models imported wallet balances that predate this guard.
      // The paired entries preserve company cash and the journal/physical sum.
      await db.exec('reset role');
      await db.query('insert into arhittek_finance.wallet_entries(request_id,wallet_id,amount) values($1,$2,-10),($1,$3,10)',
        [randomUUID(),bank,wallet]);
      await db.exec('set role anon');
      await workspace('record',{label:'Наличное пополнение',direction:'income',amount:4,date:day,wallet_id:bank,funding:'reserve',certainty:'confirmed'});
      assert.equal(await walletBalance(bank),-6);
      await deny(()=>workspace('record',{...plan(1),date:day,wallet_id:bank}),/Недостаточно денег в месте хранения/);
      await workspace('wallet_transfer',{from:wallet,to:bank,amount:6});
      assert.equal(await walletBalance(bank),0);
    });
    await check('Старая подтверждённая сверка всех денег фиксирует непокрытые назначения',async()=>{
      await operation('reconcile',{cash:2,confirmed:true});
      assert.equal(await walletBalance(wallet),2);
      assert.ok(await getReserve()<0);
    });
    await check('Конкурирующие версии: устаревшая вторая оплата после первого списания отклонена',async()=>{
      await income(10);
      const rev=(await journal()).revision;
      const args={...plan(8),date:day,wallet_id:wallet};
      await workspace('record',args,randomUUID(),rev);
      await deny(()=>workspace('record',args,randomUUID(),rev),/изменил/,'40001');
      await deny(()=>workspace('record',args),spendErr);
    });
    console.log('Проверено сценариев:',count);
    if(process.env.SPENDING_LIMIT_QA_OUTPUT){
      const rows=[['Миграция SHA256','Сценарий SQL · PGlite','Время с проверками и снимками, мс','Результат'],...results];
      fs.writeFileSync(process.env.SPENDING_LIMIT_QA_OUTPUT,'\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
    }
  }finally{await db.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
