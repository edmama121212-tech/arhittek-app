begin;
set local lock_timeout = '5s';
select 1 from arhittek_finance.settings where singleton for update;

-- Preserve the zero-start wrappers, permissions and existing transaction logic.
-- Refuse an unfamiliar installed definition rather than replacing another release.
do $migration$
declare
  definition text;
  before_guard text := 'if old_value is not null and exists(select 1 from arhittek_finance.settlements where plan_key=id_value::text) then';
  after_guard text := 'if old_value is not null and (exists(select 1 from arhittek_finance.settlements where plan_key=id_value::text) or exists(select 1 from arhittek_finance.calendar_links where plan_key=id_value::text)) then';
  before_link text := 'funding:=item->>''funding'';capacity:=arhittek_finance.amount(source.changes,funding);';
  after_link text := $link$
  -- calendar_link_identity_v1: both sides must name the same recipient/project.
  project:=nullif(item->>'project_id','')::uuid;
  employee:=nullif(item->>'employee_id','')::uuid;
  if source.source_table='ledger_entries' then
   select l.project_id,l.payee_employee_id into v
     from public.ledger_entries l
     where l.id=source.source_id and l.deleted_at is null;
   if not found or project is distinct from v.project_id
      or employee is distinct from v.payee_employee_id then
    raise sqlstate '22023' using message='Оплата и план должны относиться к одному сотруднику и проекту';
   end if;
  elsif source.source_table in ('company_income','company_expenses') then
   if project is not null or employee is not null then
    raise sqlstate '22023' using message='В исходной оплате не указан сотрудник или проект выбранного плана';
   end if;
  else
   raise sqlstate '22023' using message='Неизвестный источник оплаты';
  end if;
  funding:=item->>'funding';capacity:=arhittek_finance.amount(source.changes,funding);
$link$;
begin
  if to_regprocedure('arhittek_finance.workspace_command_before_zero_start(text,jsonb,uuid,bigint)') is null then
    raise exception 'Install finance_zero_start before finance_payment_integrity';
  end if;
  definition:=pg_get_functiondef('arhittek_finance.workspace_command_before_zero_start(text,jsonb,uuid,bigint)'::regprocedure);
  if position(after_guard in definition)=0 then
    if position(before_guard in definition)=0 then
      raise exception 'Unrecognized paid-plan guard; migration canceled';
    end if;
    definition:=replace(definition,before_guard,after_guard);
  end if;
  if position('calendar_link_identity_v1' in definition)=0 then
    if position(before_link in definition)=0 then
      raise exception 'Unrecognized calendar-link command; migration canceled';
    end if;
    definition:=replace(definition,before_link,after_link);
  end if;
  execute definition;
end;
$migration$;

do $migration$
declare
  definition text;
  before_guard text := 'fee_paid=case when co_employee_id is distinct from (item->>''payee_employee_id'')::uuid then';
  -- Recipient-less legacy fee records refer to the primary executor.
  after_guard text := 'fee_paid=case when (item->>''payee_employee_id'') is null or employee_id=(item->>''payee_employee_id'')::uuid then';
begin
  definition:=pg_get_functiondef('arhittek_finance.command_before_zero_start(text,jsonb,uuid,bigint)'::regprocedure);
  if position(after_guard in definition)=0 then
    if position(before_guard in definition)=0 then
      raise exception 'Unrecognized fee reversal command; migration canceled';
    end if;
    execute replace(definition,before_guard,after_guard);
  end if;
end;
$migration$;

-- The owner-facing unmatched list carries the same source identity as journal
-- entries, including older operations beyond the latest journal page.
do $migration$
declare
  definition text;
  before_fields text := 'select o.id,o.reason,o.created_at,o.cash_delta,o.changes,abs(o.cash_delta)';
  after_fields text := 'select o.id,o.source_table,o.source_id,o.reason,o.created_at,o.cash_delta,o.changes,abs(o.cash_delta)';
begin
  definition:=pg_get_functiondef('arhittek_finance.workspace_before_zero_start()'::regprocedure);
  if position(after_fields in definition)=0 then
    if position(before_fields in definition)=0 then
      raise exception 'Unrecognized unmatched-payment snapshot; migration canceled';
    end if;
    execute replace(definition,before_fields,after_fields);
  end if;
end;
$migration$;

commit;
