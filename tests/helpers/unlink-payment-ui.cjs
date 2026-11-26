'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function ({page,fw,db,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames}) {
  const month = day.slice(0,7)+'-01', next = shift(month,0,1);
  const cases = [
    {mode:'twins', label:'Два полностью закрытых заказа', plan:100, source:100, link:100},
    {mode:'partial', label:'Восстановить частично оплаченный расход', plan:800, source:500, link:300},
    {mode:'cent', label:'Исправить распределение одной копейки', plan:12.58, source:10.01, link:0.01},
    {mode:'split', label:'Один чек погасил два плана', plan:420, source:600, link:250},
    {mode:'multi', label:'Один план погашен двумя чеками', plan:400, source:200, link:200},
    {mode:'settled', label:'Оставить прямую оплату из календаря', plan:660, source:300, link:300},
    {mode:'current', label:'Вернуть поступление в ожидания месяца', income:true, plan:330, source:500, link:330},
    {mode:'future', label:'Восстановить поступление следующего месяца', income:true, plan:720, source:700, link:500},
    {mode:'regular', label:'Исправить один период регулярной аренды', plan:1000, source:1000, link:1000},
    {mode:'cancel', label:'Передумать после выбора связи', plan:120, source:120, link:120},
    {mode:'reason', label:'Дополнить основание отмены', plan:320, source:320, link:160},
    {mode:'double', label:'Повторное подтверждение отмены', plan:99, source:99, link:99},
    {mode:'waived', label:'Сохранить ранее отменённый остаток', plan:750, source:200, link:200},
    {mode:'moved', label:'Два периода с одной датой исполнения', plan:300, source:300, link:300}
  ];
  const out = process.env.UNLINK_OUTPUT;
  if(out) fs.mkdirSync(out,{recursive:true});
  const csv = [['Элемент','Сборка SHA256 index/finance','Дата UTC','Бизнес-сценарий','Исходные данные и шаги','Бизнес-результат и связи','Открытие, мс','Подтверждение или закрытие, мс','Визуальная проверка','Удобство','Стенд','Итог']];
  const home = () => fw.locator('[data-fw-tab="overview"]').click();
  const more = async name => {
    await fw.getByRole('button',{name:/Ещё/}).click();
    await fw.getByRole('button',{name,exact:true}).click();
  };
  const details = async name => {
    const el=fw.locator('details[data-fw-section="'+name+'"]');
    if(!await el.evaluate(e=>e.open)) await el.locator('summary').click();
    return el;
  };
  const asMoney = text => Number(text.replace(/[^\d,-]/g,'').replace(',','.'));
  const sum = (a,b) => (Math.round(a*100)+Math.round(b*100))/100;
  const remaining = (j,key) => j.workspace.items.find(x=>x.key===key)?.remaining || 0;
  const capacity = (j,id) => j.workspace.unmatched.find(x=>x.id===id)?.remaining || 0;
  const ordered = (rows,key) => rows.slice().sort((a,b)=>a[key].localeCompare(b[key]));
  for(const [i,c] of cases.entries()) {
    const fixtureId = off => uuid(4000+20*i+off);
    const direction=c.income?'income':'expense', due=c.mode==='future'?next:day;
    const plan = (id,label,amount) => command('plan',{label,direction,due_date:due,amount,funding:'reserve',certainty:'confirmed',reason:'Учебное обязательство'},id);
    const payment = async (id,description,amount) => {
      const table=c.income?'company_income':'company_expenses', date=c.income?'income_date':'expense_date';
      await db.query('insert into public.'+table+'(id,category,description,amount,'+date+') values($1,$2,$3,$4,$5)',[id,'Учебная оплата',description,amount,day]);
      return (await snap()).operations.find(x=>x.source_id===id).id;
    };
    const link = (source,key,amount,id) => command('link',{source,key,amount,reason:'Сверено с актом'},id);
    const label=c.mode==='twins'?'Печать эскизов':c.label;
    let key=fixtureId(0), extra='';
    if(c.mode==='regular'||c.mode==='moved') {
      await command('rule',{label,amount:c.plan,direction,start_month:month,due_day:5,certainty:'confirmed',reason:'Учебный договор'},key);
      key='rule:'+key+':'+next.slice(0,7);
      extra='Выбрать начисление за '+next.slice(0,7)+'. ';
      if(c.mode==='moved') {
        const oldKey='rule:'+fixtureId(0)+':'+month.slice(0,7);
        const sameDate=shift(next,4);
        await command('reschedule',{key:oldKey,due_date:sameDate,reason:'Общий срок аренды'},fixtureId(3));
        const second=await payment(fixtureId(4),'Оплата раннего периода',c.source);
        await link(second,oldKey,c.link,fixtureId(5));
        extra+='Перенести предыдущий период на тот же срок '+sameDate+' и также полностью погасить. ';
      }
    } else await plan(key,label,c.plan);
    const source=await payment(fixtureId(1),'Расчёт за '+label,c.source), chosen=fixtureId(2);
    await link(source,key,c.link,chosen);
    if(c.mode==='twins'||c.mode==='split') {
      await plan(fixtureId(3),'Печать чертежей',100);
      const otherSource=c.mode==='split'?source:await payment(fixtureId(4),'Оплата тиража чертежей',100);
      await link(otherSource,fixtureId(3),100,fixtureId(5));
      extra=c.mode==='split'?'Тем же чеком закрыть второй план на 100 ₽. ':'Создать вторую связь с таким же основанием и суммой 100 ₽ для плана «Печать чертежей». ';
    }
    if(c.mode==='multi') {
      const otherSource=await payment(fixtureId(3),'Второй чек',200);
      await link(otherSource,key,200,fixtureId(4)); extra='Привязать второй чек на 200 ₽ к тому же плану. ';
    }
    if(c.mode==='waived') {
      await command('cancel',{id:key,reason:'Поставщик снял остаток заказа'},fixtureId(3));
      extra='Отменить непогашенный остаток 550 ₽ до исправления связи на 200 ₽. ';
    }
    if(c.mode==='settled') {
      await command('pay',{key,amount:140,date:day,wallet_id:wallet,reason:'Оплата отдельно в календаре'},fixtureId(3));
      extra='В календаре провести дополнительную оплату 140 ₽. ';
    }
    await page.evaluate(()=>loadAll());
    const before=await snap(), cash=await expectedTile('Сейф'), expected=await expectedTile('Ожидаем до конца месяца');
    await more('История операций');
    const section=await details('payment-links');
    let button=section.locator('[data-fw="unlink"][data-id="'+chosen+'"]');
    if(c.mode==='twins') {
      const other=section.locator('[data-fw="unlink"][data-id="'+fixtureId(5)+'"]');
      const cardText = btn => btn.locator('xpath=..').innerText();
      assert.notEqual(await cardText(button),await cardText(other),'Две разные полностью оплаченные работы неразличимы в истории связей');
      assert.ok((await cardText(button)).includes(label),'Нет названия погашенного плана в истории');
      button=section.locator('.fw-row').filter({hasText:label}).getByRole('button',{name:'Отменить связь'});
      assert.equal(await button.count(),1,'Пользователь может выбрать нужное назначение по названию');
    }
    if(c.mode==='moved') {
      const monthLabel=await page.evaluate(date=>new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date)),next);
      button=section.locator('.fw-row').filter({hasText:label}).filter({hasText:monthLabel}).getByRole('button',{name:'Отменить связь'});
      assert.equal(await button.count(),1,'Месяц начисления различает одинаковые сроки оплаты');
      assert.equal(await button.getAttribute('data-id'),chosen);
    }
    const dialog=page.getByRole('dialog');
    let t=performance.now();
    await button.click(); await dialog.waitFor(); await twoFrames(page);
    const open=Math.round(performance.now()-t);
    const context=await dialog.innerText();
    const original=before.operations.find(o=>o.id===source);
    assert.ok(context.includes(label),'Не видно назначения выбранной связи в диалоге отмены');
    assert.ok(context.includes('№'+original.revision),'Нет номера исходной операции');
    assert.ok(context.includes(original.reason),'Не видно основания исходной операции');
    assert.ok(await dialog.evaluate(e=> e.scrollWidth<=e.clientWidth+1 && e.getBoundingClientRect().width <= innerWidth+1));
    const reason=dialog.getByLabel('Основание операции'), submit=dialog.locator('button[type="submit"]');
    if(c.mode==='reason') {
      await submit.click(); await dialog.getByRole('alert').filter({hasText:/основан/i}).waitFor();
      assert.equal((await snap()).revision,before.revision);
    }
    await reason.fill('Уточнение назначения по акту');
    if(out&&c.mode==='twins')await dialog.screenshot({path:path.join(out,'QA_UNLINK_DIALOG.png')});
    t=performance.now();
    if(c.mode==='cancel') await dialog.getByRole('button',{name:'Закрыть'}).click();
    else if(c.mode==='double') await submit.dblclick();
    else await submit.click();
    await dialog.waitFor({state:'hidden'}); await twoFrames(page);
    const finish=Math.round(performance.now()-t);
    const changed=c.mode!=='cancel', delta=changed?c.link:0, after=await snap();
    assert.equal(after.revision-before.revision,Number(changed));
    assert.deepEqual(after.workspace.wallets,before.workspace.wallets);
    assert.deepEqual(after.operations,before.operations);
    assert.deepEqual(ordered(after.workspace.links,'id'),ordered(before.workspace.links.filter(l=>!changed||l.id!==chosen),'id'));
    assert.deepEqual(ordered(after.workspace.items.filter(x=>x.key!==key),'key'),ordered(before.workspace.items.filter(x=>x.key!==key),'key'));
    assert.equal(remaining(after,key),sum(remaining(before,key),delta));
    assert.equal(capacity(after,source),sum(capacity(before,source),delta));
    assert.equal(await fw.locator('[data-fw="unlink"][data-id="'+chosen+'"]').count(),Number(!changed));
    await home(); await more('Платёжный календарь');
    const card=fw.locator('[data-fw="pay"][data-id="'+key+'"]').locator('xpath=ancestor::article');
    if(remaining(after,key)>0) {
      assert.equal(await card.locator('h3').innerText(),label);
      assert.equal(asMoney(await card.locator('.fw-row b').innerText()),remaining(after,key));
    } else assert.equal(await card.count(),0);
    if(capacity(after,source)>0) {
      const unmatched=await details('unmatched');
      const available=unmatched.locator('[data-fw="link"][data-id="'+source+'"]').locator('xpath=..');
      assert.equal(asMoney((await available.locator('span').innerText()).split('·').at(-1)),capacity(after,source));
    }
    await home();
    const expectation=await expectedTile('Ожидаем до конца месяца');
    assert.equal(await expectedTile('Сейф'),cash);
    assert.equal(expectation,sum(expected,c.mode==='current'?delta:0));
    const action={cancel:'Ввести причину и закрыть форму.',double:'Ввести причину и дважды подтвердить.',reason:'Подтвердить без основания, исправить и повторить.'}[c.mode]||'Ввести причину отмены и подтвердить.';
    const steps='План '+c.plan+' ₽, срок '+(['moved','regular'].includes(c.mode)?next.slice(0,7):due)+', '+(c.income?'поступление':'расход')+' '+c.source+' ₽. Привязать '+c.link+' ₽. '+extra+'Ещё → История операций → Связи ранее внесённых оплат → Отменить связь. '+action+' Проверить календарь, нераспределённую часть платежа и Главную.';
    csv.push(['UI-0320',build,new Date().toISOString().slice(0,10),c.label,steps,'Долг плана '+remaining(before,key)+' → '+remaining(after,key)+' ₽, свободная часть оплаты '+capacity(before,source)+' → '+capacity(after,source)+' ₽. Ожидаемые поступления '+expected+' → '+expectation+' ₽. В сейфе '+cash+' ₽. Денежные проводки и остальные связи сохранены.',open,finish,'Название плана видно в диалоге, форма помещается по ширине.',c.mode==='twins'?'Названия различают две одинаковые суммы.':c.mode==='cancel'?'Закрытие сохранило распределение.':c.mode==='reason'?'Форма дождалась основания.':'Выбранная связь исчезла из истории активных связей.','Chromium '+browser.version()+' 390×844, PGlite','Прошло']);
    console.log('PASS unlink',c.mode,open,finish);
  }
  if(out) fs.writeFileSync(path.join(out,'QA_UNLINK_RUNS.csv'),'\ufeff'+csv.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
