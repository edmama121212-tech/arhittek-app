begin;
alter table public.projects add column if not exists completed_at timestamptz;
comment on column public.projects.completed_at is 'First actual completion; server-controlled payroll accrual date. end_date remains the planned delivery date.';
-- Recover actual completion from the existing status journal. Preserve the
-- historical month for legacy projects whose completion was never journalled.
update public.projects p set completed_at=coalesce(
 (select min(a.created_at) from public.audit_log a join public.statuses s
   on s.id::text=a.changes->'status_id'->>'new' and s.name='Завершён'
   where a.entity_type='project' and a.entity_id=p.id
     and a.changes->'status_id'->>'old' is distinct from a.changes->'status_id'->>'new'),
 p.end_date::timestamp at time zone 'Europe/Moscow',p.created_at)
where p.completed_at is null and exists(select 1 from public.statuses s where s.id=p.status_id and s.name='Завершён');
create or replace function arhittek_security.capture_project_completion()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin
 if tg_op='INSERT' then
  new.completed_at:=null;
 else
  new.completed_at:=old.completed_at;
 end if;
 if new.completed_at is null and exists(select 1 from public.statuses s where s.id=new.status_id and s.name='Завершён') then
  if tg_op='INSERT' then new.completed_at:=statement_timestamp();
  elsif new.status_id is distinct from old.status_id then new.completed_at:=statement_timestamp();
  end if;
 end if;
 return new;
end;
$$;
revoke all on function arhittek_security.capture_project_completion() from public,anon,authenticated;
create trigger arhittek_capture_project_completion before insert or update on public.projects
for each row execute function arhittek_security.capture_project_completion();
commit;
