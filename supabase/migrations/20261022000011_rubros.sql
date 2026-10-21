-- ==========================================================================
-- Reservalope · Migración 11 · Rubros: cualquier negocio con citas
-- --------------------------------------------------------------------------
-- Reservalope deja de ser solo para barberías: cada negocio tiene un rubro
-- (barbería, salón, spa, consultorio, clínica dental...) y las palabras que
-- ve la gente salen de ese rubro (js/core/vocab.js). Los nombres internos
-- (tabla barbers, columna barber_id, función web_barberia...) NO cambian.
-- Se puede ejecutar sobre una base con datos y volver a ejecutar sin romper
-- nada.
--
--   1. tenants.business_type (rubro) y tenants.labels (palabras propias)
--   2. tenants_guard: el rubro y las palabras los cambia el admin con el
--      módulo Configuración (o el superadmin)
--   3. web_barberia devuelve business_type y labels
--   4. WhatsApp: variables {negocio} y {profesional} y plantillas de fábrica
--      neutras (solo se cambian las que nadie personalizó)
--   5. Mensajes de error sin "barbería" / "barbero"
--   6. Permisos de las funciones
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Rubro y palabras propias
-- --------------------------------------------------------------------------
alter table public.tenants add column if not exists business_type text not null default 'barberia';
alter table public.tenants add column if not exists labels jsonb not null default '{}'::jsonb;

-- Lista de rubros (la misma que Vocab.TYPES en js/core/vocab.js)
alter table public.tenants drop constraint if exists tenants_business_type_valid;
alter table public.tenants add constraint tenants_business_type_valid check (business_type in (
  'barberia', 'salon', 'spa', 'unas', 'consultorio', 'dental',
  'psicologia', 'veterinaria', 'tatuajes', 'fitness', 'otro'));

-- Palabras propias: objeto con claves conocidas (Vocab.KEYS) y textos de 1 a
-- 40 caracteres sin < > "
create or replace function private.labels_validas(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null
     and jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) e
       where e.key not in ('business', 'businessArticle', 'staff', 'staffPlural', 'staffArticle',
                           'service', 'servicePlural', 'client', 'clientPlural', 'appointment',
                           'appointmentPlural', 'inService', 'walkIn')
          or jsonb_typeof(e.value) <> 'string'
          or char_length(e.value #>> '{}') not between 1 and 40
          or btrim(e.value #>> '{}') = ''
          or (e.value #>> '{}') ~ '[<>"]')
$$;

alter table public.tenants drop constraint if exists tenants_labels_valid;
alter table public.tenants add constraint tenants_labels_valid check (private.labels_validas(labels));

comment on column public.tenants.business_type is
  'Rubro del negocio: barberia, salon, spa, unas, consultorio, dental, psicologia, veterinaria, tatuajes, fitness u otro.';
comment on column public.tenants.labels is
  'Palabras propias que reemplazan las del rubro (staff, client, service...). Ver js/core/vocab.js.';

-- --------------------------------------------------------------------------
-- 2. Candado de columnas de tenants
-- --------------------------------------------------------------------------
-- RLS ya deja actualizar el negocio solo al ADMIN con el módulo Configuración;
-- aquí se deja explícito para el rubro y las palabras.
create or replace function private.tenants_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_superadmin() then
    return new;                      -- servidor (secret key) o superadmin
  end if;
  if new.slug is distinct from old.slug
     or new.plan is distinct from old.plan
     or new.plan_fee is distinct from old.plan_fee
     or new.subscription_end is distinct from old.subscription_end
     or new.status is distinct from old.status
     or new.owner_email is distinct from old.owner_email then
    raise exception 'Solo el superadministrador puede cambiar enlace, plan, vencimiento, estado o correo del dueño.'
      using errcode = '42501';
  end if;
  if (new.business_type is distinct from old.business_type or new.labels is distinct from old.labels)
     and not (private.my_role() = 'ADMIN' and private.has_grant('settings')
              and old.id = private.my_tenant()) then
    raise exception 'Solo un administrador con el módulo Configuración puede cambiar el rubro y las palabras del negocio.'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- --------------------------------------------------------------------------
-- 3. Web pública: el rubro y las palabras van en la raíz y en "tenant"
-- --------------------------------------------------------------------------
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
      'labels', t.labels
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

-- --------------------------------------------------------------------------
-- 4. WhatsApp
-- --------------------------------------------------------------------------
-- Variables de las plantillas:
--   {cliente} {telefono} {servicio} {fecha} {hora} {cuando} {precio}
--   {direccion} {codigo}
--   {negocio}     = nombre del negocio      ({barberia} sigue funcionando)
--   {profesional} = nombre del profesional  ({barbero} sigue funcionando)
create or replace function private.wa_render(tpl text, a public.appointments, t public.tenants,
                                             p_send timestamptz default now())
returns text language sql stable set search_path = '' as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
           coalesce(tpl, ''),
           '{cuando}',      case a.date - (p_send at time zone t.timezone)::date
                              when 0 then 'hoy'
                              when 1 then 'mañana'
                              else 'el ' || private.wa_fecha(a.date)
                            end),
           '{cliente}',     split_part(a.customer_name, ' ', 1)),
           '{telefono}',    coalesce(a.phone, '')),
           '{servicio}',    a.service_name),
           '{profesional}', a.barber_name),
           '{barbero}',     a.barber_name),
           '{fecha}',       private.wa_fecha(a.date)),
           '{hora}',        to_char(a.time, 'HH24:MI')),
           '{precio}',      t.currency || ' ' || case when a.price = trunc(a.price) then trunc(a.price)::text
                                                      else to_char(a.price, 'FM999999990.00') end),
           '{negocio}',     t.name),
           '{barberia}',    t.name),
           '{direccion}',   t.address),
           '{codigo}',      a.code)
