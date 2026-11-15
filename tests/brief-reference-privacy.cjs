'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const U=n=>'71000000-0000-4000-8000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();let n=0;
 try{
 await db.exec(fs.readFileSync('tests/fixtures/session-security-baseline.sql','utf8'));
 await db.exec("create table storage.buckets(id text primary key,public boolean);insert into storage.buckets values('tz-references',true);");
 for(const [id,name,role,admin]of[[1,'Мансур','Директор',true],[2,'Worker A','Архитектор',false],[3,'Worker B','Архитектор',false]]){
 await db.query('insert into public.employees(id,name,role,is_admin,can_see_projects,active) values($1,$2,$3,$4,true,true)',[U(id),name,role,admin]);
 await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day')",[U(id),'private-media-fixture-'+String(id).repeat(45)]);
 }
 await db.query("insert into public.projects(id,name,employee_id) values($1,'A',$2),($3,'B',$4)",[U(10),U(2),U(11),U(3)]);
 await db.query("insert into public.tz_forms(id,project_id,token) values($1,$2,'brief-A-fixture'),($3,$4,'brief-B-fixture')",[U(20),U(10),U(21),U(11)]);
 const a='tz-refs/'+U(20)+'/a.png',b='tz-refs/'+U(21)+'/b.png';
 await db.query("insert into storage.objects(bucket_id,name) values('tz-references',$1),('tz-references',$2),('tz-references','_orphaned/old.png')",[a,b]);
 await db.exec(fs.readFileSync('supabase/session-security.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/brief-reference-privacy.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/brief-reference-privacy.sql','utf8'));
 const as=async(h,sql,p=[])=>{await db.exec('begin;set local role anon');try{await db.query("select set_config('request.headers',$1,true)",[JSON.stringify(h)]);return await db.query(sql,p);}finally{await db.exec('rollback');}};
 const visible=async h=>(await as(h,"select name from storage.objects where bucket_id='tz-references' order by name")).rows.map(x=>x.name);
 const eq=(a,b)=>{assert.deepEqual(a,b);n++;};
 eq((await db.query("select public from storage.buckets where id='tz-references'")).rows[0].public,false);
 eq(await visible({}),[]);eq(await visible({'x-tz-token':'wrong'}),[]);
 eq(await visible({'x-tz-token':'brief-A-fixture'}),[a]);eq(await visible({'x-tz-token':'brief-B-fixture'}),[b]);
 eq(await visible({'x-session-token':'private-media-fixture-'+'2'.repeat(45)}),[a]);
 eq(await visible({'x-session-token':'private-media-fixture-'+'3'.repeat(45)}),[b]);
 eq((await visible({'x-session-token':'private-media-fixture-'+'1'.repeat(45)})).length,3);
 eq((await as({'x-tz-token':'brief-A-fixture'},"insert into storage.objects(bucket_id,name) values('tz-references',$1) returning name",[a+'2'])).rows.length,1);
 await assert.rejects(()=>as({'x-tz-token':'brief-A-fixture'},"insert into storage.objects(bucket_id,name) values('tz-references',$1)",[b+'2']));n++;
 eq((await as({'x-tz-token':'brief-A-fixture'},"delete from storage.objects where name=$1 returning name",[b])).rows.length,0);
 for(const path of ['tz-refs/'+U(20)+'/../'+U(21)+'/b.png','tz-refs/'+U(20)+'/./a.png','tz-refs/'+U(20)+'//','tz-refs/invalid/a.png']){
 eq((await as({'x-tz-token':'brief-A-fixture'},'select arhittek_security.tz_reference_access($1) ok',[path])).rows[0].ok,false);
 }
 await db.query("update public.projects set deleted_at=now() where id=$1",[U(10)]);
 eq(await visible({'x-tz-token':'brief-A-fixture'}),[]);
 console.log('Private brief reference RLS checks passed: '+n);
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
