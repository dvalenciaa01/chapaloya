-- ==========================================================================
-- Reservalope · Migración 5 · Lo que necesita la app (Fase 1)
-- --------------------------------------------------------------------------
--  1. Horarios ocupados para la web pública (sin datos de clientes)
--  2. Fotos y logos en Supabase Storage (bucket público "media")
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. WEB PÚBLICA · horarios ocupados de los próximos días, todos los barberos.
--    La web los usa para bloquear horarios y saltar al primer día libre.
-- --------------------------------------------------------------------------
create or replace function public.web_ocupados(p_slug text, p_days int default 60)
returns table (barber_id uuid, date date, "time" text)
language sql stable security definer set search_path = '' as $$
  select a.barber_id, a.date, to_char(a.time, 'HH24:MI')
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  where t.slug = lower(p_slug) and t.status = 'ACTIVE'
    and a.status <> 'CANCELADA'
    and a.date >= (now() at time zone t.timezone)::date
    and a.date <= (now() at time zone t.timezone)::date + least(greatest(p_days, 1), 120)
$$;
revoke all on function public.web_ocupados(text, int) from public;
grant execute on function public.web_ocupados(text, int) to anon, authenticated;

-- Uso de la base de datos (Reservalope → Plataforma). Solo superadmin.
create or replace function public.plataforma_uso()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_superadmin() then
    raise exception 'No tienes permiso para esta acción.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'limit_bytes', 500 * 1024 * 1024,
    'tenants', (select jsonb_object_agg(t.id, coalesce(x.n, 0))
                from public.tenants t
                left join (select tenant_id, count(*) n from public.appointments group by tenant_id) x
                  on x.tenant_id = t.id));
end $$;
revoke all on function public.plataforma_uso() from public, anon;
grant execute on function public.plataforma_uso() to authenticated;

-- --------------------------------------------------------------------------
-- 2. STORAGE · bucket "media": lectura pública, escritura solo del equipo.
--    Ruta obligatoria: <id de la barbería>/<archivo>
-- --------------------------------------------------------------------------
create or replace function private.try_uuid(p text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;
grant execute on function private.try_uuid(text) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
    on conflict (id) do update set public = true, file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    execute $p$
      create policy media_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'media'
                  and private.is_tenant_admin(private.try_uuid((storage.foldername(name))[1])))
    $p$;
    execute $p$
      create policy media_update on storage.objects for update to authenticated
      using (bucket_id = 'media'
             and private.is_tenant_admin(private.try_uuid((storage.foldername(name))[1])))
    $p$;
    execute $p$
      create policy media_delete on storage.objects for delete to authenticated
      using (bucket_id = 'media'
             and private.is_tenant_admin(private.try_uuid((storage.foldername(name))[1])))
    $p$;
  end if;
end $$;
