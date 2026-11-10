-- ==========================================================================
-- 27 · Opciones por servicio que suman al precio, y precio "Desde"
-- --------------------------------------------------------------------------
-- Un servicio puede tener grupos de opciones (p. ej. "Tamaño": Corto, Medio,
-- Largo; "Extras": Piedras, Francés). Cada opción suma su precio al del
-- servicio. Quien reserva elige en la web y ve el total al momento.
--   services.options [ { id, name, multi?, required?,
--                        items: [ { id, name, price } ] } ]   ≤ 6 grupos, ≤ 12 opciones
--     multi    = se pueden elegir varias (si no, solo una)
--     required = hay que elegir al menos una
--   services.price_from = la web muestra "Desde S/ 45"
-- crear_reserva(p_options { idGrupo: [idOpción, …] }) valida contra el
-- servicio, guarda lo elegido en appointments.options (nombre y precio de ese
-- momento) y pone en la cita el precio total.
-- web_barberia (versión de la 26) devuelve options y price_from.
-- Requiere la migración 26. Se puede ejecutar más de una vez. No toca datos.
-- ==========================================================================

-- 1. Forma de services.options
create or replace function private.servicio_opciones_valida(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  g jsonb;
  it jsonb;
  gids text[] := '{}';
  iids text[];
  id_re constant text := '^[a-z0-9]{4,16}$';
begin
  if v is null then return true; end if;
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 6 then return false; end if;
  for g in select x from jsonb_array_elements(v) x loop
    if jsonb_typeof(g) <> 'object'
       or exists (select 1 from jsonb_object_keys(g) k where k not in ('id', 'name', 'multi', 'required', 'items')) then
      return false;
    end if;
    if jsonb_typeof(g -> 'id') is distinct from 'string' or (g ->> 'id') !~ id_re or (g ->> 'id') = any (gids) then
      return false;
    end if;
    gids := gids || (g ->> 'id');
    if not private.json_texto(g -> 'name', 40)
       or not private.json_bool_o_nada(g -> 'multi')
       or not private.json_bool_o_nada(g -> 'required') then
      return false;
    end if;
    if jsonb_typeof(g -> 'items') is distinct from 'array' or jsonb_array_length(g -> 'items') not between 1 and 12 then
      return false;
    end if;
    iids := '{}';
    for it in select x from jsonb_array_elements(g -> 'items') x loop
      if jsonb_typeof(it) <> 'object'
         or exists (select 1 from jsonb_object_keys(it) k where k not in ('id', 'name', 'price')) then
        return false;
      end if;
      if jsonb_typeof(it -> 'id') is distinct from 'string' or (it ->> 'id') !~ id_re or (it ->> 'id') = any (iids) then
        return false;
      end if;
      iids := iids || (it ->> 'id');
      if not private.json_texto(it -> 'name', 60)
         or jsonb_typeof(it -> 'price') is distinct from 'number'
         or (it ->> 'price')::numeric not between 0 and 99999
         or (it ->> 'price')::numeric <> round((it ->> 'price')::numeric, 2) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $$;

-- 2. Columnas
alter table public.services add column if not exists options jsonb not null default '[]'::jsonb;
alter table public.services add column if not exists price_from boolean not null default false;
alter table public.appointments add column if not exists options jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'services_options_valida'
                 and conrelid = 'public.services'::regclass) then
    alter table public.services add constraint services_options_valida check (private.servicio_opciones_valida(options));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_options_forma'
                 and conrelid = 'public.appointments'::regclass) then
    alter table public.appointments add constraint appointments_options_forma
      check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 72);
  end if;
end $$;
comment on column public.services.options is
  'Grupos de opciones que suman al precio (tamaño, extras). Ver migración 27.';
comment on column public.services.price_from is 'La web muestra el precio como "Desde".';
comment on column public.appointments.options is
  'Opciones elegidas al reservar: [{group, item, price}] con los nombres y precios de ese momento.';

