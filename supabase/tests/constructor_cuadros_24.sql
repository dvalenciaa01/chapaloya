-- ==========================================================================
-- Pruebas de la migración 24 (cuadros de texto extra)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 23 aplicadas (SIN la 24). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/constructor_cuadros_24.sql
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$ begin
  if private.web_page_valida('{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"Hola"}]}]}') then
    raise exception 'FALLA: antes de la 24, extras ya era válido';
  end if;
  raise notice 'OK antes de la 24: extras se rechaza';
end $$;

set client_min_messages = warning;
\ir ../migrations/20261110000024_constructor_cuadros_texto.sql
\ir ../migrations/20261110000024_constructor_cuadros_texto.sql
set client_min_messages = notice;

do $$
declare
  ok jsonb[] := array[
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"Hola"},{"id":"x2x2","kind":"titulo","text":"Promo","fmt":{"color":"#FF0000","size":"xl","bold":true,"align":"center","font":"bodoni"}}]}]}',
    '{"blocks":[{"id":"ab12","type":"servicios","extras":[{"id":"x1x1","kind":"subtitulo","text":""}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":null}]}',
    '{"blocks":[{"id":"ab12","type":"texto","title":"","eyebrow":"","text":""}]}',
    -- lo de la 23 sigue valiendo
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"font":"bodoni","color":"#FF0000","size":"xl"}}}]}'
  ]::jsonb[];
  bad jsonb[] := array[
    '{"blocks":[{"id":"ab12","type":"texto","extras":{"a":1}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":["hola"]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"html","text":"x"}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"X!","kind":"parrafo","text":"x"}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a"},{"id":"x1x1","kind":"parrafo","text":"b"}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"x","link":"https://x.com"}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"x","fmt":{"bg":"#000000"}}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"x","fmt":{"color":"red"}}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":1}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"a1a1","kind":"parrafo"},{"id":"a2a2","kind":"parrafo"},{"id":"a3a3","kind":"parrafo"},{"id":"a4a4","kind":"parrafo"},{"id":"a5a5","kind":"parrafo"},{"id":"a6a6","kind":"parrafo"},{"id":"a7a7","kind":"parrafo"},{"id":"a8a8","kind":"parrafo"},{"id":"a9a9","kind":"parrafo"}]}]}'
  ]::jsonb[];
  v jsonb;
begin
  foreach v in array ok loop
    if not private.web_page_valida(v) then raise exception 'FALLA: debía ser válido: %', v; end if;
  end loop;
  raise notice 'OK % diseños válidos', array_length(ok, 1);
  foreach v in array bad loop
    if private.web_page_valida(v) then raise exception 'FALLA: debía rechazarse: %', v; end if;
  end loop;
  raise notice 'OK % diseños inválidos rechazados', array_length(bad, 1);
end $$;
