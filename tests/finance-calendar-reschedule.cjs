'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const uuid = n => '46000000-0000-4000-8000-' + String(n).padStart(12, '0');
const token = 'finance-calendar-offline-' + 'a'.repeat(48);
const qa = process.env.CALENDAR_QA_OUTPUT;
const shift = (day, days, months = 0) => {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const amountFrom = text => Number(text.replace(/[^\d,−-]/g, '').replace('−','-').replace(',','.'));
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
const twoFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

(async () => {
  const cancelPlan = process.argv.includes('--cancel-plan');
  const paymentLinks = process.argv.includes('--payment-links');
  const unlinkPayments = process.argv.includes('--unlink-payments');
  const stopRule = process.argv.includes('--stop-rule');
  const createRule = process.argv.includes('--create-rule');
  const recurring = process.argv.includes('--recurring');
  const homeActions = process.argv.includes('--home-actions');
  const cashFloor = process.argv.includes('--cash-floor');
  const dedicated = cancelPlan || paymentLinks || unlinkPayments || stopRule || createRule || recurring || homeActions || cashFloor;
  const db = new PGlite();
  await db.waitReady;
  const browser = await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || undefined, args:['--no-sandbox']});
  try {
    await db.exec(read('tests/fixtures/session-security-baseline.sql'));
    await db.query("insert into public.employees(id,name,role,is_admin) values($1,'Мансур','Генеральный директор',true)", [uuid(1)]);
    await db.query("insert into public.employee_sessions(employee_id,token,expires_at) values($1,$2,now()+interval '1 day')", [uuid(1), token]);
    for (const file of ['supabase/install-owner-access.sql', 'supabase/financial-journal.sql',
      ...fs.readdirSync(path.join(root, 'supabase/migrations')).filter(name => /^20261030|^20261031|^20261101|employee_salary_history\.sql$|finance_(?:payment_integrity|link_details)\.sql$|recurring_(?:replacement|stop)\.sql$|finance_spending_limits\.sql$/.test(name)).sort().map(name => 'supabase/migrations/' + name)]) {
      await db.exec(read(file));
    }
    if(homeActions){
      await db.query("insert into public.projects(id,name,price,balance) values($1,'Тестовый павильон',10000,10000)",[uuid(701)]);
    }
    await db.exec('set role anon');
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({'x-session-token':token,'x-finance-client':'1'})]);
    const snap = async () => (await db.query('select public.get_financial_journal() as j')).rows[0].j;
    const command = async (name, payload, operation, revision) => (await db.query('select public.confirm_finance_workspace($1,$2,$3,$4) as j',
      [name,payload,operation,revision ?? (await snap()).revision])).rows[0].j;
    const initial = await snap(), day = initial.workspace.as_of;
    const month = day.slice(0,7) + '-01', nextMonth = shift(month,0,1);
    const wallet = initial.workspace.wallets.find(w => w.is_default).id;
    await command('record',{label:'Тестовый сейф',direction:'income',amount:50000,date:day,wallet_id:wallet,funding:'reserve',certainty:'confirmed',reason:'Начальные тестовые деньги'},uuid(2));
    const cases = [
      ['Погасить просрочку переносом', 'Аренда мастерской', 'expense', shift(day,-2), shift(day,2)],
      ['Назначить первый срок', 'Печать образцов', 'expense', null, day],
      ['Включить поступление в текущий месяц', 'Первый аванс', 'income', nextMonth, day],
      ['Убрать из ожиданий месяца', 'Второй аванс', 'income', day, nextMonth],
      ['Снять неподтверждённый срок', 'Поставка материалов', 'expense', day, null],
      ['Перенести только неоплаченный остаток', 'Частично оплаченное оборудование', 'expense', day, shift(day,5)],
      ['Выбрать нужный платёж среди одноимённых', 'Этап проектирования', 'expense', day, shift(day,4)],
      ['Перенести один месяц регулярного расхода', 'Связь офиса', 'expense', month.slice(0,7)+'-10', shift(day,6)],
      ['Отказаться от переноса после ввода', 'Выезд на объект', 'expense', day, shift(day,7)],
      ['Исправить пустое основание и повторить', 'Авторский надзор', 'income', null, day],
    ];
    const plan = (label, direction, due_date, amount) => ({label, direction, due_date, amount, funding:'reserve', certainty:'confirmed',reason:'Изолированное обязательство'});
    const idFor = i => i === 7 ? 'rule:'+uuid(27)+':'+month.slice(0,7) : uuid(20+i);
    for (const [i,[,label,direction,from]] of (dedicated ? [] : cases).entries()) {
      if(i===7) await command('rule',{label,direction,amount:1007,due_day:10,start_month:month,certainty:'confirmed',reason:'Тестовое регулярное обязательство'},uuid(27));
      else await command('plan',plan(label,direction,from,1000+i),uuid(20+i));
    }
    if(!dedicated) await command('plan',plan(cases[6][1],'expense',day,2000),uuid(50));
    if(!dedicated) await command('pay',{key:idFor(5),amount:407.75,wallet_id:wallet,date:day,reason:'Часть суммы уже оплачена'},uuid(51));

    const ctx = await browser.newContext({hasTouch:createRule||stopRule||paymentLinks||unlinkPayments||cancelPlan,locale:'ru-RU',viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
    await ctx.addInitScript({path:path.join(__dirname,'mock.js')});
    const servedHashes = {};
    await ctx.route('**/*',route=>{
      const url = new URL(route.request().url());
      const file = url.hostname === 'app.test' ? path.join(root,url.pathname === '/' ? 'index.html' : url.pathname.slice(1)) : null;
      if (!file || !fs.existsSync(file)) return route.fulfill({body:'',contentType:'text/javascript'});
      if (['index.html','finance-workspace.js'].includes(path.basename(file))){
        const body = fs.readFileSync(file);
        servedHashes[path.basename(file)] = crypto.createHash('sha256').update(body).digest('hex').slice(0,12);
        return route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':'text/html'});
      }
      return route.fulfill({path:file});
    });
    const page = await ctx.newPage(), errors = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.exposeFunction('qaCalendarRpc',async(name,args)=>{
      try {
        const data = name === 'get_financial_journal' ? await snap() :
          await command(args.p_command,args.p_payload,args.p_operation,args.p_revision);
        return {data,error:null};
      } catch(error) { return {error:{message:error.message,code:error.code},data:null}; }
    });
    await page.goto('https://app.test/');
    await page.waitForFunction(()=>state.financialDataReady && !loadAllInFlight);
    await page.evaluate(async()=>{
      const previous = sb.rpc.bind(sb);
      sb.rpc = (name,args) => ['get_financial_journal','confirm_finance_workspace'].includes(name) ? qaCalendarRpc(name,args) : previous(name,args);
      await loadAll();
    });
    assert.ok(servedHashes['index.html'] && servedHashes['finance-workspace.js']);
    const build = servedHashes['index.html']+'/'+servedHashes['finance-workspace.js'];
    const fw = page.locator('#financeWorkspace');
    const calendar = async () => {
      await fw.getByRole('button',{name:/Ещё/}).click();
      await fw.getByRole('button',{name:'Платёжный календарь'}).click();
    };
    const digitsOf = s => s.replace(/\s/g,'');
    const expectedTile = async (label) => amountFrom(await fw.locator('.studio-money-grid article').filter({has:page.getByText(label,{exact:true})}).locator('strong').innerText());
    const csv = [['Элемент','Сборка SHA256 index/finance-workspace','Дата UTC','Браузер','Задача','Данные','Шаги','Результат и связи','Открытие до 2 кадров, мс','Завершение до 2 кадров, мс','Визуальная проверка','Удобство','Статус']];
    if(qa) fs.mkdirSync(qa,{recursive:true});
    await page.locator('.nav-btn[data-view="view-finance"]').click();
    if(cancelPlan){
      await require('./helpers/cancel-plan-ui.cjs')({page,fw,db,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames,errors});
      assert.deepEqual(errors,[]);
      return;
    }
    if(paymentLinks || unlinkPayments){
      const test = paymentLinks ? './helpers/link-payment-ui.cjs' : './helpers/unlink-payment-ui.cjs';
      await require(test)({page,fw,db,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames,errors});
      assert.deepEqual(errors,[]);
      return;
    }
    if(stopRule){
      await require('./helpers/stop-rule-ui.cjs')({page,fw,db,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames});
      assert.deepEqual(errors,[]);
      return;
    }
    if(createRule){
      await require('./helpers/create-rule-ui.cjs')({page,fw,snap,day,shift,build,browser,expectedTile,twoFrames,errors});
      return;
    }
    if(cashFloor){
      await require('./helpers/cash-floor-ui.cjs')({page,fw,db,command,snap,day,wallet,uuid,build,browser,expectedTile,twoFrames,errors});
      return;
    }
    if(homeActions){
      await require('./helpers/home-money-actions.cjs')({page,fw,db,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames,errors});
      return;
    }
    if(recurring){
      await require('./helpers/recurring-replacement.cjs')({page,fw,command,snap,day,wallet,uuid,shift,build,browser,expectedTile,twoFrames,errors});
      return;
    }
    for (const [i,[task,label,direction,from,to]] of cases.entries()){
      const before = await snap(), id = idFor(i), original = before.workspace.items.find(x=>x.key===id);
      assert.equal(original.due_date,from);
      const cash = await expectedTile('Сейф'), expected = await expectedTile('Ожидаем до конца месяца');
      await calendar();
      const opener = fw.locator('[data-fw="reschedule"][data-id="'+id+'"]');
      const card = opener.locator('xpath=ancestor::article');
      assert.equal(await card.locator('h3').innerText(),label);
      await opener.scrollIntoViewIfNeeded();
      const start = performance.now();
      await opener.click();
      const dialog = page.getByRole('dialog');
      const input = dialog.getByLabel('Новая дата');
      await input.waitFor(); await twoFrames(page);
      assert.equal(await page.locator('#toast.show').count(),0);
      const openMs = Math.round(performance.now()-start);
      assert.equal(await input.inputValue(),from||'');
      const dialogContent = digitsOf(await dialog.innerText());
      assert.ok(dialogContent.includes(digitsOf(label)) && dialogContent.includes(original.remaining.toFixed(2).replace('.',',')), 'Контекст переноса: название и остаток выбранного обязательства');
      assert.ok(await dialog.locator('h2').evaluate(e=>document.activeElement===e));
      assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
      await input.fill(to||'');
      const reason = 'Уточнение графика '+String(i+1);
      const confirm = dialog.getByRole('button',{name:'Подтвердить'});
      if(i===9){
        await confirm.click();
        assert.match(await dialog.getByRole('alert').innerText(),/Укажите основание/);
        assert.equal(await input.inputValue(),to);
        assert.equal((await snap()).revision,before.revision);
      }
      await dialog.getByLabel('Основание операции').fill(reason);
      assert.equal(await dialog.getByRole('alert').innerText(),'');
      if(qa) await dialog.screenshot({path:path.join(qa,'case-'+(i+1)+'-form.png')});
      const endStart = performance.now();
      if(i===8) await page.keyboard.press('Escape');
      else await confirm.click();
      await dialog.waitFor({state:'hidden'}); await twoFrames(page);
      const saveMs = Math.round(performance.now()-endStart);
      const after = await snap();
      assert.equal(after.revision,before.revision+(i===8?0:1));
      const finalDate = i===8?from:to;
      const updated = after.workspace.items.find(x=>x.key===id);
      assert.equal(updated.due_date,finalDate);
      assert.equal(updated.remaining,original.remaining);
      assert.deepEqual(after.workspace.items.filter(x=>x.key!==id).sort((a,b)=>a.key.localeCompare(b.key)),before.workspace.items.filter(x=>x.key!==id).sort((a,b)=>a.key.localeCompare(b.key)));
      assert.equal(after.workspace.cash,before.workspace.cash);
      const dateText = finalDate ? await page.evaluate(d=>fmtDate(d), finalDate) : 'Без срока';
      assert.ok((await card.innerText()).includes(dateText));
      assert.equal((await card.innerText()).includes('просрочено'),!!finalDate && finalDate<day);
      assert.ok(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
      assert.ok(await opener.evaluate(e=>e===document.activeElement));
      if(qa) await card.screenshot({path:path.join(qa,'case-'+(i+1)+'-card.png')});
      await fw.getByRole('button',{name:'Финансы',exact:true}).click();
      const homeAmount = await expectedTile('Ожидаем до конца месяца');
      const inMonth = date => Number(!!date && date.startsWith(month.slice(0,7)));
      const delta = direction==='income' ? original.remaining*(inMonth(finalDate)-inMonth(from)) : 0;
      assert.equal(homeAmount,expected+delta);
      assert.equal(await expectedTile('Сейф'),cash);
      const steps = 'Финансы → Ещё → Платёжный календарь → '+label+' ('+original.remaining+' ₽) → Перенести срок → '+(to||'очистить дату')+' → '+(i===9?'Подтвердить без причины → исправить основание → Подтвердить':i===8?'ввести причину → Escape':'ввести причину → Подтвердить')+' → Финансы';
      const ux = 'В форме видны выбранная запись и остаток. После закрытия фокус на её кнопке.'+(i===9?' Причина запрошена, введённая дата сохранена.':'');
      csv.push(['FW-CALENDAR-RESCHEDULE',build,new Date().toISOString().slice(0,10),
        'Chromium '+browser.version()+' · 390×844 · PGlite в памяти',task,'До: '+(from||'без срока')+', сумма '+original.remaining,steps,
        'Срок '+(finalDate||'без срока')+'; остаток '+updated.remaining+'; соседние обязательства без изменений; ожидаем за месяц '+expected+' → '+homeAmount+'; сейф '+cash+' ₽',
        openMs,saveMs,'Форма и карточка без горизонтального переполнения; проверены дата и пометка просрочки.',ux,'Прошло']);
      console.log(i+1,task,openMs,saveMs);
    }
    assert.deepEqual(errors,[]);
    if(qa) fs.writeFileSync(path.join(qa,'QA_FINANCE_CALENDAR_RUNS.csv'), '\uFEFF'+csv.map(r=>r.map(quote).join(',')).join('\n')+'\n');
  } finally {await browser.close(); await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
