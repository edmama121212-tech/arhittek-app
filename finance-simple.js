/* ARHITTEK: one financial workspace, existing records and payment forms. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),n=v=>Number.isFinite(Number(v))?Number(v):0,esc=v=>escapeHtml(String(v??'')),money=v=>fmtMoney(n(v));
let tab='overview',month=new Date().toLocaleDateString('sv-SE').slice(0,7);
function rows(){
 const range=timesheetMonthRange(month),earned=completedProjectEarningsForRange(range.from,range.to).employees,split=splitPayrollByEmployee(earned).result;
 return (state.employees||[]).filter(e=>!e.deleted_at&&(e.active!==false||n(split[e.id]?.payout)>0)).map(e=>({employee:e,...salaryPaymentState(e.id,month,n(split[e.id]?.payout))})).filter(r=>r.due||r.paid);
}
function office(kind){
 const expected=Math.max(0,n(localStorage.getItem('forecast_'+kind)??(kind==='rent'?110000:2500))),category=kind==='rent'?'Аренда':'Связь и интернет';
 const records=(state.companyExpenses||[]).filter(x=>!x.deleted_at&&x.category===category&&period(x)===month);
 const paid=records.reduce((s,x)=>s+n(x.amount),0),remaining=Math.max(0,expected-paid),day=Math.max(1,Math.min(28,n(localStorage.getItem('finance_'+kind+'_due_day')||(kind==='rent'?5:10))));
 const dueDate=month+'-'+String(day).padStart(2,'0');
 return {kind,category,expected,paid,remaining,dueDate,overdue:remaining>0&&today()>dueDate,records};
}
function today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function period(x){return (String(x.description||'').match(/период\s+(\d{4}-\d{2})/i)||[])[1]||String(x.expense_date||'').slice(0,7);}
function badge(x){return '<span class="sf-status '+(x.overdue?'late':x.remaining<=0?'ok':'')+'">'+(x.remaining<=0?'Оплачено':x.overdue?'Просрочено':'Срок до '+fmtDate(x.dueDate))+'</span>';}
function button(label,action,id=''){return '<button type="button" class="btn btn-secondary" data-sf-action="'+action+'" data-id="'+esc(id)+'">'+label+'</button>';}
function transactions(){
 const list=[];
 (state.companyIncome||[]).filter(x=>!x.deleted_at&&x.category!==RESERVE_INCREASE_CATEGORY).forEach(x=>list.push({id:x.id,type:'income',date:x.income_date,label:x.category||'Поступление',note:x.description,amount:n(x.amount)}));
 (state.companyExpenses||[]).filter(x=>!x.deleted_at&&x.category!==RESERVE_DECREASE_CATEGORY).forEach(x=>list.push({id:x.id,type:'expense',date:x.expense_date,label:x.category||'Расход',note:x.description,amount:-n(x.amount)}));
 (state.ledger||[]).filter(x=>!x.deleted_at&&x.type==='salary_payment').forEach(x=>list.push({id:x.id,type:'salary',date:x.entry_date,label:'Зарплата · '+(findEmployee(x.payee_employee_id)?.name||'Сотрудник'),note:x.description,amount:-n(x.amount),employee:x.payee_employee_id,month:(String(x.description||'').match(/\[salary:(\d{4}-\d{2})\]/)||[])[1]}));
 return list.filter(x=>String(x.date||'').slice(0,7)===month).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function render(){
 const view=$('view-finance');if(!view||!session?.isAdmin)return;
 let root=$('simpleFinance');if(!root){root=document.createElement('section');root.id='simpleFinance';view.appendChild(root);}
 const people=rows(),rent=office('rent'),internet=office('internet'),items=transactions(),reserve=getCompanyReserveBalance();
 const salaryLeft=people.reduce((s,x)=>s+x.remaining,0),planned=salaryLeft+rent.remaining+internet.remaining,late=people.reduce((s,x)=>s+(x.overdue?x.remaining:0),0)+(rent.overdue?rent.remaining:0)+(internet.overdue?internet.remaining:0);
 const received=items.filter(x=>x.amount>0).reduce((s,x)=>s+x.amount,0),spent=-items.filter(x=>x.amount<0).reduce((s,x)=>s+x.amount,0);
 let html='<div class="sf-top"><div><h2>Финансы компании</h2><p>Деньги, оплаты и остатки — в одном месте.</p></div><label>Месяц<input type="month" id="sfMonth" value="'+month+'"></label></div><nav class="sf-tabs">'+[['overview','Главное'],['payments','Зарплата и аренда'],['journal','Операции'],['settings','Настройки']].map(([id,name])=>'<button data-sf-tab="'+id+'" class="'+(tab===id?'active':'')+'">'+name+'</button>').join('')+'</nav>';
 if(tab==='overview'){
 html+='<div class="sf-grid"><div class="sf-card"><small>Указанный остаток денег</small><strong>'+money(reserve)+'</strong>'+button('Изменить остаток','reserve')+'<p>Сверяется вручную с кассой и счетами. Поступления и расходы не меняют его автоматически.</p></div><div class="sf-card"><small>Ещё нужно оплатить за месяц</small><strong>'+money(planned)+'</strong><p>Зарплата '+money(salaryLeft)+'<br>Аренда '+money(rent.remaining)+'<br>Интернет '+money(internet.remaining)+'</p>'+button('Посмотреть и оплатить','payments')+'</div></div>';
 html+='<div class="sf-grid"><div class="sf-card"><small>Внесённые поступления за месяц</small><strong class="positive">'+money(received)+'</strong>'+button('+ Поступление','income')+'</div><div class="sf-card"><small>Внесённые оплаты за месяц</small><strong>'+money(spent)+'</strong>'+button('+ Расход','expense')+'</div></div>';
 html+='<div class="sf-note">Поступления здесь — записи в разделе «Операции». Выручка по договорам и расчётная прибыль не прибавляются к остатку денег.</div>';
 if(late)html+='<div class="sf-note late">Не отмечены оплаты после срока: '+money(late)+'. Если уже заплатили — внесите оплату. '+button('Проверить','payments')+'</div>';
 }else if(tab==='payments'){
 html+='<h3>Зарплата за '+esc(ruMonthLabel(month))+'</h3><p class="sf-muted">Оклад + начисления по завершённым проектам + премии. Частичные выплаты уменьшают остаток.</p>';
 html+=people.map(x=>'<article class="sf-card sf-payment"><div class="sf-row"><h3>'+esc(x.employee.name)+'</h3>'+badge(x)+'</div><div class="sf-metrics"><span>Начислено<b>'+money(x.due)+'</b></span><span>Выплачено<b class="positive">'+money(x.paid)+'</b></span><span>Осталось<b>'+money(x.remaining)+'</b></span></div><div class="sf-actions">'+button(x.remaining?'Добавить выплату':'История выплат','salary',x.employee.id)+button('Редактировать оклад','employee',x.employee.id)+button('Начисления и выплаты','timesheet',x.employee.id)+'</div></article>').join('')||'<p>Начислений нет.</p>';
 html+='<h3>Аренда и интернет</h3>'+[rent,internet].map(x=>'<article class="sf-card"><div class="sf-row"><h3>'+esc(x.category)+'</h3>'+badge(x)+'</div><div class="sf-metrics"><span>За месяц<b>'+money(x.expected)+'</b></span><span>Оплачено<b class="positive">'+money(x.paid)+'</b></span><span>Осталось<b>'+money(x.remaining)+'</b></span></div><div class="sf-actions">'+button('Добавить оплату','office',x.kind)+button('Изменить сумму и срок','settings')+'</div>'+x.records.map(r=>'<div class="sf-row sf-history"><span>'+fmtDate(r.expense_date)+' · '+money(r.amount)+'</span>'+button('Редактировать','edit-expense',r.id)+'</div>').join('')+'</article>').join('');
 }else if(tab==='journal'){
 html+='<div class="sf-actions">'+button('+ Поступление','income')+button('+ Расход','expense')+button('Выплата зарплаты','payments')+button('Вывод денег','withdraw')+'</div><h3>Записанные операции за месяц</h3>';
 html+=items.length?items.map(x=>'<article class="sf-card sf-row"><div><b>'+esc(x.label)+'</b><p>'+fmtDate(x.date)+' · '+esc(String(x.note||'').replace(/\[salary:[^\]]+\]/,''))+'</p></div><div><strong class="'+(x.amount>0?'positive':'')+'">'+(x.amount>0?'+':'−')+money(Math.abs(x.amount))+'</strong>'+button('Редактировать','edit-'+x.type,x.id)+'</div></article>').join(''):'<div class="sf-card">Операций за этот месяц нет.</div>';
 }else{
 html+='<div class="sf-card"><h3>Плановые расходы</h3><div class="sf-settings">'+[['forecast_rent','Аренда в месяц, ₽',rent.expected],['finance_rent_due_day','Аренда — до числа',rent.dueDate.slice(-2)],['forecast_internet','Интернет в месяц, ₽',internet.expected],['finance_internet_due_day','Интернет — до числа',internet.dueDate.slice(-2)],['finance_salary_due_day','Зарплата — до числа следующего месяца',localStorage.getItem('finance_salary_due_day')||10]].map(([key,label,value])=>'<label>'+label+'<input type="number" data-sf-setting="'+key+'" min="'+(key.includes('day')?1:0)+'" '+(key.includes('day')?'max="28"':'')+' value="'+value+'"></label>').join('')+'</div>'+button('Сохранить настройки','save-settings')+'<p>Эти настройки действуют в этом браузере и применяются к расчёту выбранных месяцев.</p></div><div class="sf-card"><h3>Остаток денег</h3><strong>'+money(reserve)+'</strong>'+button('Редактировать остаток','reserve')+'</div><div class="sf-card"><h3>Сотрудники и оклады</h3>'+(state.employees||[]).filter(x=>!x.deleted_at&&x.active!==false).map(x=>'<div class="sf-row sf-history"><span>'+esc(x.name)+' · '+(x.is_salaried?money(x.fixed_salary):'по проектам')+'</span>'+button('Редактировать','employee',x.id)+'</div>').join('')+'</div>';
 }
 root.innerHTML=html;
 $('sfMonth').onchange=e=>{if(e.target.value){month=e.target.value;render();}};
 root.querySelectorAll('[data-sf-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.sfTab;render();});
 root.querySelectorAll('[data-sf-action]').forEach(b=>b.onclick=()=>act(b.dataset.sfAction,b.dataset.id));
}
function act(action,id){
 if(!session?.isAdmin)return;
 if(['payments','settings'].includes(action)){tab=action;render();return;}
 if(action==='reserve')openReserveCorrection();
 if(action==='income')openCompanyIncomeSheet(null);
 if(action==='expense')openCompanyExpenseSheet(null);
 if(action==='withdraw')openCompanyWithdrawal();
 if(action==='employee')openEmployeeSheet(id);
 if(action==='salary')openSalaryPaymentSheet(id,month);
 if(action==='timesheet'){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$('view-timesheet').classList.add('active');$('ts-month').value=month;timesheetExpanded[id]=true;renderTimesheet();}
 if(action==='office'){
 const x=office(id);openCompanyExpenseSheet(null,x.category);$('cex-amount').value=x.remaining||'';$('cex-desc').value='Оплата · период '+month;$('cex-date').value=today();
 }
 if(action==='edit-income')openCompanyIncomeSheet(id);
 if(action==='edit-expense')openCompanyExpenseSheet(id);
 if(action==='edit-salary'){
 const r=(state.ledger||[]).find(x=>x.id===id);const m=(String(r?.description||'').match(/\[salary:(\d{4}-\d{2})\]/)||[])[1];
 if(r&&m){openSalaryPaymentSheet(r.payee_employee_id,m);$('salaryPaymentHistory')?.querySelector('[data-edit-salary-payment="'+id+'"]')?.click();}
 }
 if(action==='save-settings'){
 const inputs=[...$('simpleFinance').querySelectorAll('[data-sf-setting]')];
 if(inputs.some(i=>!i.value||!Number.isFinite(Number(i.value))||n(i.value)<n(i.min)||(i.max&&n(i.value)>n(i.max)))){showToast('Проверьте суммы и числа от 1 до 28');return;}
 inputs.forEach(i=>localStorage.setItem(i.dataset.sfSetting,i.value));render();if(typeof renderTimesheet==='function')renderTimesheet();showToast('Настройки сохранены');
 }
}
function init(){
 if(!$('sfStyle')){const s=document.createElement('style');s.id='sfStyle';s.textContent=`#view-finance>:not(#simpleFinance){display:none!important}#simpleFinance{max-width:1100px;margin:auto}.sf-top,.sf-row,.sf-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.sf-top{margin-bottom:20px}.sf-top h2{font-size:30px;margin:0}.sf-top p,.sf-card p,.sf-muted{color:var(--text-dim);font-size:13px;line-height:1.6}.sf-top label,.sf-settings label{display:grid;gap:8px;font-size:12px}.sf-top input,.sf-settings input{padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text)}.sf-tabs{display:flex;gap:6px;margin-bottom:24px;flex-wrap:wrap}.sf-tabs button{padding:12px 18px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);cursor:pointer}.sf-tabs .active{background:var(--blue);color:white}.sf-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.sf-card{padding:22px;border:1px solid var(--line);border-radius:16px;background:var(--card);margin-bottom:16px}.sf-card>strong{display:block;font-size:30px;margin:12px 0}.sf-card small{color:var(--text-dim)}.sf-card h3{margin:0 0 12px;font-size:17px}.sf-actions{justify-content:flex-start;flex-wrap:wrap;margin:14px 0}.sf-card .btn,.sf-note .btn,.sf-actions .btn{width:auto;padding:10px 14px}.sf-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}.sf-metrics span{font-size:12px;color:var(--text-dim)}.sf-metrics b{display:block;font-size:20px;color:var(--text);margin-top:6px}.sf-history{border-top:1px solid var(--line);padding-top:12px;margin-top:12px;font-size:13px}.sf-status{font-size:12px;color:var(--gold)}.sf-status.ok,.positive{color:var(--green)!important}.late{color:var(--red)!important}.sf-note{border:1px solid var(--line);border-radius:12px;padding:16px;font-size:13px;margin-bottom:16px;line-height:1.6}.sf-settings{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}@media(max-width:600px){.sf-grid,.sf-settings{grid-template-columns:1fr}.sf-top{align-items:flex-start;flex-direction:column}.sf-card{padding:16px}.sf-metrics{gap:8px}.sf-metrics b{font-size:16px}.sf-row{flex-wrap:wrap}.sf-tabs button{flex:1;padding:10px;font-size:12px}}`;document.head.appendChild(s);}
 render();
}
for(const name of ['renderAll','renderAnalytics','renderCompanyBudget','renderCompanyExpensesList','renderCompanyIncomeList','renderTimesheet']){
 const old=window[name];if(typeof old==='function')window[name]=function(){const r=old.apply(this,arguments);setTimeout(render,0);return r;};
}
window.renderSimpleFinance=render;
init();setTimeout(init,1500);
})();
