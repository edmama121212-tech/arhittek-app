/* Project payments commit their source and all derived totals on the server. */
(function(root){
 'use strict';
 const key=(action,id)=>'arhittek-project-payment-v2:'+session.employeeId+':'+action+':'+id;
 const pending=(action,id)=>{try{return JSON.parse(sessionStorage.getItem(key(action,id))||'null')}catch(_){return null}};
 async function confirm(action,payload,id){
  if(!isOwner())throw Error('Финансовые операции доступны владельцу');
  const actor=session.token,k=key(action,id);let saved=pending(action,id);
  if(saved&&JSON.stringify(saved.payload)!==JSON.stringify(payload))throw Error('Предыдущая отправка не подтверждена. Повторите её с прежними суммой, датой и назначением');
  if(!saved){saved={operation:crypto.randomUUID(),payload};sessionStorage.setItem(k,JSON.stringify(saved));}
  const result=await sb.rpc('confirm_project_payment',{p_action:action,p_payload:saved.payload,p_operation:saved.operation});
  if(actor!==session?.token)throw Error('Сессия изменилась');
  if(result.error){if(/^(22|23|42)/.test(result.error.code||''))sessionStorage.removeItem(k);throw Error(result.error.code==='PGRST202'?'Обновляется сервер платежей. Обновите приложение и повторите':result.error.message||'Не удалось подтвердить платёж');}
  if(!result.data?.entry?.id||!result.data?.project?.id)throw Error('Сервер не подтвердил платёж и итоги проекта. Повторите отправку');
  const entry=result.data.entry,project=result.data.project;
  if(action==='create'&&(entry.id!==saved.operation||entry.project_id!==payload.project_id||Number(entry.amount)!==Number(payload.amount))||action==='cancel'&&(entry.id!==payload.entry_id||!entry.deleted_at))throw Error('Ответ сервера не совпал с отправленным платежом. Повторите подтверждение');
  if(result.data.journal&&root.ARHITTEKFinanceWorkspace&&!root.ARHITTEKFinanceWorkspace.accepted(result.data.journal,{token:actor,id:session.employeeId}))throw Error('Не удалось подтвердить новый финансовый снимок. Обновите данные');
  state.projects=(state.projects||[]).map(p=>p.id===project.id?{...p,...project}:p);
  if(state.financialProjects)state.financialProjects=state.financialProjects.map(p=>p.id===project.id?{...p,...project}:p);
  state.ledger=(state.ledger||[]).filter(r=>r.id!==entry.id);if(!entry.deleted_at)state.ledger.push(entry);
  sessionStorage.removeItem(k);if(typeof renderAll==='function')renderAll();return result.data;
 }
 function lockForm(projectId){
  const frozen=!!pending('create',projectId);
  for(const id of ['payment-amount','payment-date','payment-note','payment-payee']){const el=document.getElementById(id);if(el)el.disabled=frozen;}
  document.querySelectorAll('#payment-type .yn-btn').forEach(el=>el.setAttribute('aria-disabled',String(frozen)));
  const button=document.getElementById('payment-save');if(button)button.textContent=frozen?'Подтвердить прежнюю отправку':'Сохранить платёж';
 }
 function advanceEditorVersion(before,after){
  const derived=new Set(['advance','balance','expenses','fee_paid','co_fee_paid','payment_status','updated_at','received_opening','expenses_opening']);
  if(before&&after&&Object.keys(before).every(k=>derived.has(k)||JSON.stringify(before[k])===JSON.stringify(after[k])))editingProjectLoadedAt=after.updated_at;
 }
 function salaryRate(emp,month){
  const w=state.financialJournal?.workspace;if(!state.financialJournal?.active||!w?.automatic_salaries)return Number(emp.fixed_salary)||0;
  const next=new Date(month+'-01T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const due=next.toISOString().slice(0,10);
  const rule=w.rules?.find(r=>r.employee_id===emp.id&&r.start_month<=due&&(!r.end_month||r.end_month>=due));if(rule)return Number(rule.amount)||0;
  const term=w.salary_terms?.find(t=>t.employee_id===emp.id&&t.payroll_month===month);if(term)return Number(term.monthly_rate)||0;
  return emp.active===false?0:Number(emp.fixed_salary)||0;
 }
 function hasSalaryPeriod(employee,from,to){return !!(state.financialJournal?.active&&state.financialJournal.workspace?.salary_terms?.some(t=>t.employee_id===employee&&t.payroll_month>=from.slice(0,7)&&t.payroll_month<=to.slice(0,7)));}
 function salaryDue(employee,month){return state.financialJournal?.active?state.financialJournal.workspace?.items?.find(i=>i.employee_id===employee&&i.terms?.payroll_month===month&&['employee_salary','rule'].includes(i.origin))?.due_date:null;}
 root.ProjectMoney=Object.freeze({confirm,pending,lockForm,advanceEditorVersion,salaryRate,hasSalaryPeriod,salaryDue});
})(window);
