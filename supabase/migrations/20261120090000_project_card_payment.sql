-- The card editor also supports older construction projects identified by invoices.
create or replace function arhittek_security.card_payment_is_construction(p public.projects)
returns boolean language sql stable security invoker set search_path=pg_catalog,pg_temp as $$
  select coalesce((select d.name='Строительный отдел' or c.name ~* '(строительств|ремонт|монтаж)'
    from public.categories c left join public.departments d on d.id=c.department_id where c.id=p.category_id),false)
    or (not exists(select 1 from public.categories c join public.departments d on d.id=c.department_id
       where c.id=p.category_id and d.name='Проектный отдел')
       and exists(select 1 from public.invoices i where i.project_id=p.id and (to_jsonb(i)->>'deleted_at') is null));
$$;
revoke all on function arhittek_security.card_payment_is_construction(public.projects) from public;
grant execute on function arhittek_security.card_payment_is_construction(public.projects) to anon,authenticated,service_role;

-- A journal reversal and an old client may update the received total directly.
create or replace function arhittek_security.sync_card_payment_status()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
  if not arhittek_security.card_payment_is_construction(new) then
    new.payment_status:=case when new.price>0 and new.advance>=new.price then 'Оплачен'
      when new.advance>0 then 'Частично оплачен' else 'Ждём оплату' end;
  end if;
  return new;
end $$;
drop trigger if exists arhittek_card_payment_status on public.projects;
create trigger arhittek_card_payment_status before update of price,advance on public.projects
  for each row when(old.price is distinct from new.price or old.advance is distinct from new.advance)
  execute function arhittek_security.sync_card_payment_status();

-- One transaction for the cash journal entry and the project totals.
create or replace function public.record_project_card_payment(p_entry jsonb,p_expected jsonb,p_updates jsonb)
returns uuid language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
declare
  actor uuid;
  entry public.ledger_entries;
  prior public.ledger_entries;
  project public.projects;
  updated public.projects;
  contract_payment boolean;
  construction boolean;
  received numeric;
  outgoing numeric;
  allowed jsonb:='{}'::jsonb;
  fee_field text;
begin
  select employee_id into actor from public.current_session_employee() where is_admin;
  if actor is null then raise insufficient_privilege using message='Финансовые операции сохраняет администратор'; end if;
  entry:=jsonb_populate_record(null::public.ledger_entries,p_entry);
  if entry.id is null or entry.project_id is null or entry.type is null or
     entry.type not in ('advance','final_payment','materials_budget','withdrawal','fee_payment')
     or entry.amount is null or entry.amount::text in ('NaN','Infinity','-Infinity') or entry.amount<=0 or entry.amount<>round(entry.amount,2)
     or entry.entry_date is null or entry.entry_date>(now() at time zone 'Europe/Moscow')::date
     or (entry.type='withdrawal' and nullif(trim(entry.description),'') is null)
     or ((entry.type='fee_payment')<>(entry.payee_employee_id is not null))
     or (coalesce(entry.received_before_start,false) and entry.type in ('withdrawal','fee_payment')) then
    raise invalid_parameter_value using message='Проверьте сумму, дату и назначение платежа';
  end if;
  if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_updates) is distinct from 'object'
     or (p_updates-array['advance','balance','fee_paid','co_fee_paid','payment_status'])<>'{}'::jsonb then
    raise invalid_parameter_value using message='Некорректные поля платежа';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(entry.id::text,0));
  select * into prior from public.ledger_entries where id=entry.id;
  if found then
    if prior.deleted_at is null and prior.received_by=actor and
       row(prior.project_id,prior.type,prior.amount,prior.entry_date,prior.description,prior.payee_employee_id,prior.received_before_start)
       is not distinct from row(entry.project_id,entry.type,entry.amount,entry.entry_date,entry.description,entry.payee_employee_id,coalesce(entry.received_before_start,false)) then
      return prior.id;
    end if;
    raise unique_violation using message='Этот номер платежа уже использован';
  end if;
  -- Acquire the normal journal serialization lock before locking the project.
  -- A later exception rolls back both this insert and its cash-capture trigger.
  insert into public.ledger_entries(id,project_id,type,amount,entry_date,description,received_before_start,payee_employee_id,received_by)
  values(entry.id,entry.project_id,entry.type,entry.amount,entry.entry_date,entry.description,coalesce(entry.received_before_start,false),entry.payee_employee_id,actor);
  select * into project from public.projects where id=entry.project_id and deleted_at is null for update;
  if not found or not(to_jsonb(project) @> p_expected) then
    raise serialization_failure using message='Данные проекта изменились. Обновите карточку перед повтором.';
  end if;
  -- Confirm the browser's projection against the locked project and persisted money.
  construction:=arhittek_security.card_payment_is_construction(project);
  contract_payment:=entry.type in ('advance','final_payment','materials_budget');
  if construction then
    select coalesce(sum(amount) filter(where type in ('advance','final_payment','materials_budget','construction_budget','income')),0),
           coalesce(sum(amount) filter(where type in ('expense','project_expense','payment','withdrawal','fee_payment','salary_payment','client_refund')
             and not(type='project_expense' and (coalesce(description,'')='Ранее внесённые расходы' or coalesce(description,'') like '[cash:historical-expense]%'))),0)
      into received,outgoing from public.ledger_entries where project_id=project.id and deleted_at is null
      and (entry_date is null or entry_date<=(now() at time zone 'Europe/Moscow')::date);
    allowed:=jsonb_build_object('balance',round(received-outgoing,2));
    if contract_payment then allowed:=allowed||jsonb_build_object('advance',received); end if;
  elsif contract_payment then
    received:=round(coalesce(project.advance,0),2)+entry.amount;
    allowed:=jsonb_build_object('advance',received,'balance',greatest(0,round(coalesce(project.price,0),2)-received),
      'payment_status',case when project.price>0 and received>=project.price then 'Оплачен' else 'Частично оплачен' end);
  end if;
  if entry.type='fee_payment' and project.fee_base is distinct from 'm2' then
    fee_field:=case when entry.payee_employee_id=project.employee_id then 'fee_paid' when entry.payee_employee_id=project.co_employee_id then 'co_fee_paid' end;
    if fee_field is not null then allowed:=allowed||jsonb_build_object(fee_field,coalesce((to_jsonb(project)->>fee_field)::numeric,0)+entry.amount); end if;
  end if;
  if allowed<>p_updates then
    raise serialization_failure using message='Данные проекта изменились. Обновите карточку перед повтором.';
  end if;
  if p_updates<>'{}'::jsonb then
    updated:=jsonb_populate_record(project,p_updates);
    update public.projects set advance=updated.advance,balance=updated.balance,fee_paid=updated.fee_paid,
      co_fee_paid=updated.co_fee_paid,payment_status=updated.payment_status where id=project.id;
  end if;
  return entry.id;
end $$;
revoke all on function public.record_project_card_payment(jsonb,jsonb,jsonb) from public;
grant execute on function public.record_project_card_payment(jsonb,jsonb,jsonb) to anon,authenticated;
