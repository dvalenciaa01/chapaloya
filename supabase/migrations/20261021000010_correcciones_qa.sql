-- ==========================================================================
-- Reservalope · Migración 10 · Correcciones del QA del 21/10/2026
-- --------------------------------------------------------------------------
-- Informe: QA-Reservalope-2026-10-21.md (los códigos C1, A1… B11 son los del
-- informe). Esta migración se puede ejecutar sobre una base con datos: no
-- falla si ya hay citas que se cruzan, nombres repetidos o configuraciones
-- raras; en esos casos avisa con NOTICE y deja la regla activa solo para lo
-- nuevo. Se puede volver a ejecutar sin romper nada.
--
--   1. Utilidades (teléfonos, horas, lectura segura de la configuración)
--   2. Barbería: anticipación mínima (B11), ¿recibe reservas? (M17),
--      paleta válida (C1) y configuración de WhatsApp válida (B6)
--   3. Contraseña temporal obligatoria también en la base (A3)
--   4. Citas: fin de la cita y sin solapes (A1), reglas de estados (A2),
--      el personal solo cambia estado, notas y horario (M12)
--   5. Nombres únicos de barberos y servicios y renombrar sin perder el
--      historial (M6)
--   6. Clientes: permisos por módulo (M11) y cliente_asegurar (M14)
--   7. Web pública: web_barberia, web_horarios, web_ocupados,
--      web_consultar_cita y crear_reserva (A5, M5, B11, M17)
--   8. WhatsApp: avisos al cliente al cancelar o reprogramar (M20), horas
--      de silencio (M19), bajas por teléfono (B3), apagar WhatsApp detiene la
--      cola (A6), reparto justo, caducidad y tope de intentos (A9, M22),
--      respuestas CONFIRMAR / BAJA (M21) y límite de pruebas
--   9. Fechas especiales: el admin necesita el módulo Configuración
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Utilidades
-- --------------------------------------------------------------------------
-- "+51 987 654 321" → "987654321". Otros números quedan solo con dígitos.
create or replace function private.norm_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select case when d ~ '^519[0-9]{8}$' then substr(d, 3) else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- Hora "HH:MM" o null si el texto no es una hora válida (nunca falla)
create or replace function private.try_time(p text)
returns time language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    return null;
  end if;
  return p::time;
end $$;

