-- Owner and rank rules. Apply after session-security.sql in the same transaction.
-- Bootstrap the reviewed existing owner once; later renames and legacy flags do
-- not transfer ownership. No PINs, balances, salaries or payments are changed.
begin;
create table if not exists arhittek_security.app_owner (
  singleton boolean primary key default true check (singleton),
  employee_id uuid not null unique references public.employees(id) on delete restrict
);
revoke all on arhittek_security.app_owner from public,anon,authenticated;
alter table arhittek_security.app_owner enable row level security;
do $$ begin
  if not exists(select 1 from arhittek_security.app_owner) then
    if (select count(*) from public.employees where lower(btrim(name))='мансур'
      and is_admin is true and deleted_at is null and coalesce(active,true))<>1 then
      raise exception 'Exactly one reviewed active Mansur owner is required';
    end if;
    insert into arhittek_security.app_owner(singleton,employee_id)
      select true,id from public.employees where lower(btrim(name))='мансур'
      and is_admin is true and deleted_at is null and coalesce(active,true);
  end if;
end $$;

create or replace function arhittek_security.session_employee()
returns table(employee_id uuid,is_admin boolean)
language plpgsql stable security definer set search_path=pg_catalog,pg_temp
as $$ declare v_headers jsonb; v_token text; begin
  begin v_headers:=nullif(current_setting('request.headers',true),'')::jsonb;
  exception when invalid_text_representation then return; end;
  v_token:=v_headers->>'x-session-token';
  if v_token is null or length(v_token)<32 or length(v_token)>512 then return; end if;
  return query select e.id,exists(select 1 from arhittek_security.app_owner o where o.employee_id=e.id)
  from public.employee_sessions s join public.employees e on e.id=s.employee_id
  where s.token=v_token and s.expires_at>now() and e.deleted_at is null and coalesce(e.active,true)
  limit 1;
end $$;

create or replace function arhittek_security.can_use_documents()
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp
as $$ select exists(select 1 from arhittek_security.session_employee() s
  join public.employees e on e.id=s.employee_id
  where s.is_admin or lower(btrim(coalesce(e.role,''))) in ('ведущий архитектор','ведущий дизайнер')); $$;
revoke all on function arhittek_security.can_use_documents() from public;
grant execute on function arhittek_security.can_use_documents() to anon,authenticated,service_role;

create or replace function arhittek_security.employee_access()
returns table(employee_id uuid,name text,role text,is_owner boolean,can_documents boolean,access_policy text)
language sql stable security definer set search_path=pg_catalog,pg_temp
as $$ select e.id,e.name,e.role,s.is_admin,arhittek_security.can_use_documents(),'owner-only-v1'::text
  from arhittek_security.session_employee() s join public.employees e on e.id=s.employee_id; $$;
create or replace function public.get_employee_access()
returns table(employee_id uuid,name text,role text,is_owner boolean,can_documents boolean,access_policy text)
language sql stable security invoker set search_path=pg_catalog,pg_temp
as $$ select * from arhittek_security.employee_access(); $$;
revoke all on function arhittek_security.employee_access(),public.get_employee_access() from public;
grant execute on function arhittek_security.employee_access(),public.get_employee_access() to anon,authenticated,service_role;

