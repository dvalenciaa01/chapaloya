-- ==========================================================================
-- Pruebas de la migración 10 (correcciones del QA)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 9 aplicadas (SIN la 10). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/qa_10.sql
-- El script:
--   1. Carga datos "viejos" con problemas (citas que se cruzan, nombres
--      repetidos, una baja de WhatsApp) para comprobar que la 10 se aplica
--      igual sobre una base con datos.
--   2. Aplica la migración 10 (dos veces: es repetible).
--   3. Prueba cada corrección con usuarios simulados (request.jwt.claims +
--      SET ROLE authenticated / service_role). Cada prueba imprime "OK …";
--      la primera que falla detiene el script con "FALLO: …".
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists qa cascade;
create schema qa;
grant usage on schema qa to public;
create table qa.ids (k text primary key, id uuid not null);
grant select on qa.ids to public;

create function qa.id(p text) returns uuid language sql stable as $$
  select id from qa.ids where k = p $$;
create function qa.d(n int) returns date language sql stable as $$
  select (now() at time zone 'America/Lima')::date + n $$;
create function qa.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then
    raise exception 'FALLO: %', msg;
  end if;
  raise notice 'OK   %', msg;
end $$;
create function qa.err(q text, pat text, msg text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'FALLO (no dio error): %', msg;
exception when others then
  if sqlerrm like 'FALLO%' then raise; end if;
  if sqlerrm !~* pat then
    raise exception 'FALLO: % → error inesperado: %', msg, sqlerrm;
  end if;
  raise notice 'OK   % → "%"', msg, sqlerrm;
end $$;
create function qa.login(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
$$;
create function qa.server() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', false);
$$;
create function qa.nadie() returns void language sql as $$
  select set_config('request.jwt.claims', '', false);
$$;
grant execute on all functions in schema qa to public;

-- --------------------------------------------------------------------------
-- 1. Datos previos (con migraciones 1–9)
-- --------------------------------------------------------------------------
insert into qa.ids values
  ('tA', gen_random_uuid()), ('tB', gen_random_uuid()),
  ('super', gen_random_uuid()), ('adminA', gen_random_uuid()), ('staffA', gen_random_uuid()),
  ('staffA2', gen_random_uuid()), ('temp', gen_random_uuid()), ('adminB', gen_random_uuid()),
  ('b1', gen_random_uuid()), ('b2', gen_random_uuid()), ('b4', gen_random_uuid()), ('b5', gen_random_uuid()),
  ('bB', gen_random_uuid()),
  ('s30', gen_random_uuid()), ('s60', gen_random_uuid()), ('sOculto', gen_random_uuid()),
  ('sT1', gen_random_uuid()), ('sT2', gen_random_uuid()), ('sB', gen_random_uuid());

insert into public.tenants (id, slug, name, schedule, whatsapp) values
  (qa.id('tA'), 'golden', 'Golden Barbería',
   jsonb_build_object('interval', 30, 'maxDays', 60,
     'week', (select jsonb_object_agg(d::text, '[["00:00","23:30"]]'::jsonb) from generate_series(0, 6) d)),
   private.wa_default_config() || '{"enabled": true, "notifyTo": ["999888777"], "quietHours": {}}'),
  (qa.id('tB'), 'otra', 'Otra Barbería',
   jsonb_build_object('interval', 30, 'maxDays', 60,
     'week', (select jsonb_object_agg(d::text, '[["00:00","23:30"]]'::jsonb) from generate_series(0, 6) d)),
   private.wa_default_config() || '{"enabled": true, "quietHours": {}}');

insert into auth.users (id, email, encrypted_password)
select id, k || '@x.pe', 'hash-' || k from qa.ids where k in ('super', 'adminA', 'staffA', 'staffA2', 'temp', 'adminB');

insert into public.barbers (id, tenant_id, name, schedule) values
  (qa.id('b1'), qa.id('tA'), 'Carlos', null),
  (qa.id('b2'), qa.id('tA'), 'Luis',
   jsonb_build_object('week', (select jsonb_object_agg(d::text, '[["09:00","12:00"],["13:00","18:00"]]'::jsonb)
                               from generate_series(0, 6) d))),
  (qa.id('b4'), qa.id('tA'), 'Pedro', null),
  (qa.id('b5'), qa.id('tA'), 'pedro', null),          -- nombre repetido (dato viejo)
  (qa.id('bB'), qa.id('tB'), 'Beto', null);

insert into public.services (id, tenant_id, name, duration_min, price, active) values
  (qa.id('s30'), qa.id('tA'), 'Corte', 30, 25, true),
  (qa.id('s60'), qa.id('tA'), 'Corte y barba', 60, 40, true),
  (qa.id('sOculto'), qa.id('tA'), 'Asesoría', 30, 0, false),
  (qa.id('sT1'), qa.id('tA'), 'Tinte', 30, 50, true),
  (qa.id('sT2'), qa.id('tA'), 'TINTE', 30, 50, true),  -- nombre repetido (dato viejo)
  (qa.id('sB'), qa.id('tB'), 'Corte', 30, 20, true);

insert into public.profiles (id, email, name, role, tenant_id, barber_id, must_change_password, grants) values
  (qa.id('super'), 'super@x.pe', 'Super', 'SUPERADMIN', null, null, false, default),
  (qa.id('adminA'), 'adminA@x.pe', 'Admin A', 'ADMIN', qa.id('tA'), null, false, default),
  (qa.id('staffA'), 'staffA@x.pe', 'Staff A', 'STAFF', qa.id('tA'), qa.id('b1'), false, default),
  (qa.id('staffA2'), 'staffA2@x.pe', 'Recepción', 'STAFF', qa.id('tA'), null, false, default),
  (qa.id('temp'), 'temp@x.pe', 'Temporal', 'ADMIN', qa.id('tA'), null, true, default),
  (qa.id('adminB'), 'adminB@x.pe', 'Admin B', 'ADMIN', qa.id('tB'), null, false, default);

-- Cliente con BAJA (dato viejo) y citas que se cruzan (dato viejo: 10:00 de 60 min y 10:30)
insert into public.customers (tenant_id, name, phone, wa_opt_out_at) values
  (qa.id('tA'), 'Cliente Baja', '911111111', now()),
  (qa.id('tA'), 'Juan Original', '922222222', null);
insert into public.appointments (tenant_id, customer_name, phone, service_id, barber_id, date, time)
values (qa.id('tA'), 'Viejo Uno', '933333331', qa.id('s60'), qa.id('b1'), qa.d(5), '10:00'),
       (qa.id('tA'), 'Viejo Dos', '933333332', qa.id('s30'), qa.id('b1'), qa.d(5), '10:30');

-- --------------------------------------------------------------------------
-- 2. Aplicar la migración 10 (dos veces)
-- --------------------------------------------------------------------------
\ir ../migrations/20261021000010_correcciones_qa.sql
\ir ../migrations/20261021000010_correcciones_qa.sql

select qa.ok((select count(*) = 0 from public.appointments where ends_at is null), 'MIGR: todas las citas tienen ends_at');
select qa.ok((select ends_at - starts_at = interval '60 min' from public.appointments where customer_name = 'Viejo Uno'), 'MIGR: ends_at = inicio + duración');
select qa.ok((select count(*) = 2 from public.appointments where date = qa.d(5) and barber_id = qa.id('b1')), 'MIGR: las citas viejas que se cruzan siguen ahí (no falla)');
select qa.ok(to_regclass('public.barbers_tenant_name_unique') is null, 'MIGR: con barberos repetidos no crea el índice único (solo avisa)');
select qa.ok(to_regclass('public.services_tenant_name_unique') is null, 'MIGR: con servicios repetidos no crea el índice único (solo avisa)');
select qa.ok(exists (select 1 from public.wa_opt_outs where phone = '51911111111'), 'MIGR: la baja vieja pasó a wa_opt_outs');
select qa.ok((select bool_and(whatsapp -> 'templates' ? 'clientCancel' and whatsapp -> 'templates' ? 'clientReschedule') from public.tenants), 'MIGR: plantillas clientCancel/clientReschedule agregadas');
select qa.ok(exists (select 1 from private.temp_passwords where user_id = qa.id('temp') and pw_hash = 'hash-temp'), 'MIGR: huella de la clave temporal guardada');

-- Cambiar una cita vieja que se cruza (cancelar) funciona
update public.appointments set status = 'CANCELADA' where customer_name = 'Viejo Dos';
select qa.ok(true, 'MIGR: se puede cancelar una cita vieja que se cruzaba');

-- WhatsApp apagado durante las pruebas de agenda (se prueba en la sección 10)
update public.tenants set whatsapp = jsonb_set(whatsapp, '{enabled}', 'false');

-- --------------------------------------------------------------------------
-- 3. A1 · Solapes, cierre y descansos (como ADMIN)
-- --------------------------------------------------------------------------
select qa.login(qa.id('adminA'));
set role authenticated;

insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time)
values (qa.id('tA'), 'Ana', qa.id('s60'), qa.id('b1'), qa.d(3), '10:00');
select qa.ok((select ends_at - starts_at = interval '60 min' and duration_min = 60 from public.appointments where customer_name = 'Ana'), 'A1: ends_at y duración tomados del servicio');
select qa.err(format($q$insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time)
  values (%L, 'Bea', %L, %L, %L, '10:30')$q$, qa.id('tA'), qa.id('s30'), qa.id('b1'), qa.d(3)),
  'ya está ocupado', 'A1: 10:30 choca con la cita de 10:00 de 60 min');
