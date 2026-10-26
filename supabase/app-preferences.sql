begin;
create schema if not exists arhittek_settings;
revoke all on schema arhittek_settings from public,anon,authenticated;
create table if not exists arhittek_settings.current(singleton boolean primary key default true check(singleton),revision bigint not null default 0,values jsonb not null default '{}');
insert into arhittek_settings.current(singleton) values(true) on conflict do nothing;
create table if not exists arhittek_settings.history(id uuid primary key,revision bigint unique not null,actor uuid not null,created_at timestamptz not null default clock_timestamp(),reason text not null,values jsonb not null,request jsonb not null);
alter table arhittek_settings.current enable row level security;
alter table arhittek_settings.history enable row level security;
revoke all on all tables in schema arhittek_settings from public,anon,authenticated;
create or replace function arhittek_settings.spec() returns jsonb language sql immutable set search_path='' as $$ select '{"project_category": {"group": "Проекты", "label": "Категория нового проекта", "type": "category", "default": ""}, "project_status": {"group": "Проекты", "label": "Статус нового проекта", "type": "status", "default": ""}, "project_days": {"group": "Проекты", "label": "Срок нового проекта, календарных дней (0 — вручную)", "type": "number", "default": 0, "min": 0, "max": 730, "integer": true}, "project_start_today": {"group": "Проекты", "label": "Начинать новый проект сегодняшним числом", "type": "boolean", "default": false}, "project_notes": {"group": "Проекты", "label": "Заметка для новых проектов", "type": "text", "default": "", "maxlen": 2000}, "contract_advance": {"group": "Договоры", "label": "Аванс в новом договоре, %", "type": "number", "default": 50, "min": 0, "max": 100}, "contract_days": {"group": "Договоры", "label": "Срок нового договора, календарных дней (0 — вручную)", "type": "number", "default": 0, "min": 0, "max": 730, "integer": true}, "contract_customer": {"group": "Договоры", "label": "Заказчик в новом договоре", "type": "enum", "default": "individual", "options": {"individual": "Физлицо", "legal": "Юрлицо"}}, "scope_ar": {"group": "Договоры", "label": "Состав работ: Архитектура (пусто — стандартный)", "type": "text", "default": "", "maxlen": 6000}, "scope_di": {"group": "Договоры", "label": "Состав работ: Дизайн интерьера (пусто — стандартный)", "type": "text", "default": "", "maxlen": 6000}, "scope_st": {"group": "Договоры", "label": "Состав работ: Строительство / ремонт (пусто — стандартный)", "type": "text", "default": "", "maxlen": 6000}, "kp_deadline": {"group": "КП", "label": "Срок выполнения для новых КП", "type": "text", "default": "", "maxlen": 200}, "kp_start": {"group": "КП", "label": "Начало работ для новых КП", "type": "text", "default": "", "maxlen": 200}, "kp_discount": {"group": "КП", "label": "Скидка в новом КП, %", "type": "number", "default": 0, "min": 0, "max": 100}, "kp_payment": {"group": "КП", "label": "Способ оплаты нового КП", "type": "enum", "default": "account", "options": {"account": "Расчётный счёт", "card": "Карта", "cash": "Наличные"}}, "team_rate": {"group": "Сотрудники и выплаты", "label": "Начальная ставка в форме добавления исполнителя, ₽/м²", "type": "number", "default": 400, "min": 0, "max": 1000000, "private": true}, "employee_salary": {"group": "Сотрудники и выплаты", "label": "Оклад нового сотрудника, ₽", "type": "number", "default": 0, "min": 0, "max": 10000000, "private": true}, "plan_rent": {"group": "Планирование финансов", "label": "План аренды офиса, ₽/месяц", "type": "number", "default": 110000, "min": 0, "max": 100000000, "private": true}, "plan_internet": {"group": "Планирование финансов", "label": "План интернета, ₽/месяц", "type": "number", "default": 2500, "min": 0, "max": 100000000, "private": true}, "plan_sublease": {"group": "Планирование финансов", "label": "План сдачи помещения, ₽/месяц", "type": "number", "default": 20000, "min": 0, "max": 100000000, "private": true}, "forecast_months": {"group": "Планирование финансов", "label": "Количество месяцев в прогнозе", "type": "number", "default": 6, "min": 1, "max": 24, "integer": true, "private": true}, "notify_overdue": {"group": "Уведомления", "label": "Уведомления о просрочках", "type": "boolean", "default": true}, "notify_rent": {"group": "Уведомления", "label": "Напоминание о сдаче помещений", "type": "boolean", "default": true, "private": true}, "notify_prompts": {"group": "Уведомления", "label": "Предлагать включить уведомления", "type": "boolean", "default": true}, "reduce_motion": {"group": "Внешний вид", "label": "Уменьшить анимации", "type": "boolean", "default": false}, "density": {"group": "Внешний вид", "label": "Плотность карточек", "type": "enum", "default": "comfortable", "options": {"comfortable": "Обычная", "compact": "Компактная"}}, "text_scale": {"group": "Внешний вид", "label": "Размер текста, %", "type": "number", "default": 100, "min": 90, "max": 125, "integer": true}}'::jsonb $$;
create or replace function arhittek_settings.read() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor record; result jsonb; vals jsonb; begin
 select * into actor from arhittek_security.session_employee();
 if actor.employee_id is null then raise insufficient_privilege using message='Требуется вход'; end if;
 select values into vals from arhittek_settings.current where singleton;
 if not actor.is_admin then select coalesce(jsonb_object_agg(key,value),'{}') into vals from jsonb_each(vals) where coalesce((arhittek_settings.spec()->key->>'private')::boolean,false)=false; end if;
 select jsonb_build_object('version',1,'revision',revision,'values',vals) into result from arhittek_settings.current where singleton;
 if actor.is_admin then result:=result||jsonb_build_object('history',coalesce((select jsonb_agg(to_jsonb(h) order by revision desc) from (select x.id,x.revision,x.actor,x.created_at,x.reason,x.values from arhittek_settings.history x order by x.revision desc limit 50) h),'[]'));end if;
 return result;
