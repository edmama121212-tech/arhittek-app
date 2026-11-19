-- Keep the existing command's actor, lock, revision and idempotency checks.
-- Validate against the locked version before shortening its effective period.
do $migration$
declare
  cmd regprocedure := 'arhittek_finance.workspace_command_before_zero_start(text,jsonb,uuid,bigint)'::regprocedure;
  def text := pg_get_functiondef(cmd);
  anchor text := '   update arhittek_finance.rules set end_month=(month_value-interval ''1 month'')::date';
  guard text := $guard$   if old_value->>'end_month' is not null then
    raise sqlstate '22023' using message='У этой версии уже задан последний месяц. Выберите новый действующий тариф.';
   end if;
   if exists (
    select 1 from (
     select plan_key from arhittek_finance.settlements
     union select plan_key from arhittek_finance.calendar_links
    ) k
    where split_part(k.plan_key,':',1)='rule'
      and split_part(k.plan_key,':',2)=old_value->>'id'
      and split_part(k.plan_key,':',3)>=to_char(month_value,'YYYY-MM')
      and arhittek_finance.plan_paid(k.plan_key)>0
   ) then
    raise sqlstate '22023' using message='В выбранном или последующем месяце уже учтена оплата. Выберите месяц после оплаченного периода.';
   end if;
$guard$;
begin
  if strpos(def,guard)>0 then return; end if;
  if strpos(def,anchor)=0 then raise exception 'Unexpected recurring payment command definition'; end if;
  execute replace(def,anchor,guard||anchor);
end
$migration$;
