begin;
select 1 from arhittek_finance.settings where singleton for update;
alter table public.ledger_entries add column if not exists received_before_start boolean not null default false;
create table if not exists arhittek_finance.receipt_corrections(
 id uuid primary key,source_id uuid not null,request jsonb not null,before_value jsonb not null,after_value jsonb not null,
 actor uuid not null,transaction_id bigint not null,created_at timestamptz not null default clock_timestamp());
alter table arhittek_finance.receipt_corrections enable row level security;
revoke all on arhittek_finance.receipt_corrections from public,anon,authenticated;
drop trigger if exists receipt_correction_immutable on arhittek_finance.receipt_corrections;
create trigger receipt_correction_immutable before update or delete on arhittek_finance.receipt_corrections for each row execute function arhittek_finance.immutable();

do $patch$
declare def text; marker text:=$guard$
 -- receipt_timing_guard_v1
 if tg_table_name='ledger_entries' then
  if tg_op='UPDATE' and exists(select 1 from arhittek_finance.receipt_corrections c
    where c.source_id=new.id and c.transaction_id=txid_current()
      and c.after_value=to_jsonb(new) and c.before_value=to_jsonb(old)) then return new;end if;
  if tg_op='INSERT' and new.type in ('advance','final_payment','income','materials_budget','construction_budget')
    and (new.received_before_start or new.entry_date<(cfg.activated_at at time zone 'Europe/Moscow')::date) then
   if new.deleted_at is not null or new.amount<=0 or new.entry_date is null or new.entry_date>(clock_timestamp() at time zone 'Europe/Moscow')::date then
    raise sqlstate '22023' using message='Проверьте дату и сумму прежней оплаты';end if;
   perform arhittek_finance.money(new.amount);
   perform arhittek_finance.post(gen_random_uuid(),'historical_receipt','Ранее получено: '||coalesce(new.description,'оплата'),0,'{}',
    jsonb_build_object('historical_receipt',true,'date_unknown',new.received_before_start),'ledger_entries',new.id);
   return new;
  end if;
 end if;
$guard$;
begin
 def:=pg_get_functiondef('arhittek_finance.capture()'::regprocedure);
 if position('receipt_timing_guard_v1' in def)=0 then
  if position('perform arhittek_finance.actor();' in def)=0 then raise exception 'Unknown capture definition';end if;
  execute replace(def,'perform arhittek_finance.actor();','perform arhittek_finance.actor();'||marker);
 end if;
end $patch$;

create or replace function arhittek_finance.correct_receipt(p jsonb,op uuid,expected bigint) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare cfg arhittek_finance.settings; src public.ledger_entries; original arhittek_finance.operations;
 oldvalue jsonb; newvalue jsonb; req jsonb:=p; existing jsonb; dt date; prior boolean; was_prior boolean;
 ch jsonb:='{}'; k text; v numeric; factor int; am numeric; w uuid; headers jsonb; actor_id uuid;