create or replace function arhittek_security.employee_profiles()
returns table(id uuid,name text,role text,is_admin boolean,active boolean,
  can_edit_cards boolean,can_see_projects boolean,can_see_construction boolean,
  is_salaried boolean,fixed_salary numeric,deleted_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,pg_temp
as $$ declare v_actor record; begin
  select * into v_actor from arhittek_security.session_employee();
  if v_actor.employee_id is null then raise insufficient_privilege using message='Valid employee session required'; end if;
  return query select e.id,e.name,e.role,
    exists(select 1 from arhittek_security.app_owner o where o.employee_id=e.id),e.active,
    case when v_actor.is_admin then e.can_edit_cards else false end,e.can_see_projects,e.can_see_construction,
    case when v_actor.is_admin then e.is_salaried else null::boolean end,
    case when v_actor.is_admin then e.fixed_salary else null::numeric end,e.deleted_at,e.created_at
  from public.employees e where v_actor.is_admin or e.deleted_at is null order by e.name,e.id;
end $$;
create or replace function arhittek_security.can_edit_catalog()
returns boolean language sql stable security invoker set search_path=pg_catalog,pg_temp
as $$ select public.has_admin_session(); $$;

-- Remove every older permissive policy: policies are OR-combined by default.
do $$ declare t text; p record; begin
  foreach t in array array['company_expenses','company_income','timesheet_payments','ledger_entries','audit_log'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy %I on public.%I for all to anon,authenticated using ((select public.has_admin_session())) with check ((select public.has_admin_session()))',t||'_owner_only',t);
  end loop;
end $$;
-- Staff may log only their own project action. Company/payroll history stays private.
create policy audit_project_action on public.audit_log for insert to anon,authenticated
with check (entity_type='project' and entity_id is not null and arhittek_security.project_access(entity_id));

create or replace function arhittek_security.current_employee_id()
returns uuid language sql stable security invoker set search_path=pg_catalog,pg_temp
as $$ select employee_id from arhittek_security.session_employee(); $$;
revoke all on function arhittek_security.current_employee_id() from public;
grant execute on function arhittek_security.current_employee_id() to anon,authenticated,service_role;
alter table public.kp_forms add column if not exists created_by uuid references public.employees(id);
alter table public.kp_forms alter column created_by set default arhittek_security.current_employee_id();

do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='kp_forms' loop
    execute format('drop policy %I on public.kp_forms',p.policyname);
  end loop;
end $$;
create policy kp_forms_rank_scope on public.kp_forms for all to anon,authenticated
using ((select public.has_admin_session()) or ((select arhittek_security.can_use_documents()) and
  ((project_id is not null and arhittek_security.project_access(project_id)) or
   (project_id is null and created_by=(select arhittek_security.current_employee_id())))))
with check ((select public.has_admin_session()) or ((select arhittek_security.can_use_documents()) and
  ((project_id is not null and arhittek_security.project_access(project_id)) or
   (project_id is null and created_by=(select arhittek_security.current_employee_id())))));

create or replace function arhittek_security.protect_kp_author()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp
as $$ begin
  if current_user not in ('anon','authenticated') or public.has_admin_session() then return new; end if;
  if tg_op='INSERT' then new.created_by:=arhittek_security.current_employee_id();
  elsif new.created_by is distinct from old.created_by then
    raise insufficient_privilege using message='Proposal author cannot be changed';
  end if;
  return new;
end $$;
revoke all on function arhittek_security.protect_kp_author() from public;
drop trigger if exists arhittek_kp_author on public.kp_forms;
create trigger arhittek_kp_author before insert or update on public.kp_forms
for each row execute function arhittek_security.protect_kp_author();

-- Leads can save contract details for an assigned project, never money or team.
create or replace function arhittek_security.protect_project_update()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp
as $$ declare v_allowed text[]:=array['expenses','balance','updated_at']; begin
  if current_user not in ('anon','authenticated') or public.has_admin_session() then return new; end if;
  if not arhittek_security.project_access(old.id) then raise insufficient_privilege using message='Project access required'; end if;
  if arhittek_security.can_use_documents() then v_allowed:=v_allowed||array[
    'contract_client_name','contract_passport','contract_birthdate','contract_passport_issuer',
    'contract_passport_date','contract_address','contract_scope','contract_advance_pct','contract_number']; end if;
  if (to_jsonb(new)-v_allowed) is distinct from (to_jsonb(old)-v_allowed) then
    raise insufficient_privilege using message='Project conditions require owner';
  end if;
  new.expenses:=old.expenses;new.balance:=old.balance;new.updated_at:=now();return new;
end $$;

-- A role/name change cannot transfer the private owner record or lock it out.
create or replace function arhittek_security.protect_app_owner()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp
as $$ begin
  if exists(select 1 from arhittek_security.app_owner o where o.employee_id=old.id) and
    (tg_op='DELETE' or new.id is distinct from old.id or new.deleted_at is not null or new.active is false) then
    raise insufficient_privilege using message='The application owner cannot be archived or deleted';
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function arhittek_security.protect_app_owner() from public;
drop trigger if exists arhittek_owner_protection on public.employees;
create trigger arhittek_owner_protection before update or delete on public.employees
for each row execute function arhittek_security.protect_app_owner();
notify pgrst,'reload schema';
commit;
