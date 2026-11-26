-- Keep the Facebook challenge verifier in the project's encrypted Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'facebook_catalog_webhook_verify') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'facebook_catalog_webhook_verify', 'ARHITTEK Catalog Facebook Page webhook verification');
  end if;
end $$;

create or replace function public.match_facebook_catalog_verifier(p_candidate text)
returns boolean language sql stable security definer
set search_path = pg_catalog, pg_temp as $$
  select case when octet_length(p_candidate) = 64 then exists (
    select 1 from vault.decrypted_secrets
    where name = 'facebook_catalog_webhook_verify'
      and sha256(convert_to(decrypted_secret, 'UTF8')) = sha256(convert_to(p_candidate, 'UTF8'))
  ) else false end;
$$;
revoke all on function public.match_facebook_catalog_verifier(text) from public, anon, authenticated;
grant execute on function public.match_facebook_catalog_verifier(text) to service_role;
