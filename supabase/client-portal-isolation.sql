begin;
-- A grant's identity never changes. Issue a new grant instead.
create or replace function arhittek_client_private.lock_grant_identity() returns trigger
language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['revoked_at','window_started_at','window_requests']) is distinct from
    (to_jsonb(old)-array['revoked_at','window_started_at','window_requests'])
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
  raise sqlstate '23514' using message='Client grant identity is immutable; issue a new link';
 end if;
 return new;
end $$;
revoke all on function arhittek_client_private.lock_grant_identity() from public,anon,authenticated;
drop trigger if exists client_grant_identity on arhittek_client_private.grants;
create trigger client_grant_identity before update on arhittek_client_private.grants for each row execute function arhittek_client_private.lock_grant_identity();

create or replace function arhittek_client_private.revoke_reassigned_project() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (old.client_name,old.phone,old.category_id,old.deleted_at) is distinct from
    (new.client_name,new.phone,new.category_id,new.deleted_at) then
  update arhittek_client_private.grants set revoked_at=coalesce(revoked_at,clock_timestamp()) where project_id=old.id;
  update arhittek_client_private.project_settings set published=false,revision=revision+1,updated_at=clock_timestamp() where project_id=old.id;
 end if;
 return new;
end $$;
revoke all on function arhittek_client_private.revoke_reassigned_project() from public,anon,authenticated;
drop trigger if exists client_project_reassigned on public.projects;
create trigger client_project_reassigned after update of client_name,phone,category_id,deleted_at on public.projects
 for each row execute function arhittek_client_private.revoke_reassigned_project();
-- Recheck the construction category on every read, independently of publication.
do $patch$
declare def text; old_join text:='join public.projects p on p.id=gr.project_id and p.deleted_at is null';
 new_join text:='join public.projects p on p.id=gr.project_id and p.deleted_at is null
    join public.categories cat on cat.id=p.category_id
    join public.departments dep on dep.id=cat.department_id and dep.name=''Строительный отдел''';
begin
 def:=pg_get_functiondef('arhittek_client_private.authorize_grant(text,text)'::regprocedure);
 if position('dep.name=' in def)=0 then
  if position(old_join in def)=0 then raise exception 'Unknown client authorization definition';end if;
  execute replace(def,old_join,new_join);
 end if;
end $patch$;
notify pgrst,'reload schema';
commit;
