-- Apply after session-security.sql. No money/history is rewritten.
-- Every marked payment, including an older cached writer, locks its invoice.
begin;

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
notify pgrst,'reload schema';
commit;
