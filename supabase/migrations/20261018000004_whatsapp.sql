-- ==========================================================================
-- Reservalope · Migración 4/4 · WhatsApp (cola de mensajes)
-- --------------------------------------------------------------------------
-- Cada vez que se crea, cancela, confirma o reprograma una cita, un trigger
-- escribe en public.wa_outbox los mensajes que tocan y CUÁNDO enviarlos,
-- según la configuración de cada barbería (tenants.whatsapp).
-- El bot (VM) solo toma lo que ya venció y lo envía. Si mañana se cambia el
-- bot por la API oficial de Meta, esta parte no cambia.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Formato
-- --------------------------------------------------------------------------
-- 987654321 → 51987654321 (Perú). Números ya internacionales se dejan igual.
create or replace function private.wa_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p is null then null
    when length(regexp_replace(p, '\D', '', 'g')) = 9 then '51' || regexp_replace(p, '\D', '', 'g')
    when length(regexp_replace(p, '\D', '', 'g')) between 10 and 15 then regexp_replace(p, '\D', '', 'g')
    else null
  end
$$;

-- 2026-10-25 → "domingo 25 de octubre" (sin depender del idioma del servidor)
create or replace function private.wa_fecha(d date)
returns text language sql immutable set search_path = '' as $$
  select (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from d)::int + 1]
         || ' ' || extract(day from d)::int || ' de '
         || (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                   'septiembre','octubre','noviembre','diciembre'])[extract(month from d)::int]
$$;

-- p_send = cuándo saldrá el mensaje; sirve para que {cuando} diga "hoy" o "mañana" con verdad
create or replace function private.wa_render(tpl text, a public.appointments, t public.tenants,
                                             p_send timestamptz default now())
returns text language sql stable set search_path = '' as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
           coalesce(tpl, ''),
           '{cuando}',    case a.date - (p_send at time zone t.timezone)::date
                            when 0 then 'hoy'
                            when 1 then 'mañana'
                            else 'el ' || private.wa_fecha(a.date)
                          end),
           '{cliente}',   split_part(a.customer_name, ' ', 1)),
           '{telefono}',  coalesce(a.phone, '')),
           '{servicio}',  a.service_name),
           '{barbero}',   a.barber_name),
           '{fecha}',     private.wa_fecha(a.date)),
           '{hora}',      to_char(a.time, 'HH24:MI')),
           '{precio}',    t.currency || ' ' || case when a.price = trunc(a.price) then trunc(a.price)::text
                                                    else to_char(a.price, 'FM999999990.00') end),
           '{barberia}',  t.name),
           '{direccion}', t.address),
           '{codigo}',    a.code)
$$;

