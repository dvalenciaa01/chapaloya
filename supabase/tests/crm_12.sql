-- ==========================================================================
-- Pruebas de la migración 12 (CRM personalizable)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 11 aplicadas (SIN la 12). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/crm_12.sql
-- El script:
--   1. Carga un negocio con un cliente y una cita (datos de antes de la 12).
--   2. Aplica la migración 12 (dos veces: es repetible).
--   3. Prueba crm_config, quién la cambia, campos de clientes, extra,
--      web_barberia (booking_fields) y crear_reserva con p_extra.
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
-- 1. Datos previos (con migraciones 1–11)
-- --------------------------------------------------------------------------
insert into qa.ids values
  ('tA', gen_random_uuid()), ('tB', gen_random_uuid()),
  ('super', gen_random_uuid()), ('adminA', gen_random_uuid()), ('staffA', gen_random_uuid()),
  ('b1', gen_random_uuid()), ('s30', gen_random_uuid()), ('c1', gen_random_uuid()),
  ('a1', gen_random_uuid());

insert into public.tenants (id, slug, name, address, schedule, business_type) values
  (qa.id('tA'), 'clinica', 'Clínica Sonrisa', 'Av. Arequipa 100',
   jsonb_build_object('interval', 30, 'maxDays', 60,
     'week', (select jsonb_object_agg(d::text, '[["00:00","23:30"]]'::jsonb) from generate_series(0, 6) d)),
   'dental'),
  (qa.id('tB'), 'otra', 'Otro Negocio', '',
   jsonb_build_object('interval', 30, 'maxDays', 60,
     'week', (select jsonb_object_agg(d::text, '[["00:00","23:30"]]'::jsonb) from generate_series(0, 6) d)),
   'barberia');

insert into auth.users (id, email, encrypted_password)
select id, k || '@x.pe', 'hash-' || k from qa.ids where k in ('super', 'adminA', 'staffA');

insert into public.barbers (id, tenant_id, name) values (qa.id('b1'), qa.id('tA'), 'Dra. Ruiz');
insert into public.services (id, tenant_id, name, duration_min, price, active) values
  (qa.id('s30'), qa.id('tA'), 'Limpieza', 30, 80, true);
insert into public.profiles (id, email, name, role, tenant_id, barber_id, must_change_password, grants) values
  (qa.id('super'), 'super@x.pe', 'Super', 'SUPERADMIN', null, null, false, default),
  (qa.id('adminA'), 'adminA@x.pe', 'Admin A', 'ADMIN', qa.id('tA'), null, false, default),
  (qa.id('staffA'), 'staffA@x.pe', 'Staff A', 'STAFF', qa.id('tA'), qa.id('b1'), false, default);
insert into public.customers (id, tenant_id, name, phone) values
  (qa.id('c1'), qa.id('tA'), 'Ana Pérez', '987654321');
insert into public.appointments (id, tenant_id, customer_id, customer_name, phone, service_id, barber_id, date, time)
values (qa.id('a1'), qa.id('tA'), qa.id('c1'), 'Ana Pérez', '987654321', qa.id('s30'), qa.id('b1'), qa.d(3), '10:00');

-- --------------------------------------------------------------------------
-- 2. Aplicar la migración 12 (dos veces)
-- --------------------------------------------------------------------------
\ir ../migrations/20261022000012_crm_personalizable.sql
\ir ../migrations/20261022000012_crm_personalizable.sql

-- --------------------------------------------------------------------------
-- 3. Columnas nuevas y valores por defecto
-- --------------------------------------------------------------------------
select qa.ok((select bool_and(crm_config = '{}'::jsonb) from public.tenants),
  'MIGR: negocios existentes quedan con crm_config {} (CRM como hoy)');
select qa.ok((select email is null and birthdate is null and document is null and address is null
                     and extra = '{}'::jsonb from public.customers where id = qa.id('c1')),
  'MIGR: cliente existente con email/birthdate/document/address null y extra {}');
select qa.ok((select extra = '{}'::jsonb from public.appointments where id = qa.id('a1')),
  'MIGR: cita existente con extra {}');
select qa.ok((select count(*) = 1 from pg_proc where proname = 'crear_reserva' and pronamespace = 'public'::regnamespace),
  'Solo existe una crear_reserva (la de 10 argumentos)');
select qa.ok(to_regprocedure('public.crear_reserva(text,uuid,uuid,date,time,text,text,text,boolean,jsonb)') is not null,
  'Firma nueva crear_reserva(..., p_extra jsonb)');
select qa.ok((select bool_and(attnotnull) from pg_attribute
              where (attrelid, attname) in (('public.tenants'::regclass, 'crm_config'),
                                            ('public.customers'::regclass, 'extra'),
                                            ('public.appointments'::regclass, 'extra'))),
  'crm_config y extra son NOT NULL');

