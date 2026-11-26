'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
module.exports = async ({page,fw,snap,day,shift,build,browser,expectedTile,twoFrames}) => {
  const fee = n => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n);
  const tomorrow = shift(day,1), last = shift(day,-1), next = shift(day.slice(0,7)+'-01',0,1);
  const cases = [
    {task:'Начислить долг, предварительно оценённый как неподтверждённый',label:'Акт доставки',amount:320.25,debt:true,estim:true},
    {task:'Поставить разовую закупку на сегодня',label:'Бумага для печати',amount:80,due:day},
    {task:'Внести просроченный счёт',label:'Счёт типографии',amount:250,due:last},
    {task:'Запланировать работу без согласованного срока',label:'Выезд инженера',amount:330},
    {task:'Отложить неподтверждённую закупку на следующий месяц',label:'Материалы макета',amount:950,due:next,estim:true},
    {task:'Зарегистрировать отдельный счёт того же подрядчика',label:'Счёт типографии',amount:425.75,due:tomorrow},
    {task:'Сохранить отдельное основание решения в истории',label:'Проверка сметы',amount:670,reason:'Согласовано по акту 28'},
    {task:'Вернуть неподтверждённый план после отказа от резервирования',label:'Декор образца',amount:400,estim:true,toggle:true},
    {task:'Исправить нулевой счёт до записи',label:'Архивные копии',amount:0.01,bad:'0'},
    {task:'Исправить точность счёта до копейки',label:'Брошюровка',amount:9.99,bad:'9.999'},
    {task:'Отменить подготовленное резервирование до подтверждения',label:'Аванс монтажнику',amount:700,debt:true,close:true},
    {task:'Сохранить смету выше доступных денег для будущего финансирования',label:'Будущий подряд',amount:120000,due:next},
  ];
  const rows=[['ID','Сборка index/finance SHA256','Бизнес-сценарий','Действия','Фактический результат и связи','Открытие, мс','Результат, мс','Визуальная проверка','Удобство','Стенд','Итог']];
  for(const c of cases){
    const before=await snap(),cash=await expectedTile('Сейф'),spent=await expectedTile('Расходы за месяц');
    await fw.getByRole('button',{name:/Ещё/}).click();
    await fw.getByRole('button',{name:'Платёжный календарь',exact:true}).click();
    const t=performance.now();
    await fw.getByRole('button',{name:'Запланировать расход'}).click();
    const dialog=page.getByRole('dialog'), field=name=>dialog.locator('[name="'+name+'"]');
    await dialog.waitFor();await twoFrames(page);
    const open=Math.round(performance.now()-t);
    await field('label').fill(c.label);
    await field('amount').fill(c.bad||String(c.amount));
    if(c.due)await field('due_date').fill(c.due);
    if(c.estim||c.reason)await dialog.locator('summary').click();
    if(c.estim)await field('certainty').selectOption('expected');
    if(c.reason)await field('reason').fill(c.reason);
    if(c.debt||c.toggle)await field('obligation').selectOption('true');
    if(c.toggle)await field('obligation').selectOption('false');
    const submit=dialog.getByRole('button',{name:'Добавить в план'});
    if(c.bad){
      await submit.click();
      assert.equal(await field('amount').evaluate(el=>el.validity.valid),false);
      assert.equal((await snap()).revision,before.revision);
      await field('amount').fill(String(c.amount));
    }
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.ok(await submit.evaluate(el=>el.getBoundingClientRect().height>=44));
    if(c.debt){
      assert.equal(await field('certainty').inputValue(),'confirmed');
      assert.ok(await dialog.getByText('Начисление подтверждает сумму долга и резервирует деньги до оплаты.').isVisible());
      if(process.env.EXPENSE_PLAN_SHOT && !c.close)await dialog.screenshot({path:process.env.EXPENSE_PLAN_SHOT});
    }
    const started=performance.now();
    if(c.close)await dialog.getByRole('button',{name:'Закрыть'}).click();
    else await submit.click();
    await dialog.waitFor({state:'hidden'});await twoFrames(page);
    const elapsed=Math.round(performance.now()-started),after=await snap();
    const oldKeys=new Set(before.workspace.items.map(x=>x.key));
    const added=after.workspace.items.filter(x=>!oldKeys.has(x.key));
    assert.equal(added.length,c.close?0:1);
    assert.deepEqual(before.workspace.items.map(x=>[x.key,x.remaining]).sort(),after.workspace.items.filter(x=>oldKeys.has(x.key)).map(x=>[x.key,x.remaining]).sort());
    if(!c.close){
      const item=added[0];
      assert.equal(item.label,c.label);assert.equal(item.remaining,c.amount);assert.equal(item.due_date,c.due||null);
      assert.equal(item.certainty,c.estim&&!c.debt?'expected':'confirmed');
      assert.equal(item.terms.basis,c.reason||c.label);
      const card=fw.locator('[data-fw="pay"][data-id="'+item.key+'"]').locator('xpath=ancestor::article[1]');
      const view=await card.innerText();
      assert.ok(view.includes(c.label)&&view.replace(/\s/g,'').includes(fee(c.amount).replace(/\s/g,'')));
      assert.ok(view.includes(c.due?c.due.split('-').reverse().join('.'):'Без срока'));
      assert.equal(view.includes('просрочено'),c.due===last);
      assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    }else assert.equal(before.revision,after.revision);
    assert.deepEqual(after.workspace.wallets,before.workspace.wallets);
    const reserveChange=c.debt&&!c.close?c.amount:0;
    assert.equal(Math.round((before.workspace.reserve-after.workspace.reserve)*100),Math.round(reserveChange*100));
    assert.equal(after.operations.length-before.operations.length,reserveChange?1:0);
    await fw.locator('[data-fw-tab="overview"]').click();
    assert.equal(await expectedTile('Сейф'),cash);assert.equal(await expectedTile('Расходы за месяц'),spent);
    const how='Ещё → Платёжный календарь → Запланировать расход → '+c.label+' → '+(c.bad?c.bad+' → отказ → ':'')+c.amount+' ₽, '+(c.due||'без срока')+(c.estim?' → Требует уточнения':'')+(c.debt||c.toggle?' → Начисленный долг':'')+(c.toggle?' → Запланированный расход':'')+(c.reason?' → '+c.reason:'')+' → '+(c.close?'Закрыть':'Добавить в план');
    rows.push(['UI-0323',build,c.task,how,(c.close?'Черновик закрыт.':'Добавлена одна строка, остаток '+c.amount+' ₽.')+' Зарезервировано '+reserveChange+' ₽. Сейф '+cash+' ₽, расходы месяца '+spent+' ₽, соседние платежи сохранены.',open,elapsed,'Диалог по ширине окна, кнопка от 44 px; '+(c.close?'возврат в календарь':'сумма и срок читаются в строке календаря'),c.bad?'Ошибка исправляется в открытой форме':c.toggle?'Восстановлен ранее выбранный статус согласования':c.debt?'Вид платежа выбирается до записи':c.due?'Срок виден рядом с остатком':'Доступна запись без даты',day+' МСК · Chromium '+browser.version()+' 390×844, PGlite, синтетические записи','Пройдено']);
  }
  if(process.env.EXPENSE_PLAN_CSV)fs.writeFileSync(process.env.EXPENSE_PLAN_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
  console.log('Expense plan:',rows.length-1,'business journeys');
};
