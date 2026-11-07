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
  const day=(await db.query("select to_char(clock_timestamp() at time zone 'Europe/Moscow','YYYY-MM-DD') as day")).rows[0].day;
  const owner=async()=>{await db.exec('reset role;set role anon');await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-session-token':token,'x-finance-client':'1'})]);};
  await owner();
  eq((await db.query('select public.get_employee_salary_history() as h')).rows[0].h.employees.length,4);
  const snapshot=async()=>(await db.query('select public.get_financial_journal() as j')).rows[0].j;
  const cmd=async(command,payload,n,revision)=>(await db.query('select public.confirm_finance_workspace($1,$2,$3,$4) as j',[command,payload,id(n),revision??(await snapshot()).revision])).rows[0].j;
  const reverse=async(operation,n)=>(await db.query('select public.confirm_financial_operation($1,$2,$3,$4) as j',['reverse',{operation,reason:'Verified isolated reversal'},id(n),(await snapshot()).revision])).rows[0].j;
  const deny=async fn=>{let error;try{await fn();}catch(e){error=e;}assert(error,'operation must reject');assert(['22023','23514','40001','42501'].includes(error.code),error.message);checks++;};
  let j=await snapshot();
  const wallet=j.workspace.wallets[0].id;
  await cmd('record',{label:'Funding',direction:'income',amount:10000,date:day,wallet_id:wallet,funding:'reserve',certainty:'confirmed',reason:'Isolated test funding'},100);
  await db.query("insert into public.ledger_entries(id,payee_employee_id,type,amount,entry_date,description) values($1,$2,'salary_payment',100,$3::date,'Salary paid [salary:'||left($3::text,7)||'] [funded:0]')",[id(101),id(2),day]);
  j=await snapshot();
  const source=j.operations.find(x=>x.source_id===id(101));
  eq(j.workspace.unmatched.find(x=>x.id===source.id).source_id,id(101));
  eq(j.workspace.unmatched.find(x=>x.id===source.id).source_table,'ledger_entries');
  const plan={label:'Employee obligation',direction:'expense',amount:200,due_date:day,employee_id:id(3),funding:'reserve',certainty:'confirmed',reason:'Verified employee obligation'};
  await cmd('plan',plan,102);
  const beforeMismatch=await snapshot();
  await deny(()=>cmd('link',{source:source.id,key:id(102),amount:100,reason:'Mismatched employee'},103));
  j=await snapshot();eq(j.revision,beforeMismatch.revision);eq(j.workspace.cash,beforeMismatch.workspace.cash);eq(j.workspace.items.find(x=>x.key===id(102)).remaining,200);
  await cmd('plan',{...plan,employee_id:id(2)},104);
  j=await cmd('link',{source:source.id,key:id(104),amount:100,reason:'Matching employee payment'},105);
  const linkedRevision=j.revision;
  eq(j.workspace.items.find(x=>x.key===id(104)).remaining,100);
  j=await cmd('link',{source:source.id,key:id(104),amount:100,reason:'Matching employee payment'},105,0);
  eq(j.revision,linkedRevision);
  await deny(()=>cmd('plan',{...plan,id:id(104),employee_id:id(2),amount:50},106));
  await deny(()=>cmd('plan',{...plan,id:id(104),employee_id:id(4),amount:200},107));
  await cmd('reschedule',{key:id(104),due_date:day,reason:'Confirm the due date'},108);
  j=await snapshot();eq(j.workspace.items.find(x=>x.key===id(104)).amount,200);
  await cmd('unlink',{id:id(105),reason:'Undo only the calendar link'},109);
  await deny(()=>cmd('plan',{...plan,id:id(104),employee_id:id(2),amount:50},110));
  await cmd('plan',{...plan,employee_id:null,label:'Generic unlinked plan'},111);
  j=await cmd('plan',{...plan,id:id(111),employee_id:null,amount:50,label:'Generic unlinked plan'},112);
  eq(j.workspace.items.find(x=>x.key===id(111)).amount,50);

  await db.query("insert into public.company_expenses(id,category,amount,expense_date,description) values($1,'Office',50,$2,'Generic office payment')",[id(113),day]);
  j=await snapshot();const generic=j.operations.find(x=>x.source_id===id(113));
  await deny(()=>cmd('link',{source:generic.id,key:id(102),amount:50,reason:'Generic expense cannot pay employee'},114));
  const beforeGeneric=j.workspace.cash;
  j=await cmd('link',{source:generic.id,key:id(111),amount:50,reason:'Matching office expense'},115);
  eq(j.workspace.cash,beforeGeneric);
  eq(j.workspace.items.some(x=>x.key===id(111)),false);

  await db.query("insert into public.ledger_entries(id,project_id,type,amount,entry_date,description) values($1,$2,'project_expense',100,$3,'Project A expense')",[id(116),id(10),day]);
  j=await snapshot();const projectPayment=j.operations.find(x=>x.source_id===id(116));
  await cmd('plan',{...plan,employee_id:null,project_id:id(11),label:'Project B cost'},117);
  await deny(()=>cmd('link',{source:projectPayment.id,key:id(117),amount:100,reason:'Mismatched project'},118));
  await cmd('plan',{...plan,employee_id:null,project_id:id(10),label:'Project A cost'},119);
  j=await cmd('link',{source:projectPayment.id,key:id(119),amount:100,reason:'Matching project'},120);
  eq(j.workspace.items.find(x=>x.key===id(119)).remaining,100);

  const counters=async()=>(await db.query('select fee_paid::text,co_fee_paid::text from public.projects where id=$1',[id(10)])).rows[0];
  for(const [employee,planId,payId,reverseId,expected] of [[4,121,122,123,{fee_paid:'1000',co_fee_paid:'500'}],[2,124,125,126,{fee_paid:'1300',co_fee_paid:'500'}],[3,127,128,129,{fee_paid:'1000',co_fee_paid:'800'}]]){
   await cmd('plan',{...plan,employee_id:id(employee),project_id:id(10),amount:300,label:'Project fee'},planId);
   const beforePay=(await snapshot()).workspace.cash;
   j=await cmd('pay',{key:id(planId),amount:300,wallet_id:wallet,date:day,reason:'Verified recipient payment'},payId);
   eq(await counters(),expected);
   const operation=j.operations.find(x=>x.source_id===id(payId));
   await reverse(operation.id,reverseId);j=await snapshot();
   eq(await counters(),{fee_paid:'1000',co_fee_paid:'500'});
   eq(j.workspace.cash,beforePay);
   eq(j.workspace.items.find(x=>x.key===id(planId)).remaining,300);
   const revision=j.revision;
   await reverse(operation.id,reverseId);j=await snapshot();eq(j.revision,revision);
   await deny(()=>reverse(operation.id,reverseId+100));
  }

  j=await snapshot();eq(Object.values(j.balances).reduce((sum,n)=>sum+Number(n),0),j.workspace.cash);
  eq(j.workspace.wallets.reduce((sum,w)=>sum+w.balance,0),j.workspace.cash);
  await db.exec('reset role;set role anon');await db.query("select set_config('request.headers','{}',false)");
  await deny(snapshot);

  const code=read('src/features/finance/project-payments.js');
  const context={};vm.createContext(context);
  vm.runInContext(code.slice(code.indexOf('function projectFeePaidField('),code.indexOf('async function savePayment(')),context);
  const project={employee_id:'main',co_employee_id:'co',fee_base:'profit'};
  eq(context.projectFeePaidField(project,{payee_employee_id:'third'}),null);
  eq(context.projectFeePaidField(project,{payee_employee_id:'main'}),'fee_paid');
  eq(context.projectFeePaidField(project,{payee_employee_id:'co'}),'co_fee_paid');
  eq(context.projectFeePaidField(project,{}),'fee_paid');
  eq(context.projectFeePaidField({...project,fee_base:'m2'},{payee_employee_id:'main'}),null);
  console.log(JSON.stringify({passed:checks,failed:[]}));
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