-- --------------------------------------------------------------------------
-- 4. Forma de crm_config
-- --------------------------------------------------------------------------
create table qa.ejemplo (c jsonb);
grant select on qa.ejemplo to public;
insert into qa.ejemplo values ($j${
  "modules": { "dashboard": true, "appointments": true, "walkin": true, "customers": true,
               "services": true, "staff": true, "sales": true, "reports": false,
               "whatsapp": true, "audit": false },
  "fields": {
    "appointments": { "phone": {"show": true, "required": true}, "notes": {"show": true},
                      "price": {"show": false}, "source": {"show": true} },
    "customers":    { "phone": {"show": true, "required": false}, "email": {"show": true},
                      "birthdate": {"show": true}, "document": {"show": true},
                      "address": {"show": false}, "notes": {"show": true} },
    "services":     { "category": {"show": true}, "description": {"show": true},
                      "duration": {"show": true}, "featured": {"show": false} },
    "staff":        { "role": {"show": true}, "photo": {"show": true}, "bio": {"show": true},
                      "gallery": {"show": false} }
  },
  "customFields": {
    "customers":    [ {"key": "alergias", "label": "Alergias", "type": "text", "required": false,
                       "showInList": true} ],
    "appointments": [ {"key": "motivo", "label": "Motivo de la consulta", "type": "select",
                       "options": ["Control", "Dolor", "Otro"], "required": true,
                       "showInList": true, "public": true},
                      {"key": "pieza", "label": "Pieza dental", "type": "number", "public": true},
                      {"key": "interno", "label": "Nota interna", "type": "textarea", "showInList": false},
                      {"key": "ultima_visita", "label": "Última visita", "type": "date", "public": true},
                      {"key": "acepta", "label": "Acepto el consentimiento", "type": "checkbox",
                       "required": true, "public": true},
                      {"key": "seguro", "label": "Seguro", "type": "text", "public": false} ]
  },
  "theme": { "mode": "dark", "primary": "#C9A24B", "accent": null, "font": "barlow",
             "density": "comfortable", "radius": "soft", "logoInNav": true },
  "lists": { "appointments": { "columns": ["date", "time", "client", "x:motivo", "service", "staff",
                                           "status", "x:pieza"] } },
  "site": { "heroTitle": "Tu sonrisa, en buenas manos", "heroSubtitle": "Odontología general y estética en Miraflores.",
            "heroImage": "https://abcd1234.supabase.co/storage/v1/object/public/media/tenants/clinica/portada.jpg" }
}$j$);

select qa.ok(private.crm_config_valida((select c from qa.ejemplo)), 'crm_config: ejemplo completo es válido');
select qa.ok(private.crm_config_valida('{}'), 'crm_config: {} es válido');
select qa.ok(private.crm_config_valida('{"modules":{},"fields":{},"customFields":{},"theme":{}}'),
  'crm_config: secciones vacías son válidas');
select qa.ok(private.crm_config_valida('{"modules":{"settings":true}}'), 'crm_config: settings true se acepta');
select qa.ok(private.crm_config_valida('{"theme":{"mode":"auto","primary":null,"font":"system","density":"compact","radius":"round"}}'),
  'crm_config: tema auto/system/compact/round');
select qa.ok(private.crm_config_valida('{"theme":{"mode":"light","font":"inter","radius":"sharp","logoInNav":false}}')
             and private.crm_config_valida('{"theme":{"font":"jakarta"}}'),
  'crm_config: tema light/inter/jakarta/sharp');
select qa.ok(private.crm_config_valida(jsonb_build_object('customFields', jsonb_build_object('customers',
               (select jsonb_agg(jsonb_build_object('key', 'c' || n, 'label', 'Campo ' || n, 'type', 'text'))
                from generate_series(1, 12) n)))),
  'crm_config: 12 campos propios por entidad');
select qa.ok(private.crm_config_valida(jsonb_build_object('customFields', jsonb_build_object('appointments',
               jsonb_build_array(jsonb_build_object('key', 'ab', 'label', repeat('ñ', 40), 'type', 'select',
                 'options', (select jsonb_agg(repeat('x', 39) || n) from generate_series(0, 9) n)
                            || (select jsonb_agg('o' || n) from generate_series(1, 10) n)))))),
  'crm_config: label de 40, 20 opciones de hasta 40');
select qa.ok(private.crm_config_valida('{"lists":{"appointments":{"columns":["date","time","client","phone","service","staff","price","status","source","notes"]}}}'),
  'lists: las 10 columnas estándar');
select qa.ok(private.crm_config_valida('{"lists":{}}') and private.crm_config_valida('{"lists":{"appointments":{}}}'),
  'lists: vacío = columnas de siempre');
