begin;
-- Apply atomically AFTER the frontend employee RPC adapter is published.
-- Uses the application's existing x-session-token login; no employee/PIN,
-- project, ledger, invoice, salary or account balance is changed.
-- Prepared SQL, not a Supabase-CLI-generated migration filename.

create schema if not exists arhittek_security;
revoke all on schema arhittek_security from public;
grant usage on schema arhittek_security to anon, authenticated, service_role;

-- A private definer is necessary here: employee_sessions must never be readable
-- by the Data API role. Its sole input is the exact existing random session
-- token; active/deleted/expiry are checked again on every statement.
create or replace function arhittek_security.session_employee()
returns table(employee_id uuid, is_admin boolean)
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare v_headers jsonb; v_token text;
begin
  begin
    v_headers := nullif(current_setting('request.headers',true),'')::jsonb;
  exception when invalid_text_representation then
    return;
  end;
  v_token := v_headers->>'x-session-token';
  if v_token is null or length(v_token) < 32 or length(v_token) > 512 then return; end if;
  return query
  select e.id, coalesce(e.is_admin,false)
  from public.employee_sessions s
  join public.employees e on e.id=s.employee_id
  where s.token=v_token and s.expires_at>now()
    and e.deleted_at is null and coalesce(e.active,true)
  limit 1;
end;
$$;
revoke all on function arhittek_security.session_employee() from public;
grant execute on function arhittek_security.session_employee() to anon, authenticated, service_role;

create or replace function public.current_session_employee()
returns table(employee_id uuid,is_admin boolean)
language sql stable security invoker set search_path=pg_catalog,pg_temp
as $$ select * from arhittek_security.session_employee(); $$;
create or replace function public.has_session()
returns boolean language sql stable security invoker set search_path=pg_catalog,pg_temp
as $$ select exists(select 1 from arhittek_security.session_employee()); $$;
create or replace function public.has_admin_session()
returns boolean language sql stable security invoker set search_path=pg_catalog,pg_temp
as $$ select exists(select 1 from arhittek_security.session_employee() s where s.is_admin); $$;
revoke all on function public.current_session_employee(),public.has_session(),public.has_admin_session() from public;
grant execute on function public.current_session_employee(),public.has_session(),public.has_admin_session() to anon,authenticated,service_role;

-- Only id/name/active are intentionally public for the existing PIN picker.
create or replace function arhittek_security.employee_login_options()
returns table(id uuid,name text,active boolean)
language sql stable security definer set search_path=pg_catalog,pg_temp
as $$
  select e.id,e.name,coalesce(e.active,true) from public.employees e
  where e.deleted_at is null and coalesce(e.active,true)
  order by e.name,e.id;
$$;
create or replace function public.get_employee_login_options()
returns table(id uuid,name text,active boolean)
language sql stable security invoker set search_path=pg_catalog,pg_temp
as $$ select * from arhittek_security.employee_login_options(); $$;
revoke all on function arhittek_security.employee_login_options(),public.get_employee_login_options() from public;
grant execute on function arhittek_security.employee_login_options(),public.get_employee_login_options() to anon,authenticated,service_role;

