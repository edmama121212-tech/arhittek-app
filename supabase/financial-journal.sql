-- Immutable owner-only money journal. Installation does not activate it or import balances.
begin;
create schema if not exists arhittek_finance;
revoke all on schema arhittek_finance from public,anon,authenticated;
create table if not exists arhittek_finance.settings(
 singleton boolean primary key default true check(singleton), active boolean not null default false,
 activated_at timestamptz, revision bigint not null default 0
);
insert into arhittek_finance.settings(singleton) values(true) on conflict do nothing;
create table if not exists arhittek_finance.operations(
 id uuid primary key, revision bigint unique not null, kind text not null, reason text not null,
 actor uuid not null, created_at timestamptz not null default clock_timestamp(),
 cash_delta numeric not null, changes jsonb not null, balances_after jsonb not null,
 source_table text, source_id uuid, reverses uuid unique references arhittek_finance.operations(id),
 request jsonb not null default '{}', unique(source_table,source_id)
);
create table if not exists arhittek_finance.project_types(
 project_id uuid primary key, construction boolean not null
);
alter table arhittek_finance.settings enable row level security;
alter table arhittek_finance.operations enable row level security;
alter table arhittek_finance.project_types enable row level security;
revoke all on all tables in schema arhittek_finance from public,anon,authenticated;

create or replace function arhittek_finance.actor() returns uuid language plpgsql stable security definer set search_path='' as $$
declare v uuid; begin
 select employee_id into v from public.current_session_employee() where is_admin is true;
 if v is null then raise sqlstate '42501' using message='Финансы доступны только владельцу'; end if;
 return v;
end $$;
create or replace function arhittek_finance.money(v numeric) returns numeric language plpgsql immutable set search_path='' as $$
begin
 if v is null or v::text in ('NaN','Infinity','-Infinity') or abs(v)>1000000000000 or v<>round(v,2) then
 raise sqlstate '22023' using message='Некорректная денежная сумма'; end if; return v;
end $$;
create or replace function arhittek_finance.balances() returns jsonb language sql stable set search_path='' as $$
 select coalesce((select balances_after from arhittek_finance.operations order by revision desc limit 1),'{}'::jsonb)
$$;
create or replace function arhittek_finance.amount(b jsonb,k text) returns numeric language sql immutable set search_path='' as $$
 select coalesce((b->>k)::numeric,0)
$$;
create or replace function arhittek_finance.add(b jsonb,k text,v numeric) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_set(b,array[k],to_jsonb(arhittek_finance.amount(b,k)+v),true)
$$;
create or replace function arhittek_finance.construction(p uuid) returns boolean language plpgsql set search_path='' as $$
declare v boolean; begin
 select construction into v from arhittek_finance.project_types where project_id=p;
 if found then return v; end if;
 select coalesce(d.name='Строительный отдел' or c.name ~* '(строительств|ремонт|монтаж)',false) into v
 from public.projects x left join public.categories c on c.id=x.category_id left join public.departments d on d.id=c.department_id where x.id=p;
 if not found then raise sqlstate '22023' using message='Проект не найден'; end if;
 insert into arhittek_finance.project_types values(p,v); return v;
end $$;
create or replace function arhittek_finance.fingerprint() returns text language sql stable set search_path='' as $$
 select md5(jsonb_build_array(
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.ledger_entries x),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.company_income x),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.company_expenses x),
 (select coalesce(jsonb_agg(jsonb_build_array(id,category_id,status_id,employee_id,co_employee_id,price,advance,balance,expenses,fee_base,fee_percent,co_fee_percent,fee_paid,co_fee_paid,end_date,area,deleted_at) order by id),'[]') from public.projects),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.invoices x),
 (select coalesce(jsonb_agg(jsonb_build_array(id,role,is_salaried,fixed_salary,active,deleted_at) order by id),'[]') from public.employees),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.categories x),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.timesheet_payments x),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.statuses x),
 (select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.departments x),
 (select coalesce(jsonb_agg(jsonb_build_array(id,entity_id,changes,created_at) order by id),'[]') from public.audit_log where changes ? 'status_id' or action='cash_count')
 )::text)
