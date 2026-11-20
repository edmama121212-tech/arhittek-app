-- Wallet creation through workspace_command already holds the settings row lock.
-- Validate new names without changing identifiers or rewriting existing wallets.
create or replace function arhittek_finance.validate_new_wallet_name()
returns trigger language plpgsql set search_path='' as $$
begin
  new.name := trim(regexp_replace(replace(new.name,chr(160),' '),'[[:space:]]+',' ','g'));
  if coalesce(length(new.name),0) not between 1 and 120 then
    raise sqlstate '22023' using message='Введите название длиной от 1 до 120 символов';
  end if;
  if exists (
    select 1 from arhittek_finance.wallets w
    where w.active and lower(trim(regexp_replace(replace(
      case when w.is_default then 'Сейф' else w.name end,chr(160),' '),'[[:space:]]+',' ','g'))) = lower(new.name)
  ) then
    raise sqlstate '22023' using message='Это название уже используется. Введите другое название.';
  end if;
  return new;
end
$$;
revoke all on function arhittek_finance.validate_new_wallet_name() from public;
create or replace trigger validate_new_wallet_name before insert on arhittek_finance.wallets
for each row when (new.is_default is not true) execute function arhittek_finance.validate_new_wallet_name();