-- Si un envío cae en horas de silencio, se adelanta a 30 min antes de que empiece
-- el silencio (p. ej. silencio 21:00–08:00 → recordatorio de las 07:00 sale a las 20:30 del día anterior).
create or replace function private.wa_quiet_adjust(p_send timestamptz, cfg jsonb, tz text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  qf time := nullif(cfg -> 'quietHours' ->> 'from', '')::time;
  qt time := nullif(cfg -> 'quietHours' ->> 'to', '')::time;
  loc timestamp := p_send at time zone tz;
  lt time := loc::time;
  d date;
begin
  if qf is null or qt is null or qf = qt then
    return p_send;
  end if;
  if qf > qt then                                   -- el silencio cruza la medianoche
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

-- --------------------------------------------------------------------------
-- Programación de mensajes
-- --------------------------------------------------------------------------
create or replace function private.wa_notificar_barberia(t public.tenants, a public.appointments, p_kind text, p_tpl text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n text;
  body text := private.wa_render(p_tpl, a, t);
begin
  for n in select jsonb_array_elements_text(coalesce(t.whatsapp -> 'notifyTo', '[]'::jsonb)) loop
    if private.wa_phone(n) is not null then
      insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
      values (t.id, a.id, p_kind, private.wa_phone(n), private.wa_phone(n), body)
      on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing;
    end if;
  end loop;
  if nullif(t.whatsapp ->> 'notifyGroupId', '') is not null then
    insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
    values (t.id, a.id, p_kind, 'group', t.whatsapp ->> 'notifyGroupId', body)
    on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing;
  end if;
end $$;

create or replace function private.wa_programar_recordatorios(t public.tenants, a public.appointments, p_to text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_send timestamptz;
begin
  for r in select jsonb_array_elements(coalesce(t.whatsapp -> 'reminders', '[]'::jsonb)) loop
    continue when coalesce((r ->> 'offsetMinutes')::int, 0) <= 0;
    v_send := a.starts_at - make_interval(mins => (r ->> 'offsetMinutes')::int);
    v_send := private.wa_quiet_adjust(v_send, t.whatsapp, t.timezone);
    continue when v_send <= now() or v_send >= a.starts_at;
    insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body, send_at, only_if_not_confirmed)
    values (t.id, a.id, 'REMINDER', coalesce(r ->> 'id', ''), p_to, private.wa_render(r ->> 'template', a, t, v_send),
            v_send, coalesce((r ->> 'onlyIfNotConfirmed')::boolean, false))
    on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing;
  end loop;
end $$;

create or replace function private.wa_programar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  cfg jsonb;
  v_to text;
  client_ok boolean;
  vigente constant text[] := array['PROGRAMADA', 'CONFIRMADA_WSP'];
begin
  select * into t from public.tenants where id = new.tenant_id;
  cfg := t.whatsapp;
  if not coalesce((cfg ->> 'enabled')::boolean, false) then
    return null;
  end if;

  v_to := private.wa_phone(new.phone);
  client_ok := new.wa_opt_in and v_to is not null
               and not exists (select 1 from public.customers c
                               where c.id = new.customer_id and c.wa_opt_out_at is not null);

  if tg_op = 'INSERT' then
    if not (new.status = any (vigente)) then
      return null;                                   -- historial importado: no avisar
    end if;
    if coalesce((cfg -> 'notifyOn' ->> 'new')::boolean, true) then
      perform private.wa_notificar_barberia(t, new, 'SHOP_NEW', cfg -> 'templates' ->> 'shopNew');
    end if;
    if client_ok then
      if coalesce((cfg ->> 'confirmationToClient')::boolean, true) then
        insert into public.wa_outbox (tenant_id, appointment_id, kind, recipient, body)
        values (t.id, new.id, 'CLIENT_CONFIRM', v_to, private.wa_render(cfg -> 'templates' ->> 'clientConfirm', new, t))
        on conflict (appointment_id, kind, rule_id) where status = 'PENDING' do nothing;
      end if;
      perform private.wa_programar_recordatorios(t, new, v_to);
    end if;
    return null;
  end if;

  -- UPDATE ------------------------------------------------------------------
  -- Cita cerrada (cancelada, completada o no asistió): anular lo pendiente
  if not (new.status = any (vigente)) and old.status = any (vigente) then
    update public.wa_outbox set status = 'CANCELLED'
    where appointment_id = new.id and status = 'PENDING' and kind in ('REMINDER', 'CLIENT_CONFIRM');
    if new.status = 'CANCELADA' and coalesce((cfg -> 'notifyOn' ->> 'cancel')::boolean, true) then
      perform private.wa_notificar_barberia(t, new, 'SHOP_CANCEL', cfg -> 'templates' ->> 'shopCancel');
    end if;
    return null;
  end if;

  -- Reprogramada: recalcular recordatorios
  if new.status = any (vigente)
     and (new.date, new.time, new.barber_id) is distinct from (old.date, old.time, old.barber_id) then
    update public.wa_outbox set status = 'CANCELLED'
    where appointment_id = new.id and status = 'PENDING' and kind = 'REMINDER';
    if coalesce((cfg -> 'notifyOn' ->> 'reschedule')::boolean, true) then
      perform private.wa_notificar_barberia(t, new, 'SHOP_RESCHEDULE', cfg -> 'templates' ->> 'shopReschedule');
    end if;
    if client_ok then
      perform private.wa_programar_recordatorios(t, new, v_to);
    end if;
  end if;

  -- El cliente aceptó WhatsApp después de creada la cita: programar sus recordatorios
  if new.status = any (vigente) and client_ok and not old.wa_opt_in then
    perform private.wa_programar_recordatorios(t, new, v_to);
  end if;

  -- Confirmada: anular recordatorios marcados "solo si no ha confirmado"
  if new.status = 'CONFIRMADA_WSP' and old.status <> 'CONFIRMADA_WSP' then
    update public.wa_outbox set status = 'CANCELLED'
    where appointment_id = new.id and status = 'PENDING' and kind = 'REMINDER' and only_if_not_confirmed;
  end if;

  return null;
end $$;

create trigger appointments_wa
  after insert or update on public.appointments
  for each row execute function private.wa_programar();

-- --------------------------------------------------------------------------
-- Funciones para el CRM (admin con el módulo Configuración)
-- --------------------------------------------------------------------------
-- Botón "Enviar prueba"
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
  select name into v_name from public.tenants where id = v_tenant;
  insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body)
  values (v_tenant, 'TEST', gen_random_uuid()::text, v_to,
          'Mensaje de prueba de ' || v_name || '. Si lo recibiste, WhatsApp está bien configurado. ✅')
  returning id into v_id;
  return v_id;
end $$;

-- Botones "Vincular WhatsApp" / "Desvincular": el bot lee la petición y publica el QR en wa_sessions
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
-- Funciones para el BOT (solo con la secret key / service_role)
-- --------------------------------------------------------------------------
-- Toma hasta p_limit mensajes vencidos y los marca como "enviando".
-- SKIP LOCKED evita que dos procesos envíen el mismo mensaje.
-- Un mensaje "enviando" por más de 10 min (bot caído) vuelve a tomarse.
create or replace function public.bot_tomar_mensajes(p_limit int default 20)
returns setof public.wa_outbox language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.wa_outbox o
     set status = 'SENDING', locked_at = now(), attempts = o.attempts + 1
   where o.id in (
     select x.id from public.wa_outbox x
     where (x.status = 'PENDING' and x.send_at <= now())
        or (x.status = 'SENDING' and x.locked_at < now() - interval '10 minutes')
     order by x.send_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked)
  returning o.*;
end $$;

-- Resultado de un envío: ok → SENT; error → vuelve a PENDING en 2 min, o FAILED al 3er intento
create or replace function public.bot_marcar(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.wa_outbox set
    status     = case when p_ok then 'SENT' when attempts >= 3 then 'FAILED' else 'PENDING' end,
    sent_at    = case when p_ok then now() else sent_at end,
    send_at    = case when p_ok then send_at else now() + interval '2 minutes' end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    locked_at  = null
  where id = p_id;
end $$;

-- Respuesta de un cliente. Solo reacciona a 1/2/BAJA y solo si esa persona tiene
-- una cita próxima: cualquier otro mensaje lo atiende la barbería a mano,
-- porque es su propio WhatsApp. Devuelve el id del mensaje de respuesta o null.
create or replace function public.bot_respuesta(p_tenant_id uuid, p_from text, p_text text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  v_local text := right(regexp_replace(coalesce(p_from, ''), '\D', '', 'g'), 9);
  v_txt text := lower(btrim(translate(coalesce(p_text, ''), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')));
  a public.appointments;
  v_reply text;
  v_id uuid;
begin
  select * into t from public.tenants where id = p_tenant_id;
  if t.id is null or v_local !~ '^9[0-9]{8}$' then
    return null;
  end if;

  if v_txt in ('baja', 'stop') then
    update public.customers set wa_opt_out_at = now() where tenant_id = t.id and phone = v_local;
    update public.wa_outbox set status = 'CANCELLED'
    where tenant_id = t.id and status = 'PENDING' and recipient = private.wa_phone(v_local)
      and kind in ('REMINDER', 'CLIENT_CONFIRM');
    v_reply := 'Listo, no te enviaremos más recordatorios por WhatsApp.';
  else
    select * into a from public.appointments
    where tenant_id = t.id and phone = v_local
      and status in ('PROGRAMADA', 'CONFIRMADA_WSP') and starts_at > now()
    order by starts_at limit 1;
    if a.id is null then
      return null;
    end if;

    if v_txt in ('1', 'si', 'confirmo', 'confirmar') then
      if a.status = 'PROGRAMADA' then
        update public.appointments set status = 'CONFIRMADA_WSP' where id = a.id;
        insert into public.audit_log (tenant_id, user_name, role, action, detail)
        values (t.id, a.customer_name || ' (WhatsApp)', 'PUBLIC', 'Cliente confirmó su cita',
                a.date || ' ' || to_char(a.time, 'HH24:MI') || ' · ' || a.barber_name);
      end if;
      v_reply := private.wa_render('¡Gracias, {cliente}! Tu cita del {fecha} a las {hora} con {barbero} quedó confirmada. ✅', a, t);
    elsif v_txt in ('2', 'no', 'cancelo', 'cancelar') then
      update public.appointments set status = 'CANCELADA' where id = a.id;
      insert into public.audit_log (tenant_id, user_name, role, action, detail)
      values (t.id, a.customer_name || ' (WhatsApp)', 'PUBLIC', 'Cliente canceló su cita',
              a.date || ' ' || to_char(a.time, 'HH24:MI') || ' · ' || a.barber_name);
      v_reply := private.wa_render('Tu cita del {fecha} a las {hora} fue cancelada. Si quieres otra fecha, puedes reservar de nuevo en nuestra web.', a, t);
    else
      return null;
    end if;
  end if;

  insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
  values (t.id, a.id, 'REPLY', gen_random_uuid()::text, private.wa_phone(v_local), v_reply)
  returning id into v_id;
  return v_id;
end $$;

-- Permisos
revoke all on function public.wa_enviar_prueba(text, uuid) from public, anon;
revoke all on function public.wa_solicitar(text, uuid) from public, anon;
revoke all on function public.bot_tomar_mensajes(int) from public, anon, authenticated;
revoke all on function public.bot_marcar(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.bot_respuesta(uuid, text, text) from public, anon, authenticated;

grant execute on function public.wa_enviar_prueba(text, uuid) to authenticated;
grant execute on function public.wa_solicitar(text, uuid) to authenticated;
grant execute on function public.bot_tomar_mensajes(int) to service_role;
grant execute on function public.bot_marcar(uuid, boolean, text) to service_role;
grant execute on function public.bot_respuesta(uuid, text, text) to service_role;

-- --------------------------------------------------------------------------
-- Tiempo real: el CRM ve al instante citas nuevas y el estado del WhatsApp
-- (Supabase ya crea la publicación "supabase_realtime"; RLS se respeta)
-- --------------------------------------------------------------------------
alter publication supabase_realtime add table public.appointments, public.walk_ins, public.wa_sessions;
