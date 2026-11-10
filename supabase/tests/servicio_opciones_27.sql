-- ==========================================================================
-- Pruebas de la migración 27 (opciones por servicio y precio "Desde")
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 26 aplicadas. Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/servicio_opciones_27.sql
-- NO ejecutar en Supabase. Los datos de prueba se deshacen (rollback).
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\ir ../migrations/20261110000027_servicio_opciones.sql
\ir ../migrations/20261110000027_servicio_opciones.sql
set client_min_messages = notice;

begin;
do $$
declare
  opts constant jsonb := '[
    {"id":"tam1","name":"Tamaño","required":true,"items":[
      {"id":"cort","name":"Corto","price":0},{"id":"medi","name":"Medio","price":15},{"id":"larg","name":"Largo","price":30.5}]},
    {"id":"ext1","name":"Extras","multi":true,"items":[
      {"id":"pied","name":"Piedras","price":10},{"id":"fran","name":"Francés","price":8}]}]';
  ok jsonb[] := array['[]', opts]::jsonb[];
  bad jsonb[] := array[
    '{}',
    '[{"id":"tam1","name":"T","items":[]}]',
    '[{"id":"TAM","name":"T","items":[{"id":"aaaa","name":"x","price":1}]}]',
    '[{"id":"tam1","name":"","items":[{"id":"aaaa","name":"x","price":1}]}]',
    '[{"id":"tam1","name":"<b>","items":[{"id":"aaaa","name":"x","price":1}]}]',
    '[{"id":"tam1","name":"T","items":[{"id":"aaaa","name":"x","price":-1}]}]',
    '[{"id":"tam1","name":"T","items":[{"id":"aaaa","name":"x","price":"5"}]}]',
    '[{"id":"tam1","name":"T","items":[{"id":"aaaa","name":"x","price":1.555}]}]',
    '[{"id":"tam1","name":"T","items":[{"id":"aaaa","name":"x","price":1},{"id":"aaaa","name":"y","price":2}]}]',
    '[{"id":"tam1","name":"T","items":[{"id":"aaaa","name":"x","price":1}]},{"id":"tam1","name":"U","items":[{"id":"bbbb","name":"x","price":1}]}]',
    '[{"id":"tam1","name":"T","multi":"si","items":[{"id":"aaaa","name":"x","price":1}]}]',
    '[{"id":"tam1","name":"T","x":1,"items":[{"id":"aaaa","name":"x","price":1}]}]'
  ]::jsonb[];
  v jsonb;
  t public.tenants;
  s public.services;
  bid uuid;
  d date;
  r jsonb;
  a public.appointments;
  n int := 0;
  sel jsonb;