$$;
create or replace function arhittek_finance.post(op uuid,kind text,reason text,delta numeric,changes jsonb,request jsonb default '{}',src text default null,sid uuid default null,rev uuid default null) returns uuid language plpgsql set search_path='' as $$
declare b jsonb:=arhittek_finance.balances(); k text; v numeric; n bigint; total numeric:=0; actor uuid:=arhittek_finance.actor(); begin
 if op is null or length(trim(coalesce(reason,'')))<3 then raise sqlstate '22023' using message='Укажите причину операции'; end if;
 perform arhittek_finance.money(delta);
 for k,v in select key,value::numeric from jsonb_each_text(changes) loop
  perform arhittek_finance.money(v); total:=total+v; b:=arhittek_finance.add(b,k,v);
  if k<>'reserve' and arhittek_finance.amount(b,k)<0 then raise sqlstate '23514' using message='Недостаточно средств в выбранном резервировании. Сначала отмените зависимое распределение.'; end if;
 end loop;
 if total<>delta then raise sqlstate '23514' using message='Распределение не совпадает с движением денег'; end if;
 if (select coalesce(sum(value::numeric),0) from jsonb_each_text(b))<0 then raise sqlstate '23514' using message='В журнале недостаточно общих денег для выплаты'; end if;
 update arhittek_finance.settings set revision=revision+1 where singleton returning revision into n;
 insert into arhittek_finance.operations(id,revision,kind,reason,actor,cash_delta,changes,balances_after,request,source_table,source_id,reverses)
 values(op,n,kind,reason,actor,delta,changes,b,request,src,sid,rev); return op;
end $$;
create or replace function arhittek_finance.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise sqlstate '42501' using message='Журнал неизменяемый. Используйте отдельную отменяющую операцию.'; end $$;
drop trigger if exists journal_immutable on arhittek_finance.operations;
create trigger journal_immutable before update or delete on arhittek_finance.operations for each row execute function arhittek_finance.immutable();

-- Existing payment forms continue to write their source records. The money and
-- the journal posting commit in the same database transaction, including RPCs.
create or replace function arhittek_finance.capture() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings; r jsonb; prev jsonb; typ text; d date; a numeric; incoming boolean; outgoing boolean;
 b jsonb; ch jsonb:='{}'; project uuid; emp uuid; k text; m text; take numeric; leftpay numeric; am numeric; v record; changed boolean;
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
drop trigger if exists financial_journal_capture on public.ledger_entries;
create trigger financial_journal_capture before insert or update or delete on public.ledger_entries for each row execute function arhittek_finance.capture();
drop trigger if exists financial_journal_capture on public.company_income;
create trigger financial_journal_capture before insert or update or delete on public.company_income for each row execute function arhittek_finance.capture();
drop trigger if exists financial_journal_capture on public.company_expenses;
create trigger financial_journal_capture before insert or update or delete on public.company_expenses for each row execute function arhittek_finance.capture();


create or replace function arhittek_finance.serialize_source() returns trigger language plpgsql security definer set search_path='' as $$
begin perform 1 from arhittek_finance.settings where singleton for update; return null; end $$;
drop trigger if exists financial_journal_serialize on public.ledger_entries;
create trigger financial_journal_serialize before insert or update or delete on public.ledger_entries for each statement execute function arhittek_finance.serialize_source();
drop trigger if exists financial_journal_serialize on public.company_income;
create trigger financial_journal_serialize before insert or update or delete on public.company_income for each statement execute function arhittek_finance.serialize_source();
drop trigger if exists financial_journal_serialize on public.company_expenses;
create trigger financial_journal_serialize before insert or update or delete on public.company_expenses for each statement execute function arhittek_finance.serialize_source();

create or replace function arhittek_finance.snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare s arhittek_finance.settings; begin
 perform arhittek_finance.actor(); select * into s from arhittek_finance.settings where singleton for share;
 return jsonb_build_object('version',1,'active',s.active,'activated_at',s.activated_at,'revision',s.revision,
 'fingerprint',case when not s.active then arhittek_finance.fingerprint() else null end,
 'balances',arhittek_finance.balances(),
 'operations',coalesce((select jsonb_agg(to_jsonb(o) order by o.revision desc) from (
  select id,revision,kind,reason,actor,created_at,cash_delta,changes,balances_after,source_table,source_id,reverses
  from arhittek_finance.operations order by revision desc limit 100) o),'[]'::jsonb));
end $$;
create or replace function public.get_financial_journal() returns jsonb language sql security invoker set search_path='' as $$ select arhittek_finance.snapshot() $$;