select qa.ok(private.crm_config_valida('{"site":{"heroTitle":null,"heroSubtitle":null,"heroImage":null}}')
             and private.crm_config_valida('{"site":{}}'),
  'site: null o vacío = portada de siempre');
select qa.ok(private.crm_config_valida(jsonb_build_object('site', jsonb_build_object(
               'heroTitle', repeat('á', 80), 'heroSubtitle', repeat('b', 200),
               'heroImage', 'https://cdn.ejemplo.pe/' || repeat('c', 477)))),
  'site: título de 80, subtítulo de 200 e imagen de 500');
select qa.ok(private.crm_config_valida('{"customFields":{"customers":[{"key":"a1","label":"X","type":"text","options":null}]}}'),
  'crm_config: options null en un campo que no es select se acepta');

create table qa.malas (c jsonb, why text);
insert into qa.malas values
  ('[]', 'no es objeto'),
  ('null', 'null JSON'),
  ('{"otra":1}', 'clave raíz desconocida'),
  ('{"modules":[]}', 'modules no es objeto'),
  ('{"modules":{"ventas":true}}', 'módulo desconocido'),
  ('{"modules":{"sales":"no"}}', 'módulo no booleano'),
  ('{"modules":{"settings":false}}', 'settings no se puede ocultar'),
  ('{"fields":{"walkin":{}}}', 'fields: entidad desconocida'),
  ('{"fields":{"customers":{"dni":{"show":true}}}}', 'fields: campo desconocido'),
  ('{"fields":{"customers":{"email":true}}}', 'fields: campo no es objeto'),
  ('{"fields":{"customers":{"email":{"show":"si"}}}}', 'fields: show no booleano'),
  ('{"fields":{"customers":{"email":{"show":true,"color":"red"}}}}', 'fields: clave desconocida en campo'),
  ('{"fields":{"customers":{"email":{"show":true,"required":true}}}}', 'fields: required donde no aplica'),
  ('{"fields":{"appointments":{"notes":{"required":true}}}}', 'fields: required en notas de cita'),
  ('{"fields":{"appointments":{"phone":{"required":"si"}}}}', 'fields: required no booleano'),
  ('{"customFields":{"staff":[]}}', 'customFields: entidad desconocida'),
  ('{"customFields":{"customers":{}}}', 'customFields: no es arreglo'),
  ('{"customFields":{"customers":[1]}}', 'customFields: elemento no es objeto'),
  ('{"customFields":{"customers":[{"key":"Alergias","label":"A","type":"text"}]}}', 'key con mayúscula'),
  ('{"customFields":{"customers":[{"key":"a","label":"A","type":"text"}]}}', 'key de 1 carácter'),
  ('{"customFields":{"customers":[{"key":"1abc","label":"A","type":"text"}]}}', 'key empieza con número'),
  ('{"customFields":{"customers":[{"key":"a-b","label":"A","type":"text"}]}}', 'key con guion'),
  ('{"customFields":{"customers":[{"key":"abcdefghijabcdefghijabcdefghijx","label":"A","type":"text"}]}}', 'key de 31'),
  ('{"customFields":{"customers":[{"label":"A","type":"text"}]}}', 'sin key'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A","type":"text"},{"key":"ab","label":"B","type":"text"}]}}', 'key repetida'),
  ('{"customFields":{"customers":[{"key":"ab","type":"text"}]}}', 'sin label'),
  ('{"customFields":{"customers":[{"key":"ab","label":"","type":"text"}]}}', 'label vacío'),
  ('{"customFields":{"customers":[{"key":"ab","label":"   ","type":"text"}]}}', 'label solo espacios'),
  ('{"customFields":{"customers":[{"key":"ab","label":"<b>","type":"text"}]}}', 'label con < >'),
  ('{"customFields":{"customers":[{"key":"ab","label":"el \"x\"","type":"text"}]}}', 'label con comillas'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A"}]}}', 'sin type'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A","type":"email"}]}}', 'type desconocido'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A","type":"select"}]}}', 'select sin options'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A","type":"select","options":[]}]}}', 'select con 0 opciones'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A","type":"select","options":[""]}]}}', 'opción vacía'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A","type":"select","options":[3]}]}}', 'opción no texto'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A","type":"text","options":["x"]}]}}', 'options en un text'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A","type":"text","required":"no"}]}}', 'required no booleano'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A","type":"text","showInList":1}]}}', 'showInList no booleano'),
  ('{"customFields":{"customers":[{"key":"ab","label":"A","type":"text","public":true}]}}', 'public en clientes'),
  ('{"customFields":{"appointments":[{"key":"ab","label":"A","type":"text","public":"si"}]}}', 'public no booleano'),
  ('{"customFields":{"appointments":[{"key":"ab","label":"A","type":"text","orden":1}]}}', 'clave desconocida en campo propio'),
  ('{"theme":[]}', 'theme no es objeto'),
  ('{"theme":{"mode":"neon"}}', 'mode desconocido'),
  ('{"theme":{"primary":"#FFF"}}', 'primary corto'),
  ('{"theme":{"primary":"rojo"}}', 'primary no hex'),
  ('{"theme":{"accent":"#12345G"}}', 'accent no hex'),
  ('{"theme":{"font":"comic"}}', 'font desconocida'),
  ('{"theme":{"density":"tight"}}', 'density desconocida'),
  ('{"theme":{"radius":"pill"}}', 'radius desconocido'),
  ('{"theme":{"logoInNav":"si"}}', 'logoInNav no booleano'),
  ('{"theme":{"fondo":"#000000"}}', 'clave de tema desconocida'),
  ('{"lists":[]}', 'lists no es objeto'),
  ('{"lists":{"customers":{"columns":["name"]}}}', 'lists: entidad desconocida'),
  ('{"lists":{"appointments":{"columns":["date"],"orden":"asc"}}}', 'lists: clave desconocida'),
  ('{"lists":{"appointments":{"columns":"date,time"}}}', 'lists: columns no es arreglo'),
  ('{"lists":{"appointments":{"columns":[]}}}', 'lists: 0 columnas'),
  ('{"lists":{"appointments":{"columns":["date","fecha"]}}}', 'lists: columna desconocida'),
  ('{"lists":{"appointments":{"columns":["date","date"]}}}', 'lists: columna repetida'),
  ('{"lists":{"appointments":{"columns":["date",1]}}}', 'lists: columna no texto'),
  ('{"lists":{"appointments":{"columns":["date","x:motivo"]}}}', 'lists: x: de un campo que no existe'),
  ('{"customFields":{"customers":[{"key":"motivo","label":"M","type":"text"}]},"lists":{"appointments":{"columns":["x:motivo"]}}}',
   'lists: x: de un campo de clientes'),
  ('{"site":[]}', 'site no es objeto'),
  ('{"site":{"logo":"x"}}', 'site: clave desconocida'),
  ('{"site":{"heroTitle":""}}', 'site: título vacío (usar null)'),
  ('{"site":{"heroTitle":"<script>"}}', 'site: título con < >'),
  ('{"site":{"heroSubtitle":"el \"mejor\""}}', 'site: subtítulo con comillas'),
  ('{"site":{"heroTitle":5}}', 'site: título no texto'),
  ('{"site":{"heroImage":"http://x.pe/a.jpg"}}', 'site: imagen sin https'),
  ('{"site":{"heroImage":"javascript:alert(1)"}}', 'site: imagen javascript:'),
  ('{"site":{"heroImage":"https://x.pe/a b.jpg"}}', 'site: imagen con espacio'),
  ('{"site":{"heroImage":"https://x.pe/a\".jpg"}}', 'site: imagen con comillas'),
  ('{"site":{"heroImage":"https:///a.jpg"}}', 'site: imagen sin dominio');
