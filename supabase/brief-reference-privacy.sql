begin;
-- Private reference originals: access is authorized for every download.
create or replace function arhittek_security.tz_staff_reference_access(p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare form_id text;
begin
 if public.has_admin_session() then return true;end if;
 if split_part(p_name,'/',1)<>'tz-refs' then return false;end if;
 form_id:=split_part(p_name,'/',2);
 if form_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or p_name like '%//%' or p_name ~ '/$' or p_name ~ '(^|/)[.][.]?(/|$)' or position(chr(92) in p_name)>0 then return false;end if;
 return exists(select 1 from public.tz_forms f where f.id=form_id::uuid and arhittek_security.project_access(f.project_id));
end $$;
revoke all on function arhittek_security.tz_staff_reference_access(text) from public;
grant execute on function arhittek_security.tz_staff_reference_access(text) to anon,authenticated,service_role;

create or replace function arhittek_security.tz_reference_access(p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare h jsonb; t text; form_id text;
begin
 begin h:=nullif(current_setting('request.headers',true),'')::jsonb;exception when invalid_text_representation then return false;end;
 t:=h->>'x-tz-token';
 if t is null or t='' or length(t)>512 or split_part(p_name,'/',1)<>'tz-refs'
 or p_name like '%//%' or p_name ~ '/$' or p_name ~ '(^|/)[.][.]?(/|$)' or position(chr(92) in p_name)>0 then return false;end if;
 form_id:=split_part(p_name,'/',2);
 if form_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or length(p_name)<=length('tz-refs/'||form_id||'/') then return false;end if;
 return exists(select 1 from public.tz_forms f where f.id=form_id::uuid and f.token=t
  and (f.project_id is null or exists(select 1 from public.projects p where p.id=f.project_id and p.deleted_at is null)));
end $$;
revoke all on function arhittek_security.tz_reference_access(text) from public;
grant execute on function arhittek_security.tz_reference_access(text) to anon,authenticated,service_role;

drop policy if exists "session read tz-references" on storage.objects;
drop policy if exists "session delete tz-references" on storage.objects;
drop policy if exists tz_staff_reference_select on storage.objects;
drop policy if exists tz_staff_reference_delete on storage.objects;
drop policy if exists tz_staff_reference_insert on storage.objects;
create policy tz_staff_reference_select on storage.objects for select to anon,authenticated
 using(bucket_id='tz-references' and arhittek_security.tz_staff_reference_access(name));
create policy tz_staff_reference_delete on storage.objects for delete to anon,authenticated
 using(bucket_id='tz-references' and arhittek_security.tz_staff_reference_access(name));
create policy tz_staff_reference_insert on storage.objects for insert to anon,authenticated
 with check(bucket_id='tz-references' and arhittek_security.tz_staff_reference_access(name));
update storage.buckets set public=false where id='tz-references';
notify pgrst,'reload schema';
commit;
