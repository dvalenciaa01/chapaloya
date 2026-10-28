-- ==========================================================================
-- Pruebas de la migración 16 (solicitudes de la landing)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 15 aplicadas (SIN la 16). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/solicitudes_16.sql
-- El script aplica la 16 dos veces (es repetible) y prueba que la web
-- (anon) solo pueda crear solicitudes con registrar_solicitud, los límites
-- de envío y que solo el superadmin las lea y cambie estado y nota.
-- Cada prueba imprime "OK …"; la primera que falla detiene el script.
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

\ir ../migrations/20261028000016_solicitudes_landing.sql
\ir ../migrations/20261028000016_solicitudes_landing.sql
set client_min_messages = notice;

drop schema if exists qa cascade;
create schema qa;
grant usage on schema qa to public;
create function qa.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FALLA: %', msg; end if;
  raise notice 'OK %', msg;
end $$;
-- ¿La sentencia falla? (devuelve el mensaje o null)
create function qa.err(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on all functions in schema qa to public;

insert into auth.users (id, email, encrypted_password) values
  ('00000000-0000-0000-0000-0000000000a1', 'super16@x.pe', 'hash'),
  ('00000000-0000-0000-0000-0000000000a2', 'otro16@x.pe', 'hash');
insert into public.profiles (id, email, name, role, tenant_id, barber_id, must_change_password) values
  ('00000000-0000-0000-0000-0000000000a1', 'super16@x.pe', 'Super', 'SUPERADMIN', null, null, false);

-- ---------------- La web (anon) ----------------
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);

select qa.ok(public.registrar_solicitud(' Ana Pérez ', 'Barbería Sol', 'Barbería', '+51 987 654 321', ' Ana@Sol.PE '),
  'anon registra una solicitud');
select qa.ok(public.registrar_solicitud('Ana Pérez', 'Barbería Sol', 'Barbería', '987654321', 'otro@sol.pe') = false,
  'el mismo celular dentro de 10 minutos no se repite');
select qa.ok(qa.err($$select public.registrar_solicitud('A', 'Negocio', '', '987654322', 'a@b.pe')$$) like 'Escribe tu nombre%',
  'rechaza nombre corto');
select qa.ok(qa.err($$select public.registrar_solicitud('Luis', 'Negocio', '', '887654322', 'a@b.pe')$$) like 'Escribe un celular%',
  'rechaza celular que no empieza con 9');
select qa.ok(qa.err($$select public.registrar_solicitud('Luis', 'Negocio', '', '987654322', 'sin-arroba')$$) like 'Escribe un correo%',
  'rechaza correo inválido');
select qa.ok(qa.err($$select * from public.solicitudes$$) like '%permission denied%', 'anon no lee la tabla');
select qa.ok(qa.err($$insert into public.solicitudes (nombre, negocio, celular, email) values ('Xx', 'Yy', '911111111', 'x@y.pe')$$) like '%permission denied%',
  'anon no inserta directo');
reset role;

select qa.ok((select celular = '987654321' and email = 'ana@sol.pe' and nombre = 'Ana Pérez' and estado = 'NUEVA'
              from public.solicitudes), 'guarda celular de 9 dígitos, correo en minúsculas y estado NUEVA');

-- Límite por celular: 3 por día (las anteriores, fuera de los 10 minutos)
update public.solicitudes set created_at = now() - interval '1 hour';
insert into public.solicitudes (nombre, negocio, celular, email, created_at) values
  ('Ana Pérez', 'Barbería Sol', '987654321', 'ana@sol.pe', now() - interval '2 hours'),
  ('Ana Pérez', 'Barbería Sol', '987654321', 'ana@sol.pe', now() - interval '3 hours');
set role anon;
select qa.ok(qa.err($$select public.registrar_solicitud('Ana Pérez', 'Barbería Sol', '', '987654321', 'nuevo@sol.pe')$$) like 'Ya recibimos%',
  'más de 3 por celular en un día se rechaza');
reset role;

-- Límite total: 60 por hora
insert into public.solicitudes (nombre, negocio, celular, email, created_at)
select 'Prueba', 'Negocio', '9' || lpad(g::text, 8, '0'), 'p' || g || '@x.pe', now() - interval '20 minutes'
from generate_series(1, 60) g;
set role anon;
select qa.ok(qa.err($$select public.registrar_solicitud('Luis', 'Negocio', '', '955555555', 'luis@x.pe')$$) like 'Recibimos muchas%',
  'más de 60 por hora en total se rechaza');
reset role;
delete from public.solicitudes where nombre = 'Prueba';

-- ---------------- Usuario sin rol de superadmin ----------------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', false);
select qa.ok((select count(*) from public.solicitudes) = 0, 'otro usuario no ve solicitudes');
update public.solicitudes set estado = 'CERRADA';
reset role;
select qa.ok(not exists (select 1 from public.solicitudes where estado = 'CERRADA'), 'otro usuario no cambia el estado');

-- ---------------- Superadmin ----------------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select qa.ok((select count(*) from public.solicitudes) = 3, 'el superadmin ve todas');
update public.solicitudes set estado = 'CONTACTADA', nota = 'Le escribí por WhatsApp'
  where id = (select id from public.solicitudes order by created_at desc limit 1);
select qa.ok((select count(*) from public.solicitudes where estado = 'CONTACTADA' and updated_at > created_at) = 1,
  'el superadmin cambia estado y nota (y se actualiza updated_at)');
select qa.ok(qa.err($$update public.solicitudes set nombre = 'Otro'$$) like '%permission denied%',
  'el superadmin no cambia los datos del formulario');
select qa.ok(qa.err($$update public.solicitudes set estado = 'RARO'$$) like '%check%', 'estado desconocido se rechaza');
delete from public.solicitudes where estado = 'NUEVA';
select qa.ok((select count(*) from public.solicitudes) = 1, 'el superadmin borra solicitudes');
reset role;
select set_config('request.jwt.claims', '', false);

drop schema qa cascade;
delete from public.solicitudes;
delete from public.profiles where id in ('00000000-0000-0000-0000-0000000000a1');
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');
\echo 'solicitudes_16: todas las pruebas pasaron'