$$;

-- Plantillas de fábrica con palabras neutras
create or replace function private.wa_default_config()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'enabled', false,
    'notifyTo', '[]'::jsonb,
    'notifyGroupId', null,
    'notifyOn', jsonb_build_object('new', true, 'cancel', true, 'reschedule', true),
    'confirmationToClient', true,
    'templates', jsonb_build_object(
      'shopNew',          E'📅 Nueva reserva ({codigo})\n{cliente} · {telefono}\n{servicio} con {profesional}\n{fecha} a las {hora}',
      'shopCancel',       E'❌ Cita cancelada ({codigo})\n{cliente} · {servicio} con {profesional}\n{fecha} a las {hora}',
      'shopReschedule',   E'🔁 Cita reprogramada ({codigo})\n{cliente} · {servicio} con {profesional}\nNueva fecha: {fecha} a las {hora}',
      'clientConfirm',    E'Hola {cliente}, tu cita en *{negocio}* quedó registrada.\n\n*Servicio:* {servicio}\n*Te atiende:* {profesional}\n*Fecha:* {fecha}, {hora}\n*Código:* {codigo}\n\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.',
      'clientCancel',     E'Hola {cliente}, tu cita en *{negocio}* del {fecha} a las {hora} fue cancelada.\n\nSi quieres otra fecha, puedes reservar de nuevo en nuestra web.',
      'clientReschedule', E'Hola {cliente}, tu cita en *{negocio}* cambió de horario.\n\n*Servicio:* {servicio}\n*Te atiende:* {profesional}\n*Nueva fecha:* {fecha}, {hora}\n*Código:* {codigo}\n\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.'
    ),
    'reminders', jsonb_build_array(
      jsonb_build_object('id', 'r1', 'offsetMinutes', 1440, 'onlyIfNotConfirmed', false,
        'template', E'Hola {cliente}, te recordamos tu cita {cuando} a las {hora} con {profesional} en {negocio}. {direccion}\n¡Te esperamos!'),
      jsonb_build_object('id', 'r2', 'offsetMinutes', 120, 'onlyIfNotConfirmed', false,
        'template', E'{cliente}, tu cita es {cuando} a las {hora} con {profesional}. ¡Te esperamos en {negocio}!')
    ),
    'quietHours', jsonb_build_object('from', '21:00', 'to', '08:00')
  )
$$;

-- Negocios existentes: cambiar solo los textos que siguen iguales a los de
-- fábrica de la migración 10 (los personalizados no se tocan)
do $$
declare
  viejas constant jsonb := jsonb_build_object(
    'shopNew',          E'💈 Nueva reserva ({codigo})\n{cliente} · {telefono}\n{servicio} con {barbero}\n{fecha} a las {hora}',
    'shopCancel',       E'❌ Cita cancelada ({codigo})\n{cliente} · {servicio} con {barbero}\n{fecha} a las {hora}',
    'shopReschedule',   E'🔁 Cita reprogramada ({codigo})\n{cliente} · {servicio} con {barbero}\nNueva fecha: {fecha} a las {hora}',
    'clientConfirm',    E'Hola {cliente}, tu cita en *{barberia}* quedó registrada.\n\n*Servicio:* {servicio}\n*Barbero:* {barbero}\n*Fecha:* {fecha}, {hora}\n*Código:* {codigo}\n\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.',
    'clientCancel',     E'Hola {cliente}, tu cita en *{barberia}* del {fecha} a las {hora} fue cancelada.\n\nSi quieres otra fecha, puedes reservar de nuevo en nuestra web.',
    'clientReschedule', E'Hola {cliente}, tu cita en *{barberia}* cambió de horario.\n\n*Servicio:* {servicio}\n*Barbero:* {barbero}\n*Nueva fecha:* {fecha}, {hora}\n*Código:* {codigo}\n\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.');
  viejos_rec constant jsonb := jsonb_build_object(
    'r1', E'Hola {cliente}, te recordamos tu cita {cuando} a las {hora} con {barbero} en {barberia}. {direccion}\n¡Te esperamos!',
    'r2', E'{cliente}, tu cita es {cuando} a las {hora} con {barbero}. ¡Te esperamos en {barberia}!');
  nuevas constant jsonb := private.wa_default_config() -> 'templates';
  nuevos_rec jsonb;
  k text;
