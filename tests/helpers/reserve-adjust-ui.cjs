'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');

module.exports=async function({page,fw,command,snap,wallet,uuid,build,browser,expectedTile,twoFrames}){
  const other=uuid(8401);
  await command('wallet',{name:'Касса офиса',kind:'cash',reason:'Тестовое место хранения'},other);
  await page.evaluate(()=>loadAll());
  const cases=[
    ['Излишек в сейфе',50,'save'],['Недостача в сейфе',-25,'save'],
    ['Исправить расхождение на одну копейку',0.01,'save'],['Учесть найденные деньги в кассе офиса',200,'other'],
    ['Отклонить списание сверх остатка выбранной кассы',-201,'over'],
    ['Обнулить остаток второй кассы',-200,'other'],['Сохранить учёт при отказе от ввода',100,'cancel'],
    ['Не проводить совпадающую сумму',0,'same'],['Проверить основание до подтверждения',-5,'reason'],
    ['Потребовать подтверждение сверки',20,'unchecked'],['Использовать все свободные деньги, сохранив целевые',null,'save']
  ];
  const rows=[['Элемент','Сборка index/finance','Chromium','Цель','Шаги','Результат и связи','Действие до результата, мс','Стенд и время UTC','Вид и удобство','Статус']];
  const money=v=>Math.round(v*100)/100;
  const display=v=>v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
  for(const [label,change,mode] of cases){
    const before=await snap(),s=before.workspace;
    const id=['other','over'].includes(mode)?other:wallet;
    const selected=s.wallets.find(w=>w.id===id);
    const target=change===null?0:money(s.reserve+change),delta=money(target-s.reserve);
    await fw.getByRole('button',{name:/Ещё/}).click();
    await fw.getByRole('button',{name:'История операций',exact:true}).click();
    await fw.locator('[data-fw="reserve-adjust"]').click();
    const dialog=page.getByRole('dialog'),fields=dialog.locator('input[name="target"]');
    await dialog.locator('[name=wallet_id]').selectOption(id);
    await fields.fill(String(target));
    const preview=dialog.locator('[data-fw-count-preview]');
    assert.ok(await preview.isVisible(),'При вводе новой свободной суммы не показано изменение реальных денег');
    assert.ok((await preview.innerText()).includes(mode==='over'?'Недостаточно':display(money(selected.balance+delta))));
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    if(mode!=='unchecked')await dialog.getByRole('checkbox').check();
    if(mode!=='reason')await dialog.locator('[name=reason]').fill(label);
    const submit=dialog.getByRole('button',{name:'Подтвердить',exact:true});
    if(process.env.RESERVE_QA_SHOT&&mode==='other'&&delta>0)await dialog.screenshot({path:process.env.RESERVE_QA_SHOT});
    const start=performance.now();
    if(mode==='cancel')await dialog.getByRole('button',{name:'Закрыть'}).click();
    else await submit.click();
    const saved=['save','other'].includes(mode);
    if(saved||mode==='cancel')await dialog.waitFor({state:'hidden'});
    else if(mode==='unchecked')assert.equal(await dialog.getByRole('checkbox').evaluate(el=>el.validity.valueMissing),true);
    else await dialog.getByRole('alert').filter({hasText:mode==='over'?/отрицательным|Недостаточно/:mode==='same'?/совпадает/:/основание/}).waitFor();
    await twoFrames(page);
    const ms=Math.round(performance.now()-start);
    if(await dialog.isVisible())await dialog.getByRole('button',{name:'Закрыть'}).click();
    const a=await snap(),diff=saved?delta:0;
    assert.equal(a.operations.length,before.operations.length+Number(saved));
    assert.equal(a.workspace.reserve,money(s.reserve+diff));
    assert.equal(a.workspace.cash,money(s.cash+diff));
    for(const w of s.wallets)assert.equal(a.workspace.wallets.find(n=>n.id===w.id).balance,money(w.balance+(w.id===id?diff:0)));
    assert.deepEqual(a.workspace.items,s.items);
    await fw.locator('[data-fw-tab=overview]').click();
    assert.equal(await expectedTile('Сейф'),a.workspace.wallets.find(w=>w.id===wallet).balance);
    const steps=({cancel:'Закрыть',reason:'Подтвердить без основания',unchecked:'Подтвердить без отметки о сверке'})[mode]||'Подтвердить';
    rows.push(['UI-0325',build,browser.version(),label,'Финансы → Ещё → История → исправление свободных денег → '+selected.name+' → '+target+' ₽ → '+steps,
      'Свободно '+s.reserve+' → '+a.workspace.reserve+' ₽. Денег всего '+a.workspace.cash+' ₽. Новых проводок '+Number(saved)+'. Другие кошельки и календарь сверены.',ms,'PGlite, '+new Date().toISOString(),'Диалог помещается на 390 px. До подтверждения виден '+(mode==='over'?'отказ по остатку выбранной кассы':'будущий остаток выбранного места хранения')+'.','Пройдено']);
  }
  if(process.env.RESERVE_QA_CSV)fs.writeFileSync(process.env.RESERVE_QA_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
  console.log('11 reserve adjustment journeys passed');
};
