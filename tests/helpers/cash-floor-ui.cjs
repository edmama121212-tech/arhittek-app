'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cents = value => Math.round(Number(value)*100);
const compact = text => text.replace(/\s+/gu,' ').trim();
const migration = '20261120020000_finance_spending_limits.sql';

module.exports = async function cashFloor({page,fw,db,command,snap,day,wallet,uuid,build,browser,expectedTile,twoFrames,errors}){
  const secondary=uuid(803), held=uuid(804), ordinary=uuid(805), incoming=uuid(806);
  const planned = (label, direction, amount) => ({label,direction,amount,due_date:day,certainty:'confirmed',funding:'reserve',reason:'Подготовка учебного календаря'});
  await command('wallet',{name:'Отдельная касса',kind:'cash',reason:'Вторая учебная касса'},secondary);
  await command('plan',{...planned('Гонорар подрядчика','expense',47300),obligation:true},held);
  await command('plan',planned('Счёт за связь','expense',201),ordinary);
  await command('plan',planned('Оплата заказа','income',200),incoming);
  await page.evaluate(()=>loadAll());
  assert.equal((await snap()).workspace.reserve,200);
  const ids={held,ordinary,incoming};
  const walletNames={safe:wallet,second:secondary};
  const scenarios=[
    {task:'Оплата счёта на 1 ₽ сверх свободных денег',plan:'ordinary',amount:201,error:/Недостаточно свободных денег/,numbers:[200,201],keep:true},
    {task:'После отказа внести частичную сумму',plan:'ordinary',amount:50.01,retry:true},
    {task:'Остановить переплату в одну копейку',plan:'ordinary',amount:150,error:/Недостаточно свободных денег/,numbers:[149.99,150],keep:true},
    {task:'Подтвердить ровно оставшиеся свободные деньги',plan:'ordinary',amount:149.99,retry:true},
    {task:'Остановить обычный расход при 49 800 ₽ в сейфе и нуле свободных денег',plan:'ordinary',amount:1,error:/Недостаточно свободных денег/,numbers:[0,1]},
    {task:'Погасить часть ранее обеспеченного обязательства при нулевом резерве',plan:'held',amount:120},
    {task:'Не выплачивать обеспеченный гонорар из пустой кассы',plan:'held',amount:20,where:'second',error:/Недостаточно денег в месте хранения/,numbers:[0,20],keep:true},
    {task:'Повторить выплату из сейфа вместо пустой кассы',plan:'held',amount:20,retry:true},
    {task:'Отменить подготовленную подтверждённую выплату',plan:'held',amount:100,cancel:true},
    {task:'Принять деньги во вторую кассу при исчерпанном свободном остатке',plan:'incoming',amount:200,where:'second'},
    {task:'Закрыть отложенный счёт после поступления в другую кассу',plan:'ordinary',amount:1,where:'second'},
  ];
  const output=process.env.CASH_FLOOR_OUTPUT;
  if(output)fs.mkdirSync(output,{recursive:true});
  const migrationHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../../supabase/migrations',migration))).digest('hex').slice(0,12);
  const csv=[['Элемент','Сценарий','Сборка SHA256 index/finance-workspace/миграция','Бизнес-цель','Шаги','Итог и связанные данные','Отклик подтверждения/отмены до видимого результата, мс','Визуальная проверка','Удобство','Стенд','Результат']];
  const countSource = async () => (await db.query('select (select count(*)::int from public.company_expenses) as expenses,(select count(*)::int from public.company_income) as income')).rows[0];
  const goCalendar=async()=>{await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name:'Платёжный календарь'}).click();};
  const sheet=page.getByRole('dialog');
  const open=async id=>{await fw.locator('[data-fw="pay"][data-id="'+id+'"]').click();await sheet.waitFor();};
  const isVisible=async el=>el.evaluate(node=>{
    const rect=node.getBoundingClientRect();
    return rect.width>0 && rect.left>=-1 && rect.right<=innerWidth+1 && node.scrollWidth<=node.clientWidth+1;
  });
  const availableAmount=(journal,id)=>cents(journal.workspace.items.find(value=>value.key===id)?.remaining||0);
  const walletAmount=(journal,id)=>cents(journal.workspace.wallets.find(w=>w.id===id).balance);
  await goCalendar();
  for(const [i,c] of scenarios.entries()){
    const id=ids[c.plan], selected=walletNames[c.where||'safe'];
    if(!c.retry){
      await page.setViewportSize({width:i%2?1280:390,height:844});
      await open(id);
    }
    const before=await snap(), src=await countSource();
    const item=before.workspace.items.find(x=>x.key===id);
    const number=sheet.locator('[name=amount]'), field=sheet.locator('[name=wallet_id]');
    assert.ok(await isVisible(sheet));
    await number.fill(String(c.amount));
    await field.selectOption(selected);
    const reason='Проверка платежа '+String(i+1);
    await sheet.getByLabel('Основание операции').fill(reason);
    const t=performance.now();
    let feedback='';
    if(c.cancel)await sheet.getByRole('button',{name:'Закрыть'}).click();
    else await sheet.getByRole('button',{name:'Подтвердить',exact:true}).click();
    if(c.error){
      const alert=sheet.getByRole('alert');
      await page.waitForFunction(()=>!!document.querySelector('#financeWorkspaceModal [role="alert"]')?.textContent.trim());
      feedback=compact(await alert.innerText());
      assert.match(feedback,c.error);
      if(c.numbers) {
        const displayed=feedback.match(/\d+(?:[,.]\d+)?/g).map(x=>cents(x.replace(',','.')));
        assert.deepEqual(displayed,c.numbers.map(cents),feedback);
      }
      await twoFrames(page);
      assert.ok(await isVisible(alert));
      assert.equal(await number.inputValue(),String(c.amount));
      assert.equal(await field.inputValue(),selected);
    }else{
      await sheet.waitFor({state:'hidden'});await twoFrames(page);
    }
    const elapsed=Math.round(performance.now()-t),after=await snap(),srcAfter=await countSource();
    let note;
    const changed=!c.error&&!c.cancel;
    if(changed){
      const sign=c.plan==='incoming'?1:-1;
      assert.equal(after.revision,before.revision+1);
      assert.equal(after.operations.length,before.operations.length+1);
      assert.equal(cents(after.workspace.cash)-cents(before.workspace.cash),sign*cents(c.amount));
      assert.equal(walletAmount(after,selected)-walletAmount(before,selected),sign*cents(c.amount));
      assert.equal(walletAmount(after,selected===wallet?secondary:wallet),walletAmount(before,selected===wallet?secondary:wallet));
      assert.equal(availableAmount(after,id),availableAmount(before,id)-cents(c.amount));
      assert.equal(srcAfter.expenses-src.expenses,sign===-1?1:0);
      assert.equal(srcAfter.income-src.income,sign===1?1:0);
      const newReserve=cents(before.workspace.reserve)+(c.plan==='held'?0:sign===1?cents(c.amount)*0.95:-cents(c.amount));
      assert.equal(cents(after.workspace.reserve),newReserve);
      const row=fw.locator('[data-fw="pay"][data-id="'+id+'"]');
      assert.equal(await row.count(),availableAmount(after,id)>0?1:0);
      if(await row.count())assert.ok(await isVisible(row.locator('xpath=ancestor::article')));
      assert.ok(after.operations.some(op=>op.reason.includes(reason)));
      note='Одна проводка. Остаток по плану '+availableAmount(after,id)/100+' ₽.';
    }else{
      assert.equal(before.revision,after.revision);assert.deepEqual(before.operations,after.operations);
      assert.deepEqual(before.workspace.items,after.workspace.items);assert.deepEqual(before.workspace.wallets,after.workspace.wallets);
      assert.deepEqual(srcAfter,src);
      note=c.cancel?'Отмена без проводки':feedback+' Сумма и выбранная касса сохранены в форме; записей 0.';
    }
    for(const other of Object.values(ids).filter(v=>v!==id))assert.equal(availableAmount(before,other),availableAmount(after,other));
    const uiSize=page.viewportSize();
    if(output && [0,4,6].includes(i))await sheet.screenshot({path:path.join(output,'floor-'+(i+1)+'.png')});
    if(c.error&&!c.keep)await sheet.getByRole('button',{name:'Закрыть'}).click();
    if(!c.keep){
      await fw.getByRole('button',{name:'Финансы',exact:true}).click();
      assert.equal(cents(await expectedTile('Сейф')),walletAmount(after,wallet));await goCalendar();
    }
    const when='До действия: в сейфе '+walletAmount(before,wallet)/100+' ₽; свободно '+before.workspace.reserve+' ₽; остаток плана '+availableAmount(before,id)/100+' ₽.';
    const steps=when+' '+(c.retry?'В оставшейся открытой форме':('Финансы → Ещё → Платёжный календарь → '+item.label+' → оплата'))+' → '+c.amount+' ₽ → '+(c.where==='second'?'Отдельная касса':'Сейф')+' → '+(c.cancel?'Закрыть':'Подтвердить');
    const totals=' Сейф '+walletAmount(after,wallet)/100+' ₽, отдельная касса '+walletAmount(after,secondary)/100+' ₽, свободно '+after.workspace.reserve+' ₽.';
    csv.push(['FW-CALENDAR-PAY','FLOOR-'+String(i+1).padStart(2,'0'),build+'/'+migrationHash,c.task,steps,note+totals,elapsed,'Ширина '+uiSize.width+' CSS px; диалог в границах'+(c.error?', сообщение видно без горизонтальной прокрутки':', после закрытия виден календарь'),c.error?'Сумму и кошелёк можно исправить без повторного открытия диалога':c.cancel?'Закрытие одной кнопкой, календарь доступен':'Календарь сразу обновил остаток плана; на Главной сверена сумма сейфа',new Date().toISOString().slice(0,10)+' UTC, Chromium '+browser.version()+', PGlite, владелец, синтетические записи','Пройдено']);
    console.log(csv.at(-1)[1],c.task,elapsed);
  }
  assert.deepEqual(errors,[]);
  if(output)fs.writeFileSync(path.join(output,'QA_CASH_FLOOR_RUNS.csv'),'\uFEFF'+csv.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