insert into qa.malas
select jsonb_build_object('lists', jsonb_build_object('appointments', jsonb_build_object('columns',
         '["date","time","client","phone","service","staff","price","status","source","notes"]'::jsonb
         || '["x:motivo","x:pieza","x:interno"]'::jsonb)), 'customFields', (select c -> 'customFields' from qa.ejemplo)),
       'lists: 13 columnas';
insert into qa.malas values
  (jsonb_build_object('site', jsonb_build_object('heroTitle', repeat('a', 81))), 'site: título de 81'),
  (jsonb_build_object('site', jsonb_build_object('heroSubtitle', repeat('a', 201))), 'site: subtítulo de 201'),
  (jsonb_build_object('site', jsonb_build_object('heroImage', 'https://cdn.ejemplo.pe/' || repeat('c', 478))), 'site: imagen de 501');
insert into qa.malas
select jsonb_build_object('customFields', jsonb_build_object('customers',
         (select jsonb_agg(jsonb_build_object('key', 'c' || n, 'label', 'C', 'type', 'text')) from generate_series(1, 13) n))),
       '13 campos propios';
insert into qa.malas
select jsonb_build_object('customFields', jsonb_build_object('appointments', jsonb_build_array(
         jsonb_build_object('key', 'ab', 'label', repeat('a', 41), 'type', 'text')))), 'label de 41';
insert into qa.malas
select jsonb_build_object('customFields', jsonb_build_object('appointments', jsonb_build_array(
         jsonb_build_object('key', 'ab', 'label', 'A', 'type', 'select',
           'options', (select jsonb_agg('o' || n) from generate_series(1, 21) n))))), '21 opciones';
