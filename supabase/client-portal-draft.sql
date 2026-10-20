-- Prepared installation SQL. Activation is a separate reviewed server setting.
-- Never run this file twice: create it as one tracked production migration.
-- Existing source entities remain public.projects / invoices / ledger_entries /
-- project_stages. These are supplementary terms, confirmations, and permissions.
-- Before promotion: create a migration with the Supabase CLI, run isolated SQL
-- tests/advisors, review the real global RLS/Storage preflight, then root approval.
begin;
create schema if not exists arhittek_client_private;
revoke all on schema arhittek_client_private from public, anon, authenticated;
grant usage on schema arhittek_client_private to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('construction-documents','construction-documents',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false;

create table arhittek_client_private.settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  allowed_origins text[] not null default array['https://edmama121212-tech.github.io'],
  security_reviewed_at timestamptz,
  security_review_reference text,
  check (not enabled or (security_reviewed_at is not null and length(security_review_reference) >= 10))
);
insert into arhittek_client_private.settings(singleton) values(true);
create table arhittek_client_private.project_settings (
  project_id uuid primary key references public.projects(id) on delete restrict,
  published boolean not null default false,
  cost_facts_complete boolean not null default false,
  cash_history_complete boolean not null default false,
  source_fingerprint text,
  revision bigint not null default 1 check(revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.employees(id)
);
create table arhittek_client_private.terms (
  project_id uuid primary key references public.projects(id) on delete restrict,
  version integer not null default 2 check(version = 2),
  company_fee_basis text not null default 'actual_cost_markup' check(company_fee_basis = 'actual_cost_markup'),
  company_fee_rate numeric not null check(company_fee_rate between 0 and 100 and company_fee_rate=round(company_fee_rate,2)),
  company_fee_mode text not null default 'on_top' check(company_fee_mode = 'on_top'),
  currency text not null default 'RUB' check(currency = 'RUB'),
  revision bigint not null check(revision > 0),
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.employees(id)
);
create table arhittek_client_private.ledger_classifications (
  ledger_entry_id uuid primary key references public.ledger_entries(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  funding_source text not null check(funding_source in ('client','company_fee')),
  purpose text check(purpose in ('project_expense','company_fee_expense','client_refund','cash_handover')),
  invoice_id uuid references public.invoices(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.employees(id)
);
create table arhittek_client_private.cost_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  invoice_id uuid unique references public.invoices(id) on delete restrict,
  ledger_entry_id uuid unique references public.ledger_entries(id) on delete restrict,
  cost_scope text not null check(cost_scope in ('project','company_fee')),
  amount numeric(18,2) not null check(amount > 0),
  entry_date date not null,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.employees(id),
  check((invoice_id is null) <> (ledger_entry_id is null))
);
create index cost_facts_project on arhittek_client_private.cost_facts(project_id);
create table arhittek_client_private.cost_credits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  cost_fact_id uuid not null references arhittek_client_private.cost_facts(id) on delete restrict,
  amount numeric(18,2) not null check(amount > 0),
  entry_date date not null,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.employees(id)
);
create index cost_credits_fact on arhittek_client_private.cost_credits(cost_fact_id);
create table arhittek_client_private.fee_allocations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  amount numeric(18,2) not null check(amount > 0),
  entry_date date not null,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.employees(id)
);
create index fee_allocations_project on arhittek_client_private.fee_allocations(project_id);
create table arhittek_client_private.direct_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(18,2) not null check(amount > 0),
  entry_date date not null,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.employees(id)
);
create index direct_payments_invoice on arhittek_client_private.direct_payments(invoice_id);
create table arhittek_client_private.invoice_titles (
  invoice_id uuid primary key references public.invoices(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  public_title text not null check(length(public_title) between 1 and 300),
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.employees(id)
);
-- Work completion is an explicit saved fact, never inferred from invoice type.
create table arhittek_client_private.work_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  stage_id uuid references public.project_stages(id) on delete restrict,
  name text not null check(length(name) between 1 and 250),
  zone text not null default '' check(length(zone) <= 150),
  quantity numeric(13,4) not null check(quantity >= 0),
  unit text not null check(length(unit) between 1 and 30),
  unit_price numeric(18,2) not null check(unit_price >= 0),
  status text not null default 'planned' check(status in ('planned','in_progress','completed','accepted')),
  planned_date date,
  completed_at timestamptz,
  inspected_at timestamptz,
  accepted_at timestamptz,
  published boolean not null default false,
  confirmed_by uuid not null references public.employees(id),
  check((status in ('completed','accepted')) = (completed_at is not null)),
  check((status = 'accepted') = (accepted_at is not null)),
  check(inspected_at is null or (completed_at is not null and inspected_at >= completed_at)),
  check(accepted_at is null or accepted_at >= completed_at)
);
create index work_items_project on arhittek_client_private.work_items(project_id);
create table arhittek_client_private.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  bucket_id text not null,
  object_path text not null,
  object_version text not null,
  filename text not null check(length(filename) between 1 and 200),
  media_type text not null check(media_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check(size_bytes between 1 and 26214400),
  published boolean not null default false,
  reviewed_at timestamptz not null,
  reviewed_by uuid not null references public.employees(id),
  unique(bucket_id,object_path)
);
create index documents_project on arhittek_client_private.documents(project_id,invoice_id);
create table arhittek_client_private.grants (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  scope_ref uuid not null default gen_random_uuid(),
  token_digest text not null unique check(token_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.employees(id),
  window_started_at timestamptz not null default now(),
  window_requests integer not null default 0 check(window_requests >= 0)
);
create index grants_project on arhittek_client_private.grants(project_id);

do $block$
declare tab text;
begin
  foreach tab in array array['settings','project_settings','terms','ledger_classifications','cost_facts','cost_credits','fee_allocations','direct_payments','invoice_titles','work_items','documents','grants'] loop
    execute format('alter table arhittek_client_private.%I enable row level security',tab);
    execute format('revoke all on table arhittek_client_private.%I from public, anon, authenticated',tab);
    execute format('grant select, insert, update, delete on table arhittek_client_private.%I to service_role',tab);
  end loop;
end
$block$;

create function arhittek_client_private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $fn$
declare actor uuid;
begin
  -- Existing real session lookup, not the historical SELECT true helpers.
  select employee_id into actor from public.current_session_employee() where is_admin is true;
  if actor is null then raise sqlstate '42501' using message='Administrator session required'; end if;
  return actor;
end
$fn$;
revoke all on function arhittek_client_private.require_admin() from public,anon,authenticated;

create function arhittek_client_private.source_fingerprint(p_project_id uuid) returns text
language sql stable security invoker set search_path='' as $fn$
 select md5(jsonb_build_array(
  (select jsonb_build_object('saved_markup_percent',p.fee_percent) from public.projects p where p.id=p_project_id),
  (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.invoices i where i.project_id=p_project_id),
  (select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) from public.ledger_entries l where l.project_id=p_project_id),
  (select coalesce(jsonb_agg(to_jsonb(c) order by c.ledger_entry_id),'[]'::jsonb) from arhittek_client_private.ledger_classifications c where c.project_id=p_project_id),
  (select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb) from arhittek_client_private.cost_facts f where f.project_id=p_project_id),
  (select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from arhittek_client_private.cost_credits c where c.project_id=p_project_id),
  (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from arhittek_client_private.fee_allocations a where a.project_id=p_project_id),
  (select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from arhittek_client_private.direct_payments d where d.project_id=p_project_id)
 )::text)
