-- ==========================================================================
-- Pruebas de la migración 19 (web por negocio: diseño y secciones)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 18 aplicadas (SIN la 19). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/web_secciones_19.sql
-- Cada prueba imprime "OK …"; la primera que falla detiene el script.
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$ begin
  if private.crm_config_valida('{"site":{"layout":"boutique"}}') then
    raise exception 'FALLA: antes de la 19, site.layout ya era válido';
  end if;
  raise notice 'OK antes de la 19: site.layout se rechaza';
end $$;

set client_min_messages = warning;
\ir ../migrations/20261109000019_web_secciones.sql
\ir ../migrations/20261109000019_web_secciones.sql
set client_min_messages = notice;

-- Válidas
do $$
declare ok jsonb[] := array[
  '{}',
  '{"site":{"heroTitle":"Hola","heroImage":"https://x.com/a.webp"}}',
  '{"site":{"layout":"clasico"}}',
  '{"site":{"layout":null,"sections":null}}',
  '{"site":{"sections":[{"type":"inicio","label":"Inicio"},{"type":"reservar","label":"Reservar"}]}}',
  '{"site":{"layout":"boutique","sections":[{"type":"inicio","label":"Inicio","show":true},{"type":"servicios","label":"Servicios","show":true},{"type":"servicios","label":"Modelos","show":true,"cat":"Modelos"},{"type":"galeria","label":"Galería","show":true},{"type":"mi-cita","label":"Mi cita","show":true},{"type":"reservar","label":"Reservar cita","show":true}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"Inicio"},{"type":"equipo","label":"Barberos"},{"type":"servicios","label":"Cortes","cat":"Cortes"},{"type":"mi-cita","label":"Mi cita","show":false},{"type":"reservar","label":"Reservas"}]}}',
  '{"modules":{"settings":false},"site":{"sections":[{"type":"inicio","label":"Inicio"},{"type":"reservar","label":"Reservar"}]}}'
]::jsonb[];
  c jsonb;
begin
  foreach c in array ok loop
    if not private.crm_config_valida(c) then raise exception 'FALLA: debía ser válida: %', c; end if;
  end loop;
  raise notice 'OK % configuraciones válidas', array_length(ok, 1);
end $$;

-- Inválidas
do $$
declare bad jsonb[] := array[
  '{"site":{"layout":"moderno"}}',
  '{"site":{"otra":1}}',
  '{"site":{"sections":{}}}',
  '{"site":{"sections":[{"type":"inicio","label":"Inicio"}]}}',
  '{"site":{"sections":[{"type":"servicios","label":"A"},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"servicios","label":"A"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I","show":false},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"reservar","label":"R","show":false}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"blog","label":"Blog"},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"reservar","label":"<b>R</b>"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":""},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"Un nombre demasiado largo para el menú"},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"inicio","label":"I2"},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"equipo","label":"E"},{"type":"equipo","label":"E2"},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"servicios","label":"A"},{"type":"servicios","label":"B"},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"servicios","label":"A","cat":"Uñas"},{"type":"servicios","label":"B","cat":"uñas "},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"servicios","label":"A","cat":"x"},{"type":"servicios","label":"B","cat":"y"},{"type":"servicios","label":"C","cat":"z"},{"type":"servicios","label":"D","cat":"w"},{"type":"servicios","label":"E"},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"equipo","label":"E","cat":"x"},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"mi-cita","label":"M","show":"no"},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I","extra":1},{"type":"reservar","label":"R"}]}}',
  '{"site":{"sections":[{"type":"inicio","label":"I"},{"type":"servicios","label":"1"},{"type":"equipo","label":"2"},{"type":"galeria","label":"3"},{"type":"mi-cita","label":"4"},{"type":"servicios","label":"5","cat":"a"},{"type":"servicios","label":"6","cat":"b"},{"type":"servicios","label":"7","cat":"c"},{"type":"reservar","label":"R"},{"type":"inicio","label":"x"},{"type":"reservar","label":"y"}]}}'
]::jsonb[];
  c jsonb;
begin
  foreach c in array bad loop
    if private.crm_config_valida(c) then raise exception 'FALLA: debía rechazarse: %', c; end if;
  end loop;
  raise notice 'OK % configuraciones inválidas rechazadas', array_length(bad, 1);
end $$;

-- La web recibe layout y sections; sin dato, null
do $$
declare s jsonb;
begin
  s := private.site_publico('{"site":{"layout":"boutique","sections":[{"type":"inicio","label":"Inicio"},{"type":"reservar","label":"Reservar"}]}}');
  if s ->> 'layout' <> 'boutique' or jsonb_array_length(s -> 'sections') <> 2 then raise exception 'FALLA: site_publico %', s; end if;
  s := private.site_publico('{}');
  if s -> 'layout' <> 'null'::jsonb or s -> 'sections' <> 'null'::jsonb or s -> 'heroTitle' <> 'null'::jsonb then
    raise exception 'FALLA: site_publico vacío %', s;
  end if;
  raise notice 'OK site_publico devuelve layout y sections';
end $$;

-- La restricción de tenants y el enlace reservado
do $$
declare t uuid;
begin
  select id into t from public.tenants limit 1;
  if t is null then raise notice 'OK (sin negocios para probar la restricción)'; return; end if;
  update public.tenants set crm_config = '{"site":{"sections":[{"type":"inicio","label":"Inicio"},{"type":"reservar","label":"Reservar"}]}}' where id = t;
  begin
    update public.tenants set crm_config = '{"site":{"sections":[{"type":"inicio","label":"Inicio"}]}}' where id = t;
    raise exception 'FALLA: la restricción aceptó secciones sin Reservar';
  exception when check_violation then null;
  end;
  begin
    update public.tenants set slug = 'galeria' where id = t;
    raise exception 'FALLA: se aceptó el enlace galeria';
  exception when check_violation then null;
  end;
  update public.tenants set crm_config = '{}' where id = t;
  raise notice 'OK la restricción de tenants valida site y rechaza el enlace galeria';
end $$;
