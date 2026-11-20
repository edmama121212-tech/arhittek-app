'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cases=[
 ['direction','Не учесть оклад как ожидаемый доход',1500],
 ['next','Включить принятого сотрудника со следующего месяца',2300],
 ['same','Оставить оклад уже включённого сотрудника',1100],
 ['raise','Поднять оклад с нового месяца по карточке',1800],
 ['future','Согласовать новый тариф после будущего первого периода',2000],
 ['stopped','Возобновить выплаты после остановки прежнего договора',1500],
 ['partial','Проверить долг и назначение после частичной выплаты',2000.25],
 ['cent','Назначить выплату с копейками на 28-е число',3200.95],
 ['twins','Выбрать второго сотрудника с тем же именем',1500],
 ['cancel','Отложить решение о включении оклада',1500],
 ['double','Подтвердить один оклад при двойном нажатии',1200],
 ['archive','Исключить завершившего работу сотрудника',900],
 ['piece','Исключить сотрудника на сдельной оплате',1000]
];
function staff(uuid){
 return cases.map(([mode,,amount],i)=>({id:uuid(6800+i),name:['direction','twins'].includes(mode)?'Учебный Адам':'Учебный сотрудник '+(i+1),role:mode==='twins'?'Визуализатор':'Архитектор',is_salaried:mode!=='piece',active:mode!=='archive',fixed_salary:amount}));
}
exports.seed=async(db,uuid)=>{
 for(const e of staff(uuid))await db.query('insert into public.employees(id,name,role,is_salaried,active,fixed_salary) values($1,$2,$3,$4,$5,$6)',Object.values(e));
};
exports.run=async({page,fw,db,command,snap,wallet,uuid,day,shift,build,browser,expectedTile,twoFrames})=>{
 const employees=staff(uuid);
 await page.evaluate(async staff=>{__db.employees.push(...staff);await loadAll();},employees);
 const rows=[['Элемент','Сборка index/finance','Сценарий','Шаги и данные','Фактический исход и связи','Открытие или доступность, мс','До результата, мс','Вид и удобство','Стенд','Итог']];
 const month=day.slice(0,7)+'-01',next=shift(month,0,1),later=shift(month,0,2);
 const go=async name=>{await fw.locator('[data-fw-tab=more]').click();await fw.getByRole('button',{name,exact:true}).click();};
 for(const [i,[mode,task,amount]] of cases.entries()){
  const e=employees[i],label='Оклад · '+e.name,id=uuid(7000+i);
  const old=['same','raise','future','stopped'].includes(mode);
  if(old){
   await command('rule',{employee_id:e.id,label,amount:mode==='same'?amount:750,direction:'expense',certainty:'confirmed',start_month:mode==='future'?next:month,due_day:12,reason:'Учебный оклад'},id);
   if(mode==='stopped')await command('stop_rule',{id,reason:'Договор завершён'},uuid(7100+i));
   await page.evaluate(()=>loadAll());
  }
  const before=await snap(),cash=await expectedTile('Сейф'),income=await expectedTile('Ожидаем до конца месяца');
  const start=['direction','partial','double'].includes(mode)?month:mode==='future'?later:next;
  await go('Регулярные платежи');
  const btn=fw.locator('[data-fw=salary-rule][data-id="'+e.id+'"]'),dialog=page.getByRole('dialog');
  const t=performance.now();
  let finish,steps='Финансы → Ещё → Регулярные платежи → '+e.name+' ('+e.role+'), оклад '+amount+' ₽',ux,summary;
  const hidden=['archive','piece'].includes(mode),skip=hidden||mode==='same';
  if(hidden){
   assert.equal(await btn.count(),0);
   assert.ok(await fw.locator('[data-fw=salary-rule]').first().isVisible());await twoFrames(page);
   ux='Список предлагает только действующие оклады.';summary='Доступных действий для выбранного сотрудника 0.';
  }else if(mode==='same'){
   assert.ok(await btn.isDisabled());assert.match(await btn.innerText(),/уже в календаре/);
   await twoFrames(page);ux='Состояние видно в строке сотрудника.';summary='Тариф уже действует. Повторная запись недоступна.';
  }else{
   if(mode==='twins'){
    const row=fw.locator('.fw-row').filter({hasText:e.name}).filter({hasText:e.role}).filter({has:page.locator('[data-fw=salary-rule]')});
    assert.equal(await row.count(),1);await row.getByRole('button').click();
   }else await btn.click();
   await dialog.waitFor();await twoFrames(page);
   assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   ux='Форма помещается при ширине 390 px, сотрудник и сумма видны.';
  }
  const open=Math.round(performance.now()-t);
  let at=performance.now();
  if(!skip){
   const f=key=>dialog.locator('[name="'+key+'"]');
   assert.equal(await f('amount').inputValue(),String(amount));
   if(mode==='future')assert.equal(await f('start_month').inputValue(),later.slice(0,7));
   if(mode==='next')assert.equal(await f('start_month').inputValue(),next.slice(0,7));
   await f('start_month').fill(start.slice(0,7));if(mode==='cent')await f('due_day').fill('28');
   await f('reason').fill('Оклад по учебному договору');
   const direction=dialog.locator('select[name=direction]');
   if(mode==='direction' && await direction.count() && await direction.isEnabled() && await direction.locator('option[value=income]').count())await direction.selectOption('income');
   steps+=' → первый месяц '+start.slice(0,7)+(mode==='cent'?' → до 28 числа':'')+(mode==='cancel'?' → Закрыть':' → Подтвердить');
   if(process.env.SALARY_RULE_SHOT&&mode==='raise')await dialog.screenshot({path:process.env.SALARY_RULE_SHOT});
   at=performance.now();
   if(mode==='cancel')await dialog.getByRole('button',{name:'Закрыть'}).click();
   else if(mode==='double')await dialog.getByRole('button',{name:'Подтвердить'}).dblclick();
   else await dialog.getByRole('button',{name:'Подтвердить'}).click();
   await dialog.waitFor({state:'hidden'});await twoFrames(page);
  }
  finish=skip?open:Math.round(performance.now()-at);
  const after=await snap(),created=!skip&&mode!=='cancel';
  assert.deepEqual(after.operations,before.operations);assert.deepEqual(after.workspace.wallets,before.workspace.wallets);
  assert.equal(after.workspace.rules.length,before.workspace.rules.length+Number(created));
  const match=after.workspace.rules.filter(r=>r.employee_id===e.id&&r.start_month===start&&r.amount===amount);
  if(created){
   assert.equal(match.length,1);const rule=match[0];assert.equal(rule.direction,'expense','Оклад оказался плановым поступлением');
   if(mode==='raise'||mode==='future')assert.equal(after.workspace.rules.find(x=>x.id===id).end_month.slice(0,7),shift(start,0,-1).slice(0,7));
   if(mode==='cent')assert.equal(rule.due_day,28);
   const item=after.workspace.items.find(x=>x.key==='rule:'+rule.id+':'+start.slice(0,7));assert.equal(item.remaining,amount);assert.equal(item.employee_id,e.id);
   await go('Платёжный календарь');
   const pay=fw.locator('[data-fw=pay][data-id="'+item.key+'"]');
   assert.ok(await pay.isVisible());summary='В календаре расход '+amount+' ₽ с '+start.slice(0,7)+'. Новых движений денег 0.';
   if(mode==='partial'){
    await pay.click();await dialog.locator('[name=amount]').fill('500.15');await dialog.locator('[name=reason]').fill('Часть зарплаты');
    await dialog.getByRole('button',{name:'Подтвердить'}).click();await dialog.waitFor({state:'hidden'});
    const paid=await snap();assert.equal(paid.workspace.items.find(x=>x.key===item.key).remaining,1500.10);
    const ledger=await db.query('select type,description,amount from public.ledger_entries where payee_employee_id=$1',[e.id]);
    assert.equal(ledger.rows.length,1);assert.equal(ledger.rows[0].type,'salary_payment');assert.ok(ledger.rows[0].description.includes('[salary:'+shift(start,0,-1).slice(0,7)+']'));
    steps+=' → календарь → выплатить 500,15 ₽';summary+=' После частичной выплаты осталось 1500,10 ₽, одна запись зарплаты за предыдущий месяц.';
   }
  }else if(!summary)summary='После закрытия календарь сохранил прежний состав.';
  assert.deepEqual(after.workspace.rules.filter(x=>x.employee_id!==e.id),before.workspace.rules.filter(x=>x.employee_id!==e.id));
  await fw.locator('[data-fw-tab=overview]').click();assert.equal(await expectedTile('Ожидаем до конца месяца'),income);
  assert.equal(await expectedTile('Сейф'),mode==='partial'?cash-500.15:cash);
  rows.push(['UI-0330',build,task,steps,summary+' Ожидаемый доход '+income+' ₽. Сейф '+await expectedTile('Сейф')+' ₽.',open,finish,ux,'Chromium '+browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);console.log(mode,open,finish);
 }
 const final=await snap();
 await assert.rejects(command('rule',{label:'Старый клиент',amount:1800,direction:'income',due_day:10,start_month:next,
  employee_id:employees.at(-1).id,certainty:'confirmed',reason:'Проверка устаревшей формы'},uuid(7299)),/Оклад сотрудника учитывается как расход/);
 assert.equal((await snap()).revision,final.revision);
 if(process.env.SALARY_RULE_CSV)fs.writeFileSync(process.env.SALARY_RULE_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
