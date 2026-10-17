const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-17T14:00:00Z']));}}
const context={window:{},Date:Clock,Intl,Number,Math,String,Set,Map};vm.createContext(context);
for(const file of ['project-budget.js','cash-finance.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
const cash=context.window.ARHITTEKCash,budget=context.window.ARHITTEKBudget;
const event=(id,type,amount,project_id,extra={})=>({id,type,amount,project_id,entry_date:'2026-10-16',created_at:'2026-10-16T08:00:00Z',...extra});
const count=(extra={})=>({id:'count',entity_type:'reserve',action:'cash_count',created_at:'2026-10-17T13:12:00Z',changes:{cash_count:{new:{version:1,total:158000,counted_at:'2026-10-17T13:11:45Z',book_balance:224700,...extra}}}});
const fresh=()=>({projects:[
 {id:'recent-close',status_id:'done',employee_id:'executor',mainFee:32600,end_date:'2026-10-06',updated_at:'2026-10-11T07:00:00Z'},
 {id:'finished',status_id:'done',employee_id:'commission',fee_percent:15,mainFee:21000,end_date:'2026-10-15'},
 {id:'active',status_id:'active',employee_id:'commission',fee_percent:25},
 {id:'other',status_id:'done',end_date:'2026-08-01'}],
 employees:[{id:'commission',role:'Менеджер'},{id:'executor'}],
 ledger:[event('old','advance',30000,'recent-close',{entry_date:'2026-09-23',created_at:'2026-09-23T00:00:00Z'}),
 event('close-income','final_payment',55000,'recent-close'),event('finished-income','advance',140000,'finished'),
 event('active-income','advance',30000,'active'),event('other-income','final_payment',80000,'other'),
 event('cost-one','project_expense',3500,'recent-close'),event('cost-two','project_expense',2400,'other'),
 event('unallocated-pay','salary_payment',27000,null,{payee_employee_id:'salary',description:'[salary:2026-10]'}),
 event('commission-pay','salary_payment',28500,null,{payee_employee_id:'commission',description:'[salary:2026-10]'})],
 companyIncome:[{id:'sale',category:'Прочий доход',amount:35000,income_date:'2026-10-13',created_at:'2026-10-13T00:00:00Z'}],
 companyExpenses:[{id:'expenses',amount:73900,expense_date:'2026-10-17',created_at:'2026-10-17T10:00:00Z'}],
 invoices:[],timesheetPayments:[],statuses:[{id:'done',name:'Завершён'},{id:'active',name:'В процессе'}],cashCounts:[count()]});
const hooks={fee:p=>({mainFeeAmount:p.mainFee||0,feePercent:p.fee_percent||0}),manager:id=>id==='commission',construction:()=>false};
let passed=0;function check(name,fn){fn();passed++;console.log('PASS: '+name);}
check('A physical count is the total money, including project funds, team and amortization',()=>{
 const s=fresh(),b=budget.calculate(s,undefined,hooks);
 assert.equal(cash.balance(s),158000);assert.equal(cash.bookBalance(s),224700);
 assert.equal(b.projectsHeld,21000);assert.equal(b.teamHeld,32600);assert.equal(b.amortization,17000);
 assert.equal(b.companyReserve,87400);assert.equal(b.companyReserve+b.projectsHeld+b.teamHeld+b.costsHeld+b.amortization,b.cashBalance);
 assert.equal(cash.cashStatus(s).difference,66700);
});
check('A count creates neither income, expense, nor amortization',()=>{
 const s=fresh(),before=cash.flowSummary(cash.cashEvents(s)),amort=cash.amortization(s);s.cashCounts=[];
 assert.deepEqual(cash.flowSummary(cash.cashEvents(s)),before);assert.equal(cash.amortization(s),amort);
});
check('The same count survives reload and duplicate observations without adding money',()=>{
 const s=fresh();s.cashCounts.push({...count(),id:'retry',created_at:'2026-10-17T13:13:00Z'});
 assert.equal(cash.balance(s),158000);assert.equal(cash.balance(JSON.parse(JSON.stringify(s))),158000);
});
check('A new payment moves physical cash and journal equally after the count',()=>{
 const s=fresh();s.companyExpenses.push({id:'new-payment',amount:500,expense_date:'2026-10-17',created_at:'2026-10-17T13:20:00Z'});
 assert.equal(cash.balance(s),157500);assert.equal(cash.bookBalance(s),224200);assert.equal(cash.cashStatus(s).difference,66700);
});
check('A new receipt updates cash and allocates its amortization once',()=>{
 const s=fresh();s.companyIncome.push({id:'new-sale',amount:10000,income_date:'2026-10-17',created_at:'2026-10-17T13:20:00Z'});
 assert.equal(cash.balance(s),168000);assert.equal(cash.amortization(s),17500);assert.equal(cash.cashStatus(s).difference,66700);
});
check('Correcting an old receipt changes the discrepancy without changing counted money',()=>{
 const s=fresh();s.ledger.find(r=>r.id==='finished-income').amount-=20000;
 assert.equal(cash.balance(s),158000);assert.equal(cash.bookBalance(s),204700);assert.equal(cash.cashStatus(s).difference,46700);
});
check('A backdated old payment entered after the count is already inside that physical count',()=>{
 const s=fresh();s.companyExpenses.push({id:'backfill',amount:1000,expense_date:'2026-10-16',created_at:'2026-10-17T13:20:00Z'});
 assert.equal(cash.balance(s),158000);assert.equal(cash.cashStatus(s).difference,65700);
});
check('Legacy balance corrections are journal corrections and do not spend counted cash',()=>{
 const s=fresh();s.companyExpenses.push({id:'old-correction',category:'Корректировка резерва (−)',amount:1000,expense_date:'2026-10-17',created_at:'2026-10-17T13:20:00Z'});
 assert.equal(cash.balance(s),158000);assert.equal(cash.amortization(s),17000);
});
check('Imported historical expenses after a count do not become new cash payments',()=>{
 const s=fresh();s.ledger.push(event('import','project_expense',5000,'active',{description:'Ранее внесённые расходы',entry_date:'2026-10-17',created_at:'2026-10-17T13:20:00Z'}));
 assert.equal(cash.balance(s),158000);assert.equal(cash.bookBalance(s),224700);
});
check('An explicitly counted same-day backfill closes the discrepancy without spending money again',()=>{
 const s=fresh();s.companyExpenses.push({id:'same-day-backfill',amount:66700,expense_date:'2026-10-17',created_at:'2026-10-17T13:20:00Z',description:'Ранее оплаченный расход [cash:counted:count]'});
 assert.equal(cash.balance(s),158000);assert.equal(cash.bookBalance(s),158000);assert.equal(cash.cashStatus(s).difference,0);
 assert.equal(cash.displayNote(s.companyExpenses.at(-1).description),'Ранее оплаченный расход');
});
check('Closing a project redistributes existing cash without creating its old advance again',()=>{
 const s=fresh();s.projects.find(p=>p.id==='active').status_id='done';
 const b=budget.calculate(s,undefined,hooks);assert.equal(b.cashBalance,158000);assert.equal(b.projectsHeld,0);assert.equal(b.companyReserve,108400);
 assert.equal(b.companyReserve+b.teamHeld+b.amortization,b.cashBalance);
});
check('An old project expense spends real cash once after a count',()=>{
 const s=fresh();s.ledger.push(event('later-cost','project_expense',5000,'active',{entry_date:'2026-10-17',created_at:'2026-10-17T13:20:00Z'}));
 const b=budget.calculate(s,undefined,hooks);assert.equal(b.cashBalance,153000);assert.equal(b.projectsHeld,16000);assert.equal(b.companyReserve,87400);
});
check('A salary payment after a count settles a previously held fee without a second reserve debit',()=>{
 const s=fresh(),before=budget.calculate(s,undefined,hooks);s.ledger.push(event('executor-pay','fee_payment',32600,'recent-close',{payee_employee_id:'executor',entry_date:'2026-10-17',created_at:'2026-10-17T13:20:00Z'}));
 const after=budget.calculate(s,undefined,hooks);assert.equal(after.cashBalance,125400);assert.equal(after.teamHeld,0);assert.equal(after.companyReserve,before.companyReserve);
});
check('Historical months before the count keep their original ledger history',()=>{
 const s=fresh();assert.equal(cash.balance(s,'2026-10-16'),cash.bookBalance(s,'2026-10-16'));assert.equal(cash.cashCount(s,'2026-10-16'),null);
});
check('A monthly cash summary exposes the count difference and conserves the month balance',()=>{
 const s=fresh(),m=cash.monthSummary(s,'2026-10');
 assert.equal(m.closing,158000);assert.equal(m.reconciliation,-66700);assert.equal(m.opening+m.incoming-m.outgoing+m.reconciliation,m.closing);
});
check('A count of zero is valid and unpaid obligations remain visible as a deficit',()=>{
 const s=fresh();s.cashCounts=[count({total:0})];const b=budget.calculate(s,undefined,hooks);
 assert.equal(b.cashBalance,0);assert.equal(b.companyReserve,-70600);
});
check('Future and invalid observations cannot replace the current cash total',()=>{
 const s=fresh();s.cashCounts.push(count({total:999999,counted_at:'2026-10-18T10:00:00Z'}),count({total:-5}),count({total:NaN}));
 assert.equal(cash.balance(s),158000);
});
console.log('PASS: '+passed+' physical cash-count scenarios');