create or replace function arhittek_security.employee_profiles()
returns table(id uuid,name text,role text,is_admin boolean,active boolean,
  can_edit_cards boolean,can_see_projects boolean,can_see_construction boolean,
  is_salaried boolean,fixed_salary numeric,deleted_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,pg_temp
as $$
declare v_actor record;
begin
  select * into v_actor from arhittek_security.session_employee();
  if v_actor.employee_id is null then raise insufficient_privilege using message='Valid employee session required'; end if;
  return query select e.id,e.name,e.role,e.is_admin,e.active,
    e.can_edit_cards,e.can_see_projects,e.can_see_construction,e.is_salaried,
    case when v_actor.is_admin or e.id=v_actor.employee_id then e.fixed_salary else null::numeric end,
    e.deleted_at,e.created_at
  from public.employees e where v_actor.is_admin or e.deleted_at is null
  order by e.name,e.id;
end;
$$;
create or replace function public.get_employee_profiles()
returns table(id uuid,name text,role text,is_admin boolean,active boolean,
  can_edit_cards boolean,can_see_projects boolean,can_see_construction boolean,
  is_salaried boolean,fixed_salary numeric,deleted_at timestamptz,created_at timestamptz)
language sql stable security invoker set search_path=pg_catalog,pg_temp
as $$ select * from arhittek_security.employee_profiles(); $$;
revoke all on function arhittek_security.employee_profiles(),public.get_employee_profiles() from public;
grant execute on function arhittek_security.employee_profiles(),public.get_employee_profiles() to anon,authenticated,service_role;

-- Session and login-attempt internals have no direct browser operation.
revoke all on public.employee_sessions,public.login_attempts from public,anon,authenticated;
alter table public.employee_sessions enable row level security;
alter table public.login_attempts enable row level security;

-- Table-level SELECT overrides column grants; revoke BOTH forms. Returning id
-- after administrator INSERT/UPDATE remains compatible with the frontend.
revoke select on public.employees from public,anon,authenticated;
do $$ declare v_col text; begin
  for v_col in select a.attname from pg_attribute a where a.attrelid='public.employees'::regclass and a.attnum>0 and not a.attisdropped loop
    execute format('revoke select (%I) on public.employees from public,anon,authenticated',v_col);
  end loop;
end $$;
grant select(id) on public.employees to anon,authenticated;
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select to anon,authenticated using ((select public.has_session()));

-- RLS does not apply to TRUNCATE. These privileges were granted by the old
-- schema defaults and are unnecessary for every application browser role.
do $$ declare r record; begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') loop
    execute format('revoke truncate,references,trigger,maintain on public.%I from public,anon,authenticated',r.relname);
  end loop;
end $$;

-- Company money and payroll writes belong to an administrator. A team member
-- may read only their own existing timesheet-payment marker.
drop policy if exists company_expenses_all on public.company_expenses;
drop policy if exists company_expenses_admin on public.company_expenses;
create policy company_expenses_admin on public.company_expenses for all to anon,authenticated
using ((select public.has_admin_session())) with check ((select public.has_admin_session()));
drop policy if exists company_income_delete on public.company_income;
drop policy if exists company_income_insert on public.company_income;
drop policy if exists company_income_select on public.company_income;
drop policy if exists company_income_update on public.company_income;
drop policy if exists company_income_admin on public.company_income;
create policy company_income_admin on public.company_income for all to anon,authenticated
using ((select public.has_admin_session())) with check ((select public.has_admin_session()));
drop policy if exists timesheet_payments_all on public.timesheet_payments;
drop policy if exists timesheet_payments_select on public.timesheet_payments;
drop policy if exists timesheet_payments_admin on public.timesheet_payments;
create policy timesheet_payments_select on public.timesheet_payments for select to anon,authenticated
using ((select public.has_admin_session()) or employee_id=(select s.employee_id from arhittek_security.session_employee() s));
create policy timesheet_payments_admin on public.timesheet_payments for all to anon,authenticated
using ((select public.has_admin_session())) with check ((select public.has_admin_session()));
drop policy if exists kp_catalog_all on public.kp_catalog;
drop policy if exists kp_catalog_select on public.kp_catalog;
drop policy if exists kp_catalog_admin on public.kp_catalog;
-- Public client briefs intentionally use the published service/price catalogue.
create policy kp_catalog_select on public.kp_catalog for select to anon,authenticated using (deleted_at is null or (select public.has_session()));
create policy kp_catalog_admin on public.kp_catalog for all to anon,authenticated
using ((select public.has_admin_session())) with check ((select public.has_admin_session()));

-- Existing non-admin catalogue editors retain their explicit permission.
create or replace function arhittek_security.can_edit_catalog()
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp
as $$ select exists(select 1 from arhittek_security.session_employee() s join public.employees e on e.id=s.employee_id
  where s.is_admin or coalesce(e.can_edit_cards,lower(btrim(e.name)) in ('мансур','ислам'))); $$;
revoke all on function arhittek_security.can_edit_catalog() from public;
grant execute on function arhittek_security.can_edit_catalog() to anon,authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['project_cards','share_links'] loop
    execute format('drop policy if exists %I on public.%I',t||'_insert',t);
    execute format('drop policy if exists %I on public.%I',t||'_update',t);
    execute format('drop policy if exists %I on public.%I',t||'_delete',t);
    execute format('create policy %I on public.%I for insert to anon,authenticated with check ((select arhittek_security.can_edit_catalog()))',t||'_insert',t);
    execute format('create policy %I on public.%I for update to anon,authenticated using ((select arhittek_security.can_edit_catalog())) with check ((select arhittek_security.can_edit_catalog()))',t||'_update',t);
    execute format('create policy %I on public.%I for delete to anon,authenticated using ((select arhittek_security.can_edit_catalog()))',t||'_delete',t);
  end loop;
end $$;

-- This private predicate avoids recursive policies between projects and
-- project_members while checking the existing section flags and assignment.
create or replace function arhittek_security.category_is_construction(p_category uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp
as $$ select exists(select 1 from public.categories c left join public.departments d on d.id=c.department_id
  where c.id=p_category and (d.name='Строительный отдел' or lower(c.name) like '%строительств%' or lower(c.name) like '%ремонт%' or lower(c.name) like '%монтаж%')); $$;
create or replace function arhittek_security.project_visible(p public.projects)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,pg_temp
as $$ declare v_actor record; v_emp record; v_construction boolean;
begin
  select * into v_actor from arhittek_security.session_employee();
  if v_actor.employee_id is null then return false; end if;
  if v_actor.is_admin then return true; end if;
  select * into v_emp from public.employees e where e.id=v_actor.employee_id;
  if p.id is null or p.deleted_at is not null then return false; end if;
  if v_actor.employee_id is distinct from p.employee_id and v_actor.employee_id is distinct from p.co_employee_id
     and not exists(select 1 from public.project_members m where m.project_id=p.id and m.employee_id=v_actor.employee_id) then return false; end if;
  v_construction:=arhittek_security.category_is_construction(p.category_id)
    or exists(select 1 from public.invoices i where i.project_id=p.id);
  if v_construction then
    return coalesce(v_emp.can_see_construction,lower(coalesce(v_emp.role,'')) ~ '(прораб|менеджер|manager)');
  end if;
  return coalesce(v_emp.can_see_projects,true);
end $$;
create or replace function arhittek_security.project_access(p_project uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp
as $$ select public.has_admin_session() or exists(select 1 from public.projects p where p.id=p_project and arhittek_security.project_visible(p)); $$;
create or replace function arhittek_security.construction_access(p_project uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp
as $$ select public.has_admin_session() or exists(select 1 from public.projects p where p.id=p_project
  and arhittek_security.project_visible(p)
  and (arhittek_security.category_is_construction(p.category_id) or exists(select 1 from public.invoices i where i.project_id=p.id))); $$;
revoke all on function arhittek_security.category_is_construction(uuid),arhittek_security.project_visible(public.projects),arhittek_security.project_access(uuid),arhittek_security.construction_access(uuid) from public;
grant execute on function arhittek_security.category_is_construction(uuid),arhittek_security.project_visible(public.projects),arhittek_security.project_access(uuid),arhittek_security.construction_access(uuid) to anon,authenticated,service_role;

-- Lead designers may create the same basic self-assigned card as the current
-- UI. They cannot set money, appoint colleagues, finish, archive or impersonate.
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
revoke all on function arhittek_security.project_basic_insert(public.projects) from public;
grant execute on function arhittek_security.project_basic_insert(public.projects) to anon,authenticated,service_role;

drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
create policy projects_select on public.projects for select to anon,authenticated using (arhittek_security.project_visible(projects));
create policy projects_insert on public.projects for insert to anon,authenticated with check (arhittek_security.project_basic_insert(projects));
create policy projects_update on public.projects for update to anon,authenticated using (arhittek_security.project_access(id)) with check (arhittek_security.project_access(id));
create policy projects_delete on public.projects for delete to anon,authenticated using ((select public.has_admin_session()));

-- Existing construction handlers submit derived caches after a saved invoice.
-- Preserve that compatibility, but ignore those cache values for staff; no
-- non-admin can alter financial/project conditions via a direct REST request.
create or replace function arhittek_security.protect_project_update()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp
as $$ begin
  if current_user not in ('anon','authenticated') or public.has_admin_session() then return new; end if;
  if not arhittek_security.project_access(old.id) then raise insufficient_privilege using message='Project access required'; end if;
  if (to_jsonb(new)-array['expenses','balance','updated_at']) is distinct from (to_jsonb(old)-array['expenses','balance','updated_at']) then
    raise insufficient_privilege using message='Project conditions require administrator';
  end if;
  new.expenses:=old.expenses; new.balance:=old.balance; new.updated_at:=now();
  return new;
end $$;
revoke all on function arhittek_security.protect_project_update() from public;
drop trigger if exists arhittek_protect_project_update on public.projects;
create trigger arhittek_protect_project_update before update on public.projects for each row execute function arhittek_security.protect_project_update();

-- Replace broad session policies on related records with the same project
-- assignment predicate. Staff cannot add themselves to someone else's project.
do $$ declare t text; pol record; v_access text; begin
  foreach t in array array['project_members','ledger_entries','invoices','expense_photos','project_stages','project_plans','tz_forms','kp_forms'] loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',pol.policyname,t);
    end loop;
    v_access:=case when t in ('invoices','expense_photos') then 'arhittek_security.construction_access(project_id)' else 'arhittek_security.project_access(project_id)' end;
    execute format('create policy %I on public.%I for select to anon,authenticated using (%s)',t||'_select',t,v_access);
    if t in ('project_members','ledger_entries') then
      execute format('create policy %I on public.%I for all to anon,authenticated using ((select public.has_admin_session())) with check ((select public.has_admin_session()))',t||'_admin',t);
    else
      execute format('create policy %I on public.%I for insert to anon,authenticated with check (%s)',t||'_insert',t,v_access);
      execute format('create policy %I on public.%I for update to anon,authenticated using (%s) with check (%s)',t||'_update',t,v_access,v_access);
      execute format('create policy %I on public.%I for delete to anon,authenticated using (%s)',t||'_delete',t,
        case when t='project_stages' then '(select public.has_admin_session())' else v_access end);
    end if;
  end loop;
end $$;

drop policy if exists project_stages_insert on public.project_stages;
create policy project_stages_insert on public.project_stages for insert to anon,authenticated with check (
  (select public.has_admin_session()) or
  (arhittek_security.project_access(project_id) and due_date is null and name=any(array[
    'Составление ТЗ','Разработка планировки','Экстерьер','Визуализация','Чертежи','Печать и отправка Альбома'
  ]))
);

-- stage toggles may not move a record into another assigned project or edit its
-- scheduling conditions. Name is included for legacy canonical-name upgrades.
create or replace function arhittek_security.protect_stage_update()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp
as $$ begin
  if current_user not in ('anon','authenticated') or public.has_admin_session() then return new; end if;
  if (to_jsonb(new)-array['done','done_at','name']) is distinct from (to_jsonb(old)-array['done','done_at','name']) then
    raise insufficient_privilege using message='Stage conditions require administrator';
  end if;
  if new.name is distinct from old.name and not (
    (old.name='Составить ТЗ' and new.name='Составление ТЗ') or
    (old.name='Планировка' and new.name='Разработка планировки') or
    (old.name in ('Распечатка и Отправка','Распечатка и отправка') and new.name='Печать и отправка Альбома')
  ) then raise insufficient_privilege using message='Stage names require administrator'; end if;
  return new;
end $$;
revoke all on function arhittek_security.protect_stage_update() from public;
drop trigger if exists arhittek_protect_stage_update on public.project_stages;
create trigger arhittek_protect_stage_update before update on public.project_stages for each row execute function arhittek_security.protect_stage_update();

drop policy if exists tz_references_select on public.tz_references;
drop policy if exists tz_references_insert on public.tz_references;
drop policy if exists tz_references_update on public.tz_references;
drop policy if exists tz_references_delete on public.tz_references;
drop policy if exists tz_references_scoped on public.tz_references;
create policy tz_references_scoped on public.tz_references for all to anon,authenticated
using (exists(select 1 from public.tz_forms f where f.id=tz_form_id and arhittek_security.project_access(f.project_id)))
with check (exists(select 1 from public.tz_forms f where f.id=tz_form_id and arhittek_security.project_access(f.project_id)));

-- Company-wide audit events are not a team-readable salary/reserve API.
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to anon,authenticated using ((select public.has_admin_session()));
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to anon,authenticated with check (
  (select public.has_admin_session()) or
  (entity_type='project' and entity_id is not null and arhittek_security.project_access(entity_id))
);

-- An employee controls only their own push device registrations.
drop policy if exists push_subscriptions_select on public.push_subscriptions;
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
drop policy if exists push_subscriptions_update on public.push_subscriptions;
drop policy if exists push_subscriptions_delete on public.push_subscriptions;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to anon,authenticated
using (employee_id=(select s.employee_id from arhittek_security.session_employee() s))
with check (employee_id=(select s.employee_id from arhittek_security.session_employee() s));

-- Remove legacy unauthenticated file writes. Public bucket reads are an
-- independent deployment step: first publish a staff signed-image adapter.
drop policy if exists "Allow delete tz-references" on storage.objects;
drop policy if exists "Allow uploads to tz-references" on storage.objects;

-- A public brief is an existing token-authorized flow, not an employee login.
-- The upgraded tz.html sends the same token in x-tz-token for file uploads.
create or replace function arhittek_security.tz_reference_access(p_name text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,pg_temp
as $$ declare v_headers jsonb; v_token text; begin
  begin v_headers:=nullif(current_setting('request.headers',true),'')::jsonb;
  exception when invalid_text_representation then return false; end;
  v_token:=v_headers->>'x-tz-token';
  if v_token is null or v_token='' or length(v_token)>512 then return false; end if;
  return exists(select 1 from public.tz_forms f where f.token=v_token
    and p_name like 'tz-refs/'||f.id::text||'/%'
    and length(p_name)>length('tz-refs/'||f.id::text||'/'));
end $$;
revoke all on function arhittek_security.tz_reference_access(text) from public;
grant execute on function arhittek_security.tz_reference_access(text) to anon,authenticated,service_role;
drop policy if exists tz_client_reference_upload on storage.objects;
drop policy if exists tz_client_reference_select on storage.objects;
create policy tz_client_reference_upload on storage.objects for insert to anon,authenticated
with check (bucket_id='tz-references' and arhittek_security.tz_reference_access(name));
create policy tz_client_reference_select on storage.objects for select to anon,authenticated
using (bucket_id='tz-references' and arhittek_security.tz_reference_access(name));

-- Object originals for client reports use a separate private bucket. Catalogue
-- renders under expense-photos/cards keep their existing public delivery.
create or replace function arhittek_security.storage_project_access(p_name text)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog,pg_temp
as $$ declare v_project text; begin
  v_project:=split_part(p_name,'/',1);
  if v_project !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return arhittek_security.construction_access(v_project::uuid);
end $$;
revoke all on function arhittek_security.storage_project_access(text) from public;
grant execute on function arhittek_security.storage_project_access(text) to anon,authenticated,service_role;
drop policy if exists construction_documents_select on storage.objects;
drop policy if exists construction_documents_insert on storage.objects;
drop policy if exists construction_documents_update on storage.objects;
drop policy if exists construction_documents_delete on storage.objects;
create policy construction_documents_select on storage.objects for select to anon,authenticated
using (bucket_id='construction-documents' and arhittek_security.storage_project_access(name));
create policy construction_documents_insert on storage.objects for insert to anon,authenticated
with check (bucket_id='construction-documents' and arhittek_security.storage_project_access(name));
create policy construction_documents_update on storage.objects for update to anon,authenticated
using (bucket_id='construction-documents' and arhittek_security.storage_project_access(name))
with check (bucket_id='construction-documents' and arhittek_security.storage_project_access(name));
create policy construction_documents_delete on storage.objects for delete to anon,authenticated
using (bucket_id='construction-documents' and arhittek_security.storage_project_access(name));

notify pgrst,'reload schema';

-- Owner and rank rules. Apply after session-security.sql in the same transaction.
-- Bootstrap the reviewed existing owner once; later renames and legacy flags do
-- not transfer ownership. No PINs, balances, salaries or payments are changed.

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