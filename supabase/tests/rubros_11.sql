-- ==========================================================================
-- Pruebas de la migración 11 (rubros)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 10 aplicadas (SIN la 11). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/rubros_11.sql
-- El script:
--   1. Carga negocios con plantillas de WhatsApp de fábrica y personalizadas.
--   2. Aplica la migración 11 (dos veces: es repetible).
--   3. Prueba rubro, palabras, permisos, web_barberia, WhatsApp y mensajes.
--      Cada prueba imprime "OK …"; la primera que falla detiene el script.
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists qa cascade;
create schema qa;
grant usage on schema qa to public;
create table qa.ids (k text primary key, id uuid not null);
grant select on qa.ids to public;
create table qa.acl (fn text primary key, acl text);

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
-- 1. Datos previos (con migraciones 1–10)
-- --------------------------------------------------------------------------
insert into qa.ids values
  ('tA', gen_random_uuid()), ('tB', gen_random_uuid()), ('tC', gen_random_uuid()),
  ('super', gen_random_uuid()), ('adminA', gen_random_uuid()), ('staffA', gen_random_uuid()),
  ('adminB', gen_random_uuid()), ('b1', gen_random_uuid()), ('bB', gen_random_uuid()),
  ('s30', gen_random_uuid());

-- tA: plantillas de fábrica de la 10 · tB: clientConfirm y r2 personalizados
insert into public.tenants (id, slug, name, address, schedule, whatsapp) values
  (qa.id('tA'), 'golden', 'Golden Barbería', 'Av. La Marina 123',
   jsonb_build_object('interval', 30, 'maxDays', 60,
     'week', (select jsonb_object_agg(d::text, '[["00:00","23:30"]]'::jsonb) from generate_series(0, 6) d)),
   private.wa_default_config()),
  (qa.id('tB'), 'otra', 'Otra Barbería', '',
   jsonb_build_object('interval', 30, 'maxDays', 60,
     'week', (select jsonb_object_agg(d::text, '[["00:00","23:30"]]'::jsonb) from generate_series(0, 6) d)),
   jsonb_set(jsonb_set(private.wa_default_config(), '{templates,clientConfirm}', '"Hola {cliente}, te esperamos en {barberia}."'),
             '{reminders,1,template}', '"Mi recordatorio propio con {barbero}"'));

insert into qa.acl
select p.oid::regprocedure::text, coalesce(p.proacl::text, '')
from pg_proc p
where p.oid in ('private.tenant_for_admin(uuid,text)'::regprocedure, 'private.profiles_guard()'::regprocedure,
                'private.appointments_before()'::regprocedure, 'private.nombre_unico()'::regprocedure,
                'public.crear_reserva(text,uuid,uuid,date,time,text,text,text,boolean)'::regprocedure,
                'public.bot_respuesta(uuid,text,text)'::regprocedure);

insert into auth.users (id, email, encrypted_password)
select id, k || '@x.pe', 'hash-' || k from qa.ids where k in ('super', 'adminA', 'staffA', 'adminB');

insert into public.barbers (id, tenant_id, name) values
  (qa.id('b1'), qa.id('tA'), 'Carlos'),
  (qa.id('bB'), qa.id('tB'), 'Beto');
insert into public.services (id, tenant_id, name, duration_min, price, active) values
  (qa.id('s30'), qa.id('tA'), 'Corte', 30, 25, true);

insert into public.profiles (id, email, name, role, tenant_id, barber_id, must_change_password, grants) values
  (qa.id('super'), 'super@x.pe', 'Super', 'SUPERADMIN', null, null, false, default),
  (qa.id('adminA'), 'adminA@x.pe', 'Admin A', 'ADMIN', qa.id('tA'), null, false, default),
  (qa.id('staffA'), 'staffA@x.pe', 'Staff A', 'STAFF', qa.id('tA'), qa.id('b1'), false, default),
  (qa.id('adminB'), 'adminB@x.pe', 'Admin B', 'ADMIN', qa.id('tB'), null, false, default);

-- --------------------------------------------------------------------------
-- 2. Aplicar la migración 11 (dos veces)
-- --------------------------------------------------------------------------
\ir ../migrations/20261022000011_rubros.sql
\ir ../migrations/20261022000011_rubros.sql

