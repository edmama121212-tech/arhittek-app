'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function ({page, fw, snap, day, shift, build, browser, expectedTile, twoFrames, errors}) {
  const out = process.env.CREATE_RULE_OUTPUT;
  if (out) fs.mkdirSync(out, {recursive:true});
  const cases = [
    {task:'Исправить 29-е число перед записью', label:'Связь', bad:['due_day','29'], day:28},
    {task:'Запланировать текущую аренду', label:'Аренда офиса', amount:3200},
    {task:'Включить выручку в ожидания месяца', label:'Субаренда', income:true, amount:800},
    {task:'Начать поступления со следующего месяца', label:'Сопровождение', income:true, offset:1},
    {task:'Заключить договор вне горизонта календаря', label:'Лизинг', offset:8},
    {task:'Сохранить малый платёж с точностью до копейки', label:'Лицензия', amount:0.01},
    {task:'Исправить дробный номер дня', label:'Клининг', bad:['due_day','2.5'], day:1},
    {task:'Восстановить очищенный месяц начала', label:'Хостинг', bad:['start_month',''], offset:1},
    {task:'Дополнить однобуквенное название', label:'Обслуживание', bad:['label','А']},
    {task:'Отменить неподписанный договор', label:'Охрана', cancel:true},
    {task:'Повторно подтвердить один договор', label:'Доставка', double:true},
    {task:'Исправить нулевой взнос', label:'Страховка', bad:['amount','0'], amount:250}
  ];
  const csv = [['Элемент','Сборка SHA256 index/finance','Сценарий','Шаги','Результат и связанные разделы','Открытие, мс','Завершение, мс','Внешний вид и удобство','Стенд']];
  const navigate = name => fw.getByRole('button',{name,exact:true}).click();
  const openSection = async name => {await fw.getByRole('button',{name:/Ещё/}).click(); await navigate(name);};
  const month = day.slice(0,7)+'-01';
  for (const [index,c] of cases.entries()) {
    const before = await snap();
    const cash = await expectedTile('Сейф'), income = await expectedTile('Ожидаем до конца месяца');
    const start = shift(month,0,c.offset||0).slice(0,7), amount = c.amount??120, due = c.day||10;
    await openSection('Регулярные платежи');
    const plus = fw.getByRole('button',{name:'+ Регулярный платёж',exact:true});
    const t0 = performance.now();
    if(index%2) await plus.tap();
    else await plus.click();
    const dialog = page.getByRole('dialog',{name:'Регулярный платёж',exact:true});
    await dialog.waitFor();
    await twoFrames(page);
    const openMs = Math.round(performance.now()-t0);
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.ok(await plus.evaluate(el=>el.getBoundingClientRect().height>=44));
    const field = name => dialog.locator('[name="'+name+'"]');
    const values = {label:c.label,amount:String(amount),start_month:start,due_day:String(due)};
    for(const [key,value] of Object.entries(values)) await field(key).fill(value);
    await field('direction').selectOption(c.income?'income':'expense');
    await field('reason').fill('Учебный договор');
    const submit = dialog.getByRole('button',{name:'Подтвердить'});
    if(c.bad) {
      const [key,bad] = c.bad;
      await field(key).fill(bad);
      await submit.click();
      assert.equal(await field(key).evaluate(el=>el===document.activeElement && !el.validity.valid),true,'Поле '+key+' должно подсветиться до отправки');
      assert.equal((await snap()).revision,before.revision);
      await field(key).fill(values[key]);
    }
    if(out && csv.length===1) await dialog.screenshot({path:path.join(out,'rule.png')});
    const t1 = performance.now();
    if(c.cancel) await dialog.getByRole('button',{name:'Закрыть'}).click();
    else if(c.double) await submit.dblclick();
    else await submit.click();
    await dialog.waitFor({state:'hidden'}); await twoFrames(page);
    const finishMs = Math.round(performance.now()-t1);
    const after = await snap();
    assert.equal(after.revision-before.revision,c.cancel?0:1);
    assert.deepEqual(after.workspace.rules.filter(r=>r.label!==c.label),before.workspace.rules);
    const rules = after.workspace.rules.filter(r=>r.label===c.label);
    assert.equal(rules.length,c.cancel?0:1);
    if(!c.cancel) {
      assert.equal(rules[0].start_month,start+'-01');assert.equal(rules[0].amount,amount);
      assert.equal(rules[0].due_day,due);assert.equal(rules[0].direction,c.income?'income':'expense');
    }
    await navigate('Финансы');await openSection('Платёжный календарь');
    const items = after.workspace.items.filter(x=>x.label===c.label);
    const rows = fw.getByRole('heading',{name:c.label,exact:true});
    assert.equal(await rows.count(),items.length);
    if(c.cancel || c.offset===8) assert.equal(items.length,0);
    else {
      assert.ok(items.length>=1);
      assert.ok(items.every(i=>i.remaining===amount && i.due_date.slice(-2)===String(due).padStart(2,'0')));
      assert.equal(items.map(i=>i.due_date).sort()[0],start+'-'+String(due).padStart(2,'0'));
    }
    await navigate('Финансы');
    assert.equal(await expectedTile('Сейф'),cash);
    const expected = income+(c.income&&!c.offset?amount:0);
    assert.equal(await expectedTile('Ожидаем до конца месяца'),expected);
    const steps='Ещё → Регулярные платежи → + Регулярный платёж ('+(index%2?'касание':'мышь')+'). '+c.label+', '+(c.income?'поступление':'расход')+' '+amount+' ₽, с '+start+' по '+due+' числам. '+(c.bad?'Ввести "'+c.bad[1]+'" в '+c.bad[0]+', подтвердить и исправить. ':'')+(c.cancel?'Закрыть':c.double?'Дважды подтвердить':'Подтвердить');
    const result='Новых договоров '+rules.length+', строк в платёжном календаре '+items.length+'; сейф '+cash+' ₽, ожидаемые поступления месяца '+expected+' ₽.';
    csv.push(['UI-0317',build,c.task,steps,result,openMs,finishMs,'Диалог в пределах ширины, кнопка ≥44 px. '+(c.bad?'Фокус переходит на ошибочное поле, можно исправить значение.':c.cancel?'Можно закрыть до записи.':'По подтверждении форма закрывается.'),'Chromium '+browser.version()+' 390×844; PGlite']);
    console.log('PASS',c.task,openMs,finishMs);
  }
  assert.deepEqual(errors,[]);
  if(out) fs.writeFileSync(path.join(out,'QA_CREATE_RULE_RUNS.csv'),'\ufeff'+csv.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
};
