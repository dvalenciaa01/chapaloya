-- ==========================================================================
-- Reservalope · Migración 9 · WhatsApp: confirmar asistencia y bot
-- --------------------------------------------------------------------------
-- 1. Los mensajes al cliente ya no ofrecen "1 / 2": piden responder
--    CONFIRMAR, como muestra la web de Reservalope. Ya no se cancela por
--    WhatsApp; si el cliente escribe otra cosa, la barbería le responde a mano.
-- 2. El bot solo toma mensajes de las barberías que tiene vinculadas, para
--    no gastar intentos mientras un WhatsApp está desconectado.
-- Las barberías que ya cambiaron sus textos los conservan: solo se
-- reemplazan las plantillas que siguen iguales a las de fábrica.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Plantillas de fábrica
-- --------------------------------------------------------------------------
create or replace function private.wa_default_config()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'enabled', false,
    'notifyTo', '[]'::jsonb,
    'notifyGroupId', null,
    'notifyOn', jsonb_build_object('new', true, 'cancel', true, 'reschedule', true),
    'confirmationToClient', true,
    'templates', jsonb_build_object(
      'shopNew',        E'💈 Nueva reserva ({codigo})\n{cliente} · {telefono}\n{servicio} con {barbero}\n{fecha} a las {hora}',
      'shopCancel',     E'❌ Cita cancelada ({codigo})\n{cliente} · {servicio} con {barbero}\n{fecha} a las {hora}',
      'shopReschedule', E'🔁 Cita reprogramada ({codigo})\n{cliente} · {servicio} con {barbero}\nNueva fecha: {fecha} a las {hora}',
      'clientConfirm',  E'Hola {cliente}, tu cita en *{barberia}* quedó registrada.\n\n*Servicio:* {servicio}\n*Barbero:* {barbero}\n*Fecha:* {fecha}, {hora}\n*Código:* {codigo}\n\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.'
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

-- Barberías existentes: cambiar solo los textos que nadie personalizó
update public.tenants
   set whatsapp = jsonb_set(whatsapp, '{templates,clientConfirm}',
                            private.wa_default_config() -> 'templates' -> 'clientConfirm')
 where whatsapp -> 'templates' ->> 'clientConfirm' =
       E'Hola {cliente}, tu cita en {barberia} quedó registrada:\n{servicio} con {barbero}\n{fecha} a las {hora}\nCódigo: {codigo}\n\nResponde 1 para confirmar o 2 para cancelar.';

update public.tenants t
   set whatsapp = jsonb_set(t.whatsapp, '{reminders}', (
         select jsonb_agg(case
                  when r ->> 'template' = E'Hola {cliente}, te recordamos tu cita {cuando} a las {hora} con {barbero} en {barberia}. {direccion}\nResponde 1 para confirmar o 2 para cancelar.'
                  then jsonb_set(r, '{template}', to_jsonb(E'Hola {cliente}, te recordamos tu cita {cuando} a las {hora} con {barbero} en {barberia}. {direccion}\n¡Te esperamos!'::text))
                  else r end order by ord)
         from jsonb_array_elements(t.whatsapp -> 'reminders') with ordinality as x(r, ord)))
 where jsonb_typeof(t.whatsapp -> 'reminders') = 'array'
   and jsonb_array_length(t.whatsapp -> 'reminders') > 0;

-- Mensajes ya programados con el texto viejo
update public.wa_outbox
   set body = replace(replace(body,
              E'Responde 1 para confirmar o 2 para cancelar.', E'Por favor, confirma tu asistencia respondiendo *CONFIRMAR*.'),
              E'\nPor favor, confirma tu asistencia respondiendo *CONFIRMAR*.', E'\n¡Te esperamos!')
 where status = 'PENDING' and kind = 'REMINDER' and body like '%Responde 1 para confirmar o 2 para cancelar.%';

update public.wa_outbox
   set body = replace(body, E'Responde 1 para confirmar o 2 para cancelar.', E'Por favor, confirma tu asistencia respondiendo *CONFIRMAR*.')
 where status = 'PENDING' and body like '%Responde 1 para confirmar o 2 para cancelar.%';

-- --------------------------------------------------------------------------
-- Respuestas del cliente: CONFIRMAR (también "sí", "ok", "1") y BAJA
-- --------------------------------------------------------------------------
create or replace function public.bot_respuesta(p_tenant_id uuid, p_from text, p_text text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  v_local text := right(regexp_replace(coalesce(p_from, ''), '\D', '', 'g'), 9);
  v_txt text := btrim(regexp_replace(
                  lower(translate(coalesce(p_text, ''), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')),
                  '[^a-z0-9ñ ]+', ' ', 'g'));
  a public.appointments;
  v_reply text;
  v_id uuid;
begin
  select * into t from public.tenants where id = p_tenant_id;
  if t.id is null or v_local !~ '^9[0-9]{8}$' then
    return null;
  end if;
  v_txt := regexp_replace(v_txt, '\s+', ' ', 'g');

  if v_txt in ('baja', 'stop') then
    update public.customers set wa_opt_out_at = now() where tenant_id = t.id and phone = v_local;
    update public.wa_outbox set status = 'CANCELLED'
    where tenant_id = t.id and status = 'PENDING' and recipient = private.wa_phone(v_local)
      and kind in ('REMINDER', 'CLIENT_CONFIRM');
    v_reply := 'Listo, no te enviaremos más recordatorios por WhatsApp.';
  elsif v_txt in ('1', 'si', 'ok', 'okey', 'listo') or v_txt ~ '^(si |ok )?confirm[a-z]*( gracias)?$' then
    select * into a from public.appointments
    where tenant_id = t.id and phone = v_local
      and status in ('PROGRAMADA', 'CONFIRMADA_WSP') and starts_at > now()
    order by starts_at limit 1;
    if a.id is null then
      return null;
    end if;
    if a.status = 'PROGRAMADA' then
      update public.appointments set status = 'CONFIRMADA_WSP' where id = a.id;
      insert into public.audit_log (tenant_id, user_name, role, action, detail)
      values (t.id, a.customer_name || ' (WhatsApp)', 'PUBLIC', 'Cliente confirmó su cita',
              a.date || ' ' || to_char(a.time, 'HH24:MI') || ' · ' || a.barber_name);
    end if;
    v_reply := private.wa_render(E'✅ *Asistencia confirmada*\nGracias, {cliente}. Te esperamos el {fecha} a las {hora}.', a, t);
  else
    return null;                                     -- lo atiende la barbería a mano
  end if;

  insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
  values (t.id, a.id, 'REPLY', gen_random_uuid()::text, private.wa_phone(v_local), v_reply)
  returning id into v_id;
  return v_id;
end $$;

-- --------------------------------------------------------------------------
-- El bot toma solo mensajes de las barberías que tiene conectadas
-- --------------------------------------------------------------------------
drop function if exists public.bot_tomar_mensajes(int);
create or replace function public.bot_tomar_mensajes(p_limit int default 20, p_tenants uuid[] default null)
returns setof public.wa_outbox language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.wa_outbox o
     set status = 'SENDING', locked_at = now(), attempts = o.attempts + 1
   where o.id in (
     select x.id from public.wa_outbox x
     where ((x.status = 'PENDING' and x.send_at <= now())
         or (x.status = 'SENDING' and x.locked_at < now() - interval '10 minutes'))
       and (p_tenants is null or x.tenant_id = any (p_tenants))
     order by x.send_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked)
  returning o.*;
end $$;

revoke all on function public.bot_tomar_mensajes(int, uuid[]) from public, anon, authenticated;
grant execute on function public.bot_tomar_mensajes(int, uuid[]) to service_role;
