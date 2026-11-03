-- ==========================================================================
-- Pruebas de la migración 18 (Configuración como módulo ocultable)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 17 aplicadas (SIN la 18). Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/configuracion_18.sql
-- Cada prueba imprime "OK …"; la primera que falla detiene el script.
-- NO ejecutar en Supabase.
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

do $$ begin
  if private.crm_config_valida('{"modules":{"settings":false}}') then
    raise exception 'FALLA: antes de la 18, settings=false ya era válido';
  end if;
  raise notice 'OK antes de la 18: settings=false se rechaza';
end $$;

set client_min_messages = warning;
\ir ../migrations/20261103000018_configuracion_modulo.sql
\ir ../migrations/20261103000018_configuracion_modulo.sql
set client_min_messages = notice;

do $$ begin
  if not private.crm_config_valida('{"modules":{"settings":false}}') then raise exception 'FALLA: settings=false'; end if;
  if not private.crm_config_valida('{"modules":{"settings":true,"audit":false}}') then raise exception 'FALLA: settings=true'; end if;
  if private.crm_config_valida('{"modules":{"settings":"no"}}') then raise exception 'FALLA: settings no booleano'; end if;
  if private.crm_config_valida('{"modules":{"inventado":false}}') then raise exception 'FALLA: módulo desconocido'; end if;
  if not private.crm_config_valida('{"modules":{"whatsapp":false},"fields":{"customers":{"email":{"show":true}}}}') then
    raise exception 'FALLA: config de antes dejó de ser válida';
  end if;
  raise notice 'OK settings acepta true/false; lo demás se valida igual';
end $$;

-- La restricción de tenants usa la función nueva
do $$
declare t uuid;
begin
  select id into t from public.tenants limit 1;
  if t is null then raise notice 'OK (sin negocios para probar la restricción)'; return; end if;
  update public.tenants set crm_config = '{"modules":{"settings":false}}' where id = t;
  begin
    update public.tenants set crm_config = '{"modules":{"settings":1}}' where id = t;
    raise exception 'FALLA: la restricción aceptó settings=1';
  exception when check_violation then null;
  end;
  update public.tenants set crm_config = '{}' where id = t;
  raise notice 'OK la restricción de tenants acepta settings=false y rechaza lo inválido';
end $$;
