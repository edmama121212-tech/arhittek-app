'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

module.exports=async function({page,fw,db,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames}){
  const month=day.slice(0,7)+'-01', next=shift(month,0,1), later=shift(month,0,2);
  const cases=[
    ['advance','Аванс за следующий месяц',375],['unpaid','Действующая аренда'],
    ['incoming','Окончание субаренды'],['partial','Частично оплаченный текущий месяц',250],
    ['paid','Полностью оплачен текущий месяц',1000],['future','Отмена до первого начисления'],
    ['cancel','Отказ от остановки'],['reason','Исправление основания'],
    ['double','Двойное подтверждение'],['shorten','Досрочное окончание перед сменой тарифа'],
    ['ended','Повторная остановка завершённого тарифа'],['later','Полная оплата через два месяца',1000],
    ['linked','Ранее внесённая оплата связана с будущим месяцем'],['unlinked','Привязка будущей оплаты уже отменена']
  ];
  const out=process.env.STOP_RULE_OUTPUT;
  if(out)fs.mkdirSync(out,{recursive:true});
  const rows=[['ID','Сборка index/finance SHA256','Бизнес-сценарий','Шаги','Результат и связи','Открытие или проверка доступности, мс','Ответ до видимого результата, мс','Вид и удобство','Стенд']];
  const home=()=>fw.locator('[data-fw-tab="overview"]').click();
  const more=async name=>{await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name,exact:true}).click();};
  for(const [i,[mode,label,paid]] of cases.entries()){
    const id=uuid(900+i),key='rule:'+id+':';
    const spec={label,amount:1000,start_month:mode==='future'?next:month,direction:mode==='incoming'?'income':'expense',certainty:'confirmed',due_day:10,reason:'Учебный договор'};
    await command('rule',spec,id);
    if(paid){
      const period=mode==='advance'?next:mode==='later'?later:month;
      await command('pay',{key:key+period.slice(0,7),amount:paid,date:day,wallet_id:wallet,reason:'Учебная оплата'},uuid(950+i));
    }
    if(mode==='linked'||mode==='unlinked'){
      const sourceId=uuid(1500+i),link=uuid(1600+i);
      await db.query("insert into public.company_expenses(id,category,amount,expense_date,description) values($1,'Учебные',80,$2,'Оплата услуги')",[sourceId,day]);
      const source=(await snap()).operations.find(o=>o.source_id===sourceId);
      await command('link',{source:source.id,key:key+next.slice(0,7),amount:80,reason:'Аванс за следующий период'},link);
      if(mode==='unlinked')await command('unlink',{id:link,reason:'Ошибка назначения'},uuid(1700+i));
    }
    if(mode==='shorten')await command('rule',{...spec,amount:1200,start_month:later,replace_id:id},uuid(980+i));
    if(mode==='ended')await command('stop_rule',{id,reason:'Окончание договора'},uuid(980+i));
    await page.evaluate(()=>loadAll());
    const before=await snap(),expected=await expectedTile('Ожидаем до конца месяца'),cash=await expectedTile('Сейф');
    await more('Регулярные платежи');
    const button=fw.locator('[data-fw="stop-rule"][data-id="'+id+'"]');
    const dialog=page.getByRole('dialog'), reject=['advance','later','linked'].includes(mode);
    let t=performance.now(),open,finish,ux;
    if(mode==='ended'){
      assert.equal(await button.count(),0);
      await twoFrames(page);open=Math.round(performance.now()-t);
      t=performance.now();
      await assert.rejects(command('stop_rule',{id,reason:'Устаревшая форма'},uuid(999)),/уже заверш/i);
      finish=Math.round(performance.now()-t);
      ux='Повторная кнопка скрыта, старый запрос отклонён сервером.';
    }else{
      if(i%2)await button.tap();else await button.click();
      await dialog.waitFor();await twoFrames(page);
      open=Math.round(performance.now()-t);
      assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
      assert.ok(await dialog.getByText(label,{exact:true}).isVisible());
      if(mode==='future')assert.equal(await dialog.locator('h2').innerText(),'Отменить будущий платёж');
      const input=dialog.getByLabel('Основание операции'),submit=dialog.getByRole('button',{name:'Подтвердить'});
      if(mode==='reason'){
        await submit.click();await dialog.getByRole('alert').filter({hasText:/основан/i}).waitFor();
      }
      await input.fill('Договор прекращён');
      if(out&&mode==='future')await dialog.screenshot({path:path.join(out,'future.png')});
      t=performance.now();
      if(mode==='cancel')await page.keyboard.press('Escape');
      else if(mode==='double')await submit.dblclick();
      else await submit.click();
      if(reject){
        await Promise.race([dialog.waitFor({state:'hidden'}),dialog.getByRole('alert').filter({hasText:/оплат/}).waitFor()]);
        assert.ok(await dialog.isVisible(),'Остановка скрыла будущую оплаченную строку');
        assert.match(await dialog.getByRole('alert').innerText(),/оплат/);
        if(out&&mode==='advance')await dialog.screenshot({path:path.join(out,'advance.png')});
      }else await dialog.waitFor({state:'hidden'});
      await twoFrames(page);finish=Math.round(performance.now()-t);
      if(reject)await page.keyboard.press('Escape');
      ux=reject?'Причина отказа видна в форме; закрытие доступно.':mode==='cancel'?'Escape закрыл форму.':'Подтверждение закрыло форму, горизонтального переполнения нет.';
    }
    const after=await snap(),changed=!reject&&!['cancel','ended'].includes(mode);
    assert.equal(after.revision,before.revision+(changed?1:0));
    const scheduled=s=>s.workspace.items.filter(x=>x.key.startsWith(key)).sort((a,b)=>a.key.localeCompare(b.key));
    const others=s=>s.workspace.items.filter(x=>!x.key.startsWith(key)).sort((a,b)=>a.key.localeCompare(b.key));
    const wanted=scheduled(before).filter(x=>!changed||x.key.slice(-7)<=month.slice(0,7));
    assert.deepEqual(scheduled(after),wanted);
    assert.deepEqual(others(after),others(before));
    assert.deepEqual(after.workspace.wallets,before.workspace.wallets);
    assert.equal(after.workspace.rules.find(r=>r.id===id).end_month,changed?month:before.workspace.rules.find(r=>r.id===id).end_month);
    await home();await more('Платёжный календарь');
    assert.equal(await fw.locator('[data-fw="pay"][data-id^="'+key+'"]').count(),wanted.length);
    for(const item of wanted){
      const card=fw.locator('[data-fw="pay"][data-id="'+item.key+'"]').locator('xpath=ancestor::article');
      assert.equal(await card.locator('h3').innerText(),label);
      assert.equal(Number((await card.locator('.fw-row b').innerText()).replace(/[^\d,]/g,'').replace(',','.')),item.remaining);
    }
    await home();assert.equal(await expectedTile('Сейф'),cash);assert.equal(await expectedTile('Ожидаем до конца месяца'),expected);
    const setup='Тариф '+spec.amount+' ₽/мес. с '+spec.start_month+'. '+(paid?'Провести '+paid+' ₽ за '+(mode==='advance'?next:mode==='later'?later:month).slice(0,7)+'. ':mode==='shorten'?'Заменить тариф с '+later+' на 1200 ₽. ':mode==='ended'?'Предварительно завершить тариф. ':['linked','unlinked'].includes(mode)?'Привязать 80 ₽ к следующему месяцу. '+(mode==='unlinked'?'Отменить привязку. ':''):'');
    const steps=setup+'Ещё → Регулярные платежи → '+label+' → '+({ended:'проверить отсутствие повторного действия и отправить прежний запрос',cancel:'остановка → Escape',reason:'подтвердить без причины → ввести причину → подтвердить',double:'остановка → ввести причину → подтвердить дважды'}[mode]||'остановка → ввести причину → подтвердить')+' → календарь → Главная.';
    rows.push(['UI-0318',build,label,steps,'Изменений '+(after.revision-before.revision)+', строки данного договора до/после '+scheduled(before).length+'/'+wanted.length+', остаток в периодах '+(wanted.map(x=>x.due_date+' '+x.remaining+' ₽').join(', ')||'нет')+'. Соседние договоры сохранены, сейф '+cash+' ₽, ожидаем '+expected+' ₽.',open,finish,ux,'Chromium '+browser.version()+' 390×844; PGlite']);
    console.log('PASS',mode,open,finish);
  }
  if(out)fs.writeFileSync(path.join(out,'QA_STOP_RULE_RUNS.csv'),'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