-- Booleano de un jsonb, con valor por defecto si falta o no es booleano
create or replace function private.jb(p jsonb, p_default boolean)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'boolean' then (p #>> '{}')::boolean else p_default end
$$;

-- ¿WhatsApp encendido en esta configuración?
create or replace function private.wa_activo(cfg jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select private.jb(cfg -> 'enabled', false)
$$;

-- --------------------------------------------------------------------------
-- 2. Barbería
-- --------------------------------------------------------------------------
-- B11 · Anticipación mínima para reservar por la web (minutos)
alter table public.tenants
  add column if not exists booking_lead_minutes int not null default 15;
alter table public.tenants drop constraint if exists tenants_booking_lead_minutes_check;
alter table public.tenants
  add constraint tenants_booking_lead_minutes_check check (booking_lead_minutes between 0 and 1440);

-- M17 · La web recibe reservas si la barbería está activa y la suscripción
-- no venció hace más de 7 días (sin fecha de vencimiento = sin límite).
create or replace function private.tenant_accepting(t public.tenants)
returns boolean language sql stable set search_path = '' as $$
  select t.status = 'ACTIVE'
     and (t.subscription_end is null
          or t.subscription_end + 7 >= (now() at time zone coalesce(t.timezone, 'America/Lima'))::date)
$$;

-- C1 · Colores de la paleta: solo #RRGGBB (impide inyectar HTML en la consola)
create or replace function private.valid_palette(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null and jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) e
       where e.key not in ('primary', 'secondary', 'tertiary')
          or jsonb_typeof(e.value) <> 'string'
          or (e.value #>> '{}') !~ '^#[0-9A-Fa-f]{6}$')
$$;

-- Paletas existentes: se conservan los colores válidos; lo demás vuelve al de fábrica
update public.tenants t
   set palette = (
     select jsonb_object_agg(k.key,
              case when jsonb_typeof(t.palette -> k.key) = 'string'
                        and (t.palette ->> k.key) ~ '^#[0-9A-Fa-f]{6}$'
                   then t.palette -> k.key else k.value end)
     from jsonb_each('{"primary":"#000000","secondary":"#D79848","tertiary":"#FFFFFF"}'::jsonb) k)
 where not private.valid_palette(t.palette);

alter table public.tenants drop constraint if exists tenants_palette_valid;
alter table public.tenants add constraint tenants_palette_valid check (private.valid_palette(palette));

-- B6 · Forma de tenants.whatsapp. Acepta claves extra, pero las conocidas
-- deben tener el tipo correcto; así un dato raro guardado por API no hace
-- fallar las reservas.
create or replace function private.wa_config_valida(c jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  r jsonb;
  q jsonb;
begin
  if c is null or jsonb_typeof(c) <> 'object' then
    return false;
  end if;
  if (c ? 'enabled' and jsonb_typeof(c -> 'enabled') <> 'boolean')
     or (c ? 'confirmationToClient' and jsonb_typeof(c -> 'confirmationToClient') <> 'boolean') then
    return false;
  end if;
  if c ? 'notifyTo' then
    if jsonb_typeof(c -> 'notifyTo') <> 'array' or jsonb_array_length(c -> 'notifyTo') > 20
       or exists (select 1 from jsonb_array_elements(c -> 'notifyTo') e
                  where jsonb_typeof(e) <> 'string' or length(e #>> '{}') > 40) then
      return false;
    end if;
  end if;
  if c ? 'notifyGroupId' and jsonb_typeof(c -> 'notifyGroupId') not in ('null', 'string') then
    return false;
  end if;
  if c ? 'notifyOn' then
    if jsonb_typeof(c -> 'notifyOn') <> 'object'
       or exists (select 1 from jsonb_each(c -> 'notifyOn') e where jsonb_typeof(e.value) <> 'boolean') then
      return false;
    end if;
  end if;
  if c ? 'templates' then
    if jsonb_typeof(c -> 'templates') <> 'object'
       or exists (select 1 from jsonb_each(c -> 'templates') e
                  where jsonb_typeof(e.value) not in ('string', 'null') or length(e.value #>> '{}') > 1500) then
      return false;
    end if;
  end if;
  if c ? 'reminders' then
    if jsonb_typeof(c -> 'reminders') <> 'array' or jsonb_array_length(c -> 'reminders') > 10 then
      return false;
    end if;
    for r in select value from jsonb_array_elements(c -> 'reminders') loop
      if jsonb_typeof(r) <> 'object'
         or jsonb_typeof(r -> 'offsetMinutes') <> 'number'
         or (r ->> 'offsetMinutes')::numeric <> trunc((r ->> 'offsetMinutes')::numeric)
         or (r ->> 'offsetMinutes')::numeric not between 1 and 43200
         or (r ? 'template' and (jsonb_typeof(r -> 'template') <> 'string' or length(r ->> 'template') > 1500))
         or (r ? 'onlyIfNotConfirmed' and jsonb_typeof(r -> 'onlyIfNotConfirmed') <> 'boolean')
         or (r ? 'id' and jsonb_typeof(r -> 'id') not in ('string', 'number')) then
        return false;
      end if;
    end loop;
  end if;
  if c ? 'quietHours' then
    q := c -> 'quietHours';
    if jsonb_typeof(q) = 'null' then
      return true;
    end if;
    if jsonb_typeof(q) <> 'object'
       or (coalesce(q ->> 'from', '') <> '' and private.try_time(q ->> 'from') is null)
       or (coalesce(q ->> 'to', '') <> '' and private.try_time(q ->> 'to') is null) then
      return false;
    end if;
  end if;
  return true;
end $$;

-- M20 · Plantillas de fábrica con los avisos nuevos al cliente
create or replace function private.wa_default_config()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'enabled', false,
    'notifyTo', '[]'::jsonb,
    'notifyGroupId', null,
    'notifyOn', jsonb_build_object('new', true, 'cancel', true, 'reschedule', true),
    'confirmationToClient', true,
    'templates', jsonb_build_object(
      'shopNew',          E'💈 Nueva reserva ({codigo})\n{cliente} · {telefono}\n{servicio} con {barbero}\n{fecha} a las {hora}',
      'shopCancel',       E'❌ Cita cancelada ({codigo})\n{cliente} · {servicio} con {barbero}\n{fecha} a las {hora}',
      'shopReschedule',   E'🔁 Cita reprogramada ({codigo})\n{cliente} · {servicio} con {barbero}\nNueva fecha: {fecha} a las {hora}',
      'clientConfirm',    E'Hola {cliente}, tu cita en *{barberia}* quedó registrada.\n\n*Servicio:* {servicio}\n*Barbero:* {barbero}\n*Fecha:* {fecha}, {hora}\n*Código:* {codigo}\n\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.',
      'clientCancel',     E'Hola {cliente}, tu cita en *{barberia}* del {fecha} a las {hora} fue cancelada.\n\nSi quieres otra fecha, puedes reservar de nuevo en nuestra web.',
      'clientReschedule', E'Hola {cliente}, tu cita en *{barberia}* cambió de horario.\n\n*Servicio:* {servicio}\n*Barbero:* {barbero}\n*Nueva fecha:* {fecha}, {hora}\n*Código:* {codigo}\n\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.'
    ),
    'reminders', jsonb_build_array(
      jsonb_build_object('id', 'r1', 'offsetMinutes', 1440, 'onlyIfNotConfirmed', false,
        'template', E'Hola {cliente}, te recordamos tu cita {cuando} a las {hora} con {barbero} en {barberia}. {direccion}\n¡Te esperamos!'),
      jsonb_build_object('id', 'r2', 'offsetMinutes', 120, 'onlyIfNotConfirmed', false,
        'template', E'{cliente}, tu cita es {cuando} a las {hora} con {barbero}. ¡Te esperamos en {barberia}!')
    ),
    'quietHours', jsonb_build_object('from', '21:00', 'to', '08:00')
  )
$$;

-- Barberías existentes: reciben las plantillas nuevas que les falten (las suyas no cambian)
update public.tenants
   set whatsapp = jsonb_set(whatsapp, '{templates}',
                            (private.wa_default_config() -> 'templates')
                            || case when jsonb_typeof(whatsapp -> 'templates') = 'object'
                                    then whatsapp -> 'templates' else '{}'::jsonb end)
 where jsonb_typeof(whatsapp) = 'object'
   and (jsonb_typeof(whatsapp -> 'templates') is distinct from 'object'
        or not (whatsapp -> 'templates') ? 'clientCancel'
        or not (whatsapp -> 'templates') ? 'clientReschedule');

alter table public.tenants drop constraint if exists tenants_whatsapp_valid;
alter table public.tenants add constraint tenants_whatsapp_valid check (private.wa_config_valida(whatsapp)) not valid;
do $$
begin
  alter table public.tenants validate constraint tenants_whatsapp_valid;
exception when check_violation then
  raise notice 'Hay barberías con una configuración de WhatsApp mal formada: %. Corrígela desde el CRM (Configuración → WhatsApp → Guardar).',
    (select string_agg(slug, ', ') from public.tenants where not private.wa_config_valida(whatsapp));
end $$;

-- --------------------------------------------------------------------------
-- 3. A3 · Contraseña temporal
-- --------------------------------------------------------------------------
-- Huella de la contraseña temporal: al cambiarla en Supabase Auth, la huella
-- deja de coincidir y recién ahí se puede quitar must_change_password.
create table if not exists private.temp_passwords (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pw_hash text,
  set_at  timestamptz not null default now()
);
revoke all on private.temp_passwords from public;

-- Usuarios que hoy tienen la clave temporal pendiente
insert into private.temp_passwords (user_id, pw_hash)
select p.id, u.encrypted_password
from public.profiles p join auth.users u on u.id = p.id
where p.must_change_password
on conflict (user_id) do nothing;

create or replace function private.clave_cambiada(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.temp_passwords s
                 join auth.users u on u.id = s.user_id
                 where s.user_id = p_user and u.encrypted_password is distinct from s.pw_hash)
$$;

create or replace function private.guardar_huella(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  insert into private.temp_passwords (user_id, pw_hash, set_at)
  select u.id, u.encrypted_password, now() from auth.users u where u.id = p_user
  on conflict (user_id) do update set pw_hash = excluded.pw_hash, set_at = excluded.set_at
$$;

-- Mientras la contraseña sea temporal, el usuario no tiene rol, barbería ni
-- módulos: RLS le niega todo salvo leer y editar su propio perfil.
create or replace function private.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active and not p.must_change_password
$$;

create or replace function private.my_tenant()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.tenant_id
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id and t.status = 'ACTIVE'
  where p.id = auth.uid() and p.active and not p.must_change_password
$$;

create or replace function private.my_barber()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.barber_id from public.profiles p
  where p.id = auth.uid() and p.active and p.role = 'STAFF' and not p.must_change_password
$$;

create or replace function private.has_grant(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_superadmin() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'ADMIN' and not p.must_change_password
      and coalesce((p.grants ->> p_key)::boolean, false)
  )
$$;

create or replace function private.profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return new;                                   -- servidor (Edge Function, secret key)
  end if;
  -- Quitar la marca de clave temporal: solo si la contraseña ya cambió
  -- (o lo hace un superadmin con otra cuenta).
  if old.must_change_password and not new.must_change_password
     and not (private.is_superadmin() and new.id <> auth.uid())
     and not private.clave_cambiada(new.id) then
    raise exception 'Primero cambia tu contraseña temporal.' using errcode = '42501';
  end if;
  if private.is_superadmin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.tenant_id is distinct from old.tenant_id
     or new.email is distinct from old.email
     or new.grants is distinct from old.grants then
    raise exception 'No puedes cambiar rol, barbería, correo ni permisos.' using errcode = '42501';
  end if;
  if new.id = auth.uid()
     and (new.active is distinct from old.active or new.barber_id is distinct from old.barber_id) then
    raise exception 'No puedes cambiar tu propio estado ni tu vínculo de barbero.' using errcode = '42501';
  end if;
  return new;
end $$;

-- Al marcar una clave como temporal se guarda su huella automáticamente
create or replace function private.profiles_huella()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.must_change_password and (tg_op = 'INSERT' or not old.must_change_password) then
    perform private.guardar_huella(new.id);
  elsif not new.must_change_password and tg_op = 'UPDATE' and old.must_change_password then
    delete from private.temp_passwords where user_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists profiles_huella on public.profiles;
create trigger profiles_huella after insert or update of must_change_password on public.profiles
  for each row execute function private.profiles_huella();

-- RPC del CRM: llamar DESPUÉS de supabase.auth.updateUser({ password })
create or replace function public.perfil_contrasena_cambiada()
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not me.active then
    raise exception 'Sesión no válida.' using errcode = '42501';
  end if;
  if not me.must_change_password then
    return true;
  end if;
  if not private.clave_cambiada(me.id) then
    raise exception 'Primero cambia tu contraseña temporal.' using errcode = '42501';
  end if;
  update public.profiles set must_change_password = false where id = me.id;
  return true;
end $$;

-- RPC de la Edge Function admin-usuarios (secret key): tras crear o
-- restablecer una contraseña, la marca como temporal y guarda su huella.
create or replace function public.perfil_clave_temporal(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set must_change_password = true where id = p_user_id;
  perform private.guardar_huella(p_user_id);
end $$;

-- Historial: tampoco se escribe con la clave temporal
create or replace function public.registrar_actividad(p_action text, p_detail text default '', p_tenant_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and active and not must_change_password;
  if me.id is null then
    raise exception 'Sesión no válida.' using errcode = '42501';
  end if;
  insert into public.audit_log (tenant_id, user_id, user_name, role, action, detail)
  values (case when me.role = 'SUPERADMIN' then p_tenant_id else private.my_tenant() end,
          me.id, coalesce(nullif(me.name, ''), me.email), me.role,
          left(p_action, 120), left(coalesce(p_detail, ''), 1000));
end $$;

-- --------------------------------------------------------------------------
-- 4. Citas
-- --------------------------------------------------------------------------
-- A1 · Fin de la cita. Ocupan agenda todos los estados salvo CANCELADA.
alter table public.appointments add column if not exists ends_at timestamptz;
alter table public.appointments disable trigger user;        -- relleno sin disparar reglas ni WhatsApp
update public.appointments
   set ends_at = starts_at + make_interval(mins => greatest(duration_min, 1))
 where ends_at is distinct from starts_at + make_interval(mins => greatest(duration_min, 1));
alter table public.appointments enable trigger user;
alter table public.appointments alter column ends_at set not null;
create index if not exists appointments_barber_range on public.appointments (barber_id, starts_at)
  where status <> 'CANCELADA';

alter table public.appointments drop constraint if exists appointments_duration_check;
alter table public.appointments
  add constraint appointments_duration_check check (duration_min between 5 and 480) not valid;

-- Tramos del día: de la barbería y, si tiene horario propio, del barbero
-- (mismas reglas que private.horario_slots de la migración 6)
create or replace function private.rangos_dia(p_tenant uuid, p_barber uuid, p_date date,
                                              out shop jsonb, out barber jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.tenants;
  v_dow text := extract(dow from p_date)::int::text;
begin
  select * into t from public.tenants where id = p_tenant;
  select e.ranges into shop from public.schedule_exceptions e
  where e.tenant_id = p_tenant and e.barber_id is null and e.date = p_date;
  if shop is null then
    shop := coalesce(t.schedule -> 'week' -> v_dow, '[]'::jsonb);
  end if;
  barber := null;
  if p_barber is not null then
    select e.ranges into barber from public.schedule_exceptions e
    where e.tenant_id = p_tenant and e.barber_id = p_barber and e.date = p_date;
    if barber is null then
      select coalesce(b.schedule -> 'week' -> v_dow, case when b.schedule is null then null else '[]'::jsonb end)
        into barber
      from public.barbers b where b.id = p_barber and b.tenant_id = p_tenant;
    end if;
  end if;
end $$;

-- ¿Una cita de p_dur minutos que empieza a p_time cabe sin cruzar el cierre ni un descanso?
create or replace function private.cabe_en_horario(p_tenant uuid, p_barber uuid, p_date date, p_time time, p_dur int)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.slot_fits(p_time, greatest(p_dur, 1), r.shop)
     and (r.barber is null or private.slot_fits(p_time, greatest(p_dur, 1), r.barber))
  from private.rangos_dia(p_tenant, p_barber, p_date) r
$$;

-- Validación de cada cita (reemplaza la de la migración 6)
create or replace function private.appointments_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  b public.barbers;
  s public.services;
  local_now timestamp;
  slot_changed boolean;
  dur_changed boolean;
  v_max int;
  v_role text := case when auth.uid() is null then 'SERVER' else coalesce(private.my_role(), 'NONE') end;
  v_admin boolean;
  vigente constant text[] := array['PROGRAMADA', 'CONFIRMADA_WSP'];
  -- M12 · columnas que el personal (STAFF) no puede cambiar
  bloqueadas constant text[] := array['price', 'service_id', 'barber_id', 'duration_min', 'created_by',
                                      'customer_id', 'customer_name', 'phone', 'wa_opt_in', 'source',
                                      'service_name', 'barber_name'];
  jn jsonb;
  jo jsonb;
  k text;
  etiqueta constant jsonb := '{"PROGRAMADA":"programada","CONFIRMADA_WSP":"confirmada","COMPLETADA":"completada","CANCELADA":"cancelada","NO_ASISTIO":"no asistió"}';
begin
  v_admin := v_role in ('SERVER', 'SUPERADMIN', 'ADMIN');

  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'Una cita no puede cambiar de barbería.' using errcode = '42501';
    end if;
    if v_role = 'STAFF' then
      jn := to_jsonb(new);
      jo := to_jsonb(old);
      foreach k in array bloqueadas loop
        if (jn -> k) is distinct from (jo -> k) then
          raise exception 'El personal solo puede cambiar el estado, las notas y la fecha u hora de la cita.'
            using errcode = '42501';
        end if;
      end loop;
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

  -- A2 · Reglas de estados -------------------------------------------------
  if tg_op = 'INSERT' then
    if new.status = 'COMPLETADA' then
      if not v_admin then
        raise exception 'Solo un administrador puede registrar una cita ya atendida.' using errcode = '42501';
      end if;
    elsif not (new.status = any (vigente)) then
      raise exception 'Una cita nueva solo puede quedar programada o confirmada.' using errcode = '22023';
    end if;
  else
    if slot_changed and not (old.status = any (vigente) and new.status = any (vigente)) then
      raise exception 'Solo se pueden reprogramar citas programadas o confirmadas.' using errcode = '22023';
    end if;
    if new.status is distinct from old.status then
      if old.status = 'CANCELADA' then
        raise exception 'Esta cita ya fue cancelada; no se puede cambiar su estado.' using errcode = '22023';
      elsif old.status in ('COMPLETADA', 'NO_ASISTIO') then
        if new.status not in ('COMPLETADA', 'NO_ASISTIO') then
          raise exception 'Una cita % no puede pasar a %.', etiqueta ->> old.status, etiqueta ->> new.status
            using errcode = '22023';
        elsif not v_admin then
          raise exception 'Solo un administrador puede corregir si el cliente asistió.' using errcode = '42501';
        end if;
      elsif old.status = 'CONFIRMADA_WSP' and new.status = 'PROGRAMADA' and not slot_changed then
        raise exception 'Una cita confirmada solo vuelve a programada cuando se reprograma.' using errcode = '22023';
      end if;
    end if;
    -- Reprogramar una cita confirmada: el cliente debe volver a confirmar
    if slot_changed and new.status = 'CONFIRMADA_WSP' then
      new.status := 'PROGRAMADA';
    end if;
    if slot_changed and new.status = 'PROGRAMADA' then
      new.confirmed_at := null;
    end if;
  end if;

  -- Servicio: nombre y duración salen del servicio ----------------------------
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
  new.duration_min := coalesce(new.duration_min, 30);
  dur_changed := tg_op = 'INSERT' or new.duration_min is distinct from old.duration_min;

  if slot_changed then
    select * into b from public.barbers where id = new.barber_id and tenant_id = new.tenant_id;
    if b.id is null or not b.active then
      raise exception 'Ese barbero no está disponible.' using errcode = '22023';
    end if;
    new.barber_name := b.name;
  end if;

  new.starts_at := (new.date + new.time) at time zone t.timezone;
  new.ends_at := new.starts_at + make_interval(mins => greatest(new.duration_min, 1));
  new.customer_name := btrim(new.customer_name);

  -- Horario: solo citas vigentes (el historial importado no) ----------------
  if new.status = any (vigente) and (slot_changed or dur_changed) then
    if b.id is null then
      select * into b from public.barbers where id = new.barber_id and tenant_id = new.tenant_id;
    end if;
    if slot_changed then
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
    end if;
    if not private.cabe_en_horario(t.id, b.id, new.date, new.time, new.duration_min) then
      raise exception 'La cita dura % min y no alcanza antes del cierre o de un descanso. Elige otra hora.',
        new.duration_min using errcode = '22023';
    end if;
    -- Dos reservas a la vez para el mismo barbero se atienden en fila
    perform pg_advisory_xact_lock(hashtextextended('reservalope.barbero:' || new.barber_id::text, 0));
    if exists (select 1 from public.appointments a
               where a.barber_id = new.barber_id and a.status <> 'CANCELADA' and a.id <> new.id
                 and a.starts_at < new.ends_at and a.ends_at > new.starts_at) then
      raise exception 'Ese horario ya está ocupado para %.', b.name using errcode = '23505';
    end if;
  end if;

  -- COMPLETADA y NO_ASISTIO solo cuando la cita ya empezó
  if new.status in ('COMPLETADA', 'NO_ASISTIO')
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and new.starts_at > now() then
    raise exception 'Solo se puede marcar como % una cita que ya empezó.', etiqueta ->> new.status
      using errcode = '22023';
  end if;

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
-- 5. M6 · Nombres únicos por barbería y renombrar sin perder el historial
-- --------------------------------------------------------------------------
create or replace function private.nombre_unico()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_dup boolean;
begin
  new.name := btrim(new.name);
  if not new.active then
    return new;
  end if;
  if tg_table_name = 'barbers' then
    select exists (select 1 from public.barbers x where x.tenant_id = new.tenant_id and x.active
                   and x.id <> new.id and lower(x.name) = lower(new.name)) into v_dup;
    if v_dup then
      raise exception 'Ya existe un barbero llamado "%". Usa otro nombre.', new.name using errcode = '23505';
    end if;
  else
    select exists (select 1 from public.services x where x.tenant_id = new.tenant_id and x.active
                   and x.id <> new.id and lower(x.name) = lower(new.name)) into v_dup;
    if v_dup then
      raise exception 'Ya existe un servicio llamado "%". Usa otro nombre.', new.name using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists barbers_nombre_unico on public.barbers;
create trigger barbers_nombre_unico before insert or update of name, active on public.barbers
  for each row execute function private.nombre_unico();
drop trigger if exists services_nombre_unico on public.services;
create trigger services_nombre_unico before insert or update of name, active on public.services
  for each row execute function private.nombre_unico();

-- Índices únicos (si hoy hay nombres repetidos se avisa y no se crean; el
-- trigger de arriba igual impide repetir nombres nuevos)
do $$
declare
  v text;
begin
  select string_agg(x, ', ') into v from (
    select t.slug || ': ' || min(b.name) as x from public.barbers b join public.tenants t on t.id = b.tenant_id
    where b.active group by t.slug, b.tenant_id, lower(b.name) having count(*) > 1) d;
  if v is null then
    create unique index if not exists barbers_tenant_name_unique on public.barbers (tenant_id, lower(name)) where active;
  else
    raise notice 'Barberos con nombre repetido (renómbralos y vuelve a ejecutar esta migración para crear el índice): %', v;
  end if;

  select string_agg(x, ', ') into v from (
    select t.slug || ': ' || min(s.name) as x from public.services s join public.tenants t on t.id = s.tenant_id
    where s.active group by t.slug, s.tenant_id, lower(s.name) having count(*) > 1) d;
  if v is null then
    create unique index if not exists services_tenant_name_unique on public.services (tenant_id, lower(name)) where active;
  else
    raise notice 'Servicios con nombre repetido (renómbralos y vuelve a ejecutar esta migración para crear el índice): %', v;
  end if;
end $$;

-- Al renombrar un barbero, sus citas y su cola walk-in muestran el nombre nuevo
create or replace function private.barbers_renombrar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.appointments set barber_name = new.name
  where barber_id = new.id and barber_name is distinct from new.name;
  update public.walk_ins set barber_name = new.name
  where barber_id = new.id and barber_name is distinct from new.name;
  return null;
end $$;
drop trigger if exists barbers_renombrar on public.barbers;
create trigger barbers_renombrar after update of name on public.barbers
  for each row when (new.name is distinct from old.name)
  execute function private.barbers_renombrar();

-- --------------------------------------------------------------------------
-- 6. Clientes
-- --------------------------------------------------------------------------
-- M11 · ADMIN necesita el módulo Clientes. STAFF vinculado a un barbero ve
-- solo a los clientes con citas de su barbero; STAFF sin vínculo, todos.
create or replace function private.can_see_customer(p_tenant uuid, p_id uuid, p_phone text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_superadmin()
      or (p_tenant = private.my_tenant()
          and ((private.my_role() = 'ADMIN' and private.has_grant('customers'))
               or (private.my_role() = 'STAFF'
                   and (private.my_barber() is null
                        or exists (select 1 from public.appointments a
                                   where a.tenant_id = p_tenant and a.barber_id = private.my_barber()
                                     and (a.customer_id = p_id or (p_phone is not null and a.phone = p_phone)))))))
$$;

drop policy if exists customers_select on public.customers;
drop policy if exists customers_update on public.customers;
create policy customers_select on public.customers for select to authenticated
  using (private.can_see_customer(tenant_id, id, phone));
create policy customers_update on public.customers for update to authenticated
  using (private.can_see_customer(tenant_id, id, phone))
  with check ((select private.is_tenant_member(tenant_id)));

-- M14 · El CRM obtiene (o crea) la ficha del cliente SOLO por celular.
-- No renombra fichas existentes. Sin celular no crea nada (devuelve null).
create or replace function public.cliente_asegurar(p_name text, p_phone text, p_tenant_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := case when private.is_superadmin() then p_tenant_id else private.my_tenant() end;
  v_phone text := private.norm_phone(p_phone);
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_tenant is null or not private.is_tenant_member(v_tenant) then
    raise exception 'No tienes permiso para esta acción.' using errcode = '42501';
  end if;
  if v_phone = '' then
    return null;
  end if;
  if v_phone !~ '^[0-9]{9,15}$' then
    raise exception 'El celular del cliente no es válido.' using errcode = '22023';
  end if;
  select id into v_id from public.customers where tenant_id = v_tenant and phone = v_phone;
  if v_id is not null then
    return v_id;
  end if;
  if length(v_name) not between 2 and 80 then
    raise exception 'Escribe el nombre del cliente (de 2 a 80 caracteres).' using errcode = '22023';
  end if;
  insert into public.customers (tenant_id, name, phone) values (v_tenant, v_name, v_phone)
  on conflict (tenant_id, phone) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.customers where tenant_id = v_tenant and phone = v_phone;
  end if;
  return v_id;
end $$;

-- --------------------------------------------------------------------------
-- 7. Web pública
-- --------------------------------------------------------------------------
-- Ahora también responde para barberías suspendidas o vencidas (con
-- accepting = false) para que la web diga "reservas pausadas" en vez de
-- "no encontramos esta barbería". Solo un enlace desconocido devuelve null.
-- wa_enabled, accepting, lead_minutes, timezone y server_now van en la raíz
-- y también dentro de "tenant".
create or replace function public.web_barberia(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'wa_enabled', private.wa_activo(t.whatsapp),
    'accepting', private.tenant_accepting(t),
    'lead_minutes', t.booking_lead_minutes,
    'timezone', t.timezone,
    'server_now', now(),
    'tenant', jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'logo_url', t.logo_url, 'palette', t.palette,
      'address', t.address, 'phone', t.phone, 'hours', t.hours, 'city', t.city,
      'currency', t.currency, 'timezone', t.timezone, 'schedule', t.schedule,
      'time_slots', (select coalesce(jsonb_agg(to_char(x, 'HH24:MI') order by x), '[]'::jsonb)
                     from unnest(t.time_slots) x),
      'wa_enabled', private.wa_activo(t.whatsapp),
      'server_now', now(),
      'lead_minutes', t.booking_lead_minutes,
      'accepting', private.tenant_accepting(t)
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

-- Horarios ocupados: ahora con la duración de cada cita (A1)
drop function if exists public.web_ocupados(text, int);
create function public.web_ocupados(p_slug text, p_days int default 60)
returns table (barber_id uuid, date date, "time" text, duration_min int)
language sql stable security definer set search_path = '' as $$
  select a.barber_id, a.date, to_char(a.time, 'HH24:MI'), a.duration_min
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  where t.slug = lower(p_slug) and t.status = 'ACTIVE'
    and a.status <> 'CANCELADA'
    and a.date >= (now() at time zone t.timezone)::date
    and a.date <= (now() at time zone t.timezone)::date + least(greatest(p_days, 1), 365)
$$;

-- Estado de cada horario. Con p_service_id se usa la duración de ese
-- servicio: "busy" si se cruza con otra cita o no cabe antes del cierre o de
-- un descanso; "past" si ya pasó o está dentro de la anticipación mínima.
drop function if exists public.web_horarios(text, uuid, date);
drop function if exists public.web_horarios(text, uuid, date, uuid);
create function public.web_horarios(p_slug text, p_barber_id uuid, p_date date, p_service_id uuid default null)
returns table (slot text, state text)
language sql stable security definer set search_path = '' as $$
  select to_char(x, 'HH24:MI') as slot,
         case
           when ((p_date + x) at time zone t.timezone) <= now() + make_interval(mins => t.booking_lead_minutes) then 'past'
           when not private.cabe_en_horario(t.id, p_barber_id, p_date, x, d.dur) then 'busy'
           when exists (select 1 from public.appointments a
                        where a.barber_id = p_barber_id and a.status <> 'CANCELADA'
                          and a.starts_at < ((p_date + x) at time zone t.timezone) + make_interval(mins => d.dur)
                          and a.ends_at > ((p_date + x) at time zone t.timezone)) then 'busy'
           else 'free'
         end as state
  from public.tenants t
  cross join lateral (
    select coalesce((select s.duration_min from public.services s
                     where s.id = p_service_id and s.tenant_id = t.id and s.active),
                    (t.schedule ->> 'interval')::int, 30) as dur) d
  cross join lateral unnest(private.horario_slots(t.id, p_barber_id, p_date)) x
  where t.slug = lower(p_slug) and t.status = 'ACTIVE'
    and exists (select 1 from public.barbers b where b.id = p_barber_id and b.tenant_id = t.id and b.active)
  order by x
$$;

-- "Mi cita": el celular también puede venir con +51 o espacios (M4)
create or replace function public.web_consultar_cita(p_slug text, p_phone text, p_code text)
returns table (code text, date date, "time" text, service_name text, barber_name text,
               status text, customer_name text)
language sql stable security definer set search_path = '' as $$
  select a.code, a.date, to_char(a.time, 'HH24:MI'), a.service_name, a.barber_name, a.status, a.customer_name
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  where t.slug = lower(p_slug) and t.status = 'ACTIVE'
    and a.phone = private.norm_phone(p_phone)
    and a.code = upper(btrim(coalesce(p_code, '')))
$$;

-- Crear reserva (A5, M5, B11, M17). Solo la Edge Function "reservar".
create or replace function public.crear_reserva(
  p_slug text, p_service_id uuid, p_barber_id uuid, p_date date, p_time time,
  p_name text, p_phone text, p_notes text default '', p_wa_opt_in boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
  v_phone text := private.norm_phone(p_phone);
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_start timestamptz;
  v_customer uuid;
  a public.appointments;
begin
  select * into t from public.tenants where slug = lower(btrim(coalesce(p_slug, '')));
  if t.id is null then
    raise exception 'Esta barbería no está disponible.' using errcode = '22023';
  end if;
  if not private.tenant_accepting(t) then
    raise exception 'Esta barbería no está recibiendo reservas en línea por ahora.' using errcode = '22023';
  end if;
  if p_service_id is null then
    raise exception 'Elige un servicio.' using errcode = '22023';
  end if;
  select * into s from public.services where id = p_service_id and tenant_id = t.id and active;
  if s.id is null then
    raise exception 'Ese servicio no está disponible.' using errcode = '22023';
  end if;
  if p_barber_id is null then
    raise exception 'Elige un barbero.' using errcode = '22023';
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
  v_start := (p_date + p_time) at time zone t.timezone;
  if v_start > now() and v_start < now() + make_interval(mins => t.booking_lead_minutes) then
    raise exception 'Reserva con al menos % minutos de anticipación. Elige una hora más tarde.',
      t.booking_lead_minutes using errcode = '22023';
  end if;

  -- A5 · Máximo 2 citas futuras vigentes por celular en esta barbería
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
                                     date, time, status, source, notes, wa_opt_in)
    values (t.id, v_customer, v_name, v_phone, s.id, p_barber_id,
            p_date, p_time, 'PROGRAMADA', 'WEB',
            coalesce(nullif(v_notes, ''), 'Reserva desde la web'), coalesce(p_wa_opt_in, false))
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
          a.service_name || ' · ' || a.barber_name || ' · ' || a.date || ' ' || to_char(a.time, 'HH24:MI'));

  return jsonb_build_object('id', a.id, 'code', a.code, 'date', a.date, 'time', to_char(a.time, 'HH24:MI'),
                            'service', a.service_name, 'barber', a.barber_name);
end $$;

-- --------------------------------------------------------------------------
-- 8. WhatsApp
-- --------------------------------------------------------------------------
-- Tipos nuevos: aviso al cliente cuando la barbería cancela o reprograma
do $$
declare
  c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.wa_outbox'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.wa_outbox drop constraint %I', c);
  end loop;
end $$;
alter table public.wa_outbox add constraint wa_outbox_kind_check check (kind in
  ('SHOP_NEW', 'SHOP_CANCEL', 'SHOP_RESCHEDULE', 'CLIENT_CONFIRM', 'CLIENT_CANCEL', 'CLIENT_RESCHEDULE',
   'REMINDER', 'REPLY', 'TEST'));
create index if not exists wa_outbox_recipient on public.wa_outbox (tenant_id, recipient, created_at desc);

-- B3 · Bajas por teléfono (aunque no haya ficha de cliente o el número no sea peruano)
create table if not exists public.wa_opt_outs (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  phone      text not null check (phone ~ '^[0-9]{9,15}$'),   -- formato de WhatsApp: 51XXXXXXXXX
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);
alter table public.wa_opt_outs enable row level security;
revoke all on public.wa_opt_outs from anon, authenticated;
grant select, delete on public.wa_opt_outs to authenticated;
drop policy if exists wa_opt_outs_select on public.wa_opt_outs;
drop policy if exists wa_opt_outs_delete on public.wa_opt_outs;
create policy wa_opt_outs_select on public.wa_opt_outs for select to authenticated
  using ((select private.is_superadmin())
         or (tenant_id = (select private.my_tenant()) and (select private.my_role()) = 'ADMIN'
             and (select private.has_grant('settings'))));
create policy wa_opt_outs_delete on public.wa_opt_outs for delete to authenticated
  using ((select private.is_superadmin())
         or (tenant_id = (select private.my_tenant()) and (select private.my_role()) = 'ADMIN'
             and (select private.has_grant('settings'))));

insert into public.wa_opt_outs (tenant_id, phone, created_at)
select c.tenant_id, private.wa_phone(c.phone), c.wa_opt_out_at
from public.customers c
where c.wa_opt_out_at is not null and private.wa_phone(c.phone) is not null
on conflict do nothing;

-- Quitar la baja en la ficha del cliente (CRM) también la quita de la lista
create or replace function private.customers_baja()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.wa_opt_out_at is null and old.wa_opt_out_at is not null and private.wa_phone(new.phone) is not null then
    delete from public.wa_opt_outs where tenant_id = new.tenant_id and phone = private.wa_phone(new.phone);
  end if;
  return null;
end $$;
drop trigger if exists customers_baja on public.customers;
create trigger customers_baja after update of wa_opt_out_at on public.customers
  for each row execute function private.customers_baja();

create or replace function private.wa_de_baja(p_tenant uuid, p_to text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_to is not null and exists (select 1 from public.wa_opt_outs o where o.tenant_id = p_tenant and o.phone = p_to)
$$;

-- M19 · Fin de las horas de silencio que contienen p_send (null = no está en silencio)
create or replace function private.wa_fin_silencio(p_send timestamptz, cfg jsonb, tz text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  qf time := private.try_time(cfg -> 'quietHours' ->> 'from');
  qt time := private.try_time(cfg -> 'quietHours' ->> 'to');
  loc timestamp := p_send at time zone tz;
  lt time := loc::time;
begin
  if qf is null or qt is null or qf = qt then
    return null;
  end if;
  if qf > qt then                                     -- el silencio cruza la medianoche
    if lt >= qf then return ((loc::date + 1) + qt) at time zone tz; end if;
    if lt < qt then return (loc::date + qt) at time zone tz; end if;
    return null;
  end if;
  if lt >= qf and lt < qt then
    return (loc::date + qt) at time zone tz;
  end if;
  return null;
end $$;

-- Mismo ajuste de la migración 4 pero tolerante a horas mal escritas
create or replace function private.wa_quiet_adjust(p_send timestamptz, cfg jsonb, tz text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  qf time := private.try_time(cfg -> 'quietHours' ->> 'from');
  qt time := private.try_time(cfg -> 'quietHours' ->> 'to');
  loc timestamp := p_send at time zone tz;
  lt time := loc::time;
  d date;
begin
  if qf is null or qt is null or qf = qt then
    return p_send;
  end if;
  if qf > qt then
    if lt >= qf then d := loc::date;
    elsif lt < qt then d := loc::date - 1;
    else return p_send;
    end if;
  else
    if lt >= qf and lt < qt then d := loc::date;
    else return p_send;
    end if;
  end if;
  return ((d + qf) - interval '30 minutes') at time zone tz;
end $$;

-- Cuándo sale un mensaje al cliente que "debería salir ya": ahora, o al
-- terminar el silencio (sin pasarse de 30 min antes de la cita).
create or replace function private.wa_envio_cliente(cfg jsonb, tz text, p_starts timestamptz)
returns timestamptz language sql stable set search_path = '' as $$
  select case
    when f is null then now()
    else greatest(now(), least(f, p_starts - interval '30 minutes'))
  end
  from (select private.wa_fin_silencio(now(), cfg, tz) as f) x
$$;

create or replace function private.wa_notificar_barberia(t public.tenants, a public.appointments, p_kind text, p_tpl text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n text;
  body text := private.wa_render(p_tpl, a, t);
begin
  if nullif(btrim(coalesce(p_tpl, '')), '') is null then
    return;
  end if;
  if jsonb_typeof(t.whatsapp -> 'notifyTo') = 'array' then
    for n in select jsonb_array_elements_text(t.whatsapp -> 'notifyTo') loop
      if private.wa_phone(n) is not null then
        insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
        values (t.id, a.id, p_kind, private.wa_phone(n), private.wa_phone(n), body)
        on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing;
      end if;
    end loop;
  end if;
  if jsonb_typeof(t.whatsapp -> 'notifyGroupId') = 'string' and nullif(t.whatsapp ->> 'notifyGroupId', '') is not null then
    insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
    values (t.id, a.id, p_kind, 'group', t.whatsapp ->> 'notifyGroupId', body)
    on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing;
  end if;
end $$;

-- Aviso al cliente (confirmación, cancelación o reprogramación) respetando el silencio
create or replace function private.wa_avisar_cliente(t public.tenants, a public.appointments, p_kind text, p_tpl text, p_to text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if nullif(btrim(coalesce(p_tpl, '')), '') is null or a.starts_at <= now() then
    return;
  end if;
  insert into public.wa_outbox (tenant_id, appointment_id, kind, recipient, body, send_at)
  values (t.id, a.id, p_kind, p_to, private.wa_render(p_tpl, a, t),
          private.wa_envio_cliente(t.whatsapp, t.timezone, a.starts_at))
  on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing;
end $$;

-- Recordatorios. M19: si el ajuste por silencio ya pasó, sale al terminar el
-- silencio (antes se descartaba). M20: "solo si no confirmó" no se programa
-- para una cita ya confirmada.
create or replace function private.wa_programar_recordatorios(t public.tenants, a public.appointments, p_to text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_off int;
  v_raw timestamptz;
  v_send timestamptz;
  v_only boolean;
begin
  if jsonb_typeof(t.whatsapp -> 'reminders') <> 'array' then
    return;
  end if;
  for r in select value from jsonb_array_elements(t.whatsapp -> 'reminders') loop
    continue when jsonb_typeof(r) <> 'object' or jsonb_typeof(r -> 'offsetMinutes') <> 'number';
    v_off := (r ->> 'offsetMinutes')::numeric::int;
    continue when v_off <= 0;
    v_only := private.jb(r -> 'onlyIfNotConfirmed', false);
    continue when v_only and a.status = 'CONFIRMADA_WSP';
    v_raw := a.starts_at - make_interval(mins => v_off);
    continue when v_raw <= now();                     -- ese recordatorio ya no corresponde
    v_send := private.wa_quiet_adjust(v_raw, t.whatsapp, t.timezone);
    if v_send <= now() then
      v_send := coalesce(private.wa_fin_silencio(v_raw, t.whatsapp, t.timezone), v_raw);
    end if;
    continue when v_send >= a.starts_at;
    insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body, send_at, only_if_not_confirmed)
    values (t.id, a.id, 'REMINDER', coalesce(r ->> 'id', ''), p_to, private.wa_render(r ->> 'template', a, t, v_send),
            v_send, v_only)
    on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing;
  end loop;
end $$;

-- Trigger de citas → cola. Nunca hace fallar una cita (B6): si algo sale
-- mal se registra en wa_sessions.last_error y la cita se guarda igual.
create or replace function private.wa_programar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  cfg jsonb;
  v_to text;
  client_ok boolean;
  v_resched boolean := false;
  vigente constant text[] := array['PROGRAMADA', 'CONFIRMADA_WSP'];
begin
  begin
    select * into t from public.tenants where id = new.tenant_id;
    cfg := coalesce(t.whatsapp, '{}'::jsonb);

    -- A6 · Lo pendiente se anula aunque WhatsApp esté apagado
    if tg_op = 'UPDATE' then
      v_resched := new.status = any (vigente) and old.status = any (vigente)
                   and (new.date, new.time, new.barber_id) is distinct from (old.date, old.time, old.barber_id);
      if not (new.status = any (vigente)) and old.status = any (vigente) then
        update public.wa_outbox set status = 'CANCELLED', last_error = 'La cita se cerró'
        where appointment_id = new.id and status = 'PENDING'
          and kind in ('REMINDER', 'CLIENT_CONFIRM', 'CLIENT_RESCHEDULE', 'SHOP_RESCHEDULE');
      elsif v_resched then
        -- M22 · el aviso de reprogramación pendiente se reemplaza por el nuevo
        update public.wa_outbox set status = 'CANCELLED', last_error = 'Cita reprogramada'
        where appointment_id = new.id and status = 'PENDING'
          and kind in ('REMINDER', 'CLIENT_CONFIRM', 'CLIENT_RESCHEDULE', 'SHOP_RESCHEDULE');
      end if;
    end if;

    if not private.wa_activo(cfg) then
      return null;
    end if;

    v_to := private.wa_phone(new.phone);
    client_ok := new.wa_opt_in and v_to is not null
                 and not private.wa_de_baja(t.id, v_to)
                 and not exists (select 1 from public.customers c
                                 where c.id = new.customer_id and c.wa_opt_out_at is not null);

    if tg_op = 'INSERT' then
      if not (new.status = any (vigente)) then
        return null;                                 -- historial importado: no avisar
      end if;
      if private.jb(cfg -> 'notifyOn' -> 'new', true) then
        perform private.wa_notificar_barberia(t, new, 'SHOP_NEW', cfg -> 'templates' ->> 'shopNew');
      end if;
      if client_ok then
        if private.jb(cfg -> 'confirmationToClient', true) then
          perform private.wa_avisar_cliente(t, new, 'CLIENT_CONFIRM', cfg -> 'templates' ->> 'clientConfirm', v_to);
        end if;
        perform private.wa_programar_recordatorios(t, new, v_to);
      end if;
      return null;
    end if;

    -- Cita cerrada (cancelada, completada o no asistió)
    if not (new.status = any (vigente)) and old.status = any (vigente) then
      if new.status = 'CANCELADA' then
        if private.jb(cfg -> 'notifyOn' -> 'cancel', true) then
          perform private.wa_notificar_barberia(t, new, 'SHOP_CANCEL', cfg -> 'templates' ->> 'shopCancel');
        end if;
        if client_ok then
          perform private.wa_avisar_cliente(t, new, 'CLIENT_CANCEL', cfg -> 'templates' ->> 'clientCancel', v_to);
        end if;
      end if;
      return null;
    end if;

    -- Reprogramada: avisos y recordatorios nuevos
    if v_resched then
      if private.jb(cfg -> 'notifyOn' -> 'reschedule', true) then
        perform private.wa_notificar_barberia(t, new, 'SHOP_RESCHEDULE', cfg -> 'templates' ->> 'shopReschedule');
      end if;
      if client_ok then
        perform private.wa_avisar_cliente(t, new, 'CLIENT_RESCHEDULE', cfg -> 'templates' ->> 'clientReschedule', v_to);
        perform private.wa_programar_recordatorios(t, new, v_to);
      end if;
    end if;

    -- El cliente aceptó WhatsApp después de creada la cita
    if new.status = any (vigente) and client_ok and not old.wa_opt_in then
      perform private.wa_programar_recordatorios(t, new, v_to);
    end if;

    -- Confirmada: anular recordatorios marcados "solo si no ha confirmado"
    if new.status = 'CONFIRMADA_WSP' and old.status <> 'CONFIRMADA_WSP' then
      update public.wa_outbox set status = 'CANCELLED', last_error = 'El cliente ya confirmó'
      where appointment_id = new.id and status = 'PENDING' and kind = 'REMINDER' and only_if_not_confirmed;
    end if;
  exception when others then
    raise warning 'WhatsApp: no se pudo programar el mensaje de la cita %: %', new.id, sqlerrm;
    begin
      update public.wa_sessions set last_error = left('No se pudo programar un mensaje: ' || sqlerrm, 500)
      where tenant_id = new.tenant_id;
    exception when others then
      null;
    end;
  end;
  return null;
end $$;

-- Anular todo lo pendiente de una barbería
create or replace function private.wa_cancelar_pendientes(p_tenant uuid, p_motivo text)
returns void language sql security definer set search_path = '' as $$
  update public.wa_outbox set status = 'CANCELLED', locked_at = null, last_error = p_motivo
  where tenant_id = p_tenant and status = 'PENDING'
$$;

-- A6 · Apagar WhatsApp anula lo pendiente de esa barbería
create or replace function private.tenants_wa_apagado()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.wa_activo(old.whatsapp) and not private.wa_activo(new.whatsapp) then
    perform private.wa_cancelar_pendientes(new.id, 'WhatsApp desactivado');
  end if;
  return null;
end $$;
drop trigger if exists tenants_wa_apagado on public.tenants;
create trigger tenants_wa_apagado after update of whatsapp on public.tenants
  for each row execute function private.tenants_wa_apagado();

-- A6 · Desvincular (pedido del CRM o cierre desde el celular) también
create or replace function private.wa_sessions_logout()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.requested_action = 'LOGOUT' and (tg_op = 'INSERT' or old.requested_action is distinct from 'LOGOUT'))
     or (new.status = 'LOGGED_OUT' and (tg_op = 'INSERT' or old.status is distinct from 'LOGGED_OUT')) then
    perform private.wa_cancelar_pendientes(new.tenant_id, 'WhatsApp desvinculado');
  end if;
  return null;
end $$;
drop trigger if exists wa_sessions_logout on public.wa_sessions;
create trigger wa_sessions_logout after insert or update on public.wa_sessions
  for each row execute function private.wa_sessions_logout();

-- Botón "Enviar prueba": máximo 5 por barbería por hora
create or replace function public.wa_enviar_prueba(p_numero text, p_tenant_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_for_admin(p_tenant_id, 'settings');
  v_to text := private.wa_phone(p_numero);
  v_name text;
  v_id uuid;
begin
  if v_to is null then
    raise exception 'Número no válido.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reservalope.prueba:' || v_tenant::text, 0));
  if (select count(*) from public.wa_outbox
      where tenant_id = v_tenant and kind = 'TEST' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Ya enviaste 5 mensajes de prueba en la última hora. Espera un rato.' using errcode = '22023';
  end if;
  select name into v_name from public.tenants where id = v_tenant;
  insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body)
  values (v_tenant, 'TEST', gen_random_uuid()::text, v_to,
          'Mensaje de prueba de ' || v_name || '. Si lo recibiste, WhatsApp está bien configurado. ✅')
  returning id into v_id;
  return v_id;
end $$;

-- --------------------------------------------------------------------------
-- Bot: tomar mensajes (A6, A9, B5, M19, M20, M22). Misma firma.
--   · Solo barberías ACTIVAS con WhatsApp encendido (las pruebas TEST salen
--     aunque esté apagado, para probar antes de encenderlo).
--   · Caducan: avisos a la barbería, pruebas y respuestas con más de 12 h;
--     todo mensaje de una cita que ya empezó (salvo REPLY).
--   · "Enviando" atascado con 3 intentos → FAILED.
--   · Bajas, recordatorios "solo si no confirmó" de citas confirmadas y
--     mensajes de citas cerradas → CANCELLED.
--   · Mensajes al cliente dentro del silencio: se posponen al final.
--   · Reparto justo: como máximo ceil(p_limit / barberías con mensajes) por barbería.
-- --------------------------------------------------------------------------
create or replace function public.bot_tomar_mensajes(p_limit int default 20, p_tenants uuid[] default null)
returns setof public.wa_outbox language plpgsql security definer set search_path = '' as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 20), 100));
  cliente constant text[] := array['CLIENT_CONFIRM', 'CLIENT_CANCEL', 'CLIENT_RESCHEDULE', 'REMINDER'];
begin
  update public.wa_outbox o
     set status = 'FAILED', locked_at = null,
         last_error = coalesce(o.last_error || ' · ', '') || 'Sin confirmación de envío tras 3 intentos'
   where o.status = 'SENDING' and o.locked_at < now() - interval '10 minutes' and o.attempts >= 3
     and (p_tenants is null or o.tenant_id = any (p_tenants));

  update public.wa_outbox o
     set status = 'CANCELLED', locked_at = null, last_error = 'Caducó sin enviarse'
   where (o.status = 'PENDING' or (o.status = 'SENDING' and o.locked_at < now() - interval '10 minutes'))
     and (p_tenants is null or o.tenant_id = any (p_tenants))
     and ((o.kind in ('SHOP_NEW', 'SHOP_CANCEL', 'SHOP_RESCHEDULE', 'TEST', 'REPLY')
           and o.created_at < now() - interval '12 hours')
          or (o.kind <> 'REPLY' and o.appointment_id is not null
              and exists (select 1 from public.appointments a where a.id = o.appointment_id and a.starts_at <= now())));

  update public.wa_outbox o
     set status = 'CANCELLED', locked_at = null,
         last_error = case when private.wa_de_baja(o.tenant_id, o.recipient) then 'El cliente pidió BAJA'
                           else 'Ya no corresponde' end
   where o.status = 'PENDING' and o.send_at <= now()
     and (p_tenants is null or o.tenant_id = any (p_tenants))
     and o.kind = any (cliente)
     and (private.wa_de_baja(o.tenant_id, o.recipient)
          or exists (select 1 from public.appointments a where a.id = o.appointment_id
                     and ((o.kind = 'REMINDER' and o.only_if_not_confirmed and a.status = 'CONFIRMADA_WSP')
                          or (o.kind <> 'CLIENT_CANCEL' and a.status not in ('PROGRAMADA', 'CONFIRMADA_WSP')))));

  update public.wa_outbox o
     set send_at = private.wa_fin_silencio(now(), t.whatsapp, t.timezone)
    from public.tenants t
   where t.id = o.tenant_id and o.status = 'PENDING' and o.send_at <= now()
     and (p_tenants is null or o.tenant_id = any (p_tenants))
     and o.kind = any (cliente)
     and private.wa_fin_silencio(now(), t.whatsapp, t.timezone) is not null;

  return query
  with cand as (
    select x.id, x.tenant_id, x.send_at
    from public.wa_outbox x
    join public.tenants t on t.id = x.tenant_id
    where ((x.status = 'PENDING' and x.send_at <= now())
        or (x.status = 'SENDING' and x.locked_at < now() - interval '10 minutes' and x.attempts < 3))
      and (p_tenants is null or x.tenant_id = any (p_tenants))
      and t.status = 'ACTIVE'
      and (private.wa_activo(t.whatsapp) or x.kind = 'TEST')
    order by x.send_at
    limit 1000
    for update of x skip locked
  ), ranked as (
    select c.id, c.send_at, row_number() over (partition by c.tenant_id order by c.send_at, c.id) as rn
    from cand c
  ), cupo as (
    select ceil(v_lim::numeric / greatest(1, count(distinct c.tenant_id)))::int as por from cand c
  )
  update public.wa_outbox o
     set status = 'SENDING', locked_at = now(), attempts = o.attempts + 1
   where o.id in (select r.id from ranked r, cupo where r.rn <= cupo.por order by r.send_at, r.id limit v_lim)
  returning o.*;
end $$;

-- Resultado de un envío. Ahora devuelve true si encontró el mensaje (el bot
-- puede reintentar el marcado si recibe error o false).
drop function if exists public.bot_marcar(uuid, boolean, text);
create function public.bot_marcar(p_id uuid, p_ok boolean, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.wa_outbox set
    status     = case when p_ok then 'SENT' when attempts >= 3 then 'FAILED' else 'PENDING' end,
    sent_at    = case when p_ok then now() else sent_at end,
    send_at    = case when p_ok then send_at else now() + interval '2 minutes' end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    locked_at  = null
  where id = p_id;
  return found;
end $$;

-- --------------------------------------------------------------------------
-- Respuestas del cliente (A9, B3, B5, M21)
--   · CONFIRMAR, "confirmar <código>" o "si confirmo" (ya no "ok", "sí", "1").
--   · Varias citas sin confirmar y sin código → pide el código una vez.
--   · Ya confirmada y ya respondida → no responde de nuevo.
--   · BAJA / STOP → guarda la baja por teléfono; responde solo la primera vez.
--   · Máximo 5 respuestas por remitente por hora; barbería suspendida o con
--     WhatsApp apagado → no responde.
-- --------------------------------------------------------------------------
create or replace function public.bot_respuesta(p_tenant_id uuid, p_from text, p_text text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  v_to text := private.wa_phone(regexp_replace(coalesce(p_from, ''), '\D', '', 'g'));
  v_local text;
  v_txt text := btrim(regexp_replace(
                  lower(translate(coalesce(p_text, ''), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')),
                  '[^a-z0-9ñ ]+', ' ', 'g'));
  v_code text;
  a public.appointments;
  v_pend int;
  v_reply text;
  v_rule text := gen_random_uuid()::text;
  v_n int;
  v_id uuid;
begin
  select * into t from public.tenants where id = p_tenant_id;
  if t.id is null or v_to is null or t.status <> 'ACTIVE' or not private.wa_activo(t.whatsapp) then
    return null;
  end if;
  v_local := case when v_to ~ '^519[0-9]{8}$' then substr(v_to, 3) end;
  v_txt := regexp_replace(v_txt, '\s+', ' ', 'g');

  if v_txt in ('baja', 'stop') then
    insert into public.wa_opt_outs (tenant_id, phone) values (t.id, v_to) on conflict do nothing;
    get diagnostics v_n = row_count;
    update public.customers set wa_opt_out_at = coalesce(wa_opt_out_at, now())
    where tenant_id = t.id and v_local is not null and phone = v_local;
    update public.wa_outbox set status = 'CANCELLED', last_error = 'El cliente pidió BAJA'
    where tenant_id = t.id and status = 'PENDING' and recipient = v_to
      and kind in ('REMINDER', 'CLIENT_CONFIRM', 'CLIENT_CANCEL', 'CLIENT_RESCHEDULE');
    if v_n = 0 then
      return null;                                   -- ya estaba de baja: no se repite la respuesta
    end if;
    v_reply := 'Listo, no te enviaremos más mensajes automáticos por WhatsApp.';
  elsif v_local is not null and v_txt ~ '^(confirmar|si confirmo)( [a-z0-9]{6})?$' then
    v_code := upper(nullif(substring(v_txt from ' ([a-z0-9]{6})$'), ''));
    if v_code is not null then
      select * into a from public.appointments
      where tenant_id = t.id and phone = v_local and code = v_code
        and status in ('PROGRAMADA', 'CONFIRMADA_WSP') and starts_at > now();
    else
      select count(*) into v_pend from public.appointments
      where tenant_id = t.id and phone = v_local and status = 'PROGRAMADA' and starts_at > now();
      if v_pend > 1 then
        select * into a from public.appointments
        where tenant_id = t.id and phone = v_local and status = 'PROGRAMADA' and starts_at > now()
        order by starts_at limit 1;
        if exists (select 1 from public.wa_outbox where tenant_id = t.id and recipient = v_to
                   and kind = 'REPLY' and rule_id = 'pedir-codigo' and created_at > now() - interval '12 hours') then
          return null;
        end if;
        v_rule := 'pedir-codigo';
        v_reply := private.wa_render(E'Tienes más de una cita próxima en *{barberia}*. Para confirmar una, responde *CONFIRMAR* seguido de su código (por ejemplo: CONFIRMAR {codigo}).', a, t);
        a := null;
      else
        select * into a from public.appointments
        where tenant_id = t.id and phone = v_local
          and status in ('PROGRAMADA', 'CONFIRMADA_WSP') and starts_at > now()
        order by (status = 'PROGRAMADA') desc, starts_at limit 1;
      end if;
    end if;
    if v_reply is null then
      if a.id is null then
        return null;
      end if;
      if a.status = 'CONFIRMADA_WSP'
         and exists (select 1 from public.wa_outbox where appointment_id = a.id and kind = 'REPLY'
                     and rule_id = 'confirmada' and status <> 'CANCELLED' and created_at >= coalesce(a.confirmed_at, a.created_at)) then
        return null;                                 -- ya confirmada y ya se respondió
      end if;
      if a.status = 'PROGRAMADA' then
        update public.appointments set status = 'CONFIRMADA_WSP' where id = a.id;
        insert into public.audit_log (tenant_id, user_name, role, action, detail)
        values (t.id, a.customer_name || ' (WhatsApp)', 'PUBLIC', 'Cliente confirmó su cita',
                a.date || ' ' || to_char(a.time, 'HH24:MI') || ' · ' || a.barber_name);
      end if;
      v_rule := 'confirmada';
      v_reply := private.wa_render(E'✅ *Asistencia confirmada*\nGracias, {cliente}. Te esperamos el {fecha} a las {hora}.', a, t);
    end if;
  else
    return null;                                     -- lo atiende la barbería a mano
  end if;

  -- Límite: 5 respuestas por remitente por hora
  if (select count(*) from public.wa_outbox where tenant_id = t.id and recipient = v_to
      and kind = 'REPLY' and created_at > now() - interval '1 hour') >= 5 then
    return null;
  end if;

  insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
  values (t.id, a.id, 'REPLY', v_rule, v_to, v_reply)
  on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Desvincular desde el CRM: el trigger de wa_sessions anula lo pendiente
create or replace function public.wa_solicitar(p_accion text, p_tenant_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := private.tenant_for_admin(p_tenant_id, 'settings');
begin
  if p_accion not in ('LINK', 'LOGOUT') then
    raise exception 'Acción no válida.' using errcode = '22023';
  end if;
  insert into public.wa_sessions (tenant_id, requested_action) values (v_tenant, p_accion)
  on conflict (tenant_id) do update set requested_action = excluded.requested_action;
end $$;

-- --------------------------------------------------------------------------
-- 9. Fechas especiales: el ADMIN necesita el módulo Configuración
-- --------------------------------------------------------------------------
drop policy if exists schedule_exceptions_write on public.schedule_exceptions;
create policy schedule_exceptions_write on public.schedule_exceptions for all to authenticated
  using ((select private.is_tenant_admin(tenant_id)) and (select private.has_grant('settings')))
  with check ((select private.is_tenant_admin(tenant_id)) and (select private.has_grant('settings')));

-- --------------------------------------------------------------------------
-- Permisos de las funciones (Supabase da EXECUTE a anon por defecto)
-- --------------------------------------------------------------------------
revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

revoke all on function public.perfil_contrasena_cambiada() from public, anon;
revoke all on function public.perfil_clave_temporal(uuid) from public, anon, authenticated;
revoke all on function public.cliente_asegurar(text, text, uuid) from public, anon;
revoke all on function public.registrar_actividad(text, text, uuid) from public, anon;
revoke all on function public.web_barberia(text) from public;
revoke all on function public.web_horarios(text, uuid, date, uuid) from public;
revoke all on function public.web_ocupados(text, int) from public;
revoke all on function public.web_consultar_cita(text, text, text) from public;
revoke all on function public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.wa_enviar_prueba(text, uuid) from public, anon;
revoke all on function public.wa_solicitar(text, uuid) from public, anon;
revoke all on function public.bot_tomar_mensajes(int, uuid[]) from public, anon, authenticated;
revoke all on function public.bot_marcar(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.bot_respuesta(uuid, text, text) from public, anon, authenticated;

grant execute on function public.perfil_contrasena_cambiada() to authenticated;
grant execute on function public.perfil_clave_temporal(uuid) to service_role;
grant execute on function public.cliente_asegurar(text, text, uuid) to authenticated;
grant execute on function public.registrar_actividad(text, text, uuid) to authenticated;
grant execute on function public.web_barberia(text) to anon, authenticated;
grant execute on function public.web_horarios(text, uuid, date, uuid) to anon, authenticated;
grant execute on function public.web_ocupados(text, int) to anon, authenticated;
grant execute on function public.web_consultar_cita(text, text, text) to anon, authenticated;
grant execute on function public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean) to service_role;
grant execute on function public.wa_enviar_prueba(text, uuid) to authenticated;
grant execute on function public.wa_solicitar(text, uuid) to authenticated;
grant execute on function public.bot_tomar_mensajes(int, uuid[]) to service_role;
grant execute on function public.bot_marcar(uuid, boolean, text) to service_role;
grant execute on function public.bot_respuesta(uuid, text, text) to service_role;
