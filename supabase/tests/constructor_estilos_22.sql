-- ==========================================================================
-- Pruebas de la migración 22 (tipo de letra, colores, fotos y videos)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 21 aplicadas (SIN la 22). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/constructor_estilos_22.sql
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$ begin
  if private.web_page_valida('{"blocks":[],"theme":{"fontTitle":"bodoni"}}') then
    raise exception 'FALLA: antes de la 22, theme ya era válido';
  end if;
  raise notice 'OK antes de la 22: theme se rechaza';
end $$;

set client_min_messages = warning;
\ir ../migrations/20261110000022_constructor_estilos_media.sql
\ir ../migrations/20261110000022_constructor_estilos_media.sql
set client_min_messages = notice;

do $$
declare
  ok jsonb[] := array[
    '{"blocks":[]}',
    '{"blocks":[],"theme":{"fontTitle":"bodoni","fontBody":"dm-sans","primary":"#111111","accent":"#FB23A1"}}',
    '{"blocks":[],"theme":{"fontTitle":null}}',
    '{"blocks":[{"id":"ab12","type":"portada","video":"https://x.supabase.co/storage/v1/object/public/media/a/b.mp4","poster":"https://x.com/p.webp"}]}',
    '{"blocks":[{"id":"ab12","type":"video","style":"con-texto","video":"https://www.youtube.com/watch?v=abc_DEF-123","title":"Mira"}]}',
    '{"blocks":[{"id":"ab12","type":"fotos","style":"carrusel","images":["https://x.com/1.webp","https://x.com/2.webp"]}]}',
    '{"blocks":[{"id":"ab12","type":"texto","bg":"color","bgColor":"#1E293B"}]}',
    -- lo de la 21 sigue valiendo
    '{"blocks":[{"id":"s1s1","type":"servicios","cat":"Modelos","limit":6,"style":"lista","bg":"suave"}]}'
  ]::jsonb[];
  bad jsonb[] := array[
    '{"blocks":[],"theme":{"fontTitle":"comic-sans"}}',
    '{"blocks":[],"theme":{"accent":"rojo"}}',
    '{"blocks":[],"theme":{"css":"body{}"}}',
    '{"blocks":[],"theme":[]}',
    '{"blocks":[{"id":"ab12","type":"texto","bgColor":"#FFF"}]}',
    '{"blocks":[{"id":"ab12","type":"texto","bg":"rojo"}]}',
    '{"blocks":[{"id":"ab12","type":"video","video":"javascript:alert(1)"}]}',
    '{"blocks":[{"id":"ab12","type":"video","video":"http://x.com/a.mp4"}]}',
    '{"blocks":[{"id":"ab12","type":"video","poster":"https://x.com/a\".jpg"}]}',
    '{"blocks":[{"id":"ab12","type":"video","style":"lista"}]}',
    '{"blocks":[{"id":"ab12","type":"fotos","images":"https://x.com/1.webp"}]}',
    '{"blocks":[{"id":"ab12","type":"fotos","images":[1]}]}',
    '{"blocks":[{"id":"ab12","type":"fotos","images":["http://x.com/1.webp"]}]}'
  ]::jsonb[];
  c jsonb;
begin
  foreach c in array ok loop
    if not private.web_page_valida(c) then raise exception 'FALLA: debía ser válida: %', c; end if;
  end loop;
  raise notice 'OK % formas válidas aceptadas', array_length(ok, 1);
  foreach c in array bad loop
    if private.web_page_valida(c) then raise exception 'FALLA: debía rechazarse: %', c; end if;
  end loop;
  if private.web_page_valida(jsonb_build_object('blocks', jsonb_build_array(jsonb_build_object('id', 'ab12', 'type', 'fotos',
       'images', (select jsonb_agg('https://x.com/' || n || '.webp') from generate_series(1, 13) n))))) then
    raise exception 'FALLA: 13 fotos debían rechazarse';
  end if;
  raise notice 'OK % formas inválidas rechazadas (y 13 fotos)', array_length(bad, 1);
end $$;
