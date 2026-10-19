const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'], headless: true});
  const context = await browser.newContext({timezoneId: 'Europe/Berlin', serviceWorkers: 'block'});
  await context.addInitScript(() => {
    const OriginalDate = Date;
    window.__clockNow = '2026-11-15T12:00:00Z';
    window.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [window.__clockNow])); }
      static now() { return OriginalDate.parse(window.__clockNow); }
    };
  });
  await context.addInitScript({path: path.join(__dirname, 'mock.js')});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'app.test') {
      const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      if (fs.existsSync(file)) return route.fulfill({path: file,
        contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : undefined});
    }
    for (const [key, file] of [['xlsx@', 'xlsx/dist/xlsx.full.min.js'], ['jspdf@', 'jspdf/dist/jspdf.umd.min.js'],
      ['jspdf-autotable@', 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js']]) {
      if (url.href.includes(key)) return route.fulfill({path: path.join(process.env.TEST_DEPS || path.join(root, 'node_modules'), file), contentType: 'text/javascript'});
    }
    return route.fulfill({body: '', contentType: 'text/javascript'});
  });
  const page = await context.newPage(), results = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://app.test/');
  await page.waitForTimeout(150);
  async function check(name, fn, expected) {
    try { const actual = await page.evaluate(fn); assert.deepEqual(actual, expected); results.push({name, pass: true}); }
    catch (error) { results.push({name, pass: false, error: error.message}); }
  }
  await check('An unspecified percentage does not add a project fee to a salaried employee', () => {
    const p = {category_id: 'arch', employee_id: 'admin', price: 50000, expenses: 2400, fee_percent: null};
    return [getProjectFee(p).mainFeeAmount, getProjectFee({...p, fee_percent: undefined}).mainFeeAmount];
  }, [0, 0]);
  await check('A non-salaried project employee keeps the category percentage fallback', () =>
    getProjectFee({category_id: 'arch', employee_id: 'architect', price: 50000, expenses: 2400, fee_percent: null}).mainFeeAmount,
  19040);
  await check('An explicit historical percentage for a salaried employee is preserved', () =>
    getProjectFee({category_id: 'arch', employee_id: 'admin', price: 50000, expenses: 2400, fee_percent: 40}).mainFeeAmount,
  19040);
  await check('A salaried manager without a percentage has no inferred commission', () => {
    const e = {id: 'salaried-manager', role: 'Менеджер', is_salaried: true}; state.employees.push(e);
    const p = {category_id: 'arch', employee_id: e.id, price: 50000, fee_percent: null};
    const result = [getProjectFee(p).mainFeeAmount, projectManagerSlots(p)[0]?.[1]];
    state.employees = state.employees.filter(row => row.id !== e.id); return result;
  }, [0, 0]);
  await page.evaluate(async () => {
    __db.projects = [{id: 'old-salary', name: 'Старый проект на окладе', category_id: 'arch',
      status_id: 'done', employee_id: 'admin', price: 50000, advance: 50000, expenses: 0,
      fee_percent: null, fee_base: 'profit', fee_paid: 0, created_at: '2026-06-13T00:00:00Z',
      updated_at: '2026-06-25T00:00:00Z'}];
    __db.ledger_entries = [{id: 'old-salary-income', project_id: 'old-salary', type: 'advance',
      amount: 50000, entry_date: '2026-06-25', created_at: '2026-06-25T00:00:00Z'}];
    __db.company_income = []; __db.company_expenses = []; await loadAll();
  });
  await check('A later album expense on an old salaried project debits only its actual cost', async () => {
    const before = getCompanyReserveBalance();
    __db.projects[0].expenses = 2400; __db.projects[0].updated_at = '2026-10-13T00:00:00Z';
    __db.ledger_entries.push({id: 'old-album', project_id: 'old-salary', type: 'project_expense',
      amount: 2400, entry_date: '2026-10-13', created_at: '2026-10-13T00:00:00Z'});
    await loadAll(); const budget = ARHITTEKCash.projectBudget(state);
    return [before, budget.available, budget.teamHeld];
  }, [20000, 17600, 0]);
  await check('The project card shows salary without inventing the category fee', () => {
    openProjectSheet('old-salary');
    return document.getElementById('team-main-result').textContent.includes('На окладе');
  }, true);
  await check('Other income increases reserve once and assigns only 5% to amortization', async () => {
    const before = ARHITTEKCash.projectBudget(state);
    __db.company_income.push({id: 'other-sale', category: 'Прочий доход', amount: 35000,
      income_date: '2026-10-13', created_at: '2026-10-13T00:00:00Z'});
    await loadAll(); await loadAll(); const after = ARHITTEKCash.projectBudget(state);
    return [after.available - before.available, after.amortization - before.amortization,
      after.teamHeld - before.teamHeld, after.projectsHeld - before.projectsHeld,
      ARHITTEKCash.cashEvents(state).filter(e => e.row.id === 'other-sale').length];
  }, [33250, 1750, 0, 0, 1]);
  await page.evaluate(async () => {
    __db.projects = []; await loadAll();
    __db.ledger_entries = [
      {id: 'old', type: 'advance', amount: 90000, entry_date: '2026-10-01', created_at: '2026-10-01T00:00:00Z'},
      {id: 'new', type: 'advance', amount: 50000, entry_date: '2026-10-10', created_at: '2026-10-10T00:00:00Z'}];
    __db.company_income = [{id: 'nov', category: 'Прочий доход', amount: 40000, income_date: '2026-11-02', created_at: '2026-11-02T00:00:00Z'}];
    await loadAll(); renderCashFinance();
  });
  await check('October opening + movements equals closing', () => {
    const s = ARHITTEKCash.monthSummary(state, '2026-10');
    return [s.incoming, s.outgoing, s.opening + s.incoming - s.outgoing, s.closing];
  }, [50000, 0, 70000, 70000]);
  await check('Historical operations stay visible', () => ARHITTEKCash.monthSummary(state, '2026-10').events.length, 2);
  await check('Reserve excludes allocated money while cash stays auditable', () => [getCompanyReserveBalance(), getCompanyCashBalance()], [105500, 110000]);
  await check('October overview uses October available balance', () => {
    const picker = document.getElementById('cashMonth'); picker.value = '2026-10'; picker.dispatchEvent(new Event('change'));
    return document.querySelector('#cash-panel-overview .finance-kpi strong').textContent.replace(/\D/g, '');
  }, '67500');
  await check('Reloading data does not move reserve', async () => {
    const before = ARHITTEKCash.balance(state); await loadAll(); await loadAll(); return ARHITTEKCash.balance(state) === before;
  }, true);
  await check('Imported expense is not a new cash payment', () => {
    state.ledger.push({id: 'import', type: 'project_expense', description: 'Ранее внесённые расходы', amount: 18000,
      entry_date: '2026-10-06', created_at: '2026-10-11T00:00:00Z'});
    return ARHITTEKCash.balance(state);
  }, 110000);
  await check('A receipt note cannot switch off amortization', () => {
    state.ledger.push({id: 'note', type: 'advance', description: 'Сверка оплаты по проекту', amount: 20000,
      entry_date: '2026-10-12', created_at: '2026-10-12T00:00:00Z'});
    return ARHITTEKCash.amortization(state);
  }, 5500);
  await check('Editing an adjustment preserves its income category', () => {
    state.companyIncome.push({id: 'adjust-plus', category: RESERVE_INCREASE_CATEGORY, amount: 5000, income_date: '2026-11-15'});
    openCompanyIncomeSheet('adjust-plus'); return document.getElementById('cin-category').value;
  }, 'Корректировка резерва (+)');
  await check('Editing an adjustment preserves its expense category', () => {
    state.companyExpenses.push({id: 'adjust-minus', category: RESERVE_DECREASE_CATEGORY, amount: 5000, expense_date: '2026-11-15'});
    openCompanyExpenseSheet('adjust-minus'); return document.getElementById('cex-category').value;
  }, 'Корректировка резерва (−)');
  await page.evaluate(async () => { __db.company_income = []; __db.company_expenses = []; __db.ledger_entries = []; await loadAll(); });
  await check('Two income submits create one receipt', async () => {
    openCompanyIncomeSheet(null); document.getElementById('cin-amount').value = '20000';
    await Promise.all([saveCompanyIncome(), saveCompanyIncome()]); return __db.company_income.length;
  }, 1);
  await check('Two expense submits create one payment', async () => {
    openCompanyExpenseSheet(null); document.getElementById('cex-amount').value = '10000';
    await Promise.all([saveCompanyExpense(), saveCompanyExpense()]); return __db.company_expenses.length;
  }, 1);
  await check('Two salary clicks create one payment', async () => {
    openSalaryPaymentSheet('admin', '2026-10'); document.getElementById('salaryPaymentAmount').value = '20000';
    const button = document.getElementById('salaryPaymentSave'); button.click(); button.click();
    await new Promise(resolve => setTimeout(resolve, 150));
    return __db.ledger_entries.filter(row => row.type === 'salary_payment').length;
  }, 1);
  await check('Future salary is not already paid', () => {
    state.ledger = [{id: 'future-pay', type: 'salary_payment', payee_employee_id: 'admin', amount: 20000,
      entry_date: '2026-11-20', description: '[salary:2026-10]'}];
    return salaryPaymentState('admin', '2026-10', 50000).paid;
  }, 0);
  await check('Moscow dates agree across finance forms at midnight', () => {
    __clockNow = '2026-10-31T21:30:00Z'; openCompanyIncomeSheet(null); openCompanyExpenseSheet(null);
    openSalaryPaymentSheet('admin', '2026-10');
    return [ARHITTEKCash.day(), document.getElementById('cin-date').value,
      document.getElementById('cex-date').value, document.getElementById('salaryPaymentDate').value];
  }, ['2026-11-01', '2026-11-01', '2026-11-01', '2026-11-01']);
  await page.evaluate(async () => {
    __clockNow = '2026-11-15T12:00:00Z';
    __db.projects = [{id: 'p', name: 'Test', category_id: 'design', status_id: 'active', fee_base: 'm2', price: 100000,
      advance: 20000, balance: 80000, expenses: 0, created_at: '2026-10-01T00:00:00Z'}];
    __db.ledger_entries = []; await loadAll();
  });
  await check('Failed payment insert leaves project and cash unchanged', async () => {
    openPaymentSheet('p'); document.getElementById('payment-amount').value = '10000';
    __fail = {table: 'ledger_entries', op: 'insert'}; await savePayment(); __fail = null;
    return [__db.projects[0].advance, __db.projects[0].balance, __db.ledger_entries.length];
  }, [20000, 80000, 0]);
  await check('Failed income save can be retried once', async () => {
    openCompanyIncomeSheet(null); document.getElementById('cin-amount').value = '7000';
    __fail = {table: 'company_income', op: 'insert'}; await saveCompanyIncome(); __fail = null;
    const before = __db.company_income.length; await saveCompanyIncome(); return __db.company_income.length - before;
  }, 1);
  await page.evaluate(async () => {
    __db.projects = [{id: 'settlement', name: 'Тестовый расчёт', category_id: 'arch', status_id: 'done', fee_base: 'profit',
      employee_id: 'visual', co_employee_id: 'architect', price: 100000, advance: 55000, balance: 45000,
      expenses: 0, fee_percent: 20, co_fee_percent: 40, fee_paid: 0, co_fee_paid: 0, end_date: '2026-11-14'}];
    __db.ledger_entries = [{id: 'historical', project_id: 'settlement', type: 'advance', amount: 30000,
      entry_date: '2026-09-10', created_at: '2026-11-10T00:00:00Z'},
      {id: 'final', project_id: 'settlement', type: 'final_payment', amount: 55000,
      entry_date: '2026-11-10', created_at: '2026-11-10T00:00:00Z'}];
    __db.company_income = [{id: 'lease', category: 'Аренда помещений', amount: 20000,
      income_date: '2026-11-10', created_at: '2026-11-10T00:00:00Z'}]; __db.company_expenses = []; await loadAll();
  });
  await check('A co-executor payment belongs to that employee', async () => {
    openPaymentSheet('settlement'); document.querySelector('#payment-type [data-value="fee_payment"]').click();
    document.getElementById('payment-payee').value = 'architect'; document.getElementById('payment-amount').value = '34000';
    await savePayment();
    return [__db.projects[0].fee_paid, __db.projects[0].co_fee_paid,
      __db.ledger_entries.find(row => row.type === 'fee_payment')?.payee_employee_id];
  }, [0, 34000, 'architect']);
  await check('Cash and company budget differ by unpaid fees and amortization', () => [ARHITTEKCash.balance(state), ARHITTEKCash.available(state)], [61000, 31250]);
  await check('Cash groups cover every movement exactly once', () => {
    const f = ARHITTEKCash.flowSummary(ARHITTEKCash.cashEvents(state).filter(e => e.afterSnapshot));
    return [f.clients, f.otherIncome, f.team, f.projects, f.company, f.withdrawals, f.adjustments];
  }, [55000, 20000, 34000, 0, 0, 0, 0]);
  await check('Failed cancellation preserves cash and co-executor payment', async () => {
    const row = state.ledger.find(row => row.type === 'fee_payment'); __fail = {table: 'projects', op: 'update'};
    await cancelPayment(row.id); __fail = null;
    return [ARHITTEKCash.balance(state), __db.projects[0].co_fee_paid, !!__db.ledger_entries.find(e => e.id === row.id).deleted_at];
  }, [61000, 34000, false]);
  await check('Cancel and concurrent restore preserve one co-executor payment', async () => {
    const row = state.ledger.find(row => row.type === 'fee_payment'); await cancelPayment(row.id); await loadDeferredData();
    await Promise.all([restoreItem('ledger_entries', row.id, 'Выплата'), restoreItem('ledger_entries', row.id, 'Выплата')]);
    return [ARHITTEKCash.balance(state), __db.projects[0].fee_paid, __db.projects[0].co_fee_paid];
  }, [61000, 0, 34000]);
  await check('Manager payment on an active project prevents a second payroll payment', () => {
    state.employees.push({id: 'manager', name: 'Test manager', role: 'Менеджер'});
    state.projects.push({id: 'managed', employee_id: 'manager', status_id: 'active', fee_base: 'profit'});
    state.ledger.push({id: 'manager-paid', project_id: 'managed', type: 'fee_payment', amount: 5000,
      payee_employee_id: 'manager', entry_date: '2026-11-14'});
    const payment = salaryPaymentState('manager', '2026-11', 10000); return [payment.paid, payment.remaining];
  }, [5000, 5000]);
  await check('Overpayment is visible and never clamped to the accrued amount', () => {
    state.ledger.push({id: 'overpaid', type: 'salary_payment', payee_employee_id: 'admin', amount: 35000,
      description: '[salary:2026-11]', entry_date: '2026-11-14'});
    const payment = salaryPaymentState('admin', '2026-11', 30000); return [payment.paid, payment.overpaid, payment.remaining];
  }, [35000, 5000, 0]);
  await page.evaluate(async () => {
    __db.projects = [{id: 'build-test', name: 'Тестовая стройка', category_id: 'build', status_id: 'active', fee_base: 'price', expenses: 20000}];
    __db.invoices = [{id: 'invoice-test', project_id: 'build-test', item_type: 'Материал', description: 'Тестовая закупка', amount: 20000,
      invoice_date: '2026-11-14', created_at: '2026-11-14T00:00:00Z', paid_by_client: false}];
    __db.ledger_entries = []; __db.company_income = []; __db.company_expenses = []; await loadAll();
  });
  await check('Invoice cost alone does not pretend to be a cash payment', () => [ARHITTEKCash.balance(state), getProjectExpenses(state.projects[0])], [20000, 20000]);
  await check('Double invoice payment click debits cash once', async () => {
    openInvoicePayment('invoice-test'); document.getElementById('cashInvoiceAmount').value = '5000';
    const save = document.getElementById('cashInvoiceSave'); save.click(); save.click(); await new Promise(resolve => setTimeout(resolve, 150));
    return [__db.ledger_entries.filter(r => !r.deleted_at).length, ARHITTEKCash.balance(state), getProjectExpenses(state.projects[0])];
  }, [1, 15000, 20000]);
  await check('Linking an existing expense changes neither cash nor invoice cost twice', async () => {
    __db.ledger_entries.push({id: 'existing-expense', project_id: 'build-test', type: 'project_expense', amount: 15000,
      description: 'Оплачены материалы', entry_date: '2026-11-14', created_at: '2026-11-14T00:00:00Z'});
    await loadAll(); const before = ARHITTEKCash.balance(state); openInvoicePayment('invoice-test');
    const select = document.getElementById('cashInvoiceExisting'); select.value = 'existing-expense'; select.dispatchEvent(new Event('change'));
    document.getElementById('cashInvoiceSave').click(); await new Promise(resolve => setTimeout(resolve, 150));
    return [ARHITTEKCash.balance(state) === before, getProjectExpenses(state.projects[0]),
      ARHITTEKCash.invoicePaymentState(state, state.invoices[0]).remaining];
  }, [true, 20000, 0]);
  await check('Cancelling invoice payment restores cash once', async () => {
    openInvoicePayment('invoice-test'); document.querySelector('#cashInvoiceOverlay [data-id="existing-expense"]').click();
    await new Promise(resolve => setTimeout(resolve, 150));
    return [ARHITTEKCash.balance(state), ARHITTEKCash.invoicePaymentState(state, state.invoices[0]).remaining, getProjectExpenses(state.projects[0])];
  }, [15000, 15000, 20000]);
  await check('Client-paid invoice cannot create a company payment', () => {
    document.getElementById('cashInvoiceOverlay').classList.remove('active'); state.invoices[0].paid_by_client = true;
    openInvoicePayment('invoice-test'); const opened = document.getElementById('cashInvoiceOverlay').classList.contains('active');
    state.invoices[0].paid_by_client = false; return opened;
  }, false);
  await check('Paid invoice cannot be deleted while its payment exists', async () => {
    const before = __db.invoices.length; openInvoiceSheet('invoice-test'); await deleteInvoiceSheet(); return __db.invoices.length === before;
  }, true);
  await check('Audit export excludes employee credentials', () => {
    state.employees[0].pin = 'test-secret'; state.employees[0].auth_token = 'test-secret';
    const data = ARHITTEKCash.auditData(state); return [JSON.stringify(data).includes('test-secret'), data.calculation.balance];
  }, [false, 15000]);
  await check('A failed refresh visibly marks the reserve as stale', async () => {
    __fail = {table: 'company_expenses', op: 'select'}; await loadAll(); __fail = null;
    const text = document.getElementById('cash-panel-reserve').textContent;
    const stale = !!state.financialDataError && text.includes('Не удалось обновить операции'); await loadAll(); return stale;
  }, true);
  await check('Missing operation timestamps are visible rather than silently trusted', () => {
    state.companyIncome.push({id: 'missing-time', category: 'Прочий доход', amount: 1000, income_date: '2026-11-15'});
    renderCashFinance(); const visible = document.getElementById('cash-panel-reserve').textContent.includes('операций без даты создания');
    state.companyIncome.pop(); renderCashFinance(); return visible;
  }, true);
  await page.evaluate(async () => {
    __clockNow = '2026-10-11T09:00:00Z';
    __db.employees.push({id:'budget-manager',name:'Тестовый менеджер',role:'Менеджер',active:true});
    __db.projects = [
      {id:'budget-old',name:'Завершён до сверки',category_id:'arch',status_id:'done',employee_id:'visual',fee_base:'profit',fee_percent:20,price:105000,advance:105000,expenses:5000,end_date:'2026-10-01'},
      {id:'budget-closed',name:'Завершён после сверки',category_id:'arch',status_id:'done',employee_id:'architect',fee_base:'profit',fee_percent:40,price:85000,advance:85000,expenses:0,end_date:'2026-10-06',updated_at:'2026-10-11T07:25:00Z'},
      {id:'budget-active-1',name:'Активный проект 1',category_id:'arch',status_id:'active',employee_id:'architect',co_employee_id:'budget-manager',fee_base:'profit',fee_percent:50,co_fee_percent:25,price:60000,advance:30000,expenses:0,end_date:'2026-10-20'},
      {id:'budget-active-2',name:'Активный проект 2',category_id:'arch',status_id:'active',employee_id:'admin',co_employee_id:'budget-manager',fee_base:'profit',fee_percent:0,co_fee_percent:15,price:100000,advance:40000,expenses:0,end_date:'2026-10-21'}];
    const row=(id,project_id,type,amount,extra={})=>({id,project_id,type,amount,entry_date:'2026-10-10',created_at:'2026-10-10T00:00:00Z',...extra});
    __db.ledger_entries = [row('budget-early','budget-closed','advance',30000,{entry_date:'2026-09-23',created_at:'2026-09-23T00:00:00Z'}),
      row('budget-final-old','budget-old','final_payment',65000),row('budget-a1','budget-active-1','advance',30000),row('budget-a2','budget-active-2','advance',40000),row('budget-final','budget-closed','final_payment',55000),
      row('budget-pay1',null,'salary_payment',20000,{payee_employee_id:'visual',description:'[salary:2026-10]'}),row('budget-pay2',null,'salary_payment',7000,{payee_employee_id:'designer',description:'[salary:2026-10]'})];
    __db.invoices=[];__db.company_income=[];__db.company_expenses=[{id:'budget-costs',category:'Прочие расходы',amount:42600,expense_date:'2026-10-10',created_at:'2026-10-10T00:00:00Z'}];
    __db.timesheet_payments=[];await loadAll();renderCashFinance();
  });
  await check('Company reserve uses one cash base and excludes project money and team debt',()=>{
    const b=ARHITTEKCash.projectBudget(state);return [b.cashBalance,b.releasedOpeningFunds,b.projectsHeld,b.teamHeld,b.amortization,getCompanyReserveBalance()];
  },[140400,30000,66500,34000,9500,30400]);
  await check('Reserve hero shows the company share, with the old advance explained separately',()=>{
    renderCashFinance();return [document.querySelector('[data-company-reserve]').textContent.replace(/\D/g,''),document.getElementById('cash-panel-reserve').textContent.includes('Они не являются новым приходом и не прибавлены к деньгам')];
  },['30400',true]);
  await check('Project fee payout leaves company reserve and forecast unchanged',async()=>{
    const before=ARHITTEKCash.available(state),forecast=document.querySelector('#cash-panel-forecast .fee-row.total .fv').textContent;
    openPaymentSheet('budget-closed');document.querySelector('#payment-type [data-value="fee_payment"]').click();document.getElementById('payment-amount').value='34000';await savePayment();renderCashFinance();
    return [ARHITTEKCash.available(state)===before,ARHITTEKCash.projectBudget(state).teamHeld,ARHITTEKCash.balance(state),document.querySelector('#cash-panel-forecast .fee-row.total .fv').textContent===forecast];
  },[true,0,106400,true]);
  await check('Reopening and re-closing restores one company share without creating money',async()=>{
    const before=getCompanyReserveBalance(),cash=getCompanyCashBalance();__db.projects.find(p=>p.id==='budget-closed').status_id='active';await loadAll();const reopened=getCompanyReserveBalance();
    __db.projects.find(p=>p.id==='budget-closed').status_id='done';await loadAll();return [reopened,before,getCompanyReserveBalance(),getCompanyCashBalance()===cash];
  },[12150,30400,30400,true]);
  await check('Withdrawal is limited to company money even when recorded cash is higher',async()=>{
    const before=__db.company_expenses.length;openCompanyWithdrawal();document.getElementById('cex-amount').value='70000';document.getElementById('cex-desc').value='Тест вывода';await saveCompanyExpense();closeCompanyExpenseSheet();return __db.company_expenses.length===before;
  },true);
  await check('Common expense debits company reserve once and reload never re-transfers the old advance',async()=>{
    openCompanyExpenseSheet(null);document.getElementById('cex-amount').value='1000';await saveCompanyExpense();await loadAll();await loadAll();return getCompanyReserveBalance();
  },29400);
  await page.evaluate(()=>{__clockNow='2026-10-17T14:00:00Z';renderCashFinance();});
  await check('A physical cash count records all money separately from receipts and payments',async()=>{
    const before=[__db.company_income.length,__db.company_expenses.length,__db.ledger_entries.length];
    openReserveCorrection();document.getElementById('cashBalanceValue').value='158000';document.getElementById('cashBalanceNote').value='Тестовая сверка кассы и счетов';
    document.getElementById('cashBalanceSave').click();document.getElementById('cashBalanceSave').click();
    await new Promise(resolve=>setTimeout(resolve,220));await loadAll();renderCashFinance();
    const counts=__db.audit_log.filter(r=>r.action==='cash_count');
    return [counts.length,ARHITTEKCash.balance(state),ARHITTEKCash.bookBalance(state),getCompanyReserveBalance(),
      JSON.stringify(before)===JSON.stringify([__db.company_income.length,__db.company_expenses.length,__db.ledger_entries.length])];
  },[1,158000,105400,82000,true]);
  await check('Money total, reserve and open discrepancy are visibly distinct',()=>{
    const reserve=document.getElementById('cash-panel-reserve');
    return [reserve.querySelector('[data-company-total]').textContent.replace(/\D/g,''),
      reserve.querySelector('[data-company-reserve]').textContent.replace(/\D/g,''),
      !!reserve.querySelector('[data-cash-discrepancy]'),reserve.textContent.includes('не записывается расходом или доходом')];
  },['158000','82000',true,true]);
  await check('The first financial load retains a count without waiting for the general audit history',async()=>{
    state.cashCounts=[];state.history=[];await loadAll();
    return [state.cashCounts.length,ARHITTEKCash.balance(state)];
  },[1,158000]);
  await check('A failed count read hides unconfirmed financial amounts',async()=>{
    __fail={table:'audit_log',op:'select'};await loadAll();__fail=null;
    const hidden=!state.financialDataReady&&document.getElementById('cash-panel-reserve').textContent.includes('Не удалось обновить операции');
    await loadAll();return hidden;
  },true);
  await check('A failed count save leaves cash and all monetary records unchanged',async()=>{
    const before=[__db.company_income.length,__db.company_expenses.length,__db.ledger_entries.length,__db.audit_log.length];
    openReserveCorrection();document.getElementById('cashBalanceValue').value='150000';__fail={table:'audit_log',op:'insert'};
    document.getElementById('cashBalanceSave').click();await new Promise(resolve=>setTimeout(resolve,180));__fail=null;
    return [ARHITTEKCash.balance(state),JSON.stringify(before)===JSON.stringify([__db.company_income.length,__db.company_expenses.length,__db.ledger_entries.length,__db.audit_log.length])];
  },[158000,true]);
  await check('Negative physical money is rejected without changing the count',async()=>{
    document.getElementById('cashBalanceValue').value='-1';document.getElementById('cashBalanceSave').click();
    await new Promise(resolve=>setTimeout(resolve,80));return [__db.audit_log.filter(r=>r.action==='cash_count').length,ARHITTEKCash.balance(state)];
  },[1,158000]);
  await check('Audit export preserves the actual cash observation and unresolved journal difference',()=>{
    const data=ARHITTEKCash.auditData(state);return [data.cashCounts.length,data.calculation.balance,data.calculation.bookBalance,data.calculation.difference];
  },[1,158000,105400,-52600]);
  await page.evaluate(()=>{__clockNow='2026-10-17T15:00:00Z';});
  await check('A same-day old expense can be restored without spending counted money again',async()=>{
    const before=ARHITTEKCash.bookBalance(state);
    openCompanyExpenseSheet(null);document.getElementById('cex-amount').value='1000';
    document.getElementById('cex-desc').value='Восстановлен старый расход';
    document.getElementById('counted-before-cex-desc').checked=true;await saveCompanyExpense();
    return [ARHITTEKCash.balance(state),ARHITTEKCash.bookBalance(state)-before];
  },[158000,-1000]);
  await check('Editing a restored expense keeps its counted flag and clean comment',async()=>{
    const row=__db.company_expenses.find(r=>r.description?.startsWith('Восстановлен старый расход'));
    openCompanyExpenseSheet(row.id);
    const visible=[document.getElementById('counted-before-cex-desc').checked,document.getElementById('cex-desc').value];
    document.getElementById('cex-amount').value='2000';await saveCompanyExpense();
    return [...visible,ARHITTEKCash.balance(state),ARHITTEKCash.bookBalance(state)];
  },[true,'Восстановлен старый расход',158000,103400]);
  await check('A genuine new payment after the count still debits real cash once',async()=>{
    openCompanyExpenseSheet(null);const unchecked=!document.getElementById('counted-before-cex-desc').checked;
    document.getElementById('cex-amount').value='500';await saveCompanyExpense();
    return [unchecked,ARHITTEKCash.balance(state),ARHITTEKCash.bookBalance(state)];
  },[true,157500,102900]);
  await check('A genuine new other income increases cash and amortization once after a count',async()=>{
    const amort=ARHITTEKCash.amortization(state);openCompanyIncomeSheet(null);
    const unchecked=!document.getElementById('counted-before-cin-desc').checked;
    document.getElementById('cin-amount').value='2000';await saveCompanyIncome();
    return [unchecked,ARHITTEKCash.balance(state),ARHITTEKCash.amortization(state)-amort];
  },[true,159500,100]);
  await check('Restoring a prior project receipt changes its ledger without inventing new physical cash',async()=>{
    const before=ARHITTEKCash.bookBalance(state);openPaymentSheet('budget-closed');
    document.getElementById('payment-amount').value='1000';document.getElementById('payment-note').value='Старая оплата';
    document.getElementById('counted-before-payment-note').checked=true;await savePayment();
    return [ARHITTEKCash.balance(state),ARHITTEKCash.bookBalance(state)-before];
  },[159500,1000]);
  await check('Restoring a prior payroll payment preserves salary month and avoids a second cash debit',async()=>{
    const before=ARHITTEKCash.bookBalance(state);openSalaryPaymentSheet('admin','2026-10');
    document.getElementById('salaryPaymentAmount').value='1000';
    document.getElementById('salaryPaymentNote').value='Старая выплата';document.getElementById('counted-before-salaryPaymentNote').checked=true;
    document.getElementById('salaryPaymentSave').click();await new Promise(resolve=>setTimeout(resolve,220));await loadAll();
    const row=__db.ledger_entries.find(r=>r.description?.includes('Старая выплата'));
    return [ARHITTEKCash.balance(state),ARHITTEKCash.bookBalance(state)-before,row?.description?.match(/\[salary:(\d{4}-\d{2})\]/)?.[1]];
  },[159500,-1000,'2026-10']);
  await page.evaluate(() => {
    document.querySelectorAll('.sheet-overlay').forEach(overlay => overlay.classList.remove('active'));
    closeInvoiceSheet();
    document.querySelector('.nav-btn[data-view="view-finance"]').click();
    const picker = document.getElementById('cashMonth'); picker.value = '2026-10'; picker.dispatchEvent(new Event('change'));
    const note = document.createElement('div'); note.textContent = 'ТЕСТОВЫЕ ДАННЫЕ · рабочие операции пользователя не загружены';
    note.style.cssText = 'background:#ffe8a1;color:#342500;padding:12px;font-weight:bold'; document.getElementById('view-finance').prepend(note);
  });
  for (const width of [390, 360]) {
    await page.setViewportSize({width, height: 900});
    for (const tab of ['overview', 'team', 'expense', 'reserve']) {
      await page.evaluate(tab => document.querySelector('[data-fin-tab="' + tab + '"]').click(), tab);
      await check('Finance ' + tab + ' fits ' + width + 'px', () => {
        const panel = document.querySelector('.finance-visual-panel:not([hidden]) .cash-panel');
        return panel.getBoundingClientRect().width > 0 && panel.scrollWidth <= panel.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1;
      }, true);
    }
  }
  if (process.env.TEST_OUTPUT) {
    await page.evaluate(() => document.querySelector('[data-fin-tab="overview"]').click());
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
    await page.screenshot({path: path.join(process.env.TEST_OUTPUT, 'finance-mobile.png'), fullPage: true});
    for (const tab of ['team', 'reserve']) {
      await page.evaluate(tab => document.querySelector('[data-fin-tab="' + tab + '"]').click(), tab);
      await page.waitForTimeout(250);
      await page.screenshot({path: path.join(process.env.TEST_OUTPUT, 'finance-' + tab + '-mobile.png'), fullPage: true});
    }
  }
  const output = process.env.TEST_OUTPUT;
  if (output) { fs.mkdirSync(output, {recursive: true}); fs.writeFileSync(path.join(output, 'reserve-results.json'), JSON.stringify({results, errors}, null, 2)); }
  console.log(JSON.stringify({passed: results.filter(row => row.pass).length, total: results.length,
    failed: results.filter(row => !row.pass), errors}));
  await browser.close();
  if (results.some(row => !row.pass) || errors.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
