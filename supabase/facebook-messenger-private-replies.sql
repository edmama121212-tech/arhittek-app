create table if not exists arhittek_marketing.facebook_message_replies (
  page_id text not null check(page_id ~ '^[0-9]{1,50}$'),
  sender_id text not null check(sender_id ~ '^[0-9]{1,100}$'),
  incoming_mid text not null,
  state text not null default 'pending' check(state in ('pending','sending','sent','failed','uncertain')),
  attempts integer not null default 0,
  lease uuid,
  sent_mid text,
  sent_at timestamptz,
  expires_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (page_id,sender_id)
);
alter table arhittek_marketing.facebook_message_replies enable row level security;
revoke all on arhittek_marketing.facebook_message_replies from public,anon,authenticated;
create index if not exists facebook_message_replies_updated_idx on arhittek_marketing.facebook_message_replies(updated_at);

create or replace function public.claim_facebook_message_catalog_reply(
  p_page text,p_sender text,p_incoming_mid text,p_event_time timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp
as $fn$
declare r arhittek_marketing.facebook_message_replies;
  new_lease uuid:=gen_random_uuid();
begin
  if p_page !~ '^[0-9]{1,50}$' or p_sender !~ '^[0-9]{1,100}$'
     or length(coalesce(p_incoming_mid,'')) not between 1 and 200
     or p_event_time < now()-interval '24 hours'
     or p_event_time > now()+interval '5 minutes'
  then return jsonb_build_object('claimed',false);end if;
  insert into arhittek_marketing.facebook_message_replies(page_id,sender_id,incoming_mid)
    values(p_page,p_sender,p_incoming_mid) on conflict do nothing;
  select * into r from arhittek_marketing.facebook_message_replies
    where page_id=p_page and sender_id=p_sender for update;
  if r.state='sent' and r.expires_at>now() then
    return jsonb_build_object('claimed',false,'state','sent');end if;
  if r.state='uncertain' or r.state='failed' then
    return jsonb_build_object('claimed',false,'state',r.state);end if;
  if r.state='sending' then
    if r.updated_at<now()-interval '2 minutes' then
      update arhittek_marketing.facebook_message_replies
        set state='uncertain',last_error='Ambiguous network delivery; manual reconciliation',updated_at=now()
        where page_id=p_page and sender_id=p_sender;
    end if;
    return jsonb_build_object('claimed',false,'state','sending');end if;
  update arhittek_marketing.facebook_message_replies
    set state='sending',lease=new_lease,attempts=attempts+1,
        incoming_mid=p_incoming_mid,updated_at=now()
    where page_id=p_page and sender_id=p_sender;
  return jsonb_build_object('claimed',true,'lease',new_lease);
end $fn$;

create or replace function public.finish_facebook_message_catalog_reply(
  p_page text,p_sender text,p_lease uuid,p_state text,
  p_sent_mid text default null,p_error text default null
) returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp
as $fn$
declare n integer;
begin
  if p_state not in ('pending','sent','failed','uncertain') then
    raise exception 'Invalid state';end if;
  if p_state='sent' and nullif(p_sent_mid,'') is null then
    raise exception 'Confirmed delivery requires message id';end if;
  update arhittek_marketing.facebook_message_replies
    set state=p_state,sent_mid=case when p_state='sent' then p_sent_mid else sent_mid end,
        sent_at=case when p_state='sent' then now() else sent_at end,
        expires_at=case when p_state='sent' then now()+interval '48 hours' else expires_at end,
        last_error=left(p_error,200),updated_at=now()
  where page_id=p_page and sender_id=p_sender and lease=p_lease and state='sending';
  get diagnostics n=row_count;
  return n=1;
end $fn$;

revoke all on function public.claim_facebook_message_catalog_reply(text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.finish_facebook_message_catalog_reply(text,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_facebook_message_catalog_reply(text,text,text,timestamptz) to service_role;
grant execute on function public.finish_facebook_message_catalog_reply(text,text,uuid,text,text,text) to service_role;
