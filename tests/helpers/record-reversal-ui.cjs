'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
module.exports=async function({page,fw,db,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames,read}){
 await page.exposeFunction('qaReverseRecord',async a=>{
  try{return {data:(await db.query('select public.confirm_financial_operation($1,$2,$3,$4)',[a.p_command,a.p_payload,a.p_operation,a.p_revision])).rows[0].confirm_financial_operation,error:null};}
  catch(e){return {data:null,error:{message:e.message,code:e.code}};}
 });
 await page.evaluate(()=>{const old=sb.rpc.bind(sb);sb.rpc=(name,args)=>name==='confirm_financial_operation'?qaReverseRecord(args):old(name,args);});
 const expected=()=>expectedTile('Ожидаем до конца месяца');
 const overview=async()=>{await page.evaluate(()=>loadAll());const back=fw.locator('[data-fw-tab="overview"]').first();if(await back.isVisible())await back.click();await fw.getByRole('button',{name:'Записать поступление',exact:true}).waitFor();};
 const rows=[['Состояние сборки и SQL','Сценарий','Шаги','Факт','Отклик отмены до результата, мс','Визуальная проверка и удобство','Браузер / UTC']];
 const label='Учебная одинаковая оплата',ids=()=>crypto.randomUUID();
 let version=build+' до исправления SQL';
 const add=async(amount,action='record-income')=>{
  const prior=await snap(),known=new Set(prior.workspace.items.map(x=>x.key));
  if(action==='record-income')await fw.getByRole('button',{name:'Записать поступление',exact:true}).click();
  else {await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name:'Платёжный календарь',exact:true}).click();await fw.locator('[data-fw="income"]').click();}
  const modal=page.locator('#financeWorkspaceModal');
  await modal.locator('[name="label"]').fill(label);await modal.locator('[name="amount"]').fill(String(amount));
  if(action!=='record-income')await modal.locator('[name="due_date"]').fill(day);
  await modal.locator('[type="submit"]').click();await modal.waitFor({state:'hidden'});
  const j=await snap();
  if(action!=='record-income')return j.workspace.items.find(x=>!known.has(x.key)&&x.label===label&&Number(x.remaining)===amount).key;
  return j.operations.find(o=>o.revision>prior.revision&&Number(o.cash_delta)===amount&&String(o.reason).includes(label));
 };
 const reverse=async(op)=>{
  await overview();await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name:'История операций',exact:true}).click();
  await fw.locator('[data-journal="reverse"][data-id="'+op.id+'"]').click();
  const dialog=page.locator('#financialJournalSheet');
  assert.ok(await dialog.locator('.sheet').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await dialog.locator('#journalReason').fill('Отмена учебной оплаты');
  const t=performance.now();await dialog.locator('#journalConfirm').click();await dialog.waitFor({state:'hidden'});await twoFrames(page);
  const ms=Math.round(performance.now()-t);await overview();return ms;
 };
 const remaining=(j,key)=>j.workspace.items.find(x=>x.key===key)?.remaining??0;
 const keyOf=async op=>{
  await db.exec('reset role');
  try{return (await db.query('select plan_key from arhittek_finance.settlements where source_id=$1',[op.source_id])).rows[0].plan_key;}
  finally{await db.exec('set role anon');}
 };
 const log=(task,steps,message,ms)=>rows.push([version,task,steps,message,ms,'Форма отмены помещается при 390 px, число сверено на финансовой главной.',browser.version()+' / '+new Date().toISOString()]);
 const base=await expected(),cash=await expectedTile('Сейф');
 const legacy=await add(327.4),oldKey=await keyOf(legacy),oldMs=await reverse(legacy);
 assert.equal(await expected(),base+327.4);assert.equal(remaining(await snap(),oldKey),327.4);assert.equal(await expectedTile('Сейф'),cash);
 log('Воспроизведение старой ошибки','Финансы → Записать поступление 327,40 ₽ → История → Отменить с причиной → Финансы','Сейф восстановлен до '+cash+' ₽. В ожиданиях появилось лишних 327,40 ₽.',oldMs);
 console.log('BEFORE',await expected(),cash);
 const adopted=await add(33.33),adoptedKey=await keyOf(adopted);await reverse(adopted);
 await command('reschedule',{key:adoptedKey,due_date:shift(day,32),reason:'Пользователь подтвердил новый срок'},ids());
 await overview();
 const deliberate=await add(327.4,'plan');
 await command('pay',{key:deliberate,amount:127.4,date:day,wallet_id:wallet,reason:'Частичная оплата по договорённости'},ids());
 const paid=(await snap()).operations.find(o=>Number(o.cash_delta)===127.4);
 await overview();
 const migration=read('supabase/migrations/20261120100000_record_reversal.sql');
 await db.exec('reset role');
 // Import fixture without any command provenance, deliberately identical to the apparent one-off plan.
 const unattributed=uuid(9963);
 await db.query("insert into arhittek_finance.plans(id,label,direction,amount,due_date,certainty) values($1,$2,'income',327.4,$3,'confirmed')",[unattributed,label,shift(day,32)]);
 const storedSnapshot=async()=>{const result=[];for(const table of ['plans','operations','settlements','plan_history','workspace_requests']){
  result.push((await db.query('select md5(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text) as hash from arhittek_finance.'+table+' t')).rows[0].hash);
 }return result;};
 const stored=await storedSnapshot();await db.exec(migration);await db.exec(migration);
 assert.deepEqual(await storedSnapshot(),stored);await db.exec('set role anon');
 version=build+' / SQL '+crypto.createHash('sha256').update(migration).digest('hex').slice(0,12);
 const t=performance.now();await overview();await twoFrames(page);
 assert.equal(remaining(await snap(),oldKey),0);assert.equal(await expected(),base+200);
 assert.equal(remaining(await snap(),adoptedKey),33.33);assert.equal(remaining(await snap(),unattributed),327.4);
 assert.equal((await snap()).workspace.items.find(i=>i.key===adoptedKey).due_date,shift(day,32));
 log('Состояние старых данных при переходе на новую сборку','Открыть тот же журнал после обновления, сверить обычный план и перенесённую вручную старую строку','Лишние 327,40 ₽ ушли. Ожидается '+(base+200)+' ₽. Явно перенесённая пользователем строка на 33,33 ₽ и импортированная строка без доказательства происхождения сохранились. Данные пяти таблиц совпадают до и после.',Math.round(performance.now()-t));
 const manualMs=await reverse(paid);
 assert.equal(remaining(await snap(),deliberate),327.4);assert.equal(await expected(),base+327.4);
 log('Отмена частичной оплаты реального плана','Запланировать поступление 327,40 ₽ → оплатить 127,40 ₽ → отменить эту оплату → Финансы','Настоящий план с тем же названием восстановлен с 200 до 327,40 ₽.',manualMs);
 const corrected=await add(327.4),key=await keyOf(corrected),ms=await reverse(corrected);
 assert.equal(remaining(await snap(),key),0);assert.equal(await expected(),base+327.4);assert.equal(await expectedTile('Сейф'),cash);
 log('Разовый приход после исправления','Финансы → Записать поступление 327,40 ₽ → История → Отменить с причиной → Финансы','В сейфе '+cash+' ₽. В ожиданиях только настоящий план на 327,40 ₽. Разовый приход повторно не запланирован.',ms);
 if(process.env.RECORD_REVERSAL_CSV)fs.writeFileSync(process.env.RECORD_REVERSAL_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('AFTER technical',remaining(await snap(),key),'actual plan',remaining(await snap(),deliberate),'safe',await expectedTile('Сейф'));
};
