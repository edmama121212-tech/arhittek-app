'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

module.exports=async function({page,fw,db,day,snap,shift,uuid,build,browser,expectedTile,twoFrames}){
  const project=uuid(701);
  const sources=async()=>Object.fromEntries(await Promise.all(['projects','company_income','ledger_entries'].map(async name=>[name,(await db.query('select * from public.'+name+' order by id')).rows])));
  await page.evaluate(async data=>{Object.assign(__db,data);await loadAll();},await sources());
  const next=shift(day.slice(0,7)+'-01',0,1);
  const cases=[
    {task:'Принять к планированию доход компании без зарплатного назначения',label:'Поступление субаренды',amount:300,due:day,details:true},
    {task:'Запланировать аванс заказчика, сохранив фактический долг по договору',label:'Аванс заказчика',amount:2700,project:true,due:day},
    {task:'Распределить второй этап договора на следующий месяц',label:'Оплата чертежей',amount:2500,project:true,due:next},
    {task:'Внести неподтверждённое поступление с известным сроком',label:'Ожидается согласование',amount:180,expected:true,due:day},
    {task:'Записать согласованный доход без назначенной даты',label:'Лицензионный платёж',amount:100.01},
    {task:'После планирования получить частичную оплату компании',label:'Возврат обеспечительного платежа',amount:120,due:day,receive:40.01},
    {task:'Исправить дату ранее начала нового учёта',label:'Перенесённая субаренда',amount:125,badDate:true,due:day},
    {task:'Сохранить отдельное основание согласования суммы',label:'Доплата по акту',amount:200.34,reason:'Письмо заказчика от 15 числа',due:day},
    {task:'Различить одноимённые этапы по сроку и сумме',label:'Оплата чертежей',amount:300.57,project:true,due:day},
    {task:'Отменить подготовленный аванс до добавления в календарь',label:'Черновой аванс',amount:1900,project:true,due:day,cancel:true},
    {task:'Исправить недопустимую точность банковской суммы',label:'Банковская выплата',amount:11.22,due:day,invalid:'11.222'},
    {task:'Переназначить аванс компании вместо выбранного договора',label:'Возврат арендатора',amount:850,due:day,resetProject:true}
  ];
  const report=[['Элемент','Сборка index/finance SHA256','Бизнес-сценарий','Шаги','Результат и связи','Открытие, мс','До результата, мс','Визуально','Удобство','Стенд','Статус']];
  const cents=n=>Math.round(Number(n)*100);
  const rubles=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n);
  for(const c of cases){
    const before=await snap(),records=await sources(),cash=await expectedTile('Сейф'),expected=await expectedTile('Ожидаем до конца месяца');
    await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name:'Платёжный календарь'}).click();
    const opening=performance.now();await fw.getByRole('button',{name:'Запланировать поступление',exact:true}).click();
    const dlg=page.getByRole('dialog'),field=name=>dlg.locator('[name="'+name+'"]');
    await dlg.waitFor();await twoFrames(page);const open=Math.round(performance.now()-opening);
    await field('label').fill(c.label);
    await field('amount').fill(c.invalid||String(c.amount));
    if(c.due)await field('due_date').fill(c.due);
    if(c.project||c.resetProject)await field('project_id').selectOption(project);
    if(c.resetProject)await field('project_id').selectOption('');
    if(c.details||c.reason||c.expected)await dlg.locator('summary').click();
    if(c.details){
      assert.ok(!await field('payroll_month').isVisible(),'У планируемого поступления предлагается указать месяц начисления зарплаты');
      assert.ok(!await field('employee_id').isVisible(),'Поступление позволяет указать получателя зарплаты');
    }
    if(c.reason)await field('reason').fill(c.reason);
    if(c.expected)await field('certainty').selectOption('expected');
    const submit=dlg.getByRole('button',{name:'Добавить в план'});
    if(c.badDate){
      await field('due_date').fill(shift(before.workspace.start_date,-1));
      await submit.click();assert.equal(await field('due_date').evaluate(el=>el.validity.rangeUnderflow),true);
      assert.equal((await snap()).revision,before.revision);await field('due_date').fill(c.due);
    }
    if(c.invalid){
      await submit.click();assert.equal(await field('amount').evaluate(e=>e.validity.stepMismatch),true);
      assert.equal((await snap()).revision,before.revision);await field('amount').fill(String(c.amount));
    }
    assert.ok(await dlg.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    assert.ok(await submit.evaluate(e=>e.getBoundingClientRect().height>=44));
    if(c.details&&process.env.INCOME_PLAN_SHOT)await dlg.screenshot({path:process.env.INCOME_PLAN_SHOT});
    const started=performance.now();
    await (c.cancel?dlg.getByRole('button',{name:'Закрыть'}):submit).click();
    try{await dlg.waitFor({state:'hidden'});}catch(error){throw new Error(c.task+' — '+await dlg.getByRole('alert').innerText(),{cause:error});}
    await twoFrames(page);
    const elapsed=Math.round(performance.now()-started),after=await snap();
    const priorKeys=new Set(before.workspace.items.map(x=>x.key));
    const added=after.workspace.items.filter(x=>!priorKeys.has(x.key));
    assert.equal(added.length,c.cancel?0:1);assert.equal(after.revision-before.revision,c.cancel?0:1);
    assert.deepEqual(await sources(),records);assert.deepEqual(after.workspace.wallets,before.workspace.wallets);
    assert.deepEqual(after.operations,before.operations);assert.equal(after.workspace.reserve,before.workspace.reserve);
    for(const item of before.workspace.items)assert.deepEqual(after.workspace.items.find(x=>x.key===item.key),item);
    if(!c.cancel){
      const item=added[0];assert.equal(item.direction,'income');assert.equal(item.remaining,c.amount);assert.equal(item.label,c.label);
      assert.equal(item.project_id,c.project?project:null);assert.equal(item.due_date,c.due||null);assert.equal(item.certainty,c.expected?'expected':'confirmed');
      assert.equal(item.terms.basis,c.reason||c.label);assert.equal(item.employee_id,null);
      const card=fw.locator('[data-fw="pay"][data-id="'+item.key+'"]').locator('xpath=ancestor::article[1]');
      const text=await card.innerText();assert.ok(text.includes(c.label)&&text.includes(rubles(c.amount)));
      assert.ok(text.includes(c.due?c.due.split('-').reverse().join('.'):'Без срока'));assert.equal(text.includes('просрочено'),!!c.due&&c.due<day);
      assert.ok(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    }
    await fw.locator('[data-fw-tab=overview]').click();assert.equal(await expectedTile('Сейф'),cash);
    const expectedAfter=await expectedTile('Ожидаем до конца месяца');
    assert.equal(cents(expectedAfter)-cents(expected),!c.cancel&&c.due?.slice(0,7)===day.slice(0,7)?cents(c.amount):0);
    if(c.project){
      await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name:'Прогноз по проектам'}).click();
      const forecast=fw.locator('article').filter({has:page.getByRole('heading',{name:'Тестовый павильон'})});
      assert.ok((await forecast.innerText()).includes(rubles(10000)));await fw.locator('[data-fw-tab=overview]').click();
    }
    let received='';
    if(c.receive){
      await fw.getByRole('button',{name:/Ещё/}).click();
      await fw.getByRole('button',{name:'Платёжный календарь'}).click();
      await fw.locator('[data-fw="pay"][data-id="'+added[0].key+'"]').click();
      await field('amount').fill(String(c.receive));
      await field('reason').fill('Поступила первая часть');
      await dlg.getByRole('button',{name:'Подтвердить'}).click();await dlg.waitFor({state:'hidden'});
      const paid=await snap(),actual=await sources();
      assert.equal(actual.company_income.length,records.company_income.length+1);
      assert.equal(actual.ledger_entries.length,records.ledger_entries.length);
      assert.equal(paid.operations.length,after.operations.length+1);
      assert.equal(cents(paid.workspace.items.find(x=>x.key===added[0].key).remaining),cents(c.amount)-cents(c.receive));
      await fw.locator('[data-fw-tab=overview]').click();
      assert.equal(cents(await expectedTile('Сейф')),cents(cash)+cents(c.receive));
      assert.equal(cents(await expectedTile('Ожидаем до конца месяца')),cents(expectedAfter)-cents(c.receive));
      received=' Затем получено '+c.receive+' ₽. Только после оплаты увеличился сейф, создан один приход компании, остаток плана 79,99 ₽.';
    }
    const steps='Финансы → Ещё → Платёжный календарь → Запланировать поступление → '+c.label+', '+(c.invalid?c.invalid+' → исправить на ':'')+c.amount+' ₽, '+(c.badDate?shift(before.workspace.start_date,-1)+' → исправить на ':'')+(c.due||'без срока')+(c.project?' → Тестовый павильон':c.resetProject?' → Тестовый павильон → Без проекта':'')+(c.expected?' → Требует уточнения':'')+(c.reason?' → '+c.reason:'')+' → '+(c.cancel?'Закрыть':'Добавить в план')+(c.receive?' → Получил оплату → '+c.receive+' ₽ → Подтвердить':'');
    report.push(['UI-0326',build,c.task,steps,(c.cancel?'Черновик закрыт':'Добавлен один план')+'. Ожидаем за месяц '+expected+' → '+expectedAfter+' ₽. Сейф '+cash+' ₽, доходов и денежных проводок добавлено 0.'+(c.project?' Долг клиента 10 000 ₽ в прогнозе.':'')+received,open,elapsed,'Диалог укладывается в ширину 390 px, кнопка от 44 px.',c.invalid||c.badDate?'Можно исправить поле в открытой форме':c.cancel?'Закрытие возвращает в календарь':c.expected?'Видна отметка о согласовании':c.due?'Сумма и срок видны в календаре':'Виден статус «Без срока»',new Date().toISOString()+' Chromium '+browser.version()+' PGlite','Пройдено']);
  }
  if(process.env.INCOME_PLAN_CSV)fs.writeFileSync(process.env.INCOME_PLAN_CSV,'\ufeff'+report.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
  console.log('Income plan:',report.length-1,'browser journeys');
};
