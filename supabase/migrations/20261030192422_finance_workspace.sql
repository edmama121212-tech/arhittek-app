begin;
select 1 from arhittek_finance.settings where singleton for update;
-- Additive workspace. No opening balance is guessed; existing journal activation remains explicit.
create table if not exists arhittek_finance.wallets(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 120),kind text not null check(kind in ('cash','bank','unallocated')),is_default boolean unique check(is_default is null or is_default),active boolean not null default true);
insert into arhittek_finance.wallets(name,kind,is_default) values('Общая касса · не распределено по счетам','unallocated',true) on conflict(is_default) do nothing;
create table if not exists arhittek_finance.wallet_entries(id uuid primary key default gen_random_uuid(),operation_id uuid references arhittek_finance.operations(id),request_id uuid not null,wallet_id uuid not null references arhittek_finance.wallets(id),amount numeric not null,created_at timestamptz not null default clock_timestamp(),unique(operation_id,wallet_id));
create index if not exists wallet_entries_wallet on arhittek_finance.wallet_entries(wallet_id);
create table if not exists arhittek_finance.plans(id uuid primary key default gen_random_uuid(),label text not null,direction text not null check(direction in ('income','expense','release')),amount numeric not null check(amount>0 and amount=round(amount,2)),due_date date,funding text not null default 'reserve',project_id uuid references public.projects(id),employee_id uuid references public.employees(id),certainty text not null check(certainty in ('confirmed','expected')),canceled boolean not null default false,terms jsonb not null default '{}',created_at timestamptz not null default clock_timestamp());
create table if not exists arhittek_finance.rules(id uuid primary key default gen_random_uuid(),label text not null,direction text not null check(direction in ('income','expense')),amount numeric not null check(amount>0 and amount=round(amount,2)),due_day int not null check(due_day between 1 and 28),start_month date not null,end_month date,employee_id uuid references public.employees(id),certainty text not null default 'confirmed' check(certainty in ('confirmed','expected')),terms jsonb not null default '{}');
create table if not exists arhittek_finance.settlements(source_id uuid primary key,plan_key text not null,amount numeric not null check(amount>0),wallet_id uuid not null references arhittek_finance.wallets(id),funding text not null,direction text not null,project_id uuid,employee_id uuid);
create index if not exists settlements_plan on arhittek_finance.settlements(plan_key);
create table if not exists arhittek_finance.workspace_requests(id uuid primary key,request jsonb not null,revision bigint not null,actor uuid not null,created_at timestamptz not null default clock_timestamp());
create table if not exists arhittek_finance.plan_history(id bigint generated always as identity primary key,request_id uuid not null,entity text not null,before_value jsonb,after_value jsonb,actor uuid not null,created_at timestamptz not null default clock_timestamp());
create table if not exists arhittek_finance.workspace_policy(singleton boolean primary key default true check(singleton),salary_due_day int not null default 10 check(salary_due_day between 1 and 28));
insert into arhittek_finance.workspace_policy(singleton) values(true) on conflict do nothing;
-- All tables stay private; only owner-checked commands and snapshots expose them.
do $$ declare t text;begin foreach t in array array['wallets','wallet_entries','plans','rules','settlements','workspace_requests','plan_history','workspace_policy'] loop execute format('alter table arhittek_finance.%I enable row level security',t);execute format('revoke all on arhittek_finance.%I from public,anon,authenticated',t);end loop;end $$;
create or replace function arhittek_finance.wallet_balance(w uuid) returns numeric language sql stable set search_path='' as $$select coalesce(sum(amount),0) from arhittek_finance.wallet_entries where wallet_id=w$$;
create or replace function arhittek_finance.wallet_capture() returns trigger language plpgsql security definer set search_path='' as $$
declare w uuid;begin
 if new.cash_delta=0 then return new;end if;
 if new.reverses is not null then select wallet_id into w from arhittek_finance.wallet_entries where operation_id=new.reverses limit 1;
 else select wallet_id into w from arhittek_finance.settlements where source_id=new.source_id;
  if w is null and coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-finance-wallet','')<>'' then
   w:=(nullif(current_setting('request.headers',true),'')::jsonb->>'x-finance-wallet')::uuid;
   if not exists(select 1 from arhittek_finance.wallets where id=w and active) then raise sqlstate '22023' using message='Выбранный счёт недоступен';end if;
  end if;
 end if;
 if w is null then select id into w from arhittek_finance.wallets where is_default;end if;
 if arhittek_finance.wallet_balance(w)+new.cash_delta<0 then raise sqlstate '23514' using message='Недостаточно денег на выбранном счёте. Уточните счёт или сначала оформите перевод.';end if;
 insert into arhittek_finance.wallet_entries(operation_id,request_id,wallet_id,amount) values(new.id,new.id,w,new.cash_delta);return new;
end $$;
drop trigger if exists workspace_wallet_capture on arhittek_finance.operations;
create trigger workspace_wallet_capture after insert on arhittek_finance.operations for each row execute function arhittek_finance.wallet_capture();
-- Existing active installations get a visible unallocated account, without changing cash.
insert into arhittek_finance.wallet_entries(operation_id,request_id,wallet_id,amount)
select o.id,o.id,w.id,o.cash_delta from arhittek_finance.operations o cross join arhittek_finance.wallets w where w.is_default and o.cash_delta<>0 and not exists(select 1 from arhittek_finance.wallet_entries e where e.operation_id=o.id);
create table if not exists arhittek_finance.occurrence_dates(plan_key text primary key,due_date date);
alter table arhittek_finance.occurrence_dates enable row level security;revoke all on arhittek_finance.occurrence_dates from public,anon,authenticated;
create table if not exists arhittek_finance.calendar_links(id uuid primary key,source_operation uuid not null references arhittek_finance.operations(id),plan_key text not null,funding text not null,amount numeric not null check(amount<>0),reverses uuid unique references arhittek_finance.calendar_links(id),reason text not null,created_at timestamptz not null default clock_timestamp());
alter table arhittek_finance.calendar_links enable row level security;revoke all on arhittek_finance.calendar_links from public,anon,authenticated;
create index if not exists calendar_links_source on arhittek_finance.calendar_links(source_operation);
create index if not exists calendar_links_plan on arhittek_finance.calendar_links(plan_key);
create or replace function arhittek_finance.plan_paid(k text) returns numeric language sql stable set search_path='' as $$
 select coalesce(sum(amount),0) from (
 select s.amount from arhittek_finance.settlements s join arhittek_finance.operations o on o.source_id=s.source_id where s.plan_key=$1 and not exists(select 1 from arhittek_finance.operations undo where undo.reverses=o.id)
 union all select l.amount from arhittek_finance.calendar_links l join arhittek_finance.operations o on o.id=l.source_operation where l.plan_key=$1 and not exists(select 1 from arhittek_finance.operations undo where undo.reverses=o.id)) payments
