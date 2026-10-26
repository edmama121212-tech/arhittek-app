const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const U=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{const db=new PGlite();await db.waitReady;await db.exec(fs.readFileSync('tests/fixtures/session-security-baseline.sql','utf8'));
for(const [id,name,role,admin]of [[1,'Мансур','Директор',true],[2,'Ведущий','Ведущий архитектор',false],[3,'Мансур','Администратор',true]]){await db.query('insert into public.employees(id,name,role,is_admin) values($1,$2,$3,$4)',[U(id),name,role,admin]);await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day')",[U(id),'settings-test-token-'+String(id).repeat(40)]);}
// Only the reviewed original owner exists when installing ownership.
await db.query("update public.employees set name='Other admin' where id=$1",[U(3)]);
await db.exec(fs.readFileSync('supabase/install-owner-access.sql','utf8'));await db.exec(fs.readFileSync('supabase/app-preferences.sql','utf8'));await db.exec(fs.readFileSync('supabase/app-preferences.sql','utf8'));
async function actor(n){await db.exec('reset role;set role anon');await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-session-token':'settings-test-token-'+String(n).repeat(40)})]);}
const read=async()=>(await db.query('select public.get_app_preferences() j')).rows[0].j;
const save=(values,rev,id,reason='Test settings')=>db.query('select public.save_app_preferences($1,$2,$3,$4) j',[values,rev,U(id),reason]);
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};async function denied(f){await assert.rejects(f,e=>['42501','22023','23514','40001'].includes(e.code));checks++;}
await actor(0);await denied(read);await actor(2);await denied(()=>save({},0,10));await actor(3);await denied(()=>save({},0,10));
await actor(1);eq((await read()).revision,0);
for(const values of [{is_admin:true},{contract_advance:101},{contract_advance:-1},{contract_advance:12.333},{contract_days:2.5},{density:'bad'},{notify_overdue:'yes'},{scope_ar:'x'.repeat(6001)},{contract_customer:null},{project_category:'not-a-category'},{project_status:'missing'}])await denied(()=>save(values,0,10));
await denied(()=>save({},0,10,''));
const values={contract_advance:35,scope_ar:'Custom scope',plan_rent:123456,project_days:21,reduce_motion:true};
await save(values,0,10);eq((await read()).values,values);await save(values,0,10);eq((await read()).revision,1);await denied(()=>save({...values,contract_advance:40},0,10));await denied(()=>save({},0,11));
await actor(2);const staff=await read();eq(staff.values.plan_rent,undefined);eq(staff.values.contract_advance,35);eq(staff.history,undefined);await denied(()=>db.query('select * from arhittek_settings.history'));await denied(()=>db.query('update arhittek_settings.current set revision=99'));
await actor(1);await save({contract_advance:70},1,11);eq((await read()).history.length,2);await save(values,2,12,'Restore reviewed version');eq((await read()).values,values);eq((await read()).revision,3);
eq((await db.query('select count(*)::int n from public.ledger_entries')).rows[0].n,0);eq((await db.query('select count(*)::int n from public.company_expenses')).rows[0].n,0);
console.log(checks+' app settings server checks passed');await db.close();})().catch(e=>{console.error(e);process.exitCode=1});
