-- ==========================================================================
-- Pruebas de la migración 26 (fotos de modelo al reservar)
-- --------------------------------------------------------------------------
-- Requiere PostgreSQL 16 local con supabase/tests/supabase_stub.sql y las
-- migraciones 1 a 25 aplicadas. Ejecutar como superusuario:
--   psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/reserva_fotos_26.sql
-- NO ejecutar en Supabase. Deja la base como estaba (todo va en una transacción).
-- ==========================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\ir ../migrations/20261110000026_reserva_fotos_modelo.sql
\ir ../migrations/20261110000026_reserva_fotos_modelo.sql
set client_min_messages = notice;

begin;
do $$
declare
  t public.tenants;
  sid uuid;
  bid uuid;
  d date;
  p1 text;
  p2 text;
  r jsonb;
  a public.appointments;
  n int := 0;
  bad text;
begin
  select * into t from public.tenants
   where status = 'ACTIVE' and exists (select 1 from public.services s where s.tenant_id = tenants.id and s.active)
   order by created_at limit 1;
  select id into sid from public.services where tenant_id = t.id and active limit 1;
  select id into bid from public.barbers where tenant_id = t.id and active limit 1;
  if bid is null and t.id is not null then
    insert into public.barbers (tenant_id, name) values (t.id, 'Prueba Fotos') returning id into bid;
  end if;
  if sid is null or bid is null then raise exception 'FALLA: faltan datos de prueba (servicio/profesional)'; end if;
  p1 := t.id || '/' || gen_random_uuid() || '.jpg';
  p2 := t.id || '/' || gen_random_uuid() || '.webp';

  -- Apagada por defecto y web_barberia lo dice
  if t.booking_photos then raise exception 'FALLA: la opción debía nacer apagada'; end if;
  if (public.web_barberia(t.slug) ->> 'booking_photos')::boolean is distinct from false then
    raise exception 'FALLA: web_barberia no devuelve booking_photos=false';
  end if;

  -- Sin la opción: rechaza fotos
  begin
    perform private.fotos_reserva(t, array[p1]);
    raise exception 'FALLA: aceptó fotos con la opción apagada';
  exception when sqlstate '22023' then n := n + 1;
  end;
  -- Sin fotos siempre vale
  if cardinality(private.fotos_reserva(t, null)) <> 0 or cardinality(private.fotos_reserva(t, '{}')) <> 0 then
    raise exception 'FALLA: sin fotos debía devolver vacío';
  end if;

  update public.tenants set booking_photos = true where id = t.id;
  select * into t from public.tenants where id = t.id;
  if (public.web_barberia(t.slug) ->> 'booking_photos')::boolean is distinct from true then
    raise exception 'FALLA: web_barberia no devuelve booking_photos=true';
  end if;

  if private.fotos_reserva(t, array[p1, p2]) <> array[p1, p2] then raise exception 'FALLA: rutas válidas rechazadas'; end if;

  -- Rutas inválidas, una por una
  for bad in select unnest(array[
      gen_random_uuid() || '/' || gen_random_uuid() || '.jpg',
      t.id || '/../x/' || gen_random_uuid() || '.jpg',
      t.id || '/' || gen_random_uuid() || '.gif',
      t.id || '/' || gen_random_uuid() || '.svg',
      'https://x.com/a.jpg',
      t.id || '/sub/' || gen_random_uuid() || '.jpg'
    ]) loop
    begin
      perform private.fotos_reserva(t, array[bad]);
      raise exception 'FALLA: aceptó una ruta inválida: %', bad;
    exception when sqlstate '22023' then n := n + 1;
    end;
  end loop;
  begin
    perform private.fotos_reserva(t, array[p1, p2, p1 || 'a', p2 || 'b']);
    raise exception 'FALLA: aceptó 4 fotos';
  exception when sqlstate '22023' then n := n + 1;
  end;
  begin
    perform private.fotos_reserva(t, array[p1, p1]);
    raise exception 'FALLA: aceptó una foto repetida';
  exception when sqlstate '22023' then n := n + 1;
  end;
  begin
    perform private.fotos_reserva(t, array[null::text]);
    raise exception 'FALLA: aceptó una ruta nula';
  exception when sqlstate '22023' then n := n + 1;
  end;
  raise notice 'OK % rutas inválidas rechazadas', n;

  -- crear_reserva guarda las fotos en la cita
  d := (now() at time zone t.timezone)::date + 3;
  r := public.crear_reserva(t.slug, sid, bid, d, '10:00', 'Prueba Fotos', '987650001', '', false, '{}', array[p1, p2]);
  select * into a from public.appointments where id = (r ->> 'id')::uuid;
  if a.ref_photos <> array[p1, p2] then raise exception 'FALLA: la cita no guardó las fotos: %', a.ref_photos; end if;
  raise notice 'OK crear_reserva guarda las fotos';

  -- Sin p_ref_photos (Edge Function anterior) sigue funcionando
  r := public.crear_reserva(p_slug => t.slug, p_service_id => sid, p_barber_id => bid, p_date => d + 1, p_time => '11:00',
                            p_name => 'Prueba Sin Fotos', p_phone => '987650002');
  select * into a from public.appointments where id = (r ->> 'id')::uuid;
  if a.ref_photos <> '{}' then raise exception 'FALLA: cita sin fotos con ref_photos'; end if;
  raise notice 'OK crear_reserva sin fotos (llamada antigua)';

  -- La tabla no acepta más de 3
  begin
    update public.appointments set ref_photos = array['a', 'b', 'c', 'd'] where id = a.id;
    raise exception 'FALLA: la tabla aceptó 4 fotos';
  exception when check_violation then raise notice 'OK la tabla limita a 3 fotos';
  end;
end $$;

-- Permisos: ni anon ni authenticated llaman crear_reserva ni fotos_reserva
do $$
begin
  if has_function_privilege('anon', 'public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb, text[])', 'execute')
     or has_function_privilege('anon', 'private.fotos_reserva(public.tenants, text[])', 'execute') then
    raise exception 'FALLA: permisos de crear_reserva / fotos_reserva';
  end if;
  if (select count(*) from pg_proc where proname = 'crear_reserva' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'FALLA: quedó más de una versión de crear_reserva';
  end if;
  raise notice 'OK permisos';
end $$;
rollback;
