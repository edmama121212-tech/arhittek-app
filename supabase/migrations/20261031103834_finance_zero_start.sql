begin;
select 1 from arhittek_finance.settings where singleton for update;
alter table arhittek_finance.settings add column if not exists opening_mode text not null default 'reconciled' check(opening_mode in ('reconciled','zero'));
alter table arhittek_finance.settings add column if not exists zero_start_date date;
alter table arhittek_finance.settings add column if not exists zero_start_note text;
-- Owner instruction: November starts from zero, without importing old balances.
-- Scheduling never modifies the source records or silently resets an active journal.
do $$declare cfg arhittek_finance.settings;begin
 select * into cfg from arhittek_finance.settings where singleton;
 if cfg.opening_mode='zero' and cfg.zero_start_date=date '2026-11-01' then return;end if;
 if cfg.active or exists(select 1 from arhittek_finance.operations) or exists(select 1 from arhittek_finance.wallet_entries) or exists(select 1 from arhittek_finance.plans) or exists(select 1 from arhittek_finance.rules) then
  raise exception 'Нельзя настроить нулевой старт поверх действующего журнала или внесённых обязательств';
 end if;
 update arhittek_finance.settings set opening_mode='zero',zero_start_date=date '2026-11-01',zero_start_note='По поручению Мансура: новый учёт с нуля с 01.11.2026, без сверки и переноса старых остатков' where singleton;
end $$;
create or replace function arhittek_finance.ensure_zero_start() returns void language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings;begin
 select * into cfg from arhittek_finance.settings where singleton for update;
 if cfg.active or cfg.opening_mode<>'zero' or cfg.zero_start_date is null or (clock_timestamp() at time zone 'Europe/Moscow')::date<cfg.zero_start_date then return;end if;
 perform arhittek_finance.actor();
 if exists(select 1 from arhittek_finance.operations) or exists(select 1 from arhittek_finance.wallet_entries) then raise exception 'Нулевой старт не может перезаписать существующие операции';end if;
 update arhittek_finance.settings set active=true,activated_at=cfg.zero_start_date::timestamp at time zone 'Europe/Moscow' where singleton;
 perform arhittek_finance.post(gen_random_uuid(),'activate',cfg.zero_start_note,0,'{"reserve":0,"amortization":0}'::jsonb,jsonb_build_object('command','zero_start','payload',jsonb_build_object('start_date',cfg.zero_start_date,'basis',cfg.zero_start_note,'reconciliation_required',false)));
end $$;
revoke all on function arhittek_finance.ensure_zero_start() from public,anon,authenticated;
-- Wrappers preserve the existing algorithms. Only the start policy changes.
do $$begin
 if to_regprocedure('arhittek_finance.snapshot_before_zero_start()') is null then alter function arhittek_finance.snapshot() rename to snapshot_before_zero_start;end if;
 if to_regprocedure('arhittek_finance.workspace_before_zero_start()') is null then alter function arhittek_finance.workspace() rename to workspace_before_zero_start;end if;
 if to_regprocedure('arhittek_finance.workspace_command_before_zero_start(text,jsonb,uuid,bigint)') is null then alter function arhittek_finance.workspace_command(text,jsonb,uuid,bigint) rename to workspace_command_before_zero_start;end if;
 if to_regprocedure('arhittek_finance.command_before_zero_start(text,jsonb,uuid,bigint)') is null then alter function arhittek_finance.command(text,jsonb,uuid,bigint) rename to command_before_zero_start;end if;
end $$;
create or replace function arhittek_finance.snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings;begin
 perform arhittek_finance.actor();perform arhittek_finance.ensure_zero_start();select * into cfg from arhittek_finance.settings where singleton;
 return arhittek_finance.snapshot_before_zero_start()||jsonb_build_object('opening_mode',cfg.opening_mode,'start_date',cfg.zero_start_date,'opening_note',cfg.zero_start_note);
end $$;
create or replace function arhittek_finance.workspace() returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings;result jsonb;begin
 perform arhittek_finance.actor();perform arhittek_finance.ensure_zero_start();select * into cfg from arhittek_finance.settings where singleton;
 result:=arhittek_finance.workspace_before_zero_start()||jsonb_build_object('opening_mode',cfg.opening_mode,'start_date',cfg.zero_start_date,'opening_note',cfg.zero_start_note);
 if cfg.opening_mode='zero' then
  -- Old contract remainders are not new-period promises or automatic debts.
  result:=jsonb_set(result,'{unscheduled_projects}',coalesce((select jsonb_agg(v) from jsonb_array_elements(result->'unscheduled_projects') v join public.projects p on p.id=(v->>'id')::uuid where (p.created_at at time zone 'Europe/Moscow')::date>=cfg.zero_start_date),'[]'::jsonb));
  result:=jsonb_set(result,'{warnings}',coalesce((select jsonb_agg(v) from jsonb_array_elements(result->'warnings') v where v#>>'{}'<>'Не подтверждена начальная сверка денег и обязательств'),'[]'::jsonb));
 end if;
 return result;
end $$;
create or replace function arhittek_finance.workspace_command(cmd text,p jsonb,op uuid,expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings;begin
 perform arhittek_finance.actor();perform arhittek_finance.ensure_zero_start();select * into cfg from arhittek_finance.settings where singleton;
 if cfg.opening_mode='zero' and cmd in ('plan','rule') and coalesce(nullif(p->>'due_date',''),nullif(p->>'start_month',''))::date<cfg.zero_start_date then raise sqlstate '22023' using message='План нового учёта не может начинаться раньше нулевого старта';end if;
 return arhittek_finance.workspace_command_before_zero_start(cmd,p,op,expected_revision);
end $$;
create or replace function arhittek_finance.command(cmd text,p jsonb,op uuid,expected bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform arhittek_finance.actor();perform arhittek_finance.ensure_zero_start();
 if cmd='activate' and exists(select 1 from arhittek_finance.settings where singleton and opening_mode='zero') then raise sqlstate '23514' using message='Уже настроен старт с нуля. Начальная сверка не требуется';end if;
 return arhittek_finance.command_before_zero_start(cmd,p,op,expected);
end $$;
-- Rebind public entry points to invalidate plans compiled before the wrappers.
create or replace function public.get_financial_journal() returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.snapshot()||jsonb_build_object('workspace',arhittek_finance.workspace())$$;
create or replace function public.confirm_finance_workspace(p_command text,p_payload jsonb,p_operation uuid,p_revision bigint) returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.workspace_command(p_command,p_payload,p_operation,p_revision)$$;
create or replace function public.confirm_financial_operation(p_command text,p_payload jsonb,p_operation uuid,p_revision bigint) returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.command(p_command,p_payload,p_operation,p_revision)$$;
revoke all on function arhittek_finance.snapshot_before_zero_start(),arhittek_finance.workspace_before_zero_start(),arhittek_finance.workspace_command_before_zero_start(text,jsonb,uuid,bigint),arhittek_finance.command_before_zero_start(text,jsonb,uuid,bigint) from public,anon,authenticated;
revoke all on function arhittek_finance.snapshot(),arhittek_finance.workspace(),arhittek_finance.workspace_command(text,jsonb,uuid,bigint),arhittek_finance.command(text,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function arhittek_finance.snapshot(),arhittek_finance.workspace(),arhittek_finance.workspace_command(text,jsonb,uuid,bigint),arhittek_finance.command(text,jsonb,uuid,bigint) to anon,authenticated;
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
