-- ==========================================================================
-- Pruebas de la migración 29 (landing editable desde la consola)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 28 aplicadas (SIN la 29). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/landing_29.sql
-- Aplica la 29 dos veces (es repetible) y prueba que todos lean el contenido,
-- que solo el superadmin lo cambie y que se rechace contenido inválido.
-- Cada prueba imprime "OK …"; la primera que falla detiene el script.
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

\ir ../migrations/20261112000029_landing_editable.sql
\ir ../migrations/20261112000029_landing_editable.sql
set client_min_messages = notice;

drop schema if exists qa cascade;
create schema qa;
grant usage on schema qa to public;
create function qa.ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FALLA: %', msg; end if;
  raise notice 'OK %', msg;
end $$;
create function qa.err(sql text) returns text language plpgsql as $$
begin
  execute sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on all functions in schema qa to public;

insert into auth.users (id, email, encrypted_password) values
  ('00000000-0000-0000-0000-0000000000b1', 'super29@x.pe', 'hash'),
  ('00000000-0000-0000-0000-0000000000b2', 'otro29@x.pe', 'hash')
on conflict do nothing;
insert into public.profiles (id, email, name, role, tenant_id, barber_id, must_change_password) values
  ('00000000-0000-0000-0000-0000000000b1', 'super29@x.pe', 'Super', 'SUPERADMIN', null, null, false)
on conflict do nothing;

select qa.ok((select count(*) from public.landing_contenido) = 1 and (select contenido = '{}'::jsonb from public.landing_contenido),
  'hay una sola fila, vacía');

-- ---------------- La web (anon) ----------------
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select qa.ok((select contenido from public.landing_contenido where id = 1) = '{}'::jsonb, 'anon lee el contenido');
select qa.ok(qa.err($$update public.landing_contenido set contenido = '{"text":{"portada.title":"X"}}'$$) like '%permission denied%', 'anon no tiene permiso de cambiar');
reset role;
select qa.ok((select contenido = '{}'::jsonb from public.landing_contenido), 'anon no lo cambia');

-- ---------------- Usuario que no es superadmin ----------------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', false);
update public.landing_contenido set contenido = '{"text":{"portada.title":"X"}}';
select qa.ok(qa.err($$insert into public.landing_contenido (id) values (1)$$) like '%permission denied%', 'nadie inserta filas');
reset role;
select qa.ok((select contenido = '{}'::jsonb from public.landing_contenido), 'otro usuario no lo cambia');

-- ---------------- Superadmin ----------------
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false);
update public.landing_contenido set contenido =
  '{"v":1,"text":{"portada.title":"Agenda simple.","preguntas.i2.q":"¿Y si…?"},
    "media":{"videos.i1.video":{"src":"https://x.supabase.co/storage/v1/object/public/media/a/b.mp4","poster":"https://x.supabase.co/p.jpg"}},
    "hidden":["panel","preguntas.i5"],"seo":{"title":"Reservalope","description":"Reservas"}}';
select qa.ok((select contenido->'text'->>'portada.title' = 'Agenda simple.' from public.landing_contenido), 'el superadmin guarda');
reset role;
select qa.ok((select updated_by = '00000000-0000-0000-0000-0000000000b1' from public.landing_contenido), 'guarda quién cambió');
set role authenticated;
select qa.ok(qa.err($$update public.landing_contenido set contenido = '{"html":"<b>x</b>"}'$$) like '%landing_contenido_valido%', 'rechaza claves desconocidas');
select qa.ok(qa.err($$update public.landing_contenido set contenido = '{"text":{"a b":"x"}}'$$) like '%landing_contenido_valido%', 'rechaza claves de texto raras');
select qa.ok(qa.err($$update public.landing_contenido set contenido = '{"text":{"a":1}}'$$) like '%landing_contenido_valido%', 'rechaza textos que no son texto');
select qa.ok(qa.err($$update public.landing_contenido set contenido = jsonb_build_object('text', jsonb_build_object('a', repeat('x', 2001)))$$) like '%landing_contenido_valido%', 'rechaza textos muy largos');
select qa.ok(qa.err($$update public.landing_contenido set contenido = '{"media":{"a":{"src":"javascript:alert(1)"}}}'$$) like '%landing_contenido_valido%', 'rechaza videos que no son https');
select qa.ok(qa.err($$update public.landing_contenido set contenido = '{"media":{"a":{"src":"https://x.pe/\"onerror=x"}}}'$$) like '%landing_contenido_valido%', 'rechaza enlaces con comillas');
select qa.ok(qa.err($$update public.landing_contenido set contenido = '{"hidden":"panel"}'$$) like '%landing_contenido_valido%', 'hidden debe ser una lista');
select qa.ok(qa.err($$update public.landing_contenido set contenido = '{"seo":{"title":1}}'$$) like '%landing_contenido_valido%', 'seo con texto');
select qa.ok(qa.err($$update public.landing_contenido set id = 2$$) is not null, 'no se cambia el id');
reset role;

select 'TODAS LAS PRUEBAS DE LA 29 PASARON' as resultado;