$fn$;
revoke all on function arhittek_client_private.source_fingerprint(uuid) from public,anon,authenticated;
grant execute on function arhittek_client_private.source_fingerprint(uuid) to service_role;

create function arhittek_client_private.authorize_grant(p_digest text,p_origin text)
returns arhittek_client_private.grants language plpgsql volatile security invoker set search_path = '' as $fn$
declare cfg arhittek_client_private.settings; g arhittek_client_private.grants;
begin
  select * into cfg from arhittek_client_private.settings where singleton;
  if cfg.enabled is not true or cfg.security_reviewed_at is null or not(p_origin = any(cfg.allowed_origins)) then
    raise sqlstate 'PT403' using message='Access denied';
  end if;
  -- The customer gateway MUST NOT forward employee x-session-token headers.
  -- With no employee session both repaired helpers must be false. Stub=true is blocked.
  if public.has_session() or public.has_admin_session() then raise sqlstate 'PT403' using message='Access denied'; end if;
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then raise sqlstate 'PT403' using message='Access denied'; end if;
  select gr.* into g from arhittek_client_private.grants gr
    join arhittek_client_private.project_settings ps on ps.project_id=gr.project_id and ps.published
    join public.projects p on p.id=gr.project_id and p.deleted_at is null
    where gr.token_digest=p_digest and gr.revoked_at is null and gr.expires_at > now()
    for update of gr;
  if g.id is null then raise sqlstate 'PT403' using message='Access denied'; end if;
  if g.window_started_at <= now()-interval '1 minute' then g.window_started_at=now();g.window_requests=0; end if;
  if g.window_requests >= 60 then raise sqlstate 'PT429' using message='Too many requests'; end if;
  update arhittek_client_private.grants set window_started_at=g.window_started_at,window_requests=g.window_requests+1 where id=g.id;
  return g;
