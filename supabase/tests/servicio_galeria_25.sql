-- ==========================================================================
-- Pruebas de la migración 25 (más fotos y videos por servicio)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 24 aplicadas (SIN la 25). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/servicio_galeria_25.sql
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\ir ../migrations/20261110000025_servicio_galeria.sql
\ir ../migrations/20261110000025_servicio_galeria.sql
set client_min_messages = notice;

do $$
declare
  ok jsonb[] := array[
    '[]',
    '[{"type":"image","url":"https://x.supabase.co/storage/v1/object/public/media/t/a.webp"}]',
    '[{"type":"video","url":"https://x.supabase.co/storage/v1/object/public/media/t/a.mp4"},{"type":"image","url":"https://x.com/b.jpg"}]'
  ]::jsonb[];
  bad jsonb[] := array[
    '{}', '["https://x.com/a.jpg"]',
    '[{"type":"audio","url":"https://x.com/a.mp3"}]',
    '[{"type":"image","url":"http://x.com/a.jpg"}]',
    '[{"type":"image","url":"javascript:alert(1)"}]',
    '[{"type":"image","url":"https://x.com/a\"onerror=x.jpg"}]',
    '[{"type":"image","url":"https://x.com/a.jpg","title":"x"}]',
    '[{"type":"image"}]',
    '[1,2,3,4,5,6,7,8,9,10,11,12,13]'
  ]::jsonb[];
  v jsonb;
  tid uuid;
  sid uuid;
  r jsonb;
begin
  foreach v in array ok loop
    if not private.servicio_media_valida(v) then raise exception 'FALLA: debía ser válido: %', v; end if;
  end loop;
  foreach v in array bad loop
    if private.servicio_media_valida(v) then raise exception 'FALLA: debía rechazarse: %', v; end if;
  end loop;
  raise notice 'OK % válidos y % rechazados', array_length(ok, 1), array_length(bad, 1);

  -- La columna rechaza datos inválidos y web_barberia devuelve media
  select s.id, s.tenant_id into sid, tid from public.services s where s.active limit 1;
  if sid is null then raise notice 'Sin servicios de prueba: se omite la parte de la tabla'; return; end if;
  update public.services set media = '[{"type":"video","url":"https://x.com/v.mp4"}]' where id = sid;
  begin
    update public.services set media = '[{"type":"image","url":"http://x.com/a.jpg"}]' where id = sid;
    raise exception 'FALLA: la tabla aceptó media inválido';
  exception when check_violation then raise notice 'OK la tabla rechaza media inválido';
  end;
  select x into r from jsonb_array_elements(public.web_barberia((select slug from public.tenants where id = tid)) -> 'services') x
   where x ->> 'id' = sid::text;
  if r -> 'media' -> 0 ->> 'url' is distinct from 'https://x.com/v.mp4' then raise exception 'FALLA: web_barberia no devuelve media: %', r; end if;
  raise notice 'OK web_barberia devuelve media';
  update public.services set media = '[]' where id = sid;
end $$;
