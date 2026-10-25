begin;
create or replace function arhittek_security.project_basic_insert(p public.projects)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,pg_temp
as $$ declare v_actor record; v_emp record; v_construction boolean;
begin
  select * into v_actor from arhittek_security.session_employee();
  if v_actor.employee_id is null then return false; end if;
  if v_actor.is_admin then return true; end if;
  select * into v_emp from public.employees e where e.id=v_actor.employee_id;
  if lower(btrim(coalesce(v_emp.role,''))) not in ('ведущий дизайнер','ведущий архитектор') or not coalesce(v_emp.can_see_projects,true) then return false; end if;
  if p.employee_id is distinct from v_actor.employee_id or p.co_employee_id is not null or p.deleted_at is not null
    or coalesce(p.price,0)<>0 or coalesce(p.advance,0)<>0 or coalesce(p.balance,0)<>0 or coalesce(p.expenses,0)<>0
    or coalesce(p.fee_percent,0)<>0 or coalesce(p.co_fee_percent,0)<>0 or coalesce(p.fee_paid,0)<>0 or coalesce(p.co_fee_paid,0)<>0
    or coalesce(p.fee_settled,false) or p.category_id is null or p.status_id is null
    or not exists(select 1 from public.categories c where c.id=p.category_id and c.deleted_at is null)
    or not exists(select 1 from public.statuses s where s.id=p.status_id and s.name<>'Завершён')
    or coalesce(p.area,0)<0 or length(btrim(coalesce(p.name,'')))=0
    or (p.start_date is not null and p.end_date is not null and p.start_date>p.end_date)
    or p.contract_passport is not null or p.contract_passport_issuer is not null or p.contract_passport_date is not null
    or p.contract_birthdate is not null or p.contract_address is not null or p.contract_scope is not null
    or p.contract_advance_pct is not null or p.contract_number is not null or p.contract_client_name is not null then return false; end if;
  v_construction:=arhittek_security.category_is_construction(p.category_id);
  return not v_construction or coalesce(v_emp.can_see_construction,lower(coalesce(v_emp.role,'')) ~ '(прораб|менеджер|manager)');
end $$;

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

notify pgrst,'reload schema';
commit;
