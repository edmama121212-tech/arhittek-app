-- One reporting row per Meta-confirmed reply, including repeat contacts after 48h.
create table if not exists arhittek_marketing.facebook_sheet_deliveries (
  page_id text not null,
  channel text not null check(channel in ('comment','messenger')),
  event_id text not null,
  sent_at timestamptz not null default now(),
  customer text,
  incoming_text text,
  expires_at timestamptz not null,
  primary key (page_id,channel,event_id)
);
alter table arhittek_marketing.facebook_sheet_deliveries enable row level security;
revoke all on arhittek_marketing.facebook_sheet_deliveries from public,anon,authenticated;

create or replace function public.confirm_facebook_report_delivery(
  p_page text,p_channel text,p_event text,p_sender text,p_text text,
  p_lease uuid,p_message text,p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp
as $$
declare finished boolean;
begin
  if p_channel='comment' then
    if not exists(select 1 from arhittek_marketing.facebook_replies
        where page_id=p_page and comment_id=p_event and lease=p_lease) then return false; end if;
    finished:=public.finish_facebook_catalog_reply(p_event,p_lease,'sent',p_message,null,p_sender,p_text);
  elsif p_channel='messenger' then
    if not exists(select 1 from arhittek_marketing.facebook_message_replies
        where page_id=p_page and sender_id=p_sender and incoming_mid=p_event and lease=p_lease) then return false; end if;
    finished:=public.finish_facebook_message_catalog_reply(p_page,p_sender,p_lease,'sent',p_message,null);
  else
    raise exception 'Unexpected Facebook channel';
  end if;
  if finished then
    insert into arhittek_marketing.facebook_sheet_deliveries(page_id,channel,event_id,customer,incoming_text,expires_at)
      values(p_page,p_channel,p_event,nullif(left(p_sender,100),''),nullif(left(p_text,500),''),p_expires_at)
      on conflict(page_id,channel,event_id) do nothing;
  end if;
  return finished;
end $$;
revoke all on function public.confirm_facebook_report_delivery(text,text,text,text,text,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.confirm_facebook_report_delivery(text,text,text,text,text,uuid,text,timestamptz) to service_role;
