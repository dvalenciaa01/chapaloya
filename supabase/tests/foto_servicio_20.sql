-- ==========================================================================
-- Pruebas de la migración 20 (foto referencial por servicio)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 19 aplicadas (SIN la 20). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/foto_servicio_20.sql
-- Cada prueba imprime "OK …"; la primera que falla detiene el script.
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\ir ../migrations/20261110000020_foto_servicio.sql
\ir ../migrations/20261110000020_foto_servicio.sql
set client_min_messages = notice;

do $$
declare tid uuid := gen_random_uuid(); sid uuid; j jsonb; ok boolean;
begin
  insert into public.tenants (id, slug, name) values (tid, 'prueba-foto-20', 'Prueba foto');
  insert into public.services (tenant_id, name) values (tid, 'Sin foto') ;
  insert into public.services (tenant_id, name, image_url) values (tid, 'Con foto', 'https://x.supabase.co/storage/v1/object/public/media/a/b.webp') returning id into sid;
  j := public.web_barberia('prueba-foto-20');
  if (select count(*) from jsonb_array_elements(j->'services') s where s->>'image_url' = 'https://x.supabase.co/storage/v1/object/public/media/a/b.webp') <> 1
  then raise exception 'FALLA: web_barberia no devuelve image_url: %', j->'services'; end if;
  if (select count(*) from jsonb_array_elements(j->'services') s where s ? 'image_url' and s->'image_url' = 'null'::jsonb) <> 1
  then raise exception 'FALLA: el servicio sin foto debía traer image_url null'; end if;
  raise notice 'OK web_barberia devuelve la foto de cada servicio';

  foreach j in array array['"http://x.com/a.jpg"', '"https://x.com/a b.jpg"', '"javascript:alert(1)"', '"https://x.com/a\".jpg"']::jsonb[] loop
    begin
      update public.services set image_url = j #>> '{}' where id = sid;
      ok := true;
    exception when check_violation then ok := false;
    end;
    if ok then raise exception 'FALLA: debía rechazar %', j; end if;
  end loop;
  update public.services set image_url = null where id = sid;
  raise notice 'OK solo acepta enlaces https sin caracteres raros (o vacío)';
  delete from public.tenants where id = tid;
end $$;
