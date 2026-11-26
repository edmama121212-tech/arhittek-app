begin;

-- A direct receipt internally creates and settles a one-off plan in one request.
-- Its calendar row is not a promise to receive money again after reversing it.
-- Reconstruct this relationship only from the immutable, server-written chain.
create index if not exists workspace_record_revision on arhittek_finance.workspace_requests(revision)
  where request->>'command'='record';
create index if not exists workspace_target_revision on arhittek_finance.workspace_requests
  ((coalesce(request#>>'{payload,key}',request#>>'{payload,id}')),revision);

create or replace function arhittek_finance.reversed_direct_record_plan(plan_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists (
    select 1
    from arhittek_finance.settlements s
    join arhittek_finance.workspace_requests pay on pay.id=s.source_id and pay.request->>'command'='pay'
    join arhittek_finance.workspace_requests parent on parent.revision=pay.revision and parent.actor=pay.actor and parent.request->>'command'='record'
    join arhittek_finance.workspace_requests origin on origin.id=plan_id and origin.actor=parent.actor and origin.revision<pay.revision
    join arhittek_finance.operations posting on posting.revision=pay.revision and posting.source_id=s.source_id and posting.source_table is not null
    join arhittek_finance.operations undo on undo.reverses=posting.id
    where s.plan_key=plan_id::text and pay.request#>>'{payload,key}'=s.plan_key
      and origin.request=jsonb_build_object('command','plan','payload',
        (parent.request->'payload')||jsonb_build_object('id',plan_id,'certainty','confirmed','due_date',parent.request#>>'{payload,date}'))
      -- Older versions exposed the erroneous row. Preserve any subsequent explicit choice (a new due date, link, payment or edit).
      and not exists(select 1 from arhittek_finance.workspace_requests later where later.revision>parent.revision
        and coalesce(later.request#>>'{payload,key}',later.request#>>'{payload,id}')=s.plan_key)
  );
$$;
revoke all on function arhittek_finance.reversed_direct_record_plan(uuid) from public,anon,authenticated;

do $patch$
declare
  body text:=pg_get_functiondef('arhittek_finance.workspace_items(date)'::regprocedure);
  before_text text:='if remaining>0 then result:=result||jsonb_build_array(to_jsonb(r)||jsonb_build_object(''key'',r.id::text';
  after_text text:='if remaining>0 and not arhittek_finance.reversed_direct_record_plan(r.id) then result:=result||jsonb_build_array(to_jsonb(r)||jsonb_build_object(''key'',r.id::text';
begin
  if strpos(body,after_text)>0 then return;end if;
  if strpos(body,before_text)=0 then raise exception 'Unknown calendar plan reader';end if;
  execute replace(body,before_text,after_text);
end $patch$;
commit;
