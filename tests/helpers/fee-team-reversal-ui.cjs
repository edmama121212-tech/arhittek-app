'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const people=['Первый','Второй','Третий','Четвёртый'];
// Person indices express the team after the payout. The fixture balances belong
// to these named employees at the instant the owner opens the reversal.
const cases=[
 ['Основной исполнитель остался в проекте',0,0,1,160,75,120,75],
 ['Соисполнитель остался в проекте',1,0,1,120,115,120,75],
 ['Основного исполнителя заменили',0,2,1,88,75,88,75],
 ['Соисполнителя заменили',1,0,2,120,88,120,88],
 ['Прежний основной теперь соисполнитель',0,2,0,88,160,88,120],
 ['Прежний соисполнитель ведёт проект',1,1,2,115,88,75,88],
 ['В проекте сменились оба исполнителя',1,2,3,88,92,88,92],
 ['Прежний соисполнитель снят без замены',1,0,null,120,0,120,0],
 ['После перехода на оплату по площади сумма слотов сохранена',0,0,1,160,75,160,75,'m2'],
 ['Владелец передумал отменять выплату бывшему исполнителю',0,2,1,88,75,88,75,'cancel'],
];
const person=(id,i)=>i===null?null:id(9450+i);
async function seed(db,id){
 for(const [i,name] of people.entries())await db.query("insert into public.employees(id,name,role) values($1,$2,'Архитектор')",[person(id,i),name]);
 for(const [i,c] of cases.entries())await db.query("insert into public.projects(id,name,employee_id,co_employee_id,price,advance,balance,fee_paid,co_fee_paid,fee_base) values($1,$2,$3,$4,1500,300,1200,120,75,'profit')",[id(9470+i),c[0],person(id,0),person(id,1)]);
}
async function run({page,fw,db,command,snap,day,wallet,uuid,build,browser,expectedTile,twoFrames}){
 const rows=[['Элемент','Сборка index/finance','Маршрут','Подготовка и шаги','Что проверено','Открытие, мс','Решение до двух кадров, мс','Вид и удобство','Стенд/UTC','Итог']];
 await page.exposeFunction('qaReverseFee',async args=>{
  try{return {data:(await db.query('select public.confirm_financial_operation($1,$2,$3,$4) as j',[args.p_command,args.p_payload,args.p_operation,args.p_revision])).rows[0].j,error:null};}
  catch(error){return {data:null,error:{message:error.message}};}
 });
 await page.evaluate(()=>{const prior=sb.rpc.bind(sb);sb.rpc=(name,args)=>name==='confirm_financial_operation'?qaReverseFee(args):prior(name,args);});
 const sheet=page.locator('#financialJournalSheet');
 for(const [i,[task,recipient,main,co,paidMain,paidCo,afterMain,afterCo,mode]] of cases.entries()){
  const project=uuid(9470+i),plan=uuid(9500+i),source=uuid(9530+i),reason='Возврат гонорара '+(i+1);
  const startCash=(await snap()).workspace.cash;
  await command('plan',{label:'Гонорар '+(i+1),direction:'expense',amount:40,due_date:day,employee_id:person(uuid,recipient),project_id:project,funding:'reserve',certainty:'confirmed',reason:'Учебное назначение выплаты'},plan);
  const paid=await command('pay',{key:plan,amount:40,wallet_id:wallet,date:day,reason:'Учебная выплата '+(i+1)},source);
  assert.equal(paid.workspace.cash,startCash-40);
  const counters=async()=> (await db.query('select fee_paid,co_fee_paid,employee_id,co_employee_id,advance,balance from public.projects where id=$1',[project])).rows[0];
  const original=await counters();assert.equal(Number(original.fee_paid),recipient===0?160:120);assert.equal(Number(original.co_fee_paid),recipient===1?115:75);
  await db.query('update public.projects set employee_id=$1,co_employee_id=$2,fee_base=$3,fee_paid=$4,co_fee_paid=$5 where id=$6',[person(uuid,main),person(uuid,co),mode==='m2'?'m2':'profit',paidMain,paidCo,project]);
  const target=paid.operations.find(o=>o.source_id===source);assert.ok(target);
  await page.evaluate(()=>loadAll());
  await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name:'История операций',exact:true}).click();
  const t=performance.now();
  await fw.locator('[data-journal="reverse"][data-id="'+target.id+'"]').click();await sheet.waitFor();await twoFrames(page);
  const open=Math.round(performance.now()-t);
  assert.match(await sheet.locator('h3').innerText(),new RegExp('№'+target.revision+'$'));
  assert.equal(await sheet.locator('.fv').innerText(),new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(40));
  assert.ok(await sheet.locator('.sheet').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await sheet.locator('#journalReason').fill(reason);
  const submit=performance.now();
  await sheet.locator(mode==='cancel'?'#journalCancel':'#journalConfirm').click();await sheet.waitFor({state:'hidden'});await twoFrames(page);
  const end=Math.round(performance.now()-submit),j=await snap(),p=await counters(),cash=startCash-(mode==='cancel'?40:0);
  assert.equal(j.workspace.cash,cash);assert.equal(Number(p.fee_paid),afterMain);assert.equal(Number(p.co_fee_paid),afterCo);
  assert.equal(p.employee_id,person(uuid,main));assert.equal(p.co_employee_id,person(uuid,co));assert.equal(Number(p.advance),300);assert.equal(Number(p.balance),1200);
  const entry=(await db.query('select deleted_at,payee_employee_id from public.ledger_entries where id=$1',[source])).rows[0];
  assert.equal(entry.payee_employee_id,person(uuid,recipient));assert.equal(Boolean(entry.deleted_at),mode!=='cancel');
  assert.equal(j.operations.filter(o=>o.reverses===target.id).length,mode==='cancel'?0:1);
  const item=j.workspace.items.find(x=>x.key===plan);assert.equal(item?.remaining||0,mode==='cancel'?0:40);
  if(item)assert.equal(item.employee_id,person(uuid,recipient));
  await fw.locator('[data-fw-tab="overview"]').click();assert.equal(await expectedTile('Сейф'),cash);
  rows.push(['UI-0334',build,task,'Выплатить 40 ₽ сотруднику «'+people[recipient]+'»; подготовить состав '+[people[main],people[co]||'без соисполнителя'].join(' / ')+' → Финансы → Ещё → История → запись №'+target.revision+' → Отменить с причиной → '+(mode==='cancel'?'Закрыть':'Подтвердить')+' → Главная финансов',
   'Выплачено основному '+paidMain+' → '+afterMain+' ₽; соисполнителю '+paidCo+' → '+afterCo+' ₽. Сейф '+(startCash-40)+' → '+cash+' ₽. Долг клиента 1200 ₽. В плане первоначального получателя осталось '+(item?.remaining||0)+' ₽.',open,end,'В форме видны номер и сумма 40 ₽; ширина формы в пределах окна.',browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);
 }
 if(process.env.FEE_TEAM_REVERSAL_CSV)fs.writeFileSync(process.env.FEE_TEAM_REVERSAL_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('10 fee reversal journeys through team changes passed');
}
module.exports={seed,run};
