'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const id=n=>'31000000-0000-4000-8000-'+String(n).padStart(12,'0');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const migrations=fs.readdirSync(path.join(root,'supabase/migrations'));
const fix=migrations.find(name=>name.endsWith('_finance_payment_integrity.sql'));
const token='isolated-payment-integrity-'+'a'.repeat(48);

(async()=>{
 const db=new PGlite();
 await db.waitReady;
 let checks=0;
 const eq=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
 try{
  await db.exec(read('tests/fixtures/session-security-baseline.sql'));
  await db.query("insert into public.employees(id,name,role,is_admin) values ($1,'Мансур','Генеральный директор',true),($2,'Primary','Архитектор',false),($3,'Co-executor','Дизайнер',false),($4,'Third recipient','Визуализатор',false)",[id(1),id(2),id(3),id(4)]);
  await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day')",[id(1),token]);
  await db.query("insert into public.categories(id,name) values($1,'Архитектура')",[id(5)]);
  await db.query("insert into public.statuses(id,name) values($1,'В работе')",[id(6)]);
  await db.query("insert into public.projects(id,name,category_id,status_id,employee_id,co_employee_id,price,fee_base,fee_paid,co_fee_paid) values($1,'Project A',$2,$3,$4,$5,100000,'profit',1000,500),($6,'Project B',$2,$3,$4,$5,100000,'profit',0,0)",[id(10),id(5),id(6),id(2),id(3),id(11)]);
  for(const file of ['supabase/install-owner-access.sql','supabase/financial-journal.sql',
    ...migrations.filter(name=>/^20261030|^20261031|^20261101/.test(name)).sort().map(name=>'supabase/migrations/'+name)])await db.exec(read(file));
  // Exercise the release's real installation order against the same database.
  await db.exec(read('supabase/migrations/'+migrations.find(name=>name.endsWith('_employee_salary_history.sql'))));
  await db.exec(read('supabase/migrations/'+fix));
  await db.exec(read('supabase/migrations/'+fix));

  await db.exec(read('supabase/receipt-timing.sql'));
  const day=(await db.query("select to_char(clock_timestamp() at time zone 'Europe/Moscow','YYYY-MM-DD') as day")).rows[0].day;
  await db.exec('reset role');await db.query("update arhittek_finance.settings set opening_mode='reconciled',active=true,activated_at=$1::date::timestamp at time zone 'Europe/Moscow'",[day]);
  const owner=async()=>{await db.exec('reset role;set role anon');await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-session-token':token,'x-finance-client':'1'})]);};
  await owner();
  const snap=async()=>(await db.query('select public.get_financial_journal() as j')).rows[0].j;
  await db.query("insert into public.ledger_entries(id,project_id,type,amount,entry_date,description) values($1,$2,'advance',50000,$3,'Receipt test')",[id(501),id(10),day]);
  let j=await snap();eq(j.workspace.cash,50000);
  const rev=j.revision, payload={source:id(501),before_start:true,reason:'Previously received before opening'};
  const cmd=async(p,op,version)=>(await db.query("select public.confirm_finance_workspace('correct_receipt',$1,$2,$3) as j",[p,id(op),version??(await snap()).revision])).rows[0].j;
  j=await cmd(payload,502,rev);eq(j.workspace.cash,0);eq(j.balances.amortization,0);
  eq((await db.query("select amount,received_before_start from public.ledger_entries where id=$1",[id(501)])).rows[0],{amount:'50000',received_before_start:true});
  eq((await cmd(payload,502,rev)).revision,j.revision);
  await assert.rejects(()=>cmd({...payload,reason:'Different request'},502,rev));
  await assert.rejects(()=>cmd({...payload,before_start:false,date:day},503,rev));
  j=await cmd({...payload,before_start:false,date:day},504);eq(j.workspace.cash,50000);
  await assert.rejects(()=>db.query("update public.ledger_entries set entry_date=entry_date-1 where id=$1",[id(501)]));
  await db.query("insert into public.ledger_entries(id,project_id,type,amount,entry_date,description,received_before_start) values($1,$2,'advance',7000,$3,'Earlier receipt',true)",[id(505),id(10),day]);
  eq((await snap()).workspace.cash,50000);
  const earlier=(await db.query("select ($1::date-2)::text as d",[day])).rows[0].d;
  await db.query("insert into public.ledger_entries(id,project_id,type,amount,entry_date,description) values($1,$2,'advance',9000,$3,'Known earlier receipt')",[id(506),id(10),earlier]);
  eq((await snap()).workspace.cash,50000);
  await db.query("select set_config('request.headers','{}',false)");
  await assert.rejects(()=>cmd(payload,507));
  console.log('Receipt corrections: cash, original source, retry, stale revision, tamper denial, prior receipts and access passed');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
