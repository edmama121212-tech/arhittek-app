'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function ({page,fw,db,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames}) {
  const output=process.env.CANCEL_PLAN_OUTPUT;
  if(output) fs.mkdirSync(output,{recursive:true});
  const next=shift(day.slice(0,7)+'-01',0,1);
  const cases=[
    {label:'Печатные образцы',task:'Отменить весь заказ до первой оплаты',amount:260},
    {label:'Доплата за съёмку',task:'Снять ожидаемое поступление текущего месяца',income:true,amount:530},
    {label:'Подписка на следующий этап',task:'Отозвать выручку следующего месяца',income:true,due:next,amount:820},
    {label:'Закупка бумаги',task:'Прекратить покупку после аванса поставщику',amount:930.85,paid:300.25},
    {label:'Оплата эскизов',task:'Отказаться от доплаты после получения аванса',income:true,amount:475.90,paid:475.89},
    {label:'Бронирование печати',task:'Сохранить привязанный чек и снять остаток заказа',amount:700,linked:185},
    {label:'Авторский надзор',task:'Из двух одноимённых работ отменить только выбранный срок',amount:420,twin:true},
    {label:'Доставка палитр',task:'Убрать бессрочный заказ из списка обязательств',due:null,amount:670},
    {label:'Долг за визуализацию',task:'Высвободить деньги ранее зарезервированные под долг',hold:true,amount:805},
    {label:'Долг за фотофиксацию',task:'Высвободить только остаток зарезервированных денег после выплаты',hold:true,paid:320,amount:810},
    {label:'Аренда зала',task:'Сохранить заказ при выходе без подтверждения',close:true,amount:855},
    {label:'Дополнительные расчёты',task:'Исправить пропущенную причину списания плана',repair:true,amount:618}
  ];
  const rows=[['Элемент','Сборка SHA256 index/finance','Дата UTC','Бизнес-сценарий','Шаги','Результат и связи','Открытие, мс','Ответ до видимого результата, мс','Вид и удобство','Стенд','Статус']];
  const home=()=>fw.locator('[data-fw-tab="overview"]').click();
  const open=async name=>{await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name,exact:true}).click();};
  const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n).replace(/\s/g,'');
  for(const [i,c] of cases.entries()){
    const id=k=>uuid(8000+i*10+k);
    const due=c.due===undefined?day:c.due;
    const spec={label:c.label,amount:c.amount,direction:c.income?'income':'expense',due_date:due,certainty:'confirmed',funding:'reserve',obligation:!!c.hold,reason:'Учебная заявка'};
    await command('plan',spec,id(0));
    if(c.twin) await command('plan',{...spec,due_date:next},id(1));
    if(c.paid) await command('pay',{key:id(0),amount:c.paid,wallet_id:wallet,date:day,reason:'Частичная оплата'},id(2));
    if(c.linked){
      await db.query("insert into public.company_expenses(id,category,amount,expense_date,description) values($1,'Печать',$2,$3,'Чек типографии')",[id(2),c.linked,day]);
      const source=(await snap()).operations.find(o=>o.source_id===id(2));
      await command('link',{source:source.id,key:id(0),amount:c.linked,reason:'Привязка чека'},id(3));
    }
    await page.evaluate(()=>loadAll());
    const before=await snap(),cash=await expectedTile('Сейф'),expected=await expectedTile('Ожидаем до конца месяца');
    const remainder=before.workspace.items.find(x=>x.key===id(0)).remaining;
    assert.equal(remainder,Math.round((c.amount-(c.paid||c.linked||0))*100)/100);
    await open('Платёжный календарь');
    const button=fw.locator('[data-fw="cancel"][data-id="'+id(0)+'"]');
    const card=button.locator('xpath=ancestor::article[1]');
    const when=due?due.split('-').reverse().join('.'):'Без срока';
    assert.match(await card.innerText(),new RegExp(when));
    const t=performance.now();
    if(i%2) await button.tap(); else await button.click();
    const dialog=page.getByRole('dialog');
    await dialog.waitFor(); await twoFrames(page);
    const opening=Math.round(performance.now()-t);
    const text=await dialog.innerText();
    assert.ok(text.includes(c.label)&&text.includes(when)&&text.replace(/\s/g,'').includes(money(remainder)),text);
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    const submit=dialog.locator('[type="submit"]');
    assert.ok(await submit.evaluate(el=>el.getBoundingClientRect().height>=44));
    if(c.repair){
      await submit.click();
      assert.match(await dialog.locator('[role="alert"]').innerText(),/основание/i);
      assert.equal((await snap()).revision,before.revision);
    }
    await dialog.locator('[name="reason"]').fill('Отказ по учебной заявке');
    if(output&&c.paid&&c.hold) await dialog.screenshot({path:path.join(output,'cancel-plan.png')});
    const t2=performance.now();
    if(c.close) await dialog.getByRole('button',{name:'Закрыть'}).click(); else await submit.click();
    await dialog.waitFor({state:'hidden'}); await twoFrames(page);
    const finish=Math.round(performance.now()-t2);
    assert.equal(await button.count(),c.close?1:0);
    const after=await snap();
    if(c.close) assert.equal(after.revision,before.revision);
    else{
      const change=after.workspace.changes.find(h=>h.entity==='cancel'&&h.after_value.id===id(0));
      assert.equal(change.after_value.terms.canceled_amount,remainder);
      assert.equal(change.before_value.remaining,remainder);
    }
    const remainingBefore=before.workspace.items.filter(x=>x.key!==id(0)).map(x=>[x.key,x.remaining]).sort();
    assert.deepEqual(after.workspace.items.filter(x=>x.key!==id(0)).map(x=>[x.key,x.remaining]).sort(),remainingBefore);
    if(c.twin) assert.equal(await fw.locator('[data-fw="cancel"][data-id="'+id(1)+'"]').count(),1);
    assert.deepEqual(after.workspace.links,before.workspace.links);
    assert.equal(after.workspace.cash,cash);
    assert.equal(after.workspace.reserve,Math.round((before.workspace.reserve+(c.hold?remainder:0))*100)/100);
    const added=after.operations.filter(o=>!before.operations.some(b=>o.id===b.id));
    assert.deepEqual(added.map(o=>[o.kind,o.cash_delta]),c.hold?[['obligation_release',0]]:[]);
    if(c.paid||c.linked) assert.equal(after.operations.find(o=>o.source_id===id(2)).cash_delta,(c.income?1:-1)*(c.paid||c.linked));
    await home();
    assert.equal(await expectedTile('Сейф'),cash);
    const expectedAfter=Math.round((expected-(c.income&&!c.close&&due?.slice(0,7)===day.slice(0,7)?remainder:0))*100)/100;
    assert.equal(await expectedTile('Ожидаем до конца месяца'),expectedAfter);
    const result=(c.close?'План остаётся в календаре':'Остаток '+remainder+' ₽ снят из календаря')+
      '; сейф '+cash+' ₽; ожидаемые поступления месяца '+expected+' → '+expectedAfter+' ₽.'+
      (c.hold?' Освобождено '+remainder+' ₽. Свободные деньги '+before.workspace.reserve+' → '+after.workspace.reserve+' ₽.':' Денежных проводок при отмене 0.')+
      (c.paid?' Фактическая оплата '+c.paid+' ₽ сохранена.':'')+(c.linked?' Чек и его связь сохранены.':'')+(c.twin?' Второй срок и его остаток сохранены.':'');
    const steps='Создать '+(c.hold?'начисленный долг':c.income?'план прихода':'план расхода')+' «'+c.label+'», '+c.amount+' ₽, '+when+'. '+
      (c.paid?'Внести '+c.paid+' ₽. ':'')+(c.linked?'Привязать чек '+c.linked+' ₽. ':'')+(c.twin?'Добавить одноимённую работу на '+next+'. ':'')+
      'Финансы → Ещё → Платёжный календарь → Отменить остаток плана. '+(c.repair?'Подтвердить с пустой причиной и исправить поле. ':'')+
      'Ввести причину → '+(c.close?'Закрыть':'Подтвердить')+' → проверить календарь и Главную.';
    rows.push(['UI-0321',build,new Date().toISOString().slice(0,10),c.task,steps,result,opening,finish,
      'Диалог помещается по ширине; название, остаток и срок видны до подтверждения, кнопка ≥44 px. '+(c.repair?'Причину можно исправить в открытой форме.':c.close?'Можно выйти до записи.':'После подтверждения календарь обновился.'),
      'Chromium '+browser.version()+' 390×844, PGlite, синтетические записи','Пройдено']);
    console.log('PASS',c.task,opening,finish);
  }
  if(output) fs.writeFileSync(path.join(output,'QA_CANCEL_PLAN_RUNS.csv'),'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