select qa.err(format($q$insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time)
  values (%L, 'Bea', %L, %L, %L, '09:30')$q$, qa.id('tA'), qa.id('s60'), qa.id('b1'), qa.d(3)),
  'ya está ocupado', 'A1: 09:30 de 60 min invade la de 10:00');
insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time)
values (qa.id('tA'), 'Caro', qa.id('s30'), qa.id('b1'), qa.d(3), '11:00');
select qa.ok(true, 'A1: 11:00 (justo al terminar la anterior) sí se puede');
select qa.err(format($q$insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time)
  values (%L, 'Dani', %L, %L, %L, '23:00')$q$, qa.id('tA'), qa.id('s60'), qa.id('b1'), qa.d(3)),
  'no alcanza antes del cierre', 'A1: 23:00 de 60 min no cabe antes del cierre (23:30)');
select qa.err(format($q$insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time)
  values (%L, 'Eva', %L, %L, %L, '11:30')$q$, qa.id('tA'), qa.id('s60'), qa.id('b2'), qa.d(3)),
  'no alcanza', 'A1: 11:30 de 60 min invade el descanso del barbero (12:00–13:00)');
insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time)
values (qa.id('tA'), 'Fito', qa.id('s60'), qa.id('b2'), qa.d(3), '11:00');
select qa.ok(true, 'A1: 11:00 de 60 min cabe justo antes del descanso');
insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time)
values (qa.id('tA'), 'Dora', qa.id('s30'), qa.id('b1'), qa.d(3), '11:30');
select qa.err(format($q$update public.appointments set service_id = %L where customer_name = 'Caro'$q$, qa.id('s60')),
  'ya está ocupado', 'A1: cambiar a un servicio más largo que choca con la siguiente es rechazado');
update public.appointments set status = 'CANCELADA' where customer_name = 'Dora';
update public.appointments set service_id = qa.id('s60') where customer_name = 'Caro';
select qa.ok((select duration_min = 60 from public.appointments where customer_name = 'Caro'), 'A1: alargar el servicio sin choque sí se puede');

-- --------------------------------------------------------------------------
-- 4. A2 · Estados
-- --------------------------------------------------------------------------
select qa.err($q$update public.appointments set status = 'COMPLETADA' where customer_name = 'Ana'$q$,
  'ya empezó', 'A2: no se completa una cita futura');
select qa.err($q$update public.appointments set status = 'NO_ASISTIO' where customer_name = 'Ana'$q$,
  'ya empezó', 'A2: no se marca "no asistió" una cita futura');
update public.appointments set status = 'CONFIRMADA_WSP' where customer_name = 'Ana';
select qa.ok((select confirmed_at is not null from public.appointments where customer_name = 'Ana'), 'A2: PROGRAMADA → CONFIRMADA_WSP');
select qa.err($q$update public.appointments set status = 'PROGRAMADA' where customer_name = 'Ana'$q$,
  'solo vuelve a programada', 'A2: confirmada no vuelve a programada sin reprogramar');
update public.appointments set time = '14:00' where customer_name = 'Ana';
select qa.ok((select status = 'PROGRAMADA' and confirmed_at is null from public.appointments where customer_name = 'Ana'), 'A2: reprogramar una confirmada la deja PROGRAMADA');
update public.appointments set status = 'CANCELADA' where customer_name = 'Ana';
select qa.err($q$update public.appointments set status = 'PROGRAMADA' where customer_name = 'Ana'$q$,
  'ya fue cancelada', 'A2: CANCELADA es final');
select qa.err($q$update public.appointments set time = '15:00' where customer_name = 'Ana'$q$,
  'Solo se pueden reprogramar', 'A2: no se reprograma una cancelada');
update public.appointments set notes = 'nota' where customer_name = 'Ana';
select qa.ok(true, 'A2: una cancelada sí admite notas');
select qa.err(format($q$insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time, status)
  values (%L, 'Gus', %L, %L, %L, '16:00', 'CANCELADA')$q$, qa.id('tA'), qa.id('s30'), qa.id('b1'), qa.d(3)),
  'solo puede quedar programada', 'A2: no se inserta una cita ya cancelada');
select qa.err(format($q$insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time, status)
  values (%L, 'Gus', %L, %L, %L, '16:00', 'COMPLETADA')$q$, qa.id('tA'), qa.id('s30'), qa.id('b1'), qa.d(3)),
  'ya empezó', 'A2: no se inserta COMPLETADA en el futuro');
insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time, status)
values (qa.id('tA'), 'Venta Pasada', qa.id('s30'), qa.id('b1'), qa.d(-2), '10:00', 'COMPLETADA');
select qa.ok(true, 'A2: ADMIN registra una cita pasada COMPLETADA');

-- Cita pasada PROGRAMADA (se crea sin triggers, como si el tiempo hubiera pasado)
reset role; select qa.nadie();
alter table public.appointments disable trigger user;
insert into public.appointments (tenant_id, code, customer_name, service_id, service_name, barber_id, barber_name,
                                 date, time, starts_at, ends_at, duration_min, status)
