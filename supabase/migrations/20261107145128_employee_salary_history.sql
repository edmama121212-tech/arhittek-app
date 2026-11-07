begin;
set local lock_timeout='5s';
lock table public.employees in share row exclusive mode;

-- Private, append-only snapshots. Deliberately no employee FK: removing a card
-- must not remove the company's historical payroll or the employee's name.
create table arhittek_security.payroll_roster (
 employee_id uuid primary key,name text not null,role text,created_at timestamptz,
 active boolean not null,is_salaried boolean not null,fixed_salary numeric not null,
 deleted_at timestamptz,check(fixed_salary>=0)
);
create table arhittek_security.employee_salary_versions (
 version_id bigint generated always as identity primary key,
 employee_id uuid not null,effective_from date not null,changed_at timestamptz not null,
 is_salaried boolean not null,fixed_salary numeric not null check(fixed_salary>=0),
 active boolean not null,deleted boolean not null,
 source text not null check(source in ('legacy_baseline','audit','server')),
 uncertain boolean not null
);
create index employee_salary_versions_employee_date on arhittek_security.employee_salary_versions(employee_id,effective_from,changed_at,version_id);
revoke all on arhittek_security.payroll_roster,arhittek_security.employee_salary_versions from public,anon,authenticated,service_role;
revoke all on sequence arhittek_security.employee_salary_versions_version_id_seq from public,anon,authenticated,service_role;
alter table arhittek_security.payroll_roster enable row level security;
alter table arhittek_security.employee_salary_versions enable row level security;

create function arhittek_security.protect_employee_salary_history()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp
as $$ begin
 raise exception using errcode='55000',message='Salary history versions are immutable';
end $$;
revoke all on function arhittek_security.protect_employee_salary_history() from public,anon,authenticated,service_role;
create trigger arhittek_immutable_employee_salary_history before update or delete on arhittek_security.employee_salary_versions
 for each row execute function arhittek_security.protect_employee_salary_history();

insert into arhittek_security.payroll_roster
 select id,name,role,created_at,coalesce(active,true),coalesce(is_salaried,false),greatest(0,coalesce(fixed_salary,0)),deleted_at from public.employees;

-- Audit is the only evidence available for pre-install changes. Rewind complete
-- old/new values, never turn malformed/missing values into zero. The initial
-- baseline remains explicitly uncertain: older unjournalled changes cannot be
-- invented. Every future change is captured atomically by the server trigger.
do $$ declare e record;a record;v_salary numeric;v_salaried boolean;v_active boolean;
 v_deleted boolean;v_uncertain boolean;v_old jsonb;v_new jsonb;k text;v_valid boolean;
 v_events jsonb;v_event jsonb;v_install_at timestamptz:=clock_timestamp();
begin
 for e in select * from public.employees loop
  v_salary:=greatest(0,coalesce(e.fixed_salary,0));v_salaried:=coalesce(e.is_salaried,false);
  v_active:=coalesce(e.active,true);v_deleted:=e.deleted_at is not null;v_uncertain:=false;v_events:='[]'::jsonb;
  if v_deleted and not exists(select 1 from public.audit_log where entity_type='employee' and entity_id=e.id and action in ('delete','restore')) then
   v_events:=jsonb_build_array(jsonb_build_object('changed_at',e.deleted_at,'is_salaried',v_salaried,'fixed_salary',v_salary,'active',v_active,'deleted',true,'uncertain',true));
   v_deleted:=false;
  end if;
  for a in select id,action,changes,created_at from public.audit_log
    where entity_type='employee' and entity_id=e.id and (changes ?| array['fixed_salary','is_salaried','active'] or action in ('delete','restore'))
    order by created_at desc,id desc loop
   v_valid:=true;
   if a.action='delete' and not v_deleted or a.action='restore' and v_deleted then v_valid:=false;end if;
   foreach k in array array['fixed_salary','is_salaried','active'] loop
    if a.changes ? k then
     v_old:=a.changes->k->'old';v_new:=a.changes->k->'new';
     if k='fixed_salary' then
      if jsonb_typeof(v_old) is distinct from 'number' or jsonb_typeof(v_new) is distinct from 'number' then v_valid:=false;
      elsif (v_old::text)::numeric<0 or (v_new::text)::numeric<0 or (v_new::text)::numeric<>v_salary then v_valid:=false;end if;
     elsif jsonb_typeof(v_old) is distinct from 'boolean' or jsonb_typeof(v_new) is distinct from 'boolean' then v_valid:=false;
     elsif k='is_salaried' and (v_new::text)::boolean is distinct from v_salaried then v_valid:=false;
     elsif k='active' and (v_new::text)::boolean is distinct from v_active then v_valid:=false;end if;
    end if;
   end loop;
   if not v_valid then
    -- Stop at an inconsistent chain; do not guess terms across its gap.
    v_uncertain:=true;exit;
   end if;
   -- Build the complete chain first, then insert oldest first. Identity IDs
   -- consequently preserve the recovered order even for equal audit timestamps.
   v_events:=jsonb_build_array(jsonb_build_object('changed_at',a.created_at,'is_salaried',v_salaried,'fixed_salary',v_salary,'active',v_active,'deleted',v_deleted,'uncertain',v_uncertain))||v_events;
   if a.action='delete' then v_deleted:=false;elsif a.action='restore' then v_deleted:=true;end if;
   if a.changes ? 'fixed_salary' then v_salary:=(a.changes->'fixed_salary'->>'old')::numeric;end if;
   if a.changes ? 'is_salaried' then v_salaried:=(a.changes->'is_salaried'->>'old')::boolean;end if;
   if a.changes ? 'active' then v_active:=(a.changes->'active'->>'old')::boolean;end if;
  end loop;
  insert into arhittek_security.employee_salary_versions(employee_id,effective_from,changed_at,is_salaried,fixed_salary,active,deleted,source,uncertain)
   values(e.id,(coalesce(e.created_at,statement_timestamp()) at time zone 'Europe/Moscow')::date,
    coalesce(e.created_at,statement_timestamp()),v_salaried,v_salary,v_active,v_deleted,'legacy_baseline',true);
  for v_event in select value from jsonb_array_elements(v_events) loop
   insert into arhittek_security.employee_salary_versions(employee_id,effective_from,changed_at,is_salaried,fixed_salary,active,deleted,source,uncertain)
    values(e.id,((v_event->>'changed_at')::timestamptz at time zone 'Europe/Moscow')::date,(v_event->>'changed_at')::timestamptz,
     (v_event->>'is_salaried')::boolean,(v_event->>'fixed_salary')::numeric,(v_event->>'active')::boolean,(v_event->>'deleted')::boolean,'audit',(v_event->>'uncertain')::boolean);
  end loop;
  -- The locked current card is authoritative from installation onward. Only
  -- the prefix before this server checkpoint depends on incomplete old audit.
  insert into arhittek_security.employee_salary_versions(employee_id,effective_from,changed_at,is_salaried,fixed_salary,active,deleted,source,uncertain)
   values(e.id,(v_install_at at time zone 'Europe/Moscow')::date,v_install_at,coalesce(e.is_salaried,false),
    greatest(0,coalesce(e.fixed_salary,0)),coalesce(e.active,true),e.deleted_at is not null,'server',false);
 end loop;
