-- Preserve employee sign-in and closed server access. Never restore SELECT true.
-- All client grants/documents remain stored, but client delivery is disabled.
begin;
do $$ begin
  if to_regclass('arhittek_client_private.settings') is not null then
    execute 'update arhittek_client_private.settings set enabled=false where singleton=true';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
