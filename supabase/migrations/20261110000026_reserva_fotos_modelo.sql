-- ==========================================================================
-- 26 · Fotos de modelo al reservar
-- --------------------------------------------------------------------------
-- El administrador del negocio (con Configuración) activa en el CRM
-- tenants.booking_photos. Entonces la web pública deja adjuntar hasta 3 fotos
-- de referencia al reservar ("quiero este diseño / este corte").
--   · Las fotos las sube la Edge Function "reservar" (después del captcha)
--     al bucket PRIVADO "reservas", en <id del negocio>/<uuid>.jpg|png|webp.
--     El público no puede subir ni ver nada en ese bucket.
--   · crear_reserva recibe las rutas (p_ref_photos), comprueba que sean de
--     ese negocio y que existan, y las guarda en appointments.ref_photos.
--   · El equipo del negocio las ve en la ficha de la cita con enlaces
--     firmados que vencen (política reservas_select).
-- web_barberia (versión de la 25) devuelve booking_photos.
-- Requiere la migración 25. Se puede ejecutar más de una vez. No toca datos:
-- todos los negocios quedan con la opción apagada.
-- ==========================================================================

-- 1. Opción del negocio (tenants_update ya la limita al ADMIN con
--    Configuración y al superadministrador)
alter table public.tenants add column if not exists booking_photos boolean not null default false;
comment on column public.tenants.booking_photos is
  'La web pública deja adjuntar hasta 3 fotos de modelo al reservar. La activa el negocio en Configuración.';

-- 2. Rutas de las fotos de cada cita
alter table public.appointments add column if not exists ref_photos text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_ref_photos_valida'
                 and conrelid = 'public.appointments'::regclass) then
    alter table public.appointments add constraint appointments_ref_photos_valida check (
      cardinality(ref_photos) <= 3
      and array_position(ref_photos, null) is null);
  end if;
end $$;
comment on column public.appointments.ref_photos is
  'Fotos de modelo que adjuntó el cliente al reservar (rutas del bucket privado reservas).';

-- 3. Bucket privado "reservas": solo la secret key sube; el equipo lee lo de
--    su negocio y el administrador puede borrar.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('reservas', 'reservas', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

    execute 'drop policy if exists reservas_select on storage.objects';
    execute $p$
      create policy reservas_select on storage.objects for select to authenticated
      using (bucket_id = 'reservas'
             and private.is_tenant_member(private.try_uuid((storage.foldername(name))[1])))
    $p$;
    execute 'drop policy if exists reservas_delete on storage.objects';
    execute $p$
      create policy reservas_delete on storage.objects for delete to authenticated
      using (bucket_id = 'reservas'
             and private.is_tenant_admin(private.try_uuid((storage.foldername(name))[1])))
    $p$;
  end if;
end $$;

-- 4. Valida las rutas que manda la Edge Function → text[] limpio
create or replace function private.fotos_reserva(t public.tenants, p text[])
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  out text[] := '{}';
  x text;
  existe boolean;
begin
  if p is null or cardinality(p) = 0 then
    return out;
  end if;
  if not t.booking_photos then
    raise exception 'Este negocio no recibe fotos de modelo. Quítalas e inténtalo de nuevo.' using errcode = '22023';
  end if;
  if cardinality(p) > 3 then
    raise exception 'Puedes adjuntar hasta 3 fotos de modelo.' using errcode = '22023';
  end if;
  foreach x in array p loop
    if x is null or x !~ ('^' || t.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
       or x = any (out) then
      raise exception 'No pudimos guardar tus fotos de modelo. Vuelve a elegirlas.' using errcode = '22023';
    end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects where bucket_id = ''reservas'' and name = $1)'
        into existe using x;
      if not existe then
        raise exception 'No pudimos guardar tus fotos de modelo. Vuelve a elegirlas.' using errcode = '22023';
      end if;
    end if;
    out := out || x;
  end loop;
  return out;
end $$;

-- 5. crear_reserva: igual que en la migración 12, más p_ref_photos al final
drop function if exists public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb);

-- Crear reserva. Solo la Edge Function "reservar" (secret key).
create or replace function public.crear_reserva(
  p_slug text, p_service_id uuid, p_barber_id uuid, p_date date, p_time time,
  p_name text, p_phone text, p_notes text default '', p_wa_opt_in boolean default false,
  p_extra jsonb default '{}'::jsonb, p_ref_photos text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
  v_phone text := private.norm_phone(p_phone);
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_extra jsonb;
  v_photos text[];
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

  insert into public.audit_log (tenant_id, user_name, role, action, detail)
  values (t.id, v_name || ' (web)', 'PUBLIC', 'Reserva desde la web',
          a.service_name || ' · ' || a.barber_name || ' · ' || a.date || ' ' || to_char(a.time, 'HH24:MI')
          || case when cardinality(v_photos) > 0 then ' · ' || cardinality(v_photos) || ' foto(s) de modelo' else '' end);

  return jsonb_build_object('id', a.id, 'code', a.code, 'date', a.date, 'time', to_char(a.time, 'HH24:MI'),
                            'service', a.service_name, 'barber', a.barber_name);
end $$;

-- 6. web_barberia: igual que en la migración 25, más booking_photos
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
                   'image_url', s.image_url, 'media', s.media)
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

-- 7. Permisos
revoke all on function private.fotos_reserva(public.tenants, text[]) from public;
grant execute on function private.fotos_reserva(public.tenants, text[]) to service_role;
revoke all on function public.web_barberia(text) from public;
grant execute on function public.web_barberia(text) to anon, authenticated;
revoke all on function public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb, text[])
  to service_role;
