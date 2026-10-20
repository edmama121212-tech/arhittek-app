const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-20T08:00:00Z']));}}
const scope={window:{},Date:Clock,Intl,Number,Math,String,Set,Map};vm.createContext(scope);
for(const filename of ['project-budget.js','cash-finance.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',filename),'utf8'),scope);
const cash=scope.window.ARHITTEKCash,budget=scope.window.ARHITTEKBudget,round=n=>Math.round(n*100)/100;
const row=(id,type,amount,extra={})=>({id,project_id:'repair',type,amount,entry_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z',...extra});
const hooks={fee:()=>({mainFeeAmount:99999999,coFeeAmount:99999999,mainPaid:0,coPaid:0,feePercent:90,coFeePercent:90}),manager:()=>true};
function fixture(){return {projects:[{id:'repair',name:'Новый ремонт',category_id:'build',employee_id:'foreman',co_employee_id:'manager',fee_percent:15,fee_paid:0,status_id:'active',end_date:'2026-10-19',updated_at:'2026-10-19T10:00:00Z'}],financialProjects:[],employees:[{id:'foreman',role:'Прораб'},{id:'manager',role:'Менеджер'}],ledger:[],invoices:[],companyExpenses:[],companyIncome:[],cashCounts:[],timesheetPayments:[],history:[],categories:[{id:'build',name:'Ремонт',department_id:'construction'}],departments:[{id:'construction',name:'Строительный отдел'}],statuses:[{id:'active',name:'В процессе'},{id:'done',name:'Завершён'},{id:'frozen',name:'Заморожен'}]};}
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS: '+name);}
check('Construction status, invoice total and company percentage cannot create free money in 288 cash scenarios',()=>{
 let combinations=0;
 for(const receipt of [0,0.15,10000,115000])for(const paid of [0,0.07,2000,130000])for(const bill of [0,100000,200000])for(const status of ['active','done','frozen'])for(const fee_percent of [0,15]){
  const s=fixture();Object.assign(s.projects[0],{status_id:status,fee_percent,fee_paid:bill});
  if(receipt)s.ledger.push(row('advance','construction_budget',receipt));
  if(paid)s.ledger.push(row('supplier','expense',paid));
  if(bill)s.invoices=[{id:'bill',project_id:'repair',amount:bill,item_type:'Работа',invoice_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z'}];
  const f=budget.calculate(s,'2026-10-20',hooks),expectedCash=round(20000+receipt-paid),expectedHeld=Math.max(0,round(receipt-paid));
  assert.equal(f.cashBalance,expectedCash);assert.equal(f.amortization,0);assert.equal(f.constructionHeld,expectedHeld);assert.equal(f.teamHeld,0);assert.equal(f.costsHeld,0);
  assert.equal(f.available,round(expectedCash-expectedHeld));assert.equal(round(f.available+f.amortization+f.projectsHeld+f.teamHeld+f.costsHeld),f.cashBalance);
  combinations++;
 }
 assert.equal(combinations,288);
});
check('All construction outgoing kinds reduce cash and held money once, including partial supplier and employee payments',()=>{
 for(const type of ['expense','project_expense','payment','withdrawal','fee_payment','salary_payment']){
  const s=fixture();s.ledger=[row('in','construction_budget',115000),row('out',type,10000,{payee_employee_id:['payment','fee_payment','salary_payment'].includes(type)?'foreman':null,description:'[invoice-payment:bill]'})];
  s.invoices=[{id:'bill',project_id:'repair',amount:100000,item_type:'Материал',invoice_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z'}];
  const f=budget.calculate(s,'2026-10-20',hooks);assert.equal(f.cashBalance,125000);assert.equal(f.constructionHeld,105000);assert.equal(f.available,20000);assert.equal(f.amortization,0);
 }
});
check('Repeated close, reopen and archive cannot release a construction advance or invent employee commission',()=>{
 const s=fixture();s.ledger=[row('in','advance',115000),row('work','role_payout',70000,{payee_employee_id:'foreman'}),row('paid','fee_payment',10000,{payee_employee_id:'foreman'})];
 for(let repeat=0;repeat<4;repeat++)for(const status_id of ['done','active','done']){
  s.projects[0].status_id=status_id;const f=budget.calculate(s,'2026-10-20',hooks);assert.equal(f.available,20000);assert.equal(f.constructionHeld,105000);assert.equal(f.teamHeld,0);assert.equal(f.releasedOpeningFunds,0);
 }
 const project=s.projects.pop();s.financialProjects=[{...project,deleted_at:'2026-10-20T08:00:00Z'}];
 const f=budget.calculate(s,'2026-10-20',hooks);assert.equal(f.available,20000);assert.equal(f.constructionHeld,105000);assert.equal(f.projects[0].archived,true);
});
check('A direct customer purchase and unpaid invoices do not change the global cash or allocate amortization',()=>{
 const s=fixture();s.ledger=[row('in','advance',15000)];s.invoices=[{id:'direct',project_id:'repair',amount:100000,item_type:'Материал',paid_by_client:true,invoice_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z'}];
 const f=budget.calculate(s,'2026-10-20',hooks);assert.equal(f.cashBalance,35000);assert.equal(f.available,20000);assert.equal(f.constructionHeld,15000);assert.equal(f.amortization,0);
});
check('A company receipt still allocates 5% while construction client money allocates none',()=>{
 const s=fixture();s.ledger=[row('in','advance',115000)];s.companyIncome=[{id:'supervision',amount:50000,income_date:'2026-10-19',created_at:'2026-10-19T09:00:00Z'}];
 const f=budget.calculate(s,'2026-10-20',hooks);assert.equal(f.cashBalance,185000);assert.equal(f.available,67500);assert.equal(f.constructionHeld,115000);assert.equal(f.amortization,2500);assert.equal(cash.amortEvents(s,'2026-10-20').length,1);
});
check('Old and future construction receipts never re-enter cash or amortization on closure',()=>{
 const s=fixture();s.projects[0].status_id='done';s.ledger=[row('old','advance',145000,{entry_date:'2026-09-01',created_at:'2026-09-01T00:00:00Z'}),row('future','advance',50000,{entry_date:'2099-01-01'})];
 const f=budget.calculate(s,'2026-10-20',hooks);assert.equal(f.cashBalance,20000);assert.equal(f.available,20000);assert.equal(f.amortization,0);assert.equal(f.constructionHeld,0);assert.equal(f.releasedOpeningFunds,0);
});
console.log(`Construction reserve invariants: ${checks}/${checks} checks passed.`);
