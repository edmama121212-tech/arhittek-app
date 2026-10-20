// Isolated PostgreSQL transaction/constraint tests. Concurrent promises submit
// separate autocommit RPC statements to PGlite's one PostgreSQL connection;
// this is not a claim of a real two-device/multi-backend network test.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const T={admin:'isolated-admin-token-with-sixty-four-characters-000000000000000001',staff:'isolated-staff-token-with-sixty-four-characters-000000000000000002'};
(async()=>{
 const db=new PGlite();await db.waitReady;const results=[];
 await db.exec(fs.readFileSync(path.join(root,'tests/fixtures/session-security-baseline.sql'),'utf8'));
 await db.query("insert into public.employees(id,name,role,is_admin,can_see_construction) values($1,'Admin','CEO',true,true),($2,'Foreman','Прораб',false,true)",[U(1),U(2)]);
 await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day'),($3,$4,now()+interval '1 day')",[U(1),T.admin,U(2),T.staff]);
 await db.query("insert into public.categories(id,name) values($1,'Ремонт')",[U(10)]);
 await db.query("insert into public.projects(id,name,category_id,employee_id) values($1,'Object A',$2,$3),($4,'Object B',$2,$3)",[U(20),U(10),U(2),U(21)]);
 await db.query("insert into public.invoices(id,project_id,amount,description,paid_by_client) values($1,$2,30000,'Materials A',false),($3,$4,30000,'Materials B',false),($5,$2,30000,'Direct client payment',true)",[U(30),U(20),U(31),U(21),U(32)]);
 await db.exec(fs.readFileSync(path.join(root,'supabase/session-security.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/invoice-payment-atomic.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/invoice-payment-atomic.sql'),'utf8'));
 const today=(await db.query("select timezone('Europe/Moscow',now())::date::text d")).rows[0].d;
 const marker=id=>'[invoice-payment:'+id+']';
 const rpc=(op,amount=20000,inv=U(30),description=marker(inv)+' Materials',existing=null,date=today)=>db.query('select public.save_invoice_payment($1,$2,$3,$4,$5,$6) row',[inv,op,amount,date,description,existing]);
 async function role(token){await db.exec('set role anon;');await db.query("select set_config('request.headers',$1,false)",[JSON.stringify(token?{'x-session-token':T[token]||token}:{})]);}
 async function txn(token,fn){await db.exec('begin;');try{await role(token);return await fn();}finally{await db.exec('rollback;reset role;');}}
 async function check(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});await db.exec('rollback;reset role;').catch(()=>{});}}
 async function denied(fn,codes=['23514','22023']){let e;try{await fn();}catch(err){e=err;}assert.ok(e,'Expected rejected operation');assert.ok(codes.includes(e.code),e.code+': '+e.message);}
 const paid=async()=>Number((await db.query('select coalesce(sum(amount),0)::text total from public.ledger_entries where deleted_at is null')).rows[0].total);
 for(const token of [null,'staff','isolated-guessed-token-with-long-enough-value'])await check((token||'unsigned')+' is rejected before looking up invoice UUID',()=>txn(token,()=>denied(()=>rpc(U(100)),['42501'])));
 await check('New payment returns only the safe existing ledger shape and records actor',()=>txn('admin',async()=>{
  const r=(await rpc(U(100))).rows[0].row;assert.deepEqual(Object.keys(r).sort(),['amount','deleted_at','description','entry_date','id','payee_employee_id','project_id','type'].sort());assert.equal(r.amount,20000);assert.equal(r.type,'expense');assert.equal(r.project_id,U(20));assert.equal(await paid(),20000);
  assert.equal((await db.query('select received_by from public.ledger_entries where id=$1',[U(100)])).rows[0].received_by,U(1));
 }));
 await check('Retry after a lost response returns the same UUID and never debits twice',()=>txn('admin',async()=>{
  const first=(await rpc(U(100))).rows[0].row,second=(await rpc(U(100))).rows[0].row;assert.deepEqual(second,first);assert.equal(await paid(),20000);
 }));
 await check('Replay remains successful after the invoice has no remaining debt',()=>txn('admin',async()=>{await rpc(U(100),30000);assert.equal((await rpc(U(100),30000)).rows[0].row.id,U(100));assert.equal(await paid(),30000);}));
 await check('Two separate payments may exactly close the remaining amount',()=>txn('admin',async()=>{await rpc(U(100),20000);await rpc(U(101),10000);assert.equal(await paid(),30000);}));
 await check('A second payment cannot exceed the freshly locked remaining amount',()=>txn('admin',async()=>{await rpc(U(100),20000);await denied(()=>rpc(U(101),15000));}));
 await check('The same UUID with changed amount/date/description is a conflict',()=>txn('admin',async()=>{
  await rpc(U(100),20000);await denied(()=>rpc(U(100),10000));
 }));
 for(const [name,change] of [['zero',()=>({amount:0})],['negative',()=>({amount:-1})],['fractional cent',()=>({amount:'0.001'})],['NaN',()=>({amount:'NaN'})],['missing marker',()=>({desc:'Materials'})],['another invoice marker',()=>({desc:marker(U(31))+' Materials'})],['duplicate marker',()=>({desc:marker(U(30))+' '+marker(U(31))})],['future date',()=>({date:'2099-01-01'})]])await check('Invalid '+name+' is rejected',()=>txn('admin',async()=>{
  const c=change();await denied(()=>rpc(U(100),c.amount??20000,U(30),c.desc??marker(U(30))+' Materials',null,c.date??today));
 }));
 await check('Direct client-paid invoice cannot also debit company cash',()=>txn('admin',()=>denied(()=>rpc(U(100),20000,U(32),marker(U(32))+' Materials'))));
 await check('Existing supplier expense is linked without creating a second ledger debit',async()=>{
  await db.query("insert into public.ledger_entries(id,project_id,type,amount,entry_date,description) values($1,$2,'expense',20000,$3,'Materials already paid')",[U(110),U(20),today]);
  await txn('admin',async()=>{const d=marker(U(30))+' Materials already paid';const r=(await rpc(U(110),20000,U(30),d,U(110))).rows[0].row;assert.equal(r.id,U(110));assert.equal(await paid(),20000);await rpc(U(110),20000,U(30),d,U(110));assert.equal(await paid(),20000);});
  await db.query('delete from public.ledger_entries where id=$1',[U(110)]);
 });
 for(const desc of ['Ранее внесённые расходы','[cash:historical-expense] Imported baseline'])await check('Historical expense cannot be converted into an invoice payment: '+desc,async()=>{
  await db.query("insert into public.ledger_entries(id,project_id,type,amount,entry_date,description) values($1,$2,'project_expense',20000,$3,$4)",[U(110),U(20),today,desc]);
  await txn('admin',()=>denied(()=>rpc(U(110),20000,U(30),marker(U(30))+' '+desc,U(110))));await db.query('delete from public.ledger_entries where id=$1',[U(110)]);
 });
 await check('Expense from another object cannot be linked even with a known UUID',async()=>{
  await db.query("insert into public.ledger_entries(id,project_id,type,amount,entry_date,description) values($1,$2,'expense',20000,$3,'Other object expense')",[U(110),U(21),today]);
  await txn('admin',()=>denied(()=>rpc(U(110),20000,U(30),marker(U(30))+' Materials',U(110))));await db.query('delete from public.ledger_entries where id=$1',[U(110)]);
 });
 await check('An employee payout cannot be reclassified as a supplier invoice payment',async()=>{
  await db.query("insert into public.ledger_entries(id,project_id,type,amount,entry_date,description,payee_employee_id) values($1,$2,'payment',20000,$3,'Employee fee',$4)",[U(110),U(20),today,U(2)]);
  await txn('admin',()=>denied(()=>rpc(U(110),20000,U(30),marker(U(30))+' Employee fee',U(110))));await db.query('delete from public.ledger_entries where id=$1',[U(110)]);
 });
 await check('Linked payment cannot be silently moved to another invoice',()=>txn('admin',async()=>{await rpc(U(100));await denied(()=>db.query('update public.ledger_entries set description=$1 where id=$2',[marker(U(31))+' Wrong invoice',U(100)]));}));
 for(const [name,sql,params]of [
  ['reduction below payments','update public.invoices set amount=19000 where id=$1',[U(30)]],
  ['direct client flag','update public.invoices set paid_by_client=true where id=$1',[U(30)]],
  ['object reassignment','update public.invoices set project_id=$1 where id=$2',[U(21),U(30)]],
  ['deletion','delete from public.invoices where id=$1',[U(30)]],
 ])await check('Paid invoice rejects '+name,()=>txn('admin',async()=>{await rpc(U(100));await denied(()=>db.query(sql,params));}));
 await check('Invoice may be increased while preserving its original payments',()=>txn('admin',async()=>{await rpc(U(100));await db.query('update public.invoices set amount=40000 where id=$1',[U(30)]);await rpc(U(101),20000);assert.equal(await paid(),40000);}));
 await check('Unpaid invoice still supports normal deletion',()=>txn('admin',async()=>{assert.equal((await db.query('delete from public.invoices where id=$1 returning id',[U(30)])).rows.length,1);}));
 await check('Canceled marked payment releases the invoice amount for a replacement',()=>txn('admin',async()=>{await rpc(U(100),30000);await db.query('update public.ledger_entries set deleted_at=now() where id=$1',[U(100)]);await rpc(U(101),30000);assert.equal(await paid(),30000);}));
 await check('RPC and trigger remain VOLATILE so post-lock queries see current committed rows',async()=>{
  const rows=(await db.query("select proname,provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and proname='save_invoice_payment') or (n.nspname='arhittek_security' and proname='check_invoice_payment')")).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(r=>r.provolatile==='v'));
 });
 await check('Concurrent submissions of 20k + 20k against 30k accept one payment only',async()=>{
  await role('admin');const rs=await Promise.allSettled([rpc(U(120),20000),rpc(U(121),20000)]);assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(await paid(),20000);await db.exec('reset role;');await db.query('delete from public.ledger_entries where id in ($1,$2)',[U(120),U(121)]);
 });
 await check('Concurrent repeat of one operation UUID produces one debit and two confirmations',async()=>{
  await role('admin');const rs=await Promise.allSettled([rpc(U(120),30000),rpc(U(120),30000)]);assert.equal(rs.filter(r=>r.status==='fulfilled').length,2);assert.equal(await paid(),30000);await db.exec('reset role;');await db.query('delete from public.ledger_entries where id=$1',[U(120)]);
 });
 await check('Older direct marked-payment writers are protected by the same database lock/check',async()=>{
  await role('admin');const write=id=>db.query("insert into public.ledger_entries(id,project_id,type,amount,entry_date,description) values($1,$2,'expense',20000,$3,$4)",[id,U(20),today,marker(U(30))+' Cached writer']);
  const rs=await Promise.allSettled([write(U(120)),write(U(121))]);assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(await paid(),20000);await db.exec('reset role;');await db.query('delete from public.ledger_entries where id in ($1,$2)',[U(120),U(121)]);
 });
 console.log(JSON.stringify(results,null,2));const fails=results.filter(r=>!r.pass);console.log(`${results.length-fails.length}/${results.length} passed`);await db.close();process.exitCode=fails.length?1:0;
})().catch(e=>{console.error(e);process.exit(1);});
