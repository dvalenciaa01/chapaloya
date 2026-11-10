-- ==========================================================================
-- Pruebas de la migración 23 (formato de cada texto del bloque)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 22 aplicadas (SIN la 23). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/constructor_formato_23.sql
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$ begin
  if private.web_page_valida('{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"color":"#FF0000"}}}]}') then
    raise exception 'FALLA: antes de la 23, fmt ya era válido';
  end if;
  raise notice 'OK antes de la 23: fmt se rechaza';
end $$;

set client_min_messages = warning;
\ir ../migrations/20261110000023_constructor_formato_texto.sql
\ir ../migrations/20261110000023_constructor_formato_texto.sql
set client_min_messages = notice;

do $$
declare
  ok jsonb[] := array[
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"font":"bodoni","color":"#FF0000","size":"xl","bold":false,"italic":true,"align":"center"}}}]}',
    '{"blocks":[{"id":"ab12","type":"portada","fmt":{"eyebrow":{"size":"xs"},"text":{"align":"right"},"btn":{"bg":"#112233","color":"#FFFFFF","font":"jost"},"btn2":{"bold":true}}}]}',
    '{"blocks":[{"id":"ab12","type":"ventajas","fmt":{"itemTitle":{"color":"#00AA00"},"itemText":{"size":"s"}}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":null}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"color":null}}}]}',
    -- lo de la 22 sigue valiendo
    '{"blocks":[{"id":"ab12","type":"fotos","style":"carrusel","images":["https://x.com/1.webp"]}],"theme":{"fontTitle":"bodoni"}}'
  ]::jsonb[];
  bad jsonb[] := array[
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"cat":{"color":"#FF0000"}}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"color":"red"}}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"font":"comic-sans"}}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"size":"m"}}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"size":"40px"}}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"bold":"si"}}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"align":"justify"}}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"bg":"#000000"}}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":{"css":"x"}}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"title":"rojo"}}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":[1]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","fmt":{"btn":{"bg":"url(x)"}}}]}'
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