values (qa.id('tA'), 'PASADA', 'Pasado', qa.id('s30'), 'Corte', qa.id('b1'), 'Carlos',
        qa.d(-1), '10:00', (qa.d(-1) + time '10:00') at time zone 'America/Lima',
        (qa.d(-1) + time '10:30') at time zone 'America/Lima', 30, 'PROGRAMADA');
alter table public.appointments enable trigger user;

select qa.login(qa.id('staffA'));
set role authenticated;
update public.appointments set status = 'COMPLETADA' where code = 'PASADA';
select qa.ok((select status = 'COMPLETADA' from public.appointments where code = 'PASADA'), 'A2: STAFF completa una cita que ya empezó');
select qa.err($q$update public.appointments set status = 'NO_ASISTIO' where code = 'PASADA'$q$,
  'Solo un administrador', 'A2: STAFF no corrige COMPLETADA → NO_ASISTIO');
select qa.err(format($q$insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time, status)
  values (%L, 'Hugo', %L, %L, %L, '10:00', 'COMPLETADA')$q$, qa.id('tA'), qa.id('s30'), qa.id('b1'), qa.d(-3)),
  'Solo un administrador', 'A2: STAFF no inserta citas COMPLETADA');

select qa.login(qa.id('adminA'));
update public.appointments set status = 'NO_ASISTIO' where code = 'PASADA';
update public.appointments set status = 'COMPLETADA' where code = 'PASADA';
select qa.ok(true, 'A2: ADMIN corrige COMPLETADA ↔ NO_ASISTIO');
select qa.err($q$update public.appointments set status = 'CANCELADA' where code = 'PASADA'$q$,
  'no puede pasar a cancelada', 'A2: COMPLETADA no pasa a CANCELADA');
select qa.err($q$update public.appointments set status = 'PROGRAMADA' where code = 'PASADA'$q$,
  'no puede pasar a programada', 'A2: COMPLETADA no vuelve a PROGRAMADA');

-- --------------------------------------------------------------------------
-- 5. M12 · El personal solo cambia estado, notas y fecha/hora
-- --------------------------------------------------------------------------
select qa.login(qa.id('staffA'));
insert into public.appointments (tenant_id, customer_name, phone, service_id, barber_id, date, time)
values (qa.id('tA'), 'Iris', '955555555', qa.id('s30'), qa.id('b1'), qa.d(4), '09:00');
update public.appointments set notes = 'llega tarde', time = '09:30' where customer_name = 'Iris';
select qa.ok((select time = '09:30' from public.appointments where customer_name = 'Iris'), 'M12: STAFF reprograma y anota su cita');
select qa.err($q$update public.appointments set price = 1 where customer_name = 'Iris'$q$, 'El personal solo puede', 'M12: STAFF no cambia el precio');
select qa.err($q$update public.appointments set customer_name = 'Otro' where customer_name = 'Iris'$q$, 'El personal solo puede', 'M12: STAFF no cambia el cliente');
select qa.err(format($q$update public.appointments set service_id = %L where customer_name = 'Iris'$q$, qa.id('s60')), 'El personal solo puede', 'M12: STAFF no cambia el servicio');
select qa.err(format($q$update public.appointments set barber_id = %L where customer_name = 'Iris'$q$, qa.id('b2')), 'El personal solo puede', 'M12: STAFF no cambia el barbero');
select qa.err($q$update public.appointments set duration_min = 5 where customer_name = 'Iris'$q$, 'El personal solo puede', 'M12: STAFF no cambia la duración');
select qa.ok((select count(*) = 0 from public.appointments where barber_id <> qa.id('b1')), 'M12: STAFF vinculado solo ve citas de su barbero');
select qa.login(qa.id('adminA'));
update public.appointments set price = 30 where customer_name = 'Iris';
select qa.ok(true, 'M12: ADMIN sí cambia el precio');
reset role; select qa.nadie();

-- --------------------------------------------------------------------------
-- 6. A3 · Contraseña temporal
-- --------------------------------------------------------------------------
select qa.login(qa.id('temp'));
set role authenticated;
select qa.ok((select count(*) = 0 from public.tenants), 'A3: con clave temporal no ve la barbería');
select qa.ok((select count(*) = 0 from public.appointments), 'A3: con clave temporal no ve citas');
select qa.ok((select count(*) = 1 from public.profiles), 'A3: con clave temporal solo ve su perfil');
select qa.err($q$update public.profiles set must_change_password = false where id = auth.uid()$q$,
  'Primero cambia tu contraseña', 'A3: no puede quitarse la marca sin cambiar la clave');
select qa.err($q$select public.perfil_contrasena_cambiada()$q$, 'Primero cambia tu contraseña', 'A3: la RPC exige que la clave haya cambiado');
select qa.err($q$select public.registrar_actividad('x')$q$, 'Sesión no válida', 'A3: no escribe historial con clave temporal');
select qa.err(format($q$select public.perfil_clave_temporal(%L)$q$, qa.id('staffA')), 'permission denied', 'A3: perfil_clave_temporal no es para usuarios');
update public.profiles set name = 'Temporal 2' where id = auth.uid();
select qa.ok(true, 'A3: sí puede editar su nombre');
reset role; select qa.nadie();
update auth.users set encrypted_password = 'hash-nuevo' where id = qa.id('temp');   -- updateUser({password})
select qa.login(qa.id('temp')); set role authenticated;
select qa.ok(public.perfil_contrasena_cambiada(), 'A3: tras cambiar la clave la RPC quita la marca');
select qa.ok((select count(*) = 1 from public.tenants), 'A3: ya ve su barbería');
reset role; select qa.nadie();
select qa.ok(not exists (select 1 from private.temp_passwords where user_id = qa.id('temp')), 'A3: la huella se borra al terminar');
select qa.server();
set role service_role;
select public.perfil_clave_temporal(qa.id('temp'));
reset role; select qa.nadie();
select qa.ok((select must_change_password from public.profiles where id = qa.id('temp'))
             and exists (select 1 from private.temp_passwords where user_id = qa.id('temp') and pw_hash = 'hash-nuevo'),
             'A3: admin-usuarios (service_role) marca la clave temporal y guarda la huella');
select qa.login(qa.id('temp'));
set role authenticated;
select qa.ok((select count(*) = 0 from public.tenants), 'A3: tras restablecer vuelve a quedar bloqueado');
reset role; select qa.nadie();

-- --------------------------------------------------------------------------
-- 7. M6 · Nombres únicos y renombrar
-- --------------------------------------------------------------------------
select qa.login(qa.id('adminA'));
set role authenticated;
select qa.err(format($q$insert into public.barbers (tenant_id, name) values (%L, ' CARLOS ')$q$, qa.id('tA')),
  'Ya existe un barbero', 'M6: no se repite el nombre de un barbero (sin importar mayúsculas)');
select qa.err(format($q$insert into public.services (tenant_id, name) values (%L, 'corte')$q$, qa.id('tA')),
  'Ya existe un servicio', 'M6: no se repite el nombre de un servicio');
update public.barbers set name = 'Carlos M.' where id = qa.id('b1');
select qa.ok((select bool_and(barber_name = 'Carlos M.') from public.appointments where barber_id = qa.id('b1')),
  'M6: al renombrar, las citas del barbero llevan el nombre nuevo');