begin
  foreach v in array ok loop
    if not private.servicio_opciones_valida(v) then raise exception 'FALLA: debía ser válido: %', v; end if;
  end loop;
  foreach v in array bad loop
    if private.servicio_opciones_valida(v) then raise exception 'FALLA: debía rechazarse: %', v; end if;
  end loop;
  raise notice 'OK % válidos y % rechazados', array_length(ok, 1), array_length(bad, 1);

  select * into t from public.tenants
   where status = 'ACTIVE' and exists (select 1 from public.services x where x.tenant_id = tenants.id and x.active)
   order by created_at limit 1;
  select * into s from public.services where tenant_id = t.id and active limit 1;
  select id into bid from public.barbers where tenant_id = t.id and active limit 1;
  if bid is null then insert into public.barbers (tenant_id, name) values (t.id, 'Prueba Opciones') returning id into bid; end if;

  begin
    update public.services set options = '[{"id":"x"}]' where id = s.id;
    raise exception 'FALLA: la tabla aceptó opciones inválidas';
  exception when check_violation then raise notice 'OK la tabla rechaza opciones inválidas';
  end;
  update public.services set options = opts, price_from = true, price = 50 where id = s.id returning * into s;

  r := (select x from jsonb_array_elements(public.web_barberia(t.slug) -> 'services') x where x ->> 'id' = s.id::text);
  if r -> 'options' <> opts or (r ->> 'price_from')::boolean is distinct from true then
    raise exception 'FALLA: web_barberia no devuelve options/price_from: %', r;
  end if;
  raise notice 'OK web_barberia devuelve options y price_from';

  -- Cálculo
  r := private.opciones_reserva(s, '{"tam1":["larg"],"ext1":["fran","pied"]}');
  if (r ->> 'total')::numeric <> 48.5 or jsonb_array_length(r -> 'items') <> 3
     or r -> 'items' -> 2 ->> 'item' <> 'Francés' then
    raise exception 'FALLA: cálculo de opciones: %', r;
  end if;
  raise notice 'OK total 48.5 en el orden del servicio';

  foreach sel in array array[
      '{}',                                   -- falta el obligatorio
      '{"tam1":["cort","medi"]}',             -- dos en un grupo de una
      '{"tam1":["zzzz"]}',                    -- opción que no existe
      '{"otro":["cort"]}',                    -- grupo que no existe
      '{"tam1":["cort","cort"]}',             -- repetida
      '{"tam1":"cort"}',                      -- no es lista
      '{"tam1":[1]}',
      '[]'
    ]::jsonb[] loop
    begin
      perform private.opciones_reserva(s, sel);
      raise exception 'FALLA: aceptó opciones inválidas: %', sel;
    exception when sqlstate '22023' then n := n + 1;
    end;
  end loop;
  raise notice 'OK % selecciones inválidas rechazadas', n;

  -- crear_reserva guarda opciones y total
  d := (now() at time zone t.timezone)::date + 4;
  r := public.crear_reserva(p_slug => t.slug, p_service_id => s.id, p_barber_id => bid, p_date => d, p_time => '10:00',
                            p_name => 'Prueba Opciones', p_phone => '987650011',
                            p_options => '{"tam1":["medi"],"ext1":["pied"]}');
  select * into a from public.appointments where id = (r ->> 'id')::uuid;
  if a.price <> 75 or jsonb_array_length(a.options) <> 2 or (r ->> 'price')::numeric <> 75 then
    raise exception 'FALLA: la cita no tiene el total o las opciones: % %', a.price, a.options;
  end if;
  raise notice 'OK crear_reserva guarda opciones y total (75)';

  -- Obligatorio sin elegir → error en español
  begin
    perform public.crear_reserva(p_slug => t.slug, p_service_id => s.id, p_barber_id => bid, p_date => d, p_time => '11:00',
                                 p_name => 'Prueba Opciones', p_phone => '987650012');
    raise exception 'FALLA: reservó sin el tamaño obligatorio';
  exception when sqlstate '22023' then
    if sqlerrm !~ 'Tamaño' then raise exception 'FALLA: mensaje: %', sqlerrm; end if;
    raise notice 'OK pide el grupo obligatorio: %', sqlerrm;
  end;

  -- Servicio sin opciones: precio de siempre
  update public.services set options = '[]' where id = s.id returning * into s;
  r := public.crear_reserva(p_slug => t.slug, p_service_id => s.id, p_barber_id => bid, p_date => d, p_time => '11:00',
                            p_name => 'Prueba Opciones', p_phone => '987650013');
  select * into a from public.appointments where id = (r ->> 'id')::uuid;
  if a.price <> 50 or a.options <> '[]' then raise exception 'FALLA: cita sin opciones: % %', a.price, a.options; end if;
  raise notice 'OK servicio sin opciones conserva su precio';
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb, text[], jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb, text[], jsonb)', 'execute')
     or has_function_privilege('anon', 'private.opciones_reserva(public.services, jsonb)', 'execute') then
    raise exception 'FALLA: permisos';
  end if;
  if (select count(*) from pg_proc where proname = 'crear_reserva' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'FALLA: quedó más de una versión de crear_reserva';
  end if;
  raise notice 'OK permisos';
end $$;
rollback;