$$;
revoke all on function arhittek_finance.plan_paid(text) from public,anon,authenticated;
create or replace function arhittek_finance.workspace_items(as_of date) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:='[]';r record;paid numeric;remaining numeric;month_value date;last_month date:=(date_trunc('month',as_of+90)+interval '1 month')::date;row_value jsonb;b jsonb:=arhittek_finance.balances();v record;due date;begin
 for r in select * from arhittek_finance.plans order by due_date nulls last,id loop
  paid:=arhittek_finance.plan_paid(r.id::text);
  remaining:=greatest(0,r.amount-paid-case when r.canceled then coalesce((r.terms->>'canceled_amount')::numeric,r.amount) else 0 end);
  if remaining>0 then result:=result||jsonb_build_array(to_jsonb(r)||jsonb_build_object('key',r.id::text,'remaining',remaining,'paid',paid,'origin','plan'));end if;
 end loop;
 for r in select * from arhittek_finance.rules order by id loop
  month_value:=r.start_month;
  while month_value<last_month and (r.end_month is null or month_value<=r.end_month) loop
   due:=month_value+(r.due_day-1);
   paid:=arhittek_finance.plan_paid('rule:'||r.id||':'||to_char(month_value,'YYYY-MM'));
   remaining:=greatest(0,r.amount-paid);
   if remaining>0 then result:=result||jsonb_build_array(jsonb_build_object('key','rule:'||r.id||':'||to_char(month_value,'YYYY-MM'),'label',r.label,'direction',r.direction,'amount',r.amount,'remaining',remaining,'paid',paid,'due_date',due,'funding','reserve','certainty',r.certainty,'employee_id',r.employee_id,'terms',r.terms,'origin','rule'));end if;
   month_value:=(month_value+interval '1 month')::date;
  end loop;
 end loop;
 -- Confirmed funded obligations come from exact journal accounts, never from mutable project formulas.
 for v in select key,value::numeric amount from jsonb_each_text(b) where (key like 'team:%' or key like 'costs:%') and value::numeric>0 loop
  due:=null;
  if v.key like 'team:%' then due:=(to_date(split_part(v.key,':',4)||'-01','YYYY-MM-DD')+interval '1 month')::date+((select salary_due_day from arhittek_finance.workspace_policy where singleton)-1);end if;
  result:=result||jsonb_build_array(jsonb_build_object('key','funded:'||v.key,'label',case when v.key like 'team:%' then 'Гонорар · '||coalesce((select name from public.employees where id=split_part(v.key,':',3)::uuid),'Сотрудник') else 'Прямые расходы проекта' end,'direction','expense','amount',v.amount,'remaining',v.amount,'paid',0,'due_date',due,'funding',v.key,'certainty','confirmed','project_id',split_part(v.key,':',2),'employee_id',case when v.key like 'team:%' then split_part(v.key,':',3) else null end,'origin','funded'));
 end loop;
 return (select coalesce(jsonb_agg(case when o.plan_key is not null then x.value||jsonb_build_object('due_date',o.due_date) else x.value end),'[]') from jsonb_array_elements(result) x left join arhittek_finance.occurrence_dates o on o.plan_key=x.value->>'key');
