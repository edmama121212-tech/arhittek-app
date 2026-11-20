const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function run({page,fw,db,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames,errors}){
  const out = process.env.HOME_QA_OUTPUT;
  if(out) fs.mkdirSync(out,{recursive:true});
  const csv=[['Элемент','Сборка SHA256 index/finance','Сценарий','Шаги','Фактический результат и связанные разделы','Открытие до двух кадров, мс','Завершение до двух кадров, мс','Визуальная проверка','Удобство','Стенд','Статус']];
  const project=uuid(701), secondWallet=uuid(702);
  const readSources = async () => {
    const result = {};
    for(const table of ['company_income','company_expenses','ledger_entries','projects']){
      result[table]=(await db.query('select * from public.'+table)).rows;
    }
    return result;
  };
  // Serve reads of the same synthetic rows the real SQL function commits.
  await page.exposeFunction('homeQaSources',readSources);
  await page.evaluate(async()=>{
    const rpc=sb.rpc.bind(sb);
    sb.rpc=async(name,args)=>{
      const result=await rpc(name,args);
      if(name==='confirm_finance_workspace' && !result.error) Object.assign(__db,await homeQaSources());
      return result;
    };
    Object.assign(__db,await homeQaSources());
    await loadAll();
  });
  const modes=[
    ['cash','Оплата компании через сейф',2225],
    ['cents','Расчёт с точностью до копейки',119.98],
    ['project','Оплата по выбранному проекту',455],
    ['wallet','Оплата через другое место хранения',323],
    ['memo','Отдельное основание для истории',65],
    ['cancel','Отказ после заполнения по ошибке',700],
    ['zero','Попытка записать нулевую сумму',0],
    ['future','Попытка провести будущую оплату',750],
    ['reason','Исправление слишком короткого назначения',40],
    ['double','Защита от повторного подтверждения',17],
  ];
  const cents=x=>Math.round(Number(x)*100);
  const home=()=>fw.getByRole('button',{name:'Финансы',exact:true}).click();
  const history=async()=>{await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name:'История операций',exact:true}).click();};
  const buttonName='Записать поступление';
  const noExpense=fw.getByRole('button',{name:'Записать расход',exact:true});
  assert.equal(await noExpense.count(),0);
  await fw.getByRole('button',{name:/Ещё/}).click();
  assert.equal(await noExpense.count(),0);
  await home();
    for(const [i,[mode,scenario,amount]] of modes.entries()){
      const title=scenario;
      if(mode==='wallet'){
        await command('wallet',{name:'Банк стенда',kind:'bank',reason:'Второе место хранения'},secondWallet);
        await page.evaluate(()=>loadAll());
      }
      const size=i%2?{width:1280,height:900}:{width:390,height:844};
      await page.setViewportSize(size);
      const opener=fw.getByRole('button',{name:buttonName,exact:true});
      const before=await snap(), sourcesBefore=await readSources();
      const expected=await expectedTile('Ожидаем до конца месяца'),expenses=await expectedTile('Расходы за месяц');
      const cash=await expectedTile('Сейф');
      assert.equal(await fw.locator('.studio-money-grid + .fw-group').getByRole('button').count(),1);
      assert.ok(await fw.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
      assert.ok(await opener.evaluate(e=>e.getBoundingClientRect().height>=44));
      if(out && i<2){
        await fw.screenshot({path:path.join(out,i===0?'mobile.png':'desktop.png')});
      }
      const start=performance.now();
      await opener.click();
      const dialog=page.getByRole('dialog',{name:buttonName});
      await dialog.waitFor();await twoFrames(page);
      const openMs=Math.round(performance.now()-start);
      assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1 && e.querySelector('h2')===document.activeElement));
      const label=dialog.locator('[name=label]'), sum=dialog.locator('[name=amount]'),date=dialog.locator('[name=date]');
      const selected=dialog.locator('[name=wallet_id]');
      assert.equal(await selected.inputValue(),wallet);
      assert.equal(await date.inputValue(),day);
      const name='Выручка'+' · '+title;
      const reason=mode==='memo'?'Договор 107, платёж 4':name;
      await label.fill(mode==='reason'?'АБ':name);
      await sum.fill(String(amount));
      if(mode==='project')await dialog.locator('[name=project_id]').selectOption(project);
      if(mode==='wallet')await selected.selectOption(secondWallet);
      if(mode==='memo'){
        await dialog.locator('summary').click();
        await dialog.getByLabel('Отдельный комментарий для журнала').fill(reason);
      }
      if(mode==='future')await date.fill(shift(day,1));
      const submit=dialog.getByRole('button',{name:'Записать оплату'});
      if(mode==='reason'){
        await submit.click();
        await dialog.getByRole('alert').getByText(/Уточните назначение/).waitFor();
        assert.equal((await snap()).revision,before.revision);
        await label.fill(name);
        assert.equal(await dialog.getByRole('alert').innerText(),'');
      }
      const endStart=performance.now();
      const saved=!['cancel','zero','future'].includes(mode);
      if(mode==='cancel')await dialog.getByRole('button',{name:'Закрыть'}).click();
      else if(mode==='zero' || mode==='future'){
        await submit.click();
        assert.ok(await (mode==='zero'?sum:date).evaluate(e=>!e.validity.valid && e===document.activeElement));
        assert.equal((await snap()).revision,before.revision);
        await page.keyboard.press('Escape');
      }else if(mode==='double'){
        // A rapid second activation arrives before the first RPC finishes.
        await submit.evaluate(button=>{button.click();button.click();});
      }else await submit.click();
      await dialog.waitFor({state:'hidden'});await twoFrames(page);
      const endMs=Math.round(performance.now()-endStart);
      assert.ok(await opener.evaluate(e=>e===document.activeElement));
      const after=await snap(),sources=await readSources();
      const table=mode==='project'?'ledger_entries':'company_income';
      const rows=sources[table].filter(x=>!sourcesBefore[table].some(prev=>prev.id===x.id));
      const delta=saved?cents(amount):0;
      const walletDelta=mode==='wallet'?0:delta;
      assert.equal(cents(await expectedTile('Сейф')),cents(cash)+walletDelta);
      assert.equal(cents(after.workspace.cash),cents(before.workspace.cash)+delta);
      assert.equal(cents(await expectedTile('Ожидаем до конца месяца')),cents(expected));
      assert.equal(cents(await expectedTile('Расходы за месяц')),cents(expenses));
      assert.equal(rows.length,saved?1:0);
      let outcome='Сейф '+cash+' → '+await expectedTile('Сейф')+' ₽. Расходы месяца '+expenses+' → '+await expectedTile('Расходы за месяц')+' ₽. Ожидаемые поступления '+expected+' ₽.';
      if(saved){
        assert.equal(cents(rows[0].amount),cents(amount));
        if(mode==='wallet'){
          const balance=s=>s.workspace.wallets.find(w=>w.id===secondWallet).balance;
          assert.equal(cents(balance(after))-cents(balance(before)),delta);
          outcome+=' Банк стенда '+balance(before)+' → '+balance(after)+' ₽.';
        }
        if(mode==='project'){
          assert.equal(rows[0].project_id,project);
          assert.equal(cents(sources.projects[0].balance),cents(sourcesBefore.projects[0].balance)-delta);
          outcome+=' В журнале проекта одна запись.';
        }
        await history();
        const op=fw.locator('[data-fw-operation]').filter({hasText:reason}).first();
        assert.ok(await op.isVisible());
        assert.equal(cents(await op.getAttribute('data-fw-delta')),delta);
        await home();
        outcome+=' В истории одно подтверждённое движение на '+(delta/100)+' ₽.';
      }else{
        assert.equal(after.revision,before.revision);
        assert.deepEqual(sources,sourcesBefore);
        outcome+=' Записи и ревизия журнала сохранены без изменений.';
      }
      const step={
        cash:'Оставить сейф и сегодняшнюю дату. Подтвердить.',
        cents:'Ввести сумму с копейками. Подтвердить и найти запись в истории.',
        project:'Выбрать «Тестовый павильон» и подтвердить. Сверить журнал проекта.',
        wallet:'Выбрать «Банк стенда», подтвердить и сравнить с сейфом.',
        memo:'Раскрыть реквизиты, указать «Договор 107, платёж 4», подтвердить и открыть историю.',
        cancel:'Нажать «Закрыть» после заполнения.',
        zero:'Ввести ноль и подтвердить. Проверить ошибку суммы. Выйти клавишей Escape.',
        future:'Указать завтрашнюю дату и подтвердить. Проверить ошибку даты. Выйти клавишей Escape.',
        reason:'Ввести «АБ», подтвердить, проверить сообщение, исправить назначение и повторить.',
        double:'Дважды активировать подтверждение до ответа SQL. Проверить число новых записей.',
      }[mode];
      csv.push([buttonName,build,title,'Финансы → '+buttonName+'. '+amount+' ₽. '+step,outcome,openMs,endMs,'Ширина '+size.width+' px. Карточка и диалог без горизонтального переполнения, строка действия ≥44 px.','Один переход с главной, заголовок диалога получает фокус, после закрытия фокус возвращается на выбранное действие.',new Date().toISOString().slice(0,10)+' · Chromium '+browser.version()+' · PGlite в памяти','Прошло']);
      console.log(buttonName,mode,openMs,endMs);
    }
  assert.deepEqual(errors,[]);
  if(out)fs.writeFileSync(path.join(out,'QA_HOME_MONEY_ACTIONS.csv'),'\uFEFF'+csv.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
