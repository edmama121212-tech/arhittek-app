// Accountant's conservation cases: client funds are never earned by closing a building.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-20T06:00:00Z']));}static now(){return Date.parse('2026-10-20T06:00:00Z');}}
const ctx={window:{},Date:Clock,Intl,Number,Math,String,Set,Map,Array,Object};vm.createContext(ctx);
for(const file of ['project-budget.js','cash-finance.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
const c=ctx.window.ARHITTEKCash,b=ctx.window.ARHITTEKBudget;
const row=(id,type,amount,extra={})=>({id,type,amount,project_id:'repair',entry_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z',...extra});
const fresh=()=>({projects:[{id:'repair',name:'Ремонт',category_id:'build',status_id:'active',fee_percent:15,fee_paid:0,created_at:'2026-10-10T00:00:00Z',end_date:'2026-10-19',updated_at:'2026-10-19T18:00:00Z'}],categories:[{id:'build',name:'Ремонт',department_id:'construction'},{id:'arch',name:'Архитектура'}],departments:[{id:'construction',name:'Строительный отдел'}],statuses:[{id:'active',name:'В процессе'},{id:'done',name:'Завершён'}],employees:[],ledger:[row('advance','construction_budget',100000)],companyIncome:[],companyExpenses:[],invoices:[],timesheetPayments:[]});
const calculate=s=>b.calculate(s,'2026-10-20');
let count=0;function check(name,fn){fn();count++;console.log('PASS: '+name);}
function conserved(x){assert.equal(Math.round((x.companyReserve+x.projectsHeld+x.teamHeld+x.costsHeld+x.amortization)*100),Math.round(x.cashBalance*100));}
check('Construction cash and reserve are unchanged through completion, reopening and archive',()=>{
 const s=fresh();for(const status of ['active','done','active','done']){s.projects[0].status_id=status;const x=calculate(s);assert.equal(x.cashBalance,120000);assert.equal(x.companyReserve,20000);assert.equal(x.projectsHeld,100000);assert.equal(x.constructionHeld,100000);assert.equal(x.amortization,0);conserved(x);}
 s.financialProjects=[{...s.projects[0],deleted_at:'2026-10-20T01:00:00Z'}];s.projects=[];const archived=calculate(s);assert.equal(archived.projectsHeld,100000);assert.equal(archived.companyReserve,20000);assert.equal(c.amortization(s),0);conserved(archived);
});
check('An unpaid supplier bill does not deduct money or duplicate the construction hold',()=>{
 const s=fresh();s.projects[0].status_id='done';s.invoices=[{id:'bill',project_id:'repair',amount:40000,item_type:'Материал',invoice_date:'2026-10-19',created_at:'2026-10-19T11:00:00Z'}];
 const before=calculate(s);assert.equal(before.projectsHeld,100000);assert.equal(before.costsHeld,0);assert.equal(before.companyReserve,20000);
 s.ledger.push(row('partial','expense',10000,{description:'[invoice-payment:bill]'}));const after=calculate(s);assert.equal(after.cashBalance,110000);assert.equal(after.projectsHeld,90000);assert.equal(after.companyReserve,20000);assert.equal(c.invoicePaymentState(s,s.invoices[0]).remaining,30000);conserved(after);
});
check('A worker accrual is not a cash payment or personal percentage of the company markup',()=>{
 const s=fresh();s.projects[0].status_id='done';s.projects[0].employee_id='foreman';s.ledger.push(row('accrual','role_payout',7000,{payee_employee_id:'foreman'}));
 let x=b.calculate(s,'2026-10-20',{fee:()=>({mainFeeAmount:15000,mainPaid:0})});assert.equal(x.projects[0].team[0].due,7000);assert.equal(x.teamHeld,0);assert.equal(x.projectsHeld,100000);assert.equal(x.companyReserve,20000);
 s.ledger.push(row('paid','fee_payment',7000,{payee_employee_id:'foreman'}));x=calculate(s);assert.equal(x.projectsHeld,93000);assert.equal(x.companyReserve,20000);assert.equal(x.cashBalance,113000);conserved(x);
});
check('A refund to the client reduces real money and entrusted site funds without earning company markup',()=>{
 const model=require('../construction-finance.js');
 for(const refund of [row('refund','client_refund',5000),row('refund','withdrawal',5000,{purpose:'client_refund'})]){
  const s=fresh();s.ledger.push(refund);s.projects[0].status_id='done';
  const x=calculate(s),f=model.cashSummary({projectId:'repair',asOf:'2026-10-20',ledger:s.ledger,invoices:[]});
  assert.equal(f.summary.physical_cash_balance,95000);assert.equal(f.summary.client_refunds,5000);
  assert.equal(x.cashBalance,115000);assert.equal(x.projectsHeld,95000);assert.equal(x.companyReserve,20000);assert.equal(x.amortization,0);conserved(x);
  refund.deleted_at='2026-10-20T01:00:00Z';const restored=calculate(s);assert.equal(restored.cashBalance,120000);assert.equal(restored.projectsHeld,100000);assert.equal(restored.companyReserve,20000);conserved(restored);
 }
});
check('A project-linked salary payment consumes site cash once and settles its accrual once',()=>{
 const s=fresh();s.projects[0].status_id='done';s.projects[0].employee_id='foreman';s.employees=[{id:'foreman'}];s.ledger.push(row('accrual','role_payout',7000,{payee_employee_id:'foreman'}),row('paid','salary_payment',7000,{payee_employee_id:'foreman',description:'[salary:2026-10]'}));const x=calculate(s);assert.equal(x.cashBalance,113000);assert.equal(x.projectsHeld,93000);assert.equal(x.companyReserve,20000);assert.equal(x.projects[0].team[0].remaining,0);assert.equal(x.projects[0].teamPaidAfterSnapshot,7000);conserved(x);
});
check('Direct customer purchases and documentary markup do not become company cash',()=>{
 const s=fresh();s.projects[0].status_id='done';s.projects[0].fee_paid=999999;s.invoices=[{id:'client',project_id:'repair',amount:50000,paid_by_client:true,invoice_date:'2026-10-19'}];const snapshot=JSON.stringify(s),x=calculate(s);assert.equal(x.projectsHeld,100000);assert.equal(x.companyReserve,20000);assert.equal(x.amortization,0);assert.equal(JSON.stringify(s),snapshot);conserved(x);
});
check('An actual company expense spends reserve; a site expense spends site money',()=>{
 const s=fresh();s.ledger.push(row('material','expense',40000));s.companyExpenses=[{id:'office',amount:2500,expense_date:'2026-10-19',created_at:'2026-10-19T12:00:00Z'}];const x=calculate(s);assert.equal(x.cashBalance,77500);assert.equal(x.projectsHeld,60000);assert.equal(x.companyReserve,17500);conserved(x);
});
check('Company amortization applies to architecture and other company income, not building advances',()=>{
 const s=fresh();s.projects.push({id:'design',category_id:'arch',status_id:'done',end_date:'2026-10-19',created_at:'2026-10-10T00:00:00Z',updated_at:'2026-10-19T18:00:00Z'});s.ledger.push(row('design-income','advance',20000,{project_id:'design'}));s.companyIncome=[{id:'rent',amount:10000,income_date:'2026-10-19',created_at:'2026-10-19T10:00:00Z'}];const x=calculate(s);assert.equal(x.amortization,1500);assert.equal(c.amortization(s),1500);assert.equal(x.projectsHeld,100000);assert.equal(x.companyReserve,48500);conserved(x);
});
check('Changing historic construction rates and fee counters cannot manufacture reserve',()=>{
 const s=fresh();for(const rate of[0,10,15,20])for(const paid of[0,321,552243]){s.projects[0].fee_percent=rate;s.projects[0].fee_paid=paid;s.projects[0].status_id='done';const snapshot=JSON.stringify(s),x=calculate(s);assert.equal(x.companyReserve,20000);assert.equal(x.projectsHeld,100000);assert.equal(JSON.stringify(s),snapshot);conserved(x);}
});
check('A construction overrun is visible without turning a negative site balance into positive reserve',()=>{
 const s=fresh();s.ledger.push(row('overrun','expense',120000));s.projects[0].status_id='done';const x=calculate(s);assert.equal(x.cashBalance,0);assert.equal(x.companyReserve,0);assert.equal(x.projectsHeld,0);conserved(x);
});
check('Historical construction advances do not reappear as cash when the object closes',()=>{
 const s=fresh();s.ledger=[row('old','construction_budget',100000,{entry_date:'2026-09-19',created_at:'2026-09-19T10:00:00Z'})];for(const status of['active','done']){s.projects[0].status_id=status;const x=calculate(s);assert.equal(x.cashBalance,20000);assert.equal(x.companyReserve,20000);assert.equal(x.releasedOpeningFunds,0);assert.equal(x.amortization,0);conserved(x);}
});
check('Deleted, future and imported historical payments cannot spend site cash a second time',()=>{
 const s=fresh();s.ledger.push(row('deleted','expense',5000,{deleted_at:'2026-10-20T01:00:00Z'}),row('future','expense',5000,{entry_date:'2099-01-01'}),row('historical','project_expense',5000,{description:'Ранее внесённые расходы'}));const x=calculate(s);assert.equal(x.projectsHeld,100000);assert.equal(x.cashBalance,120000);assert.equal(x.companyReserve,20000);conserved(x);
});
check('A physical count preserves site liabilities instead of treating all counted money as reserve',()=>{
 const s=fresh();s.cashCounts=[{id:'count',entity_type:'reserve',action:'cash_count',created_at:'2026-10-20T04:00:00Z',changes:{cash_count:{new:{version:1,total:80000,counted_at:'2026-10-20T04:00:00Z',book_balance:120000}}}}];const x=calculate(s);assert.equal(x.cashBalance,80000);assert.equal(x.projectsHeld,100000);assert.equal(x.companyReserve,-20000);assert.equal(c.cashStatus(s).difference,40000);conserved(x);
});
check('A range of site receipts and supplier payments conserves every kopeck independently of status',()=>{
 for(const amount of[0,10000.01,100000,999999.99])for(const spent of[0,3999.99,amount,amount+3000.01]){const s=fresh();s.ledger=[row('in','advance',amount),row('out','expense',spent)];let prior;for(const status of['active','done']){s.projects[0].status_id=status;const x=calculate(s);conserved(x);assert.equal(x.amortization,0);if(prior)assert.equal(x.companyReserve,prior.companyReserve);prior=x;}}
});
console.log('PASS: '+count+' construction reserve scenarios');