-- --------------------------------------------------------------------------
-- 3. Columnas y validaciones
-- --------------------------------------------------------------------------
select qa.ok((select bool_and(business_type = 'barberia' and labels = '{}'::jsonb) from public.tenants),
  'MIGR: negocios existentes quedan como barbería y sin palabras propias');
insert into public.tenants (id, slug, name) values (qa.id('tC'), 'clinica', 'Clínica Sonrisa');
select qa.ok((select business_type = 'barberia' and labels = '{}'::jsonb from public.tenants where id = qa.id('tC')),
  'Negocio nuevo: business_type por defecto barberia y labels {}');

select qa.err($q$update public.tenants set business_type = 'peluqueria' where slug = 'clinica'$q$,
  'tenants_business_type_valid', 'Rubro desconocido rechazado');
select qa.err($q$update public.tenants set business_type = null where slug = 'clinica'$q$,
  'null value', 'Rubro vacío rechazado');
select qa.err($q$update public.tenants set labels = '[]' where slug = 'clinica'$q$,
  'tenants_labels_valid', 'labels debe ser un objeto');
select qa.err($q$update public.tenants set labels = '{"barbero":"x"}' where slug = 'clinica'$q$,
  'tenants_labels_valid', 'labels: clave desconocida rechazada');
select qa.err($q$update public.tenants set labels = '{"staff":"<b>doc</b>"}' where slug = 'clinica'$q$,
  'tenants_labels_valid', 'labels: texto con < > rechazado');
select qa.err($q$update public.tenants set labels = '{"staff":"el \"doc\""}' where slug = 'clinica'$q$,
  'tenants_labels_valid', 'labels: texto con comillas rechazado');
select qa.err($q$update public.tenants set labels = '{"staff":""}' where slug = 'clinica'$q$,
  'tenants_labels_valid', 'labels: texto vacío rechazado');
select qa.err($q$update public.tenants set labels = '{"staff":"   "}' where slug = 'clinica'$q$,
  'tenants_labels_valid', 'labels: solo espacios rechazado');
select qa.err(format($q$update public.tenants set labels = jsonb_build_object('staff', %L) where slug = 'clinica'$q$, repeat('a', 41)),
  'tenants_labels_valid', 'labels: más de 40 caracteres rechazado');
select qa.err($q$update public.tenants set labels = '{"staff":3}' where slug = 'clinica'$q$,
  'tenants_labels_valid', 'labels: valor que no es texto rechazado');
update public.tenants set business_type = 'dental',
       labels = '{"staff":"doctora","staffPlural":"doctoras","staffArticle":"la"}' where slug = 'clinica';
select qa.ok((select business_type = 'dental' and labels ->> 'staff' = 'doctora' from public.tenants where slug = 'clinica'),
  'Rubro y palabras válidas se guardan');
select qa.ok(private.labels_validas(jsonb_build_object('business', repeat('ñ', 40))), 'labels: 40 caracteres (con tildes) sí');

-- --------------------------------------------------------------------------
-- 4. Quién puede cambiar el rubro y las palabras
-- --------------------------------------------------------------------------
select qa.login(qa.id('adminA'));
set role authenticated;
update public.tenants set business_type = 'spa', labels = '{"client":"huésped"}' where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select business_type = 'spa' and labels ->> 'client' = 'huésped' from public.tenants where id = qa.id('tA')),
  'ADMIN con Configuración cambia rubro y palabras de su negocio');

select qa.login(qa.id('adminA'));
set role authenticated;
update public.tenants set business_type = 'otro' where id = qa.id('tB');
reset role; select qa.nadie();
select qa.ok((select business_type = 'barberia' from public.tenants where id = qa.id('tB')),
  'ADMIN no cambia el rubro de otro negocio');

select qa.login(qa.id('staffA'));
set role authenticated;
update public.tenants set business_type = 'otro' where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select business_type = 'spa' from public.tenants where id = qa.id('tA')),
  'STAFF no cambia el rubro');

update public.profiles set grants = jsonb_set(grants, '{settings}', 'false') where id = qa.id('adminA');
select qa.login(qa.id('adminA'));
set role authenticated;
update public.tenants set business_type = 'otro' where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select business_type = 'spa' from public.tenants where id = qa.id('tA')),
  'ADMIN sin Configuración no cambia el rubro');
