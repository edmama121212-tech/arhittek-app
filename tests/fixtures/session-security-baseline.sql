-- Sanitized schema-only fixture from the production metadata audit.
create role anon; create role authenticated; create role service_role bypassrls;
create schema storage;
create sequence public.login_attempts_id_seq;
create sequence public.push_subscriptions_id_seq;
grant usage,select on all sequences in schema public to anon,authenticated;
grant usage on schema public,storage to anon,authenticated,service_role;
create table public.employees("id" uuid default gen_random_uuid() not null,"name" text not null,"role" text default ''::text,"active" bool default true,"created_at" timestamptz default now(),"deleted_at" timestamptz,"pin_code" text default ''::text,"is_admin" bool default false,"can_edit_cards" bool default false,"can_see_projects" bool,"can_see_construction" bool,"is_salaried" bool default false,"fixed_salary" numeric default 0,primary key("id"));
alter table public.employees enable row level security;
grant all on public.employees to anon,authenticated,service_role;
create table public.categories("id" uuid default gen_random_uuid() not null,"name" text not null,"fee_percent" numeric default 0,"fee_base" text default 'profit'::text,"sort_order" int4 default 0,"department_id" uuid,"deleted_at" timestamptz,primary key("id"));
alter table public.categories enable row level security;
grant all on public.categories to anon,authenticated,service_role;
create table public.statuses("id" uuid default gen_random_uuid() not null,"name" text not null,"sort_order" int4 default 0,"color" text default '#FFFFFF'::text,primary key("id"));
alter table public.statuses enable row level security;
grant all on public.statuses to anon,authenticated,service_role;
create table public.projects("id" uuid default gen_random_uuid() not null,"name" text not null,"category_id" uuid,"status_id" uuid,"employee_id" uuid,"address" text default ''::text,"phone" text default ''::text,"description" text default ''::text,"price" numeric default 0,"advance" numeric default 0,"balance" numeric default 0,"expenses" numeric default 0,"fee_percent" numeric,"fee_base" text,"fee_paid" numeric default 0,"start_date" date,"end_date" date,"notes" text default ''::text,"created_at" timestamptz default now(),"updated_at" timestamptz default now(),"payment_status" text default 'Ждём оплату'::text,"deleted_at" timestamptz,"floors_total" int4,"floors_done" int4,"stage_notes" text,"co_employee_id" uuid,"fee_settled" bool default false,"contract_client_name" text,"contract_passport" text,"contract_birthdate" text,"contract_passport_issuer" text,"contract_passport_date" text,"contract_address" text,"contract_scope" text,"contract_advance_pct" text,"contract_number" text,"client_name" text,"co_fee_percent" numeric,"co_fee_paid" numeric default 0,"area" numeric,primary key("id"));
alter table public.projects enable row level security;
grant all on public.projects to anon,authenticated,service_role;
create table public.ledger_entries("id" uuid default gen_random_uuid() not null,"project_id" uuid,"type" text not null,"description" text default ''::text,"amount" numeric not null,"entry_date" date default CURRENT_DATE,"created_at" timestamptz default now(),"deleted_at" timestamptz,"received_by" uuid,"payee_employee_id" uuid,primary key("id"));
alter table public.ledger_entries enable row level security;
grant all on public.ledger_entries to anon,authenticated,service_role;
create table public.departments("id" uuid default gen_random_uuid() not null,"name" text not null,"sort_order" int4 default 0,primary key("id"));
alter table public.departments enable row level security;
grant all on public.departments to anon,authenticated,service_role;
create table public.audit_log("id" uuid default gen_random_uuid() not null,"entity_type" text not null,"entity_id" uuid not null,"entity_name" text default ''::text,"action" text not null,"changes" jsonb default '{}'::jsonb,"created_at" timestamptz default now(),primary key("id"));
alter table public.audit_log enable row level security;
grant all on public.audit_log to anon,authenticated,service_role;
create table public.expense_photos("id" uuid default gen_random_uuid() not null,"project_id" uuid,"ledger_entry_id" uuid,"description" text default ''::text,"amount" numeric,"photo_url" text not null,"entry_date" date default CURRENT_DATE,"created_at" timestamptz default now(),primary key("id"));
alter table public.expense_photos enable row level security;
grant all on public.expense_photos to anon,authenticated,service_role;
create table public.invoices("id" uuid default gen_random_uuid() not null,"project_id" uuid,"number" text default ''::text,"invoice_date" date,"category" text default ''::text,"item_type" text default 'Материал'::text,"description" text default ''::text,"amount" numeric default 0 not null,"supplier" text default ''::text,"photo_url" text default ''::text,"notes" text default ''::text,"created_at" timestamptz default now(),"paid_by_client" bool default false not null,primary key("id"));
alter table public.invoices enable row level security;
grant all on public.invoices to anon,authenticated,service_role;
create table public.tz_forms("id" uuid default gen_random_uuid() not null,"project_id" uuid,"token" text not null,"status" text default 'Отправлено'::text,"client_name" text default ''::text,"answers" jsonb default '{}'::jsonb,"created_at" timestamptz default now(),"submitted_at" timestamptz,primary key("id"));
alter table public.tz_forms enable row level security;
grant all on public.tz_forms to anon,authenticated,service_role;
create table public.tz_references("id" uuid default gen_random_uuid() not null,"tz_form_id" uuid,"section" text default ''::text,"photo_url" text not null,"created_at" timestamptz default now(),primary key("id"));
alter table public.tz_references enable row level security;
grant all on public.tz_references to anon,authenticated,service_role;
create table public.company_info("id" uuid default gen_random_uuid() not null,"full_name" text default ''::text,"short_name" text default ''::text,"director" text default ''::text,"inn" text default ''::text,"kpp" text default ''::text,"ogrn" text default ''::text,"tax_system" text default ''::text,"legal_address" text default ''::text,"phone" text default ''::text,"email" text default ''::text,"bank_name" text default ''::text,"bank_account" text default ''::text,"bik" text default ''::text,"corr_account" text default ''::text,"card_number" text default ''::text,"card_holder" text default ''::text,"card_bank" text default ''::text,"updated_at" timestamptz default now(),"price_per_sqm" numeric default 150 not null,primary key("id"));
alter table public.company_info enable row level security;
grant all on public.company_info to anon,authenticated,service_role;
create table public.kp_forms("id" uuid default gen_random_uuid() not null,"project_id" uuid,"client_name" text default ''::text,"client_phone" text default ''::text,"object" text default ''::text,"kp_date" date,"deadline" text default ''::text,"start_date" text default ''::text,"payment_method" text default 'account'::text,"discount_type" text default 'percent'::text,"discount_value" numeric default 0,"services" jsonb default '[]'::jsonb,"created_at" timestamptz default now(),"updated_at" timestamptz default now(),primary key("id"));
alter table public.kp_forms enable row level security;
grant all on public.kp_forms to anon,authenticated,service_role;
create table public.project_stages("id" uuid default gen_random_uuid() not null,"project_id" uuid,"name" text not null,"due_date" date,"done" bool default false,"done_at" timestamptz,"sort_order" int4 default 0,"created_at" timestamptz default now(),primary key("id"));
alter table public.project_stages enable row level security;
grant all on public.project_stages to anon,authenticated,service_role;
create table public.project_cards("id" uuid default gen_random_uuid() not null,"project_number" text,"title" text not null,"floors" int4 default 2 not null,"total_area" text,"footprint" text,"beds" int4,"baths" int4,"price" text,"tags" jsonb default '[]'::jsonb,"floor1_area" text,"floor2_area" text,"expl1" jsonb default '[]'::jsonb,"expl2" jsonb default '[]'::jsonb,"images" jsonb default '[]'::jsonb,"created_at" timestamptz default now(),"updated_at" timestamptz default now(),"deleted_at" timestamptz,"thumbnails" jsonb,primary key("id"));
alter table public.project_cards enable row level security;
grant all on public.project_cards to anon,authenticated,service_role;
create table public.share_links("id" uuid default gen_random_uuid() not null,"label" text,"token" text not null,"floors_filter" text default 'all'::text,"created_at" timestamptz default now(),"deleted_at" timestamptz,"expires_at" timestamptz,"project_id" uuid,primary key("id"));
alter table public.share_links enable row level security;
grant all on public.share_links to anon,authenticated,service_role;
create table public.project_members("id" uuid default gen_random_uuid() not null,"project_id" uuid,"employee_id" uuid,"created_at" timestamptz default now(),primary key("id"));
alter table public.project_members enable row level security;
grant all on public.project_members to anon,authenticated,service_role;
create table public.login_attempts("id" int8 default nextval('login_attempts_id_seq'::regclass) not null,"employee_id" uuid not null,"attempted_at" timestamptz default now() not null,"success" bool not null,primary key("id"));
alter table public.login_attempts enable row level security;
grant all on public.login_attempts to anon,authenticated,service_role;
create table public.push_subscriptions("id" int8 default nextval('push_subscriptions_id_seq'::regclass) not null,"employee_id" uuid not null,"endpoint" text not null,"p256dh" text not null,"auth" text not null,"created_at" timestamptz default now() not null,"updated_at" timestamptz default now() not null,primary key("id"));
alter table public.push_subscriptions enable row level security;
grant all on public.push_subscriptions to anon,authenticated,service_role;
create table public.project_plans("id" uuid default gen_random_uuid() not null,"project_id" uuid not null,"project_name" text,"plan_data" jsonb not null,"updated_at" timestamptz default now() not null,primary key("id"));
alter table public.project_plans enable row level security;
grant all on public.project_plans to anon,authenticated,service_role;
create table public.employee_sessions("id" uuid default gen_random_uuid() not null,"employee_id" uuid not null,"token" text not null,"created_at" timestamptz default now() not null,"last_seen_at" timestamptz default now() not null,"expires_at" timestamptz default (now() + '30 days'::interval) not null,primary key("id"));
alter table public.employee_sessions enable row level security;
grant all on public.employee_sessions to anon,authenticated,service_role;
create table public.kp_catalog("id" uuid default gen_random_uuid() not null,"group_name" text not null,"name" text not null,"unit" text default 'м²'::text not null,"rate" numeric default 0 not null,"description" text,"sort_order" int4 default 0 not null,"deleted_at" timestamptz,"created_at" timestamptz default now() not null,"updated_at" timestamptz default now() not null,primary key("id"));
alter table public.kp_catalog enable row level security;
grant all on public.kp_catalog to anon,authenticated,service_role;
create table public.timesheet_payments("id" uuid default gen_random_uuid() not null,"employee_id" uuid not null,"month" text not null,"paid" bool default false not null,"paid_at" timestamptz,"created_at" timestamptz default now() not null,primary key("id"));
alter table public.timesheet_payments enable row level security;
grant all on public.timesheet_payments to anon,authenticated,service_role;
create table public.company_expenses("id" uuid default gen_random_uuid() not null,"category" text not null,"amount" numeric default 0 not null,"expense_date" date not null,"description" text,"deleted_at" timestamptz,"created_at" timestamptz default now() not null,primary key("id"));
alter table public.company_expenses enable row level security;
grant all on public.company_expenses to anon,authenticated,service_role;
create table public.company_income("id" uuid default gen_random_uuid() not null,"category" text not null,"amount" numeric not null,"income_date" date not null,"description" text,"created_at" timestamptz default now() not null,"deleted_at" timestamptz,primary key("id"));
alter table public.company_income enable row level security;
grant all on public.company_income to anon,authenticated,service_role;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant all on storage.objects to anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.current_session_employee()
 RETURNS TABLE(employee_id uuid, is_admin boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id, e.is_admin
  FROM public.employee_sessions s
  JOIN public.employees e ON e.id = s.employee_id
  WHERE s.token = COALESCE(NULLIF(current_setting('request.headers', true), '')::json ->> 'x-session-token', '')
    AND s.expires_at > now()
    AND e.deleted_at IS NULL
    AND (e.active IS NULL OR e.active = true)
  LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.has_admin_session()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ SELECT true; $function$
;
CREATE OR REPLACE FUNCTION public.has_session()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ SELECT true; $function$
;
create policy "audit_insert" on public.audit_log for INSERT to public with check (has_session());
create policy "audit_select" on public.audit_log for SELECT to public using (has_session());
create policy "categories_delete" on public.categories for DELETE to public using (has_admin_session());
create policy "categories_insert" on public.categories for INSERT to public with check (has_admin_session());
create policy "categories_select" on public.categories for SELECT to public using (has_session());
create policy "categories_update" on public.categories for UPDATE to public using (has_admin_session()) with check (has_admin_session());
create policy "company_expenses_all" on public.company_expenses for ALL to public using (true) with check (true);
create policy "company_income_delete" on public.company_income for DELETE to public using (true);
create policy "company_income_insert" on public.company_income for INSERT to public with check (true);
create policy "company_income_select" on public.company_income for SELECT to public using (true);
create policy "company_income_update" on public.company_income for UPDATE to public using (true);
create policy "company_info_delete" on public.company_info for DELETE to public using (has_admin_session());
create policy "company_info_insert" on public.company_info for INSERT to public with check (has_admin_session());
create policy "company_info_select" on public.company_info for SELECT to public using (has_session());
create policy "company_info_update" on public.company_info for UPDATE to public using (has_admin_session()) with check (has_admin_session());
create policy "departments_delete" on public.departments for DELETE to public using (has_admin_session());
create policy "departments_insert" on public.departments for INSERT to public with check (has_admin_session());
create policy "departments_select" on public.departments for SELECT to public using (has_session());
create policy "departments_update" on public.departments for UPDATE to public using (has_admin_session()) with check (has_admin_session());
create policy "employees_delete" on public.employees for DELETE to public using (has_admin_session());
create policy "employees_insert" on public.employees for INSERT to public with check (has_admin_session());
create policy "employees_select" on public.employees for SELECT to public using (true);
create policy "employees_update" on public.employees for UPDATE to public using (has_admin_session()) with check (has_admin_session());
create policy "expense_photos_delete" on public.expense_photos for DELETE to public using (has_session());
create policy "expense_photos_insert" on public.expense_photos for INSERT to public with check (has_session());
create policy "expense_photos_select" on public.expense_photos for SELECT to public using (has_session());
create policy "expense_photos_update" on public.expense_photos for UPDATE to public using (has_session()) with check (has_session());
create policy "invoices_delete" on public.invoices for DELETE to public using (has_session());
create policy "invoices_insert" on public.invoices for INSERT to public with check (has_session());
create policy "invoices_select" on public.invoices for SELECT to public using (has_session());
create policy "invoices_update" on public.invoices for UPDATE to public using (has_session()) with check (has_session());
create policy "kp_catalog_all" on public.kp_catalog for ALL to public using (true) with check (true);
create policy "kp_forms_delete" on public.kp_forms for DELETE to public using (has_session());
create policy "kp_forms_insert" on public.kp_forms for INSERT to public with check (has_session());
create policy "kp_forms_select" on public.kp_forms for SELECT to public using (has_session());
create policy "kp_forms_update" on public.kp_forms for UPDATE to public using (has_session()) with check (has_session());
create policy "ledger_delete" on public.ledger_entries for DELETE to public using (has_session());
create policy "ledger_insert" on public.ledger_entries for INSERT to public with check (has_session());
create policy "ledger_select" on public.ledger_entries for SELECT to public using (has_session());
create policy "ledger_update" on public.ledger_entries for UPDATE to public using (has_session()) with check (has_session());
create policy "project_cards_delete" on public.project_cards for DELETE to public using (has_admin_session());
create policy "project_cards_insert" on public.project_cards for INSERT to public with check (has_admin_session());
create policy "project_cards_select" on public.project_cards for SELECT to public using (true);
create policy "project_cards_update" on public.project_cards for UPDATE to public using (has_admin_session()) with check (has_admin_session());
create policy "project_members_delete" on public.project_members for DELETE to public using (has_session());
create policy "project_members_insert" on public.project_members for INSERT to public with check (has_session());
create policy "project_members_select" on public.project_members for SELECT to public using (has_session());
create policy "project_members_update" on public.project_members for UPDATE to public using (has_session()) with check (has_session());
create policy "project_plans_delete" on public.project_plans for DELETE to public using (has_session());
create policy "project_plans_insert" on public.project_plans for INSERT to public with check (has_session());
create policy "project_plans_select" on public.project_plans for SELECT to public using (has_session());
create policy "project_plans_update" on public.project_plans for UPDATE to public using (has_session()) with check (has_session());
create policy "project_stages_delete" on public.project_stages for DELETE to public using (has_session());
create policy "project_stages_insert" on public.project_stages for INSERT to public with check (has_session());
create policy "project_stages_select" on public.project_stages for SELECT to public using (has_session());
create policy "project_stages_update" on public.project_stages for UPDATE to public using (has_session()) with check (has_session());
create policy "projects_delete" on public.projects for DELETE to public using (has_session());
create policy "projects_insert" on public.projects for INSERT to public with check (has_session());
create policy "projects_select" on public.projects for SELECT to public using (has_session());
create policy "projects_update" on public.projects for UPDATE to public using (has_session()) with check (has_session());
create policy "push_subscriptions_delete" on public.push_subscriptions for DELETE to public using (has_session());
create policy "push_subscriptions_insert" on public.push_subscriptions for INSERT to public with check (has_session());
create policy "push_subscriptions_select" on public.push_subscriptions for SELECT to public using (has_session());
create policy "push_subscriptions_update" on public.push_subscriptions for UPDATE to public using (has_session()) with check (has_session());
create policy "share_links_delete" on public.share_links for DELETE to public using (has_admin_session());
create policy "share_links_insert" on public.share_links for INSERT to public with check (has_admin_session());
create policy "share_links_select" on public.share_links for SELECT to public using (true);
create policy "share_links_update" on public.share_links for UPDATE to public using (has_admin_session()) with check (has_admin_session());
create policy "statuses_delete" on public.statuses for DELETE to public using (has_admin_session());
create policy "statuses_insert" on public.statuses for INSERT to public with check (has_admin_session());
create policy "statuses_select" on public.statuses for SELECT to public using (has_session());
create policy "statuses_update" on public.statuses for UPDATE to public using (has_admin_session()) with check (has_admin_session());
create policy "timesheet_payments_all" on public.timesheet_payments for ALL to public using (true) with check (true);
create policy "tz_forms_delete" on public.tz_forms for DELETE to public using (has_session());
create policy "tz_forms_insert" on public.tz_forms for INSERT to public with check (has_session());
create policy "tz_forms_select" on public.tz_forms for SELECT to public using (has_session());
create policy "tz_forms_update" on public.tz_forms for UPDATE to public using (has_session()) with check (has_session());
create policy "tz_references_delete" on public.tz_references for DELETE to public using (has_session());
create policy "tz_references_insert" on public.tz_references for INSERT to public with check (has_session());
create policy "tz_references_select" on public.tz_references for SELECT to public using (has_session());
create policy "tz_references_update" on public.tz_references for UPDATE to public using (has_session()) with check (has_session());
create policy "Allow delete tz-references" on storage.objects for DELETE to public using ((bucket_id = 'tz-references'::text));
create policy "Allow uploads to tz-references" on storage.objects for INSERT to public with check ((bucket_id = 'tz-references'::text));
create policy "session delete expense-photos" on storage.objects for DELETE to public using (((bucket_id = 'expense-photos'::text) AND has_session()));
create policy "session delete tz-references" on storage.objects for DELETE to public using (((bucket_id = 'tz-references'::text) AND has_session()));
create policy "session read expense-photos" on storage.objects for SELECT to public using (((bucket_id = 'expense-photos'::text) AND has_session()));
create policy "session read tz-references" on storage.objects for SELECT to public using (((bucket_id = 'tz-references'::text) AND has_session()));
create policy "session upload expense-photos" on storage.objects for INSERT to public with check (((bucket_id = 'expense-photos'::text) AND has_session()));
grant select(id) on public.employees to anon,authenticated;
grant select(name) on public.employees to anon,authenticated;
grant select(role) on public.employees to anon,authenticated;
grant select(active) on public.employees to anon,authenticated;
grant select(created_at) on public.employees to anon,authenticated;
grant select(deleted_at) on public.employees to anon,authenticated;
grant select(is_admin) on public.employees to anon,authenticated;
grant select(can_edit_cards) on public.employees to anon,authenticated;
grant select(can_see_projects) on public.employees to anon,authenticated;
grant select(can_see_construction) on public.employees to anon,authenticated;
