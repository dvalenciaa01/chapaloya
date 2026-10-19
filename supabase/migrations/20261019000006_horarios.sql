-- ==========================================================================
-- Reservalope · Migración 6 · Horarios por barbería, por barbero y por fecha
-- --------------------------------------------------------------------------
-- Antes todas las barberías usaban una lista fija de horas (tenants.time_slots)
-- los 7 días. Ahora cada administrador define:
--   1. El horario semanal de la barbería (tenants.schedule): qué días abre,
--      en qué tramos (p. ej. 09:00–13:00 y 14:00–20:30) y cada cuántos minutos
--      empieza una cita. También hasta cuántos días adelante se puede reservar.
--   2. El horario semanal de cada barbero (barbers.schedule). Vacío = trabaja
--      todo el horario de la barbería. El horario del barbero siempre queda
--      DENTRO del de la barbería.
--   3. Fechas especiales (public.schedule_exceptions): feriados o días con
--      otro horario para toda la barbería, o el día libre de un barbero.
--
-- Formato de un día: lista de tramos [desde, hasta] en "HH:MM".
--   []                                   → cerrado / no trabaja
--   [["09:00","13:00"],["14:00","20:30"]] → dos tramos
-- "hasta" es la hora de cierre: la última cita empieza "intervalo" minutos antes.
-- tenants.time_slots se conserva solo por compatibilidad; ya no se usa.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Validación del formato
-- --------------------------------------------------------------------------
create or replace function private.valid_ranges(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  r jsonb;
  prev_to time := null;
  f time;
  t time;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 3 then
    return false;
  end if;
  for r in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(r) <> 'array' or jsonb_array_length(r) <> 2
       or coalesce(r ->> 0, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(r ->> 1, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return false;
    end if;
    f := (r ->> 0)::time;
    t := (r ->> 1)::time;
    if f >= t or (prev_to is not null and f < prev_to) then
      return false;                                 -- tramos en orden y sin cruzarse
    end if;
    prev_to := t;
  end loop;
  return true;
end $$;

create or replace function private.valid_week(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  for k in select jsonb_object_keys(p) loop
    if k !~ '^[0-6]$' or not private.valid_ranges(p -> k) then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- Horario que recibe cada barbería: todos los días, 09:00–13:00 y 14:00–20:30, citas cada 30 min
create or replace function private.default_schedule()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'interval', 30,
    'maxDays', 60,
    'week', (select jsonb_object_agg(d::text, '[["09:00","13:00"],["14:00","20:30"]]'::jsonb)
             from generate_series(0, 6) d)
  )
$$;

-- --------------------------------------------------------------------------
-- Columnas y tabla nuevas
-- --------------------------------------------------------------------------
alter table public.tenants
  add column if not exists schedule jsonb not null default private.default_schedule();
alter table public.tenants
  add constraint tenants_schedule_valid check (
    jsonb_typeof(schedule) = 'object'
    and (schedule ->> 'interval') in ('10', '15', '20', '30', '45', '60', '90', '120')
    and (schedule ->> 'maxDays') ~ '^[0-9]{1,3}$'
    and (schedule ->> 'maxDays')::int between 1 and 365
    and private.valid_week(schedule -> 'week'));

alter table public.barbers
  add column if not exists schedule jsonb;            -- null = horario de la barbería
alter table public.barbers
  add constraint barbers_schedule_valid check (
    schedule is null or (jsonb_typeof(schedule) = 'object' and private.valid_week(schedule -> 'week')));

create table public.schedule_exceptions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  barber_id  uuid,                                   -- null = toda la barbería
  date       date not null,
  ranges     jsonb not null default '[]' check (private.valid_ranges(ranges)),  -- [] = cerrado
  note       text not null default '' check (length(note) <= 80),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, barber_id) references public.barbers (tenant_id, id) on delete cascade,
  unique nulls not distinct (tenant_id, barber_id, date)
);
create index schedule_exceptions_tenant_date on public.schedule_exceptions (tenant_id, date);

alter table public.schedule_exceptions enable row level security;
revoke all on public.schedule_exceptions from anon;
grant select, insert, update, delete on public.schedule_exceptions to authenticated;

create policy schedule_exceptions_select on public.schedule_exceptions for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy schedule_exceptions_write on public.schedule_exceptions for all to authenticated
  using ((select private.is_tenant_admin(tenant_id)))
  with check ((select private.is_tenant_admin(tenant_id)));

-- --------------------------------------------------------------------------
-- Cálculo de horarios
-- --------------------------------------------------------------------------
-- Horas de inicio que caben en los tramos: desde, desde+intervalo… hasta (cierre − intervalo)
create or replace function private.ranges_slots(p_ranges jsonb, p_interval int)
returns time[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(s order by s), '{}')
  from (
    select distinct (gs)::time as s
    from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) r
    cross join lateral generate_series(
      ('2000-01-01'::date + (r ->> 0)::time),
      ('2000-01-01'::date + (r ->> 1)::time) - make_interval(mins => p_interval),
      make_interval(mins => p_interval)) gs
  ) x