update public.profiles set grants = jsonb_set(grants, '{settings}', 'true') where id = qa.id('adminA');

select qa.login(qa.id('super'));
set role authenticated;
update public.tenants set business_type = 'barberia', labels = '{}' where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select business_type = 'barberia' and labels = '{}'::jsonb from public.tenants where id = qa.id('tA')),
  'Superadmin cambia rubro y palabras');

-- Candado del trigger (por si una política futura abriera la tabla)
update public.profiles set grants = jsonb_set(grants, '{settings}', 'false') where id = qa.id('adminA');
select qa.login(qa.id('adminA'));
select qa.err($q$update public.tenants set business_type = 'otro' where id = qa.id('tA')$q$,
  'módulo Configuración', 'tenants_guard: sin Configuración no cambia el rubro (aunque RLS lo dejara)');
select qa.nadie();
update public.profiles set grants = jsonb_set(grants, '{settings}', 'true') where id = qa.id('adminA');

-- --------------------------------------------------------------------------
-- 5. Web pública
-- --------------------------------------------------------------------------
set role anon;
select qa.ok((select (j ->> 'business_type') = 'dental' and (j -> 'tenant' ->> 'business_type') = 'dental'
                     and (j -> 'labels' ->> 'staff') = 'doctora' and (j -> 'tenant' -> 'labels' ->> 'staffArticle') = 'la'
              from (select public.web_barberia('clinica') j) x),
  'web_barberia devuelve business_type y labels (raíz y tenant) a anon');
select qa.ok((select (j ->> 'business_type') = 'barberia' and (j -> 'labels') = '{}'::jsonb and jsonb_array_length(j -> 'barbers') = 1
              from (select public.web_barberia('golden') j) x),
  'web_barberia: negocio sin rubro elegido = barberia, y sigue devolviendo barbers');
select qa.ok(public.web_barberia('no-existe') is null, 'web_barberia: enlace desconocido = null');
reset role;

-- --------------------------------------------------------------------------
-- 6. WhatsApp
-- --------------------------------------------------------------------------
update public.tenants set whatsapp = jsonb_set(whatsapp, '{enabled}', 'false');
insert into public.appointments (tenant_id, customer_name, phone, service_id, barber_id, date, time)
values (qa.id('tA'), 'Ana Pérez', '987654321', qa.id('s30'), qa.id('b1'), qa.d(3), '10:00');
select qa.ok((select private.wa_render('{negocio}|{barberia}|{profesional}|{barbero}|{cliente}|{servicio}', a, t)
                     = 'Golden Barbería|Golden Barbería|Carlos|Carlos|Ana|Corte'
              from public.appointments a join public.tenants t on t.id = a.tenant_id
              where a.customer_name = 'Ana Pérez'),
  'wa_render: {negocio} = {barberia} y {profesional} = {barbero}');

select qa.ok(private.wa_default_config()::text !~ '\{barber(o|ia)\}' and private.wa_default_config()::text !~ '💈'
             and private.wa_default_config() -> 'templates' ->> 'shopNew' like '📅 Nueva reserva%',
  'Plantillas de fábrica usan {negocio}/{profesional} y 📅');
select qa.ok((select whatsapp -> 'templates' = private.wa_default_config() -> 'templates'
                     and whatsapp -> 'reminders' = private.wa_default_config() -> 'reminders'
              from public.tenants where id = qa.id('tA')),
  'MIGR: negocio con plantillas de fábrica recibe las nuevas (plantillas y recordatorios)');
select qa.ok((select whatsapp -> 'templates' ->> 'clientConfirm' = 'Hola {cliente}, te esperamos en {barberia}.'
                     and whatsapp -> 'reminders' -> 1 ->> 'template' = 'Mi recordatorio propio con {barbero}'
              from public.tenants where id = qa.id('tB')),
  'MIGR: las plantillas personalizadas no se tocan');
select qa.ok((select whatsapp -> 'templates' ->> 'shopNew' = private.wa_default_config() -> 'templates' ->> 'shopNew'
                     and whatsapp -> 'reminders' -> 0 ->> 'template' = private.wa_default_config() -> 'reminders' -> 0 ->> 'template'
              from public.tenants where id = qa.id('tB')),
  'MIGR: … y las que seguían de fábrica en ese negocio sí cambian');
