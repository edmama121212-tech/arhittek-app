begin;
set local lock_timeout = '5s';
-- Existing names stay intact. Only newly created cards acquire a fixed identity.
alter table public.projects add column if not exists number_series text;
alter table public.projects add column if not exists number_year integer;
alter table public.projects add column if not exists number_sequence integer;
alter table public.projects add column if not exists project_title text;
create unique index if not exists projects_number_identity on public.projects(number_series,number_year,number_sequence) where number_series is not null;
create table if not exists arhittek_security.project_number_counters(
 series text not null check(series in ('architecture','interior','landscape')),
 year integer not null check(year between 2000 and 2099),
 last_sequence integer not null check(last_sequence between 0 and 999999),
 primary key(series,year)
);
alter table arhittek_security.project_number_counters enable row level security;
revoke all on arhittek_security.project_number_counters from public,anon,authenticated;

create or replace function arhittek_security.project_number_series(p_category uuid)
returns text language sql stable security definer set search_path='' as $$
 select case when lower(c.name) like '%ландшафт%' then 'landscape'
 when lower(c.name) like '%интерьер%' then 'interior'
 when lower(c.name) like '%архитект%' then 'architecture' end
 from public.categories c where c.id=p_category;
$$;
create or replace function arhittek_security.project_number_prefix(p_series text,p_sequence integer,p_year integer)
returns text language sql immutable set search_path='' as $$
 select 'Проект '||case p_series when 'interior' then 'ДИ ' when 'landscape' then 'ЛД ' else '' end||'№'||p_sequence::text||right(p_year::text,2);
$$;
-- Parse only a project label at the beginning; never treat an address/area as a number.
create or replace function arhittek_security.legacy_project_number(p_name text)
returns text language sql immutable set search_path='' as $$
 select (regexp_match(p_name,'^\s*(?:проект\s*(?:(?:АР|АПР|ДИ|ЛД|ПР)\s*)*№?\s*|№\s*)([0-9]{3,8})(?:[^0-9]|$)','i'))[1];
$$;
create or replace function arhittek_security.project_number_highwater(p_series text,p_year integer)
returns integer language sql stable security definer set search_path='' as $$
 select greatest(
 coalesce((select max(c.last_sequence) from arhittek_security.project_number_counters c where c.series=p_series),0),
 coalesce((select max(left(n,length(n)-2)::integer) from (
 select arhittek_security.legacy_project_number(p.name) n from public.projects p
 where arhittek_security.project_number_series(p.category_id)=p_series) q
 where 2000+right(n,2)::integer<=p_year and length(n)>2),0));
