// ===== ARHITTEK PAYROLL & OBLIGATIONS V1 =====
(()=>{
'use strict';
if(window.__arhittekPayrollObligationsInstalled) return;
window.__arhittekPayrollObligationsInstalled=true;

const $=id=>document.getElementById(id);
const LEGACY_PAID_FN = typeof isTimesheetPaid==='function' ? isTimesheetPaid : (()=>false);
let editingSalaryPaymentId=null;
let salarySheetEmployeeId=null;
let salarySheetMonth=null;
let salarySaveInFlight=false;

function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function monthLabel(key){
  try{return ruMonthLabel(key);}catch(e){return key||'';}
}
function monthRange(key){
  return timesheetMonthRange(key);
}
function payrollDueForEmployee(employeeId,month){
  const range=monthRange(month);
  const earned=completedProjectEarningsForRange(range.from,range.to).employees;
  const split=splitPayrollByEmployee(earned).result;
  return Math.max(0,num(split[employeeId]?.payout));
}
function salaryPaymentMonth(row){
  const m=String(row?.description||'').match(/\[salary:(\d{4}-\d{2})\]/);
  return m?m[1]:null;
}
function salaryPaymentNote(row){
  return String(row?.description||'').replace(/^\[salary:\d{4}-\d{2}\]\s*/,'').trim();
}
function salaryPaymentRows(employeeId,month){
  return (state.ledger||[])
    .filter(x=>!x.deleted_at&&x.type==='salary_payment'&&x.payee_employee_id===employeeId&&salaryPaymentMonth(x)===month)
    .sort((a,b)=>String(b.entry_date||'').localeCompare(String(a.entry_date||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
}
function salaryDueDay(){
  return Math.min(28,Math.max(1,parseInt(localStorage.getItem('finance_salary_due_day')||'10',10)||10));
}
function officeDueDay(kind){
  const def=kind==='rent'?5:10;
  return Math.min(28,Math.max(1,parseInt(localStorage.getItem('finance_'+kind+'_due_day')||String(def),10)||def));
}
function salaryDueDate(month){
  const p=month.split('-').map(Number),d=new Date(Date.UTC(p[0],p[1],salaryDueDay(),12));
  return financeLocalDate(d);
}
function officeDueDate(month,kind){
  const p=month.split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1,officeDueDay(kind),12));
  return financeLocalDate(d);
}
function financeLocalDate(d){
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
function todayISO(){return financeLocalDate(new Date());}
function salaryPaymentState(employeeId,month,dueOverride){
  const due=dueOverride==null?payrollDueForEmployee(employeeId,month):Math.max(0,num(dueOverride));
  const rows=salaryPaymentRows(employeeId,month);
  const projectFeeRows=(state.ledger||[]).filter(x=>!x.deleted_at&&x.type==='fee_payment'&&x.entry_date<=todayISO()&&
    (()=>{const p=getFinancialProjects().find(p=>p.id===x.project_id);if(!p||(x.payee_employee_id||p.employee_id)!==employeeId)return false;
      return projectEmployeeRole(employeeId)==='manager' ? String(x.entry_date||'').slice(0,7)===month :
        findStatus(p.status_id)?.name==='Завершён'&&timesheetProjectRefDate(p)?.slice(0,7)===month;})());
  const actualPaid=rows.filter(x=>x.entry_date&&x.entry_date<=todayISO()).reduce((s,x)=>s+num(x.amount),0)+projectFeeRows.reduce((sum,x)=>sum+num(x.amount),0);
  const legacyMarked=!rows.length&&!projectFeeRows.length&&LEGACY_PAID_FN(employeeId,month);
  const paid=Math.max(0,Math.round((legacyMarked?due:actualPaid)*100)/100);
  const remaining=Math.max(0,due-paid);
  const dueDate=salaryDueDate(month);
  const overdue=remaining>0.009&&todayISO()>dueDate;
  return {due,paid,actualPaid,legacyMarked,overpaid:Math.max(0,paid-due),remaining,dueDate,overdue,rows,full:due>0&&remaining<=0.009};
}
window.salaryPaymentState=salaryPaymentState;
window.payrollDueForEmployee=payrollDueForEmployee;

async function syncLegacySalaryFlag(employeeId,month){
  const st=salaryPaymentState(employeeId,month);
  const existing=(state.timesheetPayments||[]).find(x=>x.employee_id===employeeId&&x.month===month);
  const payload={paid:st.full,paid_at:st.full?new Date().toISOString():null};
  if(existing){
    const r=await sb.from('timesheet_payments').update(payload).eq('id',existing.id);
    if(r.error)throw r.error;
    Object.assign(existing,payload);
  }else if(st.full){
    const r=await sb.from('timesheet_payments').insert({employee_id:employeeId,month:month,paid:true,paid_at:payload.paid_at}).select().single();
    if(r.error)throw r.error;
    state.timesheetPayments=state.timesheetPayments||[];
    if(r.data)state.timesheetPayments.push(r.data);
  }
}
function ensureSalarySheet(){
  let o=$('salaryPaymentSheetOverlay');
  if(o)return o;
  o=document.createElement('div');
  o.className='sheet-overlay';
  o.id='salaryPaymentSheetOverlay';
  o.innerHTML=
    '<div class="sheet" style="max-width:560px">'+
      '<div class="sheet-handle"></div>'+
      '<div class="sheet-title"><span id="salaryPaymentSheetTitle">Выплата зарплаты</span><button class="sheet-close" id="salaryPaymentClose" type="button">✕</button></div>'+
      '<div id="salaryPaymentSummary" class="fee-card" style="margin-bottom:12px"></div>'+
      '<div class="field-row">'+
        '<div class="field"><label>Сумма выплаты, ₽</label><input type="number" id="salaryPaymentAmount" min="0" step="100"></div>'+
        '<div class="field"><label>Дата выплаты</label><input type="date" id="salaryPaymentDate"></div>'+
      '</div>'+
      '<div class="field"><label>Комментарий</label><input type="text" id="salaryPaymentNote" placeholder="например: первая часть / перевод на карту"></div>'+
      '<button class="btn btn-primary" id="salaryPaymentSave" type="button">Сохранить выплату</button>'+
      '<button class="btn btn-secondary" id="salaryPaymentCancelEdit" type="button" style="display:none;margin-top:8px">Отменить редактирование</button>'+
      '<div class="section-label" style="margin-top:18px"><span class="lbl-text">История выплат</span><span class="section-label-line"></span></div>'+
      '<div id="salaryPaymentHistory" class="card"></div>'+
    '</div>';
  document.body.appendChild(o);
  $('salaryPaymentClose').addEventListener('click',()=>o.classList.remove('active'));
  $('salaryPaymentSave').addEventListener('click',saveSalaryPayment);
  $('salaryPaymentCancelEdit').addEventListener('click',()=>{editingSalaryPaymentId=null;renderSalaryPaymentSheet();});
  $('salaryPaymentHistory').addEventListener('click',e=>{
    const edit=e.target.closest('[data-edit-salary-payment]');
    if(edit){editingSalaryPaymentId=edit.dataset.editSalaryPayment;renderSalaryPaymentSheet();return;}
    const del=e.target.closest('[data-delete-salary-payment]');
    if(del)deleteSalaryPayment(del.dataset.deleteSalaryPayment);
  });
  return o;
}
function renderSalaryPaymentSheet(){
  if(!salarySheetEmployeeId||!salarySheetMonth)return;
  const emp=findEmployee(salarySheetEmployeeId);
  const st=salaryPaymentState(salarySheetEmployeeId,salarySheetMonth);
  const edit=editingSalaryPaymentId?st.rows.find(x=>x.id===editingSalaryPaymentId):null;
  $('salaryPaymentSheetTitle').textContent=(edit?'Редактировать выплату':'Выплата зарплаты')+' · '+(emp?.name||'');
  $('salaryPaymentSummary').innerHTML=
    '<div class="fee-row"><div class="fl">Начислено за '+escapeHtml(monthLabel(salarySheetMonth))+'</div><div class="fv">'+fmtMoney(st.due)+'</div></div>'+
    '<div class="fee-row"><div class="fl">Уже выплачено</div><div class="fv" style="color:var(--green)">'+fmtMoney(st.paid)+'</div></div>'+
    '<div class="fee-row total"><div class="fl">Осталось выплатить</div><div class="fv" style="color:'+(st.overdue?'var(--red)':'var(--gold)')+'">'+fmtMoney(st.remaining)+'</div></div>'+
    '<div class="project-note" style="margin-top:8px">'+(st.full?'Закрыто полностью':st.overdue?'Просрочка · срок был до '+fmtDate(st.dueDate):'Срок выплаты до '+fmtDate(st.dueDate))+'</div>'+
    (st.legacyMarked?'<div class="note">По прежней отметке оплаты; отдельной денежной записи нет. Перед новой выплатой сверьте историю.</div>':'')+
    (st.overpaid>0.009?'<div class="note" style="color:var(--red)">Выплачено сверх начисления: '+fmtMoney(st.overpaid)+'</div>':'');
  const max=Math.max(0,st.remaining+num(edit?.amount));
  $('salaryPaymentAmount').value=edit?edit.amount:(st.remaining||'');
  $('salaryPaymentAmount').max=String(max);
  $('salaryPaymentDate').value=edit?.entry_date||todayISO();
  $('salaryPaymentNote').value=edit?salaryPaymentNote(edit):'';
  window.ARHITTEKCash?.attachCountField('salaryPaymentNote');
  window.ARHITTEKJournal?.salaryField(salarySheetEmployeeId,salarySheetMonth);
  $('salaryPaymentSave').textContent=edit?'Сохранить изменение':'Сохранить выплату';
  $('salaryPaymentSave').disabled=!edit&&st.remaining<=0.009;
  $('salaryPaymentCancelEdit').style.display=edit?'':'none';
  $('salaryPaymentHistory').innerHTML=st.rows.length?st.rows.map(x=>
    '<div class="list-item">'+
      '<div><div class="li-name">'+fmtMoney(x.amount)+'</div><div class="li-meta">'+fmtDate(x.entry_date)+(salaryPaymentNote(x)?' · '+escapeHtml(window.ARHITTEKCash?.displayNote?ARHITTEKCash.displayNote(salaryPaymentNote(x)):salaryPaymentNote(x)):'')+'</div></div>'+
      '<div class="li-actions"><button class="icon-btn" type="button" data-edit-salary-payment="'+escapeHtml(x.id)+'" title="Редактировать">✏️</button><button class="icon-btn danger" type="button" data-delete-salary-payment="'+escapeHtml(x.id)+'" title="Удалить выплату">🗑</button></div>'+
    '</div>'
  ).join(''):'<div class="empty-state">Выплат пока нет</div>';
}
function openSalaryPaymentSheet(employeeId,month){
  if(!session?.isAdmin){showToast('Выплаты отмечает администратор');return;}
  salarySheetEmployeeId=employeeId;salarySheetMonth=month;editingSalaryPaymentId=null;
  const o=ensureSalarySheet();renderSalaryPaymentSheet();o.classList.add('active');
}
window.openSalaryPaymentSheet=openSalaryPaymentSheet;

async function saveSalaryPayment(){
  if(salarySaveInFlight||!session?.isAdmin||!salarySheetEmployeeId||!salarySheetMonth)return;
  const amount=num($('salaryPaymentAmount').value),date=$('salaryPaymentDate').value,note=$('salaryPaymentNote').value.trim();
  const current=salaryPaymentState(salarySheetEmployeeId,salarySheetMonth);
  const edit=editingSalaryPaymentId?current.rows.find(x=>x.id===editingSalaryPaymentId):null;
  const max=current.remaining+num(edit?.amount);
  if(amount<=0){showToast('Укажите сумму выплаты');return;}
  if(amount>max+0.009){showToast('Сумма больше остатка к выплате: '+fmtMoney(max));return;}
  if(!date){showToast('Укажите дату выплаты');return;}
  if(date>todayISO()){showToast('Фактическая выплата не может быть в будущем');return;}
  const paymentNote=window.ARHITTEKCash?.operationDescription?ARHITTEKCash.operationDescription('salaryPaymentNote',note):note;
  let description='[salary:'+salarySheetMonth+']'+(paymentNote?' '+paymentNote:'');
  try{description=window.ARHITTEKJournal?.salaryDescription(description,amount)||description;}catch(e){showToast(e.message);return;}
  salarySaveInFlight=true;$('salaryPaymentSave').disabled=true;
  try{
    let savedId=edit?.id||null;
    if(edit){
      const r=await sb.from('ledger_entries').update({amount:amount,entry_date:date,description:description,payee_employee_id:salarySheetEmployeeId}).eq('id',edit.id);
      if(r.error)throw r.error;
      await logAudit('salary_payment',edit.id,(findEmployee(salarySheetEmployeeId)?.name||'Сотрудник')+' · '+salarySheetMonth,'update',{
        amount:{old:num(edit.amount),new:amount},
        entry_date:{old:edit.entry_date||null,new:date},
        note:{old:salaryPaymentNote(edit),new:note}
      });
    }else{
      const r=await sb.from('ledger_entries').insert({type:'salary_payment',payee_employee_id:salarySheetEmployeeId,amount:amount,entry_date:date,description:description,received_by:session.employeeId}).select().single();
      if(r.error)throw r.error;
      savedId=r.data?.id||null;
      await logAudit('salary_payment',savedId,(findEmployee(salarySheetEmployeeId)?.name||'Сотрудник')+' · '+salarySheetMonth,'create',{
        amount:{old:null,new:amount},entry_date:{old:null,new:date},note:{old:null,new:note}
      });
    }
    editingSalaryPaymentId=null;
    await loadAll();
    await syncLegacySalaryFlag(salarySheetEmployeeId,salarySheetMonth);
    renderTimesheet();
    renderSalaryPaymentSheet();
    renderFinancialObligations();
    try{enhanceFinanceSalaryCard();}catch(_){}
    try{enhanceCompanyBudgetObligations();}catch(_){}
    showToast(edit?'Выплата изменена':'Выплата сохранена');
  }catch(e){console.error(e);showToast('Не удалось сохранить выплату');
  }finally{salarySaveInFlight=false;renderSalaryPaymentSheet();}
}
async function deleteSalaryPayment(id){
  if(!session?.isAdmin)return;
  if(!confirm('Удалить эту запись о выплате? Она будет перемещена в корзину.'))return;
  try{
    const before=(state.ledger||[]).find(x=>x.id===id);
    const r=await sb.from('ledger_entries').update({deleted_at:new Date().toISOString()}).eq('id',id);
    if(r.error)throw r.error;
    await logAudit('salary_payment',id,(findEmployee(before?.payee_employee_id)?.name||'Сотрудник')+' · '+(salaryPaymentMonth(before)||''),'delete',{
      amount:{old:num(before?.amount),new:null},entry_date:{old:before?.entry_date||null,new:null}
    });
    await loadAll();
    await syncLegacySalaryFlag(salarySheetEmployeeId,salarySheetMonth);
    renderTimesheet();renderSalaryPaymentSheet();renderFinancialObligations();try{enhanceFinanceSalaryCard();}catch(_){}try{enhanceCompanyBudgetObligations();}catch(_){}
    showToast('Выплата удалена');
  }catch(e){console.error(e);showToast('Не удалось удалить выплату');}
}

function enhanceTimesheet(){
  const card=$('timesheetCard'),month=$('ts-month')?.value;
  if(!card||!month)return;
  card.querySelector('.payroll-explanation')?.remove();
  const note=document.createElement('p');
  note.className='project-note payroll-explanation';
  note.textContent='Табель показывает начислено, фактически выплачено и остаток. Частичные выплаты сохраняются отдельно; просрочка появляется после установленного срока выплаты.';
  card.prepend(note);

  let totalDue=0,totalPaid=0,totalRemaining=0,totalOverdue=0,totalLegacy=0;
  const range=monthRange(month),earned=completedProjectEarningsForRange(range.from,range.to).employees,split=splitPayrollByEmployee(earned).result;
  Array.from(card.querySelectorAll('.list-item[onclick*="toggleTimesheetRow"]')).forEach(row=>{
    const click=row.getAttribute('onclick')||'',id=(click.match(/toggleTimesheetRow\('([^']+)'\)/)||[])[1];
    if(!id)return;
    const due=num(split[id]?.payout),st=salaryPaymentState(id,month,due);
    totalDue+=st.due;totalPaid+=st.paid;totalRemaining+=st.remaining;if(st.overdue)totalOverdue+=st.remaining;
    if(st.legacyMarked)totalLegacy+=st.paid;
    const checkbox=row.querySelector('input[type="checkbox"]');
    if(checkbox)checkbox.style.display='none';
    const meta=row.querySelector('.li-meta');
    if(meta){
      meta.innerHTML='Начислено '+fmtMoney(st.due)+' · <span style="color:var(--green)">'+(st.legacyMarked?'прежняя отметка оплаты ':'выплачено ')+fmtMoney(st.paid)+'</span> · <span style="color:'+(st.overdue?'var(--red)':'var(--gold)')+'">осталось '+fmtMoney(st.remaining)+'</span>'+(st.overpaid>0.009?' · <b style="color:var(--red)">СВЕРХ НАЧИСЛЕНИЯ '+fmtMoney(st.overpaid)+'</b>':st.overdue?' · <b style="color:var(--red)">ПРОСРОЧЕНО</b>':st.full?' · <b style="color:var(--green)">ОПЛАЧЕНО</b>':'');
    }
    const right=row.lastElementChild;
    if(right){
      const sum=right.querySelector('.proj-sum');
      if(sum){sum.textContent=st.remaining>0?'Остаток '+fmtMoney(st.remaining):'Оплачено';sum.style.color=st.remaining?(st.overdue?'var(--red)':'var(--gold)'):'var(--green)';}
      if(session?.isAdmin&&!right.querySelector('[data-salary-pay]')){
        const b=document.createElement('button');
        b.type='button';b.className='btn btn-secondary';b.dataset.salaryPay=id;b.style.cssText='width:auto;padding:7px 10px;font-size:11px;white-space:nowrap';
        b.textContent=st.remaining>0?'Выплатить':'История';
        b.addEventListener('click',e=>{e.stopPropagation();openSalaryPaymentSheet(id,month);});
        right.appendChild(b);
      }
    }
  });
  Array.from(card.querySelectorAll('.list-item')).forEach(row=>{
    const name=row.querySelector('.li-name')?.textContent?.trim();
    const sum=row.querySelector('.proj-sum');
    if(!sum)return;
    if(name==='Всего начислено за месяц')sum.textContent=fmtMoney(totalDue);
    if(name==='Отмечено выплаченным'){row.querySelector('.li-name').textContent=totalLegacy?'Учтено выплаченным':'Фактически выплачено';sum.textContent=fmtMoney(totalPaid);sum.style.color='var(--green)';}
    if(name==='Осталось выплатить'){sum.textContent=fmtMoney(totalRemaining);sum.style.color=totalOverdue?'var(--red)':'var(--gold)';}
  });
  if(totalLegacy)note.textContent+=' В том числе '+fmtMoney(totalLegacy)+' по прежним отметкам без отдельных денежных записей.';
  if(totalOverdue>0){
    const warn=document.createElement('div');
    warn.className='note';warn.style.cssText='margin:8px 0 10px;border:1px solid rgba(224,82,82,.35);background:rgba(224,82,82,.08);color:var(--red);';
    warn.textContent='Просрочено по зарплате: '+fmtMoney(totalOverdue);
    note.after(warn);
  }
}
if(typeof renderTimesheet==='function'){
  const oldRenderTimesheetV3=renderTimesheet;
  renderTimesheet=function(){const r=oldRenderTimesheetV3.apply(this,arguments);try{enhanceTimesheet();}catch(e){console.warn('[Payroll]',e);}return r;};
}

function obligationPeriod(row){
  const m=String(row?.description||'').match(/период\s+(\d{4}-\d{2})/i);
  return m?m[1]:String(row?.expense_date||'').slice(0,7);
}
function officeExpected(kind){
  const def=kind==='rent'?110000:2500;
  return Math.max(0,num(localStorage.getItem('forecast_'+kind)??def));
}
function officePaid(kind,month){
  const re=kind==='rent'?/аренд/i:/интернет|связь/i;
  return (state.companyExpenses||[]).filter(x=>!x.deleted_at&&re.test(String(x.category||''))&&obligationPeriod(x)===month).reduce((s,x)=>s+num(x.amount),0);
}
function officeRecordedByCashMonth(kind,month){
  const re=kind==='rent'?/аренд/i:/интернет|связь/i;
  return (state.companyExpenses||[]).filter(x=>!x.deleted_at&&re.test(String(x.category||''))&&String(x.expense_date||'').slice(0,7)===month).reduce((s,x)=>s+num(x.amount),0);
}
function adjustedMonthResult(month){
  try{
    const r=timesheetMonthRange(month),f=computeFinancePeriod(r.from,r.to);
    const extraIncome=(state.companyIncome||[]).filter(i=>isOperationalCompanyIncome(i)&&i.income_date&&String(i.income_date).slice(0,7)===month).reduce((s,i)=>s+num(i.amount),0);
    const rentGap=Math.max(0,officeExpected('rent')-officeRecordedByCashMonth('rent',month));
    const internetGap=Math.max(0,officeExpected('internet')-officeRecordedByCashMonth('internet',month));
    return {raw:f.netProfit+extraIncome,adjusted:f.netProfit+extraIncome-rentGap-internetGap,rentGap,internetGap};
  }catch(e){return null;}
}
function officeObligation(kind,month){
  const expected=officeExpected(kind),paid=Math.min(expected,officePaid(kind,month)),remaining=Math.max(0,expected-paid),dueDate=officeDueDate(month,kind),overdue=remaining>0.009&&todayISO()>dueDate;
  return {kind,expected,paid,remaining,dueDate,overdue,full:remaining<=0.009};
}
function currentObligationMonth(){return $('finance-obligation-month')?.value||todayISO().slice(0,7);}
function financeTrackingStart(){
  let v=localStorage.getItem('finance_obligations_tracking_start');
  if(!v){
    const candidates=[todayISO().slice(0,7)];
    (state.timesheetPayments||[]).forEach(x=>{if(/^\d{4}-\d{2}$/.test(x.month||''))candidates.push(x.month);});
    (state.ledger||[]).filter(x=>!x.deleted_at&&x.type==='salary_payment').forEach(x=>{const m=salaryPaymentMonth(x);if(m)candidates.push(m);});
    (state.companyExpenses||[]).filter(x=>!x.deleted_at&&/аренд|интернет|связь/i.test(String(x.category||''))).forEach(x=>{
      const m=obligationPeriod(x);if(/^\d{4}-\d{2}$/.test(m||''))candidates.push(m);
    });
    v=candidates.sort()[0];
    localStorage.setItem('finance_obligations_tracking_start',v);
  }
  return v;
}
function monthSequence(from,to){
  if(!/^\d{4}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}$/.test(to||'')||from>to)return [];
  const out=[],a=from.split('-').map(Number),b=to.split('-').map(Number);
  let y=a[0],m=a[1],guard=0;
  while((y<b[0]||(y===b[0]&&m<=b[1]))&&guard<36){
    out.push(String(y)+'-'+String(m).padStart(2,'0'));
    m++;if(m>12){m=1;y++;}guard++;
  }
  return out;
}
function allOverdueObligations(){
  const current=todayISO().slice(0,7),start=financeTrackingStart();
  let salary=0,rent=0,internet=0;
  monthSequence(start,current).forEach(month=>{
    const s=salaryAggregate(month),r=officeObligation('rent',month),i=officeObligation('internet',month);
    salary+=s.overdue;
    if(r.overdue)rent+=r.remaining;
    if(i.overdue)internet+=i.remaining;
  });
  return {salary,rent,internet,total:salary+rent+internet,start};
}
function openOfficePayment(kind,month){
  const st=officeObligation(kind,month);
  if(st.remaining<=0){showToast('Обязательство уже оплачено');return;}
  const category=kind==='rent'?'Аренда':'Связь и интернет';
  openCompanyExpenseSheet(null,category);
  setTimeout(()=>{
    if($('cex-amount'))$('cex-amount').value=st.remaining;
    if($('cex-date'))$('cex-date').value=todayISO();
    if($('cex-desc'))$('cex-desc').value=(kind==='rent'?'Оплата аренды':'Оплата интернета / связи')+' · период '+month;
  },0);
}
window.openOfficePayment=openOfficePayment;

function salaryAggregate(month){
  let due=0,paid=0,remaining=0,overdue=0;
  (state.employees||[]).filter(e=>e.active!==false||payrollDueForEmployee(e.id,month)>0).forEach(e=>{
    const st=salaryPaymentState(e.id,month);
    due+=st.due;paid+=st.paid;remaining+=st.remaining;if(st.overdue)overdue+=st.remaining;
  });
  return {due,paid,remaining,overdue};
}
function ensureObligationsBlock(){
  const view=$('view-finance');if(!view)return null;
  let wrap=$('financeObligationsWrap');if(wrap)return wrap;
  wrap=document.createElement('section');wrap.id='financeObligationsWrap';wrap.style.marginBottom='18px';
  const forecast=$('forecastMain')?.closest('.forecast-wrap');
  if(forecast)forecast.after(wrap);else view.querySelector('.workspace-head')?.after(wrap);
  return wrap;
}
function statusBadge(st){
  if(st.full)return '<span style="color:var(--green);font-weight:700">ОПЛАЧЕНО</span>';
  if(st.overdue)return '<span style="color:var(--red);font-weight:700">ПРОСРОЧЕНО</span>';
  if(st.paid>0)return '<span style="color:var(--gold);font-weight:700">ЧАСТИЧНО</span>';
  return '<span style="color:var(--text-dim);font-weight:700">К ОПЛАТЕ</span>';
}
function renderFinancialObligations(){
  const wrap=ensureObligationsBlock();if(!wrap)return;
  const month=currentObligationMonth(),salary=salaryAggregate(month),rent=officeObligation('rent',month),internet=officeObligation('internet',month);
  const totalDue=salary.due+rent.expected+internet.expected,totalPaid=salary.paid+rent.paid+internet.paid,totalRemaining=salary.remaining+rent.remaining+internet.remaining,totalOverdue=salary.overdue+(rent.overdue?rent.remaining:0)+(internet.overdue?internet.remaining:0);
  const backlog=allOverdueObligations();
  const adjusted=adjustedMonthResult(month);
  wrap.innerHTML=
    '<div class="section-label"><span class="lbl-text">Обязательства и оплаты</span><span class="section-label-line"></span></div>'+
    '<div class="card">'+
      '<div class="field" style="margin-bottom:12px"><label>Месяц</label><input type="month" id="finance-obligation-month" value="'+month+'"></div>'+
      '<div class="finance-kpi-grid">'+
        '<div class="finance-kpi"><span>Начислено / план</span><strong>'+fmtMoney(totalDue)+'</strong></div>'+
        '<div class="finance-kpi"><span>Фактически оплачено</span><strong style="color:var(--green)">'+fmtMoney(totalPaid)+'</strong></div>'+
        '<div class="finance-kpi finance-kpi-main"><span>Осталось оплатить</span><strong style="color:'+(backlog.total?'var(--red)':'var(--gold)')+'">'+fmtMoney(totalRemaining)+'</strong><small>'+(backlog.total?'общая просрочка '+fmtMoney(backlog.total):'просрочек нет')+'</small></div>'+
      '</div>'+
      (backlog.total?'<div class="note" style="margin:10px 0;border:1px solid rgba(224,82,82,.35);background:rgba(224,82,82,.08);color:var(--red)"><b>Просроченные обязательства: '+fmtMoney(backlog.total)+'</b><br>Зарплата '+fmtMoney(backlog.salary)+' · аренда '+fmtMoney(backlog.rent)+' · интернет '+fmtMoney(backlog.internet)+' · учёт с '+escapeHtml(backlog.start)+'</div>':'')+
      '<div class="list-item"><div><div class="li-name">Зарплата сотрудникам</div><div class="li-meta">Начислено '+fmtMoney(salary.due)+' · выплачено '+fmtMoney(salary.paid)+' · осталось '+fmtMoney(salary.remaining)+'</div></div><div class="li-actions">'+(salary.overdue?'<span style="color:var(--red);font-size:11px;font-weight:700">ПРОСРОЧЕНО</span>':'')+'<button class="btn btn-secondary" type="button" id="financeOpenTimesheet" style="width:auto;padding:7px 10px">Табель</button></div></div>'+
      '<div class="list-item"><div><div class="li-name">Аренда офиса · '+fmtMoney(rent.expected)+'</div><div class="li-meta">Оплачено '+fmtMoney(rent.paid)+' · осталось '+fmtMoney(rent.remaining)+' · срок до '+fmtDate(rent.dueDate)+'</div></div><div class="li-actions">'+statusBadge(rent)+(rent.remaining>0?'<button class="btn btn-secondary" type="button" data-pay-office="rent" style="width:auto;padding:7px 10px">Оплатить</button>':'')+'</div></div>'+
      '<div class="list-item"><div><div class="li-name">Интернет / связь · '+fmtMoney(internet.expected)+'</div><div class="li-meta">Оплачено '+fmtMoney(internet.paid)+' · осталось '+fmtMoney(internet.remaining)+' · срок до '+fmtDate(internet.dueDate)+'</div></div><div class="li-actions">'+statusBadge(internet)+(internet.remaining>0?'<button class="btn btn-secondary" type="button" data-pay-office="internet" style="width:auto;padding:7px 10px">Оплатить</button>':'')+'</div></div>'+
      (adjusted?'<div class="fee-row total" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line-strong)"><div class="fl">Результат месяца после обязательных расходов</div><div class="fv" style="color:'+(adjusted.adjusted>=0?'var(--green)':'var(--red)')+'">'+fmtMoney(adjusted.adjusted)+'</div></div><div class="project-note">Если аренда или интернет ещё не внесены в расходы, здесь они всё равно зарезервированы в расчёте.</div>':'')+
      '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:var(--text-dim)">Настроить суммы и сроки</summary>'+
        '<div class="field-row" style="margin-top:10px"><div class="field"><label>Аренда в месяц, ₽</label><input type="number" id="financeRentExpected" value="'+rent.expected+'"></div><div class="field"><label>Аренда до числа</label><input type="number" min="1" max="28" id="financeRentDueDay" value="'+officeDueDay('rent')+'"></div></div>'+
        '<div class="field-row"><div class="field"><label>Интернет в месяц, ₽</label><input type="number" id="financeInternetExpected" value="'+internet.expected+'"></div><div class="field"><label>Интернет до числа</label><input type="number" min="1" max="28" id="financeInternetDueDay" value="'+officeDueDay('internet')+'"></div></div>'+
        '<div class="field"><label>Зарплата за месяц — выплатить до числа следующего месяца</label><input type="number" min="1" max="28" id="financeSalaryDueDay" value="'+salaryDueDay()+'"></div>'+
        '<div class="field"><label>С какого месяца учитывать просрочки</label><input type="month" id="financeTrackingStart" value="'+financeTrackingStart()+'"></div>'+
      '</details>'+
    '</div>';
  $('finance-obligation-month')?.addEventListener('change',()=>{renderFinancialObligations();try{enhanceFinanceSalaryCard();}catch(_){}try{enhanceCompanyBudgetObligations();}catch(_){}});
  wrap.querySelectorAll('[data-pay-office]').forEach(b=>b.addEventListener('click',()=>openOfficePayment(b.dataset.payOffice,month)));
  $('financeOpenTimesheet')?.addEventListener('click',()=>{
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    $('view-timesheet').classList.add('active');$('ts-month').value=month;renderTimesheet();window.scrollTo(0,0);
  });
  [['financeRentExpected','forecast_rent'],['financeInternetExpected','forecast_internet'],['financeRentDueDay','finance_rent_due_day'],['financeInternetDueDay','finance_internet_due_day'],['financeSalaryDueDay','finance_salary_due_day']].forEach(pair=>{
    $(pair[0])?.addEventListener('change',e=>{localStorage.setItem(pair[1],String(Math.max(0,num(e.target.value))));renderFinancialObligations();try{renderFinancialForecast?.();}catch(_){}try{enhanceCompanyBudgetObligations();}catch(_){}});  });
  $('financeTrackingStart')?.addEventListener('change',e=>{if(e.target.value)localStorage.setItem('finance_obligations_tracking_start',e.target.value);renderFinancialObligations();try{enhanceCompanyBudgetObligations();}catch(_){}});
  const nav=document.querySelector('.nav-btn[data-view="view-finance"]');
  if(nav){
    let badge=nav.querySelector('.finance-overdue-badge');
    if(backlog.total>0){
      if(!badge){badge=document.createElement('span');badge.className='finance-overdue-badge';badge.style.cssText='position:absolute;top:3px;right:8px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--red);color:white;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center';nav.style.position='relative';nav.appendChild(badge);}
      badge.textContent='!';
      nav.title='Есть просроченные обязательства на '+fmtMoney(backlog.total);
    }else if(badge)badge.remove();
  }
}
window.renderFinancialObligations=renderFinancialObligations;

function enhanceCompanyBudgetObligations(){
  const el=$('companyBudgetBlock');if(!el)return;
  const month=currentObligationMonth();
  const salary=salaryAggregate(month),rent=officeObligation('rent',month),internet=officeObligation('internet',month);
  const committed=salary.remaining+rent.remaining+internet.remaining;
  let reserve=0;
  try{reserve=getCompanyReserveBalance();}catch(e){}
  const free=reserve-committed;
  const old=el.querySelector('.reserve-obligations-extra');if(old)old.remove();
  const extra=document.createElement('div');extra.className='reserve-obligations-extra';
  extra.innerHTML=
    '<div class="fee-row" style="border-top:1px solid var(--line-strong);margin-top:8px;padding-top:8px"><div class="fl">Плановые оплаты, ещё не отмеченные · '+escapeHtml(monthLabel(month))+'</div><div class="fv" style="color:'+(committed?'var(--gold)':'var(--green)')+'">−'+fmtMoney(committed)+'</div></div>'+
    '<div class="fee-row total"><div class="fl">'+(free>=0?'Останется после плановых оплат':'Не хватает для плановых оплат')+'</div><div class="fv" style="color:'+(free>=0?'var(--green)':'var(--red)')+'">'+fmtMoney(Math.abs(free))+'</div></div>'+
    '<div class="note" style="margin-top:8px">Это прогноз по указанному резерву: зарплата, аренда и интернет за выбранный месяц. Неотмеченная оплата не означает подтверждённый долг. Внесите уже сделанные выплаты, чтобы остатки обновились.</div>';
  el.appendChild(extra);
}

const oldRenderCompanyBudgetOb=typeof renderCompanyBudget==='function'?renderCompanyBudget:null;
if(oldRenderCompanyBudgetOb){
  renderCompanyBudget=function(){const r=oldRenderCompanyBudgetOb.apply(this,arguments);try{enhanceCompanyBudgetObligations();}catch(e){console.warn('[Reserve obligations]',e);}return r;};
}

function enhanceFinanceSalaryCard(){
  const el=$('finSalariesCard');if(!el)return;
  const month=currentObligationMonth();
  const rows=(state.employees||[]).filter(e=>e.active!==false&&e.is_salaried);
  if(!rows.length)return;
  let totalDue=0,totalPaid=0,totalRemaining=0,totalOverdue=0;
  const body=rows.map(e=>{
    const st=salaryPaymentState(e.id,month);
    totalDue+=st.due;totalPaid+=st.paid;totalRemaining+=st.remaining;if(st.overdue)totalOverdue+=st.remaining;
    return '<div class="list-item">'+
      '<div><div class="li-name">'+escapeHtml(e.name)+(e.role?' <span style="color:var(--text-dim);font-weight:400">· '+escapeHtml(e.role)+'</span>':'')+'</div>'+
      '<div class="li-meta">'+monthLabel(month)+' · начислено '+fmtMoney(st.due)+' · выплачено '+fmtMoney(st.paid)+' · осталось '+fmtMoney(st.remaining)+(st.overdue?' · <b style="color:var(--red)">ПРОСРОЧЕНО</b>':'')+'</div></div>'+
      '<div class="li-actions"><div class="proj-sum" style="color:'+(st.remaining?(st.overdue?'var(--red)':'var(--gold)'):'var(--green)')+'">'+(st.remaining?fmtMoney(st.remaining):'Оплачено')+'</div>'+
      (session?.isAdmin?'<button class="btn btn-secondary" type="button" data-fin-salary-pay="'+escapeHtml(e.id)+'" style="width:auto;padding:7px 10px">'+(st.remaining?'Выплатить':'История')+'</button>':'')+'</div>'+
    '</div>';
  }).join('');
  el.innerHTML='<div class="project-note" style="padding:10px 0">Фиксированный оклад — это начисление. Реальная выплата учитывается отдельно и может быть частичной.</div>'+body+
    '<div class="list-item" style="border-top:1px solid var(--line-strong)"><div class="li-name" style="font-weight:700">Итого · '+escapeHtml(monthLabel(month))+'</div><div class="proj-sum" style="font-weight:700">'+fmtMoney(totalDue)+'</div></div>'+
    '<div class="list-item"><div class="li-name">Фактически выплачено</div><div class="proj-sum" style="color:var(--green)">'+fmtMoney(totalPaid)+'</div></div>'+
    '<div class="list-item"><div class="li-name">Осталось'+(totalOverdue?' · просрочено '+fmtMoney(totalOverdue):'')+'</div><div class="proj-sum" style="color:'+(totalOverdue?'var(--red)':'var(--gold)')+'">'+fmtMoney(totalRemaining)+'</div></div>';
  el.querySelectorAll('[data-fin-salary-pay]').forEach(b=>b.addEventListener('click',()=>openSalaryPaymentSheet(b.dataset.finSalaryPay,month)));
}

const oldRenderFinanceSalariesPayroll=typeof renderFinanceSalaries==='function'?renderFinanceSalaries:null;
if(oldRenderFinanceSalariesPayroll){
  renderFinanceSalaries=function(){const r=oldRenderFinanceSalariesPayroll.apply(this,arguments);try{enhanceFinanceSalaryCard();}catch(e){console.warn('[Finance salaries]',e);}return r;};
}

const oldRenderAnalyticsPayroll=typeof renderAnalytics==='function'?renderAnalytics:null;
if(oldRenderAnalyticsPayroll){
  renderAnalytics=function(){const r=oldRenderAnalyticsPayroll.apply(this,arguments);setTimeout(renderFinancialObligations,0);return r;};
}
const oldRenderAllPayroll=typeof renderAll==='function'?renderAll:null;
if(oldRenderAllPayroll){
  renderAll=function(){const r=oldRenderAllPayroll.apply(this,arguments);setTimeout(()=>{try{renderFinancialObligations();}catch(e){}try{if($('view-finance')?.classList.contains('active'))enhanceFinanceSalaryCard();}catch(e){}},0);return r;};
}
setTimeout(()=>{try{renderFinancialObligations();}catch(e){console.warn('[Obligations]',e);}},900);
})();
