'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const cases = [
  ['sameMonth', 'Уточнить день аванса внутри месяца', 'first', 'today'],
  ['monthOut', 'Перенести выручку в предыдущий месяц', 'today', 'previous'],
  ['monthIn', 'Вернуть окончательную оплату в текущий месяц', 'previous', 'today'],
  ['older', 'Отнести оплату к известной дате до старта', 'today', 'old'],
  ['unknownToOld', 'Указать точную дату архивной оплаты', 'unknown', 'old'],
  ['oldToUnknown', 'Убрать ошибочную точную дату старой оплаты', 'old', 'unknown'],
  ['opening', 'Отнести прежнюю оплату к первому дню нового учёта', 'unknown', 'opening'],
  ['same', 'Отклонить повтор уже сохранённой даты', 'today', 'today'],
  ['reason', 'Исправить пропущенное основание без потери ввода', 'previous', 'today'],
  ['future', 'Оставить фактическую оплату при вводе будущей даты', 'today', 'future'],
  ['cancel', 'Отложить изменение периода', 'today', 'previous'],
  ['twins', 'Из двух одинаковых поступлений перенести только оплату второго проекта', 'today', 'previous'],
  ['blank', 'Оставить оплату в учёте при пустой дате', 'previous', 'blank']
];
const cents = x => Math.round(Number(x)*100);
const asAmount = text => Number(text.replace(/[^\d,−-]/g,'').replace('−','-').replace(',','.'));
const seedAmount = i => cases[i][0]==='twins'?118.75:118.75+i;
const name = i => 'Учебный объект '+String(i+1).padStart(2,'0');

exports.prepare = async(db,uuid)=>{
  // Both the previous and current month fall inside this isolated accounting period.
  await db.query("update arhittek_finance.settings set active=true,opening_mode='zero',zero_start_date=(date_trunc('month',clock_timestamp() at time zone 'Europe/Moscow')-interval '2 months')::date,activated_at=(date_trunc('month',clock_timestamp() at time zone 'Europe/Moscow')-interval '2 months') at time zone 'Europe/Moscow' where singleton");
  for(const [i] of cases.entries()){
    await db.query('insert into public.projects(id,name,price,advance,balance) values($1,$2,1500,$3,1500-$3::numeric)',[uuid(9300+i),name(i),seedAmount(i)]);
  }
};

