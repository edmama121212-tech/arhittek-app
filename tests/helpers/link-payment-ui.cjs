'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function ({ page, fw, db, command, snap, day, uuid, shift, build, browser, expectedTile, twoFrames }) {
  const home = () => fw.locator('[data-fw-tab="overview"]').click();
  const calendar = async () => {
    await fw.getByRole('button', {name:/Ещё/}).click();
    await fw.getByRole('button', {name:'Платёжный календарь',exact:true}).click();
  };
  const amountText = s => Number(s.replace(/[^\d,]/g,'').replace(',','.'));
  const round = n => Math.round(n*100)/100;
  const output = process.env.PAYMENT_LINK_OUTPUT;
  if (output) fs.mkdirSync(output,{recursive:true});
  const rows = [['Элемент','Сборка SHA256 index/finance','Бизнес-сценарий','Воспроизведение','Результат в календаре и связанных разделах','Открытие до отрисовки, мс','Действие до отрисовки, мс','Визуальная проверка','Удобство','Стенд и дата UTC','Статус']];
  const month = day.slice(0,7)+'-01';
  let nextId = 3000;
  const next = () => uuid(++nextId);
  async function plan(label,amount,direction='expense',date=day,funding='reserve') {
    const id = next();
    await command('plan',{label,amount,direction,due_date:date,funding,certainty:'confirmed',reason:'Учебный план'},id);
    return id;
  }
  async function source(label,amount,direction='expense') {
    const id = next();
    const table = direction==='expense'?'company_expenses':'company_income';
    await db.query('insert into public.'+table+'(id,category,amount,'+direction+'_date,description) values($1,$2,$3,$4,$5)',[id,'Учебные',amount,day,label]);
    return (await snap()).operations.find(o=>o.source_id===id).id;
  }
  const card = key => fw.locator('[data-fw="pay"][data-id="'+key+'"]').locator('xpath=ancestor::article');
  const dialog = page.getByRole('dialog');
  const section = fw.locator('[data-fw-section="unmatched"]');
  const button = id => section.locator('[data-fw="link"][data-id="'+id+'"]');
  const select = dialog.locator('[name="key"]'), amount = dialog.locator('[name="amount"]');
  const submit = dialog.getByRole('button',{name:'Подтвердить'});
  const openSection = async () => {
    if (await section.count() && !(await section.evaluate(e=>e.open))) await section.locator('summary').click();
  };
  const waitFrames = () => twoFrames(page);
  // No other eligible expense plans exist yet.
  const amort = await plan('Замена оборудования',200,'expense',day,'amortization');
  const reservePayment = await source('Доставка из свободных денег',110);
  await page.evaluate(()=>loadAll());
  const reserveBefore=await snap(), reserveCash=await expectedTile('Сейф');
  const reserveExpected=await expectedTile('Ожидаем до конца месяца');
  let started=performance.now();
  await calendar();await openSection();await waitFrames();
  const discoveryMs=Math.round(performance.now()-started);
  started=performance.now();
  await button(reservePayment).click();
  await waitFrames();
  if (await dialog.isVisible()) {
    await select.selectOption(amort);
    await dialog.locator('[name="reason"]').fill('Ошибочное назначение');
    await submit.click();
    const error=dialog.getByRole('alert');
    await error.filter({hasText:/резервирован/}).waitFor();
    assert.fail('Интерфейс предложил план амортизации. Сервер вернул: '+await error.innerText());
  }
  const feedback=page.locator('#toast.show');
  await feedback.filter({hasText:/подходящим назначением/}).waitFor();
  const rejectedMs=Math.round(performance.now()-started);
  if(output) await page.screenshot({path:path.join(output,'link-funding.png')});
  const geometry = await feedback.evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,viewport:window.innerWidth}));
  assert.ok(geometry.left>=-1 && geometry.right<=geometry.viewport+1,'Сообщение целиком в окне: '+JSON.stringify(geometry));
  assert.ok(await card(amort).isVisible());
  assert.equal(amountText(await card(amort).locator('.fw-row b').innerText()),200);
  assert.ok(await button(reservePayment).isVisible());
  const reserveAfter=await snap();
  assert.equal(reserveAfter.revision,reserveBefore.revision);
  assert.deepEqual(reserveAfter.workspace.items,reserveBefore.workspace.items);
  assert.deepEqual(reserveAfter.workspace.links,reserveBefore.workspace.links);
  assert.deepEqual(reserveAfter.workspace.wallets,reserveBefore.workspace.wallets);
  await home();
  assert.equal(await expectedTile('Сейф'),reserveCash);
  assert.equal(await expectedTile('Ожидаем до конца месяца'),reserveExpected);
  rows.push(['UI-0319',build,'Расход из свободных денег при единственном плане амортизации','Запланировать 200 ₽ на замену оборудования из амортизации. Отдельно провести расход 110 ₽ из свободных денег. Ещё → Платёжный календарь → Оплаты, внесённые вне календаря → Связать с планом → сверить календарь и Главную.',
    'Календарь сохранил долг 200 ₽, расход 110 ₽ доступен для распределения. Новых операций и связей 0. Сейф '+reserveCash+' ₽, ожидаем '+reserveExpected+' ₽.',discoveryMs,rejectedMs,
    'Сообщение отображено без горизонтального переполнения, план и исходная оплата остались доступны.','Причина отсутствия подходящего плана показана сразу после нажатия.','Chromium '+browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);
  const title = 'Счёт подрядчика';
  const original = await plan(title,800,'expense',day);
  const duplicate = await plan(title,800,'expense',shift(day,1));
  const smaller = await plan('Курьер',125.50,'expense',shift(day,2));
  const first = await source('Ранее выплачено подрядчику',800);
  const second = await source('Доплата подрядчику',125.50);
  const cases = [
    {title:'Выбрать одноимённый счёт по сроку',mode:'duplicate',key:duplicate,sourceAmount:800,use:800},
    {title:'Погасить меньший счёт из крупной выплаты',source:first,key:smaller,use:125.5},
    {title:'Остаток одной выплаты направить на второй счёт',source:first,key:original,use:674.5},
    {title:'Закрыть остаток счёта второй выплатой',source:second,key:original,use:125.5},
    {title:'Распределить только согласованную часть',mode:'partial',label:'Поставка',planAmount:600,sourceAmount:500,use:200},
    {title:'Погасить обязательство без срока с точностью до копейки',label:'Нотариальные услуги',planAmount:46.13,sourceAmount:46.14,use:46.13,date:null},
    {title:'Назначить аванс в ожидаемые поступления месяца',label:'Субаренда',direction:'income',planAmount:3000,sourceAmount:1500,use:1500},
    {title:'Учесть аванс за следующий месяц',label:'Оплата будущего этапа',direction:'income',planAmount:900,sourceAmount:900,use:900,date:shift(month,0,1)},
    {title:'Погасить конкретный месяц регулярного платежа',label:'Уборка офиса',mode:'rule',sourceAmount:350,use:350},
    {title:'Отказаться от привязки до подтверждения',label:'Канцелярия',mode:'cancel',planAmount:90,sourceAmount:60,use:0},
    {title:'Исправить сумму выше остатка плана',label:'Доставка образцов',mode:'limit',planAmount:400,sourceAmount:700,use:400},
    {title:'Распределить остаток после оплаты в календаре',label:'Оборудование',mode:'paid',planAmount:1000,sourceAmount:900,use:650}
  ];
  for (const c of cases) {
    const direction = c.direction || 'expense';
    const due = c.date===undefined ? day : c.date;
    let key = c.key;
    if (c.mode==='rule') {
      const id = next();
      await command('rule',{label:c.label,amount:500,start_month:month,due_day:12,direction,certainty:'confirmed',reason:'По договору уборки'},id);
      key='rule:'+id+':'+shift(month,0,1).slice(0,7);
    } else if (!key) key = await plan(c.label,c.planAmount,direction,due);
    if (c.mode==='paid') {
      const wallet=(await snap()).workspace.wallets.find(w=>w.is_default);
      await command('pay',{key,amount:350,date:day,wallet_id:wallet.id,reason:'Учтён аванс в календаре'},next());
    }
    const other = c.mode==='partial' ? await plan('Запасные материалы',300) : null;
    const id = c.source || await source('Внесённая оплата · '+c.title,c.sourceAmount,direction);
    const before = await snap();
    const item = before.workspace.items.find(x=>x.key===key);
    const available = o=>o.workspace.unmatched.find(x=>x.id===id)?.remaining||0;
    const limit = Math.min(item.remaining,available(before));
    await page.evaluate(()=>loadAll());
    const cash = await expectedTile('Сейф'), expected = await expectedTile('Ожидаем до конца месяца');
    await calendar();await openSection();
    let t = performance.now();
    await button(id).click();
    await dialog.waitFor();await waitFrames();
    const openMs = Math.round(performance.now()-t);
    let selection = key;
    if (c.mode==='duplicate') {
      const labels=await Promise.all([original,duplicate].map(k=>select.locator('option[value="'+k+'"]').innerText()));
      assert.notEqual(labels[0],labels[1],'Одноимённые счета должны различаться по сроку');
      const displayedDate=await page.evaluate(date=>fmtDate(date),item.due_date);
      assert.ok(labels[1].includes(displayedDate));
      selection={label:labels[1]};
    }
    await select.selectOption(selection);
    assert.equal(Number(await amount.inputValue()),limit,'Сумма соответствует выбранному остатку');
    assert.equal(Number(await amount.getAttribute('max')),limit,'Верхняя граница одного назначения');
    if (c.mode==='limit') {
      await amount.fill(String(limit+0.01));
      await submit.click();
      assert.equal(await amount.evaluate(e=>e.validity.rangeOverflow),true);
      assert.equal((await snap()).revision,before.revision);
    }
    if (c.use && (c.use!==limit||c.mode==='limit')) await amount.fill(String(c.use));
    if (other) {
      await select.selectOption(other);
      assert.equal(Number(await amount.inputValue()),c.use);
      await select.selectOption(key);
      assert.equal(Number(await amount.inputValue()),c.use);
    }
    await dialog.locator('[name="reason"]').fill('Распределение ранее внесённой оплаты');
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.ok(await select.isVisible() && await amount.isVisible() && await submit.isVisible());
    const visibleChoice = await select.locator('option:checked').innerText();
    if (output) {
      await dialog.screenshot({path:path.join(output,'link-'+String(rows.length).padStart(2,'0')+'.png')});
    }
    t=performance.now();
    if (c.mode==='cancel') await dialog.getByRole('button',{name:'Закрыть'}).click();
    else await submit.click();
    await dialog.waitFor({state:'hidden'});await waitFrames();
    const finish = Math.round(performance.now()-t), after = await snap();
    const debt = round(item.remaining-c.use), left = round(available(before)-c.use);
    assert.equal(after.revision-before.revision,c.use?1:0);
    assert.equal(available(after),left);
    assert.equal(after.workspace.items.find(x=>x.key===key)?.remaining||0,debt);
    const neighbors = j=>j.workspace.items.filter(x=>x.key!==key).sort((a,b)=>a.key.localeCompare(b.key));
    assert.deepEqual(neighbors(after),neighbors(before));
    assert.deepEqual(after.workspace.wallets,before.workspace.wallets);
    assert.equal(after.workspace.cash,before.workspace.cash);
    assert.deepEqual(after.operations.filter(o=>o.cash_delta).map(o=>o.id),before.operations.filter(o=>o.cash_delta).map(o=>o.id));
    const links = j=>j.workspace.links.filter(x=>x.plan_key===key&&x.source_operation===id);
    assert.equal(links(after).length-links(before).length,c.use?1:0);
    if (c.use) assert.ok(links(after).some(l=>l.amount===c.use));
    assert.equal(await card(key).count(),debt?1:0);
    if (debt) assert.equal(amountText(await card(key).locator('.fw-row b').innerText()),debt);
    await openSection();
    assert.equal(await button(id).count(),left?1:0);
    if (left) {
      const line = await button(id).locator('..').locator('span').innerText();
      assert.ok(line.replace(/\s/g,'').includes(left.toFixed(2).replace('.',',')+'₽'));
    }
    await home();
    assert.equal(await expectedTile('Сейф'),cash);
    const nextExpected=round(expected-(direction==='income'&&item.due_date?.startsWith(day.slice(0,7))?c.use:0));
    assert.equal(await expectedTile('Ожидаем до конца месяца'),nextExpected);
    const setup = (c.mode==='paid'?'Записать в календаре аванс 350 ₽ за оборудование. ':'')+
      'Остаток исходной оплаты '+available(before)+' ₽; в плане «'+item.label+'» '+item.remaining+' ₽, срок '+(item.due_date||'не назначен')+'. ';
    const steps = setup+'Ещё → Платёжный календарь → Оплаты, внесённые вне календаря → Связать с планом → выбрать «'+visibleChoice+'» → '+
      (c.mode==='cancel'?'закрыть':(c.mode==='limit'?'ввести '+(limit+0.01)+' ₽ и попытаться подтвердить → исправить сумму → ':'')+'назначить '+c.use+' ₽ → '+(other?'проверить второй план и вернуться к первому → ':'')+'указать основание → подтвердить')+' → сверить календарь и Главную.';
    const result = 'План '+item.remaining+' → '+debt+' ₽, свободная часть исходной оплаты '+available(before)+' → '+left+' ₽, новых связей '+(c.use?1:0)+
      '. Сейф '+cash+' ₽, новых денежных проводок 0. Ожидаемые поступления месяца '+expected+' → '+nextExpected+' ₽. Другие сроки и платежи сохранены.';
    const usability = c.mode==='limit'?'Неверное значение остановлено в поле, исправление в той же форме.':c.mode==='cancel'?'Форма закрывается отдельной кнопкой, план можно выбрать заново.':
      other?'При просмотре альтернативного плана вручную введённая часть сохранилась.':c.mode==='duplicate'||c.mode==='rule'?'Срок выбранного платежа виден в списке.':'Доступная сумма подставлена после выбора, частичная сумма редактируется.';
    rows.push(['UI-0319',build,c.title,steps,result,openMs,finish,'Диалог 390×844 без горизонтального переполнения, план, сумма и подтверждение видны.',usability,'Chromium '+browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);
    console.log('PASS',c.title,openMs,finish);
  }
  if (output) fs.writeFileSync(path.join(output,'QA_LINK_RUNS.csv'),'\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