begin
 actor_id:=arhittek_finance.actor();
 select * into cfg from arhittek_finance.settings where singleton for update;
 select request into existing from arhittek_finance.receipt_corrections where id=op;
 if found then
  if existing<>req then raise sqlstate '22023' using message='Повторная отправка содержит другие данные';end if;
  return public.get_financial_journal();
 end if;
 if op is null or not cfg.active or expected is distinct from cfg.revision then raise sqlstate '40001' using message='Финансы изменились. Обновите данные';end if;
 if length(trim(coalesce(p->>'reason','')))<3 then raise sqlstate '22023' using message='Укажите причину исправления';end if;
 select * into src from public.ledger_entries where id=(p->>'source')::uuid for update;
 if not found or src.deleted_at is not null or src.type not in ('advance','final_payment','income','materials_budget','construction_budget') then raise sqlstate '22023' using message='Выберите действующую оплату клиента';end if;
 select * into original from arhittek_finance.operations where source_table='ledger_entries' and source_id=src.id and kind in ('receipt','historical_receipt') order by revision limit 1;
 if not found or original.created_at<cfg.activated_at or exists(select 1 from arhittek_finance.operations where reverses=original.id)
 or exists(select 1 from arhittek_finance.settlements where source_id=src.id)
 or exists(select 1 from arhittek_finance.calendar_links where source_operation=original.id) then raise sqlstate '23514' using message='У оплаты есть связи с планом или она относится к закрытому учёту. Сначала проверьте связанные операции';end if;
 dt:=nullif(p->>'date','')::date;
 prior:=coalesce((p->>'before_start')::boolean,false);
 if prior then dt:=src.entry_date;elsif dt is null or dt>(clock_timestamp() at time zone 'Europe/Moscow')::date then raise sqlstate '22023' using message='Укажите фактическую дату, не в будущем';end if;
 was_prior:=src.received_before_start or src.entry_date<(cfg.activated_at at time zone 'Europe/Moscow')::date;
 prior:=prior or dt<(cfg.activated_at at time zone 'Europe/Moscow')::date;
 oldvalue:=to_jsonb(src);
 src.entry_date:=dt;src.received_before_start:=coalesce((p->>'before_start')::boolean,false);
 newvalue:=to_jsonb(src);
 if newvalue=oldvalue then raise sqlstate '22023' using message='Дата и способ учёта не изменились';end if;
 factor:=(case when prior then 0 else 1 end)-(case when was_prior then 0 else 1 end);
 if factor<>0 then
  if original.cash_delta<>0 then
   for k,v in select key,value::numeric from jsonb_each_text(original.changes) loop ch:=jsonb_set(ch,array[k],to_jsonb(v*factor));end loop;
  else
   am:=case when arhittek_finance.construction(src.project_id) then 0 else round(src.amount*0.05,2) end;
   k:=case when src.project_id is null then 'reserve' else 'project:'||src.project_id end;
   ch:=jsonb_build_object(k,(src.amount-am)*factor,'amortization',am*factor);
  end if;
 end if;
 insert into arhittek_finance.receipt_corrections values(op,src.id,req,oldvalue,newvalue,actor_id,txid_current(),clock_timestamp());
 update public.ledger_entries set entry_date=src.entry_date,received_before_start=src.received_before_start where id=src.id;
 select wallet_id into w from arhittek_finance.wallet_entries where operation_id=original.id limit 1;
 headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}');
 if w is not null then perform set_config('request.headers',(headers||jsonb_build_object('x-finance-wallet',w))::text,true);end if;
 perform arhittek_finance.post(op,'receipt_correction',p->>'reason',src.amount*factor,ch,
  jsonb_build_object('before',oldvalue,'after',newvalue,'source_operation',original.id));
 perform set_config('request.headers',headers::text,true);
 return public.get_financial_journal();
end $$;
revoke all on function arhittek_finance.correct_receipt(jsonb,uuid,bigint) from public,anon,authenticated;
-- Extend the existing idempotent workspace dispatch; preserve its other commands.
do $$ begin
 if to_regprocedure('arhittek_finance.workspace_before_receipt_timing(text,jsonb,uuid,bigint)') is null then
  alter function arhittek_finance.workspace_command(text,jsonb,uuid,bigint) rename to workspace_before_receipt_timing;
 end if;
 if to_regprocedure('arhittek_finance.command_before_receipt_timing(text,jsonb,uuid,bigint)') is null then
  alter function arhittek_finance.command(text,jsonb,uuid,bigint) rename to command_before_receipt_timing;
 end if;
end $$;
create or replace function arhittek_finance.workspace_command(cmd text,p jsonb,op uuid,expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if cmd='correct_receipt' then return arhittek_finance.correct_receipt(p,op,expected_revision);end if;
 return arhittek_finance.workspace_before_receipt_timing(cmd,p,op,expected_revision);
end $$;
create or replace function arhittek_finance.command(cmd text,p jsonb,op uuid,expected bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform arhittek_finance.actor();
 if cmd='reverse' and exists(select 1 from arhittek_finance.operations o where o.id=(p->>'operation')::uuid and
 (o.kind in ('receipt_correction','historical_receipt') or exists(select 1 from public.ledger_entries l where l.id=o.source_id and (l.received_before_start or l.entry_date<(select (activated_at at time zone 'Europe/Moscow')::date from arhittek_finance.settings where singleton))))) then
 raise sqlstate '23514' using message='Исправьте дату через корректировку оплаты. Старая оплата не является новым движением денег';end if;
 return arhittek_finance.command_before_receipt_timing(cmd,p,op,expected);
end $$;
revoke all on function arhittek_finance.workspace_before_receipt_timing(text,jsonb,uuid,bigint),arhittek_finance.command_before_receipt_timing(text,jsonb,uuid,bigint) from public,anon,authenticated;
revoke all on function arhittek_finance.workspace_command(text,jsonb,uuid,bigint),arhittek_finance.command(text,jsonb,uuid,bigint) from public;
grant execute on function arhittek_finance.workspace_command(text,jsonb,uuid,bigint),arhittek_finance.command(text,jsonb,uuid,bigint) to anon,authenticated;
create or replace function public.confirm_finance_workspace(p_command text,p_payload jsonb,p_operation uuid,p_revision bigint) returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.workspace_command(p_command,p_payload,p_operation,p_revision)$$;
create or replace function public.confirm_financial_operation(p_command text,p_payload jsonb,p_operation uuid,p_revision bigint) returns jsonb language sql security invoker set search_path='' as $$select arhittek_finance.command(p_command,p_payload,p_operation,p_revision)$$;
notify pgrst,'reload schema';
commit;
