begin;
create table if not exists public.catalog_plan_jobs(
 id uuid primary key,
 actor uuid not null references public.employees(id),
 request_hash text not null check(length(request_hash)=64),
 state text not null check(state in ('generating','generated','reviewing','approved','rejected','failed')),
 attempt integer not null check(attempt between 1 and 2),
 manifest jsonb not null,
 review jsonb,
 error text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(actor,request_hash)
);
alter table public.catalog_plan_jobs enable row level security;
revoke all on public.catalog_plan_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.catalog_plan_jobs to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('catalog-plan-jobs','catalog-plan-jobs',false,10485760,array['image/png'])
on conflict(id) do nothing;
commit;
