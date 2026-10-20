/* Explicit construction contracts: v2 actual cost markup, historical v1 budget fee. Pure calculations only. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.ARHITTEKConstructionFinance=api;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:null,function(){
 'use strict';
 const MAX=BigInt(Number.MAX_SAFE_INTEGER);
 const INCOMING=new Set(['advance','final_payment','income','materials_budget','construction_budget']);
 const OUTGOING=new Set(['expense','project_expense','payment','withdrawal','fee_payment','salary_payment','client_refund']);
 const ACCRUAL=new Set(['role_payout','bonus']);
 const INVOICE_TYPES=new Set(['Материал','Инструмент','Расходник','Доставка','Работа']);
 const MONEY_FIELDS=['received_by_company','cash_outgoing','cash_payments','client_refunds','physical_cash_balance',
  'client_funded_cash_payments','company_fee_funded_cash_payments','unclassified_outgoing','accountable_advances_issued',
  'confirmed_cash_costs','confirmed_client_cash_costs','confirmed_company_fee_cash_costs',
  'client_accountable_advances_issued','company_fee_accountable_advances_issued','client_resources_with_advances',
  'unclassified_accruals','recorded_accruals','direct_client_paid','total_client_funding',
  'invoice_total','invoice_paid_by_company','invoice_paid_by_client','unpaid_invoices','invoice_overpaid',
  'company_fee_total','company_fee_allocated','company_fee_remaining','company_fee_overallocated',
  'client_cash_balance','company_fee_cash_balance','client_after_invoice_commitments','client_available_after_reserved_fee',
  'total_confirmed_cash_costs','client_total_confirmed_cash_costs',
  'gross_confirmed_project_costs','project_cost_credits','known_confirmed_project_costs',
  'confirmed_project_costs','confirmed_company_costs','chargeable_cost_total',
  'invoice_credit_total','invoice_net_total'];
 function issue(list,code,scope,message,rowId,severity='error'){
  list.push({code,scope,severity,message,...(rowId?{row_id:rowId}:{})});
 }
 function toMinor(value){
  if((typeof value!=='number'&&typeof value!=='string')||(typeof value==='number'&&!Number.isFinite(value)))throw new TypeError('Сумма должна быть конечным числом или десятичной строкой');
  const text=String(value).trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new RangeError('Сумма должна быть неотрицательной и содержать не более двух знаков после запятой');
  const [whole,fraction='']=text.split('.'),minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(minor>MAX)throw new RangeError('Сумма превышает точность учета в копейках');
  return Number(minor);
 }
 function fromMinor(value){
  if(value===null)return null;
  if(!Number.isSafeInteger(value))throw new RangeError('Ожидается целое безопасное число копеек');
  return value/100;
 }
 function add(...values){
  let amount=0n;for(const value of values){if(!Number.isSafeInteger(value))throw new RangeError('Некорректная сумма в копейках');amount+=BigInt(value);}
  if(amount>MAX||amount< -MAX)throw new RangeError('Итог превышает точность учета в копейках');
  return Number(amount);
 }
 function percentage(amount,rate){return Number((BigInt(amount)*BigInt(rate)+50n)/100n);}
 function percentageBps(amount,rate){return Number((BigInt(amount)*BigInt(rate)+5000n)/10000n);}
 function dateOnly(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?value:null;
 }
 function timestamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  if(!dateOnly(value.slice(0,10))||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)return null;
  const time=Date.parse(value);return Number.isFinite(time)?time:null;
 }
 function timestampDay(value){
  const time=timestamp(value);if(time===null)return null;
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
 }
 function summary(minor){return Object.fromEntries(Object.entries(minor).map(([key,value])=>[key,value===null?null:fromMinor(value)]));}
 function positive(value,list,scope,id){
  try{const minor=toMinor(value);if(minor===0)throw new RangeError('Сумма операции должна быть больше нуля');return minor;}
  catch(e){issue(list,'INVALID_AMOUNT',scope,e.message,id);return null;}
 }
 function normalizeContract(contract,options={}){
  if(contract?.version===2)return normalizeMarkupContract(contract,options);
  const issues=[],minor={budget_basis_amount:null,works_budget:null,company_fee_total:null,contract_total:null};
  const result={ok:false,version:1,project_id:contract?.project_id||null,currency:'RUB',company_fee_rate:null,
   company_fee_mode:null,company_fee_basis:null,confirmed_at:null,minor,summary:summary(minor),issues};
  if(!contract||typeof contract!=='object'||Array.isArray(contract)){
   issue(issues,'MISSING_CONTRACT','contract','Для расчета гонорара нужен отдельный утвержденный договор');return result;
  }
  if(contract.version!==1)issue(issues,'UNSUPPORTED_CONTRACT_VERSION','contract','Поддерживается только явный договор версии 1');
  if(typeof contract.project_id!=='string'||!contract.project_id.trim()||(options.projectId&&contract.project_id!==options.projectId))issue(issues,'CONTRACT_PROJECT_MISMATCH','contract','Договор должен принадлежать этому объекту');
  if(contract.currency!=='RUB')issue(issues,'UNSUPPORTED_CURRENCY','contract','В этой версии поддерживается только RUB');
  if(contract.company_fee_basis!=='approved_budget')issue(issues,'INVALID_FEE_BASIS','contract','Гонорар рассчитывается от утвержденной базы бюджета');
  if(!['included','on_top'].includes(contract.company_fee_mode))issue(issues,'UNCONFIRMED_FEE_MODE','contract','Укажите, включен ли гонорар в бюджет или начисляется сверху');
  let feeRate=null;try{feeRate=toMinor(contract.company_fee_rate);}catch(e){/* Invalid rates stay unconfirmed. */}
  if(feeRate!==1500)issue(issues,'UNSUPPORTED_FEE_RATE','contract','Для новой модели должен быть явно утвержден гонорар 15%');
  const confirmedDay=timestampDay(contract.confirmed_at);
  if(!confirmedDay||!String(contract.confirmed_by||'').trim())issue(issues,'UNCONFIRMED_CONTRACT','contract','Условия должны иметь дату и автора подтверждения');
  if(options.asOf&&!dateOnly(options.asOf))issue(issues,'INVALID_AS_OF','contract','Укажите корректную дату расчета YYYY-MM-DD');
  if(confirmedDay&&options.asOf&&confirmedDay>options.asOf)issue(issues,'FUTURE_CONTRACT','contract','На дату расчета договор еще не подтвержден');
  let budget=null;try{budget=toMinor(contract.budget_basis_amount);}catch(e){issue(issues,'INVALID_BUDGET','contract',e.message);}
  if(contract.revision!==undefined&&(!Number.isSafeInteger(contract.revision)||contract.revision<1))issue(issues,'INVALID_CONTRACT_REVISION','contract','Номер редакции договора должен быть положительным целым');
  if(issues.length)return result;
  try{
   const fee=percentage(budget,15),included=contract.company_fee_mode==='included';
   Object.assign(minor,{budget_basis_amount:budget,company_fee_total:fee,works_budget:included?add(budget,-fee):budget,contract_total:included?budget:add(budget,fee)});
   return {...result,ok:true,project_id:contract.project_id,company_fee_rate:15,company_fee_mode:contract.company_fee_mode,
    company_fee_basis:'approved_budget',confirmed_at:contract.confirmed_at,revision:contract.revision||1,summary:summary(minor)};
  }catch(e){issue(issues,'MONEY_OVERFLOW','contract',e.message);return result;}
 }
 function normalizeMarkupContract(contract,options={}){
  const issues=[],minor={budget_basis_amount:null,works_budget:null,company_fee_total:null,contract_total:null,
   confirmed_project_costs:null,chargeable_cost_total:null};
  const result={ok:false,version:2,project_id:contract?.project_id||null,currency:'RUB',company_fee_rate:null,
   company_fee_mode:null,company_fee_basis:null,confirmed_at:null,minor,summary:summary(minor),issues};
  if(typeof contract.project_id!=='string'||!contract.project_id.trim()||(options.projectId&&contract.project_id!==options.projectId))issue(issues,'CONTRACT_PROJECT_MISMATCH','contract','Договор должен принадлежать этому объекту');
  if(contract.currency!=='RUB')issue(issues,'UNSUPPORTED_CURRENCY','contract','В этой версии поддерживается только RUB');
  if(contract.company_fee_basis!=='actual_cost_markup')issue(issues,'INVALID_FEE_BASIS','contract','Новая наценка рассчитывается только от подтвержденных фактических расходов объекта');
  if(contract.company_fee_mode!=='on_top')issue(issues,'UNCONFIRMED_FEE_MODE','contract','Открытая наценка должна быть явно согласована сверх расходов');
  let rate=null;try{rate=toMinor(contract.company_fee_rate);}catch(e){/* No inferred rate. */}
  if(rate===null||rate>10000)issue(issues,'UNSUPPORTED_FEE_RATE','contract','Нужна явно сохраненная ставка от 0 до 100% с точностью до двух знаков; для новых объектов 15%');
  const confirmedDay=timestampDay(contract.confirmed_at);
  if(!confirmedDay||!String(contract.confirmed_by||'').trim())issue(issues,'UNCONFIRMED_CONTRACT','contract','Условия должны иметь дату и автора подтверждения');
  if(options.asOf&&!dateOnly(options.asOf))issue(issues,'INVALID_AS_OF','contract','Укажите корректную дату расчета YYYY-MM-DD');
  if(confirmedDay&&options.asOf&&confirmedDay>options.asOf)issue(issues,'FUTURE_CONTRACT','contract','На дату расчета договор еще не подтвержден');
  if(contract.revision!==undefined&&(!Number.isSafeInteger(contract.revision)||contract.revision<1))issue(issues,'INVALID_CONTRACT_REVISION','contract','Номер редакции договора должен быть положительным целым');
  if(issues.length)return result;
  return {...result,ok:true,company_fee_rate:fromMinor(rate),company_fee_mode:'on_top',company_fee_basis:'actual_cost_markup',
   confirmed_at:contract.confirmed_at,revision:contract.revision||1};
 }
 function invoiceId(row){
  const marker=(String(row.description||'').match(/\[invoice-payment:([^\]]+)\]/)||[])[1]||null;
  return row.invoice_id||marker;
 }
 function importedExpense(row){return row.type==='project_expense'&&(row.description==='Ранее внесённые расходы'||String(row.description||'').startsWith('[cash:historical-expense]'));}
 function inputRows(value,list,scope,required=false){
  if(value===undefined){if(required)issue(list,'MISSING_ROWS',scope,'Не загружен обязательный список записей');return [];}
  if(!Array.isArray(value)){issue(list,'INVALID_ROWS',scope,'Ожидается массив записей');return [];}
  return value;
 }
 function scopedRows(rows,projectId,asOf,list,scope,dateField){
  const seen=new Map(),out=[];
  for(const row of rows){
   if(!row||typeof row!=='object'||row.deleted_at||row.project_id!==projectId)continue;
   const id=typeof row.id==='string'&&row.id.trim()?row.id:null;
   if(!id){issue(list,'MISSING_ROW_ID',scope,'У операции должен быть постоянный ID');continue;}
   const date=dateOnly(row[dateField]);
   if(!date){issue(list,'INVALID_OPERATION_DATE',scope,'У операции должна быть корректная календарная дата',id);continue;}
   if(date>asOf)continue;
   if(row.currency!==undefined&&row.currency!=='RUB'){issue(list,'UNSUPPORTED_ROW_CURRENCY',scope,'Нельзя складывать операции разных валют без подтвержденного пересчета',id);continue;}
   const key=JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])));
   if(seen.has(id)){
    issue(list,seen.get(id)===key?'DUPLICATE_ROW':'CONFLICTING_DUPLICATE_ROW',scope,
     seen.get(id)===key?'Повтор одного ID учтен один раз':'Один ID содержит противоречащие значения',id,seen.get(id)===key?'warning':'error');continue;
   }
   seen.set(id,key);out.push({...row});
  }
  return out;
 }
 function collect(input={},options={}){
  const issues=[],projectId=input.projectId,asOf=dateOnly(input.asOf);
  const minor=Object.fromEntries(MONEY_FIELDS.map(key=>[key,0]));
  const invalid=typeof projectId!=='string'||!projectId.trim()||!asOf;
  if(typeof projectId!=='string'||!projectId.trim())issue(issues,'MISSING_PROJECT_ID','input','Укажите объект расчета');
  if(!asOf)issue(issues,'INVALID_AS_OF','input','Укажите корректную дату расчета YYYY-MM-DD');
  if(invalid)return {issues,minor:Object.fromEntries(MONEY_FIELDS.map(key=>[key,null])),rows:[],invoices:[],invoiceIndex:new Map(),cashOk:false,classificationOk:false,invoicesOk:false,projectId,asOf};
  const allInvoices=inputRows(input.invoices,issues,'invoices',!!options.requireInvoices),allLedger=inputRows(input.ledger,issues,'cash',true);
  const invoices=scopedRows(allInvoices,projectId,asOf,issues,'invoices','invoice_date'),invoiceIndex=new Map();
  for(const invoice of invoices){
   const amount=positive(invoice.amount,issues,'invoices',invoice.id);if(amount===null)continue;
   if(invoice.paid_by_client!==undefined&&invoice.paid_by_client!==false&&invoice.paid_by_client!==true){issue(issues,'INVALID_DIRECT_PAID_FLAG','invoices','Прямая оплата должна быть логическим значением',invoice.id);continue;}
   if(!INVOICE_TYPES.has(invoice.item_type))issue(issues,'UNKNOWN_INVOICE_TYPE','invoices','Стоимость документа учтена в отдельной статье; тип требует уточнения',invoice.id,'warning');
   const item={id:invoice.id,project_id:projectId,item_type:invoice.item_type||'Прочее',amount,companyPaid:0,directPaid:invoice.paid_by_client?amount:0,legacyDirect:!!invoice.paid_by_client,paymentIds:[],directPaymentIds:[],sourceRow:invoice};
   invoiceIndex.set(invoice.id,item);minor.invoice_total=add(minor.invoice_total,amount);
  }
  const rows=scopedRows(allLedger,projectId,asOf,issues,'cash','entry_date');
  for(const row of rows){
   if(!INCOMING.has(row.type)&&!OUTGOING.has(row.type)&&!ACCRUAL.has(row.type)){issue(issues,'UNSUPPORTED_LEDGER_TYPE','cash','Неизвестный тип проводки нельзя считать подтвержденным денежным движением',row.id);continue;}
   const amount=positive(row.amount,issues,ACCRUAL.has(row.type)?'commitments':'cash',row.id);if(amount===null)continue;
   if(importedExpense(row)){issue(issues,'IMPORTED_COST_NOT_PAYMENT','classification','Перенос старых расходов не подтверждает новую оплату',row.id,'warning');continue;}
   if(ACCRUAL.has(row.type)){
    minor.recorded_accruals=add(minor.recorded_accruals,amount);
    minor.unclassified_accruals=add(minor.unclassified_accruals,amount);
    issue(issues,'ACCRUAL_REQUIRES_SEPARATE_SETTLEMENT','commitments','Начисление не является оплатой; связь с накладной и погашением долга должна быть подтверждена отдельно',row.id,'warning');continue;
   }
   if(INCOMING.has(row.type)){minor.received_by_company=add(minor.received_by_company,amount);continue;}
   minor.cash_outgoing=add(minor.cash_outgoing,amount);
   const refund=row.type==='client_refund'||row.purpose==='client_refund';
   if(refund){
    minor.client_refunds=add(minor.client_refunds,amount);
    if(row.funding_source&&row.funding_source!=='client')issue(issues,'INVALID_REFUND_SOURCE','classification','Возврат клиенту должен относиться к клиентскому фонду',row.id);
    continue;
   }
   minor.cash_payments=add(minor.cash_payments,amount);
   const team=!!row.payee_employee_id||['fee_payment','salary_payment'].includes(row.type),handover=row.purpose==='cash_handover';
   let funding=row.funding_source;
   if(!funding&&!team&&row.type!=='withdrawal')funding='client';
   if(row.purpose==='company_fee_expense'&&funding!=='company_fee'){
    minor.unclassified_outgoing=add(minor.unclassified_outgoing,amount);
    issue(issues,'FUNDING_PURPOSE_MISMATCH','classification','Расход компании должен явно относиться к ее выделенному гонорару',row.id);
   }else if(funding!=='client'&&funding!=='company_fee'){
    minor.unclassified_outgoing=add(minor.unclassified_outgoing,amount);
    issue(issues,'UNCLASSIFIED_OUTGOING','classification','Укажите источник выплаты: клиентский фонд или уже выделенный гонорар компании',row.id);
   }else if(row.type==='withdrawal'&&!['cash_handover','project_expense','company_fee_expense'].includes(row.purpose)){
    minor.unclassified_outgoing=add(minor.unclassified_outgoing,amount);
    issue(issues,'UNCLASSIFIED_WITHDRAWAL','classification','Укажите назначение: подотчет, конечный расход или расход компании',row.id);
   }else{
    const key=funding==='client'?'client_funded_cash_payments':'company_fee_funded_cash_payments';minor[key]=add(minor[key],amount);
    if(handover){minor.accountable_advances_issued=add(minor.accountable_advances_issued,amount);const key=funding==='client'?'client_accountable_advances_issued':'company_fee_accountable_advances_issued';minor[key]=add(minor[key],amount);}
    else{minor.confirmed_cash_costs=add(minor.confirmed_cash_costs,amount);const key=funding==='client'?'confirmed_client_cash_costs':'confirmed_company_fee_cash_costs';minor[key]=add(minor[key],amount);}
   }
   const linked=invoiceId(row);
   if(linked){
    const marker=(String(row.description||'').match(/\[invoice-payment:([^\]]+)\]/)||[])[1];
    if(row.invoice_id&&marker&&row.invoice_id!==marker){issue(issues,'CONFLICTING_INVOICE_LINK','invoices','Поле и маркер оплаты ссылаются на разные накладные',row.id);continue;}
    const item=invoiceIndex.get(linked);
    if(!item){issue(issues,'INVOICE_LINK_OUTSIDE_PROJECT','invoices','Оплата ссылается на отсутствующий, будущий или чужой документ',row.id);continue;}
    if(handover){issue(issues,'CASH_HANDOVER_IS_NOT_INVOICE_PAYMENT','invoices','Выдача подотчета не подтверждает оплату накладной',row.id);continue;}
    if(item.legacyDirect){issue(issues,'COMPANY_PAYMENT_ON_CLIENT_PAID_INVOICE','invoices','Накладная отмечена как оплаченная напрямую, но содержит оплату компании',row.id);}
    item.companyPaid=add(item.companyPaid,amount);item.paymentIds.push(row.id);
   }
  }
  // Foreign project operations can never close this object's document.
  for(const row of allLedger){
   if(!row||row.deleted_at||row.project_id===projectId||!OUTGOING.has(row.type))continue;
   const linked=invoiceId(row);if(linked&&invoiceIndex.has(linked))issue(issues,'FOREIGN_PROJECT_INVOICE_PAYMENT','invoices','Платеж другого объекта не учитывается в оплате этой накладной',row.id,'warning');
  }
  const directRows=scopedRows(inputRows(input.directPayments,issues,'direct'),projectId,asOf,issues,'direct','entry_date');
  for(const row of directRows){
   const amount=positive(row.amount,issues,'direct',row.id);if(amount===null)continue;
   const confirmedDay=timestampDay(row.confirmed_at);
   if(!confirmedDay||confirmedDay>asOf){issue(issues,'UNCONFIRMED_DIRECT_PAYMENT','direct','Прямая оплата должна быть подтверждена на дату расчета',row.id);continue;}
   minor.direct_client_paid=add(minor.direct_client_paid,amount);
   const item=invoiceIndex.get(row.invoice_id);
   if(!item){issue(issues,'UNLINKED_DIRECT_PAYMENT','invoices','Прямая оплата не закрыла накладную: нужна связь с документом этого объекта',row.id);continue;}
   if(item.legacyDirect){issue(issues,'DUPLICATE_DIRECT_PAYMENT_SOURCE','direct','Полная отметка прямой оплаты и отдельные прямые платежи не должны дублировать друг друга',row.id);continue;}
   item.directPaid=add(item.directPaid,amount);item.directPaymentIds.push(row.id);
  }
  for(const item of invoiceIndex.values()){
   if(item.legacyDirect)minor.direct_client_paid=add(minor.direct_client_paid,item.directPaid);
   minor.invoice_paid_by_company=add(minor.invoice_paid_by_company,item.companyPaid);
   minor.invoice_paid_by_client=add(minor.invoice_paid_by_client,item.directPaid);
   item.unpaid=Math.max(0,add(item.amount,-item.companyPaid,-item.directPaid));
   item.overpaid=Math.max(0,add(item.companyPaid,item.directPaid,-item.amount));
   minor.unpaid_invoices=add(minor.unpaid_invoices,item.unpaid);minor.invoice_overpaid=add(minor.invoice_overpaid,item.overpaid);
   if(item.overpaid)issue(issues,'INVOICE_OVERPAID','invoices','Подтвержденные платежи превышают стоимость документа',item.id,'warning');
  }
  minor.physical_cash_balance=add(minor.received_by_company,-minor.cash_outgoing);
  minor.total_client_funding=add(minor.received_by_company,minor.direct_client_paid);
  minor.total_confirmed_cash_costs=add(minor.confirmed_cash_costs,minor.direct_client_paid);
  minor.client_total_confirmed_cash_costs=add(minor.confirmed_client_cash_costs,minor.direct_client_paid);
  if(minor.accountable_advances_issued)issue(issues,'UNSETTLED_ACCOUNTABLE_ADVANCE','commitments','Выданный подотчет не погашен: для подтверждения остатка нужны принятые чеки или возврат','', 'warning');
  const cashOk=!issues.some(i=>i.severity==='error'&&['input','cash'].includes(i.scope));
  const classificationOk=cashOk&&!issues.some(i=>i.severity==='error'&&i.scope==='classification');
  const invoicesOk=!issues.some(i=>i.severity==='error'&&['invoices','direct'].includes(i.scope));
  if(!classificationOk)for(const key of ['client_funded_cash_payments','company_fee_funded_cash_payments','confirmed_client_cash_costs','confirmed_company_fee_cash_costs','client_accountable_advances_issued','company_fee_accountable_advances_issued','client_total_confirmed_cash_costs'])minor[key]=null;
  if(!cashOk)for(const key of ['received_by_company','cash_outgoing','cash_payments','client_refunds','physical_cash_balance','client_funded_cash_payments','company_fee_funded_cash_payments','unclassified_outgoing','accountable_advances_issued','confirmed_cash_costs','confirmed_client_cash_costs','confirmed_company_fee_cash_costs','client_accountable_advances_issued','company_fee_accountable_advances_issued','total_client_funding','total_confirmed_cash_costs','client_total_confirmed_cash_costs'])minor[key]=null;
  if(!invoicesOk)for(const key of ['invoice_total','invoice_paid_by_company','invoice_paid_by_client','unpaid_invoices','invoice_overpaid','direct_client_paid','total_client_funding','total_confirmed_cash_costs','client_total_confirmed_cash_costs'])minor[key]=null;
  minor.invoice_net_total=minor.invoice_total;
  return {issues,minor,rows,invoices:[...invoiceIndex.values()],invoiceIndex,cashOk,classificationOk,invoicesOk,projectId,asOf};
 }
 function calculateMarkupCosts(input,base){
  const issues=base.issues,scope='costs',factMap=new Map(),sourceMap=new Map(),ledgerMap=new Map(base.rows.map(row=>[row.id,row]));
  const result={ok:false,gross:0,credits:0,knownNet:0,net:null,companyCosts:0,facts:[],creditsByInvoice:new Map()};
  if(input.costFactsComplete!==true)issue(issues,'COST_FACTS_INCOMPLETE',scope,'Полнота подтвержденных фактических расходов объекта еще не согласована');
  const facts=scopedRows(inputRows(input.costFacts,issues,scope,true),input.projectId,base.asOf,issues,scope,'entry_date');
  for(const fact of facts){
   const amount=positive(fact.amount,issues,scope,fact.id),confirmedDay=timestampDay(fact.confirmed_at);
   if(amount===null)continue;
   if(!confirmedDay||confirmedDay>base.asOf||confirmedDay<fact.entry_date||!String(fact.confirmed_by||'').trim()){
    issue(issues,'UNCONFIRMED_COST_FACT',scope,'Фактический расход должен быть подтвержден на дату расчета',fact.id);continue;
   }
   if(!['project','company_fee'].includes(fact.cost_scope)){issue(issues,'UNCONFIRMED_COST_SCOPE',scope,'Уточните, относится расход к объекту клиента или к внутренним расходам компании',fact.id);continue;}
   const sourceType=fact.source_type,sourceId=fact.source_id,key=sourceType+':'+sourceId;
   let source=null,sourceAmount=null;
   if(sourceType==='invoice'){
    const item=base.invoiceIndex.get(sourceId);source=item?.sourceRow||null;sourceAmount=item?.amount??null;
   }else if(sourceType==='ledger'){
    source=ledgerMap.get(sourceId)||null;
    if(source){
     if(issues.some(item=>item.severity==='error'&&item.scope==='cash'&&item.row_id===sourceId)){
      issue(issues,'INVALID_COST_SOURCE',scope,'Исходная расходная проводка содержит противоречащие или некорректные значения',fact.id);continue;
     }
     const refund=source.type==='client_refund'||source.purpose==='client_refund';
     const handover=source.purpose==='cash_handover';
     if(!OUTGOING.has(source.type)||refund||handover||importedExpense(source)){
      issue(issues,'NON_COST_LEDGER_SOURCE',scope,'Аванс, возврат клиенту, подотчет и начисление не подтверждают конечный расход',fact.id);continue;
     }
     if(source.type==='withdrawal'&&!['project_expense','company_fee_expense'].includes(source.purpose)){
      issue(issues,'COST_SOURCE_CLASSIFICATION_REQUIRED',scope,'Неопределенный вывод нельзя включить в базу наценки',fact.id);continue;
     }
     if(invoiceId(source)){
      issue(issues,'INVOICE_PAYMENT_IS_NOT_SECOND_COST',scope,'Оплата накладной не является вторым расходом: подтвердите саму накладную',fact.id);continue;
     }
     if((source.payee_employee_id||['fee_payment','salary_payment'].includes(source.type))&&!['client','company_fee'].includes(source.funding_source)){
      issue(issues,'COST_SOURCE_CLASSIFICATION_REQUIRED',scope,'Выплату команде нельзя наценять без подтвержденного источника и назначения',fact.id);continue;
     }
     try{sourceAmount=toMinor(source.amount);}catch(e){issue(issues,'INVALID_COST_SOURCE_AMOUNT',scope,e.message,fact.id);continue;}
    }
   }else{issue(issues,'UNSUPPORTED_COST_SOURCE',scope,'Факт должен ссылаться на накладную или отдельную фактическую расходную проводку',fact.id);continue;}
   if(!source){issue(issues,'COST_SOURCE_OUTSIDE_PROJECT',scope,'Источник расхода отсутствует, удален, относится к другой дате или объекту',fact.id);continue;}
   if(amount!==sourceAmount){issue(issues,'COST_SOURCE_AMOUNT_MISMATCH',scope,'Подтвержденный факт должен совпадать с суммой исходного документа; корректировки вносятся отдельным кредитом',fact.id);continue;}
   if(sourceMap.has(key)){issue(issues,'DUPLICATE_COST_SOURCE',scope,'Один исходный расход нельзя повторно включить в базу с другим ID факта',fact.id);continue;}
   if(source.funding_source==='company_fee'&&fact.cost_scope==='project'){
    issue(issues,'COMPANY_FEE_COST_NOT_MARKUP_BASE',scope,'Внутренний расход из гонорара компании нельзя наценять повторно',fact.id);continue;
   }
   if(source.cost_scope&&source.cost_scope!==fact.cost_scope){issue(issues,'COST_SCOPE_MISMATCH',scope,'Подтвержденный факт противоречит назначению исходного документа',fact.id);continue;}
   const item={id:fact.id,sourceType,sourceId,scope:fact.cost_scope,amount,credit:0,entryDate:fact.entry_date};
   factMap.set(fact.id,item);sourceMap.set(key,item);result.facts.push(item);
   if(item.scope==='project')result.gross=add(result.gross,amount);else result.companyCosts=add(result.companyCosts,amount);
  }
  // Every current cost document needs explicit confirmation or explicit exclusion.
  for(const item of base.invoiceIndex.values())if(!sourceMap.has('invoice:'+item.id))issue(issues,'UNCONFIRMED_COST_SOURCE',scope,'Назначение и факт расхода по накладной еще не подтверждены',item.id);
  for(const row of base.rows){
   if(!OUTGOING.has(row.type)||row.type==='client_refund'||row.purpose==='client_refund'||row.purpose==='cash_handover'||importedExpense(row))continue;
   if(row.funding_source==='company_fee')continue;
   const linked=invoiceId(row);
   if(linked){if(!base.invoiceIndex.has(linked))issue(issues,'COST_SOURCE_OUTSIDE_PROJECT',scope,'Оплата ссылается на неподтвержденный документ другого объекта',row.id);continue;}
   if(!sourceMap.has('ledger:'+row.id))issue(issues,'UNCONFIRMED_COST_SOURCE',scope,'Фактический расход еще не подтвержден для расчета наценки',row.id);
  }
  const credits=scopedRows(inputRows(input.costCredits,issues,scope,true),input.projectId,base.asOf,issues,scope,'entry_date');
  for(const credit of credits){
   const amount=positive(credit.amount,issues,scope,credit.id),confirmedDay=timestampDay(credit.confirmed_at),fact=factMap.get(credit.cost_fact_id);
   if(amount===null)continue;
   if(!confirmedDay||confirmedDay>base.asOf||confirmedDay<credit.entry_date||!String(credit.confirmed_by||'').trim()){
    issue(issues,'UNCONFIRMED_COST_CREDIT',scope,'Уменьшение расхода должно быть подтверждено на дату расчета',credit.id);continue;
   }
   if(!fact||credit.entry_date<fact.entryDate){issue(issues,'CREDIT_SOURCE_OUTSIDE_PROJECT',scope,'Корректировка должна ссылаться на ранее подтвержденный расход этого объекта',credit.id);continue;}
   if(add(fact.credit,amount)>fact.amount){issue(issues,'COST_CREDIT_EXCEEDS_SOURCE',scope,'Уменьшение не может превышать оставшуюся стоимость исходного расхода',credit.id);continue;}
   fact.credit=add(fact.credit,amount);
   if(fact.scope==='project')result.credits=add(result.credits,amount);else result.companyCosts=add(result.companyCosts,-amount);
   if(fact.sourceType==='invoice')result.creditsByInvoice.set(fact.sourceId,add(result.creditsByInvoice.get(fact.sourceId)||0,amount));
  }
  result.knownNet=add(result.gross,-result.credits);
  const costError=issues.some(item=>item.severity==='error'&&item.scope===scope);
  // Invalid source lists cannot establish a complete cost base either.
  result.ok=!costError&&base.invoicesOk&&!issues.some(item=>item.severity==='error'&&(item.scope==='input'||(item.scope==='cash'&&['MISSING_ROWS','INVALID_ROWS'].includes(item.code))));
  result.net=result.ok?result.knownNet:null;
  return result;
 }
 function applyInvoiceCredits(base,costs){
  if(!costs.ok)return;
  let total=0,unpaid=0,overpaid=0;
  for(const item of base.invoiceIndex.values()){
   item.credit=costs.creditsByInvoice.get(item.id)||0;item.netAmount=add(item.amount,-item.credit);
   item.unpaid=Math.max(0,add(item.netAmount,-item.companyPaid,-item.directPaid));
   item.overpaid=Math.max(0,add(item.companyPaid,item.directPaid,-item.netAmount));
   total=add(total,item.credit);unpaid=add(unpaid,item.unpaid);overpaid=add(overpaid,item.overpaid);
   if(item.credit&&item.overpaid)issue(base.issues,'CREDIT_REFUND_NOT_YET_RECEIVED','invoices','Кредит уменьшил стоимость, но сам по себе не вернул деньги: нужен реальный возврат или подтвержденный зачет',item.id,'warning');
  }
  base.minor.invoice_credit_total=total;base.minor.invoice_net_total=add(base.minor.invoice_total,-total);
  base.minor.unpaid_invoices=unpaid;base.minor.invoice_overpaid=overpaid;
 }
 function report(base,extra={}){
  return {version:1,project_id:base.projectId,as_of:base.asOf,basis:'recorded_cash_operations',bank_reconciled:false,
   cash_ok:base.cashOk,classification_ok:base.classificationOk,invoices_ok:base.invoicesOk,
   minor:base.minor,summary:summary(base.minor),issues:base.issues,
   invoices:base.invoices.map(item=>({id:item.id,project_id:item.project_id,item_type:item.item_type,
    minor:{amount:item.amount,credit:item.credit||0,net_amount:item.netAmount??item.amount,company_paid:item.companyPaid,direct_paid:item.directPaid,unpaid:item.unpaid,overpaid:item.overpaid},
    summary:summary({amount:item.amount,credit:item.credit||0,net_amount:item.netAmount??item.amount,company_paid:item.companyPaid,direct_paid:item.directPaid,unpaid:item.unpaid,overpaid:item.overpaid}),
    payment_ids:item.paymentIds.slice(),direct_payment_ids:item.directPaymentIds.slice()})),...extra};
 }
 function guarded(input,fn,options={}){
  try{return fn(collect(input,options));}
  catch(e){
   const issues=[];issue(issues,e instanceof RangeError?'MONEY_OVERFLOW':'INVALID_INPUT','input',e.message);
   return report({projectId:input?.projectId||null,asOf:dateOnly(input?.asOf),cashOk:false,classificationOk:false,invoicesOk:false,
    minor:Object.fromEntries(MONEY_FIELDS.map(k=>[k,null])),issues,invoices:[]},{ok:false,contract_ok:false});
  }
 }
 function cashSummary(input={}){
  return guarded(input,base=>{
   for(const key of ['company_fee_total','company_fee_allocated','company_fee_remaining','company_fee_overallocated','client_cash_balance','company_fee_cash_balance','client_resources_with_advances','client_after_invoice_commitments','client_available_after_reserved_fee','gross_confirmed_project_costs','project_cost_credits','known_confirmed_project_costs','confirmed_project_costs','confirmed_company_costs','chargeable_cost_total'])base.minor[key]=null;
   return report(base,{ok:base.cashOk,contract_ok:false});
  });
 }
 function evaluate(input={}){
  return guarded(input,base=>{
   const contract=normalizeContract(input.contract,{projectId:input.projectId,asOf:input.asOf});
   base.issues.push(...contract.issues);
   const markup=contract.version===2,costs=markup?calculateMarkupCosts(input,base):null;
   for(const key of ['gross_confirmed_project_costs','project_cost_credits','known_confirmed_project_costs','confirmed_project_costs','confirmed_company_costs','chargeable_cost_total'])base.minor[key]=null;
   if(costs){
    Object.assign(base.minor,{gross_confirmed_project_costs:costs.gross,project_cost_credits:costs.credits,
     known_confirmed_project_costs:costs.knownNet,confirmed_project_costs:costs.net,confirmed_company_costs:costs.companyCosts});
    if(contract.ok&&costs.ok){
     const fee=percentageBps(costs.net,toMinor(contract.company_fee_rate)),chargeable=add(costs.net,fee);
     Object.assign(contract.minor,{confirmed_project_costs:costs.net,company_fee_total:fee,chargeable_cost_total:chargeable});
     contract.summary=summary(contract.minor);base.minor.chargeable_cost_total=chargeable;
    }
    applyInvoiceCredits(base,costs);
   }
   const allocationRows=scopedRows(inputRows(input.allocations,base.issues,'allocation',true),input.projectId,base.asOf,base.issues,'allocation','entry_date');
   let allocated=0;
   for(const row of allocationRows){
    const amount=positive(row.amount,base.issues,'allocation',row.id),confirmedDay=timestampDay(row.confirmed_at);
    if(amount===null)continue;
    if(!confirmedDay||confirmedDay>base.asOf||!String(row.confirmed_by||'').trim()){issue(base.issues,'UNCONFIRMED_FEE_ALLOCATION','allocation','Выделение гонорара должно иметь автора и подтверждение на дату расчета',row.id);continue;}
    allocated=add(allocated,amount);
   }
   const allocationsOk=!base.issues.some(i=>i.severity==='error'&&i.scope==='allocation');
   const m=base.minor,feeTotal=contract.ok?contract.minor.company_fee_total:null;
   m.company_fee_total=feeTotal;m.company_fee_allocated=allocationsOk?allocated:null;
   m.company_fee_remaining=feeTotal!==null&&allocationsOk?Math.max(0,add(feeTotal,-allocated)):null;
   m.company_fee_overallocated=feeTotal!==null&&allocationsOk?Math.max(0,add(allocated,-feeTotal)):null;
   if(m.company_fee_overallocated)issue(base.issues,'FEE_OVERALLOCATED','allocation','Выделенный гонорар превышает утвержденную сумму');
   if(allocated&&!contract.ok)issue(base.issues,'FEE_ALLOCATION_WITHOUT_CONFIRMED_CONTRACT','allocation','Нельзя подтвердить распределение гонорара без утвержденного договора');
   if(markup&&allocated&&feeTotal===null)issue(base.issues,'FEE_ALLOCATION_WITHOUT_CONFIRMED_COSTS','allocation','Нельзя подтвердить выделение наценки без согласованной базы фактических расходов');
   const splitOk=base.classificationOk&&allocationsOk&&(!allocated||(contract.ok&&(!markup||costs.ok)))&&!m.company_fee_overallocated;
   m.client_cash_balance=splitOk?add(m.received_by_company,-m.client_funded_cash_payments,-m.client_refunds,-allocated):null;
   m.company_fee_cash_balance=splitOk?add(allocated,-m.company_fee_funded_cash_payments):null;
   m.client_resources_with_advances=splitOk?add(m.client_cash_balance,m.client_accountable_advances_issued):null;
   if(m.company_fee_cash_balance!==null&&m.company_fee_cash_balance<0)issue(base.issues,'COMPANY_FEE_CASH_DEFICIT','allocation','Из средств компании выплачено больше, чем выделено ей из этого объекта','', 'warning');
   const commitmentsComplete=base.invoicesOk&&m.unclassified_accruals===0&&m.accountable_advances_issued===0&&!base.issues.some(i=>i.severity==='error'&&i.scope==='commitments');
   m.client_after_invoice_commitments=splitOk&&commitmentsComplete?add(m.client_cash_balance,-m.unpaid_invoices):null;
   m.client_available_after_reserved_fee=m.client_after_invoice_commitments!==null&&feeTotal!==null?add(m.client_after_invoice_commitments,-m.company_fee_remaining):null;
   const conservation=splitOk?{physical_cash_minor:m.physical_cash_balance,classified_cash_minor:add(m.client_cash_balance,m.company_fee_cash_balance),difference_minor:add(m.physical_cash_balance,-m.client_cash_balance,-m.company_fee_cash_balance)}:null;
   return report(base,{version:markup?2:1,ok:contract.ok&&(!markup||costs.ok)&&base.cashOk&&base.invoicesOk&&splitOk&&commitmentsComplete,
    contract_ok:contract.ok,allocation_ok:allocationsOk&&!m.company_fee_overallocated&&(!allocated||(contract.ok&&(!markup||costs.ok))),
    costs_ok:markup?costs.ok:null,cost_facts_complete:markup?costs.ok:null,
    commitments_complete:commitmentsComplete,contract,conservation});
  },{requireInvoices:true});
 }
 return Object.freeze({version:2,toMinor,fromMinor,normalizeContract,cashSummary,evaluate,
  incomingTypes:Object.freeze([...INCOMING]),outgoingTypes:Object.freeze([...OUTGOING]),accrualTypes:Object.freeze([...ACCRUAL])});
});
