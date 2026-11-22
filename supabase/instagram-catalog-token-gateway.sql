-- Deployed to Supabase via migration instagram_catalog_token_gateway_phase1_20261122.
-- Non-breaking: this function is used before tightening public SELECT policies.
create or replace function public.get_public_catalog(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $catalog$
declare
  v_link public.share_links%rowtype;
  v_cards jsonb;
begin
  -- Opaque bearer token. Never return the raw share token.
  if p_token is null or length(p_token) < 20 or length(p_token) > 256 then
    return null;
  end if;
  select s.* into v_link
    from public.share_links s
    where s.token = p_token
      and s.deleted_at is null
      and (s.expires_at is null or s.expires_at > now())
    limit 1;
  if not found then
    return null;
  end if;
  select coalesce(
    jsonb_agg(to_jsonb(c) - 'pdf_import_meta' order by c.created_at desc nulls last),
    '[]'::jsonb
  ) into v_cards
    from public.project_cards c
   where c.deleted_at is null
     and (v_link.project_id is null or c.id = v_link.project_id)
     and (
       v_link.floors_filter is null or v_link.floors_filter = 'all'
       or (v_link.floors_filter = '1' and c.floors = 1)
       or (v_link.floors_filter = '2' and c.floors = 2)
       or (v_link.floors_filter = '3' and c.floors >= 3)
     );
  return jsonb_build_object(
    'link', jsonb_build_object(
      'id', v_link.id,
      'project_id', v_link.project_id,
      'floors_filter', v_link.floors_filter,
      'expires_at', v_link.expires_at
    ),
    'cards', v_cards
  );
end
$catalog$;

revoke all on function public.get_public_catalog(text) from public;
grant execute on function public.get_public_catalog(text) to anon, authenticated;
comment on function public.get_public_catalog(text) is
  'A valid, non-deleted, unexpired opaque share token grants only a curated catalog payload. Never exposes raw share tokens or PDF import metadata.';
