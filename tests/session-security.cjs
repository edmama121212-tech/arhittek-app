// Real PostgreSQL RLS/grant/trigger checks with isolated data in PGlite.
// No production endpoint, PIN, employee or financial row is used.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const tokens={admin:'isolated-admin-session-token-00000000000000000000000000000000001',lead:'isolated-lead-session-token-000000000000000000000000000000000002',worker:'isolated-worker-session-token-0000000000000000000000000000000003',other:'isolated-other-session-token-00000000000000000000000000000000004',expired:'isolated-expired-session-token-000000000000000000000000000000005',inactive:'isolated-inactive-session-token-00000000000000000000000000000006',archived:'isolated-archived-session-token-00000000000000000000000000000007',editor:'isolated-editor-session-token-00000000000000000000000000000000008'};
(async()=>{
 const db=new PGlite();await db.waitReady;
 await db.exec(fs.readFileSync(path.join(root,'tests/fixtures/session-security-baseline.sql'),'utf8'));
 for(const [n,name,role,admin,construction,active,deleted,salary,editor] of [
  [1,'Admin','CEO',true,true,true,null,50000,false],[2,'Lead','Ведущий дизайнер',false,true,true,null,50000,false],
  [3,'Foreman','Прораб',false,true,true,null,0,false],[4,'Other','Архитектор',false,false,true,null,42000,false],
  [5,'Inactive','Прораб',false,true,false,null,0,false],[6,'Archived','Прораб',false,true,true,'2026-01-01T00:00:00Z',0,false],
  [7,'Editor','Сотрудник',false,false,true,null,0,true]
 ]) await db.query('insert into public.employees(id,name,role,is_admin,can_see_projects,can_see_construction,active,deleted_at,is_salaried,fixed_salary,can_edit_cards,pin_code) values($1,$2,$3,$4,true,$5,$6,$7,true,$8,$9,$10)',[U(n),name,role,admin,construction,active,deleted,salary,editor,'isolated-sensitive-pin-hash-'+n]);
 for(const [key,n,expired] of [['admin',1,false],['lead',2,false],['worker',3,false],['other',4,false],['inactive',5,false],['archived',6,false],['editor',7,false],['expired',2,true]])
  await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+$3::interval)",[U(n),tokens[key],expired?'-1 day':'1 day']);
 await db.query("insert into public.departments(id,name) values($1,'Проектный отдел'),($2,'Строительный отдел')",[U(10),U(11)]);
 await db.query("insert into public.categories(id,name,department_id) values($1,'Архитектура',$2),($3,'Ремонт',$4)",[U(20),U(10),U(21),U(11)]);
 await db.query("insert into public.statuses(id,name) values($1,'В работе'),($2,'Завершён')",[U(30),U(31)]);
 await db.query("insert into public.projects(id,name,category_id,status_id,employee_id,price) values($1,'Lead project',$2,$3,$4,100000),($5,'Other project',$2,$3,$6,75000),($7,'Build object',$8,$3,$9,500000),($10,'Second build object',$8,$3,$9,100000)",[U(40),U(20),U(30),U(2),U(41),U(4),U(42),U(21),U(3),U(43)]);
 await db.query('insert into public.project_members(project_id,employee_id) values($1,$2)',[U(42),U(2)]);
 await db.query("insert into public.ledger_entries(id,project_id,type,description,amount) values($1,$2,'advance','Fixture receipt',100000),($3,$4,'expense','Fixture payment',25000)",[U(50),U(42),U(51),U(41)]);
 await db.query("insert into public.company_expenses(id,category,amount,expense_date) values($1,'Fixture salary',50000,current_date)",[U(60)]);
 await db.query("insert into public.company_income(id,category,amount,income_date) values($1,'Fixture company receipt',100000,current_date)",[U(61)]);
 await db.query("insert into public.timesheet_payments(employee_id,month,paid) values($1,'2026-10',true),($2,'2026-10',false)",[U(2),U(4)]);
 await db.query("insert into public.invoices(id,project_id,description,amount) values($1,$2,'Object material',10000),($3,$4,'Other material',2000)",[U(70),U(42),U(71),U(41)]);
 await db.query("insert into public.project_stages(id,project_id,name,done) values($1,$2,'Замеры',false),($3,$4,'Визуализация',false)",[U(80),U(40),U(81),U(41)]);
 await db.query("insert into public.project_cards(id,title) values($1,'Public architecture portfolio')",[U(90)]);
 await db.query("insert into public.share_links(id,label,token) values($1,'Public catalog share','isolated-catalog-token')",[U(91)]);
 await db.query("insert into storage.objects(bucket_id,name) values('construction-documents',$1),('construction-documents',$2),('expense-photos','cards/isolated-public-catalog.png')",[U(42)+'/receipt.jpg',U(41)+'/receipt.jpg']);
 await db.query("insert into public.tz_forms(id,project_id,token) values($1,$2,'isolated-brief-grant'),($3,$4,'isolated-second-brief-grant')",[U(110),U(40),U(111),U(41)]);
 await db.query("insert into public.kp_catalog(id,group_name,name,unit,rate,deleted_at) values($1,'Public','Active service','m2',100,null),($2,'Private archive','Archived service','m2',90,now())",[U(120),U(121)]);
 await db.exec(fs.readFileSync(path.join(root,'supabase/session-security.sql'),'utf8'));
 // Rerunning a confirmed migration is harmless; no new financial rows are made.
 await db.exec(fs.readFileSync(path.join(root,'supabase/session-security.sql'),'utf8'));
 const results=[];
 async function as(role,token,sql,params=[],headers){
  await db.exec('begin; set local role '+role+';');
  try{await db.query("select set_config('request.headers',$1,true)",[headers===undefined?JSON.stringify(token?{'x-session-token':tokens[token]||token}:{}):headers]);return await db.query(sql,params);}
  finally{await db.exec('rollback;');}
 }
 async function check(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
 const count=(r)=>r.rows.length;
 const denied=async(fn)=>{let error;try{await fn();}catch(e){error=e;}assert.ok(error,'Expected permission rejection');assert.equal(error.code,'42501');};
 for(const token of [null,'wrong-token-with-at-least-thirty-two-characters','expired','inactive','archived'])await check((token||'unsigned')+' cannot read internal project/company/ledger data',async()=>{
  for(const table of ['projects','ledger_entries','invoices','company_expenses','company_income','timesheet_payments'])assert.equal(count(await as('anon',token,'select * from public.'+table)),0,table);
  assert.equal((await as('anon',token,'select public.has_session() s,public.has_admin_session() a')).rows[0].s,false);
 });
 await check('Malformed header JSON fails closed instead of matching a session',async()=>{assert.equal((await as('anon',null,'select public.has_session() s',[],'{bad')).rows[0].s,false);});
 await check('Anonymous profile API requires a valid application session',async()=>denied(()=>as('anon',null,'select * from public.get_employee_profiles()')));
 await check('Public PIN picker exposes only active id/name/active',async()=>{
  const r=await as('anon',null,'select * from public.get_employee_login_options()');assert.equal(count(r),5);assert.deepEqual(Object.keys(r.rows[0]).sort(),['active','id','name']);
 });
 for(const role of ['anon','authenticated'])await check(role+' cannot SELECT raw PIN hashes even with valid admin session',async()=>{
  await denied(()=>as(role,'admin','select pin_code from public.employees'));await denied(()=>as(role,'admin','select * from public.employees'));
 });
 await check('Admin profile API retains salaries and archived history without PINs',async()=>{
  const r=await as('anon','admin','select * from public.get_employee_profiles()');assert.equal(count(r),7);assert.equal(r.rows.find(e=>e.id===U(4)).fixed_salary,'42000');assert.ok(r.rows.some(e=>e.deleted_at));assert.ok(r.rows.every(e=>!('pin_code'in e)));
 });
 await check('Staff profiles retain own salary, hide colleague salary and archived profiles',async()=>{
  const r=await as('anon','lead','select * from public.get_employee_profiles()');assert.equal(count(r),6);assert.equal(r.rows.find(e=>e.id===U(2)).fixed_salary,'50000');assert.equal(r.rows.find(e=>e.id===U(1)).fixed_salary,null);assert.ok(r.rows.every(e=>!e.deleted_at));
 });
 for(const role of ['anon','authenticated'])await check(role+' cannot read or truncate session/login tables',async()=>{
  for(const t of ['employee_sessions','login_attempts'])await denied(()=>as(role,'admin','select * from public.'+t));
  for(const t of ['projects','ledger_entries','employees','company_income'])await denied(()=>as(role,'admin','truncate public.'+t));
 });
 await check('Active admin retains normal project and company financial reads',async()=>{
  assert.equal(count(await as('anon','admin','select * from public.projects')),4);assert.equal(count(await as('anon','admin','select * from public.company_expenses')),1);assert.equal(count(await as('anon','admin','select * from public.company_income')),1);
 });
 await check('Lead sees self-assigned and team-member projects only',async()=>{assert.deepEqual((await as('anon','lead','select id from public.projects order by id')).rows.map(r=>r.id),[U(40),U(42)]);});
 await check('Foreman sees assigned construction objects only',async()=>{assert.deepEqual((await as('anon','worker','select id from public.projects order by id')).rows.map(r=>r.id),[U(42),U(43)]);});
 await check('Staff cannot read company finances, can read own payroll marker only',async()=>{
  assert.equal(count(await as('anon','lead','select * from public.company_expenses')),0);assert.equal(count(await as('anon','lead','select * from public.company_income')),0);
  assert.deepEqual((await as('anon','lead','select employee_id from public.timesheet_payments')).rows,[{employee_id:U(2)}]);
 });
 const basic={id:U(100),name:'Lead new card',category_id:U(20),status_id:U(30),employee_id:U(2),area:125};
 async function insertProject(p,token='lead'){
  const keys=Object.keys(p);return as('anon',token,'insert into public.projects('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+') returning *',Object.values(p));
 }
 await check('Madina/lead can create and receive their own basic card without admin rights',async()=>{const r=await insertProject(basic);assert.equal(count(r),1);assert.equal(r.rows[0].employee_id,U(2));assert.equal(r.rows[0].price,'0');});
 await check('Lead with construction permission can create their own basic object',async()=>{const r=await insertProject({...basic,category_id:U(21)});assert.equal(count(r),1);});
 for(const [field,value] of [['price',1],['advance',1],['fee_percent',15],['fee_paid',100],['co_fee_percent',1],['fee_settled',true],['employee_id',U(4)],['co_employee_id',U(4)],['status_id',U(31)],['contract_passport','isolated fake contract'],['deleted_at','2026-01-01T00:00:00Z']])await check('Lead cannot create a card with unauthorized '+field,async()=>denied(()=>insertProject({...basic,[field]:value})));
 await check('Ordinary executor cannot create a lead-designer card by direct REST',async()=>denied(()=>insertProject({...basic,employee_id:U(4)},'other')));
 await check('Admin can create financial conditions normally',async()=>{assert.equal(count(await insertProject({...basic,employee_id:U(4),price:250000,fee_percent:40},'admin')),1);});
 await check('Staff cannot edit price, assignment or finish an existing project',async()=>{
  for(const [field,value] of [['price',5],['employee_id',U(4)],['status_id',U(31)]])await denied(()=>as('anon','lead','update public.projects set '+field+'=$1 where id=$2 returning id',[value,U(40)]));
 });
 await check('Construction cache submissions do not grant staff control over cash or expenses',async()=>{
  const r=await as('anon','worker','update public.projects set balance=999999,expenses=888888 where id=$1 returning balance,expenses',[U(42)]);assert.deepEqual(r.rows,[{balance:'0',expenses:'0'}]);
 });
 await check('Lead cannot add themselves to another project through project_members',async()=>denied(()=>as('anon','lead','insert into public.project_members(project_id,employee_id) values($1,$2)',[U(41),U(2)])));
 await check('Admin can maintain project membership',async()=>{assert.equal(count(await as('anon','admin','insert into public.project_members(project_id,employee_id) values($1,$2) returning id',[U(41),U(2)])),1);});
 await check('Team member can immediately toggle an assigned stage',async()=>{const r=await as('anon','lead','update public.project_stages set done=true,done_at=now() where id=$1 returning done',[U(80)]);assert.equal(r.rows[0].done,true);});
 await check('Team member can persist a missing canonical stage',async()=>{assert.equal(count(await as('anon','lead',"insert into public.project_stages(project_id,name,done,done_at) values($1,'Чертежи',true,now()) returning id",[U(40)])),1);});
 await check('Stage in an unrelated project cannot be toggled',async()=>{assert.equal(count(await as('anon','lead','update public.project_stages set done=true where id=$1 returning id',[U(81)])),0);});
 await check('Staff stage update cannot move the stage or its deadline',async()=>{
  await denied(()=>as('anon','lead','update public.project_stages set project_id=$1 where id=$2 returning id',[U(42),U(80)]));await denied(()=>as('anon','lead',"update public.project_stages set due_date='2026-11-01' where id=$1 returning id",[U(80)]));
 });
 await check('Foreman may add an invoice to assigned object, never unrelated object',async()=>{
  assert.equal(count(await as('anon','worker',"insert into public.invoices(project_id,description,amount) values($1,'Materials',100) returning id",[U(42)])),1);
  await denied(()=>as('anon','worker',"insert into public.invoices(project_id,description,amount) values($1,'Materials',100) returning id",[U(41)]));
 });
 await check('A design-project assignment cannot be abused to insert its first construction invoice',async()=>{
  await denied(()=>as('anon','lead',"insert into public.invoices(project_id,description,amount) values($1,'Unexpected construction invoice',100) returning id",[U(40)]));
  await denied(()=>as('anon','lead',"insert into storage.objects(bucket_id,name) values('construction-documents',$1)",[U(40)+'/unexpected-receipt.jpg']));
 });
 await check('Staff cannot insert a company receipt or salary payment',async()=>{
  await denied(()=>as('anon','lead',"insert into public.company_income(category,amount,income_date) values('isolated',1,current_date)"));await denied(()=>as('anon','lead',"insert into public.ledger_entries(project_id,type,amount) values($1,'payment',1)",[U(40)]));
 });
 await check('Staff cannot promote themselves or view a colleague PIN via mutation RETURNING',async()=>{
  assert.equal(count(await as('anon','lead','update public.employees set is_admin=true where id=$1 returning id',[U(2)])),0);
  await denied(()=>as('anon','admin','update public.employees set name=name where id=$1 returning pin_code',[U(2)]));
 });
 await check('Admin employee INSERT/UPDATE return id without requiring PIN SELECT',async()=>{
  assert.equal(count(await as('anon','admin',"insert into public.employees(id,name,pin_code) values($1,'New fixture employee','isolated fixture') returning id",[U(101)])),1);
  assert.equal(count(await as('anon','admin',"update public.employees set name='Edited fixture' where id=$1 returning id",[U(2)])),1);
 });
 await check('Own push registration is allowed, another employee is rejected',async()=>{
  assert.equal(count(await as('anon','lead',"insert into public.push_subscriptions(employee_id,endpoint,p256dh,auth) values($1,'isolated own endpoint','isolated-key','isolated-auth') returning id",[U(2)])),1);
  await denied(()=>as('anon','lead',"insert into public.push_subscriptions(employee_id,endpoint,p256dh,auth) values($1,'isolated other endpoint','isolated-key','isolated-auth')",[U(4)]));
 });
 await check('Public portfolio remains public while editor writes require their explicit role',async()=>{
  assert.equal(count(await as('anon',null,'select * from public.project_cards')),1);
  assert.equal(count(await as('anon','editor',"insert into public.project_cards(title) values('Editor fixture card') returning id")),1);
  await denied(()=>as('anon','lead',"insert into public.project_cards(title) values('Unauthorized fixture card')"));
 });
 for(const token of [null,'expired','inactive'])await check((token||'unsigned')+' cannot read/upload protected construction documents',async()=>{
  assert.equal(count(await as('anon',token,"select * from storage.objects where bucket_id='construction-documents'")),0);
  await denied(()=>as('anon',token,"insert into storage.objects(bucket_id,name) values('construction-documents',$1)",[U(42)+'/new.jpg']));
 });
 await check('Assigned foreman gets their private object documents, not another project',async()=>{
  assert.deepEqual((await as('anon','worker',"select name from storage.objects where bucket_id='construction-documents' order by name")).rows,[{name:U(42)+'/receipt.jpg'}]);
  assert.equal(count(await as('anon','worker',"insert into storage.objects(bucket_id,name) values('construction-documents',$1) returning id",[U(42)+'/new.jpg'])),1);
  await denied(()=>as('anon','worker',"insert into storage.objects(bucket_id,name) values('construction-documents',$1)",[U(41)+'/new.jpg']));
 });
 await check('Malformed protected path fails closed without UUID casting error',async()=>{await denied(()=>as('anon','worker',"insert into storage.objects(bucket_id,name) values('construction-documents','not-a-uuid/file.jpg')"));});
 await check('Private document upsert requirements cover SELECT and UPDATE as well as INSERT',async()=>{assert.equal(count(await as('anon','worker',"update storage.objects set name=$1 where bucket_id='construction-documents' and name=$2 returning id",[U(42)+'/renamed.jpg',U(42)+'/receipt.jpg'])),1);});
 await check('Published tariff catalogue remains readable in a public client brief',async()=>{assert.deepEqual((await as('anon',null,'select name from public.kp_catalog')).rows,[{name:'Active service'}]);});
 await check('Brief token authorizes upload only into the same form folder',async()=>{
  const headers=JSON.stringify({'x-tz-token':'isolated-brief-grant'});
  assert.equal(count(await as('anon',null,"insert into storage.objects(bucket_id,name) values('tz-references',$1) returning id",['tz-refs/'+U(110)+'/reference.jpg'],headers)),1);
  await denied(()=>as('anon',null,"insert into storage.objects(bucket_id,name) values('tz-references',$1)",['tz-refs/'+U(111)+'/reference.jpg'],headers));
  await denied(()=>as('anon',null,"insert into storage.objects(bucket_id,name) values('construction-documents',$1)",[U(42)+'/reference.jpg'],headers));
 });
 await check('Staff cannot create arbitrary stages or rename existing workflow conditions',async()=>{
  await denied(()=>as('anon','lead',"insert into public.project_stages(project_id,name) values($1,'Unauthorized arbitrary stage')",[U(40)]));
  await denied(()=>as('anon','lead',"update public.project_stages set name='Unauthorized replacement' where id=$1 returning id",[U(80)]));
 });
 await check('Existing legacy stage names can be normalized during a toggle',async()=>{
  await db.query("update public.project_stages set name='Планировка' where id=$1",[U(80)]);
  assert.equal(count(await as('anon','lead',"update public.project_stages set name='Разработка планировки',done=true,done_at=now() where id=$1 returning id",[U(80)])),1);
 });
 await check('Legacy anonymous TZ upload/delete policies have been removed',async()=>{
  await denied(()=>as('anon',null,"insert into storage.objects(bucket_id,name) values('tz-references','isolated-upload')"));
  assert.equal((await db.query("select count(*)::int n from pg_policies where schemaname='storage' and policyname in ('Allow delete tz-references','Allow uploads to tz-references')")).rows[0].n,0);
 });
 await check('Every public table still has RLS enabled',async()=>{assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")).rows[0].n,0);});
 await check('No API role retains table-level employee SELECT or any TRUNCATE grant',async()=>{
  for(const role of ['anon','authenticated']){
   assert.equal((await db.query('select has_table_privilege($1,$2,$3) value',[role,'public.employees','SELECT'])).rows[0].value,false);
   assert.equal((await db.query("select count(*)::int n from information_schema.table_privileges where table_schema='public' and grantee=$1 and privilege_type='TRUNCATE'",[role])).rows[0].n,0);
  }
 });
 console.log(JSON.stringify(results,null,2));const fails=results.filter(r=>!r.pass);console.log(`${results.length-fails.length}/${results.length} passed`);
 await db.close();process.exitCode=fails.length?1:0;
})().catch(e=>{console.error(e);process.exit(1);});
