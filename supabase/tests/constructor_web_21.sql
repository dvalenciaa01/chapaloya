-- ==========================================================================
-- Pruebas de la migración 21 (constructor visual de la web)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 20 aplicadas (SIN la 21). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/constructor_web_21.sql
-- Cada prueba imprime "OK …"; la primera que falla detiene el script.
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

drop schema if exists qa cascade;
create schema qa;
grant usage on schema qa to public;
create table qa.ids (k text primary key, id uuid not null);
grant select on qa.ids to public;
create function qa.id(p text) returns uuid language sql stable as $$ select id from qa.ids where k = p $$;
create function qa.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FALLO: %', msg; end if;
  raise notice 'OK   %', msg;
end $$;
create function qa.err(q text, pat text, msg text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'FALLO (no dio error): %', msg;
exception when others then
  if sqlerrm like 'FALLO%' then raise; end if;
  if sqlerrm !~* pat then raise exception 'FALLO: % → error inesperado: %', msg, sqlerrm; end if;
  raise notice 'OK   % → "%"', msg, sqlerrm;
end $$;
create function qa.login(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false) $$;
create function qa.nadie() returns void language sql as $$ select set_config('request.jwt.claims', '', false) $$;
grant execute on all functions in schema qa to public;

insert into qa.ids values ('tA', gen_random_uuid()), ('tB', gen_random_uuid()),
  ('super', gen_random_uuid()), ('adminA', gen_random_uuid()), ('adminSin', gen_random_uuid()), ('staffA', gen_random_uuid()),
  ('b1', gen_random_uuid());
insert into public.tenants (id, slug, name) values (qa.id('tA'), 'web-21-a', 'Negocio A'), (qa.id('tB'), 'web-21-b', 'Negocio B');
insert into auth.users (id, email, encrypted_password)
select id, k || '@x.pe', 'hash' from qa.ids where k in ('super', 'adminA', 'adminSin', 'staffA');
insert into public.barbers (id, tenant_id, name) values (qa.id('b1'), qa.id('tA'), 'Ana');
insert into public.profiles (id, email, name, role, tenant_id, barber_id, must_change_password, grants) values
  (qa.id('super'), 'super@x.pe', 'Super', 'SUPERADMIN', null, null, false, default),
  (qa.id('adminA'), 'adminA@x.pe', 'Admin A', 'ADMIN', qa.id('tA'), null, false, '{"settings":true}'),
  (qa.id('adminSin'), 'adminSin@x.pe', 'Admin sin Configuración', 'ADMIN', qa.id('tA'), null, false, '{"settings":false}'),
  (qa.id('staffA'), 'staffA@x.pe', 'Staff A', 'STAFF', qa.id('tA'), qa.id('b1'), false, default);

set client_min_messages = warning;
\ir ../migrations/20261110000021_constructor_web.sql
\ir ../migrations/20261110000021_constructor_web.sql
set client_min_messages = notice;

select qa.ok((select bool_and(web_page is null and web_editor) from public.tenants),
  'MIGR: negocios existentes sin diseño (web de siempre) y con el editor permitido');
select qa.ok((public.web_barberia('web-21-a') -> 'page') = 'null'::jsonb, 'web_barberia: page null sin diseño');

-- Formas válidas
create table qa.buenas (c jsonb);
insert into qa.buenas values
  (null), ('{"blocks":[]}'),
  ('{"blocks":[{"id":"ab12","type":"portada","style":"foto-fondo","title":"Hola","text":"Texto","image":"https://x.supabase.co/storage/v1/object/public/media/a/b.webp","btn":"Reservar","btn2":"Ver"}]}'),
  ('{"blocks":[{"id":"s1s1","type":"servicios","cat":"Modelos","limit":6,"style":"lista","bg":"suave"},{"id":"e1e1","type":"equipo","show":false},{"id":"g1g1","type":"galeria","limit":8,"style":"mosaico"}]}'),
  ('{"blocks":[{"id":"v1v1","type":"ventajas","items":[{"icon":"clock","title":"24/7","text":"Cuando quieras"},{"title":"Sin icono"}]},{"id":"r1r1","type":"reservar","bg":"marca"},{"id":"c1c1","type":"contacto","map":true},{"id":"t1t1","type":"texto","text":"Comillas \" y <b> se guardan tal cual; la web las escapa","style":"solo-texto"}]}');
select qa.ok(not exists (select 1 from qa.buenas where not private.web_page_valida(c)),
  'web_page: ' || (select count(*) from qa.buenas) || ' formas válidas aceptadas');

-- Formas inválidas
create table qa.malas (c jsonb, why text);
insert into qa.malas values
  ('[]', 'no es objeto'), ('{"blocks":{}}', 'blocks no es lista'), ('{"x":1,"blocks":[]}', 'clave desconocida'),
  ('{"blocks":[{"type":"portada"}]}', 'sin id'),
  ('{"blocks":[{"id":"AB12","type":"portada"}]}', 'id con mayúsculas'),
  ('{"blocks":[{"id":"ab12","type":"portada"},{"id":"ab12","type":"texto"}]}', 'id repetido'),
  ('{"blocks":[{"id":"ab12","type":"html"}]}', 'tipo desconocido'),
  ('{"blocks":[{"id":"ab12","type":"portada"},{"id":"cd34","type":"portada"}]}', 'dos portadas'),
  ('{"blocks":[{"id":"ab12","type":"servicios","style":"foto-fondo"}]}', 'estilo de otro bloque'),
  ('{"blocks":[{"id":"ab12","type":"servicios","bg":"rojo"}]}', 'fondo desconocido'),
  ('{"blocks":[{"id":"ab12","type":"servicios","show":"no"}]}', 'show no booleano'),
  ('{"blocks":[{"id":"ab12","type":"servicios","limit":0}]}', 'limit 0'),
  ('{"blocks":[{"id":"ab12","type":"servicios","limit":2.5}]}', 'limit decimal'),
  ('{"blocks":[{"id":"ab12","type":"servicios","limit":99}]}', 'limit 99'),
  ('{"blocks":[{"id":"ab12","type":"portada","image":"http://x.com/a.jpg"}]}', 'foto http'),
  ('{"blocks":[{"id":"ab12","type":"portada","image":"https://x.com/a\".jpg"}]}', 'foto con comillas'),
  ('{"blocks":[{"id":"ab12","type":"portada","image":"javascript:alert(1)"}]}', 'foto javascript'),
  ('{"blocks":[{"id":"ab12","type":"portada","onclick":"x"}]}', 'clave extra en bloque'),
  ('{"blocks":[{"id":"ab12","type":"ventajas","items":[{"icon":"a b"}]}]}', 'icono inválido'),
  ('{"blocks":[{"id":"ab12","type":"ventajas","items":[{"title":"x","url":"y"}]}]}', 'clave extra en item'),
  ('{"blocks":[{"id":"ab12","type":"ventajas","items":[{},{},{},{},{},{},{}]}]}', '7 items');
insert into qa.malas select jsonb_build_object('blocks', jsonb_build_array(jsonb_build_object('id', 'ab12', 'type', 'texto', 'title', repeat('a', 121)))), 'título largo';
insert into qa.malas select jsonb_build_object('blocks', (select jsonb_agg(jsonb_build_object('id', 'b' || lpad(n::text, 3, '0'), 'type', 'texto')) from generate_series(1, 25) n)), '25 bloques';
do $$
declare r record;
begin
  for r in select * from qa.malas where private.web_page_valida(c) loop
    raise notice 'ACEPTADA (no debía): % → %', r.why, r.c;
  end loop;
end $$;
select qa.ok(not exists (select 1 from qa.malas where private.web_page_valida(c)),
  'web_page: ' || (select count(*) from qa.malas) || ' formas inválidas rechazadas');
select qa.err($q$update public.tenants set web_page = '{"blocks":[{"id":"ab12","type":"html"}]}' where id = qa.id('tA')$q$,
  'tenants_web_page_valida', 'CHECK de tenants rechaza un diseño inválido');

-- Quién cambia el diseño
select qa.login(qa.id('adminA'));
set role authenticated;
update public.tenants set web_page = '{"blocks":[{"id":"ab12","type":"portada","title":"Hola"}]}' where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select web_page #>> '{blocks,0,title}' = 'Hola' from public.tenants where id = qa.id('tA')),
  'ADMIN con Configuración diseña la web de su negocio');