insert into qa.malas
select jsonb_build_object('customFields', jsonb_build_object('appointments', jsonb_build_array(
         jsonb_build_object('key', 'ab', 'label', 'A', 'type', 'select', 'options', jsonb_build_array(repeat('o', 41)))))),
       'opción de 41';

select qa.ok(not exists (select 1 from qa.malas where private.crm_config_valida(c)),
  'crm_config: ' || (select count(*) from qa.malas) || ' formas inválidas rechazadas');
do $$
declare r record;
begin
  for r in select * from qa.malas where private.crm_config_valida(c) loop
    raise notice 'ACEPTADA (no debía): % → %', r.why, r.c;
  end loop;
end $$;
select qa.err($q$update public.tenants set crm_config = '{"modules":{"ventas":true}}' where id = qa.id('tA')$q$,
  'tenants_crm_config_valid', 'CHECK de tenants rechaza crm_config inválida');

-- --------------------------------------------------------------------------
-- 5. Quién cambia crm_config
-- --------------------------------------------------------------------------
select qa.login(qa.id('adminA'));
set role authenticated;
select qa.err($q$update public.tenants set crm_config = '{"theme":{"mode":"light"}}' where id = qa.id('tA')$q$,
  'Solo el superadministrador puede personalizar el CRM', 'ADMIN con Configuración NO cambia crm_config');
update public.tenants set name = 'Clínica Sonrisa Feliz' where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select name = 'Clínica Sonrisa Feliz' and crm_config = '{}'::jsonb from public.tenants where id = qa.id('tA')),
  'ADMIN sigue cambiando el resto de su negocio');

select qa.login(qa.id('staffA'));
set role authenticated;
update public.tenants set crm_config = '{"theme":{"mode":"light"}}' where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select crm_config = '{}'::jsonb from public.tenants where id = qa.id('tA')), 'STAFF no cambia crm_config');

select qa.login(qa.id('staffA'));
select qa.err($q$update public.tenants set crm_config = '{"theme":{"mode":"light"}}' where id = qa.id('tA')$q$,
  'personalizar el CRM', 'tenants_guard: STAFF no cambia crm_config (aunque RLS lo dejara)');
select qa.nadie();

select qa.login(qa.id('super'));
set role authenticated;
update public.tenants set crm_config = (select c from qa.ejemplo) where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select crm_config = (select c from qa.ejemplo) from public.tenants where id = qa.id('tA')),
  'SUPERADMIN cambia crm_config');

select qa.server();
update public.tenants set crm_config = '{"theme":{"mode":"auto"}}' where id = qa.id('tB');
select qa.nadie();
select qa.ok((select crm_config -> 'theme' ->> 'mode' = 'auto' from public.tenants where id = qa.id('tB')),
  'Servidor (secret key) cambia crm_config');

select qa.login(qa.id('adminA'));
set role authenticated;
select qa.ok((select crm_config -> 'theme' ->> 'primary' = '#C9A24B' from public.tenants where id = qa.id('tA')),
  'ADMIN lee crm_config de su negocio (para aplicarla)');
reset role; select qa.nadie();
select qa.login(qa.id('staffA'));
set role authenticated;
select qa.ok((select jsonb_array_length(crm_config -> 'customFields' -> 'appointments') = 6
              from public.tenants where id = qa.id('tA')),
  'STAFF lee crm_config de su negocio');
reset role; select qa.nadie();

-- --------------------------------------------------------------------------
-- 6. Campos nuevos de clientes y extra
-- --------------------------------------------------------------------------
select qa.login(qa.id('adminA'));
set role authenticated;
update public.customers
   set email = 'ana.perez@correo.pe', birthdate = '1990-05-17', document = '45678912',
       address = 'Jr. Las Flores 123, Miraflores', extra = '{"alergias":"Penicilina","hijos":2,"vip":true}'
 where id = qa.id('c1');
reset role; select qa.nadie();
select qa.ok((select email = 'ana.perez@correo.pe' and birthdate = '1990-05-17' and document = '45678912'
                     and address like 'Jr. Las Flores%' and extra ->> 'alergias' = 'Penicilina'
              from public.customers where id = qa.id('c1')),
  'ADMIN guarda email, nacimiento, documento, dirección y extra del cliente');
update public.customers set document = '20123456789', email = 'x@y.co' where id = qa.id('c1');
update public.customers set document = 'CE-001234' where id = qa.id('c1');
select qa.ok(true, 'Documento RUC (11) y CE con guion aceptados');
update public.customers set email = null, birthdate = null, document = null, address = null where id = qa.id('c1');
select qa.ok(true, 'Campos nuevos vuelven a null');

