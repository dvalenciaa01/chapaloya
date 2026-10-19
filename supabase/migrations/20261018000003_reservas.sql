-- ==========================================================================
-- Reservalope · Migración 3/4 · Reglas de agenda y funciones públicas
-- --------------------------------------------------------------------------
-- Las reglas de DB.validateBooking() pasan a un trigger: valen igual para la
-- web, el CRM o cualquier otra vía, aunque alguien manipule el navegador.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Código corto de reserva (6 caracteres, sin 0/O/1/I/L para no confundir)
-- --------------------------------------------------------------------------
create or replace function private.new_booking_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  hex text := replace(gen_random_uuid()::text, '-', '');
  v_code text := '';
begin
  for i in 0..5 loop
    v_code := v_code || substr(alphabet, (('x' || substr(hex, i * 2 + 1, 2))::bit(8)::int % length(alphabet)) + 1, 1);
  end loop;
  return v_code;
end $$;

-- --------------------------------------------------------------------------
-- Validación y datos derivados de cada cita
-- --------------------------------------------------------------------------
create or replace function private.appointments_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  b public.barbers;
  s public.services;
  local_now timestamp;
  slot_changed boolean;
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
      if not (new.time = any (t.time_slots)) then
        raise exception 'Selecciona un horario de la lista.' using errcode = '22023';
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

create trigger appointments_before
  before insert or update on public.appointments
  for each row execute function private.appointments_before();

-- --------------------------------------------------------------------------
-- WEB PÚBLICA · datos de la barbería (reemplaza DB.initPublic)
-- Devuelve null si el enlace no existe o la barbería está suspendida.
-- --------------------------------------------------------------------------
create or replace function public.web_barberia(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'logo_url', t.logo_url, 'palette', t.palette,
      'address', t.address, 'phone', t.phone, 'hours', t.hours, 'city', t.city,
      'currency', t.currency, 'timezone', t.timezone,
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
                   'specialties', to_jsonb(b.specialties),
                   'in_chair', exists (select 1 from public.walk_ins w
                                       where w.barber_id = b.id and w.status = 'EN_SILLON'),
                   'works', (select coalesce(jsonb_agg(jsonb_build_object(
                               'id', wk.id, 'title', wk.title, 'image_url', wk.image_url)
                               order by wk.sort, wk.created_at), '[]'::jsonb)
                             from public.barber_works wk where wk.barber_id = b.id))
                   order by b.sort, b.name), '[]'::jsonb)
                from public.barbers b where b.tenant_id = t.id and b.active)
  )
  from public.tenants t
  where t.slug = lower(p_slug) and t.status = 'ACTIVE'
$$;

-- --------------------------------------------------------------------------
-- WEB PÚBLICA · estado de cada horario (libre / ocupado / ya pasó)
-- No revela nombres de clientes.
-- --------------------------------------------------------------------------
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
  cross join lateral unnest(t.time_slots) x
  where t.slug = lower(p_slug) and t.status = 'ACTIVE'
    and exists (select 1 from public.barbers b where b.id = p_barber_id and b.tenant_id = t.id and b.active)
  order by x
$$;

-- --------------------------------------------------------------------------
-- WEB PÚBLICA · "Mi cita": exige celular Y código (antes bastaba un nombre)
-- --------------------------------------------------------------------------
create or replace function public.web_consultar_cita(p_slug text, p_phone text, p_code text)
returns table (code text, date date, "time" text, service_name text, barber_name text,
               status text, customer_name text)
language sql stable security definer set search_path = '' as $$
  select a.code, a.date, to_char(a.time, 'HH24:MI'), a.service_name, a.barber_name, a.status, a.customer_name
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  where t.slug = lower(p_slug) and t.status = 'ACTIVE'
    and a.phone = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
    and a.code = upper(btrim(coalesce(p_code, '')))
$$;

-- --------------------------------------------------------------------------
-- WEB PÚBLICA · crear reserva
-- Solo la llama la Edge Function "reservar" (Fase 2) DESPUÉS de verificar el
-- captcha de Cloudflare Turnstile, usando la secret key. Por eso no se otorga
-- a "anon".
-- --------------------------------------------------------------------------
create or replace function public.crear_reserva(
  p_slug text, p_service_id uuid, p_barber_id uuid, p_date date, p_time time,
  p_name text, p_phone text, p_notes text default '', p_wa_opt_in boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_name text := btrim(coalesce(p_name, ''));
  v_customer uuid;
  a public.appointments;
begin
  select * into t from public.tenants where slug = lower(p_slug) and status = 'ACTIVE';
  if t.id is null then
    raise exception 'Esta barbería no está disponible.' using errcode = '22023';
  end if;
  if length(v_name) < 2 then
    raise exception 'Escribe tu nombre.' using errcode = '22023';
  end if;
  if v_phone !~ '^9[0-9]{8}$' then
    raise exception 'El celular debe tener 9 dígitos y empezar con 9.' using errcode = '22023';
  end if;

  insert into public.customers (tenant_id, name, phone)
  values (t.id, v_name, v_phone)
  on conflict (tenant_id, phone) do update
    set name = excluded.name,
        wa_opt_out_at = case when p_wa_opt_in then null else public.customers.wa_opt_out_at end
  returning id into v_customer;

  begin
    insert into public.appointments (tenant_id, customer_id, customer_name, phone, service_id, barber_id,
                                     date, time, status, source, notes, wa_opt_in)
    values (t.id, v_customer, v_name, v_phone, p_service_id, p_barber_id,
            p_date, p_time, 'PROGRAMADA', 'WEB',
            coalesce(nullif(btrim(p_notes), ''), 'Reserva desde la web'), coalesce(p_wa_opt_in, false))
    returning * into a;
  exception when unique_violation then
    raise exception 'Ese horario acaba de ser tomado. Elige otro.' using errcode = '23505';
  end;

  insert into public.audit_log (tenant_id, user_name, role, action, detail)
  values (t.id, v_name || ' (web)', 'PUBLIC', 'Reserva desde la web',
          a.service_name || ' · ' || a.barber_name || ' · ' || a.date || ' ' || to_char(a.time, 'HH24:MI'));

  return jsonb_build_object('id', a.id, 'code', a.code, 'date', a.date, 'time', to_char(a.time, 'HH24:MI'),
                            'service', a.service_name, 'barber', a.barber_name);
end $$;

-- Permisos de las funciones públicas
revoke all on function public.web_barberia(text) from public;
revoke all on function public.web_horarios(text, uuid, date) from public;
revoke all on function public.web_consultar_cita(text, text, text) from public;
revoke all on function public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean) from public, anon, authenticated;

grant execute on function public.web_barberia(text) to anon, authenticated;
grant execute on function public.web_horarios(text, uuid, date) to anon, authenticated;
grant execute on function public.web_consultar_cita(text, text, text) to anon, authenticated;
grant execute on function public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean) to service_role;
