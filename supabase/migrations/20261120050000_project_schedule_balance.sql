-- Debt and plans both shrink when a scheduled instalment is paid.
-- Subtract outstanding instalments only, using the same calculation for display and submission.
create or replace function arhittek_finance.project_schedule_balances(items jsonb)
returns table(project_id uuid, remaining numeric) language sql stable set search_path='' as $$
 select p.id,coalesce(p.price,0)-coalesce(p.advance,0)-coalesce(s.open_amount,0)
 from public.projects p
 left join (
   select x.project_id,sum(x.remaining) open_amount
   from jsonb_to_recordset(items) as x(project_id uuid,direction text,remaining numeric)
   where x.direction='income' and x.project_id is not null group by x.project_id
 ) s on s.project_id=p.id
 where p.deleted_at is null and coalesce(p.price,0)-coalesce(p.advance,0)>coalesce(s.open_amount,0)
$$;
revoke all on function arhittek_finance.project_schedule_balances(jsonb) from public,anon,authenticated;

do $migration$
declare
 fn regprocedure := 'arhittek_finance.workspace_before_zero_start()'::regprocedure;
 body text := pg_get_functiondef(fn);
 old_amount text := $old$'remaining',greatest(0,coalesce(p.price,0)-coalesce(p.advance,0))$old$;
 old_projects text := $old$from public.projects p where deleted_at is null and coalesce(p.price,0)>coalesce(p.advance,0) and not exists(select 1 from arhittek_finance.plans x where x.project_id=p.id and x.direction='income' and not x.canceled)$old$;
 guard text := $new$elsif cmd='plan' then
  if p->'terms'->>'project_schedule'='true' then
   select b.remaining into remaining from arhittek_finance.project_schedule_balances(arhittek_finance.workspace_items(as_of)) b where b.project_id=(p->>'project_id')::uuid;
   if remaining is null or arhittek_finance.money((p->>'amount')::numeric)>remaining or nullif(p->>'due_date','') is null or (p->>'direction') is distinct from 'income' then
    raise sqlstate '23514' using message='Обновите график: проверьте срок и остаток договора.';
   end if;
  end if;$new$;
begin
 if strpos(body,'arhittek_finance.project_schedule_balances(items)')=0 then
  if strpos(body,old_amount)=0 or strpos(body,old_projects)=0 then raise exception 'Unexpected project schedule query';end if;
  body:=replace(body,old_amount,$new$'remaining',gap.remaining$new$);
  execute replace(body,old_projects,'from arhittek_finance.project_schedule_balances(items) gap join public.projects p on p.id=gap.project_id');
 end if;
 fn:='arhittek_finance.workspace_command_before_zero_start(text,jsonb,uuid,bigint)'::regprocedure;
 body:=pg_get_functiondef(fn);
 if strpos(body,guard)=0 then
  if strpos(body,'elsif cmd=''plan'' then')=0 then raise exception 'Unexpected plan command';end if;
  execute replace(body,'elsif cmd=''plan'' then',guard);
 end if;
end
$migration$;