select qa.err($q$update public.customers set email = 'ana@' where id = qa.id('c1')$q$, 'customers_email_valid', 'email sin dominio');
select qa.err($q$update public.customers set email = '' where id = qa.id('c1')$q$, 'customers_email_valid', 'email vacío (usar null)');
select qa.err($q$update public.customers set email = 'a b@c.pe' where id = qa.id('c1')$q$, 'customers_email_valid', 'email con espacio');
select qa.err(format($q$update public.customers set email = %L where id = qa.id('c1')$q$, repeat('a', 116) || '@c.pe'),
  'customers_email_valid', 'email de 121 caracteres');
select qa.err($q$update public.customers set document = '12345678901234567890X' where id = qa.id('c1')$q$,
  'customers_document_valid', 'documento de 21');
select qa.err($q$update public.customers set document = '4567 8912' where id = qa.id('c1')$q$,
  'customers_document_valid', 'documento con espacio');
select qa.err(format($q$update public.customers set address = %L where id = qa.id('c1')$q$, repeat('a', 161)),
  'customers_address_valid', 'dirección de 161');
select qa.err($q$update public.customers set birthdate = '1800-01-01' where id = qa.id('c1')$q$,
  'customers_birthdate_valid', 'nacimiento antes de 1900');

select qa.ok(private.extra_valido('{}') and private.extra_valido(jsonb_build_object('ab', repeat('x', 500), 'num', 1.5, 'si_no', false)),
  'extra: texto de 500, número y booleano');
select qa.err($q$update public.customers set extra = '[]' where id = qa.id('c1')$q$, 'customers_extra_valid', 'extra: arreglo');
select qa.err($q$update public.customers set extra = '{"ab":{"x":1}}' where id = qa.id('c1')$q$, 'customers_extra_valid', 'extra: objeto anidado');
select qa.err($q$update public.customers set extra = '{"ab":[1]}' where id = qa.id('c1')$q$, 'customers_extra_valid', 'extra: arreglo como valor');
select qa.err($q$update public.customers set extra = '{"ab":null}' where id = qa.id('c1')$q$, 'customers_extra_valid', 'extra: null como valor');
select qa.err($q$update public.customers set extra = '{"Ab":"x"}' where id = qa.id('c1')$q$, 'customers_extra_valid', 'extra: clave inválida');
select qa.err(format($q$update public.customers set extra = jsonb_build_object('ab', %L) where id = qa.id('c1')$q$, repeat('x', 501)),
  'customers_extra_valid', 'extra: texto de 501');
select qa.err($q$update public.customers set extra = (select jsonb_object_agg('k' || n, repeat('x', 400)) from generate_series(1, 25) n)
                 where id = qa.id('c1')$q$,
  'customers_extra_valid', 'extra: más de 8 KB');
select qa.err($q$update public.customers set extra = null where id = qa.id('c1')$q$, 'null value', 'extra: null de SQL');

-- --------------------------------------------------------------------------
-- 7. appointments.extra: el personal también lo cambia
-- --------------------------------------------------------------------------
select qa.login(qa.id('staffA'));
set role authenticated;
update public.appointments set extra = '{"motivo":"Dolor","interno":"Sensibilidad en 36"}' where id = qa.id('a1');
reset role; select qa.nadie();
select qa.ok((select extra ->> 'interno' = 'Sensibilidad en 36' from public.appointments where id = qa.id('a1')),
  'STAFF cambia appointments.extra de su cita');

select qa.login(qa.id('staffA'));
set role authenticated;
select qa.err($q$update public.appointments set price = 1 where id = qa.id('a1')$q$,
  'El personal solo puede cambiar el estado, las notas, los datos propios y la fecha u hora de la cita',
  'STAFF sigue sin cambiar el precio (mensaje menciona los datos propios)');
reset role; select qa.nadie();

select qa.login(qa.id('adminA'));
set role authenticated;
update public.appointments set extra = extra || '{"pieza":36}' where id = qa.id('a1');
reset role; select qa.nadie();
select qa.ok((select extra ->> 'pieza' = '36' from public.appointments where id = qa.id('a1')),
  'ADMIN cambia appointments.extra');
select qa.err($q$update public.appointments set extra = '{"ab":{"x":1}}' where id = qa.id('a1')$q$,
  'appointments_extra_valid', 'appointments.extra inválido rechazado');

-- --------------------------------------------------------------------------
-- 8. Web pública: booking_fields
-- --------------------------------------------------------------------------
set role anon;
select qa.ok((select j -> 'booking_fields' = $j$[
    {"key":"motivo","label":"Motivo de la consulta","type":"select","options":["Control","Dolor","Otro"],"required":true},
    {"key":"pieza","label":"Pieza dental","type":"number","options":[],"required":false},
    {"key":"ultima_visita","label":"Última visita","type":"date","options":[],"required":false},
    {"key":"acepta","label":"Acepto el consentimiento","type":"checkbox","options":[],"required":true}
  ]$j$::jsonb
  from (select public.web_barberia('clinica') j) x),
  'web_barberia: booking_fields = solo campos públicos, en orden, con key/label/type/options/required');