end
$fn$;
revoke all on function arhittek_client_private.authorize_grant(text,text) from public,anon,authenticated;
grant execute on function arhittek_client_private.authorize_grant(text,text) to service_role;

-- Attachment mappings are derived from the existing invoice URL. A public URL
-- never becomes a client document. Old public originals must be migrated first.
create view arhittek_client_private.document_sources with(security_invoker=true) as
 select d.id,d.project_id,d.invoice_id,d.bucket_id,d.object_path,d.object_version,d.filename,d.media_type,d.size_bytes
 from arhittek_client_private.documents d join public.invoices i on i.id=d.invoice_id and i.project_id=d.project_id
 join storage.buckets b on b.id=d.bucket_id and b.public is false
 join storage.objects o on o.bucket_id=d.bucket_id and o.name=d.object_path and o.version=d.object_version and coalesce(o.is_delete_marker,false) is false and o.archived_at is null
 where d.published and d.bucket_id='construction-documents' and split_part(o.name,'/',1)=d.project_id::text and not exists(select 1 from arhittek_client_private.cost_facts f where f.invoice_id=i.id and f.project_id=i.project_id and f.cost_scope='company_fee')
 union all
 select md5('construction-invoice-document:'||i.id::text||':'||o.id::text)::uuid,i.project_id,i.id,'construction-documents'::text,o.name,o.version,
  case when lower(o.metadata->>'mimetype')='application/pdf' then 'Накладная.pdf'
       when lower(o.metadata->>'mimetype')='image/png' then 'Накладная.png'
       when lower(o.metadata->>'mimetype')='image/webp' then 'Накладная.webp' else 'Накладная.jpg' end,
  lower(o.metadata->>'mimetype'),(o.metadata->>'size')::bigint
 from public.invoices i join storage.objects o on o.bucket_id='construction-documents'
  and i.photo_url='https://chbkkoxwzpaghanofvqk.supabase.co/storage/v1/object/public/construction-documents/'||o.name
 join storage.buckets b on b.id=o.bucket_id and b.public is false
 where split_part(o.name,'/',1)=i.project_id::text and coalesce(o.is_delete_marker,false) is false and o.archived_at is null
  and lower(o.metadata->>'mimetype') in ('application/pdf','image/jpeg','image/png','image/webp')
  and (o.metadata->>'size') ~ '^[0-9]+$' and (o.metadata->>'size')::bigint between 1 and 26214400
  and not exists(select 1 from arhittek_client_private.documents d where d.bucket_id=o.bucket_id and d.object_path=o.name)
  and not exists(select 1 from arhittek_client_private.cost_facts f where f.invoice_id=i.id and f.project_id=i.project_id and f.cost_scope='company_fee');
revoke all on arhittek_client_private.document_sources from public,anon,authenticated;
grant select on arhittek_client_private.document_sources to service_role;

