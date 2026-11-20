'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const cases=[
 ['boundary','Нашлась квитанция в день открытия учёта','Граница начала учёта включительно','advance'],
 ['older','Перед закрытием договора нашли квитанцию за день до открытия','Квитанция до границы учёта','final_payment'],
 ['priorMonth','Уточнить месяц принятого бюджета на материалы','Дата предыдущего месяца в открытом учёте','materials_budget'],
 ['historicalFinal','Закрыть договор прежней оплатой без точного дня','Архивная оплата остатка','final_payment'],
 ['switchIncome','Изменить назначение прежней оплаты с аванса на материалы','Смена типа поступления сохраняет неизвестную дату','materials_budget'],
 ['futureUnknown','При сверке выяснилось, что будущая дата черновика ошибочна, оплата давняя','Будущая дата черновика не переносится в старую оплату','advance'],
 ['emptyUnknown','В пустом поле нельзя незаметно принять деньги сегодня','Принять старую оплату после отказа за пустую дату','advance'],
 ['outBack','Отказаться от старой оплаты, передумать выводить средства и принять их сегодня','Переход через вывод сбрасывает признак архивной оплаты','advance'],
 ['cancel','Отменить черновик старой оплаты и открыть форму заново','Режим и дата при повторном входе','advance'],
 ['fee','При смене назначения на гонорар убрать ошибочную отметку и отложить выплату','Недоступность старой клиентской оплаты для гонорара','fee_payment'],
 ['clearKnown','Восстановить точную дату после ошибки пустого поля','Исправление пустой даты без повторной записи','final_payment'],
 ['amount','Исправить сумму архивного аванса с копейками','Ошибка суммы не меняет режим неизвестной даты','advance'],
 ['split','Разнести старую и нынешнюю части оплаты одного договора','Отдельный учёт двух частей оплаты','advance'],
 ['restore','Вернуть введённую дату после краткого выбора неизвестной','Сохранение черновика точного дня','advance']
];
const projectName=i=>'Договор приёмки '+String(i+1).padStart(2,'0');
const amount=i=>i===1||i===3?800:12.25+i;
const money=text=>Number(text.replace(/[^\d,-]/g,'').replace(',','.'));
exports.prepare=async(db,id,root)=>{
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261120090000_project_card_payment.sql'),'utf8'));
  await db.exec("update arhittek_finance.settings set active=true,opening_mode='zero',zero_start_date=(date_trunc('month',clock_timestamp() at time zone 'Europe/Moscow')-interval '1 month')::date,activated_at=(date_trunc('month',clock_timestamp() at time zone 'Europe/Moscow')-interval '1 month') at time zone 'Europe/Moscow' where singleton");
  await db.query("insert into public.categories(id,name) values($1,'Архитектурное решение')",[id(9430)]);
  await db.query("insert into public.statuses(id,name) values($1,'В работе')",[id(9431)]);
  for(const [i] of cases.entries())await db.query("insert into public.projects(id,name,category_id,status_id,price,advance,balance,payment_status,fee_base) values($1,$2,$3,$4,1000,200,800,'Частично оплачен','profit')",[id(9440+i),projectName(i),id(9430),id(9431)]);
};
exports.run=async({page,fw,db,uuid,day,shift,snap,build,browser,expectedTile,twoFrames})=>{
  const projects=(await db.query('select * from public.projects order by name')).rows;
  for(const p of projects)for(const k of ['price','advance','balance','fee_paid','co_fee_paid'])p[k]=Number(p[k]||0);
  await page.evaluate(async ({projects,cat,st})=>{
    __db.categories.push({id:cat,name:'Архитектурное решение',department_id:'d'});
    __db.statuses.push({id:st,name:'В работе'});
    __db.projects=projects;__db.ledger_entries=[];__db.audit_log=[];await loadAll();
  },{projects,cat:uuid(9430),st:uuid(9431)});
  await require('./card-payment-ui.cjs').installBridge(page,db);
  const start=(await snap()).workspace.start_date,old=shift(start,-1),last=shift(day.slice(0,7)+'-01',-1);
  const rows=[['Элементы','Сборка index/finance','Бизнес-сценарий','Функция даты и признака','Шаги и данные','Фактический результат и связи','Открытие, мс','До результата, мс','Визуальная проверка и удобство','Время UTC и стенд','Итог']];
  const report=async()=>{
    await fw.locator('[data-fw-tab=more]').click();
    const report=fw.locator('[data-fw-section=month-report]');
    await report.locator('summary').click();
    const value=money(await report.locator('.fw-card').filter({has:page.getByText('Выручка',{exact:true})}).locator('strong').innerText());
    await fw.locator('[data-fw-tab=overview]').click();return value;
  };
  const modal=page.locator('#paymentSheetOverlay'),date=modal.locator('#payment-date'),prior=modal.locator('#payment-before-start'),sum=modal.locator('#payment-amount');
  const save=modal.locator('#payment-save'),open=page.locator('#pf-add-payment');
  const type=kind=>modal.locator('[data-value="'+kind+'"]').click();
  const unknown=async()=>{await prior.check();assert.ok(await date.isDisabled());assert.ok(!await date.isVisible());assert.ok(await modal.locator('#payment-history-note').isVisible());assert.ok(!await modal.locator('.fw-wallet-picker').isVisible());};
  const chosen=async()=>{await prior.uncheck();assert.ok(await date.isEnabled());assert.ok(await date.isVisible());};
  for(const [i,[mode,title,functionality,kind]] of cases.entries()){
    const id=uuid(9440+i),before=await expectedTile('Сейф'),rev=await report(),a=amount(i),note='Тест периода '+(i+1);
    await page.locator('.nav-btn[data-view=view-projects]').click();
    await page.locator('#projectsCard .proj-row').filter({has:page.getByText(projectName(i),{exact:true})}).click();
    await page.locator('#project-tab-money').click();
    let at=performance.now();await open.click();await date.waitFor();await twoFrames(page);
    const openMs=Math.round(performance.now()-at);assert.equal(await date.inputValue(),day);
    assert.equal(await prior.isChecked(),false);
    await sum.fill(String(a));await modal.locator('#payment-note').fill(note);
    let dt=day,archive=false,cancelled=false,second=0;
    const steps=[];
    if(!['switchIncome','fee'].includes(mode))await type(kind);
    if(['boundary','older','priorMonth','restore'].includes(mode)){
      dt=mode==='boundary'?start:mode==='older'?old:mode==='priorMonth'?last:shift(day,-1);
      await date.fill(dt);await unknown();await chosen();assert.equal(await date.inputValue(),dt);
      steps.push('Ввести '+dt+' → отметить и снять «точная дата неизвестна» → проверить восстановленную дату');
    }
    if(['emptyUnknown','clearKnown'].includes(mode)){
      await date.fill('');await save.click();await page.locator('#toast').filter({hasText:/дату/}).waitFor();
      assert.ok(await modal.isVisible());assert.equal(await sum.inputValue(),String(a));
      assert.equal((await db.query('select count(*) as n from public.ledger_entries where project_id=$1',[id])).rows[0].n,0);
      steps.push('Очистить дату → Сохранить → отказ без записи');
      if(mode==='clearKnown'){dt=last;await date.fill(dt);steps.push('Ввести '+dt);}
    }
    if(['historicalFinal','switchIncome','futureUnknown','emptyUnknown','outBack','cancel','fee','amount','split'].includes(mode)){
      if(mode==='futureUnknown'){await date.fill(shift(day,2));steps.push('Ввести '+shift(day,2));}
      await unknown();archive=true;steps.push('Отметить прежнюю оплату без даты');
    }
    if(mode==='switchIncome'){await type(kind);assert.ok(await prior.isChecked());assert.ok(!await date.isVisible());steps.push('Сменить аванс на бюджет материалов');}
    if(mode==='outBack'||mode==='fee'){
      await type(mode==='fee'?'fee_payment':'withdrawal');assert.ok(!await prior.isVisible());assert.ok(!await prior.isChecked());assert.ok(await date.isVisible());archive=false;
      if(mode==='fee'){cancelled=true;steps.push('Сменить на гонорар → закрыть без выплаты');}
      else{await type(kind);assert.ok(await prior.isVisible());assert.ok(!await prior.isChecked());steps.push('Сменить на вывод, затем обратно на аванс → проверить сброс отметки');}
    }
    if(mode==='cancel'){
      await modal.locator('#paymentSheetClose').click();await open.click();assert.ok(!await prior.isChecked());assert.equal(await date.inputValue(),day);assert.equal(await sum.inputValue(),'');cancelled=true;archive=false;
      steps.push('Закрыть → открыть заново → проверить чистую форму → закрыть');
    }
    if(mode==='amount'){
      await sum.fill('0');await save.click();await page.locator('#toast').filter({hasText:/сумму/}).waitFor();assert.ok(await prior.isChecked());await sum.fill(String(a));
      steps.push('Ввести 0 ₽ → Сохранить → исправить на '+a+' ₽ без потери режима');
    }
    const layout=await modal.locator('.sheet').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
    assert.ok(layout.width>280&&layout.scroll<=layout.width+1);
    if(mode==='futureUnknown'&&process.env.CARD_TIMING_SHOT)await modal.locator('.sheet').screenshot({path:process.env.CARD_TIMING_SHOT});
    at=performance.now();
    if(cancelled)await modal.locator('#paymentSheetClose').click();else await save.click();
    try{await modal.waitFor({state:'hidden'});}catch(error){throw Error(mode+': '+await page.locator('#toast').textContent(),{cause:error});}await page.waitForFunction(()=>!paymentSaveInFlight&&!loadAllInFlight);
    if(mode==='split'){
      await open.click();assert.equal(await prior.isChecked(),false);await sum.fill('1.25');await save.click();await modal.waitFor({state:'hidden'});
      await page.waitForFunction(()=>!paymentSaveInFlight&&!loadAllInFlight);second=1.25;steps.push('Открыть новую форму и принять 1,25 ₽ сегодня');
    }
    await twoFrames(page);const ms=Math.round(performance.now()-at);
    const entries=(await db.query('select amount,entry_date::text,received_before_start from public.ledger_entries where project_id=$1 order by created_at',[id])).rows;
    assert.equal(entries.length,cancelled?0:second?2:1);
    if(!cancelled){
      assert.equal(entries[0].entry_date,archive?day:dt);assert.equal(entries[0].received_before_start,archive);assert.equal(Number(entries[0].amount),a);
      const meta=page.locator('#pf-payment-history .li-meta').filter({hasText:note});await meta.waitFor();
      if(archive)assert.match(await meta.innerText(),/точная дата неизвестна/);else assert.ok((await meta.innerText()).includes(await page.evaluate(dt=>fmtDate(dt),dt)));
    }
    const debt=800-(cancelled?0:a)-second;
    const dbProject=(await db.query('select balance,advance from public.projects where id=$1',[id])).rows[0];
    assert.equal(Number(dbProject.balance),debt);assert.equal(Number(dbProject.advance),1000-debt);
    const debtCard=page.locator('#project-economy .project-metric').filter({hasText:'Долг клиента'}).locator('strong');assert.equal(money(await debtCard.innerText()),debt);
    await page.locator('#pf-cancel').click();await page.locator('.nav-btn[data-view=view-finance]').click();
    const safe=await expectedTile('Сейф'),newRevenue=await report();
    assert.equal(safe,before+(!cancelled&&!archive&&dt>=start?a:0)+second);
    assert.equal(newRevenue,rev+(!cancelled&&!archive&&dt>=start&&dt.slice(0,7)===day.slice(0,7)?a:0)+second);
    rows.push(['UI-0183 / UI-0184',build,title,functionality,'Проекты → '+projectName(i)+' → Деньги → Принять платёж, '+a+' ₽. '+steps.join('. ')+'. '+(cancelled?'Проверить отсутствие записи.':'Сохранить и проверить историю платежей.')+' Открыть Финансы → Ещё → Отчёт за месяц.',
      'Записей '+entries.length+'. Долг по договору 800 → '+debt+' ₽. Сейф '+before+' → '+safe+' ₽. Выручка месяца '+rev+' → '+newRevenue+' ₽.',
      openMs,ms,'Форма '+layout.width+' px без горизонтального выхода. '+(cancelled?'Закрытие доступно.':archive?'Отмечен режим старой оплаты, поле точной даты скрыто.':'Точный день виден и совпадает с записью истории.'),'Chromium '+browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);
    console.log(mode,openMs,ms);
  }
  if(process.env.CARD_TIMING_CSV)fs.writeFileSync(process.env.CARD_TIMING_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
