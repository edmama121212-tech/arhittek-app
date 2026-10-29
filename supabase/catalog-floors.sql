-- Additive catalogue extension. Existing cards and access policies are preserved.
-- images[0..3] remain facade 1, facade 2, floor 1, floor 2;
-- images[4] is floor 3, images[5] is basement (same order for thumbnails).
begin;
alter table public.project_cards
  add column if not exists floor3_area text,
  add column if not exists basement_area text,
  add column if not exists expl3 jsonb default '[]'::jsonb,
  add column if not exists expl_basement jsonb default '[]'::jsonb;
notify pgrst, 'reload schema';
commit;
