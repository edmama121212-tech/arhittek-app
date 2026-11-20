'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function reverseJourneys({page, fw, db, command, snap, day, wallet, uuid, build, browser, expectedTile, twoFrames}) {
  const rows = [['Элемент','Сборка index/finance/journal','Сценарий','Шаги','Результат и связи','Открытие, мс','Подтверждение/закрытие, мс','Визуальная проверка','Удобство','Стенд','Итог']];
  const journalHash = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../../financial-journal.js'))).digest('hex').slice(0,12);
  const secondary = uuid(8300);
  await command('wallet',{name:'Тестовая вторая касса',kind:'cash',reason:'Проверка места возврата'},secondary);
  await page.exposeFunction('qaReverse',async args => {
    try {
      const result=await db.query('select public.confirm_financial_operation($1,$2,$3,$4) as j',[args.p_command,args.p_payload,args.p_operation,args.p_revision]);
      return {data:result.rows[0].j,error:null};
    } catch(error){return {error:{message:error.message},data:null};}
  });
  await page.evaluate(()=>{
    const previous=sb.rpc.bind(sb);
    sb.rpc=(name,args)=>name==='confirm_financial_operation'?qaReverse(args):previous(name,args);
  });
  const cases = [
    ['Отменить ошибочный приход компании','income',1200],
    ['Вернуть расход компании в сейф','expense',340],
    ['Вернуть расход с точностью до копейки','expense',0.01],
    ['Сохранить соседний чек с тем же назначением','twins',100],
    ['Восстановить полностью оплаченный план поставщика','paid',350],
    ['Вернуть часть аванса в ожидания месяца','partial',150],
    ['Освободить привязку старой оплаты к плану','link',65],
    ['Убрать приход только из дополнительной кассы','secondary',90],
    ['Запретить возврат прихода из уже пустой кассы','empty',80],
    ['Сохранить расход после отказа от отмены','cancel',50],
    ['Дополнить основание перед возвратом денег','reason',60],
    ['Остановить отмену после изменения журнала в другом сеансе','stale',75],
  ];
  const cents = value=>Math.round(Number(value)*100);
  const remaining=(j,key)=>j.workspace.items.find(x=>x.key===key)?.remaining||0;
  const balance=(j,id)=>j.workspace.wallets.find(x=>x.id===id).balance;
  const sheet=page.locator('#financialJournalSheet');
  for(const [i,[task,mode,amount]] of cases.entries()){
    const id=n=>uuid(8320+i*10+n);
    const incoming=['income','partial','secondary','empty'].includes(mode);
    const direction=incoming?'income':'expense';
    const where=['secondary','empty'].includes(mode)?secondary:wallet;
    const planned=['paid','partial','secondary','empty'].includes(mode);
    const total=mode==='partial'?amount*2:amount;
    const label=mode==='twins'?'Бумага для печати':'Учебный платёж '+(i+1);
    const reason='Исправление документа '+(i+1);
    const table=incoming?'company_income':'company_expenses';
    const date=incoming?'income_date':'expense_date';
    const createPlan=()=>command('plan',{label,amount:total,direction,due_date:day,funding:'reserve',certainty:'confirmed',reason:label},id(0));
    const raw=source=>db.query('insert into public.'+table+'(id,category,description,amount,'+date+') values($1,$2,$3,$4,$5)',[source,'Учебная запись',label,amount,day]);
    if(planned){
      await createPlan();
      await command('pay',{key:id(0),date:day,amount,wallet_id:where,reason:label},id(1));
    }else await raw(id(1));
    const operation=(await snap()).operations.find(x=>x.source_id===id(1));
    if(mode==='twins')await raw(id(2));
    if(mode==='link'){
      await createPlan();
      await command('link',{key:id(0),source:operation.id,amount,reason:'Связь с чеком'},id(2));
    }
    if(mode==='empty')await command('wallet_transfer',{from:secondary,to:wallet,amount,reason:'Переместили наличные'},id(2));
    await page.setViewportSize({width:i%2?1100:390,height:844});
    await page.evaluate(()=>loadAll());
    await fw.getByRole('button',{name:/Ещё/}).click();
    await fw.getByRole('button',{name:'История операций',exact:true}).click();
    const button = fw.locator('[data-journal="reverse"][data-id="'+operation.id+'"]');
    let start=performance.now();
    await button.click();
    await sheet.waitFor();
    await twoFrames(page);
    const opening=Math.round(performance.now()-start);
    assert.equal(await sheet.locator('h3').textContent(),'Отмена записи №'+operation.revision);
    assert.equal(await sheet.locator('.fv').textContent(),new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(amount));
    assert.ok(await sheet.locator('#journalReason').isVisible());
    if(i===0&&process.env.JOURNAL_REVERSE_SHOT)await page.screenshot({path:process.env.JOURNAL_REVERSE_SHOT});
    assert.ok(await sheet.locator('.sheet').evaluate(n=>n.clientWidth+1>=n.scrollWidth));
    let steps='Финансы → Ещё → История операций → запись №'+operation.revision+' ('+amount+' ₽) → Отменить с причиной';
    if(mode==='reason'){
      await sheet.locator('#journalConfirm').click();
      assert.match(await sheet.locator('[role=alert]').innerText(),/Укажите причину/);
      steps+=' → попытка без причины → дополнить основание';
    }
    if(mode==='stale'){
      await raw(id(2));
      steps+=' → другой сеанс вносит отдельный расход';
    }
    const before=await snap();
    const blocked=['cancel','empty','stale'].includes(mode);
    await sheet.locator('#journalReason').fill(reason);
    start=performance.now();
    if(mode==='cancel')await sheet.locator('#journalCancel').click();
    else await sheet.locator('#journalConfirm').click();
    let alert='';
    if(mode==='empty'||mode==='stale'){
      const message=sheet.locator('#journalFormError');
      await page.waitForFunction(()=>document.getElementById('journalFormError')?.textContent.trim());
      alert=await message.innerText();
      assert.match(alert,mode==='empty'?/Недостаточно денег в месте хранения/:/данные изменились/i);
      assert.equal(await sheet.locator('#journalReason').inputValue(),reason);
    }else await sheet.waitFor({state:'hidden'});
    await twoFrames(page);
    const duration=Math.round(performance.now()-start);
    if(alert)await sheet.locator('#journalCancel').click();
    const after=await snap();
    assert.equal(after.revision-before.revision,blocked?0:1);
    const difference=cents(blocked?0:incoming?-amount:amount);
    assert.equal(cents(after.workspace.cash)-cents(before.workspace.cash),difference);
    assert.equal(cents(balance(after,where))-cents(balance(before,where)),difference);
    const otherWallet=where===wallet?secondary:wallet;
    assert.equal(balance(before,otherWallet),balance(after,otherWallet));
    const original=await db.query('select deleted_at from public.'+table+' where id=$1',[id(1)]);
    assert.equal(Boolean(original.rows[0].deleted_at),!blocked);
    const reversing=after.operations.filter(x=>x.reverses===operation.id);
    assert.equal(reversing.length,blocked?0:1);
    if(!blocked){
      assert.equal(reversing[0].reason,reason);
      assert.equal(cents(reversing[0].cash_delta),difference);
      await button.waitFor({state:'detached'});
      const reversalCard=fw.locator('[data-fw-operation]').filter({has:page.getByRole('heading',{name:reason,exact:true})});
      assert.match(await reversalCard.innerText(),new RegExp('Отмена записи №'+operation.revision+'(?:\\D|$)'));
    }
    if(mode==='twins')assert.equal((await db.query('select deleted_at from public.company_expenses where id=$1',[id(2)])).rows[0].deleted_at,null);
    if(planned||mode==='link')assert.equal(cents(remaining(after,id(0)))-cents(remaining(before,id(0))),blocked?0:cents(amount));
    if(mode==='link')assert.ok(!after.workspace.links.some(x=>x.source_operation===operation.id));
    // Refresh only the stale session, as instructed by the refusal.
    if(mode==='stale')await page.evaluate(()=>loadAll());
    await fw.locator('[data-fw-tab="overview"]').click();
    assert.equal(await expectedTile('Сейф'),balance(after,wallet));
    const outcome='Деньги в кассах '+before.workspace.cash+' → '+after.workspace.cash+' ₽. '+(blocked?'Исходная запись действует. '+alert:'Исходная запись помечена отменённой. В истории одна обратная запись №'+reversing[0].revision+'.')+
      (planned||mode==='link'?' По плану осталось '+remaining(after,id(0))+' ₽.':'')+(mode==='twins'?' Второй чек сохранился.':'');
    rows.push(['UI-0334',build+'/'+journalHash,task,steps+' → '+(mode==='cancel'?'Закрыть':'Подтвердить')+' → Главная финансов',outcome,opening,duration,'Поле причины и кнопка видны. Форма помещается по ширине '+page.viewportSize().width+' px.',alert?'Основание осталось в форме после отказа.':blocked?'Закрытие сохраняет платёж.':'В истории указан номер исходной записи.',browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);
  }
  if(process.env.JOURNAL_REVERSE_CSV)fs.writeFileSync(process.env.JOURNAL_REVERSE_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
  console.log(cases.length+' isolated reversal journeys passed');
};