begin
  select jsonb_object_agg(r ->> 'id', r ->> 'template') into nuevos_rec
  from jsonb_array_elements(private.wa_default_config() -> 'reminders') r;

  -- Plantillas sueltas
  foreach k in array array['shopNew', 'shopCancel', 'shopReschedule', 'clientConfirm', 'clientCancel', 'clientReschedule'] loop
    update public.tenants
       set whatsapp = jsonb_set(whatsapp, array['templates', k], nuevas -> k)
     where jsonb_typeof(whatsapp -> 'templates') = 'object'
       and whatsapp -> 'templates' ->> k = viejas ->> k;
  end loop;

  -- Recordatorios: se compara el texto (no el id: el admin puede haberlos reordenado)
  update public.tenants t
     set whatsapp = jsonb_set(t.whatsapp, '{reminders}', (
           select jsonb_agg(case
                    when r ->> 'template' = viejos_rec ->> 'r1' then jsonb_set(r, '{template}', to_jsonb(nuevos_rec ->> 'r1'))
                    when r ->> 'template' = viejos_rec ->> 'r2' then jsonb_set(r, '{template}', to_jsonb(nuevos_rec ->> 'r2'))
                    else r end order by ord)
           from jsonb_array_elements(t.whatsapp -> 'reminders') with ordinality as x(r, ord)))
   where jsonb_typeof(t.whatsapp -> 'reminders') = 'array'
     and exists (select 1 from jsonb_array_elements(t.whatsapp -> 'reminders') r
                 where r ->> 'template' in (viejos_rec ->> 'r1', viejos_rec ->> 'r2'));
end $$;

-- --------------------------------------------------------------------------
-- 5. Mensajes de error con palabras neutras
-- --------------------------------------------------------------------------
-- Solo cambia el texto de los mensajes: se toma la definición actual de cada
-- función (la de la migración 10 o anterior), se reemplazan las frases y se
-- vuelve a crear igual. Repetible: si la frase ya no está, no hace nada.
do $$
declare
  cambios constant text[][] := array[
    ['private.tenant_for_admin(uuid,text)', 'Indica la barbería.', 'Indica el negocio.'],
    ['private.profiles_guard()', 'No puedes cambiar rol, barbería, correo ni permisos.', 'No puedes cambiar rol, negocio, correo ni permisos.'],
    ['private.profiles_guard()', 'No puedes cambiar tu propio estado ni tu vínculo de barbero.', 'No puedes cambiar tu propio estado ni tu vínculo de profesional.'],
    ['private.appointments_before()', 'Una cita no puede cambiar de barbería.', 'Una cita no puede cambiar de negocio.'],
    ['private.appointments_before()', 'La barbería no existe.', 'El negocio no existe.'],
    ['private.appointments_before()', 'Ese barbero no está disponible.', 'Ese profesional no está disponible.'],
    ['private.nombre_unico()', 'Ya existe un barbero llamado', 'Ya existe un profesional llamado'],
    ['public.crear_reserva(text,uuid,uuid,date,time,text,text,text,boolean)', 'Esta barbería no está disponible.', 'Este negocio no está disponible.'],
    ['public.crear_reserva(text,uuid,uuid,date,time,text,text,text,boolean)', 'Esta barbería no está recibiendo reservas en línea por ahora.', 'Este negocio no está recibiendo reservas en línea por ahora.'],
    ['public.crear_reserva(text,uuid,uuid,date,time,text,text,text,boolean)', 'Elige un barbero.', 'Elige un profesional.'],
    ['public.bot_respuesta(uuid,text,text)', 'Tienes más de una cita próxima en *{barberia}*.', 'Tienes más de una cita próxima en *{negocio}*.']
  ];
  fns text[];
  f text;
  def text;
  nuevo text;
  i int;
begin
  select array_agg(distinct c) into fns from (select cambios[n][1] as c from generate_subscripts(cambios, 1) n) x;
  foreach f in array fns loop
    if to_regprocedure(f) is null then
      raise notice 'No existe la función %: se omite.', f;
      continue;
    end if;
    def := pg_get_functiondef(to_regprocedure(f));
    nuevo := def;
    for i in 1 .. array_length(cambios, 1) loop
      if cambios[i][1] = f then
        nuevo := replace(nuevo, cambios[i][2], cambios[i][3]);
      end if;
    end loop;
    if nuevo <> def then
      execute nuevo;
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 6. Permisos de las funciones (Supabase da EXECUTE a anon por defecto)
-- --------------------------------------------------------------------------
revoke all on function private.labels_validas(jsonb) from public;
grant execute on function private.labels_validas(jsonb) to authenticated, service_role;
revoke all on function public.web_barberia(text) from public;
grant execute on function public.web_barberia(text) to anon, authenticated;
