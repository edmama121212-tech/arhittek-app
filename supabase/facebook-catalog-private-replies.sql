-- Separate Facebook Page comment private replies; does not change Instagram.
create table if not exists arhittek_marketing.facebook_replies (
  comment_id text primary key check (comment_id ~ '^[0-9_]{1,100}$'),
  page_id text not null check (page_id ~ '^[0-9]{1,50}$'),
  observed_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','sending','sent','failed','uncertain')),
  attempts integer not null default 0,
  lease uuid,
  message_id text,
  sender_name text,
  comment_text text,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table arhittek_marketing.facebook_replies enable row level security;
revoke all on arhittek_marketing.facebook_replies from public,anon,authenticated;
create index if not exists facebook_replies_updated_idx on arhittek_marketing.facebook_replies(updated_at);

create or replace function public.claim_facebook_catalog_reply(
  p_comment text,p_page text,p_observed timestamptz
) returns jsonb language plpgsql security definer set search_path = pg_catalog,pg_temp
as $fn$
declare r arhittek_marketing.facebook_replies; new_lease uuid:=gen_random_uuid();
begin
  if p_comment !~ '^[0-9_]{1,100}$' or p_page !~ '^[0-9]{1,50}$'
     or p_observed < now()-interval '3 days' or p_observed > now()+interval '5 minutes'
  then return jsonb_build_object('claimed',false); end if;
  insert into arhittek_marketing.facebook_replies(comment_id,page_id,observed_at)
    values(p_comment,p_page,p_observed) on conflict do nothing;
  select * into r from arhittek_marketing.facebook_replies where comment_id=p_comment for update;
  if r.page_id<>p_page or r.state in ('sent','failed','uncertain')
    then return jsonb_build_object('claimed',false,'state',r.state); end if;
  if r.state='sending' then
    if r.updated_at<now()-interval '2 minutes' then
      update arhittek_marketing.facebook_replies
         set state='uncertain',last_error='Ambiguous private reply requires reconciliation',updated_at=now()
       where comment_id=p_comment;
    end if;
    return jsonb_build_object('claimed',false,'state','sending');
  end if;
  update arhittek_marketing.facebook_replies
    set state='sending',lease=new_lease,attempts=attempts+1,updated_at=now()
    where comment_id=p_comment;
  return jsonb_build_object('claimed',true,'lease',new_lease);
end $fn$;

create or replace function public.finish_facebook_catalog_reply(
  p_comment text,p_lease uuid,p_state text,p_message text default null,
  p_error text default null,p_sender text default null,p_text text default null
) returns boolean language plpgsql security definer set search_path = pg_catalog,pg_temp
as $fn$
declare n integer;
begin
  if p_state not in ('pending','sent','failed','uncertain') then
    raise exception 'Invalid delivery state';
  end if;
  if p_state='sent' and nullif(p_message,'') is null then
    raise exception 'Confirmed reply requires message id';
  end if;
  update arhittek_marketing.facebook_replies
  set state=p_state,message_id=case when p_state='sent' then p_message else null end,
      last_error=left(p_error,200),updated_at=now(),
      sender_name=case when p_state='sent' then nullif(left(btrim(p_sender),100),'') else sender_name end,
      comment_text=case when p_state='sent' then nullif(left(btrim(p_text),500),'') else comment_text end
  where comment_id=p_comment and lease=p_lease and state='sending';
  get diagnostics n=row_count;
  return n=1;
end $fn$;

revoke all on function public.claim_facebook_catalog_reply(text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.finish_facebook_catalog_reply(text,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_facebook_catalog_reply(text,text,timestamptz) to service_role;
grant execute on function public.finish_facebook_catalog_reply(text,uuid,text,text,text,text,text) to service_role;
