-- Preserve the ability to close a legacy rule. New salary periods always represent a payout.
create or replace function arhittek_finance.validate_salary_rule_direction()
returns trigger language plpgsql set search_path='' as $$
begin
  raise sqlstate '22023' using message='Оклад сотрудника учитывается как расход';
end
$$;
revoke all on function arhittek_finance.validate_salary_rule_direction() from public;
create or replace trigger validate_salary_rule_direction before insert or update of direction, employee_id
on arhittek_finance.rules for each row when (new.employee_id is not null and new.direction<>'expense')
execute function arhittek_finance.validate_salary_rule_direction();
