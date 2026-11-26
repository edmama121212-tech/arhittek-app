-- Bind the existing individual-design tariff by ID so rate and label edits remain linked.
alter table public.catalog_pricing add column if not exists individual_tariff_id uuid
  references public.kp_catalog(id) on delete set null;
update public.catalog_pricing
   set individual_tariff_id = (
     select k.id from public.kp_catalog k
      where k.group_name = 'Архитектурное проектирование' and k.name = 'Архитектурное решение'
        and k.deleted_at is null and k.unit in ('м²', 'м2', 'm²', 'm2')
      order by k.sort_order, k.id limit 1
   )
 where id = 1 and individual_tariff_id is null;

create or replace function public.get_public_catalog(p_token text, p_prices_only boolean)
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
    jsonb_agg(case when p_prices_only then
      jsonb_build_object('id', c.id, 'total_area', c.total_area, 'price', c.price)
      else to_jsonb(c) - 'pdf_import_meta' end order by c.created_at desc nulls last),
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
    'individual_design_rate', (
      select k.rate from public.catalog_pricing p join public.kp_catalog k on k.id = p.individual_tariff_id
       where p.id = 1 and k.deleted_at is null and k.unit in ('м²', 'м2', 'm²', 'm2') and k.rate > 0
    ),
    'cards', v_cards
  );
end
$catalog$;

revoke all on function public.get_public_catalog(text, boolean) from public;
grant execute on function public.get_public_catalog(text, boolean) to anon, authenticated;

-- Keep the original one-argument API for already-issued links and older clients.
create or replace function public.get_public_catalog(p_token text) returns jsonb
language sql stable security invoker set search_path = pg_catalog, pg_temp
as $$ select public.get_public_catalog(p_token, false) $$;

revoke all on function public.get_public_catalog(text) from public;
grant execute on function public.get_public_catalog(text) to anon, authenticated;
comment on function public.get_public_catalog(text) is
  'A valid, non-deleted, unexpired opaque share token grants only a curated catalog payload. Never exposes raw share tokens or PDF import metadata.';