select qa.login(qa.id('adminA'));
set role authenticated;
select qa.err($q$update public.tenants set web_editor = false where id = qa.id('tA')$q$,
  'Solo el superadministrador decide', 'ADMIN NO cambia web_editor');
update public.tenants set web_page = '{"blocks":[]}' where id = qa.id('tB');
reset role; select qa.nadie();
select qa.ok((select web_page is null from public.tenants where id = qa.id('tB')), 'ADMIN NO toca el diseño de otro negocio');

select qa.login(qa.id('adminSin'));
set role authenticated;
update public.tenants set web_page = null where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select web_page is not null from public.tenants where id = qa.id('tA')), 'ADMIN sin Configuración NO cambia el diseño');

select qa.login(qa.id('staffA'));
set role authenticated;
update public.tenants set web_page = null where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select web_page is not null from public.tenants where id = qa.id('tA')), 'STAFF NO cambia el diseño');

select qa.login(qa.id('super'));
set role authenticated;
update public.tenants set web_editor = false where id = qa.id('tA');
update public.tenants set web_page = '{"blocks":[{"id":"zz99","type":"reservar"}]}' where id = qa.id('tB');
reset role; select qa.nadie();
select qa.ok((select not web_editor from public.tenants where id = qa.id('tA'))
         and (select web_page #>> '{blocks,0,type}' = 'reservar' from public.tenants where id = qa.id('tB')),
  'SUPERADMIN apaga el editor del negocio y diseña cualquier web');

select qa.login(qa.id('adminA'));
set role authenticated;
select qa.err($q$update public.tenants set web_page = null where id = qa.id('tA')$q$,
  'El diseño de la web solo lo cambia', 'Con el editor apagado, el ADMIN ya no cambia el diseño');
update public.tenants set address = 'Av. Nueva 123' where id = qa.id('tA');
reset role; select qa.nadie();
select qa.ok((select address = 'Av. Nueva 123' from public.tenants where id = qa.id('tA')),
  'Con el editor apagado, el ADMIN sigue guardando su Configuración');

-- La web recibe el diseño
select qa.ok((public.web_barberia('web-21-a') #>> '{page,blocks,0,title}') = 'Hola'
         and (public.web_barberia('web-21-a') #>> '{tenant,page,blocks,0,title}') = 'Hola'
         and jsonb_typeof(public.web_barberia('web-21-a') -> 'services') = 'array',
  'web_barberia devuelve page (arriba y en tenant) y sigue devolviendo servicios');

drop schema qa cascade;