reset role; select qa.nadie();

-- --------------------------------------------------------------------------
-- 8. M11 · Clientes y cliente_asegurar (M14)
-- --------------------------------------------------------------------------
insert into public.customers (tenant_id, name, phone) values (qa.id('tA'), 'Cliente De Luis', '966666666');
insert into public.appointments (tenant_id, customer_name, phone, service_id, barber_id, date, time)
values (qa.id('tA'), 'Cliente De Luis', '966666666', qa.id('s30'), qa.id('b2'), qa.d(4), '09:00');
insert into public.customers (tenant_id, name, phone) values (qa.id('tA'), 'Iris', '955555555');
select qa.login(qa.id('adminA'));
set role authenticated;
select qa.ok((select count(*) >= 3 from public.customers), 'M11: ADMIN con módulo Clientes ve la cartera');
reset role; select qa.nadie();
update public.profiles set grants = jsonb_set(grants, '{customers}', 'false') where id = qa.id('adminA');
select qa.login(qa.id('adminA')); set role authenticated;
select qa.ok((select count(*) = 0 from public.customers), 'M11: ADMIN sin módulo Clientes no ve clientes');
reset role; select qa.nadie();
update public.profiles set grants = jsonb_set(grants, '{customers}', 'true') where id = qa.id('adminA');
select qa.login(qa.id('staffA'));
set role authenticated;
select qa.ok((select count(*) = 1 and bool_and(phone = '955555555') from public.customers), 'M11: STAFF vinculado solo ve clientes de su barbero');
select set_config('qa.r', public.cliente_asegurar('Otro Nombre', '+51 922 222 222')::text, false);
reset role; select qa.nadie();
select qa.ok(current_setting('qa.r')::uuid = (select id from public.customers where phone = '922222222' and tenant_id = qa.id('tA')),
  'M14: cliente_asegurar encuentra la ficha por celular (con +51)');
select qa.ok((select name = 'Juan Original' from public.customers where phone = '922222222'), 'M14: cliente_asegurar no renombra');
select qa.login(qa.id('staffA2'));
set role authenticated;
select qa.ok((select count(*) >= 4 from public.customers), 'M11: STAFF sin barbero ve todos');
select qa.ok(public.cliente_asegurar('Nuevo Cliente', '977777777') is not null, 'M14: crea un cliente nuevo por celular');
select qa.ok(public.cliente_asegurar('Repetido', '977777777') = (select id from public.customers where phone = '977777777'), 'M14: el mismo celular devuelve la misma ficha');
select qa.ok(public.cliente_asegurar('Sin cel', '') is null, 'M14: sin celular no crea ficha');
select qa.err($q$select public.cliente_asegurar('X', '988888888')$q$, 'nombre del cliente', 'M14: valida el nombre');
reset role; select qa.nadie();
select qa.login(qa.id('adminB'));
set role authenticated;
select qa.ok(public.cliente_asegurar('De B', '977777777') is not null, 'M14: otra barbería crea su propia ficha');
reset role; select qa.nadie();
select qa.ok((select count(*) = 2 from public.customers where phone = '977777777'), 'M14: cada barbería con su ficha');
select qa.nadie();
set role anon;
select qa.err($q$select public.cliente_asegurar('x', '911')$q$, 'permission denied', 'M14: anon no llama cliente_asegurar');
reset role; select qa.nadie();

-- --------------------------------------------------------------------------
-- 9. Web pública: crear_reserva (A5, M5, B11, M17) y web_*
-- --------------------------------------------------------------------------
set role anon;
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L, '10:00', 'Ana', '999999999')$q$, qa.id('s30'), qa.id('b1'), qa.d(6)),
  'permission denied', 'crear_reserva: anon no la llama directo');
select qa.ok((public.web_barberia('golden') -> 'tenant') ?& array['wa_enabled', 'server_now', 'timezone', 'lead_minutes', 'accepting'],
  'web_barberia: devuelve wa_enabled, server_now, timezone, lead_minutes, accepting');
select qa.ok(public.web_barberia('golden') ?& array['wa_enabled', 'server_now', 'timezone', 'lead_minutes', 'accepting'],
  'web_barberia: los mismos campos también en la raíz');
select qa.ok(not (public.web_barberia('golden') ->> 'wa_enabled')::boolean, 'M1: wa_enabled = false con WhatsApp apagado');
select qa.ok((public.web_barberia('golden') -> 'tenant' ->> 'lead_minutes')::int = 15 and (public.web_barberia('golden') -> 'tenant' ->> 'accepting')::boolean,
  'web_barberia: anticipación 15 y acepta reservas');
reset role; select qa.nadie();

select qa.server();
set role service_role;
select qa.err(format($q$select public.crear_reserva('golden', null, %L, %L, '10:00', 'Ana', '999999999')$q$, qa.id('b1'), qa.d(6)),
  'Elige un servicio', 'M5: servicio obligatorio');
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L, '10:00', 'Ana', '999999999')$q$, qa.id('sOculto'), qa.id('b1'), qa.d(6)),
  'no está disponible', 'M5: servicio oculto rechazado');
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L, '10:00', 'Ana', '999999999')$q$, qa.id('sB'), qa.id('b1'), qa.d(6)),
  'no está disponible', 'M5: servicio de otra barbería rechazado');
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, null, '10:00', 'Ana', '999999999')$q$, qa.id('s30'), qa.id('b1')),
  'Elige la fecha', 'M5: fecha obligatoria');
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L, '10:00', 'A', '999999999')$q$, qa.id('s30'), qa.id('b1'), qa.d(6)),
  'entre 2 y 80', 'M5: nombre muy corto');
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L, '10:00', %L, '999999999')$q$, qa.id('s30'), qa.id('b1'), qa.d(6), repeat('a', 81)),
  'entre 2 y 80', 'M5: nombre de 81 letras (mensaje en español)');
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L, '10:00', 'Ana', '999999999', %L)$q$, qa.id('s30'), qa.id('b1'), qa.d(6), repeat('x', 301)),
  '300 caracteres', 'M5: notas de más de 300');
select qa.ok((public.crear_reserva('golden', qa.id('s30'), qa.id('b1'), qa.d(6), '10:00', 'Juan Impostor', '+51 922 222 222', '', true)) ? 'code',
  'M4: acepta el celular con +51 y espacios');
select qa.ok((public.crear_reserva('golden', qa.id('s30'), qa.id('b1'), qa.d(6), '12:00', 'Cliente Baja Otra', '911111111', '', true)) ? 'code',
  'A5: reserva con un celular dado de baja');
reset role; select qa.nadie();
select qa.ok((select name = 'Juan Original' from public.customers where phone = '922222222' and tenant_id = qa.id('tA')), 'A5: la web no renombra al cliente existente');
select qa.ok((select wa_opt_out_at is not null from public.customers where phone = '911111111'), 'A5: la web no anula la baja de WhatsApp');
select qa.server();
set role service_role;
select public.crear_reserva('golden', qa.id('s30'), qa.id('b1'), qa.d(7), '10:00', 'Juan', '922222222');
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L, '11:00', 'Juan', '922222222')$q$, qa.id('s30'), qa.id('b1'), qa.d(8)),
  'Ya tienes 2 citas pendientes', 'A5: máximo 2 citas futuras por celular');
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L, '10:00', 'Otro', '944444444')$q$, qa.id('s30'), qa.id('b1'), qa.d(6)),
  'acaba de ser tomado', 'A1: la web recibe el mensaje de horario tomado');
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L, '11:30', 'Otro', '944444444')$q$, qa.id('s60'), qa.id('b2'), qa.d(6)),
  'no alcanza', 'A1: la web no reserva 60 min que invaden el descanso');