-- One SELECT assembles all sources from one statement snapshot. No LIMIT1000,
-- raw employee rows, PIN, sessions, project notes/passports or public file URLs.
create function arhittek_client_private.project_sources(p_project_id uuid,p_scope_ref uuid,p_expires_at timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $fn$
declare sources jsonb;
begin
  if (select count(*) from public.ledger_entries where project_id=p_project_id)>10000
    or (select count(*) from public.invoices where project_id=p_project_id)>10000
    or (select count(*) from public.project_stages where project_id=p_project_id)>10000
    or (select count(*) from arhittek_client_private.cost_facts where project_id=p_project_id)>10000
    or (select count(*) from arhittek_client_private.cost_credits where project_id=p_project_id)>10000
    or (select count(*) from arhittek_client_private.work_items where project_id=p_project_id)>10000
    or (select count(*) from arhittek_client_private.documents where project_id=p_project_id)>10000 then
    raise sqlstate 'PT413' using message='Project snapshot too large';
  end if;
  select jsonb_build_object(
    'source_version',2,'complete',true,'generated_at',now(),'access_expires_at',p_expires_at,'scope_ref',p_scope_ref,
    'project',jsonb_build_object('id',p.id,'name',p.name,'company_markup_percent',p.fee_percent,'address',coalesce(p.address,''),'status',coalesce(st.name,'В работе')),
    'contract',(select jsonb_build_object('version',t.version,'project_id',t.project_id,'currency',t.currency,'company_fee_basis',t.company_fee_basis,'company_fee_rate',t.company_fee_rate,'company_fee_mode',t.company_fee_mode,'revision',t.revision,'confirmed_at',t.confirmed_at,'confirmed_by',t.confirmed_by) from arhittek_client_private.terms t where t.project_id=p.id and t.company_fee_rate is not distinct from p.fee_percent),
    'costFactsComplete',coalesce(ps.cost_facts_complete and ps.source_fingerprint=arhittek_client_private.source_fingerprint(p.id),false),
    'cashHistoryComplete',coalesce(ps.cash_history_complete and ps.source_fingerprint=arhittek_client_private.source_fingerprint(p.id),false),
    'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'project_id',l.project_id,'type',l.type,'amount',l.amount::text,'entry_date',l.entry_date,'created_at',l.created_at,'funding_source',lc.funding_source,'purpose',lc.purpose,'invoice_id',lc.invoice_id,'payee_employee_id',case when l.payee_employee_id is null then null else 'assigned' end,'description',case when l.description='Ранее внесённые расходы' then l.description when l.description like '[cash:historical-expense]%' then '[cash:historical-expense]' else substring(l.description from '\[invoice-payment:[^\]]+\]') end) order by l.entry_date,l.id) from public.ledger_entries l left join arhittek_client_private.ledger_classifications lc on lc.ledger_entry_id=l.id and lc.project_id=p.id where l.project_id=p.id and l.deleted_at is null),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'project_id',i.project_id,'number',coalesce(i.number,''),'invoice_date',i.invoice_date,'item_type',coalesce(i.item_type,'Прочее'),'amount',i.amount::text,'paid_by_client',i.paid_by_client,'cost_scope',coalesce(f.cost_scope,'project'),'public_title',coalesce(it.public_title,left(regexp_replace(coalesce(nullif(btrim(i.description),''),case when nullif(i.number,'') is not null then 'Накладная № '||i.number else 'Накладная по объекту' end),'[[:cntrl:]]',' ','g'),300))) order by i.invoice_date,i.id) from public.invoices i left join arhittek_client_private.cost_facts f on f.invoice_id=i.id and f.project_id=p.id left join arhittek_client_private.invoice_titles it on it.invoice_id=i.id and it.project_id=p.id where i.project_id=p.id),'[]'::jsonb),
    'costFacts',coalesce((select jsonb_agg(v.row order by v.id) from (
      select i.id,jsonb_build_object('id',coalesce(f.id,i.id),'project_id',i.project_id,'source_type','invoice','source_id',i.id,'cost_scope',coalesce(f.cost_scope,'project'),'amount',i.amount::text,'entry_date',i.invoice_date,'confirmed_at',ps.updated_at,'confirmed_by',ps.updated_by) as row
      from public.invoices i left join arhittek_client_private.cost_facts f on f.invoice_id=i.id and f.project_id=i.project_id where i.project_id=p.id
      union all
      select l.id,jsonb_build_object('id',coalesce(f.id,l.id),'project_id',l.project_id,'source_type','ledger','source_id',l.id,'cost_scope',coalesce(f.cost_scope,case when lc.funding_source='company_fee' then 'company_fee' else 'project' end),'amount',l.amount::text,'entry_date',l.entry_date,'confirmed_at',ps.updated_at,'confirmed_by',ps.updated_by)
      from public.ledger_entries l left join arhittek_client_private.ledger_classifications lc on lc.ledger_entry_id=l.id and lc.project_id=l.project_id left join arhittek_client_private.cost_facts f on f.ledger_entry_id=l.id and f.project_id=l.project_id
      where l.project_id=p.id and l.deleted_at is null and l.type in ('expense','project_expense','payment','withdrawal','fee_payment','salary_payment')
       and coalesce(lc.purpose,'') not in ('cash_handover','client_refund')
       and (l.type<>'withdrawal' or lc.purpose in ('project_expense','company_fee_expense'))
       and (l.payee_employee_id is null and l.type not in ('fee_payment','salary_payment') or lc.funding_source in ('client','company_fee'))
       and l.description is distinct from 'Ранее внесённые расходы' and coalesce(l.description,'') not like '[cash:historical-expense]%'
       and coalesce(l.description,'') not like '%[invoice-payment:%' and lc.invoice_id is null
    )v),'[]'::jsonb),
    'costCredits',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'project_id',c.project_id,'cost_fact_id',c.cost_fact_id,'amount',c.amount::text,'entry_date',c.entry_date,'confirmed_at',c.confirmed_at,'confirmed_by',c.confirmed_by) order by c.entry_date,c.id) from arhittek_client_private.cost_credits c where c.project_id=p.id),'[]'::jsonb),
    'allocations',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'project_id',a.project_id,'amount',a.amount::text,'entry_date',a.entry_date,'confirmed_at',a.confirmed_at,'confirmed_by',a.confirmed_by) order by a.entry_date,a.id) from arhittek_client_private.fee_allocations a where a.project_id=p.id),'[]'::jsonb),
    'directPayments',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'project_id',d.project_id,'invoice_id',d.invoice_id,'amount',d.amount::text,'entry_date',d.entry_date,'confirmed_at',d.confirmed_at,'confirmed_by',d.confirmed_by) order by d.entry_date,d.id) from arhittek_client_private.direct_payments d where d.project_id=p.id),'[]'::jsonb),
    'stages',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'project_id',s.project_id,'name',s.name,'due_date',s.due_date,'done',coalesce(s.done,false),'done_at',s.done_at) order by s.sort_order,s.created_at,s.id) from public.project_stages s where s.project_id=p.id),'[]'::jsonb),
    'work_items',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'project_id',w.project_id,'stage_id',w.stage_id,'name',w.name,'zone',w.zone,'quantity',w.quantity::text,'unit',w.unit,'unit_price',w.unit_price::text,'status',w.status,'planned_date',w.planned_date,'completed_at',w.completed_at,'inspected_at',w.inspected_at,'accepted_at',w.accepted_at) order by w.planned_date,w.id) from arhittek_client_private.work_items w where w.project_id=p.id and w.published),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'project_id',d.project_id,'invoice_id',d.invoice_id,'name',d.filename,'media_type',d.media_type,'size_bytes',d.size_bytes) order by d.id) from arhittek_client_private.document_sources d where d.project_id=p.id),'[]'::jsonb)
  ) into sources from public.projects p left join public.statuses st on st.id=p.status_id left join arhittek_client_private.project_settings ps on ps.project_id=p.id where p.id=p_project_id and p.deleted_at is null;
  if sources is null then raise sqlstate 'PT403' using message='Access denied'; end if;
  return sources;
