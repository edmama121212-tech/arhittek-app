'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

module.exports=async({db,page,fw,uuid,day,shift,snap,command,wallet,build,browser,expectedTile,twoFrames})=>{
  const nextMonth=shift(day.slice(0,7)+'-01',0,1);
  const cases=[
    ['partial','Назначить только первую часть оплаты',250,day],
    ['rest','Распределить оставшиеся 750 ₽ вторым этапом',750,nextMonth],
    ['paid','Назначить остаток после частичной оплаты прежнего этапа',600,day],
    ['cancelled','Вернуть отменённую часть в новый график',1000,day],
    ['names','Назначить срок одному из одноимённых проектов',220,day],
    ['cent','Оставить без графика одну копейку',999.99,day],
    ['prior','Внести просроченный этап',280,shift(day,-2)],
    ['date','Исправить забытый срок оплаты',100,day],
    ['over','Исправить превышение долга на копейку',1000,day],
    ['abandon','Закрыть неподтверждённый график без записи',150,day],
    ['confirm','Внести согласованный с заказчиком срок',333.25,nextMonth],
    ['stale','Остановить запись после уменьшения цены договора',800,day]
  ];
  const rows=[['Элемент','Сборка index/finance','UTC','Сценарий','Шаги и данные','Результат и связи','Открытие, мс','Действие до результата, мс','Вид и удобство','Стенд','Итог']];
  const load=async()=>{
    const projects=(await db.query('select * from public.projects')).rows;
    await page.evaluate(async projects=>{__db.projects=projects;await loadAll();},projects);
  };
  const cash=()=>expectedTile('Сейф'),month=()=>expectedTile('Ожидаем до конца месяца');
  const button=id=>fw.locator('[data-fw="project-plan"][data-id="'+id+'"]');
  const dialog=page.getByRole('dialog'),submit=dialog.getByRole('button',{name:'Добавить в план'});
  const calendar=async()=>{await fw.getByRole('button',{name:/Ещё/}).click();await fw.getByRole('button',{name:'Платёжный календарь'}).click();};
  const gap=(s,id)=>s.unscheduled_projects.find(x=>x.id===id)?.remaining||0;
  const cents=n=>Math.round(n*100);
  for(const [i,[mode,task,amount,due]] of cases.entries()){
    const id=uuid(4200+(mode==='rest'?0:i)),oldKey=uuid(4500+i);
    if(mode==='paid'||mode==='cancelled'){
      await command('plan',{label:'Ранее назначенный этап',direction:'income',amount:400,due_date:day,funding:'project:'+id,project_id:id,certainty:'confirmed',reason:'Действующий этап договора'},oldKey);
      if(mode==='paid')await command('pay',{key:oldKey,amount:150,date:day,wallet_id:wallet,reason:'Аванс по договору'},uuid(4600+i));
      else await command('cancel',{id:oldKey,reason:'Заказчик отменил прежний срок'},uuid(4600+i));
    }
    await load();
    const before=await snap(),s=before.workspace,available=gap(s,id);
    assert.equal(available,mode==='rest'?750:mode==='paid'?600:1000);
    const initialCash=await cash(),initialMonth=await month();
    const originalAdvance=(await db.query('select advance from public.projects where id=$1',[id])).rows[0].advance;
    await calendar();
    const start=performance.now();
    await button(id).click();await dialog.waitFor();await twoFrames(page);
    const openMs=Math.round(performance.now()-start);
    const amountField=dialog.locator('[name=amount]'),dateField=dialog.locator('[name=due_date]');
    assert.equal(Number(await amountField.inputValue()),available);
    assert.equal(await dialog.getByRole('combobox',{name:'Проект',exact:true}).count(),0);
    assert.equal(await dialog.locator('strong').innerText(),s.unscheduled_projects.find(x=>x.id===id).name);
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await amountField.fill(String(mode==='over'?1000.01:amount));
    if(mode!=='date')await dateField.fill(due);
    if(mode==='confirm')await dialog.locator('[name=certainty]').selectOption('confirmed');
    let extra='';
    if(mode==='over'||mode==='date'){
      await submit.click();
      const flagged=mode==='date'?dateField:amountField;
      assert.equal(await flagged.evaluate(e=>e.validity.valid),false);
      assert.equal((await snap()).revision,before.revision);
      await amountField.fill(String(amount));await dateField.fill(due);
      extra=mode==='over'?'После отказа заменить 1000,01 на 1000. ':'После отказа ввести пропущенную дату. ';
    }
    if(mode==='stale'){
      await db.query('update public.projects set price=700,balance=500 where id=$1',[id]);
      extra='Пока открыта форма, цена договора снижена с 1200 до 700 ₽. ';
    }
    if(process.env.PROJECT_SCHEDULE_SHOT&&mode==='partial')await dialog.screenshot({path:process.env.PROJECT_SCHEDULE_SHOT});
    const timer=performance.now(),saved=!['abandon','stale'].includes(mode);
    if(mode==='abandon')await dialog.getByRole('button',{name:'Закрыть'}).click();else await submit.click();
    if(mode==='stale')await dialog.getByRole('alert').filter({hasText:/остаток договора/}).waitFor();
    else await dialog.waitFor({state:'hidden'});
    await twoFrames(page);
    const ms=Math.round(performance.now()-timer);
    if(mode==='stale'){await dialog.getByRole('button',{name:'Закрыть'}).click();await load();}
    const after=await snap();
    assert.equal(after.revision,before.revision+Number(saved));
    assert.deepEqual(after.operations,before.operations);
    assert.deepEqual(after.workspace.wallets,s.wallets);
    assert.equal((await db.query('select advance from public.projects where id=$1',[id])).rows[0].advance,originalAdvance);
    const prev=new Set(s.items.map(x=>x.key));
    const added=after.workspace.items.filter(x=>!prev.has(x.key));
    assert.equal(added.length,Number(saved));
    if(saved){
      assert.equal(added[0].amount,amount);assert.equal(added[0].due_date,due);
      assert.equal(added[0].project_id,id);assert.equal(added[0].direction,'income');
      assert.equal(added[0].certainty,mode==='confirm'?'confirmed':'expected');
      assert.ok(await fw.locator('[data-fw="pay"][data-id="'+added[0].key+'"]').isVisible());
    }
    const left=mode==='stale'?500:Math.round((available-(saved?amount:0))*100)/100;
    assert.equal(gap(after.workspace,id),left);
    assert.equal(await button(id).count(),Number(left>0));
    for(const p of s.unscheduled_projects.filter(x=>x.id!==id))assert.equal(gap(after.workspace,p.id),p.remaining);
    await fw.locator('[data-fw-tab=overview]').click();
    assert.equal(await cash(),initialCash);
    assert.equal(cents(await month()),cents(initialMonth)+(saved&&due.slice(0,7)===day.slice(0,7)?cents(amount):0));
    rows.push(['UI-0327',build,new Date().toISOString(),task,'Финансы → Ещё → Платёжный календарь → Указать график. Без графика '+available+' ₽; этап '+amount+' ₽; срок '+due+'. '+extra+(mode==='abandon'?'Закрыть.':'Добавить в план.'),
      'Этапов добавлено '+Number(saved)+', осталось без графика '+left+' ₽. Сейф '+initialCash+' ₽, ожидаем до конца месяца '+await month()+' ₽, фактический аванс '+originalAdvance+' ₽. Соседние проекты сверены.',openMs,ms,'Название проекта, остаток и поля в диалоге видны. На ширине 390 px горизонтального переполнения нет. '+(mode==='stale'?'Пояснение об изменении договора осталось в форме.':mode==='over'||mode==='date'?'Исправление в той же форме.':'Проект подставлен из выбранной строки.'),'PGlite, Chromium '+browser.version(),'Пройдено']);
  }
  if(process.env.PROJECT_SCHEDULE_CSV)fs.writeFileSync(process.env.PROJECT_SCHEDULE_CSV,'\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
  console.log('Project schedule: '+(rows.length-1)+' journeys passed');
};
