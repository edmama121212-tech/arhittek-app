alter table public.company_info
  add column office_address text not null default 'г. Грозный, ул. Умара Гимаева, 14' check (char_length(office_address) <= 300);
notify pgrst, 'reload schema';