select qa.ok((select j ->> 'booking_fields' = '[]' and not (j ? 'crm_config') and not (j -> 'tenant' ? 'crm_config')
              from (select public.web_barberia('otra') j) x),
  'web_barberia: sin campos públicos = [] y no expone crm_config');
select qa.ok((select position('Nota interna' in j::text) = 0 and position('Seguro' in j::text) = 0
                     and position('showInList' in j::text) = 0 and position('#C9A24B' in j::text) = 0
              from (select public.web_barberia('clinica') j) x),
  'web_barberia: no aparecen campos privados, showInList ni el tema');
select qa.ok((select j -> 'site' = (select c -> 'site' from qa.ejemplo) and j -> 'tenant' -> 'site' = j -> 'site'
              from (select public.web_barberia('clinica') j) x),
  'web_barberia: site (portada) en la raíz y en tenant');
select qa.ok((select j -> 'site' = '{"heroTitle":null,"heroSubtitle":null,"heroImage":null}'::jsonb
                     and j -> 'tenant' -> 'site' = j -> 'site'
              from (select public.web_barberia('otra') j) x),
  'web_barberia: sin portada propia = site con las tres claves en null');
select qa.ok((select jsonb_array_length(j -> 'barbers') = 1 and j ->> 'business_type' = 'dental'
              from (select public.web_barberia('clinica') j) x),
  'web_barberia conserva lo demás (barbers, business_type)');
reset role;

-- --------------------------------------------------------------------------
-- 9. crear_reserva con p_extra
-- --------------------------------------------------------------------------
select qa.ok(not has_function_privilege('anon', 'public.crear_reserva(text,uuid,uuid,date,time,text,text,text,boolean,jsonb)', 'execute')
             and not has_function_privilege('authenticated', 'public.crear_reserva(text,uuid,uuid,date,time,text,text,text,boolean,jsonb)', 'execute')
             and has_function_privilege('service_role', 'public.crear_reserva(text,uuid,uuid,date,time,text,text,text,boolean,jsonb)', 'execute'),
  'crear_reserva: solo service_role la ejecuta');
select qa.ok(has_function_privilege('anon', 'public.web_barberia(text)', 'execute'), 'web_barberia: anon la ejecuta');

select qa.server();
set role service_role;
create temp table r (j jsonb);

select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601')$q$,
  '^Completa "Motivo de la consulta"\.$', 'Sin p_extra: exige el select obligatorio');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Dolor"}')$q$,
  '^Marca "Acepto el consentimiento"\.$', 'Checkbox obligatorio ausente');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Dolor","acepta":false}')$q$,
  '^Marca "Acepto el consentimiento"\.$', 'Checkbox obligatorio en false');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"   ","acepta":true}')$q$,
  '^Completa "Motivo', 'Obligatorio solo con espacios');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Muela","acepta":true}')$q$,
  '^Elige una opción de "Motivo', 'Select fuera de las opciones');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Dolor","acepta":true,"interno":"x"}')$q$,
  'Recarga la página', 'Clave de un campo privado rechazada');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Dolor","acepta":true,"inventado":"x"}')$q$,
  'Recarga la página', 'Clave desconocida rechazada');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Dolor","acepta":true,"pieza":"treinta"}')$q$,
  'debe ser un número', 'Número inválido');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Dolor","acepta":true,"pieza":true}')$q$,
  'debe ser un número', 'Número booleano');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Dolor","acepta":true,"ultima_visita":"2026-02-30"}')$q$,
  'fecha válida', 'Fecha imposible');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Dolor","acepta":true,"ultima_visita":"17/05/2026"}')$q$,
  'fecha válida', 'Fecha en otro formato');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Dolor","acepta":"si"}')$q$,
  '^Revisa "Acepto', 'Checkbox que no es booleano');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '["Dolor"]')$q$,
  '^Revisa los datos de tu reserva', 'p_extra que no es objeto');
select qa.ok((select count(*) = 0 from public.appointments where phone = '912345601'),
  'Ninguna reserva inválida quedó guardada');

insert into r select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '09:00', 'Luis Rojas', '912345601',
                 p_extra => '{"motivo":"Dolor","acepta":true,"pieza":"36","ultima_visita":"2026-05-17","otra":null}'::jsonb - 'otra');
select qa.ok((select extra = '{"motivo":"Dolor","acepta":true,"pieza":36,"ultima_visita":"2026-05-17"}'::jsonb
              from public.appointments where code = (select j ->> 'code' from r)),
  'Reserva válida guarda extra limpio (número de texto → número)');