reset role; select qa.nadie();
-- B11 · anticipación mínima
update public.tenants set booking_lead_minutes = 1440 where id = qa.id('tA');
select qa.server();
set role service_role;
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L::date, %L::time, 'Lia', '944444445')$q$,
  qa.id('s30'), qa.id('b1'),
  (date_trunc('hour', now() at time zone 'America/Lima') + interval '2 hours')::date,
  (date_trunc('hour', now() at time zone 'America/Lima') + interval '2 hours')::time),
  'anticipación', 'B11: respeta la anticipación mínima');
set role anon;
select qa.ok((select count(*) = 0 from public.web_horarios('golden', qa.id('b1'), qa.d(0)) where state <> 'past'), 'B11: web_horarios marca como pasado lo que está dentro de la anticipación');
reset role; select qa.nadie();
update public.tenants set booking_lead_minutes = 15 where id = qa.id('tA');
-- M17 · suscripción vencida hace más de 7 días
update public.tenants set subscription_end = qa.d(-8) where id = qa.id('tA');
select qa.server();
set role service_role;
select qa.err(format($q$select public.crear_reserva('golden', %L, %L, %L, '15:00', 'Lia', '944444445')$q$, qa.id('s30'), qa.id('b1'), qa.d(6)),
  'no está recibiendo reservas', 'M17: vencida hace más de 7 días no recibe reservas');
set role anon;
select qa.ok(not (public.web_barberia('golden') -> 'tenant' ->> 'accepting')::boolean, 'M17: web_barberia accepting = false');
select qa.ok((public.web_barberia('golden') ->> 'accepting') = 'false' and (public.web_barberia('golden') -> 'tenant' ->> 'name') = 'Golden Barbería',
  'M17: vencida → web_barberia devuelve la barbería con accepting=false (raíz)');
reset role; select qa.nadie();
update public.tenants set status = 'SUSPENDED' where id = qa.id('tB');
set role anon;
select qa.ok((public.web_barberia('otra') ->> 'accepting') = 'false', 'M17: suspendida → web_barberia con accepting=false');
select qa.ok(public.web_barberia('no-existe') is null, 'web_barberia: enlace desconocido → null');
reset role; select qa.nadie();
update public.tenants set status = 'ACTIVE' where id = qa.id('tB');
update public.tenants set subscription_end = qa.d(-7) where id = qa.id('tA');
set role anon;
select qa.ok((public.web_barberia('golden') -> 'tenant' ->> 'accepting')::boolean, 'M17: dentro de los 7 días de gracia sigue aceptando');
-- web_ocupados y web_horarios con duración
select qa.ok((select duration_min = 60 from public.web_ocupados('golden', 30) where barber_id = qa.id('b1') and date = qa.d(3) and "time" = '11:00'),
  'A1: web_ocupados devuelve duration_min');
select qa.ok((select state = 'busy' from public.web_horarios('golden', qa.id('b1'), qa.d(3), qa.id('s60')) where slot = '10:30'),
  'A1: web_horarios marca 10:30 ocupado para un servicio de 60 min (choca a las 11:00)');
select qa.ok((select state = 'free' from public.web_horarios('golden', qa.id('b1'), qa.d(3), qa.id('s30')) where slot = '10:30'),
  'A1: web_horarios deja 10:30 libre para 30 min');
select qa.ok((select state = 'busy' from public.web_horarios('golden', qa.id('b1'), qa.d(3), qa.id('s60')) where slot = '23:00'),
  'A1: web_horarios marca ocupado lo que no cabe antes del cierre');
reset role; select qa.nadie();
select set_config('qa.code', (select code from public.appointments where phone = '922222222' and date = qa.d(6)), false);
set role anon;
select qa.ok((select count(*) = 1 from public.web_consultar_cita('golden', '+51 922 222 222', current_setting('qa.code'))), 'M4: "Mi cita" con +51');
reset role; select qa.nadie();

-- --------------------------------------------------------------------------
-- 10. C1 · paleta y B6 · configuración de WhatsApp
-- --------------------------------------------------------------------------
select qa.login(qa.id('adminA'));
set role authenticated;
select qa.err($q$update public.tenants set palette = '{"primary":"#000\" onmouseover=\"alert(1)","secondary":"#D79848","tertiary":"#FFFFFF"}' where slug = 'golden'$q$,
  'tenants_palette_valid', 'C1: la paleta solo acepta #RRGGBB');
update public.tenants set palette = '{"primary":"#112233","secondary":"#D79848","tertiary":"#ffffff"}' where slug = 'golden';
select qa.ok(true, 'C1: una paleta válida se guarda');
select qa.err($q$update public.tenants set whatsapp = jsonb_set(whatsapp, '{reminders}', '[{"id":"r1","offsetMinutes":"x"}]') where slug = 'golden'$q$,
  'tenants_whatsapp_valid', 'B6: rechaza una configuración de WhatsApp mal formada');
select qa.err($q$update public.tenants set booking_lead_minutes = 5000 where slug = 'golden'$q$, 'booking_lead_minutes', 'B11: anticipación entre 0 y 1440');
reset role; select qa.nadie();
-- B6 · aunque una configuración rara llegue a la base, la cita se guarda
alter table public.tenants drop constraint tenants_whatsapp_valid;
update public.tenants set whatsapp = jsonb_set(jsonb_set(whatsapp, '{enabled}', 'true'),
  '{reminders}', '[{"id":"r1","offsetMinutes":99999999999}]') where slug = 'golden';
insert into public.appointments (tenant_id, customer_name, phone, service_id, barber_id, date, time, wa_opt_in)
values (qa.id('tA'), 'Config Rara', '988800001', qa.id('s30'), qa.id('b1'), qa.d(9), '10:00', true);
select qa.ok(exists (select 1 from public.appointments where customer_name = 'Config Rara'), 'B6: el error de WhatsApp no impide guardar la cita');
update public.tenants set whatsapp = private.wa_default_config() || '{"enabled": true, "notifyTo": ["999888777"], "quietHours": {}}'
where slug = 'golden';
alter table public.tenants add constraint tenants_whatsapp_valid check (private.wa_config_valida(whatsapp));

-- --------------------------------------------------------------------------
-- 11. WhatsApp: programación (M19, M20, M22, A6, B3)
-- --------------------------------------------------------------------------
delete from public.wa_outbox;
select qa.login(qa.id('adminA'));
set role authenticated;
insert into public.appointments (tenant_id, customer_name, phone, service_id, barber_id, date, time, wa_opt_in)
values (qa.id('tA'), 'Wa Uno', '988800002', qa.id('s30'), qa.id('b1'), qa.d(10), '10:00', true);
reset role; select qa.nadie();
select qa.ok((select array_agg(kind || ':' || rule_id order by kind, rule_id) from public.wa_outbox o
              join public.appointments a on a.id = o.appointment_id where a.customer_name = 'Wa Uno')
             = array['CLIENT_CONFIRM:', 'REMINDER:r1', 'REMINDER:r2', 'SHOP_NEW:51999888777'],
             'WA: al reservar → aviso a la barbería, confirmación y 2 recordatorios');
