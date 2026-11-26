'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

module.exports=async({page,fw,db,command,snap,day,shift,wallet,uuid,build,browser,expectedTile,twoFrames})=>{
 const main=uuid(8901),garden=uuid(8902),dialog=page.getByRole('dialog');
 const rows=[['Элемент','Сборка index/finance','Бизнес-сценарий','Шаги','Результат и связи','Открытие, мс','Действие до результата, мс','Подтверждение распределения до результата, мс','Визуальная проверка','Удобство','Стенд и время','Итог']];
 const projects=async()=>(await db.query('select * from public.projects order by id')).rows;
 const sources=async()=>(await db.query('select id,amount,type from public.ledger_entries order by id')).rows;
 const cases=[
  ['project','Привязать распределение к проекту после пропущенного выбора',120],
  ['today','Перевести согласованную сумму проекта в свободные деньги',240],
  ['part','Подтвердить часть запланированного распределения',370.75],
  ['cent','Распределить остаток с точностью до копейки',0.01],
  ['expected','Оставить предполагаемое распределение до согласования',300],
  ['future','Назначить распределение на следующий месяц',700],
  ['nodate','Записать отложенное решение без известного срока',350],
  ['empty','Запланировать распределение до получения средств по второму договору',250],
  ['switch','Перенаправить черновик распределения на другой договор',210],
  ['cancel','Отказаться от назначения распределения',100],
  ['comment','Зафиксировать отдельное договорное основание',160],
  ['double','Защитить календарь от двойного подтверждения',99]
 ];
 const field=name=>dialog.locator('[name="'+name+'"]');
 const cents=x=>Math.round(x*100);
 const calendar=async()=>{await fw.locator('[data-fw-tab=more]').click();await fw.locator('[data-fw-tab=calendar]').click();};
 await command('wallet',{name:'Касса объекта',kind:'cash',reason:'Касса второй площадки'},uuid(8904));
 await command('record',{direction:'income',label:'Аванс павильона',amount:5000,date:day,wallet_id:wallet,funding:'project:'+main,project_id:main,reason:'Договор павильона'},uuid(8903));
 await page.evaluate(async projects=>{__db.projects=projects;await loadAll();},await projects());
 for(const [i,[mode,task,amount]] of cases.entries()){
  const before=await snap(),original=await projects(),ledger=await sources(),cash=await expectedTile('Сейф'),income=await expectedTile('Ожидаем до конца месяца');
  const project=['empty','switch'].includes(mode)?garden:main,due=mode==='nodate'?'':mode==='future'?shift(day.slice(0,7)+'-01',0,1):day;
  const label='Этап '+(i+1)+' · '+(project===main?'Павильон':'Сад');
  await calendar();let start=performance.now();await fw.locator('[data-fw="release"]').click();await dialog.waitFor();await twoFrames(page);
  const open=Math.round(performance.now()-start),submit=dialog.getByRole('button',{name:'Добавить в план'});
  await field('label').fill(label);await field('amount').fill(String(amount));if(due)await field('due_date').fill(due);
  if(mode==='project'){
   await submit.click();
   if(!await field('project_id').evaluate(e=>e.validity.valueMissing)){
    await dialog.getByRole('alert').filter({hasText:/укажите проект/i}).waitFor();
    assert.fail('Предложено «Без проекта» и отправлено заведомо недействительное распределение');
   }
   assert.equal((await snap()).revision,before.revision);
  }
  if(mode==='switch')await field('project_id').selectOption(main);
  await field('project_id').selectOption(project);
  if(mode==='comment'||mode==='expected'){
   await dialog.locator('summary').click();assert.equal(await field('payroll_month').count(),0);assert.equal(await field('employee_id').count(),0);
   if(mode==='expected')await field('certainty').selectOption('expected');
   else await field('reason').fill('Решение по договору от заказчика');
  }
  const size=await dialog.boundingBox();assert.ok(size.width<=390 && size.x>=0);assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  if(process.env.RELEASE_PLAN_SHOT&&mode==='project')await dialog.screenshot({path:process.env.RELEASE_PLAN_SHOT});
  start=performance.now();
  if(mode==='double')await submit.dblclick();else if(mode==='cancel')await dialog.getByRole('button',{name:'Закрыть'}).click();else await submit.click();
  await dialog.waitFor({state:'hidden'});await twoFrames(page);
  const elapsed=Math.round(performance.now()-start),after=await snap(),old=new Set(before.workspace.items.map(x=>x.key));
  const added=after.workspace.items.filter(x=>!old.has(x.key));
  assert.equal(added.length,mode==='cancel'?0:1);assert.equal(after.revision-before.revision,added.length);
  assert.deepEqual(after.workspace.wallets,before.workspace.wallets);assert.deepEqual(after.balances,before.balances);assert.deepEqual(after.operations,before.operations);
  const day0=s=>s.workspace.forecast[0];
  const predicted=mode==='expected'||mode==='cancel'||due!==day?0:Math.min(amount,Math.max(0,before.balances['project:'+project]||0));
  assert.equal(cents(day0(after).expected-day0(before).expected),cents(predicted));
  assert.equal(day0(after).cash_expected,day0(before).cash_expected);
  let outcome='Изменение прогноза свободных денег на сегодня '+predicted+' ₽. ';
  if(mode==='future'){
   const onDue=s=>s.workspace.forecast.find(d=>d.date===due);
   assert.equal(cents(onDue(after).expected-onDue(before).expected),cents(amount));
   assert.equal(onDue(after).cash_expected,onDue(before).cash_expected);
   outcome+='На назначенную дату прогноз свободных денег вырос на '+amount+' ₽. ';
  }
  let extraSteps='',confirmMs='';
  if(added.length){
   const item=added[0];assert.equal(item.direction,'release');assert.equal(item.project_id,project);assert.equal(item.employee_id,null);assert.equal(item.remaining,amount);
   assert.equal(item.due_date,due||null);assert.equal(item.certainty,mode==='expected'?'expected':'confirmed');
   assert.equal(item.terms.basis,mode==='comment'?'Решение по договору от заказчика':label);
   const card=fw.locator('article').filter({has:page.getByRole('heading',{name:label,exact:true})});assert.ok(await card.isVisible());
   if(['today','part','cent','empty'].includes(mode)){
    await card.locator('[data-fw="pay"]').click();
    assert.equal(await dialog.getByLabel('Сумма распределения').count(),1);
    assert.equal(await field('wallet_id').count(),0);
    const pay=mode==='part'?88.25:amount;
    await field('amount').fill(String(pay));
    await field('reason').fill('Распределение по договору');
    const submitTime=performance.now();
    await dialog.getByRole('button',{name:'Подтвердить'}).click();
    extraSteps=' → Подтвердить распределение → '+pay+' ₽';
    if(mode==='empty'){
     await dialog.getByRole('alert').filter({hasText:/Недостаточно/}).waitFor();
     await twoFrames(page);confirmMs=Math.round(performance.now()-submitTime);
     assert.equal((await snap()).revision,after.revision);
     await dialog.getByRole('button',{name:'Закрыть'}).click();
     outcome+='Без денег проекта подтверждение отклонено, план сохранён. ';
    }else{
     await dialog.waitFor({state:'hidden'});await twoFrames(page);confirmMs=Math.round(performance.now()-submitTime);const paid=await snap();
     assert.deepEqual(paid.workspace.wallets,after.workspace.wallets);
     assert.equal(cents(paid.workspace.reserve-after.workspace.reserve),cents(pay));
     assert.equal(cents(after.balances[item.funding]-paid.balances[item.funding]),cents(pay));
     assert.equal(cents(paid.workspace.items.find(x=>x.key===item.key)?.remaining||0),cents(amount-pay));
     assert.equal(paid.operations.length,after.operations.length+1);assert.equal(paid.operations[0].cash_delta,0);
     outcome+='Свободно стало больше на '+pay+' ₽, целевые деньги уменьшились на столько же. В плане осталось '+(cents(amount-pay)/100)+' ₽. ';
    }
   }
  }else outcome+='Календарь сохранён без новой строки. ';
  assert.deepEqual(await projects(),original);assert.deepEqual(await sources(),ledger);
  await fw.locator('[data-fw-tab=overview]').click();assert.equal(await expectedTile('Сейф'),cash);assert.equal(await expectedTile('Ожидаем до конца месяца'),income);
  rows.push(['UI-0329',build,task,'Финансы → Ещё → Платёжный календарь → Запланировать распределение → '+label+' → '+amount+' ₽ → '+(due||'Без срока')+' → '+(mode==='cancel'?'Закрыть':'Добавить в план')+extraSteps,outcome+'Сейф '+cash+' ₽, долг клиента и ожидаемые поступления сохранены.',open,elapsed,confirmMs,'Форма '+size.width+' px без горизонтального переполнения.',mode==='project'?'Поле проекта показывает обязательный выбор.':mode==='empty'?'Виден отказ, введённый план сохраняется.':mode==='cancel'?'После закрытия виден календарь.':'В календаре доступны название и остаток распределения.',browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);
 }
 if(process.env.RELEASE_PLAN_CSV)fs.writeFileSync(process.env.RELEASE_PLAN_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('12 release plan journeys passed');
};