create or replace function arhittek_finance.command(cmd text,p jsonb,op uuid,expected bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare s arhittek_finance.settings; existing arhittek_finance.operations; request jsonb:=jsonb_build_object('command',cmd,'payload',p);
 b jsonb; ch jsonb:='{}'; item jsonb; team jsonb; project_id_value uuid; emp uuid; m text; k text; a numeric; cash numeric:=0; total numeric:=0; reason text:=trim(p->>'reason'); v record; original arhittek_finance.operations; prior jsonb;
begin
 perform arhittek_finance.actor();
 -- All journal writers take this lock. Source tables are read only after it.
 select * into s from arhittek_finance.settings where singleton for update;
 select changes->'reserve_adjustment' into prior from public.audit_log where id=op and action='cash_count';
 if found then
  if prior->'request' is distinct from request then raise sqlstate '23514' using message='Повтор операции с другими данными'; end if;
  return arhittek_finance.snapshot();
 end if;
 select * into existing from arhittek_finance.operations where operations.id=op;
 if found then
  if existing.request<>request then raise sqlstate '23514' using message='Повтор операции с другими данными'; end if;
  return arhittek_finance.snapshot();
 end if;
 if op is null or expected is distinct from s.revision then raise sqlstate '40001' using message='Финансовые данные изменились. Обновите расчёт и проверьте его снова.'; end if;
 if reason is null or length(reason)<3 then raise sqlstate '22023' using message='Укажите причину'; end if;
 b:=arhittek_finance.balances();
 if cmd='activate' then
  if s.active then raise sqlstate '23514' using message='Журнал уже включён'; end if;
  -- Prevent an initial snapshot being accepted while any source is changing.
  lock table public.projects,public.employees,public.categories,public.invoices,public.timesheet_payments in share mode;
  if p->>'fingerprint' is distinct from arhittek_finance.fingerprint() then raise sqlstate '40001' using message='Исходные данные изменились во время сверки. Обновите сверку.'; end if;
  if (p->>'confirmed') is distinct from 'true' then raise sqlstate '22023' using message='Подтвердите фактическую сверку'; end if;
  cash:=arhittek_finance.money((p->>'cash')::numeric);a:=arhittek_finance.money((p->>'amortization')::numeric);
  if cash<0 or a<0 then raise sqlstate '22023' using message='Остатки не могут быть отрицательными'; end if;
  ch:=jsonb_build_object('amortization',a);
  if jsonb_typeof(p->'projects') is distinct from 'array' then raise sqlstate '22023' using message='Проверьте распределение по проектам'; end if;
  for item in select value from jsonb_array_elements(p->'projects') loop
   project_id_value:=(item->>'id')::uuid;perform arhittek_finance.construction(project_id_value);
   k:='project:'||project_id_value;if ch?k then raise sqlstate '22023' using message='Повтор проекта в сверке';end if;
   a:=arhittek_finance.money((item->>'funds')::numeric);if a<0 then raise sqlstate '22023' using message='Отрицательный остаток проекта';end if;ch:=ch||jsonb_build_object(k,a);
   a:=arhittek_finance.money((item->>'costs')::numeric);if a<0 then raise sqlstate '22023' using message='Отрицательные обязательства';end if;ch:=ch||jsonb_build_object('costs:'||project_id_value,a);
   for team in select value from jsonb_array_elements(item->'team') loop
    emp:=(team->>'employee')::uuid;m:=team->>'month';a:=arhittek_finance.money((team->>'amount')::numeric);
    if a<0 or m is null or m!~'^[0-9]{4}-(0[1-9]|1[0-2])$' or not exists(select 1 from public.employees where employees.id=emp) then raise sqlstate '22023' using message='Проверьте сотрудника и месяц долга';end if;
    k:='team:'||project_id_value||':'||emp||':'||m;ch:=arhittek_finance.add(ch,k,a);
   end loop;
  end loop;
  select coalesce(sum(value::numeric),0) into total from jsonb_each_text(ch);
  ch:=ch||jsonb_build_object('reserve',cash-total);
  update arhittek_finance.settings set active=true,activated_at=clock_timestamp() where singleton;
 elsif cmd='adjust_reserve_legacy' then
  if s.active then raise sqlstate '40001' using message='Журнал уже включён. Обновите данные'; end if;
  lock table public.projects,public.employees,public.categories,public.invoices,public.timesheet_payments,public.statuses,public.departments,public.audit_log in share mode;
  if p->>'fingerprint' is distinct from arhittek_finance.fingerprint() then raise sqlstate '40001' using message='Данные изменились. Обновите резерв'; end if;
  a:=arhittek_finance.money((p->>'target')::numeric);
  cash:=arhittek_finance.money((p->>'cash')::numeric)+a-arhittek_finance.money((p->>'before')::numeric);
  perform arhittek_finance.money(cash);
  if cash<0 or (p->>'confirmed') is distinct from 'true' then raise sqlstate '22023' using message='Проверьте сумму и подтвердите корректировку'; end if;
  insert into public.audit_log(id,entity_type,entity_id,entity_name,action,changes)
  values(op,'reserve',op,'Корректировка резерва','cash_count',jsonb_build_object(
   'cash_count',jsonb_build_object('old',null,'new',jsonb_build_object('version',1,'total',cash,'counted_at',clock_timestamp(),'note',reason,'source','reserve-correction')),
   'reserve_adjustment',jsonb_build_object('before',(p->>'before')::numeric,'after',a,'delta',a-(p->>'before')::numeric,'request',request),
   '_actor',arhittek_finance.actor()));
  return arhittek_finance.snapshot();
 elsif not s.active then raise sqlstate '23514' using message='Сначала подтвердите начальную сверку';
 elsif cmd='close' then
  lock table public.projects,public.employees,public.categories,public.invoices in share mode;
  project_id_value:=(p->>'project')::uuid;
  perform 1 from public.projects where projects.id=project_id_value and deleted_at is null for update;
  if not found then raise sqlstate '22023' using message='Проект не найден';end if;
  if arhittek_finance.construction(project_id_value) then raise sqlstate '22023' using message='Для стройки используйте отдельное подтверждение вознаграждения компании';end if;
  if not exists(select 1 from public.projects x join public.statuses t on t.id=x.status_id where x.id=project_id_value and t.name ~* 'заверш') then raise sqlstate '22023' using message='Сначала завершите проект';end if;
  if p->>'project_fingerprint' is distinct from arhittek_finance.fingerprint() then raise sqlstate '40001' using message='Условия проекта изменились. Обновите расчёт закрытия';end if;
  k:='project:'||project_id_value;ch:=jsonb_build_object(k,-arhittek_finance.amount(b,k));
  for v in select key,value::numeric as amount from jsonb_each_text(b) where key='costs:'||project_id_value or key like 'team:'||project_id_value||':%' loop ch:=ch||jsonb_build_object(v.key,-v.amount);end loop;
  a:=arhittek_finance.money((p->>'costs')::numeric);if a<0 then raise sqlstate '22023' using message='Отрицательные расходы';end if;
  ch:=arhittek_finance.add(ch,'costs:'||project_id_value,a);
  if jsonb_typeof(p->'team') is distinct from 'array' then raise sqlstate '22023' using message='Проверьте обязательства перед командой';end if;
  for team in select value from jsonb_array_elements(p->'team') loop
   emp:=(team->>'employee')::uuid;m:=team->>'month';a:=arhittek_finance.money((team->>'amount')::numeric);
   if a<0 or m is null or m!~'^[0-9]{4}-(0[1-9]|1[0-2])$' or not exists(select 1 from public.employees where employees.id=emp) then raise sqlstate '22023' using message='Проверьте сотрудника, сумму и месяц';end if;
   ch:=arhittek_finance.add(ch,'team:'||project_id_value||':'||emp||':'||m,a);
  end loop;
  select coalesce(sum(value::numeric),0) into total from jsonb_each_text(ch);ch:=ch||jsonb_build_object('reserve',-total);
 elsif cmd='transfer' then
  -- Explicit owner-approved allocation; never creates or removes cash.
  k:=p->>'from';m:=p->>'to';a:=arhittek_finance.money((p->>'amount')::numeric);
  if a<=0 or k is null or m is null or k=m or not (b?k) then raise sqlstate '22023' using message='Проверьте источник, назначение и сумму';end if;
  if m not in ('reserve','amortization') then
   if m!~'^project:[0-9a-f-]{36}$' then raise sqlstate '22023' using message='Неизвестное назначение';end if;
   perform arhittek_finance.construction(split_part(m,':',2)::uuid);
  end if;
  if k='reserve' and arhittek_finance.amount(b,k)<a then raise sqlstate '23514' using message='Недостаточно свободного резерва';end if;
  ch:=jsonb_build_object(k,-a,m,a);
 elsif cmd='reverse' then
  select * into original from arhittek_finance.operations where operations.id=(p->>'operation')::uuid;
  if not found or original.kind='activate' or original.reverses is not null then raise sqlstate '22023' using message='Эту запись нельзя отменить';end if;
  if exists(select 1 from arhittek_finance.operations where reverses=original.id) then raise sqlstate '23514' using message='Операция уже отменена';end if;
  select jsonb_object_agg(key,-value::numeric) into ch from jsonb_each_text(original.changes);cash:=-original.cash_delta;
  perform arhittek_finance.post(op,cmd,reason,cash,ch,request,null,null,original.id);
  if original.source_table is not null then
   execute format('update public.%I set deleted_at=clock_timestamp() where id=$1 and deleted_at is null',original.source_table) using original.source_id;
  end if;
  if original.source_table='ledger_entries' then
   select to_jsonb(l) into item from public.ledger_entries l where l.id=original.source_id;
   project_id_value:=(item->>'project_id')::uuid;
   if project_id_value is not null and item->>'type' in ('advance','final_payment','income','materials_budget','construction_budget') then
    update public.projects set advance=greatest(0,coalesce(advance,0)-(item->>'amount')::numeric),balance=greatest(0,coalesce(price,0)-greatest(0,coalesce(advance,0)-(item->>'amount')::numeric)) where projects.id=project_id_value;
   elsif project_id_value is not null and item->>'type'='fee_payment' then
    update public.projects set
     co_fee_paid=case when co_employee_id=(item->>'payee_employee_id')::uuid then greatest(0,coalesce(co_fee_paid,0)-(item->>'amount')::numeric) else co_fee_paid end,
     fee_paid=case when co_employee_id is distinct from (item->>'payee_employee_id')::uuid then greatest(0,coalesce(fee_paid,0)-(item->>'amount')::numeric) else fee_paid end
    where projects.id=project_id_value and fee_base is distinct from 'm2';
   end if;
  end if;
  return arhittek_finance.snapshot();
 elsif cmd='adjust_reserve' then
  a:=arhittek_finance.money((p->>'target')::numeric);
  if (p->>'confirmed') is distinct from 'true' then raise sqlstate '22023' using message='Подтвердите корректировку'; end if;
  cash:=a-arhittek_finance.amount(b,'reserve');
  select cash+coalesce(sum(value::numeric),0) into total from jsonb_each_text(b);
  if total<0 then raise sqlstate '22023' using message='Общая сумма денег не может быть отрицательной'; end if;
  ch:=jsonb_build_object('reserve',cash);
 elsif cmd='reconcile' then
  cash:=arhittek_finance.money((p->>'cash')::numeric);
  if cash<0 or (p->>'confirmed') is distinct from 'true' then raise sqlstate '22023' using message='Подтвердите фактическую сумму всех денег';end if;
  select cash-coalesce(sum(value::numeric),0) into cash from jsonb_each_text(b);ch:=jsonb_build_object('reserve',cash);
 else raise sqlstate '22023' using message='Неизвестная операция';end if;
 perform arhittek_finance.post(op,cmd,reason,cash,ch,request);
 return arhittek_finance.snapshot();
end $$;
create or replace function public.confirm_financial_operation(p_command text,p_payload jsonb,p_operation uuid,p_revision bigint) returns jsonb language sql security invoker set search_path='' as $$
 select arhittek_finance.command(p_command,p_payload,p_operation,p_revision)
$$;
create or replace function arhittek_finance.project_review(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform arhittek_finance.actor();
 return (select jsonb_build_object('fingerprint',arhittek_finance.fingerprint(),'revision',(select revision from arhittek_finance.settings where singleton)) from public.projects where id=p_id);
end $$;
create or replace function public.review_financial_project(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select arhittek_finance.project_review(p_id) $$;

create or replace function arhittek_finance.history(before_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform arhittek_finance.actor();
 return coalesce((select jsonb_agg(to_jsonb(o) order by o.revision desc) from (
 select x.id,x.revision,x.kind,x.reason,x.actor,x.created_at,x.cash_delta,x.changes,x.balances_after,x.source_table,x.source_id,x.reverses,
 exists(select 1 from arhittek_finance.operations r where r.reverses=x.id) as is_reversed
 from arhittek_finance.operations x where before_revision is null or x.revision<before_revision order by x.revision desc limit 100) o),'[]'::jsonb);
end $$;
create or replace function public.get_financial_journal_history(p_before bigint default null) returns jsonb language sql security invoker set search_path='' as $$ select arhittek_finance.history(p_before) $$;
revoke execute on all functions in schema arhittek_finance from public,anon,authenticated;
grant usage on schema arhittek_finance to anon,authenticated;
grant execute on function arhittek_finance.snapshot(),arhittek_finance.command(text,jsonb,uuid,bigint),arhittek_finance.project_review(uuid),arhittek_finance.history(bigint) to anon,authenticated;
revoke all on function public.get_financial_journal(),public.confirm_financial_operation(text,jsonb,uuid,bigint),public.review_financial_project(uuid),public.get_financial_journal_history(bigint) from public,anon,authenticated;
grant execute on function public.get_financial_journal(),public.confirm_financial_operation(text,jsonb,uuid,bigint),public.review_financial_project(uuid),public.get_financial_journal_history(bigint) to anon,authenticated;
commit;
