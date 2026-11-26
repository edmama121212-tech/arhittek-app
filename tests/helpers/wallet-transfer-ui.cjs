'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function({page,fw,command,snap,wallet,uuid,build,browser,expectedTile,twoFrames}){
  const bank=uuid(3841), desk=uuid(3842);
  const names={[wallet]:'Сейф',[bank]:'Банк студии',[desk]:'Касса объекта'};
  const visit=async tab=>{
    await fw.locator('[data-fw-tab="more"]').click();
    await fw.locator('[data-fw-tab="'+tab+'"]').click();
  };
  const button=fw.locator('[data-fw="wallet-transfer"]');
  const section=fw.locator('[data-fw-section="storage-settings"]');
  const dialog=page.getByRole('dialog');
  const cases=[
    ['first','Внести наличные в банк',wallet,bank,3300],
    ['reverse','Вернуть средства из банка в сейф',bank,wallet,350],
    ['branch','Выдать кассе объекта деньги из банка',bank,desk,110],
    ['cents','Перевести одну копейку из кассы объекта в сейф',desk,wallet,0.01],
    ['exact','Вернуть в банк весь остаток кассы объекта',desk,bank,109.99],
    ['empty','Остановить перевод из пустой кассы объекта',desk,wallet,1],
    ['over','Остановить превышение банковского остатка на копейку',bank,desk,null],
    ['retry','Исправить сумму, превышающую остаток',bank,desk,35],
    ['cancel','Отказаться от подготовленного перевода',wallet,desk,250],
    ['reason','Добавить пропущенное обоснование',wallet,desk,299],
    ['double','Двойное подтверждение выдачи в кассу',wallet,desk,17],
    ['hold','Переместить деньги при уже начисленном обязательстве',wallet,desk,500],
  ];
  const output=process.env.TRANSFER_OUTPUT;
  if(output)fs.mkdirSync(output,{recursive:true});
  const csv=[['ID','SHA256 index / finance','Сценарий','Начальные данные и действия','Фактический результат и связанные разделы','Открытие, мс','Действие до результата, мс','Визуальная проверка','Удобство','Стенд','Итог']];
  await visit('accounts');
  assert.equal(await button.count(),0);
  for(const [key,task,src,dest,value] of cases){
    if(key==='first')await command('wallet',{kind:'bank',name:names[bank],reason:'Учебный банк студии'},bank);
    if(key==='branch')await command('wallet',{kind:'cash',name:names[desk],reason:'Учебная касса объекта'},desk);
    if(key==='hold')await command('plan',{direction:'expense',label:'Начисление подрядчику',amount:47500,certainty:'confirmed',funding:'reserve',obligation:true,reason:'Долг по учебному договору'},uuid(3851));
    await page.evaluate(()=>loadAll());
    const before=await snap();
    const balances=s=>Object.fromEntries(s.workspace.wallets.map(w=>[w.id,Math.round(w.balance*100)]));
    const expected=balances(before);
    const capacity=expected[src]/100;
    if(key==='hold')assert.equal(before.workspace.reserve,0);
    const amount=key==='over'?capacity+0.01:value;
    await visit('accounts');
    if(!await section.evaluate(e=>e.open))await section.locator('summary').click();
    const started=performance.now();
    await button.click();await dialog.waitFor();await twoFrames(page);
    const open=Math.round(performance.now()-started);
    const from=dialog.locator('[name=from]'),to=dialog.locator('[name=to]'),field=dialog.getByLabel('Сумма'),reason=dialog.getByLabel('Основание операции'),submit=dialog.getByRole('button',{name:'Подтвердить'});
    assert.equal(await from.inputValue(),wallet);
    if(key==='first')assert.equal(await to.inputValue(),dest);
    if(src!==wallet)await from.selectOption(src);
    if(key==='reverse')assert.equal(await to.inputValue(),wallet);
    assert.ok(await to.locator('option[value="'+src+'"]').evaluate(option=>option.disabled));
    if(await to.inputValue()!==dest)await to.selectOption(dest);
    assert.equal(Number(await field.getAttribute('max')),capacity);
    await field.fill(String(key==='retry'?capacity+1:amount));
    if(key!=='reason')await reason.fill(task);
    const visual=await dialog.evaluate(el=>({
      fits:el.scrollWidth<=el.clientWidth+1,
      controls:[...el.querySelectorAll('select,input,button')].every(node=>node.getBoundingClientRect().width>20),
      width:el.getBoundingClientRect().width
    }));
    assert.ok(visual.fits&&visual.controls);
    if(output&&key==='reverse')await dialog.screenshot({path:path.join(output,'transfer.png')});
    const start=performance.now();
    const rejected=['empty','over'].includes(key);
    if(rejected||key==='retry'){
      await submit.click();
      assert.ok(await field.evaluate(e=>e.validity.rangeOverflow));
      assert.equal((await snap()).revision,before.revision);
      if(key==='retry')await field.fill(String(amount));
    }
    if(key==='reason'){
      await submit.click();
      await dialog.getByRole('alert').filter({hasText:'Укажите основание'}).waitFor();
      assert.equal((await snap()).revision,before.revision);
      await reason.fill(task);
    }
    const written=!rejected&&key!=='cancel';
    if(key==='cancel')await dialog.getByRole('button',{name:'Закрыть'}).click();
    if(written){
      if(key==='double')await submit.dblclick();else await submit.click();
    }
    if(!rejected)await dialog.waitFor({state:'hidden'});
    await twoFrames(page);const elapsed=Math.round(performance.now()-start);
    if(rejected)await dialog.getByRole('button',{name:'Закрыть'}).click();
    const after=await snap();
    if(written){
      expected[src]-=Math.round(amount*100);expected[dest]+=Math.round(amount*100);
    }
    assert.deepEqual(balances(after),expected);
    assert.equal(after.revision,before.revision+Number(written));
    assert.deepEqual(after.operations,before.operations);
    assert.deepEqual(after.workspace.items,before.workspace.items);
    assert.deepEqual(after.balances,before.balances);
    assert.equal(after.workspace.cash,before.workspace.cash);
    const delta=after.workspace.changes.filter(h=>h.entity==='wallet_transfer'&&h.after_value.reason===task);
    assert.equal(delta.length,Number(written));
    const readMoney=async loc=>Number((await loc.innerText()).replace(/[^\d,-]/g,'').replace(',','.'));
    for(const id of Object.keys(expected)){
      const balance=id===wallet?fw.locator('.fw-row').filter({hasText:'Деньги в сейфе'}):fw.locator('article').filter({has:page.getByRole('heading',{name:names[id],exact:true})});
      assert.equal(await readMoney(balance.locator('strong')),expected[id]/100);
    }
    await visit('history');
    const history=fw.locator('[data-fw-section="plan-history"]');
    if(!await history.evaluate(e=>e.open))await history.locator('summary').click();
    assert.equal(await history.getByText(task,{exact:true}).count(),Number(written));
    await fw.locator('[data-fw-tab="overview"]').click();
    assert.equal(await expectedTile('Сейф'),expected[wallet]/100);
    const steps='Финансы → Ещё → Сейф → Другие места хранения → Перевести деньги. '+names[src]+' ('+capacity+' ₽) → '+names[dest]+', '+amount.toFixed(2)+' ₽. '+({
      retry:'Сначала ввести сумму на рубль выше остатка, исправить и подтвердить.',cancel:'Закрыть до подтверждения.',reason:'Подтвердить без основания, дописать его и повторить.',double:'Дважды нажать подтверждение.'
    }[key]||'Подтвердить перевод.');
    const result=(written?'Один перевод.':rejected?'Сумма отклонена в поле ввода.':'Форма закрыта без перевода.')+
      ' Остатки: '+Object.entries(expected).map(([id,v])=>names[id]+' '+(v/100)+' ₽').join(', ')+
      '. Сумма компании '+after.workspace.cash+' ₽, свободный резерв '+after.workspace.reserve+' ₽. История переводов и Главная сверены, денежных проводок не добавилось.';
    const ux=rejected?'Предел указан рядом с суммой, введённые данные сохранены.':key==='reverse'?'После смены источника выбран другой получатель.':key==='cancel'?'Закрытие возвращает в карточку мест хранения.':'Остатки источника и получателя видны в списках при выборе.';
    csv.push(['UI-0322',build,task,steps,result,open,elapsed,'Ширина диалога '+visual.width+' px, все поля доступны, горизонтального переполнения нет.',ux,'Chromium '+browser.version()+' / PGlite / 390×844 / '+new Date().toISOString(),'PASS']);
    console.log('PASS',key,elapsed);
  }
  if(output)fs.writeFileSync(path.join(output,'QA_WALLET_TRANSFER_RUNS.csv'),'\uFEFF'+csv.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
