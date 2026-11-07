/* ARHITTEK FINANCE OBLIGATIONS V4 */
(()=>{
'use strict';
if(window.__arhittekFinanceObligationsV4)return;
window.__arhittekFinanceObligationsV4=true;
const $=id=>document.getElementById(id), n=v=>Number.isFinite(Number(v))?Number(v):0;
const cash=v=>{try{return fmtMoney(Math.round(n(v)));}catch(e){return Math.round(n(v)).toLocaleString('ru-RU')+' ₽';}};
const esc=v=>{try{return escapeHtml(String(v??''));}catch(e){return String(v??'');}};
const dateISO=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=()=>dateISO(new Date()), isAdmin=()=>!!(window.session?.isAdmin||session?.isAdmin);
const monthName=k=>{const a=String(k||'').split('-').map(Number);return a[0]&&a[1]?new Date(a[0],a[1]-1,1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'}):k;};
const day=(key,d)=>Math.max(1,Math.min(28,parseInt(localStorage.getItem(key)||d,10)||d));
const salaryMonth=x=>String(x?.description||'').match(/\[salary:(\d{4}-\d{2})\]/)?.[1]||'';
const salaryNote=x=>String(x?.description||'').replace(/\[salary:\d{4}-\d{2}\]\s*/,'').trim();
const salaryRows=(emp,month)=>(state.ledger||[]).filter(x=>!x.deleted_at&&x.type==='salary_payment'&&x.payee_employee_id===emp&&salaryMonth(x)===month).sort((a,b)=>String(b.entry_date||'').localeCompare(String(a.entry_date||'')));
const payroll=month=>{const r=timesheetMonthRange(month),e=completedProjectEarningsForRange(r.from,r.to).employees;return splitPayrollByEmployee(e).result;};
const accrued=(emp,month)=>n(payroll(month)[emp]?.payout);
const legacy=(emp,month)=>(state.timesheetPayments||[]).find(x=>x.employee_id===emp&&x.month===month&&x.paid);
const paid=(emp,month,total)=>{const s=salaryRows(emp,month).reduce((a,x)=>a+n(x.amount),0);return s>0?Math.min(s,total):legacy(emp,month)?total:0;};
const balance=(emp,month,total)=>Math.max(0,total-paid(emp,month,total));
function salaryDue(month){const a=month.split('-').map(Number),d=day('finance_salary_due_day',5),x=new Date(a[0],a[1],d);return dateISO(x);}
function dueThisMonth(month,key,def){const a=month.split('-'),d=day(key,def);return a[0]+'-'+a[1]+'-'+String(d).padStart(2,'0');}
const overdue=(sum,due)=>n(sum)>0&&today()>due;
window.salaryPaidForMonth=paid;window.salaryBalanceForMonth=balance;window.salaryPaymentsForMonth=salaryRows;

let editPay=null;
function paySheet(){
 let o=$('salaryPaymentSheetOverlay');if(o)return o;
 o=document.createElement('div');o.id='salaryPaymentSheetOverlay';o.className='sheet-overlay';
 o.innerHTML='<div class="sheet"><div class="sheet-handle"></div><div class="sheet-title"><span id="salaryPaymentTitle">Выплата зарплаты</span><button class="sheet-close" id="salaryPaymentClose" type="button">✕</button></div><div id="salaryPaymentBody"></div></div>';
 document.body.appendChild(o);$('salaryPaymentClose').onclick=()=>{o.classList.remove('active');editPay=null;};return o;
}
window.openSalaryPaymentSheet=function(empId,month,id){
 if(!isAdmin()){showToast('Отмечать выплаты может только администратор');return;}
 const emp=(state.employees||[]).find(e=>e.id===empId);if(!emp)return;
 const total=accrued(empId,month),already=paid(empId,month,total),left=Math.max(0,total-already);
 const row=id?(state.ledger||[]).find(x=>x.id===id&&x.type==='salary_payment'):null;editPay=row?.id||null;
 const o=paySheet();$('salaryPaymentTitle').textContent=row?'Редактировать выплату':'Выплата зарплаты';
 $('salaryPaymentBody').innerHTML=
 '<div class="finance-current-balance"><span>'+esc(emp.name)+' · '+esc(monthName(month))+'</span><strong>'+cash(left)+' осталось</strong></div>'+
 '<div class="field-row"><div class="field"><label>Сумма выплаты, ₽</label><input id="salary-payment-amount" type="number" min="1" step="500" value="'+(row?n(row.amount):Math.round(left))+'"></div>'+
 '<div class="field"><label>Дата выплаты</label><input id="salary-payment-date" type="date" value="'+esc(row?.entry_date||today())+'"></div></div>'+
 '<div class="field"><label>Комментарий</label><input id="salary-payment-note" type="text" value="'+esc(row?salaryNote(row):'')+'" placeholder="например: часть зарплаты наличными"></div>'+
 '<input id="salary-payment-employee" type="hidden" value="'+esc(empId)+'"><input id="salary-payment-month" type="hidden" value="'+esc(month)+'">'+
 '<button class="btn btn-primary" id="salary-payment-save" type="button">'+(row?'Сохранить изменение':'Записать выплату')+'</button>'+
 (row?'<button class="btn btn-danger" id="salary-payment-delete" type="button" style="margin-top:8px">Удалить эту выплату</button>':'')+
 '<div class="note" style="margin-top:10px">Начислено: '+cash(total)+' · выплачено: '+cash(already)+' · срок: '+fmtDate(salaryDue(month))+'</div>';
 $('salary-payment-save').onclick=saveSalaryPayment;if(row)$('salary-payment-delete').onclick=deleteSalaryPayment;o.classList.add('active');
};
async function saveSalaryPayment(){
 const emp=$('salary-payment-employee')?.value,month=$('salary-payment-month')?.value,amount=n($('salary-payment-amount')?.value),date=$('salary-payment-date')?.value||today(),note=($('salary-payment-note')?.value||'').trim();
 if(!emp||!month||amount<=0){showToast('Укажите сумму выплаты');return;}
 const total=accrued(emp,month),other=salaryRows(emp,month).filter(x=>x.id!==editPay).reduce((a,x)=>a+n(x.amount),0);
 if(other+amount>total+.01){showToast('Сумма выплат превысит начисленную зарплату. Осталось '+cash(Math.max(0,total-other)));return;}
 const payload={type:'salary_payment',project_id:null,payee_employee_id:emp,amount,entry_date:date,description:'[salary:'+month+'] '+(note||'Выплата зарплаты'),received_by:session?.employeeId||null};
 try{
  const q=editPay?await sb.from('ledger_entries').update(payload).eq('id',editPay):await sb.from('ledger_entries').insert(payload);if(q.error)throw q.error;
  const old=legacy(emp,month);if(old)await sb.from('timesheet_payments').update({paid:false,paid_at:null}).eq('id',old.id);
  $('salaryPaymentSheetOverlay').classList.remove('active');editPay=null;await loadAll();renderTimesheet();try{renderFinanceVisualPanels();}catch(e){}showToast('Выплата сохранена');
 }catch(e){console.error(e);showToast('Не удалось сохранить выплату');}
}
async function deleteSalaryPayment(){
 if(!editPay||!confirm('Удалить запись о выплате зарплаты?'))return;
 try{const q=await sb.from('ledger_entries').update({deleted_at:new Date().toISOString()}).eq('id',editPay);if(q.error)throw q.error;$('salaryPaymentSheetOverlay').classList.remove('active');editPay=null;await loadAll();renderTimesheet();showToast('Выплата удалена');}catch(e){console.error(e);showToast('Ошибка удаления');}
}
window.saveSalaryPayment=saveSalaryPayment;

function style(){
 if($('financeObligationStyle'))return;
 const s=document.createElement('style');s.id='financeObligationStyle';s.textContent=
 '.payroll-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}.payroll-summary>div{border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--card)}.payroll-summary span{display:block;font-size:9px;color:var(--text-dim);text-transform:uppercase}.payroll-summary strong{font:700 15px Space Grotesk,sans-serif}.payroll-summary .late{border-color:rgba(220,70,70,.35)}.payroll-card{border:1px solid var(--line);border-radius:13px;margin-bottom:8px;overflow:hidden;background:var(--card)}.payroll-card.late{border-color:rgba(220,70,70,.35)}.payroll-head{display:flex;justify-content:space-between;gap:10px;padding:12px;cursor:pointer}.payroll-head small,.payroll-line small{display:block;color:var(--text-dim);font-size:9px}.payroll-head>div:last-child{text-align:right}.payroll-bar{height:3px;background:var(--line)}.payroll-bar i{display:block;height:100%;background:var(--green)}.payroll-line{display:flex;gap:10px;flex-wrap:wrap;padding:8px 12px;font-size:10px}.payroll-pay{margin:0 12px 10px;width:calc(100% - 24px)}.payroll-more{border-top:1px solid var(--line);padding:10px 12px}.salary-history{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:7px 0}.salary-history>div:last-child{display:flex;align-items:center;gap:6px}.status-pill{font-size:9px;font-weight:700;padding:3px 7px;border-radius:15px;background:rgba(232,163,61,.1);color:var(--gold)}.status-pill.ok{background:rgba(50,170,105,.1);color:var(--green)}.status-pill.late{background:rgba(220,70,70,.1);color:var(--red)}.obligation-row{border:1px solid var(--line);border-radius:12px;padding:11px;margin-bottom:7px}.obligation-top{display:flex;justify-content:space-between;gap:10px}.obligation-top>div:last-child{text-align:right}.obligation-settings{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.obligation-settings .field{margin:0}@media(max-width:520px){.payroll-summary{grid-template-columns:1fr 1fr}.obligation-settings{grid-template-columns:1fr}}';
 document.head.appendChild(s);
}
function pill(left,due){return left<=0?'<span class="status-pill ok">Оплачено</span>':overdue(left,due)?'<span class="status-pill late">Просрочено</span>':'<span class="status-pill">К оплате</span>';}

renderTimesheet=function(){
 style();const mi=$('ts-month');if(!mi)return;if(!mi.value)mi.value=today().slice(0,7);const month=mi.value,r=timesheetMonthRange(month),earned=completedProjectEarningsForRange(r.from,r.to).employees,p=splitPayrollByEmployee(earned).result,card=$('timesheetCard');if(!card)return;
 const rows=(state.employees||[]).filter(e=>!e.deleted_at&&(e.active!==false||n(p[e.id]?.payout)>0)).filter(e=>isAdmin()||e.id===session?.employeeId).map(e=>{const total=n(p[e.id]?.payout),got=paid(e.id,month,total),left=Math.max(0,total-got),due=salaryDue(month);return {e,total,got,left,due,late:overdue(left,due),hist:salaryRows(e.id,month),items:earned[e.id]?.items||[]};}).filter(x=>x.total||x.got).sort((a,b)=>(b.late-a.late)||b.left-a.left);
 const t=rows.reduce((a,x)=>({a:a.a+x.total,p:a.p+x.got,l:a.l+x.left,o:a.o+(x.late?x.left:0)}),{a:0,p:0,l:0,o:0});
 let html='<div class="payroll-summary"><div><span>Начислено</span><strong>'+cash(t.a)+'</strong></div><div><span>Выплачено</span><strong style="color:var(--green)">'+cash(t.p)+'</strong></div><div><span>Осталось</span><strong>'+cash(t.l)+'</strong></div><div class="'+(t.o?'late':'')+'"><span>Просрочено</span><strong>'+cash(t.o)+'</strong></div></div>';
 if(!rows.length){card.innerHTML=html+'<div class="empty-state">За выбранный месяц начислений нет</div>';return;}
 html+=rows.map(x=>{const ex=!!timesheetExpanded[x.e.id],pct=x.total?Math.min(100,x.got/x.total*100):0,history=x.hist.length?x.hist.map(h=>'<div class="salary-history"><div><strong>'+fmtDate(h.entry_date)+'</strong><small>'+esc(salaryNote(h)||'Выплата зарплаты')+'</small></div><div><b>'+cash(h.amount)+'</b>'+(isAdmin()?'<button class="icon-btn" onclick="event.stopPropagation();openSalaryPaymentSheet(\''+x.e.id+'\',\''+month+'\',\''+h.id+'\')">✎</button>':'')+'</div></div>').join(''):'<div class="finance-v-empty">Выплат пока нет</div>',items=x.items.map(it=>'<div class="list-item" style="padding-left:0"><div><div class="li-name">'+esc(it.name)+'</div><div class="li-meta">'+esc(it.role||'начисление')+'</div></div><div class="proj-sum">'+cash(it.amount)+'</div></div>').join('');
  return '<div class="payroll-card '+(x.late?'late':'')+'"><div class="payroll-head" onclick="toggleTimesheetRow(\''+x.e.id+'\')"><div><strong>'+(ex?'▾ ':'▸ ')+esc(x.e.name)+'</strong><small>'+esc(x.e.role||'Сотрудник')+(x.late?' · ПРОСРОЧКА':'')+'</small></div><div><small>'+cash(x.left)+' осталось</small><strong>'+cash(x.total)+'</strong></div></div><div class="payroll-bar"><i style="width:'+pct+'%"></i></div><div class="payroll-line"><span>Начислено <b>'+cash(x.total)+'</b></span><span>Выплачено <b style="color:var(--green)">'+cash(x.got)+'</b></span><span>Остаток <b>'+cash(x.left)+'</b></span>'+pill(x.left,x.due)+'</div>'+(isAdmin()&&x.left>0?'<button class="btn btn-secondary payroll-pay" onclick="event.stopPropagation();openSalaryPaymentSheet(\''+x.e.id+'\',\''+month+'\')">+ Записать выплату</button>':'')+(ex?'<div class="payroll-more"><div class="project-eyebrow">Из чего начислено</div>'+(items||'<div class="finance-v-empty">Фиксированный оклад</div>')+'<div class="project-eyebrow" style="margin-top:10px">История выплат</div>'+history+'<div class="note" style="margin-top:8px">Срок полной выплаты: '+fmtDate(x.due)+'</div></div>':'')+'</div>';
 }).join('');
 card.innerHTML=html;
};
toggleTimesheetPaid=async function(emp,month,checked){if(!checked){renderTimesheet();return;}const left=balance(emp,month,accrued(emp,month));if(left<=0){showToast('Зарплата уже выплачена');return;}openSalaryPaymentSheet(emp,month);};

function expensePaid(month,re){return (state.companyExpenses||[]).filter(x=>!x.deleted_at&&String(x.expense_date||'').slice(0,7)===month&&re.test(String(x.category||'')+' '+String(x.description||''))).reduce((a,x)=>a+n(x.amount),0);}
function obligations(month){const rp=n(localStorage.getItem('forecast_rent')??110000),ip=n(localStorage.getItem('forecast_internet')??2500),r=expensePaid(month,/аренд/i),i=expensePaid(month,/интернет|связь/i);return [{id:'rent',name:'Аренда офиса',plan:rp,paid:r,left:Math.max(0,rp-r),due:dueThisMonth(month,'finance_rent_due_day',5),cat:'Аренда'},{id:'internet',name:'Интернет / связь',plan:ip,paid:i,left:Math.max(0,ip-i),due:dueThisMonth(month,'finance_internet_due_day',10),cat:'Связь и интернет'}];}
function renderObligations(){
 style();const team=document.querySelector('.finance-visual-panel[data-fin-panel="team"]'),expense=document.querySelector('.finance-visual-panel[data-fin-panel="expense"]');if(!team||!expense)return;
 let month=today().slice(0,7);try{const r=financeCurrentRange();if(r?.from)month=String(r.from).slice(0,7);}catch(e){}
 const pp=payroll(month),people=(state.employees||[]).filter(e=>!e.deleted_at).map(e=>{const total=n(pp[e.id]?.payout),got=paid(e.id,month,total),left=Math.max(0,total-got),due=salaryDue(month);return {total,got,left,late:overdue(left,due)};}).filter(x=>x.total||x.got),a=people.reduce((s,x)=>({t:s.t+x.total,p:s.p+x.got,l:s.l+x.left,o:s.o+(x.late?x.left:0)}),{t:0,p:0,l:0,o:0});
 let ps=$('financePayrollStatus');if(!ps){ps=document.createElement('div');ps.id='financePayrollStatus';$('financeTeamVisual')?.insertAdjacentElement('beforebegin',ps);}if(ps)ps.innerHTML='<div class="finance-v-hero team-hero"><span>Расчёты с сотрудниками · '+esc(monthName(month))+'</span><strong>'+cash(a.l)+' к выплате</strong><small>Начислено '+cash(a.t)+' · выплачено '+cash(a.p)+(a.o?' · просрочено '+cash(a.o):'')+'</small></div>';
 let box=$('financeObligations');if(!box){box=document.createElement('div');box.id='financeObligations';$('financeExpenseVisual')?.insertAdjacentElement('beforebegin',box);}const list=obligations(month);
 const obligationLeft=list.reduce((s,x)=>s+x.left,0),obligationLate=list.reduce((s,x)=>s+(overdue(x.left,x.due)?x.left:0),0),allLeft=a.l+obligationLeft,allLate=a.o+obligationLate;
 let commitment=$('financeCommitmentStatus');
 if(!commitment){commitment=document.createElement('div');commitment.id='financeCommitmentStatus';const flow=$('financeFlowMap');flow?.insertAdjacentElement('beforebegin',commitment);}
 if(commitment)commitment.innerHTML='<div class="finance-v-hero '+(allLate>0?'expense-hero':'reserve-hero')+'"><span>Обязательства компании · '+esc(monthName(month))+'</span><strong>'+cash(allLeft)+' ещё нужно оплатить</strong><small>Зарплата '+cash(a.l)+' · офис '+cash(obligationLeft)+(allLate>0?' · просрочено '+cash(allLate):' · просрочки нет')+'</small></div>';
 const financeNav=document.querySelector('.nav-btn[data-view="view-finance"]');
 if(financeNav){
   let badge=financeNav.querySelector('.finance-overdue-badge');
   if(allLate>0){
     if(!badge){badge=document.createElement('span');badge.className='finance-overdue-badge';badge.style.cssText='position:absolute;top:4px;right:8px;min-width:16px;height:16px;padding:0 4px;border-radius:9px;background:var(--red);color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;';financeNav.style.position='relative';financeNav.appendChild(badge);}
     badge.textContent='!';
     financeNav.title='Есть просроченные обязательства: '+cash(allLate);
   }else{
     badge?.remove();
     financeNav.title='';
   }
 }
 if(box)box.innerHTML='<div class="finance-v-section-head"><strong>Обязательные платежи · '+esc(monthName(month))+'</strong><span>'+list.filter(x=>x.left>0).length+' открыто</span></div>'+list.map(o=>'<div class="obligation-row"><div class="obligation-top"><div><strong>'+esc(o.name)+'</strong><small>Срок '+fmtDate(o.due)+' · план '+cash(o.plan)+'</small></div><div>'+pill(o.left,o.due)+'<strong style="display:block">'+cash(o.left)+' осталось</strong><small>оплачено '+cash(o.paid)+'</small></div></div>'+(isAdmin()&&o.left>0?'<button class="btn btn-secondary" style="margin-top:8px" data-obligation="'+o.id+'">+ Записать оплату</button>':'')+'</div>').join('')+(isAdmin()?'<details class="finance-visual-disclosure"><summary>Сроки обязательных платежей</summary><div class="obligation-settings"><div class="field"><label>Зарплата — до числа следующего месяца</label><input id="salaryDueDay" type="number" min="1" max="28" value="'+day('finance_salary_due_day',5)+'"></div><div class="field"><label>Аренда — до числа</label><input id="rentDueDay" type="number" min="1" max="28" value="'+day('finance_rent_due_day',5)+'"></div><div class="field"><label>Интернет — до числа</label><input id="internetDueDay" type="number" min="1" max="28" value="'+day('finance_internet_due_day',10)+'"></div></div></details>':'');
 box?.querySelectorAll('[data-obligation]').forEach(b=>b.onclick=()=>{const o=list.find(x=>x.id===b.dataset.obligation);if(o)openCompanyExpenseSheet(null,o.cat);});
 [['salaryDueDay','finance_salary_due_day'],['rentDueDay','finance_rent_due_day'],['internetDueDay','finance_internet_due_day']].forEach(a=>$(a[0])?.addEventListener('change',e=>{localStorage.setItem(a[1],String(Math.max(1,Math.min(28,parseInt(e.target.value)||1))));renderObligations();}));
}
window.renderFinanceObligations=renderObligations;
const oldVisual=window.renderFinanceVisualPanels;if(typeof oldVisual==='function')window.renderFinanceVisualPanels=function(){const r=oldVisual.apply(this,arguments);try{renderObligations();}catch(e){}return r;};
const oldAll=window.renderAll;if(typeof oldAll==='function')window.renderAll=function(){const r=oldAll.apply(this,arguments);setTimeout(()=>{try{renderObligations();}catch(e){}},0);return r;};
$('ts-month')?.addEventListener('change',()=>{renderTimesheet();try{renderObligations();}catch(e){}});
setTimeout(()=>{try{renderTimesheet();renderObligations();}catch(e){console.warn('[Finance obligations]',e);}},1200);
})();

