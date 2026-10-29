-- Apply after catalog-floors.sql. Existing cards and RLS policies are untouched.
alter table public.project_cards add column if not exists pdf_import_meta jsonb;

create or replace function public.import_catalog_pdf(p_card jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_card public.project_cards%rowtype;
  v_number text;
  v_hash text;
  v_id uuid;
  v_key text;
begin
  if not coalesce(public.has_admin_session(), false) then
    raise exception 'Нет доступа к импорту каталога' using errcode = '42501';
  end if;
  if jsonb_typeof(p_card) is distinct from 'object' or octet_length(p_card::text) > 262144 then
    raise exception 'Некорректная карточка PDF';
  end if;
  v_number := btrim(p_card->>'project_number');
  v_hash := p_card->'pdf_import_meta'->>'sha256';
  if coalesce(v_number, '') = '' or length(v_number) > 80 then
    raise exception 'Нужен номер проекта из PDF';
  end if;
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Не получен идентификатор PDF';
  end if;
  foreach v_key in array array['tags','images','thumbnails','expl1','expl2','expl3','expl_basement'] loop
    if jsonb_typeof(p_card->v_key) is distinct from 'array' then
      raise exception 'Некорректное поле карточки: %', v_key;
    end if;
    if jsonb_array_length(p_card->v_key) > 200 then
      raise exception 'Слишком много элементов: %', v_key;
    end if;
  end loop;
  select * into v_card from jsonb_populate_record(null::public.project_cards, p_card);
  if v_card.floors is null or v_card.floors not between 1 and 3
    or coalesce(v_card.beds, 0) not between 0 and 999
    or coalesce(v_card.baths, 0) not between 0 and 999 then
    raise exception 'Проверьте этажность и количество помещений';
  end if;
  -- Serialize imports of the same file or project, including retries after a lost response.
  perform pg_advisory_xact_lock(hashtextextended('catalog-pdf-hash:' || v_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('catalog-pdf-number:' || lower(v_number), 0));
  select id into v_id from public.project_cards
    where deleted_at is null and
      (lower(btrim(project_number)) = lower(v_number) or pdf_import_meta->>'sha256' = v_hash)
    order by created_at, id limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;
  insert into public.project_cards (
    project_number,title,floors,total_area,footprint,beds,baths,price,tags,
    floor1_area,floor2_area,floor3_area,basement_area,expl1,expl2,expl3,expl_basement,
    images,thumbnails,pdf_import_meta
  ) values (
    v_number,v_card.title,v_card.floors,v_card.total_area,v_card.footprint,v_card.beds,v_card.baths,v_card.price,v_card.tags,
    v_card.floor1_area,v_card.floor2_area,v_card.floor3_area,v_card.basement_area,v_card.expl1,v_card.expl2,v_card.expl3,v_card.expl_basement,
    v_card.images,v_card.thumbnails,jsonb_build_object(
      'sha256',v_hash,'version',1,'pages',v_card.pdf_import_meta->'pages',
      'sources',v_card.pdf_import_meta->'sources','warnings',v_card.pdf_import_meta->'warnings'
    )
  ) returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true);
end;
$$;

revoke all on function public.import_catalog_pdf(jsonb) from public;
grant execute on function public.import_catalog_pdf(jsonb) to anon, authenticated;
