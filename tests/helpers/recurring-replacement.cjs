const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function run({page,fw,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames,errors}){
  const month = day.slice(0,7)+'-01';
  const next = shift(month,0,1), later = shift(month,0,2);
  const cases = [
    ['Увеличение аренды со следующего месяца','Аренда',1400],
    ['Снижение ожидаемого дохода','Субаренда',700,'income'],
    ['Тариф с копейками','Обслуживание',1000.01],
    ['Изменение цены через месяц с сохранением промежуточной цены','Поддержка',780,'later'],
    ['Новая цена после частичной оплаты действующего месяца','Связь',2000,'partial'],
    ['Изменение срока одновременно с суммой','Доставка',1800,'day'],
    ['Отмена введённого тарифа','Печать',1550,'cancel'],
    ['Попытка ретроспективно изменить действующий месяц','Охрана',1900,'past'],
    ['Исправление отсутствующего основания','Интернет',2600,'reason'],
    ['Пересмотр заранее созданного будущего тарифа','Лизинг',950,'future'],
    ['Смена тарифа после досрочной оплаты будущего месяца','Домофон',1600,'prepaid'],
    ['Повторная замена уже завершённой версии','Полиграфия',2000,'closed']
  ];
  const out = process.env.RULE_QA_OUTPUT;
  if(out)fs.mkdirSync(out,{recursive:true});
  const csv=[['ID','Сборка index/finance SHA256','Сценарий','Шаги','Результат и связи','Открытие, мс','Завершение, мс','Визуальная проверка и удобство','Стенд']];
  const more = async name=>{
    await fw.getByRole('button',{name:/Ещё/}).click();
    await fw.getByRole('button',{name,exact:true}).click();
  };
  const home = ()=>fw.locator('[data-fw-tab="overview"]').click();
  const action = id=>fw.locator('[data-fw="replace-rule"][data-id="'+id+'"]');
  const spec = (label,start,amount=1000,direction='expense')=>({label,start_month:start,due_day:10,amount,direction,certainty:'confirmed',reason:'Договор тестовой студии'});
  const controlId=uuid(103);
  await command('rule',spec('Соседнее обязательство',month,567),controlId);
  for(const [i,[task,label,amount,mode]] of cases.entries()){
    const id=uuid(200+i),start=mode==='future'?next:month, effective=['later','future'].includes(mode)?later:next;
    const direction=mode==='income'?'income':'expense';
    await command('rule',spec(label,start,1000,direction),id);
    if(mode==='closed')await command('rule',{...spec(label,next,1350),replace_id:id},uuid(600));
    if(mode==='prepaid')await command('pay',{key:'rule:'+id+':'+next.slice(0,7),amount:375,wallet_id:wallet,date:day,reason:'Аванс за следующий месяц'},uuid(602));
    if(mode==='partial')await command('pay',{key:'rule:'+id+':'+month.slice(0,7),amount:375,wallet_id:wallet,date:day,reason:'Тестовая частичная оплата'},uuid(601));
    await page.evaluate(()=>loadAll());
    const before=await snap(),cash=await expectedTile('Сейф'),income=await expectedTile('Ожидаем до конца месяца');
    await more('Регулярные платежи');
    const started=performance.now(), dialog=page.getByRole('dialog');
    let openMs,finishMs,steps,observation,ux;
    if(mode==='closed' && !await action(id).count()){
      const ended=fw.locator('article').filter({has:page.getByRole('heading',{name:label,exact:true})}).filter({hasText:'по '+month.slice(0,7)});
      assert.equal(await ended.count(),1);
      assert.equal(await ended.locator('[data-fw="replace-rule"]').count(),0);
      assert.equal(await action(uuid(600)).count(),1);
      await twoFrames(page);openMs=Math.round(performance.now()-started);
      const end=performance.now();
      await assert.rejects(command('rule',{...spec(label,next,amount),replace_id:id},uuid(611)),/последний месяц/i);
      finishMs=Math.round(performance.now()-end);
      steps='Открыть регулярные платежи, сравнить обе версии; дополнительно передать прежний ID через тестовую RPC';
      ux='Кнопка изменения только у действующей версии; срок действия предыдущей виден.';
    }else{
      const opener=action(id);
      await opener.click();await dialog.getByLabel('Первый месяц оплаты').waitFor();await twoFrames(page);
      openMs=Math.round(performance.now()-started);
      const date=dialog.getByLabel('Первый месяц оплаты'),sum=dialog.getByLabel('Сумма в месяц');
      assert.equal(await sum.inputValue(),'1000');
      if(mode==='future')assert.equal(await date.inputValue(),effective.slice(0,7),'Первый допустимый месяц для будущего тарифа');
      await sum.fill(String(amount));
      const selected=(mode==='past'?month:effective).slice(0,7);
      await date.fill(selected);
      if(mode==='day')await dialog.getByLabel('До какого числа (1–28)').fill('28');
      assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
      if(out)await dialog.screenshot({path:path.join(out,'rule-'+(i+1)+'.png')});
      if(mode==='reason'){
        await dialog.getByRole('button',{name:'Подтвердить'}).click();
        assert.match(await dialog.getByRole('alert').innerText(),/основание/i);
        assert.equal(await sum.inputValue(),String(amount));
      }
      await dialog.getByLabel('Основание операции').fill('Пересмотр тарифа');
      const end=performance.now();
      if(mode==='cancel')await page.keyboard.press('Escape');
      else await dialog.getByRole('button',{name:'Подтвердить'}).click();
      if(mode==='prepaid'){
        await Promise.race([dialog.waitFor({state:'hidden'}),dialog.getByRole('alert').filter({hasText:/оплат/}).waitFor()]);
        const future=(await snap()).workspace.items.filter(x=>x.label===label && x.due_date.startsWith(next.slice(0,7)));
        assert.equal(future[0].remaining,625,'Отменённая замена должна сохранить досрочную оплату');
        await page.keyboard.press('Escape');
      }
      if(mode==='past'){
        await dialog.getByRole('alert').filter({hasText:/нового месяца/}).waitFor();
        assert.equal(await sum.inputValue(),String(amount));
        await page.keyboard.press('Escape');
      }
      await dialog.waitFor({state:'hidden'});await twoFrames(page);finishMs=Math.round(performance.now()-end);
      if(mode==='closed'){
        const duplicated=(await snap()).workspace.items.filter(x=>x.label===label&&x.due_date.startsWith(next.slice(0,7)));
        assert.equal(duplicated.length,1,'В календаре две версии одного платежа: '+duplicated.map(x=>x.remaining).join(' + '));
      }
      steps='Регулярные платежи → '+label+' → Новая сумма → '+amount+' ₽ с '+selected+(mode==='day'?', число 28':'')+' → '+(mode==='cancel'?'Escape':['past','prepaid'].includes(mode)?'Подтвердить → ошибка → Escape':mode==='reason'?'Подтвердить без причины → ввести основание → подтвердить':'Подтвердить');
      ux='Название и прежняя сумма заполнены. Поля и кнопки помещаются в окне; '+(mode==='prepaid'?'сообщение объясняет защиту учтённой оплаты':mode==='past'?'ошибка объясняет ограничение месяца':mode==='reason'?'ошибка сохраняет ввод':mode==='cancel'?'Escape закрывает форму':'после подтверждения форма закрывается');
    }
    const after=await snap(),changed=!['cancel','past','closed','prepaid'].includes(mode);
    assert.equal(after.revision-before.revision,changed?1:0);
    assert.equal(after.workspace.cash,cash);
    const items=s=>s.workspace.items.filter(x=>x.label!==label).sort((a,b)=>a.key.localeCompare(b.key));
    assert.deepEqual(items(after),items(before));
    const target=after.workspace.items.filter(x=>x.label===label);
    const due=target.find(x=>x.due_date.startsWith(effective.slice(0,7)));
    const expected=changed?amount:mode==='closed'?1350:mode==='prepaid'?625:1000;
    assert.equal(due.remaining,expected);
    assert.equal(due.direction,direction);
    assert.equal(due.due_date.slice(-2),mode==='day'?'28':'10');
    assert.equal(target.filter(x=>x.due_date.startsWith(effective.slice(0,7))).length,1);
    assert.equal(target.find(x=>x.due_date.startsWith(start.slice(0,7))).remaining,mode==='partial'?625:1000);
    if(mode==='later')assert.equal(target.find(x=>x.due_date.startsWith(next.slice(0,7))).remaining,1000);
    await home();await more('Платёжный календарь');
    const card=fw.locator('[data-fw="reschedule"][data-id="'+due.key+'"]').locator('xpath=ancestor::article');
    assert.equal(await card.locator('h3').innerText(),label);
    assert.equal(Number((await card.locator('.fw-row b').innerText()).replace(/[^\d,]/g,'').replace(',','.')),expected);
    const fitsCalendar=await card.evaluate(element=>{
      element.scrollIntoView({block:'nearest',behavior:'instant'});
      return element.clientWidth>0 && element.scrollWidth<=element.clientWidth+1;
    });
    assert.ok(fitsCalendar);
    if(out)await card.screenshot({path:path.join(out,'calendar-'+(i+1)+'.png')});
    await home();
    assert.equal(await expectedTile('Сейф'),cash);assert.equal(await expectedTile('Ожидаем до конца месяца'),income);
    observation='В календаре одна строка за '+effective.slice(0,7)+', '+expected+' ₽, дата '+due.due_date+'. Остаток первого месяца '+(mode==='partial'?625:1000)+' ₽; соседние платежи сохранены; сейф '+cash+' ₽; ожидаем в этом месяце '+income+' ₽.';
    csv.push(['UI-0314',build,task,steps,observation,openMs,finishMs,ux,'Chromium '+browser.version()+' 390×844; PGlite']);
    console.log('PASS',task,openMs,finishMs);
  }
  assert.deepEqual(errors,[]);
  if(out)fs.writeFileSync(path.join(out,'QA_RULE_REPLACEMENT_RUNS.csv'),'\ufeff'+csv.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
