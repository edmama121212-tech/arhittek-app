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

check('Historical v1: the included 1m budget contains 150k fee and 850k works',()=>{
 const result=finance.normalizeContract(contract());assert.equal(result.ok,true);
 assert.deepEqual(result.summary,{budget_basis_amount:1000000,works_budget:850000,company_fee_total:150000,contract_total:1000000});
});
check('Historical v1: the on-top 1m works budget has 150k fee and a 1.15m contract',()=>{
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
const markupContract=(changes={})=>({version:2,project_id:'object',currency:'RUB',company_fee_rate:15,
 company_fee_basis:'actual_cost_markup',company_fee_mode:'on_top',confirmed_at:'2026-10-19T08:00:00Z',confirmed_by:'Owner',revision:1,...changes});
const markupInput=(changes={})=>input({contract:markupContract(),costFactsComplete:true,costFacts:[],costCredits:[],...changes});
const costFact=(id,type,sourceId,amount,changes={})=>({id,project_id:'object',source_type:type,source_id:sourceId,amount,
 entry_date:day,cost_scope:'project',confirmed_at:'2026-10-19T10:00:00Z',confirmed_by:'Owner',...changes});
const credit=(id,factId,amount,changes={})=>({id,project_id:'object',cost_fact_id:factId,amount,entry_date:day,
 confirmed_at:'2026-10-19T11:00:00Z',confirmed_by:'Owner',...changes});
const costBase=(changes={})=>markupInput({invoices:[invoice('cost',100000)],costFacts:[costFact('fact','invoice','cost',100000)],...changes});

check('V2 terms explicitly declare cost markup with no invented budget or final project price',()=>{
 const result=finance.normalizeContract(markupContract());assert.equal(result.ok,true);assert.equal(result.version,2);
 assert.equal(result.company_fee_basis,'actual_cost_markup');assert.equal(result.summary.company_fee_total,null);assert.equal(result.summary.contract_total,null);
 assert.equal(result.summary.budget_basis_amount,null);
});
check('V2: 100k confirmed costs plus 15k markup makes 115k chargeable',()=>{
 const result=finance.evaluate(costBase());assert.equal(result.costs_ok,true);assert.equal(result.version,2);
 assert.equal(result.summary.confirmed_project_costs,100000);assert.equal(result.summary.company_fee_total,15000);assert.equal(result.summary.chargeable_cost_total,115000);
 assert.equal(result.summary.physical_cash_balance,0);assert.equal(result.summary.unpaid_invoices,100000);
});
check('V2: the invoice and its linked actual payment create one 100k cost base',()=>{
 const result=finance.evaluate(costBase({ledger:[operation('in','advance',115000),operation('paid','expense',100000,{invoice_id:'cost'})]}));
 assert.equal(result.summary.confirmed_project_costs,100000);assert.equal(result.summary.company_fee_total,15000);assert.equal(result.summary.physical_cash_balance,15000);
 assert.equal(result.summary.unpaid_invoices,0);assert.equal(result.summary.chargeable_cost_total,115000);
});
check('V2: a partial payment changes cash and payables, never the same confirmed cost twice',()=>{
 const result=finance.evaluate(costBase({ledger:[operation('in','advance',115000),operation('paid','expense',10000,{description:'[invoice-payment:cost]'})]}));
 assert.equal(result.summary.company_fee_total,15000);assert.equal(result.summary.physical_cash_balance,105000);assert.equal(result.summary.unpaid_invoices,90000);
});
check('V2: a direct client expense creates markup without a company cash receipt',()=>{
 const result=finance.evaluate(costBase({invoices:[invoice('cost',100000,{paid_by_client:true})]}));
 assert.equal(result.summary.confirmed_project_costs,100000);assert.equal(result.summary.company_fee_total,15000);
 assert.equal(result.summary.received_by_company,0);assert.equal(result.summary.physical_cash_balance,0);assert.equal(result.summary.direct_client_paid,100000);
});
check('V2: an advance without costs generates zero markup',()=>{
 const result=finance.evaluate(markupInput({ledger:[operation('in','construction_budget',115000)]}));
 assert.equal(result.costs_ok,true);assert.equal(result.summary.confirmed_project_costs,0);assert.equal(result.summary.company_fee_total,0);assert.equal(result.summary.chargeable_cost_total,0);
 assert.equal(result.summary.physical_cash_balance,115000);assert.equal(result.summary.company_fee_allocated,0);
});
check('V2: changing a saved budget, price, staff or expense cache cannot create markup',()=>{
 for(const budget of [0,1000000,9000000]){
  const result=finance.evaluate(markupInput({contract:markupContract({budget_basis_amount:budget,price:budget,expenses:budget,employee_id:'manager',fee_percent:99}),price:budget}));
  assert.equal(result.summary.company_fee_total,0);assert.equal(result.summary.chargeable_cost_total,0);
 }
});
check('V2: no explicit completeness means unknown fee rather than zero',()=>{
 for(const complete of [undefined,false,null,'true']){
  const result=finance.evaluate(markupInput({costFactsComplete:complete}));assert.equal(result.costs_ok,false);assert.equal(result.summary.company_fee_total,null);assert.equal(result.summary.chargeable_cost_total,null);
  assert(code(result,'COST_FACTS_INCOMPLETE'));
 }
});
check('V2: an omitted cost or credit list does not claim a complete approved base',()=>{
 for(const changes of [{costFacts:undefined},{costCredits:undefined}]){
  const result=finance.evaluate(markupInput(changes));assert.equal(result.costs_ok,false);assert.equal(result.summary.company_fee_total,null);
 }
});
check('V2: uploading a bill alone does not confirm the expense for markup',()=>{
 const result=finance.evaluate(markupInput({invoices:[invoice('cost',100000)]}));
 assert.equal(result.summary.physical_cash_balance,0);assert.equal(result.summary.known_confirmed_project_costs,0);assert.equal(result.summary.company_fee_total,null);assert(code(result,'UNCONFIRMED_COST_SOURCE'));
});
check('V2: unconfirmed, negative, invalid or mismatched facts block the fee',()=>{
 for(const changes of [{confirmed_at:null},{confirmed_by:undefined},{amount:-1},{amount:NaN},{amount:undefined},{amount:'0.001'},{amount:90000},{cost_scope:undefined}]){
  const result=finance.evaluate(costBase({costFacts:[costFact('fact','invoice','cost',100000,changes)]}));
  assert.equal(result.costs_ok,false,JSON.stringify(changes));assert.equal(result.summary.company_fee_total,null);
 }
});
check('V2: a wrong version basis, included mode or unsupported rate cannot be chosen implicitly',()=>{
 for(const changes of [{company_fee_basis:'approved_budget'},{company_fee_mode:'included'},{company_fee_rate:undefined},{company_fee_rate:101},{confirmed_by:null}]){
  const result=finance.evaluate(costBase({contract:markupContract(changes)}));assert.equal(result.contract_ok,false);assert.equal(result.summary.company_fee_total,null);assert.equal(result.summary.chargeable_cost_total,null);
 }
});
check('V2: historical version1 is read by its own terms rather than migrated',()=>{
 const old=finance.evaluate(costBase({contract:contract()}));const next=finance.evaluate(costBase());
 assert.equal(old.version,1);assert.equal(old.summary.company_fee_total,150000);assert.equal(next.version,2);assert.equal(next.summary.company_fee_total,15000);
});
check('V2: a standalone actual project expense can be confirmed once',()=>{
 const result=finance.evaluate(markupInput({ledger:[operation('in','advance',115000),operation('manual','project_expense',100000)],costFacts:[costFact('manual-fact','ledger','manual',100000)]}));
 assert.equal(result.costs_ok,true);assert.equal(result.summary.confirmed_project_costs,100000);assert.equal(result.summary.company_fee_total,15000);assert.equal(result.summary.physical_cash_balance,15000);
});
check('V2: an unconfirmed standalone expense blocks a claimed complete zero base',()=>{
 const result=finance.evaluate(markupInput({ledger:[operation('expense','project_expense',100000)]}));
 assert.equal(result.costs_ok,false);assert.equal(result.summary.company_fee_total,null);assert.equal(result.summary.physical_cash_balance,-100000);
});
check('V2: adding a second fact for an invoice payment never doubles the base',()=>{
 const result=finance.evaluate(costBase({ledger:[operation('paid','expense',100000,{invoice_id:'cost'})],costFacts:[costFact('fact','invoice','cost',100000),costFact('duplicate','ledger','paid',100000)]}));
 assert.equal(result.costs_ok,false);assert.equal(result.summary.company_fee_total,null);assert(code(result,'INVOICE_PAYMENT_IS_NOT_SECOND_COST'));
});
check('V2: two IDs cannot confirm the same document twice',()=>{
 const result=finance.evaluate(costBase({costFacts:[costFact('one','invoice','cost',100000),costFact('two','invoice','cost',100000)]}));
 assert.equal(result.costs_ok,false);assert.equal(result.summary.known_confirmed_project_costs,100000);assert(code(result,'DUPLICATE_COST_SOURCE'));
});
check('V2: internal expenses paid from the company markup are not marked up again',()=>{
 const result=finance.evaluate(costBase({ledger:[operation('in','advance',115000),operation('paid','expense',100000,{invoice_id:'cost'}),
  operation('company-cost','fee_payment',5000,{payee_employee_id:'manager',funding_source:'company_fee'})],allocations:[allocation('fee',15000)]}));
 assert.equal(result.costs_ok,true);assert.equal(result.summary.confirmed_project_costs,100000);assert.equal(result.summary.company_fee_total,15000);
 assert.equal(result.summary.company_fee_cash_balance,10000);assert.equal(result.summary.client_cash_balance,0);
});
check('V2: explicitly excluded company invoices remain documents with no second markup',()=>{
 const result=finance.evaluate(costBase({invoices:[invoice('cost',100000),invoice('overhead',15000,{funding_source:'company_fee'})],
  costFacts:[costFact('fact','invoice','cost',100000),costFact('internal','invoice','overhead',15000,{cost_scope:'company_fee'})]}));
 assert.equal(result.costs_ok,true);assert.equal(result.summary.confirmed_project_costs,100000);assert.equal(result.summary.confirmed_company_costs,15000);assert.equal(result.summary.company_fee_total,15000);
});
check('V2: a company-funded payout cannot be promoted into a client markup cost',()=>{
 const result=finance.evaluate(markupInput({ledger:[operation('company','expense',10000,{funding_source:'company_fee'})],costFacts:[costFact('fake','ledger','company',10000)]}));
 assert.equal(result.costs_ok,false);assert(code(result,'COMPANY_FEE_COST_NOT_MARKUP_BASE'));assert.equal(result.summary.company_fee_total,null);
});
check('V2: role accrual and handed-out cash are not automatic final expenses',()=>{
 const result=finance.evaluate(markupInput({ledger:[operation('salary-accrual','role_payout',100000),operation('hand','withdrawal',10000,{funding_source:'client',purpose:'cash_handover'})]}));
 assert.equal(result.costs_ok,true);assert.equal(result.summary.company_fee_total,0);assert.equal(result.commitments_complete,false);
 for(const row of [operation('acc','role_payout',10000),operation('hand','withdrawal',10000,{funding_source:'client',purpose:'cash_handover'})]){
  const bad=finance.evaluate(markupInput({ledger:[row],costFacts:[costFact('not-cost','ledger',row.id,10000)]}));assert.equal(bad.costs_ok,false);assert(code(bad,'NON_COST_LEDGER_SOURCE'));
 }
});
check('V2: controlled supplier credit reduces the base and markup without creating cash',()=>{
 const result=finance.evaluate(costBase({costCredits:[credit('credit','fact',10000)]}));
 assert.equal(result.costs_ok,true);assert.equal(result.summary.gross_confirmed_project_costs,100000);assert.equal(result.summary.project_cost_credits,10000);
 assert.equal(result.summary.confirmed_project_costs,90000);assert.equal(result.summary.company_fee_total,13500);assert.equal(result.summary.chargeable_cost_total,103500);
 assert.equal(result.summary.physical_cash_balance,0);assert.equal(result.summary.invoice_net_total,90000);assert.equal(result.summary.unpaid_invoices,90000);
});
check('V2: credit on an already paid document is a receivable, never a fictional refund',()=>{
 const result=finance.evaluate(costBase({ledger:[operation('in','advance',115000),operation('paid','expense',100000,{invoice_id:'cost'})],costCredits:[credit('credit','fact',10000)]}));
 assert.equal(result.summary.company_fee_total,13500);assert.equal(result.summary.physical_cash_balance,15000);assert.equal(result.summary.client_refunds,0);assert.equal(result.summary.invoice_overpaid,10000);assert(code(result,'CREDIT_REFUND_NOT_YET_RECEIVED'));
});
check('V2: a refund to the client is not a supplier credit and does not change the fee base',()=>{
 const result=finance.evaluate(costBase({ledger:[operation('in','advance',115000),operation('paid','expense',100000,{invoice_id:'cost'}),operation('refund','client_refund',5000)]}));
 assert.equal(result.summary.confirmed_project_costs,100000);assert.equal(result.summary.company_fee_total,15000);assert.equal(result.summary.physical_cash_balance,10000);assert.equal(result.summary.client_refunds,5000);
});
check('V2: an over-credit, missing reference or unconfirmed credit blocks a false lower fee',()=>{
 for(const value of [credit('bad','fact',100001),credit('bad','missing',1),credit('bad','fact',10000,{confirmed_by:null}),credit('bad','fact',10000,{confirmed_at:null})]){
  const result=finance.evaluate(costBase({costCredits:[value]}));assert.equal(result.costs_ok,false);assert.equal(result.summary.company_fee_total,null);
 }
 const over=finance.evaluate(costBase({costCredits:[credit('one','fact',90000),credit('two','fact',20000)]}));assert.equal(over.costs_ok,false);assert(code(over,'COST_CREDIT_EXCEEDS_SOURCE'));
});
check('V2: foreign objects cannot contribute a fact or a cost credit',()=>{
 const source=finance.evaluate(markupInput({invoices:[invoice('foreign',100000,{project_id:'other'})],costFacts:[costFact('bad','invoice','foreign',100000)]}));
 assert.equal(source.costs_ok,false);assert(code(source,'COST_SOURCE_OUTSIDE_PROJECT'));
 const reference=finance.evaluate(costBase({costCredits:[credit('bad','foreign-fact',10000)]}));assert.equal(reference.costs_ok,false);assert(code(reference,'CREDIT_SOURCE_OUTSIDE_PROJECT'));
});
check('V2: future facts or credits cannot alter the current base',()=>{
 const noCost=finance.evaluate(costBase({costFacts:[costFact('fact','invoice','cost',100000,{entry_date:'2026-10-20',confirmed_at:'2026-10-20T10:00:00Z'})]}));assert.equal(noCost.costs_ok,false);
 const noCredit=finance.evaluate(costBase({costCredits:[credit('future','fact',10000,{entry_date:'2026-10-20',confirmed_at:'2026-10-20T10:00:00Z'})]}));assert.equal(noCredit.summary.company_fee_total,15000);
});
check('V2: a company cost credit never reduces the project markup base',()=>{
 const result=finance.evaluate(costBase({invoices:[invoice('cost',100000),invoice('internal',15000,{funding_source:'company_fee'})],
  costFacts:[costFact('fact','invoice','cost',100000),costFact('internal-fact','invoice','internal',15000,{cost_scope:'company_fee'})],costCredits:[credit('credit','internal-fact',5000)]}));
 assert.equal(result.summary.confirmed_project_costs,100000);assert.equal(result.summary.company_fee_total,15000);assert.equal(result.summary.confirmed_company_costs,10000);
});
check('V2: shrinking the agreed cost base exposes previously overallocated markup',()=>{
 const result=finance.evaluate(costBase({allocations:[allocation('allocated',15000)],costCredits:[credit('credit','fact',10000)]}));
 assert.equal(result.summary.company_fee_total,13500);assert.equal(result.summary.company_fee_allocated,15000);assert.equal(result.summary.company_fee_overallocated,1500);assert.equal(result.allocation_ok,false);
});
check('V2: an existing allocation with an unconfirmed base stays recorded and is not legitimized',()=>{
 const result=finance.evaluate(costBase({costFactsComplete:false,allocations:[allocation('allocated',15000)]}));
 assert.equal(result.summary.company_fee_total,null);assert.equal(result.summary.company_fee_allocated,15000);assert.equal(result.allocation_ok,false);assert.equal(result.summary.client_cash_balance,null);
});
check('V2: rounding applies once to the net confirmed cost total in kopecks',()=>{
 const documents=[invoice('one','0.05'),invoice('two','0.05'),invoice('three','0.05')],facts=documents.map(row=>costFact('fact-'+row.id,'invoice',row.id,'0.05'));
 const result=finance.evaluate(markupInput({invoices:documents,costFacts:facts}));assert.equal(result.summary.confirmed_project_costs,0.15);assert.equal(result.summary.company_fee_total,0.02);assert.equal(result.summary.chargeable_cost_total,0.17);
});
check('V2: fee allocation only divides existing cash after real costs',()=>{
 const result=finance.evaluate(costBase({ledger:[operation('in','advance',115000),operation('paid','expense',100000,{invoice_id:'cost'})],allocations:[allocation('fee',15000)]}));
 assert.equal(result.summary.physical_cash_balance,15000);assert.equal(result.summary.received_by_company,115000);assert.equal(result.summary.client_cash_balance,0);assert.equal(result.summary.company_fee_cash_balance,15000);assert.equal(result.conservation.difference_minor,0);
});
check('V2: the same fact and credit IDs survive duplicated snapshots without repeated markup or credit',()=>{
 const fact=costFact('fact','invoice','cost',100000),adjustment=credit('credit','fact',10000);
 const result=finance.evaluate(costBase({costFacts:[fact,{...fact}],costCredits:[adjustment,{...adjustment}]}));
 assert.equal(result.costs_ok,true);assert.equal(result.summary.confirmed_project_costs,90000);assert.equal(result.summary.company_fee_total,13500);
});
check('V2: an unconfirmed cost base never masks independently known actual cash',()=>{
 const result=finance.evaluate(costBase({costFactsComplete:false,ledger:[operation('in','advance',115000),operation('paid','expense',100000,{invoice_id:'cost'})]}));
 assert.equal(result.summary.company_fee_total,null);assert.equal(result.summary.chargeable_cost_total,null);assert.equal(result.cash_ok,true);assert.equal(result.summary.physical_cash_balance,15000);
});
check('V2: deleted sources and conflicting source copies require review instead of a silently reduced fee',()=>{
 const removed=finance.evaluate(costBase({invoices:[invoice('cost',100000,{deleted_at:'2026-10-19T12:00:00Z'})]}));
 assert.equal(removed.costs_ok,false);assert.equal(removed.summary.company_fee_total,null);assert(code(removed,'COST_SOURCE_OUTSIDE_PROJECT'));
 const row=operation('manual','project_expense',100000),bad=finance.evaluate(markupInput({ledger:[row,{...row,amount:200000}],costFacts:[costFact('fact','ledger','manual',100000)]}));
 assert.equal(bad.costs_ok,false);assert.equal(bad.summary.company_fee_total,null);assert(code(bad,'INVALID_COST_SOURCE'));
});
check('V2: crediting the entire accepted cost resets markup to an explicit zero without generating money',()=>{
 const result=finance.evaluate(costBase({ledger:[operation('in','advance',115000)],costCredits:[credit('cancel-cost','fact',100000)]}));
 assert.equal(result.costs_ok,true);assert.equal(result.summary.confirmed_project_costs,0);assert.equal(result.summary.company_fee_total,0);assert.equal(result.summary.chargeable_cost_total,0);assert.equal(result.summary.physical_cash_balance,115000);
});
check('V2: evaluation is immutable and order independent for facts and distinct credits',()=>{
 const value=costBase({costCredits:[credit('one','fact',1000),credit('two','fact',2000)]}),snapshot=JSON.stringify(value),one=finance.evaluate(value),two=finance.evaluate({...value,costCredits:[...value.costCredits].reverse()});
 assert.equal(JSON.stringify(value),snapshot);assert.deepEqual(one.minor,two.minor);assert.equal(one.summary.company_fee_total,14550);
});
check('V2: explicit saved legacy rates 0, 10 and 20 are preserved instead of overwritten by the new default 15',()=>{
 for(const company_fee_rate of [0,10,15,20]){
  const result=finance.evaluate(costBase({contract:markupContract({company_fee_rate})}));
  assert.equal(result.contract_ok,true);assert.equal(result.contract.company_fee_rate,company_fee_rate);assert.equal(result.summary.company_fee_total,100000*company_fee_rate/100);assert.equal(result.summary.chargeable_cost_total,100000+100000*company_fee_rate/100);
 }
});
check('V2: fractional percentages use basis points and half-up kopeck rounding on the complete base',()=>{
 const result=finance.evaluate(markupInput({contract:markupContract({company_fee_rate:'12.50'}),invoices:[invoice('cost','0.04')],costFacts:[costFact('fact','invoice','cost','0.04')]}));
 assert.equal(result.contract.company_fee_rate,12.5);assert.equal(result.summary.company_fee_total,0.01);assert.equal(result.summary.chargeable_cost_total,0.05);
 for(const company_fee_rate of [-1,100.01,'15.001',NaN,Infinity,null,''])assert.equal(finance.normalizeContract(markupContract({company_fee_rate})).ok,false);
});
// The existing object card is also a consumer of these rules. Exercise its
// exported function bodies without a browser or a production transport.
const cardSource=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function cardFixture(changes={}){
 const scope={window:{},Intl,Date,console,state:{projects:[],departments:[{id:'construction',name:'Строительный отдел'}],categories:[{id:'build',name:'Строительство',department_id:'construction'}],ledger:[],invoices:[],...changes},financeToday:()=>day,
  findCategory:id=>scope.state.categories.find(row=>row.id===id),
  fmtMoney:value=>Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽'};
 scope.isInvoiceLinkedExpense=row=>!!scope.window.ARHITTEKCash.invoicePaymentId(row)&&scope.state.invoices.some(invoice=>invoice.project_id===row.project_id&&invoice.id===scope.window.ARHITTEKCash.invoicePaymentId(row)&&!invoice.deleted_at);
 vm.createContext(scope);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','cash-finance.js'),'utf8'),scope);
 vm.runInContext(cardSource.slice(cardSource.indexOf('const CONSTRUCTION_INCOME_TYPES ='),cardSource.indexOf('let activeConstrStatusFilter =')),scope);
 vm.runInContext(cardSource.slice(cardSource.indexOf('function constructionCompanyFeePlanHtml('),cardSource.indexOf('// История поступлений от заказчика по объекту стройки')),scope);
 return scope;
}
const object=(changes={})=>({id:'object',name:'Ремонт',category_id:'build',price:1000000,employee_id:'worker',fee_percent:15,...changes});
check('Existing card: 100000 documented costs plus 15% is 115000 with or without an employee',()=>{
 const app=cardFixture({invoices:[invoice('document',100000)]});
 for(const employee_id of ['worker',null]){const f=app.getConstructionFinancials(object({employee_id}));assert.equal(f.companyMarkupBase,100000);assert.equal(f.companyMarkupAmount,15000);assert.equal(f.totalWithMarkup,115000);}
});
check('Existing card: an advance alone or a changed planned budget creates no markup',()=>{
 const app=cardFixture({ledger:[operation('receipt','advance',100000)]});
 for(const price of [0,1000000,2000000]){const f=app.getConstructionFinancials(object({price}));assert.equal(f.companyMarkupAmount,0);assert.equal(f.totalWithMarkup,0);assert.equal(f.balance,100000);}
});
check('Existing card: unpaid documents affect the calculation but do not spend cash',()=>{
 const app=cardFixture({ledger:[operation('receipt','advance',115000)],invoices:[invoice('document',100000)]}),f=app.getConstructionFinancials(object());
 assert.equal(f.balance,115000);assert.equal(f.unpaidInvoices,100000);assert.equal(f.companyMarkupAmount,15000);assert.equal(f.calculatedAdvanceBalance,0);
});
check('Existing card: partial payment changes cash once without a second cost or fee',()=>{
 const app=cardFixture({ledger:[operation('receipt','advance',115000),operation('paid','project_expense',20000,{description:'[invoice-payment:document]'})],invoices:[invoice('document',100000)]}),f=app.getConstructionFinancials(object());
 assert.equal(f.balance,95000);assert.equal(f.unpaidInvoices,80000);assert.equal(f.companyMarkupBase,100000);assert.equal(f.companyMarkupAmount,15000);assert.equal(f.calculatedAdvanceBalance,0);
});
check('Existing card: direct client purchase is included in markup but never deducted twice from the advance',()=>{
 const app=cardFixture({ledger:[operation('receipt','advance',15000)],invoices:[invoice('direct',100000,{paid_by_client:true})]}),f=app.getConstructionFinancials(object());
 assert.equal(f.balance,15000);assert.equal(f.directPaid,100000);assert.equal(f.companyMarkupAmount,15000);assert.equal(f.calculatedAdvanceBalance,0);
});
check('Existing card: legacy rates and recorded company fee remain intact and generate no employee commission',()=>{
 const app=cardFixture({invoices:[invoice('document',100000)]});
 for(const fee_percent of [0,10,20]){
  const p=object({fee_percent,fee_paid:1234,co_fee_percent:20,co_employee_id:'other',co_fee_paid:55}),before=JSON.stringify(p),f=app.getConstructionFinancials(p),personal=app.calcConstrFee({...p,expenses:f.directCosts});
  assert.equal(f.companyMarkupAmount,100000*fee_percent/100);assert.equal(f.companyMarkupRecordedPaid,1234);assert.equal(personal.feeAmount,0);assert.equal(personal.paid,0);assert.equal(personal.remaining,0);assert.equal(personal.companyMarkupAmount,f.companyMarkupAmount);assert.equal(JSON.stringify(p),before);
 }
});
check('Existing card: future and removed source documents do not alter today markup or cash',()=>{
 const app=cardFixture({ledger:[operation('receipt','advance',115000),operation('future-cost','expense',70000,{entry_date:'2099-01-01'}),operation('removed-cost','expense',90000,{deleted_at:'2026-10-19T10:00:00Z'})],invoices:[invoice('today',100000),invoice('future',80000,{invoice_date:'2099-01-01'}),invoice('removed',50000,{deleted_at:'2026-10-19T10:00:00Z'})]}),f=app.getConstructionFinancials(object());
 assert.equal(f.companyMarkupBase,100000);assert.equal(f.companyMarkupAmount,15000);assert.equal(f.balance,115000);
});
check('Existing card: work accruals and salary payments never become a second markup base',()=>{
 const app=cardFixture({ledger:[operation('labor','role_payout',50000,{payee_employee_id:'worker'}),operation('paid','payment',5000,{payee_employee_id:'worker'})],invoices:[invoice('document',100000)]}),f=app.getConstructionFinancials(object());
 assert.equal(f.rolePayouts,50000);assert.equal(f.cashOutgoing,5000);assert.equal(f.companyMarkupBase,100000);assert.equal(f.companyMarkupAmount,15000);
});
check('Existing card: exact fractional costs round markup on the accumulated base once',()=>{
 const app=cardFixture({invoices:[invoice('one','0.05'),invoice('two','0.05'),invoice('three','0.05')]}),f=app.getConstructionFinancials(object());
 assert.equal(f.companyMarkupBase,0.15);assert.equal(f.companyMarkupAmount,0.02);assert.equal(f.totalWithMarkup,0.17);
 const half=app.constructionCompanyMarkup(object({fee_percent:50}),0.29);assert.equal(half.companyMarkupAmount,0.15);assert.equal(half.totalWithMarkup,0.44);
 const fractionalRate=app.constructionCompanyMarkup(object({fee_percent:0.29}),50);assert.equal(fractionalRate.companyMarkupAmount,0.15);assert.equal(fractionalRate.totalWithMarkup,50.15);
});
check('Existing card: missing percentage stays unknown while explicit zero stays zero',()=>{
 const app=cardFixture({invoices:[invoice('document',100000)]});
 for(const fee_percent of [null,undefined,'',-1,101]){const f=app.getConstructionFinancials(object({fee_percent}));assert.equal(f.companyMarkupAmount,null);assert.equal(f.totalWithMarkup,null);assert.equal(f.balance,0);}
 const zero=app.getConstructionFinancials(object({fee_percent:0}));assert.equal(zero.companyMarkupAmount,0);assert.equal(zero.totalWithMarkup,100000);
});
check('Existing card: fee display uses documentary costs, labels cash separately and never changes state',()=>{
 const app=cardFixture({invoices:[invoice('document',100000)],ledger:[operation('receipt','advance',115000)]}),p=object(),snapshot=JSON.stringify(app.state),html=app.constructionCompanyFeePlanHtml(p);
 assert(html.includes('Открытая наценка ARHITTEK'));assert(html.includes('Расходы по документам'));assert(html.includes('15% сверх расходов'));assert(html.includes('Расчётный остаток аванса'));assert(!html.includes('бюджета'));assert.equal(JSON.stringify(app.state),snapshot);
});
console.log(`Construction finance: ${checks}/${checks} checks passed.`);
