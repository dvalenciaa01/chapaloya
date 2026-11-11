-- ==========================================================================
-- Pruebas de la migración 28 (cuadros de texto en posición libre)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 27 aplicadas (SIN la 28). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/constructor_texto_libre_28.sql
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$ begin
  if private.web_page_valida('{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"Hola","pos":{"x":10,"y":20,"w":40}}]}]}') then
    raise exception 'FALLA: antes de la 28, pos ya era válido';
  end if;
  raise notice 'OK antes de la 28: pos se rechaza';
end $$;

set client_min_messages = warning;
\ir ../migrations/20261111000028_constructor_texto_libre.sql
\ir ../migrations/20261111000028_constructor_texto_libre.sql
set client_min_messages = notice;

do $$
declare
  ok jsonb[] := array[
    '{"blocks":[{"id":"ab12","type":"portada","extras":[{"id":"x1x1","kind":"titulo","text":"Promo","pos":{"x":10,"y":20,"w":40}}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","pos":{"x":0,"y":0,"w":100},"mpos":{"x":5.5,"y":80.25,"w":90}}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","pos":null}]}]}',
    -- lo de la 24 sigue valiendo
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"Hola"}]}]}'
  ]::jsonb[];
  bad jsonb[] := array[
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","pos":{"x":10,"y":20}}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","pos":{"x":-1,"y":20,"w":40}}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","pos":{"x":10,"y":101,"w":40}}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","pos":{"x":10,"y":20,"w":5}}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","pos":{"x":"10","y":20,"w":40}}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","pos":{"x":10,"y":20,"w":40,"z":1}}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","mpos":[1,2,3]}]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","top":10}]}]}'
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
