begin;
-- Install the verified invoice prerequisite when it has not reached this database.
do $invoice_prerequisite$ begin
 if to_regprocedure('public.save_invoice_payment(uuid,uuid,numeric,date,text,uuid)') is null and to_regprocedure('arhittek_finance.invoice_payment_before_integrity(uuid,uuid,numeric,date,text,uuid)') is null then
  execute $invoice_install$
-- Apply after session-security.sql. No money/history is rewritten.
-- Every marked payment, including an older cached writer, locks its invoice.

create or replace function arhittek_security.invoice_marker(p_description text)
returns uuid language plpgsql immutable security invoker set search_path=pg_catalog,pg_temp
as $$ declare v_match text[]; begin
  v_match:=regexp_match(coalesce(p_description,''),'\[invoice-payment:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]');
  if v_match is null then return null; end if;
  return v_match[1]::uuid;
end $$;
revoke all on function arhittek_security.invoice_marker(text) from public;
grant execute on function arhittek_security.invoice_marker(text) to anon,authenticated,service_role;

create or replace function arhittek_security.check_invoice_payment()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp
as $$ declare v_old uuid; v_new uuid; v_id uuid; v_invoice record; v_paid numeric; v_today date;
begin
  if tg_op<>'INSERT' then v_old:=arhittek_security.invoice_marker(old.description); end if;
  if tg_op<>'DELETE' then v_new:=arhittek_security.invoice_marker(new.description); end if;
  -- Reassigning a previously linked operation must be explicit unlink+relink.
  if v_old is not null and v_new is not null and v_old<>v_new then
    raise check_violation using message='A payment is already linked to another invoice';
  end if;
  for v_id in select distinct x from unnest(array[v_old,v_new]) x where x is not null order by x loop
    perform 1 from public.invoices i where i.id=v_id for update;
  end loop;
  if tg_op='DELETE' then return old; end if;
  if v_new is null or new.deleted_at is not null then return new; end if;
  select * into v_invoice from public.invoices i where i.id=v_new;
  v_today:=timezone('Europe/Moscow',now())::date;
  if v_invoice.id is null or v_invoice.project_id is distinct from new.project_id or coalesce(v_invoice.paid_by_client,false)
     or new.type not in ('expense','project_expense','payment') or new.payee_employee_id is not null
     or new.amount is null or new.amount::text in ('NaN','Infinity','-Infinity') or new.amount<=0 or new.amount<>round(new.amount,2)
     or new.entry_date is null or new.entry_date>v_today
     or regexp_count(coalesce(new.description,''),'\[invoice-payment:')<>1 then
    raise check_violation using message='Invalid invoice payment or document';
  end if;
  select coalesce(sum(e.amount),0) into v_paid from public.ledger_entries e
  where e.project_id=v_invoice.project_id and e.id<>new.id and e.deleted_at is null
    and e.type in ('expense','project_expense','payment') and e.payee_employee_id is null
    and e.entry_date is not null and e.entry_date<=v_today
    and arhittek_security.invoice_marker(e.description)=v_new;
  if v_paid+new.amount>v_invoice.amount then
    raise check_violation using message='Payment exceeds the current unpaid invoice amount';
  end if;
  return new;
end $$;
revoke all on function arhittek_security.check_invoice_payment() from public;
drop trigger if exists arhittek_check_invoice_payment on public.ledger_entries;
create trigger arhittek_check_invoice_payment before insert or update or delete on public.ledger_entries
for each row execute function arhittek_security.check_invoice_payment();

create or replace function arhittek_security.protect_paid_invoice()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp
as $$ declare v_paid numeric; begin
  if tg_op<>'DELETE' and (new.amount is null or new.amount::text in ('NaN','Infinity','-Infinity')
    or new.amount<=0 or new.amount<>round(new.amount,2)) then
    raise check_violation using message='Invoice amount must be positive with at most two decimal places';
  end if;
  if tg_op='INSERT' then return new; end if;
  select coalesce(sum(e.amount),0) into v_paid from public.ledger_entries e
  where e.project_id=old.project_id and e.deleted_at is null
    and e.type in ('expense','project_expense','payment') and e.payee_employee_id is null
    and e.entry_date is not null and e.entry_date<=timezone('Europe/Moscow',now())::date
    and arhittek_security.invoice_marker(e.description)=old.id;
  if v_paid>0 and (tg_op='DELETE' or new.project_id is distinct from old.project_id
    or coalesce(new.paid_by_client,false) or new.amount<v_paid) then
    raise check_violation using message='Resolve linked invoice payments before changing or deleting this document';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function arhittek_security.protect_paid_invoice() from public;
drop trigger if exists arhittek_protect_paid_invoice on public.invoices;
create trigger arhittek_protect_paid_invoice before insert or update or delete on public.invoices
for each row execute function arhittek_security.protect_paid_invoice();

