/* Project funds stay earmarked; a construction status never releases client cash. No database writes. */
(()=>{
'use strict';
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const round=v=>Math.round(num(v)*100)/100;
const sum=rows=>round(rows.reduce((a,r)=>a+num(r.amount),0));
const salaryMonth=r=>(String(r.description||'').match(/\[salary:(\d{4}-\d{2})\]/)||[])[1];
function projectRows(s){
 const live=s.projects||[],ids=new Set(live.map(p=>p.id));
 const archived=(s.financialProjects||s.trash?.projects||[]).filter(p=>p.deleted_at&&!ids.has(p.id));
 return [...live,...archived];
}
function calculate(s,until,hooks={}){
 const cash=window.ARHITTEKCash;
 until=until||cash.day();

 const fee=hooks.fee||((p)=>typeof getProjectFee==='function'?getProjectFee(p):{});
 const manager=hooks.manager||((id)=>typeof projectEmployeeRole==='function'?projectEmployeeRole(id)==='manager':/менеджер/i.test((s.employees||[]).find(e=>e.id===id)?.role||''));
 const construction=hooks.construction||((p)=>cash.constructionProject(s,p));
 const cashBalance=cash.balance(s,until),amortization=cash.amortization(s,until,construction);
 if(cashBalance===null)return {cashBalance:null,available:null,companyReserve:null,amortization,projectsHeld:0,constructionHeld:0,teamHeld:0,costsHeld:0,projects:[],warnings:[]};
 const expenses=hooks.expenses||((p)=>typeof getProjectExpenses==='function'?getProjectExpenses(p):num(p.expenses));
 const salary=hooks.salary||((e,month)=>typeof salaryForRange==='function'?salaryForRange(e,month+'-01',new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10)):num(e.fixed_salary));
 const live=(s.ledger||[]).filter(r=>!r.deleted_at&&r.entry_date&&r.entry_date<=until);
 const events=cash.cashEvents(s).filter(e=>e.date<=until);
 const post=events.filter(e=>e.afterSnapshot),postIds=new Set(post.map(e=>e.row.id).filter(Boolean));
 const isPost=r=>r.id?postIds.has(r.id):events.some(e=>e.row===r&&e.afterSnapshot);
 const projects=projectRows(s);
 const details=[],items=[],warnings=[];
 for(const p of projects){
  const isConstruction=construction(p);
  const statusChanges=(s.financialStatusHistory||s.history||[]).filter(a=>a.entity_id===p.id&&a.changes?.status_id&&Number.isFinite(Date.parse(a.created_at))).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  let statusId=p.status_id;
  statusChanges.filter(a=>cash.day(new Date(a.created_at))>until).forEach(a=>statusId=a.changes.status_id.old);
  const completion=statusChanges.find(a=>a.changes.status_id.new===statusId&&cash.day(new Date(a.created_at))<=until);
  // updated_at changes for names, notes, contracts and stages too; it is not
  // evidence that a project was completed or that money was released.
  const completionDay=completion?cash.day(new Date(completion.created_at)):p.end_date;
  const completed=/заверш/i.test((s.statuses||[]).find(x=>x.id===statusId)?.name||'')&&(until===cash.day()||!completionDay||completionDay<=until);
  const movements=post.filter(e=>e.row.project_id===p.id);
  const receipts=round(movements.filter(e=>e.amount>0).reduce((a,e)=>a+e.amount,0));
  const projectAmort=isConstruction?0:round(movements.filter(e=>e.amount>0&&!cash.isAdjustment(e.row)).reduce((a,e)=>a+Math.round(e.amount*5)/100,0));
  const directPayments=round(movements.filter(e=>e.amount<0&&cash.flowGroup(e)!=='team').reduce((a,e)=>a-e.amount,0));
  const closingAfterSnapshot=completed&&(completion
   ?Date.parse(completion.created_at)>Date.parse(cash.cutoff)
   :!!p.end_date&&p.end_date>=cash.cutoff.slice(0,10)&&p.end_date<=until);
  const invoiceRows=(s.invoices||[]).filter(i=>!i.deleted_at&&i.project_id===p.id&&!i.paid_by_client&&Date.parse(i.created_at)>Date.parse(cash.cutoff)&&String(i.invoice_date||i.created_at).slice(0,10)<=until);
  const eligible=movements.length>0||closingAfterSnapshot||invoiceRows.length>0;
  const projectInvoices=(s.invoices||[]).filter(i=>!i.deleted_at&&i.project_id===p.id&&String(i.invoice_date||i.created_at||'').slice(0,10)<=until);
  const manualCost=Math.max(0,expenses(p)-(construction(p)?sum(projectInvoices):0));
  const manualPaid=sum(live.filter(r=>r.project_id===p.id&&['expense','project_expense','payment'].includes(r.type)&&!r.payee_employee_id&&!cash.invoicePaymentId(r)&&(!cash.isImportedExpense(r)||r.entry_date<cash.cutoff.slice(0,10))));
  const manualHold=completed&&closingAfterSnapshot?Math.max(0,round(manualCost-manualPaid)):0;
  const costHold=!isConstruction&&completed&&eligible?round(manualHold+invoiceRows.reduce((a,i)=>a+cash.invoicePaymentState(s,i,until).remaining,0)):0;
  const oldFunds=round(events.filter(e=>e.row.project_id===p.id&&!e.afterSnapshot&&e.date<=cash.cutoff.slice(0,10)&&Number.isFinite(Date.parse(e.row.created_at))).reduce((a,e)=>a+e.amount,0));
  const d={id:p.id,name:p.name,construction:isConstruction,archived:!!p.deleted_at,completed,eligible,closingAfterSnapshot,openingProjectFunds:Math.max(0,oldFunds),releasedOpeningFunds:0,openingFundsUsed:0,receivedAfterSnapshot:receipts,amortization:projectAmort,directPaidAfterSnapshot:directPayments,teamPaidAfterSnapshot:0,projectHeld:0,teamHeld:0,costsHeld:costHold,team:[]};
  details.push(d);
  const f=fee(p)||{},roleRows=live.filter(r=>r.project_id===p.id&&r.type==='role_payout');
  const add=(id,amount,month,legacy=0)=>{
   if(!id||amount<=0||!month)return;
   let item=items.find(x=>x.projectId===p.id&&x.employeeId===id&&x.month===month);
   if(!item){item={projectId:p.id,employeeId:id,month,ref:p.end_date||p.created_at||'',due:0,legacy:0,paid:0,paidPost:0,salaryPaid:0,salaryPaidBefore:0,salaryPaidPost:0};items.push(item);}
   item.due=round(item.due+amount);item.legacy=round(item.legacy+legacy);
  };
  if(p.fee_base==='m2'||isConstruction){
   if(completed)roleRows.forEach(r=>add(r.payee_employee_id,num(r.amount),String(p.end_date||p.created_at||'').slice(0,7)));
  }else{
   [[p.employee_id,num(f.mainFeeAmount),num(f.mainPaid),num(f.feePercent)],
    [p.co_employee_id,num(f.coFeeAmount),num(f.coPaid),num(f.coFeePercent)]].forEach(([id,amount,legacy,rate])=>{
    if(!id)return;
    if(manager(id)&&!construction(p)){
     const byMonth=new Map();
     live.filter(r=>r.project_id===p.id&&['advance','final_payment','income'].includes(r.type)).forEach(r=>{
      const m=r.entry_date.slice(0,7);byMonth.set(m,round((byMonth.get(m)||0)+Math.max(0,num(r.amount))*Math.max(0,rate)/100));
     });
     for(const [m,a] of [...byMonth].sort())add(id,a,m);
     const own=items.filter(x=>x.projectId===p.id&&x.employeeId===id);
     for(const x of own){const paid=Math.min(legacy,x.due);x.legacy+=paid;legacy-=paid;}
    }else if(completed)add(id,amount,String(p.end_date||p.created_at||'').slice(0,7),legacy);
   });
   if(completed&&construction(p))roleRows.forEach(r=>add(r.payee_employee_id,num(r.amount),String(p.end_date||p.created_at||'').slice(0,7)));
  }
 }
 // A fee payment and the project's fee_paid counter describe the same payment.
 for(const x of items){
  const rows=live.filter(r=>['fee_payment','salary_payment'].includes(r.type)&&r.project_id===x.projectId&&(r.payee_employee_id||projects.find(p=>p.id===r.project_id)?.employee_id)===x.employeeId&&(!manager(x.employeeId)||r.entry_date.slice(0,7)===x.month));
  x.paid=Math.max(sum(rows),x.legacy);x.paidPost=sum(rows.filter(isPost));
 }
 // Monthly payroll can pay project fees too. Allocate it once, after the guaranteed salary and bonuses.
 const groups=new Map();
 items.sort((a,b)=>String(a.ref).localeCompare(String(b.ref))||String(a.projectId).localeCompare(String(b.projectId)));
 items.forEach(x=>{const key=x.employeeId+'|'+x.month;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);});
 for(const group of groups.values()){
  const first=group[0],e=(s.employees||[]).find(e=>e.id===first.employeeId)||{};
  const rows=live.filter(r=>r.type==='salary_payment'&&!r.project_id&&r.payee_employee_id===first.employeeId&&salaryMonth(r)===first.month);
  const fixed=e.is_salaried?Math.max(0,salary(e,first.month)):0;
  const bonuses=sum(live.filter(r=>r.type==='bonus'&&r.payee_employee_id===first.employeeId&&r.entry_date.slice(0,7)===first.month));
  let pool=Math.max(0,sum(rows)-fixed-bonuses),oldPool=Math.max(0,sum(rows.filter(r=>!isPost(r)))-fixed-bonuses);
  const legacy=(s.timesheetPayments||[]).some(t=>t.employee_id===first.employeeId&&t.month===first.month&&t.paid&&t.paid_at&&Date.parse(t.paid_at)<=Date.parse(cash.cutoff));
  for(const x of group){
   const left=Math.max(0,x.due-x.paid),paid=Math.min(left,pool),before=Math.min(left,oldPool);
   x.salaryPaid=paid;x.salaryPaidBefore=before;x.salaryPaidPost=round(paid-before);x.paid=round(x.paid+paid);x.paidPost=round(x.paidPost+x.salaryPaidPost);
   pool=round(pool-paid);oldPool=round(oldPool-before);
   if(legacy&&!rows.length&&!live.some(r=>r.type==='fee_payment'&&r.project_id===x.projectId))x.paid=x.due;
  }
 }
 for(const d of details){
  const own=items.filter(x=>x.projectId===d.id);
  d.team=own.map(x=>({employeeId:x.employeeId,month:x.month,due:x.due,paid:x.paid,remaining:Math.max(0,round(x.due-x.paid))}));
  const explicit=post.filter(e=>e.row.project_id===d.id&&e.amount<0&&cash.flowGroup(e)==='team').reduce((a,e)=>a-e.amount,0);
  d.teamPaidAfterSnapshot=round(explicit+own.reduce((a,x)=>a+x.salaryPaidPost,0));
  d.openingProjectFunds=Math.max(0,round(d.openingProjectFunds-own.reduce((a,x)=>a+x.salaryPaidBefore,0)));
  d.teamHeld=!d.construction&&d.completed&&d.eligible?round(d.team.reduce((a,x)=>a+x.remaining,0)):0;
  const projectMovement=round(d.receivedAfterSnapshot-d.amortization-d.directPaidAfterSnapshot-d.teamPaidAfterSnapshot);
  if(d.construction||!d.completed){d.projectHeld=Math.max(0,projectMovement);d.openingFundsUsed=Math.min(d.openingProjectFunds,Math.max(0,-projectMovement));}
  if(!d.construction&&d.closingAfterSnapshot)d.releasedOpeningFunds=d.openingProjectFunds;
  d.companyContribution=!d.construction&&d.completed&&d.eligible?round(projectMovement-d.teamHeld-d.costsHeld):0;
  if(d.eligible&&d.completed&&d.teamHeld>0)warnings.push({projectId:d.id,type:'unpaid-team',amount:d.teamHeld});
 }
 const constructionHeld=round(details.filter(d=>d.construction).reduce((a,d)=>a+d.projectHeld,0));
 const projectsHeld=round(details.reduce((a,d)=>a+d.projectHeld,0)),teamHeld=round(details.reduce((a,d)=>a+d.teamHeld,0)),costsHeld=round(details.reduce((a,d)=>a+d.costsHeld,0));
 const releasedOpeningFunds=round(details.reduce((a,d)=>a+d.releasedOpeningFunds,0)),openingFundsUsed=round(details.reduce((a,d)=>a+d.openingFundsUsed,0));
 // Every allocation uses the same cash base. A historical advance is evidence
 // for reconciliation, never a new receipt on completion or an expense offset.
 const counted=typeof cash.cashCount==='function'&&!!cash.cashCount(s,until);
 const companyReserve=round(cashBalance-amortization-projectsHeld-teamHeld-costsHeld);
 return {cashBalance,amortization,projectsHeld,constructionHeld,teamHeld,costsHeld,releasedOpeningFunds,openingFundsUsed,countedCash:counted,companyReserve,available:companyReserve,beforeTeam:round(companyReserve+teamHeld),projects:details.filter(d=>d.eligible),warnings};
}
window.ARHITTEKBudget={calculate,projectRows};
})();