end $$;

create function arhittek_security.capture_employee_salary()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp
as $$ declare v public.employees%rowtype;t timestamptz:=clock_timestamp();begin
 if tg_op='DELETE' then v:=old;v.deleted_at:=t;else v:=new;end if;
 insert into arhittek_security.payroll_roster(employee_id,name,role,created_at,active,is_salaried,fixed_salary,deleted_at)
  values(v.id,v.name,v.role,v.created_at,coalesce(v.active,true),coalesce(v.is_salaried,false),greatest(0,coalesce(v.fixed_salary,0)),v.deleted_at)
  on conflict(employee_id) do update set name=excluded.name,role=excluded.role,created_at=excluded.created_at,
   active=excluded.active,is_salaried=excluded.is_salaried,fixed_salary=excluded.fixed_salary,deleted_at=excluded.deleted_at;
 if tg_op in ('INSERT','DELETE') or new.fixed_salary is distinct from old.fixed_salary
   or new.is_salaried is distinct from old.is_salaried or new.active is distinct from old.active
   or new.deleted_at is distinct from old.deleted_at then
  insert into arhittek_security.employee_salary_versions(employee_id,effective_from,changed_at,is_salaried,fixed_salary,active,deleted,source,uncertain)
   values(v.id,(t at time zone 'Europe/Moscow')::date,t,coalesce(v.is_salaried,false),greatest(0,coalesce(v.fixed_salary,0)),coalesce(v.active,true),v.deleted_at is not null,'server',false);
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function arhittek_security.capture_employee_salary() from public,anon,authenticated,service_role;
create trigger arhittek_capture_employee_salary after insert or update or delete on public.employees
 for each row execute function arhittek_security.capture_employee_salary();

create function arhittek_security.employee_salary_history()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,pg_temp
as $$ declare actor record;result jsonb;begin
 select * into actor from arhittek_security.session_employee();
 if actor.employee_id is null or actor.is_admin is not true then
  raise insufficient_privilege using message='Owner session required for salary history';end if;
 select jsonb_build_object('version',1,'history_policy','effective-salary-v1','employees',coalesce(jsonb_agg(
  jsonb_build_object('id',r.employee_id,'name',r.name,'role',r.role,'created_at',r.created_at,
   'active',r.active,'is_salaried',r.is_salaried,'fixed_salary',r.fixed_salary,'deleted_at',r.deleted_at,
   'versions',(select coalesce(jsonb_agg(jsonb_build_object('id',h.version_id::text,'effective_from',h.effective_from,
    'changed_at',h.changed_at,'is_salaried',h.is_salaried,'fixed_salary',h.fixed_salary,'active',h.active,
    'deleted',h.deleted,'source',h.source,'uncertain',h.uncertain)
    order by h.effective_from,h.changed_at,h.version_id),'[]'::jsonb)
    from arhittek_security.employee_salary_versions h where h.employee_id=r.employee_id)) order by r.name,r.employee_id),'[]'::jsonb))
 into result from arhittek_security.payroll_roster r;
 return result;
end $$;
create function public.get_employee_salary_history()
returns jsonb language sql stable security invoker set search_path=pg_catalog,pg_temp
as $$ select arhittek_security.employee_salary_history(); $$;
revoke all on function arhittek_security.employee_salary_history(),public.get_employee_salary_history() from public;
grant execute on function arhittek_security.employee_salary_history(),public.get_employee_salary_history() to anon,authenticated,service_role;
comment on function public.get_employee_salary_history() is 'Owner only. Daily Moscow salary/status versions; latest change on each day wins. legacy_baseline is explicitly uncertain before reliable audit coverage.';
notify pgrst, 'reload schema';
commit;