select qa.ok((select j ?& array['id', 'code', 'date', 'time', 'service', 'barber'] from r),
  'crear_reserva devuelve id, code, date, time, service, barber');

insert into r select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '10:00', 'Rosa Díaz', '912345602',
                 null, false, '{"motivo":"Control","acepta":true,"pieza":"","ultima_visita":null}');
select qa.ok((select extra = '{"motivo":"Control","acepta":true}'::jsonb from public.appointments where phone = '912345602'),
  'Opcionales vacíos o null no se guardan');

-- Negocio sin campos propios: la reserva funciona igual que antes
update public.tenants set crm_config = '{}' where id = qa.id('tA');
insert into r select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '11:00', 'Pedro Soto', '912345603');
select qa.ok((select extra = '{}'::jsonb from public.appointments where phone = '912345603'),
  'Sin booking_fields: crear_reserva sin p_extra guarda extra {}');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '12:00', 'Pedro Soto', '912345604',
                 p_extra => '{"motivo":"Dolor"}')$q$,
  'Recarga la página', 'Sin booking_fields: cualquier clave se rechaza');
insert into r select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '12:00', 'Pedro Soto', '912345604',
                 p_extra => 'null');
select qa.ok((select extra = '{}'::jsonb from public.appointments where phone = '912345604'), 'p_extra JSON null = {}');

-- Texto: recorta espacios y máximo 500
update public.tenants set crm_config = '{"customFields":{"appointments":[{"key":"comentario","label":"Comentario","type":"textarea","public":true}]}}'
 where id = qa.id('tA');
select qa.err(format($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '13:00', 'Eva Luna', '912345605',
                 p_extra => jsonb_build_object('comentario', %L))$q$, repeat('x', 501)),
  'no puede pasar de 500', 'Texto de 501 rechazado');
select qa.err($q$select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '13:00', 'Eva Luna', '912345605',
                 p_extra => '{"comentario":5}')$q$,
  '^Revisa "Comentario"', 'Texto que no es texto');
insert into r select public.crear_reserva('clinica', qa.id('s30'), qa.id('b1'), qa.d(5), '13:00', 'Eva Luna', '912345605',
                 p_extra => jsonb_build_object('comentario', '  ' || repeat('x', 500) || '  '));
select qa.ok((select char_length(extra ->> 'comentario') = 500 from public.appointments where phone = '912345605'),
  'Texto de 500 (con espacios alrededor) se guarda recortado');
reset role; select qa.nadie();

-- --------------------------------------------------------------------------
-- 10. Palabras: "turno / turnos" para la cita (tenants.labels, migración 11)
-- --------------------------------------------------------------------------
select qa.login(qa.id('adminA'));
set role authenticated;
update public.tenants set labels = '{"appointment":"turno","appointmentPlural":"turnos"}' where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select labels = '{"appointment":"turno","appointmentPlural":"turnos"}'::jsonb from public.tenants where id = qa.id('tA')),
  'labels acepta appointment y appointmentPlural (turno / turnos)');
set role anon;
select qa.ok((select j -> 'labels' ->> 'appointmentPlural' = 'turnos' from (select public.web_barberia('clinica') j) x),
  'web_barberia devuelve las palabras de la cita');
reset role;

-- --------------------------------------------------------------------------
-- 11. Repaso general
-- --------------------------------------------------------------------------
select qa.ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral regexp_matches(p.prosrc, E'''([^''\\n]*(?:barber[íi]a|barbero|Barbero)[^''\\n]*)''', 'g') m
    where n.nspname in ('public', 'private') and m[1] !~ '^\{barber(o|ia)\}$'
      and m[1] <> 'reservalope.barbero:'),
  'Ninguna función tiene mensajes con "barbería" / "barbero"');
select qa.ok((select bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
              from pg_proc p where p.oid in ('public.crear_reserva(text,uuid,uuid,date,time,text,text,text,boolean,jsonb)'::regprocedure,
                                             'public.web_barberia(text)'::regprocedure,
                                             'private.tenants_guard()'::regprocedure,
                                             'private.appointments_before()'::regprocedure)),
  'Funciones reescritas siguen SECURITY DEFINER con search_path vacío');
select qa.ok((select bool_and(not has_function_privilege('anon', p.oid, 'execute'))
              from pg_proc p where p.oid in ('private.crm_config_valida(jsonb)'::regprocedure,
                                             'private.extra_valido(jsonb)'::regprocedure,
                                             'private.booking_fields(jsonb)'::regprocedure,
                                             'private.extra_reserva(jsonb,jsonb)'::regprocedure)),
  'Funciones privadas nuevas no se ejecutan como anon');

\echo '=== crm_12: todas las pruebas pasaron ==='