select qa.login(qa.id('adminA'));
set role authenticated;
update public.appointments set status = 'CANCELADA' where customer_name = 'Wa Uno';
reset role; select qa.nadie();
select qa.ok((select count(*) = 1 from public.wa_outbox o join public.appointments a on a.id = o.appointment_id
              where a.customer_name = 'Wa Uno' and kind = 'CLIENT_CANCEL' and o.status = 'PENDING'), 'M20: la barbería cancela → CLIENT_CANCEL al cliente');
select qa.ok((select count(*) = 0 from public.wa_outbox o join public.appointments a on a.id = o.appointment_id
              where a.customer_name = 'Wa Uno' and kind in ('REMINDER', 'CLIENT_CONFIRM') and o.status = 'PENDING'), 'WA: cancelar anula recordatorios y confirmación');

-- Reprogramar dos veces: el aviso pendiente se reemplaza (M22) y "solo si no confirmó" vuelve (M20)
update public.tenants set whatsapp = jsonb_set(whatsapp, '{reminders}', (whatsapp -> 'reminders') ||
  '[{"id":"r3","offsetMinutes":60,"onlyIfNotConfirmed":true,"template":"¿Vienes? {hora}"}]') where slug = 'golden';
select qa.login(qa.id('adminA'));
set role authenticated;
insert into public.appointments (tenant_id, customer_name, phone, service_id, barber_id, date, time, wa_opt_in, status)
values (qa.id('tA'), 'Wa Dos', '988800003', qa.id('s30'), qa.id('b1'), qa.d(10), '12:00', true, 'CONFIRMADA_WSP');
reset role; select qa.nadie();
select qa.ok(not exists (select 1 from public.wa_outbox o join public.appointments a on a.id = o.appointment_id
              where a.customer_name = 'Wa Dos' and o.rule_id = 'r3'), 'M20: cita ya confirmada → no programa el recordatorio "solo si no confirmó"');
select qa.login(qa.id('adminA'));
set role authenticated;
update public.appointments set time = '13:00' where customer_name = 'Wa Dos';
update public.appointments set time = '14:00' where customer_name = 'Wa Dos';
reset role; select qa.nadie();
select qa.ok((select count(*) = 1 from public.wa_outbox o join public.appointments a on a.id = o.appointment_id
              where a.customer_name = 'Wa Dos' and kind = 'CLIENT_RESCHEDULE' and o.status = 'PENDING'
                and o.body like '%14:00%'), 'M22: reprogramar dos veces deja un solo aviso al cliente, el último');
select qa.ok((select count(*) = 1 from public.wa_outbox o join public.appointments a on a.id = o.appointment_id
              where a.customer_name = 'Wa Dos' and kind = 'SHOP_RESCHEDULE' and o.status = 'PENDING'
                and o.body like '%14:00%'), 'M22: y un solo aviso a la barbería, el último');
select qa.ok(exists (select 1 from public.wa_outbox o join public.appointments a on a.id = o.appointment_id
              where a.customer_name = 'Wa Dos' and o.rule_id = 'r3' and o.status = 'PENDING' and o.only_if_not_confirmed),
             'M20: al reprogramar una confirmada vuelve el recordatorio "solo si no confirmó"');
update public.appointments set status = 'CONFIRMADA_WSP' where customer_name = 'Wa Dos';
select qa.ok(exists (select 1 from public.wa_outbox o join public.appointments a on a.id = o.appointment_id
              where a.customer_name = 'Wa Dos' and o.rule_id = 'r3' and o.status = 'CANCELLED'),
             'WA: al confirmar se anula el recordatorio "solo si no confirmó"');

-- B3 · baja por teléfono
insert into public.wa_opt_outs (tenant_id, phone) values (qa.id('tA'), '51988800004');
insert into public.appointments (tenant_id, customer_name, phone, service_id, barber_id, date, time, wa_opt_in)
values (qa.id('tA'), 'Wa Baja', '988800004', qa.id('s30'), qa.id('b1'), qa.d(10), '15:00', true);
select qa.ok(not exists (select 1 from public.wa_outbox o join public.appointments a on a.id = o.appointment_id
              where a.customer_name = 'Wa Baja' and o.kind in ('CLIENT_CONFIRM', 'REMINDER')), 'B3: un teléfono de baja no recibe mensajes aunque marque la casilla');

-- M19 · horas de silencio
update public.tenants set whatsapp = jsonb_set(whatsapp, '{quietHours}', jsonb_build_object(
  'from', to_char((now() at time zone 'America/Lima') - interval '1 hour', 'HH24:MI'),
  'to', to_char(date_trunc('hour', (now() at time zone 'America/Lima') + interval '3 hours'), 'HH24:MI')))
where slug = 'golden';
create temp table qa_q as
  select date_trunc('hour', (now() at time zone 'America/Lima') + interval '3 hours') as fin,
         date_trunc('hour', (now() at time zone 'America/Lima') + interval '3 hours') + interval '60 min' as cita;
grant select on qa_q to public;
insert into public.appointments (tenant_id, customer_name, phone, service_id, barber_id, date, time, wa_opt_in)
select qa.id('tA'), 'Wa Noche', '988800005', qa.id('s30'), qa.id('b4'), cita::date, cita::time, true from qa_q;
select qa.ok((select o.send_at = (q.fin at time zone 'America/Lima') from public.wa_outbox o join public.appointments a on a.id = o.appointment_id, qa_q q
              where a.customer_name = 'Wa Noche' and o.kind = 'CLIENT_CONFIRM'), 'M19: la confirmación al cliente sale al terminar el silencio');
select qa.ok((select o.send_at = (q.fin at time zone 'America/Lima') from public.wa_outbox o join public.appointments a on a.id = o.appointment_id, qa_q q
              where a.customer_name = 'Wa Noche' and o.rule_id = 'r2'), 'M19: el recordatorio que caía en silencio (y su ajuste ya pasó) sale al terminar el silencio');
select qa.ok((select o.send_at <= now() + interval '1 second' from public.wa_outbox o join public.appointments a on a.id = o.appointment_id
              where a.customer_name = 'Wa Noche' and o.kind = 'SHOP_NEW'), 'M19: el aviso a la barbería sale enseguida');
select qa.ok(private.wa_fin_silencio('2026-10-21 23:30-05', '{"quietHours":{"from":"21:00","to":"08:00"}}', 'America/Lima') = '2026-10-22 08:00-05'
             and private.wa_fin_silencio('2026-10-22 03:00-05', '{"quietHours":{"from":"21:00","to":"08:00"}}', 'America/Lima') = '2026-10-22 08:00-05'
             and private.wa_fin_silencio('2026-10-22 12:00-05', '{"quietHours":{"from":"21:00","to":"08:00"}}', 'America/Lima') is null,
             'M19: fin del silencio que cruza la medianoche');
update public.tenants set whatsapp = jsonb_set(whatsapp, '{quietHours}', '{}') where slug = 'golden';

