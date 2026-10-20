begin;
set local role anon;
select set_config('request.headers','{}',true);
select jsonb_build_object(
  'valid_session',public.has_session(),
  'admin_session',public.has_admin_session(),
  'visible_projects',(select count(*) from public.projects),
  'visible_ledger_entries',(select count(*) from public.ledger_entries),
  'visible_company_expenses',(select count(*) from public.company_expenses),
  'visible_company_income',(select count(*) from public.company_income),
  'can_select_employee_pin',has_column_privilege(current_user,'public.employees','pin_code','SELECT'),
  'can_select_employee_salary',has_column_privilege(current_user,'public.employees','fixed_salary','SELECT'),
  'can_truncate_projects',has_table_privilege(current_user,'public.projects','TRUNCATE'),
  'can_read_raw_sessions',has_table_privilege(current_user,'public.employee_sessions','SELECT'),
  'login_options_available',(select count(*) from public.get_employee_login_options())
) as anonymous_postflight;
rollback;