$$;

-- ¿La cita que empieza a p_slot cabe completa en alguno de los tramos?
create or replace function private.slot_fits(p_slot time, p_interval int, p_ranges jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) r
    where p_slot >= (r ->> 0)::time
      and ('2000-01-01'::date + p_slot) + make_interval(mins => p_interval)
          <= ('2000-01-01'::date + (r ->> 1)::time))
$$;

-- Horarios de un barbero en una fecha. Mismo cálculo que DB.slotsFor() en js/data/db.js:
--   barbería  = fecha especial de la barbería, o su horario semanal
--   barbero   = su fecha especial, o su horario semanal (si tiene uno propio)
--   resultado = horarios de la barbería que caben en el horario del barbero
create or replace function private.horario_slots(p_tenant uuid, p_barber uuid, p_date date)
returns time[] language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  v_dow text := extract(dow from p_date)::int::text;
  v_interval int;
  v_shop jsonb;
  v_barber jsonb;
  v_slots time[];
begin
  select * into t from public.tenants where id = p_tenant;
  if t.id is null then
    return '{}';
  end if;
  v_interval := coalesce((t.schedule ->> 'interval')::int, 30);

  select e.ranges into v_shop from public.schedule_exceptions e
  where e.tenant_id = p_tenant and e.barber_id is null and e.date = p_date;
  if v_shop is null then
    v_shop := coalesce(t.schedule -> 'week' -> v_dow, '[]'::jsonb);
  end if;
  v_slots := private.ranges_slots(v_shop, v_interval);

  if p_barber is not null then
    select e.ranges into v_barber from public.schedule_exceptions e
    where e.tenant_id = p_tenant and e.barber_id = p_barber and e.date = p_date;
    if v_barber is null then
      select coalesce(b.schedule -> 'week' -> v_dow, case when b.schedule is null then null else '[]'::jsonb end)
        into v_barber
      from public.barbers b where b.id = p_barber and b.tenant_id = p_tenant;
    end if;
    if v_barber is not null then
      select coalesce(array_agg(s order by s), '{}') into v_slots
      from unnest(v_slots) s
      where private.slot_fits(s, v_interval, v_barber);
    end if;
  end if;
  return v_slots;
end $$;

revoke all on function private.valid_ranges(jsonb) from public;
revoke all on function private.valid_week(jsonb) from public;
revoke all on function private.default_schedule() from public;
revoke all on function private.ranges_slots(jsonb, int) from public;
revoke all on function private.slot_fits(time, int, jsonb) from public;
revoke all on function private.horario_slots(uuid, uuid, date) from public;
grant execute on function private.valid_ranges(jsonb), private.valid_week(jsonb), private.default_schedule(),
  private.ranges_slots(jsonb, int), private.slot_fits(time, int, jsonb), private.horario_slots(uuid, uuid, date)
  to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Validación de cada cita: ahora con el horario del día y del barbero
