const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const finance=require('../construction-finance.js');
const day='2026-10-19';
const contract=(changes={})=>({version:1,project_id:'object',currency:'RUB',budget_basis_amount:1000000,
 company_fee_rate:15,company_fee_basis:'approved_budget',company_fee_mode:'included',
 confirmed_at:'2026-10-19T08:00:00Z',confirmed_by:'Owner',revision:1,...changes});
const input=(changes={})=>({projectId:'object',asOf:day,contract:contract(),ledger:[],invoices:[],allocations:[],...changes});
const operation=(id,type,amount,changes={})=>({id,project_id:'object',type,amount,entry_date:day,...changes});
const invoice=(id,amount,changes={})=>({id,project_id:'object',amount,item_type:'Материал',invoice_date:day,...changes});
const allocation=(id,amount,changes={})=>({id,project_id:'object',amount,entry_date:day,confirmed_at:'2026-10-19T09:00:00Z',confirmed_by:'Owner',...changes});
const direct=(id,amount,changes={})=>({id,project_id:'object',amount,entry_date:day,confirmed_at:'2026-10-19T09:00:00Z',...changes});
const code=(result,name)=>result.issues.some(issue=>issue.code===name);
let checks=0;function check(name,fn){fn();checks++;console.log('PASS: '+name);}

