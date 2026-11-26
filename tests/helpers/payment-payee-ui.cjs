'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {installBridge}=require('./card-payment-ui.cjs');
const scenarios=[
 ['round','Доплатить 20 копеек исполнителю после 10 копеек',1,0.2],
 ['coRound','Доплатить 10 копеек соисполнителю после 20 копеек',2,0.1],
 ['change','Исправить получателя до выдачи',1,20],
 ['onlyCo','Выдать соисполнителю договора без основного исполнителя',2,45],
 ['twins','Выбрать соисполнителя среди двух тёзок',2,18],
 ['twoRoles','Выдать один раз сотруднику, занимающему две роли',1,17],
 ['m2','Оплатить работу основного исполнителя со ставкой за м²',1,25],
 ['third','Выдать деньги исполнителю начисления за м²',3,21],
 ['dupe','Выдать одну выплату по двум начислениям одного исполнителя',3,35],
 ['deleted','Не включать сотрудника с отменённым начислением',1,14],
 ['switch','После выбора соисполнителя перейти на приём аванса',2,33],
 ['cancel','Отменить выдачу после выбора получателя',2,40],
 ['noFunds','Сохранить выбранного получателя после отказа кассы',2,60000]
];
const people=(uuid)=>[null,uuid(9401),uuid(9402),uuid(9403)];
const cents=n=>Math.round(Number(n)*100);
function project(uuid,mode,i){
 const [,a,b]=people(uuid);
 return {id:uuid(9410+i),name:'Договор выплат '+(i+1),category_id:uuid(9405),status_id:'active',price:1000,advance:200,balance:800,
  payment_status:'Частично оплачен',fee_base:['m2','third','dupe'].includes(mode)?'m2':'profit',fee_paid:0.1,co_fee_paid:0.2,
  employee_id:mode==='onlyCo'?null:a,co_employee_id:mode==='twoRoles'?a:b};
}
function allocationIds(mode){return mode==='dupe'?[3,3]:['third','deleted'].includes(mode)?[3]:[];}
async function prepare(db,uuid){
 await db.query("insert into public.categories(id,name) values($1,'Архитектура')",[uuid(9405)]);
 for(const [i,id] of people(uuid).entries())if(id)await db.query("insert into public.employees(id,name,role) values($1,$2,'Архитектор')",[id,i===3?'Исполнитель отделки':'Тестовый Алексей']);
 for(const [i,[mode]] of scenarios.entries()){
  const p=project(uuid,mode,i);
  await db.query('insert into public.projects(id,name,category_id,price,advance,balance,payment_status,fee_base,fee_paid,co_fee_paid,employee_id,co_employee_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[p.id,p.name,p.category_id,p.price,p.advance,p.balance,p.payment_status,p.fee_base,p.fee_paid,p.co_fee_paid,p.employee_id,p.co_employee_id]);

 }
}
async function run({page,db,uuid,day,snap,build,browser,expectedTile,twoFrames}){
 await installBridge(page,db);
 const all=people(uuid),projects=scenarios.map(([mode],i)=>project(uuid,mode,i));
 for(const [i,[mode]] of scenarios.entries()){
  const p=projects[i];
  for(const [j,k] of allocationIds(mode).entries()){
   await db.query("insert into public.ledger_entries(id,project_id,type,amount,payee_employee_id,description,deleted_at) values($1,$2,'role_payout',100,$3,'Оплата за м²',$4)",[uuid(9500+i*5+j),p.id,people(uuid)[k],mode==='deleted'?'2026-01-01':null]);
  }
 }
 const ledger=(await db.query("select * from public.ledger_entries where type='role_payout'")).rows;
 await page.evaluate(async({all,projects,ledger})=>{
  __db.categories.push({...__db.categories.find(c=>c.id==='arch'),id:projects[0].category_id});
  __db.employees.push(...all.slice(1).map((id,i)=>({id,name:i===2?'Исполнитель отделки':'Тестовый Алексей',role:'Архитектор',active:true})));
  __db.projects=projects;__db.ledger_entries=ledger;__db.audit_log=[];await loadAll();
 },{all,projects,ledger});
 const rows=[['Элемент','Сборка index/finance','Сценарий','Шаги','Фактический результат и связи','Выбор получателя, мс','До результата, мс','Визуально и удобно','Стенд','Статус']];
 for(const [i,[mode,task,k,amount]] of scenarios.entries()){
  const p=projects[i],recipient=all[k];
  const before=(await snap()).workspace.cash;
  await page.locator('.nav-btn[data-view="view-projects"]').click();
  await page.locator('#projectsCard .proj-row').filter({has:page.getByText(p.name,{exact:true})}).click();
  await page.locator('#project-tab-money').click();await page.locator('#pf-add-payment').click();
  const modal=page.locator('#paymentSheetOverlay'),field=modal.locator('#payment-payee');
  await modal.locator('[data-value="fee_payment"]').click();
  const options=await field.locator('option').evaluateAll(os=>os.map(o=>[o.value,o.textContent]));
  const members=[...new Set([p.employee_id,p.co_employee_id,...(mode==='deleted'?[]:allocationIds(mode).map(n=>all[n]))].filter(Boolean))];
  assert.deepEqual(options.map(o=>o[0]).sort(),members.sort());
  if(mode==='twins')assert.equal(new Set(options.map(o=>o[1])).size,options.length,'У тёзок разные видимые подписи');
  if(mode==='change')await field.selectOption(all[2]);
  const start=performance.now();await field.selectOption(recipient);await twoFrames(page);
  const selectMs=Math.round(performance.now()-start),label=options.find(o=>o[0]===recipient)[1];
  const box=await field.boundingBox();assert.ok(box.height>=40&&box.width>0&&box.x>=0&&box.x+box.width<=page.viewportSize().width+1);
  if(mode==='twins'&&process.env.PAYEE_SHOT)await modal.locator('.sheet').screenshot({path:process.env.PAYEE_SHOT});
  if(mode==='switch'){await modal.locator('[data-value="advance"]').click();assert.equal(await field.isVisible(),false);}
  await modal.locator('#payment-amount').fill(String(amount));await modal.locator('#payment-note').fill(task);
  const confirm=performance.now();
  if(mode==='cancel')await modal.locator('#paymentSheetClose').click();
  else await modal.locator('#payment-save').click();
  if(mode==='noFunds'){
   await page.locator('#toast').filter({hasText:/недостаточ/i}).waitFor();assert.equal(await field.inputValue(),recipient);
  }else await modal.waitFor({state:'hidden'});
  await twoFrames(page);const resultMs=Math.round(performance.now()-confirm);
  if(mode==='noFunds')await modal.locator('#paymentSheetClose').click();
  const posted=!['noFunds','cancel'].includes(mode),fee=posted&&mode!=='switch';
  const stored=(await db.query('select fee_paid,co_fee_paid,advance,balance from public.projects where id=$1',[p.id])).rows[0];
  const entries=(await db.query("select payee_employee_id,type,amount from public.ledger_entries where project_id=$1 and type<>'role_payout'",[p.id])).rows;
  assert.equal(entries.length,Number(posted),mode);
  if(posted){assert.equal(entries[0].payee_employee_id,fee?recipient:null);assert.equal(entries[0].type,fee?'fee_payment':'advance');assert.equal(cents(entries[0].amount),cents(amount));}
  assert.equal(cents(stored.fee_paid),10+(fee&&p.employee_id===recipient&&p.fee_base!=='m2'?cents(amount):0));
  assert.equal(cents(stored.co_fee_paid),20+(fee&&p.employee_id!==recipient&&p.co_employee_id===recipient&&p.fee_base!=='m2'?cents(amount):0));
  assert.equal(cents(stored.advance),20000+(mode==='switch'?cents(amount):0));
  assert.equal(cents(stored.balance),80000-(mode==='switch'?cents(amount):0));
  await page.locator('#pf-cancel').click();await page.locator('.nav-btn[data-view="view-finance"]').click();
  const cash=(await snap()).workspace.cash;
  assert.equal(cents(cash)-cents(before),!posted?0:fee?-cents(amount):cents(amount));
  assert.equal(cents(await expectedTile('Сейф')),cents(cash));
  rows.push(['UI-0181',build,task,'Проекты → '+p.name+' → Деньги → Принять платёж → Выплата команде → '+(mode==='change'?'соисполнитель → ':'')+label+(mode==='switch'?' → Аванс':'')+' → '+amount+' ₽ → '+(mode==='cancel'?'Закрыть':'Сохранить')+' → Финансы',
   'Допустимых получателей '+members.length+'. Новых записей '+entries.length+'. '+(fee?'Выплата назначена выбранному сотруднику. ':mode==='switch'?'Принят аванс без получателя. ':'Выплата отсутствует. ')+'Гонорар выплачен: основной '+stored.fee_paid+' ₽, соисполнитель '+stored.co_fee_paid+' ₽. Долг клиента '+stored.balance+' ₽. Сейф '+before+' → '+cash+' ₽.',selectMs,resultMs,'Поле '+Math.round(box.width)+'×'+Math.round(box.height)+' px в пределах экрана. Выбранная подпись «'+label+'».',browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);
  console.log(mode,selectMs,resultMs);
 }
 if(process.env.PAYEE_CSV)fs.writeFileSync(process.env.PAYEE_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
}
module.exports={prepare,run};
