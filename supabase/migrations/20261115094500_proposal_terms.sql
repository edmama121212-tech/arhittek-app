alter table public.kp_forms
  add column client_comment text not null default '' check (char_length(client_comment) <= 2000),
  add column advance_percent smallint not null default 50 check (advance_percent in (50,100));
notify pgrst, 'reload schema';