check('The included 1m budget contains 150k fee and 850k works',()=>{
 const result=finance.normalizeContract(contract());assert.equal(result.ok,true);
 assert.deepEqual(result.summary,{budget_basis_amount:1000000,works_budget:850000,company_fee_total:150000,contract_total:1000000});
});
check('The on-top 1m works budget has 150k fee and a 1.15m contract',()=>{
 const result=finance.normalizeContract(contract({company_fee_mode:'on_top'}));assert.equal(result.ok,true);
 assert.deepEqual(result.summary,{budget_basis_amount:1000000,works_budget:1000000,company_fee_total:150000,contract_total:1150000});
});
check('Expenses, receipts, employee commission and assignments never change agreed company fee',()=>{
 for(const costs of [0,200000,1200000]){
  const result=finance.evaluate(input({contract:contract({fee_percent:99,employee_id:null,price:88,expenses:costs}),
   ledger:[operation('in','advance',100000),...(costs?[operation('cost','project_expense',costs)]:[])]}));
  assert.equal(result.summary.company_fee_total,150000);assert.equal(result.contract.summary.contract_total,1000000);
 }
});
check('Undefined or unconfirmed legacy terms do not invent an agency contract',()=>{
 for(const value of [undefined,null,{}, {price:1000000,fee_percent:15,fee_base:'price',employee_id:'foreman'}]){
  const result=finance.evaluate(input({contract:value,ledger:[operation('in','advance',100000)]}));
  assert.equal(result.contract_ok,false);assert.equal(result.contract.summary.company_fee_total,null);
  assert.equal(result.contract.summary.contract_total,null);assert.equal(result.summary.physical_cash_balance,100000);
 }
});
check('Each missing approval field fails closed without hiding independently recorded cash',()=>{
 for(const key of ['version','project_id','currency','budget_basis_amount','company_fee_rate','company_fee_basis','company_fee_mode','confirmed_at','confirmed_by']){
  const terms=contract();delete terms[key];const result=finance.evaluate(input({contract:terms,ledger:[operation('in','advance',1)]}));
  assert.equal(result.contract_ok,false,key);assert.equal(result.summary.company_fee_total,null,key);
  assert.equal(result.contract.summary.contract_total,null,key);assert.equal(result.summary.physical_cash_balance,1,key);
 }
});
check('Negative, NaN, Infinity, undefined and sub-kopeck budgets are rejected',()=>{
 for(const value of [-1,NaN,Infinity,undefined,null,'',true,'0.001']){
  const result=finance.normalizeContract(contract({budget_basis_amount:value}));assert.equal(result.ok,false,String(value));assert.equal(result.summary.company_fee_total,null);
 }
});
check('Unconfirmed modes, rates, currency, revisions and future terms are rejected',()=>{
 for(const change of [{company_fee_mode:'unknown'},{company_fee_rate:undefined},{company_fee_rate:-15},{company_fee_rate:NaN},{company_fee_rate:20},
  {company_fee_basis:'expenses'},{currency:'USD'},{revision:0},{version:2},{confirmed_at:'2026-10-20T08:00:00Z'},
  {confirmed_at:'2026-02-31T08:00:00Z'},{confirmed_at:'2026-10-19T24:00:00Z'}]){
  assert.equal(finance.normalizeContract(contract(change),{projectId:'object',asOf:day}).ok,false,JSON.stringify(change));
 }
});
check('Exact decimal strings and 15.00 percent are supported',()=>{
 const result=finance.normalizeContract(contract({budget_basis_amount:'1000000.03',company_fee_rate:'15.00'}));
 assert.equal(result.summary.company_fee_total,150000);assert.equal(result.summary.works_budget,850000.03);
});
check('Percentage rounding happens in kopecks with half-up boundaries',()=>{
 const expected=[['0.01',0],['0.03',0],['0.04',0.01],['0.10',0.02],['0.30',0.05],['0.50',0.08]];
 for(const [budget,fee] of expected)assert.equal(finance.normalizeContract(contract({budget_basis_amount:budget})).summary.company_fee_total,fee);
 assert.equal(finance.toMinor('0.29'),29);assert.equal(finance.fromMinor(29),0.29);
});
check('A zero agreed budget remains an explicit zero rather than a missing contract',()=>{
 const result=finance.normalizeContract(contract({budget_basis_amount:0}));assert.equal(result.ok,true);assert.equal(result.summary.contract_total,0);
});
check('Unpaid invoices create commitments without spending cash',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','construction_budget',100000)],invoices:[invoice('materials',30000)]}));
 assert.equal(result.summary.physical_cash_balance,100000);assert.equal(result.summary.cash_payments,0);
 assert.equal(result.summary.unpaid_invoices,30000);assert.equal(result.summary.client_after_invoice_commitments,70000);
});
check('A partial invoice payment moves cash once and reduces the payable',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('pay','project_expense',10000,{description:'[invoice-payment:materials] Cement'})],invoices:[invoice('materials',30000)]}));
 assert.equal(result.summary.physical_cash_balance,90000);assert.equal(result.summary.invoice_paid_by_company,10000);
 assert.equal(result.summary.unpaid_invoices,20000);assert.equal(result.summary.client_after_invoice_commitments,70000);
});
check('Paying a second installment does not count the invoice amount again',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('one','project_expense',10000,{invoice_id:'i'}),operation('two','expense',20000,{invoice_id:'i'})],invoices:[invoice('i',30000)]}));
 assert.equal(result.summary.physical_cash_balance,70000);assert.equal(result.summary.invoice_total,30000);assert.equal(result.summary.unpaid_invoices,0);
});
check('Client direct purchases remain outside company cash',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000)],invoices:[invoice('direct',20000,{paid_by_client:true})]}));
 assert.equal(result.summary.physical_cash_balance,100000);assert.equal(result.summary.received_by_company,100000);
 assert.equal(result.summary.direct_client_paid,20000);assert.equal(result.summary.total_client_funding,120000);assert.equal(result.summary.unpaid_invoices,0);
});
check('Partial direct payments close only their portion of the invoice',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000)],invoices:[invoice('mixed',30000)],directPayments:[direct('direct-one',12000,{invoice_id:'mixed'})]}));
 assert.equal(result.summary.physical_cash_balance,100000);assert.equal(result.summary.direct_client_paid,12000);assert.equal(result.summary.unpaid_invoices,18000);
});
check('A mixed company/direct payment settles one invoice with exact conservation',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('pay','expense',18000,{invoice_id:'mixed'})],invoices:[invoice('mixed',30000)],directPayments:[direct('d',12000,{invoice_id:'mixed'})]}));
 assert.equal(result.summary.physical_cash_balance,82000);assert.equal(result.summary.unpaid_invoices,0);
 assert.equal(result.summary.client_total_confirmed_cash_costs,30000);assert.equal(result.conservation.difference_minor,0);
});
check('A full direct flag and separate direct payments cannot silently double count',()=>{
 const result=finance.evaluate(input({invoices:[invoice('same',30000,{paid_by_client:true})],directPayments:[direct('d',30000,{invoice_id:'same'})]}));
 assert.equal(result.invoices_ok,false);assert.equal(result.summary.direct_client_paid,null);assert(code(result,'DUPLICATE_DIRECT_PAYMENT_SOURCE'));
});
check('Unknown invoice types are retained as costs and never manufacture money',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000)],invoices:[invoice('unknown',30000,{item_type:'Иное',paid_by_client:true})]}));
 assert.equal(result.summary.physical_cash_balance,100000);assert.equal(result.summary.invoice_total,30000);assert.equal(result.summary.unpaid_invoices,0);
 assert(code(result,'UNKNOWN_INVOICE_TYPE'));
});
check('Fee allocation is internal: 150k company plus 850k client equals unchanged 1m cash',()=>{
 const base=input({ledger:[operation('in','construction_budget',1000000)]}),before=finance.evaluate(base),after=finance.evaluate({...base,allocations:[allocation('fee',150000)]});
 assert.equal(before.summary.physical_cash_balance,1000000);assert.equal(after.summary.physical_cash_balance,1000000);
 assert.equal(after.summary.received_by_company,before.summary.received_by_company);assert.equal(after.summary.cash_outgoing,0);
 assert.equal(after.summary.client_cash_balance,850000);assert.equal(after.summary.company_fee_cash_balance,150000);assert.equal(after.conservation.difference_minor,0);
});
check('Employee commission from allocated company fee does not debit the client twice',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',1000000),operation('manager','fee_payment',30000,{payee_employee_id:'manager',funding_source:'company_fee'})],allocations:[allocation('fee',150000)]}));
 assert.equal(result.summary.physical_cash_balance,970000);assert.equal(result.summary.client_cash_balance,850000);
 assert.equal(result.summary.company_fee_cash_balance,120000);assert.equal(result.summary.client_total_confirmed_cash_costs,0);
 assert.equal(result.summary.confirmed_company_fee_cash_costs,30000);assert.equal(result.conservation.difference_minor,0);
});
check('Unclassified employee payments preserve cash and close the unverified split',()=>{
 for(const type of ['fee_payment','salary_payment','payment']){
  const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('team',type,10000,{payee_employee_id:'worker'})]}));
  assert.equal(result.cash_ok,true);assert.equal(result.summary.physical_cash_balance,90000);assert.equal(result.summary.unclassified_outgoing,10000);
  assert.equal(result.classification_ok,false);assert.equal(result.summary.client_cash_balance,null);assert.equal(result.summary.client_funded_cash_payments,null);assert.equal(result.summary.client_total_confirmed_cash_costs,null);
 }
});
check('An explicitly client-funded subcontractor payment is classified without a second fee',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('worker','payment',10000,{payee_employee_id:'worker',funding_source:'client'})]}));
 assert.equal(result.summary.client_cash_balance,90000);assert.equal(result.summary.client_total_confirmed_cash_costs,10000);
});
check('Unknown withdrawal purpose does not pretend that handing out cash is a final cost',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('withdraw','withdrawal',10000,{funding_source:'client'})]}));
 assert.equal(result.summary.physical_cash_balance,90000);assert.equal(result.summary.unclassified_outgoing,10000);
 assert.equal(result.summary.client_cash_balance,null);assert.equal(result.summary.confirmed_client_cash_costs,null);
});
check('A known accountable advance reduces held cash but is not final work or material cost',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('advance','withdrawal',10000,{funding_source:'client',purpose:'cash_handover'})]}));
 assert.equal(result.summary.physical_cash_balance,90000);assert.equal(result.summary.accountable_advances_issued,10000);
 assert.equal(result.summary.confirmed_client_cash_costs,0);assert.equal(result.summary.client_cash_balance,90000);assert.equal(result.summary.client_resources_with_advances,100000);
});
check('A cash handover cannot confirm payment of a supplier invoice',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('advance','withdrawal',10000,{funding_source:'client',purpose:'cash_handover',invoice_id:'i'})],invoices:[invoice('i',10000)]}));
 assert.equal(result.invoices_ok,false);assert.equal(result.invoices[0].summary.company_paid,0);assert(code(result,'CASH_HANDOVER_IS_NOT_INVOICE_PAYMENT'));
});
check('An explicit client refund moves cash and client balance with no extra cost',()=>{
 for(const row of [operation('refund','client_refund',5000),operation('refund','withdrawal',5000,{purpose:'client_refund'})]){
  const result=finance.evaluate(input({ledger:[operation('in','advance',100000),row]}));
  assert.equal(result.summary.physical_cash_balance,95000);assert.equal(result.summary.client_cash_balance,95000);assert.equal(result.summary.client_refunds,5000);assert.equal(result.summary.confirmed_cash_costs,0);
 }
});
check('Every actual expense type affects held cash while accruals do not',()=>{
 const ledger=[operation('in','advance',100000),...['expense','project_expense','payment','withdrawal','fee_payment','salary_payment','client_refund'].map((type,i)=>operation('out'+i,type,1000,{funding_source:'client',purpose:type==='withdrawal'?'project_expense':undefined})),operation('accrue','role_payout',70000),operation('bonus','bonus',3000)];
 const result=finance.cashSummary(input({ledger}));assert.equal(result.summary.physical_cash_balance,93000);assert.equal(result.summary.recorded_accruals,73000);
});
check('Accruals without a verified liability settlement cannot masquerade as a complete free budget',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('accrue','role_payout',30000)]}));
 assert.equal(result.summary.physical_cash_balance,100000);assert.equal(result.summary.unclassified_accruals,30000);assert.equal(result.commitments_complete,false);
 assert.equal(result.summary.client_after_invoice_commitments,null);assert.equal(result.summary.client_available_after_reserved_fee,null);
});
check('Closing, reopening or archiving a project never releases client money',()=>{
 const ledger=[operation('in','advance',100000)];const a=finance.evaluate(input({ledger,status:'active'}));
 for(const extra of [{status:'done'},{status:'active'},{deleted_at:'2026-10-19T10:00:00Z'}]){
  const b=finance.evaluate(input({ledger,...extra}));assert.deepEqual(b.minor,a.minor);
 }
});
check('Foreign ledger and invoice IDs cannot confirm this object invoice',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('foreign','expense',30000,{project_id:'other',invoice_id:'i'})],invoices:[invoice('i',30000),invoice('foreign-i',50000,{project_id:'other'})]}));
 assert.equal(result.summary.received_by_company,100000);assert.equal(result.summary.physical_cash_balance,100000);
 assert.equal(result.summary.invoice_total,30000);assert.equal(result.summary.unpaid_invoices,30000);assert(code(result,'FOREIGN_PROJECT_INVOICE_PAYMENT'));
});
check('An own payment referencing a foreign invoice keeps cash exact but invoice totals unverified',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('pay','expense',10000,{invoice_id:'foreign-i'})],invoices:[invoice('foreign-i',10000,{project_id:'other'})]}));
 assert.equal(result.summary.physical_cash_balance,90000);assert.equal(result.invoices_ok,false);assert.equal(result.summary.unpaid_invoices,null);
});
check('Overpayment remains visible without capping the cash actually spent',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('pay','expense',40000,{invoice_id:'i'})],invoices:[invoice('i',30000)]}));
 assert.equal(result.summary.physical_cash_balance,60000);assert.equal(result.summary.unpaid_invoices,0);assert.equal(result.summary.invoice_overpaid,10000);assert(code(result,'INVOICE_OVERPAID'));
});
check('Soft deletion cancels the same operation once and never fabricates a new receipt',()=>{
 const ledger=[operation('in','advance',100000),operation('pay','expense',30000,{invoice_id:'i'})],invoices=[invoice('i',30000)];
 const before=finance.evaluate(input({ledger,invoices}));const after=finance.evaluate(input({ledger:[ledger[0],{...ledger[1],deleted_at:'2026-10-19T12:00:00Z'}],invoices}));
 assert.equal(before.summary.physical_cash_balance,70000);assert.equal(after.summary.physical_cash_balance,100000);assert.equal(after.summary.unpaid_invoices,30000);assert.equal(after.summary.received_by_company,100000);
});
check('Future rows are excluded from historical calculations',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('future','expense',10000,{entry_date:'2026-10-20'})],invoices:[invoice('future-i',30000,{invoice_date:'2026-10-20'})],allocations:[allocation('future-a',10000,{entry_date:'2026-10-20'})]}));
 assert.equal(result.summary.physical_cash_balance,100000);assert.equal(result.summary.invoice_total,0);assert.equal(result.summary.company_fee_allocated,0);
});
check('Unconfirmed allocations are not silently accepted',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000)],allocations:[allocation('a',10000,{confirmed_at:null})]}));
 assert.equal(result.summary.physical_cash_balance,100000);assert.equal(result.allocation_ok,false);assert.equal(result.summary.company_fee_allocated,null);assert.equal(result.summary.client_cash_balance,null);
});
check('Allocating above the agreed 150k raises an issue without inventing extra fee',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',1000000)],allocations:[allocation('a',160000)]}));
 assert.equal(result.summary.company_fee_total,150000);assert.equal(result.summary.company_fee_allocated,160000);assert.equal(result.summary.company_fee_overallocated,10000);
 assert.equal(result.summary.client_cash_balance,null);assert.equal(result.summary.physical_cash_balance,1000000);assert(code(result,'FEE_OVERALLOCATED'));
});
check('The fee is reserved only once before and after an allocation',()=>{
 const base=input({ledger:[operation('in','advance',1000000)],invoices:[invoice('i',200000)]});
 const a=finance.evaluate(base),b=finance.evaluate({...base,allocations:[allocation('fee',150000)]});
 assert.equal(a.summary.client_available_after_reserved_fee,650000);assert.equal(b.summary.client_available_after_reserved_fee,650000);
});
check('Duplicate equal IDs are counted once; conflicting copies fail cash closed',()=>{
 const row=operation('in','advance',100000),same=finance.cashSummary(input({ledger:[row,{...row}]}));
 assert.equal(same.summary.physical_cash_balance,100000);assert(code(same,'DUPLICATE_ROW'));
 const different=finance.cashSummary(input({ledger:[row,{...row,amount:200000}]}));assert.equal(different.cash_ok,false);assert.equal(different.summary.physical_cash_balance,null);
});
check('Missing IDs, invalid dates, unknown types and invalid cash amounts close cash results',()=>{
 for(const change of [{id:undefined},{entry_date:'2026-02-31'},{entry_date:undefined},{type:'unknown'},{amount:-1},{amount:NaN},{amount:undefined},{amount:'0.001'}]){
  const result=finance.cashSummary(input({ledger:[operation('bad','advance',100000,change)]}));assert.equal(result.cash_ok,false,JSON.stringify(change));assert.equal(result.summary.physical_cash_balance,null);
 }
});
check('Missing/invalid array and input values never masquerade as verified zero',()=>{
 for(const change of [{projectId:undefined},{asOf:undefined},{asOf:'2026-02-31'},{ledger:{amount:100}}]){
  const result=finance.cashSummary(input(change));assert.equal(result.cash_ok,false);assert.equal(result.summary.physical_cash_balance,null);
 }
});
check('Overflow is rejected instead of losing kopecks',()=>{
 assert.throws(()=>finance.toMinor('90071992547409.92'));
 const result=finance.cashSummary(input({ledger:[operation('one','advance','45035996273704.96'),operation('two','advance','45035996273704.96')]}));
 assert.equal(result.cash_ok,false);assert.equal(result.summary.physical_cash_balance,null);assert(code(result,'MONEY_OVERFLOW'));
 assert.equal(finance.normalizeContract(contract({budget_basis_amount:'90071992547409.91',company_fee_mode:'on_top'})).ok,false);
});
check('Negative cash is an explicit deficit and is not rounded up to zero',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',10000),operation('pay','expense',12000)]}));assert.equal(result.summary.physical_cash_balance,-2000);assert.equal(result.summary.client_cash_balance,-2000);
});
check('Historical imported cost is not treated as a new cash payment',()=>{
 const result=finance.cashSummary(input({ledger:[operation('in','advance',100000),operation('import','project_expense',30000,{description:'Ранее внесённые расходы'})]}));
 assert.equal(result.summary.physical_cash_balance,100000);assert(code(result,'IMPORTED_COST_NOT_PAYMENT'));
});
check('Legacy cash summary does not infer fee terms, add cached advances, or add amortization',()=>{
 const result=finance.cashSummary(input({contract:undefined,price:1000000,advance:500000,balance:300000,fee_percent:15,amortization:1000,
  ledger:[operation('in','materials_budget',100000),operation('out','expense',20000)]}));
 assert.equal(result.summary.physical_cash_balance,80000);assert.equal(result.summary.company_fee_total,null);assert.equal(result.bank_reconciled,false);
});
check('Pure evaluation neither mutates inputs nor depends on array order',()=>{
 const value=input({ledger:[operation('in','advance',100000),operation('pay','expense',10000,{invoice_id:'i'})],invoices:[invoice('i',30000)],allocations:[allocation('fee',15000)]});
 const original=JSON.stringify(value),a=finance.evaluate(value),b=finance.evaluate({...value,ledger:[...value.ledger].reverse()});
 assert.equal(JSON.stringify(value),original);assert.deepEqual(a.minor,b.minor);assert.equal(a.conservation.difference_minor,0);
});
check('The same API loads without a DOM, network, storage or CommonJS in the browser',()=>{
 const context={window:{},Intl,Date,console};vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','construction-finance.js'),'utf8'),context);
 assert.equal(context.window.ARHITTEKConstructionFinance.evaluate(input()).summary.company_fee_total,150000);
});
check('Missing ledger, invoices and allocations cannot masquerade as complete new-contract data',()=>{
 const missingLedger=finance.evaluate(input({ledger:undefined}));assert.equal(missingLedger.cash_ok,false);assert.equal(missingLedger.summary.physical_cash_balance,null);
 const missingInvoices=finance.evaluate(input({invoices:undefined}));assert.equal(missingInvoices.cash_ok,true);assert.equal(missingInvoices.invoices_ok,false);assert.equal(missingInvoices.summary.unpaid_invoices,null);
 const missingAllocations=finance.evaluate(input({allocations:undefined}));assert.equal(missingAllocations.cash_ok,true);assert.equal(missingAllocations.allocation_ok,false);assert.equal(missingAllocations.summary.client_cash_balance,null);
});
check('Conflicting invoice fields and tags preserve cash but block a false payable result',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('pay','expense',10000,{invoice_id:'one',description:'[invoice-payment:two]'})],invoices:[invoice('one',10000),invoice('two',10000)]}));
 assert.equal(result.summary.physical_cash_balance,90000);assert.equal(result.invoices_ok,false);assert(code(result,'CONFLICTING_INVOICE_LINK'));
});
check('Unknown accrual amounts never debit cash and never confirm complete liabilities',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('accrue','role_payout',undefined)]}));
 assert.equal(result.summary.physical_cash_balance,100000);assert.equal(result.cash_ok,true);assert.equal(result.commitments_complete,false);assert.equal(result.summary.client_after_invoice_commitments,null);
});
check('An allocation without an author is not an authorized fee transfer',()=>{
 const result=finance.evaluate(input({allocations:[allocation('fee',150000,{confirmed_by:undefined})]}));
 assert.equal(result.allocation_ok,false);assert.equal(result.summary.company_fee_allocated,null);assert.equal(result.summary.client_cash_balance,null);
});
check('Foreign currency rows are not silently treated as rubles',()=>{
 const cash=finance.cashSummary(input({ledger:[operation('in','advance',100,{currency:'USD'})]}));assert.equal(cash.cash_ok,false);assert.equal(cash.summary.physical_cash_balance,null);
 const documents=finance.evaluate(input({invoices:[invoice('usd',100,{currency:'USD'})]}));assert.equal(documents.cash_ok,true);assert.equal(documents.invoices_ok,false);
});
check('An unsettled advance prevents a promise that all money is available after liabilities',()=>{
 const result=finance.evaluate(input({ledger:[operation('in','advance',100000),operation('hand','withdrawal',10000,{purpose:'cash_handover',funding_source:'client'})]}));
 assert.equal(result.summary.client_resources_with_advances,100000);assert.equal(result.commitments_complete,false);assert.equal(result.summary.client_available_after_reserved_fee,null);assert(code(result,'UNSETTLED_ACCOUNTABLE_ADVANCE'));
});
console.log(`Construction finance: ${checks}/${checks} checks passed.`);