-- (misma función de la migración 3; solo cambian las reglas de horario)
-- --------------------------------------------------------------------------
create or replace function private.appointments_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  b public.barbers;
  s public.services;
  local_now timestamp;
  slot_changed boolean;
  v_max int;
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Una cita no puede cambiar de barbería.' using errcode = '42501';
    end if;
    new.code := old.code;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;

  select * into t from public.tenants where id = new.tenant_id;
  if t.id is null then
    raise exception 'La barbería no existe.' using errcode = '22023';
  end if;

  slot_changed := tg_op = 'INSERT'
               or new.date is distinct from old.date
               or new.time is distinct from old.time
               or new.barber_id is distinct from old.barber_id;

  if slot_changed then
    select * into b from public.barbers where id = new.barber_id and tenant_id = new.tenant_id;
    if b.id is null or not b.active then
      raise exception 'Ese barbero no está disponible.' using errcode = '22023';
    end if;
    new.barber_name := b.name;

    -- Solo se validan horarios para citas vigentes (el historial importado no)
    if new.status in ('PROGRAMADA', 'CONFIRMADA_WSP') then
      local_now := now() at time zone t.timezone;
      if new.date < local_now::date then
        raise exception 'No se puede reservar en una fecha que ya pasó.' using errcode = '22023';
      end if;
      v_max := coalesce((t.schedule ->> 'maxDays')::int, 60);
      if new.source = 'WEB' and new.date > local_now::date + v_max then
        raise exception 'Solo se puede reservar hasta % días adelante.', v_max using errcode = '22023';
      end if;
      if not (new.time = any (private.horario_slots(t.id, b.id, new.date))) then
        raise exception '% no atiende en ese horario. Elige otro de la lista.', b.name using errcode = '22023';
      end if;
      if (new.date + new.time) <= local_now then
        raise exception 'Ese horario ya pasó. Elige uno más tarde.' using errcode = '22023';
      end if;
      if exists (select 1 from public.appointments a
                 where a.barber_id = new.barber_id and a.date = new.date and a.time = new.time
                   and a.status <> 'CANCELADA' and a.id <> new.id) then
        raise exception 'Ese horario ya está ocupado para %.', b.name using errcode = '23505';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' or new.service_id is distinct from old.service_id then
    if new.service_id is not null then
      select * into s from public.services where id = new.service_id and tenant_id = new.tenant_id;
      if s.id is null then
        raise exception 'Ese servicio no está disponible.' using errcode = '22023';
      end if;
      new.service_name := s.name;
      new.duration_min := s.duration_min;
      if tg_op = 'INSERT' then
        new.price := s.price;
      end if;
    end if;
  end if;

  new.starts_at := (new.date + new.time) at time zone t.timezone;
  new.customer_name := btrim(new.customer_name);

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    loop
      new.code := private.new_booking_code();
      exit when not exists (select 1 from public.appointments a
                            where a.tenant_id = new.tenant_id and a.code = new.code);
    end loop;
  end if;

  if new.status = 'CONFIRMADA_WSP' and (tg_op = 'INSERT' or old.status <> 'CONFIRMADA_WSP') then
    new.confirmed_at := now();
  elsif new.status = 'COMPLETADA' and (tg_op = 'INSERT' or old.status <> 'COMPLETADA') then
    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status = 'CANCELADA' and (tg_op = 'INSERT' or old.status <> 'CANCELADA') then
    new.cancelled_at := now();
  end if;

  return new;
end $$;