-- A6 · desactivar WhatsApp anula lo pendiente
select qa.login(qa.id('adminA'));
set role authenticated;
update public.tenants set whatsapp = jsonb_set(whatsapp, '{enabled}', 'false') where slug = 'golden';
reset role; select qa.nadie();
select qa.ok(not exists (select 1 from public.wa_outbox where tenant_id = qa.id('tA') and status = 'PENDING'), 'A6: desactivar WhatsApp cancela todo lo pendiente');
select qa.login(qa.id('adminA'));
set role authenticated;
update public.appointments set status = 'CANCELADA' where customer_name = 'Wa Noche';
reset role; select qa.nadie();
select qa.ok(not exists (select 1 from public.wa_outbox o join public.appointments a on a.id = o.appointment_id
                         where a.customer_name = 'Wa Noche' and o.status = 'PENDING'), 'A6: con WhatsApp apagado no se programa nada nuevo');
update public.tenants set whatsapp = jsonb_set(whatsapp, '{enabled}', 'true') where slug = 'golden';

-- A6 · Desvincular desde el CRM
insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body) values (qa.id('tA'), 'TEST', 'x1', '51999000001', 'x');
select qa.login(qa.id('adminA'));
set role authenticated;
select public.wa_solicitar('LOGOUT');
reset role; select qa.nadie();
select qa.ok(not exists (select 1 from public.wa_outbox where tenant_id = qa.id('tA') and status = 'PENDING'), 'A6: Desvincular cancela lo pendiente');

-- Enviar prueba: máximo 5 por hora
delete from public.wa_outbox;
select qa.login(qa.id('adminA'));
set role authenticated;
select public.wa_enviar_prueba('999000001') from generate_series(1, 5);
select qa.err($q$select public.wa_enviar_prueba('999000001')$q$, 'Ya enviaste 5', 'WA: máximo 5 pruebas por hora');
reset role; select qa.nadie();

-- --------------------------------------------------------------------------
-- 12. bot_tomar_mensajes (A6, A9, B5, M19, M22)
-- --------------------------------------------------------------------------
delete from public.wa_outbox;
update public.tenants set whatsapp = jsonb_set(whatsapp, '{enabled}', 'true');
-- 30 pruebas en A y 5 en B: reparto justo
insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body)
select qa.id('tA'), 'TEST', 'a' || g, '51999000001', 'x' from generate_series(1, 30) g;
insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body)
select qa.id('tB'), 'TEST', 'b' || g, '51999000002', 'x' from generate_series(1, 5) g;
select qa.server();
set role service_role;
create temp table qa_t1 as select * from public.bot_tomar_mensajes(20, null);
reset role; select qa.nadie();
select qa.ok((select count(*) filter (where tenant_id = qa.id('tA')) = 10 and count(*) filter (where tenant_id = qa.id('tB')) = 5 from qa_t1),
  'A9: reparto justo (10 de A y 5 de B con p_limit 20)');

delete from public.wa_outbox;
-- caducidad, atascados, suspendida, apagada, baja, confirmada
insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body, created_at, send_at) values
  (qa.id('tA'), 'SHOP_NEW', 'viejo', '51999888777', 'viejo', now() - interval '13 hours', now() - interval '13 hours'),
  (qa.id('tA'), 'REPLY', 'viejo', '51999888777', 'viejo', now() - interval '13 hours', now() - interval '13 hours');
insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
select qa.id('tA'), id, 'SHOP_NEW', 'pasada', '51999888777', 'cita ya empezó' from public.appointments where code = 'PASADA';
insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body, status, attempts, locked_at) values
  (qa.id('tA'), 'TEST', 'atascado3', '51999000001', 'x', 'SENDING', 3, now() - interval '11 minutes'),
  (qa.id('tA'), 'TEST', 'atascado1', '51999000001', 'x', 'SENDING', 1, now() - interval '11 minutes');
insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
select qa.id('tA'), id, 'CLIENT_CONFIRM', '', '51988800004', 'de baja' from public.appointments where customer_name = 'Wa Baja';
insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body, only_if_not_confirmed)
select qa.id('tA'), id, 'REMINDER', 'rx', '51988800003', 'ya confirmó', true from public.appointments where customer_name = 'Wa Dos';
insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body) values
  (qa.id('tB'), 'TEST', 'suspendida', '51999000002', 'x');
update public.tenants set status = 'SUSPENDED' where id = qa.id('tB');
select qa.server();
set role service_role;
create temp table qa_t2 as select * from public.bot_tomar_mensajes(20, null);
reset role; select qa.nadie();
select qa.ok((select status from public.wa_outbox where kind = 'SHOP_NEW' and rule_id = 'viejo') = 'CANCELLED', 'M22: aviso a la barbería con más de 12 h caduca');
select qa.ok((select status from public.wa_outbox where kind = 'REPLY' and rule_id = 'viejo') = 'CANCELLED', 'M22: respuesta con más de 12 h caduca');
select qa.ok((select status from public.wa_outbox where rule_id = 'pasada') = 'CANCELLED', 'M22: aviso de una cita que ya empezó caduca');
select qa.ok((select status from public.wa_outbox where rule_id = 'atascado3') = 'FAILED', 'M22: "enviando" atascado con 3 intentos → FAILED');
select qa.ok((select status = 'SENDING' and attempts = 2 from public.wa_outbox where rule_id = 'atascado1'), 'M22: "enviando" atascado con 1 intento se retoma');
select qa.ok((select status from public.wa_outbox where body = 'de baja') = 'CANCELLED', 'B3: mensaje a un teléfono de baja se cancela al tomar');
select qa.ok((select status from public.wa_outbox where rule_id = 'rx') = 'CANCELLED', 'M20: recordatorio "solo si no confirmó" de cita confirmada se cancela');
select qa.ok((select status from public.wa_outbox where rule_id = 'suspendida') = 'PENDING', 'B5: barbería suspendida: no se toma');
select qa.ok((select count(*) = 1 from qa_t2), 'bot_tomar: solo tomó el atascado recuperable');
update public.tenants set status = 'ACTIVE' where id = qa.id('tB');

-- Apagada: TEST sí sale, REMINDER no
delete from public.wa_outbox;
insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
select qa.id('tA'), id, 'REMINDER', 'apagada', '51988800002', 'x' from public.appointments where customer_name = 'Iris';
insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body) values (qa.id('tA'), 'TEST', 'apagada', '51999000001', 'x');
alter table public.tenants disable trigger tenants_wa_apagado;          -- apagar sin cancelar, para ver el filtro
update public.tenants set whatsapp = jsonb_set(whatsapp, '{enabled}', 'false') where slug = 'golden';
alter table public.tenants enable trigger tenants_wa_apagado;
select qa.server();
set role service_role;
create temp table qa_t3 as select * from public.bot_tomar_mensajes(20, array[qa.id('tA')]);
reset role; select qa.nadie();
select qa.ok((select array_agg(kind) = array['TEST'] from qa_t3), 'A6: con WhatsApp apagado el bot solo toma pruebas');
update public.tenants set whatsapp = jsonb_set(whatsapp, '{enabled}', 'true') where slug = 'golden';

-- Silencio al tomar: se pospone el mensaje al cliente
delete from public.wa_outbox;
update public.tenants set whatsapp = jsonb_set(whatsapp, '{quietHours}', jsonb_build_object(
  'from', to_char((now() at time zone 'America/Lima') - interval '1 hour', 'HH24:MI'),
  'to', to_char((now() at time zone 'America/Lima') + interval '2 hours', 'HH24:MI'))) where slug = 'golden';