-- 3. Lo elegido al reservar → { items: [{group, item, price}], total }
create or replace function private.opciones_reserva(s public.services, p jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  g jsonb;
  it jsonb;
  sel jsonb;
  ids text[];
  items jsonb := '[]'::jsonb;
  total numeric := 0;
  n int;
begin
  if p is null or jsonb_typeof(p) = 'null' then p := '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' then
    raise exception 'Revisa las opciones que elegiste e inténtalo de nuevo.' using errcode = '22023';
  end if;
  -- Ninguna clave que no sea un grupo del servicio
  if exists (select 1 from jsonb_object_keys(p) k
             where not exists (select 1 from jsonb_array_elements(coalesce(s.options, '[]')) x where x ->> 'id' = k)) then
    raise exception 'Las opciones de este servicio cambiaron. Recarga la página y vuelve a elegirlas.' using errcode = '22023';
  end if;
  for g in select x from jsonb_array_elements(coalesce(s.options, '[]')) x loop
    sel := p -> (g ->> 'id');
    if sel is null or jsonb_typeof(sel) = 'null' then sel := '[]'::jsonb; end if;
    if jsonb_typeof(sel) <> 'array' or exists (select 1 from jsonb_array_elements(sel) y where jsonb_typeof(y) <> 'string') then
      raise exception 'Revisa las opciones que elegiste e inténtalo de nuevo.' using errcode = '22023';
    end if;
    select array_agg(distinct y) into ids from jsonb_array_elements_text(sel) y;
    n := coalesce(cardinality(ids), 0);
    if n <> jsonb_array_length(sel) then
      raise exception 'Revisa las opciones que elegiste e inténtalo de nuevo.' using errcode = '22023';
    end if;
    if n = 0 and coalesce((g ->> 'required')::boolean, false) then
      raise exception 'Elige una opción de "%".', g ->> 'name' using errcode = '22023';
    end if;
    if n > 1 and not coalesce((g ->> 'multi')::boolean, false) then
      raise exception 'En "%" solo puedes elegir una opción.', g ->> 'name' using errcode = '22023';
    end if;
    if n > 0 and exists (select 1 from unnest(ids) i
                         where not exists (select 1 from jsonb_array_elements(g -> 'items') x where x ->> 'id' = i)) then
      raise exception 'Las opciones de este servicio cambiaron. Recarga la página y vuelve a elegirlas.' using errcode = '22023';
    end if;
    -- En el orden del servicio
    for it in select x from jsonb_array_elements(g -> 'items') x loop
      if n > 0 and (it ->> 'id') = any (ids) then
        items := items || jsonb_build_object('group', g ->> 'name', 'item', it ->> 'name', 'price', (it ->> 'price')::numeric);
        total := total + (it ->> 'price')::numeric;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('items', items, 'total', total);
end $$;

-- 4. crear_reserva: igual que en la migración 26, más p_options al final
drop function if exists public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb, text[]);

