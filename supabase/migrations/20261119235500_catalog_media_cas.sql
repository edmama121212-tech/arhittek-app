-- Compare the snapshot the worker actually reviewed, including legacy NULL thumbnails.
create or replace function public.migrate_catalog_media(
  p_id uuid, p_version timestamptz, p_album text,
  p_old_images jsonb, p_old_thumbs jsonb, p_images jsonb, p_thumbs jsonb
) returns timestamptz
language sql volatile security invoker set search_path = pg_catalog, pg_temp
as $$
  update public.project_cards c
     set images = p_images, thumbnails = p_thumbs, updated_at = clock_timestamp()
   where c.id = p_id and c.deleted_at is null and public.has_admin_session()
     and c.updated_at is not distinct from p_version
     and (c.pdf_import_meta->>'sha256') is not distinct from p_album
     and c.images is not distinct from p_old_images
     and c.thumbnails is not distinct from p_old_thumbs
     and jsonb_typeof(p_images) = 'array' and jsonb_typeof(p_thumbs) = 'array'
  returning c.updated_at
$$;

revoke all on function public.migrate_catalog_media(uuid,timestamptz,text,jsonb,jsonb,jsonb,jsonb) from public;
grant execute on function public.migrate_catalog_media(uuid,timestamptz,text,jsonb,jsonb,jsonb,jsonb) to anon, authenticated;
