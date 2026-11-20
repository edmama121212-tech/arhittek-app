-- A reviewed roof is a separate catalog asset. Legacy floor editors never send this column.
alter table public.project_cards add column if not exists catalog_roof_plan jsonb;

create schema if not exists catalog_plan_work;
create table if not exists catalog_plan_work.roof_reviews (
  card_id uuid not null,
  album_sha256 text not null,
  image_sha256 text not null,
  thumbnail_sha256 text not null,
  review jsonb not null,
  prior_plan jsonb,
  saved_at timestamptz not null default clock_timestamp(),
  primary key(card_id, album_sha256, image_sha256, thumbnail_sha256)
);
alter table catalog_plan_work.roof_reviews enable row level security;
revoke all on catalog_plan_work.roof_reviews from public, anon, authenticated;

-- Only the trusted catalog worker publishes. Each digest names the exact immutable WebP
-- at expense-photos/cards/{card_id}/{sha256}.webp, verified by the worker before and after.
create or replace function public.publish_catalog_roof(
  p_card uuid, p_previous_updated_at timestamptz, p_previous jsonb, p_review jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  row_card public.project_cards%rowtype;
  album text := p_review->>'album_hash';
  main text := p_review->>'file_sha256';
  thumb text := p_review->>'thumbnail_file_sha256';
  next_plan jsonb;
begin
  if not coalesce(
    p_review->>'revision' = 'generated-render-v2-gray'
    and p_review->>'slot' = 'roof'
    and album ~ '^[a-f0-9]{64}$' and main ~ '^[a-f0-9]{64}$' and thumb ~ '^[a-f0-9]{64}$'
    and main <> thumb and p_review->>'review_sha256' = main
    and p_review->>'page' ~ '^[1-9][0-9]*$'
    and (p_review#>>'{overall_dimensions,width_mm}')::numeric > 0
    and (p_review#>>'{overall_dimensions,length_mm}')::numeric > 0
    and length(trim(p_review#>>'{overall_dimensions,source}')) > 0
    and length(trim(p_review#>>'{overall_dimensions,bounds}')) > 0
    and jsonb_typeof(p_review->'observations') = 'array'
    and (select count(distinct trim(n#>>'{}')) from jsonb_array_elements(p_review->'observations') n) >= 5
    and not exists(select 1 from jsonb_array_elements(p_review->'observations') n
                   where jsonb_typeof(n) <> 'string' or length(trim(n#>>'{}')) < 10)
  ,false) then raise exception 'Incomplete roof review'; end if;

  select * into row_card from public.project_cards where id = p_card and deleted_at is null for update;
  if not found or row_card.pdf_import_meta->>'sha256' is distinct from album then
    raise exception 'Catalog album changed';
  end if;
  next_plan := jsonb_build_object('album_hash',album,'file_sha256',main,'thumbnail_file_sha256',thumb,'revision',p_review->>'revision');
  if row_card.catalog_roof_plan = next_plan and exists(select 1 from catalog_plan_work.roof_reviews
      where card_id=p_card and album_sha256=album and image_sha256=main and thumbnail_sha256=thumb and review=p_review) then
    return next_plan;
  end if;
  if row_card.updated_at is distinct from p_previous_updated_at or row_card.catalog_roof_plan is distinct from p_previous then
    raise exception 'Catalog card changed';
  end if;
  insert into catalog_plan_work.roof_reviews(card_id,album_sha256,image_sha256,thumbnail_sha256,review,prior_plan)
  values(p_card,album,main,thumb,p_review,row_card.catalog_roof_plan)
  on conflict(card_id,album_sha256,image_sha256,thumbnail_sha256) do nothing;
  if not exists(select 1 from catalog_plan_work.roof_reviews where card_id=p_card and album_sha256=album
        and image_sha256=main and thumbnail_sha256=thumb and review=p_review) then
    raise exception 'Conflicting review for this file pair';
  end if;
  update public.project_cards set catalog_roof_plan=next_plan,updated_at=clock_timestamp() where id=p_card;
  return next_plan;
end;
$$;
revoke all on function public.publish_catalog_roof(uuid,timestamptz,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.publish_catalog_roof(uuid,timestamptz,jsonb,jsonb) to service_role;

-- Old editors update the other columns. Direct edits cannot attach an unreviewed pair.
create or replace function catalog_plan_work.verify_roof_pointer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.catalog_roof_plan is null then
    return new;
  end if;
  if not exists(select 1 from catalog_plan_work.roof_reviews r where r.card_id=new.id
      and r.album_sha256=new.pdf_import_meta->>'sha256'
      and new.catalog_roof_plan=jsonb_build_object('album_hash',r.album_sha256,'file_sha256',r.image_sha256,
        'thumbnail_file_sha256',r.thumbnail_sha256,'revision',r.review->>'revision')) then
    raise exception 'No verified roof matches this card and album';
  end if;
  return new;
end;
$$;
revoke all on function catalog_plan_work.verify_roof_pointer() from public, anon, authenticated;
drop trigger if exists catalog_verified_roof_pointer on public.project_cards;
create trigger catalog_verified_roof_pointer before insert or update of catalog_roof_plan on public.project_cards
  for each row execute function catalog_plan_work.verify_roof_pointer();
