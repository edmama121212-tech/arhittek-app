-- Keep the identity of a settled instalment visible after it leaves the calendar.
-- Extend only the existing owner-authorized query. Its active-link filters remain in place.
do $migration$
declare
  fn regprocedure := 'arhittek_finance.workspace_before_zero_start()'::regprocedure;
  def text := pg_get_functiondef(fn);
  original text := $old$'links',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from arhittek_finance.calendar_links l where l.reverses is null$old$;
  expanded text := $new$'links',(
    select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
      'plan_label', coalesce(p.label,r.label),
      'plan_month', case when r.id is not null then split_part(l.plan_key,':',3) end,
      'due_date', case
        when dates.plan_key is not null then dates.due_date
        when r.id is not null then (split_part(l.plan_key,':',3)||'-01')::date + (r.due_day-1)
        else p.due_date end,
      'source_reason', source.reason,
      'source_revision', source.revision
    ) order by l.created_at desc,l.id), '[]')
    from arhittek_finance.calendar_links l
    join arhittek_finance.operations source on source.id=l.source_operation
    left join arhittek_finance.plans p on p.id=case
      when strpos(l.plan_key,':')=0 then l.plan_key::uuid end
    left join arhittek_finance.rules r on r.id=case
      when split_part(l.plan_key,':',1)='rule' then split_part(l.plan_key,':',2)::uuid end
    left join arhittek_finance.occurrence_dates dates on dates.plan_key=l.plan_key
    where l.reverses is null$new$;
begin
  if strpos(def,expanded)>0 then return; end if;
  if strpos(def,original)=0 then raise exception 'Unexpected active calendar links query'; end if;
  execute replace(def,original,expanded);
end
$migration$;