$$;
create or replace function arhittek_security.assign_project_number()
returns trigger language plpgsql security definer set search_path='' as $$
declare s text; y integer; n integer; title text; prefix text;
begin
 if tg_op='UPDATE' then
  if new.number_series is distinct from old.number_series or new.number_year is distinct from old.number_year or new.number_sequence is distinct from old.number_sequence then
   raise exception 'Номер проекта нельзя изменять' using errcode='23514';
  end if;
  if old.number_series is null then
   if new.project_title is not null then raise exception 'У старой карточки нет отдельного номера' using errcode='23514';end if;
   return new;
  end if;
  if new.category_id is distinct from old.category_id
     and arhittek_security.project_number_series(new.category_id) is distinct from old.number_series then
   raise exception 'Направление закреплено за номером проекта' using errcode='23514';
  end if;
  prefix:=arhittek_security.project_number_prefix(old.number_series,old.number_sequence,old.number_year);
  if left(new.name,length(prefix)+1) is distinct from prefix||' ' then raise exception 'Номер проекта нельзя изменять' using errcode='23514';end if;
  title:=btrim(substr(new.name,length(prefix)+2));
  if coalesce(title,'')='' then raise exception 'Введите название проекта' using errcode='23514';end if;
  new.project_title:=title;new.name:=prefix||' '||title;
  return new;
 end if;
 s:=arhittek_security.project_number_series(new.category_id);
 -- Never trust caller-supplied identity, including requests from old application versions.
 new.number_series:=null;new.number_year:=null;new.number_sequence:=null;new.project_title:=null;
 if s is null then return new;end if;
 y:=extract(year from statement_timestamp() at time zone 'Europe/Moscow')::integer;
 title:=btrim(regexp_replace(new.name,'^\s*(?:проект\s*(?:(?:АР|АПР|ДИ|ЛД|ПР)\s*)*№?\s*|№\s*)[0-9]{3,8}(?![0-9])\s*','', 'i'));
 if coalesce(title,'')='' then raise exception 'Введите название проекта' using errcode='23514';end if;
 -- Serialize allocations across the year boundary, then read the committed high-water mark.
 perform pg_advisory_xact_lock(hashtextextended('arhittek.project-numbering',0));
 insert into arhittek_security.project_number_counters as c(series,year,last_sequence)
 values(s,y,arhittek_security.project_number_highwater(s,y)+1)
 on conflict(series,year) do update set last_sequence=greatest(c.last_sequence+1,excluded.last_sequence)
 returning last_sequence into n;
 new.number_series:=s;new.number_year:=y;new.number_sequence:=n;new.project_title:=title;
 new.name:=arhittek_security.project_number_prefix(s,n,y)||' '||title;
 return new;
end $$;
revoke all on function arhittek_security.assign_project_number() from public,anon,authenticated;
create or replace trigger arhittek_assign_project_number before insert or update on public.projects for each row execute function arhittek_security.assign_project_number();

create or replace function arhittek_security.get_next_project_numbers()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a record; y integer:=extract(year from statement_timestamp() at time zone 'Europe/Moscow')::integer;
begin
 select * into a from arhittek_security.session_employee();
 if a.employee_id is null or not(a.is_admin or exists(select 1 from public.employees e where e.id=a.employee_id and coalesce(e.can_see_projects,true) and lower(btrim(e.role)) in ('ведущий архитектор','ведущий дизайнер'))) then
  raise insufficient_privilege using message='Создание проектов недоступно';
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('category_id',c.id,'series',s.series,'year',y,'sequence',n.seq,'prefix',arhittek_security.project_number_prefix(s.series,n.seq,y)) order by s.series),'[]'::jsonb)
 from public.categories c
 cross join lateral (select arhittek_security.project_number_series(c.id) series)s
 cross join lateral (select arhittek_security.project_number_highwater(s.series,y)+1 seq)n
 where c.deleted_at is null and s.series is not null);
end $$;
revoke all on function arhittek_security.get_next_project_numbers() from public;
grant execute on function arhittek_security.get_next_project_numbers() to anon,authenticated;

create or replace function public.get_next_project_numbers()
returns jsonb language sql stable security invoker set search_path='' as $$
 select arhittek_security.get_next_project_numbers();
$$;
revoke all on function public.get_next_project_numbers() from public;
grant execute on function public.get_next_project_numbers() to anon,authenticated;
revoke all on function arhittek_security.project_number_series(uuid),arhittek_security.project_number_prefix(text,integer,integer),arhittek_security.legacy_project_number(text),arhittek_security.project_number_highwater(text,integer) from public,anon,authenticated;
-- Retain a high-water mark even if all old cards are later removed.
insert into arhittek_security.project_number_counters(series,year,last_sequence)
select s,2000+right(n,2)::integer,max(left(n,length(n)-2)::integer) from (
 select arhittek_security.project_number_series(p.category_id) s,arhittek_security.legacy_project_number(p.name)n from public.projects p) q
where s is not null and n is not null and left(n,length(n)-2)::integer>0
group by s,2000+right(n,2)::integer
on conflict(series,year) do update set last_sequence=greatest(arhittek_security.project_number_counters.last_sequence,excluded.last_sequence);
notify pgrst,'reload schema';
commit;