select qa.ok((select whatsapp = private.wa_default_config() from public.tenants where id = qa.id('tC')),
  'Negocio nuevo recibe la configuración de fábrica nueva');
select qa.ok((select bool_and(private.wa_config_valida(whatsapp)) from public.tenants),
  'Configuraciones de WhatsApp siguen siendo válidas');

-- --------------------------------------------------------------------------
-- 7. Mensajes neutros (y las funciones reescritas conservan todo lo demás)
-- --------------------------------------------------------------------------
-- Textos entre comillas (sin saltos de línea) que mencionen barbería/barbero,
-- salvo las variables viejas {barbero} y {barberia} que wa_render sigue aceptando
-- y la clave interna del candado de agenda (reservalope.barbero:)
select qa.ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral regexp_matches(p.prosrc, E'''([^''\\n]*(?:barber[íi]a|barbero|Barbero)[^''\\n]*)''', 'g') m
    where n.nspname in ('public', 'private') and m[1] !~ '^\{barber(o|ia)\}$'
      and m[1] <> 'reservalope.barbero:'),
  'Ninguna función tiene mensajes con "barbería" / "barbero"');
select qa.ok((select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
              from pg_proc p where p.oid in (select fn::regprocedure from qa.acl)),
  'Funciones reescritas siguen SECURITY DEFINER con search_path vacío');
select qa.ok((select bool_and(coalesce(p.proacl::text, '') = a.acl)
              from qa.acl a join pg_proc p on p.oid = a.fn::regprocedure),
  'Funciones reescritas conservan sus permisos');

select qa.server();
set role service_role;
select qa.err($q$select public.crear_reserva('golden', qa.id('s30'), null, qa.d(4), '11:00', 'Ana Pérez', '987654321')$q$,
  '^Elige un profesional\.$', 'crear_reserva: "Elige un profesional."');
select qa.err($q$select public.crear_reserva('no-existe', qa.id('s30'), qa.id('b1'), qa.d(4), '11:00', 'Ana Pérez', '987654321')$q$,
  '^Este negocio no está disponible\.$', 'crear_reserva: "Este negocio no está disponible."');
reset role; select qa.nadie();
update public.tenants set status = 'SUSPENDED' where id = qa.id('tA');
select qa.server();
set role service_role;
select qa.err($q$select public.crear_reserva('golden', qa.id('s30'), qa.id('b1'), qa.d(4), '11:00', 'Ana Pérez', '987654321')$q$,
  '^Este negocio no está recibiendo reservas', 'crear_reserva: negocio pausado con texto neutro');
reset role; select qa.nadie();
update public.tenants set status = 'ACTIVE' where id = qa.id('tA');

select qa.err($q$insert into public.appointments (tenant_id, customer_name, service_id, barber_id, date, time)
                 values (qa.id('tA'), 'X', qa.id('s30'), qa.id('bB'), qa.d(4), '11:00')$q$,
  '^Ese profesional no está disponible\.$', 'Cita con profesional de otro negocio: texto neutro');
select qa.err($q$update public.appointments set tenant_id = qa.id('tB') where customer_name = 'Ana Pérez'$q$,
  '^Una cita no puede cambiar de negocio\.$', 'Cita no cambia de negocio: texto neutro');
select qa.err($q$insert into public.barbers (tenant_id, name) values (qa.id('tA'), 'carlos')$q$,
  '^Ya existe un profesional llamado "carlos"', 'Nombre repetido: texto neutro');

select qa.login(qa.id('super'));
select qa.err($q$select private.tenant_for_admin(null, 'settings')$q$,
  '^Indica el negocio\.$', 'tenant_for_admin: "Indica el negocio."');
select qa.login(qa.id('staffA'));
set role authenticated;
select qa.err($q$update public.profiles set barber_id = null where id = qa.id('staffA')$q$,
  'vínculo de profesional', 'profiles_guard: texto neutro');
reset role; select qa.nadie();

-- Reserva completa sigue funcionando
select qa.server();
set role service_role;
select qa.ok((public.crear_reserva('golden', qa.id('s30'), qa.id('b1'), qa.d(4), '11:00', 'Luis Rojas', '912345678')) is not null,
  'crear_reserva sigue funcionando');
reset role; select qa.nadie();

\echo '=== rubros_11: todas las pruebas pasaron ==='
