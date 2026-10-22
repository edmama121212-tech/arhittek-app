const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const U=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
const db=new PGlite();await db.waitReady;let checks=0;
await db.exec(fs.readFileSync('tests/fixtures/session-security-baseline.sql','utf8'));
await db.query("insert into public.employees(id,name,role,is_admin) values($1,'Мансур','Генеральный директор',true),($2,'Employee','Архитектор',false)",[U(1),U(2)]);
const token=n=>'isolated-finance-token-'+String(n).repeat(48);
await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day'),($3,$4,now()+interval '1 day')",[U(1),token(1),U(2),token(2)]);
await db.query("insert into public.categories(id,name) values($1,'Архитектура'),($2,'Строительство')",[U(3),U(4)]);
await db.query("insert into public.statuses(id,name) values($1,'Завершён'),($2,'В работе')",[U(5),U(6)]);
await db.query("insert into public.projects(id,name,category_id,status_id,employee_id,price) values($1,'Design',$2,$3,$4,100000),($5,'Build',$6,$7,$4,500000)",[U(10),U(3),U(5),U(2),U(11),U(4),U(6)]);
await db.exec(fs.readFileSync('supabase/install-owner-access.sql','utf8'));
await db.exec(fs.readFileSync('supabase/financial-journal.sql','utf8'));
await db.exec(fs.readFileSync('supabase/financial-journal.sql','utf8'));
async function role(n,header=true){await db.exec('reset role;set role anon');await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-session-token':token(n),...(header?{'x-finance-client':'1'}:{})})]);}
async function denied(fn,codes=['42501','22023','23514','40001']){let e;try{await fn()}catch(x){e=x}assert.ok(e,'must reject');assert.ok(codes.includes(e.code),e.code+': '+e.message);checks++}
const snapshot=async()=>(await db.query('select public.get_financial_journal() j')).rows[0].j;
const cmd=(c,p,id,rev)=>db.query('select public.confirm_financial_operation($1,$2,$3,$4) j',[c,p,U(id),rev]);
const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
await role(2);await denied(snapshot);await denied(()=>cmd('activate',{},20,0));await role(0);await denied(snapshot);
await role(1);let snap=await snapshot();eq(snap.active,false);
const opening={reason:'Actual count confirmed',confirmed:true,fingerprint:snap.fingerprint,cash:100000,amortization:5000,projects:[{id:U(10),funds:60000,costs:0,team:[]},{id:U(11),funds:10000,costs:0,team:[]}]};
await denied(()=>cmd('activate',{...opening,fingerprint:'stale'},20,0));await denied(()=>cmd('activate',{...opening,confirmed:null},20,0));await cmd('activate',opening,20,0);eq((await snapshot()).balances.reserve,25000);
await cmd('activate',opening,20,0);eq((await snapshot()).revision,1);await denied(()=>cmd('activate',{...opening,cash:200000},20,0));
const before=await snapshot();await db.query("update public.projects set name='Renamed',end_date=current_date+10,notes='Note',price=200000 where id=$1",[U(10)]);eq((await snapshot()).balances,before.balances);
let review=(await db.query('select public.review_financial_project($1) j',[U(10)])).rows[0].j;
const close={reason:'Close after review',project:U(10),project_fingerprint:review.fingerprint,costs:10000,team:[{employee:U(2),month:'2026-10',amount:20000}]};
await denied(()=>cmd('close',{...close,project_fingerprint:'stale'},21,1));await cmd('close',close,21,1);eq((await snapshot()).balances.reserve,55000);await cmd('close',close,21,1);eq((await snapshot()).revision,2);
const today=(await db.query("select timezone('Europe/Moscow',now())::date::text d")).rows[0].d;
const ledger=(id,p,t,a,emp,desc)=>db.query('insert into public.ledger_entries(id,project_id,type,amount,entry_date,payee_employee_id,description) values($1,$2,$3,$4,$5,$6,$7)',[U(id),p,t,a,today,emp,desc]);
await ledger(30,U(10),'fee_payment',10000,U(2),'Fee payment');eq((await snapshot()).balances.reserve,55000);
await denied(()=>ledger(40,U(10),'fee_payment',100,null,'Missing employee'));
await denied(()=>ledger(41,null,'salary_payment',1000,U(2),'[salary:2026-10] No allocation'));
await ledger(31,null,'salary_payment',15000,U(2),'[salary:2026-10] [funded:5000] Salary plus fee');snap=await snapshot();eq(snap.balances.reserve,45000);eq(snap.balances['team:'+U(10)+':'+U(2)+':2026-10'],5000);
await ledger(32,U(10),'expense',10000,null,'Already reserved costs');eq((await snapshot()).balances.reserve,45000);
await ledger(33,U(11),'advance',20000,null,'Construction receipt');snap=await snapshot();eq(snap.balances.reserve,45000);eq(snap.balances['project:'+U(11)],30000);eq(snap.balances.amortization,5000);
await db.query('update public.projects set status_id=$1,category_id=$2 where id=$3',[U(5),U(3),U(11)]);eq((await snapshot()).balances,snap.balances);
await ledger(34,U(11),'advance',10000,null,'Construction classification frozen');snap=await snapshot();eq(snap.balances.amortization,5000);await denied(()=>cmd('close',{...close,project:U(11)},22,snap.revision));
await db.query("insert into public.company_income(id,category,amount,income_date,description) values($1,'Other',10000,$2,'Other income')",[U(35),today]);snap=await snapshot();eq(snap.balances.reserve,54500);eq(snap.balances.amortization,5500);
await denied(()=>db.query('update public.company_income set amount=999 where id=$1',[U(35)]));await denied(()=>db.query('delete from public.company_income where id=$1',[U(35)]));await denied(()=>db.query('update arhittek_finance.operations set reason=$1',['rewrite']));
const receipt=snap.operations.find(o=>o.source_id===U(35));await cmd('reverse',{reason:'Wrong income record',operation:receipt.id},23,snap.revision);snap=await snapshot();eq(snap.balances.reserve,45000);eq(snap.balances.amortization,5000);
await denied(()=>cmd('reverse',{reason:'Again',operation:receipt.id},24,snap.revision));await denied(()=>cmd('reverse',{reason:'Dependent payments',operation:U(21)},25,snap.revision));
await role(1,false);await denied(()=>db.query("insert into public.company_expenses(category,amount,expense_date) values('Cached old app',100,$1)",[today]));await role(1);
for(const amount of ['0.001','NaN','Infinity','-1'])await denied(()=>db.query("insert into public.company_expenses(category,amount,expense_date) values('Invalid',$1,$2)",[amount,today]));
await denied(()=>db.query("insert into public.company_expenses(category,amount,expense_date) values('Future',100,'2099-01-01')"));await denied(()=>cmd('transfer',{reason:'Bad allocation',from:'reserve',to:'amortization',amount:1},26,0));
snap=await snapshot();eq(Object.values(snap.balances).reduce((a,b)=>a+Number(b),0),snap.operations.reduce((a,b)=>a+Number(b.cash_delta),0));
// Reconciliation is explicit and zero-sum transfers do not manufacture cash.
snap=await snapshot();const beforeTransfer=Object.values(snap.balances).reduce((a,b)=>a+Number(b),0);
await cmd('transfer',{reason:'Company remuneration approved',from:'project:'+U(11),to:'reserve',amount:5000},60,snap.revision);snap=await snapshot();eq(Object.values(snap.balances).reduce((a,b)=>a+Number(b),0),beforeTransfer);eq(snap.balances.reserve,50000);
await cmd('reconcile',{reason:'Cash and bank count verified',confirmed:true,cash:90000},61,snap.revision);snap=await snapshot();eq(Object.values(snap.balances).reduce((a,b)=>a+Number(b),0),90000);
const reverseTarget=snap.operations.find(o=>o.source_id===U(30));await cmd('reverse',{reason:'Wrong employee payment',operation:reverseTarget.id},62,snap.revision);snap=await snapshot();eq(snap.balances['team:'+U(10)+':'+U(2)+':2026-10'],15000);
eq((await db.query('select deleted_at is not null canceled from public.ledger_entries where id=$1',[U(30)])).rows[0].canceled,true);
// Unrelated invoice and accrual edits cannot alter a fixed balance.
const fixed=snap.balances;await db.query("insert into public.invoices(project_id,amount,description) values($1,99999,'Accrual only')",[U(11)]);await ledger(70,U(10),'role_payout',5000,U(2),'Accrual only');eq((await snapshot()).balances,fixed);
await role(2);await denied(snapshot);await denied(()=>db.query("insert into public.company_expenses(category,amount,expense_date) values('Staff',1,current_date)"));
console.log(checks+' financial journal invariants passed');await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
