-- ==========================================================================
-- Pruebas de la migración 31 (estilo propio de la web: web_page.css)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 30 aplicadas (SIN la 31). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/web_estilo_propio_31.sql
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$ begin
  if private.web_page_valida('{"blocks":[],"css":".blk{color:red}"}') then
    raise exception 'FALLA: antes de la 31, css ya era válido';
  end if;
  raise notice 'OK antes de la 31: css se rechaza';
end $$;

set client_min_messages = warning;
\ir ../migrations/20261112000031_web_estilo_propio.sql
\ir ../migrations/20261112000031_web_estilo_propio.sql
set client_min_messages = notice;

do $$
declare
  ok jsonb[] := array[
    '{"blocks":[],"css":".blk-portada h1{font-size:64px;letter-spacing:.02em}"}',
    '{"blocks":[],"css":null}',
    '{"blocks":[],"css":""}',
    '{"blocks":[{"id":"ab12","type":"portada"}],"theme":{"primary":"#E91E63"},"css":"body{background:#fff}\n.site-header{border-bottom:1px solid #eee}"}',
    -- lo de la 28 sigue valiendo
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","pos":{"x":0,"y":0,"w":100}}]}]}'
  ]::jsonb[];
  bad jsonb[] := array[
    '{"blocks":[],"css":5}',
    '{"blocks":[],"css":".a{background:url(https://x.com/a.png)}"}',
    '{"blocks":[],"css":".a{background:URL (x)}"}',
    '{"blocks":[],"css":"@import \"x.css\";"}',
    '{"blocks":[],"css":"</style><script>alert(1)</script>"}',
    '{"blocks":[],"css":".a{background:u\\72l(x)}"}',
    '{"blocks":[],"css":"@font-face{font-family:x}"}',
    '{"blocks":[],"css":".a{width:expression(alert(1))}"}',
    '{"blocks":[],"css":".a{background:image-set(\"x.png\" 1x)}"}',
    '{"blocks":[],"otra":1}'
  ]::jsonb[];
  x jsonb;
begin
  foreach x in array ok loop
    if not private.web_page_valida(x) then raise exception 'FALLA: debería valer %', x; end if;
  end loop;
  foreach x in array bad loop
    if private.web_page_valida(x) then raise exception 'FALLA: no debería valer %', x; end if;
  end loop;
  if private.web_page_valida(jsonb_build_object('blocks', '[]'::jsonb, 'css', repeat('a', 30001))) then
    raise exception 'FALLA: css de más de 30000 caracteres';
  end if;
  raise notice 'OK web_page.css: % válidos y % rechazados', array_length(ok, 1), array_length(bad, 1) + 1;
end $$;