insert into public.wa_outbox (tenant_id, appointment_id, kind, rule_id, recipient, body)
select qa.id('tA'), id, 'REMINDER', 'silencio', '51955555555', 'x' from public.appointments where customer_name = 'Iris';
insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body) values (qa.id('tA'), 'SHOP_NEW', 'silencio', '51999888777', 'x');
select qa.server();
set role service_role;
create temp table qa_t4 as select * from public.bot_tomar_mensajes(20, null);
reset role; select qa.nadie();
select qa.ok((select array_agg(kind) = array['SHOP_NEW'] from qa_t4), 'M19: en silencio el bot no toma mensajes al cliente');
select qa.ok((select send_at > now() + interval '1 hour' and status = 'PENDING' from public.wa_outbox where kind = 'REMINDER' and rule_id = 'silencio'),
  'M19: el mensaje al cliente se pospone al final del silencio');
update public.tenants set whatsapp = jsonb_set(whatsapp, '{quietHours}', '{}') where slug = 'golden';

-- bot_marcar devuelve si encontró el mensaje
select qa.server();
set role service_role;
select qa.ok(public.bot_marcar((select id from qa_t4 limit 1), true), 'M22: bot_marcar devuelve true');
select qa.ok(not public.bot_marcar(gen_random_uuid(), true), 'M22: bot_marcar devuelve false si no existe');
reset role; select qa.nadie();

-- --------------------------------------------------------------------------
-- 13. bot_respuesta (A9, B3, B5, M21)
-- --------------------------------------------------------------------------
delete from public.wa_outbox;
insert into public.appointments (tenant_id, customer_name, phone, service_id, barber_id, date, time)
values (qa.id('tA'), 'Doble Uno', '987600001', qa.id('s30'), qa.id('b4'), qa.d(11), '10:00'),
       (qa.id('tA'), 'Doble Dos', '987600001', qa.id('s30'), qa.id('b4'), qa.d(12), '10:00'),
       (qa.id('tA'), 'Sola', '987600002', qa.id('s30'), qa.id('b4'), qa.d(11), '11:00');
select qa.server();
set role service_role;
select qa.ok(public.bot_respuesta(qa.id('tA'), '51987600001', 'ok') is null, 'M21: "ok" ya no confirma');
select qa.ok(public.bot_respuesta(qa.id('tA'), '51987600001', 'Sí') is null, 'M21: "sí" ya no confirma');
select qa.ok(public.bot_respuesta(qa.id('tA'), '51987600001', 'CONFIRMAR') is not null, 'M21: con dos citas, CONFIRMAR pide el código');
select qa.ok((select count(*) = 0 from public.appointments where phone = '987600001' and status = 'CONFIRMADA_WSP'), 'M21: … sin confirmar ninguna');
select qa.ok(public.bot_respuesta(qa.id('tA'), '51987600001', 'confirmar') is null, 'M21: pide el código una sola vez');
select qa.ok(public.bot_respuesta(qa.id('tA'), '51987600001',
               'Confirmar ' || lower((select code from public.appointments where customer_name = 'Doble Dos'))) is not null, 'M21: "confirmar <código>" confirma esa cita');
select qa.ok((select status = 'CONFIRMADA_WSP' from public.appointments where customer_name = 'Doble Dos')
             and (select status = 'PROGRAMADA' from public.appointments where customer_name = 'Doble Uno'), 'M21: … y solo esa');
select qa.ok(public.bot_respuesta(qa.id('tA'), '51987600001',
               'confirmar ' || (select code from public.appointments where customer_name = 'Doble Dos')) is null, 'M21: ya confirmada y respondida → no responde');
select qa.ok(public.bot_respuesta(qa.id('tA'), '987600002', 'Sí, confirmo!') is not null, 'M21: "si confirmo" responde');
select qa.ok((select status = 'CONFIRMADA_WSP' from public.appointments where customer_name = 'Sola'), 'M21: "si confirmo" con una cita la confirma');
-- BAJA
select qa.ok(public.bot_respuesta(qa.id('tA'), '51987600003', 'BAJA') is not null, 'B3: BAJA sin ficha de cliente responde');
select qa.ok(exists (select 1 from public.wa_opt_outs where tenant_id = qa.id('tA') and phone = '51987600003'), 'B3: … y queda la baja por teléfono');
select qa.ok(public.bot_respuesta(qa.id('tA'), '51987600003', 'baja') is null, 'A9: BAJA responde solo la primera vez');
select qa.ok(public.bot_respuesta(qa.id('tA'), '34600111222', 'stop') is not null, 'B3: STOP de un número no peruano responde');
select qa.ok(exists (select 1 from public.wa_opt_outs where phone = '34600111222'), 'B3: … y queda su baja');
-- Límite 5 respuestas por hora
reset role; select qa.nadie();
insert into public.wa_outbox (tenant_id, kind, rule_id, recipient, body, status)
select qa.id('tA'), 'REPLY', 'r' || g, '51987600009', 'x', 'SENT' from generate_series(1, 5) g;
select qa.server();
set role service_role;
select qa.ok(public.bot_respuesta(qa.id('tA'), '51987600009', 'baja') is null, 'A9: más de 5 respuestas por hora → no responde');
reset role; select qa.nadie();
select qa.ok(exists (select 1 from public.wa_opt_outs where phone = '51987600009'), 'A9: … pero la baja sí se registra');
-- Suspendida
update public.tenants set status = 'SUSPENDED' where id = qa.id('tA');
select qa.server();
set role service_role;
select qa.ok(public.bot_respuesta(qa.id('tA'), '51987600010', 'baja') is null, 'B5: barbería suspendida no responde');
reset role; select qa.nadie();
update public.tenants set status = 'ACTIVE' where id = qa.id('tA');
-- Quitar la baja en la ficha del cliente la quita de la lista
update public.customers set wa_opt_out_at = null where phone = '911111111';
select qa.ok(not exists (select 1 from public.wa_opt_outs where phone = '51911111111'), 'B3: quitar la baja en la ficha la quita de wa_opt_outs');

-- --------------------------------------------------------------------------
-- 14. Fechas especiales: el ADMIN necesita el módulo Configuración
-- --------------------------------------------------------------------------
update public.profiles set grants = jsonb_set(grants, '{settings}', 'false') where id = qa.id('adminA');
select qa.login(qa.id('adminA'));
set role authenticated;
select qa.err(format($q$insert into public.schedule_exceptions (tenant_id, date, ranges) values (%L, %L, '[]')$q$, qa.id('tA'), qa.d(20)),
  'row-level security', 'Fechas especiales: ADMIN sin Configuración no puede escribir');
reset role; select qa.nadie();
update public.profiles set grants = jsonb_set(grants, '{settings}', 'true') where id = qa.id('adminA');
select qa.login(qa.id('adminA')); set role authenticated;
insert into public.schedule_exceptions (tenant_id, date, ranges) values (qa.id('tA'), qa.d(20), '[]');
select qa.ok(true, 'Fechas especiales: ADMIN con Configuración sí puede');
reset role; select qa.nadie();
select qa.nadie();

\echo '=== qa_10: todas las pruebas pasaron ==='