end $$;
create or replace function arhittek_finance.construction_readonly(project_value uuid) returns boolean language sql stable set search_path='' as $$select coalesce((select construction from arhittek_finance.project_types where project_id=$1),(select coalesce(d.name='Строительный отдел' or c.name ~* '(строительств|ремонт|монтаж)',false) from public.projects p left join public.categories c on c.id=p.category_id left join public.departments d on d.id=c.department_id where p.id=$1),false)$$;
revoke all on function arhittek_finance.construction_readonly(uuid) from public,anon,authenticated;
create or replace function arhittek_finance.workspace() returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings;as_of date:=(clock_timestamp() at time zone 'Europe/Moscow')::date;items jsonb;v jsonb;d date;h int;reserve numeric;b jsonb;cash numeric;wallet_total numeric;conservative numeric;expected numeric;income numeric;expenses numeric;all_expenses numeric;all_income numeric;cash_conservative numeric;cash_expected numeric;first_cash_deficit date;amort numeric;minimum numeric;first_deficit date;expected_allocations jsonb;funding_value text;take numeric;planned_amount numeric;timeline jsonb:='[]';warnings jsonb:='[]';begin
 perform arhittek_finance.actor();select * into cfg from arhittek_finance.settings where singleton for share;b:=arhittek_finance.balances();reserve:=arhittek_finance.amount(b,'reserve');
 select coalesce(sum(value::numeric),0) into cash from jsonb_each_text(b);select coalesce(sum(amount),0) into wallet_total from arhittek_finance.wallet_entries;
 if cash<>wallet_total then raise sqlstate '23514' using message='Остатки счетов не совпадают с журналом. Требуется проверка.';end if;
 items:=arhittek_finance.workspace_items(as_of);cash_conservative:=cash;cash_expected:=cash;conservative:=reserve;expected:=reserve;minimum:=reserve;if reserve<0 then first_deficit:=as_of;end if;
 if not cfg.active then warnings:=warnings||'"Не подтверждена начальная сверка денег и обязательств"'::jsonb;end if;
 if exists(select 1 from jsonb_array_elements(items) x where x->>'due_date' is null) then warnings:=warnings||'"Есть обязательства без срока: учтены в ближайшей потребности"'::jsonb;end if;
 if exists(select 1 from jsonb_array_elements(items) x where x->>'direction'='income' and ((x->>'due_date')::date<as_of or x->>'due_date' is null)) then warnings:=warnings||'"Просроченные поступления не включены в ожидаемый сценарий до уточнения срока"'::jsonb;end if;
 expected_allocations:=b;
 for h in 0..90 loop
  d:=as_of+h;income:=0;expenses:=0;all_expenses:=0;all_income:=0;
  -- Apply confirmed receipts first, then expenses, then proposed distributions.
  for v in select value from jsonb_array_elements(items) where value->>'direction'='income' and (value->>'due_date')::date=d and value->>'certainty'='confirmed' loop
   planned_amount:=(v->>'remaining')::numeric;funding_value:=v->>'funding';all_income:=all_income+planned_amount;
   amOrt:=case when nullif(v->>'project_id','') is not null and arhittek_finance.construction_readonly((v->>'project_id')::uuid) then 0 else round(planned_amount*0.05,2) end;
   expected_allocations:=arhittek_finance.add(expected_allocations,funding_value,planned_amount-amOrt);expected_allocations:=arhittek_finance.add(expected_allocations,'amortization',amOrt);
   if funding_value='reserve' then income:=income+planned_amount-amOrt;end if;
  end loop;
  for v in select value from jsonb_array_elements(items) where value->>'direction'='expense' and greatest(coalesce((value->>'due_date')::date,as_of),as_of)=d loop
   planned_amount:=(v->>'remaining')::numeric;funding_value:=v->>'funding';all_expenses:=all_expenses+planned_amount;
   if funding_value='reserve' then expenses:=expenses+planned_amount;expected_allocations:=arhittek_finance.add(expected_allocations,funding_value,-planned_amount);
   else
    take:=least(planned_amount,greatest(0,arhittek_finance.amount(expected_allocations,funding_value)));expected_allocations:=arhittek_finance.add(expected_allocations,funding_value,-take);
    if take<planned_amount then warnings:=warnings||jsonb_build_array('Не хватает финансирования для расхода «'||(v->>'label')||'»: проверьте график и назначение денег');end if;
   end if;
  end loop;
  for v in select value from jsonb_array_elements(items) where value->>'direction'='release' and (value->>'due_date')::date=d and value->>'certainty'='confirmed' loop
   planned_amount:=(v->>'remaining')::numeric;funding_value:=v->>'funding';take:=least(planned_amount,greatest(0,arhittek_finance.amount(expected_allocations,funding_value)));
   expected_allocations:=arhittek_finance.add(expected_allocations,funding_value,-take);expected_allocations:=arhittek_finance.add(expected_allocations,'reserve',take);income:=income+take;
   if take<planned_amount then warnings:=warnings||jsonb_build_array('Распределение «'||(v->>'label')||'» ограничено ожидаемыми деньгами проекта');end if;
  end loop;
  cash_conservative:=cash_conservative-all_expenses;cash_expected:=cash_expected+all_income-all_expenses;if cash_conservative<0 and first_cash_deficit is null then first_cash_deficit:=d;end if;
  conservative:=conservative-expenses;expected:=arhittek_finance.amount(expected_allocations,'reserve');minimum:=least(minimum,conservative);if conservative<0 and first_deficit is null then first_deficit:=d;end if;
  timeline:=timeline||jsonb_build_array(jsonb_build_object('date',d,'conservative',conservative,'expected',expected,'cash_conservative',cash_conservative,'cash_expected',cash_expected,'income',income,'expenses',expenses));
 end loop;
 return jsonb_build_object('version',2,'revision',cfg.revision,'as_of',as_of,'generated_at',clock_timestamp(),'active',cfg.active,'cash',cash,'reserve',reserve,'minimum',minimum,'available_30',(select min((value->>'conservative')::numeric) from jsonb_array_elements(timeline) with ordinality where ordinality<=31),'first_deficit',first_deficit,'first_cash_deficit',first_cash_deficit,'balances',b,'items',items,'forecast',timeline,'warnings',warnings,'wallets',(select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('balance',arhittek_finance.wallet_balance(w.id)) order by w.name),'[]') from arhittek_finance.wallets w),'rules',(select coalesce(jsonb_agg(to_jsonb(r) order by start_month,id),'[]') from arhittek_finance.rules r),'changes',(select coalesce(jsonb_agg(to_jsonb(history_row) order by history_row.created_at desc),'[]') from (select request_id,entity,before_value,after_value,created_at from arhittek_finance.plan_history order by created_at desc,id desc limit 100) history_row),'unmatched',(select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at desc),'[]') from (select o.id,o.reason,o.created_at,o.cash_delta,o.changes,abs(o.cash_delta)-coalesce((select sum(amount) from arhittek_finance.settlements where source_id=o.source_id),0)-coalesce((select sum(amount) from arhittek_finance.calendar_links where source_operation=o.id),0) remaining from arhittek_finance.operations o where o.source_table is not null and o.cash_delta<>0 and not exists(select 1 from arhittek_finance.operations undo where undo.reverses=o.id) order by o.created_at desc limit 100) u where remaining>0),'links',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from arhittek_finance.calendar_links l where l.reverses is null and not exists(select 1 from arhittek_finance.calendar_links undo where undo.reverses=l.id) and not exists(select 1 from arhittek_finance.operations undo where undo.reverses=l.source_operation)),'salary_due_day',(select salary_due_day from arhittek_finance.workspace_policy where singleton),'unscheduled_projects',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'remaining',greatest(0,coalesce(p.price,0)-coalesce(p.advance,0)),'construction',exists(select 1 from public.categories c left join public.departments d on d.id=c.department_id where c.id=p.category_id and (d.name='Строительный отдел' or c.name ~* '(строительств|ремонт|монтаж)')))),'[]') from public.projects p where deleted_at is null and coalesce(p.price,0)>coalesce(p.advance,0) and not exists(select 1 from arhittek_finance.plans x where x.project_id=p.id and x.direction='income' and not x.canceled)));
