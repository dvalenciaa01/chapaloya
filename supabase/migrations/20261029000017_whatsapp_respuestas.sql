-- ==========================================================================
-- Reservalope · Migración 17 · WhatsApp: el bot responde y trae clientes
-- --------------------------------------------------------------------------
-- Respuestas nuevas del bot (además de CONFIRMAR y BAJA):
--   · CANCELAR            → cancela la cita, responde con el enlace para
--                           reservar otra y avisa al equipo.
--   · REPROGRAMAR         → responde con el enlace para elegir otro horario y
--                           avisa al equipo. Si el cliente reserva la nueva en
--                           72 h, la anterior se cancela sola.
--   · MI CITA             → responde con sus próximas citas.
--   · "hola" (o MENU)     → menú: 1 reservar, 2 mi cita, 3 horario y
--                           dirección, 4 hablar con una persona y, si hay
--                           lista de espera, 5 avisarme si se libera un horario.
--   · AVISAME [fecha]     → lista de espera: si alguien cancela ese día (o en
--                           los próximos 7 días), se le avisa.
-- Mensajes nuevos que salen solos (apagados por defecto):
--   · Reseña de Google unas horas después de una cita completada.
--   · "Te extrañamos" a clientes que no vuelven hace N días (con tope diario,
--     separados 20 min y solo de 10:00 a 18:00). Lo programa el bot llamando
--     a bot_campanas() cada pocos minutos.
--   · Aviso a la lista de espera cuando se cancela una cita.
-- Todo respeta BAJA, las horas de silencio y el permiso (wa_opt_in) del
-- cliente. Se configura en tenants.whatsapp -> 'bot' (CRM → WhatsApp).
--
-- Se puede volver a ejecutar sin romper nada.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Tipos de mensaje y tablas nuevas
-- --------------------------------------------------------------------------
--   SHOP_ALERT = aviso al equipo (pidió cambiar la cita, quiere hablar con una persona)
--   REVIEW     = pedido de reseña      WINBACK  = "te extrañamos"
--   WAITLIST   = aviso a la lista de espera
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
  ('SHOP_NEW', 'SHOP_CANCEL', 'SHOP_RESCHEDULE', 'SHOP_ALERT', 'CLIENT_CONFIRM', 'CLIENT_CANCEL',
   'CLIENT_RESCHEDULE', 'REMINDER', 'REPLY', 'TEST', 'REVIEW', 'WINBACK', 'WAITLIST'));

-- Pedidos de REPROGRAMAR: la cita anterior se cancela cuando el cliente reserva la nueva
create table if not exists public.wa_cambios (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  phone          text not null,                 -- como appointments.phone (9 dígitos en Perú)
  created_at     timestamptz not null default now(),
  done_at        timestamptz
);
create index if not exists wa_cambios_abiertos on public.wa_cambios (tenant_id, phone) where done_at is null;
alter table public.wa_cambios enable row level security;
revoke all on public.wa_cambios from anon, authenticated;

-- Lista de espera (el cliente escribió AVISAME desde su propio WhatsApp)
create table if not exists public.wa_lista_espera (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  phone       text not null check (phone ~ '^[0-9]{9,15}$'),   -- formato de WhatsApp: 51XXXXXXXXX
  name        text not null default '',
  date_from   date not null,
  date_to     date not null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  check (date_to >= date_from)
);
create index if not exists wa_lista_espera_activa on public.wa_lista_espera (tenant_id, date_from) where notified_at is null;
alter table public.wa_lista_espera enable row level security;
revoke all on public.wa_lista_espera from anon, authenticated;
grant select, delete on public.wa_lista_espera to authenticated;
drop policy if exists wa_lista_espera_select on public.wa_lista_espera;
drop policy if exists wa_lista_espera_delete on public.wa_lista_espera;
create policy wa_lista_espera_select on public.wa_lista_espera for select to authenticated
  using ((select private.is_superadmin())
         or (tenant_id = (select private.my_tenant()) and (select private.my_role()) = 'ADMIN'
             and (select private.has_grant('settings'))));
create policy wa_lista_espera_delete on public.wa_lista_espera for delete to authenticated
  using ((select private.is_superadmin())
         or (tenant_id = (select private.my_tenant()) and (select private.my_role()) = 'ADMIN'
             and (select private.has_grant('settings'))));

-- --------------------------------------------------------------------------
-- 2. Configuración
-- --------------------------------------------------------------------------
-- tenants.whatsapp gana:
--   bot: { menu, cancel, reschedule, waitlist, review, winback: boolean,
--          reviewDelayHours, winbackDays, winbackPerDay: número }
--   bookingUrl: enlace para reservar (lo guarda el CRM solo)
--   reviewUrl:  enlace de reseñas de Google
--   templates.review, templates.winback

-- Interruptor del bot (con valor por defecto si falta)
create or replace function private.wa_bot(cfg jsonb, p_key text, p_default boolean)
returns boolean language sql immutable set search_path = '' as $$
  select private.jb(cfg -> 'bot' -> p_key, p_default)
$$;

-- Número entero del bot dentro de [p_min, p_max] (o el valor por defecto)
create or replace function private.wa_bot_num(cfg jsonb, p_key text, p_default int, p_min int, p_max int)
returns int language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(cfg -> 'bot' -> p_key) = 'number'
              then greatest(p_min, least(p_max, (cfg -> 'bot' ->> p_key)::numeric::int))
              else p_default end
$$;

