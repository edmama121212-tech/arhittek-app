-- The command already owns the settings lock and has checked permission, revision and replay.
do $migration$
declare
  cmd regprocedure := 'arhittek_finance.workspace_command_before_zero_start(text,jsonb,uuid,bigint)'::regprocedure;
  def text := pg_get_functiondef(cmd);
  anchor text := '  update arhittek_finance.rules set end_month=date_trunc(''month'',as_of)::date where id=id_value';
  guard text := $guard$  if (old_value->>'end_month')::date <= date_trunc('month',as_of)::date then
   raise sqlstate '22023' using message='Этот тариф уже завершён.';
  end if;
  if exists (
   select 1 from (
    select plan_key from arhittek_finance.settlements
    union select plan_key from arhittek_finance.calendar_links
   ) k
   where split_part(k.plan_key,':',1)='rule'
     and split_part(k.plan_key,':',2)=id_value::text
     and split_part(k.plan_key,':',3)>to_char(as_of,'YYYY-MM')
     and arhittek_finance.plan_paid(k.plan_key)>0
  ) then
   raise sqlstate '22023' using message='В будущих месяцах уже учтена оплата. Проверьте оплаты по этому договору в календаре.';
  end if;
$guard$;
begin
  if strpos(def,guard)>0 then return; end if;
  if strpos(def,anchor)=0 then raise exception 'Unexpected stop_rule command definition'; end if;
  execute replace(def,anchor,guard||anchor);
end
$migration$;
