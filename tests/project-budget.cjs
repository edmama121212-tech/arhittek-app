const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-11T09:00:00Z']));}}
const ctx={window:{},Date:Clock,Intl,Number,Math,String,Set,Map};vm.createContext(ctx);
for(const file of ['project-budget.js','cash-finance.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
const c=ctx.window.ARHITTEKCash,b=ctx.window.ARHITTEKBudget;
const event=(id,type,amount,project_id,extra={})=>({id,type,amount,project_id,entry_date:'2026-10-10',created_at:'2026-10-10T00:00:00Z',...extra});
const hooks={fee:p=>({mainFeeAmount:p.mainFee||0,coFeeAmount:p.coFee||0,mainPaid:p.fee_paid||0,coPaid:p.co_fee_paid||0,feePercent:p.fee_percent||0,coFeePercent:p.co_fee_percent||0}),manager:id=>id==='manager',construction:p=>p.kind==='build'};
const fresh=()=>({projects:[],employees:[],ledger:[],companyIncome:[],companyExpenses:[],invoices:[],timesheetPayments:[],statuses:[{id:'done',name:'Завершён'},{id:'active',name:'В процессе'}]});
let count=0;function check(name,fn){fn();count++;console.log('PASS: '+name);}
check('An advance funds its project without increasing or decreasing free company money',()=>{
 const s=fresh();s.projects=[{id:'p',status_id:'active'}];s.ledger=[event('a','advance',30000,'p')];
 const x=b.calculate(s,undefined,hooks);assert.equal(x.cashBalance,50000);assert.equal(x.projectsHeld,28500);assert.equal(x.amortization,1500);assert.equal(x.available,20000);
});
check('Completion transfers the project remainder; paying the reserved fee does not debit it again',()=>{
 const s=fresh(),p={id:'p',status_id:'active',mainFee:34000,employee_id:'executor',end_date:'2026-10-10'};s.projects=[p];
 s.ledger=[event('a','advance',30000,'p'),event('f','final_payment',55000,'p')];assert.equal(b.calculate(s,undefined,hooks).available,20000);
 p.status_id='done';let x=b.calculate(s,undefined,hooks);assert.equal(x.teamHeld,34000);assert.equal(x.available,66750);
 s.ledger.push(event('pay','fee_payment',34000,'p',{payee_employee_id:'executor'}));p.fee_paid=34000;
 x=b.calculate(s,undefined,hooks);assert.equal(x.cashBalance,71000);assert.equal(x.teamHeld,0);assert.equal(x.available,66750);
 s.ledger.at(-1).deleted_at='cancelled';p.fee_paid=0;assert.equal(b.calculate(s,undefined,hooks).available,66750);
});
check('Project costs spend the earmarked advance; coffee spends the company reserve once',()=>{
 const s=fresh();s.projects=[{id:'p',status_id:'active',employee_id:'executor',mainFee:10000,end_date:'2026-10-10'}];
 s.ledger=[event('a','advance',50000,'p'),event('e','project_expense',5000,'p')];assert.equal(b.calculate(s,undefined,hooks).available,20000);
 s.companyExpenses=[{id:'coffee',amount:1000,expense_date:'2026-10-10',created_at:'2026-10-10T00:00:00Z'}];assert.equal(b.calculate(s,undefined,hooks).available,19000);
 s.projects[0].status_id='done';assert.equal(b.calculate(s,undefined,hooks).available,51500);
});
check('Monthly salary payment closes a project fee, with no second deduction at completion',()=>{
 const s=fresh();s.employees=[{id:'executor'}];s.projects=[{id:'p',status_id:'done',employee_id:'executor',mainFee:20000,end_date:'2026-10-01'}];
 s.ledger=[event('a','final_payment',65000,'p'),event('s','salary_payment',20000,null,{payee_employee_id:'executor',description:'[salary:2026-10]'})];
 const x=b.calculate(s,undefined,hooks);assert.equal(x.teamHeld,0);assert.equal(x.available,61750);assert.equal(x.projects[0].teamPaidAfterSnapshot,20000);
});
check('Guaranteed salary is separate from project fees and cannot falsely settle them',()=>{
 const s=fresh();s.employees=[{id:'executor',is_salaried:true,fixed_salary:50000}];s.projects=[{id:'p',status_id:'done',employee_id:'executor',mainFee:10000,end_date:'2026-10-10'}];
 s.ledger=[event('a','final_payment',100000,'p'),event('s','salary_payment',50000,null,{payee_employee_id:'executor',description:'[salary:2026-10]'})];
 assert.equal(b.calculate(s,undefined,hooks).teamHeld,10000);
});
check('Active manager commission paid through payroll comes from the project pool',()=>{
 const s=fresh();s.employees=[{id:'manager'}];s.projects=[{id:'p',status_id:'active',employee_id:'manager',fee_percent:25}];
 s.ledger=[event('a','advance',30000,'p')];assert.equal(b.calculate(s,undefined,hooks).available,20000);
 s.ledger.push(event('s','salary_payment',7500,null,{payee_employee_id:'manager',description:'[salary:2026-10]'}));
 const x=b.calculate(s,undefined,hooks);assert.equal(x.projectsHeld,21000);assert.equal(x.available,20000);
});
check('A completed unpaid invoice holds money; paying it releases that hold without a second debit',()=>{
 const s=fresh();s.projects=[{id:'p',status_id:'done',kind:'build',end_date:'2026-10-10'}];s.ledger=[event('a','construction_budget',50000,'p')];
 s.invoices=[{id:'i',project_id:'p',amount:10000,invoice_date:'2026-10-10',created_at:'2026-10-10T00:00:00Z'}];
 let x=b.calculate(s,undefined,hooks);assert.equal(x.costsHeld,10000);assert.equal(x.available,57500);
 s.ledger.push(event('e','expense',10000,'p',{description:'[invoice-payment:i] material'}));x=b.calculate(s,undefined,hooks);assert.equal(x.costsHeld,0);assert.equal(x.available,57500);
});
check('An old advance cannot increase recorded money or free reserve on closing',()=>{
 const s=fresh();s.projects=[{id:'p',status_id:'done',employee_id:'executor',mainFee:34000,end_date:'2026-10-06',updated_at:'2026-10-11T07:25:00Z'}];
 s.ledger=[event('old','advance',30000,'p',{entry_date:'2026-09-23',created_at:'2026-09-23T00:00:00Z'}),event('f','final_payment',55000,'p')];
 const x=b.calculate(s,undefined,hooks);assert.equal(x.cashBalance,75000);assert.equal(x.releasedOpeningFunds,30000);assert.equal(x.available,38250);assert.equal(x.companyReserve+x.amortization+x.projectsHeld+x.teamHeld+x.costsHeld,x.cashBalance);
 assert.equal(JSON.stringify(b.calculate(s,undefined,hooks)),JSON.stringify(b.calculate(s,undefined,hooks)));
});
check('Actual-derived sanitized reconciliation separates 140400 cash, project advances, and the unpaid 34000 fee',()=>{
 const s=fresh();s.employees=[{id:'paid-executor'},{id:'executor'},{id:'salaried',is_salaried:true,fixed_salary:50000}];
 s.projects=[{id:'closed-old',status_id:'done',employee_id:'paid-executor',mainFee:20000,end_date:'2026-10-01'},
  {id:'closed-new',status_id:'done',employee_id:'executor',mainFee:34000,end_date:'2026-10-06',updated_at:'2026-10-11T07:25:00Z'},
  {id:'active-one',status_id:'active'},{id:'active-two',status_id:'active'}];
 s.ledger=[event('historical','advance',30000,'closed-new',{entry_date:'2026-09-23',created_at:'2026-09-23T00:00:00Z'}),event('h','final_payment',65000,'closed-old'),event('i','advance',30000,'active-one'),event('e','advance',40000,'active-two'),event('m','final_payment',55000,'closed-new'),
  event('s1','salary_payment',20000,null,{payee_employee_id:'paid-executor',description:'[salary:2026-10]'}),event('s2','salary_payment',7000,null,{payee_employee_id:'salaried',description:'[salary:2026-10]'})];
 s.companyExpenses=[{id:'expenses',amount:42600,expense_date:'2026-10-10',created_at:'2026-10-10T00:00:00Z'}];
 const x=b.calculate(s,undefined,hooks);assert.equal(x.cashBalance,140400);assert.equal(x.projectsHeld,66500);assert.equal(x.teamHeld,34000);assert.equal(x.amortization,9500);assert.equal(x.releasedOpeningFunds,30000);assert.equal(x.available,30400);
 s.ledger.push(event('fee','fee_payment',34000,'closed-new',{payee_employee_id:'executor'}));s.projects[1].fee_paid=34000;assert.equal(b.calculate(s,undefined,hooks).available,30400);
});
check('An old advance cannot offset an actual payment in the current cash base',()=>{
 const s=fresh();s.projects=[{id:'p',status_id:'active'}];s.ledger=[event('old','advance',30000,'p',{entry_date:'2026-09-23',created_at:'2026-09-23T00:00:00Z'}),event('expense','project_expense',5000,'p')];
 const x=b.calculate(s,undefined,hooks);assert.equal(x.cashBalance,15000);assert.equal(x.openingFundsUsed,5000);assert.equal(x.available,15000);
});
check('A final receipt on a project closed before the snapshot does not re-transfer its old advance',()=>{
 const s=fresh();s.projects=[{id:'p',status_id:'done',employee_id:'executor',mainFee:20000,end_date:'2026-10-01',updated_at:'2026-10-10T00:00:00Z'}];
 s.ledger=[event('old','advance',40000,'p',{entry_date:'2026-08-14',created_at:'2026-08-14T00:00:00Z'}),event('new','final_payment',65000,'p'),event('s','salary_payment',20000,null,{payee_employee_id:'executor',description:'[salary:2026-10]'})];
 const x=b.calculate(s,undefined,hooks);assert.equal(x.releasedOpeningFunds,0);assert.equal(x.available,61750);
});
check('Reopening a project returns its share to the project; closing again does not multiply the transfer',()=>{
 const s=fresh(),p={id:'p',status_id:'done',employee_id:'executor',mainFee:34000,end_date:'2026-10-06',updated_at:'2026-10-11T00:00:00Z'};s.projects=[p];
 s.ledger=[event('old','advance',30000,'p',{entry_date:'2026-09-23',created_at:'2026-09-23T00:00:00Z'}),event('new','final_payment',55000,'p')];
 const before=b.calculate(s,undefined,hooks).available;p.status_id='active';assert.equal(b.calculate(s,undefined,hooks).available,20000);p.status_id='done';assert.equal(b.calculate(s,undefined,hooks).available,before);
});
check('A completed project deducts recorded direct costs even before a separate cash payment is confirmed',()=>{
 const s=fresh();s.projects=[{id:'p',status_id:'done',employee_id:'executor',mainFee:32000,expenses:5000,end_date:'2026-10-06',updated_at:'2026-10-11T00:00:00Z'}];
 s.ledger=[event('old','advance',30000,'p',{entry_date:'2026-09-23',created_at:'2026-09-23T00:00:00Z'}),event('new','final_payment',55000,'p')];
 const before=b.calculate(s,undefined,hooks);assert.equal(before.costsHeld,5000);assert.equal(before.available,35250);
 s.ledger.push(event('e','project_expense',5000,'p'));const after=b.calculate(s,undefined,hooks);assert.equal(after.costsHeld,0);assert.equal(after.available,before.available);
});
check('Closing a legacy 145000 advance never creates cash or funds an unrecorded reserve',()=>{
 const s=fresh(),p={id:'legacy',status_id:'active',fee_base:'m2',end_date:'2026-10-19',updated_at:'2026-10-19T17:24:00Z'};
 s.employees=[{id:'executor'}];s.projects=[p];
 s.ledger=[event('legacy-receipt','advance',145000,p.id,{entry_date:'2026-09-23',created_at:'2026-09-23T00:00:00Z'}),
  event('fee-accrual','role_payout',60400,p.id,{payee_employee_id:'executor',entry_date:'2026-10-19',created_at:'2026-10-19T17:22:00Z'}),
  event('album','project_expense',5000,p.id,{entry_date:'2026-10-18',created_at:'2026-10-19T17:23:00Z'}),
  event('paid','salary_payment',60400,null,{payee_employee_id:'executor',description:'[salary:2026-10]',entry_date:'2026-10-19',created_at:'2026-10-19T17:27:00Z'})];
 s.companyIncome=[{id:'supervision',amount:50000,income_date:'2026-10-19',created_at:'2026-10-19T17:29:00Z'}];
 const before=b.calculate(s,'2026-10-19',hooks);p.status_id='done';const after=b.calculate(s,'2026-10-19',hooks);
 assert.equal(after.cashBalance,4600);assert.equal(after.amortization,2500);assert.equal(after.teamHeld,0);assert.equal(after.companyReserve,2100);
 assert.equal(after.cashBalance,before.cashBalance);assert.equal(after.companyReserve,before.companyReserve);
 assert.equal(after.companyReserve+after.amortization+after.projectsHeld+after.teamHeld+after.costsHeld,after.cashBalance);
 for(let i=0;i<3;i++){p.status_id='active';b.calculate(s,'2026-10-19',hooks);p.status_id='done';assert.equal(b.calculate(s,'2026-10-19',hooks).companyReserve,2100);}
});
check('Cash is conserved for legacy advances, actual costs, accruals and subsequent fee payments',()=>{
 for(const paid of [0,10000,60400]){
  const s=fresh();s.employees=[{id:'executor'}];s.projects=[{id:'p',status_id:'done',fee_base:'m2',end_date:'2026-10-10',updated_at:'2026-10-10T12:00:00Z'}];
  s.ledger=[event('old','advance',145000,'p',{entry_date:'2026-09-23',created_at:'2026-09-23T00:00:00Z'}),event('new','final_payment',100000,'p'),event('accrued','role_payout',60400,'p',{payee_employee_id:'executor'}),event('cost','project_expense',5000,'p')];
  if(paid)s.ledger.push(event('paid','salary_payment',paid,null,{payee_employee_id:'executor',description:'[salary:2026-10]'}));
  const x=b.calculate(s,undefined,hooks);assert.equal(x.companyReserve,49600);assert.equal(x.teamHeld,60400-paid);
  assert.equal(x.companyReserve+x.amortization+x.projectsHeld+x.teamHeld+x.costsHeld,x.cashBalance);
 }
});
console.log('PASS: '+count+' project budget scenarios');