end $$;
create or replace function arhittek_settings.save(p_values jsonb,p_revision bigint,p_operation uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor record; cfg arhittek_settings.current; prev arhittek_settings.history; k text; v jsonb; spec jsonb:=arhittek_settings.spec(); def jsonb; x numeric; req jsonb:=jsonb_build_object('values',p_values,'reason',p_reason);
begin
 select * into actor from arhittek_security.session_employee();
 if actor.employee_id is null or not actor.is_admin then raise insufficient_privilege using message='Настройки изменяет только Мансур';end if;
 select * into cfg from arhittek_settings.current where singleton for update;
 select * into prev from arhittek_settings.history where id=p_operation;
 if found then if prev.request is distinct from req then raise sqlstate '23514' using message='Повтор с другими данными';end if;return arhittek_settings.read();end if;
 if p_operation is null or cfg.revision is distinct from p_revision then raise sqlstate '40001' using message='Настройки изменились на другом устройстве. Обновите страницу настроек';end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>64000 then raise sqlstate '22023' using message='Некорректные настройки';end if;
 if p_reason is null or length(trim(p_reason))<3 or length(p_reason)>500 then raise sqlstate '22023' using message='Укажите причину изменения (3–500 символов)';end if;
 for k,v in select * from jsonb_each(p_values) loop
  def:=spec->k;if def is null or v='null'::jsonb then raise sqlstate '22023' using message='Неизвестная настройка: '||k;end if;
  if def->>'type'='number' then
   if jsonb_typeof(v)<>'number' then raise sqlstate '22023' using message='Нужно число: '||k;end if;
   x:=v::text::numeric;if x<(def->>'min')::numeric or x>(def->>'max')::numeric or x<>round(x,2) or (coalesce((def->>'integer')::boolean,false) and x<>trunc(x)) then raise sqlstate '22023' using message='Недопустимое значение: '||k;end if;
  elsif def->>'type'='boolean' then
   if jsonb_typeof(v)<>'boolean' then raise sqlstate '22023' using message='Нужен переключатель: '||k;end if;
  else
   if jsonb_typeof(v)<>'string' or length(v#>>'{}')>coalesce((def->>'maxlen')::int,200) then raise sqlstate '22023' using message='Некорректный текст: '||k;end if;
   if def->>'type'='enum' and not (def->'options' ? (v#>>'{}')) then raise sqlstate '22023' using message='Неизвестный вариант: '||k;end if;
   if def->>'type'='category' and (v#>>'{}')<>'' and not exists(select 1 from public.categories where id::text=(v#>>'{}') and deleted_at is null) then raise sqlstate '22023' using message='Категория недоступна';end if;
   if def->>'type'='status' and (v#>>'{}')<>'' and not exists(select 1 from public.statuses where id::text=(v#>>'{}') and name!~* 'заверш') then raise sqlstate '22023' using message='Выберите незавершённый статус';end if;
  end if;
 end loop;
 insert into arhittek_settings.history(id,revision,actor,reason,values,request) values(p_operation,cfg.revision+1,actor.employee_id,trim(p_reason),p_values,req);
 update arhittek_settings.current set revision=cfg.revision+1,values=p_values where singleton;
 return arhittek_settings.read();
end $$;
create or replace function public.get_app_preferences() returns jsonb language sql stable security invoker set search_path='' as $$ select arhittek_settings.read() $$;
create or replace function public.save_app_preferences(p_values jsonb,p_revision bigint,p_operation uuid,p_reason text) returns jsonb language sql security invoker set search_path='' as $$ select arhittek_settings.save(p_values,p_revision,p_operation,p_reason) $$;
revoke all on all functions in schema arhittek_settings from public;
revoke all on function public.get_app_preferences(),public.save_app_preferences(jsonb,bigint,uuid,text) from public;
grant usage on schema arhittek_settings to anon,authenticated,service_role;
grant execute on function arhittek_settings.read(),arhittek_settings.save(jsonb,bigint,uuid,text),public.get_app_preferences(),public.save_app_preferences(jsonb,bigint,uuid,text) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