end
$fn$;
revoke all on function arhittek_client_private.project_sources(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function arhittek_client_private.project_sources(uuid,uuid,timestamptz) to service_role;

create function public.construction_client_sources(p_token_digest text,p_origin text)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $fn$
declare g arhittek_client_private.grants;
begin
  g=arhittek_client_private.authorize_grant(p_token_digest,p_origin);
  return arhittek_client_private.project_sources(g.project_id,g.scope_ref,g.expires_at);
end
$fn$;
revoke all on function public.construction_client_sources(text,text) from public,anon,authenticated;
grant execute on function public.construction_client_sources(text,text) to service_role;

create function public.construction_client_document(p_token_digest text,p_origin text,p_document_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $fn$
declare g arhittek_client_private.grants; result jsonb;
begin
  g=arhittek_client_private.authorize_grant(p_token_digest,p_origin);
  select jsonb_build_object('id',d.id,'name',d.filename,'media_type',d.media_type,'size_bytes',d.size_bytes,'bucket_id',d.bucket_id,'object_path',d.object_path,'object_version',d.object_version,'access_expires_at',g.expires_at)
  into result from arhittek_client_private.document_sources d
  where d.id=p_document_id and d.project_id=g.project_id;
  if result is null then raise sqlstate 'PT403' using message='Access denied'; end if;
  return result;
end
$fn$;
revoke all on function public.construction_client_document(text,text,uuid) from public,anon,authenticated;
grant execute on function public.construction_client_document(text,text,uuid) to service_role;

create function public.issue_construction_client_grant(p_project_id uuid,p_expires_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare actor uuid; raw_token text; g arhittek_client_private.grants; cfg arhittek_client_private.settings;
begin
  actor=arhittek_client_private.require_admin();
  select * into cfg from arhittek_client_private.settings where singleton;
  if cfg.enabled is not true or cfg.security_reviewed_at is null then raise sqlstate 'PT403' using message='Portal is not activated'; end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now()+interval '30 days' then raise sqlstate '22023' using message='Invalid expiration'; end if;
  if not exists(select 1 from public.projects p join arhittek_client_private.project_settings ps on ps.project_id=p.id and ps.published where p.id=p_project_id and p.deleted_at is null) then raise sqlstate 'PT403' using message='Project is not published'; end if;
  raw_token=encode(extensions.gen_random_bytes(32),'hex');
  insert into arhittek_client_private.grants(project_id,token_digest,expires_at,created_by) values(p_project_id,encode(extensions.digest(raw_token,'sha256'),'hex'),p_expires_at,actor) returning * into g;
  return jsonb_build_object('grant_id',g.id,'access',raw_token,'expires_at',g.expires_at);
end
$fn$;
revoke all on function public.issue_construction_client_grant(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.issue_construction_client_grant(uuid,timestamptz) to anon,authenticated;

create function public.revoke_construction_client_grant(p_grant_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $fn$
begin
  perform arhittek_client_private.require_admin();
  update arhittek_client_private.grants set revoked_at=coalesce(revoked_at,now()) where id=p_grant_id;
  return found;
end
$fn$;
revoke all on function public.revoke_construction_client_grant(uuid) from public,anon,authenticated;
grant execute on function public.revoke_construction_client_grant(uuid) to anon,authenticated;

-- Internal admin source reader for the EXISTING object card. No customer token
-- or second object is created. Foremen do not gain access to admin economics.
create function public.get_construction_finance_sources(p_project_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
begin
  perform arhittek_client_private.require_admin();
  return arhittek_client_private.project_sources(p_project_id,p_project_id,now()+interval '30 minutes');
end
$fn$;
revoke all on function public.get_construction_finance_sources(uuid) from public,anon,authenticated;
grant execute on function public.get_construction_finance_sources(uuid) to anon,authenticated;

-- Publication confirms the current source revision, not a second invoice ledger.
-- Financial edits invalidate that confirmation automatically via fingerprint.
create function public.get_construction_client_settings(p_project_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare result jsonb;
begin
 perform arhittek_client_private.require_admin();
 if not exists(select 1 from public.projects p where p.id=p_project_id and p.deleted_at is null) then raise sqlstate 'PT404' using message='Project not found'; end if;
 select jsonb_build_object('project_id',p_project_id,'saved_markup_percent',(select p.fee_percent from public.projects p where p.id=p_project_id),'revision',coalesce(ps.revision,0),'published',coalesce(ps.published,false),
  'cost_facts_complete',coalesce(ps.cost_facts_complete and ps.source_fingerprint=arhittek_client_private.source_fingerprint(p_project_id),false),
  'cash_history_complete',coalesce(ps.cash_history_complete and ps.source_fingerprint=arhittek_client_private.source_fingerprint(p_project_id),false),
  'portal_enabled',coalesce(cfg.enabled,false),
  'public_attachments_pending',(select count(*) from public.invoices i where i.project_id=p_project_id and coalesce(i.photo_url,'')<>'' and not exists(select 1 from arhittek_client_private.cost_facts f where f.invoice_id=i.id and f.project_id=i.project_id and f.cost_scope='company_fee') and not exists(select 1 from arhittek_client_private.document_sources d where d.invoice_id=i.id and d.project_id=i.project_id)),
  'grants',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'created_at',g.created_at,'expires_at',g.expires_at,'revoked_at',g.revoked_at) order by g.created_at desc) from arhittek_client_private.grants g where g.project_id=p_project_id),'[]'::jsonb)) into result
 from arhittek_client_private.settings cfg left join arhittek_client_private.project_settings ps on ps.project_id=p_project_id where cfg.singleton;
 return result;
end
$fn$;
revoke all on function public.get_construction_client_settings(uuid) from public,anon,authenticated;
grant execute on function public.get_construction_client_settings(uuid) to anon,authenticated;

create function public.configure_construction_client_project(p_project_id uuid,p_published boolean,p_confirm_history boolean,p_confirm_markup boolean,p_expected_revision bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $fn$
declare actor uuid; current_revision bigint; stamp text;
begin
 actor=arhittek_client_private.require_admin();
 perform 1 from public.projects p join public.categories c on c.id=p.category_id join public.departments d on d.id=c.department_id
 where p.id=p_project_id and p.deleted_at is null and d.name='Строительный отдел' for update of p;
 if not found then raise sqlstate 'PT404' using message='Construction project not found';end if;
 select revision into current_revision from arhittek_client_private.project_settings where project_id=p_project_id for update;
 if coalesce(current_revision,0) is distinct from p_expected_revision then raise sqlstate 'PT409' using message='Project settings changed; reload';end if;
 if p_published is null or p_confirm_history is null or p_confirm_markup is null then raise sqlstate '22023' using message='Confirmation required';end if;
 if p_published and exists(select 1 from public.projects p where p.id=p_project_id and (p.fee_percent is null or p.fee_percent<0 or p.fee_percent>100 or p.fee_percent<>round(p.fee_percent,2))) then raise sqlstate '22023' using message='Set the saved markup rate before publication';end if;
 if p_published and not p_confirm_markup then raise sqlstate '22023' using message='Confirm the saved open markup rate';end if;
 if p_published and exists(select 1 from public.invoices i where i.project_id=p_project_id and coalesce(i.photo_url,'')<>'' and not exists(select 1 from arhittek_client_private.cost_facts f where f.invoice_id=i.id and f.project_id=i.project_id and f.cost_scope='company_fee') and not exists(select 1 from arhittek_client_private.document_sources d where d.invoice_id=i.id and d.project_id=i.project_id)) then
  raise sqlstate 'PT409' using message='Invoice photos must be moved to private construction documents before publication';end if;
 stamp=arhittek_client_private.source_fingerprint(p_project_id);
 insert into arhittek_client_private.project_settings(project_id,published,cost_facts_complete,cash_history_complete,source_fingerprint,revision,updated_by)
 values(p_project_id,p_published,p_published,p_confirm_history,stamp,1,actor)
 on conflict(project_id) do update set published=excluded.published,cost_facts_complete=excluded.cost_facts_complete,cash_history_complete=excluded.cash_history_complete,source_fingerprint=excluded.source_fingerprint,revision=arhittek_client_private.project_settings.revision+1,updated_at=now(),updated_by=actor;
 if p_published then
 insert into arhittek_client_private.terms(project_id,company_fee_rate,revision,confirmed_by) select p_project_id,p.fee_percent,coalesce(current_revision,0)+1,actor from public.projects p where p.id=p_project_id
 on conflict(project_id) do update set company_fee_rate=excluded.company_fee_rate,revision=excluded.revision,confirmed_at=now(),confirmed_by=actor;
 else
 update arhittek_client_private.grants set revoked_at=coalesce(revoked_at,now()) where project_id=p_project_id;
 end if;
 return public.get_construction_client_settings(p_project_id);
end
$fn$;
revoke all on function public.configure_construction_client_project(uuid,boolean,boolean,boolean,bigint) from public,anon,authenticated;
grant execute on function public.configure_construction_client_project(uuid,boolean,boolean,boolean,bigint) to anon,authenticated;

-- New work/settlements/credits remain explicit supplementary facts tied to the
-- same project and source IDs. No update silently rewrites legacy financial rows.
-- Never set settings.enabled until the common RLS + Edge + private-file preflight.
commit;