-- Crear reserva. Solo la Edge Function "reservar" (secret key).
create or replace function public.crear_reserva(
  p_slug text, p_service_id uuid, p_barber_id uuid, p_date date, p_time time,
  p_name text, p_phone text, p_notes text default '', p_wa_opt_in boolean default false,
  p_extra jsonb default '{}'::jsonb, p_ref_photos text[] default '{}', p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
  v_phone text := private.norm_phone(p_phone);
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_extra jsonb;
  v_photos text[];
  v_opts jsonb;
  v_start timestamptz;
  v_customer uuid;
  a public.appointments;
begin
  select * into t from public.tenants where slug = lower(btrim(coalesce(p_slug, '')));
  if t.id is null then
    raise exception 'Este negocio no está disponible.' using errcode = '22023';
  end if;
  if not private.tenant_accepting(t) then
    raise exception 'Este negocio no está recibiendo reservas en línea por ahora.' using errcode = '22023';
  end if;
  if p_service_id is null then
    raise exception 'Elige un servicio.' using errcode = '22023';
  end if;
  select * into s from public.services where id = p_service_id and tenant_id = t.id and active;
  if s.id is null then
    raise exception 'Ese servicio no está disponible.' using errcode = '22023';
  end if;
  if p_barber_id is null then
    raise exception 'Elige un profesional.' using errcode = '22023';
  end if;
  if p_date is null or p_time is null then
    raise exception 'Elige la fecha y la hora de tu cita.' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Tu nombre debe tener entre 2 y 80 letras.' using errcode = '22023';
  end if;
  if v_phone !~ '^9[0-9]{8}$' then
    raise exception 'El celular debe tener 9 dígitos y empezar con 9.' using errcode = '22023';
  end if;
  if length(v_notes) > 300 then
    raise exception 'Las notas no pueden pasar de 300 caracteres.' using errcode = '22023';
  end if;
  v_extra := private.extra_reserva(t.crm_config, p_extra);
  v_photos := private.fotos_reserva(t, p_ref_photos);
  v_opts := private.opciones_reserva(s, p_options);
  v_start := (p_date + p_time) at time zone t.timezone;
  if v_start > now() and v_start < now() + make_interval(mins => t.booking_lead_minutes) then
    raise exception 'Reserva con al menos % minutos de anticipación. Elige una hora más tarde.',
      t.booking_lead_minutes using errcode = '22023';
  end if;

  -- A5 · Máximo 2 citas futuras vigentes por celular en este negocio
  perform pg_advisory_xact_lock(hashtextextended('reservalope.cel:' || t.id::text || ':' || v_phone, 0));
  if (select count(*) from public.appointments x
      where x.tenant_id = t.id and x.phone = v_phone
        and x.status in ('PROGRAMADA', 'CONFIRMADA_WSP') and x.starts_at > now()) >= 2 then
    raise exception 'Ya tienes 2 citas pendientes con nosotros. Para otra, escríbenos.' using errcode = '22023';
  end if;

  -- A5 · La web nunca renombra al cliente ni anula su baja de WhatsApp
  insert into public.customers (tenant_id, name, phone) values (t.id, v_name, v_phone)
  on conflict (tenant_id, phone) do nothing
  returning id into v_customer;
  if v_customer is null then
    select id into v_customer from public.customers where tenant_id = t.id and phone = v_phone;
  end if;

  begin
    insert into public.appointments (tenant_id, customer_id, customer_name, phone, service_id, barber_id,
                                     date, time, status, source, notes, wa_opt_in, extra, ref_photos)
    values (t.id, v_customer, v_name, v_phone, s.id, p_barber_id,
            p_date, p_time, 'PROGRAMADA', 'WEB',
            coalesce(nullif(v_notes, ''), 'Reserva desde la web'), coalesce(p_wa_opt_in, false), v_extra, v_photos)
    returning * into a;
  exception
    when unique_violation then
      raise exception 'Ese horario acaba de ser tomado. Elige otro.' using errcode = '23505';
    when check_violation or not_null_violation or string_data_right_truncation
         or invalid_text_representation or foreign_key_violation then
      raise exception 'Revisa los datos de tu reserva e inténtalo de nuevo.' using errcode = '22023';
  end;

  -- Opciones elegidas: se guardan y el precio de la cita pasa a ser el total
  if jsonb_array_length(v_opts -> 'items') > 0 then
    update public.appointments
       set options = v_opts -> 'items', price = s.price + (v_opts ->> 'total')::numeric
     where id = a.id
    returning * into a;
  end if;

  insert into public.audit_log (tenant_id, user_name, role, action, detail)
  values (t.id, v_name || ' (web)', 'PUBLIC', 'Reserva desde la web',
          a.service_name || ' · ' || a.barber_name || ' · ' || a.date || ' ' || to_char(a.time, 'HH24:MI')
          || case when jsonb_array_length(v_opts -> 'items') > 0
                  then ' · ' || (select string_agg(x ->> 'item', ', ') from jsonb_array_elements(v_opts -> 'items') x) else '' end
          || case when cardinality(v_photos) > 0 then ' · ' || cardinality(v_photos) || ' foto(s) de modelo' else '' end);

  return jsonb_build_object('id', a.id, 'code', a.code, 'date', a.date, 'time', to_char(a.time, 'HH24:MI'),
                            'service', a.service_name, 'barber', a.barber_name, 'price', a.price);
end $$;

-- 5. web_barberia: igual que en la migración 26, más options y price_from en cada servicio
create or replace function public.web_barberia(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'wa_enabled', private.wa_activo(t.whatsapp),
    'accepting', private.tenant_accepting(t),
    'lead_minutes', t.booking_lead_minutes,
    'timezone', t.timezone,
    'server_now', now(),
    'business_type', t.business_type,
    'labels', t.labels,
    'booking_fields', private.booking_fields(t.crm_config),
    'site', private.site_publico(t.crm_config),
    'page', t.web_page,
    'booking_photos', t.booking_photos,
    'tenant', jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'logo_url', t.logo_url, 'palette', t.palette,
      'address', t.address, 'phone', t.phone, 'hours', t.hours, 'city', t.city,
      'currency', t.currency, 'timezone', t.timezone, 'schedule', t.schedule,
      'time_slots', (select coalesce(jsonb_agg(to_char(x, 'HH24:MI') order by x), '[]'::jsonb)
                     from unnest(t.time_slots) x),
      'wa_enabled', private.wa_activo(t.whatsapp),
      'server_now', now(),
      'lead_minutes', t.booking_lead_minutes,
      'accepting', private.tenant_accepting(t),
      'business_type', t.business_type,
      'labels', t.labels,
      'site', private.site_publico(t.crm_config),
      'page', t.web_page
    ),
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', s.id, 'name', s.name, 'category', s.category, 'price', s.price,
                   'duration_min', s.duration_min, 'description', s.description, 'featured', s.featured,
                   'image_url', s.image_url, 'media', s.media,
                   'options', s.options, 'price_from', s.price_from)
                   order by s.featured desc, s.sort, s.name), '[]'::jsonb)
                 from public.services s where s.tenant_id = t.id and s.active),
    'barbers', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', b.id, 'name', b.name, 'role_title', b.role_title, 'photo_url', b.photo_url,
                   'specialties', to_jsonb(b.specialties), 'schedule', b.schedule,
                   'in_chair', exists (select 1 from public.walk_ins w
                                       where w.barber_id = b.id and w.status = 'EN_SILLON'
                                         and w.date = (now() at time zone t.timezone)::date),
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
  where t.slug = lower(p_slug)
$$;

-- 6. Permisos
revoke all on function private.servicio_opciones_valida(jsonb) from public;
grant execute on function private.servicio_opciones_valida(jsonb) to authenticated, service_role;
revoke all on function private.opciones_reserva(public.services, jsonb) from public;
grant execute on function private.opciones_reserva(public.services, jsonb) to service_role;
revoke all on function public.web_barberia(text) from public;
grant execute on function public.web_barberia(text) to anon, authenticated;
revoke all on function public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb, text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb, text[], jsonb)
  to service_role;
