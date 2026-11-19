begin;
set local lock_timeout = '5s';
select 1 from arhittek_finance.settings where singleton for update;

-- post is private. Source triggers and both owner RPC families share this lock.
-- Read the balances only after taking it, including when called by a future writer.
create or replace function arhittek_finance.post(
  op uuid, kind text, reason text, delta numeric, changes jsonb,
  request jsonb default '{}', src text default null, sid uuid default null, rev uuid default null
) returns uuid language plpgsql set search_path='' as $$
declare
  actor_id uuid := arhittek_finance.actor();
  balances jsonb;
  account text;
  change numeric;
  available numeric;
  change_total numeric := 0;
  next_revision bigint;
  counted boolean := false;
  payload jsonb := request->'payload';
begin
  if op is null or length(trim(coalesce(reason,'')))<3 then
    raise sqlstate '22023' using message='Укажите причину операции';
  end if;
  perform arhittek_finance.money(delta);
  perform 1 from arhittek_finance.settings where singleton for update;
  balances := arhittek_finance.balances();

  if request->>'command'=kind and payload->>'confirmed'='true' then
    -- These are the server's opening count, the previous all-money count, and
    -- the workspace count. A comment/category from an expense never qualifies.
    if kind='activate' then
      counted := balances='{}'::jsonb and delta=(payload->>'cash')::numeric and delta>=0;
    elsif kind='reconcile' then
      counted := (payload->>'cash')::numeric>=0 and changes=jsonb_build_object('reserve',delta)
        and (payload->>'cash')::numeric=delta+(select coalesce(sum(value::numeric),0) from jsonb_each_text(balances));
    elsif kind='wallet_reconcile' and op=sid and changes=jsonb_build_object('reserve',delta) then
      select exists (
        select 1 from arhittek_finance.settlements s
        where s.source_id=op and s.plan_key='wallet_reconcile:'||op and s.funding='reserve'
          and s.wallet_id=(payload->>'wallet_id')::uuid and s.amount=abs(delta)
          and (payload->>'target')::numeric>=0
          and arhittek_finance.wallet_balance(s.wallet_id)+delta=(payload->>'target')::numeric
      ) into counted;
    end if;
  end if;

  for account,change in select key,value::numeric from jsonb_each_text(changes) loop
    perform arhittek_finance.money(change);
    available := arhittek_finance.amount(balances,account);
    if change<0 and available+change<0 and not (account='reserve' and counted is true) then
      if account='reserve' then
        raise sqlstate '23514' using message=format('Недостаточно свободных денег. Доступно %s ₽, требуется %s ₽.',greatest(0,available),-change);
      end if;
      raise sqlstate '23514' using message=format('Недостаточно средств в выбранном резервировании. Доступно %s ₽, требуется %s ₽.',greatest(0,available),-change);
    end if;
    balances := arhittek_finance.add(balances,account,change);
    change_total := change_total+change;
  end loop;
  if change_total<>delta then
    raise sqlstate '23514' using message='Распределение не совпадает с движением денег';
  end if;
  if delta<0 and (select coalesce(sum(value::numeric),0) from jsonb_each_text(balances))<0 then
    raise sqlstate '23514' using message='В журнале недостаточно общих денег для выплаты';
  end if;
  update arhittek_finance.settings set revision=revision+1 where singleton returning revision into next_revision;
  insert into arhittek_finance.operations(id,revision,kind,reason,actor,cash_delta,changes,balances_after,request,source_table,source_id,reverses)
    values(op,next_revision,kind,reason,actor_id,delta,changes,balances,request,src,sid,rev);
  return op;
end $$;

-- The original wallet code rejects even a CREDIT to a legacy negative wallet.
-- Keep its routing and transfer checks. Only an outgoing debit must fit.
do $patch$
declare
  target regprocedure;
  definition text;
  old_guard text;
  new_guard text;
begin
  for target,old_guard,new_guard in values
    ('arhittek_finance.wallet_capture()'::regprocedure,
     'if arhittek_finance.wallet_balance(w)+new.cash_delta<0 then',
     'if new.cash_delta<0 and arhittek_finance.wallet_balance(w)+new.cash_delta<0 then'),
    ('arhittek_finance.wallet_capture()'::regprocedure,
     $old$message='Недостаточно денег на выбранном счёте. Уточните счёт или сначала оформите перевод.'$old$,
     $new$message=format('Недостаточно денег в месте хранения. Доступно %s ₽, требуется %s ₽.',greatest(0,arhittek_finance.wallet_balance(w)),-new.cash_delta)$new$),
    ('arhittek_finance.workspace_command_before_zero_start(text,jsonb,uuid,bigint)'::regprocedure,
     'if arhittek_finance.wallet_balance(w)+a<0 then',
     'if a<0 and arhittek_finance.wallet_balance(w)+a<0 then'),
    ('arhittek_finance.workspace_command_before_zero_start(text,jsonb,uuid,bigint)'::regprocedure,
     'w:=(p->>''wallet_id'')::uuid;a:=arhittek_finance.money((p->>''target'')::numeric);',
     $target$w:=(p->>'wallet_id')::uuid;a:=arhittek_finance.money((p->>'target')::numeric);
       if a<0 then raise sqlstate '22023' using message='Введите остаток не меньше нуля'; end if;$target$),
    ('arhittek_finance.command_before_zero_start(text,jsonb,uuid,bigint)'::regprocedure,
     'if cmd=''activate'' then',
     $target$if cmd in ('adjust_reserve','adjust_reserve_legacy') and (p->>'target')::numeric<0 then
       raise sqlstate '22023' using message='Введите остаток не меньше нуля';
     end if;
     if cmd='activate' then$target$)
  loop
    definition := pg_get_functiondef(target);
    if position(new_guard in definition)=0 then
      if position(old_guard in definition)=0 then
        raise exception 'Unrecognized wallet guard in %',target;
      end if;
      execute replace(definition,old_guard,new_guard);
    end if;
  end loop;
end $patch$;
commit;
