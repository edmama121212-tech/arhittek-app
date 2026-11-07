const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),U=n=>'a0000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/session-security-baseline.sql'),'utf8'));
 const tokens={};
 for(const [n,name,admin,active,deleted,salary] of [[1,'Мансур',true,true,null,0],[2,'Historical salary',false,true,null,65000],[3,'Archived',false,false,null,50000],[4,'Deleted',false,true,'2026-11-06T14:00:00Z',50000],[5,'Other administrator',true,true,null,0],[6,'Incomplete audit',false,true,null,65000],[7,'Equal audit timestamps',false,true,null,65000],[8,'Restored card',false,true,null,50000]]){
  await db.query("insert into public.employees(id,name,role,is_admin,active,deleted_at,is_salaried,fixed_salary,created_at,pin_code) values($1,$2,'Архитектор',$3,$4,$5,$6,$7,'2026-01-01','private-pin')",[U(n),name,admin,active,deleted,salary>0,salary]);
  tokens[n]='isolated-salary-token-'+String(n).repeat(40);
  await db.query("insert into employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day')",[U(n),tokens[n]]);
 }
 for(const [id,employee,created,changes] of [[20,2,'2026-10-31T22:00:00Z',{fixed_salary:{old:50000,new:65000}}],[21,3,'2026-11-05T14:00:00Z',{active:{old:true,new:false}}],[22,6,'2026-11-01T14:00:00Z',{fixed_salary:{old:'unknown',new:65000}}],[23,7,'2026-11-01T14:00:00Z',{fixed_salary:{old:50000,new:60000}}],[24,7,'2026-11-01T14:00:00Z',{fixed_salary:{old:60000,new:65000}}]]){
  await db.query("insert into audit_log(id,entity_type,entity_id,entity_name,action,changes,created_at) values($1,'employee',$2,'Fixture','update',$3,$4)",[U(id),U(employee),JSON.stringify(changes),created]);
 }
 await db.query("insert into audit_log(id,entity_type,entity_id,entity_name,action,changes,created_at) values($1,'employee',$2,'Fixture','delete','{}','2026-11-03T12:00:00Z'),($3,'employee',$2,'Fixture','restore','{}','2026-11-05T12:00:00Z')",[U(25),U(8),U(26)]);
 await db.exec(fs.readFileSync(path.join(root,'supabase/install-owner-access.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/owner-access.sql'),'utf8'));
 const migration=fs.readdirSync(path.join(root,'supabase/migrations')).find(f=>f.endsWith('_employee_salary_history.sql'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
 let checks=0;
 const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 async function as(n,sql,params=[],headers={}){
  await db.exec('begin;set local role anon;');
  try{await db.query("select set_config('request.headers',$1,true)",[JSON.stringify({...headers,...(n?{'x-session-token':tokens[n]||n}:{})})]);return await db.query(sql,params);}
  finally{await db.exec('rollback');}
 }
 async function denied(fn,label){let code;try{await fn();}catch(e){code=e.code;}eq(code,'42501',label);}
 const history=async()=> (await as(1,'select public.get_employee_salary_history() data')).rows[0].data;
 let h=await history(),employee=id=>h.employees.find(e=>e.id===U(id)),legacy=id=>employee(id).versions.filter(v=>v.source!=='server');
 eq(h.history_policy,'effective-salary-v1','Versioned server contract');
 eq(legacy(2).map(v=>[v.effective_from,v.fixed_salary,v.source,v.uncertain]),[['2026-01-01',50000,'legacy_baseline',true],['2026-11-01',65000,'audit',false]],'Known old salary and Moscow change date are recovered');
 eq(legacy(3).map(v=>v.active),[true,false],'Archive preserves old active status');
 eq(legacy(4).map(v=>v.deleted),[false,true],'Deleted card retains historical terms');
 eq(legacy(6).map(v=>[v.fixed_salary,v.source,v.uncertain]),[[65000,'legacy_baseline',true]],'Malformed audit never manufactures a known salary');
 eq(legacy(7).map(v=>v.fixed_salary),[50000,60000,65000],'Equal audit timestamps retain recovered change order');
 eq(legacy(8).map(v=>v.deleted),[false,true,false],'Known delete and restore preserve the historical gap');
 eq([employee(2).versions.at(-1).source,employee(2).versions.at(-1).uncertain],['server',false],'Installation establishes a confirmed current checkpoint');
 eq(JSON.stringify(h).includes('private-pin'),false,'Roster never contains authentication secrets');
 for(const n of [null,'invalid-session-token-1234567890123456789',2,3,4,5])await denied(()=>as(n,'select public.get_employee_salary_history()'),'History denied for non-owner '+n);
 await denied(()=>as(5,'select public.get_employee_salary_history()',[],{'employee_id':U(1),'is_admin':'true'}),'Forged owner headers denied');
 for(const table of ['payroll_roster','employee_salary_versions']){
  await denied(()=>as(1,'select * from arhittek_security.'+table),'No direct private read '+table);
  await denied(()=>as(1,'delete from arhittek_security.'+table),'No direct private write '+table);
 }
 await denied(()=>as(1,"select nextval('arhittek_security.employee_salary_versions_version_id_seq')"),'Private history sequence denied');
 for(const sql of ['update arhittek_security.employee_salary_versions set fixed_salary=1','delete from arhittek_security.employee_salary_versions']){
  let code;try{await db.exec(sql);}catch(e){code=e.code;}eq(code,'55000','Even privileged historical version mutation is denied');
 }
 const oldVersions=legacy(2);
 await db.query("insert into employees(id,name,is_salaried,fixed_salary,active,created_at) values($1,'New hire',true,30000,true,'2010-01-01')",[U(10)]);
 h=await history();eq(employee(10).versions.map(v=>[v.source,v.uncertain]),[['server',false]],'New hires receive server-backed history');
 eq(employee(10).versions[0].effective_from>'2010-01-01',true,'Client creation date cannot backdate new salary accrual');
 await db.query('update employees set fixed_salary=70000 where id=$1',[U(2)]);
 await db.query('update employees set fixed_salary=80000 where id=$1',[U(2)]);
 h=await history();eq(employee(2).versions.slice(0,2),oldVersions,'Future salary edits never modify old versions');
 const tail=employee(2).versions.slice(-2);eq(tail.map(v=>v.fixed_salary),[70000,80000],'Same-day versions remain additive and ordered');
 eq(tail.every(v=>v.source==='server'&&!v.uncertain),true,'Future changes have server provenance');
 for(const version of tail){const d=(await db.query("select ($1::timestamptz at time zone 'Europe/Moscow')::date::text d",[version.changed_at])).rows[0].d;eq(version.effective_from,d,'Effective day uses server Moscow time');}
 await db.query('update employees set active=false where id=$1',[U(2)]);h=await history();eq(employee(2).versions.at(-1).active,false,'Archive adds a status version');
 await db.query("update employees set deleted_at='2000-01-01' where id=$1",[U(2)]);h=await history();eq(employee(2).versions.at(-1).deleted,true,'Soft deletion adds a version');
 eq(employee(2).versions.at(-1).effective_from,tail.at(-1).effective_from,'Client deleted_at cannot backdate effective payroll');
 await db.query('delete from employees where id=$1',[U(2)]);h=await history();eq(employee(2).name,'Historical salary','Physical deletion preserves historical roster');
 eq(employee(2).versions.slice(0,2),oldVersions,'Physical deletion preserves original salary versions');
 await db.query("update employee_sessions set expires_at=now()-interval '1 second' where employee_id=$1",[U(1)]);await denied(()=>history(),'Expired owner denied');
 await db.close();console.log(checks+' employee salary-history PostgreSQL checks passed');
})().catch(e=>{console.error(e);process.exit(1)});
