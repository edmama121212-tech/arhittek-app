// PostgreSQL tests for the final owner/rank policy (no live users or secrets).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),U=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();await db.waitReady;
 await db.exec(fs.readFileSync(path.join(root,'tests/fixtures/session-security-baseline.sql'),'utf8'));
 const tokens={};
 for(const [n,name,role,admin] of [[1,'Мансур','Генеральный директор',true],[2,'Lead architect','Ведущий архитектор',false],
  [3,'Lead designer','Ведущий дизайнер',false],[4,'Worker','Архитектор',false],[5,'Other administrator','Генеральный директор',true]]){
  await db.query('insert into public.employees(id,name,role,is_admin,active,can_see_projects,can_see_construction,fixed_salary) values($1,$2,$3,$4,true,true,true,50000)',[U(n),name,role,admin]);
  tokens[n]='isolated-owner-policy-token-'+String(n).repeat(40);
  await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day')",[U(n),tokens[n]]);
 }
 await db.query("insert into public.departments(id,name) values($1,'Проектный отдел')",[U(10)]);
 await db.query("insert into public.categories(id,name,department_id) values($1,'Архитектура',$2)",[U(11),U(10)]);
 await db.query("insert into public.statuses(id,name) values($1,'В работе')",[U(12)]);
 for(const n of [2,3,4,5])await db.query('insert into public.projects(id,name,category_id,status_id,employee_id,price) values($1,$2,$3,$4,$5,100000)',[U(20+n),'Assigned '+n,U(11),U(12),U(n)]);
 await db.query("insert into public.company_expenses(id,category,amount,expense_date) values($1,'Fixture',100,current_date)",[U(40)]);
 await db.query("insert into public.company_income(id,category,amount,income_date) values($1,'Fixture',100,current_date)",[U(41)]);
 await db.query("insert into public.ledger_entries(id,project_id,type,amount) values($1,$2,'advance',100)",[U(42),U(24)]);
 await db.query("insert into public.timesheet_payments(employee_id,month,paid) values($1,'2026-10',true)",[U(4)]);
 await db.query("insert into public.kp_forms(id,project_id) values($1,$2),($3,$4),($5,null)",[U(43),U(22),U(44),U(24),U(45)]);
 await db.exec(fs.readFileSync(path.join(root,'supabase/install-owner-access.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/owner-access.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/owner-access.sql'),'utf8'));
 let checks=0;
 async function as(n,sql,params=[],extra={}){
  await db.exec('begin;set local role anon;');
  try{await db.query("select set_config('request.headers',$1,true)",[JSON.stringify({...extra,...(n?{'x-session-token':tokens[n]||n}:{})})]);
   return await db.query(sql,params);
  }finally{await db.exec('rollback');}
 }
 async function eq(actual,expected,label){assert.deepEqual(await actual,expected,label);checks++;}
 const rows=async(n,sql,p=[],x={})=>(await as(n,sql,p,x)).rows;
 for(const n of [2,3])await eq((async()=>(await rows(n,"insert into public.projects(name,category_id,status_id,employee_id,fee_percent) values('New lead project',$1,$2,$3,0) returning employee_id",[U(11),U(12),U(n)]))[0].employee_id)(),U(n),'Both leads create self-assigned cards');
 for(const n of [null,'invalid-token-with-more-than-thirty-two-characters',2,3,4,5]){
  for(const table of ['company_expenses','company_income','timesheet_payments','ledger_entries','audit_log'])
   await eq(rows(n,'select * from public.'+table),[],table+' hidden from '+n);
 }
 for(const table of ['company_expenses','company_income','timesheet_payments','ledger_entries'])
  await eq((async()=> (await rows(1,'select * from public.'+table)).length)(),1,'Owner reads '+table);
 for(const n of [2,3,4,5]){
  await eq((async()=>(await rows(n,'select id from public.projects')).map(x=>x.id))(),[U(20+n)],'Own projects '+n);
  await eq((async()=>(await rows(n,'select * from public.get_employee_profiles()')).every(x=>x.fixed_salary===null&&x.is_salaried===null))(),true,'No payroll profile '+n);
  await eq((async()=>(await rows(n,'select * from public.get_employee_access()'))[0].is_owner)(),false,'Not owner '+n);
 }
 for(const n of [1,2,3])await eq((async()=>(await rows(n,'select * from public.get_employee_access()'))[0].can_documents)(),true,'Documents '+n);
 for(const n of [4,5])await eq((async()=>(await rows(n,'select * from public.get_employee_access()'))[0].can_documents)(),false,'No extra tools '+n);
 await eq(rows(4,'select * from public.kp_forms'),[],'Worker cannot read even own proposals');
 await eq((async()=>(await rows(2,'select id from public.kp_forms')).map(x=>x.id))(),[U(43)],'Lead sees assigned proposals');
 await eq((async()=>(await rows(1,'select id from public.kp_forms')).length)(),3,'Owner sees all proposals');
 await eq((async()=>(await rows(2,"insert into public.kp_forms(project_id) values(null) returning created_by"))[0].created_by)(),U(2),'Standalone proposal attributed by server');
 await eq((async()=>(await rows(5,'select public.has_admin_session() allowed',[],{'is_admin':'true','employee_id':U(1)}))[0].allowed)(),false,'Forged headers do not transfer owner');
 await db.query('update public.employees set name=$1,role=$2,is_admin=true where id=$3',['Мансур','Ведущий архитектор',U(5)]);
 await eq((async()=>(await rows(5,'select public.has_admin_session() allowed'))[0].allowed)(),false,'Name and flag do not transfer owner');
 await db.query("update public.employees set name='Owner renamed',role='Сотрудник',is_admin=false,can_see_projects=false,can_see_construction=false where id=$1",[U(1)]);
 await eq((async()=>(await rows(1,'select public.has_admin_session() allowed'))[0].allowed)(),true,'Owner retains full access despite labels and flags');
 await eq((async()=>(await rows(1,'select id from public.projects')).length)(),4,'Owner still sees every project');
 for(const n of [2,3,4,5]){
  let blocked=false;try{await as(n,'select fixed_salary from public.employees');}catch(e){blocked=e.code==='42501';}
  await eq(Promise.resolve(blocked),true,'Raw payroll column denied '+n);
 }
 await db.query("update public.employee_sessions set expires_at=now()-interval '1 second' where employee_id=$1",[U(2)]);
 await eq(rows(2,'select * from public.get_employee_access()'),[],'Expired session closed');
 await eq(rows(2,'select * from public.projects'),[],'Expired project access closed');
 await db.query("update public.employees set active=false where id=$1",[U(3)]);
 await eq(rows(3,'select * from public.get_employee_access()'),[],'Inactive session closed');
 await eq(rows(null,'select * from public.get_employee_access()'),[],'Unsigned access closed');
 for(const statement of ["update public.employees set active=false where id=$1","delete from public.employees where id=$1"]){
  let blocked=false;try{await as(1,statement,[U(1)]);}catch(e){blocked=e.code==='42501';}
  await eq(Promise.resolve(blocked),true,'Owner cannot be archived or deleted');
 }
 console.log(checks+' owner/rank PostgreSQL checks passed');await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