-- --------------------------------------------------------------------------
-- WEB PÚBLICA · ahora también envía el horario semanal y las fechas especiales,
-- para que el formulario muestre solo los días y horas en que se atiende.
-- (No se envían las notas de las fechas especiales.)
-- --------------------------------------------------------------------------
create or replace function public.web_barberia(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'logo_url', t.logo_url, 'palette', t.palette,
      'address', t.address, 'phone', t.phone, 'hours', t.hours, 'city', t.city,
      'currency', t.currency, 'timezone', t.timezone, 'schedule', t.schedule,
      'time_slots', (select coalesce(jsonb_agg(to_char(x, 'HH24:MI') order by x), '[]'::jsonb)
                     from unnest(t.time_slots) x)
    ),
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', s.id, 'name', s.name, 'category', s.category, 'price', s.price,
                   'duration_min', s.duration_min, 'description', s.description, 'featured', s.featured)
                   order by s.featured desc, s.sort, s.name), '[]'::jsonb)
                 from public.services s where s.tenant_id = t.id and s.active),
    'barbers', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', b.id, 'name', b.name, 'role_title', b.role_title, 'photo_url', b.photo_url,
                   'specialties', to_jsonb(b.specialties), 'schedule', b.schedule,
                   'in_chair', exists (select 1 from public.walk_ins w
                                       where w.barber_id = b.id and w.status = 'EN_SILLON'),
                   'works', (select coalesce(jsonb_agg(jsonb_build_object(
                               'id', wk.id, 'title', wk.title, 'image_url', wk.image_url)
                               order by wk.sort, wk.created_at), '[]'::jsonb)
                             from public.barber_works wk where wk.barber_id = b.id))
                   order by b.sort, b.name), '[]'::jsonb)
                from public.barbers b where b.tenant_id = t.id and b.active),
    'exceptions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', e.id, 'barber_id', e.barber_id, 'date', e.date, 'ranges', e.ranges)
                     order by e.date), '[]'::jsonb)
                   from public.schedule_exceptions e
                   where e.tenant_id = t.id
                     and e.date >= (now() at time zone t.timezone)::date
                     and e.date <= (now() at time zone t.timezone)::date
                                   + coalesce((t.schedule ->> 'maxDays')::int, 60))
  )
  from public.tenants t
  where t.slug = lower(p_slug) and t.status = 'ACTIVE'
$$;

-- Estado de cada horario de un barbero en una fecha (libre / ocupado / ya pasó)
create or replace function public.web_horarios(p_slug text, p_barber_id uuid, p_date date)
returns table (slot text, state text)
language sql stable security definer set search_path = '' as $$
  select to_char(x, 'HH24:MI') as slot,
         case
           when (p_date + x) <= (now() at time zone t.timezone) then 'past'
           when exists (select 1 from public.appointments a
                        where a.barber_id = p_barber_id and a.date = p_date and a.time = x
                          and a.status <> 'CANCELADA') then 'busy'
           else 'free'
         end as state
  from public.tenants t
  cross join lateral unnest(private.horario_slots(t.id, p_barber_id, p_date)) x
  where t.slug = lower(p_slug) and t.status = 'ACTIVE'
    and exists (select 1 from public.barbers b where b.id = p_barber_id and b.tenant_id = t.id and b.active)
  order by x
$$;

-- Horarios ocupados: ahora acepta hasta 365 días (el máximo de "maxDays")
create or replace function public.web_ocupados(p_slug text, p_days int default 60)
returns table (barber_id uuid, date date, "time" text)
language sql stable security definer set search_path = '' as $$
  select a.barber_id, a.date, to_char(a.time, 'HH24:MI')
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  where t.slug = lower(p_slug) and t.status = 'ACTIVE'
    and a.status <> 'CANCELADA'
    and a.date >= (now() at time zone t.timezone)::date
    and a.date <= (now() at time zone t.timezone)::date + least(greatest(p_days, 1), 365)
$$;

revoke all on function public.web_barberia(text) from public;
revoke all on function public.web_horarios(text, uuid, date) from public;
revoke all on function public.web_ocupados(text, int) from public;
grant execute on function public.web_barberia(text) to anon, authenticated;
grant execute on function public.web_horarios(text, uuid, date) to anon, authenticated;
grant execute on function public.web_ocupados(text, int) to anon, authenticated;

-- El CRM se entera al instante si cambian las fechas especiales
alter publication supabase_realtime add table public.schedule_exceptions;
