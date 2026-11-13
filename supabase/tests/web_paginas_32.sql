-- ==========================================================================
-- Pruebas de la migración 32 (diseñar todas las páginas de la web)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 30 aplicadas (SIN la 32). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/web_paginas_32.sql
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$ begin
  if private.web_page_valida('{"blocks":[],"pages":{"servicios":{"blocks":[{"id":"pg01","type":"pagina"}]}}}') then
    raise exception 'FALLA: antes de la 32, pages ya era válido';
  end if;
  raise notice 'OK antes de la 32: pages se rechaza';
end $$;

set client_min_messages = warning;
\ir ../migrations/20261113000032_web_paginas.sql
\ir ../migrations/20261113000032_web_paginas.sql
set client_min_messages = notice;

do $$
declare
  ok jsonb[] := array[
    -- lo de antes sigue valiendo
    '{"blocks":[]}',
    '{"blocks":[{"id":"ab12","type":"portada","title":"Hola"},{"id":"cd34","type":"servicios","style":"lista"}],"theme":{"fontTitle":"dm-serif","accent":"#D2588A"}}',
    '{"blocks":[{"id":"ab12","type":"texto","extras":[{"id":"x1x1","kind":"parrafo","text":"a","pos":{"x":0,"y":0,"w":100}}]}]}',
    '{"blocks":[],"css":".blk{color:red}"}',
    -- páginas
    '{"blocks":[],"pages":{"servicios":{"blocks":[{"id":"pg01","type":"pagina"}]}}}',
    '{"blocks":[],"pages":null}',
    '{"blocks":[{"id":"ab12","type":"portada"}],"pages":{"servicios":{"blocks":[{"id":"ab12","type":"portada","style":"centrado","btn":"","btn2":""},{"id":"pg01","type":"pagina","style":"normal"},{"id":"cd34","type":"reservar","bg":"marca"}]},"equipo":{"blocks":[{"id":"pg02","type":"pagina"},{"id":"ef56","type":"fotos","images":["https://x.com/a.webp"]}]},"galeria":{"blocks":[{"id":"pg03","type":"pagina"}]},"mi-cita":{"blocks":[{"id":"pg04","type":"pagina"}]},"reservar":{"blocks":[{"id":"aa11","type":"texto","title":"Antes de reservar"},{"id":"pg05","type":"pagina"}]}}}'
  ]::jsonb[];
  malo jsonb[] := array[
    '{"blocks":[{"id":"pg01","type":"pagina"}]}',                                         -- "pagina" en el Inicio
    '{"blocks":[],"pages":{"servicios":{"blocks":[]}}}',                                    -- página sin su contenido
    '{"blocks":[],"pages":{"servicios":{"blocks":[{"id":"pg01","type":"pagina"},{"id":"pg02","type":"pagina"}]}}}',
    '{"blocks":[],"pages":{"inicio":{"blocks":[{"id":"pg01","type":"pagina"}]}}}',         -- página desconocida
    '{"blocks":[],"pages":{"privacidad":{"blocks":[{"id":"pg01","type":"pagina"}]}}}',
    '{"blocks":[],"pages":{"servicios":{"blocks":[{"id":"pg01","type":"pagina"}],"x":1}}}',
    '{"blocks":[],"pages":{"servicios":[]}}',
    '{"blocks":[],"pages":[]}',
    '{"blocks":[],"pages":{"servicios":{"blocks":[{"id":"pg01","type":"pagina","style":"tarjetas"}]}}}',
    '{"blocks":[],"pages":{"servicios":{"blocks":[{"id":"pg01","type":"pagina"},{"id":"ab12","type":"portada"},{"id":"cd34","type":"portada"}]}}}',
    '{"blocks":[],"pages":{"reservar":{"blocks":[{"id":"pg01","type":"pagina"},{"id":"ab12","type":"texto","title":"x","image":"javascript:alert(1)"}]}}}',
    '{"blocks":[],"pages":{"reservar":{"blocks":[{"id":"pg01","type":"pagina"},{"id":"pg01","type":"texto"}]}}}',
    '{"blocks":[],"css":"a{background:url(https://x.com/a.png)}"}',
    '{"blocks":[],"otra":1}'
  ]::jsonb[];
  c jsonb;
  grande jsonb;
begin
  foreach c in array ok loop
    if not private.web_page_valida(c) then raise exception 'FALLA: debía ser válida: %', c; end if;
  end loop;
  raise notice 'OK % diseños válidos', array_length(ok, 1);
  foreach c in array malo loop
    if private.web_page_valida(c) then raise exception 'FALLA: debía rechazarse: %', c; end if;
  end loop;
  raise notice 'OK % diseños rechazados', array_length(malo, 1);
  -- Más de 96 KB ahora cabe (hasta 256 KB)
  grande := jsonb_build_object('blocks', (select jsonb_agg(jsonb_build_object('id', 'b' || lpad(i::text, 3, '0'), 'type', 'texto', 'text', repeat('a', 1500))) from generate_series(1, 24) i),
    'pages', (select jsonb_object_agg(k, jsonb_build_object('blocks', (select jsonb_agg(x) from (
       select jsonb_build_object('id', 'pg01', 'type', 'pagina') x
       union all select jsonb_build_object('id', 's' || lpad(i::text, 3, '0'), 'type', 'texto', 'text', repeat('b', 1500)) from generate_series(1, 23) i) q)))
      from unnest(array['servicios', 'equipo']) k));
  if octet_length(grande::text) <= 98304 then raise exception 'FALLA: la prueba debía pasar de 96 KB'; end if;
  if not private.web_page_valida(grande) then raise exception 'FALLA: un diseño de % bytes debía caber', octet_length(grande::text); end if;
  raise notice 'OK diseño de % bytes aceptado', octet_length(grande::text);
end $$;

-- La restricción de tenants sigue usando la función nueva
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_web_page_valida') then
    raise exception 'FALLA: falta la restricción tenants_web_page_valida';
  end if;
  raise notice 'OK restricción en tenants';
end $$;
