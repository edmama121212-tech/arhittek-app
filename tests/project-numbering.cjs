// Atomic numbering under actual PostgreSQL grants/RLS, using isolated PGlite data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),U=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();await db.waitReady;
 await db.exec(fs.readFileSync(path.join(root,'tests/fixtures/session-security-baseline.sql'),'utf8'));
 const year=(await db.query("select extract(year from now() at time zone 'Europe/Moscow')::integer y")).rows[0].y,yy=String(year).slice(-2);
 await db.query("insert into employees(id,name,role,active,can_see_projects) values($1,'Owner','Директор',true,true),($2,'Lead','Ведущий архитектор',true,true),($3,'Worker','Архитектор',true,true)",[U(1),U(2),U(3)]);
 await db.query('update employees set is_admin=true where id=$1',[U(1)]);
 await db.query("insert into employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day'),($3,$4,now()+interval '1 day'),($5,$6,now()+interval '1 day')",[U(1),'numbering-owner-session-token-0000000000000000000000',U(2),'numbering-lead-session-token-00000000000000000000000',U(3),'numbering-worker-session-token-000000000000000000000']);
 await db.query("insert into categories(id,name) values($1,'Архитектура'),($2,'Дизайн интерьера'),($3,'Ландшафтный дизайн'),($4,'Строительство')",[U(10),U(11),U(12),U(13)]);
 await db.query("insert into statuses(id,name) values($1,'В процессе')",[U(20)]);
 await db.query("insert into projects(name,category_id,deleted_at) values($1,$2,null),($3,$2,now()),($4,$5,null),($6,$2,null),('Дом 450 м2',$2,null)",['Проект 173'+yy+' Арслан',U(10),'Проект №174'+yy+' Архив','Проект ДИ ПР №31'+yy+' Интерьер',U(11),'Проект №173'+yy+' Существующий дубль']);
 await db.exec(fs.readFileSync(path.join(root,'supabase/session-security.sql'),'utf8'));
 const leadSql=fs.readFileSync(path.join(root,'supabase/lead-projects-reserve.sql'),'utf8');
 // Apply the actual lead-project predicate; the rest of that file changes the finance journal.
 await db.exec(leadSql.slice(0,leadSql.indexOf('create or replace function arhittek_finance.'))+'commit;');
 await db.exec(fs.readFileSync(path.join(root,'supabase/project-numbering.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/project-numbering.sql'),'utf8'));
 const out=[];async function check(name,fn){try{await fn();out.push({name,pass:true});}catch(e){out.push({name,pass:false,error:e.message});}}
 async function as(actor,sql,args=[],rollback=false){
  await db.exec('begin;set local role anon;');
  try{const token=actor?'numbering-'+actor+'-session-token-'+({owner:'0000000000000000000000',lead:'00000000000000000000000',worker:'000000000000000000000'}[actor]):null;await db.query("select set_config('request.headers',$1,true)",[JSON.stringify(token?{'x-session-token':token}:{})]);const r=await db.query(sql,args);await db.exec(rollback?'rollback':'commit');return r;}
  catch(e){await db.exec('rollback');throw e;}
 }
 async function denied(actor,sql,args=[]){await assert.rejects(()=>as(actor,sql,args));}
 async function insert(actor='owner',category=10,title='Новый дом',extras=''){return(await as(actor,`insert into projects(name,category_id,status_id,employee_id,fee_percent,co_fee_percent${extras?',number_sequence,number_series,number_year':''}) values($1,$2,$3,$4,0,0${extras?',999999,\'interior\',2001':''}) returning *`,[title,U(category),U(20),U(actor==='lead'?2:1)])).rows[0];}
 await check('Existing names remain unchanged, including duplicate historic labels',async()=>{assert.equal((await db.query('select count(*) n from projects where number_series is not null')).rows[0].n,0);assert.equal((await db.query('select count(*) n from projects where name like $1',['%173'+yy+'%'])).rows[0].n,2);});
 await check('Preview sees archived high water and independent directions',async()=>{const rows=(await as('owner','select get_next_project_numbers() n')).rows[0].n;assert.equal(rows.find(x=>x.series==='architecture').prefix,'Проект №175'+yy);assert.equal(rows.find(x=>x.series==='interior').prefix,'Проект ДИ №32'+yy);assert.equal(rows.find(x=>x.series==='landscape').prefix,'Проект ЛД №1'+yy);});
 await check('Anonymous users and ordinary staff cannot read next numbers or counters',async()=>{for(const actor of [null,'worker'])await denied(actor,'select get_next_project_numbers()');await denied('owner','select * from arhittek_security.project_number_counters');});
 let first;
 await check('Owner receives the server-assigned number despite a forged client identity',async()=>{first=await insert('owner',10,'Новый дом','forged');assert.equal(first.name,'Проект №175'+yy+' Новый дом');assert.equal(first.number_series,'architecture');assert.equal(first.number_sequence,175);assert.equal(first.project_title,'Новый дом');});
 await check('Lead may create an automatically numbered basic card without finance rights',async()=>{const p=await insert('lead',11,'Интерьер');assert.equal(p.name,'Проект ДИ №32'+yy+' Интерьер');assert.equal(p.employee_id,U(2));assert.equal(Number(p.price),0);});
 await check('Old clients cannot manually choose an arbitrary project number',async()=>{const p=await insert('owner',10,'Проект №999'+yy+' Старый клиент');assert.equal(p.number_sequence,176);assert.equal(p.project_title,'Старый клиент');});
 await check('Number, year, direction and prefix are immutable after creation',async()=>{for(const update of ["number_sequence=1","number_year=2001","number_series='landscape'","category_id='"+U(12)+"'","name='Проект №999"+yy+" Перенос'"])await assert.rejects(()=>as('owner','update projects set '+update+' where id=$1',[first.id]));});
 await check('Only title can change and other project fields remain unchanged',async()=>{const name='Проект №175'+yy+' Другое название';const p=(await as('owner','update projects set name=$1 where id=$2 returning *',[name,first.id])).rows[0];assert.equal(p.project_title,'Другое название');assert.equal(p.number_sequence,175);assert.equal(p.price,first.price);});
 await check('Failed RLS insert rolls the allocated counter back',async()=>{const n=(await as('owner','select get_next_project_numbers() n')).rows[0].n.find(x=>x.series==='architecture').sequence;await assert.rejects(()=>insert('worker'));const after=(await as('owner','select get_next_project_numbers() n')).rows[0].n.find(x=>x.series==='architecture').sequence;assert.equal(after,n);});
 await check('Removed projects never free their numbers',async()=>{await as('owner','delete from projects where id=$1',[first.id]);const p=await insert();assert.equal(p.number_sequence,177);});
 await check('Several queued inserts obtain distinct consecutive identities',async()=>{const rows=await Promise.all([insert(),insert(),insert()]);assert.deepEqual(rows.map(p=>p.number_sequence),[178,179,180]);});
 await check('Construction objects keep their existing naming workflow',async()=>{const p=await insert('owner',13,'Ремонт квартиры');assert.equal(p.name,'Ремонт квартиры');assert.equal(p.number_series,null);});
 await check('The ordinal continues when the calendar year changes',async()=>{
   const last=(await db.query("select max(number_sequence) n from projects where number_series='architecture'")).rows[0].n;
   assert.equal((await db.query('select arhittek_security.project_number_highwater($1,$2) n',['architecture',year+1])).rows[0].n,last);
 });
 await check('A stale folder number leaves both the counter and the card unchanged',async()=>{
   const next=async()=>(await as('owner','select get_next_project_numbers() n')).rows[0].n.find(row=>row.series==='landscape');
   const preview=await next();
   const insertWithPreview=()=>as('owner','insert into projects(name,project_title,category_id,status_id,number_year,number_sequence) values($1,$1,$2,$3,$4,$5) returning name',['Сад',U(12),U(20),preview.year,preview.sequence]);
   const assigned=await insertWithPreview();
   assert.equal(assigned.rows[0].name,preview.prefix+' Сад');
   await assert.rejects(insertWithPreview,error=>error.code==='PT409');
   assert.equal((await next()).sequence,preview.sequence+1);
 });
 console.log(JSON.stringify(out,null,2));await db.close();if(out.some(x=>!x.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