-- Enlace guardado (http/https) o null
create or replace function private.wa_url(cfg jsonb, p_key text)
returns text language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(cfg -> p_key) = 'string' and (cfg ->> p_key) ~ '^https?://[^\s<>"]+$'
              then cfg ->> p_key end
$$;

create or replace function private.wa_default_config()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'enabled', false,
    'notifyTo', '[]'::jsonb,
    'notifyGroupId', null,
    'notifyOn', jsonb_build_object('new', true, 'cancel', true, 'reschedule', true),
    'confirmationToClient', true,
    'bot', jsonb_build_object('menu', true, 'cancel', true, 'reschedule', true, 'waitlist', false,
                              'review', false, 'reviewDelayHours', 3,
                              'winback', false, 'winbackDays', 30, 'winbackPerDay', 5),
    'templates', jsonb_build_object(
      'shopNew',          E'📅 Nueva reserva ({codigo})\n{cliente} · {telefono}\n{servicio} con {profesional}\n{fecha} a las {hora}',
      'shopCancel',       E'❌ Cita cancelada ({codigo})\n{cliente} · {servicio} con {profesional}\n{fecha} a las {hora}',
      'shopReschedule',   E'🔁 Cita reprogramada ({codigo})\n{cliente} · {servicio} con {profesional}\nNueva fecha: {fecha} a las {hora}',
      'clientConfirm',    E'Hola {cliente}, tu cita en *{negocio}* quedó registrada.\n\n*Servicio:* {servicio}\n*Te atiende:* {profesional}\n*Fecha:* {fecha}, {hora}\n*Código:* {codigo}\n\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.{opciones}',
      'clientCancel',     E'Hola {cliente}, tu cita en *{negocio}* del {fecha} a las {hora} fue cancelada.\n\nSi quieres otra fecha, puedes reservar de nuevo en nuestra web.',
      'clientReschedule', E'Hola {cliente}, tu cita en *{negocio}* cambió de horario.\n\n*Servicio:* {servicio}\n*Te atiende:* {profesional}\n*Nueva fecha:* {fecha}, {hora}\n*Código:* {codigo}\n\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.',
      'review',           E'Hola {cliente}, gracias por visitarnos en *{negocio}*. 🙌\n\n¿Nos ayudas con una reseña? Te toma un minuto:\n{resena}\n\n¡Gracias!',
      'winback',          E'Hola {cliente}, hace tiempo que no te vemos en *{negocio}*. 😊\n\nCuando quieras, reserva tu próxima cita aquí:\n{enlace}\n\nSi no quieres recibir estos mensajes, responde *BAJA*.'
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

-- Validación (migración 10) + las claves nuevas
create or replace function private.wa_config_valida(c jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  r jsonb;
  q jsonb;
  e record;
  k text;
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
       or exists (select 1 from jsonb_array_elements(c -> 'notifyTo') x
                  where jsonb_typeof(x) <> 'string' or length(x #>> '{}') > 40) then
      return false;
    end if;
  end if;
  if c ? 'notifyGroupId' and jsonb_typeof(c -> 'notifyGroupId') not in ('null', 'string') then
    return false;
  end if;
  if c ? 'notifyOn' then
    if jsonb_typeof(c -> 'notifyOn') <> 'object'
       or exists (select 1 from jsonb_each(c -> 'notifyOn') x where jsonb_typeof(x.value) <> 'boolean') then
      return false;
    end if;
  end if;
  if c ? 'templates' then
    if jsonb_typeof(c -> 'templates') <> 'object'
       or exists (select 1 from jsonb_each(c -> 'templates') x
                  where jsonb_typeof(x.value) not in ('string', 'null') or length(x.value #>> '{}') > 1500) then
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
  if c ? 'bot' then
    if jsonb_typeof(c -> 'bot') <> 'object' then
      return false;
    end if;
    for e in select * from jsonb_each(c -> 'bot') loop
      if e.key in ('menu', 'cancel', 'reschedule', 'waitlist', 'review', 'winback')
         and jsonb_typeof(e.value) <> 'boolean' then
        return false;
      end if;
      if e.key in ('reviewDelayHours', 'winbackDays', 'winbackPerDay')
         and (jsonb_typeof(e.value) <> 'number'
              or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric)
              or (e.value #>> '{}')::numeric not between 1 and 365) then
        return false;
      end if;
    end loop;
  end if;
  foreach k in array array['bookingUrl', 'reviewUrl'] loop
    if c ? k and (jsonb_typeof(c -> k) not in ('null', 'string')
                  or length(coalesce(c ->> k, '')) > 300
                  or (coalesce(c ->> k, '') <> '' and (c ->> k) !~ '^https?://[^\s<>"]+$')) then
      return false;
    end if;
  end loop;
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

-- Negocios existentes: plantillas nuevas que falten (las suyas no cambian) y
-- {opciones} en la confirmación si sigue igual a la de fábrica de la migración 11
update public.tenants
   set whatsapp = jsonb_set(whatsapp, '{templates}',
                            jsonb_build_object('review', private.wa_default_config() -> 'templates' -> 'review',
                                               'winback', private.wa_default_config() -> 'templates' -> 'winback')
                            || case when jsonb_typeof(whatsapp -> 'templates') = 'object'
                                    then whatsapp -> 'templates' else '{}'::jsonb end)
 where jsonb_typeof(whatsapp) = 'object'
   and (jsonb_typeof(whatsapp -> 'templates') is distinct from 'object'
        or not (whatsapp -> 'templates') ? 'review'
        or not (whatsapp -> 'templates') ? 'winback');

update public.tenants
   set whatsapp = jsonb_set(whatsapp, '{templates,clientConfirm}', private.wa_default_config() -> 'templates' -> 'clientConfirm')
 where jsonb_typeof(whatsapp -> 'templates') = 'object'
   and whatsapp -> 'templates' ->> 'clientConfirm' =
       E'Hola {cliente}, tu cita en *{negocio}* quedó registrada.\n\n*Servicio:* {servicio}\n*Te atiende:* {profesional}\n*Fecha:* {fecha}, {hora}\n*Código:* {codigo}\n\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.';

-- --------------------------------------------------------------------------
-- 3. Plantillas: variables nuevas
--   {enlace}   = enlace para reservar          {resena} = enlace de reseñas
--   {opciones} = "Si necesitas cambiarla, responde REPROGRAMAR o CANCELAR."
--                (solo lo que el negocio tenga encendido; vacío si nada)
-- --------------------------------------------------------------------------
create or replace function private.wa_opciones(cfg jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when private.wa_bot(cfg, 'reschedule', true) and private.wa_bot(cfg, 'cancel', true)
      then E'\nSi necesitas cambiarla, responde *REPROGRAMAR* o *CANCELAR*.'
    when private.wa_bot(cfg, 'reschedule', true) then E'\nSi necesitas cambiarla, responde *REPROGRAMAR*.'
    when private.wa_bot(cfg, 'cancel', true) then E'\nSi no puedes venir, responde *CANCELAR*.'
    else ''
  end
$$;

create or replace function private.wa_render(tpl text, a public.appointments, t public.tenants,
                                             p_send timestamptz default now())
returns text language sql stable set search_path = '' as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
         replace(replace(replace(
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
           '{codigo}',      a.code),
           '{enlace}',      coalesce(private.wa_url(t.whatsapp, 'bookingUrl'), '')),
           '{resena}',      coalesce(private.wa_url(t.whatsapp, 'reviewUrl'), '')),
           '{opciones}',    private.wa_opciones(t.whatsapp))
$$;

-- --------------------------------------------------------------------------
-- 4. Mensajes que salen solos
-- --------------------------------------------------------------------------
-- Aviso al equipo sin cita (p. ej. "quiere hablar con una persona")
create or replace function private.wa_alerta_equipo(t public.tenants, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n text;
begin
  if jsonb_typeof(t.whatsapp -> 'notifyTo') = 'array' then
    for n in select distinct jsonb_array_elements_text(t.whatsapp -> 'notifyTo') loop
      if private.wa_phone(n) is not null then
        insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body)
        values (t.id, 'SHOP_ALERT', gen_random_uuid()::text, private.wa_phone(n), p_body);
      end if;
    end loop;
  end if;
  if jsonb_typeof(t.whatsapp -> 'notifyGroupId') = 'string' and nullif(t.whatsapp ->> 'notifyGroupId', '') is not null then
    insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body)
    values (t.id, 'SHOP_ALERT', gen_random_uuid()::text, t.whatsapp ->> 'notifyGroupId', p_body);
  end if;
end $$;

-- Reseña de Google: unas horas después de completar la cita, máximo una cada 60 días por cliente
create or replace function private.wa_pedir_resena(t public.tenants, a public.appointments, p_to text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := t.whatsapp;
  v_send timestamptz;
begin
  if not private.wa_bot(cfg, 'review', false) or private.wa_url(cfg, 'reviewUrl') is null
     or nullif(btrim(coalesce(cfg -> 'templates' ->> 'review', '')), '') is null then
    return;
  end if;
  if exists (select 1 from public.wa_outbox o
             where o.tenant_id = t.id and o.recipient = p_to and o.kind = 'REVIEW'
               and o.status in ('PENDING', 'SENDING', 'SENT') and o.created_at > now() - interval '60 days') then
    return;
  end if;
  v_send := now() + make_interval(hours => private.wa_bot_num(cfg, 'reviewDelayHours', 3, 1, 48));
  v_send := coalesce(private.wa_fin_silencio(v_send, cfg, t.timezone), v_send);
  insert into public.wa_outbox (tenant_id, appointment_id, kind, recipient, body, send_at)
  values (t.id, a.id, 'REVIEW', p_to, private.wa_render(cfg -> 'templates' ->> 'review', a, t, v_send), v_send)
  on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing;
end $$;

-- Lista de espera: al cancelarse una cita futura, se avisa a los 3 primeros de ese día
create or replace function private.wa_avisar_lista_espera(t public.tenants, a public.appointments)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := t.whatsapp;
  e public.wa_lista_espera;
  v_body text;
begin
  if not private.wa_bot(cfg, 'waitlist', false) or a.starts_at < now() + interval '90 minutes' then
    return;
  end if;
  v_body := private.wa_render(
    E'¡Buenas noticias! Se liberó un horario en *{negocio}*:\n\n*{fecha}, {hora}* con {profesional}\n\n'
    || case when private.wa_url(cfg, 'bookingUrl') is not null
            then E'Si lo quieres, resérvalo aquí (el primero que reserve se lo queda):\n{enlace}'
            else 'Si lo quieres, respóndenos por aquí (el primero que confirme se lo queda).' end,
    a, t);
  for e in select * from public.wa_lista_espera w
           where w.tenant_id = t.id and w.notified_at is null
             and a.date between w.date_from and w.date_to
             and w.phone is distinct from private.wa_phone(a.phone)
             and not private.wa_de_baja(t.id, w.phone)
           order by w.created_at
           limit 3
           for update skip locked loop
    insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body, send_at)
    values (t.id, a.id, 'WAITLIST', e.phone, e.phone, v_body, private.wa_envio_cliente(cfg, t.timezone, a.starts_at))
    on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing;
    update public.wa_lista_espera set notified_at = now() where id = e.id;
  end loop;
end $$;

-- Trigger de citas → cola (migración 10) con:
--   · cancelación hecha por el cliente desde WhatsApp: no se le manda además
--     "tu cita fue cancelada" (ya recibió la respuesta) y el equipo ve quién canceló
--   · cita completada → reseña     · cita cancelada → lista de espera
create or replace function private.wa_programar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  cfg jsonb;
  v_to text;
  client_ok boolean;
  v_resched boolean := false;
  v_origen text := coalesce(current_setting('reservalope.wa_origen', true), '');
  v_tpl text;
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
      -- Pedido de REPROGRAMAR que ya no hace falta (la cita cambió o se cerró)
      if v_resched or not (new.status = any (vigente)) then
        update public.wa_cambios set done_at = now() where appointment_id = new.id and done_at is null;
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
          v_tpl := cfg -> 'templates' ->> 'shopCancel';
          if nullif(btrim(coalesce(v_tpl, '')), '') is not null and v_origen <> '' then
            v_tpl := v_tpl || case v_origen
                                when 'cliente' then E'\n\nLa canceló el cliente desde WhatsApp.'
                                when 'cambio' then E'\n\nEl cliente la cambió por una nueva reserva.'
                                else '' end;
          end if;
          perform private.wa_notificar_barberia(t, new, 'SHOP_CANCEL', v_tpl);
        end if;
        if client_ok and v_origen = '' then
          perform private.wa_avisar_cliente(t, new, 'CLIENT_CANCEL', cfg -> 'templates' ->> 'clientCancel', v_to);
        end if;
        perform private.wa_avisar_lista_espera(t, new);
      elsif new.status = 'COMPLETADA' and client_ok then
        perform private.wa_pedir_resena(t, new, v_to);
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

-- REPROGRAMAR: cuando el cliente reserva la cita nueva, la anterior se cancela sola
create or replace function private.wa_cambio_nueva_reserva()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.wa_cambios;
  old_a public.appointments;
begin
  if new.phone is null or not (new.status in ('PROGRAMADA', 'CONFIRMADA_WSP')) then
    return null;
  end if;
  select w.* into c from public.wa_cambios w
  join public.appointments a on a.id = w.appointment_id
  where w.tenant_id = new.tenant_id and w.phone = new.phone and w.done_at is null
    and w.created_at > now() - interval '72 hours'
    and a.id <> new.id and a.status in ('PROGRAMADA', 'CONFIRMADA_WSP') and a.starts_at > now()
  order by w.created_at desc
  limit 1;
  if c.id is null then
    return null;
  end if;
  begin
    perform set_config('reservalope.wa_origen', 'cambio', true);
    update public.appointments set status = 'CANCELADA' where id = c.appointment_id
    returning * into old_a;
    perform set_config('reservalope.wa_origen', '', true);
    update public.wa_cambios set done_at = now() where id = c.id;
    insert into public.audit_log (tenant_id, user_name, role, action, detail)
    values (new.tenant_id, new.customer_name || ' (WhatsApp)', 'PUBLIC', 'Cliente cambió su cita por una nueva',
            old_a.date || ' ' || to_char(old_a.time, 'HH24:MI') || ' → ' || new.date || ' ' || to_char(new.time, 'HH24:MI'));
  exception when others then
    perform set_config('reservalope.wa_origen', '', true);
    raise warning 'WhatsApp: no se pudo liberar la cita anterior %: %', c.appointment_id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists appointments_wa_cambio on public.appointments;
create trigger appointments_wa_cambio after insert on public.appointments
  for each row execute function private.wa_cambio_nueva_reserva();

-- --------------------------------------------------------------------------
-- 5. Respuestas del cliente
--   p_humano = el negocio escribió a mano a esta persona hace poco (lo sabe
--   el bot): entonces no se manda el menú al saludar, para no interrumpir.
-- --------------------------------------------------------------------------
drop function if exists public.bot_respuesta(uuid, text, text);
create or replace function public.bot_respuesta(p_tenant_id uuid, p_from text, p_text text, p_humano boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  cfg jsonb;
  v_to text := private.wa_phone(regexp_replace(coalesce(p_from, ''), '\D', '', 'g'));
  v_local text;
  v_txt text := btrim(regexp_replace(
                  lower(translate(coalesce(p_text, ''), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')),
                  '[^a-z0-9ñ ]+', ' ', 'g'));
  v_cmd text;
  v_code text;
  v_link text;
  v_name text;
  v_today date;
  v_from date;
  v_to_date date;
  v_dd int;
  v_mm int;
  a public.appointments;
  r public.appointments;
  v_pend int;
  v_lines text := '';
  v_any_prog boolean := false;
  v_reply text;
  v_rule text := gen_random_uuid()::text;
  v_n int;
  v_id uuid;
begin
  select * into t from public.tenants where id = p_tenant_id;
  if t.id is null or v_to is null or t.status <> 'ACTIVE' or not private.wa_activo(t.whatsapp) then
    return null;
  end if;
  cfg := t.whatsapp;
  v_local := case when v_to ~ '^519[0-9]{8}$' then substr(v_to, 3) end;
  v_txt := regexp_replace(v_txt, '\s+', ' ', 'g');
  v_link := private.wa_url(cfg, 'bookingUrl');
  v_today := (now() at time zone t.timezone)::date;

  -- Números del menú: solo valen si el menú se envió hace menos de 30 min
  if v_txt ~ '^[1-5]$' then
    if not exists (select 1 from public.wa_outbox where tenant_id = t.id and recipient = v_to and kind = 'REPLY'
                   and rule_id = 'menu' and created_at > now() - interval '30 minutes') then
      return null;
    end if;
    v_cmd := (array['reservar', 'mi cita', 'horario', 'persona', 'avisame'])[v_txt::int];
  else
    v_cmd := v_txt;
  end if;

  -- BAJA -------------------------------------------------------------------
  if v_cmd in ('baja', 'stop') then
    insert into public.wa_opt_outs (tenant_id, phone) values (t.id, v_to) on conflict do nothing;
    get diagnostics v_n = row_count;
    update public.customers set wa_opt_out_at = coalesce(wa_opt_out_at, now())
    where tenant_id = t.id and v_local is not null and phone = v_local;
    update public.wa_outbox set status = 'CANCELLED', last_error = 'El cliente pidió BAJA'
    where tenant_id = t.id and status = 'PENDING' and recipient = v_to
      and kind in ('REMINDER', 'CLIENT_CONFIRM', 'CLIENT_CANCEL', 'CLIENT_RESCHEDULE', 'REVIEW', 'WINBACK', 'WAITLIST');
    delete from public.wa_lista_espera where tenant_id = t.id and phone = v_to;
    if v_n = 0 then
      return null;                                   -- ya estaba de baja: no se repite la respuesta
    end if;
    v_reply := 'Listo, no te enviaremos más mensajes automáticos por WhatsApp.';

  -- CONFIRMAR (migración 10) -----------------------------------------------
  elsif v_local is not null and v_cmd ~ '^(confirmar|si confirmo)( [a-z0-9]{6})?$' then
    v_code := upper(nullif(substring(v_cmd from ' ([a-z0-9]{6})$'), ''));
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
        v_reply := private.wa_render(E'Tienes más de una cita próxima en *{negocio}*. Para confirmar una, responde *CONFIRMAR* seguido de su código (por ejemplo: CONFIRMAR {codigo}).', a, t);
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

  -- CANCELAR / REPROGRAMAR -------------------------------------------------
  elsif v_local is not null
        and ((private.wa_bot(cfg, 'cancel', true)
              and v_cmd ~ '^(cancelar|cancelo|anular)( mi cita| la cita| cita)?( [a-z0-9]{6})?$')
          or (private.wa_bot(cfg, 'reschedule', true)
              and v_cmd ~ '^(reprogramar|reagendar|cambiar)( mi cita| la cita| cita)?( [a-z0-9]{6})?$')) then
    v_code := upper(substring(v_cmd from ' ([a-z0-9]{6})$'));
    if v_code is not null then
      select * into a from public.appointments
      where tenant_id = t.id and phone = v_local and code = v_code
        and status in ('PROGRAMADA', 'CONFIRMADA_WSP') and starts_at > now();
      if a.id is null then
        v_code := null;                              -- el código no es de una cita suya: se trata como sin código
      end if;
    end if;
    if a.id is null then
      select count(*) into v_pend from public.appointments
      where tenant_id = t.id and phone = v_local and status in ('PROGRAMADA', 'CONFIRMADA_WSP') and starts_at > now();
      select * into a from public.appointments
      where tenant_id = t.id and phone = v_local and status in ('PROGRAMADA', 'CONFIRMADA_WSP') and starts_at > now()
      order by starts_at limit 1;
    end if;
    if a.id is null then
      if exists (select 1 from public.wa_outbox where tenant_id = t.id and recipient = v_to
                 and kind = 'REPLY' and rule_id = 'sin-cita' and created_at > now() - interval '12 hours') then
        return null;
      end if;
      v_rule := 'sin-cita';
      v_reply := 'No encontramos citas próximas a tu número en *' || t.name || '*.'
                 || case when v_link is not null then E'\n\nPuedes reservar aquí:\n' || v_link else '' end;
    elsif v_code is null and v_pend > 1 then
      if exists (select 1 from public.wa_outbox where tenant_id = t.id and recipient = v_to
                 and kind = 'REPLY' and rule_id = 'pedir-codigo-cambio' and created_at > now() - interval '30 minutes') then
        return null;
      end if;
      v_rule := 'pedir-codigo-cambio';
      v_reply := private.wa_render(E'Tienes más de una cita próxima en *{negocio}*. Responde la misma palabra seguida del código de la cita (por ejemplo: '
                 || upper(split_part(v_cmd, ' ', 1)) || E' {codigo}).\n\nPara ver tus citas y sus códigos, responde *MI CITA*.', a, t);
      a := null;
    elsif v_cmd ~ '^(cancelar|cancelo|anular)' then
      perform set_config('reservalope.wa_origen', 'cliente', true);
      update public.appointments set status = 'CANCELADA' where id = a.id;
      perform set_config('reservalope.wa_origen', '', true);
      insert into public.audit_log (tenant_id, user_name, role, action, detail)
      values (t.id, a.customer_name || ' (WhatsApp)', 'PUBLIC', 'Cliente canceló su cita',
              a.date || ' ' || to_char(a.time, 'HH24:MI') || ' · ' || a.barber_name);
      v_rule := 'cancelada';
      v_reply := private.wa_render(E'❌ *Cita cancelada*\nTu cita del {fecha} a las {hora} quedó cancelada. Gracias por avisarnos, {cliente}.'
                 || case when v_link is not null then E'\n\nSi quieres otra fecha, reserva aquí:\n{enlace}'
                         else E'\n\nSi quieres otra fecha, escríbenos por aquí.' end, a, t);
    else
      update public.wa_cambios set done_at = now() where appointment_id = a.id and done_at is null;
      insert into public.wa_cambios (tenant_id, appointment_id, phone) values (t.id, a.id, a.phone);
      perform private.wa_notificar_barberia(t, a, 'SHOP_ALERT',
        E'🔁 {cliente} quiere cambiar su cita ({codigo})\n{servicio} con {profesional}\n{fecha} a las {hora}\nTeléfono: {telefono}');
      v_rule := 'cambio';
      v_reply := private.wa_render(
        case when v_link is not null
             then E'🔁 Para cambiar tu cita del {fecha} a las {hora}, elige el nuevo horario aquí:\n{enlace}\n\nCuando reserves la nueva, liberamos la anterior automáticamente.'
             else E'🔁 Recibimos tu pedido para cambiar tu cita del {fecha} a las {hora}. En breve te escribimos para coordinar el nuevo horario.' end,
        a, t);
    end if;

  -- MI CITA ----------------------------------------------------------------
  elsif v_cmd ~ '^(mi cita|mis citas|ver mi cita|ver mis citas|cita|citas)$' and private.wa_bot(cfg, 'menu', true) then
    if v_local is not null then
      for r in select * from public.appointments
               where tenant_id = t.id and phone = v_local and status in ('PROGRAMADA', 'CONFIRMADA_WSP') and starts_at > now()
               order by starts_at limit 3 loop
        v_lines := v_lines || E'\n• ' || private.wa_fecha(r.date) || ', ' || to_char(r.time, 'HH24:MI')
                   || ' · ' || r.service_name || ' con ' || r.barber_name || ' (código ' || r.code || ')'
                   || case when r.status = 'CONFIRMADA_WSP' then ' ✅' else '' end;
        v_any_prog := v_any_prog or r.status = 'PROGRAMADA';
      end loop;
    end if;
    v_rule := 'mi-cita';
    if v_lines = '' then
      v_reply := 'No tienes citas próximas en *' || t.name || '*.'
                 || case when v_link is not null then E'\n\nPuedes reservar aquí:\n' || v_link else '' end;
    else
      v_reply := '📅 *Tus próximas citas en ' || t.name || E'*\n' || v_lines
                 || case when v_any_prog then E'\n\nPara confirmar tu asistencia responde *CONFIRMAR*.' else '' end
                 || private.wa_opciones(cfg);
    end if;

  -- Menú: reservar, horario, hablar con una persona ------------------------
  elsif v_cmd in ('reservar', 'reserva', 'quiero reservar', 'agendar') and private.wa_bot(cfg, 'menu', true) then
    v_rule := 'reservar';
    v_reply := case when v_link is not null
                    then E'📅 Reserva tu cita aquí, eliges el servicio, el día y la hora:\n' || v_link
                    else '📅 Cuéntanos qué servicio, día y hora prefieres y te ayudamos a reservar.' end;

  elsif v_cmd in ('horario', 'horarios', 'direccion', 'ubicacion', 'donde estan', 'donde quedan')
        and private.wa_bot(cfg, 'menu', true) then
    v_rule := 'horario';
    v_reply := '📍 *' || t.name || '*'
               || case when btrim(t.address) <> '' then E'\n' || t.address else '' end
               || case when btrim(t.hours) <> '' then E'\n\n🕒 ' || t.hours else '' end;

  elsif v_cmd in ('persona', 'asesor', 'humano', 'hablar con una persona', 'hablar con alguien')
        and private.wa_bot(cfg, 'menu', true) then
    if exists (select 1 from public.wa_outbox where tenant_id = t.id and recipient = v_to
               and kind = 'REPLY' and rule_id = 'persona' and created_at > now() - interval '1 hour') then
      return null;
    end if;
    select split_part(c.name, ' ', 1) into v_name from public.customers c where c.tenant_id = t.id and c.phone = v_local;
    perform private.wa_alerta_equipo(t, '🙋 ' || coalesce(v_name || ' (' || v_local || ')', '+' || v_to)
                                        || E' quiere hablar con una persona.\nRespóndele desde el WhatsApp del negocio.');
    v_rule := 'persona';
    v_reply := 'Listo, ya avisamos al equipo. En breve alguien te responde por aquí. 🙌';

  -- AVISAME [fecha]: lista de espera ---------------------------------------
  elsif v_cmd ~ '^(avisame|avisarme|lista de espera)( .*)?$' and private.wa_bot(cfg, 'waitlist', false) then
    v_from := v_today;
    v_to_date := v_today + 7;
    if v_cmd ~ ' (hoy)$' then
      v_to_date := v_today;
    elsif v_cmd ~ ' (manana)$' then
      v_from := v_today + 1; v_to_date := v_today + 1;
    elsif v_cmd ~ ' [0-9]{1,2} [0-9]{1,2}( [0-9]{2,4})?$' then
      v_dd := substring(v_cmd from ' ([0-9]{1,2}) [0-9]{1,2}(?: [0-9]{2,4})?$')::int;
      v_mm := substring(v_cmd from ' [0-9]{1,2} ([0-9]{1,2})(?: [0-9]{2,4})?$')::int;
      begin
        v_from := make_date(extract(year from v_today)::int, v_mm, v_dd);
        if v_from < v_today then
          v_from := make_date(extract(year from v_today)::int + 1, v_mm, v_dd);   -- "15/1" en diciembre = enero siguiente
        end if;
        v_to_date := v_from;
      exception when others then
        v_from := null;
      end;
      if v_from is null or v_from > v_today + coalesce((t.schedule ->> 'maxDays')::int, 60) then
        v_rule := 'avisame-error';
        v_reply := 'No entendimos la fecha. Escribe por ejemplo *AVISAME 15/11* (día/mes), *AVISAME MAÑANA* o solo *AVISAME* para los próximos 7 días.';
      end if;
    end if;
    if v_reply is null then
      select c.name into v_name from public.customers c where c.tenant_id = t.id and c.phone = v_local;
      delete from public.wa_lista_espera where tenant_id = t.id and phone = v_to and notified_at is null;
      insert into public.wa_lista_espera (tenant_id, phone, name, date_from, date_to)
      values (t.id, v_to, coalesce(v_name, ''), v_from, v_to_date);
      v_rule := 'avisame';
      v_reply := E'✅ Listo, quedaste en la lista de espera. Si se libera un horario '
                 || case when v_from = v_to_date then 'el ' || private.wa_fecha(v_from) else 'en los próximos 7 días' end
                 || ', te avisamos por aquí.';
    end if;

  -- Saludo → menú ----------------------------------------------------------
  elsif private.wa_bot(cfg, 'menu', true)
        and (v_cmd in ('menu', 'opciones')
             or (not coalesce(p_humano, false)
                 and v_cmd ~ '^(hola|holi|ola|buenas|buenos dias|buenas tardes|buenas noches|buen dia|info|informacion|ayuda)( [a-zñ]+){0,4}$')) then
    -- Al equipo del negocio no se le manda el menú
    if exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(cfg -> 'notifyTo') = 'array'
                                                            then cfg -> 'notifyTo' else '[]'::jsonb end) n
               where private.wa_phone(n) = v_to) then
      return null;
    end if;
    -- Una vez cada 12 h al saludar; si escribe MENU, de nuevo tras 2 min
    if exists (select 1 from public.wa_outbox where tenant_id = t.id and recipient = v_to and kind = 'REPLY'
               and rule_id = 'menu'
               and created_at > now() - case when v_cmd in ('menu', 'opciones') then interval '2 minutes' else interval '12 hours' end) then
      return null;
    end if;
    select split_part(c.name, ' ', 1) into v_name from public.customers c where c.tenant_id = t.id and c.phone = v_local;
    v_rule := 'menu';
    v_reply := '¡Hola' || coalesce(' ' || nullif(v_name, ''), '') || '! 👋 Gracias por escribir a *' || t.name || E'*.\n'
               || E'Responde con el número de lo que necesitas:\n\n'
               || E'1️⃣ Reservar una cita\n2️⃣ Ver mi cita\n3️⃣ Horario y dirección\n4️⃣ Hablar con una persona'
               || case when private.wa_bot(cfg, 'waitlist', false) then E'\n5️⃣ Avisarme si se libera un horario' else '' end;
  else
    return null;                                     -- lo atiende el negocio a mano
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

-- --------------------------------------------------------------------------
-- 6. Bot: tomar mensajes (migración 10) con los tipos nuevos
--   · REVIEW, WINBACK y WAITLIST respetan BAJA y las horas de silencio.
--   · Caducan: SHOP_ALERT a las 12 h; REVIEW y WINBACK si el bot estuvo
--     apagado más de 24 h; WAITLIST cuando empieza la hora que se liberó.
-- --------------------------------------------------------------------------
create or replace function public.bot_tomar_mensajes(p_limit int default 20, p_tenants uuid[] default null)
returns setof public.wa_outbox language plpgsql security definer set search_path = '' as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 20), 100));
  cliente constant text[] := array['CLIENT_CONFIRM', 'CLIENT_CANCEL', 'CLIENT_RESCHEDULE', 'REMINDER'];
  al_cliente constant text[] := array['CLIENT_CONFIRM', 'CLIENT_CANCEL', 'CLIENT_RESCHEDULE', 'REMINDER',
                                      'REVIEW', 'WINBACK', 'WAITLIST'];
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
     and ((o.kind in ('SHOP_NEW', 'SHOP_CANCEL', 'SHOP_RESCHEDULE', 'SHOP_ALERT', 'TEST', 'REPLY')
           and o.created_at < now() - interval '12 hours')
          or (o.kind in ('REVIEW', 'WINBACK') and o.send_at < now() - interval '24 hours')
          or (o.kind not in ('REPLY', 'REVIEW', 'WINBACK') and o.appointment_id is not null
              and exists (select 1 from public.appointments a where a.id = o.appointment_id and a.starts_at <= now())));

  update public.wa_outbox o
     set status = 'CANCELLED', locked_at = null,
         last_error = case when private.wa_de_baja(o.tenant_id, o.recipient) then 'El cliente pidió BAJA'
                           else 'Ya no corresponde' end
   where o.status = 'PENDING' and o.send_at <= now()
     and (p_tenants is null or o.tenant_id = any (p_tenants))
     and o.kind = any (al_cliente)
     and (private.wa_de_baja(o.tenant_id, o.recipient)
          or (o.kind = any (cliente)
              and exists (select 1 from public.appointments a where a.id = o.appointment_id
                          and ((o.kind = 'REMINDER' and o.only_if_not_confirmed and a.status = 'CONFIRMADA_WSP')
                               or (o.kind <> 'CLIENT_CANCEL' and a.status not in ('PROGRAMADA', 'CONFIRMADA_WSP'))))));

  update public.wa_outbox o
     set send_at = private.wa_fin_silencio(now(), t.whatsapp, t.timezone)
    from public.tenants t
   where t.id = o.tenant_id and o.status = 'PENDING' and o.send_at <= now()
     and (p_tenants is null or o.tenant_id = any (p_tenants))
     and o.kind = any (al_cliente)
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

-- --------------------------------------------------------------------------
-- 7. Bot: "te extrañamos" (lo llama el bot cada pocos minutos)
--   Solo clientes cuya última cita fue COMPLETADA hace entre N y N+30 días,
--   que aceptaron WhatsApp en esa cita, sin cita próxima, sin BAJA y sin un
--   "te extrañamos" desde esa cita. Tope diario por negocio, uno cada 20 min
--   y solo de 10:00 a 18:00 (hora del negocio) fuera de las horas de silencio.
--   Devuelve cuántos mensajes programó.
-- --------------------------------------------------------------------------
create or replace function public.bot_campanas(p_tenants uuid[] default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  u public.appointments;
  v_days int;
  v_cap int;
  v_local timestamp;
  v_n int := 0;
  v_i int;
begin
  -- Limpieza: listas de espera vencidas y pedidos de cambio viejos
  delete from public.wa_lista_espera w using public.tenants x
   where x.id = w.tenant_id and w.date_to < (now() at time zone x.timezone)::date;
  delete from public.wa_cambios where created_at < now() - interval '30 days';

  for t in select * from public.tenants x
           where x.status = 'ACTIVE' and private.wa_activo(x.whatsapp)
             and private.wa_bot(x.whatsapp, 'winback', false)
             and private.wa_url(x.whatsapp, 'bookingUrl') is not null
             and nullif(btrim(coalesce(x.whatsapp -> 'templates' ->> 'winback', '')), '') is not null
             and (p_tenants is null or x.id = any (p_tenants))
             and exists (select 1 from public.wa_sessions s where s.tenant_id = x.id and s.status = 'CONNECTED') loop
    v_local := now() at time zone t.timezone;
    continue when v_local::time < time '10:00' or v_local::time >= time '18:00'
               or private.wa_fin_silencio(now(), t.whatsapp, t.timezone) is not null;
    perform pg_advisory_xact_lock(hashtextextended('reservalope.campanas:' || t.id::text, 0));
    v_days := private.wa_bot_num(t.whatsapp, 'winbackDays', 30, 7, 365);
    v_cap := private.wa_bot_num(t.whatsapp, 'winbackPerDay', 5, 1, 30)
             - (select count(*) from public.wa_outbox o
                where o.tenant_id = t.id and o.kind = 'WINBACK'
                  and o.created_at >= (v_local::date)::timestamp at time zone t.timezone)::int;
    continue when v_cap <= 0;
    -- El siguiente sale 20 min después del último programado
    v_i := 0;
    for u in
      with ult as (
        select distinct on (a.phone) a.*
        from public.appointments a
        where a.tenant_id = t.id and a.phone is not null
        order by a.phone, a.starts_at desc
      )
      select x.* from ult x
      where x.status = 'COMPLETADA' and x.wa_opt_in
        and x.starts_at < now() - make_interval(days => v_days)
        and x.starts_at >= now() - make_interval(days => v_days + 30)
        and private.wa_phone(x.phone) is not null
        and not private.wa_de_baja(t.id, private.wa_phone(x.phone))
        and not exists (select 1 from public.customers c
                        where c.tenant_id = t.id and c.phone = x.phone and c.wa_opt_out_at is not null)
        and not exists (select 1 from public.wa_outbox o
                        where o.tenant_id = t.id and o.kind = 'WINBACK'
                          and o.recipient = private.wa_phone(x.phone) and o.created_at > x.starts_at)
      order by x.starts_at desc
      limit v_cap
    loop
      insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body, send_at)
      values (t.id, 'WINBACK', private.wa_phone(u.phone), private.wa_phone(u.phone),
              private.wa_render(t.whatsapp -> 'templates' ->> 'winback', u, t),
              greatest(now(), coalesce((select max(o.send_at) from public.wa_outbox o
                                        where o.tenant_id = t.id and o.kind = 'WINBACK' and o.status = 'PENDING'),
                                       now() - interval '20 minutes') + interval '20 minutes')
              + make_interval(secs => floor(random() * 240)::int));
      v_i := v_i + 1;
    end loop;
    v_n := v_n + v_i;
  end loop;
  return v_n;
end $$;

-- --------------------------------------------------------------------------
-- 8. Permisos (Supabase da EXECUTE a anon por defecto)
-- --------------------------------------------------------------------------
revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

revoke all on function public.bot_tomar_mensajes(int, uuid[]) from public, anon, authenticated;
revoke all on function public.bot_respuesta(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.bot_campanas(uuid[]) from public, anon, authenticated;
grant execute on function public.bot_tomar_mensajes(int, uuid[]) to service_role;
grant execute on function public.bot_respuesta(uuid, text, text, boolean) to service_role;
grant execute on function public.bot_campanas(uuid[]) to service_role;
