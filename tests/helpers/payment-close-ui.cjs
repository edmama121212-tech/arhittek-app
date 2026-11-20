'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {installBridge}=require('./card-payment-ui.cjs');
const cases=[
 ['pending','Дождаться отправленной оплаты при попытке уйти','advance','50'],
 ['clean','Посмотреть способы оплаты и вернуться без ввода','advance',''],
 ['keep','Продолжить ввод аванса после отказа потерять черновик','advance','125.50'],
 ['materials','Отложить выдачу бюджета материалов','materials_budget','360'],
 ['history','Отказаться от регистрации архивного поступления','advance','230'],
 ['remaining','Передумать закрывать остаток договора','final_payment','800'],
 ['employee','Отменить подготовленную выплату соисполнителю','fee_payment','40'],
 ['out','Отозвать вывод из бюджета с введённой причиной','withdrawal','75'],
 ['invalid','Выйти после отказа принять платёж будущей датой','advance','100'],
 ['switch','Убрать ошибочно начатый платёж и выбрать другой проект','advance','23'],
 ['wrongType','Передумать после выбора назначения без ввода суммы','fee_payment',''],
 ['uncertain','Закрыть форму после потери подтверждения уже принятой оплаты','advance','35'],
];
const label=i=>'Учебный договор закрытия '+(i+1);
async function prepare(db,uuid){
 await db.query("insert into public.categories(id,name) values($1,'Архитектура')",[uuid(9100)]);
 for(const n of [1,2])await db.query("insert into public.employees(id,name,active) values($1,$2,true)",[uuid(9100+n),'Учебный исполнитель '+n]);
 for(const [i] of cases.entries())await db.query("insert into public.projects(id,name,category_id,price,advance,balance,payment_status,employee_id,co_employee_id,fee_base) values($1,$2,$3,1000,200,800,'Частично оплачен',$4,$5,'profit')",[uuid(9200+i),label(i),uuid(9100),uuid(9101),uuid(9102)]);
}
async function run({page,db,uuid,day,shift,snap,build,browser,expectedTile,twoFrames}){
 await installBridge(page,db);
 const people=[uuid(9101),uuid(9102)],category=uuid(9100);
 await page.evaluate(async ({people,category,projects})=>{
  __db.categories.push({...__db.categories.find(c=>c.id==='arch'),id:category});
  __db.employees.push(...people.map((id,i)=>({id,name:'Учебный исполнитель '+(i+1),role:'Архитектор',active:true})));
  __db.projects=projects;__db.audit_log=[];__db.ledger_entries=[];await loadAll();
 },{people,category,projects:cases.map((_,i)=>({id:uuid(9200+i),name:label(i),category_id:category,status_id:'active',price:1000,advance:200,balance:800,payment_status:'Частично оплачен',employee_id:people[0],co_employee_id:people[1],fee_base:'profit'}))});
 const records=[['ID','Сборка index/finance','Бизнес-сценарий','Шаги','Результат и связанные разделы','Нажатие и ответ до двух кадров, мс','Визуально и удобство','Стенд','Итог']];
 const sheet=page.locator('#paymentSheetOverlay'),x=sheet.locator('#paymentSheetClose'),amount=sheet.locator('#payment-amount'),save=sheet.locator('#payment-save');
 const row=i=>page.locator('#projectsCard .proj-row').filter({has:page.getByText(label(i),{exact:true})});
 const open=async i=>{await row(i).click();await page.locator('#project-tab-money').click();await page.locator('#pf-add-payment').click();await sheet.waitFor();};
 let keep=false,dialogs=[];
 page.on('dialog',async d=>{dialogs.push(d.message());if(keep)await d.dismiss();else await d.accept();});
 for(const [i,[mode,goal,type,value]] of cases.entries()){
  const originalCash=(await snap()).workspace.cash;
  await page.locator('.nav-btn[data-view="view-projects"]').click();await open(i);
  if(type!=='advance')await sheet.locator('[data-value="'+type+'"]').click();
  if(value)await amount.fill(value);
  if(mode==='employee')await sheet.locator('#payment-payee').selectOption(people[1]);
  if(mode==='history')await sheet.locator('#payment-before-start').check();
  if(['out','keep','switch'].includes(mode))await sheet.locator('#payment-note').fill(goal);
  if(mode==='invalid'){
   await sheet.locator('#payment-date').fill(shift(day,1));await save.click();await page.locator('#toast').filter({hasText:/будущ/i}).waitFor();
  }
  if(mode==='pending'){
   await page.evaluate(()=>{const rpc=sb.rpc.bind(sb);sb.rpc=async(n,a)=>{if(n==='record_project_card_payment'){sb.rpc=rpc;await new Promise(resolve=>{window.__releasePayment=resolve;});}return rpc(n,a);};});
   await save.click();await page.waitForFunction(()=>!!window.__releasePayment);
  }
  if(mode==='uncertain'){
   await page.evaluate(()=>{window.__loseCardReceipt=true;});await save.click();
   await page.locator('#toast').filter({hasText:/перед повтором/}).waitFor();await page.waitForFunction(()=>!paymentSaveInFlight);
  }
  const b=await x.boundingBox();assert.ok(b&&b.width>=32&&b.x>=0&&b.x+b.width<=page.viewportSize().width);
  keep=mode==='keep';dialogs=[];const start=performance.now();
  await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
  if(mode==='pending'){
   await twoFrames(page);
   assert.ok(await sheet.isVisible(),'Крестик закрыл уже отправленную оплату до подтверждения');
   assert.equal(dialogs.length,0);
   assert.equal(await save.innerText(),'Сохраняем платёж…');
   if(process.env.PAYMENT_CLOSE_SHOT)await sheet.locator('.sheet').screenshot({path:process.env.PAYMENT_CLOSE_SHOT});
   await page.evaluate(()=>{__releasePayment();delete window.__releasePayment;});
  }
  if(keep){
   await twoFrames(page);
   assert.equal(dialogs.length,1);assert.equal(await amount.inputValue(),value);
   assert.equal(await sheet.locator('#payment-note').inputValue(),goal);
   keep=false;await x.click();
  }
  await sheet.waitFor({state:'hidden'});await twoFrames(page);
  const ms=Math.round(performance.now()-start);
  if(mode==='clean')assert.equal(await page.evaluate(()=>document.activeElement.id),'pf-add-payment');
  if(mode!=='pending')assert.equal(dialogs.length,mode==='clean'?0:mode==='keep'?2:1,mode+' число предупреждений');
  await page.waitForFunction(()=>!paymentSaveInFlight&&!loadAllInFlight);
  const got=mode==='pending'||mode==='uncertain'?Number(value):0;
  const stored=(await db.query('select advance,balance,(select count(*) from public.ledger_entries where project_id=p.id and deleted_at is null) as entries from public.projects p where id=$1',[uuid(9200+i)])).rows[0];
  assert.equal(Number(stored.entries),got?1:0);
  assert.equal(Number(stored.advance),200+got);assert.equal(Number(stored.balance),800-got);
  assert.equal((await snap()).workspace.cash,originalCash+got);
  if(mode==='uncertain'){
   await page.locator('#pf-cancel').click();await row(i).click();await page.locator('#project-tab-money').click();
  }
  assert.equal(Number(await page.locator('#pf-advance').inputValue()),200+got);
  if(mode==='switch'){
   await page.locator('#pf-cancel').click();await open(0);
   assert.equal(await amount.inputValue(),'');assert.equal(await sheet.locator('#payment-note').inputValue(),'');await x.click();
  }
  await page.locator('#pf-cancel').click();await page.locator('.nav-btn[data-view="view-finance"]').click();assert.equal(await expectedTile('Сейф'),originalCash+got);
  const steps={pending:'сохранить → до ответа сервера нажать × → дождаться ответа',clean:'нажать × без ввода',keep:'ввести комментарий → × → продолжить редактирование → × → отказаться от черновика',history:'выбрать получение до начала учёта → ×',employee:'выбрать соисполнителя → ×',out:'ввести причину → ×',invalid:'выбрать завтра → сохранить → после отказа нажать ×',switch:'ввести назначение → × → открыть форму другого договора',uncertain:'сохранить → потерять ответ → × → открыть карточку и платежи'}[mode]||'нажать × и подтвердить отказ от черновика';
  records.push(['UI-0180',build,goal,'Проекты → '+label(i)+' → Деньги → Принять платёж → '+type+' '+value+' → '+steps,
    'Получено '+stored.advance+' ₽, долг '+stored.balance+' ₽, проводок '+stored.entries+'. Сейф '+originalCash+' → '+(originalCash+got)+' ₽.',ms,
    'Крестик '+Math.round(b.width)+'×'+Math.round(b.height)+' px. '+(mode==='pending'?'Форма остаётся открытой до результата.':mode==='clean'?'Возврат без лишнего диалога.':'Проверено предупреждение об уходе.'),browser.version()+' / PGlite / '+new Date().toISOString(),'Пройдено']);
  console.log(mode,ms);
 }
 if(process.env.PAYMENT_CLOSE_CSV)fs.writeFileSync(process.env.PAYMENT_CLOSE_CSV,'\ufeff'+records.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
}
module.exports={prepare,run};