create or replace function public.save_invoice_payment(
  p_invoice_id uuid,p_operation_id uuid,p_amount numeric,p_entry_date date,p_description text,
  p_existing_entry_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,pg_temp
as $$ declare v_invoice record; v_entry public.ledger_entries%rowtype; v_marker text; v_today date;
begin
  -- Check before a lookup: a guessed invoice/operation UUID reveals no data.
  if not public.has_admin_session() then raise insufficient_privilege using message='Administrator session required'; end if;
  v_today:=timezone('Europe/Moscow',now())::date;
  v_marker:='[invoice-payment:'||p_invoice_id::text||']';
  if p_invoice_id is null or p_operation_id is null or p_amount is null
    or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount<>round(p_amount,2)
    or p_entry_date is null or p_entry_date>v_today or p_description is null
    or left(p_description,length(v_marker))<>v_marker or regexp_count(p_description,'\[invoice-payment:')<>1
    or (p_existing_entry_id is not null and p_existing_entry_id<>p_operation_id) then
    raise invalid_parameter_value using message='Invalid invoice payment';
  end if;
  select * into v_invoice from public.invoices i where i.id=p_invoice_id for update;
  if v_invoice.id is null or coalesce(v_invoice.paid_by_client,false) or v_invoice.amount is null
    or v_invoice.amount::text in ('NaN','Infinity','-Infinity') or v_invoice.amount<=0 then
    raise check_violation using message='Invoice is unavailable or paid directly by the client';
  end if;
  select * into v_entry from public.ledger_entries e where e.id=p_operation_id for update;
  if v_entry.id is not null then
    if v_entry.deleted_at is not null or v_entry.project_id is distinct from v_invoice.project_id
      or v_entry.type not in ('expense','project_expense','payment') or v_entry.payee_employee_id is not null
      or (p_existing_entry_id is null and v_entry.type<>'expense')
      or v_entry.amount is distinct from p_amount or v_entry.entry_date is distinct from p_entry_date then
      raise check_violation using message='Operation UUID conflicts with an existing payment';
    end if;
    if v_entry.description is distinct from p_description then
      if p_existing_entry_id is null or arhittek_security.invoice_marker(v_entry.description) is not null
        or (v_entry.type='project_expense' and (v_entry.description='Ранее внесённые расходы'
          or left(coalesce(v_entry.description,''),25)='[cash:historical-expense]')) then
        raise check_violation using message='Operation is already linked or does not match';
      end if;
      -- The ledger trigger obtains the same lock and checks the current debt.
      update public.ledger_entries set description=p_description where id=p_operation_id returning * into v_entry;
    end if;
  else
    if p_existing_entry_id is not null then raise no_data_found using message='Existing expense was not found'; end if;
    insert into public.ledger_entries(id,project_id,type,description,amount,entry_date,received_by)
    values(p_operation_id,v_invoice.project_id,'expense',p_description,p_amount,p_entry_date,
      (select s.employee_id from public.current_session_employee() s)) returning * into v_entry;
  end if;
  -- A replay of an already accepted UUID returns the same single operation,
  -- even after the remaining amount became zero. It creates no second debit.
  return jsonb_build_object('id',v_entry.id,'project_id',v_entry.project_id,'type',v_entry.type,
    'amount',v_entry.amount,'entry_date',v_entry.entry_date,'description',v_entry.description,
    'payee_employee_id',v_entry.payee_employee_id,'deleted_at',v_entry.deleted_at);
end $$;
revoke all on function public.save_invoice_payment(uuid,uuid,numeric,date,text,uuid) from public;
grant execute on function public.save_invoice_payment(uuid,uuid,numeric,date,text,uuid) to anon,authenticated,service_role;


$invoice_install$;
 end if;
end $invoice_prerequisite$;
lock table public.projects,public.ledger_entries,public.invoices in share row exclusive mode;
alter table public.projects add column if not exists received_opening numeric not null default 0;
alter table public.projects add column if not exists expenses_opening numeric not null default 0;
create or replace function arhittek_finance.project_is_construction(category uuid) returns boolean language sql stable set search_path='' as $$select coalesce((select d.name='Строительный отдел' or c.name ~* '(строительств|ремонт|монтаж)' from public.categories c left join public.departments d on d.id=c.department_id where c.id=category),false)$$;
revoke all on function arhittek_finance.project_is_construction(uuid) from public,anon,authenticated;
create table if not exists arhittek_finance.project_source_openings(
 project_id uuid primary key references public.projects(id),received numeric not null,costs numeric not null,
 main_employee uuid,co_employee uuid,main_paid numeric not null,co_paid numeric not null,
 original_values jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table arhittek_finance.project_source_openings enable row level security;
revoke all on arhittek_finance.project_source_openings from public,anon,authenticated;
create table if not exists arhittek_finance.project_payment_requests(id uuid primary key,request jsonb not null,entry_id uuid not null,actor uuid not null,created_at timestamptz not null default clock_timestamp());
alter table arhittek_finance.project_payment_requests enable row level security;
revoke all on arhittek_finance.project_payment_requests from public,anon,authenticated;
create or replace function arhittek_finance.project_sources(p uuid) returns jsonb language sql stable set search_path='' as $$
 with rows as(select * from public.ledger_entries where project_id=p and deleted_at is null and coalesce(entry_date,(created_at at time zone 'Europe/Moscow')::date)<=(clock_timestamp() at time zone 'Europe/Moscow')::date)
 select jsonb_build_object(
 'received',coalesce(sum(amount) filter(where type in ('advance','final_payment','income','materials_budget','construction_budget')),0)-coalesce(sum(amount) filter(where type='client_refund'),0),
'outgoing',coalesce(sum(amount) filter(where type in ('expense','project_expense','payment','withdrawal','fee_payment','salary_payment') and not(type='project_expense' and (description='Ранее внесённые расходы' or description like '[cash:historical-expense]%'))),0),
 'refunds',coalesce(sum(amount) filter(where type='client_refund'),0),
  'costs',coalesce(sum(amount) filter(where (type in ('expense','project_expense') or (type='payment' and payee_employee_id is null)) and not exists(select 1 from public.invoices i where i.project_id=p and i.id::text=substring(rows.description from '\[invoice-payment:([0-9a-fA-F-]{36})\]'))),0)+(select coalesce(sum(amount),0) from public.invoices where project_id=p),
 'company_costs',coalesce(sum(amount) filter(where (type in ('expense','project_expense') or (type='payment' and payee_employee_id is null)) and not exists(select 1 from public.invoices i where i.project_id=p and i.id::text=substring(rows.description from '\[invoice-payment:([0-9a-fA-F-]{36})\]'))),0)+(select coalesce(sum(amount),0) from public.invoices where project_id=p and not coalesce(paid_by_client,false)),
 'fees',coalesce((select jsonb_agg(jsonb_build_object('employee',payee_employee_id,'amount',amount)) from rows where type='fee_payment'),'[]')) from rows
$$;
revoke all on function arhittek_finance.project_sources(uuid) from public,anon,authenticated;
insert into arhittek_finance.project_source_openings(project_id,received,costs,main_employee,co_employee,main_paid,co_paid,original_values)
select p.id,case when arhittek_finance.project_is_construction(p.category_id) then 0 else greatest(0,coalesce(p.advance,0)-(s.v->>'received')::numeric) end,case when arhittek_finance.project_is_construction(p.category_id) then 0 else greatest(0,coalesce(p.expenses,0)-(s.v->>'company_costs')::numeric) end,p.employee_id,p.co_employee_id,
 greatest(0,coalesce(p.fee_paid,0)-coalesce((select sum((f.value->>'amount')::numeric) from jsonb_array_elements(s.v->'fees') as f(value) where nullif(f.value->>'employee','')::uuid is not distinct from p.employee_id or f.value->>'employee' is null),0)),
 greatest(0,coalesce(p.co_fee_paid,0)-coalesce((select sum((f.value->>'amount')::numeric) from jsonb_array_elements(s.v->'fees') as f(value) where p.co_employee_id is not null and (f.value->>'employee')::uuid=p.co_employee_id),0)),
 jsonb_build_object('advance',p.advance,'balance',p.balance,'expenses',p.expenses,'fee_paid',p.fee_paid,'co_fee_paid',p.co_fee_paid,'basis','Recorded historical project fields minus existing source records; not a new cash movement')
from public.projects p cross join lateral(select arhittek_finance.project_sources(p.id) v) s on conflict(project_id) do nothing;
create or replace function arhittek_finance.protect_project_sources() returns trigger language plpgsql security definer set search_path='' as $$
declare o arhittek_finance.project_source_openings;s jsonb;construction boolean;begin
 if tg_op='INSERT' then
  if coalesce(new.advance,0)<>0 or coalesce(new.fee_paid,0)<>0 or coalesce(new.co_fee_paid,0)<>0 or coalesce(new.expenses,0)<>0 then raise sqlstate '23514' using message='Поступления, расходы и выплаты добавляются отдельными операциями после создания проекта';end if;
  select coalesce(d.name='Строительный отдел' or c.name ~* '(строительств|ремонт|монтаж)',false) into construction from public.categories c left join public.departments d on d.id=c.department_id where c.id=new.category_id;
  if not coalesce(construction,false) then new.balance:=greatest(0,coalesce(new.price,0));end if;
  return new;
 end if;
 select * into o from arhittek_finance.project_source_openings where project_id=old.id;
 if not found then raise exception 'Не найден источник начальных данных проекта';end if;
 s:=arhittek_finance.project_sources(old.id);
 select coalesce(d.name='Строительный отдел' or c.name ~* '(строительств|ремонт|монтаж)',false) into construction from public.categories c left join public.departments d on d.id=c.department_id where c.id=new.category_id;
 new.received_opening:=o.received;new.expenses_opening:=o.costs;
 new.advance:=o.received+(s->>'received')::numeric+case when coalesce(construction,false) then (s->>'refunds')::numeric else 0 end;
 if new.advance<0 then raise sqlstate '23514' using message='Возврат превышает полученную оплату проекта';end if;
 if not coalesce(construction,false) then
  new.balance:=greatest(0,coalesce(new.price,0)-new.advance);
  new.expenses:=o.costs+(s->>'company_costs')::numeric;
  new.payment_status:=case when coalesce(new.price,0)>0 and new.balance=0 then 'Оплачен' when new.advance>0 then 'Частично оплачен' else 'Ждём оплату' end;
 else
  new.balance:=o.received+(s->>'received')::numeric-(s->>'outgoing')::numeric;
  new.expenses:=o.costs+(s->>'costs')::numeric;
 end if;
  new.fee_paid:=case when new.employee_id is not distinct from o.main_employee then o.main_paid else 0 end+coalesce((select sum((f.value->>'amount')::numeric) from jsonb_array_elements(s->'fees') as f(value) where nullif(f.value->>'employee','')::uuid is not distinct from new.employee_id or f.value->>'employee' is null),0);
  new.co_fee_paid:=case when new.co_employee_id is not distinct from o.co_employee then o.co_paid else 0 end+coalesce((select sum((f.value->>'amount')::numeric) from jsonb_array_elements(s->'fees') as f(value) where new.co_employee_id is not null and (f.value->>'employee')::uuid=new.co_employee_id),0);

 return new;
end $$;
revoke all on function arhittek_finance.protect_project_sources() from public,anon,authenticated;
create or replace function arhittek_finance.init_project_sources() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into arhittek_finance.project_source_openings(project_id,received,costs,main_employee,co_employee,main_paid,co_paid,original_values) values(new.id,0,0,new.employee_id,new.co_employee_id,0,0,'{"basis":"New project: no cash movement"}') on conflict do nothing;return new;
end $$;
revoke all on function arhittek_finance.init_project_sources() from public,anon,authenticated;
drop trigger if exists project_money_source_guard on public.projects;
create trigger project_money_source_guard before insert or update on public.projects for each row execute function arhittek_finance.protect_project_sources();
drop trigger if exists project_money_source_init on public.projects;
create trigger project_money_source_init after insert on public.projects for each row execute function arhittek_finance.init_project_sources();
create or replace function arhittek_finance.refresh_project_sources() returns trigger language plpgsql security definer set search_path='' as $$
declare previous uuid;current_id uuid;id_value uuid;begin
 if tg_op<>'INSERT' then previous:=old.project_id;end if;
 if tg_op<>'DELETE' then current_id:=new.project_id;end if;
 for id_value in select distinct v from unnest(array[previous,current_id]) v where v is not null order by v loop
  update public.projects set updated_at=clock_timestamp() where id=id_value;
 end loop;
 if tg_table_name='invoices' or coalesce(case when tg_op='DELETE' then to_jsonb(old)->>'type' else to_jsonb(new)->>'type' end,'') not in ('advance','final_payment','income','materials_budget','construction_budget','expense','project_expense','payment','withdrawal','fee_payment','salary_payment','client_refund') then update arhittek_finance.settings set revision=revision+1 where singleton;end if;
 return coalesce(new,old);
end $$;
revoke all on function arhittek_finance.refresh_project_sources() from public,anon,authenticated;
drop trigger if exists project_money_ledger_projection on public.ledger_entries;
create trigger project_money_ledger_projection after insert or update or delete on public.ledger_entries for each row execute function arhittek_finance.refresh_project_sources();
drop trigger if exists project_money_invoice_projection on public.invoices;
create trigger project_money_invoice_projection after insert or update or delete on public.invoices for each row execute function arhittek_finance.refresh_project_sources();
drop trigger if exists project_money_invoice_serialize on public.invoices;
create trigger project_money_invoice_serialize before insert or update or delete on public.invoices for each statement execute function arhittek_finance.serialize_source();
-- Empty drafts can be removed; projects with recorded money retain their history.
create or replace function arhittek_finance.protect_project_money_delete() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.ledger_entries where project_id=old.id) or exists(select 1 from public.invoices where project_id=old.id) or exists(select 1 from arhittek_finance.project_source_openings where project_id=old.id and (received<>0 or costs<>0 or main_paid<>0 or co_paid<>0)) then raise sqlstate '23514' using message='Проект с финансовой историей можно архивировать, но нельзя удалить безвозвратно';end if;
 delete from arhittek_finance.project_source_openings where project_id=old.id;return old;
end $$;
revoke all on function arhittek_finance.protect_project_money_delete() from public,anon,authenticated;
drop trigger if exists project_money_delete_guard on public.projects;
create trigger project_money_delete_guard before delete on public.projects for each row execute function arhittek_finance.protect_project_money_delete();
-- An older two-request money writer must reload before it can create a partial payment.
create or replace function arhittek_finance.require_project_money_client() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if current_user in ('anon','authenticated') and (case when tg_op='DELETE' then old.type else new.type end) in ('advance','final_payment','income','materials_budget','construction_budget','expense','project_expense','payment','withdrawal','fee_payment','salary_payment','client_refund') and coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-project-money-client','')<>'2' then raise sqlstate '23514' using message='Обновите приложение: финансовые операции теперь сохраняются целиком на сервере';end if;
 return coalesce(new,old);
end $$;
revoke all on function arhittek_finance.require_project_money_client() from public,anon,authenticated;
drop trigger if exists project_money_client_version on public.ledger_entries;
create trigger project_money_client_version before insert or update or delete on public.ledger_entries for each row execute function arhittek_finance.require_project_money_client();
create or replace function arhittek_finance.project_payment(action text,p jsonb,operation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior arhittek_finance.project_payment_requests;r public.ledger_entries;cfg arhittek_finance.settings;original arhittek_finance.operations;request jsonb:=jsonb_build_object('action',action,'payload',p);project uuid;amount numeric;date_value date;typ text;employee uuid;wallet uuid;headers_before text;begin
 perform arhittek_finance.actor();perform arhittek_finance.ensure_zero_start();select * into cfg from arhittek_finance.settings where singleton for update;
 if operation is null then raise sqlstate '22023' using message='Не задан номер операции';end if;
 select * into prior from arhittek_finance.project_payment_requests where id=operation;
 if found then if prior.request<>request then raise sqlstate '23514' using message='Повтор операции с другими данными';end if;select * into r from public.ledger_entries where id=prior.entry_id;
 elsif action='create' then
  project:=(p->>'project_id')::uuid;typ:=p->>'type';amount:=arhittek_finance.money((p->>'amount')::numeric);date_value:=(p->>'entry_date')::date;employee:=nullif(p->>'payee_employee_id','')::uuid;
  if typ not in ('advance','final_payment','income','materials_budget','construction_budget','fee_payment','withdrawal','client_refund') or amount<=0 or date_value is null or date_value>(clock_timestamp() at time zone 'Europe/Moscow')::date or not exists(select 1 from public.projects where id=project and deleted_at is null) then raise sqlstate '22023' using message='Проверьте проект, тип, сумму и дату платежа';end if;
  if typ='fee_payment' and (employee is null or not exists(select 1 from public.employees where id=employee and deleted_at is null)) then raise sqlstate '22023' using message='Укажите сотрудника';end if;
  if exists(select 1 from public.ledger_entries where id=operation) then raise sqlstate '23514' using message='Номер операции уже используется';end if;
  wallet:=nullif(p->>'wallet_id','')::uuid;
  if wallet is not null then
   if not exists(select 1 from arhittek_finance.wallets where id=wallet and active) then raise sqlstate '22023' using message='Выбранный счёт недоступен';end if;
   headers_before:=current_setting('request.headers',true);perform set_config('request.headers',(coalesce(nullif(headers_before,''),'{}')::jsonb||jsonb_build_object('x-finance-wallet',wallet))::text,true);
  end if;
  insert into public.ledger_entries(id,project_id,type,amount,entry_date,description,payee_employee_id,received_by) values(operation,project,typ,amount,date_value,coalesce(nullif(trim(p->>'description'),''),'Платёж'),case when typ='fee_payment' then employee end,arhittek_finance.actor()) returning * into r;
  if wallet is not null then perform set_config('request.headers',coalesce(headers_before,''),true);end if;
 elsif action='cancel' then
  select * into r from public.ledger_entries where id=(p->>'entry_id')::uuid for update;
  if not found or r.project_id is null then raise sqlstate '22023' using message='Платёж не найден';end if;
  if r.deleted_at is null then
   if cfg.active then
    select * into original from arhittek_finance.operations where source_table='ledger_entries' and source_id=r.id;
    if not found then raise sqlstate '23514' using message='Это платёж прежнего периода. Для фактического возврата добавьте отдельную операцию';end if;
    perform arhittek_finance.command('reverse',jsonb_build_object('operation',original.id,'reason',coalesce(nullif(trim(p->>'reason'),''),'Отмена платежа проекта')),operation,cfg.revision);
   else update public.ledger_entries set deleted_at=clock_timestamp() where id=r.id;end if;
   select * into r from public.ledger_entries where id=r.id;
  end if;
 else raise sqlstate '22023' using message='Неизвестное действие с платежом';end if;
 if prior.id is null then insert into arhittek_finance.project_payment_requests values(operation,request,r.id,arhittek_finance.actor(),clock_timestamp());end if;
 return jsonb_build_object('entry',to_jsonb(r),'project',(select to_jsonb(project_row) from public.projects project_row where project_row.id=r.project_id),'journal',public.get_financial_journal());
end $$;
create or replace function public.confirm_project_payment(p_action text,p_payload jsonb,p_operation uuid) returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.project_payment(p_action,p_payload,p_operation)$$;
revoke all on function arhittek_finance.project_payment(text,jsonb,uuid),public.confirm_project_payment(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function arhittek_finance.project_payment(text,jsonb,uuid),public.confirm_project_payment(text,jsonb,uuid) to anon,authenticated;
-- Rebuild cached totals from preserved openings and actual source records, without new money.
with before_rows as materialized(select id,name,jsonb_build_object('advance',advance,'balance',balance,'expenses',expenses,'fee_paid',fee_paid,'co_fee_paid',co_fee_paid) v from public.projects),
 rebuilt as(update public.projects p set updated_at=p.updated_at from before_rows b where p.id=b.id returning p.id,p.name,b.v before_value,jsonb_build_object('advance',p.advance,'balance',p.balance,'expenses',p.expenses,'fee_paid',p.fee_paid,'co_fee_paid',p.co_fee_paid) after_value)
insert into public.audit_log(entity_type,entity_id,entity_name,action,changes)
select 'project',id,name,'update',jsonb_build_object('source_projection',jsonb_build_object('before',before_value,'after',after_value,'basis','Rebuild from existing sources; no new cash movement')) from rebuilt where before_value is distinct from after_value;

create or replace function arhittek_finance.salary_prorated(employee uuid,month_value date,rate numeric) returns numeric language sql stable set search_path='' as $$
 select round(rate*greatest(0,((month_value+interval '1 month')::date-greatest(month_value,(e.created_at at time zone 'Europe/Moscow')::date))) / ((month_value+interval '1 month')::date-month_value),2) from public.employees e where e.id=employee
$$;
revoke all on function arhittek_finance.salary_prorated(uuid,date,numeric) from public,anon,authenticated;

-- Guaranteed salaries are known commitments, not optional manual forecast inputs.
-- Freeze current/past period terms; future periods use the current agreed rate.
create table if not exists arhittek_finance.salary_period_terms(employee_id uuid not null references public.employees(id),payroll_month date not null,amount numeric not null,due_date date not null,basis jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(employee_id,payroll_month));
alter table arhittek_finance.salary_period_terms enable row level security;
revoke all on arhittek_finance.salary_period_terms from public,anon,authenticated;
create or replace function arhittek_finance.ensure_salary_terms() returns void language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings;start_month date;month_value date;today date:=(clock_timestamp() at time zone 'Europe/Moscow')::date;due_day int;inserted int;changed boolean:=false;begin
 select * into cfg from arhittek_finance.settings where singleton for update;
 if not cfg.active then return;end if;perform arhittek_finance.actor();
 start_month:=date_trunc('month',coalesce(cfg.zero_start_date,(cfg.activated_at at time zone 'Europe/Moscow')::date))::date;
 select salary_due_day into due_day from arhittek_finance.workspace_policy where singleton;
 month_value:=start_month;
 while month_value<=date_trunc('month',today)::date loop
  insert into arhittek_finance.salary_period_terms(employee_id,payroll_month,amount,due_date,basis)
  select e.id,month_value,arhittek_finance.salary_prorated(e.id,month_value,arhittek_finance.money(e.fixed_salary)),(month_value+interval '1 month')::date+due_day-1,jsonb_build_object('source','employee.fixed_salary','role',e.role,'amount',e.fixed_salary,'snapshot_day',today)
  from public.employees e where e.is_salaried and coalesce(e.active,true) and e.deleted_at is null and e.fixed_salary>0 and (e.created_at at time zone 'Europe/Moscow')::date<(month_value+interval '1 month')::date
  on conflict(employee_id,payroll_month) do nothing;
  get diagnostics inserted=row_count;changed:=changed or inserted>0;
  month_value:=(month_value+interval '1 month')::date;
 end loop;
 if changed then update arhittek_finance.settings set revision=revision+1 where singleton;end if;
end $$;
revoke all on function arhittek_finance.ensure_salary_terms() from public,anon,authenticated;
create or replace function arhittek_finance.salary_period_paid(employee uuid,month_value date,as_of date) returns numeric language sql stable set search_path='' as $$
 select coalesce(sum(greatest(0,l.amount-coalesce(nullif(substring(l.description from '\[funded:([0-9.]+)\]'),'')::numeric,0))),0)
 from public.ledger_entries l where l.payee_employee_id=employee and l.type='salary_payment' and l.deleted_at is null and l.entry_date<=as_of and substring(l.description from '\[salary:([0-9]{4}-[0-9]{2})\]')=to_char(month_value,'YYYY-MM')
$$;
revoke all on function arhittek_finance.salary_period_paid(uuid,date,date) from public,anon,authenticated;
-- Snapshot and workspace share the same revision even when a month is first opened.
create or replace function arhittek_finance.snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings;begin
 perform arhittek_finance.actor();perform arhittek_finance.ensure_zero_start();perform arhittek_finance.ensure_salary_terms();select * into cfg from arhittek_finance.settings where singleton;
 return arhittek_finance.snapshot_before_zero_start()||jsonb_build_object('opening_mode',cfg.opening_mode,'start_date',cfg.zero_start_date,'opening_note',cfg.zero_start_note);
end $$;

-- Supplier documents and actual payments are linked without rewriting money.
create table if not exists arhittek_finance.invoice_annotation_authorizations(source_id uuid not null,transaction_id bigint not null,description text not null,primary key(source_id,transaction_id));
alter table arhittek_finance.invoice_annotation_authorizations enable row level security;
revoke all on arhittek_finance.invoice_annotation_authorizations from public,anon,authenticated;
do $$begin
 if to_regprocedure('arhittek_finance.invoice_payment_before_integrity(uuid,uuid,numeric,date,text,uuid)') is null then
  alter function public.save_invoice_payment(uuid,uuid,numeric,date,text,uuid) set schema arhittek_finance;
  alter function arhittek_finance.save_invoice_payment(uuid,uuid,numeric,date,text,uuid) rename to invoice_payment_before_integrity;
 end if;
 if to_regprocedure('arhittek_finance.workspace_items_before_integrity(date)') is null then alter function arhittek_finance.workspace_items(date) rename to workspace_items_before_integrity;end if;
 if to_regprocedure('arhittek_finance.workspace_command_before_integrity(text,jsonb,uuid,bigint)') is null then alter function arhittek_finance.workspace_command(text,jsonb,uuid,bigint) rename to workspace_command_before_integrity;end if;
 if to_regprocedure('arhittek_finance.workspace_before_integrity()') is null then alter function arhittek_finance.workspace() rename to workspace_before_integrity;end if;
end $$;
revoke all on function arhittek_finance.invoice_payment_before_integrity(uuid,uuid,numeric,date,text,uuid),arhittek_finance.workspace_items_before_integrity(date),arhittek_finance.workspace_command_before_integrity(text,jsonb,uuid,bigint),arhittek_finance.workspace_before_integrity() from public,anon,authenticated;
create or replace function arhittek_finance.invoice_payment(invoice uuid,operation uuid,amount numeric,paid_date date,description text,existing uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;before_description text;begin
 perform arhittek_finance.actor();perform arhittek_finance.ensure_zero_start();perform 1 from arhittek_finance.settings where singleton for update;
 if existing is not null then select l.description into before_description from public.ledger_entries l where l.id=existing;insert into arhittek_finance.invoice_annotation_authorizations values(existing,txid_current(),description) on conflict(source_id,transaction_id) do update set description=excluded.description;end if;
 result:=arhittek_finance.invoice_payment_before_integrity(invoice,operation,amount,paid_date,description,existing);
 if existing is not null and before_description is distinct from result->>'description' then update arhittek_finance.settings set revision=revision+1 where singleton;insert into public.audit_log(entity_type,entity_id,entity_name,action,changes) values('ledger_entry',existing,'Связь оплаты с накладной','update',jsonb_build_object('invoice_id',invoice,'description',jsonb_build_object('old',before_description,'new',result->>'description'),'cash_change',0));end if;
 delete from arhittek_finance.invoice_annotation_authorizations where source_id=existing and transaction_id=txid_current();return result;
end $$;
create or replace function public.save_invoice_payment(p_invoice_id uuid,p_operation_id uuid,p_amount numeric,p_entry_date date,p_description text,p_existing_entry_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.invoice_payment(p_invoice_id,p_operation_id,p_amount,p_entry_date,p_description,p_existing_entry_id)$$;
revoke all on function arhittek_finance.invoice_payment(uuid,uuid,numeric,date,text,uuid),public.save_invoice_payment(uuid,uuid,numeric,date,text,uuid) from public,anon,authenticated;
grant execute on function arhittek_finance.invoice_payment(uuid,uuid,numeric,date,text,uuid),public.save_invoice_payment(uuid,uuid,numeric,date,text,uuid) to anon,authenticated;
create or replace function arhittek_finance.invoice_remaining(invoice uuid,as_of date) returns numeric language sql stable set search_path='' as $$
 select greatest(0,i.amount-coalesce((select sum(l.amount) from public.ledger_entries l where l.project_id=i.project_id and l.deleted_at is null and l.type in ('expense','project_expense','payment') and l.payee_employee_id is null and l.entry_date<=as_of and arhittek_security.invoice_marker(l.description)=i.id),0)) from public.invoices i where i.id=invoice
$$;
revoke all on function arhittek_finance.invoice_remaining(uuid,date) from public,anon,authenticated;
create or replace function arhittek_finance.workspace_items(as_of date) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:='[]';item jsonb;r record;remaining numeric;invoice uuid;cutoff date;month_value date;payment_month date;due date;amount numeric;employee uuid;due_day int;begin
 select case when opening_mode='zero' then zero_start_date else (activated_at at time zone 'Europe/Moscow')::date end into cutoff from arhittek_finance.settings where singleton;
 for item in select value from jsonb_array_elements(arhittek_finance.workspace_items_before_integrity(as_of)) loop
  invoice:=nullif(item->'terms'->>'invoice_id','')::uuid;
  if item->>'origin'='rule' and nullif(item->>'employee_id','') is not null then
   employee:=(item->>'employee_id')::uuid;month_value:=(to_date(split_part(item->>'key',':',3)||'-01','YYYY-MM-DD')-interval '1 month')::date;
   amount:=arhittek_finance.salary_prorated(employee,month_value,(item->>'amount')::numeric);remaining:=greatest(0,amount-arhittek_finance.salary_period_paid(employee,month_value,as_of));
   if remaining>0 then result:=result||jsonb_build_array(item||jsonb_build_object('amount',amount,'remaining',remaining,'paid',amount-remaining,'terms',coalesce(item->'terms','{}')||jsonb_build_object('payroll_month',to_char(month_value,'YYYY-MM'))));end if;
  elsif invoice is not null and item->>'origin'='plan' then
   remaining:=arhittek_finance.invoice_remaining(invoice,as_of);
   if remaining>0 then result:=result||jsonb_build_array(item||jsonb_build_object('remaining',remaining,'paid',(item->>'amount')::numeric-remaining,'invoice_id',invoice));end if;
  else result:=result||jsonb_build_array(item);end if;
 end loop;
 for r in select i.* from public.invoices i where not coalesce(i.paid_by_client,false) and coalesce(to_jsonb(i)->>'deleted_at','')='' and (cutoff is null or (i.created_at at time zone 'Europe/Moscow')::date>=cutoff) and not exists(select 1 from arhittek_finance.plans p where not p.canceled and p.terms->>'invoice_id'=i.id::text) loop
  remaining:=arhittek_finance.invoice_remaining(r.id,as_of);
  if remaining>0 then result:=result||jsonb_build_array(jsonb_build_object('id',r.id,'key','invoice:'||r.id,'origin','invoice','invoice_id',r.id,'label','Накладная · '||coalesce(r.description,r.item_type,'Поставщик'),'direction','expense','amount',r.amount,'remaining',remaining,'paid',r.amount-remaining,'funding','project:'||r.project_id,'project_id',r.project_id,'certainty','confirmed','due_date',coalesce((select due_date from arhittek_finance.occurrence_dates where plan_key='invoice:'||r.id),nullif(to_jsonb(r)->>'due_date','')::date)));end if;
 end loop;
 select salary_due_day into due_day from arhittek_finance.workspace_policy where singleton;
 for r in
  select t.employee_id,t.payroll_month,t.amount,t.due_date,false projected,e.name from arhittek_finance.salary_period_terms t join public.employees e on e.id=t.employee_id
  union all
  select e.id,g.month_value::date,arhittek_finance.salary_prorated(e.id,g.month_value::date,e.fixed_salary),(g.month_value+interval '1 month')::date+due_day-1,true,e.name
  from public.employees e cross join lateral generate_series((date_trunc('month',as_of)+interval '1 month')::date,(as_of+90)::date,interval '1 month') as g(month_value)
  where e.is_salaried and coalesce(e.active,true) and e.deleted_at is null and e.fixed_salary>0
 loop
  payment_month:=date_trunc('month',r.due_date)::date;
  if r.due_date>as_of+90 or exists(select 1 from arhittek_finance.rules x where x.employee_id=r.employee_id and x.start_month<=payment_month and (x.end_month is null or x.end_month>=payment_month)) or exists(select 1 from arhittek_finance.plans x where not x.canceled and x.employee_id=r.employee_id and x.terms->>'payroll_month'=to_char(r.payroll_month,'YYYY-MM')) then continue;end if;
  remaining:=greatest(0,r.amount-arhittek_finance.salary_period_paid(r.employee_id,r.payroll_month,as_of));
  due:=coalesce((select due_date from arhittek_finance.occurrence_dates where plan_key='salary:'||r.employee_id||':'||to_char(r.payroll_month,'YYYY-MM')),r.due_date);
  if remaining>0 then result:=result||jsonb_build_array(jsonb_build_object('key','salary:'||r.employee_id||':'||to_char(r.payroll_month,'YYYY-MM'),'origin','employee_salary','label','Оклад · '||r.name||' · '||to_char(r.payroll_month,'YYYY-MM'),'direction','expense','funding','reserve','employee_id',r.employee_id,'amount',r.amount,'remaining',remaining,'paid',r.amount-remaining,'due_date',due,'certainty','confirmed','terms',jsonb_build_object('payroll_month',to_char(r.payroll_month,'YYYY-MM'),'projected_rate',r.projected)));end if;
 end loop;return result;
end $$;
create or replace function arhittek_finance.workspace_command(cmd text,p jsonb,op uuid,expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare invoice public.invoices;invoice_id uuid;item jsonb;cfg arhittek_finance.settings;prior arhittek_finance.workspace_requests;request jsonb:=jsonb_build_object('command',cmd,'payload',p);a numeric;w uuid;old_headers text;source arhittek_finance.operations;entry public.ledger_entries;begin
 perform arhittek_finance.actor();perform arhittek_finance.ensure_zero_start();perform 1 from arhittek_finance.settings where singleton for update;
 select * into cfg from arhittek_finance.settings where singleton;
 select * into prior from arhittek_finance.workspace_requests where id=op;
 if found then if prior.request<>request then raise sqlstate '23514' using message='Повтор с другими данными';end if;return public.get_financial_journal();end if;
 if cmd in ('pay','link') then
  select value into item from jsonb_array_elements(arhittek_finance.workspace_items((clock_timestamp() at time zone 'Europe/Moscow')::date)) where value->>'key'=p->>'key';
  invoice_id:=nullif(coalesce(item->>'invoice_id',item->'terms'->>'invoice_id'),'')::uuid;
  if cmd='link' then
   if item->>'origin'='employee_salary' or (item->>'origin'='rule' and nullif(item->>'employee_id','') is not null) then raise sqlstate '23514' using message='Оклад учитывает фактические выплаты за месяц автоматически. Используйте выплату оклада сотруднику';end if;
   select * into source from arhittek_finance.operations where id=(p->>'source')::uuid;
   select * into entry from public.ledger_entries where id=source.source_id;
   if arhittek_security.invoice_marker(entry.description) is not null then raise sqlstate '23514' using message='Оплата уже связана с накладной';end if;
  end if;
  if invoice_id is not null then
   if op is null or expected_revision is distinct from cfg.revision or not cfg.active then raise sqlstate '40001' using message='Обновите финансовые данные';end if;
   a:=arhittek_finance.money((p->>'amount')::numeric);
   if a<=0 or a>arhittek_finance.invoice_remaining(invoice_id,(clock_timestamp() at time zone 'Europe/Moscow')::date) then raise sqlstate '22023' using message='Проверьте неоплаченный остаток накладной';end if;
   if cmd='link' then
    if entry.id is null or source.source_table<>'ledger_entries' or a<>entry.amount then raise sqlstate '22023' using message='Для накладной связывается вся существующая оплата';end if;
    perform arhittek_finance.invoice_payment(invoice_id,entry.id,a,entry.entry_date,'[invoice-payment:'||invoice_id||'] '||coalesce(p->>'reason',entry.description),entry.id);
   else
    w:=(p->>'wallet_id')::uuid;if not exists(select 1 from arhittek_finance.wallets where id=w and active) then raise sqlstate '22023' using message='Проверьте счёт оплаты';end if;
    old_headers:=current_setting('request.headers',true);perform set_config('request.headers',(coalesce(nullif(old_headers,''),'{}')::jsonb||jsonb_build_object('x-finance-wallet',w))::text,true);
    perform arhittek_finance.invoice_payment(invoice_id,op,a,(p->>'date')::date,'[invoice-payment:'||invoice_id||'] '||coalesce(p->>'reason','Оплата накладной'),null);
    perform set_config('request.headers',coalesce(old_headers,''),true);
   end if;
   insert into arhittek_finance.workspace_requests(id,request,revision,actor) select op,request,revision,arhittek_finance.actor() from arhittek_finance.settings where singleton;
   return public.get_financial_journal();
  end if;
 end if;
 if cmd='plan' and nullif(p->'terms'->>'invoice_id','') is not null then
  invoice_id:=(p->'terms'->>'invoice_id')::uuid;select * into invoice from public.invoices where id=invoice_id for update;
  if not found or invoice.paid_by_client or p->>'direction'<>'expense' or nullif(p->>'project_id','')::uuid is distinct from invoice.project_id or (p->>'amount')::numeric<>invoice.amount or coalesce((p->>'obligation')::boolean,false) then raise sqlstate '22023' using message='Связанный план должен соответствовать всей накладной; повторное резервирование долга не требуется';end if;
  if exists(select 1 from arhittek_finance.plans x where not x.canceled and x.terms->>'invoice_id'=invoice_id::text and x.id<>coalesce(nullif(p->>'id','')::uuid,op)) then raise sqlstate '23514' using message='Накладная уже связана с платёжным планом';end if;
 end if;
 return arhittek_finance.workspace_command_before_integrity(cmd,p,op,expected_revision);
end $$;
-- Forecast unfunded obligations against company reserve rather than pretending
-- that a project with no money can pay them from an empty earmarked account.
create or replace function arhittek_finance.workspace() returns jsonb language plpgsql security definer set search_path='' as $$
declare w jsonb;r jsonb;f jsonb;v jsonb;timeline jsonb:='[]';expected jsonb;conservative jsonb;day date;as_of date;amount numeric;take numeric;funding text;amort numeric;minimum numeric;available numeric;first_deficit date;begin
 perform arhittek_finance.actor();perform arhittek_finance.ensure_salary_terms();w:=arhittek_finance.workspace_before_integrity();expected:=w->'balances';conservative:=expected;as_of:=(w->>'as_of')::date;minimum:=coalesce((expected->>'reserve')::numeric,0);available:=minimum;
 for f in select value from jsonb_array_elements(w->'forecast') loop
  day:=(f->>'date')::date;
  for v in select value from jsonb_array_elements(w->'items') where value->>'direction'='income' and value->>'certainty'='confirmed' and (value->>'due_date')::date=day loop
   amount:=(v->>'remaining')::numeric;funding:=v->>'funding';amort:=case when nullif(v->>'project_id','') is not null and arhittek_finance.construction_readonly((v->>'project_id')::uuid) then 0 else round(amount*.05,2) end;
   expected:=arhittek_finance.add(expected,funding,amount-amort);expected:=arhittek_finance.add(expected,'amortization',amort);
  end loop;
  for v in select value from jsonb_array_elements(w->'items') where value->>'direction'='expense' and greatest(coalesce((value->>'due_date')::date,as_of),as_of)=day loop
   amount:=(v->>'remaining')::numeric;funding:=v->>'funding';
   if funding='reserve' then conservative:=arhittek_finance.add(conservative,'reserve',-amount);expected:=arhittek_finance.add(expected,'reserve',-amount);
   else
    take:=least(amount,greatest(0,arhittek_finance.amount(conservative,funding)));conservative:=arhittek_finance.add(conservative,funding,-take);conservative:=arhittek_finance.add(conservative,'reserve',take-amount);
    take:=least(amount,greatest(0,arhittek_finance.amount(expected,funding)));expected:=arhittek_finance.add(expected,funding,-take);expected:=arhittek_finance.add(expected,'reserve',take-amount);
   end if;
  end loop;
  for v in select value from jsonb_array_elements(w->'items') where value->>'direction'='release' and value->>'certainty'='confirmed' and (value->>'due_date')::date=day loop
   amount:=(v->>'remaining')::numeric;funding:=v->>'funding';take:=least(amount,greatest(0,arhittek_finance.amount(expected,funding)));expected:=arhittek_finance.add(expected,funding,-take);expected:=arhittek_finance.add(expected,'reserve',take);
  end loop;
  amount:=arhittek_finance.amount(conservative,'reserve');minimum:=least(minimum,amount);if day<=as_of+30 then available:=least(available,amount);end if;if amount<0 and first_deficit is null then first_deficit:=day;end if;
  timeline:=timeline||jsonb_build_array(f||jsonb_build_object('conservative',amount,'expected',arhittek_finance.amount(expected,'reserve')));
 end loop;
 w:=jsonb_set(w,'{unmatched}',coalesce((select jsonb_agg(u.value) from jsonb_array_elements(w->'unmatched') as u(value) where not exists(select 1 from arhittek_finance.operations o join public.ledger_entries l on l.id=o.source_id where o.id=(u.value->>'id')::uuid and (arhittek_security.invoice_marker(l.description) is not null or (l.type='salary_payment' and substring(l.description from '\[salary:([0-9]{4}-[0-9]{2})\]') is not null)))),'[]'::jsonb));
 return w||jsonb_build_object('automatic_salaries',true,'salary_terms',(select coalesce(jsonb_agg(jsonb_build_object('employee_id',t.employee_id,'payroll_month',to_char(t.payroll_month,'YYYY-MM'),'monthly_rate',(t.basis->>'amount')::numeric,'amount',t.amount,'due_date',t.due_date)),'[]') from arhittek_finance.salary_period_terms t),'forecast',timeline,'minimum',minimum,'available_30',available,'first_deficit',first_deficit);
end $$;
revoke all on function arhittek_finance.workspace(),arhittek_finance.workspace_command(text,jsonb,uuid,bigint),arhittek_finance.workspace_items(date) from public,anon,authenticated;
grant execute on function arhittek_finance.workspace(),arhittek_finance.workspace_command(text,jsonb,uuid,bigint) to anon,authenticated;
create or replace function public.get_financial_journal() returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.snapshot()||jsonb_build_object('workspace',arhittek_finance.workspace())$$;
create or replace function public.confirm_finance_workspace(p_command text,p_payload jsonb,p_operation uuid,p_revision bigint) returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.workspace_command(p_command,p_payload,p_operation,p_revision)$$;

create or replace function arhittek_finance.capture() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings; r jsonb; prev jsonb; typ text; d date; a numeric; incoming boolean; outgoing boolean;
 b jsonb; ch jsonb:='{}'; project uuid; emp uuid; k text; m text; take numeric; leftpay numeric; am numeric; v record; changed boolean; settlement arhittek_finance.settlements;
begin
 perform arhittek_finance.ensure_zero_start();
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
  if tg_table_name='ledger_entries' and tg_op='UPDATE' and (r-'description')=(prev-'description') and exists(select 1 from arhittek_finance.invoice_annotation_authorizations a where a.source_id=old.id and a.transaction_id=txid_current() and a.description=new.description) then return new;end if;
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
  raise sqlstate '22023' using message='Укажите положительную сумму и дату не раньше начала учёта, не в будущем'; end if;
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
commit;