exports.run = async({page,fw,db,snap,uuid,day,shift,build,browser,expectedTile,twoFrames})=>{
  const start=(await snap()).workspace.start_date;
  const dates={first:day.slice(0,7)+'-01',today:day,previous:shift(day.slice(0,7)+'-01',-1),old:shift(start,-1),opening:start,unknown:day,future:shift(day,1),blank:''};
  const scenarios=cases.map(c=>[...c]);
  if(dates.first===day){
    dates.first=shift(dates.previous,-1);
    scenarios[0][3]='previous';
  }
  for(const [i,[,,from]] of scenarios.entries()){
    await db.query('insert into public.ledger_entries(id,project_id,type,amount,entry_date,description,received_before_start) values($1,$2,$3,$4,$5,$6,$7)',[uuid(9350+i),uuid(9300+i),i===2?'final_payment':'advance',seedAmount(i),dates[from],'Учебное поступление '+(i+1),from==='unknown']);
  }
  const receipts=async()=>(await db.query('select id,project_id,type,amount,entry_date::text,description,received_before_start from public.ledger_entries order by id')).rows;
  await page.exposeFunction('qaReceiptRows',receipts);
  const projects=(await db.query('select id,name,price,advance,balance from public.projects order by id')).rows;
  await page.evaluate(async projects=>{
    __db.projects=projects.map(p=>({...p,category_id:'design',status_id:'active'}));
    const actual=sb.rpc.bind(sb);
    sb.rpc=async(name,args)=>{
      const result=await actual(name,args);
      if(name==='confirm_finance_workspace'&&!result.error)__db.ledger_entries=await qaReceiptRows();
      return result;
    };
    __db.ledger_entries=await qaReceiptRows();
    await loadAll();
  },projects);
  const nav=key=>fw.locator('[data-fw-tab="'+key+'"]').click();
  const report=async()=>{
    await nav('more');
    const el=fw.locator('[data-fw-section="month-report"]');
    await el.locator('summary').click();
    return asAmount(await el.locator('.fw-card').filter({has:page.getByText('Выручка',{exact:true})}).locator('strong').innerText());
  };
  const debt=async i=>{
    await nav('forecast');
    const row=fw.locator('article').filter({has:page.getByRole('heading',{name:name(i),exact:true})}).locator('.fw-row').filter({hasText:'Долг клиента'});
    return asAmount(await row.locator('strong,b').innerText());
  };
  const rows=[['Элемент','Сборка index/finance','Задача','Шаги и данные','Фактический результат и связанные разделы','Открытие до двух кадров, мс','До результата, мс','Вид и удобство','Стенд и время UTC','Итог']];
  for(const [i,[mode,title,from,to]] of scenarios.entries()){
    const base=await snap(),before=await receipts(),amount=seedAmount(i),id=uuid(9350+i);
    const safe=await expectedTile('Сейф'),revenue=await report(),balance=await debt(i);
    assert.equal(cents(balance),cents(1500-amount));
    await nav('more');await nav('history');
    const section=fw.locator('[data-fw-section=receipt-corrections]');
    await section.locator('summary').click();
    const opener=section.locator('[data-fw=correct-receipt][data-id="'+id+'"]');
    assert.ok((await opener.locator('..').innerText()).includes(name(i)));
    const t=performance.now();await opener.click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();await twoFrames(page);
    const opened=Math.round(performance.now()-t);
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.doesNotMatch(await dialog.innerText(),/долг клиента уменьшится/i,'Форма обещает повторно уменьшить уже рассчитанный долг клиента');
    assert.ok((await dialog.innerText()).includes(name(i)),'В диалоге не указан выбранный проект');
    const modeField=dialog.locator('[name=mode]'),date=dialog.locator('[name=date]'),reason=dialog.locator('[name=reason]');
    assert.equal(await modeField.inputValue(),from==='unknown'?'before':'date');
    assert.equal(await date.isDisabled(),from==='unknown');
    await modeField.selectOption(to==='unknown'?'before':'date');
    if(to!=='unknown')await date.fill(dates[to]);
    assert.equal(await date.isDisabled(),to==='unknown');
    const oldCounted=from!=='unknown'&&dates[from]>=start,newCounted=to!=='unknown'&&dates[to]>=start;
    const hint=await dialog.locator('[data-fw-receipt-preview]').innerText();
    if(to==='future'||to==='blank')assert.match(hint,/Укажите дату/);
    else if(oldCounted===newCounted)assert.match(hint,/Остаток денег сохранится/);
    else assert.ok(hint.includes(newCounted?'увеличится':'уменьшится'));
    const note='Сверка квитанции '+(i+1);
    const submit=dialog.getByRole('button',{name:'Подтвердить',exact:true});
    if(mode==='reason'){
      await submit.click();await dialog.getByRole('alert').filter({hasText:/основание/}).waitFor();
      assert.equal(await date.inputValue(),dates[to]);assert.equal((await snap()).revision,base.revision);
    }
    await reason.fill(note);
    if(process.env.RECEIPT_DATE_SHOT&&mode==='older')await dialog.screenshot({path:process.env.RECEIPT_DATE_SHOT});
    const timer=performance.now();
    const saved=!['same','future','cancel','blank'].includes(mode);
    if(mode==='cancel')await dialog.getByRole('button',{name:'Закрыть'}).click();
    else await submit.click();
    if(saved||mode==='cancel')await dialog.waitFor({state:'hidden'});
    else if(mode==='future')assert.equal(await date.evaluate(el=>el.validity.rangeOverflow),true);
    else if(mode==='blank'&&await date.evaluate(el=>el.validity.valueMissing))assert.equal(await date.inputValue(),'');
    else await dialog.getByRole('alert').filter({hasText:mode==='same'?/не изменились/:/дату/}).waitFor();
    await twoFrames(page);
    const ms=Math.round(performance.now()-timer);
    if(await dialog.isVisible())await dialog.getByRole('button',{name:'Закрыть'}).click();
    const after=await receipts(),j=await snap(),old=before.find(r=>r.id===id),updated=after.find(r=>r.id===id);
    assert.deepEqual(after.filter(r=>r.id!==id),before.filter(r=>r.id!==id));
    assert.deepEqual(updated,{...old,entry_date:saved&&to!=='unknown'?dates[to]:old.entry_date,received_before_start:saved?to==='unknown':old.received_before_start});
    const counted=r=>!r.received_before_start&&r.entry_date>=start;
    const inMonth=r=>counted(r)&&r.entry_date.slice(0,7)===day.slice(0,7);
    const delta=cents(amount)*(Number(counted(updated))-Number(counted(old)));
    assert.equal(cents(j.workspace.cash)-cents(base.workspace.cash),delta);
    assert.equal(j.revision-base.revision,Number(saved));
    assert.deepEqual(j.workspace.items,base.workspace.items);
    await nav('overview');const finalSafe=await expectedTile('Сейф');assert.equal(cents(finalSafe),cents(safe)+delta);
    const finalRevenue=await report(),finalDebt=await debt(i);
    assert.equal(cents(finalRevenue)-cents(revenue),cents(amount)*(Number(inMonth(updated))-Number(inMonth(old))));
    assert.equal(finalDebt,balance);
    await nav('overview');
    const steps='Финансы → Ещё → История → Исправить дату или учёт оплаты клиента → '+name(i)+' ('+amount+' ₽), исходно '+(from==='unknown'?'дата неизвестна':dates[from])+'. '+(to==='unknown'?'Выбрать «До начала учёта»':'Ввести '+(dates[to]||'пустую дату'))+'. '+(mode==='cancel'?'Закрыть':mode==='reason'?'Подтвердить без причины → вписать «'+note+'» → подтвердить':'Вписать «'+note+'» → подтвердить')+'. Сверить Главную финансов, отчёт за месяц и прогноз по проекту.';
    rows.push(['UI-0332',build,title,steps,'Проводок исправления '+Number(saved)+'. Сейф '+safe+' → '+finalSafe+' ₽. Выручка за месяц '+revenue+' → '+finalRevenue+' ₽. Долг '+finalDebt+' ₽. Сумма, соседние оплаты и календарь сохранены.',opened,ms,'Диалог на 390 px без горизонтального выхода. '+({future:'Будущая дата блокирует подтверждение.',blank:'Пустая дата блокирует подтверждение.',same:'Причина отказа видна в форме.',cancel:'Закрытие возвращает к списку.',reason:'Введённая дата сохранилась после подсказки.'}[mode]||'Проект и сумма позволяют проверить выбор. Режим даты отражает вид оплаты.'),'Chromium '+browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);
    console.log(mode,opened,ms);
  }
  if(process.env.RECEIPT_DATE_CSV)fs.writeFileSync(process.env.RECEIPT_DATE_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