end $$;
create or replace function public.get_financial_journal() returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.snapshot()||jsonb_build_object('workspace',arhittek_finance.workspace())$$;
create or replace function arhittek_finance.workspace_command(cmd text,p jsonb,op uuid,expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings;prior arhittek_finance.workspace_requests;request jsonb:=jsonb_build_object('command',cmd,'payload',p);a numeric;id_value uuid;w uuid;dest uuid;month_value date;old_value jsonb;new_value jsonb;item jsonb;key_value text;remaining numeric;funding text;project uuid;employee uuid;date_value date;as_of date:=(clock_timestamp() at time zone 'Europe/Moscow')::date;reason text:=trim(p->>'reason');ch jsonb;v record;child uuid;result jsonb;payroll_month text;source arhittek_finance.operations;linked numeric;capacity numeric;link_value arhittek_finance.calendar_links;begin
 perform arhittek_finance.actor();select * into cfg from arhittek_finance.settings where singleton for update;
 if op is null then raise sqlstate '22023' using message='Нет номера операции';end if;
 select * into prior from arhittek_finance.workspace_requests where id=op;
 if found then if prior.request<>request then raise sqlstate '23514' using message='Повтор с другими данными';end if;return public.get_financial_journal();end if;
 if expected_revision is distinct from cfg.revision then raise sqlstate '40001' using message='Данные изменились на другом устройстве. Обновите и проверьте операцию.';end if;
 if length(coalesce(reason,''))<3 then raise sqlstate '22023' using message='Укажите основание';end if;
 if cmd='record' then
  if not cfg.active then raise sqlstate '23514' using message='Сначала подтвердите начальную сверку';end if;
  if p->>'direction' not in ('income','expense') then raise sqlstate '22023' using message='Выберите приход или расход';end if;
  child:=gen_random_uuid();
  if p->>'direction'='expense' and (p->>'funding' like 'team:%' or p->>'funding' like 'costs:%') then
   select value into item from jsonb_array_elements(arhittek_finance.workspace_items(as_of)) where value->>'key'='funded:'||(p->>'funding');
   if item is null or nullif(p->>'project_id','')::uuid is distinct from nullif(item->>'project_id','')::uuid or nullif(p->>'employee_id','')::uuid is distinct from nullif(item->>'employee_id','')::uuid then raise sqlstate '22023' using message='Проверьте проект и сотрудника выбранного обязательства';end if;
   result:=arhittek_finance.workspace_command('pay',jsonb_build_object('key',item->>'key','amount',p->'amount','date',p->>'date','wallet_id',p->>'wallet_id','reason',reason),child,expected_revision);
   insert into arhittek_finance.workspace_requests(id,request,revision,actor) values(op,request,(result->>'revision')::bigint,arhittek_finance.actor());return result;
  end if;
  result:=arhittek_finance.workspace_command('plan',p||jsonb_build_object('due_date',p->>'date','certainty','confirmed','id',child),child,expected_revision);
  result:=arhittek_finance.workspace_command('pay',jsonb_build_object('key',child,'amount',p->'amount','date',p->>'date','wallet_id',p->>'wallet_id','reason',reason),gen_random_uuid(),(result->>'revision')::bigint);
  insert into arhittek_finance.workspace_requests(id,request,revision,actor) values(op,request,(result->>'revision')::bigint,arhittek_finance.actor());
  return result;
 elsif cmd='wallet_reconcile' or cmd='reserve_adjust' then
  if not cfg.active or (p->>'confirmed') is distinct from 'true' then raise sqlstate '23514' using message='Подтвердите фактическую сверку';end if;
  w:=(p->>'wallet_id')::uuid;a:=arhittek_finance.money((p->>'target')::numeric);
  if not exists(select 1 from arhittek_finance.wallets where id=w and active) then raise sqlstate '22023' using message='Выберите счёт';end if;
  a:=a-case when cmd='reserve_adjust' then arhittek_finance.amount(arhittek_finance.balances(),'reserve') else arhittek_finance.wallet_balance(w) end;
  if a=0 then raise sqlstate '22023' using message='Сумма уже совпадает';end if;
  if arhittek_finance.wallet_balance(w)+a<0 then raise sqlstate '23514' using message='Остаток выбранного счёта не может стать отрицательным';end if;
  insert into arhittek_finance.settlements(source_id,plan_key,amount,wallet_id,funding,direction) values(op,cmd||':'||op,abs(a),w,'reserve',case when a>0 then 'income' else 'expense' end);
  perform arhittek_finance.post(op,cmd,reason,a,jsonb_build_object('reserve',a),request,null,op);
  insert into arhittek_finance.workspace_requests(id,request,revision,actor) select op,request,revision,arhittek_finance.actor() from arhittek_finance.settings where singleton;
  insert into arhittek_finance.plan_history(request_id,entity,after_value,actor) values(op,cmd,p,arhittek_finance.actor());
  return public.get_financial_journal();
 elsif cmd='plan' then
  id_value:=coalesce(nullif(p->>'id','')::uuid,op);select to_jsonb(x) into old_value from arhittek_finance.plans x where id=id_value;
  if old_value->>'funding' like 'obligation:%' then raise sqlstate '23514' using message='Начисление зафиксировано. Отмените остаток и создайте новое с причиной.';end if;
  if old_value is not null and exists(select 1 from arhittek_finance.settlements where plan_key=id_value::text) then raise sqlstate '23514' using message='У плана есть оплаты. Остаток оформите отдельным планом; оплаченная история сохраняется.';end if;
  a:=arhittek_finance.money((p->>'amount')::numeric);funding:=coalesce(nullif(p->>'funding',''),'reserve');project:=nullif(p->>'project_id','')::uuid;employee:=nullif(p->>'employee_id','')::uuid;
  if a<=0 or length(trim(coalesce(p->>'label','')))<2 or length(p->>'label')>180 or p->>'direction' not in ('income','expense','release') or p->>'certainty' not in ('confirmed','expected') then raise sqlstate '22023' using message='Проверьте название, сумму, направление и подтверждение';end if;
  if funding like 'team:%' or funding like 'costs:%' then raise sqlstate '23514' using message='Подтверждённое обязательство уже есть в календаре. Перенесите его срок или оплатите существующую строку.';end if;
  if funding not in ('reserve','amortization') and not(arhittek_finance.balances()?funding) and funding is distinct from 'project:'||project then raise sqlstate '22023' using message='Неизвестное назначение денег';end if;
  if p->>'direction'='income' and ((project is null and funding<>'reserve') or (project is not null and funding is distinct from 'project:'||project)) then raise sqlstate '22023' using message='Приход направляется в компанию или свой проект';end if;
  if p->>'direction'='release' and (project is null or funding<>'project:'||project) then raise sqlstate '22023' using message='Для распределения укажите проект';end if;
  if funding like 'team:%' and (employee is distinct from split_part(funding,':',3)::uuid or project is distinct from split_part(funding,':',2)::uuid) then raise sqlstate '22023' using message='Гонорар относится к другому сотруднику или проекту';end if;
  insert into arhittek_finance.plans(id,label,direction,amount,due_date,funding,project_id,employee_id,certainty,terms) values(id_value,trim(p->>'label'),p->>'direction',a,nullif(p->>'due_date','')::date,funding,project,employee,p->>'certainty',(coalesce(p->'terms','{}')-'canceled_amount'-'original_funding'-'obligation')) on conflict(id) do update set label=excluded.label,direction=excluded.direction,amount=excluded.amount,due_date=excluded.due_date,funding=excluded.funding,project_id=excluded.project_id,employee_id=excluded.employee_id,certainty=excluded.certainty,terms=excluded.terms,canceled=false;
  if (p->>'obligation')='true' then
   if p->>'direction'<>'expense' or p->>'certainty'<>'confirmed' then raise sqlstate '22023' using message='Начисленный долг относится к расходу';end if;
   update arhittek_finance.plans set funding='obligation:'||id_value,terms=terms||jsonb_build_object('original_funding',coalesce(nullif(p->>'funding',''),'reserve'),'obligation',true) where id=id_value;
   perform arhittek_finance.post(op,'obligation',reason,0,jsonb_build_object(funding,-a,'obligation:'||id_value,a),request);
  end if;
  select to_jsonb(x) into new_value from arhittek_finance.plans x where id=id_value;
 elsif cmd='reschedule' or cmd='cancel' then
  key_value:=coalesce(p->>'key',p->>'id');select value into item from jsonb_array_elements(arhittek_finance.workspace_items(as_of)) where value->>'key'=key_value;
  if item is null then raise sqlstate '22023' using message='План не найден или уже оплачен';end if;
  old_value:=item;
  if cmd='reschedule' and item->>'origin'<>'plan' then
   insert into arhittek_finance.occurrence_dates values(key_value,nullif(p->>'due_date','')::date) on conflict(plan_key) do update set due_date=excluded.due_date;new_value:=p;
  else
   if item->>'origin'<>'plan' then raise sqlstate '22023' using message='Подтверждённый долг отменяется через исходную запись журнала';end if;
   id_value:=(item->>'id')::uuid;
   if cmd='cancel' and item->>'funding' like 'obligation:%' then
    a:=arhittek_finance.amount(arhittek_finance.balances(),item->>'funding');
    if a>0 then perform arhittek_finance.post(op,'obligation_release',reason,0,jsonb_build_object(item->>'funding',-a,coalesce(item->'terms'->>'original_funding','reserve'),a),request);end if;
   end if;
   if cmd='reschedule' then update arhittek_finance.plans set due_date=nullif(p->>'due_date','')::date where id=id_value;else update arhittek_finance.plans set canceled=true,terms=terms||jsonb_build_object('canceled_amount',(item->>'remaining')::numeric+coalesce((terms->>'canceled_amount')::numeric,0)) where id=id_value;end if;
   select to_jsonb(x) into new_value from arhittek_finance.plans x where id=id_value;
  end if;
 elsif cmd='rule' then
  month_value:=date_trunc('month',(p->>'start_month')::date)::date;a:=arhittek_finance.money((p->>'amount')::numeric);
  if month_value<date_trunc('month',as_of)::date or month_value>date_trunc('month',as_of+interval '2 years')::date or a<=0 or (p->>'due_day')::int not between 1 and 28 or p->>'direction' not in ('income','expense') or p->>'certainty' not in ('confirmed','expected') or length(trim(coalesce(p->>'label','')))<2 then raise sqlstate '22023' using message='Проверьте сумму, срок и первый месяц';end if;
  if nullif(p->>'replace_id','') is not null then
   select to_jsonb(x) into old_value from arhittek_finance.rules x where id=(p->>'replace_id')::uuid for update;
   if old_value is null or month_value<=date_trunc('month',as_of)::date or month_value<=(old_value->>'start_month')::date then raise sqlstate '22023' using message='Изменение регулярной суммы — с нового месяца. История сохраняется.';end if;
   update arhittek_finance.rules set end_month=(month_value-interval '1 month')::date where id=(p->>'replace_id')::uuid;
  end if;
  if nullif(p->>'employee_id','') is not null and exists(select 1 from arhittek_finance.rules where employee_id=(p->>'employee_id')::uuid and direction='expense' and (end_month is null or end_month>=month_value)) then raise sqlstate '23514' using message='У сотрудника уже есть оклад на этот период';end if;
  insert into arhittek_finance.rules(id,label,direction,amount,due_day,start_month,employee_id,certainty,terms) values(op,trim(p->>'label'),p->>'direction',a,(p->>'due_day')::int,month_value,nullif(p->>'employee_id','')::uuid,p->>'certainty',coalesce(p->'terms','{}')) returning to_jsonb(rules.*) into new_value;
 elsif cmd='stop_rule' then
  id_value:=(p->>'id')::uuid;select to_jsonb(x) into old_value from arhittek_finance.rules x where id=id_value for update;if old_value is null then raise sqlstate '22023' using message='Правило не найдено';end if;
  update arhittek_finance.rules set end_month=date_trunc('month',as_of)::date where id=id_value returning to_jsonb(rules.*) into new_value;
 elsif cmd='link' then
  select * into source from arhittek_finance.operations where id=(p->>'source')::uuid and source_table is not null;
  key_value:=p->>'key';select value into item from jsonb_array_elements(arhittek_finance.workspace_items(as_of)) where value->>'key'=key_value;
  a:=arhittek_finance.money((p->>'amount')::numeric);
  if source.id is null or source.cash_delta=0 or item is null or item->>'origin'='funded' or item->>'direction'='release' or a<=0 or a>(item->>'remaining')::numeric or (source.cash_delta>0) is distinct from (item->>'direction'='income') or exists(select 1 from arhittek_finance.operations where reverses=source.id) then raise sqlstate '23514' using message='Выберите подходящую действующую оплату и неоплаченный план';end if;
  funding:=item->>'funding';capacity:=arhittek_finance.amount(source.changes,funding);
  if source.cash_delta>0 then if capacity<=0 then raise sqlstate '23514' using message='У поступления другое назначение денег';end if;capacity:=source.cash_delta;else capacity:=-capacity;end if;
  select coalesce(sum(amount),0) into linked from arhittek_finance.calendar_links where source_operation=source.id and calendar_links.funding=item->>'funding';
  if a+linked>capacity then raise sqlstate '23514' using message='Оплата была из другого резервирования. Не связывайте её автоматически; проверьте назначение в журнале.';end if;
  select coalesce(sum(amount),0) into linked from arhittek_finance.calendar_links where source_operation=source.id;
  linked:=linked+coalesce((select sum(amount) from arhittek_finance.settlements where source_id=source.source_id),0);
  if a+linked>abs(source.cash_delta) then raise sqlstate '23514' using message='Эта сумма оплаты уже связана с другими планами';end if;
  insert into arhittek_finance.calendar_links(id,source_operation,plan_key,funding,amount,reason) values(op,source.id,key_value,funding,a,reason);new_value:=p;
 elsif cmd='unlink' then
  select * into link_value from arhittek_finance.calendar_links where id=(p->>'id')::uuid;
  if link_value.id is null or link_value.reverses is not null or exists(select 1 from arhittek_finance.calendar_links where reverses=link_value.id) then raise sqlstate '23514' using message='Связь уже отменена или недоступна';end if;
  insert into arhittek_finance.calendar_links(id,source_operation,plan_key,funding,amount,reverses,reason) values(op,link_value.source_operation,link_value.plan_key,link_value.funding,-link_value.amount,link_value.id,reason);new_value:=p;
 elsif cmd='wallet' then
  if p->>'kind' not in ('cash','bank') then raise sqlstate '22023' using message='Выберите кассу или банковский счёт';end if;
  insert into arhittek_finance.wallets(id,name,kind) values(op,trim(p->>'name'),p->>'kind') returning to_jsonb(wallets.*) into new_value;
 elsif cmd='wallet_transfer' then
  if not cfg.active then raise sqlstate '23514' using message='Сначала выполните начальную сверку';end if;
  w:=(p->>'from')::uuid;dest:=(p->>'to')::uuid;a:=arhittek_finance.money((p->>'amount')::numeric);
  if w=dest or a<=0 or not exists(select 1 from arhittek_finance.wallets where id=dest and active) or arhittek_finance.wallet_balance(w)<a then raise sqlstate '23514' using message='Проверьте счета и доступную сумму';end if;
  insert into arhittek_finance.wallet_entries(request_id,wallet_id,amount) values(op,w,-a),(op,dest,a);new_value:=p;
 elsif cmd='pay' then
  if not cfg.active then raise sqlstate '23514' using message='Сначала подтвердите фактическую начальную сверку';end if;
  key_value:=p->>'key';select value into item from jsonb_array_elements(arhittek_finance.workspace_items(as_of)) where value->>'key'=key_value;
  if item is null then raise sqlstate '23514' using message='План уже оплачен или изменён. Обновите данные';end if;
  a:=arhittek_finance.money((p->>'amount')::numeric);date_value:=(p->>'date')::date;w:=(p->>'wallet_id')::uuid;remaining:=(item->>'remaining')::numeric;funding:=item->>'funding';project:=nullif(item->>'project_id','')::uuid;employee:=nullif(item->>'employee_id','')::uuid;
  if a<=0 or a>remaining or date_value is null or date_value>as_of or date_value<(cfg.activated_at at time zone 'Europe/Moscow')::date then raise sqlstate '22023' using message='Проверьте остаток плана, сумму и фактическую дату';end if;
  if not exists(select 1 from arhittek_finance.wallets where id=w and active) then raise sqlstate '22023' using message='Выберите счёт';end if;
  insert into arhittek_finance.settlements(source_id,plan_key,amount,wallet_id,funding,direction,project_id,employee_id) values(op,key_value,a,w,funding,item->>'direction',project,employee);
  -- Source insertion and journal capture are one transaction. The settlement supplies an exact allocation.
  if item->>'direction'='release' then
   if arhittek_finance.construction(project) and length(reason)<5 then raise sqlstate '22023' using message='Укажите договорное основание вознаграждения';end if;
   perform arhittek_finance.post(op,'transfer',reason,0,jsonb_build_object(funding,-a,'reserve',a),request,null,op);
  elsif project is not null or employee is not null then
   payroll_month:=case when key_value like 'funded:team:%' then split_part(key_value,':',5) when item->>'origin'='rule' and employee is not null then to_char(to_date(split_part(key_value,':',3)||'-01','YYYY-MM-DD')-interval '1 month','YYYY-MM') else item->'terms'->>'payroll_month' end;
   if payroll_month is not null and payroll_month!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then raise sqlstate '22023' using message='Проверьте месяц начисления';end if;
   insert into public.ledger_entries(id,project_id,payee_employee_id,type,amount,entry_date,description) values(op,project,employee,case when item->>'direction'='income' then 'advance' when employee is not null then case when project is null then 'salary_payment' else 'fee_payment' end else 'project_expense' end,a,date_value,reason||' [plan:'||key_value||']'||case when payroll_month is not null then ' [salary:'||payroll_month||']' else '' end);
   if item->>'direction'='income' and project is not null then update public.projects set advance=coalesce(advance,0)+a,balance=greatest(0,coalesce(price,0)-coalesce(advance,0)-a) where id=project;end if;
   if item->>'direction'='expense' and employee is not null and project is not null then update public.projects set fee_paid=case when employee_id=employee then coalesce(fee_paid,0)+a else fee_paid end,co_fee_paid=case when co_employee_id=employee then coalesce(co_fee_paid,0)+a else co_fee_paid end where id=project and fee_base is distinct from 'm2';end if;
  elsif item->>'direction'='income' then insert into public.company_income(id,category,amount,income_date,description) values(op,'Платёжный календарь',a,date_value,reason||' [plan:'||key_value||']');
  else insert into public.company_expenses(id,category,amount,expense_date,description) values(op,'Платёжный календарь',a,date_value,reason||' [plan:'||key_value||']');end if;
  new_value:=p;
 else raise sqlstate '22023' using message='Неизвестное действие';end if;
 if cmd<>'pay' then update arhittek_finance.settings set revision=revision+1 where singleton;end if;
 insert into arhittek_finance.workspace_requests(id,request,revision,actor) select op,request,revision,arhittek_finance.actor() from arhittek_finance.settings where singleton;
 insert into arhittek_finance.plan_history(request_id,entity,before_value,after_value,actor) values(op,cmd,old_value,new_value,arhittek_finance.actor());
 return public.get_financial_journal();
end $$;
create or replace function public.confirm_finance_workspace(p_command text,p_payload jsonb,p_operation uuid,p_revision bigint) returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.workspace_command(p_command,p_payload,p_operation,p_revision)$$;
create or replace function arhittek_finance.workspace_request(op uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin perform arhittek_finance.actor();return (select jsonb_build_object('confirmed',true,'revision',revision) from arhittek_finance.workspace_requests where id=op);end$$;
create or replace function public.get_finance_request(p_operation uuid) returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.workspace_request(p_operation)$$;
revoke all on function arhittek_finance.wallet_balance(uuid),arhittek_finance.wallet_capture(),arhittek_finance.workspace_items(date),arhittek_finance.workspace(),arhittek_finance.workspace_command(text,jsonb,uuid,bigint),arhittek_finance.workspace_request(uuid),public.confirm_finance_workspace(text,jsonb,uuid,bigint),public.get_finance_request(uuid) from public,anon,authenticated;
grant execute on function arhittek_finance.workspace(),arhittek_finance.workspace_command(text,jsonb,uuid,bigint),arhittek_finance.workspace_request(uuid),public.confirm_finance_workspace(text,jsonb,uuid,bigint),public.get_finance_request(uuid) to anon,authenticated;
create or replace function arhittek_finance.capture() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings; r jsonb; prev jsonb; typ text; d date; a numeric; incoming boolean; outgoing boolean;
 b jsonb; ch jsonb:='{}'; project uuid; emp uuid; k text; m text; take numeric; leftpay numeric; am numeric; v record; changed boolean; settlement arhittek_finance.settlements;
begin
 select * into cfg from arhittek_finance.settings where singleton for update;
 if not cfg.active then return coalesce(new,old); end if;
 perform arhittek_finance.actor();
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='ledger_entries' then
  typ:=r->>'type'; incoming:=typ in ('advance','final_payment','income','materials_budget','construction_budget');
  outgoing:=typ in ('expense','project_expense','payment','withdrawal','fee_payment','salary_payment','client_refund');
 else incoming:=tg_table_name='company_income'; outgoing:=not incoming; typ:=tg_table_name; end if;
 if not incoming and not outgoing then
  -- Non-cash accruals never change the journal.
  if tg_op='UPDATE' and (old.type in ('advance','final_payment','income','materials_budget','construction_budget','expense','project_expense','payment','withdrawal','fee_payment','salary_payment','client_refund')) then
   raise sqlstate '23514' using message='Нельзя превратить денежную операцию в начисление'; end if;
  return coalesce(new,old);
 end if;
 if tg_op<>'INSERT' then
  prev:=to_jsonb(old);
  if tg_op='UPDATE' and (r-'received_by')=(prev-'received_by') then return new; end if;
  if tg_op='UPDATE' and old.deleted_at is null and new.deleted_at is not null
   and (r-'deleted_at')=(prev-'deleted_at') and exists(
    select 1 from arhittek_finance.operations o join arhittek_finance.operations undo on undo.reverses=o.id
    where o.source_table=tg_table_name and o.source_id=old.id) then return new; end if;
  raise sqlstate '23514' using message='Денежная запись зафиксирована. Откройте Финансы → Резерв → Журнал и отмените её с причиной; затем внесите правильную.';
 end if;
 -- A private settlement is inserted only by the owner-checked workspace command.
 select * into settlement from arhittek_finance.settlements where source_id=(r->>'id')::uuid;
 if found then
  a:=arhittek_finance.money((r->>'amount')::numeric);d:=coalesce(r->>'entry_date',r->>'income_date',r->>'expense_date')::date;
  if a<>settlement.amount or a<=0 or r->>'deleted_at' is not null or d is null or d>(clock_timestamp() at time zone 'Europe/Moscow')::date or d<(cfg.activated_at at time zone 'Europe/Moscow')::date or incoming is distinct from (settlement.direction='income') or nullif(r->>'project_id','')::uuid is distinct from settlement.project_id or nullif(r->>'payee_employee_id','')::uuid is distinct from settlement.employee_id then raise sqlstate '23514' using message='Платёж не совпадает с подтверждённым планом';end if;
  if incoming then
   am:=case when settlement.project_id is not null and arhittek_finance.construction(settlement.project_id) then 0 else round(a*0.05,2) end;
   ch:=jsonb_build_object(settlement.funding,a-am,'amortization',am);
  else ch:=jsonb_build_object(settlement.funding,-a);end if;
  perform arhittek_finance.post(settlement.source_id,case when incoming then 'receipt' else 'payment' end,r->>'description',case when incoming then a else -a end,ch,'{}',tg_table_name,settlement.source_id);
  return new;
 end if;
 if coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-finance-client','')<>'1' then
  raise sqlstate '23514' using message='Обновите приложение перед финансовой операцией'; end if;
 if r->>'deleted_at' is not null then raise sqlstate '22023' using message='Нельзя добавить отменённую операцию'; end if;
 a:=arhittek_finance.money((r->>'amount')::numeric);
 d:=coalesce(r->>'entry_date',r->>'income_date',r->>'expense_date')::date;
 if a<=0 or d is null or d<(cfg.activated_at at time zone 'Europe/Moscow')::date or d>(clock_timestamp() at time zone 'Europe/Moscow')::date then
  raise sqlstate '22023' using message='Укажите положительную сумму и дату после начальной сверки, не в будущем'; end if;
 if coalesce(r->>'description','') ~ '(\[cash:counted:|\[cash:historical-expense\]|\[cash:adjustment\])' or r->>'description'='Ранее внесённые расходы' or coalesce(r->>'category','') like 'Корректировка резерва%' then
  raise sqlstate '22023' using message='Используйте отдельную сверку или корректировку журнала'; end if;
 project:=nullif(r->>'project_id','')::uuid; emp:=nullif(r->>'payee_employee_id','')::uuid;
 b:=arhittek_finance.balances();
 if incoming then
  am:=case when project is not null and arhittek_finance.construction(project) then 0 else round(a*0.05,2) end;
  k:=case when project is null then 'reserve' else 'project:'||project end;
  ch:=jsonb_build_object(k,a-am,'amortization',am);
 else
  leftpay:=a;
  if typ in ('fee_payment','salary_payment') or (typ='payment' and emp is not null) then
   if emp is null then raise sqlstate '22023' using message='Укажите сотрудника для выплаты'; end if;
   m:=substring(coalesce(r->>'description','') from '\[salary:([0-9]{4}-[0-9]{2})\]');
   -- A monthly payroll payment mixes guaranteed salary and project fees. The
   -- exact funded portion must be chosen by the owner in the payment form.
   if typ='salary_payment' and project is null then
    take:=coalesce(substring(coalesce(r->>'description','') from '\[funded:([0-9]+(?:\.[0-9]{1,2})?)\]')::numeric,0);
    if m is null or position('[funded:' in coalesce(r->>'description',''))=0 or take>a then
     raise sqlstate '22023' using message='Укажите, какая часть выплаты идёт из уже зарезервированных гонораров'; end if;
    leftpay:=take;
   end if;
   for v in select key,value::numeric as amount from jsonb_each_text(b)
    where key like 'team:%' and split_part(key,':',3)=emp::text
    and (project is null or split_part(key,':',2)=project::text)
    and (m is null or split_part(key,':',4)=m) order by key loop
    take:=least(leftpay,v.amount); ch:=arhittek_finance.add(ch,v.key,-take); leftpay:=leftpay-take;
   end loop;
   if typ='salary_payment' and project is null and leftpay>0 then raise sqlstate '23514' using message='Зарезервированных гонораров меньше выбранной суммы'; end if;
   leftpay:=a+(select coalesce(sum(value::numeric),0) from jsonb_each_text(ch));
  elsif project is not null and typ<>'withdrawal' then
   k:='costs:'||project;
   if typ<>'client_refund' then take:=least(leftpay,arhittek_finance.amount(b,k));ch:=arhittek_finance.add(ch,k,-take);leftpay:=leftpay-take;end if;
  end if;
  if project is not null and typ<>'withdrawal' then
   k:='project:'||project;take:=least(leftpay,arhittek_finance.amount(b,k));ch:=arhittek_finance.add(ch,k,-take);leftpay:=leftpay-take;
  end if;
  ch:=arhittek_finance.add(ch,'reserve',-leftpay);
 end if;
 perform arhittek_finance.post(gen_random_uuid(),case when incoming then 'receipt' else 'payment' end,coalesce(nullif(r->>'description',''),typ),case when incoming then a else -a end,ch,'{}',tg_table_name,(r->>'id')::uuid);
 return new;
end $$;

do $$ declare t text;begin foreach t in array array['wallet_entries','workspace_requests','plan_history','settlements','calendar_links'] loop execute format('drop trigger if exists workspace_immutable on arhittek_finance.%I',t);execute format('create trigger workspace_immutable before update or delete on arhittek_finance.%I for each row execute function arhittek_finance.immutable()',t);end loop;end $$;
create or replace function arhittek_finance.obligation_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare v record;begin
 if new.reverses is not null and exists(select 1 from arhittek_finance.operations where id=new.reverses and kind in ('obligation','obligation_release')) then raise sqlstate '23514' using message='Начисление меняется через остаток плана, с сохранением оплаченной части';end if;
 for v in select key,value::numeric amount from jsonb_each_text(new.changes) where key like 'obligation:%' and value::numeric<0 loop
  if new.kind<>'obligation_release' and not exists(select 1 from arhittek_finance.settlements where source_id=new.source_id and funding=v.key and amount=-v.amount) then raise sqlstate '23514' using message='Деньги обязательства доступны только для связанной оплаты или отмены остатка';end if;
 end loop;return new;
end $$;
revoke all on function arhittek_finance.obligation_guard() from public,anon,authenticated;
drop trigger if exists workspace_obligation_guard on arhittek_finance.operations;
create trigger workspace_obligation_guard before insert on arhittek_finance.operations for each row execute function arhittek_finance.obligation_guard();
do $$ declare t text;begin foreach t in array array['wallets','wallet_entries','plans','rules','settlements','workspace_requests','plan_history','workspace_policy','occurrence_dates','calendar_links'] loop execute format('drop policy if exists workspace_no_direct_access on arhittek_finance.%I',t);execute format('create policy workspace_no_direct_access on arhittek_finance.%I for all to anon,authenticated using(false) with check(false)',t);end loop;end $$;
commit;
