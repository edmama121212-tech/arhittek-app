'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

module.exports=async function({page,fw,command,snap,wallet,uuid,build,browser,expectedTile,twoFrames}){
 const cases=[
  ['Сохранить единственный основной сейф','Сейф','cash','duplicate'],
  ['Добавить подотчётную кассу','Касса прораба','cash','save'],
  ['Создать банковское место для будущих поступлений','Банк студии','bank','save'],
  ['Исключить повтор кассы с другим регистром и пробелами','  касса   ПРОРАБА  ','cash','duplicate'],
  ['Не спутать счёт банка с одноимённой кассой','Банк студии','cash','duplicate'],
  ['Отказаться от создания кассы объекта','Касса объекта','cash','cancel'],
  ['Остановить создание без назначения операции','Банк филиала','bank','reason'],
  ['Потребовать название новой кассы','   ','cash','blank'],
  ['Исправить название-дубликат и повторить','Банк студии','bank','rename'],
  ['Подтвердить одно место при двойном нажатии','Касса закупок','cash','double'],
  ['Убрать лишние пробелы при создании','  Касса   мастерской  ','cash','trim'],
  ['Создать банк при открытом плановом обязательстве','Банк стройки','bank','plan']
 ];
 const rows=[['ID','Сборка index/finance','Задача','Шаги','Результат и связи','До результата, мс','Вид и удобство','Стенд и время','Итог']];
 const go=async tab=>{await fw.locator('[data-fw-tab=more]').click();await fw.locator('[data-fw-tab='+tab+']').click();};
 for(const [label,name,kind,mode] of cases){
  if(mode==='plan'){
   await command('plan',{label:'Аренда оборудования',amount:725,direction:'expense',certainty:'confirmed',funding:'reserve',reason:'Учебный план'},uuid(4600));await page.evaluate(()=>loadAll());
  }
  const before=await snap(),cash=await expectedTile('Сейф');
  await go('accounts');
  const section=fw.locator('[data-fw-section=storage-settings]');
  if(!await section.evaluate(e=>e.open))await section.locator('summary').click();
  await section.locator('[data-fw=wallet]').click();
  const dialog=page.getByRole('dialog'),input=dialog.getByLabel('Название'),submit=dialog.getByRole('button',{name:'Подтвердить'});
  await input.fill(name);await dialog.getByLabel('Тип').selectOption(kind);
  if(mode!=='reason')await dialog.getByLabel('Основание операции').fill(label);
  assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  if(process.env.STORAGE_CREATE_SHOT&&mode==='trim')await dialog.screenshot({path:process.env.STORAGE_CREATE_SHOT});
  let expected=name.trim().replace(/\s+/g,' '),steps='Финансы → Ещё → места хранения → добавить → '+JSON.stringify(name)+' → '+(kind==='bank'?'Банковский счёт':'Наличные');
  const t=performance.now();
  if(mode==='cancel'){await dialog.getByRole('button',{name:'Закрыть'}).click();steps+=' → Закрыть';}
  else{
   if(mode==='double')await submit.dblclick();else await submit.click();
   steps+=' → Подтвердить';
  }
  const feedback=dialog.getByRole('alert');
  if(['duplicate','rename'].includes(mode)){
   await feedback.filter({hasText:/уже используется/}).waitFor();assert.equal((await snap()).revision,before.revision);
   if(mode==='rename'){expected='Банк филиала';await input.fill(expected);await submit.click();steps+=' → исправить на '+expected+' → Подтвердить';}
  }
  if(mode==='blank')await feedback.filter({hasText:/название/i}).waitFor();
  if(mode==='reason')await feedback.filter({hasText:/основание/i}).waitFor();
  const created=['save','double','trim','rename','plan'].includes(mode);
  if(created||mode==='cancel')await dialog.waitFor({state:'hidden'});
  await twoFrames(page);
  const ms=Math.round(performance.now()-t);
  if(await dialog.isVisible())await dialog.getByRole('button',{name:'Закрыть'}).click();
  const after=await snap(),oldIds=new Set(before.workspace.wallets.map(w=>w.id)),added=after.workspace.wallets.filter(w=>!oldIds.has(w.id));
  assert.equal(added.length,Number(created));
  if(created){
   assert.equal(added[0].name,expected);assert.equal(added[0].kind,kind);assert.equal(added[0].balance,0);
   assert.ok(await fw.getByRole('heading',{name:expected,exact:true}).isVisible());
   if(!await section.evaluate(e=>e.open))await section.locator('summary').click();
   await section.locator('[data-fw=wallet-transfer]').click();assert.equal(await dialog.locator('[name=to] option[value="'+added[0].id+'"]').count(),1);
   await dialog.getByRole('button',{name:'Закрыть'}).click();
  }else assert.equal(after.revision,before.revision);
  assert.deepEqual(after.workspace.items,before.workspace.items);assert.deepEqual(after.operations,before.operations);
  assert.deepEqual(after.workspace.wallets.filter(w=>oldIds.has(w.id)),before.workspace.wallets);assert.equal(after.workspace.cash,before.workspace.cash);
  await fw.locator('[data-fw-tab=overview]').click();assert.equal(await expectedTile('Сейф'),cash);
  rows.push(['UI-0328',build,label,steps,created?'Одно новое место с нулевым остатком доступно для перевода. Сейф '+cash+' ₽, календарь и проводки сохранены.':'Новых мест и проводок 0. Сейф '+cash+' ₽ и календарь сохранены.',ms,'Форма помещается при ширине 390 px. '+(created?'Название видно в списке.':mode==='cancel'?'Закрытие без записи.':'Форма остаётся доступной для исправления.'),'Chromium '+browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);
 }
 // An outdated client can still submit the rejected name. Verify the server-side guard.
 const stable=await snap();
 await assert.rejects(command('wallet',{kind:'bank',name:'  БАНК   студии ',reason:'Повтор из старой формы'},uuid(4701)),/уже используется/);
 assert.equal((await snap()).revision,stable.revision);
 if(process.env.STORAGE_CREATE_CSV)fs.writeFileSync(process.env.STORAGE_CREATE_CSV,'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 console.log('12 storage creation scenarios passed');
};
