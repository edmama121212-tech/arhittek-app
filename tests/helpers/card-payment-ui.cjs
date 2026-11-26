'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

const mergedReceipt = process.argv.includes('--merged-receipt');
const cases = mergedReceipt ? [
 ['merged','Аванс с копейками и длинным номером документа в истории проекта и Сейфе',0,173.46,'advance']
] : [
 ['first','Первый аванс по договору',0,150,'advance'],
 ['final','Закрытие остатка заказчиком',750,250,'final_payment'],
 ['materials','Получение целевых денег на материалы',100,245.8,'materials_budget'],
 ['legacy','Оплата до начала учёта с неизвестной датой',0,300,'advance'],
 ['dated','Запоздалый ввод платежа прошлого месяца',0,120,'advance'],
 ['excess','Предоплата сверх стоимости договора',900,150,'advance'],
 ['fee','Выдача гонорара исполнителю',600,45,'fee_payment'],
 ['co','Выдача гонорара соисполнителю',600,30,'fee_payment'],
 ['withdraw','Вывод денег из бюджета объекта с причиной',500,25,'withdrawal'],
 ['reason','Попытка вывода без основания',500,25,'withdrawal'],
 ['fraction','Ввод суммы мельче одной копейки',0,12.125,'advance'],
 ['future','Ввод будущей даты для фактического платежа',0,100,'advance'],
 ['nomoney','Выплата сверх всех денег компании',500,1000000,'fee_payment'],
 ['empty','Оплачиваемый договор без назначенной команды',500,50,'fee_payment'],
 ['changed','Изменение суммы после потери подтверждения',100,45,'advance'],
 ['retry','Повтор после потери ответа сервера',100,40,'advance'],
 ['race','Одновременная регистрация оплаты на другом устройстве',80,50,'advance'],
 ['double','Двойное подтверждение последней копейки',999.99,.01,'final_payment']
];
const status=(received)=>received>=1000?'Оплачен':received>0?'Частично оплачен':'Ждём оплату';
async function prepare(db,id){
 const category=id(7805),people=[id(7801),id(7802)];
 await db.query("insert into public.categories(id,name) values($1,'Архитектура')",[category]);
 for(const [i,employee] of people.entries())await db.query("insert into public.employees(id,name,role) values($1,$2,'Архитектор')",[employee,'Учебный исполнитель '+i]);
 for(const [i,[mode,,advance]] of cases.entries()){
  await db.query("insert into public.projects(id,name,price,advance,balance,payment_status,category_id,employee_id,co_employee_id,fee_base) values($1,$2,1000,$3,$4,$5,$6,$7,$8,'profit')",
   [id(7600+i),'Учебный договор '+(i+1),advance,1000-advance,status(advance),category,mode==='empty'?null:people[0],mode==='empty'?null:people[1]]);
 }
}
async function installBridge(page,db){
 await page.exposeFunction('qaRecordCardPayment',async ({p_entry:entry,p_expected:expected,p_updates:updates})=>{
  try{
   const result=await db.query('select public.record_project_card_payment($1,$2,$3) as id',[entry,expected,updates]);
   const project=(await db.query('select to_jsonb(p) as p from public.projects p where id=$1',[entry.project_id])).rows[0].p;
   const receipt=(await db.query('select to_jsonb(e) as e from public.ledger_entries e where id=$1',[result.rows[0].id])).rows[0].e;
   return {data:receipt.id,project,receipt,error:null};
  }catch(err){if(process.env.CARD_PAYMENT_DEBUG)console.log(err.code,err.message);return {data:null,error:{message:err.message,code:err.code}};}
 });
 await page.evaluate(()=>{
  const original=sb.rpc.bind(sb);
  sb.rpc=async(name,args)=>{
   if(name!=='record_project_card_payment')return original(name,args);
   const r=await qaRecordCardPayment(args);
   if(r.error)return r;
   const target=__db.projects.find(p=>p.id===r.project.id);
   for(const key of Object.keys(args.p_updates))target[key]=r.project[key];
   if(!__db.ledger_entries.some(e=>e.id===r.receipt.id))__db.ledger_entries.push(r.receipt);
   if(window.__loseCardReceipt){window.__loseCardReceipt=false;throw new Error('Ответ сервера потерян');}
   return {data:r.data,error:null};
  };
 });
}
async function run({page,db,uuid,day,shift,snap,build,browser,expectedTile,twoFrames}){
 const rows=[['Элементы','Сборка SHA256 index/finance-workspace','Дата UTC / Chromium','Бизнес-сценарий','Шаги','Факт и последствия','Открытие, мс','Подтверждение до результата, мс','Визуально и удобство','Статус']];
 const totals=[['Элементы','Сборка index/finance','UTC / Chromium','Задача','Шаги','Поля после операции и связанные разделы','Вкладка «Деньги» до двух кадров, мс','Платёж до результата, мс','Вид и удобство','Итог']];
 const people=[uuid(7801),uuid(7802)];
 await installBridge(page,db);
 await page.evaluate(async ({cases,people,category})=>{
  __db.categories.push({...__db.categories.find(c=>c.id==='arch'),id:category});
  __db.employees.push(...people.map((id,i)=>({id,name:i?'Тестовый помощник':'Тестовый архитектор',role:'Архитектор',active:true})));
  __db.projects=cases;__db.audit_log=[];__db.ledger_entries=[];await loadAll();
 },{cases:cases.map(([mode,,advance],i)=>({id:uuid(7600+i),name:'Учебный договор '+(i+1),category_id:uuid(7805),status_id:'active',price:1000,advance,balance:1000-advance,payment_status:status(advance),fee_base:'profit',fee_paid:0,co_fee_paid:0,employee_id:mode==='empty'?null:people[0],co_employee_id:mode==='empty'?null:people[1]})),people,category:uuid(7805)});
 const money=value=>Number(value.replace(/[^\d,-]/g,'').replace(',','.'));
 for(const [i,[mode,task,advance,amount,type]] of cases.entries()){
  const id=uuid(7600+i),name='Учебный договор '+(i+1),before=(await snap()).workspace.cash;
  await page.locator('.nav-btn[data-view="view-projects"]').click();
  const project=page.locator('#projectsCard .proj-row').filter({has:page.getByText(name,{exact:true})});
  await project.click();
  assert.equal(await page.locator('#pf-payment').isVisible(),false,'Статус по оплате вычисляется автоматически');
  const tabStart=performance.now();
  await page.locator('#project-tab-money').click();await twoFrames(page);
  const tabMs=Math.round(performance.now()-tabStart);
  let t=performance.now();
  await page.locator('#pf-add-payment').click();
  const modal=page.locator('#paymentSheetOverlay'),sum=modal.locator('#payment-amount');
  await sum.waitFor();await twoFrames(page);const open=Math.round(performance.now()-t);
  await modal.locator('[data-value="'+type+'"]').click();
  if(mode==='co')await modal.locator('#payment-payee').selectOption(people[1]);
  const date=mode==='dated'?shift(day.slice(0,7)+'-01',-1):mode==='future'?shift(day,1):day;
  await modal.locator('#payment-date').fill(date);
  if(mode==='legacy')await modal.locator('#payment-before-start').check();
  const note=mergedReceipt?'Акт №'+'7314'.repeat(24):mode==='reason'?'':'Учебная операция '+(i+1);
  await modal.locator('#payment-note').fill(note);await sum.fill(String(amount));
  const visual=await modal.locator('.sheet').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));
  assert.ok(visual.width>280&&visual.scroll<=visual.width+1);
  if(mode==='race'){
   await db.query('update public.projects set price=1050,balance=970 where id=$1',[id]);
   await page.evaluate(id=>Object.assign(__db.projects.find(p=>p.id===id),{price:1050,balance:970}),id);
  }
  if(['retry','changed'].includes(mode))await page.evaluate(()=>{window.__loseCardReceipt=true;});
  if(mode==='first'&&process.env.CARD_PAYMENT_SHOT)await modal.locator('.sheet').screenshot({path:process.env.CARD_PAYMENT_SHOT});
  const save=modal.locator('#payment-save');t=performance.now();
  if(mode==='double')await save.dblclick();else await save.click();
  if(['retry','changed'].includes(mode)){
   await page.locator('#toast').filter({hasText:/перед повтором/}).waitFor();
   await page.waitForFunction(()=>!paymentSaveInFlight);
   if(mode==='changed')await sum.fill('50');
   await save.click();
   if(mode==='changed'){
    await page.locator('#toast').filter({hasText:/уже сохранён/}).waitFor();await modal.locator('#paymentSheetClose').click();
    await page.locator('#pf-cancel').click();await project.click();await page.locator('#project-tab-money').click();
   }
  }
  const invalid=['reason','fraction','future','nomoney','empty','race'].includes(mode);
  let message='';
  if(invalid){
   await page.locator('#toast').filter({hasText:/причин|копе|будущ|недостаточ|сотрудника в команде|изменил|обновите/i}).waitFor();
   message=await page.locator('#toast').innerText();assert.equal(await sum.inputValue(),String(amount));
  }else await modal.waitFor({state:'hidden'});
  await page.waitForFunction(()=>!paymentSaveInFlight&&!loadAllInFlight);await twoFrames(page);
  const elapsed=Math.round(performance.now()-t);
  if(invalid)await modal.locator('#paymentSheetClose').click();
  const stored=await page.evaluate(id=>({project:__db.projects.find(p=>p.id===id),entries:__db.ledger_entries.filter(e=>!e.deleted_at&&e.project_id===id)}),id);
  const isReceipt=['advance','final_payment','materials_budget'].includes(type);
  const got=Math.round((advance+(!invalid&&isReceipt?amount:0))*100)/100,debt=Math.max(0,(mode==='race'?1050:1000)-got);
  const actual=(await db.query('select advance,balance,payment_status,fee_paid,co_fee_paid,(select count(*) from public.ledger_entries where project_id=p.id and deleted_at is null) as entries from public.projects p where id=$1',[id])).rows[0];
  assert.equal(Number(actual.entries),invalid?0:1);assert.equal(Number(actual.advance),got);assert.ok(Math.abs(Number(actual.balance)-debt)<1e-7);
  assert.equal(actual.payment_status,status(got));assert.equal(Number(actual.fee_paid),stored.project.fee_paid);assert.equal(Number(actual.co_fee_paid),stored.project.co_fee_paid);
  assert.equal(stored.entries.length,invalid?0:1);assert.equal(stored.project.advance,got);assert.ok(Math.abs(stored.project.balance-debt)<1e-7);
  assert.equal(stored.project.payment_status,status(got),'статус проекта в списке');
  assert.equal(stored.project.fee_paid,mode==='fee'?amount:0);assert.equal(stored.project.co_fee_paid,mode==='co'?amount:0);
  const history=page.locator('#pf-payment-history');if(invalid)await history.getByText('Платежей пока нет').waitFor();else await history.getByText(note,{exact:false}).waitFor();
  if(mergedReceipt){
   assert.equal(stored.entries[0].description,note);
   const bounds=await history.locator('.li-meta').evaluate(el=>({right:el.getBoundingClientRect().right,width:el.clientWidth,scroll:el.scrollWidth}));
   assert.ok(bounds.scroll<=bounds.width+1 && bounds.right<=page.viewportSize().width+1,'Полный номер документа помещается в истории');
  }
  if(mode==='race'){await page.locator('#pf-cancel').click();await project.click();await page.locator('#project-tab-money').click();}
  const summary=page.locator('#project-economy .project-metric').filter({hasText:'Долг клиента'}).locator('strong');assert.ok(Math.abs(money(await summary.innerText())-debt)<1e-7,'долг в открытой карточке');
  const fields=[['pf-advance',got],['pf-balance',debt]];
  for(const [field,value] of fields){
   const input=page.locator('#'+field);
   const label=await input.evaluate(el=>[...el.labels].map(l=>l.textContent.trim()).join(' '));
   assert.match(label,field==='pf-advance'?/Получено/:/Долг клиента/);
   assert.ok(await input.isVisible(),field+' виден на вкладке денег');
   assert.equal(await input.evaluate(el=>el.readOnly),true);
   const shown=await input.inputValue();
   assert.notEqual(shown,'',mode+' / '+field+' · сумма заполнена');
   assert.equal(Number(shown),value,mode+' / '+field);
   const bounds=await input.boundingBox();
   assert.ok(bounds.width>0&&bounds.x>=0&&bounds.x+bounds.width<=page.viewportSize().width+1);
  }
  if(mode==='first'&&process.env.CARD_TOTALS_SHOT)await page.locator('#pf-balance').locator('xpath=ancestor::div[contains(@class,"accent-block")][1]').screenshot({path:process.env.CARD_TOTALS_SHOT});
  await page.locator('#pf-cancel').click();await project.locator('.status-chip').filter({hasText:status(got)}).waitFor();
  await page.locator('.nav-btn[data-view="view-finance"]').click();
  const expected=Math.round((before+(invalid||['legacy','dated'].includes(mode)?0:isReceipt?amount:-amount))*100)/100;
  assert.equal(await expectedTile('Сейф'),expected);assert.equal((await snap()).workspace.cash,expected);
  rows.push(['UI-0221 / UI-0182 / UI-0186',build,new Date().toISOString()+' / '+browser.version(),task,
   'Проекты → '+name+' (цена 1000 ₽, принято '+advance+' ₽) → Деньги → Принять платёж → '+type+' → '+amount+' ₽, '+date+(mode==='co'?' → соисполнитель':'')+(mode==='legacy'?' → до начала учёта':'')+(mode==='race'?' → на другом устройстве изменить цену до 1050 ₽':mode==='changed'?' → потеря ответа → ввести 50 ₽ и повторить → открыть историю':mode==='retry'?' → потеря ответа → повтор с теми же данными':'')+' → '+(mode==='double'?'дважды ':'')+'Сохранить → карточка → список → Финансы',
   'Принято '+got+' ₽, долг '+debt+' ₽, '+status(got)+'. Проводок '+stored.entries.length+'. Сейф '+before+' → '+expected+' ₽. Выплат исполнителю '+stored.project.fee_paid+' ₽, соисполнителю '+stored.project.co_fee_paid+' ₽.'+(message?' Ответ: '+message:''),
   open,elapsed,'Форма '+visual.width+' px без горизонтального переполнения. '+(invalid?'Причина показана, введённая сумма сохранена.':'Долг доступен в открытой карточке и статус в списке.'),'Пройдено']);
  if(mergedReceipt){
   const receiptRow=rows.at(-1);
   receiptRow[0]='Связь UI-0185 / UI-0203 / UI-0204 → Сейф';
   receiptRow[4]+='; в комментарии «'+note+'»';
   receiptRow[8]+=' Номер документа виден в истории целиком и переносится в пределах экрана 390 px.';
   if(process.env.CARD_PAYMENT_CSV)fs.writeFileSync(process.env.CARD_PAYMENT_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
   console.log('Связь карточки и Сейфа',open,elapsed);
   return;
  }
  const paymentRow=rows.at(-1);
  totals.push(['UI-0203 / UI-0204',build,paymentRow[2],task,paymentRow[4]+' → прочитать поля «Получено» и «Долг клиента»',paymentRow[5],tabMs,elapsed,'Оба числовых поля видимы на вкладке, помещаются по ширине и защищены от ручного изменения.','Пройдено']);
  console.log(mode,open,elapsed);
 }
 // The journal's existing reversal updates advance directly, bypassing the card writer.
 const afterLast=await snap(),lastCase=cases.length-1;
 const lastReceipt=(await db.query('select id from public.ledger_entries where project_id=$1',[uuid(7600+lastCase)])).rows[0].id;
 const posting=afterLast.operations.find(o=>o.source_id===lastReceipt);
 assert.ok(posting);
 await db.query('select public.confirm_financial_operation($1,$2,$3,$4)',[
  'reverse',{operation:posting.id,reason:'Отмена последней копейки учебного договора'},uuid(7899),afterLast.revision]);
 const reversed=(await db.query('select advance,balance,payment_status from public.projects where id=$1',[uuid(7600+lastCase)])).rows[0];
 assert.equal(Number(reversed.advance),999.99);assert.equal(Number(reversed.balance),0.01);assert.equal(reversed.payment_status,'Частично оплачен');
 assert.equal(Math.round((afterLast.workspace.cash-(await snap()).workspace.cash)*100),1);
 if(process.env.CARD_TOTALS_CSV)fs.writeFileSync(process.env.CARD_TOTALS_CSV,'\ufeff'+totals.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
 if(process.env.CARD_PAYMENT_CSV)fs.writeFileSync(process.env.CARD_PAYMENT_CSV,'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
}
module.exports={prepare,run,installBridge};
